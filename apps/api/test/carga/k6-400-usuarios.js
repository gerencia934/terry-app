// Prueba de carga (requisitos de producción §6): 400 usuarios concurrentes en hora pico (fin de mes),
// pantallas con respuesta p95 menor a 1 segundo y descargas de PDF sin errores.
//
// SOLO contra staging, nunca contra producción. Pasos (detalle en apps/api/test/carga/LEAME.md):
//   1. Base de staging con volumen (2.000 clientes, meses de manifiestos y certificados) y usuarios de prueba:
//        CONFIRMAR=staging CANTIDAD=400 CLAVE_CARGA=... DATABASE_URL=... node apps/api/test/carga/usuarios-carga.mjs
//   2. En el API de staging, mientras dura la prueba: LIMITE_INGRESOS_IP_MIN=1000
//      (los 400 usuarios ingresan desde la misma máquina de prueba; el límite normal es 60 por minuto por IP).
//   3. k6 run -e API=https://staging.../api/v1 -e CLAVE_CARGA=... apps/api/test/carga/k6-400-usuarios.js
//
// Variables: API, CLAVE_CARGA (obligatoria), USUARIOS (400), VUS (400), SUBIDA (3m), DURACION (10m), PAUSA_MIN/PAUSA_MAX (2 / 5 s).
import http from 'k6/http';
import exec from 'k6/execution';
import { check, sleep } from 'k6';

const API = (__ENV.API || 'http://localhost:3000/api/v1').replace(/\/$/, '');
const CLAVE = __ENV.CLAVE_CARGA;
const USUARIOS = Number(__ENV.USUARIOS || 400);
const VUS = Number(__ENV.VUS || 400);
const PAUSA_MIN = Number(__ENV.PAUSA_MIN || 2);
const PAUSA_MAX = Number(__ENV.PAUSA_MAX || 5);
const JSON_H = { 'content-type': 'application/json' };

export const options = {
  scenarios: {
    hora_pico: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: __ENV.SUBIDA || '3m', target: VUS },
        { duration: __ENV.DURACION || '10m', target: VUS },
        { duration: '1m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    // Pantallas: p95 < 1 s y casi sin errores
    'http_req_duration{tipo:pantalla}': ['p(95)<1000'],
    'http_req_failed{tipo:pantalla}': ['rate<0.01'],
    // Descargas (certificados y manifiestos en PDF): sin errores
    'http_req_failed{tipo:descarga}': ['rate<0.001'],
    'checks{tipo:descarga}': ['rate>0.999'],
  },
};

export function setup() {
  if (!CLAVE) throw new Error('Defina CLAVE_CARGA (la contraseña de los usuarios creados con usuarios-carga.mjs).');
  const r = http.get(`${API}/salud`);
  if (r.status !== 200) throw new Error(`El API no responde en ${API} (estado ${r.status}).`);
}

// Estado de cada usuario virtual (cada uno tiene su propia sesión, como una persona en su navegador)
let sesion = null;
const correo = () => `carga${String(((exec.vu.idInTest - 1) % USUARIOS) + 1).padStart(3, '0')}@pruebas.terry-go.invalid`;
const guardar = (s) => { sesion = { accessToken: s.accessToken, refreshToken: s.refreshToken, vence: Date.now() + (s.expiraEnSeg - 60) * 1000 }; };

function ingresar() {
  const r = http.post(`${API}/auth/login`, JSON.stringify({ email: correo(), clave: CLAVE }), { headers: JSON_H, tags: { tipo: 'ingreso', name: 'ingreso' } });
  if (!check(r, { 'ingreso aceptado': (x) => x.status === 200 }, { tipo: 'ingreso' })) { sleep(10); return false; }
  let s = r.json();
  if (s.usuario.requiereAceptarDatos) { // primer ingreso: política de datos (Ley 1581)
    const a = http.post(`${API}/auth/aceptar-datos`, JSON.stringify({ version: s.usuario.politicaDatos.version }),
      { headers: { ...JSON_H, authorization: `Bearer ${s.accessToken}` }, tags: { tipo: 'ingreso', name: 'aceptar datos' } });
    if (a.status !== 200) return false;
    s = a.json();
  }
  guardar(s);
  return true;
}

function renovar() {
  const r = http.post(`${API}/auth/renovar`, JSON.stringify({ refreshToken: sesion.refreshToken }), { headers: JSON_H, tags: { tipo: 'ingreso', name: 'renovar' } });
  if (r.status !== 200) { sesion = null; return false; }
  guardar(r.json());
  return true;
}

function pedir(ruta, tipo, nombre) {
  const r = http.get(`${API}${ruta}`, { headers: { authorization: `Bearer ${sesion.accessToken}` }, tags: { tipo, name: nombre }, responseType: tipo === 'descarga' ? 'binary' : 'text' });
  check(r, { [`${nombre}: 200`]: (x) => x.status === 200 }, { tipo });
  return r;
}
const filas = (r) => { try { return r.json('filas') || []; } catch (e) { return []; } };
const azar = (xs) => xs[Math.floor(Math.random() * xs.length)];

const esPdf = (body) => !!body && body.byteLength > 4 && String.fromCharCode(...new Uint8Array(body, 0, 4)) === '%PDF';
function descargar(ruta, nombre) {
  const r = pedir(ruta, 'descarga', nombre);
  check(r, { [`${nombre}: es un PDF`]: (x) => x.status === 200 && esPdf(x.body) }, { tipo: 'descarga' });
}

// Una «visita» a una pantalla, con el peso que tiene en un fin de mes (lo más pedido: certificados).
const VISITAS = [
  [30, () => { // certificados: lista y descarga de uno
    const actas = filas(pedir('/actas?pagina=1&porPagina=50&estado=EMITIDA', 'pantalla', 'certificados'));
    if (actas.length) descargar(`/actas/${azar(actas).id}/pdf`, 'certificado PDF');
  }],
  [15, () => { // manifiestos: lista y, a veces, el PDF de uno
    const mfs = filas(pedir('/manifiestos?pagina=1&porPagina=50', 'pantalla', 'manifiestos'));
    if (mfs.length && Math.random() < 0.3) descargar(`/manifiestos/${azar(mfs).id}/pdf`, 'manifiesto PDF');
  }],
  [15, () => pedir('/solicitudes?pagina=1&porPagina=50', 'pantalla', 'solicitudes')],
  [10, () => pedir('/conciliaciones?pagina=1&porPagina=50', 'pantalla', 'conciliaciones')],
  [10, () => pedir('/declaraciones?tipo=RESIDUO&pagina=1&porPagina=50', 'pantalla', 'declaraciones')],
  [10, () => pedir(`/clientes?porPagina=20&q=${azar(['sas', 'hosp', 'taller', 'clin', 'ind', '800', '9001', 'trans'])}`, 'pantalla', 'buscar cliente')],
  [10, () => pedir('/conciliaciones/consolidado', 'pantalla', 'consolidado')],
];
const PESO_TOTAL = VISITAS.reduce((s, [p]) => s + p, 0);

export default function () {
  if (!sesion && !ingresar()) return;
  if (Date.now() > sesion.vence && !renovar() && !ingresar()) return;

  let x = Math.random() * PESO_TOTAL;
  for (const [peso, visita] of VISITAS) { if ((x -= peso) < 0) { visita(); break; } }
  if (Math.random() < 0.3) pedir('/alertas', 'pantalla', 'alertas'); // la campana consulta las alertas cada tanto

  sleep(PAUSA_MIN + Math.random() * (PAUSA_MAX - PAUSA_MIN)); // tiempo que la persona mira la pantalla
}
