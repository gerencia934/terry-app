import { createPublicKey, verify, type KeyObject } from 'node:crypto';

/**
 * Pase del portal Terry-App (docs/ECOSISTEMA.md): JWS compacto firmado con Ed25519, de 60 segundos y de un solo uso.
 * Aquí solo se verifica la firma y los campos; el uso único (jti) y el usuario los revisa AuthService.
 */
export interface DatosPase { iss: string; aud: string; sub: string; nom?: string; amr: string[]; iat: number; exp: number; jti: string }

const claves = new Map<string, KeyObject>();
function clavePublica(x: string) {
  let k = claves.get(x);
  if (!k) { k = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' }); claves.set(x, k); }
  return k;
}
const json = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as Record<string, unknown>;

/** Devuelve los datos del pase si la firma y los campos son válidos para este módulo; si no, null (sin decir por qué). */
export function verificarPase(pase: string, opciones: { portal: string; clavePublica: string; modulo: string; ahora?: number }): DatosPase | null {
  if (!opciones.portal || !opciones.clavePublica || pase.length > 4000) return null;
  const partes = pase.split('.');
  if (partes.length !== 3 || partes.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return null;
  const [h, p, f] = partes;
  try {
    if (json(h).alg !== 'EdDSA') return null;
    if (!verify(null, Buffer.from(`${h}.${p}`), clavePublica(opciones.clavePublica), Buffer.from(f, 'base64url'))) return null;
    const d = json(p);
    const ahora = opciones.ahora ?? Math.floor(Date.now() / 1000);
    const valido = d.iss === opciones.portal.replace(/\/+$/, '') && d.aud === opciones.modulo
      && typeof d.sub === 'string' && /^[^@\s]+@[^@\s]+$/.test(d.sub) && Array.isArray(d.amr)
      && typeof d.iat === 'number' && typeof d.exp === 'number' && d.exp >= ahora - 5 && d.iat <= ahora + 5 && d.exp - d.iat <= 120
      && typeof d.jti === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(d.jti);
    return valido ? (d as unknown as DatosPase) : null;
  } catch { return null; }
}
