// Prueba de punta a punta del API contra una base de datos real.
// Requiere el API corriendo (API_URL) y la base sembrada con prisma/seed.mjs.
//   API_URL=http://localhost:3000/api/v1 ADMIN_EMAIL=... ADMIN_PASSWORD=... node test/e2e.mjs
import ExcelJS from 'exceljs';
import { PrismaClient } from '@prisma/client';
import shared from '@terraviva/shared';

const { plantilla, construirPlantilla, dvNit } = shared;
const API = process.env.API_URL ?? 'http://localhost:3000/api/v1';
const ADMIN = { email: process.env.ADMIN_EMAIL ?? 'gerencia@terravivasas.com', clave: process.env.ADMIN_PASSWORD ?? 'TerraViva2026!' };
const db = new PrismaClient();
let ok = 0, fallas = 0;
const prueba = (nombre, cond, extra = '') => { if (cond) { ok++; console.log(`  ✓ ${nombre}`); } else { fallas++; console.log(`  ✗ ${nombre} ${extra}`); } };

async function llamar(metodo, ruta, { token, cuerpo, form } = {}) {
  const r = await fetch(API + ruta, { method: metodo, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cuerpo ? { 'content-type': 'application/json' } : {}) }, body: form ?? (cuerpo ? JSON.stringify(cuerpo) : undefined) });
  const texto = await r.text();
  let json; try { json = JSON.parse(texto); } catch { json = texto; }
  return { status: r.status, json };
}
async function excel(id, filas) {
  const p = plantilla(id);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await construirPlantilla(p));
  const ws = wb.getWorksheet('Plantilla');
  filas.forEach((f, i) => { ws.getRow(3 + i).values = p.columnas.map((c) => f[c.key] ?? ''); });
  const form = new FormData();
  form.append('archivo', new Blob([await wb.xlsx.writeBuffer()]), `${id}.xlsx`);
  return form;
}

console.log('\n1. Salud y autenticación');
let r = await llamar('GET', '/salud');
prueba('salud responde ok con base de datos conectada', r.status === 200 && r.json.baseDeDatos === 'conectada');
r = await llamar('GET', '/declaraciones');
prueba('sin token → 401', r.status === 401);
r = await llamar('POST', '/auth/login', { cuerpo: { email: ADMIN.email, clave: 'incorrecta' } });
prueba('clave incorrecta → 401 con mensaje genérico', r.status === 401 && /incorrectos/.test(r.json.mensaje));
r = await llamar('POST', '/auth/login', { cuerpo: { email: ADMIN.email, clave: ADMIN.clave } });
prueba('login correcto entrega tokens', r.status === 200 && r.json.accessToken && r.json.refreshToken, JSON.stringify(r.json));
let { accessToken: T, refreshToken: R } = r.json;
r = await llamar('GET', '/auth/yo', { token: T });
prueba('/auth/yo devuelve el usuario y la empresa', r.status === 200 && r.json.empresa.nit === '901089780-8');

