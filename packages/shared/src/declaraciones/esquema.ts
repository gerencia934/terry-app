// Validación de la declaración (formulario de 8 secciones). Fuente única: la usan el API (al guardar)
// y la web (react-hook-form + zod, fase B). Repite las reglas de la base de datos para avisar antes;
// la base sigue siendo la última palabra (migración «declaraciones_reglas»).
import { z } from 'zod';

const id = z.string().uuid();
const opcional = <T extends z.ZodTypeAny>(s: T) => s.nullish();
const texto = (max: number) => opcional(z.string().trim().max(max, `Máximo ${max} caracteres.`));
const lleno = (s?: string | null) => !!s && s.trim().length > 0;

export const ESTADOS_FISICOS_DB = ['SOLIDO', 'SEMISOLIDO', 'LIQUIDO', 'GASEOSO'] as const;
export const ALCANCES_SEDES = ['TODAS', 'PRINCIPAL', 'SELECCION'] as const;
export const NEGOCIACIONES = ['COBRO', 'COMPRA', 'SIN_COSTO'] as const;
export const FORMAS_PAGO = ['CONTADO', 'CREDITO_30', 'CREDITO_60', 'CREDITO_90'] as const;

const base = z.object({
  tipo: z.enum(['RESIDUO', 'SERVICIO']),
  /** true = guardar a medias (BORRADOR): no exige obligatorios. */
  borrador: z.boolean().default(false),

  // [1] Información del generador
  clienteId: id,
  alcanceSedes: z.enum(ALCANCES_SEDES).default('SELECCION'),
  sucursalIds: z.array(id).max(1000).default([]),

  // [2] Datos específicos
  nombre: z.string().trim().min(2, 'Escriba el nombre.').max(200),
  codigoInterno: texto(40),
  catalogoId: opcional(id),
  categoriaId: id,
  tipoResiduoId: opcional(id),
  lineaServicioId: id,
  esPeligroso: z.boolean().default(false),
  frecuenciaDias: opcional(z.number().int().min(1, 'Entre 1 y 366 días.').max(366, 'Entre 1 y 366 días.')),
  cantidadFrecuencia: opcional(z.number().positive('Debe ser mayor que cero.')),
  solicitudAutomatica: z.boolean().default(false),
  etiquetadoIds: z.array(id).max(10).default([]),
  codigoAId: opcional(id),
  codigoYId: opcional(id),
  codigoUn: opcional(z.string().trim().toUpperCase().regex(/^UN\d{4}$/, 'Formato UN y 4 dígitos (UN3082).')),
  riesgoIds: z.array(id).max(10).default([]),
  descripcionProceso: texto(2000),
  composicion: texto(2000),
  descripcionServicio: texto(1000),

  // [3] Embalaje
  tipoEmbalajeId: opcional(id),
  otroTipoEmbalaje: texto(80),
  presentacion: texto(60),
  materialEmbalajeId: opcional(id),
  otroMaterial: texto(80),
  tipoSellado: texto(80),

  // [4] Características fisicoquímicas
  estadoFisico: opcional(z.enum(ESTADOS_FISICOS_DB)),
  inflamable: opcional(z.boolean()),
  controladaEstupefacientes: opcional(z.boolean()),
  color: texto(60),
  olor: texto(120),
  densidad: opcional(z.number().positive('Debe ser mayor que cero.')),
  metricaDensidadId: opcional(id),

  // [5] Disposición y manejo (la primera, o la marcada, es la principal)
  disposiciones: z.array(z.object({ disposicionId: id, principal: z.boolean().default(false) })).max(20).default([]),

  // [6] Información adicional
  datosExtras: texto(4000),
  fichaSeguridadUrl: opcional(z.string().trim().url('Enlace inválido.').max(500)),
  serial: texto(60),

  // [7] Precio (cada cambio crea una nueva vigencia)
  precio: opcional(z.object({
    precioUnitario: z.number().nonnegative('El precio no puede ser negativo.'),
    metricaId: opcional(id), // vacío = precio GLOBAL
    tipoNegociacion: opcional(z.enum(NEGOCIACIONES)),
    formaPago: opcional(z.enum(FORMAS_PAGO)),
  })),
  mostrarPrecioApp: z.boolean().default(false),

  // [8] Estado
  vigenteHasta: opcional(z.coerce.date()),
  observaciones: texto(1000),
  responsabilidadAceptada: z.boolean().default(false),
});

