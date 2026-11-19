// Prueba de punta a punta del API contra una base de datos real.
// Requiere el API corriendo (API_URL) y la base sembrada con prisma/seed.mjs.
//   API_URL=http://localhost:3000/api/v1 ADMIN_EMAIL=... ADMIN_PASSWORD=... node test/e2e.mjs
import { createHmac, randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { PrismaClient } from '@prisma/client';
import shared from '@terraviva/shared';

const { plantilla, construirPlantilla, dvNit } = shared;
const API = process.env.API_URL ?? 'http://localhost:3000/api/v1';
const ADMIN = { email: process.env.ADMIN_EMAIL ?? 'gerencia@terravivasas.com', clave: process.env.ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD };
if (!ADMIN.clave) { console.error('Defina ADMIN_PASSWORD (o SEED_ADMIN_PASSWORD) con la contraseña del administrador sembrado.'); process.exit(1); }
const db = new PrismaClient();
let ok = 0, fallas = 0;
/** Fecha en Colombia dentro de n días (AAAA-MM-DD): las pruebas de precios no se vencen con el calendario. */
const fechaEn = (dias) => new Date(Date.now() + dias * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
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
/** Primer ingreso: acepta la política de datos personales (Ley 1581) y devuelve la sesión nueva. */
async function aceptarDatos(sesion) {
  if (!sesion?.usuario?.requiereAceptarDatos) return sesion;
  const x = await llamar('POST', '/auth/aceptar-datos', { token: sesion.accessToken, cuerpo: { version: sesion.usuario.politicaDatos.version } });
  return x.json;
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
const primera = r.json;
prueba('primer ingreso: pide aceptar la política de datos personales (Ley 1581)', primera.usuario?.requiereAceptarDatos === true && !!primera.usuario.politicaDatos?.version);
r = await llamar('GET', '/declaraciones', { token: primera.accessToken });
prueba('…sin aceptarla no se usa el sistema → 403', r.status === 403 && r.json.codigo === 'ACEPTAR_DATOS', JSON.stringify(r.json));
r = await llamar('POST', '/auth/aceptar-datos', { token: primera.accessToken, cuerpo: { version: primera.usuario.politicaDatos.version } });
prueba('…al aceptarla queda registrada y entrega una sesión nueva', r.status === 200 && r.json.usuario.requiereAceptarDatos === false && r.json.accessToken !== primera.accessToken, JSON.stringify(r.json).slice(0, 200));
let { accessToken: T, refreshToken: R } = r.json;
r = await llamar('GET', '/auth/yo', { token: T });
prueba('/auth/yo devuelve el usuario y la empresa', r.status === 200 && r.json.empresa.nit === '901089780-8');

console.log('\n2. Importación desde Excel');
const NIT = '900112345';
r = await llamar('POST', '/importacion/clientes/vista-previa', { token: T, form: await excel('clientes', [
  { nit: NIT, dv: dvNit(NIT), razon: 'Agroindustrial Prueba S.A.S.', representante: 'Representante Legal Prueba', negociacion: 'Cobro', pago: 'Crédito 30 días', email: 'facturas@prueba.com' },
  { nit: '900556677', dv: '0', razon: 'DV malo', negociacion: 'Cobro', pago: 'Contado' },
]) });
prueba('vista previa: 1 válida y 1 con error de DV', r.status === 201 && r.json.resumen.validas === 1 && r.json.resumen.conErrores === 1, JSON.stringify(r.json).slice(0, 300));
r = await llamar('POST', '/importacion/clientes/confirmar', { token: T, form: await excel('clientes', [{ nit: NIT, razon: 'Agroindustrial Prueba S.A.S.', representante: 'Representante Legal Prueba', negociacion: 'Cobro', pago: 'Crédito 30 días' }]) });
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
  filaResiduo({ codigo: 'RP-018', residuo: 'Lodos de trampa de grasa', categoria: 'NOPEL', peligroso: 'No', corrienteY: '', riesgos: '', disposiciones: 'BIO', frecuenciaDias: '30', cantidad: '8000', metrica: 'kg', precio: '780' }),
  filaResiduo({ codigo: 'AR-IND', residuo: 'Agua residual no doméstica', categoria: 'NOPEL', peligroso: 'No', sedes: 'C001;C002', corrienteY: '', riesgos: '', estadoFisico: 'Líquido', disposiciones: 'ASP', metrica: 'm3', precio: '165000' }),
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
// Documentos reales (planilla DMR): línea por nombre exacto, subcorriente del IDEAM y número UN en la columna equivocada
const libroDmr = await excelBuf('decl-residuos', [
  filaResiduo({ codigo: 'RP-020', residuo: 'Borras aceitosas', linea: 'operaciones propias de tratamiento y disposicion', corrienteY: 'Y9.1', disposiciones: 'BIO', precio: '900' }),
  filaResiduo({ codigo: 'RP-021', residuo: 'Z', corrienteY: 'UN3082', disposiciones: 'BIO', precio: '100' }),
]);
r = await llamar('POST', '/importacion/decl-residuos/vista-previa', { token: T, form: formDe(libroDmr, 'dmr.xlsx') });
const [fDmr, fUn] = r.json.filas ?? [];
prueba('planilla DMR: acepta la línea por su nombre y la subcorriente Y9.1, avisando', r.status === 201 && !fDmr?.errores.length
  && fDmr.advertencias.some((x) => /tomó como el código 01/.test(x)) && fDmr.advertencias.some((x) => /subcorriente de Y9/.test(x)), JSON.stringify(fDmr));
prueba('…y explica que un número UN no va en la columna de corriente', fUn?.errores.some((x) => /número UN/.test(x)), JSON.stringify(fUn));
r = await llamar('POST', '/importacion/decl-residuos/confirmar', { token: T, form: formDe(libroDmr, 'dmr.xlsx') });
const sub = await db.codigoClasificacion.findUnique({ where: { codigo: 'Y9.1' }, include: { padre: true } });
const borras = await db.declaracion.findFirst({ where: { codigoInterno: 'RP-020' }, include: { codigoY: true, lineaServicio: true } });
prueba('la subcorriente queda registrada colgada de Y9 y la declaración la usa', r.status === 201 && r.json.creadas === 1 && sub?.padre?.codigo === 'Y9'
  && borras?.codigoY?.codigo === 'Y9.1' && borras.lineaServicio.codigo === '01', JSON.stringify(r.json).slice(0, 200));
let rechazoSub = false;
try { await db.codigoClasificacion.create({ data: { tipo: 'A', codigo: 'Y9.2', descripcion: 'x', padreId: sub.padreId } }); } catch (e) { rechazoSub = /mismo tipo/.test(String(e)); }
prueba('la base no deja colgar una subcorriente de otro tipo', rechazoSub);
r = await llamar('POST', '/importacion/clientes/confirmar', { token: T, form: (() => { const f = new FormData(); f.append('archivo', new Blob(['hola']), 'malo.csv'); return f; })() });
prueba('un archivo sin los encabezados de la plantilla no se guarda → 400 con las columnas que faltan', r.status === 400 && /Faltan columnas/.test(r.json.mensaje), JSON.stringify(r.json));

console.log('\n3. Declaraciones y permisos ambientales');
r = await llamar('GET', `/declaraciones?estado=PENDIENTE`, { token: T });
const lodo = r.json.filas.find((d) => d.codigoInterno === 'RP-018');
const agua = r.json.filas.find((d) => d.codigoInterno === 'AR-IND');
prueba('listado trae las declaraciones con sedes, disposición y tarifa vigente', lodo && agua && Number(lodo.tarifaVigente?.precioUnitario) === 780
  && agua.sucursales.length === 2 && lodo.disposiciones[0]?.disposicion.codigo === 'BIO' && lodo.lineaServicio.unidadNegocio.sigla === 'TTR', JSON.stringify(lodo ?? r.json).slice(0, 300));
r = await llamar('PATCH', `/declaraciones/${lodo.id}/estado`, { token: T, cuerpo: { estado: 'AUTORIZADA' } });
prueba('autorizar biorremediación (cubierta por la Res. DGL 000632 de 2023) la deja activa', r.status === 200 && r.json.estado === 'AUTORIZADA' && r.json.activa === true, JSON.stringify(r.json));
await db.permisoAmbiental.updateMany({ where: { acto: 'Resolución DGL No. 000632 de 2023' }, data: { estado: 'VENCIDO' } });
r = await llamar('PATCH', `/declaraciones/${agua.id}/estado`, { token: T, cuerpo: { estado: 'AUTORIZADA' } });
prueba('con el permiso vencido, NO deja autorizar el tratamiento a suelo (API)', r.status === 403 && /permiso/.test(r.json.mensaje), JSON.stringify(r.json));
let bloqueada = false;
try { await db.declaracion.update({ where: { id: agua.id }, data: { estado: 'AUTORIZADA', activa: true } }); } catch (e) { bloqueada = /ningún permiso/.test(String(e)); }
prueba('…ni escribiendo directo en la base: la regla del trigger la rechaza', bloqueada);
await db.permisoAmbiental.updateMany({ where: { acto: 'Resolución DGL No. 000632 de 2023' }, data: { estado: 'VIGENTE' } });
r = await llamar('GET', '/declaraciones/catalogo-servicios', { token: T });
const servTrampas = r.json.find?.((s) => s.codigo === 'SV-TRAMPAS'); const servFumiga = r.json.find?.((s) => s.codigo === 'SV-FUMIGACION');
prueba('catálogo propio con los 10 servicios estándar de la planilla real', r.status === 200 && r.json.length >= 10 && servTrampas && servFumiga, JSON.stringify(r.json).slice(0, 200));
const asignar = { catalogoIds: [servTrampas.id, servFumiga.id], clienteIds: [lodo.cliente.id], alcanceSedes: 'PRINCIPAL', frecuenciaDias: 15, solicitudAutomatica: true, precio: { precioUnitario: 0 }, autorizar: true };
r = await llamar('POST', '/declaraciones/asignacion-masiva', { token: T, cuerpo: asignar });
prueba('asignación masiva: 2 servicios al cliente, autorizados, con precio 0 (facturación por contrato)', r.status === 201 && r.json.creadas === 2 && r.json.autorizadas === 2, JSON.stringify(r.json));
const trampasCliente = await db.declaracion.findFirst({ where: { clienteId: lodo.cliente.id, catalogoId: servTrampas.id }, include: { sucursales: true, tarifas: true } });
prueba('…cada una con la sede principal, frecuencia de 15 días y su tarifa', trampasCliente?.estado === 'AUTORIZADA' && trampasCliente.activa && trampasCliente.sucursales.length === 1
  && trampasCliente.frecuenciaDias === 15 && Number(trampasCliente.tarifas[0]?.precioUnitario) === 0);
r = await llamar('POST', '/declaraciones/asignacion-masiva', { token: T, cuerpo: asignar });
prueba('repetir la asignación no duplica: las omite y dice por qué', r.status === 201 && r.json.creadas === 0 && r.json.omitidas.length === 2 && /ya lo tiene/.test(r.json.omitidas[0].motivo), JSON.stringify(r.json));

// Formulario de 8 secciones (POST /declaraciones)
const cat = (await llamar('GET', '/declaraciones/catalogos', { token: T })).json;
const idDe = (lista, codigo) => lista.find((x) => x.codigo === codigo)?.id;
prueba('catálogos del formulario: solo las disposiciones activas (sin aprovechamiento propio, lavado ni coprocesamiento)', cat.lineas?.length === 15 && cat.disposiciones?.length === 15 && !idDe(cat.disposiciones, 'APR') && cat.metricasDensidad?.length === 5, String(cat.disposiciones?.length));
const cliente = await db.cliente.findFirst({ where: { nit: NIT } });
const formulario = {
  tipo: 'RESIDUO', clienteId: cliente.id, alcanceSedes: 'TODAS', nombre: 'Aceite usado de motor', codigoInterno: 'AU-01',
  categoriaId: idDe(cat.categorias, 'RESPEL'), tipoResiduoId: idDe(cat.tiposResiduo, 'IND'), lineaServicioId: idDe(cat.lineas, '01'), esPeligroso: true,
  codigoYId: idDe(cat.corrientesY, 'Y8'), codigoUn: 'UN1202', riesgoIds: [idDe(cat.riesgos, 'T'), idDe(cat.riesgos, 'I')], etiquetadoIds: [idDe(cat.etiquetado, 'ONU')],
  descripcionProceso: 'Cambio de aceite de la flota', composicion: 'Aceite mineral con trazas metálicas',
  tipoEmbalajeId: idDe(cat.tiposEmbalaje, 'CANECA'), materialEmbalajeId: idDe(cat.materiales, 'MET'), estadoFisico: 'LIQUIDO', inflamable: true, controladaEstupefacientes: false,
  densidad: 0.88, metricaDensidadId: idDe(cat.metricasDensidad, 'g/mL'),
  disposiciones: [{ disposicionId: idDe(cat.disposiciones, 'DF') }], precio: { precioUnitario: 500, metricaId: idDe(cat.metricasPrecio, 'gal') },
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
prueba('con la FDS se autoriza: peligroso a celda de seguridad de un gestor aliado con licencia indefinida (CGS)', r.status === 200 && r.json.estado === 'AUTORIZADA', JSON.stringify(r.json));
r = await llamar('POST', `/clientes/${cliente.id}/sucursales`, { token: T, cuerpo: { nombre: 'Sede nueva', codigo: 'C003', municipioDane: '68001' } });
prueba('una sede nueva se suma sola a las declaraciones con alcance TODAS', r.status === 201 && (await db.declaracionSucursal.count({ where: { declaracionId: aceite.id } })) === 3, JSON.stringify(r.json));
r = await llamar('POST', `/clientes/${cliente.id}/sucursales`, { token: T, cuerpo: { nombre: 'Sede rara', municipioDane: '99999' } });
prueba('municipio que no está en DIVIPOLA → 400', r.status === 400);
// Simula que ningún incinerador tiene vigencia registrada (en los datos reales hay varios: Sandesol, BIOGER, EMAS…)
const incineradores = await db.proveedor.findMany({ where: { disposicionesGestionadas: { some: { disposicion: { codigo: 'INCH' } } } }, select: { id: true, licenciaIndefinida: true, licenciaVence: true } });
await db.proveedor.updateMany({ where: { id: { in: incineradores.map((p) => p.id) } }, data: { licenciaIndefinida: false, licenciaVence: null } });
r = await llamar('POST', '/declaraciones', { token: T, cuerpo: { ...formulario, codigoInterno: 'AU-02', fichaSeguridadUrl: 'https://docs.terravivasas.com/fds/aceite.pdf', disposiciones: [{ disposicionId: idDe(cat.disposiciones, 'INCH') }] } });
const incineracion = r.json;
r = await llamar('PATCH', `/declaraciones/${incineracion.id}/estado`, { token: T, cuerpo: { estado: 'AUTORIZADA' } });
prueba('incineración con gestor aliado sin licencia vigente NO se autoriza', r.status === 403 && /licencia/.test(JSON.stringify(r.json)), JSON.stringify(r.json).slice(0, 300));
r = await llamar('PATCH', `/declaraciones/${aceite.id}/activa`, { token: T, cuerpo: { activa: false } });
prueba('inactivar exige causal → 400', r.status === 400);
const desdeProgramado = fechaEn(45);
r = await llamar('POST', '/declaraciones/tarifas/masivas', { token: T, cuerpo: { declaraciones: [lodo.id], modo: 'porcentaje', valor: 5, vigenteDesde: desdeProgramado } });
prueba('tarifa masiva +5 % crea nueva vigencia', r.status === 201 && r.json.actualizadas === 1);
const tarifas = await db.tarifa.findMany({ where: { declaracionId: lodo.id }, orderBy: { vigenteDesde: 'asc' } });
prueba('el precio anterior se conserva con fecha de cierre', tarifas.length === 2 && tarifas[0].vigenteHasta && Number(tarifas[1].precioUnitario) === 820);

// Fase B: editar desde el formulario de 8 secciones (PUT /declaraciones/:id) y cobertura en vivo
r = await llamar('GET', `/declaraciones/cobertura?disposiciones=${idDe(cat.disposiciones, 'ASP')},${idDe(cat.disposiciones, 'INCH')}`, { token: T });
const cobAsp = r.json.detalle?.find((x) => x.codigo === 'ASP'), cobInch = r.json.detalle?.find((x) => x.codigo === 'INCH');
prueba('cobertura en vivo: vertimiento a suelo cubierto por la Res. 000632; incineración sin licencia del aliado no', r.status === 200 && cobAsp?.cubierta && /000632/.test(cobAsp.soporte) && cobInch && !cobInch.cubierta && !r.json.cubierto, JSON.stringify(r.json).slice(0, 300));

// Respuestas de la gerencia (19-11-2026): los peligrosos nunca en Los Pinos, hidrocarburos y exclusiones de los aliados
r = await llamar('PATCH', `/declaraciones/${borras.id}/estado`, { token: T, cuerpo: { estado: 'AUTORIZADA' } });
prueba('un residuo peligroso con biorremediación en Los Pinos NO se autoriza (Res. 000632, art. 6)', r.status === 403 && /sin características de peligrosidad/.test(r.json.mensaje), JSON.stringify(r.json).slice(0, 300));
let bloqueoBase = false;
try { await db.declaracion.update({ where: { id: borras.id }, data: { estado: 'AUTORIZADA', activa: true, aprobadaEn: new Date() } }); } catch (e) { bloqueoBase = /sin características de peligrosidad/.test(String(e)); }
prueba('…ni escribiendo directo en la base', bloqueoBase);
r = await llamar('GET', `/declaraciones/cobertura?disposiciones=${idDe(cat.disposiciones, 'ASP')}&peligroso=true`, { token: T });
prueba('cobertura en vivo: un peligroso no va a vertimiento a suelo', r.status === 200 && !r.json.cubierto && /peligrosidad/.test(r.json.detalle?.[0]?.soporte ?? ''), JSON.stringify(r.json).slice(0, 200));
const hosp = idDe(cat.tiposResiduo, 'HOSP');
r = await llamar('GET', `/declaraciones/cobertura?disposiciones=${idDe(cat.disposiciones, 'DF')}&peligroso=true&tipoResiduoId=${hosp}`, { token: T });
prueba('hospitalario a celda de seguridad: lo cubre CGS (Las Bateas no recibe hospitalarios)', r.status === 200 && r.json.cubierto && /Centro de Gestión Sostenible/.test(r.json.detalle[0].soporte) && !/Veolia/.test(r.json.detalle[0].soporte), JSON.stringify(r.json).slice(0, 300));
const cgs = await db.proveedor.findFirst({ where: { nit: '901483038-1' } });
await db.proveedor.updateMany({ where: { disposicionesGestionadas: { some: { disposicion: { codigo: 'DF' } } } }, data: { excluyeTiposResiduo: ['HOSP'] } });
r = await llamar('GET', `/declaraciones/cobertura?disposiciones=${idDe(cat.disposiciones, 'DF')}&peligroso=true&tipoResiduoId=${hosp}`, { token: T });
prueba('…si ningún gestor aliado vigente lo recibe, no queda cubierta', r.status === 200 && !r.json.cubierto && /recibe este tipo/.test(r.json.detalle[0].soporte), JSON.stringify(r.json).slice(0, 200));
await db.proveedor.update({ where: { id: cgs.id }, data: { excluyeTiposResiduo: [] } });
const sinPeligro = { ...formulario, esPeligroso: false, codigoYId: null, codigoUn: null, riesgoIds: [], composicion: null, categoriaId: idDe(cat.categorias, 'NOPEL'),
  fichaSeguridadUrl: null, contieneHidrocarburos: true, disposiciones: [{ disposicionId: idDe(cat.disposiciones, 'BIO') }] };
r = await llamar('POST', '/declaraciones', { token: T, cuerpo: { ...sinPeligro, codigoInterno: 'HC-01', nombre: 'Lodo con hidrocarburos' } });
const lodoHc = r.json;
r = await llamar('PATCH', `/declaraciones/${lodoHc.id}/estado`, { token: T, cuerpo: { estado: 'AUTORIZADA' } });
prueba('lodo con hidrocarburos a biorremediación sin caracterización CRETIB → no se autoriza', r.status === 403 && /caracterización/.test(r.json.mensaje), JSON.stringify(r.json).slice(0, 300));
r = await llamar('PUT', `/declaraciones/${lodoHc.id}`, { token: T, cuerpo: { ...sinPeligro, codigoInterno: 'HC-01', nombre: 'Lodo con hidrocarburos', caracterizacionUrl: 'https://docs.terravivasas.com/cretib/hc-01.pdf' } });
r = await llamar('PATCH', `/declaraciones/${lodoHc.id}/estado`, { token: T, cuerpo: { estado: 'AUTORIZADA' } });
prueba('…con la caracterización CRETIB negativa cargada sí se autoriza', r.status === 200 && r.json.estado === 'AUTORIZADA', JSON.stringify(r.json).slice(0, 300));
r = await llamar('POST', '/declaraciones', { token: T, cuerpo: { ...sinPeligro, codigoInterno: 'HC-02', nombre: 'Escombro con hidrocarburos', caracterizacionUrl: 'https://docs.terravivasas.com/cretib/hc-02.pdf', disposiciones: [{ disposicionId: idDe(cat.disposiciones, 'RCD') }] } });
const rcdHc = r.json;
r = await llamar('PATCH', `/declaraciones/${rcdHc.id}/estado`, { token: T, cuerpo: { estado: 'AUTORIZADA' } });
prueba('los RCD con hidrocarburos no se reciben, aun con caracterización', r.status === 403 && /hidrocarburos/.test(r.json.mensaje), JSON.stringify(r.json).slice(0, 300));
const aMedias = await db.declaracion.findFirst({ where: { nombre: 'Borrador a medias', clienteId: cliente.id } });
const conFds = { ...formulario, fichaSeguridadUrl: 'https://docs.terravivasas.com/fds/aceite.pdf' };
r = await llamar('PUT', `/declaraciones/${aMedias.id}`, { token: T, cuerpo: { ...conFds, nombre: 'Borrador completado', codigoInterno: 'BC-01', borrador: true, responsabilidadAceptada: false } });
prueba('editar un borrador y guardarlo de nuevo como borrador', r.status === 200 && r.json.estado === 'BORRADOR' && r.json.nombre === 'Borrador completado', JSON.stringify(r.json).slice(0, 200));
r = await llamar('PUT', `/declaraciones/${aMedias.id}`, { token: T, cuerpo: { ...conFds, nombre: 'Borrador completado', codigoInterno: 'BC-01' } });
prueba('completar el borrador lo envía a revisión con la responsabilidad registrada', r.status === 200 && r.json.estado === 'PENDIENTE' && r.json.responsabilidadAceptada && r.json.aceptadaEn, JSON.stringify(r.json).slice(0, 200));
r = await llamar('PUT', `/declaraciones/${aMedias.id}`, { token: T, cuerpo: { ...conFds, clienteId: crypto.randomUUID(), codigoInterno: 'BC-01' } });
prueba('no se cambia el cliente de una declaración → 400', r.status === 400 && /cliente/.test(r.json.mensaje), JSON.stringify(r.json));
r = await llamar('PUT', `/declaraciones/${aMedias.id}`, { token: T, cuerpo: { ...conFds, tipo: 'SERVICIO', descripcionServicio: 'x', codigoInterno: 'BC-01' } });
prueba('…ni el tipo (residuo o servicio) → 400', r.status === 400 && /tipo/.test(r.json.mensaje), JSON.stringify(r.json));
r = await llamar('PUT', `/declaraciones/${aceite.id}`, { token: T, cuerpo: { ...conFds, frecuenciaDias: 15 } });
prueba('quien autoriza edita una autorizada y sigue autorizada y activa', r.status === 200 && r.json.estado === 'AUTORIZADA' && r.json.activa && r.json.frecuenciaDias === 15, JSON.stringify(r.json).slice(0, 200));
r = await llamar('PUT', `/declaraciones/${aceite.id}`, { token: T, cuerpo: { ...conFds, frecuenciaDias: 15, borrador: true } });
prueba('una autorizada no vuelve a borrador → 400', r.status === 400 && /borrador/.test(r.json.mensaje));
r = await llamar('PUT', `/declaraciones/${aceite.id}`, { token: T, cuerpo: { ...conFds, frecuenciaDias: 15, disposiciones: [] } });
prueba('quitar la disposición de una autorizada es un cambio crítico: vuelve a revisión e inactiva (no queda autorizada incompleta)', r.status === 200 && r.json.estado === 'PENDIENTE' && !r.json.activa && r.json.cambiosCriticos?.includes('la disposición o tratamiento'), JSON.stringify(r.json).slice(0, 200));
// Otra persona con el permiso (HSEQ) la vuelve a autorizar después de corregirla
const rolHseq = await db.rol.findFirst({ where: { nombre: 'HSEQ', empresaId: cliente.empresaId } });
const hseq = await db.usuario.upsert({ where: { email: 'hseq.e2e@terravivasas.com' }, update: {},
  create: { empresaId: cliente.empresaId, rolId: rolHseq.id, nombre: 'HSEQ E2E', documento: '4', email: 'hseq.e2e@terravivasas.com',
    passwordHash: await (await import('@node-rs/argon2')).hash('Hseq2026!', { memoryCost: 19456, timeCost: 2, parallelism: 1 }) } });
const thseq = (await aceptarDatos((await llamar('POST', '/auth/login', { cuerpo: { email: hseq.email, clave: 'Hseq2026!' } })).json)).accessToken;
await llamar('PUT', `/declaraciones/${aceite.id}`, { token: T, cuerpo: { ...conFds, frecuenciaDias: 15 } });
r = await llamar('PATCH', `/declaraciones/${aceite.id}/estado`, { token: thseq, cuerpo: { estado: 'AUTORIZADA' } });
prueba('…corregida, la autoriza otra persona (HSEQ)', r.status === 200 && r.json.estado === 'AUTORIZADA', JSON.stringify(r.json).slice(0, 200));
r = await llamar('PUT', `/declaraciones/${aceite.id}`, { token: T, cuerpo: { ...conFds, frecuenciaDias: 15, precio: { precioUnitario: 550, metricaId: idDe(cat.metricasPrecio, 'gal') } } });
let tarifasAceite = await db.tarifa.findMany({ where: { declaracionId: aceite.id } });
prueba('el mismo día, cambiar el precio corrige la vigencia de hoy (no la duplica)', r.status === 200 && tarifasAceite.length === 1 && Number(tarifasAceite[0].precioUnitario) === 550, JSON.stringify(tarifasAceite));
await db.tarifa.update({ where: { id: tarifasAceite[0].id }, data: { vigenteDesde: new Date('2026-11-01') } }); // como si viniera de antes
r = await llamar('PUT', `/declaraciones/${aceite.id}`, { token: T, cuerpo: { ...conFds, frecuenciaDias: 15, precio: { precioUnitario: 600, metricaId: idDe(cat.metricasPrecio, 'gal') } } });
tarifasAceite = await db.tarifa.findMany({ where: { declaracionId: aceite.id }, orderBy: { vigenteDesde: 'asc' } });
prueba('cambiar un precio de días anteriores crea una vigencia nueva y cierra la anterior (nunca la sobrescribe)',
  r.status === 200 && tarifasAceite.length === 2 && tarifasAceite[0].vigenteHasta && Number(tarifasAceite[0].precioUnitario) === 550 && !tarifasAceite[1].vigenteHasta && Number(tarifasAceite[1].precioUnitario) === 600,
  JSON.stringify(tarifasAceite.map((t) => [t.vigenteDesde, t.vigenteHasta, t.precioUnitario])));
r = await llamar('POST', '/declaraciones', { token: T, cuerpo: { ...conFds, codigoInterno: 'AU-03' } });
const paraComercial = r.json;
await llamar('PATCH', `/declaraciones/${paraComercial.id}/estado`, { token: T, cuerpo: { estado: 'AUTORIZADA' } });
const rolComercial = await db.rol.findFirst({ where: { nombre: 'Comercial', empresaId: cliente.empresaId } });
const comercial = await db.usuario.upsert({ where: { email: 'comercial.e2e@terravivasas.com' }, update: {},
  create: { empresaId: cliente.empresaId, rolId: rolComercial.id, nombre: 'Comercial E2E', documento: '3', email: 'comercial.e2e@terravivasas.com',
    passwordHash: await (await import('@node-rs/argon2')).hash('Comercial2026!', { memoryCost: 19456, timeCost: 2, parallelism: 1 }) } });
const tcom = (await aceptarDatos((await llamar('POST', '/auth/login', { cuerpo: { email: comercial.email, clave: 'Comercial2026!' } })).json)).accessToken;
r = await llamar('PUT', `/declaraciones/${paraComercial.id}`, { token: tcom, cuerpo: { ...conFds, codigoInterno: 'AU-03', cantidadFrecuencia: 30 } });
prueba('si la edita un rol que no autoriza (Comercial), vuelve a revisión e inactiva', r.status === 200 && r.json.estado === 'PENDIENTE' && !r.json.activa, JSON.stringify(r.json).slice(0, 200));
const audEditar = await db.auditoria.findFirst({ where: { entidad: 'declaracion', entidadId: paraComercial.id, accion: 'EDITAR' }, orderBy: { fecha: 'desc' } });
prueba('…y la auditoría guarda qué cambió y que volvió a revisión', audEditar?.antes?.estado === 'AUTORIZADA' && Number(audEditar?.despues?.cantidadFrecuencia) === 30 && /revisión/.test(audEditar?.despues?.nota ?? ''), JSON.stringify({ antes: audEditar?.antes, despues: audEditar?.despues }));

// Respuesta D2: un cambio crítico a una autorizada la devuelve a revisión aunque lo haga quien autoriza, y la autoriza otra persona
const conTransporte = { ...conFds, frecuenciaDias: 15, precio: { precioUnitario: 600, metricaId: idDe(cat.metricasPrecio, 'gal') },
  disposiciones: [{ disposicionId: idDe(cat.disposiciones, 'DF'), principal: true }, { disposicionId: idDe(cat.disposiciones, 'TRA') }] };
r = await llamar('PUT', `/declaraciones/${aceite.id}`, { token: T, cuerpo: conTransporte });
prueba('cambio crítico (disposición) hecho por quien autoriza: vuelve a revisión', r.status === 200 && r.json.estado === 'PENDIENTE' && !r.json.activa && r.json.cambiosCriticos?.includes('la disposición o tratamiento'), JSON.stringify(r.json).slice(0, 300));
r = await llamar('PATCH', `/declaraciones/${aceite.id}/estado`, { token: T, cuerpo: { estado: 'AUTORIZADA' } });
prueba('…quien hizo el cambio no la puede autorizar (cuatro ojos)', r.status === 403 && /otra persona/.test(r.json.mensaje), JSON.stringify(r.json));
const idAdmin = (await llamar('GET', '/auth/yo', { token: T })).json.id;
let cuatroOjos = false;
try { await db.declaracion.update({ where: { id: aceite.id }, data: { estado: 'AUTORIZADA', activa: true, aprobadaPorId: idAdmin, aprobadaEn: new Date() } }); } catch (e) { cuatroOjos = /chk_decl_cuatro_ojos/.test(String(e)); }
prueba('…ni escribiendo directo en la base', cuatroOjos);
r = await llamar('PATCH', `/declaraciones/${aceite.id}/estado`, { token: thseq, cuerpo: { estado: 'AUTORIZADA' } });
prueba('…la autoriza otra persona con el permiso (HSEQ)', r.status === 200 && r.json.estado === 'AUTORIZADA', JSON.stringify(r.json).slice(0, 300));
r = await llamar('PUT', `/declaraciones/${aceite.id}`, { token: thseq, cuerpo: { ...conTransporte, cantidadFrecuencia: 45 } });
prueba('un cambio no crítico de quien autoriza la deja autorizada', r.status === 200 && r.json.estado === 'AUTORIZADA' && r.json.activa && !r.json.cambiosCriticos?.length, JSON.stringify(r.json).slice(0, 200));

console.log('\n3b. Cargue desde CSV y deshacer un cargue (fase C)');
/** La plantilla en CSV, como la guardaría Excel: encabezados con «*» y comillas solo donde hacen falta. */
const csvDe = (id, filas, d = ';') => {
  const p = plantilla(id);
  const celda = (v) => { const x = String(v ?? ''); return x.includes(d) || /["\r\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
  return [p.columnas.map((c) => c.header + (c.requerido ? ' *' : '')), ...filas.map((f) => p.columnas.map((c) => f[c.key] ?? ''))]
    .map((fila) => fila.map(celda).join(d)).join('\r\n') + '\r\n';
};
const conSeparador = (buf, nombre, d) => { const f = formDe(buf, nombre); f.append('delimitador', d); return f; };
const filaCsv = (x) => filaResiduo({ categoria: 'NOPEL', peligroso: 'No', corrienteY: '', riesgos: '', disposiciones: 'BIO', frecuenciaDias: '30', metrica: 'kg', precio: '700', ...x });
// Como lo guarda Excel en Colombia («CSV UTF-8»): con BOM, punto y coma, y las celdas de varios valores entre comillas
const csvA = Buffer.from('﻿' + csvDe('decl-residuos', [
  filaCsv({ codigo: 'CSV-01', residuo: 'Lodos de biorremediación', sedes: 'C001;C002' }),
  filaCsv({ codigo: 'CSV-02', residuo: 'Suelo con grasa vegetal', disposiciones: 'BIO;ASP' }),
]), 'utf8');
r = await llamar('POST', '/importacion/decl-residuos/vista-previa', { token: T, form: formDe(csvA, 'declaraciones.csv') });
prueba('CSV UTF-8 de Excel: detecta el punto y coma y lee las celdas con «;» entre comillas', r.status === 201 && r.json.formato === 'CSV' && r.json.delimitador === ';'
  && r.json.resumen.validas === 2 && r.json.filas[0]?.datos.sedes === 'C001;C002' && r.json.filas[1]?.datos.disposiciones === 'BIO;ASP', JSON.stringify(r.json).slice(0, 400));
r = await llamar('POST', '/importacion/decl-residuos/confirmar', { token: tcom, form: formDe(csvA, 'declaraciones.csv') });
const loteCsv = r.json.cargueId ? await db.cargueMasivo.findUnique({ where: { id: r.json.cargueId } }) : null;
prueba('…lo guarda (Comercial) con el formato y el separador en el historial', r.status === 201 && r.json.creadas === 2 && loteCsv?.formato === 'CSV' && loteCsv.delimitador === ';', JSON.stringify(r.json).slice(0, 300));
// «CSV (delimitado por comas)» de Excel en Windows: coma y Windows-1252
const csvB = Buffer.from(csvDe('decl-residuos', [filaCsv({ codigo: 'CSV-03', residuo: 'Lodos de desnatación', sedes: 'C002' })], ','), 'latin1');
r = await llamar('POST', '/importacion/decl-residuos/vista-previa', { token: T, form: formDe(csvB, 'excel-windows.csv') });
prueba('CSV de Excel en Windows (coma, Windows-1252): detecta la coma y las tildes llegan bien', r.status === 201 && r.json.delimitador === ',' && r.json.codificacion === 'Windows-1252'
  && !r.json.faltantes.length && r.json.filas[0]?.datos.residuo === 'Lodos de desnatación' && r.json.resumen.validas === 1, JSON.stringify(r.json).slice(0, 400));
r = await llamar('POST', '/importacion/decl-residuos/vista-previa', { token: T, form: conSeparador(csvA, 'declaraciones.csv', ',') });
prueba('…con un separador equivocado elegido a mano, dice qué columnas no encuentra', r.status === 201 && r.json.delimitador === ',' && r.json.faltantes.length > 0, JSON.stringify(r.json).slice(0, 300));
r = await llamar('POST', '/importacion/decl-residuos/vista-previa', { token: T, form: conSeparador(csvA, 'declaraciones.csv', 'x') });
prueba('…y un separador que no existe → 400', r.status === 400 && /Separador no válido/.test(r.json.mensaje), JSON.stringify(r.json));
r = await llamar('POST', '/importacion/clientes/vista-previa', { token: T, form: formDe(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]), 'viejo.xls') });
prueba('un Excel antiguo (.xls) se rechaza explicando cómo guardarlo', r.status === 400 && /antiguo/.test(r.json.mensaje), JSON.stringify(r.json));
const plantillaCsv = await fetch(`${API}/importacion/plantillas/decl-residuos/archivo?formato=csv`, { headers: { authorization: `Bearer ${T}` } });
const bytesCsv = Buffer.from(await plantillaCsv.arrayBuffer());
prueba('la plantilla también se descarga en CSV (UTF-8 con BOM, punto y coma)', plantillaCsv.status === 200 && /text\/csv/.test(plantillaCsv.headers.get('content-type') ?? '')
  && bytesCsv[0] === 0xef && bytesCsv[1] === 0xbb && bytesCsv[2] === 0xbf && bytesCsv.toString('utf8').includes('NIT cliente *;'), bytesCsv.toString('utf8').slice(0, 80));

// Deshacer: quien lo cargó, sin autorizadas; nada se borra
r = await llamar('GET', `/importacion/cargues/${loteCsv.id}/reversion`, { token: tcom });
prueba('deshacer: muestra qué se anula (2 pendientes) y que quien lo cargó puede hacerlo', r.status === 200 && r.json.puede === true && r.json.declaraciones === 2 && r.json.porEstado.PENDIENTE === 2, JSON.stringify(r.json).slice(0, 300));
r = await llamar('POST', `/importacion/cargues/${loteCsv.id}/revertir`, { token: tcom, cuerpo: { motivo: 'corto' } });
prueba('…exige el motivo (mínimo 10 caracteres)', r.status === 400, JSON.stringify(r.json));
r = await llamar('POST', `/importacion/cargues/${loteCsv.id}/revertir`, { token: tcom, cuerpo: { motivo: 'Archivo con las sedes equivocadas' } });
const anuladasCsv = await db.declaracion.findMany({ where: { cargueId: loteCsv.id } });
const loteDeshecho = await db.cargueMasivo.findUnique({ where: { id: loteCsv.id } });
prueba('…lo deshace: sus declaraciones quedan ANULADAS e inactivas (no se borran) y el lote, deshecho con el motivo', r.status === 201 && r.json.anuladas === 2
  && anuladasCsv.length === 2 && anuladasCsv.every((d) => d.estado === 'ANULADA' && !d.activa) && loteDeshecho.estado === 'REVERTIDO' && loteDeshecho.motivoReversion === 'Archivo con las sedes equivocadas', JSON.stringify(r.json));
const audAnular = await db.auditoria.count({ where: { entidad: 'declaracion', accion: 'ANULAR', entidadId: { in: anuladasCsv.map((d) => d.id) } } });
const audRevertir = await db.auditoria.findFirst({ where: { entidad: 'cargue_masivo', entidadId: loteCsv.id, accion: 'REVERTIR' } });
prueba('…y la auditoría guarda el lote deshecho y la anulación de cada declaración', audAnular === 2 && audRevertir?.despues?.motivo === 'Archivo con las sedes equivocadas', String(audAnular));
r = await llamar('GET', '/declaraciones?tipo=RESIDUO&codigo=CSV-0', { token: T });
const rAnuladas = await llamar('GET', '/declaraciones?tipo=RESIDUO&estado=ANULADA', { token: T });
prueba('el listado ya no las muestra, salvo con el filtro «Anulada» (que explica de qué cargue vienen)', r.status === 200 && r.json.filas.length === 0
  && rAnuladas.json.filas?.filter((d) => d.codigoInterno?.startsWith('CSV-')).length === 2 && rAnuladas.json.filas[0].cargue?.motivoReversion === 'Archivo con las sedes equivocadas', JSON.stringify(rAnuladas.json).slice(0, 300));
r = await llamar('PATCH', `/declaraciones/${anuladasCsv[0].id}/estado`, { token: T, cuerpo: { estado: 'AUTORIZADA' } });
prueba('una anulada no se autoriza (API)', r.status === 400 && /anulada/.test(r.json.mensaje), JSON.stringify(r.json));
r = await llamar('PUT', `/declaraciones/${anuladasCsv[0].id}`, { token: T, cuerpo: { ...formulario, codigoInterno: 'CSV-01' } });
prueba('…ni se edita', r.status === 400 && /anulada/.test(r.json.mensaje), JSON.stringify(r.json).slice(0, 200));
let anuladaFija = false;
try { await db.declaracion.update({ where: { id: anuladasCsv[0].id }, data: { observaciones: 'cambio directo' } }); } catch (e) { anuladaFija = /está anulada/.test(String(e)); }
prueba('…ni se modifica escribiendo directo en la base', anuladaFija);
let precioFijo = false;
try { await db.tarifa.create({ data: { declaracionId: anuladasCsv[0].id, precioUnitario: 1, tipoNegociacion: 'COBRO', formaPago: 'CONTADO', vigenteDesde: new Date('2027-01-01') } }); } catch (e) { precioFijo = /está anulada/.test(String(e)); }
prueba('…ni recibe precios nuevos (regla en la base)', precioFijo);
r = await llamar('POST', '/importacion/decl-residuos/confirmar', { token: tcom, form: formDe(csvA, 'declaraciones.csv') });
const loteNuevo = r.json.cargueId;
prueba('el mismo archivo se vuelve a cargar: los códigos de las anuladas quedaron libres', r.status === 201 && r.json.creadas === 2, JSON.stringify(r.json).slice(0, 300));
r = await llamar('POST', `/importacion/cargues/${loteCsv.id}/revertir`, { token: T, cuerpo: { motivo: 'Intento de deshacerlo otra vez' } });
prueba('un cargue deshecho no se deshace otra vez → 409', r.status === 409 && /ya se deshizo/.test(r.json.mensaje), JSON.stringify(r.json));
let loteFijo = false;
try { await db.cargueMasivo.update({ where: { id: loteCsv.id }, data: { archivo: 'otro.csv' } }); } catch (e) { loteFijo = /ya se deshizo/.test(String(e)); }
prueba('…ni se modifica en la base', loteFijo);
r = await llamar('POST', '/importacion/decl-residuos/confirmar', { token: T, form: formDe(csvB, 'excel-windows.csv') });
const loteAdmin = r.json.cargueId;
const desnatacion = await db.declaracion.findFirst({ where: { cargueId: loteAdmin ?? undefined } });
prueba('el CSV de Windows se guarda con sus tildes', r.status === 201 && desnatacion?.nombre === 'Lodos de desnatación', JSON.stringify(r.json).slice(0, 200));
r = await llamar('POST', `/importacion/cargues/${loteAdmin}/revertir`, { token: tcom, cuerpo: { motivo: 'No es mío pero lo intento' } });
prueba('un cargue de otra persona: Comercial no lo deshace → 403', r.status === 403 && /quien lo cargó/.test(r.json.mensaje), JSON.stringify(r.json));
r = await llamar('POST', `/importacion/cargues/${loteAdmin}/revertir`, { token: T, cuerpo: { motivo: 'Lo deshace el administrador' } });
prueba('…el administrador sí', r.status === 201 && r.json.anuladas === 1, JSON.stringify(r.json));
const loteSedes = await db.cargueMasivo.findFirst({ where: { plantilla: 'sucursales', estado: 'CONFIRMADO' } });
r = await llamar('POST', `/importacion/cargues/${loteSedes.id}/revertir`, { token: T, cuerpo: { motivo: 'Probar con un cargue de sedes' } });
prueba('solo se deshacen cargues de declaraciones (los de sedes se corrigen con otro cargue) → 409', r.status === 409 && /Solo se deshacen/.test(r.json.mensaje), JSON.stringify(r.json));
// Con una autorizada: Comercial ya no; HSEQ sí, salvo que alguna esté en uso
const nuevasCsv = await db.declaracion.findMany({ where: { cargueId: loteNuevo }, orderBy: { numero: 'asc' } });
r = await llamar('PATCH', `/declaraciones/${nuevasCsv[0].id}/estado`, { token: thseq, cuerpo: { estado: 'AUTORIZADA' } });
prueba('(HSEQ autoriza una declaración del cargue nuevo)', r.status === 200 && r.json.estado === 'AUTORIZADA', JSON.stringify(r.json).slice(0, 200));
r = await llamar('POST', `/importacion/cargues/${loteNuevo}/revertir`, { token: tcom, cuerpo: { motivo: 'Comercial quiere deshacerlo' } });
prueba('con declaraciones autorizadas, quien lo cargó (Comercial) no lo deshace → 403', r.status === 403 && /importacion.revertir/.test(r.json.mensaje), JSON.stringify(r.json));
r = await llamar('GET', `/importacion/cargues/${loteNuevo}/reversion`, { token: thseq });
prueba('…HSEQ (permiso «importacion.revertir») sí podría', r.status === 200 && r.json.puede === true && r.json.porEstado.AUTORIZADA === 1, JSON.stringify(r.json).slice(0, 200));
const sedeC001 = await db.sucursal.findFirst({ where: { codigo: 'C001', cliente: { nit: NIT } } });
r = await llamar('POST', '/solicitudes', { token: T, cuerpo: { aprobacion: 'APROBADA', clienteId: sedeC001.clienteId, sucursalId: sedeC001.id, fechaSolicitada: '2026-11-25', items: [{ declaracionId: nuevasCsv[0].id, cantidadEstimada: 50 }] } });
prueba('(una solicitud usa la declaración autorizada)', r.status === 201, JSON.stringify(r.json).slice(0, 200));
r = await llamar('GET', `/importacion/cargues/${loteNuevo}/reversion`, { token: thseq });
prueba('si una ya está en una solicitud, no se deshace y dice cuál', r.status === 200 && r.json.puede === false && r.json.enUso.length === 1 && r.json.enUso[0].numero === nuevasCsv[0].numero
  && /solicitudes o manifiestos/.test(r.json.impedimento), JSON.stringify(r.json).slice(0, 300));
r = await llamar('POST', `/importacion/cargues/${loteNuevo}/revertir`, { token: thseq, cuerpo: { motivo: 'HSEQ intenta deshacerlo' } });
prueba('…el API lo rechaza → 409', r.status === 409, JSON.stringify(r.json));
let enUsoBase = false;
try { await db.declaracion.update({ where: { id: nuevasCsv[0].id }, data: { estado: 'ANULADA', activa: false } }); } catch (e) { enUsoBase = /ya tiene solicitudes/.test(String(e)); }
prueba('…ni escribiendo directo en la base', enUsoBase);

console.log('\n3c. Clientes y sedes (fase 1c)');
r = await llamar('GET', '/municipios?q=giron', { token: T });
prueba('municipios de la DIVIPOLA (1.122): se buscan sin tildes («giron» → Girón)', r.status === 200 && r.json.some((m) => m.codigoDane === '68307' && m.nombre === 'Girón'), JSON.stringify(r.json).slice(0, 200));
r = await llamar('GET', '/municipios?q=05001', { token: T });
prueba('…o por su código DANE (05001 → Medellín)', r.status === 200 && r.json[0]?.nombre === 'Medellín', JSON.stringify(r.json).slice(0, 200));
const nitF1 = '901234567';
r = await llamar('POST', '/clientes', { token: tcom, cuerpo: { nit: nitF1, razonSocial: 'Palmas del Magdalena Medio S.A.S.' } });
prueba('crear un cliente sin representante legal → 400 (es obligatorio)', r.status === 400 && /representante legal/.test(JSON.stringify(r.json)), JSON.stringify(r.json).slice(0, 200));
r = await llamar('POST', '/clientes', { token: tcom, cuerpo: { nit: nitF1, razonSocial: 'Palmas del Magdalena Medio S.A.S.', representanteLegal: 'Representante Palmas', sector: 'Palma', formaPago: 'CREDITO_30', emailFacturacion: 'facturas@palmas.test', asesorId: comercial.id } });
const cF1 = r.json;
prueba('crear un cliente (Comercial) calcula el dígito de verificación y guarda el asesor', r.status === 201 && cF1.dv === dvNit(nitF1) && cF1.asesorId === comercial.id, JSON.stringify(r.json).slice(0, 200));
r = await llamar('POST', '/clientes', { token: tcom, cuerpo: { nit: nitF1, razonSocial: 'Repetido S.A.S.', representanteLegal: 'Otra Persona' } });
prueba('…y no repite un NIT', r.status === 400 && /Ya existe/.test(r.json.mensaje), JSON.stringify(r.json));
// Cliente antiguo sin representante legal: quien cambie sus datos comerciales lo completa (inactivarlo no lo exige)
await db.cliente.update({ where: { id: cliente.id }, data: { representanteLegal: null } });
const sinRl = await llamar('PATCH', `/clientes/${cliente.id}`, { token: tcom, cuerpo: { sector: 'Agroindustria' } });
r = await llamar('PATCH', `/clientes/${cliente.id}`, { token: tcom, cuerpo: { sector: 'Agroindustria', representanteLegal: 'Representante Legal Prueba' } });
prueba('cliente antiguo sin representante legal: al cambiar sus datos se exige completarlo', sinRl.status === 400 && /representante legal/.test(sinRl.json.mensaje)
  && r.status === 200 && r.json.representanteLegal === 'Representante Legal Prueba', `${sinRl.status} ${r.status}`);
const zonasF1 = (await llamar('GET', '/zonas', { token: T })).json;
r = await llamar('POST', `/clientes/${cF1.id}/sucursales`, { token: tcom, cuerpo: { nombre: 'Planta de beneficio', codigo: 'p1', municipioDane: '68655', zonaId: zonasF1[0]?.id, latitud: 7.39, longitud: -73.5, atencionLvDesde: '07:00', atencionLvHasta: '16:00' } });
const sedeP1 = r.json;
prueba('la primera sede queda como principal, con su municipio DANE, zona y horario', r.status === 201 && sedeP1.esPrincipal && sedeP1.codigo === 'P1' && sedeP1.municipioDane === '68655' && sedeP1.atencionLvDesde?.slice(11, 16) === '07:00', JSON.stringify(r.json).slice(0, 300));
r = await llamar('POST', `/clientes/${cF1.id}/sucursales`, { token: tcom, cuerpo: { nombre: 'Vivero', codigo: 'P2', municipioDane: '68575', esPrincipal: true } });
const sedeP2 = r.json;
const principalesF1 = await db.sucursal.findMany({ where: { clienteId: cF1.id, esPrincipal: true } });
prueba('otra sede marcada como principal le quita la marca a la anterior (una sola por cliente)', r.status === 201 && principalesF1.length === 1 && principalesF1[0].id === sedeP2.id, JSON.stringify(r.json).slice(0, 200));
r = await llamar('POST', '/declaraciones', { token: T, cuerpo: { ...formulario, clienteId: cF1.id, alcanceSedes: 'TODAS', codigoInterno: 'F1C-01', fichaSeguridadUrl: 'https://docs.terravivasas.com/fds/aceite.pdf' } });
const declF1 = r.json;
r = await llamar('PATCH', `/declaraciones/${declF1.id}/estado`, { token: T, cuerpo: { estado: 'AUTORIZADA' } });
prueba('(declaración autorizada del cliente nuevo en sus dos sedes)', r.status === 200 && r.json.activa === true, JSON.stringify(r.json).slice(0, 200));
// Cargue de sedes: el municipio se busca en la DIVIPOLA sin tildes; uno mal escrito se avisa sin bloquear la fila
r = await llamar('POST', '/importacion/sucursales/vista-previa', { token: T, form: await excel('sucursales', [
  { nit: nitF1, nombre: 'Bodega Girón', codigo: 'P3', direccion: 'Calle 1', municipio: 'Giron', depto: 'Santander' },
  { nit: nitF1, nombre: 'Sede mal escrita', codigo: 'P4', direccion: 'Calle 2', municipio: 'Sabanna de Torres', depto: 'Santander' },
]) });
prueba('cargue de sedes: avisa el municipio que no está en la DIVIPOLA, sin bloquear la fila', r.status === 201 && !r.json.filas[0]?.advertencias.length
  && r.json.filas[1]?.advertencias.some((a) => /DIVIPOLA/.test(a)) && !r.json.filas[1]?.errores.length, JSON.stringify(r.json.filas ?? r.json).slice(0, 400));
r = await llamar('POST', '/importacion/sucursales/confirmar', { token: T, form: await excel('sucursales', [{ nit: nitF1, nombre: 'Bodega Girón', codigo: 'P3', direccion: 'Calle 1', municipio: 'Giron', depto: 'Santander' }]) });
const sedeGiron = await db.sucursal.findFirst({ where: { codigo: 'P3', clienteId: cF1.id } });
prueba('…y lo encuentra sin tildes: «Giron» queda con el código DANE de Girón (68307)', r.status === 201 && sedeGiron?.municipioDane === '68307', JSON.stringify(r.json).slice(0, 200));
// Sedes: inactivar no borra; la principal no se inactiva
r = await llamar('PATCH', `/clientes/${cF1.id}/sucursales/${sedeP2.id}`, { token: tcom, cuerpo: { activa: false } });
prueba('la sede principal no se inactiva sin marcar otra como principal', r.status === 400 && /principal/.test(r.json.mensaje), JSON.stringify(r.json));
r = await llamar('PATCH', `/clientes/${cF1.id}/sucursales/${sedeP1.id}`, { token: tcom, cuerpo: { activa: false } });
const vinculoP1 = await db.declaracionSucursal.findFirst({ where: { declaracionId: declF1.id, sucursalId: sedeP1.id } });
prueba('inactivar una sede: su vínculo con la declaración queda inactivo (nada se borra)', r.status === 200 && r.json.activa === false && vinculoP1?.activa === false, JSON.stringify(r.json).slice(0, 200));
r = await llamar('POST', '/solicitudes', { token: T, cuerpo: { aprobacion: 'APROBADA', clienteId: cF1.id, sucursalId: sedeP1.id, fechaSolicitada: '2026-11-26', items: [{ declaracionId: declF1.id, cantidadEstimada: 10 }] } });
prueba('…y a esa sede ya no se le programan servicios (regla en la base)', r.status === 409, JSON.stringify(r.json));
const audSede = await db.auditoria.findFirst({ where: { entidad: 'sucursal', entidadId: sedeP1.id, accion: 'INACTIVAR' } });
prueba('…la auditoría guarda la sede inactivada y sus vínculos', audSede?.despues?.vinculosInactivados === 1, JSON.stringify(audSede?.despues));
// Cliente: datos comerciales, paso a gestor e inactivación
r = await llamar('PATCH', `/clientes/${cF1.id}`, { token: tcom, cuerpo: { tipo: 'GESTOR' } });
prueba('pasar a gestor exige el NIT del generador en cada sede activa', r.status === 400 && /NIT del generador/.test(r.json.mensaje), JSON.stringify(r.json));
r = await llamar('PATCH', `/clientes/${cF1.id}`, { token: tcom, cuerpo: { razonSocial: 'Palmas del Magdalena Medio S.A.S.', sector: 'Palma de aceite', formaPago: 'CREDITO_60' } });
const audCli = await db.auditoria.findFirst({ where: { entidad: 'cliente', entidadId: cF1.id, accion: 'EDITAR' }, orderBy: { fecha: 'desc' } });
prueba('editar el cliente: la auditoría guarda solo lo que cambió', r.status === 200 && audCli?.antes?.formaPago === 'CREDITO_30' && audCli?.despues?.sector === 'Palma de aceite'
  && !('razonSocial' in (audCli?.despues ?? {})), JSON.stringify({ antes: audCli?.antes, despues: audCli?.despues }));
r = await llamar('PATCH', `/clientes/${cF1.id}`, { token: thseq, cuerpo: { sector: 'Otro' } });
prueba('sin el permiso «clientes.editar» (HSEQ) no se edita → 403', r.status === 403, String(r.status));
r = await llamar('PATCH', `/clientes/${cF1.id}`, { token: tcom, cuerpo: { activo: false } });
prueba('inactivar un cliente con declaraciones activas pide el motivo', r.status === 400 && /motivo/.test(r.json.mensaje), JSON.stringify(r.json));
const causalCli = await db.catalogoItem.findFirst({ where: { tipo: 'CAUSAL', nombre: 'Cliente cambió de operador' } });
r = await llamar('PATCH', `/clientes/${cF1.id}`, { token: tcom, cuerpo: { activo: false, causalId: causalCli.id } });
const declF1b = await db.declaracion.findUnique({ where: { id: declF1.id } });
prueba('…con el motivo: el cliente y sus declaraciones activas quedan inactivos (siguen autorizadas: nada se borra)', r.status === 200 && r.json.activo === false && r.json.inactivadas === 1
  && declF1b.activa === false && declF1b.estado === 'AUTORIZADA' && declF1b.causalId === causalCli.id, JSON.stringify(r.json).slice(0, 200));
const [activosF1, inactivosF1] = await Promise.all([llamar('GET', '/clientes?q=Palmas&activo=true', { token: T }), llamar('GET', '/clientes?q=901234&activo=false', { token: T })]);
prueba('el listado filtra por estado y busca por NIT', activosF1.json.total === 0 && inactivosF1.json.total === 1 && inactivosF1.json.filas[0].sucursales.length === 3, JSON.stringify(inactivosF1.json).slice(0, 200));
r = await llamar('POST', `/clientes/${cF1.id}/sucursales`, { token: tcom, cuerpo: { nombre: 'Otra sede' } });
prueba('a un cliente inactivo no se le agregan sedes', r.status === 400 && /inactivo/.test(r.json.mensaje), JSON.stringify(r.json));
r = await llamar('GET', `/clientes/${cF1.id}`, { token: T });
prueba('la ficha trae sedes con municipio y zona, y el resumen de declaraciones', r.status === 200 && r.json.sucursales.find((s) => s.id === sedeP1.id)?.municipio?.nombre === 'Sabana de Torres'
  && r.json._count.declaraciones === 1 && r.json.declaracionesActivas === 0 && r.json.asesor?.id === comercial.id, JSON.stringify(r.json).slice(0, 300));

console.log('\n3d. Tarifas (fase 1c)');
r = await llamar('GET', `/declaraciones?tipo=RESIDUO&estado=AUTORIZADA&activa=true&clienteId=${lodo.cliente.id}&negociacion=COBRO`, { token: T });
const lodoTf = r.json.filas?.find((d) => d.id === lodo.id);
prueba('tarifas: el listado trae el precio vigente (780) y el programado (820, en 45 días)', r.status === 200 && Number(lodoTf?.tarifaVigente?.precioUnitario) === 780
  && Number(lodoTf?.tarifaProgramada?.precioUnitario) === 820 && lodoTf.tarifaProgramada.vigenteDesde.startsWith(desdeProgramado), JSON.stringify(lodoTf ?? r.json).slice(0, 300));
r = await llamar('GET', `/declaraciones?tipo=RESIDUO&clienteId=${lodo.cliente.id}&negociacion=COMPRA`, { token: T });
prueba('…y filtra por las condiciones del precio (ninguna en «Compra»)', r.status === 200 && r.json.total === 0, JSON.stringify(r.json).slice(0, 200));
r = await llamar('GET', `/declaraciones/ids?tipo=RESIDUO&estado=AUTORIZADA&activa=true&clienteId=${lodo.cliente.id}`, { token: T });
prueba('«seleccionar las filtradas» trae los ids de todas', r.status === 200 && r.json.ids.includes(lodo.id) && r.json.ids.length === r.json.total, JSON.stringify(r.json).slice(0, 200));
r = await llamar('POST', '/declaraciones/tarifas/masivas', { token: T, cuerpo: { declaraciones: [lodo.id], modo: 'fijo', valor: 900, vigenteDesde: fechaEn(-1) } });
prueba('un precio nuevo no rige hacia atrás (lo que pudo facturarse no cambia) → 400', r.status === 400 && /hoy o una fecha futura/.test(r.json.mensaje), JSON.stringify(r.json));
r = await llamar('POST', '/declaraciones/tarifas/masivas', { token: T, cuerpo: { declaraciones: [lodo.id], modo: 'fijo', valor: 900, vigenteDesde: fechaEn(20) } });
prueba('con un precio ya programado para después, pide esa fecha o una posterior → 400', r.status === 400 && /programado para después/.test(r.json.mensaje), JSON.stringify(r.json));
const borradorSinPrecio = (await llamar('POST', '/declaraciones', { token: T, cuerpo: { tipo: 'RESIDUO', borrador: true, clienteId: cliente.id, nombre: 'Borrador sin precio', categoriaId: formulario.categoriaId, lineaServicioId: formulario.lineaServicioId } })).json;
r = await llamar('POST', '/declaraciones/tarifas/masivas', { token: T, cuerpo: { declaraciones: [lodo.id, borradorSinPrecio.id], modo: 'porcentaje', valor: 10, vigenteDesde: desdeProgramado } });
prueba('un ajuste porcentual necesita precio de base: dice cuáles no lo tienen → 400', r.status === 400 && /Sin precio/.test(r.json.mensaje) && r.json.mensaje.includes(`N.° ${borradorSinPrecio.numero}`), JSON.stringify(r.json));
r = await llamar('POST', '/declaraciones/tarifas/masivas', { token: T, cuerpo: { declaraciones: [lodo.id], modo: 'fijo', valor: 900, vigenteDesde: desdeProgramado, formaPago: 'CREDITO_60' } });
const tarifasLodo = await db.tarifa.findMany({ where: { declaracionId: lodo.id }, orderBy: { vigenteDesde: 'asc' } });
prueba('en la misma fecha de un precio programado, lo corrige (no abre otra vigencia)', r.status === 201 && r.json.corregidas === 1 && tarifasLodo.length === 2
  && Number(tarifasLodo[1].precioUnitario) === 900 && tarifasLodo[1].formaPago === 'CREDITO_60', JSON.stringify(r.json));
r = await llamar('GET', `/declaraciones/${lodo.id}`, { token: T });
prueba('el historial de precios dice quién asignó cada uno', r.status === 200 && r.json.tarifas.length === 2 && !!r.json.tarifas[0].asignadoPor?.nombre, JSON.stringify(r.json.tarifas?.map((t) => [t.vigenteDesde, t.precioUnitario, t.asignadoPor?.nombre])));
r = await llamar('POST', '/declaraciones/tarifas/masivas', { token: thseq, cuerpo: { declaraciones: [lodo.id], modo: 'porcentaje', valor: 1, vigenteDesde: desdeProgramado } });
prueba('sin el permiso «tarifas.asignar» (HSEQ) no se cambian precios → 403', r.status === 403, String(r.status));
// Cargue de precios desde Excel: la misma regla
r = await llamar('POST', '/importacion/precios/vista-previa', { token: T, form: await excel('precios', [
  { numero: String(lodo.numero), precio: '950', desde: fechaEn(-3) },
  { numero: String(lodo.numero + 0), precio: '950', desde: desdeProgramado },
]) });
prueba('cargue de precios: una fecha pasada es un error de la fila', r.status === 201 && r.json.filas[0]?.errores.some((e) => /fecha futura/.test(e)), JSON.stringify(r.json.filas ?? r.json).slice(0, 300));
r = await llamar('POST', '/importacion/precios/confirmar', { token: T, form: await excel('precios', [{ numero: String(lodo.numero), precio: '910', desde: desdeProgramado }]) });
const programadoLodo = await db.tarifa.findFirst({ where: { declaracionId: lodo.id, vigenteHasta: null } });
prueba('…en la misma fecha de un precio programado, lo corrige', r.status === 201 && r.json.actualizadas === 1 && Number(programadoLodo?.precioUnitario) === 910, JSON.stringify(r.json).slice(0, 200));
r = await llamar('POST', '/importacion/precios/confirmar', { token: T, form: await excel('precios', [{ numero: String(lodo.numero), precio: '930', desde: fechaEn(10) }]) });
prueba('…y si hay uno programado para después, no deja ponerlo antes → 400', r.status === 400 && /programado desde/.test(r.json.mensaje), JSON.stringify(r.json));

console.log('\n3e. Permisos, obligaciones y gestores aliados (fase 1c)');
r = await llamar('GET', '/permisos-ambientales', { token: T });
const res632 = r.json.find?.((p) => /000632/.test(p.acto));
const oblSemestral = res632?.obligaciones.find((o) => o.proximaFecha && o.meses === 6);
const oblEvento = r.json.flatMap?.((p) => p.obligaciones).find((o) => !o.proximaFecha && !o.cumplida);
prueba('permisos: con sus obligaciones (las de fecha primero) y las disposiciones que amparan', r.status === 200 && res632?.disposiciones.length > 0 && !!oblSemestral && !!oblEvento
  && res632.obligaciones.findIndex((o) => !o.proximaFecha) > res632.obligaciones.findIndex((o) => !!o.proximaFecha), JSON.stringify(res632 ?? r.json).slice(0, 300));
r = await llamar('POST', `/obligaciones/${oblSemestral.id}/cumplimientos`, { token: thseq, cuerpo: { nota: 'corta' } });
prueba('registrar un cumplimiento exige soporte: radicado, enlace o nota → 400', r.status === 400 && /radicado/.test(JSON.stringify(r.json)), JSON.stringify(r.json));
r = await llamar('POST', `/obligaciones/${oblSemestral.id}/cumplimientos`, { token: thseq, cuerpo: { radicado: 'CAS-2026-1', cumplidaEn: fechaEn(3) } });
prueba('…y no admite una fecha futura → 400', r.status === 400 && /futura/.test(r.json.mensaje), JSON.stringify(r.json));
r = await llamar('POST', `/obligaciones/${oblSemestral.id}/cumplimientos`, { token: tcom, cuerpo: { radicado: 'CAS-2026-1' } });
prueba('…ni lo registra quien no tiene «permisos.gestionar» (Comercial) → 403', r.status === 403, String(r.status));
const programada = new Date(oblSemestral.proximaFecha);
const esperada = new Date(Date.UTC(programada.getUTCFullYear(), programada.getUTCMonth() + 6, programada.getUTCDate())).toISOString().slice(0, 10);
r = await llamar('POST', `/obligaciones/${oblSemestral.id}/cumplimientos`, { token: thseq, cuerpo: { radicado: 'CAS-2026-04512', soporteUrl: 'https://drive.example.com/informe-arnd.pdf', nota: 'Informe de caracterización del segundo semestre' } });
prueba('HSEQ registra el cumplimiento con su radicado: la próxima fecha avanza 6 meses desde la programada', r.status === 201 && r.json.siguiente?.startsWith(esperada)
  && r.json.obligacion.proximaFecha.startsWith(esperada), JSON.stringify(r.json).slice(0, 300));
r = await llamar('GET', `/obligaciones/${oblSemestral.id}/cumplimientos`, { token: T });
prueba('…y queda en su historial (fecha programada, radicado, soporte y quién)', r.status === 200 && r.json.cumplimientos.length === 1 && r.json.cumplimientos[0].radicado === 'CAS-2026-04512'
  && r.json.cumplimientos[0].fechaProgramada.startsWith(oblSemestral.proximaFecha.slice(0, 10)) && r.json.cumplimientos[0].usuario.nombre === 'HSEQ E2E', JSON.stringify(r.json).slice(0, 300));
let historialFijo = false;
try { await db.obligacionCumplimiento.deleteMany({ where: { obligacionId: oblSemestral.id } }); } catch (e) { historialFijo = /no se modifica ni se borra/.test(String(e)); }
prueba('…historial que nadie borra ni modifica (ni escribiendo en la base)', historialFijo);
r = await llamar('POST', `/obligaciones/${oblEvento.id}/cumplimientos`, { token: thseq, cuerpo: { nota: 'Reporte de contingencia enviado por correo a la CAS' } });
const oblEventoDespues = await db.obligacionPermiso.findUnique({ where: { id: oblEvento.id } });
prueba('una obligación por evento o permanente suma el registro sin fecha que avanzar', r.status === 201 && r.json.siguiente === null && oblEventoDespues.proximaFecha === null && !oblEventoDespues.cumplida, JSON.stringify(r.json).slice(0, 200));
r = await llamar('PATCH', `/permisos-ambientales/${res632.id}`, { token: thseq, cuerpo: { expedicion: '2023-08-15', vence: '2023-01-01' } });
prueba('permiso: el vencimiento no puede ser anterior a la expedición → 400', r.status === 400 && /anterior a la expedición/.test(r.json.mensaje), JSON.stringify(r.json));
r = await llamar('PATCH', `/permisos-ambientales/${res632.id}`, { token: thseq, cuerpo: { documentoUrl: 'https://drive.example.com/res-000632-2023.pdf' } });
const audPermiso = await db.auditoria.findFirst({ where: { entidad: 'permiso_ambiental', entidadId: res632.id, accion: 'EDITAR' } });
prueba('…se registra el enlace al acto y queda en la auditoría', r.status === 200 && r.json.documentoUrl === 'https://drive.example.com/res-000632-2023.pdf' && !!audPermiso, JSON.stringify(r.json).slice(0, 200));
// Gestores aliados: la vigencia de la licencia decide si se autorizan sus disposiciones
r = await llamar('GET', '/gestores-aliados', { token: T });
const sandesol = r.json.find?.((p) => p.nit === '804001490-7');
prueba('gestores aliados: Sandesol (incineración) aparece sin vigencia y sin cubrir', r.status === 200 && sandesol?.vigencia.estado === 'SIN_VIGENCIA' && sandesol.vigencia.cubre === false
  && sandesol.disposicionesGestionadas.some((d) => d.disposicion.codigo === 'INCH'), JSON.stringify(sandesol ?? r.json).slice(0, 300));
r = await llamar('PATCH', `/gestores-aliados/${sandesol.id}`, { token: thseq, cuerpo: { licenciaIndefinida: true, licenciaVence: fechaEn(300) } });
prueba('…una licencia indefinida no lleva fecha → 400', r.status === 400, JSON.stringify(r.json));
r = await llamar('PATCH', `/gestores-aliados/${sandesol.id}`, { token: thseq, cuerpo: { excluyeTiposResiduo: ['NOEXISTE'] } });
prueba('…ni excluye tipos de residuo que no existen → 400', r.status === 400 && /NOEXISTE/.test(r.json.mensaje), JSON.stringify(r.json));
r = await llamar('PATCH', `/gestores-aliados/${sandesol.id}`, { token: thseq, cuerpo: { licenciaVence: fechaEn(400), licenciaUrl: 'https://drive.example.com/licencia-sandesol.pdf' } });
prueba('al registrar la vigencia de su licencia, Sandesol queda cubriendo', r.status === 200 && r.json.vigencia.cubre === true && r.json.vigencia.estado === 'VIGENTE', JSON.stringify(r.json).slice(0, 200));
r = await llamar('PATCH', `/declaraciones/${incineracion.id}/estado`, { token: T, cuerpo: { estado: 'AUTORIZADA' } });
prueba('…y la declaración de incineración que antes se rechazaba ahora se autoriza', r.status === 200 && r.json.estado === 'AUTORIZADA', JSON.stringify(r.json).slice(0, 200));
for (const p of incineradores.filter((x) => x.id !== sandesol.id)) await db.proveedor.update({ where: { id: p.id }, data: { licenciaIndefinida: p.licenciaIndefinida, licenciaVence: p.licenciaVence } });
// Licencias nuevas (respuesta de la gerencia del 19-11-2026: dejar espacio para subir la de un aliado nuevo o una propia)
const PDF_LIC = Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n');
const conPdf = () => { const fo = new FormData(); fo.append('archivo', new Blob([PDF_LIC]), 'licencia.pdf'); return fo; };
const aliadoNuevo = { nit: '901999888-1', razonSocial: 'Planta Aliada Nueva S.A.S. E.S.P.', municipio: 'Girón', licencia: 'Res. 0123 del 05-03-2026', licenciaAutoridad: 'CDMB',
  licenciaVence: fechaEn(700), disposiciones: ['INCH'] };
const [sinVigencia, conPropia] = await Promise.all([
  llamar('POST', '/gestores-aliados', { token: thseq, cuerpo: { ...aliadoNuevo, licenciaVence: undefined } }),
  llamar('POST', '/gestores-aliados', { token: thseq, cuerpo: { ...aliadoNuevo, disposiciones: ['ASP'] } }),
]);
r = await llamar('POST', '/gestores-aliados', { token: thseq, cuerpo: aliadoNuevo });
const nuevoAliado = r.json;
prueba('gestor aliado nuevo con su licencia y lo que gestiona (sin vigencia no se registra; lo de Los Pinos no lo ampara un aliado)', r.status === 201 && nuevoAliado.vigencia?.cubre === true
  && sinVigencia.status === 400 && conPropia.status === 400 && /Los Pinos/.test(conPropia.json.mensaje), JSON.stringify([r.status, sinVigencia.status, conPropia.status, r.json.vigencia]));
r = await llamar('POST', '/gestores-aliados', { token: thseq, cuerpo: aliadoNuevo });
prueba('…no se repite el NIT', r.status === 400 && /Ya existe/.test(r.json.mensaje), JSON.stringify(r.json));
r = await llamar('POST', `/gestores-aliados/${nuevoAliado.id}/licencia`, { token: thseq, form: conPdf() });
const verLicencia = await llamar('GET', `/gestores-aliados/${nuevoAliado.id}/licencia`, { token: tcom });
const pdfLicencia = await fetch(API + verLicencia.json.url);
prueba('…se sube el PDF de su licencia y se ve con enlace firmado', r.status === 201 && verLicencia.status === 200 && pdfLicencia.status === 200
  && Buffer.from(await pdfLicencia.arrayBuffer()).subarray(0, 4).toString() === '%PDF', `${r.status} ${verLicencia.status} ${pdfLicencia.status}`);
r = await llamar('PATCH', `/gestores-aliados/${nuevoAliado.id}`, { token: thseq, cuerpo: { disposiciones: ['INCH', 'POS'] } });
const gestiona = (await db.disposicionGestor.findMany({ where: { proveedorId: nuevoAliado.id }, include: { disposicion: true } })).map((x) => x.disposicion.codigo).sort();
prueba('…y se cambia lo que gestiona', r.status === 200 && JSON.stringify(gestiona) === JSON.stringify(['INCH', 'POS']), JSON.stringify(gestiona));
r = await llamar('POST', '/permisos-ambientales', { token: thseq, cuerpo: { acto: 'Resolución DGL No. 000999 de 2027', autoridad: 'CAS', estado: 'EN_TRAMITE',
  alcance: 'Licencia de prueba: celda de seguridad y autoclave (en trámite)', disposiciones: ['DF'] } });
const permisoNuevo = r.json;
const subirActo = await llamar('POST', `/permisos-ambientales/${permisoNuevo.id}/documento`, { token: thseq, form: conPdf() });
const sinPermisoCrear = await llamar('POST', '/permisos-ambientales', { token: tcom, cuerpo: { acto: 'Otro acto de prueba', autoridad: 'CAS', alcance: 'Algo que no se debe crear' } });
prueba('permiso o licencia propia nuevo, con su PDF (solo con «permisos.gestionar»)', r.status === 201 && subirActo.status === 201 && sinPermisoCrear.status === 403
  && (await db.permisoDisposicion.count({ where: { permisoId: permisoNuevo.id } })) === 1, `${r.status} ${subirActo.status} ${sinPermisoCrear.status}`);

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

console.log('\n4b. Inspecciones y flota (fase 1c)');
r = await llamar('GET', `/inspecciones?desde=2026-11-01&hasta=2026-11-30&vehiculoId=${veh.id}`, { token: T });
const noAprobada = r.json.filas?.find((p) => p.aprobado === false);
prueba('inspecciones (oficina): por rango y vehículo, con el resumen de aprobadas y no aprobadas', r.status === 200 && r.json.total === 2 && r.json.resumen?.aprobadas === 1
  && r.json.resumen.noAprobadas === 1 && noAprobada?._count.respuestas === 1 && !!noAprobada.conductor?.nombre, JSON.stringify(r.json).slice(0, 300));
r = await llamar('GET', `/inspecciones/${noAprobada.id}`, { token: T });
prueba('…el detalle trae cada ítem con su grupo y el crítico no aprobado', r.status === 200 && r.json.respuestas.length === elementos.json.length
  && r.json.respuestas.some((x) => x.resultado === 'NO_OK' && x.elemento.critico), JSON.stringify(r.json).slice(0, 200));
r = await llamar('GET', '/inspecciones?desde=2026-11-01&hasta=2026-12-31&resultado=no-aprobada', { token: T });
prueba('…y filtra por resultado', r.status === 200 && r.json.total >= 1 && r.json.filas.every((p) => p.aprobado === false), JSON.stringify(r.json).slice(0, 200));
r = await llamar('POST', '/vehiculos', { token: T, cuerpo: { placa: 'xyz-987', tipo: 'Furgón RESPEL', capacidad: 3500, unidadCap: 'KG', soatVence: fechaEn(20), rtmVence: fechaEn(200), polizaRcVence: fechaEn(300) } });
const vehNuevo = r.json;
prueba('flota: crear un vehículo normaliza la placa (xyz-987 → XYZ987)', r.status === 201 && vehNuevo.placa === 'XYZ987', JSON.stringify(r.json).slice(0, 200));
r = await llamar('POST', '/vehiculos', { token: T, cuerpo: { placa: 'XYZ987', tipo: 'Furgón', capacidad: 1 } });
prueba('…no repite una placa', r.status === 400 && /ya está registrada/.test(r.json.mensaje), JSON.stringify(r.json));
r = await llamar('POST', '/vehiculos', { token: T, cuerpo: { placa: '12', tipo: 'Furgón', capacidad: 1 } });
prueba('…y valida el formato de la placa', r.status === 400, JSON.stringify(r.json));
r = await llamar('POST', '/vehiculos', { token: thseq, cuerpo: { placa: 'XYZ988', tipo: 'Furgón', capacidad: 1 } });
prueba('…lo crea quien programa rutas (HSEQ no) → 403', r.status === 403, String(r.status));
r = await llamar('GET', '/alertas', { token: T });
prueba('el SOAT que vence en 20 días sale en las alertas', r.status === 200 && r.json.some((x) => x.tipo === 'flota' && x.titulo.startsWith('XYZ987') && /SOAT/.test(x.titulo)), JSON.stringify(r.json.filter?.((x) => x.tipo === 'flota')).slice(0, 300));
r = await llamar('PATCH', `/vehiculos/${vehNuevo.id}`, { token: T, cuerpo: { soatVence: fechaEn(365) } });
const alertasFlota = await llamar('GET', '/alertas', { token: T });
prueba('…al registrar el SOAT renovado, la alerta desaparece', r.status === 200 && !alertasFlota.json.some((x) => x.titulo.startsWith('XYZ987')), JSON.stringify(r.json).slice(0, 200));
r = await llamar('PATCH', `/vehiculos/${vehNuevo.id}`, { token: T, cuerpo: { activo: false } });
const audVeh = await db.auditoria.findFirst({ where: { entidad: 'vehiculo', entidadId: vehNuevo.id, accion: 'INACTIVAR' } });
prueba('inactivar un vehículo no lo borra y queda en la auditoría', r.status === 200 && r.json.activo === false && !!audVeh, JSON.stringify(r.json).slice(0, 200));

console.log('\n5. Roles y permisos');
const conductor = await db.usuario.upsert({ where: { email: 'conductor.e2e@terravivasas.com' }, update: { intentosFallidos: 0, bloqueadoHasta: null },
  create: { empresaId: yo.empresa ? (await db.empresa.findFirst({ where: { nit: '901089780-8' } })).id : '', rolId: conductorRol.id, nombre: 'Conductor E2E', documento: '1', email: 'conductor.e2e@terravivasas.com', esConductor: true,
    passwordHash: await (await import('@node-rs/argon2')).hash('Conductor2026!', { memoryCost: 19456, timeCost: 2, parallelism: 1 }) } });
const tc = (await aceptarDatos((await llamar('POST', '/auth/login', { cuerpo: { email: conductor.email, clave: 'Conductor2026!' } })).json)).accessToken;
r = await llamar('PATCH', `/declaraciones/${agua.id}/estado`, { token: tc, cuerpo: { estado: 'AUTORIZADA' } });
prueba('un conductor NO puede autorizar declaraciones → 403', r.status === 403 && /permiso/.test(r.json.mensaje));
r = await llamar('GET', '/declaraciones', { token: tc });
prueba('…pero sí puede consultar', r.status === 200);

console.log('\n5b. Usuarios y roles (fase 1c)');
r = await llamar('GET', '/usuarios', { token: thseq });
prueba('usuarios: solo la administración los ve (HSEQ → 403)', r.status === 403, String(r.status));
r = await llamar('GET', '/roles', { token: T });
const rolesE2e = r.json;
const rolComercialId = rolesE2e.roles?.find((x) => x.nombre === 'Comercial')?.id;
prueba('roles con sus permisos (la matriz) y los usuarios activos de cada uno', r.status === 200 && rolesE2e.roles.find((x) => x.nombre === 'HSEQ')?.permisos.includes('importacion.revertir')
  && rolesE2e.permisos.length > 10 && rolesE2e.roles.find((x) => x.nombre === 'Comercial')?.usuariosActivos >= 1, JSON.stringify(rolesE2e).slice(0, 300));
r = await llamar('GET', '/usuarios?q=e2e', { token: T });
prueba('…el listado busca por nombre o correo y nunca trae la contraseña', r.status === 200 && r.json.total >= 3 && !JSON.stringify(r.json).includes('passwordHash'), JSON.stringify(r.json).slice(0, 200));
r = await llamar('POST', '/usuarios', { token: T, cuerpo: { email: 'Nuevo.Comercial@terravivasas.com', nombre: 'Nuevo Comercial', documento: '1098765432', rolId: rolComercialId } });
const nuevoU = r.json;
const invitacion = nuevoU.id ? await db.passwordReset.findFirst({ where: { usuarioId: nuevoU.id }, orderBy: { expiraEn: 'desc' } }) : null;
prueba('invitar un usuario: correo en minúsculas y un enlace de 72 horas para que cree su contraseña', r.status === 201 && nuevoU.email === 'nuevo.comercial@terravivasas.com'
  && !!invitacion && invitacion.expiraEn.getTime() - Date.now() > 70 * 3_600_000, JSON.stringify(r.json).slice(0, 200));
r = await llamar('POST', '/usuarios', { token: T, cuerpo: { email: 'nuevo.comercial@terravivasas.com', nombre: 'Otra Persona', documento: '12345', rolId: rolComercialId } });
prueba('…no repite un correo', r.status === 400 && /Ya existe/.test(r.json.mensaje), JSON.stringify(r.json));
const yoAdmin = (await llamar('GET', '/auth/yo', { token: T })).json;
r = await llamar('PATCH', `/usuarios/${yoAdmin.id}`, { token: T, cuerpo: { activo: false } });
prueba('nadie se inactiva ni se cambia el rol a sí mismo', r.status === 400 && /a sí mismo/.test(r.json.mensaje), JSON.stringify(r.json));
r = await llamar('PATCH', `/usuarios/${nuevoU.id}`, { token: T, cuerpo: { esConductor: true, licenciaCat: 'C2', licenciaVence: fechaEn(30), cursoMpVence: fechaEn(400) } });
prueba('editar: datos de conductor (categoría y vencimiento de la licencia, curso)', r.status === 200 && r.json.esConductor === true && r.json.licenciaCat === 'C2', JSON.stringify(r.json).slice(0, 200));
const temporal = await db.usuario.create({ data: { empresaId: cliente.empresaId, rolId: rolComercialId, nombre: 'Temporal E2E', documento: '777', email: 'temporal.e2e@terravivasas.com',
  passwordHash: await (await import('@node-rs/argon2')).hash('Temporal2026!', { memoryCost: 19456, timeCost: 2, parallelism: 1 }) } });
const tTemporal = (await aceptarDatos((await llamar('POST', '/auth/login', { cuerpo: { email: temporal.email, clave: 'Temporal2026!' } })).json)).accessToken;
prueba('(el usuario temporal ingresa)', (await llamar('GET', '/auth/yo', { token: tTemporal })).status === 200);
r = await llamar('PATCH', `/usuarios/${temporal.id}`, { token: T, cuerpo: { activo: false } });
const trasInactivar = await llamar('GET', '/auth/yo', { token: tTemporal });
prueba('inactivar a un usuario cierra sus sesiones de inmediato', r.status === 200 && r.json.activo === false && trasInactivar.status === 401, `${r.status} ${trasInactivar.status}`);
r = await llamar('POST', `/usuarios/${temporal.id}/invitacion`, { token: T });
prueba('…y no se le envía invitación mientras esté inactivo', r.status === 400, JSON.stringify(r.json));
await db.usuario.update({ where: { id: nuevoU.id }, data: { intentosFallidos: 5, bloqueadoHasta: new Date(Date.now() + 15 * 60_000) } });
r = await llamar('GET', '/usuarios?q=nuevo.comercial', { token: T });
prueba('un usuario bloqueado por intentos fallidos aparece bloqueado', r.status === 200 && r.json.filas[0]?.bloqueado === true, JSON.stringify(r.json).slice(0, 200));
r = await llamar('PATCH', `/usuarios/${nuevoU.id}`, { token: T, cuerpo: { desbloquear: true } });
prueba('…y la administración lo desbloquea', r.status === 200 && r.json.bloqueado === false, JSON.stringify(r.json).slice(0, 200));
r = await llamar('POST', `/usuarios/${nuevoU.id}/invitacion`, { token: T });
prueba('reenviar la invitación crea un enlace nuevo', r.status === 204 && (await db.passwordReset.count({ where: { usuarioId: nuevoU.id } })) === 2, String(r.status));
// Administrador de prueba (para revisar en el navegador las pantallas de administración sobre la base de prueba)
const rolAdminE2e = await db.rol.findFirst({ where: { nombre: 'Administrador', empresaId: cliente.empresaId } });
await db.usuario.upsert({ where: { email: 'admin.e2e@terravivasas.com' }, update: {}, create: { empresaId: cliente.empresaId, rolId: rolAdminE2e.id, nombre: 'Administrador E2E', documento: '5', email: 'admin.e2e@terravivasas.com',
  passwordHash: await (await import('@node-rs/argon2')).hash('AdminE2E2026!', { memoryCost: 19456, timeCost: 2, parallelism: 1 }) } });

console.log('\n6. Multiempresa (aislamiento de datos)');
const otra = await db.empresa.upsert({ where: { nit: '800000001-1' }, update: {}, create: { nit: '800000001-1', razonSocial: 'Otra Empresa Prueba' } });
const rolOtra = await db.rol.upsert({ where: { empresaId_nombre: { empresaId: otra.id, nombre: 'Administrador' } }, update: {}, create: { empresaId: otra.id, nombre: 'Administrador' } });
const todo = await db.permiso.findUnique({ where: { codigo: '*' } });
await db.rolPermiso.upsert({ where: { rolId_permisoId: { rolId: rolOtra.id, permisoId: todo.id } }, update: {}, create: { rolId: rolOtra.id, permisoId: todo.id } });
await db.usuario.upsert({ where: { email: 'admin@otra.com' }, update: {}, create: { empresaId: otra.id, rolId: rolOtra.id, nombre: 'Admin otra', documento: '2', email: 'admin@otra.com', passwordHash: await (await import('@node-rs/argon2')).hash('OtraClave2026!', { memoryCost: 19456, timeCost: 2, parallelism: 1 }) } });
const to = (await aceptarDatos((await llamar('POST', '/auth/login', { cuerpo: { email: 'admin@otra.com', clave: 'OtraClave2026!' } })).json)).accessToken;
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
/** Cola de trabajos: pide el archivo, espera a que esté listo y lo baja con su enlace firmado (sin sesión). */
async function porLaCola(ruta, cuerpo, token) {
  const r = await llamar('POST', ruta, { token, cuerpo });
  if (r.status !== 202) return { status: r.status, json: r.json };
  let t = r.json;
  for (let i = 0; i < 120 && ['PENDIENTE', 'EN_CURSO'].includes(t.estado); i++) { await new Promise((ok) => setTimeout(ok, 250)); t = (await llamar('GET', `/trabajos/${t.id}`, { token })).json; }
  if (t.estado !== 'LISTO') return { status: 500, trabajo: t };
  const e = await llamar('POST', `/trabajos/${t.id}/enlace`, { token, cuerpo: {} });
  const x = await fetch(e.json.url.startsWith('/') ? API + e.json.url : e.json.url);
  return { status: x.status, tipo: x.headers.get('content-type'), disposicion: x.headers.get('content-disposition') ?? '', buf: Buffer.from(await x.arrayBuffer()), trabajo: t, enlace: e.json };
}
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
prueba('manifiesto de cargue desde la ruta, con consecutivo', r.status === 201 && r.json.length === 1 && /^TV\d{4,}$/.test(r.json[0].numero), JSON.stringify(r.json).slice(0, 200));
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
const enlaceFirma = await llamar('GET', `/archivos/enlace?clave=${encodeURIComponent(r.json.firmaUrl)}`, { token: T8 });
const porEnlace = await fetch(API + enlaceFirma.json.url);
prueba('archivos: enlace firmado de 5 minutos que sirve sin sesión (en S3 lo firma el almacenamiento)', enlaceFirma.status === 200 && /^\/archivos\/d\//.test(enlaceFirma.json.url)
  && new Date(enlaceFirma.json.vence) - Date.now() <= 5 * 60_000 && porEnlace.status === 200 && porEnlace.headers.get('content-type') === 'image/png', `${enlaceFirma.status} ${porEnlace.status}`);
const alterado = await fetch(API + enlaceFirma.json.url.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')));
prueba('…un enlace alterado no sirve → 403', alterado.status === 403, String(alterado.status));
prueba('…ni pide un enlace a un archivo de otra empresa → 403', (await llamar('GET', `/archivos/enlace?clave=${encodeURIComponent(r.json.firmaUrl)}`, { token: to })).status === 403);
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
const xls = await porLaCola(`/conciliaciones/${concB.id}/excel`, {}, T8);
prueba('exportar la conciliación a Excel: se prepara en la cola y se baja con enlace firmado', xls.status === 200 && xls.buf?.subarray(0, 2).toString() === 'PK' && /attachment/.test(xls.disposicion)
  && /conciliacion-.*\.xlsx/.test(xls.disposicion), JSON.stringify(xls.trabajo ?? xls.json).slice(0, 200));
r = await llamar('POST', `/manifiestos/${mfB.id}/anular`, { token: T8, cuerpo: { motivo: 'Prueba' } });
prueba('no se anula un manifiesto con conciliación aprobada → 409', r.status === 409 && /conciliación aprobada/.test(r.json.mensaje), JSON.stringify(r.json));

r = await llamar('GET', `/actas/pendientes?clienteId=${suc.clienteId}`, { token: T8 });
prueba('la línea aprobada queda pendiente de certificar', r.status === 200 && r.json.some((x) => x.id === lineaB));
r = await llamar('POST', '/actas', { token: T8, cuerpo: { clienteId: suc.clienteId, periodoDesde: '2026-11-01', periodoHasta: '2026-11-30' } });
prueba('crear el acta del periodo con las líneas aprobadas (número PSAP{año}-{n})', r.status === 201 && /^PSAP\d{4}-\d+$/.test(r.json.numero), JSON.stringify(r.json));
const actaB = r.json;
r = await llamar('POST', `/actas/${actaB.id}/emitir`, { token: T8 });
prueba('emitir: copia fija con soporte legal (Res. DGL 000632 de 2023) y PDF', r.status === 201 && r.json.estado === 'EMITIDA' && r.json.pdfUrl && JSON.stringify(r.json.contenido).includes('000632 de 2023'), JSON.stringify(r.json).slice(0, 300));
const textoDe = (cod) => r.json.contenido?.textosLegales?.find((t) => t.codigo === cod)?.texto ?? '';
prueba('…los textos legales se soportan en los permisos registrados (sin marcadores sin llenar)', /se soporta en: .*000632 de 2023 \(CAS\)/.test(textoDe('CERTIFICACION'))
  && !JSON.stringify(r.json.contenido?.textosLegales ?? []).match(/\{permiso|sin permiso vigente/), textoDe('CERTIFICACION').slice(-200));
const codigo = r.json.codigoVerificacion;
prueba('el QR lleva a la página pública de verificación', r.json.urlVerificacion?.endsWith(`/#verificar/${codigo}`), r.json.urlVerificacion);
const pdf = await descargar(`/actas/${actaB.id}/pdf`, T8);
prueba('el certificado se descarga en PDF', pdf.status === 200 && pdf.buf.subarray(0, 4).toString() === '%PDF' && pdf.buf.length > 3000);
r = await llamar('GET', `/verificar/${codigo}`);
prueba('verificación pública del QR (sin sesión): auténtico y vigente, sin datos del cliente', r.status === 200 && r.json.valido === true && !JSON.stringify(r.json).includes('Agroindustrial'), JSON.stringify(r.json));
r = await llamar('GET', '/verificar/0123456789abcdef01234567');
prueba('un código que no existe → 404', r.status === 404);
const zip = await porLaCola('/actas/zip', { ids: [actaB.id] }, T8);
prueba('descarga masiva de actas en ZIP: el API responde de inmediato (202) y la cola lo prepara', zip.status === 200 && zip.buf?.subarray(0, 2).toString() === 'PK'
  && zip.trabajo.titulo === '1 certificado en ZIP' && !!zip.trabajo.venceEn, JSON.stringify(zip.trabajo ?? zip.json).slice(0, 200));
prueba('…solo con el permiso de exportar: un conductor → 403', (await llamar('POST', '/actas/zip', { token: tc, cuerpo: { ids: [actaB.id] } })).status === 403);
r = await llamar('GET', '/trabajos', { token: T8 });
const otros = await Promise.all([llamar('GET', `/trabajos/${zip.trabajo.id}`, { token: to }), llamar('POST', `/trabajos/${zip.trabajo.id}/enlace`, { token: thseq, cuerpo: {} })]);
prueba('«Mis descargas»: cada quien ve lo suyo (otro usuario u otra empresa → 404)', r.status === 200 && r.json.some((t) => t.id === zip.trabajo.id && t.estado === 'LISTO' && t.descargadoEn)
  && otros.every((x) => x.status === 404), JSON.stringify(otros.map((x) => x.status)));
await db.trabajo.update({ where: { id: zip.trabajo.id }, data: { venceEn: new Date(Date.now() - 1000) } });
r = await llamar('POST', `/trabajos/${zip.trabajo.id}/enlace`, { token: T8, cuerpo: {} });
prueba('…el archivo preparado vence (es una copia: se pide de nuevo)', r.status === 400 && /venció/.test(r.json.mensaje), JSON.stringify(r.json));
const vacio = await llamar('POST', '/actas/zip', { token: T8, cuerpo: { ids: [randomUUID()] } });
prueba('…sin certificados emitidos en la selección no se encola → 404', vacio.status === 404, String(vacio.status));
prueba('…y la exportación queda en la auditoría', (await db.auditoria.count({ where: { entidad: 'acta', accion: 'EXPORTAR' } })) >= 1);
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
const receptor = { firmaReceptor: `data:image/png;base64,${PNG}`, receptorNombre: 'Receptor de planta', receptorDocumento: '1098000111' };
r = await llamar('POST', `/manifiestos/${mfD.id}/grabar`, { token: T8, cuerpo: { ...firma, ...receptor, horaLlegada: '2026-11-26T08:00:00-05:00', horaSalida: '2026-11-26T08:30:00-05:00', pesoEntrada: 12000, pesoSalida: 11900 } });
prueba('descargue sin ARL ni EPS del conductor → 409', r.status === 409 && /ARL y EPS del conductor/.test(r.json.mensaje), JSON.stringify(r.json));
r = await llamar('PATCH', `/manifiestos/${mfD.id}`, { token: T8, cuerpo: { transporte: { empresaTransportadora: 'Transportes del Magdalena', placa: 'XYZ123', conductorNombre: 'Conductor tercero', conductorDocumento: '91234567', conductorArlId: ops.arl[0].id, conductorEpsId: ops.eps[0].id } } });
r = await llamar('POST', `/manifiestos/${mfD.id}/grabar`, { token: T8, cuerpo: { ...firma, horaLlegada: '2026-11-26T08:00:00-05:00', horaSalida: '2026-11-26T08:30:00-05:00', pesoEntrada: 12000, pesoSalida: 11900 } });
prueba('descargue sin la firma del receptor de Terra Viva → 400', r.status === 400 && /receptor/.test(r.json.mensaje), JSON.stringify(r.json));
r = await llamar('POST', `/manifiestos/${mfD.id}/grabar`, { token: T8, cuerpo: { ...firma, ...receptor, horaLlegada: '2026-11-26T08:00:00-05:00', horaSalida: '2026-11-26T08:30:00-05:00', pesoEntrada: 12000, pesoSalida: 11900 } });
prueba('con ARL, EPS y las dos firmas el descargue se graba', r.status === 201 && r.json.estado === 'REALIZADO', JSON.stringify(r.json).slice(0, 200));
r = await llamar('POST', `/manifiestos/${mfD.id}/anular`, { token: T8, cuerpo: { causalId: (await db.catalogoItem.findFirst({ where: { tipo: 'CAUSAL' } })).id } });
const lineaD = await db.solicitudItem.findFirst({ where: { solicitudId: solD.id } });
prueba('anular el descargue: la conciliación queda ANULADA (nada legal se borra) y la línea vuelve a pendiente', r.status === 201 && (await db.conciliacion.findUnique({ where: { manifiestoId: mfD.id } }))?.estado === 'ANULADA' && lineaD.estado === 'PENDIENTE');

// Documentos reales: las solicitudes automáticas se agrupan por sede y fecha (antes, una por residuo)
const sedePrincipal = await db.sucursal.findFirst({ where: { clienteId: suc.clienteId, esPrincipal: true } });
const servicios = await db.declaracion.findMany({ where: { clienteId: suc.clienteId, solicitudAutomatica: true, tipo: 'SERVICIO' }, orderBy: { numero: 'asc' } });
r = await llamar('POST', '/manifiestos', { token: T8, cuerpo: { tipo: 'CARGUE', clienteId: suc.clienteId, fechaServicio: '2026-11-27', vehiculoId: veh.id, conductorId: yo.id,
  items: servicios.map((d) => ({ declaracionId: d.id, sucursalId: sedePrincipal.id, cantidad: 1 })) } });
const mfAuto = r.json;
r = await llamar('POST', `/manifiestos/${mfAuto.id}/grabar`, { token: T8, cuerpo: { ...firma, horaLlegada: '2026-11-27T08:00:00-05:00', horaSalida: '2026-11-27T09:00:00-05:00' } });
const recurrentes = await db.solicitud.findMany({ where: { manifiestoOrigenId: mfAuto.id }, include: { items: true } });
prueba('dos servicios con solicitud automática → UNA solicitud recurrente con dos ítems (misma sede y fecha)', r.status === 201 && servicios.length === 2 && recurrentes.length === 1
  && recurrentes[0].items.length === 2 && recurrentes[0].fechaSolicitada.toISOString().slice(0, 10) === '2026-12-12', JSON.stringify({ g: r.status, m: r.json.mensaje, recurrentes }).slice(0, 300));

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

// Documentos reales: numeración TV/PSAP, recepción en planta con NIT y dos firmas, recibo y manifiesto en PDF
r = await llamar('GET', '/empresa', { token: T8 });
prueba('Datos de la empresa: la numeración de manifiestos es TV####', r.status === 200 && /^TV\d{4}$/.test(r.json.consecutivos.find((c) => c.documento === 'MANIFIESTO')?.siguiente), JSON.stringify(r.json.consecutivos));
r = await llamar('PATCH', '/empresa/consecutivos/MANIFIESTO', { token: T8, cuerpo: { ultimo: 1830 } });
prueba('continuar la serie del sistema anterior: el siguiente es TV1831', r.status === 200 && r.json.consecutivos.find((c) => c.documento === 'MANIFIESTO').siguiente === 'TV1831', JSON.stringify(r.json));
r = await llamar('PATCH', '/empresa/consecutivos/MANIFIESTO', { token: T8, cuerpo: { ultimo: 10 } });
prueba('bajar el último número → 400 (se repetirían números)', r.status === 400);
r = await llamar('POST', '/manifiestos', { token: T8, cuerpo: { tipo: 'DESCARGUE', clienteId: suc.clienteId, fechaServicio: '2026-11-28',
  transporte: { empresaTransportadora: 'Limpieza y Logística E2E', nit: '901234567', placa: 'LPM847', tipoVehiculo: 'Vacuum', conductorNombre: 'Conductor del cliente', conductorDocumento: '91000111', conductorArlId: ops.arl[0].id, conductorEpsId: ops.eps[0].id },
  items: [{ declaracionId: lodo.id, sucursalId: suc.id, cantidad: 12 }] } });
const mfTv = r.json;
prueba('recepción de un transportador externo con NIT: el manifiesto queda TV1831', r.status === 201 && mfTv.numero === 'TV1831', JSON.stringify(r.json).slice(0, 200));
r = await llamar('POST', `/manifiestos/${mfTv.id}/grabar`, { token: T8, cuerpo: { ...firma, ...receptor, horaLlegada: '2026-11-28T07:00:00-05:00', horaSalida: '2026-11-28T07:40:00-05:00', pesoEntrada: 18500, pesoSalida: 6400 } });
prueba('…se graba con las dos firmas y báscula (neto 12.100 kg)', r.status === 201 && Number(r.json.pesoNeto) === 12100 && r.json.receptorNombre === 'Receptor de planta' && r.json.transporte?.nit === '901234567', JSON.stringify(r.json).slice(0, 300));
const pdfMf = await descargar(`/manifiestos/${mfTv.id}/pdf`, T8);
const recibo = await descargar(`/manifiestos/${mfTv.id}/recibo`, T8);
prueba('manifiesto completo y recibo angosto en PDF (mismo número)', pdfMf.status === 200 && pdfMf.buf.subarray(0, 4).toString() === '%PDF' && recibo.status === 200 && recibo.buf.subarray(0, 4).toString() === '%PDF');
// Respuestas de la gerencia: Los Pinos no recibe ni almacena peligrosos; van directo al gestor aliado
r = await llamar('POST', '/manifiestos', { token: T8, cuerpo: { tipo: 'DESCARGUE', clienteId: suc.clienteId, fechaServicio: '2026-11-28',
  transporte: { empresaTransportadora: 'Limpieza y Logística E2E', nit: '901234567', placa: 'LPM847', tipoVehiculo: 'Vacuum', conductorNombre: 'Conductor del cliente', conductorDocumento: '91000111', conductorArlId: ops.arl[0].id, conductorEpsId: ops.eps[0].id },
  items: [{ declaracionId: aceite.id, sucursalId: suc.id, cantidad: 5 }] } });
prueba('Los Pinos no recibe un residuo peligroso (Res. 000632, art. 6) → 409', r.status === 409 && /no puede recibir/.test(r.json.mensaje), JSON.stringify(r.json).slice(0, 200));
const gestorCgs = await db.proveedor.findFirst({ where: { nit: '901483038-1' } });
r = await llamar('POST', '/manifiestos', { token: T8, cuerpo: { tipo: 'CARGUE', clienteId: suc.clienteId, destinoId: gestorCgs.id, fechaServicio: '2026-11-29', vehiculoId: veh.id, conductorId: yo.id,
  items: [{ declaracionId: aceite.id, sucursalId: suc.id, cantidad: 40 }] } });
const mfAliado = r.json;
prueba('el peligroso se recoge con destino directo al gestor aliado (CGS)', r.status === 201 && mfAliado.destinoId === gestorCgs.id, JSON.stringify(r.json).slice(0, 200));
r = await llamar('POST', `/manifiestos/${mfAliado.id}/grabar`, { token: T8, cuerpo: { ...firma, horaLlegada: '2026-11-29T08:00:00-05:00', horaSalida: '2026-11-29T09:00:00-05:00' } });
const concAliado = await db.conciliacion.findUnique({ where: { manifiestoId: mfAliado.id }, include: { items: true } });
await llamar('POST', `/conciliaciones/${concAliado.id}/igualar`, { token: T8, cuerpo: {} });
r = await llamar('POST', `/conciliaciones/${concAliado.id}/aprobar`, { token: T8 });
prueba('…se graba y se aprueba su conciliación', r.status === 201 && r.json.estado === 'APROBADA', JSON.stringify(r.json).slice(0, 200));
r = await llamar('POST', '/actas', { token: T8, cuerpo: { clienteId: suc.clienteId, periodoDesde: '2026-11-29', periodoHasta: '2026-11-29', conciliacionItemIds: [concAliado.items[0].id] } });
const actaAliado = r.json;
r = await llamar('POST', `/actas/${actaAliado.id}/emitir`, { token: T8 });
prueba('sin el número del certificado del gestor aliado no se emite el certificado final', r.status === 400 && /certificado del gestor aliado/.test(r.json.mensaje), JSON.stringify(r.json).slice(0, 200));
r = await llamar('PATCH', `/actas/lineas/${concAliado.items[0].id}/certificado-aliado`, { token: T8, cuerpo: { numero: 'CGS-2026-0457' } });
prueba('registrar en la línea el número del certificado del aliado', r.status === 200 && r.json.certificadoAliado === 'CGS-2026-0457', JSON.stringify(r.json).slice(0, 200));
r = await llamar('POST', `/actas/${actaAliado.id}/emitir`, { token: T8 });
const textosAliado = r.json.contenido?.textosLegales ?? [];
const textoGestor = textosAliado.find((x) => x.codigo === 'GESTOR_ALIADO')?.texto ?? '';
prueba('…ya se emite: el texto del aliado lleva su razón social, NIT, licencia, autoridad y el número de su certificado', r.status === 201
  && /Centro de Gestión Sostenible/.test(textoGestor) && textoGestor.includes('901483038-1') && textoGestor.includes('CAR Cundinamarca') && textoGestor.includes('CGS-2026-0457') && !textoGestor.includes('{'), textoGestor.slice(0, 300));
prueba('…y con un peligroso salen la certificación y los textos de responsabilidad y transporte de RESPEL', ['CERTIFICACION', 'RESPONSABILIDAD_RESPEL', 'TRANSPORTE_RESPEL'].every((c) => textosAliado.some((x) => x.codigo === c))
  && !textosAliado.some((x) => x.codigo === 'BIORREMEDIACION'), JSON.stringify(textosAliado.map((x) => x.codigo)));
// Facturación por contrato: la línea no necesita precio
const concAuto = await db.conciliacion.findUnique({ where: { manifiestoId: mfAuto.id }, include: { items: true } });
r = await llamar('PATCH', `/conciliaciones/${concAuto.id}/items`, { token: T8, cuerpo: { items: concAuto.items.map((i) => ({ id: i.id, tipoNegociacion: 'CONTRATO', precioUnitario: null })) } });
await llamar('POST', `/conciliaciones/${concAuto.id}/igualar`, { token: T8, cuerpo: {} });
r = await llamar('POST', `/conciliaciones/${concAuto.id}/aprobar`, { token: T8 });
prueba('facturación por contrato: se aprueba sin precio y no suma al cobro', r.status === 201 && r.json.estado === 'APROBADA' && r.json.totales.cobro === 0, JSON.stringify(r.json).slice(0, 300));
// Certificado por generador de un cliente gestor, con textos legales que aplican, firma y hash
r = await llamar('PATCH', '/empresa/configuracion', { token: T8, cuerpo: { ciudadFirma: 'Sabana de Torres', representanteLegal: 'Representante E2E', certificaciones: [{ norma: 'ISO 9001:2015', numero: 'CO-SC-123' }] } });
prueba('configurar ciudad de firma, representante y certificaciones', r.status === 200 && r.json.configuracion.ciudadFirma === 'Sabana de Torres');
await db.cliente.update({ where: { id: suc.clienteId }, data: { tipo: 'GESTOR' } });
await db.sucursal.update({ where: { id: suc.id }, data: { generadorNit: '800111222', generadorNombre: 'Generador Tercero S.A.S.' } });
r = await llamar('POST', '/actas', { token: T8, cuerpo: { clienteId: suc.clienteId, periodoDesde: '2026-11-01', periodoHasta: '2026-11-30', porGenerador: true } });
const actaGen = r.json.actas?.find((x) => x.generadorNit === '800111222');
prueba('cliente gestor: un certificado por generador, a nombre del generador', r.status === 201 && actaGen?.generadorNombre === 'Generador Tercero S.A.S.' && /^PSAP\d{4}-\d+$/.test(actaGen.numero), JSON.stringify(r.json).slice(0, 300));
r = await llamar('POST', `/actas/${actaGen.id}/emitir`, { token: T8 });
const contenido = r.json.contenido ?? {};
const textos = (contenido.textosLegales ?? []).map((t) => t.codigo);
prueba('el certificado lleva al generador, la firma con ciudad y representante, y la certificación ISO', r.status === 201 && contenido.version === 3 && contenido.generador?.razonSocial === 'Generador Tercero S.A.S.'
  && contenido.firma?.ciudad === 'Sabana de Torres' && contenido.certificaciones?.some((c) => c.numero === 'CO-SC-123'), JSON.stringify(contenido).slice(0, 300));
prueba('solo los textos legales que aplican: certificación y biorremediación; sin peligrosos no van los de RESPEL; no RCD', textos.includes('CERTIFICACION') && textos.includes('BIORREMEDIACION') && !textos.includes('RCD')
  && !textos.includes('RESPONSABILIDAD_RESPEL') && !textos.includes('TRANSPORTE_RESPEL') && !textos.includes('RESPONSABILIDAD'), JSON.stringify(textos));
const pdfGen = await descargar(`/actas/${actaGen.id}/pdf`, T8);
const { createHash } = await import('node:crypto');
prueba('se guarda el hash SHA-256 del PDF emitido y coincide con el descargado', r.json.pdfSha256 === createHash('sha256').update(pdfGen.buf).digest('hex'));
r = await llamar('GET', `/verificar/${r.json.codigoVerificacion}`);
prueba('la verificación pública muestra solo número, fecha y validez', r.status === 200 && r.json.valido && r.json.numero && !('periodo' in r.json) && !('tipo' in r.json), JSON.stringify(r.json));

// Certificado con RCD (modelo oficial de Terra Viva): constancia del Anexo II de la Res. 1257 de 2021, en toneladas por tipo
r = await llamar('POST', '/declaraciones', { token: T8, cuerpo: { ...formulario, clienteId: suc.clienteId, alcanceSedes: 'TODAS', nombre: 'Escombros de demolición', codigoInterno: 'RCD-E2E',
  categoriaId: idDe(cat.categorias, 'ESPEC'), esPeligroso: false, codigoYId: null, codigoUn: null, riesgoIds: [], etiquetadoIds: [], composicion: null, estadoFisico: 'SOLIDO', inflamable: false,
  densidad: null, metricaDensidadId: null, disposiciones: [{ disposicionId: idDe(cat.disposiciones, 'RCD') }], precio: { precioUnitario: 45000, metricaId: idDe(cat.metricasPrecio, 'ton') } } });
const declRcd = r.json;
r = await llamar('PATCH', `/declaraciones/${declRcd.id}/estado`, { token: T8, cuerpo: { estado: 'AUTORIZADA' } });
prueba('declaración de RCD autorizada (todavía sin su tipo del Anexo II)', r.status === 200 && r.json.estado === 'AUTORIZADA', JSON.stringify(r.json).slice(0, 200));
r = await llamar('POST', '/manifiestos', { token: T8, cuerpo: { tipo: 'DESCARGUE', clienteId: suc.clienteId, fechaServicio: '2026-11-30',
  transporte: { empresaTransportadora: 'Volquetas E2E', nit: '901555444', placa: 'RCD123', tipoVehiculo: 'Volqueta', conductorNombre: 'Conductor volqueta', conductorDocumento: '91000222',
    conductorArlId: ops.arl[0].id, conductorEpsId: ops.eps[0].id },
  items: [{ declaracionId: declRcd.id, sucursalId: suc.id, cantidad: 12 }] } });
const mfRcd = r.json;
r = await llamar('POST', `/manifiestos/${mfRcd.id}/grabar`, { token: T8, cuerpo: { ...firma, ...receptor, horaLlegada: '2026-11-30T08:00:00-05:00', horaSalida: '2026-11-30T08:30:00-05:00', pesoEntrada: 22000, pesoSalida: 10000 } });
prueba('descargue de RCD de una volqueta externa: se graba', r.status === 201 && r.json.estado === 'REALIZADO', JSON.stringify(r.json).slice(0, 200));
const concRcd = await db.conciliacion.findUnique({ where: { manifiestoId: mfRcd.id }, include: { items: true } });
await llamar('POST', `/conciliaciones/${concRcd.id}/igualar`, { token: T8, cuerpo: {} });
await llamar('POST', `/conciliaciones/${concRcd.id}/aprobar`, { token: T8 });
r = await llamar('POST', '/actas', { token: T8, cuerpo: { clienteId: suc.clienteId, periodoDesde: '2026-11-30', periodoHasta: '2026-11-30', conciliacionItemIds: [concRcd.items[0].id] } });
const actaRcd = r.json;
r = await llamar('POST', `/actas/${actaRcd.id}/emitir`, { token: T8 });
prueba('sin el tipo de RCD (Anexo II) el certificado no se emite', r.status === 400 && /tipo de RCD/.test(r.json.mensaje), JSON.stringify(r.json).slice(0, 250));
await db.declaracion.update({ where: { id: declRcd.id }, data: { tipoRcd: 'PETREOS' } });
r = await llamar('POST', `/actas/${actaRcd.id}/emitir`, { token: T8 });
const bloqueRcd = r.json.contenido?.rcd?.[0];
prueba('…con el tipo, sale la constancia de RCD: toneladas por numeral, a nombre del generador, gestor de disposición final', r.status === 201 && r.json.contenido.version === 3
  && bloqueRcd?.cantidades.find((q) => q.codigo === 'PETREOS')?.toneladas === 12 && bloqueRcd.total === 12 && bloqueRcd.generador.razonSocial === 'Generador Tercero S.A.S.'
  && bloqueRcd.gestor.tipo === 'DISPOSICION_FINAL' && bloqueRcd.recepcion.desde === '2026-11-30', JSON.stringify(r.json.contenido?.rcd ?? r.json).slice(0, 300));
const textosRcd = r.json.contenido?.textosLegales ?? [];
prueba('…lo recibió Terra Viva en planta (no lo recogió): la entrada lo dice, va el NIT del transportador y no el texto de transporte de RESPEL',
  /recepción en planta/.test(textosRcd.find((t) => t.codigo === 'CERTIFICACION')?.texto ?? '') && !textosRcd.some((t) => t.codigo === 'TRANSPORTE_RESPEL')
  && textosRcd.some((t) => t.codigo === 'RCD') && !textosRcd.some((t) => /\{\w+\}/.test(t.texto)) && r.json.contenido.transporte.some((t) => t.nit === '901555444'),
  JSON.stringify(textosRcd.map((t) => t.codigo)));
const pdfRcd = await descargar(`/actas/${actaRcd.id}/pdf`, T8);
prueba('…y el PDF sale con el modelo oficial y la constancia de RCD', pdfRcd.status === 200 && pdfRcd.buf.subarray(0, 4).toString() === '%PDF' && pdfRcd.buf.length > 20000, String(pdfRcd.buf.length));

r = await llamar('GET', '/informes/rutas/rendimiento?desde=2026-11-25&hasta=2026-11-25', { token: T8 });
const rend = r.json.rutas?.find((x) => x.rutaId === rutaB.id);
prueba('informe de rendimiento: 1 de 1 servicios ejecutados (100 %)', r.status === 200 && rend?.habilitados === 1 && rend.ejecutados === 1 && rend.cumplimientoRuta === 100, JSON.stringify(r.json).slice(0, 300));
const costos = await porLaCola('/informes/rutas/costos/excel', { desde: '2026-11-25', hasta: '2026-11-25' }, T8);
prueba('informe de costos de flete en Excel (por la cola)', costos.status === 200 && costos.buf?.subarray(0, 2).toString() === 'PK', JSON.stringify(costos.trabajo ?? costos.json).slice(0, 200));
r = await llamar('GET', '/informes/rutas/costos?desde=2026-11-25&hasta=2026-11-25&formato=xlsx', { token: T8 });
prueba('…el Excel ya no se arma durante la petición: se pide aparte → 400 con instrucciones', r.status === 400 && /Exportar a Excel/.test(r.json.mensaje), JSON.stringify(r.json));

r = await llamar('POST', '/auth/salir-todos', { token: to });
const trasSalir = await llamar('GET', '/auth/yo', { token: to });
prueba('cerrar la sesión en todos los dispositivos', r.status === 204 && trasSalir.status === 401);
// Consolidado sumado en la base: coincide con la suma de la bandeja
r = await llamar('GET', '/conciliaciones/consolidado', { token: T8 });
const bandeja = await llamar('GET', '/conciliaciones?porPagina=500', { token: T8 });
const sumaCobro = Math.round(bandeja.json.filas.filter((c) => c.estado !== 'ANULADA').reduce((x, c) => x + c.totales.cobro, 0) * 100) / 100;
prueba('consolidado sumado en la base: coincide con la bandeja', r.status === 200 && r.json.totales.cobro === sumaCobro && r.json.conciliaciones >= 1, JSON.stringify({ consolidado: r.json.totales?.cobro, sumaCobro }));
const aud = await db.auditoria.count();
prueba(`la auditoría registró los cambios (${aud} eventos)`, aud > 10);
prueba('…con la IP de cada petición', (await db.auditoria.count({ where: { ip: { not: null } } })) > 10);
let inmutable = false;
try { await db.auditoria.deleteMany({ where: { accion: 'LOGIN' } }); } catch (e) { inmutable = /no se modifica ni se borra/.test(String(e)); }
prueba('…y nadie la puede borrar ni modificar (ni escribiendo en la base)', inmutable);

console.log('\n8b. Indicadores e inicio (fase 1c)');
r = await llamar('GET', '/informes/indicadores?desde=2026-01-01&hasta=2026-12-31', { token: T8 });
const indic = r.json;
prueba('indicadores: totales, serie por mes y repartos, con los datos de las conciliaciones', r.status === 200 && indic.totales.servicios >= 1 && indic.serie.length >= 1
  && indic.porCliente.length >= 1 && indic.porVehiculo.length >= 1, JSON.stringify(indic).slice(0, 300));
const sumaDestinos = Math.round((indic.porDestino ?? []).reduce((a, x) => a + x.toneladas, 0) * 100) / 100;
prueba('…las toneladas por destino suman el total', Math.abs(sumaDestinos - indic.totales.toneladas) < 0.05, `${sumaDestinos} vs ${indic.totales.toneladas}`);
r = await llamar('GET', '/conciliaciones/consolidado?desde=2026-01-01&hasta=2026-12-31', { token: T8 });
prueba('…lo facturado coincide con el consolidado de conciliaciones del mismo rango', r.status === 200 && Math.abs(indic.totales.facturado - r.json.totales.cobro) < 0.01, `${indic.totales.facturado} vs ${r.json.totales?.cobro}`);
r = await llamar('GET', '/informes/indicadores?desde=2026-12-31&hasta=2026-01-01', { token: T8 });
prueba('…un rango al revés → 400', r.status === 400, String(r.status));
const rolAuxiliar = await db.rol.findFirst({ where: { nombre: 'Auxiliar', empresaId: cliente.empresaId } });
const auxiliarE2e = await db.usuario.upsert({ where: { email: 'auxiliar.e2e@terravivasas.com' }, update: {}, create: { empresaId: cliente.empresaId, rolId: rolAuxiliar.id, nombre: 'Auxiliar E2E', documento: '6',
  email: 'auxiliar.e2e@terravivasas.com', esAuxiliar: true, passwordHash: await (await import('@node-rs/argon2')).hash('Auxiliar2026!', { memoryCost: 19456, timeCost: 2, parallelism: 1 }) } });
const tAux = (await aceptarDatos((await llamar('POST', '/auth/login', { cuerpo: { email: auxiliarE2e.email, clave: 'Auxiliar2026!' } })).json)).accessToken;
r = await llamar('GET', '/informes/indicadores?desde=2026-01-01&hasta=2026-12-31', { token: tAux });
prueba('…sin el permiso «informes.ver» (auxiliar) no se ven → 403', r.status === 403, String(r.status));
r = await llamar('GET', '/informes/recepcion-planta?desde=2026-01-01&hasta=2026-12-31', { token: T8 });
const enLosPinos = (indic.porDestino ?? []).find((x) => /Los Pinos/.test(x.nombre))?.toneladas ?? 0;
prueba('inventario: lo recibido en Los Pinos por tratamiento coincide con su parte en los indicadores', r.status === 200 && Math.abs(r.json.toneladas - enLosPinos) < 0.05
  && r.json.tratamientos.every((t) => t.servicios >= 1 && t.primera <= t.ultima), JSON.stringify(r.json).slice(0, 300));
r = await llamar('GET', '/informes/recepcion-planta?desde=2026-01-01&hasta=2026-12-31', { token: tAux });
prueba('…sin «informes.ver» no se ve → 403', r.status === 403, String(r.status));
r = await llamar('GET', '/informes/inicio', { token: T8 });
prueba('inicio: cadena del mes, agenda, obligaciones y cifras del mes para quien ve informes', r.status === 200 && typeof r.json.cadena?.solicitadas === 'number' && r.json.negocio !== null
  && Array.isArray(r.json.obligaciones) && Array.isArray(r.json.rutasHoy) && typeof r.json.agenda?.semana === 'number', JSON.stringify(r.json).slice(0, 300));
r = await llamar('GET', '/informes/inicio', { token: tAux });
prueba('…quien no ve informes recibe la operación, sin cifras de dinero', r.status === 200 && r.json.negocio === null && typeof r.json.cadena?.programadas === 'number', JSON.stringify(r.json).slice(0, 200));

console.log('\n9. Portal de clientes: doble barrera (requisitos de producción §2)');
const clienteA = await db.cliente.findUnique({ where: { id: suc.clienteId } });
const hashFijo = async (clave) => (await import('@node-rs/argon2')).hash(clave, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
const entrarPortal = async (email, clave) => (await aceptarDatos((await llamar('POST', '/auth/login', { cuerpo: { email, clave } })).json));
// La oficina da acceso al portal: el primer administrador del cliente A
r = await llamar('POST', `/clientes/${clienteA.id}/usuarios-portal`, { token: tcom, cuerpo: { email: 'Portal.A@cliente-a.test', nombre: 'Administradora Cliente A', documento: '52111222', perfil: 'ADMIN' } });
const portalA = r.json;
prueba('la oficina (Comercial) da acceso al portal: usuario del cliente con invitación para crear su contraseña', r.status === 201 && portalA.email === 'portal.a@cliente-a.test'
  && !!(await db.passwordReset.findFirst({ where: { usuarioId: portalA.id } })), JSON.stringify(r.json).slice(0, 200));
r = await llamar('POST', `/clientes/${clienteA.id}/usuarios-portal`, { token: thseq, cuerpo: { email: 'otro@cliente-a.test', nombre: 'Otro Usuario', documento: '52111333' } });
const listaHseq = await llamar('GET', `/clientes/${clienteA.id}/usuarios-portal`, { token: thseq });
prueba('…sin «clientes.editar» (HSEQ) no se da acceso ni se ven sus datos personales → 403', r.status === 403 && listaHseq.status === 403, `${r.status} ${listaHseq.status}`);
await db.usuario.update({ where: { id: portalA.id }, data: { passwordHash: await hashFijo('PortalA2026!') } });
const sesionA = await entrarPortal('portal.a@cliente-a.test', 'PortalA2026!');
const tPA = sesionA.accessToken;
prueba('al ingresar, la sesión dice que es del portal, de qué cliente y con qué perfil', sesionA.usuario?.cliente?.id === clienteA.id && sesionA.usuario.perfilPortal === 'ADMIN'
  && sesionA.usuario.permisos.length === 0, JSON.stringify(sesionA.usuario ?? sesionA).slice(0, 200));
// Cliente B con su propio usuario del portal
const clienteB = (await llamar('POST', '/clientes', { token: T8, cuerpo: { nit: '901777666', razonSocial: 'Cliente B del Portal S.A.S.', representanteLegal: 'Representante Cliente B' } })).json;
const sedeB = (await llamar('POST', `/clientes/${clienteB.id}/sucursales`, { token: T8, cuerpo: { nombre: 'Planta B', codigo: 'B1', municipioDane: '68001' } })).json;
const declB = (await llamar('POST', '/declaraciones', { token: T8, cuerpo: { ...formulario, clienteId: clienteB.id, alcanceSedes: 'TODAS', codigoInterno: 'B-01', nombre: 'Residuo del cliente B' } })).json;
r = await llamar('POST', `/clientes/${clienteB.id}/usuarios-portal`, { token: T8, cuerpo: { email: 'portal.b@cliente-b.test', nombre: 'Consulta Cliente B', documento: '52999888', perfil: 'CONSULTA' } });
const portalB = r.json;
await db.usuario.update({ where: { id: portalB.id }, data: { passwordHash: await hashFijo('PortalB2026!') } });
const tPB = (await entrarPortal('portal.b@cliente-b.test', 'PortalB2026!')).accessToken;
prueba('(cliente B con su sede, una declaración y un usuario de consulta)', !!sedeB.id && !!declB.id && !!tPB, JSON.stringify({ sedeB: sedeB.id, declB: declB.id }));

// Barrera 1a: el usuario del portal no usa ninguna ruta de oficina
const rutasOficina = ['/declaraciones', '/clientes', `/clientes/${clienteA.id}`, '/solicitudes', '/manifiestos', '/actas', '/conciliaciones', '/informes/inicio', '/alertas', '/vehiculos',
  '/permisos-ambientales', '/declaraciones/catalogos', '/importacion/historial', '/archivos?clave=x', '/zonas', '/municipios?q=bu', `/clientes/${clienteA.id}/usuarios-portal`,
  '/programacion/pendientes', '/empresa', '/usuarios', '/gestores-aliados', '/inspecciones?desde=2026-01-01&hasta=2026-12-31', '/informes/indicadores?desde=2026-01-01&hasta=2026-12-31'];
const fugas = [];
for (const ruta of rutasOficina) { const x = await llamar('GET', ruta, { token: tPA }); if (x.status !== 403 || x.json.codigo !== 'PORTAL') fugas.push(`${ruta} → ${x.status}`); }
prueba(`el usuario del portal recibe 403 en las ${rutasOficina.length} rutas de oficina probadas (listados, detalle, archivos e informes)`, fugas.length === 0, fugas.join(', '));
r = await llamar('PATCH', `/declaraciones/${declB.id}/estado`, { token: tPA, cuerpo: { estado: 'AUTORIZADA' } });
prueba('…ni las de escritura (autorizar una declaración) → 403', r.status === 403, String(r.status));
r = await llamar('GET', '/portal/resumen', { token: T8 });
prueba('…y el personal de Terra Viva no usa las rutas del portal → 403', r.status === 403, String(r.status));

// Lo suyo: el cliente A ve sus declaraciones, solicitudes, manifiestos y certificados
const [declsA, mfsA, actasA] = await Promise.all([
  db.declaracion.count({ where: { clienteId: clienteA.id, estado: { not: 'ANULADA' } } }),
  db.manifiesto.findMany({ where: { clienteId: clienteA.id, estado: 'REALIZADO' }, select: { id: true } }),
  db.acta.findMany({ where: { clienteId: clienteA.id, estado: 'EMITIDA' }, select: { id: true } }),
]);
r = await llamar('GET', '/portal/yo', { token: tPA });
prueba('portal: «quién soy» trae su cliente, su perfil y sus sedes', r.status === 200 && r.json.cliente.id === clienteA.id && r.json.perfil === 'ADMIN' && r.json.sedes.length >= 1, JSON.stringify(r.json).slice(0, 200));
r = await llamar('GET', '/portal/declaraciones?porPagina=200', { token: tPA });
prueba('…ve todas sus declaraciones (y solo las suyas)', r.status === 200 && r.json.total === declsA && r.json.filas.every((d) => d.id !== declB.id), `${r.json.total} vs ${declsA}`);
const unaDeclA = r.json.filas[0];
r = await llamar('GET', `/portal/declaraciones/${unaDeclA.id}`, { token: tPA });
prueba('…su detalle, sin claves internas de archivos', r.status === 200 && r.json.id === unaDeclA.id && !('fichaSeguridadUrl' in r.json) && typeof r.json.tieneFichaSeguridad === 'boolean', JSON.stringify(Object.keys(r.json)).slice(0, 200));
r = await llamar('GET', '/portal/manifiestos?porPagina=200', { token: tPA });
prueba('…sus manifiestos grabados', r.status === 200 && mfsA.length > 0 && mfsA.every((m) => r.json.filas.some((x) => x.id === m.id)), `${r.json.total} vs ${mfsA.length}`);
r = await llamar('GET', '/portal/certificados?porPagina=200', { token: tPA });
prueba('…y sus certificados emitidos', r.status === 200 && actasA.length > 0 && r.json.total === actasA.length, `${r.json.total} vs ${actasA.length}`);
r = await llamar('GET', '/portal/resumen', { token: tPA });
prueba('…con su resumen', r.status === 200 && r.json.declaraciones.autorizadas >= 1 && typeof r.json.certificadosDelAnio === 'number', JSON.stringify(r.json).slice(0, 200));
// Informe del año: vale lo conciliado (conciliación aprobada) y, mientras tanto, lo del manifiesto
const anioA = (await db.manifiesto.findUnique({ where: { id: mfsA[0].id }, select: { fechaServicio: true } })).fechaServicio.getUTCFullYear();
const gestionado = async (extra = {}) => (await db.manifiestoItem.findMany({
  where: { ...extra, manifiesto: { clienteId: clienteA.id, estado: 'REALIZADO', fechaServicio: { gte: new Date(Date.UTC(anioA, 0, 1)), lt: new Date(Date.UTC(anioA + 1, 0, 1)) } } },
  select: { cantidad: true, conciliacion: { select: { cantidadConciliada: true, conciliacion: { select: { estado: true } } } } },
})).reduce((s, i) => s + Number(i.conciliacion?.conciliacion.estado === 'APROBADA' && i.conciliacion.cantidadConciliada !== null ? i.conciliacion.cantidadConciliada : i.cantidad), 0);
const sumaInforme = (j) => j.lineas.reduce((s, l) => s + l.total, 0);
const esperadoA = await gestionado();
r = await llamar('GET', `/portal/informe?anio=${anioA}`, { token: tPA });
prueba('…y su informe del año: por residuo y por mes, con lo conciliado en planta', r.status === 200 && r.json.lineas.length > 0 && Math.abs(sumaInforme(r.json) - esperadoA) < 0.05
  && r.json.lineas.every((l) => l.meses.length === 12 && Math.abs(l.meses.reduce((s, x) => s + x, 0) - l.total) < 0.05), `${r.status} ${r.json.lineas ? sumaInforme(r.json) : JSON.stringify(r.json)} vs ${esperadoA}`);

// Barrera 1b: el cliente B pide datos del cliente A (detalle, descargas y filtros)
const pruebasB = [
  ['GET', `/portal/declaraciones/${unaDeclA.id}`], ['POST', `/portal/manifiestos/${mfsA[0].id}/enlace`], ['POST', `/portal/certificados/${actasA[0].id}/enlace`],
  ['PATCH', `/portal/usuarios/${portalA.id}`],
];
const cruzadas = [];
for (const [m, ruta] of pruebasB) { const x = await llamar(m, ruta, { token: tPB, cuerpo: m === 'PATCH' ? { activo: false } : undefined }); if (![403, 404].includes(x.status)) cruzadas.push(`${m} ${ruta} → ${x.status}`); }
prueba('el cliente B recibe 403 o 404 al pedir el detalle, la descarga o los usuarios del cliente A', cruzadas.length === 0, cruzadas.join(', '));
const [lB1, lB2, lB3, lB4, lB5] = await Promise.all([
  llamar('GET', `/portal/declaraciones?q=${encodeURIComponent(unaDeclA.nombre)}`, { token: tPB }), llamar('GET', '/portal/manifiestos', { token: tPB }),
  llamar('GET', '/portal/certificados?anio=2026', { token: tPB }), llamar('GET', '/portal/usuarios', { token: tPB }), llamar('GET', `/portal/informe?anio=${anioA}`, { token: tPB }),
]);
prueba('…y en sus listados, filtros e informes no aparece nada del cliente A', lB1.json.total === 0 && lB2.json.total === 0 && lB3.json.total === 0
  && lB4.json.every((u) => u.id !== portalA.id) && lB5.json.lineas.length === 0, JSON.stringify([lB1.json.total, lB2.json.total, lB3.json.total, lB4.json.length, lB5.json.lineas?.length]));

// Barrera 2: la base de datos (RLS) no deja ver otro cliente aunque la consulta lo pida.
// PostgreSQL no aplica la RLS a un superusuario ni a un usuario con BYPASSRLS: la prueba (como producción) usa uno sin ellos.
const [rolBase] = await db.$queryRaw`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
prueba('la base se usa con un usuario sin superusuario ni BYPASSRLS (si no, la RLS no actúa)', !rolBase.rolsuper && !rolBase.rolbypassrls, JSON.stringify(rolBase));
const conCliente = (clienteId, fn) => db.$transaction(async (tx) => { await tx.$executeRaw`SELECT set_config('app.cliente_id', ${clienteId}, true)`; return fn(tx); });
const vistoPorB = await conCliente(clienteB.id, async (tx) => ({
  declsA: await tx.declaracion.count({ where: { clienteId: clienteA.id } }), mfsA: await tx.manifiesto.count({ where: { clienteId: clienteA.id } }),
  actasA: await tx.acta.count({ where: { clienteId: clienteA.id } }), clientes: await tx.cliente.count(), itemsA: await tx.manifiestoItem.count({ where: { manifiesto: { clienteId: clienteA.id } } }),
  conciliaciones: await tx.conciliacion.count(), suyas: await tx.declaracion.count(),
}));
prueba('RLS: con la sesión del cliente B, la base no devuelve filas del cliente A aunque la consulta las pida', vistoPorB.declsA === 0 && vistoPorB.mfsA === 0 && vistoPorB.actasA === 0
  && vistoPorB.itemsA === 0 && vistoPorB.conciliaciones === 0 && vistoPorB.clientes === 1 && vistoPorB.suyas === 1, JSON.stringify(vistoPorB));
let rlsEscritura = false;
try { await conCliente(clienteB.id, (tx) => tx.solicitud.create({ data: { empresaId: clienteA.empresaId, clase: 'FORMAL', clienteId: clienteA.id, fechaSolicitada: new Date() } })); }
catch (e) { rlsEscritura = /row-level security|seguridad de registros/i.test(String(e)); }
prueba('…ni deja escribir a nombre del cliente A', rlsEscritura);
prueba('…y sin sesión de portal (personal de Terra Viva) se ve todo, como antes', (await db.declaracion.count({ where: { clienteId: clienteA.id } })) > 0);

// Descargas con enlace firmado de 5 minutos
r = await llamar('POST', `/portal/certificados/${actasA[0].id}/enlace`, { token: tPA });
const enlace = r.json;
const bajada = await fetch(API + enlace.url);
const bytes = Buffer.from(await bajada.arrayBuffer());
prueba('descarga: enlace firmado de 5 minutos y el PDF del certificado sin sesión', r.status === 201 && /^\/descargas\//.test(enlace.url) && new Date(enlace.vence) - Date.now() <= 5 * 60_000
  && bajada.status === 200 && bytes.subarray(0, 4).toString() === '%PDF', `${r.status} ${bajada.status} ${bytes.subarray(0, 8).toString()}`);
const falsa = await fetch(API + enlace.url.slice(0, -4) + 'abcd');
prueba('…un enlace alterado no sirve → 403', falsa.status === 403, String(falsa.status));
r = await llamar('POST', `/portal/manifiestos/${mfsA[0].id}/enlace`, { token: tPA });
const bajadaMf = await fetch(API + r.json.url);
prueba('…también el PDF de sus manifiestos', bajadaMf.status === 200 && Buffer.from(await bajadaMf.arrayBuffer()).subarray(0, 4).toString() === '%PDF', String(bajadaMf.status));

// Cartera (respuesta de la gerencia): con una factura vencida y sin pagar, el certificado se ve pero se descarga al pagar
// Un certificado del cliente A con líneas conciliadas (el cargado de un aliado no tiene facturas)
const actaCartera = await db.acta.findFirst({ where: { clienteId: clienteA.id, estado: 'EMITIDA', items: { some: {} } }, include: { items: { take: 1 } }, orderBy: { numero: 'asc' } });
const lineaCartera = actaCartera.items[0];
const enlaceAntes = (await llamar('POST', `/portal/certificados/${actaCartera.id}/enlace`, { token: tPA })).json;
const factura = (estadoPago, vence = fechaEn(-10)) => llamar('PATCH', `/conciliaciones/${lineaCartera.conciliacionId}/items`, { token: T8,
  cuerpo: { items: [{ id: lineaCartera.id, facturaNumero: 'FE-CARTERA-1', facturaEmision: fechaEn(-40), facturaVencimiento: vence, estadoPago }] } });
r = await factura('PENDIENTE');
const listaCartera = await llamar('GET', '/portal/certificados?porPagina=200', { token: tPA });
const retenido = listaCartera.json.filas?.find((x) => x.id === actaCartera.id);
const pedirRetenido = await llamar('POST', `/portal/certificados/${actaCartera.id}/enlace`, { token: tPA });
prueba('cartera: con una factura vencida y sin pagar el certificado se ve en el portal, pero no se descarga (aviso amable)', r.status === 200 && retenido?.pendientePago?.facturas?.includes('FE-CARTERA-1')
  && pedirRetenido.status === 403 && pedirRetenido.json.codigo === 'PENDIENTE_PAGO' && /cuando se registre el pago de la factura FE-CARTERA-1/.test(pedirRetenido.json.mensaje),
  JSON.stringify([r.status, retenido?.pendientePago, pedirRetenido.json]).slice(0, 300));
const enlaceAnterior = await fetch(API + enlaceAntes.url);
prueba('…ni con un enlace que ya tenía', enlaceAnterior.status === 403, String(enlaceAnterior.status));
r = await llamar('GET', `/actas/${actaCartera.id}`, { token: T8 });
const pdfOficina = await descargar(`/actas/${actaCartera.id}/pdf`, T8);
prueba('…la oficina lo ve «pago pendiente» y lo sigue descargando', r.json.pendientePago?.includes('FE-CARTERA-1') && pdfOficina.status === 200 && pdfOficina.buf.subarray(0, 4).toString() === '%PDF',
  JSON.stringify(r.json.pendientePago));
await llamar('PATCH', '/empresa/configuracion', { token: T8, cuerpo: { cartera: { retenerCertificados: true, diasGracia: 30 } } });
const conGracia = await llamar('POST', `/portal/certificados/${actaCartera.id}/enlace`, { token: tPA });
await llamar('PATCH', '/empresa/configuracion', { token: T8, cuerpo: { cartera: { retenerCertificados: true, diasGracia: 0 } } });
await factura('PAGADA');
const pagada = await llamar('POST', `/portal/certificados/${actaCartera.id}/enlace`, { token: tPA });
prueba('…con días de gracia (30) una factura vencida hace 10 días no lo retiene, y pagada tampoco', conGracia.status === 201 && pagada.status === 201, `${conGracia.status} ${pagada.status}`);
await factura('PENDIENTE');
const sinPermisoLiberar = await llamar('POST', `/actas/${actaCartera.id}/liberar-descarga`, { token: thseq });
r = await llamar('POST', `/actas/${actaCartera.id}/liberar-descarga`, { token: T8 });
const liberado = await llamar('POST', `/portal/certificados/${actaCartera.id}/enlace`, { token: tPA });
prueba('…quien registra facturas y pagos libera la descarga (queda quién y cuándo) y el cliente ya lo descarga', sinPermisoLiberar.status === 403 && r.status === 201 && liberado.status === 201
  && !!(await db.auditoria.findFirst({ where: { entidad: 'acta', entidadId: actaCartera.id, accion: 'LIBERAR_DESCARGA' } })), `${sinPermisoLiberar.status} ${r.status} ${liberado.status}`);

// Usuarios del portal: el administrador del cliente gestiona los de su empresa
const sedeC002 = await db.sucursal.findFirst({ where: { clienteId: clienteA.id, codigo: 'C002' } });
r = await llamar('POST', '/portal/usuarios', { token: tPA, cuerpo: { email: 'bodega@cliente-a.test', nombre: 'Jefe de Bodega A', documento: '52111444', perfil: 'CONSULTA', sucursalIds: [sedeC002.id] } });
const consultaA = r.json;
prueba('el administrador del cliente crea un usuario de consulta limitado a una sede', r.status === 201 && consultaA.perfilPortal === 'CONSULTA', JSON.stringify(r.json).slice(0, 200));
r = await llamar('POST', '/portal/usuarios', { token: tPA, cuerpo: { email: 'intruso@cliente-a.test', nombre: 'Intruso', documento: '52111555', sucursalIds: [sedeB.id] } });
prueba('…no puede darle una sede de otro cliente', r.status === 400 && /sede/.test(r.json.mensaje), JSON.stringify(r.json));
await db.usuario.update({ where: { id: consultaA.id }, data: { passwordHash: await hashFijo('BodegaA2026!') } });
const tBodega = (await entrarPortal('bodega@cliente-a.test', 'BodegaA2026!')).accessToken;
const declsC002 = await db.declaracion.count({ where: { clienteId: clienteA.id, estado: { not: 'ANULADA' }, sucursales: { some: { sucursalId: sedeC002.id } } } });
r = await llamar('GET', '/portal/declaraciones?porPagina=200', { token: tBodega });
prueba('…ese usuario solo ve las declaraciones de su sede', r.status === 200 && r.json.total === declsC002 && declsC002 < declsA, `${r.json.total} vs ${declsC002} de ${declsA}`);
const esperadoC002 = await gestionado({ sucursalId: sedeC002.id });
r = await llamar('GET', `/portal/informe?anio=${anioA}`, { token: tBodega });
prueba('…y su informe solo suma lo recogido en su sede', r.status === 200 && Math.abs(sumaInforme(r.json) - esperadoC002) < 0.05 && esperadoC002 < esperadoA, `${r.json.lineas ? sumaInforme(r.json) : r.status} vs ${esperadoC002} de ${esperadoA}`);
r = await llamar('POST', '/portal/usuarios', { token: tBodega, cuerpo: { email: 'otro2@cliente-a.test', nombre: 'Otro Más', documento: '52111666' } });
prueba('…y como es de consulta, no crea usuarios → 403', r.status === 403, String(r.status));
r = await llamar('PATCH', `/portal/usuarios/${portalA.id}`, { token: tPA, cuerpo: { activo: false } });
prueba('el administrador del cliente no se inactiva a sí mismo', r.status === 400, JSON.stringify(r.json));
r = await llamar('PATCH', `/portal/usuarios/${consultaA.id}`, { token: tPA, cuerpo: { activo: false } });
const trasPortal = await llamar('GET', '/portal/yo', { token: tBodega });
prueba('…inactiva a otro de su empresa y su sesión se cierra de inmediato', r.status === 200 && r.json.activo === false && trasPortal.status === 401, `${r.status} ${trasPortal.status}`);
r = await llamar('GET', '/usuarios?q=cliente-a', { token: T8 });
prueba('los usuarios del portal no aparecen en Usuarios y roles de la oficina (se ven en la ficha del cliente)', r.status === 200 && r.json.total === 0, JSON.stringify(r.json).slice(0, 150));
r = await llamar('GET', `/clientes/${clienteA.id}/usuarios-portal`, { token: T8 });
prueba('…donde la oficina ve los usuarios del portal del cliente', r.status === 200 && r.json.length === 2 && r.json.some((u) => u.id === portalA.id), JSON.stringify(r.json).slice(0, 150));
// Un administrador limitado a una sede no da (ni se da, con otro correo) más acceso del que tiene
r = await llamar('POST', '/portal/usuarios', { token: tPA, cuerpo: { email: 'sede.admin@cliente-a.test', nombre: 'Administrador Sede C002', documento: '52111777', perfil: 'ADMIN', sucursalIds: [sedeC002.id] } });
const adminSede = r.json;
await db.usuario.update({ where: { id: adminSede.id }, data: { passwordHash: await hashFijo('SedeA2026!') } });
const tAdminSede = (await entrarPortal('sede.admin@cliente-a.test', 'SedeA2026!')).accessToken;
const [s1, s2, s3, s4] = await Promise.all([
  llamar('POST', '/portal/usuarios', { token: tAdminSede, cuerpo: { email: 'todas@cliente-a.test', nombre: 'Sin Límite', documento: '52111888' } }),
  llamar('PATCH', `/portal/usuarios/${portalA.id}`, { token: tAdminSede, cuerpo: { perfil: 'CONSULTA' } }),
  llamar('PATCH', `/portal/usuarios/${adminSede.id}`, { token: tAdminSede, cuerpo: { sucursalIds: [] } }),
  llamar('GET', '/portal/usuarios', { token: tAdminSede }),
]);
prueba('un administrador limitado a una sede no crea usuarios sin límite, no ve ni edita a los demás y no se quita el límite', s1.status === 403 && s2.status === 404 && s3.status === 403
  && s4.status === 200 && s4.json.every((u) => u.id !== portalA.id), JSON.stringify([s1.status, s2.status, s3.status, s4.json.length]));
r = await llamar('POST', '/portal/usuarios', { token: tAdminSede, cuerpo: { email: 'auxiliar.c002@cliente-a.test', nombre: 'Auxiliar Sede C002', documento: '52111999', sucursalIds: [sedeC002.id] } });
prueba('…pero sí crea usuarios de su misma sede', r.status === 201, JSON.stringify(r.json).slice(0, 150));

// Escritura desde el portal (solo el perfil Administrador): cargar sus declaraciones y pedir servicios
const csvPortal = (id, filas, d = ';') => {
  const p = shared.plantillaPortal(id);
  const celda = (v) => { const x = String(v ?? ''); return x.includes(d) || /["\r\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
  return Buffer.from([p.columnas.map((c) => c.header + (c.requerido ? ' *' : '')), ...filas.map((x) => p.columnas.map((c) => x[c.key] ?? ''))]
    .map((fila) => fila.map(celda).join(d)).join('\r\n') + '\r\n', 'utf8');
};
const filaPortal = (x) => {
  const { nit: _n, metrica: _m, precio: _p, ...resto } = filaResiduo({ categoria: 'NOPEL', peligroso: 'No', corrienteY: '', riesgos: '', disposiciones: 'BIO', frecuenciaDias: '15', cantidad: '200', ...x });
  return resto;
};
const formPortal = (buf, extra = {}) => { const fm = formDe(buf, 'mis-declaraciones.csv'); for (const [k, v] of Object.entries(extra)) fm.append(k, v); return fm; };
const csvCliente = csvPortal('decl-residuos', [
  filaPortal({ codigo: 'PORTAL-01', residuo: 'Aceite de cocina usado', sedes: 'C001' }),
  filaPortal({ codigo: 'PORTAL-02', residuo: 'Residuo de una sede que no existe', sedes: 'C999' }),
  filaPortal({ codigo: 'RP-018', residuo: 'Código repetido', sedes: 'C001' }),
]);
const errorDe = (j, codigo) => j.filas?.find((x) => x.datos.codigo === codigo)?.errores.join(' ') ?? '';
r = await llamar('POST', '/portal/declaraciones/cargue/decl-residuos/vista-previa', { token: tPA, form: formPortal(csvCliente) });
prueba('portal: el administrador revisa su archivo de declaraciones (sin NIT ni precio) y ve qué filas fallan', r.status === 201 && r.json.resumen?.validas === 1
  && r.json.resumen.conErrores === 2 && /C999/.test(errorDe(r.json, 'PORTAL-02')) && /su empresa ya tiene/.test(errorDe(r.json, 'RP-018')) && !r.json.faltantes.length,
  JSON.stringify(r.json).slice(0, 300));
r = await llamar('POST', '/portal/declaraciones/cargue/decl-residuos/confirmar', { token: tPA, form: formPortal(csvCliente) });
prueba('…sin aceptar la declaración de responsabilidad no carga', r.status === 400 && /responsabilidad/.test(r.json.mensaje), JSON.stringify(r.json));
r = await llamar('POST', '/portal/declaraciones/cargue/decl-residuos/confirmar', { token: tPA, form: formPortal(csvCliente, { aceptaResponsabilidad: 'true' }) });
const declPortal = await db.declaracion.findFirst({ where: { clienteId: clienteA.id, codigoInterno: 'PORTAL-01' }, include: { tarifas: true, cargue: true } });
prueba('…al confirmar, sus declaraciones quedan en revisión, sin precio y a nombre de su empresa', r.status === 201 && r.json.creadas === 1 && r.json.rechazadas === 2
  && declPortal?.estado === 'PENDIENTE' && !declPortal.activa && declPortal.tarifas.length === 0 && declPortal.creadoPorId === portalA.id
  && declPortal.responsabilidadAceptada && declPortal.cargue?.clienteId === clienteA.id, JSON.stringify(r.json).slice(0, 200));
r = await llamar('GET', `/declaraciones?clienteId=${clienteA.id}&estado=PENDIENTE&porPagina=200`, { token: T8 });
prueba('…y la oficina la ve por revisar', r.status === 200 && r.json.filas.some((d) => d.id === declPortal.id), String(r.json.total));
r = await llamar('POST', '/portal/declaraciones/cargue/decl-residuos/vista-previa', { token: tPB, form: formPortal(csvCliente) });
prueba('…un usuario de consulta no carga declaraciones → 403', r.status === 403, String(r.status));
r = await llamar('POST', '/portal/declaraciones/cargue/decl-residuos/vista-previa', { token: tAdminSede, form: formPortal(csvPortal('decl-residuos', [
  filaPortal({ codigo: 'PORTAL-03', residuo: 'Para todas las sedes', sedes: 'TODAS' }), filaPortal({ codigo: 'PORTAL-04', residuo: 'En otra sede', sedes: 'C001' }),
  filaPortal({ codigo: 'PORTAL-05', residuo: 'En su sede', sedes: 'C002' }),
])) });
prueba('…un administrador limitado a una sede solo carga para su sede', r.status === 201 && r.json.resumen?.validas === 1 && errorDe(r.json, 'PORTAL-05') === ''
  && /algunas sedes/.test(errorDe(r.json, 'PORTAL-03')) && /C001/.test(errorDe(r.json, 'PORTAL-04')), JSON.stringify(r.json.resumen));

// Pedir servicios: quedan «por confirmar» en la oficina; el cliente cancela lo que nadie ha confirmado
r = await llamar('GET', '/portal/solicitudes/opciones', { token: tPA });
const opcionC001 = r.json.sedes?.find((x) => x.codigo === 'C001');
const declPedir = opcionC001?.declaraciones[0];
prueba('portal: para pedir ve sus sedes y en cada una lo autorizado y activo (no lo que está en revisión)', r.status === 200 && !!declPedir
  && !r.json.sedes.some((x) => x.declaraciones.some((d) => d.id === declPortal.id)), JSON.stringify(r.json).slice(0, 200));
r = await llamar('POST', '/portal/solicitudes', { token: tPA, cuerpo: { sucursalId: opcionC001.id, fechaSolicitada: fechaEn(4), ordenCompra: 'OC-PORTAL-1', observaciones: 'Entrar por la portería 2',
  items: [{ declaracionId: declPedir.id, cantidadEstimada: 120, jornada: 'AM' }] } });
const pedidoPortal = r.json;
const solPortal = pedidoPortal.id ? await db.solicitud.findUnique({ where: { id: pedidoPortal.id }, include: { items: true } }) : null;
prueba('…pide un servicio: queda por confirmar, a su nombre y con la tarifa vigente', r.status === 201 && solPortal?.aprobacion === 'PENDIENTE' && solPortal.estado === 'PENDIENTE'
  && solPortal.clienteId === clienteA.id && solPortal.creadoPorId === portalA.id && solPortal.items.length === 1 && solPortal.items[0].precioUnitario !== null, JSON.stringify(r.json).slice(0, 200));
r = await llamar('GET', '/solicitudes?aprobacion=PENDIENTE&porPagina=200', { token: T8 });
prueba('…y la oficina lo ve en «Por confirmar», marcado como pedido del portal', r.status === 200 && r.json.filas.some((x) => x.id === pedidoPortal.id && x.creadoPor?.clienteId === clienteA.id),
  String(r.json.total));
// Un administrador del cliente B (lo crea la oficina) no ve ni cancela lo del cliente A
r = await llamar('POST', `/clientes/${clienteB.id}/usuarios-portal`, { token: T8, cuerpo: { email: 'admin.b@cliente-b.test', nombre: 'Administrador Cliente B', documento: '52999777', perfil: 'ADMIN' } });
await db.usuario.update({ where: { id: r.json.id }, data: { passwordHash: await hashFijo('AdminB2026!') } });
const tAdminB = (await entrarPortal('admin.b@cliente-b.test', 'AdminB2026!')).accessToken;
const [p1, p2, p3, p4, p5] = await Promise.all([
  llamar('POST', '/portal/solicitudes', { token: tPA, cuerpo: { sucursalId: opcionC001.id, fechaSolicitada: fechaEn(-2), items: [{ declaracionId: declPedir.id, cantidadEstimada: 1 }] } }),
  llamar('POST', '/portal/solicitudes', { token: tPA, cuerpo: { sucursalId: opcionC001.id, fechaSolicitada: fechaEn(4), items: [{ declaracionId: declPortal.id, cantidadEstimada: 1 }] } }),
  llamar('POST', '/portal/solicitudes', { token: tPB, cuerpo: { sucursalId: sedeB.id, fechaSolicitada: fechaEn(4), items: [{ declaracionId: declB.id, cantidadEstimada: 1 }] } }),
  llamar('POST', `/portal/solicitudes/${pedidoPortal.id}/cancelar`, { token: tAdminB, cuerpo: { motivo: 'Intento de otro cliente' } }),
  llamar('POST', '/portal/solicitudes', { token: tAdminB, cuerpo: { sucursalId: opcionC001.id, fechaSolicitada: fechaEn(4), items: [{ declaracionId: declPedir.id, cantidadEstimada: 1 }] } }),
]);
prueba('…no pide con fecha pasada ni lo que sigue en revisión; consulta no pide; el cliente B no cancela ni pide con sedes de A',
  p1.status === 400 && p2.status === 400 && p3.status === 403 && p4.status === 404 && p5.status === 404, JSON.stringify([p1.status, p2.status, p3.status, p4.status, p5.status]));
r = await llamar('POST', `/portal/solicitudes/${pedidoPortal.id}/cancelar`, { token: tPA, cuerpo: { motivo: 'Ya no lo necesitamos' } });
const solCancelada = await db.solicitud.findUnique({ where: { id: pedidoPortal.id }, include: { items: true, causal: true } });
prueba('…lo cancela mientras nadie lo ha confirmado: sus líneas quedan descartadas, con la causal y el motivo', r.status === 201 && solCancelada.estado === 'CANCELADA'
  && solCancelada.items.every((i) => i.estado === 'DESCARTADO') && solCancelada.causal?.codigo === 'CAU-PORTAL' && /Ya no lo necesitamos/.test(solCancelada.observaciones ?? ''),
  JSON.stringify(r.json));
r = await llamar('POST', '/portal/solicitudes', { token: tPA, cuerpo: { sucursalId: opcionC001.id, fechaSolicitada: fechaEn(5), items: [{ declaracionId: declPedir.id, cantidadEstimada: 80 }] } });
const pedido2 = r.json;
await llamar('PATCH', `/solicitudes/${pedido2.id}/aprobacion`, { token: T8, cuerpo: { aprobacion: 'APROBADA' } });
r = await llamar('POST', `/portal/solicitudes/${pedido2.id}/cancelar`, { token: tPA, cuerpo: { motivo: 'Cambio de planes' } });
prueba('…pero si Terra Viva ya lo confirmó, no lo cancela desde el portal', r.status === 400 && /confirm/.test(r.json.mensaje), JSON.stringify(r.json));

console.log('\n10. Verificación en dos pasos (requisitos de producción §4)');
// Códigos de una app de autenticación (RFC 6238, como Google Authenticator): HMAC-SHA1 de pasos de 30 segundos
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const bytesB32 = (s) => {
  const out = []; let bits = 0, valor = 0;
  for (const ch of s.replace(/[\s=]/g, '').toUpperCase()) { valor = ((valor << 5) | B32.indexOf(ch)) & 0xffff; bits += 5; if (bits >= 8) { out.push((valor >>> (bits - 8)) & 0xff); bits -= 8; } }
  return Buffer.from(out);
};
const totp = (secreto, paso) => {
  const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(paso));
  const h = createHmac('sha1', bytesB32(secreto)).update(b).digest(); const o = h[h.length - 1] & 0x0f;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
};
const pasoAhora = () => Math.floor(Date.now() / 30_000);
const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));
/** El celular: cada código sirve una sola vez y el servidor acepta el paso anterior, el actual y el siguiente. */
const appAutenticacion = (secreto) => {
  let ultimo = -Infinity;
  return async () => {
    if (Date.now() % 30_000 > 26_000) await esperar(30_000 - (Date.now() % 30_000) + 300); // lejos del cambio de paso
    const paso = Math.max(pasoAhora() - 1, ultimo + 1);
    while (paso > pasoAhora() + 1) await esperar(1000);
    ultimo = paso;
    return totp(secreto, paso);
  };
};
const claveDe = (inicio) => (inicio?.secreto ?? '').replace(/\s/g, '');
/** Un código que hoy no es válido para esa clave (ningún paso cercano lo produce). */
const codigoErrado = (secreto) => {
  const cerca = [-2, -1, 0, 1, 2].map((d) => totp(secreto, pasoAhora() + d));
  let n = 0; while (cerca.includes(String(n).padStart(6, '0'))) n++;
  return String(n).padStart(6, '0');
};
const CLAVE_DOS = 'DosPasos2026!';
const dos = await db.usuario.upsert({ where: { email: 'dos.pasos.e2e@terravivasas.com' }, update: {},
  create: { empresaId: cliente.empresaId, rolId: rolComercial.id, nombre: 'Dos Pasos E2E', documento: '8', email: 'dos.pasos.e2e@terravivasas.com', passwordHash: await hashFijo(CLAVE_DOS) } });
const entrarDos = async () => (await llamar('POST', '/auth/login', { cuerpo: { email: dos.email, clave: CLAVE_DOS } })).json;
let sDos = await aceptarDatos(await entrarDos());
prueba('sin activarla (y sin exigirla) se entra solo con la contraseña', !!sDos.accessToken && sDos.usuario?.dobleFactor?.activo === false && sDos.usuario.requiereConfigurar2fa === false,
  JSON.stringify(sDos.usuario ?? sDos).slice(0, 200));
r = await llamar('POST', '/auth/2fa/confirmar', { token: sDos.accessToken, cuerpo: { codigo: '123456' } });
prueba('activarla: confirmar sin haber leído el código QR → 400', r.status === 400, JSON.stringify(r.json));
r = await llamar('POST', '/auth/2fa/iniciar', { token: sDos.accessToken, cuerpo: {} });
const secretoDos = claveDe(r.json);
prueba('…empezar entrega la clave (de a 4 letras), el enlace otpauth y el código QR', r.status === 200 && /^[A-Z2-7]{32}$/.test(secretoDos) && /^([A-Z2-7]{4} ){7}[A-Z2-7]{4}$/.test(r.json.secreto)
  && r.json.uri?.startsWith('otpauth://totp/TERRY-GO') && r.json.uri.includes(`secret=${secretoDos}`) && r.json.qr?.startsWith('data:image/png;base64,'), JSON.stringify(r.json).slice(0, 160));
let filaDos = await db.usuario.findUnique({ where: { id: dos.id } });
prueba('…la clave queda pendiente y cifrada en la base (no la de la app): todavía no está activa', !!filaDos.totpPendiente && !filaDos.totpPendiente.includes(secretoDos) && filaDos.totpSecreto === null);
r = await llamar('POST', '/auth/2fa/confirmar', { token: sDos.accessToken, cuerpo: { codigo: codigoErrado(secretoDos) } });
prueba('…un código errado no la activa → 400', r.status === 400 && /no coincide/.test(r.json.mensaje), JSON.stringify(r.json));
const appDos = appAutenticacion(secretoDos);
const c1 = await appDos();
r = await llamar('POST', '/auth/2fa/confirmar', { token: sDos.accessToken, cuerpo: { codigo: c1 } });
const activacion = r.json;
prueba('…con el código de la app queda activa: 10 códigos de respaldo y una sesión nueva', r.status === 200 && activacion.codigosRespaldo?.length === 10
  && activacion.codigosRespaldo.every((c) => /^[A-Z2-7]{4}-[A-Z2-7]{4}$/.test(c)) && new Set(activacion.codigosRespaldo).size === 10
  && !!activacion.sesion?.accessToken && activacion.sesion.usuario.dobleFactor?.activo === true, JSON.stringify(r.json).slice(0, 200));
r = await llamar('GET', '/auth/yo', { token: sDos.accessToken });
prueba('…y cierra las demás sesiones (también la que la activó)', r.status === 401, String(r.status));
filaDos = await db.usuario.findUnique({ where: { id: dos.id } });
const huellas = await db.codigoRespaldo.findMany({ where: { usuarioId: dos.id } });
prueba('…en la base: la clave cifrada y los códigos de respaldo solo como huella (sha256)', !!filaDos.totpSecreto && !filaDos.totpSecreto.includes(secretoDos) && filaDos.totpPendiente === null
  && !!filaDos.totpActivoDesde && huellas.length === 10 && huellas.every((h) => /^[0-9a-f]{64}$/.test(h.codigoHash) && h.usadoEn === null));
r = await llamar('POST', '/auth/2fa/iniciar', { token: activacion.sesion.accessToken, cuerpo: {} });
prueba('…ya activa, no se empieza otra (la clave no se cambia sin desactivarla)', r.status === 400, JSON.stringify(r.json));

// Ingreso en dos pasos
let x = await entrarDos();
const desafio = x.desafio;
prueba('ingreso: con la verificación activa, la contraseña sola no entrega sesión sino un desafío', x.requiere2fa === true && !!desafio && !x.accessToken, JSON.stringify(x).slice(0, 160));
r = await llamar('GET', '/auth/yo', { token: desafio });
prueba('…el desafío no sirve como sesión → 401', r.status === 401);
r = await llamar('POST', '/auth/2fa/verificar', { cuerpo: { desafio, codigo: codigoErrado(secretoDos) } });
prueba('…un código errado → 401 (y queda en la auditoría)', r.status === 401
  && !!(await db.auditoria.findFirst({ where: { entidad: 'usuario', entidadId: dos.id, accion: '2FA_FALLIDO' } })), JSON.stringify(r.json));
const c2 = await appDos();
r = await llamar('POST', '/auth/2fa/verificar', { cuerpo: { desafio, codigo: c2 } });
const sesionDos = r.json;
prueba('…con el código de la app entra', r.status === 200 && !!sesionDos.accessToken && sesionDos.usuario?.dobleFactor?.activo === true, JSON.stringify(r.json).slice(0, 160));
const rep1 = await llamar('POST', '/auth/2fa/verificar', { cuerpo: { desafio, codigo: c2 } });
const rep2 = await llamar('POST', '/auth/2fa/verificar', { cuerpo: { desafio, codigo: c1 } });
prueba('…el mismo código no sirve dos veces aunque siga vigente, ni uno anterior', rep1.status === 401 && rep2.status === 401, `${rep1.status} ${rep2.status}`);
r = await llamar('POST', '/auth/2fa/verificar', { cuerpo: { desafio: desafio.slice(0, -4) + (desafio.endsWith('AAAA') ? 'BBBB' : 'AAAA'), codigo: '123456' } });
prueba('…un desafío alterado no sirve → 401', r.status === 401 && /venció/.test(r.json.mensaje), JSON.stringify(r.json));
const respaldo = activacion.codigosRespaldo[0];
r = await llamar('POST', '/auth/2fa/verificar', { cuerpo: { desafio, codigo: respaldo.toLowerCase().replace('-', ' ') } });
prueba('sin el celular: entra con un código de respaldo (sin importar mayúsculas ni espacios)', r.status === 200 && !!r.json.accessToken, JSON.stringify(r.json).slice(0, 160));
r = await llamar('POST', '/auth/2fa/verificar', { cuerpo: { desafio, codigo: respaldo } });
prueba('…y ese código de respaldo ya no sirve otra vez', r.status === 401, String(r.status));
const ingresos = await db.auditoria.findMany({ where: { entidad: 'usuario', entidadId: dos.id, accion: 'LOGIN' }, orderBy: { id: 'desc' }, take: 2 });
prueba('…la auditoría dice cómo entró cada vez (código de la app o de respaldo)', ingresos[0]?.despues?.dobleFactor === 'RESPALDO' && ingresos[1]?.despues?.dobleFactor === 'TOTP',
  JSON.stringify(ingresos.map((i) => i.despues)));
const tDos = sesionDos.accessToken;
r = await llamar('GET', '/auth/yo', { token: tDos });
prueba('/auth/yo: activa, desde cuándo, si es obligatoria y cuántos códigos de respaldo le quedan', r.status === 200 && r.json.dobleFactor?.activo === true && !!r.json.dobleFactor.desde
  && r.json.dobleFactor.obligatorio === false && r.json.dobleFactor.codigosRestantes === 9, JSON.stringify(r.json.dobleFactor));
r = await llamar('POST', '/auth/2fa/codigos', { token: tDos, cuerpo: { codigo: activacion.codigosRespaldo[1] } });
prueba('códigos de respaldo nuevos: piden el código de la app, no uno de respaldo → 400', r.status === 400, JSON.stringify(r.json));
r = await llamar('POST', '/auth/2fa/codigos', { token: tDos, cuerpo: { codigo: await appDos() } });
const nuevosRespaldo = r.json.codigosRespaldo ?? [];
x = await entrarDos();
const viejo = await llamar('POST', '/auth/2fa/verificar', { cuerpo: { desafio: x.desafio, codigo: activacion.codigosRespaldo[1] } });
const nuevo = await llamar('POST', '/auth/2fa/verificar', { cuerpo: { desafio: x.desafio, codigo: nuevosRespaldo[0] ?? 'AAAA-AAAA' } });
prueba('…con el código de la app entrega 10 nuevos y los anteriores dejan de servir', r.status === 200 && nuevosRespaldo.length === 10 && viejo.status === 401 && nuevo.status === 200,
  `${r.status} ${nuevosRespaldo.length} ${viejo.status} ${nuevo.status}`);

// Celular perdido y sin códigos de respaldo: la restablece un administrador
const propio = await llamar('POST', `/usuarios/${idAdmin}/2fa/restablecer`, { token: T8 });
const sinPermiso = await llamar('POST', `/usuarios/${dos.id}/2fa/restablecer`, { token: tDos });
prueba('restablecerla: nadie la suya, ni sin el permiso «configuracion.editar»', propio.status === 400 && /propia/.test(propio.json.mensaje) && sinPermiso.status === 403,
  `${propio.status} ${sinPermiso.status}`);
r = await llamar('POST', `/usuarios/${dos.id}/2fa/restablecer`, { token: T8 });
const yoTrasReset = await llamar('GET', '/auth/yo', { token: tDos });
filaDos = await db.usuario.findUnique({ where: { id: dos.id } });
prueba('…el administrador la restablece: se borran la clave y los códigos, y se cierran sus sesiones', r.status === 200 && yoTrasReset.status === 401
  && filaDos.totpSecreto === null && filaDos.totpActivoDesde === null && (await db.codigoRespaldo.count({ where: { usuarioId: dos.id } })) === 0
  && !!(await db.auditoria.findFirst({ where: { entidad: 'usuario', entidadId: dos.id, accion: 'RESTABLECER_2FA', usuarioId: idAdmin } })), `${r.status} ${yoTrasReset.status}`);
sDos = await entrarDos();
prueba('…y vuelve a entrar solo con la contraseña (aquí no es obligatoria)', !!sDos.accessToken && sDos.usuario?.requiereConfigurar2fa === false, JSON.stringify(sDos).slice(0, 160));
// Desactivarla cuando no es obligatoria
r = await llamar('POST', '/auth/2fa/iniciar', { token: sDos.accessToken, cuerpo: {} });
const secretoDos2 = claveDe(r.json);
r = await llamar('POST', '/auth/2fa/confirmar', { token: sDos.accessToken, cuerpo: { codigo: await appAutenticacion(secretoDos2)() } });
const reactivada = r.json;
const desactivarMal = await llamar('POST', '/auth/2fa/desactivar', { token: reactivada.sesion?.accessToken, cuerpo: { codigo: codigoErrado(secretoDos2) } });
r = await llamar('POST', '/auth/2fa/desactivar', { token: reactivada.sesion?.accessToken, cuerpo: { codigo: reactivada.codigosRespaldo?.[0] ?? 'AAAA-AAAA' } });
filaDos = await db.usuario.findUnique({ where: { id: dos.id } });
prueba('desactivarla (si no es obligatoria) pide un código válido; sirve uno de respaldo', reactivada.codigosRespaldo?.length === 10 && desactivarMal.status === 400 && r.status === 204
  && filaDos.totpSecreto === null && (await db.codigoRespaldo.count({ where: { usuarioId: dos.id } })) === 0, `${desactivarMal.status} ${r.status}`);

// La empresa la exige a todo el personal (en producción se exige siempre)
const confAntes = (await llamar('GET', '/empresa', { token: T8 })).json.configuracion ?? {};
r = await llamar('PATCH', '/empresa/configuracion', { token: T8, cuerpo: { dobleFactorObligatorio: true } });
prueba('la empresa la exige a todo el personal (lo demás de la configuración queda igual)', r.status === 200 && r.json.configuracion?.dobleFactorObligatorio === true
  && Object.entries(confAntes).filter(([k]) => k !== 'dobleFactorObligatorio').every(([k, v]) => JSON.stringify(r.json.configuracion[k]) === JSON.stringify(v)), JSON.stringify(r.json).slice(0, 200));
sDos = await entrarDos();
const bloqueado = await llamar('GET', '/declaraciones', { token: sDos.accessToken });
const yoPendiente = await llamar('GET', '/auth/yo', { token: sDos.accessToken });
prueba('…quien no la tiene entra, pero solo para configurarla: lo demás responde 403 CONFIGURAR_2FA', sDos.usuario?.requiereConfigurar2fa === true && bloqueado.status === 403
  && bloqueado.json.codigo === 'CONFIGURAR_2FA' && yoPendiente.status === 200 && yoPendiente.json.dobleFactor?.obligatorio === true, `${bloqueado.status} ${JSON.stringify(bloqueado.json)}`);
r = await llamar('POST', '/auth/2fa/iniciar', { token: sDos.accessToken, cuerpo: {} });
const secretoDos3 = claveDe(r.json);
r = await llamar('POST', '/auth/2fa/confirmar', { token: sDos.accessToken, cuerpo: { codigo: await appAutenticacion(secretoDos3)() } });
const obligada = r.json;
const despues2fa = await llamar('GET', '/declaraciones', { token: obligada.sesion?.accessToken });
prueba('…al configurarla recibe una sesión sin la restricción y sigue trabajando', r.status === 200 && obligada.sesion?.usuario?.requiereConfigurar2fa === false && despues2fa.status === 200,
  `${r.status} ${despues2fa.status}`);
r = await llamar('POST', '/auth/2fa/desactivar', { token: obligada.sesion?.accessToken, cuerpo: { codigo: obligada.codigosRespaldo?.[0] ?? 'AAAA-AAAA' } });
prueba('…y siendo obligatoria no se puede desactivar', r.status === 400 && /obligatoria/.test(r.json.mensaje), JSON.stringify(r.json));

// Portal de clientes: es opcional; la restablece su administrador (o la oficina)
const sSede = await entrarPortal('sede.admin@cliente-a.test', 'SedeA2026!');
prueba('…a los usuarios del portal no se les exige (para ellos es opcional)', !!sSede.accessToken && sSede.usuario?.requiereConfigurar2fa === false && sSede.usuario.dobleFactor?.obligatorio === false,
  JSON.stringify(sSede.usuario ?? sSede).slice(0, 200));
r = await llamar('POST', '/auth/2fa/iniciar', { token: sSede.accessToken, cuerpo: {} });
const secretoSede = claveDe(r.json);
r = await llamar('POST', '/auth/2fa/confirmar', { token: sSede.accessToken, cuerpo: { codigo: await appAutenticacion(secretoSede)() } });
const sede2fa = r.json;
let listaPortal = await llamar('GET', '/portal/usuarios', { token: tPA });
prueba('portal: el usuario del cliente la activa si quiere, y su administrador lo ve', r.status === 200 && !!sede2fa.sesion?.accessToken
  && !!listaPortal.json.find?.((u) => u.id === adminSede.id)?.totpActivoDesde, JSON.stringify(r.json).slice(0, 160));
const porConsulta = await llamar('POST', `/portal/usuarios/${adminSede.id}/2fa/restablecer`, { token: tPB });
const porOtroCliente = await llamar('POST', `/portal/usuarios/${adminSede.id}/2fa/restablecer`, { token: tAdminB });
const porSiMismo = await llamar('POST', `/portal/usuarios/${adminSede.id}/2fa/restablecer`, { token: sede2fa.sesion?.accessToken });
prueba('…no la restablece un perfil de consulta, ni otro cliente, ni cada quien la suya', porConsulta.status === 403 && porOtroCliente.status === 404 && porSiMismo.status === 400,
  `${porConsulta.status} ${porOtroCliente.status} ${porSiMismo.status}`);
r = await llamar('POST', `/portal/usuarios/${adminSede.id}/2fa/restablecer`, { token: tPA });
const yoSede = await llamar('GET', '/auth/yo', { token: sede2fa.sesion?.accessToken });
listaPortal = await llamar('GET', `/clientes/${clienteA.id}/usuarios-portal`, { token: T8 });
prueba('…su administrador la restablece: se cierran sus sesiones y la oficina lo ve sin verificación', r.status === 201 && yoSede.status === 401
  && listaPortal.json.find?.((u) => u.id === adminSede.id)?.totpActivoDesde === null, `${r.status} ${yoSede.status}`);
r = await llamar('POST', `/clientes/${clienteA.id}/usuarios-portal/${adminSede.id}/2fa/restablecer`, { token: T8 });
prueba('…la oficina también puede (y si no hay nada que restablecer, lo dice)', r.status === 400 && /no tiene configurada/.test(r.json.mensaje), JSON.stringify(r.json));

// Restablecida siendo obligatoria: la configura de nuevo al entrar. Al final deja de exigirse para el resto de la prueba.
r = await llamar('POST', `/usuarios/${dos.id}/2fa/restablecer`, { token: T8 });
sDos = await entrarDos();
prueba('si la restablecen siendo obligatoria, al entrar la configura de nuevo', r.status === 200 && sDos.usuario?.requiereConfigurar2fa === true, JSON.stringify(sDos).slice(0, 160));
r = await llamar('PATCH', '/empresa/configuracion', { token: T8, cuerpo: { dobleFactorObligatorio: false } });
sDos = await entrarDos();
prueba('…y al dejar de exigirla se vuelve a entrar solo con la contraseña', r.status === 200 && !!sDos.accessToken && sDos.usuario?.requiereConfigurar2fa === false, JSON.stringify(sDos).slice(0, 160));

// Límite de peticiones (al final: deja la IP de la prueba sin poder ingresar durante un minuto).
// El ingreso cuenta por correo y por IP: una oficina sale a internet por una sola IP y no debe bloquearse entera.
let r11;
for (let i = 0; i < 11; i++) r11 = await llamar('POST', '/auth/login', { cuerpo: { email: 'limite@ejemplo.com', clave: 'no-es' } });
prueba('ingreso: el 11.º intento seguido con el mismo correo responde 429', r11.status === 429, String(r11.status));
r = await llamar('POST', '/auth/login', { cuerpo: { email: 'otra.persona@ejemplo.com', clave: 'no-es' } });
prueba('…pero otra persona desde la misma IP sí puede intentar', r.status === 401, String(r.status));
let techo = null;
for (let n = 1; n <= 80 && techo === null; n++) {
  const x = await llamar('POST', '/auth/login', { cuerpo: { email: `rociado${n}@ejemplo.com`, clave: 'no-es' } });
  if (x.status === 429) techo = n;
}
prueba('techo por IP: muchos correos distintos desde una IP terminan en 429 (rociado de contraseñas)', techo !== null && techo <= 60, `intento ${techo}`);
r = await llamar('GET', '/auth/yo', { token: T8 });
prueba('…y quien ya tiene sesión sigue trabajando (con sesión se cuenta por usuario, no por IP)', r.status === 200, String(r.status));

await db.$disconnect();
console.log(`\n${ok} pruebas correctas, ${fallas} fallidas`);
process.exit(fallas ? 1 : 0);
