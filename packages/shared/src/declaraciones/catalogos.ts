// Catálogos iniciales del módulo Declaraciones (datos reales de Terra Viva S.A.S. E.S.P.).
// Fuente única: los usa el seed de la base de datos, las plantillas de cargue masivo y el modo demostración.
// Los marcados «VERIFICAR» deben confirmarse con Terra Viva antes de producción.

export interface ItemCatalogo { codigo: string; nombre: string; descripcion?: string }

/** Categorías del declarado (confirmadas por Terra Viva el 18-11-2026). */
export const CATEGORIAS: ItemCatalogo[] = [
  { codigo: 'RESPEL', nombre: 'Residuos peligrosos' },
  { codigo: 'NOPEL', nombre: 'Residuos no peligrosos' },
  { codigo: 'APROV', nombre: 'Aprovechables' },
  { codigo: 'ESPEC', nombre: 'Especiales (RCD, ACU, posconsumo)' },
  { codigo: 'SERV', nombre: 'Servicios' },
];

export const TIPOS_RESIDUO: ItemCatalogo[] = [
  { codigo: 'HOSP', nombre: 'Hospitalario' }, { codigo: 'IND', nombre: 'Industrial' }, { codigo: 'ESP', nombre: 'Especial' },
  { codigo: 'REC', nombre: 'Reciclable' }, { codigo: 'RAEE', nombre: 'RAEE' }, { codigo: 'ORG', nombre: 'Orgánico' },
  { codigo: 'NA', nombre: 'No aplica (servicios)' },
];

export const UNIDADES_NEGOCIO: (ItemCatalogo & { sigla: string | null })[] = [
  { codigo: '01', nombre: 'Tratamiento de residuos', sigla: 'TTR' },
  { codigo: '02', nombre: 'Transporte', sigla: 'TPT' },
  { codigo: '03', nombre: 'Fumigación', sigla: 'FUM' },
  { codigo: '04', nombre: 'Obras civiles', sigla: 'CIV' },
  { codigo: '05', nombre: 'Aprovechamiento', sigla: 'APR' },
  { codigo: '11', nombre: 'Mantenimiento hidrosanitario', sigla: null }, // VERIFICAR sigla
];

export const LINEAS_SERVICIO: (ItemCatalogo & { unidad: string })[] = [
  { codigo: '01', unidad: '01', nombre: 'Operaciones propias de tratamiento y disposición' },
  { codigo: '02', unidad: '01', nombre: 'Tratamiento y disposición externa (tercerizada)' },
  { codigo: '03', unidad: '01', nombre: 'Gestión y disposición de residuos de construcción' },
  { codigo: '04', unidad: '02', nombre: 'Transporte de residuos y materiales peligrosos' },
  { codigo: '05', unidad: '04', nombre: 'Ejecución de obras civiles y ambientales' },
  { codigo: '06', unidad: '03', nombre: 'Saneamiento y fumigación especializada' },
  { codigo: '07', unidad: '05', nombre: 'Venta de aprovechables' },
  { codigo: '08', unidad: '05', nombre: 'Compra y retoma de materiales reciclables' },
  { codigo: '09', unidad: '01', nombre: 'Servicios especiales de gestión y limpieza' },
  { codigo: '10', unidad: '05', nombre: 'Lodos de procesos industriales de preparación de alimentos' },
  { codigo: '11', unidad: '11', nombre: 'Lavado de tanque', descripcion: 'Mantenimiento, lavado y desinfección de tanque' },
  { codigo: '12', unidad: '01', nombre: 'Mantenimiento de unidades sanitarias portátiles' },
  { codigo: '15', unidad: '11', nombre: 'Hidrolimpieza técnica de cajas', descripcion: 'Lavado con agua a alta presión (hidrojet). Tarifa plana por caja intervenida' },
  { codigo: '19', unidad: '11', nombre: 'Mantenimiento preventivo con hidrolavadora', descripcion: 'Lavado a presión con hidrolavadora' },
  { codigo: '20', unidad: '01', nombre: 'Isotanques', descripcion: 'Isotanque contaminado' },
];

