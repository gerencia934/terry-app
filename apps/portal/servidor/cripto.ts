// Criptografía del portal con WebCrypto (la misma en Cloudflare y en Node 22): contraseñas, verificación en dos pasos,
// datos cifrados, desafíos del ingreso y el pase firmado que reciben los módulos (ver docs/ECOSISTEMA.md).

const te = new TextEncoder();
const td = new TextDecoder();

export function b64u(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function desdeB64u(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
export const aleatorio = (n: number) => crypto.getRandomValues(new Uint8Array(n));
export const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
export async function sha256Hex(s: string) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(s)))); }
/** Comparación en tiempo constante (para no revelar por el tiempo cuántos caracteres coinciden). */
export function iguales(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Llaves derivadas del secreto del portal (PORTAL_SECRETO): una por uso, para que ninguna sirva para otra cosa. */
export interface Llaves { pimienta: CryptoKey; datos: CryptoKey; desafio: CryptoKey }
export async function llaves(secreto: string): Promise<Llaves> {
  if (!secreto || secreto.length < 32) throw new Error('PORTAL_SECRETO debe tener al menos 32 caracteres.');
  const base = await crypto.subtle.importKey('raw', te.encode(secreto), 'HKDF', false, ['deriveKey']);
  const derivar = (info: string, alg: HmacKeyGenParams | AesKeyGenParams, usos: KeyUsage[]) =>
    crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: te.encode(info) }, base, alg, false, usos);
  return {
    pimienta: await derivar('terry-portal:pimienta', { name: 'HMAC', hash: 'SHA-256', length: 256 }, ['sign']),
    datos: await derivar('terry-portal:datos', { name: 'AES-GCM', length: 256 }, ['encrypt', 'decrypt']),
    desafio: await derivar('terry-portal:desafio', { name: 'HMAC', hash: 'SHA-256', length: 256 }, ['sign', 'verify']),
  };
}

// --- Contraseñas: PBKDF2-SHA256 con pimienta. Cloudflare Workers no acepta más de 100.000 iteraciones; la pimienta (un
// HMAC con una llave que no está en la base) hace que una copia robada de la base no sirva para probar contraseñas.
const ITERACIONES = 100_000;
async function derivarClave(clave: string, sal: Uint8Array, iteraciones: number, k: Llaves) {
  const conPimienta = new Uint8Array(await crypto.subtle.sign('HMAC', k.pimienta, te.encode(clave.normalize('NFKC'))));
  const base = await crypto.subtle.importKey('raw', conPimienta, 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iteraciones }, base, 256));
}
export async function hashClave(clave: string, k: Llaves): Promise<string> {
  const sal = aleatorio(16);
  return `pbkdf2-sha256$${ITERACIONES}$${b64u(sal)}$${b64u(await derivarClave(clave, sal, ITERACIONES, k))}`;
}
export async function verificarClave(clave: string, guardado: string | null, k: Llaves): Promise<boolean> {
  const [alg, iter, sal, hash] = (guardado ?? '').split('$');
  const n = Number(iter);
  if (alg !== 'pbkdf2-sha256' || !sal || !hash || !Number.isInteger(n) || n < 10_000 || n > ITERACIONES) {
    await hashClave(clave, k); // mismo tiempo de respuesta aunque la cuenta no exista o no tenga contraseña
    return false;
  }
  return iguales(b64u(await derivarClave(clave, desdeB64u(sal), n, k)), hash);
}
/** Mínimo 10 caracteres, con letras y números (igual que en Residuos). */
export function claveValida(clave: unknown): clave is string {
  return typeof clave === 'string' && clave.length >= 10 && clave.length <= 200 && /[A-Za-z]/.test(clave) && /\d/.test(clave);
}