export type DeclaracionEntrada = z.input<typeof base>;

/** Reglas entre campos. No aplican al borrador (igual que en la base de datos). */
export const EsquemaDeclaracion = base.superRefine((d, ctx) => {
  const falta = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  // Formato: aplican siempre
  if ((d.densidad == null) !== (d.metricaDensidadId == null)) falta('metricaDensidadId', 'Indique la densidad y su métrica, o ninguna.');
  if (d.solicitudAutomatica && d.frecuenciaDias == null) falta('frecuenciaDias', 'La solicitud automática necesita la frecuencia en días.');
  if (d.disposiciones.filter((x) => x.principal).length > 1) falta('disposiciones', 'Solo una disposición puede ser la principal.');
  if (new Set(d.disposiciones.map((x) => x.disposicionId)).size !== d.disposiciones.length) falta('disposiciones', 'Hay disposiciones repetidas.');
  if (d.alcanceSedes === 'SELECCION' && !d.borrador && !d.sucursalIds.length) falta('sucursalIds', 'Elija al menos una sede.');
  if (d.borrador) return;

  if (!d.responsabilidadAceptada) falta('responsabilidadAceptada', 'El generador debe aceptar la declaración de responsabilidad.');
  if (d.tipo === 'RESIDUO') {
    if (!d.tipoResiduoId) falta('tipoResiduoId', 'Elija el tipo de residuo.');
    if (!lleno(d.descripcionProceso)) falta('descripcionProceso', 'Describa el proceso que generó el residuo.');
    if (!d.tipoEmbalajeId) falta('tipoEmbalajeId', 'Elija el tipo de embalaje.');
    if (!d.materialEmbalajeId) falta('materialEmbalajeId', 'Elija el material del embalaje.');
    if (!d.estadoFisico) falta('estadoFisico', 'Elija el estado físico.');
    if (d.inflamable == null) falta('inflamable', 'Indique si es inflamable.');
    if (d.controladaEstupefacientes == null) falta('controladaEstupefacientes', 'Indique si es sustancia controlada.');
  } else if (!lleno(d.descripcionServicio)) falta('descripcionServicio', 'Describa el servicio.');
  if (d.esPeligroso) {
    if (!lleno(d.composicion)) falta('composicion', 'La composición es obligatoria para residuos peligrosos.');
    if (!d.codigoAId && !d.codigoYId) falta('codigoYId', 'Un residuo peligroso necesita corriente Y o código A.');
  }
});

/** Lo que exige la autorización además de lo anterior (se revisa al autorizar, no al enviar). */
export function faltantesParaAutorizar(d: {
  tipo: 'RESIDUO' | 'SERVICIO'; esPeligroso: boolean; fichaSeguridadUrl: string | null; sedes: number; disposiciones: number; tarifaVigente: boolean;
}): string[] {
  const f: string[] = [];
  if (!d.sedes) f.push('asigne al menos una sede');
  if (d.tipo === 'RESIDUO' && !d.disposiciones) f.push('indique la disposición o manejo');
  if (!d.tarifaVigente) f.push('asigne el precio');
  // Pregunta n.º 3 de la fase A: FDS obligatoria para peligrosos (Dec. 1079 de 2015, transporte de mercancías peligrosas).
  if (d.esPeligroso && !lleno(d.fichaSeguridadUrl)) f.push('adjunte la ficha de datos de seguridad (residuo peligroso)');
  return f;
}
