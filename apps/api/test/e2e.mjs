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
async function excelBuf(id, filas) {
  const p = plantilla(id);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await construirPlantilla(p));
  const ws = wb.getWorksheet('Plantilla');
  filas.forEach((f, i) => { ws.getRow(3 + i).values = p.columnas.map((c) => f[c.key] ?? ''); });
  return wb.xlsx.writeBuffer();
}
const formDe = (buf, nombre) => { const form = new FormData(); form.append('archivo', new Blob([buf]), nombre); return form; };
const excel = async (id, filas) => formDe(await excelBuf(id, filas), `${id}.xlsx`);

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
r = await llamar('POST', '/importacion/sucursales/confirmar', { token: T, form: await excel('sucursales', [
  { nit: NIT, nombre: 'Planta extractora', codigo: 'C001', principal: 'Sí', direccion: 'Km 4', municipio: 'Puerto Wilches', depto: 'Santander', zona: 'Magdalena Medio', contacto: 'Laura' },
  { nit: NIT, nombre: 'Bodega Sabana', codigo: 'C002', direccion: 'Calle 10', municipio: 'Sabana de Torres', depto: 'Santander' },
]) });
prueba('confirmar sedes con código y sede principal', r.status === 201 && r.json.creadas + r.json.actualizadas === 2, JSON.stringify(r.json));
const sedeImportada = await db.sucursal.findFirst({ where: { codigo: 'C002', cliente: { nit: NIT } } });
prueba('la sede queda con su municipio DIVIPOLA', sedeImportada?.municipioDane === '68655');
// Fila base de una declaración de residuo peligroso (columnas con códigos de catálogo)
const filaResiduo = (x) => ({ nit: NIT, sedes: 'C001', categoria: 'RESPEL', tipoResiduo: 'IND', linea: '01', peligroso: 'Sí', proceso: 'Limpieza de trampa de grasas',
  composicion: 'Agua 60 %, grasas 30 %, sólidos 10 %', embalaje: 'CANECA', presentacion: '55 gal', material: 'MET', estadoFisico: 'Semisólido / lodo', inflamable: 'No', estupefacientes: 'No',
  riesgos: 'T', etiquetado: 'ONU;SGA', fds: 'https://docs.terravivasas.com/fds/demo.pdf', responsabilidad: 'Sí', ...x });
const libroDecl = await excelBuf('decl-residuos', [
  filaResiduo({ codigo: 'RP-018', residuo: 'Lodos aceitosos', corrienteY: 'Y18', disposiciones: 'BIO', frecuenciaDias: '30', cantidad: '8000', metrica: 'kg', precio: '780' }),
  filaResiduo({ codigo: 'AR-IND', residuo: 'Agua residual industrial', sedes: 'C001;C002', corrienteY: 'Y9', estadoFisico: 'Líquido', disposiciones: 'ASP', metrica: 'm3', precio: '165000' }),
  filaResiduo({ codigo: 'RP-009', residuo: 'X', sedes: 'Sede que no existe', corrienteY: 'Y9', disposiciones: 'BIO', precio: '100' }),
  filaResiduo({ codigo: 'RP-010', residuo: 'Y', corrienteY: 'Y9', embalaje: 'BARRIL', disposiciones: 'BIO', precio: '100' }),
]);
r = await llamar('POST', '/importacion/decl-residuos/confirmar', { token: T, form: formDe(libroDecl, 'decl.xlsx') });
prueba('declaraciones: 2 guardadas; rechazadas la de sede inexistente y la de código de catálogo inexistente', r.status === 201 && r.json.creadas === 2 && r.json.rechazadas === 2
  && JSON.stringify(r.json.filasRechazadas).includes('BARRIL'), JSON.stringify(r.json).slice(0, 400));
const lote = await db.cargueMasivo.findUnique({ where: { id: r.json.cargueId }, include: { _count: { select: { declaraciones: true } } } });
const tarifaLodo = await db.tarifa.findFirst({ where: { declaracion: { codigoInterno: 'RP-018' } }, orderBy: { vigenteDesde: 'asc' } });
prueba('la tarifa rige desde HOY en Colombia (no la fecha UTC, que de noche ya es mañana)',
  tarifaLodo?.vigenteDesde.toISOString().slice(0, 10) === new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }), tarifaLodo?.vigenteDesde.toISOString());
