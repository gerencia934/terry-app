// Servidor de la Cuenta Terry-App (portal del ecosistema): ingreso con contraseña y verificación en dos pasos, sesión,
// menú de módulos, pase firmado para entrar a cada módulo y administración de cuentas. Corre como función de Cloudflare
// Pages (functions/api/v1/[[ruta]].ts) y en las pruebas, con una base local. Contrato: docs/ECOSISTEMA.md.
import {
  aleatorio, b64u, base32, cifrar, clavePase, claveValida, codigoRespaldo, descifrar, desdeBase32, firmarDesafio, firmarPase,
  hashClave, huellaRespaldo, iguales, leerDesafio, llaves, normalRespaldo, pasoDelCodigo, sha256Hex, uriOtp, verificarClave,
  type ClavePase, type Llaves, type TipoDesafio,
} from './cripto.ts';
import { dbNeon, type Db } from './db.ts';
import { estado, IDS_MODULOS, modulos, type IdModulo } from './modulos.ts';

export interface Entorno {
  DATABASE_URL?: string;
  /** Secreto propio del portal (64 caracteres al azar): pimienta de las contraseñas y llaves de los datos cifrados. */
  PORTAL_SECRETO?: string;
  /** JWK Ed25519 con «d» y «x»: firma los pases. Su parte pública va en PORTAL_CLAVE_PUBLICA de cada módulo. */
  PORTAL_CLAVE_PRIVADA?: string;
  /** Dirección pública del portal (iss del pase y enlaces de invitación). */
  PORTAL_URL?: string;
  /** Módulos que ya aceptan el pase, separados por coma (los demás se abren con su propia entrada). */
  MODULOS_SSO?: string;
  MODULO_RESIDUOS_URL?: string; MODULO_MANTENIMIENTO_URL?: string; MODULO_CRM_URL?: string; MODULO_PLANTA_URL?: string;
}

interface Contexto { req: Request; env: Entorno; db: Db; k: Llaves; pase: ClavePase; url: URL; portal: string; ip: string; agente: string }
interface Cuenta {
  id: string; email: string; nombre: string; clave_hash: string | null; totp_secreto: string | null; totp_pendiente: string | null;
  es_admin: boolean; activa: boolean; intentos_fallidos: number; bloqueada_hasta: Date | string | null;
}
interface Sesion { id: string; cuenta: { id: string; email: string; nombre: string; es_admin: boolean; totp_desde: Date | string | null } }

const COOKIE = '__Host-tv_portal';
const SESION_HORAS = 12;
const MAX_INTENTOS = 5;
const BLOQUEO_MIN = 15;
const ENLACE_HORAS = 72;
const CODIGOS_RESPALDO = 10;
const COLUMNAS = 'id, email, nombre, clave_hash, totp_secreto, totp_pendiente, es_admin, activa, intentos_fallidos, bloqueada_hasta';

class ErrorPortal extends Error {
  status: number; codigo?: string;
  constructor(status: number, mensaje: string, codigo?: string) { super(mensaje); this.status = status; this.codigo = codigo; }
}
const fallo = (status: number, mensaje: string, codigo?: string) => new ErrorPortal(status, mensaje, codigo);

const CABECERAS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
function json(datos: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(status === 204 ? null : JSON.stringify(datos), { status, headers: { ...CABECERAS, ...extra } });
}

// Llaves y base: se preparan una vez por copia del servidor
let preparado: { clave: string; k: Llaves; pase: ClavePase; db: Db | null } | null = null;
async function preparar(env: Entorno, db?: Db) {
  const clave = `${env.PORTAL_SECRETO}|${env.PORTAL_CLAVE_PRIVADA}|${env.DATABASE_URL}`;
  if (!preparado || preparado.clave !== clave) {
    preparado = { clave, k: await llaves(env.PORTAL_SECRETO ?? ''), pase: await clavePase(env.PORTAL_CLAVE_PRIVADA ?? '{}'), db: env.DATABASE_URL ? dbNeon(env.DATABASE_URL) : null };
  }
  const base = db ?? preparado.db;
  if (!base) throw new Error('Falta DATABASE_URL.');
  return { k: preparado.k, pase: preparado.pase, db: base };
}

