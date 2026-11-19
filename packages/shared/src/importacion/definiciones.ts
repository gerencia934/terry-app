// Definición única de las plantillas de importación de datos (Excel).
// La usan: (1) el navegador para generar/leer el Excel y previsualizar, (2) scripts/generar-plantillas.ts
// para producir los .xlsx del repositorio y (3) el API, que vuelve a validar todo antes de guardar.

import { CODIGOS_BASE, ESTADOS_FISICOS, TIPOS_RCD, corrienteDe, tipoRcdDe, type ClaveCatalogo } from '../declaraciones/catalogos';
import { SECTORES } from '../clientes';

export type TipoCol = 'texto' | 'numero' | 'fecha' | 'lista' | 'email' | 'si_no' | 'codigo';
export interface Columna {
  key: string;
  header: string;
  requerido?: boolean;
  tipo: TipoCol;
  opciones?: string[];
  /** Solo tipo «codigo»: catálogo contra el que se valida el código escrito. */
  catalogo?: ClaveCatalogo;
  /** Solo tipo «codigo»: admite varios códigos separados por punto y coma (BIO;ASP). */
  multiple?: boolean;
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
  /** Por NIT: nombres de sede normalizados y códigos de sede (C001) normalizados. */
  sucursalesPorNit: Map<string, Set<string>>;
  placas: Set<string>;
  emails: Set<string>;
  numerosDeclaracion: Set<string>;
  /** Código interno (en mayúsculas) de las declaraciones autorizadas y activas. */
  codigosInternos: Set<string>;
  /** Códigos vigentes por catálogo, en mayúsculas. */
  catalogos: Record<ClaveCatalogo, Set<string>>;
  /** Nombre normalizado → códigos, por catálogo: la planilla puede traer el nombre exacto en vez del código. */
  nombres?: Partial<Record<ClaveCatalogo, Map<string, string[]>>>;
  /** Disposiciones (código en mayúsculas) cubiertas hoy por un permiso, una licencia o el objeto social. */
  disposicionesCubiertas: Set<string>;
  /** Municipios de la DIVIPOLA: claves «municipio|departamento» (claveMunicipio) y códigos DANE. Sin él no se avisa. */
  municipios?: Set<string>;
}
/** Clave de un municipio para compararlo sin tildes, mayúsculas ni espacios de más. */
export const claveMunicipio = (municipio: string, departamento: string) => `${norm(municipio).replace(/\s+/g, ' ')}|${norm(departamento).replace(/\s+/g, ' ')}`;

/** Contexto de catálogos con los datos iniciales (modo demostración). */
export const catalogosBase = (): Record<ClaveCatalogo, Set<string>> =>
  Object.fromEntries(Object.entries(CODIGOS_BASE).map(([k, v]) => [k, new Set(v.map((x) => x.toUpperCase()))])) as Record<ClaveCatalogo, Set<string>>;

/** Separa una celda de varios valores: «BIO; ASP» → ['BIO', 'ASP']. */
export const lista = (v?: string) => (v ?? '').split(';').map((x) => x.trim()).filter(Boolean);