prueba('el lote queda en cargues_masivos con hash del archivo y sus declaraciones', lote?.estado === 'CONFIRMADO' && lote.archivoHash?.length === 64 && lote._count.declaraciones === 2 && lote.tipoCargue === 'DECLARACIONES');
r = await llamar('POST', '/importacion/decl-residuos/vista-previa', { token: T, form: formDe(libroDecl, 'decl.xlsx') });
prueba('subir otra vez el mismo archivo avisa y rechaza los códigos internos ya usados', r.status === 201 && r.json.avisos.length === 1 && r.json.resumen.validas === 0, JSON.stringify(r.json).slice(0, 300));
r = await llamar('GET', '/importacion/historial', { token: T });
prueba('el historial registra los cargues', r.status === 200 && r.json.length >= 3);
r = await llamar('POST', '/importacion/clientes/confirmar', { token: T, form: (() => { const f = new FormData(); f.append('archivo', new Blob(['hola']), 'malo.csv'); return f; })() });
prueba('archivo que no es .xlsx → 400', r.status === 400);

console.log('\n3. Declaraciones y permisos ambientales');
r = await llamar('GET', `/declaraciones?estado=PENDIENTE`, { token: T });
const lodo = r.json.filas.find((d) => d.codigoInterno === 'RP-018');
const agua = r.json.filas.find((d) => d.codigoInterno === 'AR-IND');
prueba('listado trae las declaraciones con sedes, disposición y tarifa vigente', lodo && agua && Number(lodo.tarifaVigente?.precioUnitario) === 780
  && agua.sucursales.length === 2 && lodo.disposiciones[0]?.disposicion.codigo === 'BIO' && lodo.lineaServicio.unidadNegocio.sigla === 'TTR', JSON.stringify(lodo ?? r.json).slice(0, 300));
r = await llamar('PATCH', `/declaraciones/${lodo.id}/estado`, { token: T, cuerpo: { estado: 'AUTORIZADA' } });
prueba('autorizar biorremediación (cubierta por Res. 0632-2023) la deja activa', r.status === 200 && r.json.estado === 'AUTORIZADA' && r.json.activa === true, JSON.stringify(r.json));
await db.permisoAmbiental.updateMany({ where: { acto: 'Resolución 0632-2023' }, data: { estado: 'VENCIDO' } });
r = await llamar('PATCH', `/declaraciones/${agua.id}/estado`, { token: T, cuerpo: { estado: 'AUTORIZADA' } });
prueba('con el permiso vencido, NO deja autorizar el tratamiento a suelo (API)', r.status === 403 && /permiso/.test(r.json.mensaje), JSON.stringify(r.json));
let bloqueada = false;
try { await db.declaracion.update({ where: { id: agua.id }, data: { estado: 'AUTORIZADA', activa: true } }); } catch (e) { bloqueada = /ningún permiso/.test(String(e)); }
prueba('…ni escribiendo directo en la base: la regla del trigger la rechaza', bloqueada);
await db.permisoAmbiental.updateMany({ where: { acto: 'Resolución 0632-2023' }, data: { estado: 'VIGENTE' } });

