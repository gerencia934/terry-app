// Definición única de las plantillas de importación de datos (Excel).
// La usan: (1) el navegador para generar/leer el Excel y previsualizar, (2) scripts/generar-plantillas.ts
// para producir los .xlsx del repositorio y (3) el API, que vuelve a validar todo antes de guardar.

export type TipoCol = 'texto' | 'numero' | 'fecha' | 'lista' | 'email' | 'si_no';
export interface Columna {
  key: string;
  header: string;
  requerido?: boolean;
  tipo: TipoCol;
  opciones?: string[];
  ejemplo: string | number;
  ayuda: string;
  ancho?: number;
  /** Validación adicional: devuelve mensaje de error o null. */
  validar?: (v: string, fila: Record<string, string>, ctx: Contexto) => string | null;
  /** Igual que validar, pero no bloquea la fila (advertencia). */
  advertir?: (v: string, fila: Record<string, string>, ctx: Contexto) => string | null;
}
export interface Plantilla {
  id: string;
  nombre: string;
  descripcion: string;
  archivo: string;
  columnas: Columna[];
  /** Columnas que identifican un registro único (para detectar duplicados en el archivo). */
  llave: string[];
}
/** Datos ya existentes en el sistema contra los cuales se cruzan las filas. */
export interface Contexto {
  nitsClientes: Set<string>;
  sucursalesPorNit: Map<string, Set<string>>;
  placas: Set<string>;
  emails: Set<string>;
  manejosConPermiso: Set<string>;
  manejosAliados: Set<string>;
  numerosDeclaracion: Set<string>;
  codigosInternos: Set<string>;
}

// ---------------- Listas ----------------
export const L = {
  siNo: ['Sí', 'No'],
  negociacion: ['Cobro', 'Compra', 'Sin costo'],
  formaPago: ['Contado', 'Crédito 30 días', 'Crédito 60 días', 'Crédito 90 días'],
  tipoPersona: ['Jurídica', 'Natural'],
  estadoFisico: ['Sólido', 'Líquido', 'Semisólido / lodo', 'Gaseoso'],
  categoria: ['Peligroso (RESPEL)', 'No peligroso', 'Aprovechable', 'Especial (RCD, RAEE, ACU)', 'Hospitalario / biosanitario'],
  unidad: ['kg', 't', 'm³', 'gal', 'L', 'und'],
  frecuencia: ['Diaria', 'Semanal', 'Quincenal', 'Mensual', 'Bimestral', 'Trimestral', 'Eventual'],
  lineaServicio: ['RESPEL', 'Ordinarios', 'Aprovechables', 'RAEE', 'Aceite usado de motor', 'RCD', 'Hospitalarios y biomédicos',
    'ARD', 'ARnD', 'Lodos', 'Unidades sanitarias portátiles', 'Lavado de tanques', 'Manejo integrado de plagas', 'Paisajismo'],
  unidadNegocio: ['Gestión de residuos', 'Tratamiento de aguas', 'Servicios ambientales', 'Saneamiento básico'],
  manejo: ['Biorremediación (landfarming)', 'Tratamiento y vertimiento a suelo de aguas residuales, lodos, cortes y salmueras',
    'Tratamiento fisicoquímico', 'Disposición final RCD (escombrera)', 'Aprovechamiento / valorización', 'Gestión de aceite de cocina usado',
    'Incineración (gestor aliado)', 'Regeneración de aceite (gestor aliado)', 'Celda de seguridad (gestor aliado)', 'Desensamble RAEE (gestor aliado)'],
  embalaje: ['Caneca 55 gal', 'Big bag 1 m³', 'Bolsa roja', 'Guardián', 'Bidón 20 L', 'Estiba', 'Carrotanque', 'Volqueta carpada', 'A granel'],
  tipoVehiculo: ['Furgón', 'Camión estacas', 'Volqueta', 'Carrotanque / vactor', 'Camioneta', 'Tractocamión'],
  rol: ['Administrador', 'Logística', 'HSEQ', 'Comercial', 'Facturación', 'Conductor', 'Auxiliar', 'Cliente (portal)'],
  licencia: ['B1', 'B2', 'B3', 'C1', 'C2', 'C3'],
  tipoSolicitud: ['Recolección en sede', 'Entrega en planta'],
  jornada: ['AM', 'PM'],
  departamento: ['Santander', 'Norte de Santander', 'Boyacá', 'Cesar', 'Antioquia', 'Bolívar', 'Cundinamarca', 'Meta', 'Casanare', 'Otro'],
};

