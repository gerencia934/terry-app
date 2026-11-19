// Verificación en dos pasos con códigos de un solo uso basados en tiempo (TOTP, RFC 6238; HMAC-SHA1, 6 dígitos, 30 s),
// compatible con Google Authenticator, Microsoft Authenticator, Authy y similares. Sin librerías externas.
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const PASO_SEG = 30;

/** Bytes → base32 (RFC 4648, sin relleno): es como las apps reciben el secreto. */
export function base32(buf: Buffer) {
  let bits = 0, valor = 0, out = '';
  for (const b of buf) {
    valor = (valor << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(valor >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(valor << (5 - bits)) & 31];
  return out;
}
export function desdeBase32(s: string) {
  let bits = 0, valor = 0;
  const out: number[] = [];
  for (const c of s.replace(/[\s=-]/g, '').toUpperCase()) {
    const i = B32.indexOf(c);
    if (i < 0) throw new Error('Secreto en base32 no válido');
    valor = (valor << 5) | i; bits += 5;
    if (bits >= 8) { out.push((valor >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const pasoDe = (ms = Date.now()) => Math.floor(ms / 1000 / PASO_SEG);
/** Código de 6 dígitos de un paso de tiempo (HOTP del RFC 4226 con el contador = paso). */
export function codigoDelPaso(secreto: Buffer, paso: number) {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(paso));
  const h = createHmac('sha1', secreto).update(contador).digest();
  const o = h[h.length - 1] & 0x0f;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}
/**
 * Paso al que corresponde el código, con una ventana de ±1 paso (90 s, por relojes desfasados), o null. Quien verifica
 * guarda el paso usado y rechaza códigos de ese paso o anteriores: así un código no sirve dos veces.
 */
export function pasoDelCodigo(secreto: Buffer, codigo: string, ms = Date.now()) {
  if (!/^\d{6}$/.test(codigo)) return null;
  const actual = pasoDe(ms);
  for (const d of [0, -1, 1]) if (timingSafeEqual(Buffer.from(codigoDelPaso(secreto, actual + d)), Buffer.from(codigo))) return actual + d;
  return null;
}

/** Secreto nuevo de 160 bits (lo recomendado por el RFC 4226). */
export const secretoNuevo = () => base32(randomBytes(20));
/** Dirección «otpauth://» del código QR que leen las apps de autenticación. */
export const uriOtp = (emisor: string, cuenta: string, secreto: string) =>
  `otpauth://totp/${encodeURIComponent(`${emisor}:${cuenta}`)}?secret=${secreto}&issuer=${encodeURIComponent(emisor)}&algorithm=SHA1&digits=6&period=${PASO_SEG}`;

/** Código de respaldo «ABCD-EFGH» (40 bits, sin letras que se confundan: base32 no tiene 0, 1 ni 8). */
export const codigoRespaldo = () => { const s = base32(randomBytes(5)); return `${s.slice(0, 4)}-${s.slice(4, 8)}`; };
/** Forma normal de un código de respaldo escrito por el usuario (sin guion, espacios ni minúsculas). */
export const normalRespaldo = (c: string) => c.replace(/[\s-]/g, '').toUpperCase();

// El secreto se guarda cifrado (AES-256-GCM): una copia de la base no basta para generar códigos.
export function cifrar(texto: string, clave: Buffer) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', clave, iv);
  const datos = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), datos].map((b) => b.toString('base64url')).join('.');
}
export function descifrar(guardado: string, clave: Buffer) {
  const [iv, tag, datos] = guardado.split('.').map((x) => Buffer.from(x, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', clave, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(datos), d.final()]).toString('utf8');
}
