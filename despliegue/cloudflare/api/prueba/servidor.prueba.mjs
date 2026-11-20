// Prueba de la lógica del Durable Object que controla el contenedor (src/index.ts), con un contenedor simulado:
// encender una sola vez aunque lleguen varias peticiones, pasar la petición tal cual, cambiar a la versión nueva al
// publicar (apagado ordenado), volver a encender si se cae y el aviso de cada minuto. No necesita Docker ni Cloudflare.
// Uso: npm run prueba (en despliegue/cloudflare)
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const aqui = (p) => fileURLToPath(new URL(p, import.meta.url));
const { outputFiles } = await build({
  entryPoints: [aqui('../src/index.ts')], bundle: true, format: 'esm', platform: 'neutral', write: false,
  plugins: [{
    name: 'cloudflare-workers-simulado',
    setup(b) {
      b.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'cf', namespace: 'simulado' }));
      b.onLoad({ filter: /.*/, namespace: 'simulado' }, () => ({ contents: 'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }' }));
    },
  }],
});
// Node exige «duplex» para pasar un cuerpo en flujo a otra petición; Cloudflare no (allá el código corre tal cual)
const RequestNode = globalThis.Request;
globalThis.Request = class extends RequestNode { constructor(e, o) { super(e, o?.body ? { duplex: 'half', ...o } : o); } };
const modulo = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const { ServidorApi, default: worker } = modulo;

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/** Contenedor simulado: tarda `demora` ms en responder después de encender; registra arranques, señales y opciones. */
class ContenedorSimulado {
  constructor(imagen = 'registro/api@sha256:1', demora = 60) {
    this.images = { api: imagen }; this.running = false; this.demora = demora; this.arranques = []; this.senales = [];
    this.destrucciones = 0; this.timeout = null; this.listoEn = 0; this.imagen = null; this.opciones = null;
  }
  start(o) { this.running = true; this.arranques.push(o.image); this.imagen = o.image; this.opciones = o; this.listoEn = Date.now() + this.demora; }
  async setInactivityTimeout(ms) { this.timeout = ms; }
  signal(s) { this.senales.push(s); setTimeout(() => { this.running = false; }, 40); }
  async destroy() { this.destrucciones++; this.running = false; }
  getTcpPort(puerto) {
    return {
      fetch: async (url, init) => {
        if (!this.running || Date.now() < this.listoEn) throw new Error('connection refused');
        const p = url instanceof Request ? url : new Request(url, init);
        const u = new URL(p.url);
        return Response.json({ puerto, ruta: u.pathname + u.search, metodo: p.method, host: p.headers.get('host'),
          xff: p.headers.get('x-forwarded-for'), redirect: p.redirect, cuerpo: p.body ? await p.text() : null, imagen: this.imagen });
      },
    };
  }
}

/** Estado del Durable Object (almacenamiento) y un objeto nuevo sobre él, como cuando Cloudflare lo vuelve a crear. */
function estado(contenedor, guardado = new Map()) {
  const ctx = { container: contenedor, bloqueos: [],
    storage: { get: async (k) => guardado.get(k), put: async (k, v) => { guardado.set(k, v); } },
    blockConcurrencyWhile(f) { const p = f(); this.bloqueos.push(p); return p; } };
  return { ctx, guardado };
}
const ENV = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://simulada', JWT_SECRET: 'x'.repeat(40), SERVIDOR: { binding: true } };
async function objeto(ctx, env = ENV) { const o = new ServidorApi(ctx, env); await Promise.all(ctx.bloqueos); return o; }

let ok = 0; let fallas = 0;
async function prueba(nombre, f) {
  try { await f(); ok++; console.log(`  ✓ ${nombre}`); } catch (e) { fallas++; console.log(`  ✗ ${nombre}\n    ${e.message}`); }
}

console.log('Servidor en Cloudflare (Durable Object + contenedor simulado)');

