import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { Auditoria, Correo } from '../common/servicios';
import type { Actor } from '../common/http';
import type { Config } from '../config';

const MAX_INTENTOS = 5;
const BLOQUEO_MIN = 15;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const iguales = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
// Parámetros argon2id recomendados por OWASP (19 MiB, 2 iteraciones).
export const hashClave = (clave: string) => hash(clave, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

@Injectable()
export class AuthService {
  constructor(private readonly db: PrismaService, private readonly jwt: JwtService, private readonly cfg: ConfigService<Config, true>,
    private readonly audit: Auditoria, private readonly correo: Correo) {}

  async login(email: string, clave: string, meta: { ip?: string; ua?: string }) {
    const u = await this.db.usuario.findUnique({ where: { email: email.trim().toLowerCase() } });
    // Mismo mensaje si el usuario no existe o la clave es incorrecta (no revela qué correos existen).
    const invalido = new UnauthorizedException({ mensaje: 'Correo o contraseña incorrectos.' });
    if (!u || !u.activo) { await hashClave(clave); throw invalido; }
    if (u.bloqueadoHasta && u.bloqueadoHasta > new Date()) {
      throw new ForbiddenException({ mensaje: `Cuenta bloqueada temporalmente por intentos fallidos. Intente de nuevo después de las ${u.bloqueadoHasta.toTimeString().slice(0, 5)}.` });
    }
    if (!(await verify(u.passwordHash, clave))) {
      const intentos = u.intentosFallidos + 1;
      await this.db.usuario.update({ where: { id: u.id }, data: { intentosFallidos: intentos >= MAX_INTENTOS ? 0 : intentos, bloqueadoHasta: intentos >= MAX_INTENTOS ? new Date(Date.now() + BLOQUEO_MIN * 60_000) : null } });
      throw invalido;
    }
    await this.db.usuario.update({ where: { id: u.id }, data: { intentosFallidos: 0, bloqueadoHasta: null, ultimoLogin: new Date() } });
    await this.audit.registrar({ id: u.id }, 'usuario', u.id, 'LOGIN', undefined, { ip: meta.ip });
    return this.emitir(u.id, meta);
  }

  /** Crea una sesión: token de acceso corto (JWT) + token de renovación opaco «sesionId.secreto». */
  private async emitir(usuarioId: string, meta: { ip?: string; ua?: string }) {
    const u = await this.db.usuario.findUniqueOrThrow({ where: { id: usuarioId }, include: { rol: { include: { permisos: { include: { permiso: true } } } }, empresa: true } });
    const secreto = randomBytes(32).toString('base64url');
    const sesion = await this.db.sesion.create({ data: { usuarioId, tokenHash: sha256(secreto), ip: meta.ip?.slice(0, 64), userAgent: meta.ua?.slice(0, 300), expiraEn: new Date(Date.now() + this.cfg.get('REFRESH_DIAS', { infer: true }) * 86_400_000) } });
    const permisos = u.rol.permisos.map((p) => p.permiso.codigo);
    const accessToken = await this.jwt.signAsync({ sub: u.id, emp: u.empresaId, rol: u.rol.nombre, prm: permisos, nom: u.nombre, sid: sesion.id });
    return {
      accessToken, refreshToken: `${sesion.id}.${secreto}`, expiraEnSeg: this.cfg.get('JWT_ACCESS_MIN', { infer: true }) * 60,
      usuario: { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol.nombre, permisos, empresa: { id: u.empresa.id, razonSocial: u.empresa.razonSocial, nit: u.empresa.nit } },
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
    return this.emitir(s.usuarioId, meta);
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
    return this.db.usuario.findUniqueOrThrow({ where: { id: actor.id }, select: { id: true, nombre: true, email: true, telefono: true, esConductor: true, rol: { select: { nombre: true } }, empresa: { select: { razonSocial: true, nit: true } } } });
  }

  /** Siempre responde igual para no revelar si el correo existe. */
  async solicitarRecuperacion(email: string) {
    const u = await this.db.usuario.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!u || !u.activo) return;
    const token = randomBytes(32).toString('base64url');
    await this.db.passwordReset.create({ data: { usuarioId: u.id, tokenHash: sha256(token), expiraEn: new Date(Date.now() + 30 * 60_000) } });
    const url = `${this.cfg.get('WEB_URL', { infer: true })}/?token=${token}#restablecer`;
    await this.correo.enviar(u.email, 'Restablecer su contraseña · Terra Viva',
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
