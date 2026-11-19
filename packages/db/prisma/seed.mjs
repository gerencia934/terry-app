// Datos iniciales de Terra Viva S.A.S. E.S.P. (idempotente: se puede ejecutar varias veces).
// Uso:  SEED_ADMIN_PASSWORD='ClaveSegura2026' npm run db:seed
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';
import shared from '@terraviva/shared';

const { CATEGORIAS, TIPOS_RESIDUO, UNIDADES_NEGOCIO, LINEAS_SERVICIO, METRICAS, TIPOS_EMBALAJE, MATERIALES_EMBALAJE, DISPOSICIONES,
  PERMISOS_CAS, RIESGOS, SISTEMAS_ETIQUETADO, CODIGOS_CLASIFICACION, MUNICIPIOS } = shared;
const db = new PrismaClient();
const hashClave = (c) => hash(c, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

const PERMISOS = [
  ['*', 'Acceso total'], ['declaraciones.crear', 'Crear declaraciones'], ['declaraciones.autorizar', 'Autorizar o rechazar declaraciones'],
  ['tarifas.asignar', 'Asignar tarifas'], ['clientes.editar', 'Crear y editar clientes y sucursales'], ['solicitudes.crear', 'Crear y gestionar solicitudes'],
  ['rutas.programar', 'Programar rutas'], ['rutas.operar', 'Operar rutas en campo (preoperacional, paradas, estados)'],
  ['permisos.gestionar', 'Gestionar permisos ambientales y obligaciones'], ['importacion.cargar', 'Importar datos desde Excel'],
  ['reportes.facturacion', 'Ver informes de facturación'], ['configuracion.editar', 'Editar configuración'],
];
const ROLES = {
  Administrador: ['*'],
  Logística: ['solicitudes.crear', 'rutas.programar', 'rutas.operar', 'importacion.cargar', 'clientes.editar'],
  HSEQ: ['declaraciones.crear', 'declaraciones.autorizar', 'permisos.gestionar', 'rutas.operar'],
  Comercial: ['declaraciones.crear', 'clientes.editar', 'tarifas.asignar', 'importacion.cargar'],
  Facturación: ['tarifas.asignar', 'reportes.facturacion'],
  Conductor: ['rutas.operar'],
  Auxiliar: ['rutas.operar'],
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

  // Catálogos del módulo Declaraciones (por empresa). Fuente: packages/shared/src/declaraciones/catalogos.ts
  await porEmpresa('categoriaDeclarado', E, CATEGORIAS);
  await porEmpresa('tipoResiduo', E, TIPOS_RESIDUO, (x) => ({ nombre: x.nombre }));
  await porEmpresa('unidadNegocio', E, UNIDADES_NEGOCIO, (x) => ({ nombre: x.nombre, sigla: x.sigla }));
  const unidades = Object.fromEntries((await db.unidadNegocio.findMany({ where: { empresaId: E } })).map((u) => [u.codigo, u.id]));
  await porEmpresa('lineaServicio', E, LINEAS_SERVICIO, (x) => ({ nombre: x.nombre, descripcion: x.descripcion ?? null, unidadNegocioId: unidades[x.unidad] }));
  await porEmpresa('metrica', E, METRICAS, (x) => ({ nombre: x.nombre, abreviacion: x.abreviacion, uso: x.uso, factorAKg: x.factorAKg }));
  await porEmpresa('tipoEmbalaje', E, TIPOS_EMBALAJE, (x) => ({ nombre: x.nombre, esOtro: !!x.esOtro }));
  await porEmpresa('materialEmbalaje', E, MATERIALES_EMBALAJE, (x) => ({ nombre: x.nombre, esOtro: !!x.esOtro }));
  await porEmpresa('disposicion', E, DISPOSICIONES, (x) => ({ nombre: x.nombre, requierePermiso: x.requierePermiso, propia: x.propia, soporteLegal: x.soporteLegal }));

  // Permisos ambientales de la CAS y qué disposiciones ampara cada uno.
  // ⚠ Las obligaciones y fechas son de ejemplo: ajústelas al acto administrativo.
  for (const { acto, alcance, disposiciones, obligacion: [desc, per, f] } of PERMISOS_CAS) {
    let p = await db.permisoAmbiental.findFirst({ where: { empresaId: E, acto } });
    if (!p) p = await db.permisoAmbiental.create({ data: { empresaId: E, acto, autoridad: 'CAS', alcance, estado: 'VIGENTE' } });
    for (const codigo of disposiciones) {
      const d = await db.disposicion.findUniqueOrThrow({ where: { empresaId_codigo: { empresaId: E, codigo } } });
      await db.permisoDisposicion.upsert({ where: { permisoId_disposicionId: { permisoId: p.id, disposicionId: d.id } }, update: {}, create: { permisoId: p.id, disposicionId: d.id } });
    }
    if (!(await db.obligacionPermiso.count({ where: { permisoId: p.id } })))
      await db.obligacionPermiso.create({ data: { permisoId: p.id, descripcion: `${desc} (VERIFICAR fecha y periodicidad en el acto)`, periodicidad: per, proximaFecha: new Date(f) } });
  }

  // Zonas, bodegas, destinos
  for (const [nombre, color] of [['Área Metropolitana BGA', '#2A78D6'], ['Magdalena Medio', '#EB6834'], ['Sabana – Lebrija', '#1BAF7A'], ['Provincia de Mares / Chucurí', '#EDA100']])
    if (!(await db.zona.findFirst({ where: { empresaId: E, nombre } }))) await db.zona.create({ data: { empresaId: E, nombre, color } });
  for (const nombre of ['PSA Los Pinos · Celda temporal RESPEL', 'PSA Los Pinos · Acopio aprovechables', 'PSA Los Pinos · Tanque ACU'])
    if (!(await db.bodega.findFirst({ where: { empresaId: E, nombre } }))) await db.bodega.create({ data: { empresaId: E, nombre } });
  if (!(await db.proveedor.findFirst({ where: { empresaId: E, esPropio: true } })))
    await db.proveedor.create({ data: { empresaId: E, nit: '901089780', razonSocial: 'TERRA VIVA S.A.S. E.S.P. · Parque de Saneamiento Ambiental Los Pinos', esPropio: true, municipio: 'Sabana de Torres', licencia: 'Res. CAS 0632-2023 / 0235-2024' } });

  // Etapas del recorrido. Las de orden > 1 que no son finales exigen preoperacional aprobado.
  for (const [orden, nombre, color, esFinal] of [[1, 'Programada', '#6B7A72', false], [2, 'En camino', '#E5B800', false], [3, 'Donde el generador', '#1E9BD7', false], [4, 'Descargado en planta', '#1F8A3B', true], [5, 'Cancelada', '#D92D20', true]])
    if (!(await db.estadoRecorrido.findFirst({ where: { empresaId: E, nombre } }))) await db.estadoRecorrido.create({ data: { empresaId: E, nombre, color, orden, esFinal } });

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