// Formulario de 8 secciones (POST /declaraciones)
const cat = (await llamar('GET', '/declaraciones/catalogos', { token: T })).json;
const idDe = (lista, codigo) => lista.find((x) => x.codigo === codigo)?.id;
prueba('catálogos del formulario', cat.lineas?.length === 15 && cat.disposiciones?.length === 15 && cat.metricasDensidad?.length === 5);
const cliente = await db.cliente.findFirst({ where: { nit: NIT } });
const formulario = {
  tipo: 'RESIDUO', clienteId: cliente.id, alcanceSedes: 'TODAS', nombre: 'Aceite usado de motor', codigoInterno: 'AU-01',
  categoriaId: idDe(cat.categorias, 'RESPEL'), tipoResiduoId: idDe(cat.tiposResiduo, 'IND'), lineaServicioId: idDe(cat.lineas, '01'), esPeligroso: true,
  codigoYId: idDe(cat.corrientesY, 'Y8'), codigoUn: 'UN1202', riesgoIds: [idDe(cat.riesgos, 'T'), idDe(cat.riesgos, 'I')], etiquetadoIds: [idDe(cat.etiquetado, 'ONU')],
  descripcionProceso: 'Cambio de aceite de la flota', composicion: 'Aceite mineral con trazas metálicas',
  tipoEmbalajeId: idDe(cat.tiposEmbalaje, 'CANECA'), materialEmbalajeId: idDe(cat.materiales, 'MET'), estadoFisico: 'LIQUIDO', inflamable: true, controladaEstupefacientes: false,
  densidad: 0.88, metricaDensidadId: idDe(cat.metricasDensidad, 'g/mL'),
  disposiciones: [{ disposicionId: idDe(cat.disposiciones, 'APR') }], precio: { precioUnitario: 500, metricaId: idDe(cat.metricasPrecio, 'gal') },
  responsabilidadAceptada: true,
};
r = await llamar('POST', '/declaraciones', { token: T, cuerpo: { ...formulario, responsabilidadAceptada: false } });
prueba('enviar sin aceptar la responsabilidad → 400', r.status === 400 && JSON.stringify(r.json).includes('responsabilidad'), JSON.stringify(r.json).slice(0, 200));
r = await llamar('POST', '/declaraciones', { token: T, cuerpo: { tipo: 'RESIDUO', borrador: true, clienteId: cliente.id, nombre: 'Borrador a medias', categoriaId: formulario.categoriaId, lineaServicioId: formulario.lineaServicioId } });
prueba('el borrador se guarda a medias', r.status === 201 && r.json.estado === 'BORRADOR', JSON.stringify(r.json).slice(0, 200));
r = await llamar('POST', '/declaraciones', { token: T, cuerpo: formulario });
prueba('el formulario completo crea la declaración PENDIENTE con todas las sedes', r.status === 201 && r.json.estado === 'PENDIENTE', JSON.stringify(r.json).slice(0, 300));
const aceite = r.json;
prueba('…alcance TODAS asigna las 2 sedes del cliente', (await db.declaracionSucursal.count({ where: { declaracionId: aceite.id } })) === 2);
r = await llamar('PATCH', `/declaraciones/${aceite.id}/estado`, { token: T, cuerpo: { estado: 'AUTORIZADA' } });
prueba('peligroso sin ficha de datos de seguridad NO se autoriza → 400', r.status === 400 && /ficha de datos de seguridad/.test(r.json.mensaje), JSON.stringify(r.json));
await db.declaracion.update({ where: { id: aceite.id }, data: { fichaSeguridadUrl: 'https://docs.terravivasas.com/fds/aceite.pdf' } });
r = await llamar('PATCH', `/declaraciones/${aceite.id}/estado`, { token: T, cuerpo: { estado: 'AUTORIZADA' } });
prueba('con la FDS se autoriza (aprovechamiento: objeto social)', r.status === 200 && r.json.estado === 'AUTORIZADA', JSON.stringify(r.json));
r = await llamar('POST', `/clientes/${cliente.id}/sucursales`, { token: T, cuerpo: { nombre: 'Sede nueva', codigo: 'C003', municipioDane: '68001' } });
prueba('una sede nueva se suma sola a las declaraciones con alcance TODAS', r.status === 201 && (await db.declaracionSucursal.count({ where: { declaracionId: aceite.id } })) === 3, JSON.stringify(r.json));
r = await llamar('POST', `/clientes/${cliente.id}/sucursales`, { token: T, cuerpo: { nombre: 'Sede rara', municipioDane: '99999' } });
prueba('municipio que no está en DIVIPOLA → 400', r.status === 400);
r = await llamar('POST', '/declaraciones', { token: T, cuerpo: { ...formulario, codigoInterno: 'AU-02', fichaSeguridadUrl: 'https://docs.terravivasas.com/fds/aceite.pdf', disposiciones: [{ disposicionId: idDe(cat.disposiciones, 'INCH') }] } });
const incineracion = r.json;
r = await llamar('PATCH', `/declaraciones/${incineracion.id}/estado`, { token: T, cuerpo: { estado: 'AUTORIZADA' } });
prueba('incineración con gestor aliado sin licencia vigente NO se autoriza', r.status === 403 && /licencia/.test(JSON.stringify(r.json)), JSON.stringify(r.json).slice(0, 300));
r = await llamar('PATCH', `/declaraciones/${aceite.id}/activa`, { token: T, cuerpo: { activa: false } });
prueba('inactivar exige causal → 400', r.status === 400);
r = await llamar('POST', '/declaraciones/tarifas/masivas', { token: T, cuerpo: { declaraciones: [lodo.id], modo: 'porcentaje', valor: 5, vigenteDesde: '2027-01-01' } });
prueba('tarifa masiva +5 % crea nueva vigencia', r.status === 201 && r.json.actualizadas === 1);
const tarifas = await db.tarifa.findMany({ where: { declaracionId: lodo.id }, orderBy: { vigenteDesde: 'asc' } });
prueba('el precio anterior se conserva con fecha de cierre', tarifas.length === 2 && tarifas[0].vigenteHasta && Number(tarifas[1].precioUnitario) === 820);