// Correspondencia nombre de manejo (Excel) → código interno (permisos)
export const MANEJO_COD: Record<string, string> = {
  'Biorremediación (landfarming)': 'BIO',
  'Tratamiento y vertimiento a suelo de aguas residuales, lodos, cortes y salmueras': 'ASP',
  'Tratamiento fisicoquímico': 'FQ',
  'Disposición final RCD (escombrera)': 'ESC',
  'Aprovechamiento / valorización': 'APR',
  'Gestión de aceite de cocina usado': 'ACU',
  'Incineración (gestor aliado)': 'INC',
  'Regeneración de aceite (gestor aliado)': 'REG',
  'Celda de seguridad (gestor aliado)': 'CEL',
  'Desensamble RAEE (gestor aliado)': 'DES',
};

// ---------------- Validadores ----------------
const soloDigitos = (s: string) => s.replace(/\D/g, '');
/** Dígito de verificación DIAN (módulo 11). */
export function dvNit(nit: string): string {
  const pesos = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  const d = soloDigitos(nit).split('').reverse();
  const s = d.reduce((acc, n, i) => acc + Number(n) * pesos[i], 0) % 11;
  return String(s > 1 ? 11 - s : s);
}
const vNit = (v: string) => { const d = soloDigitos(v); return d.length < 6 || d.length > 10 ? 'El NIT debe tener entre 6 y 10 dígitos, sin dígito de verificación.' : null; };
const vClienteExiste = (v: string, _f: Record<string, string>, c: Contexto) =>
  c.nitsClientes.has(soloDigitos(v)) ? null : 'Ese NIT no está entre los clientes. Impórtelo primero con la plantilla de clientes.';
const vSucursalExiste = (v: string, f: Record<string, string>, c: Contexto) => {
  const s = c.sucursalesPorNit.get(soloDigitos(f.nit ?? ''));
  return !s ? null : s.has(norm(v)) ? null : `La sede "${v}" no existe para ese cliente.`;
};
export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