console.log('\n2. Importación desde Excel');
const NIT = '900112345';
r = await llamar('POST', '/importacion/clientes/vista-previa', { token: T, form: await excel('clientes', [
  { nit: NIT, dv: dvNit(NIT), razon: 'Agroindustrial Prueba S.A.S.', negociacion: 'Cobro', pago: 'Crédito 30 días', email: 'facturas@prueba.com' },
  { nit: '900556677', dv: '0', razon: 'DV malo', negociacion: 'Cobro', pago: 'Contado' },
]) });
prueba('vista previa: 1 válida y 1 con error de DV', r.status === 201 && r.json.resumen.validas === 1 && r.json.resumen.conErrores === 1, JSON.stringify(r.json).slice(0, 300));
r = await llamar('POST', '/importacion/clientes/confirmar', { token: T, form: await excel('clientes', [{ nit: NIT, razon: 'Agroindustrial Prueba S.A.S.', negociacion: 'Cobro', pago: 'Crédito 30 días' }]) });
prueba('confirmar clientes guarda en la base', r.status === 201 && r.json.creadas + r.json.actualizadas === 1, JSON.stringify(r.json));
r = await llamar('POST', '/importacion/sucursales/confirmar', { token: T, form: await excel('sucursales', [{ nit: NIT, nombre: 'Planta extractora', direccion: 'Km 4', municipio: 'Puerto Wilches', depto: 'Santander', zona: 'Magdalena Medio', contacto: 'Laura' }]) });
prueba('confirmar sucursales', r.status === 201, JSON.stringify(r.json));
r = await llamar('POST', '/importacion/decl-residuos/confirmar', { token: T, form: await excel('decl-residuos', [
  { nit: NIT, sucursal: 'Planta extractora', codigo: 'RP-018', residuo: 'Lodos aceitosos', estadoFisico: 'Semisólido / lodo', linea: 'Lodos', manejo: 'Biorremediación (landfarming)', peligroso: 'Sí', corrienteY: 'Y18', unidad: 'kg', cantidad: '8000', precio: '780' },
  { nit: NIT, sucursal: 'Planta extractora', codigo: 'AR-IND', residuo: 'Agua residual industrial', estadoFisico: 'Líquido', linea: 'ARnD', manejo: 'Tratamiento fisicoquímico', peligroso: 'Sí', corrienteY: 'Y9', unidad: 'm³', cantidad: '60', precio: '165000' },
  { nit: NIT, sucursal: 'Sucursal que no existe', codigo: 'RP-009', residuo: 'X', estadoFisico: 'Sólido', linea: 'RESPEL', manejo: 'Biorremediación (landfarming)', peligroso: 'Sí', corrienteY: 'Y9', unidad: 'kg' },
]) });
prueba('declaraciones: 2 guardadas, 1 rechazada por sucursal inexistente', r.status === 201 && r.json.creadas === 2 && r.json.rechazadas === 1, JSON.stringify(r.json).slice(0, 300));
r = await llamar('GET', '/importacion/historial', { token: T });
prueba('el historial registra los cargues', r.status === 200 && r.json.length >= 3);
r = await llamar('POST', '/importacion/clientes/confirmar', { token: T, form: (() => { const f = new FormData(); f.append('archivo', new Blob(['hola']), 'malo.csv'); return f; })() });
prueba('archivo que no es .xlsx → 400', r.status === 400);

console.log('\n3. Declaraciones y permisos ambientales');
r = await llamar('GET', `/declaraciones?estado=PENDIENTE`, { token: T });
const lodo = r.json.filas.find((d) => d.residuo.codigo === 'RP-018');
const agua = r.json.filas.find((d) => d.residuo.codigo === 'AR-IND');
prueba('listado trae las declaraciones con tarifa vigente', lodo && agua && Number(lodo.tarifaVigente?.precioUnitario) === 780);
r = await llamar('PATCH', `/declaraciones/${lodo.id}/estado`, { token: T, cuerpo: { estado: 'AUTORIZADA' } });
prueba('autorizar biorremediación (cubierta por Res. 0632-2023)', r.status === 200 && r.json.estado === 'AUTORIZADA');
await db.permisoAmbiental.updateMany({ where: { acto: 'Resolución 0632-2023' }, data: { estado: 'VENCIDO' } });
r = await llamar('PATCH', `/declaraciones/${agua.id}/estado`, { token: T, cuerpo: { estado: 'AUTORIZADA' } });
prueba('con el permiso vencido, NO deja autorizar el tratamiento fisicoquímico', r.status === 403 && /permiso/.test(r.json.mensaje), JSON.stringify(r.json));
await db.permisoAmbiental.updateMany({ where: { acto: 'Resolución 0632-2023' }, data: { estado: 'VIGENTE' } });
r = await llamar('POST', '/declaraciones/tarifas/masivas', { token: T, cuerpo: { declaraciones: [lodo.id], modo: 'porcentaje', valor: 5, vigenteDesde: '2027-01-01' } });
prueba('tarifa masiva +5 % crea nueva vigencia', r.status === 201 && r.json.actualizadas === 1);
const tarifas = await db.tarifa.findMany({ where: { declaracionId: lodo.id }, orderBy: { vigenteDesde: 'asc' } });
prueba('el precio anterior se conserva con fecha de cierre', tarifas.length === 2 && tarifas[0].vigenteHasta && Number(tarifas[1].precioUnitario) === 820);

