// Reglas comerciales de los clientes, compartidas por la oficina, el portal y el API (gerencia, 19-11-2026).

/** Por qué se inactiva un cliente. En «otra eventualidad» se describe en la nota. */
export const MOTIVOS_INACTIVACION = {
  PAGOS_PENDIENTES: 'Pagos pendientes',
  ENTREGAS_NO_AUTORIZADAS: 'Entregas no autorizadas',
  OTRO: 'Otra eventualidad',
} as const;
export type MotivoInactivacionCliente = keyof typeof MOTIVOS_INACTIVACION;

/**
 * Aviso amable que ve en el portal un cliente inactivo. Nunca muestra la nota interna de la oficina: solo le dice qué
 * puede seguir haciendo (consultar y descargar) y con quién hablar para reactivarse.
 */
export const AVISO_CLIENTE_INACTIVO: Record<MotivoInactivacionCliente, string> = {
  PAGOS_PENDIENTES: 'Su cuenta está inactiva mientras se ponen al día los pagos pendientes. Puede seguir consultando su información; para pedir servicios o cargar declaraciones, comuníquese con su asesor comercial o con nuestra área de cartera.',
  ENTREGAS_NO_AUTORIZADAS: 'Su cuenta está inactiva mientras revisamos con usted entregas de residuos que no estaban autorizadas. Puede seguir consultando su información; para reactivarla, comuníquese con su asesor comercial.',
  OTRO: 'Su cuenta está inactiva por el momento. Puede seguir consultando su información; para pedir servicios o cargar declaraciones, comuníquese con su asesor comercial.',
};

/**
 * Regla del certificado de disposición de cada cliente (Siigo, gerencia 19-11-2026). Desde el 20-11-2026 la regla de Terra
 * Viva es «Exigir factura»: el acta solo se libera cuando el manifiesto está facturado. Las reglas más flexibles son
 * excepciones: solo las dan Facturación o Gerencia, con su motivo (queda en la auditoría).
 */
export const REGLAS_CERTIFICADO = {
  EXIGIR_FACTURA: { nombre: 'Exigir factura (regla de Terra Viva)', descripcion: 'No se emite ni se descarga el certificado mientras sus manifiestos no tengan factura.' },
  EXIGIR_PAGO: { nombre: 'Exigir pago', descripcion: 'Más estricta: no se emite ni se descarga el certificado mientras sus facturas no estén pagadas.' },
  AL_VENCER: { nombre: 'Excepción: retener solo si hay facturas vencidas', descripcion: 'Se emite siempre; en el portal se descarga salvo que tenga una factura vencida (días de gracia en Ajustes).' },
  LIBRE: { nombre: 'Excepción: libre', descripcion: 'Se emite y se descarga sin restricciones financieras.' },
} as const;
export type ReglaCertificado = keyof typeof REGLAS_CERTIFICADO;
/** La regla de la empresa; las más flexibles que ella son excepciones con motivo. */
export const REGLA_CERTIFICADO_EMPRESA: ReglaCertificado = 'EXIGIR_FACTURA';
export const esExcepcionCertificado = (r: ReglaCertificado) => r === 'AL_VENCER' || r === 'LIBRE';

/** Sector económico del cliente: lista cerrada (los primeros seis los pidió la gerencia; el resto completa «entre otros»). */
export const SECTORES = [
  'Hidrocarburos', 'Doméstico', 'Industrial', 'Agrícola', 'Minero', 'Alimenticio',
  'Salud', 'Construcción', 'Comercio y servicios', 'Transporte', 'Entidad pública', 'Educativo', 'Otro',
] as const;

const normal = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
/** Nombres que se escribían antes a mano y su sector de la lista. */
const SINONIMOS: Record<string, (typeof SECTORES)[number]> = {
  petrolero: 'Hidrocarburos', petroleo: 'Hidrocarburos', 'oil & gas': 'Hidrocarburos', 'oil and gas': 'Hidrocarburos', 'petroleo y gas': 'Hidrocarburos',
  residencial: 'Doméstico', hogar: 'Doméstico', hogares: 'Doméstico', domiciliario: 'Doméstico',
  industria: 'Industrial', manufactura: 'Industrial',
  agricola: 'Agrícola', agricultura: 'Agrícola', agro: 'Agrícola', agroindustria: 'Agrícola', agroindustrial: 'Agrícola', palma: 'Agrícola', 'palma de aceite': 'Agrícola', palmero: 'Agrícola', pecuario: 'Agrícola', agropecuario: 'Agrícola',
  mineria: 'Minero', minas: 'Minero',
  alimentos: 'Alimenticio', alimentario: 'Alimenticio', 'alimentos y bebidas': 'Alimenticio',
  hospitalario: 'Salud', hospital: 'Salud', clinica: 'Salud',
  construccion: 'Construcción', 'obras civiles': 'Construcción',
  comercio: 'Comercio y servicios', servicios: 'Comercio y servicios', comercial: 'Comercio y servicios',
  publico: 'Entidad pública', gobierno: 'Entidad pública', oficial: 'Entidad pública',
  educacion: 'Educativo',
};

/** El sector de la lista que corresponde a un texto, sin importar tildes ni mayúsculas (o un sinónimo); null si no hay. */
export function sectorDe(texto: string | null | undefined): (typeof SECTORES)[number] | null {
  if (!texto?.trim()) return null;
  const n = normal(texto);
  return SECTORES.find((s) => normal(s) === n) ?? SINONIMOS[n] ?? null;
}
