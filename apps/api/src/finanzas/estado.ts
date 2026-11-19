// Estado financiero de los manifiestos y regla del certificado de cada cliente (Siigo, gerencia 19-11-2026).
// Una sola lógica para todo: la sincronización, el panel de facturación, la emisión del certificado y su descarga (en la
// oficina y en el portal). Facturado = tiene factura (de Siigo o registrada en la conciliación) que no está anulada.
// Pagado = todas sus facturas pagadas. Libre = no se cobra (facturación lo marcó, con su motivo, o la línea es sin costo
// o de compra).
import { Prisma, type EstadoPago, type EstadoPagoManifiesto, type PrismaClient, type ReglaCertificado, type TipoNegociacion } from '@prisma/client';
import { certificadosRetenidos } from '../actas/cartera';

type Db = PrismaClient | Prisma.TransactionClient;

/** Solo Comercial, Facturación (financiero) y Gerencia ven la información de facturación («finanzas.ver»). */
export const veFinanzas = (a: { permisos: string[] }) => a.permisos.includes('*') || a.permisos.includes('finanzas.ver');
/** Sincronizar, enlazar facturas, registrar pagos, marcar sin cobro y liberar certificados («finanzas.gestionar»). */
export const gestionaFinanzas = (a: { permisos: string[] }) => a.permisos.includes('*') || a.permisos.includes('finanzas.gestionar');
const CAMPOS_FACTURA = ['facturaNumero', 'facturaEmision', 'facturaVencimiento', 'estadoPago'] as const;
/** Una línea de conciliación sin sus datos de factura y pago (para quien no ve facturación). */
export function sinFacturacion<T extends object>(l: T): Omit<T, (typeof CAMPOS_FACTURA)[number]> {
  const x = { ...l } as Record<string, unknown>;
  for (const k of CAMPOS_FACTURA) delete x[k];
  return x as Omit<T, (typeof CAMPOS_FACTURA)[number]>;
}
const SIN_COBRO: TipoNegociacion[] = ['SIN_COSTO', 'COMPRA'];

/** Lo que se sabe de una línea certificable para decidir si está facturada y pagada. */
interface Linea { facturaNumero: string | null; estadoPago: EstadoPago; tipoNegociacion: TipoNegociacion | null }
interface FacturaEnlazada { nombre: string; estado: 'PENDIENTE' | 'ABONADA' | 'PAGADA' | 'ANULADA'; saldo: Prisma.Decimal; vence: Date | null }
interface DatosManifiesto { libre: boolean; facturas: FacturaEnlazada[]; lineas: Linea[] }

/** Facturado y pagado de un manifiesto (o de algunas de sus líneas, para un certificado). */
export function estadoFinanciero(m: DatosManifiesto) {
  const siigo = m.facturas.filter((f) => f.estado !== 'ANULADA');
  const lineas = m.lineas.filter((l) => !(l.tipoNegociacion && SIN_COBRO.includes(l.tipoNegociacion)));
  const sinCobro = m.lineas.length > 0 && !lineas.length;
  // Una línea está facturada si tiene su número de factura (no anulada) o si el manifiesto tiene factura en Siigo
  const lineaFacturada = (l: Linea) => (!!l.facturaNumero && l.estadoPago !== 'ANULADA') || siigo.length > 0;
  const lineaPagada = (l: Linea) => (l.facturaNumero && l.estadoPago !== 'ANULADA' ? l.estadoPago === 'PAGADA' : siigo.length > 0 && siigo.every((f) => f.estado === 'PAGADA'));
  const facturado = lineas.length ? lineas.every(lineaFacturada) : siigo.length > 0;
  const pagado = facturado && (lineas.length ? lineas.every(lineaPagada) : siigo.every((f) => f.estado === 'PAGADA'));
  const nombres = [...new Set([...siigo.map((f) => f.nombre), ...lineas.filter((l) => l.facturaNumero && l.estadoPago !== 'ANULADA').map((l) => l.facturaNumero!)])];
  const pendientes = siigo.filter((f) => f.estado !== 'PAGADA');
  const estadoPago: EstadoPagoManifiesto = m.libre || sinCobro ? 'LIBRE' : pagado ? 'PAGADO' : 'PENDIENTE';
  return {
    facturado, estadoPago, facturas: nombres,
    saldo: pendientes.length ? pendientes.reduce((s, f) => s.add(f.saldo), new Prisma.Decimal(0)) : null,
    vence: pendientes.map((f) => f.vence).filter((x): x is Date => !!x).sort((a, b) => a.getTime() - b.getTime())[0] ?? null,
    pendientesDePago: [...new Set([...pendientes.map((f) => f.nombre), ...lineas.filter((l) => l.facturaNumero && !['PAGADA', 'ANULADA'].includes(l.estadoPago)).map((l) => l.facturaNumero!)])],
  };
}

