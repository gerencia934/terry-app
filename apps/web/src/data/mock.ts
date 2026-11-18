// Datos de demostración. Servicios, permisos, planta e infraestructura tomados del
// portafolio de Terra Viva S.A.S. E.S.P.; clientes, personas, placas y cifras son ficticios.
// En producción esta capa se reemplaza por llamadas al API (ver src/lib/api.ts).

export const HOY = '2026-11-18';

export type EstadoDecl = 'AUTORIZADA' | 'PENDIENTE' | 'RECHAZADA' | 'INACTIVA' | 'BORRADOR';
export type Negociacion = 'COBRO' | 'COMPRA' | 'SIN_COSTO';
export type FormaPago = 'CONTADO' | 'CREDITO_30' | 'CREDITO_60';

export const EMPRESA = {
  razonSocial: 'Terra Viva S.A.S. E.S.P.',
  oficina: 'Edificio Millennium Business Tower, Cl 36 #27-71, Of. 915, Bucaramanga',
  planta: 'Parque de Saneamiento Ambiental Los Pinos — km 7.5 vía antigua Aprisa, vereda Villa de Leyva, Sabana de Torres',
  telefonos: ['310 556 0885', '310 556 2995', '318 260 5701'],
  certificaciones: ['ISO 9001', 'ISO 14001', 'ISO 45001', 'NORSOK S-006'],
};

// ---------------- Permisos ambientales (portafolio, p. 21) ----------------
export interface PermisoAmbiental {
  id: string; acto: string; autoridad: string; alcance: string; manejos: string[];
  proximaObligacion: { descripcion: string; fecha: string };
}
export const PERMISOS: PermisoAmbiental[] = [
  { id: 'p1', acto: 'Resolución 0235-2024', autoridad: 'CAS', alcance: 'Disposición final de residuos de construcción y demolición (RCD) — escombrera', manejos: ['ESC'],
    proximaObligacion: { descripcion: 'Informe semestral de volúmenes recibidos en escombrera', fecha: '2026-12-15' } },
  { id: 'p2', acto: 'Resolución 0632-2023', autoridad: 'CAS', alcance: 'Vertimientos a suelo y manejo de aguas residuales industriales, domésticas y lodos', manejos: ['BIO', 'ASP', 'FQ'],
    proximaObligacion: { descripcion: 'Caracterización semestral del vertimiento a suelo (laboratorio acreditado IDEAM)', fecha: '2026-11-30' } },
  { id: 'p3', acto: 'Auto SAA No. 0244-21', autoridad: 'CAS', alcance: 'Plan de contingencia para transporte de hidrocarburos, derivados y residuos peligrosos', manejos: ['TRANS'],
    proximaObligacion: { descripcion: 'Simulacro anual del plan de contingencia y reporte', fecha: '2026-12-05' } },
  { id: 'p4', acto: 'OF-311-21', autoridad: 'CAS', alcance: 'Gestión de aceite de cocina usado', manejos: ['ACU'],
    proximaObligacion: { descripcion: 'Reporte trimestral de volúmenes de ACU gestionados', fecha: '2027-01-10' } },
];

// ---------------- Catálogos operativos ----------------
export const LINEAS = [
  'RESPEL', 'Ordinarios', 'Aprovechables', 'RAEE', 'Aceite usado de motor', 'RCD', 'Hospitalarios y biomédicos',
  'ARD', 'ARnD', 'Lodos', 'Unidades sanitarias portátiles', 'Lavado de tanques', 'Manejo integrado de plagas', 'Paisajismo',
];

export interface TipoManejo { codigo: string; nombre: string; propio: boolean }
export const MANEJOS: TipoManejo[] = [
  { codigo: 'BIO', nombre: 'Biorremediación (landfarming)', propio: true },
  { codigo: 'ASP', nombre: 'Aspersión / vertimiento a suelo', propio: true },
  { codigo: 'FQ', nombre: 'Tratamiento fisicoquímico en piscinas', propio: true },
  { codigo: 'ESC', nombre: 'Disposición en escombrera', propio: true },
  { codigo: 'APR', nombre: 'Aprovechamiento / valorización', propio: true },
  { codigo: 'ACU', nombre: 'Gestión de aceite de cocina usado', propio: true },
  { codigo: 'INC', nombre: 'Incineración (gestor aliado)', propio: false },
  { codigo: 'REG', nombre: 'Regeneración de aceite (gestor aliado)', propio: false },
  { codigo: 'CEL', nombre: 'Celda de seguridad (gestor aliado)', propio: false },
  { codigo: 'DES', nombre: 'Desensamble RAEE (gestor aliado)', propio: false },
  { codigo: 'SRV', nombre: 'Servicio en sitio', propio: true },
];
export const manejo = (c: string) => MANEJOS.find((m) => m.codigo === c)!;

