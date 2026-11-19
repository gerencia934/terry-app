// Estado y reglas del formulario de 8 secciones (fase B de Declaraciones).
// La validación es la misma del API: EsquemaDeclaracion (packages/shared). Aquí solo se convierte lo que se escribe en
// pantalla (textos) a lo que espera el API, y cada mensaje se ubica en su campo y en su sección.
import { EsquemaDeclaracion, type DeclaracionEntrada, type FORMAS_PAGO, type NEGOCIACIONES } from '@terraviva/shared';

type Negociacion = (typeof NEGOCIACIONES)[number];
type FormaPago = (typeof FORMAS_PAGO)[number];

export type Tipo = 'RESIDUO' | 'SERVICIO';
export type SiNo = '' | 'si' | 'no';
export type Alcance = 'TODAS' | 'PRINCIPAL' | 'SELECCION';

export interface FormDecl {
  tipo: Tipo;
  // [1] Generador
  clienteId: string; alcanceSedes: Alcance; sucursalIds: string[];
  // [2] Datos específicos
  nombre: string; codigoInterno: string; catalogoId: string; categoriaId: string; tipoResiduoId: string; lineaServicioId: string;
  esPeligroso: boolean; frecuenciaDias: string; cantidadFrecuencia: string; solicitudAutomatica: boolean;
  etiquetadoIds: string[]; codigoAId: string; codigoYId: string; codigoUn: string; riesgoIds: string[];
  descripcionProceso: string; composicion: string; descripcionServicio: string;
  // [3] Embalaje
  tipoEmbalajeId: string; otroTipoEmbalaje: string; presentacion: string; materialEmbalajeId: string; otroMaterial: string; tipoSellado: string;
  // [4] Fisicoquímicas
  estadoFisico: '' | 'SOLIDO' | 'SEMISOLIDO' | 'LIQUIDO' | 'GASEOSO'; inflamable: SiNo; controladaEstupefacientes: SiNo;
  color: string; olor: string; densidad: string; metricaDensidadId: string; contieneHidrocarburos: SiNo;
  // [5] Disposición
  disposiciones: { disposicionId: string; principal: boolean }[];
  // [6] Adicional
  datosExtras: string; fichaSeguridadUrl: string; caracterizacionUrl: string; serial: string;
  // [7] Precio (vacío = sin precio todavía)
  precio: string; metricaId: string; tipoNegociacion: string; formaPago: string; mostrarPrecioApp: boolean;
  // [8] Estado
  vigenteHasta: string; observaciones: string; responsabilidadAceptada: boolean;
}

export const formVacio = (tipo: Tipo = 'RESIDUO'): FormDecl => ({
  tipo, clienteId: '', alcanceSedes: 'TODAS', sucursalIds: [],
  nombre: '', codigoInterno: '', catalogoId: '', categoriaId: '', tipoResiduoId: '', lineaServicioId: '',
  esPeligroso: false, frecuenciaDias: '', cantidadFrecuencia: '', solicitudAutomatica: false,
  etiquetadoIds: [], codigoAId: '', codigoYId: '', codigoUn: '', riesgoIds: [], descripcionProceso: '', composicion: '', descripcionServicio: '',
  tipoEmbalajeId: '', otroTipoEmbalaje: '', presentacion: '', materialEmbalajeId: '', otroMaterial: '', tipoSellado: '',
  estadoFisico: '', inflamable: '', controladaEstupefacientes: '', color: '', olor: '', densidad: '', metricaDensidadId: '', contieneHidrocarburos: 'no',
  disposiciones: [], datosExtras: '', fichaSeguridadUrl: '', caracterizacionUrl: '', serial: '',
  precio: '', metricaId: '', tipoNegociacion: '', formaPago: '', mostrarPrecioApp: false,
  vigenteHasta: '', observaciones: '', responsabilidadAceptada: false,
});