/** Atiende /api/v1/* del portal. En las pruebas se le pasa la base. */
export async function atender(req: Request, env: Entorno, opciones: { db?: Db } = {}): Promise<Response> {
  const url = new URL(req.url);
  const ruta = url.pathname.replace(/^\/api\/v1\/?/, '').replace(/\/+$/, '');
  try {
    const base = await preparar(env, opciones.db);
    const c: Contexto = {
      req, env, url, ...base, portal: (env.PORTAL_URL || url.origin).replace(/\/+$/, ''),
      ip: (req.headers.get('cf-connecting-ip') ?? '').slice(0, 64), agente: (req.headers.get('user-agent') ?? '').slice(0, 300),
    };
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.get('origin') !== url.origin)
      throw fallo(403, 'Solicitud rechazada: solo se aceptan cambios desde las pantallas del portal.'); // contra CSRF, además de SameSite
    return await enrutar(c, ruta);
  } catch (e) {
    if (e instanceof ErrorPortal) return json({ mensaje: e.message, ...(e.codigo ? { codigo: e.codigo } : {}) }, e.status);
    console.error('Portal Terry-App:', e instanceof Error ? e.message : e);
    return json({ mensaje: 'Error interno del portal. Intente de nuevo en un momento.' }, 500);
  }
}

async function enrutar(c: Contexto, ruta: string): Promise<Response> {
  switch (`${c.req.method} ${ruta}`) {
    case 'GET salud': return salud(c);
    case 'GET clave-publica': return json({ keys: [c.pase.publica] }, 200, { 'cache-control': 'public, max-age=300' });
    case 'POST ingresar': return ingresar(c);
    case 'POST ingresar/codigo': return ingresarConCodigo(c);
    case 'POST codigo/iniciar': return codigoIniciar(c);
    case 'POST codigo/confirmar': return codigoConfirmar(c);
    case 'POST clave/crear': return claveCrear(c);
    case 'POST salir': return salir(c);
    case 'GET yo': return yo(c);
    case 'POST pase': return pase(c);
    case 'POST clave/cambiar': return claveCambiar(c);
    case 'POST codigo/respaldo': return codigosRespaldoNuevos(c);
    case 'GET cuentas': return cuentasListar(c);
    case 'POST cuentas': return cuentaCrear(c);
  }
  const [raiz, id, ...resto] = ruta.split('/');
  if (raiz === 'cuentas' && /^[0-9a-f-]{36}$/.test(id ?? '')) {
    const accion = `${c.req.method} ${resto.join('/')}`;
    if (accion === 'PATCH ') return cuentaEditar(c, id);
    if (accion === 'POST enlace') return cuentaEnlace(c, id);
    if (accion === 'POST codigo/quitar') return cuentaQuitarCodigo(c, id);
    if (accion === 'POST sesiones/cerrar') return cuentaCerrarSesiones(c, id);
  }
  throw fallo(404, 'Ruta no encontrada.');
}