export const METRICAS: (ItemCatalogo & { abreviacion: string; uso: 'PRECIO' | 'DENSIDAD'; factorAKg: number | null })[] = [
  { codigo: 'kg', nombre: 'Kilogramo', abreviacion: 'kg', uso: 'PRECIO', factorAKg: 1 },
  { codigo: 'ton', nombre: 'Tonelada', abreviacion: 'ton', uso: 'PRECIO', factorAKg: 1000 },
  { codigo: 'm3', nombre: 'Metro cúbico', abreviacion: 'm³', uso: 'PRECIO', factorAKg: null },
  { codigo: 'gal', nombre: 'Galón', abreviacion: 'gal', uso: 'PRECIO', factorAKg: null },
  { codigo: 'L', nombre: 'Litro', abreviacion: 'L', uso: 'PRECIO', factorAKg: null },
  { codigo: 'und', nombre: 'Unidad', abreviacion: 'und', uso: 'PRECIO', factorAKg: null },
  { codigo: 'viaje', nombre: 'Viaje', abreviacion: 'viaje', uso: 'PRECIO', factorAKg: null },
  { codigo: 'kg/m3', nombre: 'Kilogramo por metro cúbico', abreviacion: 'kg/m³', uso: 'DENSIDAD', factorAKg: null },
  { codigo: 'g/cm3', nombre: 'Gramo por centímetro cúbico', abreviacion: 'g/cm³', uso: 'DENSIDAD', factorAKg: null },
  { codigo: 'g/L', nombre: 'Gramo por litro', abreviacion: 'g/L', uso: 'DENSIDAD', factorAKg: null },
  { codigo: 'g/mL', nombre: 'Gramo por mililitro', abreviacion: 'g/mL', uso: 'DENSIDAD', factorAKg: null },
  { codigo: 'kg/L', nombre: 'Kilogramo por litro', abreviacion: 'kg/L', uso: 'DENSIDAD', factorAKg: null },
];

export const TIPOS_EMBALAJE: (ItemCatalogo & { esOtro?: boolean })[] = [
  { codigo: 'BIGBAG', nombre: 'Big bag' }, { codigo: 'BOLSA', nombre: 'Bolsa' }, { codigo: 'CAJA', nombre: 'Caja' },
  { codigo: 'VACTOR', nombre: 'Camión de vacío' }, { codigo: 'CANECA', nombre: 'Caneca o tambor' }, { codigo: 'ESTIBA', nombre: 'Carga estibada' },
  { codigo: 'FURGON', nombre: 'Furgón cerrado' }, { codigo: 'GRANEL', nombre: 'A granel' }, { codigo: 'GUARDIAN', nombre: 'Guardián' },
  { codigo: 'ISOTANQUE', nombre: 'Isotanque' }, { codigo: 'TANQUE', nombre: 'Carrotanque' }, { codigo: 'OTRO', nombre: 'Otro', esOtro: true },
];

export const MATERIALES_EMBALAJE: (ItemCatalogo & { esOtro?: boolean })[] = [
  { codigo: 'MET', nombre: 'Metálico' }, { codigo: 'PLA', nombre: 'Plástico' }, { codigo: 'LONA', nombre: 'Lona' },
  { codigo: 'CAR', nombre: 'Cartón' }, { codigo: 'MAD', nombre: 'Madera' }, { codigo: 'PAP', nombre: 'Papel' },
  { codigo: 'VID', nombre: 'Vidrio' }, { codigo: 'OTRO', nombre: 'Otro', esOtro: true },
];