const seleccion = {
  id: true, numero: true, finanzas: { select: { libreEn: true } },
  facturas: { select: { factura: { select: { nombre: true, estado: true, saldo: true, vence: true } } } },
  conciliacion: { select: { estado: true, items: { select: { facturaNumero: true, estadoPago: true, tipoNegociacion: true } } } },
} satisfies Prisma.ManifiestoSelect;

/** Recalcula y guarda el estado financiero de los manifiestos realizados (todos o los indicados). Respeta lo marcado «libre». */
export async function recalcularFinanzas(db: Db, empresaId: string, manifiestoIds?: string[]) {
  const ms = await db.manifiesto.findMany({ where: { empresaId, estado: 'REALIZADO', ...(manifiestoIds ? { id: { in: manifiestoIds } } : {}) }, select: seleccion });
  for (const m of ms) {
    const e = estadoFinanciero({ libre: !!m.finanzas?.libreEn, facturas: m.facturas.map((x) => x.factura),
      lineas: m.conciliacion && m.conciliacion.estado !== 'ANULADA' ? m.conciliacion.items : [] });
    const datos = { facturado: e.facturado, estadoPago: e.estadoPago, facturas: e.facturas, saldo: e.saldo, vence: e.vence, actualizadoEn: new Date() };
    await db.manifiestoFinanzas.upsert({ where: { manifiestoId: m.id }, update: datos, create: { manifiestoId: m.id, empresaId, ...datos } });
  }
  return ms.length;
}

export type MotivoRetencion = 'FACTURA' | 'PAGO' | 'VENCIDA';
export interface Retencion { motivo: MotivoRetencion; regla: ReglaCertificado; manifiestos: string[]; facturas: string[] }

/**
 * Certificados retenidos por la regla de su cliente. `para`:
 * - EMITIR: «Exigir factura» y «Exigir pago» no dejan emitir (la salida es marcar el manifiesto «libre», con su motivo).
 * - OFICINA: esas dos reglas tampoco dejan descargar un certificado ya emitido, salvo que facturación lo libere.
 * - PORTAL: además, la regla amable («al vencer») retiene la descarga si hay una factura vencida (días de gracia en Ajustes).
 * «Libre» nunca retiene.
 */
