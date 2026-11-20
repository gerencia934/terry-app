/**
 * Accesos rápidos del tablero de inicio (Terry-App · Gestión de Residuos): enlaces a las entidades con las que Terra Viva
 * cumple (respuesta de la gerencia, 20-11-2026). Se cambian en Ajustes › Datos de la empresa sin tocar el código.
 */
export interface AccesoRapido { etiqueta: string; url: string }

export const ACCESOS_RAPIDOS_DEFECTO: AccesoRapido[] = [
  { etiqueta: 'ICONTEC', url: 'https://www.icontec.org/' },
  // El PESV lo vigila la Superintendencia de Transporte
  { etiqueta: 'PESV', url: 'https://www.supertransporte.gov.co/' },
  { etiqueta: 'MinAmbiente · IDEAM', url: 'https://www.minambiente.gov.co/' },
  // Genérico por ahora (la gerencia lo ajusta en Ajustes con su aseguradora)
  { etiqueta: 'Seguros', url: 'https://www.segurosdelestado.com/' },
];

/** Solo direcciones https completas (un enlace de otra clase no se muestra). */
export const accesoValido = (a: Partial<AccesoRapido> | null | undefined): a is AccesoRapido =>
  !!a && typeof a.etiqueta === 'string' && a.etiqueta.trim().length >= 2 && typeof a.url === 'string' && /^https:\/\/[^\s]+\.[^\s]+$/i.test(a.url.trim());

/** Los accesos guardados en la configuración de la empresa o, si no hay, los de siempre. */
export function accesosRapidos(configuracion: unknown): AccesoRapido[] {
  const guardados = (configuracion as { accesosRapidos?: unknown } | null)?.accesosRapidos;
  if (!Array.isArray(guardados)) return ACCESOS_RAPIDOS_DEFECTO;
  return guardados.filter(accesoValido).map((a) => ({ etiqueta: a.etiqueta.trim(), url: a.url.trim() }));
}