export const PLANTILLAS: Plantilla[] = [
  {
    id: 'clientes', nombre: 'Clientes', archivo: 'TV_plantilla_clientes.xlsx', llave: ['nit'],
    descripcion: 'Generadores a los que Terra Viva presta el servicio, con sus condiciones comerciales.',
    columnas: [
      { key: 'nit', header: 'NIT', requerido: true, tipo: 'texto', ejemplo: '900112345', ayuda: 'Sin puntos ni dígito de verificación.', validar: vNit, ancho: 14 },
      { key: 'dv', header: 'DV', tipo: 'texto', ejemplo: '7', ayuda: 'Dígito de verificación. Si lo deja vacío se calcula.', ancho: 6,
        validar: (v, f) => v && soloDigitos(f.nit ?? '') && dvNit(f.nit) !== soloDigitos(v) ? `El DV no corresponde al NIT (debería ser ${dvNit(f.nit)}).` : null },
      { key: 'razon', header: 'Razón social', requerido: true, tipo: 'texto', ejemplo: 'Agroindustrial La Esperanza S.A.S.', ayuda: 'Como aparece en el RUT.', ancho: 38 },
      { key: 'persona', header: 'Tipo de persona', tipo: 'lista', opciones: L.tipoPersona, ejemplo: 'Jurídica', ayuda: '', ancho: 16 },
      { key: 'sector', header: 'Sector', tipo: 'texto', ejemplo: 'Palma de aceite', ayuda: 'Hidrocarburos, salud, construcción…', ancho: 20 },
      { key: 'negociacion', header: 'Tipo de negociación', requerido: true, tipo: 'lista', opciones: L.negociacion, ejemplo: 'Cobro', ayuda: 'Compra = Terra Viva paga por el material.', ancho: 18 },
      { key: 'pago', header: 'Forma de pago', requerido: true, tipo: 'lista', opciones: L.formaPago, ejemplo: 'Crédito 30 días', ayuda: '', ancho: 18 },
      { key: 'email', header: 'Email facturación', tipo: 'email', ejemplo: 'facturas@cliente.com', ayuda: 'Recibe la factura electrónica.', ancho: 28 },
      { key: 'telefono', header: 'Teléfono', tipo: 'texto', ejemplo: '3114021188', ayuda: '', ancho: 14 },
      { key: 'asesor', header: 'Asesor comercial', tipo: 'texto', ejemplo: 'Gerencia regional', ayuda: 'Para indicadores por comercial.', ancho: 20 },
      { key: 'clasificacion', header: 'Segmento', tipo: 'texto', ejemplo: 'A', ayuda: 'Segmento del cliente (A, B, C…).', ancho: 12 },
    ],
  },
  {
    id: 'sucursales', nombre: 'Sedes de clientes', archivo: 'TV_plantilla_sedes.xlsx', llave: ['nit', 'nombre'],
    descripcion: 'Sedes donde se recoge el residuo. Cada sucursal pertenece a un cliente ya cargado.',
    columnas: [
      { key: 'nit', header: 'NIT cliente', requerido: true, tipo: 'texto', ejemplo: '900112345', ayuda: 'Debe estar ya registrado como cliente.', validar: (v, f, c) => vNit(v) ?? vClienteExiste(v, f, c), ancho: 14 },
      { key: 'nombre', header: 'Nombre de la sede', requerido: true, tipo: 'texto', ejemplo: 'Planta extractora', ayuda: '', ancho: 26 },
      { key: 'direccion', header: 'Dirección', requerido: true, tipo: 'texto', ejemplo: 'Km 4 vía Puerto Wilches', ayuda: '', ancho: 30 },
      { key: 'municipio', header: 'Municipio', requerido: true, tipo: 'texto', ejemplo: 'Puerto Wilches', ayuda: '', ancho: 18 },
      { key: 'depto', header: 'Departamento', requerido: true, tipo: 'lista', opciones: L.departamento, ejemplo: 'Santander', ayuda: '', ancho: 16 },
      { key: 'zona', header: 'Zona', tipo: 'texto', ejemplo: 'Magdalena Medio', ayuda: 'Debe existir en Ajustes › Zonas.', ancho: 18 },
      { key: 'contacto', header: 'Contacto', tipo: 'texto', ejemplo: 'Laura Méndez', ayuda: 'Quien entrega el residuo y firma.', ancho: 20 },
      { key: 'telefono', header: 'Teléfono', tipo: 'texto', ejemplo: '3114021188', ayuda: '', ancho: 14 },
      { key: 'respel', header: 'Registro generador RESPEL (IDEAM)', tipo: 'texto', ejemplo: 'RG-68575-0012', ayuda: 'Obligatorio si genera residuos peligrosos.', ancho: 22 },
      { key: 'lat', header: 'Latitud', tipo: 'numero', ejemplo: 7.3466, ayuda: 'Decimal, ej. 7.3466', ancho: 10,
        validar: (v) => v && (Number(v) < -5 || Number(v) > 14) ? 'Latitud fuera de Colombia.' : null },
      { key: 'lng', header: 'Longitud', tipo: 'numero', ejemplo: -73.8986, ayuda: 'Decimal negativo, ej. -73.8986', ancho: 10,
        validar: (v) => v && (Number(v) < -82 || Number(v) > -66) ? 'Longitud fuera de Colombia.' : null },
    ],
  },
  {
    id: 'decl-residuos', nombre: 'Declaraciones de residuos', archivo: 'TV_plantilla_declaraciones_residuos.xlsx', llave: ['nit', 'sucursal', 'codigo'],
    descripcion: 'Residuos que cada sucursal tiene autorizado entregar. Se validan contra los permisos ambientales.',
    columnas: [
      { key: 'nit', header: 'NIT cliente', requerido: true, tipo: 'texto', ejemplo: '900112345', ayuda: '', validar: (v, f, c) => vNit(v) ?? vClienteExiste(v, f, c), ancho: 14 },
      { key: 'sucursal', header: 'Sede', requerido: true, tipo: 'texto', ejemplo: 'Planta extractora', ayuda: 'Nombre exacto de la sucursal.', validar: vSucursalExiste, ancho: 22 },
      { key: 'codigo', header: 'Código interno', requerido: true, tipo: 'texto', ejemplo: 'RP-018', ayuda: 'Código del catálogo de residuos.', ancho: 12 },
      { key: 'residuo', header: 'Residuo', requerido: true, tipo: 'texto', ejemplo: 'Lodos aceitosos de trampa de grasas', ayuda: '', ancho: 34 },
      { key: 'estadoFisico', header: 'Estado físico', requerido: true, tipo: 'lista', opciones: L.estadoFisico, ejemplo: 'Semisólido / lodo', ayuda: '', ancho: 16 },
      { key: 'categoria', header: 'Clase de residuo', tipo: 'lista', opciones: L.categoria, ejemplo: 'Peligroso (RESPEL)', ayuda: '', ancho: 22 },
      { key: 'tipoResiduo', header: 'Origen', tipo: 'texto', ejemplo: 'Industrial', ayuda: '', ancho: 14 },
      { key: 'linea', header: 'Línea de servicio', requerido: true, tipo: 'lista', opciones: L.lineaServicio, ejemplo: 'Lodos', ayuda: '', ancho: 20 },
      { key: 'unidadNegocio', header: 'Unidad de negocio', tipo: 'lista', opciones: L.unidadNegocio, ejemplo: 'Gestión de residuos', ayuda: '', ancho: 20 },
      { key: 'manejo', header: 'Tratamiento', requerido: true, tipo: 'lista', opciones: L.manejo, ejemplo: 'Biorremediación (landfarming)', ayuda: 'Se verifica contra los permisos de la CAS.', ancho: 34,
        advertir: (v, _f, c) => { const cod = MANEJO_COD[v]; if (!cod) return null; if (c.manejosAliados.has(cod)) return 'Va a gestor aliado: exigir licencia y certificado del gestor.'; return c.manejosConPermiso.has(cod) ? null : 'Ningún permiso vigente cubre este manejo.'; } },
      { key: 'embalaje', header: 'Embalaje', tipo: 'lista', opciones: L.embalaje, ejemplo: 'Big bag 1 m³', ayuda: '', ancho: 16 },
      { key: 'peligroso', header: 'Peligroso', requerido: true, tipo: 'si_no', opciones: L.siNo, ejemplo: 'Sí', ayuda: '', ancho: 12 },
      { key: 'corrienteY', header: 'Corriente Y', tipo: 'texto', ejemplo: 'Y18', ayuda: 'Anexo I Dec. 1076/2015 (Y1 a Y45).', ancho: 11,
        validar: (v, f) => v ? (/^Y([1-9]|[1-3]\d|4[0-5])$/i.test(v.trim()) ? null : 'Corriente Y inválida (Y1 a Y45).') : (f.peligroso === 'Sí' && !f.corrienteA ? 'Un residuo peligroso necesita corriente Y o A.' : null) },
      { key: 'corrienteA', header: 'Corriente A', tipo: 'texto', ejemplo: '', ayuda: 'Anexo II (A1010 a A4160).', ancho: 11,
        validar: (v) => !v || /^A[1-4]\d{3}$/i.test(v.trim()) ? null : 'Corriente A inválida (formato A1010).' },
      { key: 'inflamable', header: 'Inflamable', tipo: 'si_no', opciones: L.siNo, ejemplo: 'No', ayuda: '', ancho: 12 },
      { key: 'unidad', header: 'Unidad', requerido: true, tipo: 'lista', opciones: L.unidad, ejemplo: 'kg', ayuda: '', ancho: 8 },
      { key: 'cantidad', header: 'Cantidad habitual', tipo: 'numero', ejemplo: 8000, ayuda: 'Por frecuencia.', ancho: 12 },
      { key: 'frecuencia', header: 'Frecuencia', tipo: 'lista', opciones: L.frecuencia, ejemplo: 'Mensual', ayuda: '', ancho: 12 },
      { key: 'precio', header: 'Precio unitario', tipo: 'numero', ejemplo: 780, ayuda: 'COP por unidad, sin IVA.', ancho: 12 },
      { key: 'observacion', header: 'Observación', tipo: 'texto', ejemplo: '', ayuda: '', ancho: 24 },
    ],
  },
  {
    id: 'decl-servicios', nombre: 'Declaraciones de servicios', archivo: 'TV_plantilla_declaraciones_servicios.xlsx', llave: ['nit', 'sucursal', 'codigo'],
    descripcion: 'USP, lavado de tanques, MIP, paisajismo y succión con vactor por sucursal.',
    columnas: [
      { key: 'nit', header: 'NIT cliente', requerido: true, tipo: 'texto', ejemplo: '900778123', ayuda: '', validar: (v, f, c) => vNit(v) ?? vClienteExiste(v, f, c), ancho: 14 },
      { key: 'sucursal', header: 'Sede', requerido: true, tipo: 'texto', ejemplo: 'Obra Torres del Parque', ayuda: '', validar: vSucursalExiste, ancho: 22 },
      { key: 'codigo', header: 'Código interno', requerido: true, tipo: 'texto', ejemplo: 'SV-USP', ayuda: '', ancho: 12 },
      { key: 'servicio', header: 'Servicio', requerido: true, tipo: 'texto', ejemplo: 'Alquiler unidad sanitaria portátil', ayuda: '', ancho: 32 },
      { key: 'linea', header: 'Línea de servicio', requerido: true, tipo: 'lista', opciones: L.lineaServicio, ejemplo: 'Unidades sanitarias portátiles', ayuda: '', ancho: 22 },
      { key: 'unidadNegocio', header: 'Unidad de negocio', tipo: 'lista', opciones: L.unidadNegocio, ejemplo: 'Saneamiento básico', ayuda: '', ancho: 20 },
      { key: 'frecuencia', header: 'Frecuencia', tipo: 'lista', opciones: L.frecuencia, ejemplo: 'Semanal', ayuda: '', ancho: 14 },
      { key: 'progAuto', header: 'Se programa sola', tipo: 'si_no', opciones: L.siNo, ejemplo: 'Sí', ayuda: 'Crea las solicitudes según la frecuencia.', ancho: 14 },
      { key: 'cantidad', header: 'Cantidad habitual', tipo: 'numero', ejemplo: 12, ayuda: '', ancho: 12 },
      { key: 'precio', header: 'Precio unitario', tipo: 'numero', ejemplo: 420000, ayuda: 'COP, sin IVA.', ancho: 12 },
      { key: 'descripcion', header: 'Descripción', tipo: 'texto', ejemplo: 'Incluye 2 mantenimientos semanales', ayuda: '', ancho: 30 },
    ],
  },
  {
    id: 'precios', nombre: 'Tarifas', archivo: 'TV_plantilla_precios.xlsx', llave: ['numero'],
    descripcion: 'Nuevas tarifas por número de declaración. Cada fila crea una vigencia; el precio anterior se conserva.',
    columnas: [
      { key: 'numero', header: 'Nº declaración', requerido: true, tipo: 'numero', ejemplo: 1001, ayuda: 'Está en Comercial › Exportar.', ancho: 14,
        validar: (v, _f, c) => c.numerosDeclaracion.has(String(Number(v))) ? null : 'La declaración no existe.' },
      { key: 'precio', header: 'Precio unitario', requerido: true, tipo: 'numero', ejemplo: 820, ayuda: 'COP, sin IVA.', ancho: 14, validar: (v) => Number(v) < 0 ? 'El precio no puede ser negativo.' : null },
      { key: 'negociacion', header: 'Tipo de negociación', tipo: 'lista', opciones: L.negociacion, ejemplo: 'Cobro', ayuda: 'Vacío = conserva el actual.', ancho: 18 },
      { key: 'pago', header: 'Forma de pago', tipo: 'lista', opciones: L.formaPago, ejemplo: 'Crédito 30 días', ayuda: 'Vacío = conserva la actual.', ancho: 18 },
      { key: 'desde', header: 'Vigente desde', requerido: true, tipo: 'fecha', ejemplo: '2027-01-01', ayuda: 'AAAA-MM-DD', ancho: 14 },
    ],
  },
  {
    id: 'vehiculos', nombre: 'Vehículos', archivo: 'TV_plantilla_vehiculos.xlsx', llave: ['placa'],
    descripcion: 'Flota con vencimientos de SOAT, revisión técnico-mecánica y póliza de responsabilidad civil.',
    columnas: [
      { key: 'placa', header: 'Placa', requerido: true, tipo: 'texto', ejemplo: 'USD855', ayuda: 'Sin guion: ABC123.', ancho: 10,
        validar: (v, _f, c) => !/^[A-Z]{3}\d{3}$/i.test(v.replace(/[\s-]/g, '')) ? 'Formato de placa inválido (ABC123).' : c.placas.has(v.replace(/[\s-]/g, '').toUpperCase()) ? 'La placa ya existe; se actualizarán sus datos.' : null },
      { key: 'marca', header: 'Marca', requerido: true, tipo: 'texto', ejemplo: 'Chevrolet', ayuda: '', ancho: 14 },
      { key: 'tipo', header: 'Tipo de vehículo', requerido: true, tipo: 'lista', opciones: L.tipoVehiculo, ejemplo: 'Furgón', ayuda: '', ancho: 18 },
      { key: 'capacidad', header: 'Capacidad', requerido: true, tipo: 'numero', ejemplo: 3500, ayuda: '', ancho: 10 },
      { key: 'unidadCap', header: 'Unidad capacidad', tipo: 'lista', opciones: ['kg', 'm³', 'gal'], ejemplo: 'kg', ayuda: '', ancho: 10 },
      { key: 'soat', header: 'SOAT vence', requerido: true, tipo: 'fecha', ejemplo: '2027-03-02', ayuda: 'AAAA-MM-DD', ancho: 12 },
      { key: 'rtm', header: 'Revisión técnico-mecánica vence', requerido: true, tipo: 'fecha', ejemplo: '2027-02-11', ayuda: 'AAAA-MM-DD', ancho: 14 },
      { key: 'poliza', header: 'Póliza RC vence', tipo: 'fecha', ejemplo: '2027-01-20', ayuda: 'AAAA-MM-DD', ancho: 12 },
      { key: 'bodega', header: 'Bodega', tipo: 'texto', ejemplo: 'PSA Los Pinos', ayuda: '', ancho: 16 },
    ],
  },
  {
    id: 'usuarios', nombre: 'Usuarios', archivo: 'TV_plantilla_usuarios.xlsx', llave: ['email'],
    descripcion: 'Personal con acceso a la plataforma. Conductores con licencia y curso de mercancías peligrosas.',
    columnas: [
      { key: 'documento', header: 'Documento', requerido: true, tipo: 'texto', ejemplo: '1098765432', ayuda: 'Cédula sin puntos.', ancho: 14 },
      { key: 'nombre', header: 'Nombre completo', requerido: true, tipo: 'texto', ejemplo: 'Wilson Carreño', ayuda: '', ancho: 26 },
      { key: 'email', header: 'Usuario (correo)', requerido: true, tipo: 'email', ejemplo: 'wcarreno@terravivasas.com', ayuda: 'Con este correo ingresa.', ancho: 28,
        validar: (v, _f, c) => c.emails.has(v.trim().toLowerCase()) ? 'Ya existe un usuario con ese correo.' : null },
      { key: 'rol', header: 'Rol', requerido: true, tipo: 'lista', opciones: L.rol, ejemplo: 'Conductor', ayuda: '', ancho: 16 },
      { key: 'telefono', header: 'Teléfono', tipo: 'texto', ejemplo: '3101234567', ayuda: '', ancho: 14 },
      { key: 'licencia', header: 'Categoría licencia', tipo: 'lista', opciones: L.licencia, ejemplo: 'C2', ayuda: 'Solo conductores.', ancho: 10,
        validar: (v, f) => f.rol === 'Conductor' && !v ? 'Un conductor necesita categoría de licencia.' : null },
      { key: 'licenciaVence', header: 'Licencia vence', tipo: 'fecha', ejemplo: '2028-04-10', ayuda: 'AAAA-MM-DD', ancho: 12 },
      { key: 'cursoMp', header: 'Curso mercancías peligrosas vence', tipo: 'fecha', ejemplo: '2027-06-15', ayuda: 'Res. 1223 de 2014.', ancho: 14,
        validar: (v, f) => f.rol === 'Conductor' && !v ? 'Un conductor de RESPEL necesita el curso vigente.' : null },
    ],
  },
  {
    id: 'solicitudes', nombre: 'Solicitudes', archivo: 'TV_plantilla_solicitudes.xlsx', llave: ['nit', 'sucursal', 'fecha', 'codigo'],
    descripcion: 'Programación de recolecciones en bloque (por ejemplo, el plan mensual de un cliente grande).',
    columnas: [
      { key: 'nit', header: 'NIT cliente', requerido: true, tipo: 'texto', ejemplo: '901223456', ayuda: '', validar: (v, f, c) => vNit(v) ?? vClienteExiste(v, f, c), ancho: 14 },
      { key: 'sucursal', header: 'Sede', requerido: true, tipo: 'texto', ejemplo: 'EDS Principal', ayuda: '', validar: vSucursalExiste, ancho: 22 },
      { key: 'tipo', header: 'Modalidad', requerido: true, tipo: 'lista', opciones: L.tipoSolicitud, ejemplo: 'Recolección en sede', ayuda: 'Recolección en la sede del cliente o entrega del cliente en planta.', ancho: 18 },
      { key: 'fecha', header: 'Fecha del servicio', requerido: true, tipo: 'fecha', ejemplo: '2026-12-02', ayuda: 'AAAA-MM-DD', ancho: 14 },
      { key: 'jornada', header: 'Franja', tipo: 'lista', opciones: L.jornada, ejemplo: 'AM', ayuda: '', ancho: 9 },
      { key: 'codigo', header: 'Código interno residuo', requerido: true, tipo: 'texto', ejemplo: 'RP-008', ayuda: 'Debe estar declarado y autorizado.', ancho: 14,
        validar: (v, _f, c) => c.codigosInternos.has(v.trim().toUpperCase()) ? null : 'El código no corresponde a una declaración autorizada.' },
      { key: 'cantidad', header: 'Cantidad', requerido: true, tipo: 'numero', ejemplo: 120, ayuda: 'En la unidad declarada.', ancho: 10 },
      { key: 'oc', header: 'Orden de compra', tipo: 'texto', ejemplo: 'OC-4512', ayuda: '', ancho: 14 },
      { key: 'observaciones', header: 'Observaciones', tipo: 'texto', ejemplo: 'Pasar primero por portería', ayuda: '', ancho: 28 },
    ],
  },
];
export const plantilla = (id: string) => PLANTILLAS.find((p) => p.id === id)!;

