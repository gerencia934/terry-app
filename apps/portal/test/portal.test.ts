// Prueba de punta a punta del servidor del portal contra PostgreSQL real (una base de pruebas que se vacía al empezar).
//   PORTAL_DB_URL=postgresql://usuario:clave@localhost:5432/terry_portal_pruebas node --test test/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { atender, type Entorno } from '../servidor/rutas.ts';
import { codigoTotp, desdeBase32, pasoActual, sha256Hex } from '../servidor/cripto.ts';
import { olvidarEstados } from '../servidor/modulos.ts';
import type { Db } from '../servidor/db.ts';

const URL_DB = process.env.PORTAL_DB_URL;
const PORTAL = 'https://portal.prueba';
const cliente = new pg.Client({ connectionString: URL_DB });
const db: Db = { q: async (t, v = []) => (await cliente.query(t, v as unknown[])).rows };
let env: Entorno;
let publicaX = '';
let residuosDormido = false;

before(async () => {
  if (!URL_DB) throw new Error('Defina PORTAL_DB_URL (una base de pruebas: se borra al empezar).');
  await cliente.connect();
  await cliente.query('DROP TABLE IF EXISTS eventos, intentos, enlaces, codigos_respaldo, sesiones, accesos, cuentas CASCADE');
  await cliente.query(readFileSync(new URL('../db/001_inicial.sql', import.meta.url), 'utf8'));
  const par = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', par.privateKey);
  publicaX = jwk.x!;
  env = {
    PORTAL_SECRETO: 'p'.repeat(64), PORTAL_CLAVE_PRIVADA: JSON.stringify({ d: jwk.d, x: jwk.x, kid: 'portal-prueba' }), PORTAL_URL: PORTAL,
    MODULOS_SSO: 'residuos', MODULO_RESIDUOS_URL: 'https://residuos.prueba', MODULO_MANTENIMIENTO_URL: 'https://mto.prueba', MODULO_CRM_URL: '', MODULO_PLANTA_URL: '',
  };
  // Salud de los módulos simulada: Residuos responde (salvo cuando la prueba lo «duerme»), Mantenimiento no
  globalThis.fetch = (async (u: string | URL | Request) => new Response('{}', { status: String(u).includes('residuos.prueba') && !residuosDormido ? 200 : 503 })) as typeof fetch;
  olvidarEstados();
});
after(async () => { await cliente.end(); });

interface Respuesta { status: number; json: any; cookie: string | null }
async function llamar(metodo: string, ruta: string, o: { cuerpo?: unknown; cookie?: string; origen?: string; ip?: string } = {}): Promise<Respuesta> {
  const headers: Record<string, string> = { origin: o.origen ?? PORTAL, 'cf-connecting-ip': o.ip ?? '203.0.113.7', 'user-agent': 'prueba' };
  if (o.cuerpo !== undefined) headers['content-type'] = 'application/json';
  if (o.cookie) headers.cookie = o.cookie;
  const r = await atender(new Request(`${PORTAL}/api/v1/${ruta}`, { method: metodo, headers, body: o.cuerpo !== undefined ? JSON.stringify(o.cuerpo) : undefined }), env, { db });
  const texto = await r.text();
  const sc = r.headers.get('set-cookie');
  return { status: r.status, json: texto ? JSON.parse(texto) : null, cookie: sc ? sc.split(';')[0] : null };
}
/** Cuenta creada directamente en la base (como el primer administrador) con su enlace de invitación. */
async function cuentaConEnlace(email: string, nombre: string, admin: boolean) {
  const [c] = (await cliente.query('INSERT INTO cuentas (email, nombre, es_admin) VALUES ($1, $2, $3) RETURNING id', [email, nombre, admin])).rows;
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  await cliente.query(`INSERT INTO enlaces (token_hash, cuenta_id, expira_en) VALUES ($1, $2, now() + interval '1 hour')`, [await sha256Hex(token), c.id]);
  return { id: c.id as string, token };
}
/** Primer ingreso completo: contraseña, configurar la app de autenticación y confirmar. Devuelve la cookie y el secreto. */
async function primerIngreso(email: string, clave: string) {
  const r1 = await llamar('POST', 'ingresar', { cuerpo: { email, clave } });
  assert.equal(r1.status, 200, JSON.stringify(r1.json));
  assert.equal(r1.json.paso, 'configurar');
  const r2 = await llamar('POST', 'codigo/iniciar', { cuerpo: { desafio: r1.json.desafio } });
  assert.equal(r2.status, 200);
  assert.match(r2.json.uri, /^otpauth:\/\/totp\/Terry-App:/);
  const secreto = desdeBase32(r2.json.secreto);
  const r3 = await llamar('POST', 'codigo/confirmar', { cuerpo: { desafio: r1.json.desafio, codigo: await codigoTotp(secreto, pasoActual()) } });
  assert.equal(r3.status, 200, JSON.stringify(r3.json));
  assert.equal(r3.json.respaldo.length, 10);
  assert.match(r3.cookie ?? '', /^__Host-tv_portal=/);
  return { cookie: r3.cookie!, secreto, respaldo: r3.json.respaldo as string[] };
}

