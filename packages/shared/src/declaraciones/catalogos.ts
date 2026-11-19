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

/**
 * Servicios estándar del catálogo propio: los que la planilla real (DMR) carga para unos 40 clientes.
 * Se asignan a muchos clientes de una vez («asignación masiva»). La línea de cada uno es una propuesta: VERIFICAR.
 */
export const SERVICIOS_ESTANDAR: { codigo: string; nombre: string; linea: string }[] = [
  { codigo: 'SV-VACUUM', nombre: 'Alquiler de camión de vacío', linea: '09' },
  { codigo: 'SV-TRAMPAS', nombre: 'Limpieza de trampas de grasa', linea: '09' },
  { codigo: 'SV-POZOS', nombre: 'Limpieza de pozos sépticos', linea: '09' },
  { codigo: 'SV-TANQUES', nombre: 'Limpieza de tanques y vasijas', linea: '11' },
  { codigo: 'SV-CUADRILLA', nombre: 'Cuadrilla de limpieza', linea: '09' },
  { codigo: 'SV-RECOLECCION', nombre: 'Recolección y embalaje', linea: '09' },
  { codigo: 'SV-TRANSPORTE', nombre: 'Transporte', linea: '04' },
  { codigo: 'SV-FUMIGACION', nombre: 'Fumigación institucional', linea: '06' },
  { codigo: 'SV-PODA', nombre: 'Poda de árboles', linea: '05' },
  { codigo: 'SV-OBRAS', nombre: 'Obras civiles', linea: '05' },
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

/**
 * Disposición / manejo y cómo queda cubierta legalmente (reglas fn_disposicion_cubierta y fn_decl_autorizacion_check).
 * Ajustada con las respuestas de la gerencia del 19-11-2026 (docs/PREGUNTAS_GERENCIA.md):
 * - los tratamientos de Los Pinos (ASP, BIO, RCD, ACU) solo admiten residuos SIN características de peligrosidad
 *   (Res. DGL 000632 de 2023, art. 6); mientras no exista la licencia ambiental, los peligrosos van a un gestor aliado;
 * - el aprovechamiento propio, el lavado y reúso y el coprocesamiento quedan inactivos: ningún acto los ampara;
 * - «incineración y celda ordinaria» se separa en incineración (INCH) y relleno sanitario (RS).
 */
export interface DisposicionCatalogo extends ItemCatalogo {
  requierePermiso: boolean; propia: boolean; soporteLegal: string;
  activo?: boolean; // por omisión, activa
  admitePeligrosos?: boolean; // por omisión, sí
  hidrocarburos?: 'ADMITE' | 'CON_CARACTERIZACION' | 'NO_ADMITE'; // por omisión, ADMITE
}
export const DISPOSICIONES: DisposicionCatalogo[] = [
  { codigo: 'ASP', nombre: 'Tratamiento y vertimiento a suelo de ARD y ARnD sin características de peligrosidad', requierePermiso: true, propia: true, admitePeligrosos: false,
    soporteLegal: 'Res. DGL 000632 de 2023 (CAS), arts. 1 y 6' },
  { codigo: 'BIO', nombre: 'Biorremediación (landfarming) de lodos no peligrosos y cortes de perforación base agua', requierePermiso: true, propia: true, admitePeligrosos: false,
    hidrocarburos: 'CON_CARACTERIZACION', soporteLegal: 'Res. DGL 000632 de 2023 (CAS), arts. 5 y 6' },
  { codigo: 'RCD', nombre: 'Gestión de RCD sin mezcla con ordinarios, peligrosos ni hidrocarburos', requierePermiso: true, propia: true, admitePeligrosos: false,
    hidrocarburos: 'NO_ADMITE', soporteLegal: 'Res. SAO No. 00235-24 (CAS) y licencia de funcionamiento de Sabana de Torres' },
  { codigo: 'ACU', nombre: 'Recolección y gestión de aceite de cocina usado (ACU)', requierePermiso: true, propia: true, admitePeligrosos: false,
    soporteLegal: 'Oficio SAA No. 0311/21 (CAS), conforme a la Res. 316 de 2018' },
  { codigo: 'TRA', nombre: 'Transporte de RESPEL, hidrocarburos y sustancias nocivas', requierePermiso: true, propia: true, soporteLegal: 'Auto SAA No. 0244-20 (CAS) y Exp. TH 0013-2021 (CDMB)' },
  { codigo: 'INCH', nombre: 'Incineración (hospitalarios e industriales)', requierePermiso: true, propia: false, soporteLegal: 'Licencia del gestor aliado' },
  { codigo: 'RS', nombre: 'Relleno sanitario', requierePermiso: true, propia: false, soporteLegal: 'Licencia del gestor aliado' },
  { codigo: 'DF', nombre: 'Disposición final en celda de seguridad', requierePermiso: true, propia: false, soporteLegal: 'Licencia del gestor aliado' },
  { codigo: 'DES', nombre: 'Desensamble y aprovechamiento de RAEE', requierePermiso: true, propia: false, soporteLegal: 'Licencia del gestor aliado' },
  { codigo: 'POS', nombre: 'Posconsumo', requierePermiso: true, propia: false, soporteLegal: 'Licencia del gestor aliado o sistema de posconsumo' },
  // Tratamientos de gestores aliados según sus licencias (carpetas «uso común» y «uso no común» del Drive, 19-11-2026)
  { codigo: 'TAR', nombre: 'Tratamiento de aguas residuales en la PTAR de un gestor aliado', requierePermiso: true, propia: false, soporteLegal: 'Licencia o permiso de vertimientos del gestor aliado' },
  { codigo: 'BIOA', nombre: 'Biorremediación de suelos, lodos y cortes con hidrocarburos (gestor aliado)', requierePermiso: true, propia: false, soporteLegal: 'Licencia del gestor aliado' },
  { codigo: 'AUT', nombre: 'Desactivación de alta eficiencia (autoclave) de residuos infecciosos', requierePermiso: true, propia: false, soporteLegal: 'Licencia del gestor aliado' },
  { codigo: 'AUS', nombre: 'Recuperación o aprovechamiento de aceites usados e hidrocarburos', requierePermiso: true, propia: false, soporteLegal: 'Licencia o plan de manejo del gestor aliado' },
  { codigo: 'ESC', nombre: 'Disposición de RCD en la escombrera autorizada de un gestor aliado', requierePermiso: true, propia: false, admitePeligrosos: false, hidrocarburos: 'NO_ADMITE',
    soporteLegal: 'Autorización de la escombrera o inscripción del gestor de RCD aliado' },
  // Inactivas: ningún acto las ampara (decisión de la gerencia, 19-11-2026)
  { codigo: 'APR', nombre: 'Aprovechamiento propio', requierePermiso: true, propia: true, activo: false,
    soporteLegal: 'Sin acto que lo ampare: el objeto social no es una autorización ambiental (inscripción, Res. 1342 de 2020, sin acto)' },
  { codigo: 'REC', nombre: 'Reciclaje o valorización propia', requierePermiso: true, propia: true, activo: false, soporteLegal: 'Sin acto que lo ampare' },
  { codigo: 'LAV', nombre: 'Lavado y reúso de envases', requierePermiso: true, propia: true, activo: false,
    soporteLegal: 'Requiere la licencia ambiental en trámite (Exp. CAS 210.40.00113.2026)' },
  { codigo: 'COP', nombre: 'Coprocesamiento', requierePermiso: true, propia: false, activo: false, soporteLegal: 'Sin gestor aliado registrado' },
  { codigo: 'INCO', nombre: 'Incineración y celda ordinaria (reemplazada por INCH y RS)', requierePermiso: true, propia: false, activo: false,
    soporteLegal: 'Separada en incineración y relleno sanitario' },
];

/** Obligación de un acto: con su código del Cronograma Maestro de Cumplimiento (OB-xx) cuando lo tiene. */
export interface ObligacionCatalogo { codigo?: string; descripcion: string; periodicidad: string; meses?: number; proxima?: string; articulo: string }
/** Acto administrativo de Terra Viva. Sin `vence`: indefinido (el acto no fija término). */
export interface PermisoCatalogo {
  acto: string; autoridad?: string; expedicion?: string; vence?: string; alcance: string;
  disposiciones: string[]; // disposiciones que ampara (vacío: complemento o soporte, no ampara por sí solo)
  obligaciones: ObligacionCatalogo[];
}
/** Actos administrativos y obligaciones reales (respuestas de la gerencia A1 y A4, 19-11-2026). */
export const PERMISOS_CAS: PermisoCatalogo[] = [
  {
    acto: 'Resolución DGL No. 000632 de 2023', expedicion: '2023-08-15',
    // Provisional: cinco años desde la resolución. La ejecutoria solo puede ser igual o posterior; ajustar al recibir la
    // constancia (solo hacia adelante).
    vence: '2028-08-15',
    alcance: 'Tratamiento y vertimiento a suelo de ARD y ARnD sin características de peligrosidad, hasta 3,65 L/s; tratamiento por landfarming de lodos no peligrosos y cortes base agua (arts. 1, 5 y 6). Exp. 210.60.00032.2023',
    disposiciones: ['ASP', 'BIO'],
    obligaciones: [
      { descripcion: 'Caracterizar las ARnD antes y después de la planta, con muestreo y análisis por laboratorio acreditado por el IDEAM', periodicidad: 'Semestral', meses: 6, proxima: '2026-11-25', articulo: 'Art. 10, par. 2 y 3' },
      { descripcion: 'Caracterizar las ARD (Res. 699 de 2021, art. 4, tabla 2)', periodicidad: 'Anual', meses: 12, proxima: '2026-11-25', articulo: 'Art. 10 y par. 2' },
      { codigo: 'OB-14', descripcion: 'Avisar a la CAS la fecha de cada monitoreo, 15 días antes de cada campaña', periodicidad: '15 días antes de cada campaña', proxima: '2027-01-27', articulo: 'Art. 10, par. 4' },
      { descripcion: 'Monitorear agua subterránea (piezómetros) y suelo según el Plan de Monitoreo aprobado', periodicidad: 'Semestral o anual según el parámetro', meses: 6, proxima: '2026-11-25', articulo: 'Art. 9' },
      { codigo: 'OB-36', descripcion: 'Radicar los resultados, con soportes de mantenimiento y del manejo de lodos y cortes, en el Exp. 210.60.00032.2023', periodicidad: 'Con cada caracterización', proxima: '2027-01-22', articulo: 'Art. 10, par. 5; art. 12' },
      { descripcion: 'Presentar los costos del proyecto (Acuerdo CAS 208 de 2012), en los primeros 30 días del año', periodicidad: 'Anual', meses: 12, proxima: '2027-01-22', articulo: 'Art. 20, parágrafo' },
      { codigo: 'OB-24', descripcion: 'Hacer campañas educativas sobre manejo de residuos sólidos (mínimo 3 al año)', periodicidad: 'Mínimo 3 al año', meses: 4, proxima: '2026-12-02', articulo: 'Art. 14' },
      { descripcion: 'Informar las fallas cuya reparación tarde más de 24 horas y las emergencias que cambien el vertimiento', periodicidad: 'Por evento', articulo: 'Art. 14' },
      { descripcion: 'Informar de inmediato cualquier evento que afecte los recursos naturales', periodicidad: 'Por evento', articulo: 'Art. 17' },
      { descripcion: 'Llevar registros del tratamiento, del mantenimiento y del destino de los lodos', periodicidad: 'Permanente', articulo: 'Art. 14' },
      { descripcion: 'Mantener el manual de operación y mantenimiento en la planta', periodicidad: 'Permanente', articulo: 'Art. 11' },
      { descripcion: 'Pedir la modificación del permiso antes de cambiar el sistema de tratamiento', periodicidad: 'Por evento', articulo: 'Art. 16' },
      { descripcion: 'No ceder el permiso sin autorización escrita', periodicidad: 'Permanente', articulo: 'Art. 18' },
      { codigo: 'OB-26A', descripcion: 'Obtener la constancia de ejecutoria (fija el vencimiento exacto y la ventana de renovación)', periodicidad: 'Única', proxima: '2026-11-30', articulo: 'Art. 1, par. 2' },
      { codigo: 'OB-26', descripcion: 'Solicitar la renovación en el primer trimestre del último año de vigencia; si no se pide, el permiso queda sin vigencia', periodicidad: 'Única', proxima: '2027-09-06', articulo: 'Art. 1, par. 4 y 5' },
      { codigo: 'OB-39', descripcion: 'Hacer el simulacro del plan de gestión del riesgo para el manejo de vertimientos', periodicidad: 'Anual', meses: 12, proxima: '2027-09-15', articulo: 'Art. 2' },
    ],
  },
  {
    acto: 'Oficio SAO No. 1762-2023', expedicion: '2023-12-26', vence: '2028-08-15',
    alcance: 'Aclara el alcance del art. 6 de la Res. DGL 000632 de 2023: lodos, cortes, salmueras y borras solo si no tienen características de peligrosidad. No amplía a residuos peligrosos',
    disposiciones: [], obligaciones: [],
  },
  {
    acto: 'Oficio SAO No. 846.2026', expedicion: '2026-04-27',
    alcance: 'Certifica el estado de los permisos y que no hay procesos sancionatorios (Rad. 80.30.9272.2024). Soporte ante clientes; no impone obligaciones',
    disposiciones: [], obligaciones: [],
  },
  {
    acto: 'Resolución SAO No. 00235-24',
    alcance: 'Gestor de RCD no contaminados, en el polígono del art. 2 (agosto de 2024; confirmar el día en el original). No fija término de vigencia',
    disposiciones: ['RCD'],
    obligaciones: [
      { descripcion: 'Reportar a la CAS la cantidad y el destino de los RCD (Anexo III), dentro de los 15 días calendario siguientes al trimestre', periodicidad: 'Trimestral', meses: 3, proxima: '2027-01-15', articulo: 'Art. 8' },
      { descripcion: 'Expedir al generador la constancia del Anexo II de la Res. 0472 de 2017', periodicidad: 'Cada servicio', articulo: 'Art. 9' },
      { codigo: 'OB-35', descripcion: 'Presentar el registro de los pesajes diarios', periodicidad: 'Semestral', meses: 6, proxima: '2027-01-15', articulo: 'Art. 15' },
      { descripcion: 'Presentar el reporte anual del año anterior (Anexo III), en el primer trimestre', periodicidad: 'Anual', meses: 12, proxima: '2027-03-31', articulo: 'Res. 0472 de 2017, art. 16, num. 4' },
      { codigo: 'OB-42', descripcion: 'Instalar la valla informativa (a 30 días de la notificación): verificar que esté instalada', periodicidad: 'Única', articulo: 'Art. 14' },
      { codigo: 'OB-52', descripcion: 'Presentar la ficha de manejo de tráfico: verificar el radicado', periodicidad: 'Única', articulo: 'Art. 11' },
      { codigo: 'OB-40', descripcion: 'Tener plan de emergencia y contingencia para la disposición de RCD y hacer su simulacro', periodicidad: 'Anual', meses: 12, proxima: '2027-03-10', articulo: 'Art. 17' },
      { descripcion: 'Cumplir las obligaciones de clausura y posclausura (mantenimiento e informe semestral por 3 años)', periodicidad: 'Se activa con la clausura', articulo: 'Art. 6' },
    ],
  },
  {
    acto: 'Licencia de funcionamiento RCD (28-04-2025)', autoridad: 'Secretaría de Planeación de Sabana de Torres', expedicion: '2025-04-28',
    alcance: 'Operación del gestor de RCD. Vigente por la duración del proyecto o hasta que la CAS lo considere (art. 1)',
    disposiciones: ['RCD'],
    obligaciones: [
      { codigo: 'OB-44', descripcion: 'Rendir el informe de operación a la Secretaría de Planeación', periodicidad: 'Trimestral', meses: 3, proxima: '2027-01-15', articulo: 'Art. 2, num. 8, lit. H' },
      { codigo: 'OB-43', descripcion: 'Llevar la bitácora diaria y tener los instrumentos de pesaje calibrados (calibración anual)', periodicidad: 'Diaria; calibración anual', meses: 12, proxima: '2027-02-26', articulo: 'Art. 2, num. 8, lits. B y H' },
    ],
  },
  {
    acto: 'Oficio SAA No. 0311/21', expedicion: '2021-04-19',
    alcance: 'Inscripción como gestor de aceite de cocina usado (ACU), conforme a la Res. 316 de 2018. No fija término de vigencia',
    disposiciones: ['ACU'],
    obligaciones: [
      { descripcion: 'Reportar a la CAS los generadores, los kg de cada uno y los kg totales recolectados, tratados o aprovechados (primeros 15 días de enero)', periodicidad: 'Anual', meses: 12, proxima: '2027-01-15', articulo: 'Res. 316 de 2018, art. 10, lit. b' },
      { descripcion: 'Expedir constancia al generador industrial, comercial o de servicios', periodicidad: 'Cada entrega', articulo: 'Res. 316 de 2018, art. 10, lit. c' },
      { descripcion: 'Mantener el ACU contenido y etiquetado, y tener plan de contingencia para ACU', periodicidad: 'Permanente', articulo: 'Res. 316 de 2018, art. 10, lits. d y g' },
    ],
  },
  {
    acto: 'Auto SAA No. 0244-20', expedicion: '2020-09-29',
    alcance: 'Plan de contingencia para el transporte de hidrocarburos, derivados y sustancias nocivas, actualizado con el Rad. CAS 80.30.17312.2024. Rutas: Sabana de Torres, Bucaramanga, Puerto Wilches y Puerto Nare a Aguachica; en la actualización, Sabana de Torres a Mosquera y Cisneros a Aguachica',
    disposiciones: ['TRA'],
    obligaciones: [
      { descripcion: 'Actualizar el plan en su totalidad: cada 4 años, o antes si cambia la organización, falla en una emergencia o un simulacro, o lo pide la CAS', periodicidad: 'Cada 4 años', meses: 48, proxima: '2028-09-04', articulo: 'Art. 3' },
      { descripcion: 'Ajustar el plan antes de operar rutas o tramos nuevos', periodicidad: 'Por evento', articulo: 'Art. 1, parágrafo' },
      { descripcion: 'Informar a la CAS cualquier derrame dentro de las 8 horas siguientes', periodicidad: 'Por evento', articulo: 'Art. 4' },
      { descripcion: 'Mantener las pólizas actualizadas', periodicidad: 'Permanente', articulo: 'Art. 4, parágrafo' },
      { descripcion: 'Remitir copia del auto a las autoridades ambientales de las rutas, y cada vez que haya rutas nuevas', periodicidad: 'Por evento', articulo: 'Art. 6' },
    ],
  },
  {
    acto: 'Expediente TH 0013-2021 / SINCA 33950', autoridad: 'CDMB',
    alcance: 'Plan de contingencia para el transporte (jurisdicción de la CDMB). Vencimiento y obligaciones: no constan (pedir el expediente)',
    disposiciones: ['TRA'], obligaciones: [],
  },
];

/**
 * Gestores aliados (respuesta A5 de la gerencia). Sin `vence` ni `indefinida`, la vigencia «no consta» y la disposición
 * queda sin cobertura hasta registrarla. Lúmina (posconsumo de bombillas) no se registra: su NIT no consta.
 */
export interface GestorAliado {
  nit: string; razonSocial: string; municipio?: string; disposiciones: string[];
  licencia: string; autoridad: string; vence?: string; indefinida?: boolean; alcance: string; excluyeTiposResiduo?: string[];
  /** Último soporte de la relación comercial (certificación, contrato o convenio) y su fecha. */
  soporteComercial?: string; soporteComercialFecha?: string;
}
export const GESTORES_ALIADOS: GestorAliado[] = [
  // ---- Uso común (carpeta «1. LICENCIAS DE USO COMUN») ----
  { nit: '805001538-5', razonSocial: 'Veolia Servicios Industriales Colombia S.A.S. E.S.P. (CIGE Las Bateas)', municipio: 'Aguachica', disposiciones: ['DF', 'BIOA'],
    licencia: 'Res. 858 del 10-06-2011 (Corpocesar), modificada por la Res. 0877 del 21-07-2015; cesión parcial a Tecniamsa (hoy Veolia SI) de la celda de seguridad y la planta de biorremediación por la Res. 1741 del 26-12-2018', autoridad: 'Corpocesar',
    vence: '2027-01-03', alcance: 'Celda de seguridad para RESPEL industriales (autorizada hasta el 03-01-2027, Res. 0877 y 1741) y planta de biorremediación de residuos petroleros. No recibe hospitalarios, explosivos ni patógenos (Res. 1741)',
    excluyeTiposResiduo: ['HOSP'], soporteComercial: 'Certificación comercial', soporteComercialFecha: '2026-03-31' },
  { nit: '901483038-1', razonSocial: 'Centro de Gestión Sostenible S.A.S. E.S.P. (CGS)', municipio: 'Mosquera', disposiciones: ['DF'],
    licencia: 'Res. DGEN 20217000362 del 26-08-2021 (CAR), cesión parcial a CGS de la licencia otorgada por la Res. 0869 del 09-09-2004, modificada por las Res. 2966 del 20-10-2006 y 1561 del 24-05-2010', autoridad: 'CAR Cundinamarca',
    indefinida: true, alcance: 'Celda de seguridad (predio Belbal, Mosquera) para los RESPEL del art. 1 de la Res. 2966 de 2006 y lodos con características domésticas y especiales. Vida útil del proyecto. Su licencia de 2024 (CGS2, Res. DJUR 50247000048) es de otro predio y aún no se usa',
    soporteComercial: 'Certificación comercial', soporteComercialFecha: '2024-12-13' },
  { nit: '900293868-7', razonSocial: 'Veolia Aseo Santander y Cesar S.A. E.S.P. (Parque Tecnológico Ambiental San Silvestre)', municipio: 'Barrancabermeja', disposiciones: ['RS'],
    licencia: 'Res. DGL 1121 del 27-11-2014 (CAS), otorgada a Rediba S.A. E.S.P. y cedida a Veolia Aseo Santander y Cesar S.A. E.S.P. por la Res. DGL 000063 del 25-02-2021', autoridad: 'CAS',
    indefinida: true, alcance: 'Relleno sanitario de residuos ordinarios. Vida útil del sitio proyectada a 30 años (Res. 1121, art. 2)',
    soporteComercial: 'Contrato DF-002-2024', soporteComercialFecha: '2024-01-15' },
  { nit: '804001490-7', razonSocial: 'Sandesol S.A. E.S.P.', municipio: 'Bucaramanga', disposiciones: ['INCH', 'POS', 'AUT', 'AUS'],
    licencia: 'Res. 0144 del 09-02-2000 (CDMB), modificada por las Res. 1194 del 13-12-2004 (industriales especiales), 0477 del 17-04-2012 (desactivación de alta eficiencia) y 0851 del 09-10-2017 (excedentes industriales, posconsumo e incineración)', autoridad: 'CDMB',
    indefinida: true, alcance: 'Incineración de hospitalarios, industriales especiales y peligrosos; desactivación de alta eficiencia de infecciosos; excedentes industriales y posconsumo (RAEE, luminarias, pilas, envases de plaguicidas, aceites lubricantes usados, medicamentos). No incinera PVC, Y18, Y34 ni Y35, ni plásticos sin caracterización. Vida útil del proyecto (Res. 0144, art. 10)',
    soporteComercial: 'Certificación comercial', soporteComercialFecha: '2026-02-24' },
  { nit: '800105650-1', razonSocial: 'Empresa de Servicios Públicos de Aguachica E.S.P. (ESPA)', municipio: 'Aguachica', disposiciones: ['TAR'],
    licencia: 'Res. 095 del 28-05-1996 (Corpocesar): licencia ambiental del municipio de Aguachica para construir y operar sus plantas de tratamiento de aguas residuales, que opera la ESPA', autoridad: 'Corpocesar',
    indefinida: true, alcance: 'Tratamiento de aguas residuales domésticas en las PTAR de Aguachica. La licencia no menciona de forma expresa la recepción de aguas de terceros (baños portátiles, pozos sépticos): confírmelo con la ESPA',
    soporteComercial: 'Certificación comercial', soporteComercialFecha: '2023-01-11' },
  { nit: '900607351-1', razonSocial: 'Soluxionar S.A.S.', municipio: 'Sabana de Torres', disposiciones: ['BIOA', 'TAR'],
    licencia: 'Res. DGL 00000101 del 03-02-2014 (CAS): almacenamiento, tratamiento, recuperación y disposición final de RESPEL en el predio Sion, con permiso de vertimientos', autoridad: 'CAS',
    indefinida: true, alcance: 'Tratamiento y recuperación de RESPEL (biorremediación) y de aguas, por 30 años prorrogables. El contrato con Terra Viva rigió del 03-04-2023 al 02-04-2024: confirme que la relación sigue',
    soporteComercial: 'Contrato PR-001-2023', soporteComercialFecha: '2023-04-03' },
  { nit: '804002433-1', razonSocial: 'Descont S.A.S. E.S.P.', municipio: 'Girón', disposiciones: ['AUT'],
    licencia: 'Res. 0426 del 21-05-1999 (CDMB), modificada por las Res. 0667 del 03-08-2004, 0134 del 02-02-2005 (esterilización en autoclave) y 1179 del 27-10-2006 (residuos con mercurio)', autoridad: 'CDMB',
    indefinida: true, alcance: 'Desactivación de hospitalarios en autoclave y gestión de residuos con mercurio. No incinera en sus instalaciones (Res. 0426). Vida útil del proyecto',
    soporteComercial: 'Contrato', soporteComercialFecha: '2025-04-21' },
  // Sin vigencia registrada a propósito: no cubren hasta que se confirme (plan de manejo y sistema posconsumo sin término claro)
  { nit: '804015104-1', razonSocial: 'Crudesan S.A.', municipio: 'Bucaramanga', disposiciones: ['AUS'],
    licencia: 'Plan de manejo ambiental aprobado por la Res. 0163 del 03-03-2003 (CDMB) y cedido por la Res. 0077 del 20-01-2006; autorización del Ministerio de Minas y Energía, Res. 124047 del 29-03-2006', autoridad: 'CDMB',
    alcance: 'Recuperación de aceites usados y crudos con residuos aceitosos. Es un plan de manejo, no una licencia: confirme su vigencia (y el soporte comercial) antes de usarlo' },
  { nit: '900699445-6', razonSocial: 'Corporación Posconsumo de Iluminación (LÚMINA)', municipio: 'Bogotá D.C.', disposiciones: ['POS'],
    licencia: 'Sistema posconsumo de bombillas aprobado por la Res. 307 del 07-05-2012 (ANLA), modificada por las Res. 28 de 2013, 1343 de 2014 y 01134 del 30-09-2016', autoridad: 'ANLA',
    alcance: 'Sistema posconsumo de bombillas (no es una planta). Confirme la vigencia del sistema y el soporte comercial antes de usarlo' },
  // ---- Uso no común (carpeta «2. LICENCIAS DE USO NO COMUN») ----
  { nit: '900812833-8', razonSocial: 'Social RAEE S.A.S.', municipio: 'Girón', disposiciones: ['DES'],
    licencia: 'Res. 000756 del 14-09-2016 (CDMB, exp. LA-0008-2015): reparación, almacenamiento, desensamble, trituración y molienda de RAEE', autoridad: 'CDMB', indefinida: true,
    alcance: 'Desensamble y aprovechamiento de RAEE. No hace ningún tratamiento térmico (art. 4). Vida útil del proyecto. Sin soporte comercial en la carpeta' },
  { nit: '806006669-8', razonSocial: 'BIOGER S.A.S. E.S.P. (Parque Ambiental Bioger)', municipio: 'Cartagena', disposiciones: ['RS', 'DF', 'INCH', 'AUT', 'BIOA', 'ESC'],
    licencia: 'Res. 0616 del 27-07-2004 (CARDIQUE), modificada por las Res. 0803 del 25-07-2012, 0120 del 12-02-2014, 0398 del 02-04-2020 y 1642 del 16-11-2022; gestor de RCD por la Res. 0529 del 24-06-2020', autoridad: 'CARDIQUE',
    indefinida: true, alcance: 'Relleno sanitario, celdas de seguridad, incineración, desactivación y biorremediación en Pasacaballos (Cartagena). No recibe residuos con PCB (Res. 1642 de 2022). Vida útil del proyecto',
    soporteComercial: 'Certificación comercial', soporteComercialFecha: '2020-10-13' },
  { nit: '900565947-9', razonSocial: 'BIOINTECH GREEN S.A.S. (proyecto Guayacán)', municipio: 'Aguazul', disposiciones: ['BIOA', 'TAR'],
    licencia: 'Res. 500.41-14-0050 del 16-01-2014 (CORPORINOQUIA, exp. 500.29.13-040): tratamiento biológico de residuos sólidos y líquidos peligrosos de la industria petrolera, con concesión de aguas y vertimiento por aspersión', autoridad: 'CORPORINOQUIA',
    indefinida: true, alcance: 'Biorremediación de residuos de la industria petrolera y tratamiento de sus aguas, en Aguazul (Casanare). No transporta residuos. Vida útil del proyecto',
    soporteComercial: 'Convenio', soporteComercialFecha: '2018-10-25' },
  { nit: '800249174-5', razonSocial: 'Empresa Metropolitana de Aseo S.A. E.S.P. (EMAS)', municipio: 'Galapa', disposiciones: ['INCH', 'DF'],
    licencia: 'Res. 00462 del 26-08-2009 (CRA): planta incineradora y celdas de seguridad para residuos sólidos peligrosos, km 39 vía Barranquilla - Tubará', autoridad: 'CRA',
    indefinida: true, alcance: 'Incineración y celdas de seguridad para RESPEL en Galapa (Atlántico), por la duración de la actividad. Sin soporte comercial en la carpeta' },
  { nit: '800143273-1', razonSocial: 'Montajes y Construcciones Fermar Ltda. (planta El Lomaral)', municipio: 'Barrancabermeja', disposiciones: ['BIOA'],
    licencia: 'Res. DGL 00001288 del 30-12-2014 (CAS): planta de tratamiento de lodos contaminados «El Lomaral», corregimiento El Centro', autoridad: 'CAS',
    vence: '2034-12-30', alcance: 'Tratamiento de lodos contaminados. Licencia por 20 años desde su ejecutoria (fecha que no consta: aquí se cuenta desde la expedición). Sin soporte comercial en la carpeta' },
  { nit: '900115530-1', razonSocial: 'Humberto Quintero O. y Cía. S.C.A.', municipio: 'Barrancabermeja', disposiciones: ['AUS'],
    licencia: 'Res. DGL 00001197 del 14-12-2017 (CAS, exp. 1007-017-2014): tratamiento, aprovechamiento y recuperación de aceites de motor residuales, predio El Altico, corregimiento La Fortuna', autoridad: 'CAS',
    indefinida: true, alcance: 'Recuperación de aceites de motor usados en Barrancabermeja. El acto no fija término',
    soporteComercial: 'Certificación comercial', soporteComercialFecha: '2022-11-22' },
  { nit: '900642911-4', razonSocial: 'SOLAM S.A.S.', municipio: 'Río de Oro', disposiciones: ['BIOA', 'TAR'],
    licencia: 'Res. 2166 del 26-12-2014 (Corpocesar): almacenamiento, tratamiento, aprovechamiento y disposición final de residuos de hidrocarburos (landfarming o compostaje) y tratamiento de las aguas que recibe', autoridad: 'Corpocesar',
    indefinida: true, alcance: 'Biorremediación de residuos con hidrocarburos y tratamiento de sus aguas en Río de Oro (Cesar). No incinera (exigiría permiso de emisiones). Vida útil del proyecto',
    soporteComercial: 'Certificación comercial', soporteComercialFecha: '2019-05-10' },
  { nit: '900962813-3', razonSocial: 'Tratamientos y Rellenos Ambientales de Colombia S.A.S. E.S.P. (TRACOL)', municipio: 'Mosquera', disposiciones: ['INCH', 'DF'],
    licencia: 'Res. 0989 del 26-05-2015 (CAR), cedida por la Res. 1821 del 14-07-2017: incineración de RESPEL y hospitalarios y celdas de seguridad', autoridad: 'CAR Cundinamarca',
    indefinida: true, alcance: 'Incineración (3 hornos) y 4 celdas de seguridad en Mosquera. En celda no recibe inflamables, explosivos, infecciosos ni residuos con más del 30 % de humedad. Sin soporte comercial ni prueba de que la planta opere: confírmelo' },
  { nit: '807005020-8', razonSocial: 'Aseo Urbano S.A.S. E.S.P. (relleno de ordinarios de Aguachica)', municipio: 'Aguachica', disposiciones: ['RS'],
    licencia: 'Res. 858 del 10-06-2011 (Corpocesar), modificada por la Res. 0877 del 21-07-2015 (celda de ordinarios hasta el 03-01-2027); conserva el relleno de ordinarios según la Res. 1741 del 26-12-2018', autoridad: 'Corpocesar',
    vence: '2027-01-03', alcance: 'Relleno sanitario de ordinarios de Aguachica. No recibe hospitalarios ni llantas. También opera el relleno Guayabal de Cúcuta (Corponor, Res. 0976 de 2000 renovada por la Res. 0450 de 2006). Sin soporte comercial en la carpeta',
    excluyeTiposResiduo: ['HOSP'] },
  { nit: '829000107-7', razonSocial: 'CONYSER S.A.S.', municipio: 'Barrancabermeja', disposiciones: ['BIOA', 'INCH', 'TAR'],
    licencia: 'Res. DGL 00001053 del 27-09-2010 (CAS), cedida por las Res. DGL 001089 de 2015 y 00000749 de 2017, con alcance aclarado por la Res. DGL 00001215 del 15-12-2017 (landfarming, desorción térmica, incineración y aguas industriales)', autoridad: 'CAS',
    indefinida: true, alcance: 'Landfarming, aguas industriales y, en su segunda fase (sin constancia de que opere), desorción térmica e incineración. El acto no fija término',
    soporteComercial: 'Certificación comercial', soporteComercialFecha: '2023-02-14' },
  { nit: '900335484-4', razonSocial: 'Soluciones Ecológicas de Colombia ECOSOL S.A.S. E.S.P.', municipio: 'Galapa', disposiciones: ['INCH', 'DF', 'AUT'],
    licencia: 'Res. 000303 del 23-09-2003 (CRA), modificada por la Res. 000001 del 11-01-2007, y Res. 00440 del 09-11-2007 (relleno de seguridad), cedidas a ECOSOL por la Res. 000183 de 2010', autoridad: 'CRA',
    indefinida: true, alcance: 'Incineración, esterilización y relleno de seguridad en Galapa (Atlántico). En incineración no recibe volátiles, inflamables, radiactivos ni residuos con metales pesados. Vida útil del proyecto',
    soporteComercial: 'Certificación comercial', soporteComercialFecha: '2023-03-01' },
  { nit: '900299496-8', razonSocial: 'Invercon G&G Ltda. (escombrera La Esterlina II)', municipio: 'Yondó', disposiciones: ['ESC'],
    licencia: 'Res. SPTDT 011 del 14-03-2024 (Alcaldía de Yondó): prórroga hasta el 31-12-2027 de la licencia de funcionamiento como gestor de RCD (Res. 122 de 2019); inscrito ante Corantioquia (constancia 160ZF-CON2209-3072)', autoridad: 'Alcaldía de Yondó y Corantioquia',
    vence: '2027-12-31', alcance: 'Escombrera de RCD en Yondó (Antioquia). No recibe RCD mezclados con basuras, líquidos, tóxicos, peligrosos ni hidrocarburos',
    soporteComercial: 'Certificación comercial', soporteComercialFecha: '2023-03-15' },
  { nit: '900111586-5', razonSocial: 'Proyectos e Inversiones El Parque S.A. (escombrera El Parque)', municipio: 'Bucaramanga', disposiciones: ['ESC'],
    licencia: 'Gestor de RCD inscrito en la CDMB como sitio de disposición final (oficio CDMB_4841 del 20-04-2022); ampliación de la fase II del botadero aprobada por el oficio CDMB rad. 11877 del 05-08-2013', autoridad: 'CDMB',
    indefinida: true, alcance: 'Escombrera El Parque (Bucaramanga): disposición final de RCD; no los almacena ni los aprovecha. La inscripción no fija término',
    soporteComercial: 'Certificación comercial', soporteComercialFecha: '2024-02-09' },
];

/**
 * Párrafos de respaldo legal del certificado, aprobados por la gerencia (respuesta A2, 19-11-2026).
 * Cada uno sale si el certificado tiene residuos con alguna de sus disposiciones (vacío = siempre) y, si `soloPeligrosos`,
 * solo cuando hay al menos un residuo peligroso. Cada cambio en Ajustes › Datos de la empresa crea una versión nueva.
 * GESTOR_ALIADO se llena por cada aliado con {razon_social}, {nit}, {operacion}, {licencia}, {autoridad} y {certificado}.
 * Todos admiten {emisor}, {nit_emisor} y {actividades}, y se soportan en los permisos registrados (respuesta de la gerencia del
 * 19-11-2026): {permiso:COD} es el acto propio vigente que ampara el tratamiento COD (p. ej. {permiso:ASP}, {permiso:TRA}) y
 * {permisos}, todo lo que ampara el certificado. Así una renovación o una licencia nueva sale sola, sin editar el texto.
 */
export interface TextoLegalCatalogo {
  codigo: string; titulo: string; texto: string; disposiciones: string[]; orden: number;
  soloPeligrosos?: boolean; activo?: boolean; revisado?: boolean;
}
export const TEXTOS_LEGALES: TextoLegalCatalogo[] = [
  // Modelo oficial del certificado de Terra Viva (PSAP2026-296): es el párrafo de entrada. {emisor}, {nit_emisor} y
  // {actividades} los llena el certificado (las actividades dependen de si Terra Viva recogió o solo recibió).
  { codigo: 'CERTIFICACION', orden: 0, disposiciones: [], revisado: true, titulo: 'Certificación',
    texto: '{emisor}, NIT {nit_emisor}, certifica que recibió a conformidad y realizó la gestión integral ({actividades}) de los residuos relacionados a continuación, bajo estrictos estándares de seguridad y en cumplimiento de la normativa ambiental vigente. Las cantidades son las recibidas y conciliadas con el generador. Cada línea indica la licencia o el permiso ambiental que ampara su tratamiento y disposición final, vigente a la fecha del servicio; en conjunto, este certificado se soporta en: {permisos}.' },
  { codigo: 'RESPONSABILIDAD_RESPEL', orden: 1, disposiciones: [], soloPeligrosos: true, revisado: true, titulo: 'Responsabilidad del generador de residuos peligrosos',
    texto: 'Conforme a la Ley 1252 de 2008 y al Decreto 1076 de 2015, la responsabilidad integral del generador sobre sus residuos peligrosos subsiste hasta que sean aprovechados como insumo o dispuestos con carácter definitivo (artículo 2.2.6.1.3.3). El generador debe conservar este certificado (artículo 2.2.6.1.3.1).' },
  { codigo: 'TRANSPORTE_RESPEL', orden: 2, disposiciones: [], soloPeligrosos: true, revisado: true, titulo: 'Transporte de residuos peligrosos',
    texto: 'El transporte de los residuos peligrosos relacionados lo realizó {emisor} conforme al Decreto 1079 de 2015 (transporte terrestre automotor de mercancías peligrosas) y a sus planes de contingencia para el transporte de hidrocarburos, derivados y sustancias nocivas, registrados ante las autoridades ambientales de su operación: {permiso:TRA}.' },
  { codigo: 'VERTIMIENTO_SUELO', orden: 10, disposiciones: ['ASP'], revisado: true, titulo: 'Tratamiento y vertimiento a suelo',
    texto: 'Las aguas residuales domésticas (ARD) y no domésticas (ARnD) sin características de peligrosidad relacionadas se recibieron y trataron en la planta de tratamiento de aguas residuales «Los Pinos», en el Parque de Saneamiento Ambiental Los Pinos (vereda Villa de Leyva, Sabana de Torres, Santander). El agua tratada se dispuso únicamente al suelo, por evaporación forzada o riego dentro del polígono autorizado, al amparo del permiso de vertimiento a suelo {permiso:ASP}, con un caudal de descarga estimado de 3,65 L/s (Expediente CAS 210.60.00032.2023). Ese permiso no autoriza vertimientos a cuerpos de agua superficiales.' },
  { codigo: 'BIORREMEDIACION', orden: 11, disposiciones: ['BIO'], revisado: true, titulo: 'Biorremediación',
    texto: 'Los lodos no peligrosos y los cortes de perforación base agua relacionados se trataron por biorremediación (landfarming) en la celda de operación de landfarming de la planta «Los Pinos», unidad de tratamiento aprobada en el artículo quinto de la Resolución DGL No. 000632 del 15 de agosto de 2023 de la CAS, dentro del alcance de su artículo sexto, precisado por el Oficio SAO No. 1762-2023 del 26 de diciembre de 2023.' },
  { codigo: 'RCD', orden: 12, disposiciones: ['RCD'], revisado: true, titulo: 'Residuos de construcción y demolición',
    texto: 'Los residuos de construcción y demolición (RCD) relacionados, recibidos sin mezcla con residuos ordinarios ni peligrosos, se gestionaron en el sitio de disposición final de RCD «Los Pinos» por TERRA VIVA S.A.S. E.S.P., gestor de RCD inscrito ante la CAS mediante la Resolución SAO No. 00235-24 de agosto de 2024, con licencia de funcionamiento de la Secretaría de Planeación de Sabana de Torres del 28 de abril de 2025, conforme a la Resolución 0472 de 2017 del Ministerio de Ambiente y Desarrollo Sostenible, modificada por la Resolución 1257 de 2021.' },
  { codigo: 'ACU', orden: 13, disposiciones: ['ACU'], revisado: true, titulo: 'Aceite de cocina usado',
    texto: 'El aceite de cocina usado (ACU) relacionado fue recolectado y gestionado por TERRA VIVA S.A.S. E.S.P., gestor de ACU inscrito ante la CAS (Oficio SAA No. 0311/21 del 19 de abril de 2021), conforme a la Resolución 316 de 2018 del Ministerio de Ambiente y Desarrollo Sostenible.' },
  { codigo: 'GESTOR_ALIADO', orden: 14, disposiciones: ['INCH', 'RS', 'DF', 'DES', 'POS', 'COP', 'INCO', 'TAR', 'BIOA', 'AUT', 'AUS', 'ESC'], revisado: true, titulo: 'Gestores aliados',
    texto: 'TERRA VIVA S.A.S. E.S.P. realizó la recolección y el transporte de los residuos relacionados en las líneas marcadas «gestor aliado» y los entregó, en la fecha indicada, a {razon_social}, NIT {nit}, para su {operacion}, al amparo de {licencia}, expedido por {autoridad} y vigente a la fecha de entrega. El tratamiento y la disposición final de esos residuos constan en el certificado que expide dicho gestor (N.° {certificado}).' },
  { codigo: 'LICENCIA_LOS_PINOS', orden: 20, disposiciones: [], activo: false, revisado: true, titulo: 'Licencia ambiental de Los Pinos',
    texto: 'Los residuos relacionados se gestionaron en el Parque de Saneamiento Ambiental Los Pinos al amparo de la licencia ambiental otorgada por la CAS mediante la Resolución {resolucion} del {fecha}, actividad {actividad}.' },
];
/** Textos que ya no salen: RESPONSABILIDAD se dividió (CERTIFICACION + RESPONSABILIDAD_RESPEL); APROVECHAMIENTO no fue aprobado. */
export const TEXTOS_LEGALES_RETIRADOS = ['RESPONSABILIDAD', 'APROVECHAMIENTO'];

/** «Y9.1» → «Y9»; null si no es subcorriente. Las subcorrientes del IDEAM cuelgan de su corriente Y o código A. */
export const corrienteDe = (codigo: string): string | null => /^(Y\d{1,2}|A\d{4})\.\d{1,2}$/i.exec(codigo.trim())?.[1].toUpperCase() ?? null;

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

/**
 * Corrientes Y (Anexo I, completo: Y1 a Y45) y códigos A (Anexo II, los más usados), Dec. 1076/2015.
 * Las subcorrientes del IDEAM (Y9.1, A4060.1…) cuelgan de su corriente: las registra el cargue masivo
 * cuando aparecen en una planilla (ver `corrienteDe`).
 */
export const CODIGOS_CLASIFICACION: (ItemCatalogo & { tipo: 'A' | 'Y' })[] = [
  { tipo: 'Y', codigo: 'Y1', nombre: 'Desechos clínicos resultantes de la atención médica prestada en hospitales, centros médicos y clínicas' },
  { tipo: 'Y', codigo: 'Y2', nombre: 'Desechos resultantes de la producción y preparación de productos farmacéuticos' },
  { tipo: 'Y', codigo: 'Y3', nombre: 'Desechos de medicamentos y productos farmacéuticos' },
  { tipo: 'Y', codigo: 'Y4', nombre: 'Desechos resultantes de la producción, la preparación y la utilización de biocidas y productos fitofarmacéuticos' },
  { tipo: 'Y', codigo: 'Y5', nombre: 'Desechos resultantes de la fabricación, preparación y utilización de productos químicos para la preservación de la madera' },
  { tipo: 'Y', codigo: 'Y6', nombre: 'Desechos resultantes de la producción, la preparación y la utilización de disolventes orgánicos' },
  { tipo: 'Y', codigo: 'Y7', nombre: 'Desechos que contengan cianuros, resultantes del tratamiento térmico y las operaciones de temple' },
  { tipo: 'Y', codigo: 'Y8', nombre: 'Desechos de aceites minerales no aptos para el uso a que estaban destinados' },
  { tipo: 'Y', codigo: 'Y9', nombre: 'Mezclas y emulsiones de desechos de aceite y agua o de hidrocarburos y agua' },
  { tipo: 'Y', codigo: 'Y10', nombre: 'Sustancias y artículos de desecho que contengan o estén contaminados por bifenilos policlorados (PCB), terfenilos policlorados (PCT) o bifenilos polibromados (PBB)' },
  { tipo: 'Y', codigo: 'Y11', nombre: 'Residuos alquitranados resultantes de la refinación, destilación o cualquier otro tratamiento pirolítico' },
  { tipo: 'Y', codigo: 'Y12', nombre: 'Desechos resultantes de la producción, preparación y utilización de tintas, colorantes, pigmentos, pinturas, lacas o barnices' },
  { tipo: 'Y', codigo: 'Y13', nombre: 'Desechos resultantes de la producción, preparación y utilización de resinas, látex, plastificantes o colas y adhesivos' },
  { tipo: 'Y', codigo: 'Y14', nombre: 'Sustancias químicas de desecho, no identificadas o nuevas, resultantes de la investigación y el desarrollo o de las actividades de enseñanza, cuyos efectos en el ser humano o el medio ambiente no se conozcan' },
  { tipo: 'Y', codigo: 'Y15', nombre: 'Desechos de carácter explosivo que no estén sometidos a una legislación diferente' },
  { tipo: 'Y', codigo: 'Y16', nombre: 'Desechos resultantes de la producción, preparación y utilización de productos químicos y materiales para fines fotográficos' },
  { tipo: 'Y', codigo: 'Y17', nombre: 'Desechos resultantes del tratamiento de superficie de metales y plásticos' },
  { tipo: 'Y', codigo: 'Y18', nombre: 'Residuos resultantes de las operaciones de eliminación de desechos industriales' },
  { tipo: 'Y', codigo: 'Y19', nombre: 'Metales carbonilos' },
  { tipo: 'Y', codigo: 'Y20', nombre: 'Berilio, compuestos de berilio' },
  { tipo: 'Y', codigo: 'Y21', nombre: 'Compuestos de cromo hexavalente' },
  { tipo: 'Y', codigo: 'Y22', nombre: 'Compuestos de cobre' },
  { tipo: 'Y', codigo: 'Y23', nombre: 'Compuestos de zinc' },
  { tipo: 'Y', codigo: 'Y24', nombre: 'Arsénico, compuestos de arsénico' },
  { tipo: 'Y', codigo: 'Y25', nombre: 'Selenio, compuestos de selenio' },
  { tipo: 'Y', codigo: 'Y26', nombre: 'Cadmio, compuestos de cadmio' },
  { tipo: 'Y', codigo: 'Y27', nombre: 'Antimonio, compuestos de antimonio' },
  { tipo: 'Y', codigo: 'Y28', nombre: 'Telurio, compuestos de telurio' },
  { tipo: 'Y', codigo: 'Y29', nombre: 'Mercurio, compuestos de mercurio' },
  { tipo: 'Y', codigo: 'Y30', nombre: 'Talio, compuestos de talio' },
  { tipo: 'Y', codigo: 'Y31', nombre: 'Plomo, compuestos de plomo' },
  { tipo: 'Y', codigo: 'Y32', nombre: 'Compuestos inorgánicos de flúor, con exclusión del fluoruro cálcico' },
  { tipo: 'Y', codigo: 'Y33', nombre: 'Cianuros inorgánicos' },
  { tipo: 'Y', codigo: 'Y34', nombre: 'Soluciones ácidas o ácidos en forma sólida' },
  { tipo: 'Y', codigo: 'Y35', nombre: 'Soluciones básicas o bases en forma sólida' },
  { tipo: 'Y', codigo: 'Y36', nombre: 'Asbesto (polvo y fibras)' },
  { tipo: 'Y', codigo: 'Y37', nombre: 'Compuestos orgánicos de fósforo' },
  { tipo: 'Y', codigo: 'Y38', nombre: 'Cianuros orgánicos' },
  { tipo: 'Y', codigo: 'Y39', nombre: 'Fenoles, compuestos fenólicos, con inclusión de clorofenoles' },
  { tipo: 'Y', codigo: 'Y40', nombre: 'Éteres' },
  { tipo: 'Y', codigo: 'Y41', nombre: 'Solventes orgánicos halogenados' },
  { tipo: 'Y', codigo: 'Y42', nombre: 'Disolventes orgánicos, con exclusión de disolventes halogenados' },
  { tipo: 'Y', codigo: 'Y43', nombre: 'Cualquier sustancia del grupo de los dibenzofuranos policlorados' },
  { tipo: 'Y', codigo: 'Y44', nombre: 'Cualquier sustancia del grupo de las dibenzoparadioxinas policloradas' },
  { tipo: 'Y', codigo: 'Y45', nombre: 'Compuestos organohalogenados que no sean las sustancias mencionadas en este anexo (por ejemplo, Y39, Y41, Y42, Y43, Y44)' },
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

/**
 * Tipos de RCD del Anexo II («Formato constancia gestores») de la Resolución 1257 de 2021, que modifica la 0472 de 2017.
 * El gestor de RCD entrega al generador las cantidades recibidas (en toneladas) por cada numeral.
 */
export const TIPOS_RCD = [
  { codigo: 'EXCAVACION', numeral: '1.1', nombre: 'Productos de excavación y sobrantes de la adecuación del terreno', aprovechable: true,
    ejemplos: 'coberturas vegetales, tierras, limos y materiales pétreos productos de la excavación, entre otros' },
  { codigo: 'CIMENTACION', numeral: '1.2', nombre: 'Productos de cimentaciones y pilotajes', aprovechable: true, ejemplos: 'arcillas, bentonitas y demás' },
  { codigo: 'PETREOS', numeral: '1.3', nombre: 'Pétreos', aprovechable: true,
    ejemplos: 'hormigón, arenas, gravas, gravillas, cantos, pétreos asfálticos, trozos de ladrillos y bloques, cerámicas, sobrantes de mezcla de cementos y concretos hidráulicos, entre otros' },
  { codigo: 'NO_PETREOS', numeral: '1.4', nombre: 'No pétreos', aprovechable: true,
    ejemplos: 'vidrio, metales, plásticos, espumas, gomas y cauchos, madera y compuestos de madera, cartón-yeso (drywall), entre otros' },
  { codigo: 'CONTAMINADO_RESPEL', numeral: '2.1', nombre: 'Contaminados con residuos peligrosos', aprovechable: false, ejemplos: '' },
  { codigo: 'NO_APROVECHABLE', numeral: '2.2', nombre: 'Los que por su estado no pueden ser aprovechados', aprovechable: false, ejemplos: '' },
  { codigo: 'PELIGROSO', numeral: '2.3', nombre: 'Los que tengan características de peligrosidad', aprovechable: false, ejemplos: '' },
] as const;
export type TipoRcdCodigo = (typeof TIPOS_RCD)[number]['codigo'];
/** «1.3», «PETREOS», «Pétreos» o «1.3 Pétreos» → PETREOS (sin importar tildes ni mayúsculas). */
export function tipoRcdDe(valor?: string | null): TipoRcdCodigo | null {
  const v = (valor ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  if (!v) return null;
  const t = TIPOS_RCD.find((x) => {
    const nombre = x.nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return v === x.numeral || v === x.codigo.toLowerCase() || v === nombre || v === `${x.numeral} ${nombre}` || v.startsWith(`${x.numeral} `);
  });
  return t?.codigo ?? null;
}

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
