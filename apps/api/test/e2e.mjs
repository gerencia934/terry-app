// Prueba de punta a punta del API contra una base de datos real.
// Requiere el API corriendo (API_URL) y la base sembrada con prisma/seed.mjs.
//   API_URL=http://localhost:3000/api/v1 ADMIN_EMAIL=... ADMIN_PASSWORD=... node test/e2e.mjs
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
prueba('catálogos del formulario: solo las disposiciones activas (sin aprovechamiento propio, lavado ni coprocesamiento)', cat.lineas?.length === 15 && cat.disposiciones?.length === 10 && !idDe(cat.disposiciones, 'APR') && cat.metricasDensidad?.length === 5, String(cat.disposiciones?.length));
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
await db.proveedor.update({ where: { id: cgs.id }, data: { excluyeTiposResiduo: ['HOSP'] } });
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
r = await llamar('POST', '/clientes', { token: tcom, cuerpo: { nit: nitF1, razonSocial: 'Palmas del Magdalena Medio S.A.S.', sector: 'Palma', formaPago: 'CREDITO_30', emailFacturacion: 'facturas@palmas.test', asesorId: comercial.id } });
const cF1 = r.json;
prueba('crear un cliente (Comercial) calcula el dígito de verificación y guarda el asesor', r.status === 201 && cF1.dv === dvNit(nitF1) && cF1.asesorId === comercial.id, JSON.stringify(r.json).slice(0, 200));
r = await llamar('POST', '/clientes', { token: tcom, cuerpo: { nit: nitF1, razonSocial: 'Repetido S.A.S.' } });
prueba('…y no repite un NIT', r.status === 400 && /Ya existe/.test(r.json.mensaje), JSON.stringify(r.json));
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
const tc = (await aceptarDatos((await llamar('POST', '/auth/login', { cuerpo: { email: conductor.email, clave: 'Conductor2026!' } })).json)).accessToken;
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
prueba('crear el acta del periodo con las líneas aprobadas (número PSAP{año}-{n})', r.status === 201 && /^PSAP\d{4}-\d+$/.test(r.json.numero), JSON.stringify(r.json));
const actaB = r.json;
r = await llamar('POST', `/actas/${actaB.id}/emitir`, { token: T8 });
prueba('emitir: copia fija con soporte legal (Res. DGL 000632 de 2023) y PDF', r.status === 201 && r.json.estado === 'EMITIDA' && r.json.pdfUrl && JSON.stringify(r.json.contenido).includes('000632 de 2023'), JSON.stringify(r.json).slice(0, 300));
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
prueba('…solo con el permiso de exportar: un conductor → 403', (await descargar(`/actas/zip?ids=${actaB.id}`, tc)).status === 403);
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
prueba('el certificado lleva al generador, la firma con ciudad y representante, y la certificación ISO', r.status === 201 && contenido.version === 2 && contenido.generador?.razonSocial === 'Generador Tercero S.A.S.'
  && contenido.firma?.ciudad === 'Sabana de Torres' && contenido.certificaciones?.some((c) => c.numero === 'CO-SC-123'), JSON.stringify(contenido).slice(0, 300));
prueba('solo los textos legales que aplican: certificación y biorremediación; sin peligrosos no van los de RESPEL; no RCD', textos.includes('CERTIFICACION') && textos.includes('BIORREMEDIACION') && !textos.includes('RCD')
  && !textos.includes('RESPONSABILIDAD_RESPEL') && !textos.includes('TRANSPORTE_RESPEL') && !textos.includes('RESPONSABILIDAD'), JSON.stringify(textos));
const pdfGen = await descargar(`/actas/${actaGen.id}/pdf`, T8);
const { createHash } = await import('node:crypto');
prueba('se guarda el hash SHA-256 del PDF emitido y coincide con el descargado', r.json.pdfSha256 === createHash('sha256').update(pdfGen.buf).digest('hex'));
r = await llamar('GET', `/verificar/${r.json.codigoVerificacion}`);
prueba('la verificación pública muestra solo número, fecha y validez', r.status === 200 && r.json.valido && r.json.numero && !('periodo' in r.json) && !('tipo' in r.json), JSON.stringify(r.json));

r = await llamar('GET', '/informes/rutas/rendimiento?desde=2026-11-25&hasta=2026-11-25', { token: T8 });
const rend = r.json.rutas?.find((x) => x.rutaId === rutaB.id);
prueba('informe de rendimiento: 1 de 1 servicios ejecutados (100 %)', r.status === 200 && rend?.habilitados === 1 && rend.ejecutados === 1 && rend.cumplimientoRuta === 100, JSON.stringify(r.json).slice(0, 300));
const costos = await descargar('/informes/rutas/costos?desde=2026-11-25&hasta=2026-11-25&formato=xlsx', T8);
prueba('informe de costos de flete en Excel', costos.status === 200 && costos.buf.subarray(0, 2).toString() === 'PK');

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
