// Punto de entrada único para leer una planilla diligenciada, sea Excel (.xlsx) o CSV. Lo usan la web (modo
// demostración) y el API, que vuelve a validar todo antes de guardar.

import { leerArchivo } from './excel';
import { leerCsv, type Codificacion, type Delimitador } from './csv';
import type { Plantilla } from './definiciones';

export type FormatoPlanilla = 'XLSX' | 'CSV';
export interface PlanillaLeida {
  filas: Record<string, string>[];
  faltantes: string[];
  formato: FormatoPlanilla;
  delimitador?: Delimitador;
  codificacion?: Codificacion;
}
/** Problema del archivo con un mensaje para el usuario (formato no admitido, Excel antiguo, binario…). */
export class ErrorPlanilla extends Error {}

/** Formato por el contenido, no por el nombre: un .xlsx es un ZIP («PK»); un .xls antiguo o un binario no se aceptan. */
export function formatoPlanilla(nombre: string, bytes: Uint8Array): FormatoPlanilla {
  if (!bytes.length) throw new ErrorPlanilla('El archivo está vacío.');
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 'XLSX';
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0)
    throw new ErrorPlanilla('Es un archivo de Excel antiguo (.xls). Ábralo en Excel y guárdelo como .xlsx o como CSV.');
  if (/\.xlsx$/i.test(nombre)) throw new ErrorPlanilla('El archivo no es un Excel (.xlsx) válido. Use la plantilla descargada.');
  if (!/\.(csv|txt|tsv)$/i.test(nombre)) throw new ErrorPlanilla('El archivo debe ser Excel (.xlsx) o CSV (.csv). Use la plantilla descargada.');
  const utf16 = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
  if (!utf16 && bytes.subarray(0, 8192).includes(0))
    throw new ErrorPlanilla('El archivo no es un CSV de texto. Guárdelo desde Excel como «CSV UTF-8» o use la plantilla .xlsx.');
  return 'CSV';
}

/** Lee la planilla. En CSV el separador se detecta solo; `delimitador` lo fija cuando el usuario lo elige. */
export async function leerPlanilla(p: Plantilla, nombre: string, buf: ArrayBuffer, opciones: { delimitador?: Delimitador } = {}): Promise<PlanillaLeida> {
  const bytes = new Uint8Array(buf);
  const formato = formatoPlanilla(nombre, bytes);
  if (formato === 'XLSX') return { ...(await leerArchivo(p, buf)), formato };
  return { ...leerCsv(p, bytes, opciones.delimitador), formato };
}