// --- Utilidades
async function cuerpo(c: Contexto): Promise<Record<string, unknown>> {
  if (!(c.req.headers.get('content-type') ?? '').includes('application/json')) return {};
  const t = await c.req.text();
  if (t.length > 20_000) throw fallo(413, 'La solicitud es demasiado grande.');
  try {
    const v: unknown = JSON.parse(t || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch { throw fallo(400, 'La solicitud no es válida.'); }
}
const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const correoValido = (v: string) => v.length <= 150 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
const horaColombia = (d: Date | string) => new Date(d).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hour12: false });
const bloqueada = (x: Cuenta) => !!x.bloqueada_hasta && new Date(x.bloqueada_hasta) > new Date();
const mensajeBloqueo = (x: Cuenta) => fallo(403, `Cuenta bloqueada por intentos fallidos. Intente de nuevo después de las ${horaColombia(x.bloqueada_hasta!)}.`);
const cookie = (valor: string, segundos: number) => `${COOKIE}=${valor}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${segundos}`;
function leerCookie(cabecera: string) {
  for (const parte of cabecera.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return '';
}

/** Límite de intentos por ventana de tiempo (por IP, por correo o por cuenta). */
async function limite(c: Contexto, clave: string, max: number, minutos: number) {
  const [r] = await c.db.q<{ cantidad: number }>(
    `INSERT INTO intentos (clave, ventana, cantidad) VALUES ($1, date_bin(make_interval(mins => $2::int), now(), timestamptz '2000-01-01'), 1)
     ON CONFLICT (clave, ventana) DO UPDATE SET cantidad = intentos.cantidad + 1 RETURNING cantidad`, [clave.slice(0, 200), minutos]);
  if (Math.random() < 0.02) await c.db.q(`DELETE FROM intentos WHERE ventana < now() - interval '1 day'`);
  if (Number(r?.cantidad ?? 0) > max) throw fallo(429, 'Demasiados intentos. Espere unos minutos y vuelva a intentarlo.');
}
async function evento(c: Contexto, tipo: string, cuentaId: string | null, detalle: Record<string, unknown> = {}, actorId: string | null = null) {
  await c.db.q(`INSERT INTO eventos (cuenta_id, actor_id, tipo, ip, detalle) VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [cuentaId, actorId, tipo, c.ip || null, JSON.stringify(detalle)]);
}
async function cuentaPorId(c: Contexto, id: string) { return (await c.db.q<Cuenta>(`SELECT ${COLUMNAS} FROM cuentas WHERE id = $1`, [id]))[0] ?? null; }
async function intentoFallido(c: Contexto, x: Cuenta, tipo: string) {
  const n = x.intentos_fallidos + 1;
  const bloquear = n >= MAX_INTENTOS;
  await c.db.q(`UPDATE cuentas SET intentos_fallidos = $2, bloqueada_hasta = $3 WHERE id = $1`,
    [x.id, bloquear ? 0 : n, bloquear ? new Date(Date.now() + BLOQUEO_MIN * 60_000) : null]);
  await evento(c, bloquear ? 'BLOQUEO' : tipo, x.id, { intentos: n });
}

// --- Ingreso
async function salud(c: Contexto) {
  let base = 'conectada';
  try { await c.db.q('SELECT 1'); } catch { base = 'sin-respuesta'; }
  return json({ estado: 'ok', servicio: 'terry-portal', base, hora: new Date().toISOString() }, base === 'conectada' ? 200 : 503);
}

async function ingresar(c: Contexto) {
  const b = await cuerpo(c);
  const email = texto(b.email, 150).toLowerCase();
  const clave = typeof b.clave === 'string' ? b.clave.slice(0, 200) : '';
  if (!correoValido(email) || !clave) throw fallo(400, 'Escriba su correo y su contraseña.');
  await limite(c, `ip:${c.ip}`, 40, 15);
  await limite(c, `correo:${email}`, 10, 15);
  const invalido = fallo(401, 'Correo o contraseña incorrectos.'); // igual si el correo no existe: no revela quién tiene cuenta
  const x = (await c.db.q<Cuenta>(`SELECT ${COLUMNAS} FROM cuentas WHERE email = $1`, [email]))[0];
  if (!x || !x.activa || !x.clave_hash) {
    await verificarClave(clave, null, c.k);
    await evento(c, 'INGRESO_FALLIDO', x?.id ?? null, { motivo: !x ? 'correo no registrado' : !x.activa ? 'cuenta inactiva' : 'sin contraseña' });
    throw invalido;
  }
  if (bloqueada(x)) throw mensajeBloqueo(x);
  if (!(await verificarClave(clave, x.clave_hash, c.k))) { await intentoFallido(c, x, 'INGRESO_FALLIDO'); throw invalido; }
  // La contraseña sola no abre sesión: falta el código de la app o, la primera vez, configurarla. Los intentos fallidos
  // no se reinician hasta que entre el código: repetir la contraseña no da más oportunidades de adivinar códigos.
  const paso: TipoDesafio = x.totp_secreto ? 'codigo' : 'configurar';
  return json({ paso, desafio: await firmarDesafio(x.id, paso, c.k) });
}

async function cuentaDelDesafio(c: Contexto, desafio: unknown, tipo: TipoDesafio) {
  const vencido = fallo(401, 'El ingreso venció: escriba de nuevo su correo y su contraseña.', 'DESAFIO');
  const d = await leerDesafio(desafio, c.k);
  if (!d || d.t !== tipo) throw vencido;
  await limite(c, `desafio:${d.c}`, 10, 15);
  const x = await cuentaPorId(c, d.c);
  if (!x || !x.activa || !x.clave_hash) throw vencido;
  if (bloqueada(x)) throw mensajeBloqueo(x);
  return x;
}

/** Código vigente de la app (no usado antes) o código de respaldo sin usar. */
async function comprobarCodigo(c: Contexto, x: Cuenta, codigo: string): Promise<'TOTP' | 'RESPALDO' | null> {
  if (/^\d{6}$/.test(codigo)) {
    if (!x.totp_secreto) return null;
    const paso = await pasoDelCodigo(desdeBase32(await descifrar(x.totp_secreto, c.k)), codigo);
    if (paso === null) return null;
    // Cada código sirve una vez: si llegan dos peticiones con el mismo código, solo una gana (lo decide la base)
    const r = await c.db.q(`UPDATE cuentas SET totp_ultimo_paso = $2 WHERE id = $1 AND (totp_ultimo_paso IS NULL OR totp_ultimo_paso < $2) RETURNING id`, [x.id, paso]);
    return r.length ? 'TOTP' : null;
  }
  const n = normalRespaldo(codigo);
  if (!/^[A-Z2-7]{8}$/.test(n)) return null;
  const r = await c.db.q(`UPDATE codigos_respaldo SET usado_en = now() WHERE cuenta_id = $1 AND codigo_hash = $2 AND usado_en IS NULL RETURNING cuenta_id`,
    [x.id, await huellaRespaldo(n, c.k)]);
  return r.length ? 'RESPALDO' : null;
}

async function abrirSesion(c: Contexto, x: Cuenta, detalle: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const id = crypto.randomUUID();
  const secreto = b64u(aleatorio(32));
  await c.db.q(`INSERT INTO sesiones (id, cuenta_id, secreto_hash, expira_en, ip, agente) VALUES ($1, $2, $3, now() + make_interval(hours => $4::int), $5, $6)`,
    [id, x.id, await sha256Hex(secreto), SESION_HORAS, c.ip || null, c.agente || null]);
  await c.db.q(`UPDATE cuentas SET intentos_fallidos = 0, bloqueada_hasta = NULL, ultimo_ingreso = now() WHERE id = $1`, [x.id]);
  await evento(c, 'INGRESO', x.id, { ...detalle, agente: c.agente.slice(0, 120) });
  return json({ ok: true, ...extra }, 200, { 'set-cookie': cookie(`${id}.${secreto}`, SESION_HORAS * 3600) });
}

async function ingresarConCodigo(c: Contexto) {
  const b = await cuerpo(c);
  const x = await cuentaDelDesafio(c, b.desafio, 'codigo');
  const como = await comprobarCodigo(c, x, texto(b.codigo, 20));
  if (!como) {
    await intentoFallido(c, x, 'CODIGO_FALLIDO');
    throw fallo(401, 'El código no es válido o ya se usó. Escriba el que muestra ahora su app de autenticación.');
  }
  return abrirSesion(c, x, { como });
}

async function nuevosRespaldo(c: Contexto, cuentaId: string) {
  const codigos = Array.from({ length: CODIGOS_RESPALDO }, codigoRespaldo);
  const huellas = await Promise.all(codigos.map((k) => huellaRespaldo(k, c.k)));
  await c.db.q(`DELETE FROM codigos_respaldo WHERE cuenta_id = $1`, [cuentaId]);
  await c.db.q(`INSERT INTO codigos_respaldo (cuenta_id, codigo_hash) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`, [cuentaId, huellas]);
  return codigos;
}

/** Primer ingreso: secreto nuevo para la app de autenticación (queda pendiente hasta confirmarlo con un código). */
async function codigoIniciar(c: Contexto) {
  const b = await cuerpo(c);
  const x = await cuentaDelDesafio(c, b.desafio, 'configurar');
  if (x.totp_secreto) throw fallo(409, 'Su verificación en dos pasos ya está activa: ingrese con el código de la app.');
  const secreto = base32(aleatorio(20));
  await c.db.q(`UPDATE cuentas SET totp_pendiente = $2 WHERE id = $1`, [x.id, await cifrar(secreto, c.k)]);
  return json({ secreto: (secreto.match(/.{1,4}/g) ?? []).join(' '), uri: uriOtp(x.email, secreto) });
}

async function codigoConfirmar(c: Contexto) {
  const b = await cuerpo(c);
  const x = await cuentaDelDesafio(c, b.desafio, 'configurar');
  if (x.totp_secreto) throw fallo(409, 'Su verificación en dos pasos ya está activa: ingrese con el código de la app.');
  if (!x.totp_pendiente) throw fallo(400, 'Primero escanee el código QR con la app de autenticación.');
  const paso = await pasoDelCodigo(desdeBase32(await descifrar(x.totp_pendiente, c.k)), texto(b.codigo, 20));
  if (paso === null) {
    await intentoFallido(c, x, 'CODIGO_FALLIDO');
    throw fallo(401, 'El código no coincide. Revise que la hora del celular esté bien y escriba el que muestra ahora la app.');
  }
  const r = await c.db.q(`UPDATE cuentas SET totp_secreto = totp_pendiente, totp_pendiente = NULL, totp_desde = now(), totp_ultimo_paso = $2
    WHERE id = $1 AND totp_secreto IS NULL AND totp_pendiente IS NOT NULL RETURNING id`, [x.id, paso]);
  if (!r.length) throw fallo(409, 'Su verificación en dos pasos ya está activa: ingrese con el código de la app.');
  const respaldo = await nuevosRespaldo(c, x.id);
  await evento(c, 'CODIGO_ACTIVADO', x.id);
  return abrirSesion(c, x, { como: 'CONFIGURACION' }, { respaldo });
}

/** Enlace de invitación o de recuperación (lo genera un administrador): crea la contraseña. */
async function claveCrear(c: Contexto) {
  const b = await cuerpo(c);
  const token = texto(b.token, 100);
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) throw fallo(400, 'El enlace no es válido. Ábralo de nuevo, completo.');
  if (!claveValida(b.clave)) throw fallo(400, 'La contraseña debe tener al menos 10 caracteres, con letras y números.');
  await limite(c, `ip:${c.ip}`, 40, 15);
  const [e] = await c.db.q<{ cuenta_id: string }>(`UPDATE enlaces SET usado_en = now() WHERE token_hash = $1 AND usado_en IS NULL AND expira_en > now() RETURNING cuenta_id`,
    [await sha256Hex(token)]);
  if (!e) throw fallo(410, 'El enlace venció o ya se usó. Pídale uno nuevo al administrador del portal.');
  await c.db.q(`UPDATE cuentas SET clave_hash = $2, intentos_fallidos = 0, bloqueada_hasta = NULL WHERE id = $1`, [e.cuenta_id, await hashClave(b.clave, c.k)]);
  await c.db.q(`UPDATE sesiones SET revocada_en = now() WHERE cuenta_id = $1 AND revocada_en IS NULL`, [e.cuenta_id]);
  await evento(c, 'CLAVE_CREADA', e.cuenta_id);
  return json({ mensaje: 'Listo. Ya puede ingresar con su correo y su contraseña nueva.' });
}

// --- Sesión
async function sesion(c: Contexto): Promise<Sesion> {
  const [id, secreto] = leerCookie(c.req.headers.get('cookie') ?? '').split('.');
  const sinSesion = fallo(401, 'Debe iniciar sesión.', 'SESION');
  if (!id || !secreto || !/^[0-9a-f-]{36}$/.test(id)) throw sinSesion;
  const [s] = await c.db.q<{ id: string; secreto_hash: string; cuenta_id: string; email: string; nombre: string; es_admin: boolean; totp_desde: Date | string | null }>(
    `SELECT s.id, s.secreto_hash, c.id AS cuenta_id, c.email, c.nombre, c.es_admin, c.totp_desde
       FROM sesiones s JOIN cuentas c ON c.id = s.cuenta_id
      WHERE s.id = $1 AND s.revocada_en IS NULL AND s.expira_en > now() AND c.activa`, [id]);
  if (!s || !iguales(s.secreto_hash, await sha256Hex(secreto))) throw sinSesion;
  return { id: s.id, cuenta: { id: s.cuenta_id, email: s.email, nombre: s.nombre, es_admin: s.es_admin, totp_desde: s.totp_desde } };
}
async function administrador(c: Contexto) {
  const s = await sesion(c);
  if (!s.cuenta.es_admin) throw fallo(403, 'Solo un administrador del portal puede hacer esto.');
  return s;
}

async function salir(c: Contexto) {
  try {
    const s = await sesion(c);
    await c.db.q(`UPDATE sesiones SET revocada_en = now() WHERE id = $1 AND revocada_en IS NULL`, [s.id]);
    await evento(c, 'SALIDA', s.cuenta.id);
  } catch { /* sin sesión válida: igual se borra la cookie */ }
  return json(null, 204, { 'set-cookie': cookie('', 0) });
}

async function permitidos(c: Contexto, s: Sesion): Promise<Set<IdModulo>> {
  if (s.cuenta.es_admin) return new Set(IDS_MODULOS);
  return new Set((await c.db.q<{ modulo: IdModulo }>(`SELECT modulo FROM accesos WHERE cuenta_id = $1`, [s.cuenta.id])).map((a) => a.modulo));
}

async function yo(c: Contexto) {
  const s = await sesion(c);
  const acceso = await permitidos(c, s);
  const lista = modulos(c.env as Record<string, unknown>);
  const estados = await Promise.all(lista.map((m) => (acceso.has(m.id) || !m.url ? estado(m) : Promise.resolve(null))));
  const [r] = await c.db.q<{ n: number }>(`SELECT count(*)::int AS n FROM codigos_respaldo WHERE cuenta_id = $1 AND usado_en IS NULL`, [s.cuenta.id]);
  return json({
    cuenta: { nombre: s.cuenta.nombre, email: s.cuenta.email, esAdmin: s.cuenta.es_admin, codigoDesde: s.cuenta.totp_desde, codigosRespaldo: Number(r?.n ?? 0) },
    modulos: lista.map((m, i) => ({ id: m.id, nombre: m.nombre, descripcion: m.descripcion, acceso: acceso.has(m.id), estado: estados[i], url: m.url })),
  });
}

/** Abre un módulo: pase firmado de 60 segundos (si el módulo ya lo acepta) o su dirección. */
async function pase(c: Contexto) {
  const s = await sesion(c);
  const b = await cuerpo(c);
  const m = modulos(c.env as Record<string, unknown>).find((x) => x.id === b.modulo);
  if (!m) throw fallo(404, 'Ese módulo no existe.');
  if (!m.url) throw fallo(409, `${m.nombre} todavía no está disponible.`);
  if (!(await permitidos(c, s)).has(m.id)) throw fallo(403, `Su cuenta no tiene acceso a ${m.nombre}. Pídaselo a un administrador del portal.`);
  if (!m.sso) {
    await evento(c, 'ABRIR_MODULO', s.cuenta.id, { modulo: m.id, pase: false });
    return json({ url: m.url, pase: false });
  }
  const ahora = Math.floor(Date.now() / 1000);
  const token = await firmarPase(c.pase, { iss: c.portal, aud: m.id, sub: s.cuenta.email, nom: s.cuenta.nombre, amr: ['pwd', 'otp'], iat: ahora, exp: ahora + 60, jti: crypto.randomUUID() });
  await evento(c, 'ABRIR_MODULO', s.cuenta.id, { modulo: m.id, pase: true });
  return json({ url: `${m.url}/#sso=${token}`, pase: true });
}

async function claveCambiar(c: Contexto) {
  const s = await sesion(c);
  const b = await cuerpo(c);
  if (!claveValida(b.nueva)) throw fallo(400, 'La contraseña nueva debe tener al menos 10 caracteres, con letras y números.');
  await limite(c, `cambio:${s.cuenta.id}`, 10, 15);
  const x = await cuentaPorId(c, s.cuenta.id);
  if (!x) throw fallo(401, 'Debe iniciar sesión.', 'SESION');
  if (!(await verificarClave(typeof b.actual === 'string' ? b.actual : '', x.clave_hash, c.k))) {
    await intentoFallido(c, x, 'CAMBIO_CLAVE_FALLIDO');
    throw fallo(401, 'La contraseña actual no es correcta.');
  }
  if (b.actual === b.nueva) throw fallo(400, 'La contraseña nueva debe ser distinta de la actual.');
  await c.db.q(`UPDATE cuentas SET clave_hash = $2 WHERE id = $1`, [x.id, await hashClave(b.nueva, c.k)]);
  // Las demás sesiones se cierran (por si alguien más conocía la contraseña); esta sigue abierta
  await c.db.q(`UPDATE sesiones SET revocada_en = now() WHERE cuenta_id = $1 AND id <> $2 AND revocada_en IS NULL`, [x.id, s.id]);
  await evento(c, 'CLAVE_CAMBIADA', x.id);
  return json({ mensaje: 'Contraseña cambiada. Se cerraron sus sesiones en otros equipos.' });
}

async function codigosRespaldoNuevos(c: Contexto) {
  const s = await sesion(c);
  const b = await cuerpo(c);
  await limite(c, `respaldo:${s.cuenta.id}`, 10, 15);
  const x = await cuentaPorId(c, s.cuenta.id);
  if (!x || (await comprobarCodigo(c, x, texto(b.codigo, 20))) !== 'TOTP') throw fallo(401, 'Escriba el código que muestra ahora su app de autenticación.');
  const respaldo = await nuevosRespaldo(c, x.id);
  await evento(c, 'CODIGOS_RESPALDO', x.id);
  return json({ respaldo });
}

// --- Administración de cuentas
const listaModulos = (v: unknown): IdModulo[] => (Array.isArray(v) ? [...new Set(v.filter((m): m is IdModulo => IDS_MODULOS.includes(m as IdModulo)))] : []);
async function guardarAccesos(c: Contexto, id: string, mods: IdModulo[]) {
  await c.db.q(`DELETE FROM accesos WHERE cuenta_id = $1 AND NOT (modulo = ANY($2::text[]))`, [id, mods]);
  if (mods.length) await c.db.q(`INSERT INTO accesos (cuenta_id, modulo) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`, [id, mods]);
}
async function nuevoEnlace(c: Contexto, cuentaId: string) {
  const token = b64u(aleatorio(32));
  await c.db.q(`INSERT INTO enlaces (token_hash, cuenta_id, expira_en) VALUES ($1, $2, now() + make_interval(hours => $3::int))`, [await sha256Hex(token), cuentaId, ENLACE_HORAS]);
  return `${c.portal}/#clave=${token}`;
}

async function cuentasListar(c: Contexto) {
  await administrador(c);
  const filas = await c.db.q<Record<string, unknown>>(`
    SELECT c.id, c.email, c.nombre, c.es_admin, c.activa, c.clave_hash IS NOT NULL AS con_clave, c.totp_secreto IS NOT NULL AS con_codigo,
           c.ultimo_ingreso, c.creada_en, coalesce((SELECT array_agg(a.modulo ORDER BY a.modulo) FROM accesos a WHERE a.cuenta_id = c.id), '{}') AS modulos
      FROM cuentas c ORDER BY c.activa DESC, c.nombre`);
  return json(filas.map((f) => ({
    id: f.id, email: f.email, nombre: f.nombre, esAdmin: f.es_admin, activa: f.activa, conClave: f.con_clave, conCodigo: f.con_codigo,
    ultimoIngreso: f.ultimo_ingreso, creadaEn: f.creada_en, modulos: f.modulos,
  })));
}

async function cuentaCrear(c: Contexto) {
  const s = await administrador(c);
  const b = await cuerpo(c);
  const email = texto(b.email, 150).toLowerCase();
  const nombre = texto(b.nombre, 150);
  if (!correoValido(email)) throw fallo(400, 'Escriba un correo válido.');
  if (nombre.length < 3) throw fallo(400, 'Escriba el nombre completo.');
  const mods = listaModulos(b.modulos);
  const [x] = await c.db.q<{ id: string }>(`INSERT INTO cuentas (email, nombre, es_admin) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING RETURNING id`,
    [email, nombre, b.esAdmin === true]);
  if (!x) throw fallo(409, 'Ya existe una cuenta con ese correo.');
  await guardarAccesos(c, x.id, mods);
  const enlace = await nuevoEnlace(c, x.id);
  await evento(c, 'CUENTA_CREADA', x.id, { modulos: mods, esAdmin: b.esAdmin === true }, s.cuenta.id);
  return json({ id: x.id, enlace }, 201);
}

async function cuentaEditar(c: Contexto, id: string) {
  const s = await administrador(c);
  const b = await cuerpo(c);
  const x = await cuentaPorId(c, id);
  if (!x) throw fallo(404, 'La cuenta no existe.');
  if (id === s.cuenta.id && (b.activa === false || b.esAdmin === false)) throw fallo(400, 'No puede desactivar su propia cuenta ni quitarse la administración.');
  const nombre = b.nombre !== undefined ? texto(b.nombre, 150) : x.nombre;
  if (nombre.length < 3) throw fallo(400, 'Escriba el nombre completo.');
  const activa = typeof b.activa === 'boolean' ? b.activa : x.activa;
  await c.db.q(`UPDATE cuentas SET nombre = $2, activa = $3, es_admin = $4 WHERE id = $1`, [id, nombre, activa, typeof b.esAdmin === 'boolean' ? b.esAdmin : x.es_admin]);
  if (b.modulos !== undefined) await guardarAccesos(c, id, listaModulos(b.modulos));
  if (!activa) await c.db.q(`UPDATE sesiones SET revocada_en = now() WHERE cuenta_id = $1 AND revocada_en IS NULL`, [id]);
  await evento(c, 'CUENTA_EDITADA', id, { cambios: ['nombre', 'activa', 'esAdmin', 'modulos'].filter((k) => b[k] !== undefined) }, s.cuenta.id);
  return json({ ok: true });
}

async function cuentaEnlace(c: Contexto, id: string) {
  const s = await administrador(c);
  if (!(await cuentaPorId(c, id))) throw fallo(404, 'La cuenta no existe.');
  const enlace = await nuevoEnlace(c, id);
  await evento(c, 'ENLACE_CREADO', id, {}, s.cuenta.id);
  return json({ enlace });
}

/** Celular perdido y sin códigos de respaldo: la persona configura la app de nuevo en su próximo ingreso. */
async function cuentaQuitarCodigo(c: Contexto, id: string) {
  const s = await administrador(c);
  if (!(await cuentaPorId(c, id))) throw fallo(404, 'La cuenta no existe.');
  await c.db.q(`UPDATE cuentas SET totp_secreto = NULL, totp_pendiente = NULL, totp_desde = NULL, totp_ultimo_paso = NULL WHERE id = $1`, [id]);
  await c.db.q(`DELETE FROM codigos_respaldo WHERE cuenta_id = $1`, [id]);
  await c.db.q(`UPDATE sesiones SET revocada_en = now() WHERE cuenta_id = $1 AND revocada_en IS NULL`, [id]);
  await evento(c, 'CODIGO_QUITADO', id, {}, s.cuenta.id);
  return json({ ok: true });
}

async function cuentaCerrarSesiones(c: Contexto, id: string) {
  const s = await administrador(c);
  const r = await c.db.q(`UPDATE sesiones SET revocada_en = now() WHERE cuenta_id = $1 AND revocada_en IS NULL RETURNING id`, [id]);
  await evento(c, 'SESIONES_CERRADAS', id, { sesiones: r.length }, s.cuenta.id);
  return json({ cerradas: r.length });
}
