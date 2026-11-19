// Totales de una conciliación (o de varias: consolidado). Fuente única para el API y la grilla web.
// Las cantidades se agrupan POR UNIDAD: nunca se suman kilos con metros cúbicos.

export interface LineaTotal {
  cantidadCargada: number | string;
  cantidadConciliada: number | string | null;
  precioUnitario: number | string | null;
  unidad: string | null; // abreviatura de la métrica (kg, m³…); null = global / sin unidad
  tipoNegociacion: 'COBRO' | 'COMPRA' | 'SIN_COSTO' | 'CONTRATO' | null; // CONTRATO: se factura aparte (no suma aquí)
  formaPago: 'CONTADO' | 'CREDITO_30' | 'CREDITO_60' | 'CREDITO_90' | null;
}
export interface Bascula { pesoEntrada?: number | string | null; pesoSalida?: number | string | null; pesoNeto?: number | string | null }

export interface Totales {
  lineas: number;
  sinConciliar: number; // líneas sin cantidad conciliada o sin precio
  porUnidad: { unidad: string; cargado: number; conciliado: number; diferencia: number }[];
  cobro: number; // lo que factura Terra Viva
  compra: number; // lo que paga Terra Viva (material comprado)
  contado: number;
  credito: number;
  neto: number; // cobro − compra
  bascula: { lleno: number; vacio: number; neto: number };
}

const n = (v: number | string | null | undefined) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const redondear = (v: number) => Math.round(v * 100) / 100;

/** Valor de una línea: cantidad conciliada (o cargada si aún no se concilia) × precio. */
export const valorLinea = (l: LineaTotal) => redondear(n(l.cantidadConciliada ?? l.cantidadCargada) * n(l.precioUnitario));

/** Negociaciones que no suman al cobro: sin costo, y por contrato (se factura aparte). */
const SIN_VALOR = new Set(['SIN_COSTO', 'CONTRATO']);

export function totalesConciliacion(lineas: LineaTotal[], basculas: Bascula[] = []): Totales {
  const unidades = new Map<string, { cargado: number; conciliado: number }>();
  let cobro = 0, compra = 0, contado = 0, credito = 0, sinConciliar = 0;
  for (const l of lineas) {
    const u = l.unidad ?? 'sin unidad';
    const acc = unidades.get(u) ?? { cargado: 0, conciliado: 0 };
    acc.cargado += n(l.cantidadCargada);
    acc.conciliado += n(l.cantidadConciliada);
    unidades.set(u, acc);
    // Por contrato o sin costo, la línea no necesita precio (misma regla que la base al aprobar)
    const sinPrecio = (l.precioUnitario === null || l.precioUnitario === '') && !SIN_VALOR.has(l.tipoNegociacion ?? '');
    if (l.cantidadConciliada === null || l.cantidadConciliada === '' || sinPrecio) sinConciliar++;
    const valor = valorLinea(l);
    if (l.tipoNegociacion === 'COMPRA') compra += valor;
    else if (!SIN_VALOR.has(l.tipoNegociacion ?? '')) cobro += valor;
    if (!SIN_VALOR.has(l.tipoNegociacion ?? '')) {
      if (!l.formaPago || l.formaPago === 'CONTADO') contado += valor; else credito += valor;
    }
  }
  // Báscula: el vehículo entra lleno y sale vacío (neto = entrada − salida)
  const lleno = basculas.reduce((s, b) => s + n(b.pesoEntrada), 0);
  const vacio = basculas.reduce((s, b) => s + n(b.pesoSalida), 0);
  const neto = basculas.reduce((s, b) => s + (b.pesoNeto !== null && b.pesoNeto !== undefined && b.pesoNeto !== '' ? n(b.pesoNeto) : n(b.pesoEntrada) - n(b.pesoSalida)), 0);
  return {
    lineas: lineas.length, sinConciliar,
    porUnidad: [...unidades.entries()].map(([unidad, v]) => ({ unidad, cargado: redondear(v.cargado), conciliado: redondear(v.conciliado), diferencia: redondear(v.conciliado - v.cargado) })),
    cobro: redondear(cobro), compra: redondear(compra), contado: redondear(contado), credito: redondear(credito), neto: redondear(cobro - compra),
    bascula: { lleno: redondear(lleno), vacio: redondear(vacio), neto: redondear(neto) },
  };
}

/** Diferencia porcentual entre lo cargado y lo conciliado (la base exige justificación si supera ±2 %). */
export function diferenciaPct(cargada: number | string, conciliada: number | string | null): number | null {
  const c = n(cargada);
  if (conciliada === null || conciliada === '' || c === 0) return null;
  return redondear(((n(conciliada) - c) * 100) / c);
}
export const TOLERANCIA_CONCILIACION_PCT = 2;