/** Disposición / manejo y cómo queda cubierta legalmente (ver regla fn_disposicion_cubierta). */
export const DISPOSICIONES: (ItemCatalogo & { requierePermiso: boolean; propia: boolean; soporteLegal: string })[] = [
  { codigo: 'APR', nombre: 'Aprovechamiento', requierePermiso: false, propia: true, soporteLegal: 'Objeto social — Certificado de existencia y representación legal' },
  { codigo: 'REC', nombre: 'Reciclaje o valorización', requierePermiso: false, propia: true, soporteLegal: 'Objeto social — Certificado de existencia y representación legal' },
  { codigo: 'BIO', nombre: 'Biorremediación (landfarming)', requierePermiso: true, propia: true, soporteLegal: 'Res. CAS 0632-2023' },
  { codigo: 'ASP', nombre: 'Tratamiento y vertimiento a suelo de aguas residuales, lodos, cortes y salmueras', requierePermiso: true, propia: true, soporteLegal: 'Res. CAS 0632-2023' },
  { codigo: 'RCD', nombre: 'Gestión integral de RCD (aprovechamiento y disposición final)', requierePermiso: true, propia: true, soporteLegal: 'Res. CAS 0235-2024' },
  { codigo: 'ACU', nombre: 'Aprovechamiento de ACU (biodiésel)', requierePermiso: true, propia: true, soporteLegal: 'OF-311-21 y Res. CAS 316 de 2018' },
  { codigo: 'TRA', nombre: 'Transporte de RESPEL, hidrocarburos y sustancias nocivas', requierePermiso: true, propia: true, soporteLegal: 'Auto SAA 0244-21 (Plan de contingencia)' },
  { codigo: 'LAV', nombre: 'Lavado y reúso', requierePermiso: true, propia: true, soporteLegal: 'VERIFICAR' },
  { codigo: 'INCH', nombre: 'Incineración (hospitalarios y similares)', requierePermiso: true, propia: false, soporteLegal: 'Res. 0144 de 2000 CDMB (gestor aliado)' },
  { codigo: 'INCO', nombre: 'Incineración y celda ordinaria', requierePermiso: true, propia: false, soporteLegal: 'Res. 0144 de 2000 CDMB (gestor aliado)' },
  { codigo: 'RS', nombre: 'Relleno sanitario', requierePermiso: true, propia: false, soporteLegal: 'Res. CAS 0001121 de 2014 (gestor aliado)' },
  { codigo: 'COP', nombre: 'Coprocesamiento', requierePermiso: true, propia: false, soporteLegal: 'Licencia del gestor aliado' },
  { codigo: 'DES', nombre: 'Desensamble y aprovechamiento (RAEE)', requierePermiso: true, propia: false, soporteLegal: 'Licencia del gestor aliado' },
  { codigo: 'DF', nombre: 'Disposición final (celda de seguridad)', requierePermiso: true, propia: false, soporteLegal: 'Licencia del gestor aliado' },
  { codigo: 'POS', nombre: 'Posconsumo', requierePermiso: true, propia: false, soporteLegal: 'Programa posconsumo del fabricante' },
];

/** Permisos ambientales de la CAS y las disposiciones propias que ampara cada uno. */
export const PERMISOS_CAS: { acto: string; alcance: string; disposiciones: string[]; obligacion: [string, string, string] }[] = [
  { acto: 'Resolución 0235-2024', alcance: 'Disposición final de residuos de construcción y demolición (RCD)', disposiciones: ['RCD'], obligacion: ['Informe semestral de volúmenes recibidos en escombrera', 'semestral', '2026-12-15'] },
  { acto: 'Resolución 0632-2023', alcance: 'Vertimientos a suelo y manejo de aguas residuales industriales, domésticas y lodos', disposiciones: ['BIO', 'ASP'], obligacion: ['Caracterización del vertimiento a suelo (laboratorio acreditado IDEAM)', 'semestral', '2026-11-30'] },
  { acto: 'Auto SAA No. 0244-21', alcance: 'Plan de contingencia para transporte de hidrocarburos, derivados y residuos peligrosos', disposiciones: ['TRA'], obligacion: ['Simulacro anual del plan de contingencia', 'anual', '2026-12-05'] },
  // ACU: lo amparan los dos actos (respuesta de Terra Viva, 18-11-2026). Basta con que uno esté vigente.
  // Registre en cada uno su fecha de vencimiento real para que la regla de cobertura lo controle.
  { acto: 'OF-311-21', alcance: 'Gestión de aceite de cocina usado', disposiciones: ['ACU'], obligacion: ['Reporte trimestral de volúmenes de ACU gestionados', 'trimestral', '2027-01-10'] },
  { acto: 'Resolución 316 de 2018', alcance: 'Aprovechamiento de aceite de cocina usado (biodiésel)', disposiciones: ['ACU'], obligacion: ['Revisar obligaciones y vigencia de la Res. 316 de 2018', 'anual', '2027-01-10'] },
];

