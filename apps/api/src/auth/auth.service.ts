import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { Prisma, Usuario } from '@prisma/client';
import QRCode from 'qrcode';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { Auditoria, Correo } from '../common/servicios';
import type { Actor } from '../common/http';
import type { Config } from '../config';
import { verificarPase } from './portal';
import { cifrar, codigoRespaldo, descifrar, desdeBase32, normalRespaldo, pasoDelCodigo, secretoNuevo, uriOtp } from './totp';

const MAX_INTENTOS = 5;
const BLOQUEO_MIN = 15;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const iguales = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
// Parámetros argon2id recomendados por OWASP (19 MiB, 2 iteraciones).
export const hashClave = (clave: string) => hash(clave, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

type Meta = { ip?: string; ua?: string };
const CODIGOS_RESPALDO = 10;

@Injectable()
export class AuthService {
  private readonly claveTotp: Buffer;
  private readonly claveDesafio: string;
  private readonly pimienta: string;
  constructor(private readonly db: PrismaService, private readonly jwt: JwtService, private readonly cfg: ConfigService<Config, true>,
    private readonly audit: Auditoria, private readonly correo: Correo) {
    // Claves propias de la verificación en dos pasos, distintas de la de las sesiones
    const base = this.cfg.get('CLAVE_2FA', { infer: true }) || `${this.cfg.get('JWT_SECRET', { infer: true })}:2fa`;
    this.claveTotp = createHash('sha256').update(`${base}:totp`).digest();
    this.claveDesafio = createHash('sha256').update(`${base}:desafio`).digest('base64url');
    this.pimienta = createHash('sha256').update(`${base}:respaldo`).digest('hex');
  }

  /** El personal de Terra Viva debe tener la verificación en dos pasos: en producción siempre; en otros entornos, si la empresa lo pide. */
  private obligatorio(u: { clienteId: string | null; empresa: { configuracion: Prisma.JsonValue } }) {
    if (u.clienteId) return false; // portal de clientes: opcional
    return this.cfg.get('NODE_ENV', { infer: true }) === 'production' || (u.empresa.configuracion as { dobleFactorObligatorio?: boolean } | null)?.dobleFactorObligatorio === true;
  }

  async login(email: string, clave: string, meta: { ip?: string; ua?: string }) {
    const u = await this.db.usuario.findUnique({ where: { email: email.trim().toLowerCase() } });
    // Mismo mensaje si el usuario no existe o la clave es incorrecta (no revela qué correos existen).
    const invalido = new UnauthorizedException({ mensaje: 'Correo o contraseña incorrectos.' });
    // Cada intento fallido queda en la auditoría (con la IP): la alerta de seguridad detecta los picos (un ataque)
    if (!u || !u.activo) {
      await hashClave(clave);
      await this.audit.registrar(u ? { id: u.id } : null, 'usuario', u?.id ?? 'desconocido', 'INGRESO_FALLIDO', undefined, { motivo: u ? 'usuario inactivo' : 'correo no registrado' });
      throw invalido;
    }
    if (u.bloqueadoHasta && u.bloqueadoHasta > new Date()) {
      await this.audit.registrar({ id: u.id }, 'usuario', u.id, 'INGRESO_FALLIDO', undefined, { motivo: 'cuenta bloqueada' });
      throw new ForbiddenException({ mensaje: `Cuenta bloqueada temporalmente por intentos fallidos. Intente de nuevo después de las ${u.bloqueadoHasta.toTimeString().slice(0, 5)}.` });
    }
    if (!(await verify(u.passwordHash, clave))) {
      const intentos = u.intentosFallidos + 1;
      await this.db.usuario.update({ where: { id: u.id }, data: { intentosFallidos: intentos >= MAX_INTENTOS ? 0 : intentos, bloqueadoHasta: intentos >= MAX_INTENTOS ? new Date(Date.now() + BLOQUEO_MIN * 60_000) : null } });
      await this.audit.registrar({ id: u.id }, 'usuario', u.id, intentos >= MAX_INTENTOS ? 'BLOQUEO_INGRESO' : 'INGRESO_FALLIDO', undefined, { intentos });
      throw invalido;
    }
    // Segundo paso: con la verificación en dos pasos activa, la contraseña sola no abre sesión. Los intentos fallidos no
    // se reinician hasta que entre el código: así no se pueden probar códigos sin límite repitiendo la contraseña.
    if (u.totpSecreto) {
      const desafio = await this.jwt.signAsync({ sub: u.id, t: '2fa' }, { secret: this.claveDesafio, expiresIn: '5m', issuer: 'terraviva-2fa' });
      return { requiere2fa: true as const, desafio };
    }
    return this.completarIngreso(u, meta);
  }

  private async completarIngreso(u: Usuario, meta: Meta, dobleFactor?: 'TOTP' | 'RESPALDO' | 'PORTAL', viaPortal = false) {
    await this.db.usuario.update({ where: { id: u.id }, data: { intentosFallidos: 0, bloqueadoHasta: null, ultimoLogin: new Date() } });
    await this.audit.registrar({ id: u.id }, 'usuario', u.id, 'LOGIN', undefined, { ip: meta.ip, ...(dobleFactor ? { dobleFactor } : {}) });
    await this.avisarIngresoNuevo(u, meta);
    return this.emitir(u.id, meta, viaPortal);
  }

  /**
   * Entrada única del ecosistema (docs/ECOSISTEMA.md): pase firmado por el portal Terry-App, de 60 segundos y de un solo
   * uso. El portal ya pidió contraseña y verificación en dos pasos; aquí se exige un usuario activo con el mismo correo,
   * y su rol y sus permisos siguen siendo los de Residuos.
   */
  async ingresarConPase(pase: string, meta: Meta) {
    const invalido = new UnauthorizedException({ mensaje: 'El pase del portal no es válido o ya venció. Vuelva a entrar desde el portal Terry-App.' });
    const d = verificarPase(pase, { portal: this.cfg.get('PORTAL_URL', { infer: true }), clavePublica: this.cfg.get('PORTAL_CLAVE_PUBLICA', { infer: true }), modulo: 'residuos' });
    if (!d) {
      await this.audit.registrar(null, 'usuario', 'portal', 'INGRESO_FALLIDO', undefined, { motivo: 'pase del portal inválido', ip: meta.ip });
      throw invalido;
    }
    const u = await this.db.usuario.findUnique({ where: { email: d.sub.trim().toLowerCase() }, include: { empresa: { select: { configuracion: true } } } });
    // Cada pase sirve una sola vez: si llegan dos con el mismo, solo uno gana (lo decide la llave primaria)
    try { await this.db.pasePortal.create({ data: { jti: d.jti, usuarioId: u?.id ?? null, expiraEn: new Date(d.exp * 1000) } }); }
    catch { throw invalido; }
    this.db.pasePortal.deleteMany({ where: { expiraEn: { lt: new Date(Date.now() - 86_400_000) } } }).catch(() => undefined);
    if (!u || !u.activo) {
      await this.audit.registrar(u ? { id: u.id } : null, 'usuario', u?.id ?? 'desconocido', 'INGRESO_FALLIDO', undefined, { motivo: u ? 'usuario inactivo' : 'sin usuario en Residuos', via: 'portal' });
      throw new ForbiddenException({ mensaje: 'Su cuenta Terry-App no tiene acceso a Gestión de Residuos. Pídale al administrador que lo cree aquí con el mismo correo.', codigo: 'SIN_ACCESO' });
    }
    if (u.bloqueadoHasta && u.bloqueadoHasta > new Date()) throw new ForbiddenException({ mensaje: 'Cuenta bloqueada temporalmente por intentos fallidos. Intente de nuevo en unos minutos.' });
    if (this.obligatorio(u) && !d.amr.includes('otp')) {
      await this.audit.registrar({ id: u.id }, 'usuario', u.id, 'INGRESO_FALLIDO', undefined, { motivo: 'pase sin verificación en dos pasos', via: 'portal' });
      throw new ForbiddenException({ mensaje: 'Para entrar a Residuos, el portal debe confirmar la verificación en dos pasos.' });
    }
    return this.completarIngreso(u, meta, 'PORTAL', true);
  }

  /** Segundo paso del ingreso: el código de la app de autenticación o un código de respaldo. */
  async verificar2fa(desafio: string, codigo: string, meta: Meta) {
    const vencido = new UnauthorizedException({ mensaje: 'El ingreso venció: escriba de nuevo su correo y su contraseña.' });
    let p: { sub: string; t?: string };
    try { p = await this.jwt.verifyAsync(desafio, { secret: this.claveDesafio, issuer: 'terraviva-2fa' }); } catch { throw vencido; }
    const u = p.t === '2fa' ? await this.db.usuario.findUnique({ where: { id: p.sub } }) : null;
    if (!u || !u.activo || !u.totpSecreto) throw vencido;
    if (u.bloqueadoHasta && u.bloqueadoHasta > new Date())
      throw new ForbiddenException({ mensaje: `Cuenta bloqueada temporalmente por intentos fallidos. Intente de nuevo después de las ${u.bloqueadoHasta.toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hour12: false })}.` });
    const como = await this.comprobarCodigo(u, codigo);
    if (!como) {
      const intentos = u.intentosFallidos + 1;
      await this.db.usuario.update({ where: { id: u.id }, data: { intentosFallidos: intentos >= MAX_INTENTOS ? 0 : intentos, bloqueadoHasta: intentos >= MAX_INTENTOS ? new Date(Date.now() + BLOQUEO_MIN * 60_000) : null } });
      await this.audit.registrar({ id: u.id }, 'usuario', u.id, '2FA_FALLIDO', undefined, { ip: meta.ip });
      throw new UnauthorizedException({ mensaje: 'El código no es válido o ya se usó. Escriba el que muestra ahora su app de autenticación.' });
    }
    return this.completarIngreso(u, meta, como);
  }

  /** Código vigente de la app (no usado antes) o código de respaldo sin usar. Devuelve cómo se verificó, o null. */
  private async comprobarCodigo(u: Usuario, codigo: string): Promise<'TOTP' | 'RESPALDO' | null> {
    const c = codigo.trim();
    if (/^\d{6}$/.test(c)) {
      if (!u.totpSecreto) return null;
      const paso = pasoDelCodigo(desdeBase32(descifrar(u.totpSecreto, this.claveTotp)), c);
      if (paso === null || paso <= (u.totpUltimoPaso ?? -1)) return null;
      // Si llegan dos peticiones con el mismo código, solo una gana (la condición la evalúa la base)
      const r = await this.db.usuario.updateMany({ where: { id: u.id, OR: [{ totpUltimoPaso: null }, { totpUltimoPaso: { lt: paso } }] }, data: { totpUltimoPaso: paso } });
      return r.count ? 'TOTP' : null;
    }
    const n = normalRespaldo(c);
    if (!/^[A-Z2-7]{8}$/.test(n)) return null;
    const r = await this.db.codigoRespaldo.updateMany({ where: { usuarioId: u.id, codigoHash: this.huella(n), usadoEn: null }, data: { usadoEn: new Date() } });
    if (r.count) await this.audit.registrar({ id: u.id }, 'usuario', u.id, 'CODIGO_RESPALDO');
    return r.count ? 'RESPALDO' : null;
  }
  private huella(codigoNormal: string) { return createHash('sha256').update(`${this.pimienta}:${codigoNormal}`).digest('hex'); }
  private nuevosCodigos(usuarioId: string) {
    const codigos = Array.from({ length: CODIGOS_RESPALDO }, codigoRespaldo);
    return { codigos, crear: this.db.codigoRespaldo.createMany({ data: codigos.map((c) => ({ usuarioId, codigoHash: this.huella(normalRespaldo(c)) })) }) };
  }

  /** Empieza a configurar la verificación en dos pasos: secreto nuevo (pendiente hasta confirmarlo) y su código QR. */
  async iniciar2fa(a: Actor) {
    const u = await this.db.usuario.findUniqueOrThrow({ where: { id: a.id } });
    if (u.totpSecreto) throw new BadRequestException({ mensaje: 'Ya tiene activa la verificación en dos pasos.' });
    const secreto = secretoNuevo();
    await this.db.usuario.update({ where: { id: a.id }, data: { totpPendiente: cifrar(secreto, this.claveTotp) } });
    const uri = uriOtp('Terry-App Residuos', u.email, secreto);
    return { secreto: secreto.match(/.{1,4}/g)!.join(' '), uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 240, errorCorrectionLevel: 'M' }) };
  }

  /** Confirma con el primer código: queda activa, se entregan los códigos de respaldo y se cierran las demás sesiones. */
  async confirmar2fa(a: Actor, codigo: string, meta: Meta) {
    const u = await this.db.usuario.findUniqueOrThrow({ where: { id: a.id } });
    if (u.totpSecreto) throw new BadRequestException({ mensaje: 'Ya tiene activa la verificación en dos pasos.' });
    if (!u.totpPendiente) throw new BadRequestException({ mensaje: 'Primero empiece la configuración (lea el código QR).' });
    const paso = pasoDelCodigo(desdeBase32(descifrar(u.totpPendiente, this.claveTotp)), codigo.trim());
    if (paso === null) throw new BadRequestException({ mensaje: 'El código no coincide. Revise que la hora del celular esté al día y escriba el que muestra ahora la app.' });
    const { codigos, crear } = this.nuevosCodigos(a.id);
    await this.db.$transaction([
      this.db.usuario.update({ where: { id: a.id }, data: { totpSecreto: u.totpPendiente, totpPendiente: null, totpActivoDesde: new Date(), totpUltimoPaso: paso } }),
      this.db.codigoRespaldo.deleteMany({ where: { usuarioId: a.id } }), crear,
      this.db.sesion.updateMany({ where: { usuarioId: a.id, revocadaEn: null }, data: { revocadaEn: new Date() } }),
    ]);
    await this.audit.registrar(a, 'usuario', a.id, 'ACTIVAR_2FA');
    this.correo.enviar(u.email, 'Verificación en dos pasos activada · Terry-App',
      `Hola ${u.nombre}:\n\nSe activó la verificación en dos pasos en su cuenta. Desde ahora, para entrar necesitará el código de su app de autenticación (o uno de sus códigos de respaldo).\n\nSi no fue usted, avise de inmediato al administrador.`).catch(() => undefined);
    return { codigosRespaldo: codigos, sesion: await this.emitir(a.id, meta) };
  }

  /** Códigos de respaldo nuevos (los anteriores dejan de servir). Pide el código vigente de la app. */
  async codigos2fa(a: Actor, codigo: string) {
    const u = await this.db.usuario.findUniqueOrThrow({ where: { id: a.id } });
    if (!u.totpSecreto) throw new BadRequestException({ mensaje: 'No tiene activa la verificación en dos pasos.' });
    if (!/^\d{6}$/.test(codigo.trim()) || (await this.comprobarCodigo(u, codigo)) !== 'TOTP')
      throw new BadRequestException({ mensaje: 'Escriba el código que muestra ahora su app de autenticación.' });
    const { codigos, crear } = this.nuevosCodigos(a.id);
    await this.db.$transaction([this.db.codigoRespaldo.deleteMany({ where: { usuarioId: a.id } }), crear]);
    await this.audit.registrar(a, 'usuario', a.id, 'CODIGOS_2FA');
    return { codigosRespaldo: codigos };
  }

  /** Desactivarla (solo si no es obligatoria para el usuario), con un código vigente o de respaldo. */
  async desactivar2fa(a: Actor, codigo: string) {
    const u = await this.db.usuario.findUniqueOrThrow({ where: { id: a.id }, include: { empresa: true } });
    if (!u.totpSecreto) throw new BadRequestException({ mensaje: 'No tiene activa la verificación en dos pasos.' });
    if (this.obligatorio(u)) throw new BadRequestException({ mensaje: 'Para el personal de Terra Viva la verificación en dos pasos es obligatoria.' });
    if (!(await this.comprobarCodigo(u, codigo))) throw new BadRequestException({ mensaje: 'El código no es válido o ya se usó.' });
    await this.db.$transaction([
      this.db.usuario.update({ where: { id: a.id }, data: { totpSecreto: null, totpPendiente: null, totpActivoDesde: null, totpUltimoPaso: null } }),
      this.db.codigoRespaldo.deleteMany({ where: { usuarioId: a.id } }),
    ]);
    await this.audit.registrar(a, 'usuario', a.id, 'DESACTIVAR_2FA');
    this.correo.enviar(u.email, 'Verificación en dos pasos desactivada · Terry-App',
      `Hola ${u.nombre}:\n\nSe desactivó la verificación en dos pasos de su cuenta. Si no fue usted, cambie su contraseña y avise al administrador.`).catch(() => undefined);
  }

  /**
   * El administrador la restablece (celular perdido y sin códigos de respaldo): se borra el secreto, se cierran las
   * sesiones y, si es obligatoria, el usuario la configura de nuevo al entrar. Nadie restablece la suya.
   */
  async restablecer2fa(a: Actor, usuarioId: string) {
    const u = await this.db.usuario.findFirst({ where: { id: usuarioId, empresaId: a.empresaId } });
    if (!u) throw new NotFoundException({ mensaje: 'Usuario no encontrado.' });
    if (u.id === a.id) throw new BadRequestException({ mensaje: 'Nadie restablece su propia verificación en dos pasos: pídaselo a otro administrador.' });
    if (!u.totpSecreto && !u.totpPendiente) throw new BadRequestException({ mensaje: `${u.nombre} no tiene configurada la verificación en dos pasos.` });
    await this.db.$transaction([
      this.db.usuario.update({ where: { id: u.id }, data: { totpSecreto: null, totpPendiente: null, totpActivoDesde: null, totpUltimoPaso: null } }),
      this.db.codigoRespaldo.deleteMany({ where: { usuarioId: u.id } }),
      this.db.sesion.updateMany({ where: { usuarioId: u.id, revocadaEn: null }, data: { revocadaEn: new Date() } }),
    ]);
    await this.audit.registrar(a, 'usuario', u.id, 'RESTABLECER_2FA');
    this.correo.enviar(u.email, 'Verificación en dos pasos restablecida · Terry-App',
      `Hola ${u.nombre}:\n\nUn administrador restableció la verificación en dos pasos de su cuenta y cerró sus sesiones. Al entrar, configúrela de nuevo con su app de autenticación.\n\nSi usted no lo pidió, avise de inmediato.`).catch(() => undefined);
    return { ok: true };
  }

  /** Aviso por correo cuando se entra desde una IP o un navegador no usados en 90 días (no en el primer ingreso). */
  private async avisarIngresoNuevo(u: { id: string; email: string; nombre: string }, meta: { ip?: string; ua?: string }) {
    const desde = new Date(Date.now() - 90 * 86_400_000);
    const [previas, conocida] = await Promise.all([
      this.db.sesion.count({ where: { usuarioId: u.id } }),
      this.db.sesion.findFirst({ where: { usuarioId: u.id, ip: meta.ip?.slice(0, 64), userAgent: meta.ua?.slice(0, 300), creadaEn: { gt: desde } }, select: { id: true } }),
    ]);
    if (!previas || conocida) return;
    const hora = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
    this.correo.enviar(u.email, 'Nuevo ingreso a su cuenta · Terry-App',
      `Hola ${u.nombre}:\n\nSe ingresó a su cuenta el ${hora} desde la IP ${meta.ip ?? 'desconocida'} (${meta.ua?.slice(0, 120) ?? 'navegador desconocido'}).\n\nSi no fue usted, cambie su contraseña y cierre la sesión en todos los dispositivos.`)
      .catch(() => undefined); // el aviso no debe impedir el ingreso
  }

  /** Crea una sesión: token de acceso corto (JWT) + token de renovación opaco «sesionId.secreto». */
  private async emitir(usuarioId: string, meta: { ip?: string; ua?: string }, viaPortal = false) {
    const u = await this.db.usuario.findUniqueOrThrow({ where: { id: usuarioId }, include: { rol: { include: { permisos: { include: { permiso: true } } } }, empresa: true, clientePortal: { select: { id: true, razonSocial: true, nit: true, activo: true } } } });
    const secreto = randomBytes(32).toString('base64url');
    const sesion = await this.db.sesion.create({ data: { usuarioId, tokenHash: sha256(secreto), ip: meta.ip?.slice(0, 64), userAgent: meta.ua?.slice(0, 300), viaPortal, expiraEn: new Date(Date.now() + this.cfg.get('REFRESH_DIAS', { infer: true }) * 86_400_000) } });
    // Un usuario del portal no lleva permisos de oficina, aunque su rol los tuviera
    const permisos = u.clienteId ? [] : u.rol.permisos.map((p) => p.permiso.codigo);
    // Ley 1581: sin la versión vigente de la política aceptada, el token solo sirve para aceptarla (ver el guard)
    const version = this.cfg.get('POLITICA_DATOS_VERSION', { infer: true });
    const aceptada = u.datosPoliticaVersion === version;
    // Verificación en dos pasos obligatoria y aún sin configurar: el token solo sirve para configurarla (ver el guard).
    // Con el pase del portal no aplica: la verificación la hizo el portal, también para las renovaciones de esa sesión.
    const obligatorio = this.obligatorio(u);
    const pendiente2fa = obligatorio && !u.totpSecreto && !viaPortal;
    const accessToken = await this.jwt.signAsync({ sub: u.id, emp: u.empresaId, rol: u.rol.nombre, prm: permisos, nom: u.nombre, sid: sesion.id, dat: aceptada,
      ...(u.clienteId ? { cli: u.clienteId, pp: u.perfilPortal } : {}), ...(pendiente2fa ? { c2f: true } : {}) });
    return {
      accessToken, refreshToken: `${sesion.id}.${secreto}`, expiraEnSeg: this.cfg.get('JWT_ACCESS_MIN', { infer: true }) * 60,
      usuario: { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol.nombre, permisos, empresa: { id: u.empresa.id, razonSocial: u.empresa.razonSocial, nit: u.empresa.nit },
        requiereAceptarDatos: !aceptada, politicaDatos: { version, url: this.cfg.get('POLITICA_DATOS_URL', { infer: true }) || null },
        requiereConfigurar2fa: pendiente2fa, dobleFactor: { activo: !!u.totpSecreto, obligatorio },
        ...(u.clientePortal ? { cliente: { id: u.clientePortal.id, razonSocial: u.clientePortal.razonSocial, nit: u.clientePortal.nit }, perfilPortal: u.perfilPortal } : {}) },
    };
  }

  /** Rota el token de renovación. Si alguien reutiliza uno ya usado, se cierran todas las sesiones del usuario. */
  async renovar(token: string, meta: { ip?: string; ua?: string }) {
    const [id, secreto] = token.split('.');
    const s = id && secreto ? await this.db.sesion.findUnique({ where: { id } }).catch(() => null) : null;
    if (!s || !iguales(s.tokenHash, sha256(secreto))) throw new UnauthorizedException({ mensaje: 'Sesión inválida. Ingrese de nuevo.' });
    if (s.revocadaEn) {
      await this.db.sesion.updateMany({ where: { usuarioId: s.usuarioId, revocadaEn: null }, data: { revocadaEn: new Date() } });
      await this.audit.registrar({ id: s.usuarioId }, 'sesion', s.id, 'REUSO_TOKEN');
      throw new UnauthorizedException({ mensaje: 'Por seguridad se cerraron todas sus sesiones. Ingrese de nuevo.' });
    }
    if (s.expiraEn < new Date()) throw new UnauthorizedException({ mensaje: 'La sesión venció. Ingrese de nuevo.' });
    const u = await this.db.usuario.findUnique({ where: { id: s.usuarioId } });
    if (!u?.activo) throw new UnauthorizedException({ mensaje: 'Usuario inactivo.' });
    await this.db.sesion.update({ where: { id: s.id }, data: { revocadaEn: new Date() } });
    return this.emitir(s.usuarioId, meta, s.viaPortal);
  }

  /** Acepta la política de datos vigente: queda registrada (versión, fecha, IP) y se entrega una sesión nueva. */
  async aceptarDatos(a: Actor, version: string, meta: { ip?: string; ua?: string }) {
    const vigente = this.cfg.get('POLITICA_DATOS_VERSION', { infer: true });
    if (version !== vigente) throw new ForbiddenException({ mensaje: `La política vigente es la versión ${vigente}: recargue la página.` });
    await this.db.usuario.update({ where: { id: a.id }, data: { datosPoliticaVersion: vigente, datosAceptadosEn: new Date(), datosAceptadosIp: meta.ip?.slice(0, 64) ?? null } });
    await this.audit.registrar(a, 'usuario', a.id, 'ACEPTAR_DATOS', undefined, { version: vigente });
    if (a.sesionId) await this.db.sesion.updateMany({ where: { id: a.sesionId, revocadaEn: null }, data: { revocadaEn: new Date() } });
    return this.emitir(a.id, meta);
  }

  /** Cierra la sesión en todos los dispositivos (por ejemplo, si perdió el celular). */
  async salirTodos(a: Actor) {
    const r = await this.db.sesion.updateMany({ where: { usuarioId: a.id, revocadaEn: null }, data: { revocadaEn: new Date() } });
    await this.audit.registrar(a, 'usuario', a.id, 'SALIR_TODOS', undefined, { sesiones: r.count });
  }

  async salir(token: string) {
    const [id] = token.split('.');
    if (id) await this.db.sesion.updateMany({ where: { id, revocadaEn: null }, data: { revocadaEn: new Date() } }).catch(() => undefined);
  }

  /** Verifica que la sesión del token de acceso siga activa (permite cerrar sesiones de forma remota). */
  async sesionActiva(sid: string) {
    const s = await this.db.sesion.findUnique({ where: { id: sid }, select: { revocadaEn: true, expiraEn: true, usuario: { select: { activo: true } } } });
    return !!s && !s.revocadaEn && s.expiraEn > new Date() && s.usuario.activo;
  }

  async yo(actor: Actor) {
    const u = await this.db.usuario.findUniqueOrThrow({ where: { id: actor.id }, select: {
      totpActivoDesde: true, clienteId: true, empresa: { select: { configuracion: true } }, _count: { select: { codigosRespaldo: { where: { usadoEn: null } } } } } });
    const datos = await this.db.usuario.findUniqueOrThrow({ where: { id: actor.id }, select: { id: true, nombre: true, email: true, telefono: true, esConductor: true, perfilPortal: true, rol: { select: { nombre: true } }, empresa: { select: { razonSocial: true, nit: true } },
      clientePortal: { select: { id: true, razonSocial: true, nit: true } } } });
    return { ...datos, dobleFactor: { activo: !!u.totpActivoDesde, desde: u.totpActivoDesde, obligatorio: this.obligatorio(u), codigosRestantes: u._count.codigosRespaldo } };
  }

  /**
   * Invitación a un usuario nuevo (o reenvío): enlace para crear su contraseña, válido 72 horas y una sola vez. Sin correo
   * configurado, el enlace vuelve a quien lo pidió (un administrador) para que lo entregue por otro medio (WhatsApp).
   */
  async invitar(usuarioId: string): Promise<{ enviada: boolean; enlace: string | null }> {
    const u = await this.db.usuario.findUniqueOrThrow({ where: { id: usuarioId }, include: { clientePortal: { select: { razonSocial: true } } } });
    const token = randomBytes(32).toString('base64url');
    await this.db.passwordReset.create({ data: { usuarioId: u.id, tokenHash: sha256(token), expiraEn: new Date(Date.now() + 72 * 3_600_000) } });
    const url = `${this.cfg.get('WEB_URL', { infer: true })}/?token=${token}#restablecer`;
    const que = u.clientePortal
      ? `Le dimos acceso al portal de clientes de Terra Viva, a nombre de ${u.clientePortal.razonSocial}. Allí consulta y descarga sus declaraciones, manifiestos, certificados e informes.`
      : 'Terra Viva le creó un usuario en Terry-App · Gestión de Residuos.';
    const enviada = await this.correo.enviar(u.email, u.clientePortal ? 'Portal de clientes de Terra Viva · cree su contraseña' : 'Bienvenido a Terry-App · cree su contraseña',
      `Hola ${u.nombre}:\n\n${que} Para crear su contraseña abra este enlace (vence en 72 horas y sirve una sola vez):\n${url}\n\nSi no esperaba este correo, ignórelo.`);
    return { enviada, enlace: enviada ? null : url };
  }

  /** Lo que la pantalla de ingreso necesita saber antes de entrar (sin datos de nadie). */
  opciones() { return { correo: this.correo.configurado, portal: this.cfg.get('PORTAL_URL', { infer: true }) || null }; }

  /** Siempre responde igual para no revelar si el correo existe. */
  async solicitarRecuperacion(email: string) {
    const u = await this.db.usuario.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!u || !u.activo) return;
    const token = randomBytes(32).toString('base64url');
    await this.db.passwordReset.create({ data: { usuarioId: u.id, tokenHash: sha256(token), expiraEn: new Date(Date.now() + 30 * 60_000) } });
    const url = `${this.cfg.get('WEB_URL', { infer: true })}/?token=${token}#restablecer`;
    await this.correo.enviar(u.email, 'Restablecer su contraseña · Terry-App',
      `Hola ${u.nombre}:\n\nPara crear una nueva contraseña abra este enlace (vence en 30 minutos y sirve una sola vez):\n${url}\n\nSi usted no lo pidió, ignore este mensaje.`);
  }

  async restablecer(token: string, nueva: string) {
    const r = await this.db.passwordReset.findFirst({ where: { tokenHash: sha256(token), usadoEn: null, expiraEn: { gt: new Date() } } });
    if (!r) throw new UnauthorizedException({ mensaje: 'El enlace no es válido o ya venció. Solicite uno nuevo.' });
    await this.db.$transaction([
      this.db.usuario.update({ where: { id: r.usuarioId }, data: { passwordHash: await hashClave(nueva), intentosFallidos: 0, bloqueadoHasta: null } }),
      this.db.passwordReset.update({ where: { id: r.id }, data: { usadoEn: new Date() } }),
      this.db.sesion.updateMany({ where: { usuarioId: r.usuarioId, revocadaEn: null }, data: { revocadaEn: new Date() } }),
    ]);
    await this.audit.registrar({ id: r.usuarioId }, 'usuario', r.usuarioId, 'CAMBIO_CLAVE');
  }
}