console.log('\n4. Solicitudes, rutas y preoperacional');
const suc = await db.sucursal.findFirst({ where: { nombre: 'Planta extractora', cliente: { nit: NIT } } });
r = await llamar('POST', '/solicitudes', { token: T, cuerpo: { aprobacion: 'APROBADA', clienteId: suc.clienteId, sucursalId: suc.id, fechaSolicitada: '2026-11-20', items: [{ declaracionId: agua.id, cantidadEstimada: 10 }] } });
prueba('solicitud con declaración NO autorizada → 409 (regla en la base de datos)', r.status === 409 && /autorizada/.test(r.json.mensaje), JSON.stringify(r.json));
r = await llamar('POST', '/solicitudes', { token: T, cuerpo: { aprobacion: 'APROBADA', clienteId: suc.clienteId, sucursalId: suc.id, fechaSolicitada: '2026-11-20', items: [{ declaracionId: lodo.id, cantidadEstimada: 2000 }] } });
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
const sol2 = (await llamar('POST', '/solicitudes', { token: T, cuerpo: { aprobacion: 'APROBADA', clienteId: suc.clienteId, sucursalId: suc.id, fechaSolicitada: '2026-11-21', items: [{ declaracionId: lodo.id, cantidadEstimada: 100 }] } })).json;
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