let admin: { cookie: string; secreto: Uint8Array; respaldo: string[] };

test('salud y clave pública', async () => {
  const s = await llamar('GET', 'salud');
  assert.equal(s.status, 200);
  assert.equal(s.json.base, 'conectada');
  const k = await llamar('GET', 'clave-publica');
  assert.equal(k.json.keys[0].x, publicaX);
  assert.equal(k.json.keys[0].d, undefined, 'nunca publica la parte privada');
});

test('invitación: crea la contraseña una sola vez y con reglas', async () => {
  const { token } = await cuentaConEnlace('gerencia@prueba.co', 'Gerencia Prueba', true);
  assert.equal((await llamar('POST', 'clave/crear', { cuerpo: { token, clave: 'corta1' } })).status, 400);
  assert.equal((await llamar('POST', 'clave/crear', { cuerpo: { token, clave: 'Gerencia-2026-ok' } })).status, 200);
  assert.equal((await llamar('POST', 'clave/crear', { cuerpo: { token, clave: 'Gerencia-2026-ok' } })).status, 410, 'el enlace sirve una vez');
});

test('primer ingreso: contraseña, luego configurar el código y recibir la sesión', async () => {
  assert.equal((await llamar('POST', 'ingresar', { cuerpo: { email: 'gerencia@prueba.co', clave: 'otra-clave-1' } })).status, 401);
  assert.equal((await llamar('POST', 'ingresar', { cuerpo: { email: 'nadie@prueba.co', clave: 'otra-clave-1' } })).json.mensaje, 'Correo o contraseña incorrectos.');
  admin = await primerIngreso('gerencia@prueba.co', 'Gerencia-2026-ok');
});

test('menú: módulos con estado y pase firmado para Residuos', async () => {
  const yo = await llamar('GET', 'yo', { cookie: admin.cookie });
  assert.equal(yo.status, 200);
  assert.equal(yo.json.cuenta.esAdmin, true);
  const porId = Object.fromEntries(yo.json.modulos.map((m: any) => [m.id, m]));
  assert.equal(porId.residuos.estado, 'disponible');
  assert.equal(porId.mantenimiento.estado, 'sin-respuesta');
  assert.equal(porId.crm.estado, 'proximamente');
  assert.equal((await llamar('GET', 'yo')).status, 401, 'sin cookie no hay sesión');

  const p = await llamar('POST', 'pase', { cookie: admin.cookie, cuerpo: { modulo: 'residuos' } });
  assert.equal(p.status, 200);
  const [base, pase] = p.json.url.split('#sso=');
  assert.equal(base, 'https://residuos.prueba/');
  const [h, c, f] = pase.split('.');
  const publica = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: publicaX }, format: 'jwk' });
  assert.equal(verify(null, Buffer.from(`${h}.${c}`), publica, Buffer.from(f, 'base64url')), true);
  const datos = JSON.parse(Buffer.from(c, 'base64url').toString());
  assert.equal(datos.iss, PORTAL);
  assert.equal(datos.aud, 'residuos');
  assert.equal(datos.sub, 'gerencia@prueba.co');
  assert.deepEqual(datos.amr, ['pwd', 'otp']);
  assert.equal(datos.exp - datos.iat, 60);

  const mto = await llamar('POST', 'pase', { cookie: admin.cookie, cuerpo: { modulo: 'mantenimiento' } });
  assert.deepEqual(mto.json, { url: 'https://mto.prueba', pase: false }, 'sin entrada única todavía: se abre con su propia entrada');
  assert.equal((await llamar('POST', 'pase', { cookie: admin.cookie, cuerpo: { modulo: 'crm' } })).status, 409);
  assert.equal((await llamar('POST', 'pase', { cookie: admin.cookie, cuerpo: { modulo: 'residuos' }, origen: 'https://otro.sitio' })).status, 403, 'protección CSRF');
});