// ---------- Globales (normativos) ----------
export const RIESGOS: ItemCatalogo[] = [
  { codigo: 'C', nombre: 'Corrosivo' }, { codigo: 'R', nombre: 'Reactivo' }, { codigo: 'E', nombre: 'Explosivo' },
  { codigo: 'T', nombre: 'Tóxico' }, { codigo: 'I', nombre: 'Inflamable' }, { codigo: 'B', nombre: 'Biológico-infeccioso' },
  { codigo: 'RAD', nombre: 'Radiactivo' },
];

export const SISTEMAS_ETIQUETADO: ItemCatalogo[] = [
  { codigo: 'ONU', nombre: 'Naciones Unidas (NTC 1692)' }, { codigo: 'NFPA', nombre: 'NFPA 704' },
  { codigo: 'SGA', nombre: 'Sistema Globalmente Armonizado' }, { codigo: 'HMIS', nombre: 'HMIS' },
];

/** Corrientes Y (Anexo I) y códigos A (Anexo II), Dec. 1076/2015. Solo las más usadas: la lista completa se carga aparte. */
export const CODIGOS_CLASIFICACION: (ItemCatalogo & { tipo: 'A' | 'Y' })[] = [
  { tipo: 'Y', codigo: 'Y1', nombre: 'Desechos clínicos resultantes de la atención médica prestada en hospitales, centros médicos y clínicas' },
  { tipo: 'Y', codigo: 'Y8', nombre: 'Desechos de aceites minerales no aptos para el uso a que estaban destinados' },
  { tipo: 'Y', codigo: 'Y9', nombre: 'Mezclas y emulsiones de desechos de aceite y agua o de hidrocarburos y agua' },
  { tipo: 'Y', codigo: 'Y12', nombre: 'Desechos resultantes de la producción, preparación y utilización de tintas, colorantes, pigmentos, pinturas, lacas o barnices' },
  { tipo: 'Y', codigo: 'Y18', nombre: 'Residuos resultantes de las operaciones de eliminación de desechos industriales' },
  { tipo: 'A', codigo: 'A3020', nombre: 'Aceites minerales de desecho no aptos para el uso al que estaban destinados' },
  { tipo: 'A', codigo: 'A4060', nombre: 'Desechos de mezclas y emulsiones de aceite y agua o de hidrocarburos y agua' },
  { tipo: 'A', codigo: 'A1180', nombre: 'Montajes eléctricos y electrónicos de desecho o restos de estos' },
];

/** Municipios DIVIPOLA (DANE) de la zona de operación. Lista parcial: la completa se carga del archivo del DANE. */
export const MUNICIPIOS: { codigoDane: string; nombre: string; departamento: string }[] = [
  { codigoDane: '68001', nombre: 'Bucaramanga', departamento: 'Santander' },
  { codigoDane: '68081', nombre: 'Barrancabermeja', departamento: 'Santander' },
  { codigoDane: '68276', nombre: 'Floridablanca', departamento: 'Santander' },
  { codigoDane: '68307', nombre: 'Girón', departamento: 'Santander' },
  { codigoDane: '68406', nombre: 'Lebrija', departamento: 'Santander' },
  { codigoDane: '68547', nombre: 'Piedecuesta', departamento: 'Santander' },
  { codigoDane: '68575', nombre: 'Puerto Wilches', departamento: 'Santander' },
  { codigoDane: '68655', nombre: 'Sabana de Torres', departamento: 'Santander' },
  { codigoDane: '11001', nombre: 'Bogotá, D.C.', departamento: 'Bogotá, D.C.' },
  { codigoDane: '05001', nombre: 'Medellín', departamento: 'Antioquia' },
  { codigoDane: '54001', nombre: 'Cúcuta', departamento: 'Norte de Santander' },
];