export interface ItemCatalogo {
  id: string; tipo: 'RESIDUO' | 'SERVICIO'; codigo: string; nombre: string; linea: string;
  corriente?: string; peligrosidad: string[]; onu?: string; unidad: 'KG' | 'M3' | 'GAL' | 'UND' | 'SERVICIO'; manejo: string;
}
export const CATALOGO: ItemCatalogo[] = [
  { id: 'r1', tipo: 'RESIDUO', codigo: 'RP-008', nombre: 'Aceite usado de motor', linea: 'Aceite usado de motor', corriente: 'Y8', peligrosidad: ['T', 'I'], onu: '1270', unidad: 'GAL', manejo: 'REG' },
  { id: 'r2', tipo: 'RESIDUO', codigo: 'RP-009', nombre: 'Sólidos contaminados con hidrocarburos (trapos, estopas, EPP)', linea: 'RESPEL', corriente: 'Y9', peligrosidad: ['T', 'I'], onu: '3077', unidad: 'KG', manejo: 'BIO' },
  { id: 'r3', tipo: 'RESIDUO', codigo: 'RP-018', nombre: 'Lodos aceitosos de trampa de grasas / separador API', linea: 'Lodos', corriente: 'Y18', peligrosidad: ['T'], unidad: 'KG', manejo: 'BIO' },
  { id: 'r4', tipo: 'RESIDUO', codigo: 'RP-029', nombre: 'Luminarias con mercurio', linea: 'RESPEL', corriente: 'Y29', peligrosidad: ['T'], onu: '3506', unidad: 'UND', manejo: 'CEL' },
  { id: 'r5', tipo: 'RESIDUO', codigo: 'RP-160', nombre: 'Baterías plomo-ácido', linea: 'RESPEL', corriente: 'A1160', peligrosidad: ['C', 'T'], onu: '2794', unidad: 'KG', manejo: 'APR' },
  { id: 'r6', tipo: 'RESIDUO', codigo: 'RH-001', nombre: 'Biosanitarios (bolsa roja)', linea: 'Hospitalarios y biomédicos', corriente: 'Y1', peligrosidad: ['B'], onu: '3291', unidad: 'KG', manejo: 'INC' },
  { id: 'r7', tipo: 'RESIDUO', codigo: 'RH-002', nombre: 'Cortopunzantes', linea: 'Hospitalarios y biomédicos', corriente: 'Y1', peligrosidad: ['B'], onu: '3291', unidad: 'KG', manejo: 'INC' },
  { id: 'r8', tipo: 'RESIDUO', codigo: 'RE-180', nombre: 'RAEE — equipos de cómputo y periféricos', linea: 'RAEE', corriente: 'A1180', peligrosidad: ['T'], unidad: 'KG', manejo: 'DES' },
  { id: 'r9', tipo: 'RESIDUO', codigo: 'RA-010', nombre: 'Cartón y papel aprovechable', linea: 'Aprovechables', peligrosidad: [], unidad: 'KG', manejo: 'APR' },
  { id: 'r10', tipo: 'RESIDUO', codigo: 'RA-020', nombre: 'Plástico PET y PEAD', linea: 'Aprovechables', peligrosidad: [], unidad: 'KG', manejo: 'APR' },
  { id: 'r11', tipo: 'RESIDUO', codigo: 'RA-030', nombre: 'Chatarra ferrosa', linea: 'Aprovechables', peligrosidad: [], unidad: 'KG', manejo: 'APR' },
  { id: 'r12', tipo: 'RESIDUO', codigo: 'RN-ACU', nombre: 'Aceite de cocina usado', linea: 'Aprovechables', peligrosidad: [], unidad: 'GAL', manejo: 'ACU' },
  { id: 'r13', tipo: 'RESIDUO', codigo: 'RC-001', nombre: 'Escombros de concreto y mampostería (RCD)', linea: 'RCD', peligrosidad: [], unidad: 'M3', manejo: 'ESC' },
  { id: 'r14', tipo: 'RESIDUO', codigo: 'RO-001', nombre: 'Residuos ordinarios no aprovechables', linea: 'Ordinarios', peligrosidad: [], unidad: 'KG', manejo: 'APR' },
  { id: 'r15', tipo: 'RESIDUO', codigo: 'AR-IND', nombre: 'Agua residual industrial (ARnD)', linea: 'ARnD', peligrosidad: ['T'], unidad: 'M3', manejo: 'FQ' },
  { id: 'r16', tipo: 'RESIDUO', codigo: 'AR-DOM', nombre: 'Agua residual doméstica (ARD) — pozo séptico', linea: 'ARD', peligrosidad: [], unidad: 'M3', manejo: 'ASP' },
  { id: 'r17', tipo: 'RESIDUO', codigo: 'LD-PTAR', nombre: 'Lodos orgánicos de PTAR', linea: 'Lodos', peligrosidad: [], unidad: 'KG', manejo: 'BIO' },
  { id: 's1', tipo: 'SERVICIO', codigo: 'SV-USP', nombre: 'Alquiler unidad sanitaria portátil (mensual)', linea: 'Unidades sanitarias portátiles', peligrosidad: [], unidad: 'UND', manejo: 'SRV' },
  { id: 's2', tipo: 'SERVICIO', codigo: 'SV-USPM', nombre: 'Mantenimiento y limpieza técnica USP', linea: 'Unidades sanitarias portátiles', peligrosidad: [], unidad: 'SERVICIO', manejo: 'SRV' },
  { id: 's3', tipo: 'SERVICIO', codigo: 'SV-TQ', nombre: 'Lavado y desinfección de tanque (espacio confinado)', linea: 'Lavado de tanques', peligrosidad: [], unidad: 'SERVICIO', manejo: 'SRV' },
  { id: 's4', tipo: 'SERVICIO', codigo: 'SV-MIP', nombre: 'Fumigación y control integrado de plagas', linea: 'Manejo integrado de plagas', peligrosidad: [], unidad: 'SERVICIO', manejo: 'SRV' },
  { id: 's5', tipo: 'SERVICIO', codigo: 'SV-PODA', nombre: 'Poda técnica en altura y manejo de residuo vegetal', linea: 'Paisajismo', peligrosidad: [], unidad: 'SERVICIO', manejo: 'SRV' },
  { id: 's6', tipo: 'SERVICIO', codigo: 'SV-VAC', nombre: 'Succión con equipo vactor (por hora)', linea: 'ARnD', peligrosidad: [], unidad: 'SERVICIO', manejo: 'SRV' },
];
export const item = (id: string) => CATALOGO.find((c) => c.id === id)!;

export const ZONAS = [
  { id: 'z1', nombre: 'Área Metropolitana BGA', color: '#2A78D6' },
  { id: 'z2', nombre: 'Magdalena Medio', color: '#EB6834' },
  { id: 'z3', nombre: 'Sabana – Lebrija', color: '#1BAF7A' },
  { id: 'z4', nombre: 'Provincia de Mares / Chucurí', color: '#EDA100' },
];
export const zona = (id: string) => ZONAS.find((z) => z.id === id)!;