// --- Verificación en dos pasos (TOTP, RFC 6238: SHA-1, 6 dígitos, pasos de 30 segundos)
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(bytes: Uint8Array) {
  let bits = 0, valor = 0, s = '';
  for (const b of bytes) {
    valor = (valor << 8) | b; bits += 8;
    while (bits >= 5) { s += B32[(valor >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) s += B32[(valor << (5 - bits)) & 31];
  return s;
}
export function desdeBase32(s: string): Uint8Array {
  const limpio = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, valor = 0;
  const out: number[] = [];
  for (const c of limpio) {
    valor = (valor << 5) | B32.indexOf(c); bits += 5;
    if (bits >= 8) { out.push((valor >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Uint8Array.from(out);
}
export async function codigoTotp(secreto: Uint8Array, paso: number, digitos = 6): Promise<string> {
  const msg = new Uint8Array(8);
  new DataView(msg.buffer).setBigUint64(0, BigInt(paso));
  const k = await crypto.subtle.importKey('raw', secreto, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', k, msg));
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digitos).padStart(digitos, '0');
}
export const pasoActual = (ahoraMs = Date.now()) => Math.floor(ahoraMs / 30_000);
/** Paso en que vale el código (el anterior, el actual o el siguiente, por la hora del celular), o null. */
export async function pasoDelCodigo(secreto: Uint8Array, codigo: string, ahoraMs = Date.now()): Promise<number | null> {
  if (!/^\d{6}$/.test(codigo)) return null;
  const p = pasoActual(ahoraMs);
  let hallado: number | null = null;
  for (const q of [p - 1, p, p + 1]) if (iguales(await codigoTotp(secreto, q), codigo)) hallado = q;
  return hallado;
}
export const uriOtp = (email: string, secreto32: string) =>
  `otpauth://totp/Terry-App:${encodeURIComponent(email)}?secret=${secreto32}&issuer=Terry-App&algorithm=SHA1&digits=6&period=30`;
/** Código de respaldo de 8 letras/números en dos grupos (ABCD-2345): se escribe sin confundir 0/O ni 1/I. */
export function codigoRespaldo() {
  const s = base32(aleatorio(5)).slice(0, 8);
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
export const normalRespaldo = (c: string) => c.toUpperCase().replace(/[^A-Z2-7]/g, '');
export async function huellaRespaldo(codigo: string, k: Llaves) {
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', k.pimienta, te.encode(`respaldo:${normalRespaldo(codigo)}`))));
}

// --- Datos cifrados en la base (el secreto de la verificación en dos pasos): AES-256-GCM
export async function cifrar(texto: string, k: Llaves) {
  const iv = aleatorio(12);
  return `v1.${b64u(iv)}.${b64u(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k.datos, te.encode(texto))))}`;
}
export async function descifrar(s: string, k: Llaves) {
  const [v, iv, c] = s.split('.');
  if (v !== 'v1' || !iv || !c) throw new Error('Dato cifrado con un formato desconocido.');
  return td.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: desdeB64u(iv) }, k.datos, desdeB64u(c)));
}

// --- Desafío del ingreso: entre la contraseña y el código (o la configuración del código). Firmado y de 5 minutos.
export type TipoDesafio = 'codigo' | 'configurar';
export async function firmarDesafio(c: string, t: TipoDesafio, k: Llaves, minutos = 5) {
  const cuerpo = b64u(te.encode(JSON.stringify({ c, t, exp: Math.floor(Date.now() / 1000) + minutos * 60 })));
  return `${cuerpo}.${b64u(new Uint8Array(await crypto.subtle.sign('HMAC', k.desafio, te.encode(cuerpo))))}`;
}
export async function leerDesafio(token: unknown, k: Llaves): Promise<{ c: string; t: TipoDesafio } | null> {
  if (typeof token !== 'string' || token.length > 600) return null;
  const [cuerpo, firma] = token.split('.');
  if (!cuerpo || !firma) return null;
  try {
    if (!(await crypto.subtle.verify('HMAC', k.desafio, desdeB64u(firma), te.encode(cuerpo)))) return null;
    const d = JSON.parse(td.decode(desdeB64u(cuerpo))) as { c?: unknown; t?: unknown; exp?: unknown };
    if (typeof d.c !== 'string' || (d.t !== 'codigo' && d.t !== 'configurar') || typeof d.exp !== 'number' || d.exp < Date.now() / 1000) return null;
    return { c: d.c, t: d.t };
  } catch { return null; }
}

// --- Pase para los módulos: JWS compacto con Ed25519 (docs/ECOSISTEMA.md)
export interface ClavePase { privada: CryptoKey; publica: JsonWebKey & { kid: string }; kid: string }
export async function clavePase(jwkTexto: string): Promise<ClavePase> {
  const jwk = JSON.parse(jwkTexto) as { d?: string; x?: string; kid?: string };
  if (!jwk.d || !jwk.x) throw new Error('PORTAL_CLAVE_PRIVADA debe ser un JWK Ed25519 con «d» y «x».');
  const kid = jwk.kid ?? 'portal-1';
  const privada = await crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', d: jwk.d, x: jwk.x }, { name: 'Ed25519' }, false, ['sign']);
  return { privada, kid, publica: { kty: 'OKP', crv: 'Ed25519', x: jwk.x, use: 'sig', alg: 'EdDSA', kid } };
}
export interface DatosPase { iss: string; aud: string; sub: string; nom: string; amr: string[]; iat: number; exp: number; jti: string }
export async function firmarPase(c: ClavePase, d: DatosPase) {
  const h = b64u(te.encode(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid: c.kid })));
  const p = b64u(te.encode(JSON.stringify(d)));
  return `${h}.${p}.${b64u(new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, c.privada, te.encode(`${h}.${p}`))))}`;
}
