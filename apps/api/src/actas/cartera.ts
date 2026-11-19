// Certificados sujetos al pago (respuesta de la gerencia del 19-11-2026: «condicionar sutilmente la descarga de las
// actas al pago de las facturas»). Un certificado queda retenido en el portal si alguna de sus líneas tiene una factura
// vencida (más los días de gracia) y sin pagar, salvo que la oficina haya liberado su descarga. Solo cambia lo que el
// cliente descarga en el portal: la oficina siempre lo descarga, el certificado no cambia y el QR sigue verificando.
import { Prisma } from '@prisma/client';

type Db = { $queryRaw: <T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => Prisma.PrismaPromise<T> };

/** Ajustes › Empresa: si se retiene y con cuántos días de gracia después del vencimiento. */
export interface ConfigCartera { retenerCertificados?: boolean; diasGracia?: number }

export function configCartera(configuracion: unknown): { retener: boolean; diasGracia: number } {
  const c = ((configuracion ?? {}) as { cartera?: ConfigCartera }).cartera ?? {};
  return { retener: c.retenerCertificados !== false, diasGracia: Math.max(0, Math.min(365, Math.trunc(c.diasGracia ?? 0))) };
}

/** Facturas vencidas y sin pagar de cada certificado retenido (los que no aparecen se descargan). */
export async function certificadosRetenidos(db: Db, configuracion: unknown, actaIds: string[]): Promise<Map<string, string[]>> {
  const { retener, diasGracia } = configCartera(configuracion);
  if (!retener || !actaIds.length) return new Map();
  const filas = await db.$queryRaw<{ acta_id: string; facturas: string[] }[]>`
    SELECT ci.acta_id, array_agg(DISTINCT ci.factura_numero ORDER BY ci.factura_numero) AS facturas
    FROM conciliacion_items ci
    JOIN actas a ON a.id = ci.acta_id
    WHERE ci.acta_id = ANY(${actaIds}::uuid[])
      AND a.descarga_liberada_en IS NULL
      AND ci.factura_numero IS NOT NULL
      AND ci.estado_pago IN ('PENDIENTE', 'ABONADA')
      AND ci.factura_vencimiento IS NOT NULL
      AND ci.factura_vencimiento + ${diasGracia}::int < (now() AT TIME ZONE 'America/Bogota')::date
    GROUP BY ci.acta_id`;
  return new Map(filas.map((f) => [f.acta_id, f.facturas]));
}

/** Mensaje para el cliente: amable y sin hablar de mora. */
export function mensajePendientePago(facturas: string[]) {
  const cuales = facturas.length === 1 ? `de la factura ${facturas[0]}` : `de las facturas ${facturas.slice(0, -1).join(', ')} y ${facturas[facturas.length - 1]}`;
  return `Este certificado estará disponible para descargar cuando se registre el pago ${cuales}. Si ya ${facturas.length === 1 ? 'la' : 'las'} pagó, comuníquese con Terra Viva y lo actualizamos.`;
}