export interface Cliente {
  id: string; nit: string; razonSocial: string; sector: string; negociacion: Negociacion; formaPago: FormaPago;
  sucursales: { id: string; nombre: string; municipio: string; zona: string; contacto: string; telefono: string }[];
}
export const CLIENTES: Cliente[] = [
  { id: 'c1', nit: '900.112.345-1', razonSocial: 'Agroindustrial La Esperanza S.A.S.', sector: 'Palma de aceite', negociacion: 'COBRO', formaPago: 'CREDITO_30',
    sucursales: [{ id: 'c1s1', nombre: 'Planta extractora', municipio: 'Puerto Wilches', zona: 'z2', contacto: 'Laura Méndez', telefono: '311 402 1188' },
                 { id: 'c1s2', nombre: 'Finca El Cedro', municipio: 'Sabana de Torres', zona: 'z3', contacto: 'Jairo Pinto', telefono: '312 551 0923' }] },
  { id: 'c2', nit: '901.223.456-7', razonSocial: 'Estación de Servicio El Cruce', sector: 'Combustibles', negociacion: 'COBRO', formaPago: 'CONTADO',
    sucursales: [{ id: 'c2s1', nombre: 'EDS Principal', municipio: 'Barrancabermeja', zona: 'z2', contacto: 'Óscar Ríos', telefono: '315 330 7712' }] },
  { id: 'c3', nit: '804.009.876-2', razonSocial: 'Clínica Santa Lucía del Oriente', sector: 'Salud', negociacion: 'COBRO', formaPago: 'CREDITO_60',
    sucursales: [{ id: 'c3s1', nombre: 'Sede Cabecera', municipio: 'Bucaramanga', zona: 'z1', contacto: 'Adriana Rueda', telefono: '317 228 4410' },
                 { id: 'c3s2', nombre: 'Sede Cañaveral', municipio: 'Floridablanca', zona: 'z1', contacto: 'Diana Celis', telefono: '310 884 2019' }] },
  { id: 'c4', nit: '900.778.123-4', razonSocial: 'Constructora Altos del Norte S.A.S.', sector: 'Construcción', negociacion: 'COBRO', formaPago: 'CREDITO_30',
    sucursales: [{ id: 'c4s1', nombre: 'Obra Torres del Parque', municipio: 'Girón', zona: 'z1', contacto: 'Ing. Mauricio Plata', telefono: '318 776 1203' }] },
  { id: 'c5', nit: '890.204.556-9', razonSocial: 'Lácteos del Oriente S.A.S.', sector: 'Alimentos', negociacion: 'COBRO', formaPago: 'CREDITO_30',
    sucursales: [{ id: 'c5s1', nombre: 'Planta de procesamiento', municipio: 'Lebrija', zona: 'z3', contacto: 'Sandra Vega', telefono: '314 600 2231' }] },
  { id: 'c6', nit: '901.445.890-3', razonSocial: 'Transportes Magdalena Medio Ltda.', sector: 'Transporte de carga', negociacion: 'COBRO', formaPago: 'CONTADO',
    sucursales: [{ id: 'c6s1', nombre: 'Taller y patio', municipio: 'Barrancabermeja', zona: 'z2', contacto: 'Hernán Duarte', telefono: '313 509 8820' }] },
  { id: 'c7', nit: '900.556.012-8', razonSocial: 'Recuperadora Ecociclo S.A.S.', sector: 'Reciclaje', negociacion: 'COMPRA', formaPago: 'CONTADO',
    sucursales: [{ id: 'c7s1', nombre: 'Centro de acopio', municipio: 'Bucaramanga', zona: 'z1', contacto: 'Luis Ardila', telefono: '316 120 4478' }] },
  { id: 'c8', nit: '901.667.334-0', razonSocial: 'Campo Petrolero Las Monas (operador)', sector: 'Hidrocarburos', negociacion: 'COBRO', formaPago: 'CREDITO_60',
    sucursales: [{ id: 'c8s1', nombre: 'Clúster 4', municipio: 'San Vicente de Chucurí', zona: 'z4', contacto: 'Ing. Paola Serrano', telefono: '312 908 3341' }] },
  { id: 'c9', nit: '900.889.221-5', razonSocial: 'Hotel Campestre Los Guaduales', sector: 'Turismo', negociacion: 'COBRO', formaPago: 'CONTADO',
    sucursales: [{ id: 'c9s1', nombre: 'Sede única', municipio: 'Piedecuesta', zona: 'z1', contacto: 'Marcela Ortiz', telefono: '311 732 5560' }] },
  { id: 'c10', nit: '800.334.778-6', razonSocial: 'Colegio Nuevo Horizonte', sector: 'Educación', negociacion: 'SIN_COSTO', formaPago: 'CONTADO',
    sucursales: [{ id: 'c10s1', nombre: 'Campus Lagos', municipio: 'Floridablanca', zona: 'z1', contacto: 'Rector Álvaro Gómez', telefono: '315 442 9087' }] },
];
export const cliente = (id: string) => CLIENTES.find((c) => c.id === id)!;
export const sucursal = (id: string) => CLIENTES.flatMap((c) => c.sucursales).find((s) => s.id === id)!;