console.log('\n8. Núcleo operativo: de la solicitud al certificado');
// La sección 7 cerró las sesiones del administrador: se entra de nuevo. El ingreso tiene límite de
// 10 intentos por minuto (protección real del API): si ya se gastó, se espera a que se libere.
let T8;
for (let intento = 0; intento < 20 && !T8; intento++) {
  const x = await llamar('POST', '/auth/login', { cuerpo: { email: ADMIN.email, clave: ADMIN.clave } });
  if (x.status === 200) T8 = x.json.accessToken; else await new Promise((ok) => setTimeout(ok, 5000));
}
prueba('el límite de intentos de ingreso se libera después de un minuto', !!T8);
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const archivoForm = (bytes, nombre, campos = {}) => { const f = new FormData(); f.append('archivo', new Blob([bytes]), nombre); Object.entries(campos).forEach(([k, v]) => f.append(k, v)); return f; };
const descargar = async (ruta, token) => { const x = await fetch(API + ruta, { headers: { authorization: `Bearer ${token}` } }); return { status: x.status, tipo: x.headers.get('content-type'), buf: Buffer.from(await x.arrayBuffer()) }; };
const ops = (await llamar('GET', '/catalogos/operacion', { token: T8 })).json;
prueba('catálogo operativo: ARL, EPS, especificaciones, causales y destinos', ops.arl?.length >= 5 && ops.eps?.length >= 5 && ops.especificaciones?.length >= 1 && ops.destinos?.some((d) => d.esPropio));
r = await llamar('GET', '/personal', { token: T8 });
prueba('lista de conductores y auxiliares para programar (sin correos ni documentos)', r.status === 200 && r.json.some((u) => u.nombre === 'Conductor E2E' && u.esConductor) && !JSON.stringify(r.json).includes('@'), JSON.stringify(r.json).slice(0, 200));
r = await llamar('GET', '/zonas', { token: T8 });
prueba('lista de zonas con su color', r.status === 200 && r.json.length >= 1 && /^#[0-9A-Fa-f]{6}$/.test(r.json[0].color));

r = await llamar('POST', '/solicitudes', { token: T8, cuerpo: { aprobacion: 'APROBADA', clienteId: suc.clienteId, sucursalId: suc.id, fechaSolicitada: '2026-11-25', items: [{ declaracionId: lodo.id, cantidadEstimada: 500, jornada: 'AM' }] } });
const solB = r.json;
r = await llamar('GET', '/programacion/pendientes', { token: T8 });
prueba('la solicitud aprobada aparece en «pendientes por programar» con su contador', r.status === 200 && r.json.some((s) => s.id === solB.id && s.pendientes === 1), JSON.stringify(r.json).slice(0, 200));
r = await llamar('POST', '/rutas', { token: T8, cuerpo: { fechaProgramada: '2026-11-25', horaProgramada: '07:30', solicitudes: [solB.id] } });
prueba('programar una ruta sin vehículo ni conductor («sin recursos»), con código automático y hora', r.status === 201 && /^R-20261125-\d{2}$/.test(r.json.codigo) && r.json.horaProgramada?.slice(11, 16) === '07:30', JSON.stringify(r.json));
const rutaB = r.json;
r = await llamar('POST', '/rutas', { token: T8, cuerpo: { codigo: rutaB.codigo, fechaProgramada: '2026-11-25', solicitudes: [solB.id] } });
prueba('un código de ruta repetido se explica', r.status === 400 && /Ya existe una ruta/.test(r.json.mensaje), JSON.stringify(r.json));
r = await llamar('PATCH', `/rutas/${rutaB.id}/estado`, { token: T8, cuerpo: { estadoRecorridoId: enCamino.id } });
prueba('…no sale sin vehículo y conductor → 409', r.status === 409 && /vehículo y conductor/.test(r.json.mensaje), JSON.stringify(r.json));
r = await llamar('PATCH', `/rutas/${rutaB.id}`, { token: T8, cuerpo: { vehiculoId: veh.id, conductorId: yo.id, valorFlete: 350000, horaProgramada: '07:30' } });
prueba('asignar vehículo, conductor y flete', r.status === 200, JSON.stringify(r.json));
await llamar('POST', '/preoperacionales', { token: T8, cuerpo: { vehiculoId: veh.id, rutaId: rutaB.id, fechaProgramada: '2026-11-25', km: 184600, respuestas: elementos.json.map((e) => ({ elementoId: e.id, resultado: 'OK' })) } });
r = await llamar('PATCH', `/rutas/${rutaB.id}/estado`, { token: T8, cuerpo: { estadoRecorridoId: enCamino.id, kmInicial: 184600 } });
prueba('con recursos e inspección aprobada la ruta sale', r.status === 200, JSON.stringify(r.json));
r = await llamar('POST', `/rutas/${rutaB.id}/rastreo`, { token: T8, cuerpo: { puntos: [
  { latitud: 7.3466, longitud: -73.8986, registradoEn: new Date().toISOString() },
  { latitud: 7.3, longitud: -73.9, registradoEn: new Date(Date.now() - 3600e3).toISOString() },
] } });
prueba('GPS en lote: guarda el punto de la etapa con rastreo y rechaza el de antes de salir', r.status === 201 && r.json.guardados === 1 && r.json.rechazados.length === 1, JSON.stringify(r.json));

r = await llamar('POST', '/manifiestos/desde-ruta', { token: T8, cuerpo: { rutaId: rutaB.id } });
prueba('manifiesto de cargue desde la ruta, con consecutivo', r.status === 201 && r.json.length === 1 && /^MF-\d{4}-\d{5}$/.test(r.json[0].numero), JSON.stringify(r.json).slice(0, 200));
const mfB = r.json[0];
r = await llamar('GET', `/manifiestos/${mfB.id}`, { token: T8 });
prueba('la línea trae precio de la tarifa, disposición principal y métrica', r.status === 200 && r.json.items.length === 1 && Number(r.json.items[0].precioUnitario) === 780 && r.json.items[0].disposicion?.codigo === 'BIO' && r.json.items[0].metrica?.abreviacion === 'kg', JSON.stringify(r.json.items?.[0]).slice(0, 300));
r = await llamar('PATCH', `/manifiestos/${mfB.id}/items/${r.json.items[0].id}`, { token: T8, cuerpo: { embalajes: 4 } });
prueba('en campo se corrige la línea (embalajes)', r.status === 200 && r.json.embalajes === 4, JSON.stringify(r.json));
r = await llamar('GET', `/preoperacionales?vehiculoId=${veh.id}&fecha=2026-11-25`, { token: T8 });
prueba('la app consulta la inspección del día del vehículo', r.status === 200 && r.json.some((p) => p.aprobado && /^INS-\d{4}-\d{5}$/.test(p.numero)), JSON.stringify(r.json).slice(0, 200));
for (const n of [1, 2]) r = await llamar('POST', `/manifiestos/${mfB.id}/evidencias`, { token: T8, form: archivoForm(Buffer.from(PNG, 'base64'), `foto${n}.png`, { tipo: 'FOTO' }) });
prueba('dos fotos de evidencia', r.status === 201);
r = await llamar('POST', `/manifiestos/${mfB.id}/evidencias`, { token: T8, form: archivoForm(Buffer.from(PNG, 'base64'), 'foto3.png', { tipo: 'FOTO' }) });
prueba('una tercera foto → 400', r.status === 400);
r = await llamar('POST', `/manifiestos/${mfB.id}/evidencias`, { token: T8, form: archivoForm(Buffer.from('MZ ejecutable disfrazado'), 'virus.pdf', { tipo: 'PDF' }) });
prueba('un archivo que no es PDF aunque se llame .pdf → 400', r.status === 400);
const firma = { firma: `data:image/png;base64,${PNG}`, firmaNombre: 'Conductor E2E', firmaDocumento: '1098765432' };
r = await llamar('POST', `/manifiestos/${mfB.id}/grabar`, { token: T8, cuerpo: { ...firma, horaLlegada: '2026-11-25T10:00:00-05:00', horaSalida: '2026-11-25T09:00:00-05:00' } });
prueba('grabar con la salida antes que la llegada → 409 con mensaje claro', r.status === 409 && /hora de salida/.test(r.json.mensaje), JSON.stringify(r.json));
r = await llamar('POST', `/manifiestos/${mfB.id}/grabar`, { token: T8, cuerpo: { ...firma, horaLlegada: '2026-11-25T09:00:00-05:00', horaSalida: '2026-11-25T09:40:00-05:00', pesoEntrada: 9000, pesoSalida: 8500 } });
prueba('grabar: queda REALIZADO, con peso neto calculado y conciliación en borrador', r.status === 201 && r.json.estado === 'REALIZADO' && Number(r.json.pesoNeto) === 500 && r.json.conciliacion?.estado === 'BORRADOR', JSON.stringify(r.json).slice(0, 300));
const fFirma = await descargar(`/archivos?clave=${encodeURIComponent(r.json.firmaUrl)}`, T8);
prueba('la firma queda guardada y se descarga', fFirma.status === 200 && fFirma.tipo === 'image/png');
prueba('otra empresa no puede descargar la firma → 403', (await descargar(`/archivos?clave=${encodeURIComponent(r.json.firmaUrl)}`, to)).status === 403);
r = await llamar('GET', `/solicitudes?numero=${solB.numero}`, { token: T8 });
prueba('la solicitud queda RECOLECTADA', r.json.filas?.[0]?.estado === 'RECOLECTADA');

r = await llamar('GET', `/conciliaciones?manifiesto=${mfB.numero}`, { token: T8 });
const concB = r.json.filas?.[0];
prueba('la conciliación aparece en la bandeja con sus totales', concB && concB.totales.porUnidad[0]?.cargado === 500 && concB.totales.bascula.neto === 500, JSON.stringify(r.json).slice(0, 300));
r = await llamar('POST', `/conciliaciones/${concB.id}/aprobar`, { token: T8 });
prueba('aprobar sin cantidades conciliadas → 409', r.status === 409 && /sin cantidad conciliada/.test(r.json.mensaje), JSON.stringify(r.json));
r = await llamar('POST', `/conciliaciones/${concB.id}/igualar`, { token: T8, cuerpo: {} });
prueba('«igualar cantidades» copia lo cargado', r.status === 201 && Number(r.json.items[0].cantidadConciliada) === 500);
const lineaB = r.json.items[0].id;
r = await llamar('PATCH', `/conciliaciones/${concB.id}/items`, { token: T8, cuerpo: { items: [{ id: lineaB, cantidadConciliada: 450 }] } });
prueba('bajar a 450 (−10 %) sin justificar → 409', r.status === 409 && /justificación/.test(r.json.mensaje), JSON.stringify(r.json));
r = await llamar('PATCH', `/conciliaciones/${concB.id}/items`, { token: T8, cuerpo: { items: [{ id: lineaB, cantidadConciliada: 450, justificacion: 'Báscula de planta' }] } });
prueba('con justificación: totales recalculados (450 kg × 780 = 351.000)', r.status === 200 && r.json.totales.cobro === 351000 && r.json.totales.contado + r.json.totales.credito === 351000 && r.json.items[0].diferenciaPct === -10, JSON.stringify(r.json.totales));
r = await llamar('POST', `/conciliaciones/${concB.id}/aprobar`, { token: T8 });
prueba('aprobar la conciliación', r.status === 201 && r.json.estado === 'APROBADA');
r = await llamar('PATCH', `/conciliaciones/${concB.id}/items`, { token: T8, cuerpo: { items: [{ id: lineaB, cantidadConciliada: 460 }] } });
prueba('aprobada: ya no cambian las cantidades → 409', r.status === 409);
r = await llamar('PATCH', `/conciliaciones/${concB.id}/items`, { token: T8, cuerpo: { items: [{ id: lineaB, facturaNumero: 'FE-2026-88', facturaEmision: '2026-11-30', facturaVencimiento: '2026-12-30', estadoPago: 'PENDIENTE' }] } });
prueba('…pero sí la factura (cartera)', r.status === 200 && r.json.items[0].facturaNumero === 'FE-2026-88');
const xls = await descargar(`/conciliaciones/${concB.id}/excel`, T8);
prueba('exportar la conciliación a Excel', xls.status === 200 && xls.buf.subarray(0, 2).toString() === 'PK');
r = await llamar('POST', `/manifiestos/${mfB.id}/anular`, { token: T8, cuerpo: { motivo: 'Prueba' } });
prueba('no se anula un manifiesto con conciliación aprobada → 409', r.status === 409 && /conciliación aprobada/.test(r.json.mensaje), JSON.stringify(r.json));

r = await llamar('GET', `/actas/pendientes?clienteId=${suc.clienteId}`, { token: T8 });
prueba('la línea aprobada queda pendiente de certificar', r.status === 200 && r.json.some((x) => x.id === lineaB));
r = await llamar('POST', '/actas', { token: T8, cuerpo: { clienteId: suc.clienteId, periodoDesde: '2026-11-01', periodoHasta: '2026-11-30' } });
prueba('crear el acta del periodo con las líneas aprobadas', r.status === 201 && /^ACT-\d{4}-\d{5}$/.test(r.json.numero), JSON.stringify(r.json));
const actaB = r.json;
r = await llamar('POST', `/actas/${actaB.id}/emitir`, { token: T8 });
prueba('emitir: copia fija con soporte legal (Res. 0632-2023) y PDF', r.status === 201 && r.json.estado === 'EMITIDA' && r.json.pdfUrl && JSON.stringify(r.json.contenido).includes('0632-2023'), JSON.stringify(r.json).slice(0, 300));
const codigo = r.json.codigoVerificacion;
prueba('el QR lleva a la página pública de verificación', r.json.urlVerificacion?.endsWith(`/#verificar/${codigo}`), r.json.urlVerificacion);
const pdf = await descargar(`/actas/${actaB.id}/pdf`, T8);
prueba('el certificado se descarga en PDF', pdf.status === 200 && pdf.buf.subarray(0, 4).toString() === '%PDF' && pdf.buf.length > 3000);
r = await llamar('GET', `/verificar/${codigo}`);
prueba('verificación pública del QR (sin sesión): auténtico y vigente, sin datos del cliente', r.status === 200 && r.json.valido === true && !JSON.stringify(r.json).includes('Agroindustrial'), JSON.stringify(r.json));
r = await llamar('GET', '/verificar/0123456789abcdef01234567');
prueba('un código que no existe → 404', r.status === 404);
const zip = await descargar(`/actas/zip?ids=${actaB.id}`, T8);
prueba('descarga masiva de actas en ZIP', zip.status === 200 && zip.buf.subarray(0, 2).toString() === 'PK');
r = await llamar('POST', `/actas/${actaB.id}/anular`, { token: T8, cuerpo: { motivo: 'Prueba de anulación' } });
prueba('anular el acta', r.status === 201 && r.json.estado === 'ANULADA');
r = await llamar('GET', `/verificar/${codigo}`);
prueba('…y la verificación pública ahora dice ANULADO', r.status === 200 && r.json.valido === false && /ANULADO/.test(r.json.mensaje));

r = await llamar('POST', '/solicitudes', { token: T8, cuerpo: { operacion: 'DESCARGA', aprobacion: 'APROBADA', clienteId: suc.clienteId, sucursalId: suc.id, fechaSolicitada: '2026-11-26',
  transporte: { empresaTransportadora: 'Transportes del Magdalena', placa: 'XYZ123', conductorNombre: 'Conductor tercero', conductorDocumento: '91234567' }, items: [{ declaracionId: lodo.id, cantidadEstimada: 100 }] } });
const solD = r.json;
r = await llamar('POST', '/manifiestos', { token: T8, cuerpo: { tipo: 'DESCARGUE', clienteId: suc.clienteId, fechaServicio: '2026-11-26', solicitudId: solD.id } });
prueba('manifiesto de descargue desde la solicitud, con el transportador de la solicitud', r.status === 201, JSON.stringify(r.json));
const mfD = r.json;
r = await llamar('POST', `/manifiestos/${mfD.id}/grabar`, { token: T8, cuerpo: { ...firma, horaLlegada: '2026-11-26T08:00:00-05:00', horaSalida: '2026-11-26T08:30:00-05:00', pesoEntrada: 12000, pesoSalida: 11900 } });
prueba('descargue sin ARL ni EPS del conductor → 409', r.status === 409 && /ARL y EPS del conductor/.test(r.json.mensaje), JSON.stringify(r.json));
r = await llamar('PATCH', `/manifiestos/${mfD.id}`, { token: T8, cuerpo: { transporte: { empresaTransportadora: 'Transportes del Magdalena', placa: 'XYZ123', conductorNombre: 'Conductor tercero', conductorDocumento: '91234567', conductorArlId: ops.arl[0].id, conductorEpsId: ops.eps[0].id } } });
r = await llamar('POST', `/manifiestos/${mfD.id}/grabar`, { token: T8, cuerpo: { ...firma, horaLlegada: '2026-11-26T08:00:00-05:00', horaSalida: '2026-11-26T08:30:00-05:00', pesoEntrada: 12000, pesoSalida: 11900 } });
prueba('con ARL y EPS el descargue se graba', r.status === 201 && r.json.estado === 'REALIZADO', JSON.stringify(r.json).slice(0, 200));
r = await llamar('POST', `/manifiestos/${mfD.id}/anular`, { token: T8, cuerpo: { causalId: (await db.catalogoItem.findFirst({ where: { tipo: 'CAUSAL' } })).id } });
const lineaD = await db.solicitudItem.findFirst({ where: { solicitudId: solD.id } });
prueba('anular el descargue: sin conciliación y la línea vuelve a pendiente', r.status === 201 && !(await db.conciliacion.findUnique({ where: { manifiestoId: mfD.id } })) && lineaD.estado === 'PENDIENTE');

// Torre de control (3-D): programación por línea, quitar de la ruta, descartar y actas de aliados
r = await llamar('POST', '/solicitudes', { token: T8, cuerpo: { aprobacion: 'APROBADA', clienteId: suc.clienteId, sucursalId: suc.id, fechaSolicitada: '2026-11-27', items: [{ declaracionId: lodo.id, cantidadEstimada: 200 }, { declaracionId: lodo.id, cantidadEstimada: 300 }] } });
const [l1, l2] = await db.solicitudItem.findMany({ where: { solicitudId: r.json.id }, orderBy: { cantidadEstimada: 'asc' } });
r = await llamar('POST', '/rutas', { token: T8, cuerpo: { fechaProgramada: '2026-11-27', items: [l1.id] } });
prueba('programar una sola línea de la solicitud', r.status === 201 && (await db.solicitudItem.findUnique({ where: { id: l2.id } })).estado === 'PENDIENTE', JSON.stringify(r.json));
const rutaT = r.json;
r = await llamar('POST', `/rutas/${rutaT.id}/items`, { token: T8, cuerpo: { items: [l2.id] } });
prueba('agregar la otra línea a la ruta: misma sede, misma parada', r.status === 201 && r.json.agregadas === 1 && (await db.rutaParada.count({ where: { rutaId: rutaT.id } })) === 1, JSON.stringify(r.json));
const riT = await db.rutaItem.findFirst({ where: { rutaId: rutaT.id, solicitudItemId: l2.id, liberado: false } });
r = await llamar('DELETE', `/rutas/${rutaT.id}/items/${riT.id}`, { token: T8 });
prueba('quitar una línea de la ruta: vuelve a «por programar»', r.status === 200 && (await db.solicitudItem.findUnique({ where: { id: l2.id } })).estado === 'PENDIENTE', JSON.stringify(r.json));
const causalT = await db.catalogoItem.findFirst({ where: { tipo: 'CAUSAL' } });
r = await llamar('PATCH', `/solicitudes/items/${l1.id}/descartar`, { token: T8, cuerpo: { causalId: causalT.id } });
prueba('una línea programada no se descarta (primero se quita de la ruta) → 400', r.status === 400, JSON.stringify(r.json));
r = await llamar('PATCH', `/solicitudes/items/${l2.id}/descartar`, { token: T8, cuerpo: { causalId: causalT.id } });
prueba('descartar una línea pendiente con su causal', r.status === 200 && r.json.estado === 'DESCARTADO', JSON.stringify(r.json));
const aliado = await db.proveedor.create({ data: { empresaId: suc.empresaId ?? (await db.cliente.findUnique({ where: { id: suc.clienteId } })).empresaId, nit: '900555111', razonSocial: 'Gestor aliado E2E', esDestino: true } });
const PDF = Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n');
const camposAliado = { clienteId: suc.clienteId, destinoId: aliado.id, tipo: 'APROVECHAMIENTO', periodoDesde: '2026-11-01', periodoHasta: '2026-11-30' };
r = await llamar('POST', '/actas/cargar', { token: T8, form: archivoForm(Buffer.from('esto no es un PDF'), 'falso.pdf', camposAliado) });
prueba('cargar como acta de aliado un archivo que no es PDF → 400', r.status === 400, JSON.stringify(r.json));
r = await llamar('POST', '/actas/cargar', { token: T8, form: archivoForm(PDF, 'acta-aliado.pdf', camposAliado) });
prueba('cargar el acta de un gestor aliado: queda emitida y descargable', r.status === 201 && r.json.origen === 'CARGADA' && r.json.estado === 'EMITIDA'
  && (await descargar(`/actas/${r.json.id}/pdf`, T8)).buf.subarray(0, 4).toString() === '%PDF', JSON.stringify(r.json).slice(0, 200));

r = await llamar('GET', '/informes/rutas/rendimiento?desde=2026-11-25&hasta=2026-11-25', { token: T8 });
const rend = r.json.rutas?.find((x) => x.rutaId === rutaB.id);
prueba('informe de rendimiento: 1 de 1 servicios ejecutados (100 %)', r.status === 200 && rend?.habilitados === 1 && rend.ejecutados === 1 && rend.cumplimientoRuta === 100, JSON.stringify(r.json).slice(0, 300));
const costos = await descargar('/informes/rutas/costos?desde=2026-11-25&hasta=2026-11-25&formato=xlsx', T8);
prueba('informe de costos de flete en Excel', costos.status === 200 && costos.buf.subarray(0, 2).toString() === 'PK');

const aud = await db.auditoria.count();
prueba(`la auditoría registró los cambios (${aud} eventos)`, aud > 10);

await db.$disconnect();
console.log(`\n${ok} pruebas correctas, ${fallas} fallidas`);
process.exit(fallas ? 1 : 0);