// ---------------- Validación de filas ----------------
export interface FilaValidada { n: number; datos: Record<string, string>; errores: string[]; advertencias: string[] }

export function validarFilas(p: Plantilla, filas: Record<string, string>[], ctx: Contexto): FilaValidada[] {
  const vistos = new Map<string, number>();
  return filas.map((datos, i) => {
    const errores: string[] = []; const advertencias: string[] = [];
    for (const c of p.columnas) {
      const v = (datos[c.key] ?? '').trim();
      if (!v) { if (c.requerido) errores.push(`${c.header}: es obligatorio.`); }
      else {
        if (c.tipo === 'numero' && isNaN(Number(v.replace(',', '.')))) errores.push(`${c.header}: debe ser un número.`);
        if (c.tipo === 'fecha' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errores.push(`${c.header}: use el formato AAAA-MM-DD.`);
        if (c.tipo === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errores.push(`${c.header}: correo inválido.`);
        if ((c.tipo === 'lista' || c.tipo === 'si_no') && c.opciones && !c.opciones.some((o) => norm(o) === norm(v))) errores.push(`${c.header}: "${v}" no está en la lista.`);
      }
      const e = c.validar?.(v, datos, ctx);
      // "ya existe; se actualizarán" es informativo, no bloquea
      if (e) (e.includes('se actualizarán') ? advertencias : errores).push(`${c.header}: ${e}`);
      const a = v ? c.advertir?.(v, datos, ctx) : null;
      if (a) advertencias.push(`${c.header}: ${a}`);
    }
    const llave = p.llave.map((k) => norm(datos[k] ?? '')).join('|');
    if (llave.replace(/\|/g, '')) {
      if (vistos.has(llave)) errores.push(`Fila duplicada en el archivo (igual a la fila ${vistos.get(llave)}).`);
      else vistos.set(llave, Number(datos.__fila) || i + 2);
    }
    const n = Number(datos.__fila) || i + 2;
    return { n, datos, errores, advertencias };
  });
}