export async function retencionesCertificados(db: Db, configuracion: unknown, actaIds: string[], para: 'EMITIR' | 'OFICINA' | 'PORTAL'): Promise<Map<string, Retencion>> {
  const out = new Map<string, Retencion>();
  if (!actaIds.length) return out;
  const actas = await db.acta.findMany({ where: { id: { in: actaIds } }, select: {
    id: true, descargaLiberadaEn: true, cliente: { select: { reglaCertificado: true } },
    items: { select: { facturaNumero: true, estadoPago: true, tipoNegociacion: true, conciliacion: { select: { manifiesto: { select: {
      id: true, numero: true, finanzas: { select: { libreEn: true } }, facturas: { select: { factura: { select: { nombre: true, estado: true, saldo: true, vence: true } } } } } } } } } },
  } });
  const alVencer: string[] = [];
  for (const a of actas) {
    const regla = a.cliente.reglaCertificado;
    if (regla === 'LIBRE' || (para !== 'EMITIR' && a.descargaLiberadaEn)) continue;
    if (regla === 'AL_VENCER') { if (para === 'PORTAL') alVencer.push(a.id); continue; }
    // Exigir factura o pago: se revisa cada manifiesto con las líneas de este certificado
    const porManifiesto = new Map<string, { numero: string; datos: DatosManifiesto }>();
    for (const l of a.items) {
      const m = l.conciliacion.manifiesto;
      const x = porManifiesto.get(m.id) ?? { numero: m.numero, datos: { libre: !!m.finanzas?.libreEn, facturas: m.facturas.map((f) => f.factura), lineas: [] } };
      x.datos.lineas.push(l);
      porManifiesto.set(m.id, x);
    }
    const faltan: string[] = [], facturas = new Set<string>();
    for (const { numero, datos } of porManifiesto.values()) {
      const e = estadoFinanciero(datos);
      if (e.estadoPago === 'LIBRE') continue;
      if (regla === 'EXIGIR_FACTURA' && !e.facturado) faltan.push(numero);
      if (regla === 'EXIGIR_PAGO' && e.estadoPago !== 'PAGADO') { faltan.push(numero); e.pendientesDePago.forEach((f) => facturas.add(f)); }
    }
    if (faltan.length) out.set(a.id, { motivo: regla === 'EXIGIR_FACTURA' ? 'FACTURA' : 'PAGO', regla, manifiestos: faltan.sort(), facturas: [...facturas].sort() });
  }
  if (alVencer.length) {
    for (const [id, facturas] of await certificadosRetenidos(db, configuracion, alVencer)) out.set(id, { motivo: 'VENCIDA', regla: 'AL_VENCER', manifiestos: [], facturas });
  }
  return out;
}

/** Mensaje para la oficina (con el detalle) cuando la regla no deja emitir o descargar. */
export function mensajeOficina(r: Retencion, accion: 'emitir' | 'descargar', cliente?: string) {
  const quien = cliente ? `${cliente} tiene la regla` : 'El cliente tiene la regla';
  const lista = (xs: string[]) => (xs.length > 6 ? `${xs.slice(0, 6).join(', ')} y ${xs.length - 6} más` : xs.join(', '));
  if (r.motivo === 'FACTURA') return `No se puede ${accion}: ${quien} «Exigir factura» y estos manifiestos aún no tienen factura: ${lista(r.manifiestos)}. Facturación los enlaza (o sincroniza con Siigo) o los marca sin cobro.`;
  if (r.motivo === 'PAGO') return `No se puede ${accion}: ${quien} «Exigir pago» y falta el pago de ${r.facturas.length ? `las facturas ${lista(r.facturas)}` : 'sus facturas'} (manifiestos ${lista(r.manifiestos)}). Facturación puede liberarlo.`;
  return `Retenido en el portal por facturas vencidas: ${lista(r.facturas)}.`;
}

/** Mensaje amable para el cliente en el portal (nunca habla de mora ni muestra datos internos). */
export function mensajePortal(r: Retencion) {
  if (r.motivo === 'FACTURA') return 'Este certificado estará disponible para descargar cuando se emita la factura del servicio. Si tiene dudas, comuníquese con Terra Viva.';
  const cuales = !r.facturas.length ? 'de su factura' : r.facturas.length === 1 ? `de la factura ${r.facturas[0]}` : `de las facturas ${r.facturas.slice(0, -1).join(', ')} y ${r.facturas[r.facturas.length - 1]}`;
  return `Este certificado estará disponible para descargar cuando se registre el pago ${cuales}. Si ya ${r.facturas.length > 1 ? 'las' : 'la'} pagó, comuníquese con Terra Viva y lo actualizamos.`;
}