/** Lo que devuelve GET /declaraciones/:id (solo lo que usa el formulario). */
export interface DetalleDecl {
  id: string; numero: number; tipo: Tipo; estado: 'BORRADOR' | 'PENDIENTE' | 'AUTORIZADA' | 'RECHAZADA' | 'ANULADA'; activa: boolean; origenFase1: boolean;
  clienteId: string; cliente: { id: string; razonSocial: string; nit: string; tipo?: 'DIRECTO' | 'GESTOR' }; alcanceSedes: Alcance;
  sucursales: { activa: boolean; sucursal: { id: string; codigo: string | null; nombre: string } }[];
  nombre: string; codigoInterno: string | null; catalogoId: string | null; categoriaId: string; tipoResiduoId: string | null; lineaServicioId: string;
  esPeligroso: boolean; frecuenciaDias: number | null; cantidadFrecuencia: string | null; solicitudAutomatica: boolean;
  etiquetados: { sistemaId: string }[]; codigoAId: string | null; codigoYId: string | null; codigoUn: string | null; riesgos: { riesgoId: string }[];
  descripcionProceso: string | null; composicion: string | null; descripcionServicio: string | null;
  tipoEmbalajeId: string | null; otroTipoEmbalaje: string | null; presentacion: string | null; materialEmbalajeId: string | null; otroMaterial: string | null; tipoSellado: string | null;
  estadoFisico: FormDecl['estadoFisico'] | null; inflamable: boolean | null; controladaEstupefacientes: boolean | null;
  color: string | null; olor: string | null; densidad: string | null; metricaDensidadId: string | null; contieneHidrocarburos: boolean;
  disposiciones: { principal: boolean; disposicion: { id: string; codigo: string; nombre: string } }[];
  datosExtras: string | null; fichaSeguridadUrl: string | null; caracterizacionUrl: string | null; serial: string | null; mostrarPrecioApp: boolean;
  vigenteHasta: string | null; observaciones: string | null; responsabilidadAceptada: boolean; aceptadaEn: string | null;
  aceptadaPor: { nombre: string } | null; aprobadaPor: { nombre: string } | null; aprobadaEn: string | null; causal: { nombre: string } | null;
  tarifaVigente: { precioUnitario: string; metricaId: string | null; tipoNegociacion: string; formaPago: string } | null;
  tarifas: { id: string; precioUnitario: string; vigenteDesde: string; vigenteHasta: string | null; tipoNegociacion: string; formaPago: string; metrica: { abreviacion: string } | null }[];
}

const s = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v));
const siNo = (v: boolean | null): SiNo => (v === null ? '' : v ? 'si' : 'no');

/** Detalle del API → formulario. */
export function desdeDetalle(d: DetalleDecl): FormDecl {
  return {
    tipo: d.tipo, clienteId: d.clienteId, alcanceSedes: d.alcanceSedes, sucursalIds: d.sucursales.map((x) => x.sucursal.id),
    nombre: d.nombre, codigoInterno: s(d.codigoInterno), catalogoId: s(d.catalogoId), categoriaId: d.categoriaId, tipoResiduoId: s(d.tipoResiduoId),
    lineaServicioId: d.lineaServicioId, esPeligroso: d.esPeligroso, frecuenciaDias: s(d.frecuenciaDias), cantidadFrecuencia: s(d.cantidadFrecuencia),
    solicitudAutomatica: d.solicitudAutomatica, etiquetadoIds: d.etiquetados.map((x) => x.sistemaId), codigoAId: s(d.codigoAId), codigoYId: s(d.codigoYId),
    codigoUn: s(d.codigoUn), riesgoIds: d.riesgos.map((x) => x.riesgoId), descripcionProceso: s(d.descripcionProceso), composicion: s(d.composicion),
    descripcionServicio: s(d.descripcionServicio), tipoEmbalajeId: s(d.tipoEmbalajeId), otroTipoEmbalaje: s(d.otroTipoEmbalaje), presentacion: s(d.presentacion),
    materialEmbalajeId: s(d.materialEmbalajeId), otroMaterial: s(d.otroMaterial), tipoSellado: s(d.tipoSellado), estadoFisico: d.estadoFisico ?? '',
    inflamable: siNo(d.inflamable), controladaEstupefacientes: siNo(d.controladaEstupefacientes), color: s(d.color), olor: s(d.olor),
    densidad: d.densidad === null ? '' : String(Number(d.densidad)), metricaDensidadId: s(d.metricaDensidadId), contieneHidrocarburos: d.contieneHidrocarburos ? 'si' : 'no',
    disposiciones: d.disposiciones.map((x) => ({ disposicionId: x.disposicion.id, principal: x.principal })),
    datosExtras: s(d.datosExtras), fichaSeguridadUrl: s(d.fichaSeguridadUrl), caracterizacionUrl: s(d.caracterizacionUrl), serial: s(d.serial),
    precio: d.tarifaVigente ? String(Number(d.tarifaVigente.precioUnitario)) : '', metricaId: s(d.tarifaVigente?.metricaId),
    tipoNegociacion: s(d.tarifaVigente?.tipoNegociacion), formaPago: s(d.tarifaVigente?.formaPago), mostrarPrecioApp: d.mostrarPrecioApp,
    vigenteHasta: d.vigenteHasta ? d.vigenteHasta.slice(0, 10) : '', observaciones: s(d.observaciones), responsabilidadAceptada: d.responsabilidadAceptada,
  };
}