// ---------------- Declaraciones ----------------
export interface Declaracion {
  id: string; numero: number; tipo: 'RESIDUO' | 'SERVICIO'; clienteId: string; sucursalId: string; itemId: string;
  estado: EstadoDecl; autorizacion?: string; causal?: string; cantidad: number; frecuencia: string;
  destino: string; embalaje: string; precio: number; negociacion: Negociacion; formaPago: FormaPago;
}
const D = (numero: number, clienteId: string, sucursalId: string, itemId: string, estado: EstadoDecl, cantidad: number,
  frecuencia: string, embalaje: string, precio: number, extra: Partial<Declaracion> = {}): Declaracion => {
  const it = item(itemId); const cl = cliente(clienteId); const m = manejo(it.manejo);
  return {
    id: `d${numero}`, numero, tipo: it.tipo, clienteId, sucursalId, itemId, estado, cantidad, frecuencia, embalaje, precio,
    autorizacion: estado === 'AUTORIZADA' ? `AUT-${2026}-${String(numero).padStart(4, '0')}` : undefined,
    destino: m.propio ? 'PSA Los Pinos (propio)' : 'Gestor aliado licenciado',
    negociacion: it.linea === 'Aprovechables' && cl.negociacion === 'COMPRA' ? 'COMPRA' : cl.negociacion,
    formaPago: cl.formaPago, ...extra,
  };
};
export const DECLARACIONES: Declaracion[] = [
  D(1001, 'c1', 'c1s1', 'r3', 'AUTORIZADA', 8000, 'Mensual', 'Big bag 1 m³', 780),
  D(1002, 'c1', 'c1s1', 'r2', 'AUTORIZADA', 1200, 'Mensual', 'Bolsa roja calibre 2', 1650),
  D(1003, 'c1', 'c1s2', 'r16', 'AUTORIZADA', 24, 'Quincenal', 'Carrotanque', 95000),
  D(1004, 'c1', 'c1s1', 'r1', 'AUTORIZADA', 300, 'Mensual', 'Caneca 55 gal', 0, { negociacion: 'SIN_COSTO' }),
  D(1005, 'c2', 'c2s1', 'r1', 'AUTORIZADA', 450, 'Mensual', 'Caneca 55 gal', 0, { negociacion: 'SIN_COSTO' }),
  D(1006, 'c2', 'c2s1', 'r3', 'AUTORIZADA', 900, 'Mensual', 'Caneca 55 gal', 920),
  D(1007, 'c2', 'c2s1', 'r2', 'PENDIENTE', 250, 'Mensual', 'Bolsa roja calibre 2', 1700),
  D(1008, 'c3', 'c3s1', 'r6', 'AUTORIZADA', 1800, 'Semanal', 'Bolsa roja + guardián', 3200),
  D(1009, 'c3', 'c3s1', 'r7', 'AUTORIZADA', 120, 'Semanal', 'Guardián rígido', 3900),
  D(1010, 'c3', 'c3s2', 'r6', 'AUTORIZADA', 700, 'Semanal', 'Bolsa roja + guardián', 3200),
  D(1011, 'c3', 'c3s1', 'r4', 'RECHAZADA', 60, 'Eventual', 'Caja original', 5200, { causal: 'Ficha de seguridad incompleta' }),
  D(1012, 'c4', 'c4s1', 'r13', 'AUTORIZADA', 140, 'Semanal', 'Volqueta 14 m³', 38000),
  D(1013, 'c4', 'c4s1', 's1', 'AUTORIZADA', 12, 'Mensual', 'N/A', 420000),
  D(1014, 'c4', 'c4s1', 's2', 'AUTORIZADA', 48, 'Semanal', 'N/A', 45000),
  D(1015, 'c5', 'c5s1', 'r15', 'AUTORIZADA', 60, 'Semanal', 'Carrotanque', 165000),
  D(1016, 'c5', 'c5s1', 'r17', 'AUTORIZADA', 3500, 'Quincenal', 'Big bag 1 m³', 420),
  D(1017, 'c5', 'c5s1', 's4', 'PENDIENTE', 1, 'Mensual', 'N/A', 680000),
  D(1018, 'c6', 'c6s1', 'r1', 'AUTORIZADA', 600, 'Quincenal', 'Caneca 55 gal', 0, { negociacion: 'SIN_COSTO' }),
  D(1019, 'c6', 'c6s1', 'r5', 'AUTORIZADA', 400, 'Mensual', 'Estiba plastificada', 0, { negociacion: 'SIN_COSTO' }),
  D(1020, 'c6', 'c6s1', 'r2', 'AUTORIZADA', 500, 'Mensual', 'Bolsa roja calibre 2', 1650),
  D(1021, 'c7', 'c7s1', 'r9', 'AUTORIZADA', 6000, 'Semanal', 'Paca', 350),
  D(1022, 'c7', 'c7s1', 'r10', 'AUTORIZADA', 2500, 'Semanal', 'Lona', 900),
  D(1023, 'c7', 'c7s1', 'r11', 'AUTORIZADA', 4000, 'Quincenal', 'A granel', 620),
  D(1024, 'c8', 'c8s1', 'r3', 'AUTORIZADA', 15000, 'Semanal', 'Volqueta carpada', 690),
  D(1025, 'c8', 'c8s1', 'r15', 'AUTORIZADA', 180, 'Semanal', 'Carrotanque', 148000),
  D(1026, 'c8', 'c8s1', 's3', 'PENDIENTE', 2, 'Eventual', 'N/A', 3800000),
  D(1027, 'c8', 'c8s1', 's6', 'AUTORIZADA', 40, 'Semanal', 'N/A', 260000),
  D(1028, 'c9', 'c9s1', 'r12', 'AUTORIZADA', 80, 'Mensual', 'Bidón 20 L', 0, { negociacion: 'SIN_COSTO' }),
  D(1029, 'c9', 'c9s1', 'r16', 'AUTORIZADA', 12, 'Mensual', 'Carrotanque', 98000),
  D(1030, 'c9', 'c9s1', 's5', 'BORRADOR', 1, 'Eventual', 'N/A', 1250000),
  D(1031, 'c10', 'c10s1', 'r8', 'AUTORIZADA', 350, 'Eventual', 'Estiba plastificada', 0),
  D(1032, 'c10', 'c10s1', 'r9', 'INACTIVA', 400, 'Mensual', 'Paca', 0, { causal: 'Cliente cambió de operador' }),
];

// ---------------- Flota y personal ----------------
export interface Vehiculo { id: string; placa: string; marca: string; tipo: string; capacidad: string; color: string; soat: string; rtm: string; polizaRc: string }
// Placas y marcas de la flota real (capturas de Grinclic). Tipos, capacidades y vencimientos son de demostración.
export const VEHICULOS: Vehiculo[] = [
  { id: 'v1', placa: 'USD855', marca: 'Chevrolet', tipo: 'Furgón RESPEL', capacidad: '3.500 kg', color: '#D92D20', soat: '2027-03-02', rtm: '2027-02-11', polizaRc: '2027-01-20' },
  { id: 'v2', placa: 'LPM482', marca: 'JMC', tipo: 'Furgón', capacidad: '2.000 kg', color: '#1E9BD7', soat: '2026-11-29', rtm: '2027-05-18', polizaRc: '2027-01-20' },
  { id: 'v3', placa: 'MDF180', marca: 'Chevrolet', tipo: 'Carrotanque / vactor', capacidad: '12 m³', color: '#F2790F', soat: '2027-06-30', rtm: '2026-12-08', polizaRc: '2027-01-20' },
  { id: 'v4', placa: 'DXY545', marca: 'Chevrolet', tipo: 'Volqueta', capacidad: '14 m³', color: '#1F8A3B', soat: '2027-04-14', rtm: '2027-04-14', polizaRc: '2027-01-20' },
  { id: 'v5', placa: 'UPS485', marca: 'Chevrolet', tipo: 'Camión estacas', capacidad: '5.000 kg', color: '#7A3FD1', soat: '2027-08-09', rtm: '2027-07-21', polizaRc: '2027-01-20' },
  { id: 'v6', placa: 'LPM490', marca: 'JMC', tipo: 'Furgón', capacidad: '2.000 kg', color: '#2F49C9', soat: '2027-05-11', rtm: '2027-05-11', polizaRc: '2027-01-20' },
];
export const vehiculo = (id: string) => VEHICULOS.find((v) => v.id === id)!;
export const vehLabel = (id: string) => { const v = vehiculo(id); return `${v.placa} ${v.marca.toUpperCase()}`; };