test('pase: con el módulo dormido no se firma (503 DESPERTANDO) y se firma cuando despierta', async () => {
  residuosDormido = true;
  const dormido = await llamar('POST', 'pase', { cookie: admin.cookie, cuerpo: { modulo: 'residuos' } });
  residuosDormido = false;
  assert.equal(dormido.status, 503);
  assert.equal(dormido.json.codigo, 'DESPERTANDO');
  const despierto = await llamar('POST', 'pase', { cookie: admin.cookie, cuerpo: { modulo: 'residuos' } });
  assert.equal(despierto.status, 200);
  assert.match(despierto.json.url, /^https:\/\/residuos\.prueba\/#sso=/);
});

test('administración: crear una cuenta con acceso solo a Residuos', async () => {
  const r = await llamar('POST', 'cuentas', { cookie: admin.cookie, cuerpo: { email: 'Operario@Prueba.co', nombre: 'Operario Prueba', modulos: ['residuos', 'inventado'] } });
  assert.equal(r.status, 201);
  assert.match(r.json.enlace, /^https:\/\/portal\.prueba\/#clave=[A-Za-z0-9_-]{43}$/);
  assert.equal((await llamar('POST', 'cuentas', { cookie: admin.cookie, cuerpo: { email: 'operario@prueba.co', nombre: 'Otra' } })).status, 409);
  const lista = await llamar('GET', 'cuentas', { cookie: admin.cookie });
  const op = lista.json.find((x: any) => x.email === 'operario@prueba.co');
  assert.deepEqual(op.modulos, ['residuos']);
  assert.equal(op.conClave, false);

  const token = r.json.enlace.split('#clave=')[1];
  assert.equal((await llamar('POST', 'clave/crear', { cuerpo: { token, clave: 'Operario-2026-ok' } })).status, 200);
  const op1 = await primerIngreso('operario@prueba.co', 'Operario-2026-ok');
  assert.equal((await llamar('GET', 'cuentas', { cookie: op1.cookie })).status, 403, 'no es administrador');
  assert.equal((await llamar('POST', 'pase', { cookie: op1.cookie, cuerpo: { modulo: 'mantenimiento' } })).status, 403, 'sin acceso a Mantenimiento');
  assert.equal((await llamar('POST', 'pase', { cookie: op1.cookie, cuerpo: { modulo: 'residuos' } })).status, 200);

  // Segundo ingreso: el código ya usado no sirve otra vez; uno nuevo sí; y un código de respaldo sirve una sola vez
  const r1 = await llamar('POST', 'ingresar', { cuerpo: { email: 'operario@prueba.co', clave: 'Operario-2026-ok' } });
  assert.equal(r1.json.paso, 'codigo');
  const usado = await codigoTotp(op1.secreto, pasoActual());
  assert.equal((await llamar('POST', 'ingresar/codigo', { cuerpo: { desafio: r1.json.desafio, codigo: usado } })).status, 401);
  const nuevo = await codigoTotp(op1.secreto, pasoActual() + 1);
  assert.equal((await llamar('POST', 'ingresar/codigo', { cuerpo: { desafio: r1.json.desafio, codigo: nuevo } })).status, 200);
  const r2 = await llamar('POST', 'ingresar', { cuerpo: { email: 'operario@prueba.co', clave: 'Operario-2026-ok' } });
  assert.equal((await llamar('POST', 'ingresar/codigo', { cuerpo: { desafio: r2.json.desafio, codigo: op1.respaldo[0].toLowerCase() } })).status, 200);
  const r3 = await llamar('POST', 'ingresar', { cuerpo: { email: 'operario@prueba.co', clave: 'Operario-2026-ok' } });
  assert.equal((await llamar('POST', 'ingresar/codigo', { cuerpo: { desafio: r3.json.desafio, codigo: op1.respaldo[0] } })).status, 401, 'respaldo usado');
  assert.equal((await llamar('POST', 'ingresar/codigo', { cuerpo: { desafio: 'falso.falso', codigo: nuevo } })).status, 401);

  // Desactivar la cuenta cierra sus sesiones al instante
  assert.equal((await llamar('PATCH', `cuentas/${op.id}`, { cookie: admin.cookie, cuerpo: { activa: false } })).status, 200);
  assert.equal((await llamar('GET', 'yo', { cookie: op1.cookie })).status, 401);
  assert.equal((await llamar('PATCH', `cuentas/${op.id}`, { cookie: admin.cookie, cuerpo: { activa: true, modulos: ['residuos', 'planta'] } })).status, 200);

  // Quitarle el código (celular perdido): en su próximo ingreso lo configura de nuevo
  assert.equal((await llamar('POST', `cuentas/${op.id}/codigo/quitar`, { cookie: admin.cookie })).status, 200);
  assert.equal((await llamar('POST', 'ingresar', { cuerpo: { email: 'operario@prueba.co', clave: 'Operario-2026-ok' } })).json.paso, 'configurar');
  const [yoMismo] = (await cliente.query("SELECT id FROM cuentas WHERE email = 'gerencia@prueba.co'")).rows;
  assert.equal((await llamar('PATCH', `cuentas/${yoMismo.id}`, { cookie: admin.cookie, cuerpo: { esAdmin: false } })).status, 400, 'no se quita a sí mismo la administración');
});

test('la sesión dura un año sin uso y cada uso corre el plazo (estándar 1 del ERP)', async () => {
  const id = admin.cookie.split('=')[1].split('.')[0];
  const [s] = (await cliente.query('SELECT expira_en FROM sesiones WHERE id = $1', [id])).rows;
  assert.ok(new Date(s.expira_en).getTime() - Date.now() > 360 * 86_400_000, 'un año');
  await cliente.query("UPDATE sesiones SET expira_en = now() + interval '10 days' WHERE id = $1", [id]);
  assert.equal((await llamar('GET', 'yo', { cookie: admin.cookie })).status, 200);
  const [s2] = (await cliente.query('SELECT expira_en FROM sesiones WHERE id = $1', [id])).rows;
  assert.ok(new Date(s2.expira_en).getTime() - Date.now() > 360 * 86_400_000, 'al usarla vuelve a un año');
});

test('olvidé mi contraseña: la solicitud aparece en Cuentas y se atiende con un enlace (estándar 2 del ERP)', async () => {
  const r = await llamar('POST', 'olvide', { cuerpo: { email: 'operario@prueba.co' }, ip: '198.51.100.9' });
  assert.equal(r.status, 202);
  assert.equal((await llamar('POST', 'olvide', { cuerpo: { email: 'nadie@prueba.co' }, ip: '198.51.100.9' })).status, 202, 'igual si el correo no existe');
  let op = (await llamar('GET', 'cuentas', { cookie: admin.cookie })).json.find((x: any) => x.email === 'operario@prueba.co');
  assert.ok(op.restablecerPedidoEn, 'el administrador ve la solicitud');
  assert.equal((await llamar('POST', `cuentas/${op.id}/enlace`, { cookie: admin.cookie })).status, 200);
  op = (await llamar('GET', 'cuentas', { cookie: admin.cookie })).json.find((x: any) => x.email === 'operario@prueba.co');
  assert.equal(op.restablecerPedidoEn, null, 'con el enlace queda atendida');
});

test('cambiar la contraseña cierra las otras sesiones', async () => {
  const otra = await llamar('POST', 'ingresar', { cuerpo: { email: 'gerencia@prueba.co', clave: 'Gerencia-2026-ok' } });
  const s2 = await llamar('POST', 'ingresar/codigo', { cuerpo: { desafio: otra.json.desafio, codigo: admin.respaldo[1] } });
  assert.equal(s2.status, 200);
  assert.equal((await llamar('POST', 'clave/cambiar', { cookie: admin.cookie, cuerpo: { actual: 'mala-clave-1', nueva: 'Gerencia-2027-ok' } })).status, 401);
  assert.equal((await llamar('POST', 'clave/cambiar', { cookie: admin.cookie, cuerpo: { actual: 'Gerencia-2026-ok', nueva: 'Gerencia-2027-ok' } })).status, 200);
  assert.equal((await llamar('GET', 'yo', { cookie: admin.cookie })).status, 200, 'la sesión actual sigue');
  assert.equal((await llamar('GET', 'yo', { cookie: s2.cookie! })).status, 401, 'la otra se cerró');
});

test('bloqueo tras 5 contraseñas erradas y límite por correo', async () => {
  const { token } = await cuentaConEnlace('bloqueo@prueba.co', 'Bloqueo Prueba', false);
  await llamar('POST', 'clave/crear', { cuerpo: { token, clave: 'Bloqueo-2026-ok' } });
  for (let i = 0; i < 5; i++) assert.equal((await llamar('POST', 'ingresar', { cuerpo: { email: 'bloqueo@prueba.co', clave: `Errada-${i}-xx` }, ip: '198.51.100.1' })).status, 401);
  const b = await llamar('POST', 'ingresar', { cuerpo: { email: 'bloqueo@prueba.co', clave: 'Bloqueo-2026-ok' }, ip: '198.51.100.1' });
  assert.equal(b.status, 403);
  assert.match(b.json.mensaje, /bloqueada/);
  let ultimo = 0;
  for (let i = 0; i < 11; i++) ultimo = (await llamar('POST', 'ingresar', { cuerpo: { email: 'limite@prueba.co', clave: 'Cualquiera-1' }, ip: '198.51.100.2' })).status;
  assert.equal(ultimo, 429);
  const [n] = (await cliente.query("SELECT count(*)::int AS n FROM eventos WHERE tipo = 'BLOQUEO'")).rows;
  assert.ok(n.n >= 1, 'el bloqueo queda en la bitácora');
});

test('salir cierra la sesión', async () => {
  const s = await llamar('POST', 'salir', { cookie: admin.cookie });
  assert.equal(s.status, 204);
  assert.match(s.cookie ?? '', /^__Host-tv_portal=$/);
  assert.equal((await llamar('GET', 'yo', { cookie: admin.cookie })).status, 401);
});
