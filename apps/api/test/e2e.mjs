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