/** ARL y EPS (catálogo nacional). VERIFICAR con Terra Viva la lista que usa (pregunta 3 del análisis operativo). */
export const ENTIDADES_SEGURIDAD_SOCIAL: { tipo: 'ARL' | 'EPS'; nombre: string }[] = [
  ...['Positiva Compañía de Seguros', 'ARL SURA', 'Colmena Seguros', 'Seguros Bolívar', 'AXA Colpatria', 'La Equidad Seguros',
    'Seguros de Vida Alfa', 'Mapfre Colombia Vida'].map((nombre) => ({ tipo: 'ARL' as const, nombre })),
  ...['Nueva EPS', 'EPS Sura', 'Sanitas', 'Salud Total', 'Compensar', 'Famisanar', 'Coosalud', 'Mutual Ser', 'Aliansalud',
    'SOS (Servicio Occidental de Salud)', 'Cajacopi', 'Asmet Salud'].map((nombre) => ({ tipo: 'EPS' as const, nombre })),
];

/** Especificaciones adicionales del servicio (por línea de solicitud y de manifiesto). VERIFICAR. */
export const ESPECIFICACIONES_ADICIONALES: (ItemCatalogo & { abreviatura: string })[] = [
  { codigo: 'CUSTODIA', nombre: 'Cadena de custodia', abreviatura: 'CC', descripcion: 'Registro de quién entrega y recibe en cada paso' },
  { codigo: 'DESTRUCCION', nombre: 'Destrucción certificada', abreviatura: 'DC', descripcion: 'Destrucción total con certificado (marcas, documentos, producto vencido)' },
  { codigo: 'TESTIGO', nombre: 'Con testigo del cliente', abreviatura: 'TC', descripcion: 'Un delegado del cliente presencia el tratamiento' },
  { codigo: 'FOTOS', nombre: 'Registro fotográfico del tratamiento', abreviatura: 'RF' },
];

/** Etapas del recorrido iniciales: [orden, nombre, color, final, cancela, rastreo GPS, descripción]. */
export const ETAPAS_RECORRIDO: [number, string, string, boolean, boolean, boolean, string][] = [
  [1, 'Programada', '#6B7A72', false, false, false, 'Ruta creada, aún no sale de planta'],
  [2, 'En camino', '#E5B800', false, false, true, 'Salió de planta; se registra la ubicación'],
  [3, 'Donde el generador', '#1E9BD7', false, false, false, 'En la sede del cliente: cargue y manifiesto'],
  [4, 'Descargado en planta', '#1F8A3B', true, false, false, 'Terminó: residuos en PSA Los Pinos'],
  [5, 'Cancelada', '#D92D20', true, true, false, 'No se hizo: las líneas vuelven a pendientes'],
];

/** Estado físico: etiqueta visible ↔ valor del enum de la base de datos. */
export const ESTADOS_FISICOS: [string, 'SOLIDO' | 'SEMISOLIDO' | 'LIQUIDO' | 'GASEOSO'][] = [
  ['Sólido', 'SOLIDO'], ['Semisólido / lodo', 'SEMISOLIDO'], ['Líquido', 'LIQUIDO'], ['Gaseoso', 'GASEOSO'],
];

/** Catálogos que se pueden referenciar por código desde las plantillas de cargue. */
export type ClaveCatalogo = 'categorias' | 'tiposResiduo' | 'lineas' | 'metricasPrecio' | 'embalajes' | 'materiales'
  | 'disposiciones' | 'riesgos' | 'etiquetado' | 'corrientesY' | 'codigosA';

/** Códigos por catálogo con los datos iniciales (modo demostración y listas de las plantillas). */
export const CODIGOS_BASE: Record<ClaveCatalogo, string[]> = {
  categorias: CATEGORIAS.map((x) => x.codigo),
  tiposResiduo: TIPOS_RESIDUO.map((x) => x.codigo),
  lineas: LINEAS_SERVICIO.map((x) => x.codigo),
  metricasPrecio: METRICAS.filter((m) => m.uso === 'PRECIO').map((x) => x.codigo),
  embalajes: TIPOS_EMBALAJE.map((x) => x.codigo),
  materiales: MATERIALES_EMBALAJE.map((x) => x.codigo),
  disposiciones: DISPOSICIONES.map((x) => x.codigo),
  riesgos: RIESGOS.map((x) => x.codigo),
  etiquetado: SISTEMAS_ETIQUETADO.map((x) => x.codigo),
  corrientesY: CODIGOS_CLASIFICACION.filter((c) => c.tipo === 'Y').map((x) => x.codigo),
  codigosA: CODIGOS_CLASIFICACION.filter((c) => c.tipo === 'A').map((x) => x.codigo),
};