export interface Persona { id: string; nombre: string; rol: 'Conductor' | 'Auxiliar' | 'Coordinador logístico' | 'Director HSEQ' | 'Facturación' | 'Gerencia'; licenciaVence?: string; cursoMp?: string; email: string }
export const PERSONAS: Persona[] = [
  { id: 'u1', nombre: 'Wilson Carreño', rol: 'Conductor', licenciaVence: '2028-04-10', cursoMp: '2026-12-02', email: 'wcarreno@terravivasas.com' },
  { id: 'u2', nombre: 'Édgar Quintero', rol: 'Conductor', licenciaVence: '2027-09-30', cursoMp: '2027-06-15', email: 'equintero@terravivasas.com' },
  { id: 'u3', nombre: 'Fabián Rojas', rol: 'Conductor', licenciaVence: '2026-12-20', cursoMp: '2027-02-01', email: 'frojas@terravivasas.com' },
  { id: 'u4', nombre: 'Nelson Ardila', rol: 'Conductor', licenciaVence: '2029-01-12', cursoMp: '2027-03-22', email: 'nardila@terravivasas.com' },
  { id: 'u5', nombre: 'Yesid Galvis', rol: 'Auxiliar', email: 'ygalvis@terravivasas.com' },
  { id: 'u6', nombre: 'Camilo Pérez', rol: 'Auxiliar', email: 'cperez@terravivasas.com' },
  { id: 'u7', nombre: 'Jhon Fredy Mora', rol: 'Auxiliar', email: 'jmora@terravivasas.com' },
  { id: 'u8', nombre: 'Natalia Suárez', rol: 'Coordinador logístico', email: 'logistica@terravivasas.com' },
  { id: 'u9', nombre: 'Carolina Báez', rol: 'Director HSEQ', email: 'hseq@terravivasas.com' },
  { id: 'u10', nombre: 'Diego (Gerencia)', rol: 'Gerencia', email: 'gerencia@terravivasas.com' },
];
export const persona = (id?: string) => PERSONAS.find((p) => p.id === id);

// ---------------- Estados de recorrido (configurables) ----------------
export const ESTADOS_RUTA = [
  { id: 'e1', nombre: 'Programada', color: '#6B7A72', orden: 0, descripcion: 'Ruta creada, aún no inicia', rastreo: false },
  { id: 'e2', nombre: 'En camino', color: '#E5B800', orden: 1, descripcion: 'Reporta ubicación geográfica continuamente durante el recorrido', rastreo: true },
  { id: 'e3', nombre: 'En campo', color: '#1E9BD7', orden: 2, descripcion: 'Tripulación atendiendo al generador', rastreo: true },
  { id: 'e4', nombre: 'Finalizado', color: '#1F8A3B', orden: 3, descripcion: 'Descargado en planta', rastreo: true },
  { id: 'e5', nombre: 'Cancelado', color: '#D92D20', orden: 4, descripcion: 'Cancelado', rastreo: true },
];
export const estadoRuta = (id: string) => ESTADOS_RUTA.find((e) => e.id === id)!;

// ---------------- Solicitudes ----------------
export type EstadoSol = 'PENDIENTE' | 'PROGRAMADA' | 'RECOLECTADA' | 'CANCELADA';
export interface Solicitud {
  id: string; numero: number; clase: 'PRE' | 'FORMAL'; operacion: 'CARGA' | 'DESCARGA'; clienteId: string; sucursalId: string;
  fecha: string; franja: string; estado: EstadoSol; items: { declId: string; cantidad: number }[]; causal?: string;
}
const S = (numero: number, clase: 'PRE' | 'FORMAL', declIds: [string, number][], fecha: string, estado: EstadoSol, franja = '7:00–12:00', extra: Partial<Solicitud> = {}): Solicitud => {
  const d = DECLARACIONES.find((x) => x.id === declIds[0][0])!;
  return { id: `s${numero}`, numero, clase, operacion: 'CARGA', clienteId: d.clienteId, sucursalId: d.sucursalId, fecha, franja, estado,
    items: declIds.map(([declId, cantidad]) => ({ declId, cantidad })), ...extra };
};
export const SOLICITUDES: Solicitud[] = [
  S(5101, 'FORMAL', [['d1008', 420], ['d1009', 30]], '2026-11-04', 'RECOLECTADA'),
  S(5102, 'FORMAL', [['d1012', 42]], '2026-11-05', 'RECOLECTADA'),
  S(5103, 'FORMAL', [['d1024', 3800]], '2026-11-06', 'RECOLECTADA'),
  S(5104, 'FORMAL', [['d1015', 16]], '2026-11-06', 'RECOLECTADA', '13:00–17:00'),
  S(5105, 'FORMAL', [['d1005', 110], ['d1006', 220]], '2026-11-09', 'RECOLECTADA'),
  S(5106, 'FORMAL', [['d1001', 2100], ['d1002', 300]], '2026-11-10', 'RECOLECTADA'),
  S(5107, 'FORMAL', [['d1008', 450], ['d1010', 160]], '2026-11-11', 'RECOLECTADA'),
  S(5108, 'FORMAL', [['d1021', 1500], ['d1022', 600]], '2026-11-12', 'RECOLECTADA'),
  S(5109, 'FORMAL', [['d1029', 6]], '2026-11-13', 'CANCELADA', '7:00–12:00', { causal: 'Cliente no disponible en sitio' }),
  S(5110, 'FORMAL', [['d1025', 45], ['d1027', 8]], '2026-11-13', 'RECOLECTADA'),
  S(5111, 'FORMAL', [['d1018', 180], ['d1019', 140], ['d1020', 120]], '2026-11-17', 'RECOLECTADA'),
  S(5112, 'FORMAL', [['d1008', 410], ['d1009', 28]], '2026-11-18', 'PROGRAMADA'),
  S(5113, 'FORMAL', [['d1010', 170]], '2026-11-18', 'PROGRAMADA'),
  S(5114, 'FORMAL', [['d1012', 38]], '2026-11-18', 'PROGRAMADA'),
  S(5115, 'FORMAL', [['d1024', 4100]], '2026-11-18', 'PROGRAMADA'),
  S(5124, 'FORMAL', [['d1005', 130], ['d1006', 240]], '2026-11-18', 'PROGRAMADA', '7:00–10:00'),
  S(5125, 'FORMAL', [['d1020', 140], ['d1019', 90]], '2026-11-18', 'PROGRAMADA', '9:00–12:00'),
  S(5116, 'FORMAL', [['d1016', 1700], ['d1015', 14]], '2026-11-19', 'PROGRAMADA'),
  S(5117, 'FORMAL', [['d1021', 1400], ['d1023', 1900]], '2026-11-20', 'PENDIENTE'),
  S(5118, 'FORMAL', [['d1003', 12]], '2026-11-21', 'PENDIENTE', '13:00–17:00'),
  S(5119, 'FORMAL', [['d1013', 12], ['d1014', 12]], '2026-11-23', 'PENDIENTE'),
  S(5120, 'FORMAL', [['d1005', 120]], '2026-11-24', 'PENDIENTE'),
  S(5121, 'FORMAL', [['d1031', 350]], '2026-11-26', 'PENDIENTE', '8:00–10:00'),
  S(5122, 'FORMAL', [['d1008', 400], ['d1009', 26]], '2026-11-25', 'PENDIENTE'),
  S(5123, 'FORMAL', [['d1025', 50]], '2026-11-27', 'PENDIENTE'),
  S(6001, 'PRE', [['d1026', 1]], '2026-11-28', 'PENDIENTE', 'Por confirmar'),
  S(6002, 'PRE', [['d1017', 1]], '2026-11-30', 'PENDIENTE', 'Por confirmar'),
  S(6003, 'PRE', [['d1028', 60]], '2026-11-22', 'PENDIENTE', 'Por confirmar'),
  S(6004, 'PRE', [['d1007', 200]], '2026-12-02', 'PENDIENTE', 'Por confirmar'),
  S(6005, 'PRE', [['d1030', 1]], '2026-12-04', 'PENDIENTE', 'Por confirmar'),
];
export const decl = (id: string) => DECLARACIONES.find((d) => d.id === id)!;
export const totalSolicitud = (s: Solicitud) => s.items.reduce((a, i) => a + i.cantidad * decl(i.declId).precio, 0);