// ---------------- Listas ----------------
export const L = {
  siNo: ['Sí', 'No'],
  negociacion: ['Cobro', 'Compra', 'Sin costo', 'Por contrato'],
  formaPago: ['Contado', 'Crédito 30 días', 'Crédito 60 días', 'Crédito 90 días'],
  tipoPersona: ['Jurídica', 'Natural'],
  tipoCliente: ['Directo', 'Gestor'],
  sector: [...SECTORES] as string[],
  estadoFisico: ESTADOS_FISICOS.map(([etiqueta]) => etiqueta),
  tipoRcd: TIPOS_RCD.map((t) => `${t.numeral} ${t.nombre}`),
  unidad: ['kg', 't', 'm³', 'gal', 'L', 'und'],
  tipoVehiculo: ['Furgón', 'Camión estacas', 'Volqueta', 'Carrotanque / vactor', 'Camioneta', 'Tractocamión'],
  rol: ['Administrador', 'Logística', 'HSEQ', 'Comercial', 'Facturación', 'Conductor', 'Auxiliar', 'Cliente (portal)'],
  licencia: ['B1', 'B2', 'B3', 'C1', 'C2', 'C3'],
  tipoSolicitud: ['Recolección en sede', 'Entrega en planta'],
  jornada: ['AM', 'PM'],
  // Los 33 de la DIVIPOLA del DANE (packages/db/prisma/datos/divipola.json)
  departamento: ['Amazonas', 'Antioquia', 'Arauca', 'Archipiélago de San Andrés, Providencia y Santa Catalina', 'Atlántico', 'Bogotá, D.C.', 'Bolívar', 'Boyacá',
    'Caldas', 'Caquetá', 'Casanare', 'Cauca', 'Cesar', 'Chocó', 'Córdoba', 'Cundinamarca', 'Guainía', 'Guaviare', 'Huila', 'La Guajira', 'Magdalena', 'Meta',
    'Nariño', 'Norte de Santander', 'Putumayo', 'Quindío', 'Risaralda', 'Santander', 'Sucre', 'Tolima', 'Valle del Cauca', 'Vaupés', 'Vichada'],
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
/** Sedes de una declaración: TODAS, PRINCIPAL o códigos/nombres de sede separados por «;». */
const vSedes = (v: string, f: Record<string, string>, c: Contexto) => {
  if (['todas', 'principal'].includes(norm(v))) return null;
  const s = c.sucursalesPorNit.get(soloDigitos(f.nit ?? ''));
  if (!s) return null;
  const malas = lista(v).filter((x) => !s.has(norm(x)));
  return malas.length ? `Sedes que no existen para ese cliente: ${malas.join(', ')}.` : null;
};
const si = (v?: string) => norm(v ?? '') === 'si';
/** Advierte (no bloquea) si alguna disposición no tiene hoy permiso o licencia vigente: no se podrá autorizar. */
const aDisposiciones = (v: string, f: Record<string, string>, c: Contexto) => {
  const sin = lista(v).filter((x) => c.catalogos.disposiciones.has(x.toUpperCase()) && !c.disposicionesCubiertas.has(x.toUpperCase()));
  const avisos = sin.length ? [`Sin permiso ni licencia vigente hoy: ${sin.join(', ')}. La declaración quedará pendiente y no se podrá autorizar.`] : [];
  if (lista(v).some((x) => x.toUpperCase() === 'RCD') && !tipoRcdDe(f.tipoRcd)) avisos.push('Es RCD: indique el «Tipo de RCD (Anexo II)»; sin él no se emite su certificado.');
  return avisos.length ? avisos.join(' ') : null;
};
/** Fecha de hoy en Colombia (AAAA-MM-DD), sin importar la zona horaria del equipo o del servidor. */
export const hoyColombia = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
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
      { key: 'representante', header: 'Representante legal', requerido: true, tipo: 'texto', ejemplo: 'Nombre del representante legal',
        ayuda: 'Como en el certificado de existencia y representación. Si es persona natural, su propio nombre. Sale en la constancia de RCD.', ancho: 28,
        validar: (v) => v && v.trim().length < 3 ? 'Escriba el nombre completo del representante legal.' : null },
      { key: 'tipo', header: 'Tipo de cliente', tipo: 'lista', opciones: L.tipoCliente, ejemplo: 'Directo', ayuda: 'Directo = el cliente genera el residuo. Gestor = cada sede es un generador tercero. Vacío = Directo.', ancho: 14 },
      { key: 'sector', header: 'Sector', tipo: 'lista', opciones: L.sector, ejemplo: 'Agrícola', ayuda: 'Elija de la lista: hidrocarburos, doméstico, industrial, agrícola, minero, alimenticio…', ancho: 20 },
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
      { key: 'codigo', header: 'Código de la sede', tipo: 'texto', ejemplo: 'C001', ayuda: 'Corto y único por cliente. Con él se asignan las sedes en las declaraciones.', ancho: 12,
        validar: (v) => v && !/^[A-Za-z0-9-]{1,20}$/.test(v) ? 'Use letras, números o guion (máximo 20).' : null },
      { key: 'principal', header: 'Sede principal', tipo: 'si_no', opciones: L.siNo, ejemplo: 'Sí', ayuda: 'Solo una por cliente.', ancho: 10 },
      { key: 'direccion', header: 'Dirección', requerido: true, tipo: 'texto', ejemplo: 'Km 4 vía Puerto Wilches', ayuda: '', ancho: 30 },
      { key: 'municipio', header: 'Municipio', requerido: true, tipo: 'texto', ejemplo: 'Puerto Wilches', ayuda: 'Como en la DIVIPOLA del DANE, o su código de 5 dígitos (68655)', ancho: 18,
        advertir: (v, f, c) => (c.municipios && !c.municipios.has(/^\d{5}$/.test(v.trim()) ? v.trim() : claveMunicipio(v, f.depto ?? ''))
          ? 'No está en la DIVIPOLA del DANE para ese departamento: la sede quedará sin código de municipio. Revise la ortografía.' : null) },
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
    id: 'decl-residuos', nombre: 'Declaraciones de residuos', archivo: 'TV_plantilla_declaraciones_residuos.xlsx', llave: ['nit', 'codigo', 'residuo'],
    descripcion: 'Residuos que cada cliente tiene autorizado entregar y en qué sedes. Los catálogos se escriben con su código (hoja «Instrucciones»). Las disposiciones se validan contra los permisos ambientales.',
    columnas: [
      { key: 'nit', header: 'NIT cliente', requerido: true, tipo: 'texto', ejemplo: '900112345', ayuda: '', validar: (v, f, c) => vNit(v) ?? vClienteExiste(v, f, c), ancho: 14 },
      { key: 'sedes', header: 'Sedes', requerido: true, tipo: 'texto', ejemplo: 'C001;C002', ayuda: 'TODAS, PRINCIPAL o códigos (o nombres) de sede separados por punto y coma.', validar: vSedes, ancho: 18 },
      { key: 'codigo', header: 'Código interno', tipo: 'texto', ejemplo: 'RP-018', ayuda: 'Código del cliente para este residuo. Único por cliente; con él se programan solicitudes.', ancho: 12 },
      { key: 'residuo', header: 'Residuo', requerido: true, tipo: 'texto', ejemplo: 'Lodos aceitosos de trampa de grasas', ayuda: '', ancho: 34 },
      { key: 'categoria', header: 'Categoría', requerido: true, tipo: 'codigo', catalogo: 'categorias', ejemplo: 'RESPEL', ayuda: 'Código de la categoría del declarado.', ancho: 12 },
      { key: 'tipoResiduo', header: 'Tipo de residuo', requerido: true, tipo: 'codigo', catalogo: 'tiposResiduo', ejemplo: 'IND', ayuda: '', ancho: 12 },
      { key: 'linea', header: 'Línea de servicio', requerido: true, tipo: 'codigo', catalogo: 'lineas', ejemplo: '01', ayuda: 'Código o nombre exacto de la línea; la unidad de negocio se deduce de ella.', ancho: 10 },
      { key: 'peligroso', header: 'Peligroso', requerido: true, tipo: 'si_no', opciones: L.siNo, ejemplo: 'Sí', ayuda: '', ancho: 10 },
      { key: 'corrienteY', header: 'Corriente Y', tipo: 'codigo', catalogo: 'corrientesY', ejemplo: 'Y18', ayuda: 'Anexo I Dec. 1076/2015. Admite subcorrientes del IDEAM (Y9.1). El número UN va en su propia columna.', ancho: 11,
        validar: (v, f) => !v && si(f.peligroso) && !f.codigoA ? 'Un residuo peligroso necesita corriente Y o código A.' : null },
      { key: 'codigoA', header: 'Código A', tipo: 'codigo', catalogo: 'codigosA', ejemplo: '', ayuda: 'Anexo II Dec. 1076/2015. Admite subcorrientes del IDEAM (A4060.1).', ancho: 11 },
      { key: 'codigoUn', header: 'Código UN', tipo: 'texto', ejemplo: 'UN3082', ayuda: 'Formato UN y 4 dígitos.', ancho: 10,
        validar: (v) => v && !/^UN\d{4}$/i.test(v.trim()) ? 'Use el formato UN3082.' : null },
      { key: 'riesgos', header: 'Riesgos', tipo: 'codigo', catalogo: 'riesgos', multiple: true, ejemplo: 'T;I', ayuda: 'CRETIB y RAD, separados por punto y coma.', ancho: 10 },
      { key: 'etiquetado', header: 'Etiquetado', tipo: 'codigo', catalogo: 'etiquetado', multiple: true, ejemplo: 'ONU;SGA', ayuda: 'Separados por punto y coma.', ancho: 12 },
      { key: 'proceso', header: 'Proceso que lo generó', requerido: true, tipo: 'texto', ejemplo: 'Limpieza de trampa de grasas', ayuda: '', ancho: 28 },
      { key: 'composicion', header: 'Composición fisicoquímica', tipo: 'texto', ejemplo: 'Agua 60 %, grasas 30 %, sólidos 10 %', ayuda: 'Obligatoria si es peligroso.', ancho: 28,
        validar: (v, f) => !v && si(f.peligroso) ? 'Obligatoria para residuos peligrosos.' : null },
      { key: 'embalaje', header: 'Tipo de embalaje', requerido: true, tipo: 'codigo', catalogo: 'embalajes', ejemplo: 'CANECA', ayuda: '', ancho: 12 },
      { key: 'otroEmbalaje', header: 'Otro embalaje', tipo: 'texto', ejemplo: '', ayuda: 'Obligatorio si el tipo es OTRO.', ancho: 14,
        validar: (v, f) => !v && norm(f.embalaje ?? '') === 'otro' ? 'Indique cuál es el otro embalaje.' : null },
      { key: 'presentacion', header: 'Presentación', tipo: 'texto', ejemplo: '55 gal', ayuda: 'Tamaño del embalaje.', ancho: 12 },
      { key: 'material', header: 'Material del embalaje', requerido: true, tipo: 'codigo', catalogo: 'materiales', ejemplo: 'MET', ayuda: '', ancho: 12 },
      { key: 'otroMaterial', header: 'Otro material', tipo: 'texto', ejemplo: '', ayuda: 'Obligatorio si el material es OTRO.', ancho: 14,
        validar: (v, f) => !v && norm(f.material ?? '') === 'otro' ? 'Indique cuál es el otro material.' : null },
      { key: 'estadoFisico', header: 'Estado físico', requerido: true, tipo: 'lista', opciones: L.estadoFisico, ejemplo: 'Semisólido / lodo', ayuda: '', ancho: 16 },
      { key: 'inflamable', header: 'Inflamable', requerido: true, tipo: 'si_no', opciones: L.siNo, ejemplo: 'No', ayuda: '', ancho: 10 },
      { key: 'estupefacientes', header: 'Sustancia controlada (FNE)', requerido: true, tipo: 'si_no', opciones: L.siNo, ejemplo: 'No', ayuda: 'Controlada por el Fondo Nacional de Estupefacientes.', ancho: 12 },
      { key: 'disposiciones', header: 'Disposición', requerido: true, tipo: 'codigo', catalogo: 'disposiciones', multiple: true, ejemplo: 'BIO', ayuda: 'Una o varias separadas por punto y coma; la primera es la principal.', ancho: 12, advertir: aDisposiciones },
      { key: 'tipoRcd', header: 'Tipo de RCD (Anexo II)', tipo: 'texto', opciones: L.tipoRcd, ejemplo: '', ancho: 18,
        ayuda: 'Solo para residuos de construcción y demolición: numeral del Anexo II de la Res. 1257 de 2021 (1.1 a 2.3).',
        validar: (v) => (v && !tipoRcdDe(v) ? 'Use un numeral del Anexo II: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2 o 2.3.' : null) },
      { key: 'frecuenciaDias', header: 'Frecuencia (días)', tipo: 'numero', ejemplo: 30, ayuda: 'Cada cuántos días se recoge (1 a 366).', ancho: 10,
        validar: (v) => v && !(Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 366) ? 'Entero entre 1 y 366.' : null },
      { key: 'cantidad', header: 'Cantidad por frecuencia', tipo: 'numero', ejemplo: 8000, ayuda: 'En la métrica del precio.', ancho: 12,
        validar: (v) => v && Number(v.replace(',', '.')) <= 0 ? 'Debe ser mayor que cero.' : null },
      { key: 'metrica', header: 'Métrica del precio', tipo: 'codigo', catalogo: 'metricasPrecio', ejemplo: 'kg', ayuda: 'Vacío = precio global por servicio.', ancho: 10 },
      { key: 'precio', header: 'Precio unitario', tipo: 'numero', ejemplo: 780, ayuda: 'COP sin IVA. Sin precio la declaración no se puede autorizar.', ancho: 12,
        validar: (v) => v && Number(v.replace(',', '.')) < 0 ? 'El precio no puede ser negativo.' : null },
      { key: 'fds', header: 'Ficha de datos de seguridad (enlace)', tipo: 'texto', ejemplo: 'https://…/fds-lodos.pdf', ayuda: 'Obligatoria para autorizar un residuo peligroso (Dec. 1079 de 2015).', ancho: 24 },
      { key: 'responsabilidad', header: 'Responsabilidad aceptada', requerido: true, tipo: 'si_no', opciones: L.siNo, ejemplo: 'Sí', ayuda: 'Confirma que el generador firmó la declaración de veracidad de la información. Sin ella no se carga.', ancho: 12,
        validar: (v) => v && !si(v) ? 'El generador debe aceptar la declaración de responsabilidad.' : null },
      { key: 'observacion', header: 'Observación', tipo: 'texto', ejemplo: '', ayuda: '', ancho: 24 },
    ],
  },
  {
    id: 'decl-servicios', nombre: 'Declaraciones de servicios', archivo: 'TV_plantilla_declaraciones_servicios.xlsx', llave: ['nit', 'codigo', 'servicio'],
    descripcion: 'Unidades sanitarias, lavado de tanques, fumigación, hidrolimpieza y demás servicios por cliente y sede.',
    columnas: [
      { key: 'nit', header: 'NIT cliente', requerido: true, tipo: 'texto', ejemplo: '900778123', ayuda: '', validar: (v, f, c) => vNit(v) ?? vClienteExiste(v, f, c), ancho: 14 },
      { key: 'sedes', header: 'Sedes', requerido: true, tipo: 'texto', ejemplo: 'TODAS', ayuda: 'TODAS, PRINCIPAL o códigos (o nombres) de sede separados por punto y coma.', validar: vSedes, ancho: 18 },
      { key: 'codigo', header: 'Código interno', tipo: 'texto', ejemplo: 'SV-USP', ayuda: 'Único por cliente.', ancho: 12 },
      { key: 'servicio', header: 'Servicio', requerido: true, tipo: 'texto', ejemplo: 'Mantenimiento de unidad sanitaria portátil', ayuda: '', ancho: 32 },
      { key: 'categoria', header: 'Categoría', requerido: true, tipo: 'codigo', catalogo: 'categorias', ejemplo: 'SERV', ayuda: '', ancho: 10 },
      { key: 'linea', header: 'Línea de servicio', requerido: true, tipo: 'codigo', catalogo: 'lineas', ejemplo: '12', ayuda: 'Código o nombre exacto de la línea; la unidad de negocio se deduce de ella.', ancho: 10 },
      { key: 'descripcion', header: 'Descripción del servicio', requerido: true, tipo: 'texto', ejemplo: 'Incluye 2 mantenimientos semanales', ayuda: 'Máximo 1.000 caracteres.', ancho: 30,
        validar: (v) => v.length > 1000 ? 'Máximo 1.000 caracteres.' : null },
      { key: 'frecuenciaDias', header: 'Frecuencia (días)', tipo: 'numero', ejemplo: 7, ayuda: 'Cada cuántos días se presta (1 a 366).', ancho: 10,
        validar: (v) => v && !(Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 366) ? 'Entero entre 1 y 366.' : null },
      { key: 'progAuto', header: 'Solicitud automática', tipo: 'si_no', opciones: L.siNo, ejemplo: 'Sí', ayuda: 'Crea la solicitud cada «Frecuencia (días)». Exige la frecuencia.', ancho: 12,
        validar: (v, f) => si(v) && !f.frecuenciaDias ? 'Indique la frecuencia en días.' : null },
      { key: 'cantidad', header: 'Cantidad por frecuencia', tipo: 'numero', ejemplo: 12, ayuda: '', ancho: 12,
        validar: (v) => v && Number(v.replace(',', '.')) <= 0 ? 'Debe ser mayor que cero.' : null },
      { key: 'metrica', header: 'Métrica del precio', tipo: 'codigo', catalogo: 'metricasPrecio', ejemplo: 'und', ayuda: 'Vacío = precio global por servicio.', ancho: 10 },
      { key: 'precio', header: 'Precio unitario', tipo: 'numero', ejemplo: 420000, ayuda: 'COP, sin IVA.', ancho: 12,
        validar: (v) => v && Number(v.replace(',', '.')) < 0 ? 'El precio no puede ser negativo.' : null },
      { key: 'responsabilidad', header: 'Responsabilidad aceptada', requerido: true, tipo: 'si_no', opciones: L.siNo, ejemplo: 'Sí', ayuda: 'Confirma que el cliente firmó la declaración de veracidad de la información.', ancho: 12,
        validar: (v) => v && !si(v) ? 'El cliente debe aceptar la declaración de responsabilidad.' : null },
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
      { key: 'desde', header: 'Vigente desde', requerido: true, tipo: 'fecha', ejemplo: '2027-01-01', ayuda: 'AAAA-MM-DD, desde hoy o una fecha futura', ancho: 14,
        validar: (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) && v < hoyColombia() ? 'Rige desde hoy o una fecha futura: un precio que ya pudo facturarse no se cambia.' : null) },
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

// ---------------- Portal de clientes ----------------
/** Columnas que el cliente no llena en su portal: el NIT es el de su empresa (lo pone el sistema) y el precio lo fija Terra Viva. */
const SOLO_OFICINA = new Set(['nit', 'metrica', 'precio']);
/**
 * Plantillas del cargue de declaraciones desde el portal de clientes: las mismas de la oficina, con las mismas reglas,
 * sin NIT ni precio. Lo que el cliente carga queda en revisión: Terra Viva fija la tarifa y lo autoriza.
 */
export const PLANTILLAS_PORTAL: Plantilla[] = PLANTILLAS.filter((p) => p.id === 'decl-residuos' || p.id === 'decl-servicios').map((p) => ({
  ...p,
  archivo: p.archivo.replace('TV_plantilla_', 'TV_portal_'),
  descripcion: p.id === 'decl-residuos'
    ? 'Los residuos que su empresa entrega a Terra Viva y en qué sedes. Quedan en revisión: Terra Viva fija la tarifa y los autoriza.'
    : 'Los servicios que su empresa contrata con Terra Viva (unidades sanitarias, lavado de tanques, fumigación…) y en qué sedes. Quedan en revisión.',
  llave: p.llave.filter((k) => !SOLO_OFICINA.has(k)),
  columnas: p.columnas.filter((c) => !SOLO_OFICINA.has(c.key)).map((c) => (c.key === 'cantidad' ? { ...c, ayuda: 'Cantidad aproximada en cada servicio.' } : c)),
}));
export const plantillaPortal = (id: string) => PLANTILLAS_PORTAL.find((p) => p.id === id);

// ---------------- Lectura de archivos (Excel o CSV) ----------------
/** Encabezado comparable con el de la plantilla: sin «*», tildes, mayúsculas ni espacios de más. */
export const limpiarEncabezado = (s: string) => s.replace(/\*/g, '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Clave de la plantilla para cada columna del archivo (undefined si no es de la plantilla) y las obligatorias que faltan. */
export function mapearEncabezados(p: Plantilla, encabezados: string[]): { claves: (string | undefined)[]; faltantes: string[] } {
  const claves = encabezados.map((h) => p.columnas.find((c) => limpiarEncabezado(c.header) === limpiarEncabezado(h ?? ''))?.key);
  return { claves, faltantes: p.columnas.filter((c) => c.requerido && !claves.includes(c.key)).map((c) => c.header) };
}

/** Fila del archivo → {clave: texto}, con su número en «__fila». Null si está vacía o es la fila de ejemplo («EJEMPLO …»). */
export function filaLeida(p: Plantilla, valores: [string | undefined, string][], n: number): Record<string, string> | null {
  const f: Record<string, string> = {};
  let vacia = true;
  for (const [clave, valor] of valores) {
    if (!clave) continue;
    const v = valor.trim();
    if (v) vacia = false;
    f[clave] = v;
  }
  if (vacia || (f[p.columnas[0].key] ?? '').toUpperCase().startsWith('EJEMPLO')) return null;
  return { ...f, __fila: String(n) };
}

// ---------------- Validación de filas ----------------
export interface FilaValidada { n: number; datos: Record<string, string>; errores: string[]; advertencias: string[] }

/**
 * Interpreta un valor de una columna de catálogo (documentos reales, planilla DMR):
 * - el código tal cual («09», «BIO»);
 * - el nombre exacto, sin importar mayúsculas ni tildes («Servicios especiales de gestión y limpieza»), si no es ambiguo;
 * - en corrientes Y y códigos A, una subcorriente del IDEAM («Y9.1») cuya corriente exista: se registra al guardar.
 * Devuelve el código del catálogo (o la subcorriente) y, si aplica, un aviso o el error.
 */
export function resolverCodigo(catalogo: ClaveCatalogo, valor: string, ctx: Pick<Contexto, 'catalogos' | 'nombres'>): { codigo?: string; aviso?: string; error?: string } {
  const x = valor.trim(); const X = x.toUpperCase();
  if (ctx.catalogos[catalogo].has(X)) return { codigo: X };
  if (catalogo === 'corrientesY' || catalogo === 'codigosA') {
    if (/^UN\d{4}$/.test(X)) return { error: `"${x}" es un número UN: va en la columna «Código UN».` };
    const padre = corrienteDe(X);
    if (padre && ctx.catalogos[catalogo].has(padre)) return { codigo: X, aviso: `"${x}" es una subcorriente de ${padre}: si aún no existe, se registrará.` };
    return { error: `"${x}" no existe en el catálogo.` };
  }
  const cods = ctx.nombres?.[catalogo]?.get(norm(x)) ?? [];
  if (cods.length === 1) return { codigo: cods[0], aviso: `"${x}" se tomó como el código ${cods[0]}.` };
  if (cods.length > 1) return { error: `"${x}" coincide con varios códigos (${cods.join(', ')}): escriba el código.` };
  return { error: `"${x}" no existe en el catálogo.` };
}

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
        if (c.tipo === 'codigo' && c.catalogo) {
          const valores = c.multiple ? lista(v) : [v];
          if (!c.multiple && v.includes(';')) errores.push(`${c.header}: admite un solo código.`);
          else for (const x of valores) {
            const r = resolverCodigo(c.catalogo, x, ctx);
            if (r.error) errores.push(`${c.header}: ${r.error}`);
            if (r.aviso) advertencias.push(`${c.header}: ${r.aviso}`);
          }
        }
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