console.log('\n4. Solicitudes, rutas y preoperacional');
const suc = await db.sucursal.findFirst({ where: { nombre: 'Planta extractora', cliente: { nit: NIT } } });
r = await llamar('POST', '/solicitudes', { token: T, cuerpo: { clienteId: suc.clienteId, sucursalId: suc.id, fechaSolicitada: '2026-11-20', items: [{ declaracionId: agua.id, cantidadEstimada: 10 }] } });
prueba('solicitud con declaración NO autorizada → 409 (regla en la base de datos)', r.status === 409 && /autorizada/.test(r.json.mensaje), JSON.stringify(r.json));
r = await llamar('POST', '/solicitudes', { token: T, cuerpo: { clienteId: suc.clienteId, sucursalId: suc.id, fechaSolicitada: '2026-11-20', items: [{ declaracionId: lodo.id, cantidadEstimada: 2000 }] } });
prueba('solicitud con declaración autorizada se crea', r.status === 201, JSON.stringify(r.json));
const sol = r.json;
const [veh, conductorRol, estados, elementos] = await Promise.all([db.vehiculo.findUnique({ where: { placa: 'USD855' } }), db.rol.findFirst({ where: { nombre: 'Conductor' } }), llamar('GET', '/estados-recorrido', { token: T }), llamar('GET', '/elementos-chequeo', { token: T })]);
const yo = (await llamar('GET', '/auth/yo', { token: T })).json;
r = await llamar('POST', '/rutas', { token: T, cuerpo: { codigo: `R-E2E-${Date.now() % 100000}`, fechaProgramada: '2026-11-20', vehiculoId: veh.id, conductorId: yo.id, solicitudes: [sol.id] } });
prueba('programar ruta', r.status === 201, JSON.stringify(r.json));
const ruta = r.json;
const enCamino = estados.json.find((e) => e.orden === 2), cancelada = estados.json.find((e) => e.nombre === 'Cancelada');
r = await llamar('PATCH', `/rutas/${ruta.id}/estado`, { token: T, cuerpo: { estadoRecorridoId: enCamino.id } });
prueba('la ruta NO sale sin preoperacional aprobado → 409', r.status === 409 && /preoperacional/.test(r.json.mensaje), JSON.stringify(r.json));
const critico = elementos.json.find((e) => e.critico);
r = await llamar('POST', '/preoperacionales', { token: T, cuerpo: { vehiculoId: veh.id, rutaId: ruta.id, fechaProgramada: '2026-11-20', km: 184500, respuestas: elementos.json.map((e) => ({ elementoId: e.id, resultado: e.id === critico.id ? 'NO_OK' : 'OK' })) } });
prueba('preoperacional con ítem crítico en NO queda no aprobado', r.status === 201 && r.json.aprobado === false && r.json.fallasCriticas.length === 1);
r = await llamar('PATCH', `/rutas/${ruta.id}/estado`, { token: T, cuerpo: { estadoRecorridoId: enCamino.id } });
prueba('…y la ruta sigue bloqueada', r.status === 409);
r = await llamar('POST', '/preoperacionales', { token: T, cuerpo: { vehiculoId: veh.id, rutaId: ruta.id, fechaProgramada: '2026-11-20', km: 184501, respuestas: elementos.json.map((e) => ({ elementoId: e.id, resultado: 'OK' })) } });
prueba('preoperacional completo queda aprobado', r.status === 201 && r.json.aprobado === true);
r = await llamar('PATCH', `/rutas/${ruta.id}/estado`, { token: T, cuerpo: { estadoRecorridoId: enCamino.id, kmInicial: 184501 } });
prueba('con preoperacional aprobado la ruta sale', r.status === 200);
const veh2 = await db.vehiculo.findUnique({ where: { placa: 'DXY545' } });
const sol2 = (await llamar('POST', '/solicitudes', { token: T, cuerpo: { clienteId: suc.clienteId, sucursalId: suc.id, fechaSolicitada: '2026-11-21', items: [{ declaracionId: lodo.id, cantidadEstimada: 100 }] } })).json;
const ruta2 = (await llamar('POST', '/rutas', { token: T, cuerpo: { codigo: `R-E2E-C${Date.now() % 100000}`, fechaProgramada: '2026-11-21', vehiculoId: veh2.id, conductorId: yo.id, solicitudes: [sol2.id] } })).json;
r = await llamar('PATCH', `/rutas/${ruta2.id}/estado`, { token: T, cuerpo: { estadoRecorridoId: cancelada.id } });
prueba('cancelar una ruta sin preoperacional sí se permite', r.status === 200, JSON.stringify(r.json));
r = await llamar('GET', '/alertas', { token: T });
prueba('alertas responde con obligaciones de permisos', r.status === 200 && r.json.some((a) => a.tipo === 'cumplimiento'));