// ---------------- Rutas ----------------
export interface Ruta {
  id: string; codigo: string; fecha: string; zona: string; vehiculoId: string; conductorId: string; auxiliarId?: string;
  estadoId: string; solicitudes: string[]; salida?: string;
}
export const RUTAS: Ruta[] = [
  { id: 'rt1', codigo: 'R-1104-A', fecha: '2026-11-04', zona: 'z1', vehiculoId: 'v2', conductorId: 'u2', auxiliarId: 'u6', estadoId: 'e4', solicitudes: ['s5101'] },
  { id: 'rt2', codigo: 'R-1105-A', fecha: '2026-11-05', zona: 'z1', vehiculoId: 'v4', conductorId: 'u4', estadoId: 'e4', solicitudes: ['s5102'] },
  { id: 'rt3', codigo: 'R-1106-A', fecha: '2026-11-06', zona: 'z4', vehiculoId: 'v4', conductorId: 'u4', auxiliarId: 'u7', estadoId: 'e4', solicitudes: ['s5103'] },
  { id: 'rt4', codigo: 'R-1106-B', fecha: '2026-11-06', zona: 'z3', vehiculoId: 'v3', conductorId: 'u3', auxiliarId: 'u5', estadoId: 'e4', solicitudes: ['s5104'] },
  { id: 'rt5', codigo: 'R-1109-A', fecha: '2026-11-09', zona: 'z2', vehiculoId: 'v1', conductorId: 'u1', auxiliarId: 'u5', estadoId: 'e4', solicitudes: ['s5105'] },
  { id: 'rt6', codigo: 'R-1110-A', fecha: '2026-11-10', zona: 'z2', vehiculoId: 'v1', conductorId: 'u1', auxiliarId: 'u5', estadoId: 'e4', solicitudes: ['s5106'] },
  { id: 'rt7', codigo: 'R-1111-A', fecha: '2026-11-11', zona: 'z1', vehiculoId: 'v2', conductorId: 'u2', auxiliarId: 'u6', estadoId: 'e4', solicitudes: ['s5107'] },
  { id: 'rt8', codigo: 'R-1112-A', fecha: '2026-11-12', zona: 'z1', vehiculoId: 'v5', conductorId: 'u4', auxiliarId: 'u7', estadoId: 'e4', solicitudes: ['s5108'] },
  { id: 'rt9', codigo: 'R-1113-A', fecha: '2026-11-13', zona: 'z4', vehiculoId: 'v3', conductorId: 'u3', auxiliarId: 'u5', estadoId: 'e4', solicitudes: ['s5110'] },
  { id: 'rt10', codigo: 'R-1117-A', fecha: '2026-11-17', zona: 'z2', vehiculoId: 'v1', conductorId: 'u1', auxiliarId: 'u5', estadoId: 'e4', solicitudes: ['s5111'] },
  { id: 'rt11', codigo: 'R-1118-A', fecha: '2026-11-18', zona: 'z1', vehiculoId: 'v2', conductorId: 'u2', auxiliarId: 'u6', estadoId: 'e2', solicitudes: ['s5112', 's5113'], salida: '06:40' },
  { id: 'rt12', codigo: 'R-1118-B', fecha: '2026-11-18', zona: 'z1', vehiculoId: 'v4', conductorId: 'u4', estadoId: 'e3', solicitudes: ['s5114'], salida: '06:15' },
  { id: 'rt13', codigo: 'R-1118-C', fecha: '2026-11-18', zona: 'z2', vehiculoId: 'v1', conductorId: 'u1', auxiliarId: 'u5', estadoId: 'e1', solicitudes: ['s5124', 's5125', 's5115'] },
  { id: 'rt14', codigo: 'R-1119-A', fecha: '2026-11-19', zona: 'z3', vehiculoId: 'v3', conductorId: 'u3', auxiliarId: 'u7', estadoId: 'e1', solicitudes: ['s5116'] },
];

// ---------------- Preoperacionales ----------------
export const ELEMENTOS_CHEQUEO = [
  { grupo: 'Documentos', items: [['Licencia de conducción vigente', true], ['SOAT y revisión técnico-mecánica', true], ['Tarjeta de emergencia por residuo transportado', true], ['Plan de contingencia a bordo', true]] },
  { grupo: 'Vehículo', items: [['Frenos (servicio y emergencia)', true], ['Luces delanteras, traseras y direccionales', true], ['Llantas y repuesto', true], ['Niveles (aceite, refrigerante, líquido de frenos)', false], ['Pito y alarma de reversa', false]] },
  { grupo: 'Seguridad y rotulado', items: [['Rótulos UN y pictogramas NTC 1692', true], ['Kit de derrames completo', true], ['Extintor ABC cargado (2 und)', true], ['Botiquín y conos', false]] },
  { grupo: 'EPP de la tripulación', items: [['Overol, guantes de nitrilo y botas', true], ['Respirador con cartuchos vigentes', true], ['Casco y gafas', false]] },
] as const;