const txt = (v: string) => (v.trim() === '' ? null : v.trim());
const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
const idONull = (v: string) => (v ? v : null);

/** Formulario → cuerpo de POST / PUT /declaraciones. Lo que no aplica al tipo se envía vacío. */
export function aPayload(f: FormDecl, borrador: boolean): DeclaracionEntrada {
  const residuo = f.tipo === 'RESIDUO';
  const peligroso = residuo && f.esPeligroso;
  return {
    tipo: f.tipo, borrador,
    clienteId: f.clienteId, alcanceSedes: f.alcanceSedes, sucursalIds: f.alcanceSedes === 'SELECCION' ? f.sucursalIds : [],
    nombre: f.nombre.trim(), codigoInterno: txt(f.codigoInterno), catalogoId: idONull(f.catalogoId), categoriaId: f.categoriaId,
    tipoResiduoId: residuo ? idONull(f.tipoResiduoId) : null, lineaServicioId: f.lineaServicioId, esPeligroso: peligroso,
    frecuenciaDias: num(f.frecuenciaDias), cantidadFrecuencia: num(f.cantidadFrecuencia), solicitudAutomatica: f.solicitudAutomatica,
    etiquetadoIds: residuo ? f.etiquetadoIds : [], codigoAId: peligroso ? idONull(f.codigoAId) : null, codigoYId: peligroso ? idONull(f.codigoYId) : null,
    codigoUn: residuo ? txt(f.codigoUn)?.toUpperCase() ?? null : null, riesgoIds: peligroso ? f.riesgoIds : [],
    descripcionProceso: residuo ? txt(f.descripcionProceso) : null, composicion: residuo ? txt(f.composicion) : null,
    descripcionServicio: residuo ? null : txt(f.descripcionServicio),
    tipoEmbalajeId: residuo ? idONull(f.tipoEmbalajeId) : null, otroTipoEmbalaje: residuo ? txt(f.otroTipoEmbalaje) : null,
    presentacion: residuo ? txt(f.presentacion) : null, materialEmbalajeId: residuo ? idONull(f.materialEmbalajeId) : null,
    otroMaterial: residuo ? txt(f.otroMaterial) : null, tipoSellado: residuo ? txt(f.tipoSellado) : null,
    estadoFisico: residuo && f.estadoFisico ? f.estadoFisico : null,
    inflamable: residuo && f.inflamable ? f.inflamable === 'si' : null,
    controladaEstupefacientes: residuo && f.controladaEstupefacientes ? f.controladaEstupefacientes === 'si' : null,
    color: residuo ? txt(f.color) : null, olor: residuo ? txt(f.olor) : null,
    densidad: residuo ? num(f.densidad) : null, metricaDensidadId: residuo ? idONull(f.metricaDensidadId) : null,
    contieneHidrocarburos: residuo && f.contieneHidrocarburos === 'si',
    disposiciones: f.disposiciones,
    datosExtras: txt(f.datosExtras), fichaSeguridadUrl: txt(f.fichaSeguridadUrl), caracterizacionUrl: residuo ? txt(f.caracterizacionUrl) : null, serial: txt(f.serial),
    precio: f.precio.trim() === '' ? null : {
      precioUnitario: Number(f.precio.replace(',', '.')), metricaId: idONull(f.metricaId),
      tipoNegociacion: (f.tipoNegociacion || null) as Negociacion | null, formaPago: (f.formaPago || null) as FormaPago | null,
    },
    mostrarPrecioApp: f.mostrarPrecioApp,
    vigenteHasta: f.vigenteHasta ? new Date(`${f.vigenteHasta}T00:00:00Z`) : null, observaciones: txt(f.observaciones), responsabilidadAceptada: f.responsabilidadAceptada,
  };
}

