// Datos iniciales de Terra Viva S.A.S. E.S.P. (idempotente: se puede ejecutar varias veces).
// Uso:  SEED_ADMIN_PASSWORD='ClaveSegura2026' npm run db:seed
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import shared from '@terraviva/shared';

const { CATEGORIAS, TIPOS_RESIDUO, UNIDADES_NEGOCIO, LINEAS_SERVICIO, METRICAS, TIPOS_EMBALAJE, MATERIALES_EMBALAJE, DISPOSICIONES,
  PERMISOS_CAS, RIESGOS, SISTEMAS_ETIQUETADO, CODIGOS_CLASIFICACION, MUNICIPIOS,
  ENTIDADES_SEGURIDAD_SOCIAL, ESPECIFICACIONES_ADICIONALES, ETAPAS_RECORRIDO, SERVICIOS_ESTANDAR, TEXTOS_LEGALES, TEXTOS_LEGALES_RETIRADOS, GESTORES_ALIADOS } = shared;
const db = new PrismaClient();
const hashClave = (c) => hash(c, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

const PERMISOS = [
  ['*', 'Acceso total'], ['declaraciones.crear', 'Crear declaraciones'], ['declaraciones.autorizar', 'Autorizar o rechazar declaraciones'],
  ['tarifas.asignar', 'Asignar tarifas'], ['clientes.editar', 'Crear y editar clientes y sucursales'], ['solicitudes.crear', 'Crear y gestionar solicitudes'],
  ['solicitudes.aprobar', 'Aprobar o no aprobar solicitudes'],
  ['manifiestos.operar', 'Diligenciar, firmar y grabar manifiestos'], ['manifiestos.anular', 'Anular manifiestos'],
  ['conciliaciones.gestionar', 'Conciliar cantidades y registrar facturas y pagos'], ['conciliaciones.aprobar', 'Aprobar y reabrir conciliaciones'],
  ['actas.emitir', 'Emitir, cargar y anular actas y certificados'], ['informes.ver', 'Ver informes de operación'],
  ['exportar.masivo', 'Exportar a Excel y descargar documentos en bloque (queda en la auditoría)'],
  ['rutas.programar', 'Programar rutas'], ['rutas.operar', 'Operar rutas en campo (preoperacional, paradas, estados)'],
  ['permisos.gestionar', 'Gestionar permisos ambientales y obligaciones'], ['importacion.cargar', 'Importar datos desde Excel o CSV'],
  ['importacion.revertir', 'Deshacer cargues de declaraciones de otras personas o con declaraciones autorizadas (las anula; no borra)'],
  ['reportes.facturacion', 'Ver informes de facturación'], ['configuracion.editar', 'Editar configuración'],
  // Facturación (Siigo): solo Comercial, Facturación (financiero) y Gerencia ven facturas, pagos y sus alertas
  ['finanzas.ver', 'Ver facturas, pagos, la regla de certificado de los clientes y las alertas de manifiestos sin facturar'],
  ['finanzas.gestionar', 'Sincronizar con Siigo, enlazar facturas, registrar pagos, marcar manifiestos sin cobro y liberar certificados'],
  // Comercial (reemplaza a Bigin): prospectos, oportunidades, actividades, cotizaciones e importación de Bigin
  ['comercial.gestionar', 'Prospectos, oportunidades, tareas y cotizaciones; ganar una oportunidad crea el cliente y sus declaraciones con tarifa'],
];
const ROLES = {
  Administrador: ['*'],
  Logística: ['solicitudes.crear', 'solicitudes.aprobar', 'rutas.programar', 'rutas.operar', 'importacion.cargar', 'clientes.editar',
    'manifiestos.operar', 'manifiestos.anular', 'conciliaciones.gestionar', 'informes.ver', 'exportar.masivo'],
  HSEQ: ['declaraciones.crear', 'declaraciones.autorizar', 'importacion.revertir', 'permisos.gestionar', 'rutas.operar', 'manifiestos.anular', 'actas.emitir', 'informes.ver', 'exportar.masivo'],
  Comercial: ['declaraciones.crear', 'clientes.editar', 'tarifas.asignar', 'importacion.cargar', 'solicitudes.crear', 'solicitudes.aprobar', 'informes.ver', 'exportar.masivo',
    'finanzas.ver', 'comercial.gestionar'],
  Facturación: ['tarifas.asignar', 'reportes.facturacion', 'conciliaciones.gestionar', 'conciliaciones.aprobar', 'informes.ver', 'exportar.masivo',
    'finanzas.ver', 'finanzas.gestionar'],
  Conductor: ['rutas.operar', 'manifiestos.operar'],
  Auxiliar: ['rutas.operar', 'manifiestos.operar'],
  // Portal de clientes: sin permisos de oficina; lo que ve lo decide su cliente y su perfil (apps/api/src/portal)
  'Cliente (portal)': [],
};
/** Upsert por (empresa, código) de un catálogo paramétrico del módulo Declaraciones. */
async function porEmpresa(modelo, empresaId, items, datos = (x) => ({ nombre: x.nombre, descripcion: x.descripcion ?? null })) {
  for (const x of items) await db[modelo].upsert({ where: { empresaId_codigo: { empresaId, codigo: x.codigo } }, update: datos(x), create: { empresaId, codigo: x.codigo, ...datos(x) } });
}

async function catalogo(empresaId, tipo, nombres, extra = () => ({})) {
  for (const [i, nombre] of nombres.entries()) {
    const codigo = extra(nombre).codigo ?? `${tipo.slice(0, 3)}-${i + 1}`;
    await db.catalogoItem.upsert({ where: { empresaId_tipo_codigo: { empresaId, tipo, codigo } }, update: { nombre, ...extra(nombre) }, create: { empresaId, tipo, codigo, nombre, ...extra(nombre) } });
  }
}

async function main() {
  const empresa = await db.empresa.upsert({ where: { nit: '901089780-8' }, update: {}, create: { nit: '901089780-8', razonSocial: 'TERRA VIVA S.A.S. E.S.P.' } });
  const E = empresa.id;

  for (const [codigo, nombre] of PERMISOS) await db.permiso.upsert({ where: { codigo }, update: { nombre }, create: { codigo, nombre } });
  for (const [nombre, codigos] of Object.entries(ROLES)) {
    const rol = await db.rol.upsert({ where: { empresaId_nombre: { empresaId: E, nombre } }, update: {}, create: { empresaId: E, nombre } });
    for (const c of codigos) {
      const p = await db.permiso.findUniqueOrThrow({ where: { codigo: c } });
      await db.rolPermiso.upsert({ where: { rolId_permisoId: { rolId: rol.id, permisoId: p.id } }, update: {}, create: { rolId: rol.id, permisoId: p.id } });
    }
  }

  // Listas simples
  await catalogo(E, 'CAUSAL', ['Cliente no disponible en sitio', 'Vehículo no apto (preoperacional)', 'Residuo sin embalar o sin rotular', 'Clima o vía cerrada', 'Ficha de seguridad incompleta', 'Cliente cambió de operador']);

  // Catálogos normativos (globales)
  for (const x of RIESGOS) await db.riesgo.upsert({ where: { codigo: x.codigo }, update: { nombre: x.nombre }, create: x });
  for (const x of SISTEMAS_ETIQUETADO) await db.sistemaEtiquetado.upsert({ where: { codigo: x.codigo }, update: { nombre: x.nombre }, create: x });
  for (const x of CODIGOS_CLASIFICACION) await db.codigoClasificacion.upsert({ where: { codigo: x.codigo }, update: { descripcion: x.nombre }, create: { tipo: x.tipo, codigo: x.codigo, descripcion: x.nombre } });
  for (const x of MUNICIPIOS) await db.municipio.upsert({ where: { codigoDane: x.codigoDane }, update: { nombre: x.nombre, departamento: x.departamento }, create: x });
  // DIVIPOLA completa del DANE (1.122 municipios; datos.gov.co): agrega los que falten, sin cambiar los existentes
  const divipola = JSON.parse(readFileSync(new URL('./datos/divipola.json', import.meta.url), 'utf8')).municipios;
  const nuevosMunicipios = await db.municipio.createMany({ data: divipola, skipDuplicates: true });
  if (nuevosMunicipios.count) console.log(`  + ${nuevosMunicipios.count} municipios de la DIVIPOLA`);

  // Catálogos del módulo Declaraciones (por empresa). Fuente: packages/shared/src/declaraciones/catalogos.ts
  await porEmpresa('categoriaDeclarado', E, CATEGORIAS);
  await porEmpresa('tipoResiduo', E, TIPOS_RESIDUO, (x) => ({ nombre: x.nombre }));
  await porEmpresa('unidadNegocio', E, UNIDADES_NEGOCIO, (x) => ({ nombre: x.nombre, sigla: x.sigla }));
  const unidades = Object.fromEntries((await db.unidadNegocio.findMany({ where: { empresaId: E } })).map((u) => [u.codigo, u.id]));
  await porEmpresa('lineaServicio', E, LINEAS_SERVICIO, (x) => ({ nombre: x.nombre, descripcion: x.descripcion ?? null, unidadNegocioId: unidades[x.unidad] }));
  // Servicios estándar del catálogo propio (asignación masiva a muchos clientes). Solo se crean si faltan.
  for (const x of SERVICIOS_ESTANDAR) {
    if (await db.catalogoResiduo.findFirst({ where: { empresaId: E, codigo: x.codigo } })) continue;
    const linea = await db.lineaServicio.findFirst({ where: { empresaId: E, codigo: x.linea } });
    await db.catalogoResiduo.create({ data: { empresaId: E, tipo: 'SERVICIO', codigo: x.codigo, nombre: x.nombre, lineaServicioId: linea?.id ?? null, valores: { descripcion: x.nombre } } });
  }
  await porEmpresa('metrica', E, METRICAS, (x) => ({ nombre: x.nombre, abreviacion: x.abreviacion, uso: x.uso, factorAKg: x.factorAKg }));
  await porEmpresa('tipoEmbalaje', E, TIPOS_EMBALAJE, (x) => ({ nombre: x.nombre, esOtro: !!x.esOtro }));
  await porEmpresa('materialEmbalaje', E, MATERIALES_EMBALAJE, (x) => ({ nombre: x.nombre, esOtro: !!x.esOtro }));
  await porEmpresa('disposicion', E, DISPOSICIONES, (x) => ({ nombre: x.nombre, requierePermiso: x.requierePermiso, propia: x.propia, soporteLegal: x.soporteLegal, activo: x.activo !== false, admitePeligrosos: x.admitePeligrosos !== false, hidrocarburos: x.hidrocarburos ?? 'ADMITE' }));

  // Permisos ambientales y obligaciones reales (respuestas de la gerencia A1 y A4, 19-11-2026).
  // Idempotente: crea lo que falta y completa fechas vacías; no pisa lo que se haya cambiado en la aplicación.
  for (const x of PERMISOS_CAS) {
    const autoridad = x.autoridad ?? 'CAS';
    let p = await db.permisoAmbiental.findFirst({ where: { empresaId: E, acto: x.acto } });
    if (!p) p = await db.permisoAmbiental.create({ data: { empresaId: E, acto: x.acto, autoridad, alcance: x.alcance, estado: 'VIGENTE',
      expedicion: x.expedicion ? new Date(x.expedicion) : null, vence: x.vence ? new Date(x.vence) : null } });
    else p = await db.permisoAmbiental.update({ where: { id: p.id }, data: {
      alcance: x.alcance, autoridad, expedicion: p.expedicion ?? (x.expedicion ? new Date(x.expedicion) : null),
      // El vencimiento solo se mueve hacia adelante (Res. 000632: provisional hasta la constancia de ejecutoria)
      vence: x.vence && (!p.vence || p.vence < new Date(x.vence)) ? new Date(x.vence) : p.vence,
    } });
    for (const codigo of x.disposiciones) {
      const d = await db.disposicion.findUniqueOrThrow({ where: { empresaId_codigo: { empresaId: E, codigo } } });
      await db.permisoDisposicion.upsert({ where: { permisoId_disposicionId: { permisoId: p.id, disposicionId: d.id } }, update: {}, create: { permisoId: p.id, disposicionId: d.id } });
    }
    for (const o of x.obligaciones) {
      if (await db.obligacionPermiso.findFirst({ where: { permisoId: p.id, descripcion: o.descripcion } })) continue;
      await db.obligacionPermiso.create({ data: { permisoId: p.id, codigo: o.codigo ?? null, descripcion: o.descripcion, periodicidad: o.periodicidad,
        meses: o.meses ?? null, proximaFecha: o.proxima ? new Date(o.proxima) : null, articulo: o.articulo } });
    }
  }

  // Gestores aliados (respuesta A5): licencia, autoridad, vigencia (o indefinida), alcance y exclusiones; varios por
  // disposición. Completa solo lo vacío: lo que se registre después en la aplicación se respeta.
  for (const g of GESTORES_ALIADOS) {
    let p = await db.proveedor.findFirst({ where: { empresaId: E, nit: g.nit } });
    // Sin NIT confirmado se busca por el nombre: así, cuando se registre el NIT en la aplicación, no se crea otro
    if (!p && !/^\d/.test(g.nit)) p = await db.proveedor.findFirst({ where: { empresaId: E, razonSocial: g.razonSocial } });
    const vigencia = { licenciaVence: g.vence ? new Date(g.vence) : null, licenciaIndefinida: !!g.indefinida };
    if (!p) p = await db.proveedor.create({ data: { empresaId: E, nit: g.nit, razonSocial: g.razonSocial, municipio: g.municipio ?? null, esDestino: true, esPropio: false,
      activo: g.activo !== false, licencia: g.licencia ?? null, licenciaAutoridad: g.autoridad ?? null, alcance: g.alcance, excluyeTiposResiduo: g.excluyeTiposResiduo ?? [], ...vigencia,
      soporteComercial: g.soporteComercial ?? null, soporteComercialFecha: g.soporteComercialFecha ? new Date(g.soporteComercialFecha) : null } });
    else p = await db.proveedor.update({ where: { id: p.id }, data: {
      ...(g.nombresAnteriores?.includes(p.razonSocial) ? { razonSocial: g.razonSocial } : {}),
      licencia: p.licencia || g.licencia || null, licenciaAutoridad: p.licenciaAutoridad || g.autoridad || null, alcance: p.alcance || g.alcance,
      excluyeTiposResiduo: p.excluyeTiposResiduo.length ? p.excluyeTiposResiduo : g.excluyeTiposResiduo ?? [],
      ...(p.licenciaVence || p.licenciaIndefinida ? {} : vigencia),
      municipio: p.municipio || g.municipio || null, soporteComercial: p.soporteComercial || g.soporteComercial || null,
      soporteComercialFecha: p.soporteComercialFecha ?? (g.soporteComercialFecha ? new Date(g.soporteComercialFecha) : null),
    } });
    // Con quién se trabaja hoy: lo marca el catálogo mientras nadie lo haya cambiado en la aplicación (queda en la auditoría)
    if (p.activo !== (g.activo !== false)
      && !(await db.auditoria.count({ where: { entidad: 'proveedor', entidadId: p.id, accion: { in: ['ACTIVAR', 'INACTIVAR'] } } })))
      p = await db.proveedor.update({ where: { id: p.id }, data: { activo: g.activo !== false } });
    for (const codigo of g.disposiciones) {
      const d = await db.disposicion.findUniqueOrThrow({ where: { empresaId_codigo: { empresaId: E, codigo } } });
      await db.disposicionGestor.upsert({ where: { disposicionId_proveedorId: { disposicionId: d.id, proveedorId: p.id } }, update: {}, create: { disposicionId: d.id, proveedorId: p.id } });
    }
  }

  // Textos legales del certificado (respuesta A2). Van por versiones: si la versión vigente la puso esta siembra y el texto
  // cambió, se retira y se crea la siguiente; si la cambió una persona en Ajustes, se respeta.
  const mismoTexto = (a, b) => a.texto === b.texto && a.titulo === b.titulo && a.orden === b.orden && a.soloPeligrosos === !!b.soloPeligrosos
    && JSON.stringify([...a.disposiciones].sort()) === JSON.stringify([...b.disposiciones].sort());
  for (const t of TEXTOS_LEGALES) {
    const versiones = await db.textoLegal.findMany({ where: { empresaId: E, codigo: t.codigo }, orderBy: { version: 'desc' } });
    const vigente = versiones.find((v) => v.activo);
    const datos = { titulo: t.titulo, texto: t.texto, disposiciones: t.disposiciones, orden: t.orden, soloPeligrosos: !!t.soloPeligrosos, revisado: !!t.revisado };
    if (!versiones.length) { await db.textoLegal.create({ data: { empresaId: E, codigo: t.codigo, version: 1, activo: t.activo !== false, ...datos } }); continue; }
    if (!vigente || vigente.creadoPorId) continue;
    if (mismoTexto(vigente, t)) {
      if (vigente.revisado !== !!t.revisado) await db.textoLegal.update({ where: { id: vigente.id }, data: { revisado: !!t.revisado } });
      continue;
    }
    await db.$transaction([
      db.textoLegal.update({ where: { id: vigente.id }, data: { activo: false } }),
      ...(t.activo === false ? [] : [db.textoLegal.create({ data: { empresaId: E, codigo: t.codigo, version: versiones[0].version + 1, activo: true, ...datos } })]),
    ]);
  }
  for (const codigo of TEXTOS_LEGALES_RETIRADOS)
    await db.textoLegal.updateMany({ where: { empresaId: E, codigo, activo: true, creadoPorId: null }, data: { activo: false } });

  // Configuración de los documentos (respuesta C2). Completa solo lo vacío. El nombre del representante legal y los datos
  // de calibración de la báscula se escriben en Ajustes › Datos de la empresa.
  const CERTIFICACIONES = [
    { norma: 'ISO 9001:2015', numero: 'SC-CER627273', entidad: 'ICONTEC', vence: '2027-08-02' },
    { norma: 'ISO 14001:2015', numero: 'SA-CER627275', entidad: 'ICONTEC', vence: '2027-08-02' },
    { norma: 'ISO 45001:2018', numero: 'OS-CER627378', entidad: 'ICONTEC', vence: '2027-08-02' },
    { norma: 'NORSOK S-006', numero: '', entidad: '', vence: '' }, // sin certificado vigente: el sello no se imprime
  ];
  const emp = await db.empresa.findUniqueOrThrow({ where: { id: E } });
  const conf = { ...(emp.configuracion ?? {}) };
  if (!conf.ciudadFirma) conf.ciudadFirma = 'Sabana de Torres';
  if (!conf.cargoFirmante || conf.cargoFirmante === 'Representante legal') conf.cargoFirmante = 'Representante Legal';
  conf.representanteLegal ??= '';
  conf.notaBascula ??= '';
  // Contacto del certificado y de la constancia de RCD (sin teléfonos ni correos: se escriben en Ajustes)
  conf.contacto = { direccion: 'Parque de Saneamiento Ambiental Los Pinos, km 7,5 vía antigua Aprisa, vereda Villa de Leyva', municipio: 'Sabana de Torres (Santander)', telefono: '', correo: '', ...(conf.contacto ?? {}) };
  // Número único de gestor de RCD (Anexo II): por defecto, el acto de inscripción ante la CAS; se cambia en Ajustes
  conf.rcd = { numeroGestor: 'Resolución SAO No. 00235-24 de 2024 (CAS)', ...(conf.rcd ?? {}) };
  conf.bascula ??= { identificacion: '', certificado: '', fecha: '', laboratorio: '', vigenteHasta: '' };
  const previas = Array.isArray(conf.certificaciones) ? conf.certificaciones : [];
  conf.certificaciones = [
    ...CERTIFICACIONES.map((c) => { const p = previas.find((x) => x?.norma === c.norma); return p?.numero ? { entidad: c.entidad, vence: c.vence, ...p } : c; }),
    ...previas.filter((p) => p?.norma && !CERTIFICACIONES.some((c) => c.norma === p.norma)),
  ];
  await db.empresa.update({ where: { id: E }, data: { configuracion: conf } });

  // Zonas, bodegas, destinos
  for (const [nombre, color] of [['Área Metropolitana BGA', '#2A78D6'], ['Magdalena Medio', '#EB6834'], ['Sabana – Lebrija', '#1BAF7A'], ['Provincia de Mares / Chucurí', '#EDA100']])
    if (!(await db.zona.findFirst({ where: { empresaId: E, nombre } }))) await db.zona.create({ data: { empresaId: E, nombre, color } });
  for (const nombre of ['PSA Los Pinos · Acopio aprovechables', 'PSA Los Pinos · Tanque ACU']) // la celda de RESPEL no: Los Pinos no almacena peligrosos sin licencia
    if (!(await db.bodega.findFirst({ where: { empresaId: E, nombre } }))) await db.bodega.create({ data: { empresaId: E, nombre } });
  if (!(await db.proveedor.findFirst({ where: { empresaId: E, esPropio: true } })))
    await db.proveedor.create({ data: { empresaId: E, nit: '901089780', razonSocial: 'TERRA VIVA S.A.S. E.S.P. · Parque de Saneamiento Ambiental Los Pinos', esPropio: true, municipio: 'Sabana de Torres', licencia: 'Res. DGL 000632 de 2023 y Res. SAO No. 00235-24 (CAS)' } });
  await db.proveedor.updateMany({ where: { empresaId: E, esPropio: true, licencia: 'Res. CAS 0632-2023 / 0235-2024' }, data: { licencia: 'Res. DGL 000632 de 2023 y Res. SAO No. 00235-24 (CAS)' } });

  // Etapas del recorrido. Las de orden > 1 que no son finales exigen vehículo, conductor e inspección aprobada.
  // «rastreo»: GPS solo mientras la ruta está en esa etapa. «cancela»: libera las líneas sin recoger.
  for (const [orden, nombre, color, esFinal, cancela, rastreo, descripcion] of ETAPAS_RECORRIDO) {
    const e = await db.estadoRecorrido.findFirst({ where: { empresaId: E, nombre } });
    if (!e) await db.estadoRecorrido.create({ data: { empresaId: E, nombre, color, orden, esFinal, cancela, rastreo, descripcion } });
    else if (e.descripcion === null) await db.estadoRecorrido.update({ where: { id: e.id }, data: { cancela, rastreo, descripcion } }); // completa las de la fase 1 sin pisar ajustes
  }

  // Núcleo operativo: ARL/EPS (globales) y especificaciones adicionales
  for (const x of ENTIDADES_SEGURIDAD_SOCIAL) await db.entidadSeguridadSocial.upsert({ where: { tipo_nombre: { tipo: x.tipo, nombre: x.nombre } }, update: {}, create: x });
  await porEmpresa('especificacionAdicional', E, ESPECIFICACIONES_ADICIONALES, (x) => ({ nombre: x.nombre, descripcion: x.descripcion ?? null, abreviatura: x.abreviatura }));

  // Elementos de la inspección preoperacional (críticos bloquean la salida)
  const CHEQUEO = [
    ['Documentos', 'Licencia de conducción vigente', true], ['Documentos', 'SOAT y revisión técnico-mecánica vigentes', true], ['Documentos', 'Tarjeta de emergencia por residuo transportado', true], ['Documentos', 'Plan de contingencia a bordo', true],
    ['Vehículo', 'Frenos de servicio y de emergencia', true], ['Vehículo', 'Luces y direccionales', true], ['Vehículo', 'Llantas y repuesto', true], ['Vehículo', 'Niveles de aceite, refrigerante y frenos', false],
    ['Seguridad', 'Rótulos UN y pictogramas NTC 1692', true], ['Seguridad', 'Kit de derrames completo', true], ['Seguridad', 'Extintores cargados', true], ['Seguridad', 'Botiquín y conos', false],
    ['EPP', 'Overol, guantes y botas', true], ['EPP', 'Respirador con cartuchos vigentes', true], ['EPP', 'Casco y gafas', false],
  ];
  for (const [grupo, nombre, critico] of CHEQUEO)
    if (!(await db.elementoChequeo.findFirst({ where: { empresaId: E, nombre } }))) await db.elementoChequeo.create({ data: { empresaId: E, grupo, nombre, critico } });

  // Flota (placas y marcas reales; tipo y capacidad de referencia, ajústelos con la plantilla de vehículos)
  for (const [placa, marca, tipo, capacidad, unidadCap, color] of [
    ['USD855', 'Chevrolet', 'Furgón', 3500, 'KG', '#D92D20'], ['LPM482', 'JMC', 'Furgón', 2000, 'KG', '#1E9BD7'], ['LPM490', 'JMC', 'Furgón', 2000, 'KG', '#2F49C9'],
    ['DXY545', 'Chevrolet', 'Volqueta', 14, 'M3', '#1F8A3B'], ['UPS485', 'Chevrolet', 'Camión estacas', 5000, 'KG', '#7A3FD1'], ['MDF180', 'Chevrolet', 'Carrotanque / vactor', 12, 'M3', '#F2790F'],
  ]) await db.vehiculo.upsert({ where: { placa }, update: { marca, color }, create: { empresaId: E, placa, marca, tipo, capacidad, unidadCap, color } });

  // Usuario administrador
  const email = (process.env.SEED_ADMIN_EMAIL ?? 'gerencia@terravivasas.com').toLowerCase();
  if (!(await db.usuario.findUnique({ where: { email } }))) {
    const clave = process.env.SEED_ADMIN_PASSWORD || randomBytes(9).toString('base64url');
    const rol = await db.rol.findUniqueOrThrow({ where: { empresaId_nombre: { empresaId: E, nombre: 'Administrador' } } });
    await db.usuario.create({ data: { empresaId: E, rolId: rol.id, nombre: 'Gerencia', documento: '0', email, passwordHash: await hashClave(clave) } });
    console.log(`\n  Usuario administrador: ${email}\n  Contraseña: ${process.env.SEED_ADMIN_PASSWORD ? '(la de SEED_ADMIN_PASSWORD)' : clave}\n  Cámbiela después del primer ingreso.\n`);
  }
  console.log('✓ Datos iniciales cargados');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