console.log('\n5. Roles y permisos');
const conductor = await db.usuario.upsert({ where: { email: 'conductor.e2e@terravivasas.com' }, update: { intentosFallidos: 0, bloqueadoHasta: null },
  create: { empresaId: yo.empresa ? (await db.empresa.findFirst({ where: { nit: '901089780-8' } })).id : '', rolId: conductorRol.id, nombre: 'Conductor E2E', documento: '1', email: 'conductor.e2e@terravivasas.com', esConductor: true,
    passwordHash: await (await import('@node-rs/argon2')).hash('Conductor2026!', { memoryCost: 19456, timeCost: 2, parallelism: 1 }) } });
const tc = (await llamar('POST', '/auth/login', { cuerpo: { email: conductor.email, clave: 'Conductor2026!' } })).json.accessToken;
r = await llamar('PATCH', `/declaraciones/${agua.id}/estado`, { token: tc, cuerpo: { estado: 'AUTORIZADA' } });
prueba('un conductor NO puede autorizar declaraciones → 403', r.status === 403 && /permiso/.test(r.json.mensaje));
r = await llamar('GET', '/declaraciones', { token: tc });
prueba('…pero sí puede consultar', r.status === 200);

console.log('\n6. Multiempresa (aislamiento de datos)');
const otra = await db.empresa.upsert({ where: { nit: '800000001-1' }, update: {}, create: { nit: '800000001-1', razonSocial: 'Otra Empresa Prueba' } });
const rolOtra = await db.rol.upsert({ where: { empresaId_nombre: { empresaId: otra.id, nombre: 'Administrador' } }, update: {}, create: { empresaId: otra.id, nombre: 'Administrador' } });
const todo = await db.permiso.findUnique({ where: { codigo: '*' } });
await db.rolPermiso.upsert({ where: { rolId_permisoId: { rolId: rolOtra.id, permisoId: todo.id } }, update: {}, create: { rolId: rolOtra.id, permisoId: todo.id } });
await db.usuario.upsert({ where: { email: 'admin@otra.com' }, update: {}, create: { empresaId: otra.id, rolId: rolOtra.id, nombre: 'Admin otra', documento: '2', email: 'admin@otra.com', passwordHash: await (await import('@node-rs/argon2')).hash('OtraClave2026!', { memoryCost: 19456, timeCost: 2, parallelism: 1 }) } });
const to = (await llamar('POST', '/auth/login', { cuerpo: { email: 'admin@otra.com', clave: 'OtraClave2026!' } })).json.accessToken;
r = await llamar('GET', '/declaraciones', { token: to });
prueba('otra empresa no ve las declaraciones de Terra Viva', r.status === 200 && r.json.total === 0);
r = await llamar('GET', `/declaraciones/${lodo.id}`, { token: to });
prueba('…ni por ID directo → 404', r.status === 404);

console.log('\n7. Sesiones');
r = await llamar('POST', '/auth/renovar', { cuerpo: { refreshToken: R } });
prueba('renovar entrega tokens nuevos', r.status === 200 && r.json.refreshToken !== R);
const R2 = r.json.refreshToken, T2 = r.json.accessToken;
r = await llamar('POST', '/auth/renovar', { cuerpo: { refreshToken: R } });
prueba('reutilizar un token viejo → 401 y cierra todas las sesiones', r.status === 401 && /cerraron/.test(r.json.mensaje));
r = await llamar('GET', '/auth/yo', { token: T2 });
prueba('…el token de acceso de esa sesión deja de servir', r.status === 401);
r = await llamar('POST', '/auth/renovar', { cuerpo: { refreshToken: R2 } });
prueba('…y el token de renovación más reciente también', r.status === 401);
for (let i = 0; i < 5; i++) await llamar('POST', '/auth/login', { cuerpo: { email: conductor.email, clave: 'mala' } });
r = await llamar('POST', '/auth/login', { cuerpo: { email: conductor.email, clave: 'Conductor2026!' } });
prueba('5 intentos fallidos bloquean la cuenta 15 minutos → 403', r.status === 403 && /bloqueada/.test(r.json.mensaje));
r = await llamar('POST', '/auth/recuperar', { cuerpo: { email: 'no-existe@x.com' } });
prueba('recuperar responde igual aunque el correo no exista (202)', r.status === 202);

const aud = await db.auditoria.count();
prueba(`la auditoría registró los cambios (${aud} eventos)`, aud > 10);

await db.$disconnect();
console.log(`\n${ok} pruebas correctas, ${fallas} fallidas`);
process.exit(fallas ? 1 : 0);