export interface Preop { id: string; vehiculoId: string; programada: string; real?: string; conductorId: string; auxiliarId?: string; aprobado?: boolean; observaciones: string }
export const PREOPS: Preop[] = [
  { id: 'po1', vehiculoId: 'v2', programada: '2026-11-18 06:00', real: '2026-11-18 06:12', conductorId: 'u2', auxiliarId: 'u6', aprobado: true, observaciones: 'Sin novedad' },
  { id: 'po2', vehiculoId: 'v4', programada: '2026-11-18 05:45', real: '2026-11-18 05:50', conductorId: 'u4', aprobado: true, observaciones: 'Carpa con desgaste leve, programar cambio' },
  { id: 'po3', vehiculoId: 'v1', programada: '2026-11-18 07:00', conductorId: 'u1', auxiliarId: 'u5', observaciones: 'Pendiente por diligenciar' },
  { id: 'po4', vehiculoId: 'v3', programada: '2026-11-17 06:00', real: '2026-11-17 06:30', conductorId: 'u3', auxiliarId: 'u5', aprobado: false, observaciones: 'Kit de derrames incompleto (faltan paños absorbentes). Ruta reprogramada.' },
  { id: 'po5', vehiculoId: 'v1', programada: '2026-11-17 06:00', real: '2026-11-17 06:05', conductorId: 'u1', auxiliarId: 'u5', aprobado: true, observaciones: 'Sin novedad' },
  { id: 'po6', vehiculoId: 'v5', programada: '2026-11-12 06:00', real: '2026-11-12 06:20', conductorId: 'u4', auxiliarId: 'u7', aprobado: true, observaciones: 'Sin novedad' },
  { id: 'po7', vehiculoId: 'v3', programada: '2026-11-13 05:30', real: '2026-11-13 05:41', conductorId: 'u3', auxiliarId: 'u5', aprobado: true, observaciones: 'Reposición kit de derrames verificada' },
];

// ---------------- Manifiestos y conciliaciones ----------------
export interface Manifiesto { id: string; numero: string; fecha: string; rutaId: string; solicitudId: string; vehiculoId: string; conductorId: string; estado: 'EMITIDO' | 'EN_TRANSITO' | 'RECIBIDO' | 'CERRADO'; rndc?: string }
export const MANIFIESTOS: Manifiesto[] = RUTAS.flatMap((r) => r.solicitudes.map((sid, i) => ({
  id: `m${r.id}${i}`, numero: `MT-${2400 + Number(sid.slice(1)) - 5100}`, fecha: r.fecha, rutaId: r.id, solicitudId: sid,
  vehiculoId: r.vehiculoId, conductorId: r.conductorId,
  estado: (r.estadoId === 'e4' ? 'CERRADO' : r.estadoId === 'e3' ? 'RECIBIDO' : r.estadoId === 'e2' ? 'EN_TRANSITO' : 'EMITIDO') as Manifiesto['estado'],
  rndc: r.estadoId === 'e1' ? undefined : `RNDC-${r.fecha.replace(/-/g, '')}${i}${r.vehiculoId.slice(1)}`,
})));

export interface LineaConciliacion { manifiesto: string; clienteId: string; itemId: string; unidad: string; origen: number; destino: number; justificacion?: string }
export const CONCILIACION: LineaConciliacion[] = [
  { manifiesto: 'MT-2401', clienteId: 'c3', itemId: 'r6', unidad: 'kg', origen: 420, destino: 416 },
  { manifiesto: 'MT-2401', clienteId: 'c3', itemId: 'r7', unidad: 'kg', origen: 30, destino: 30 },
  { manifiesto: 'MT-2402', clienteId: 'c4', itemId: 'r13', unidad: 'm³', origen: 42, destino: 42 },
  { manifiesto: 'MT-2403', clienteId: 'c8', itemId: 'r3', unidad: 'kg', origen: 3800, destino: 3655, justificacion: 'Pérdida de humedad en transporte (lodo con 18 % agua libre)' },
  { manifiesto: 'MT-2404', clienteId: 'c5', itemId: 'r15', unidad: 'm³', origen: 16, destino: 15.8 },
  { manifiesto: 'MT-2405', clienteId: 'c2', itemId: 'r1', unidad: 'gal', origen: 110, destino: 110 },
  { manifiesto: 'MT-2405', clienteId: 'c2', itemId: 'r3', unidad: 'kg', origen: 220, destino: 238 },
  { manifiesto: 'MT-2406', clienteId: 'c1', itemId: 'r3', unidad: 'kg', origen: 2100, destino: 2087 },
  { manifiesto: 'MT-2406', clienteId: 'c1', itemId: 'r2', unidad: 'kg', origen: 300, destino: 296 },
  { manifiesto: 'MT-2407', clienteId: 'c3', itemId: 'r6', unidad: 'kg', origen: 610, destino: 607 },
  { manifiesto: 'MT-2410', clienteId: 'c8', itemId: 'r15', unidad: 'm³', origen: 45, destino: 44.1 },
];

export const ACTAS = [
  { numero: 'AD-0388', tipo: 'Disposición final', clienteId: 'c8', periodo: 'Octubre 2026', estado: 'Emitida', destino: 'PSA Los Pinos (propio)' },
  { numero: 'AD-0389', tipo: 'Disposición final', clienteId: 'c3', periodo: 'Octubre 2026', estado: 'Emitida', destino: 'Gestor aliado licenciado' },
  { numero: 'AA-0112', tipo: 'Certificado de aprovechamiento', clienteId: 'c7', periodo: 'Octubre 2026', estado: 'Emitida', destino: 'PSA Los Pinos (propio)' },
  { numero: 'AC-0201', tipo: 'Conciliación', clienteId: 'c1', periodo: '1–15 nov 2026', estado: 'En revisión', destino: 'PSA Los Pinos (propio)' },
  { numero: 'AC-0202', tipo: 'Conciliación', clienteId: 'c2', periodo: '1–15 nov 2026', estado: 'Borrador', destino: 'PSA Los Pinos (propio)' },
];