await prueba('enciende una sola vez aunque lleguen varias peticiones a la vez, y pasa cada una tal cual', async () => {
  const c = new ContenedorSimulado(); const { ctx, guardado } = estado(c); const o = await objeto(ctx);
  const pedir = (i) => o.fetch(new Request(`https://residuos.terravivasas.net/api/v1/prueba/${i}?a=1`, { method: 'POST', body: `cuerpo-${i}`,
    headers: { host: 'residuos.terravivasas.net', 'x-forwarded-for': '203.0.113.7', 'content-type': 'text/plain' } }));
  const rs = await Promise.all([1, 2, 3].map(pedir));
  assert.equal(c.arranques.length, 1);
  for (const [i, r] of rs.entries()) {
    assert.equal(r.status, 200);
    const d = await r.json();
    assert.deepEqual([d.puerto, d.ruta, d.metodo, d.host, d.xff, d.redirect, d.cuerpo],
      [3000, `/api/v1/prueba/${i + 1}?a=1`, 'POST', null, '203.0.113.7', 'manual', `cuerpo-${i + 1}`]);
  }
  assert.equal(c.opciones.enableInternet, true);
  assert.deepEqual(c.opciones.instance, { vcpu: 1, memoryMib: 3072, diskMb: 4000 });
  assert.equal(c.timeout, 15 * 60_000);
  assert.match(guardado.get('version'), /^registro\/api@sha256:1#[0-9a-f]{64}$/);
  assert.ok(!guardado.get('version').includes('simulada')); // las claves no se guardan tal cual
});

await prueba('al contenedor le llegan las variables y claves del Worker (textos), no los enlaces', async () => {
  const c = new ContenedorSimulado(); const { ctx } = estado(c); const o = await objeto(ctx);
  await o.fetch(new Request('https://x/api/v1/salud'));
  assert.deepEqual(c.opciones.env, { NODE_ENV: 'production', DATABASE_URL: 'postgresql://simulada', JWT_SECRET: 'x'.repeat(40) });
});

await prueba('después del primer arranque no vuelve a encender ni a esperar', async () => {
  const c = new ContenedorSimulado(); const { ctx } = estado(c); const o = await objeto(ctx);
  await o.fetch(new Request('https://x/api/v1/a'));
  const t = Date.now(); const r = await o.fetch(new Request('https://x/api/v1/b'));
  assert.equal(r.status, 200); assert.equal(c.arranques.length, 1); assert.ok(Date.now() - t < 40);
});

await prueba('versión nueva publicada: apaga con calma la anterior (SIGTERM) y enciende la nueva', async () => {
  const c = new ContenedorSimulado(); const guardado = new Map();
  const o1 = await objeto(estado(c, guardado).ctx);
  await o1.fetch(new Request('https://x/api/v1/a'));
  c.images = { api: 'registro/api@sha256:2' }; // se publicó otra imagen; Cloudflare crea el objeto de nuevo
  const o2 = await objeto(estado(c, guardado).ctx);
  const d = await (await o2.fetch(new Request('https://x/api/v1/b'))).json();
  assert.deepEqual(c.senales, [15]); assert.equal(c.destrucciones, 0);
  assert.deepEqual(c.arranques, ['registro/api@sha256:1', 'registro/api@sha256:2']);
  assert.equal(d.imagen, 'registro/api@sha256:2'); assert.match(guardado.get('version'), /^registro\/api@sha256:2#/);
});

await prueba('cambia una clave del Worker (misma imagen): reinicia el contenedor con las variables nuevas', async () => {
  const c = new ContenedorSimulado(); const guardado = new Map();
  const o1 = await objeto(estado(c, guardado).ctx);
  await o1.fetch(new Request('https://x/api/v1/a'));
  const o2 = await objeto(estado(c, guardado).ctx, { ...ENV, SMTP_PASS: 'clave-nueva' });
  const r = await o2.fetch(new Request('https://x/api/v1/b'));
  assert.equal(r.status, 200); assert.deepEqual(c.senales, [15]); assert.equal(c.arranques.length, 2);
  assert.equal(c.opciones.env.SMTP_PASS, 'clave-nueva');
});

await prueba('mismo objeto en memoria y versión nueva: también cambia de imagen', async () => {
  const c = new ContenedorSimulado(); const { ctx } = estado(c); const o = await objeto(ctx);
  await o.fetch(new Request('https://x/api/v1/a'));
  c.images = { api: 'registro/api@sha256:3' };
  const d = await (await o.fetch(new Request('https://x/api/v1/b'))).json();
  assert.equal(d.imagen, 'registro/api@sha256:3'); assert.deepEqual(c.senales, [15]);
});

await prueba('objeto nuevo con el contenedor ya encendido y la misma versión: no lo reinicia y renueva su vida', async () => {
  const c = new ContenedorSimulado(); const guardado = new Map();
  const o1 = await objeto(estado(c, guardado).ctx);
  await o1.fetch(new Request('https://x/api/v1/a'));
  c.timeout = null;
  const o2 = await objeto(estado(c, guardado).ctx);
  assert.equal(c.timeout, 15 * 60_000);
  const r = await o2.fetch(new Request('https://x/api/v1/b'));
  assert.equal(r.status, 200); assert.equal(c.arranques.length, 1); assert.deepEqual(c.senales, []);
});

await prueba('si el contenedor se cae: responde 503 con un mensaje claro y la siguiente petición lo enciende', async () => {
  const c = new ContenedorSimulado(); const { ctx } = estado(c); const o = await objeto(ctx);
  await o.fetch(new Request('https://x/api/v1/a'));
  const original = c.getTcpPort.bind(c);
  c.getTcpPort = () => ({ fetch: async () => { c.running = false; throw new Error('connection reset'); } });
  const r = await o.fetch(new Request('https://x/api/v1/b'));
  assert.equal(r.status, 503); assert.match((await r.json()).mensaje, /Intente de nuevo/);
  c.getTcpPort = original;
  const r2 = await o.fetch(new Request('https://x/api/v1/c'));
  assert.equal(r2.status, 200); assert.equal(c.arranques.length, 2);
});

await prueba('solo atiende /api y el aviso interno; lo demás no enciende nada', async () => {
  const c = new ContenedorSimulado(); const { ctx } = estado(c); const o = await objeto(ctx);
  const r = await o.fetch(new Request('https://x/index.html'));
  assert.equal(r.status, 404); assert.equal(c.arranques.length, 0);
});

await prueba('el aviso de cada minuto enciende el servidor sin llegar al API', async () => {
  const c = new ContenedorSimulado(); const { ctx } = estado(c); const o = await objeto(ctx);
  const r = await o.fetch(new Request('http://interno/__vigilar'));
  assert.equal(await r.text(), 'ok'); assert.equal(c.arranques.length, 1); assert.equal(c.running, true);
});

await prueba('el Worker usa un único servidor en el oriente de Norteamérica, para peticiones y para el aviso (cron)', async () => {
  const llamadas = [];
  const env = { SERVIDOR: { getByName: (nombre, op) => ({ fetch: async (p) => { llamadas.push([nombre, op, typeof p === 'string' ? p : p.url]); return new Response('ok'); } }) } };
  await worker.fetch(new Request('https://residuos.terravivasas.net/api/v1/salud'), env);
  const pendientes = [];
  worker.scheduled({}, env, { waitUntil: (p) => pendientes.push(p) });
  await Promise.all(pendientes);
  assert.deepEqual(llamadas, [
    ['principal', { locationHint: 'enam' }, 'https://residuos.terravivasas.net/api/v1/salud'],
    ['principal', { locationHint: 'enam' }, 'http://interno/__vigilar'],
  ]);
});

await espera(60);
console.log(`\n${ok} pruebas correctas, ${fallas} con error`);
process.exit(fallas ? 1 : 0);