export const SECCIONES = [
  { n: 1, titulo: 'Información del generador' }, { n: 2, titulo: 'Datos específicos' }, { n: 3, titulo: 'Embalaje' },
  { n: 4, titulo: 'Características fisicoquímicas' }, { n: 5, titulo: 'Disposición y manejo' }, { n: 6, titulo: 'Información adicional' },
  { n: 7, titulo: 'Precio' }, { n: 8, titulo: 'Estado y responsabilidad' },
] as const;

const SECCION_DE: Record<string, number> = {
  clienteId: 1, alcanceSedes: 1, sucursalIds: 1,
  nombre: 2, codigoInterno: 2, catalogoId: 2, categoriaId: 2, tipoResiduoId: 2, lineaServicioId: 2, esPeligroso: 2, frecuenciaDias: 2,
  cantidadFrecuencia: 2, solicitudAutomatica: 2, etiquetadoIds: 2, codigoAId: 2, codigoYId: 2, codigoUn: 2, riesgoIds: 2,
  descripcionProceso: 2, composicion: 2, descripcionServicio: 2,
  tipoEmbalajeId: 3, otroTipoEmbalaje: 3, presentacion: 3, materialEmbalajeId: 3, otroMaterial: 3, tipoSellado: 3,
  estadoFisico: 4, inflamable: 4, controladaEstupefacientes: 4, color: 4, olor: 4, densidad: 4, metricaDensidadId: 4, contieneHidrocarburos: 4,
  disposiciones: 5, datosExtras: 6, fichaSeguridadUrl: 6, caracterizacionUrl: 6, serial: 6, precio: 7, mostrarPrecioApp: 7,
  vigenteHasta: 8, observaciones: 8, responsabilidadAceptada: 8,
};
export const seccionDe = (campo: string) => SECCION_DE[campo] ?? 8;

/** Mensajes en español para los obligatorios que el esquema valida por formato. */
const REQUERIDO: Record<string, string> = {
  clienteId: 'Elija el cliente.', categoriaId: 'Elija la categoría.', lineaServicioId: 'Elija la línea de servicio.', nombre: 'Escriba el nombre.',
};

export interface Revision { errores: Record<string, string>; porSeccion: Record<number, number>; total: number }

/**
 * Valida con el mismo esquema del API y agrega lo que solo sabe la pantalla: si el embalaje o el material elegido es
 * «Otro», hay que escribir cuál (la base lo exige al enviar, no en borrador).
 */
export function revisar(f: FormDecl, borrador: boolean, otro: { embalaje: boolean; material: boolean }): Revision {
  const errores: Record<string, string> = {};
  const r = EsquemaDeclaracion.safeParse(aPayload(f, borrador));
  if (!r.success) for (const i of r.error.issues) {
    const campo = String(i.path[0] ?? 'observaciones');
    if (errores[campo]) continue;
    errores[campo] = REQUERIDO[campo] && (i.code === 'invalid_type' || i.code === 'invalid_string' || i.code === 'too_small') ? REQUERIDO[campo] : i.message;
  }
  if (f.tipo === 'RESIDUO' && !borrador) {
    if (otro.embalaje && !f.otroTipoEmbalaje.trim()) errores.otroTipoEmbalaje ??= 'Escriba cuál es el tipo de embalaje.';
    if (otro.material && !f.otroMaterial.trim()) errores.otroMaterial ??= 'Escriba cuál es el material.';
  }
  const porSeccion: Record<number, number> = {};
  for (const k of Object.keys(errores)) { const n = seccionDe(k); porSeccion[n] = (porSeccion[n] ?? 0) + 1; }
  return { errores, porSeccion, total: Object.keys(errores).length };
}
