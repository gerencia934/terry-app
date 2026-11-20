// Pruebas de la criptografía del portal (node --test). Corren igual que en Cloudflare: solo WebCrypto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import {
  b64u, base32, cifrar, clavePase, claveValida, codigoTotp, descifrar, desdeB64u, desdeBase32, firmarDesafio, firmarPase,
  hashClave, leerDesafio, llaves, pasoDelCodigo, verificarClave,
} from '../servidor/cripto.ts';

const k = await llaves('s'.repeat(64));

test('TOTP: vector de la RFC 6238 (SHA-1, T=59 s)', async () => {
  const secreto = new TextEncoder().encode('12345678901234567890');
  assert.equal(await codigoTotp(secreto, 1, 8), '94287082');
  assert.equal(await codigoTotp(secreto, 1), '287082');
  assert.equal(await pasoDelCodigo(secreto, '287082', 59_000), 1);
  assert.equal(await pasoDelCodigo(secreto, '000000', 59_000), null);
});

test('base32 y base64url van y vuelven', () => {
  const datos = crypto.getRandomValues(new Uint8Array(20));
  assert.deepEqual(desdeBase32(base32(datos)), datos);
  assert.deepEqual(desdeB64u(b64u(datos)), datos);
});

test('contraseñas: con pimienta, sal propia y comparación correcta', async () => {
  const h = await hashClave('Clave-segura-2026', k);
  assert.match(h, /^pbkdf2-sha256\$100000\$/);
  assert.notEqual(h, await hashClave('Clave-segura-2026', k), 'cada hash lleva su propia sal');
  assert.equal(await verificarClave('Clave-segura-2026', h, k), true);
  assert.equal(await verificarClave('Clave-segura-2027', h, k), false);
  assert.equal(await verificarClave('Clave-segura-2026', null, k), false);
  // Con otro secreto del portal (otra pimienta) la misma contraseña no sirve: una copia de la base sola no basta
  assert.equal(await verificarClave('Clave-segura-2026', h, await llaves('t'.repeat(64))), false);
  assert.equal(claveValida('corta1'), false);
  assert.equal(claveValida('solo-letras-sin-numeros'), false);
  assert.equal(claveValida('Valida-2026x'), true);
});

test('datos cifrados: AES-GCM detecta cambios', async () => {
  const c = await cifrar('JBSWY3DPEHPK3PXP', k);
  assert.equal(await descifrar(c, k), 'JBSWY3DPEHPK3PXP');
  const [v, iv, d] = c.split('.');
  const alterado = `${v}.${iv}.${d.slice(0, -2)}${d.endsWith('A') ? 'B' : 'A'}${d.slice(-1)}`;
  await assert.rejects(descifrar(alterado, k));
});

test('desafío del ingreso: firmado, con tipo y con vencimiento', async () => {
  const d = await firmarDesafio('3f6c1d2e-0000-4000-8000-000000000001', 'codigo', k);
  assert.deepEqual(await leerDesafio(d, k), { c: '3f6c1d2e-0000-4000-8000-000000000001', t: 'codigo' });
  const [cuerpo, firma] = d.split('.');
  assert.equal(await leerDesafio(`${cuerpo}x.${firma}`, k), null, 'alterado');
  assert.equal(await leerDesafio(await firmarDesafio('x', 'codigo', k, -1), k), null, 'vencido');
  assert.equal(await leerDesafio(d, await llaves('t'.repeat(64))), null, 'otra llave');
  assert.equal(await leerDesafio(123, k), null);
});

test('pase: Ed25519 verificable con node:crypto (como lo hace Residuos)', async () => {
  const par = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', par.privateKey);
  const c = await clavePase(JSON.stringify({ d: jwk.d, x: jwk.x, kid: 'portal-prueba' }));
  const ahora = Math.floor(Date.now() / 1000);
  const pase = await firmarPase(c, { iss: 'https://portal.prueba', aud: 'residuos', sub: 'a@b.co', nom: 'A', amr: ['pwd', 'otp'], iat: ahora, exp: ahora + 60, jti: crypto.randomUUID() });
  const [h, p, f] = pase.split('.');
  const publica = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: jwk.x! }, format: 'jwk' });
  assert.equal(verify(null, Buffer.from(`${h}.${p}`), publica, Buffer.from(f, 'base64url')), true);
  assert.equal(verify(null, Buffer.from(`${h}.${p}x`), publica, Buffer.from(f, 'base64url')), false);
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url').toString()), { alg: 'EdDSA', typ: 'JWT', kid: 'portal-prueba' });
  assert.equal(JSON.parse(Buffer.from(p, 'base64url').toString()).aud, 'residuos');
});