// ---------------- Series para informes (12 meses) ----------------
export const MESES = ['Dic', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov'];
export const SERIE_MENSUAL = MESES.map((mes, i) => ({
  mes,
  servicios: [118, 104, 121, 133, 128, 141, 137, 149, 156, 152, 168, 97][i],
  facturado: [312, 276, 331, 358, 344, 392, 371, 405, 431, 419, 468, 274][i], // millones COP
  comprado: [21, 18, 22, 25, 24, 27, 26, 29, 31, 30, 33, 19][i],
  toneladas: [212, 188, 219, 241, 236, 255, 248, 266, 281, 275, 302, 171][i],
}));
export const DIST_MANEJO = [
  { nombre: 'Biorremediación', valor: 38 }, { nombre: 'Tratamiento fisicoquímico', valor: 21 },
  { nombre: 'Aprovechamiento', valor: 17 }, { nombre: 'Escombrera RCD', valor: 12 },
  { nombre: 'Gestor aliado', valor: 8 }, { nombre: 'Otros', valor: 4 },
];
export const CAUSALES_CANCELACION = [
  { nombre: 'Cliente no disponible', valor: 9 }, { nombre: 'Vehículo no apto (preop.)', valor: 4 },
  { nombre: 'Residuo sin embalar', valor: 6 }, { nombre: 'Clima / vía cerrada', valor: 3 },
];

// ---------------- Extensiones modelo Grinclic ----------------
/** Tipo de solicitud (Grinclic): carga directa, carga automática (por frecuencia) o descargue. */
export type TipoSolicitud = 'Carga directa' | 'Carga automática' | 'Descargue';
export const tipoSolicitud = (s: Solicitud): TipoSolicitud => {
  const it = item(decl(s.items[0].declId).itemId);
  if (it.linea === 'RCD' && s.numero % 2 === 0) return 'Descargue';
  return s.numero % 3 === 0 ? 'Carga automática' : 'Carga directa';
};
export const jornada = (s: Solicitud) => (s.franja.startsWith('13') || s.franja.startsWith('14') ? 'PM' : 'AM');
export const ordenCompra = (s: Solicitud) => (s.numero % 4 === 0 ? `OC-${4400 + (s.numero % 97)}` : '');
export const estadoGrinclic = (s: Solicitud) =>
  s.estado === 'CANCELADA' ? 'Descartada' : s.estado === 'PENDIENTE' ? (s.clase === 'PRE' ? 'No aprobado' : 'Pendiente') : 'Gestionado';

/** Rutas adicionales del mes para el calendario (demostración, determinísticas). */
const rnd = (seed: number) => { const x = Math.sin(seed * 9301 + 49297) * 233280; return x - Math.floor(x); };
const HORAS = ['6a', '7a', '7:30a', '8a', '9a', '10a', '1p', '2p', '3p'];
export const RUTAS_MES: Ruta[] = [...RUTAS];
for (let d = 1; d <= 30; d++) {
  const fecha = `2026-11-${String(d).padStart(2, '0')}`;
  const n = 1 + Math.floor(rnd(d) * 4);
  for (let k = 0; k < n; k++) {
    const v = VEHICULOS[Math.floor(rnd(d * 7 + k) * VEHICULOS.length)];
    if (RUTAS_MES.some((r) => r.fecha === fecha && r.vehiculoId === v.id)) continue;
    const sol = SOLICITUDES[Math.floor(rnd(d * 13 + k) * SOLICITUDES.length)];
    RUTAS_MES.push({
      id: `g${d}-${k}`, codigo: `R-11${String(d).padStart(2, '0')}-${String.fromCharCode(68 + k)}`, fecha,
      zona: ZONAS[Math.floor(rnd(d + k) * ZONAS.length)].id, vehiculoId: v.id,
      conductorId: ['u1', 'u2', 'u3', 'u4'][Math.floor(rnd(d * 3 + k) * 4)], auxiliarId: ['u5', 'u6', 'u7'][Math.floor(rnd(d * 5 + k) * 3)],
      estadoId: fecha < HOY ? (rnd(d + k * 11) > 0.93 ? 'e5' : 'e4') : fecha === HOY ? 'e2' : 'e1',
      solicitudes: [sol.id], salida: HORAS[Math.floor(rnd(d * 17 + k) * HORAS.length)],
    });
  }
}
export const horaRuta = (r: Ruta) => r.salida ?? HORAS[Number(r.id.replace(/\D/g, '')) % HORAS.length];

/** Datos del generador que pide Grinclic en la declaración (derivados del catálogo). */
export const extraDecl = (d: Declaracion) => {
  const it = item(d.itemId);
  const pel = it.peligrosidad.length > 0;
  return {
    activo: d.estado !== 'INACTIVA',
    estadoFisico: it.unidad === 'M3' || it.unidad === 'GAL' ? 'Líquido' : it.linea === 'Lodos' ? 'Semisólido / lodo' : 'Sólido',
    categoria: it.linea === 'Hospitalarios y biomédicos' ? 'Hospitalario / biosanitario' : pel ? 'Peligroso (RESPEL)' : it.linea === 'Aprovechables' ? 'Aprovechable' : ['RCD', 'RAEE'].includes(it.linea) ? 'Especial (RCD, RAEE, ACU)' : 'No peligroso',
    tipoResiduo: it.linea === 'Hospitalarios y biomédicos' ? 'Biológico' : it.linea === 'Aprovechables' ? 'Reciclable' : 'Industrial',
    unidadNegocio: ['ARD', 'ARnD'].includes(it.linea) ? 'Tratamiento de aguas' : it.tipo === 'SERVICIO' ? 'Servicios ambientales' : 'Gestión de residuos',
    peligroso: pel, inflamable: it.peligrosidad.includes('I'),
    corrienteY: it.corriente?.startsWith('Y') ? it.corriente : '', corrienteA: it.corriente?.startsWith('A') ? it.corriente : '',
    ficha: d.numero % 3 !== 0, observacion: d.causal ?? '',
    progAuto: d.frecuencia !== 'Eventual',
  };
};

export const INVENTARIO = [
  { bodega: 'PSA Los Pinos · Celda temporal RESPEL', itemId: 'r2', entradas: 4820, salidas: 3900, ingresoMasAntiguo: '2026-09-02' },
  { bodega: 'PSA Los Pinos · Celda temporal RESPEL', itemId: 'r4', entradas: 310, salidas: 0, ingresoMasAntiguo: '2026-03-14' },
  { bodega: 'PSA Los Pinos · Celda temporal RESPEL', itemId: 'r5', entradas: 2600, salidas: 2100, ingresoMasAntiguo: '2026-10-21' },
  { bodega: 'PSA Los Pinos · Acopio aprovechables', itemId: 'r9', entradas: 18200, salidas: 15400, ingresoMasAntiguo: '2026-11-03' },
  { bodega: 'PSA Los Pinos · Acopio aprovechables', itemId: 'r10', entradas: 7600, salidas: 6900, ingresoMasAntiguo: '2026-10-28' },
  { bodega: 'PSA Los Pinos · Acopio aprovechables', itemId: 'r11', entradas: 9100, salidas: 4000, ingresoMasAntiguo: '2026-08-19' },
  { bodega: 'PSA Los Pinos · Tanque ACU', itemId: 'r12', entradas: 640, salidas: 480, ingresoMasAntiguo: '2026-10-05' },
  { bodega: 'Bodega Bucaramanga · RAEE', itemId: 'r8', entradas: 1250, salidas: 900, ingresoMasAntiguo: '2026-06-30' },
];
