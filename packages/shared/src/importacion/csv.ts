// Planillas en CSV (fase C de Declaraciones). Sin librerías: respeta las comillas, los saltos de línea dentro de una
// celda y los finales de línea de Windows, Mac y Linux. Excel en Colombia guarda el CSV separado por punto y coma (la
// coma es el separador decimal), y otros programas usan coma, tabulador o barra: el separador se detecta solo.

import { filaLeida, limpiarEncabezado, mapearEncabezados, type Plantilla } from './definiciones';

export type Delimitador = ',' | ';' | '\t' | '|';
/** En orden de preferencia: con un empate gana el punto y coma, el de Excel en español. */
export const DELIMITADORES: { valor: Delimitador; nombre: string }[] = [
  { valor: ';', nombre: 'punto y coma' }, { valor: ',', nombre: 'coma' }, { valor: '\t', nombre: 'tabulador' }, { valor: '|', nombre: 'barra vertical' },
];
export const nombreDelimitador = (d?: string) => DELIMITADORES.find((x) => x.valor === d)?.nombre ?? '';

/** Separador escrito por el usuario o enviado por la web: «;», «,», «|», tabulador, o su nombre («tab», «coma»…). */
export function delimitadorDe(v?: string | null): Delimitador | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (v === '\t') return '\t';
  const x = v.trim().toLowerCase();
  if (x === ';' || x === ',' || x === '|') return x;
  if (['tab', 'tabulador', '\\t'].includes(x)) return '\t';
  return DELIMITADORES.find((d) => d.nombre === x)?.valor;
}

export type Codificacion = 'UTF-8' | 'UTF-16' | 'Windows-1252';
/**
 * Texto del archivo: UTF-8 (con o sin BOM) o UTF-16 con BOM («Texto Unicode» de Excel). Si no es UTF-8 válido se lee
 * como Windows-1252, la codificación del «CSV (delimitado por comas)» de Excel en Windows: así no se dañan las tildes.
 */
export function decodificar(bytes: Uint8Array): { texto: string; codificacion: Codificacion } {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { texto: new TextDecoder('utf-16le').decode(bytes.subarray(2)), codificacion: 'UTF-16' };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { texto: new TextDecoder('utf-16be').decode(bytes.subarray(2)), codificacion: 'UTF-16' };
  try { return { texto: new TextDecoder('utf-8', { fatal: true }).decode(bytes), codificacion: 'UTF-8' }; }
  catch { return { texto: new TextDecoder('windows-1252').decode(bytes), codificacion: 'Windows-1252' }; }
}

/** Separa el texto en registros y celdas. Una comilla sin cerrar llega hasta el final del archivo. */
export function parsearCsv(texto: string, d: string): string[][] {
  const filas: string[][] = [];
  if (!texto) return filas;
  const n = texto.length;
  const finDeCampo = (k: number) => { while (k < n && texto[k] !== d && texto[k] !== '\n' && texto[k] !== '\r') k++; return k; };
  let fila: string[] = [];
  let i = 0;
  for (;;) {
    let campo: string;
    if (texto[i] === '"') {
      let j = i + 1;
      campo = '';
      for (;;) {
        const k = texto.indexOf('"', j);
        if (k < 0) { campo += texto.slice(j); j = n; break; }
        campo += texto.slice(j, k);
        if (texto[k + 1] === '"') { campo += '"'; j = k + 2; continue; }
        j = k + 1;
        break;
      }
      const k = finDeCampo(j); // lo que quede antes del separador se conserva («"a"b» → «ab»)
      campo += texto.slice(j, k);
      i = k;
    } else {
      const k = finDeCampo(i);
      campo = texto.slice(i, k);
      i = k;
    }
    fila.push(campo);
    if (i >= n) { filas.push(fila); break; }
    if (texto[i] === d) { i++; continue; }
    filas.push(fila);
    fila = [];
    i += texto[i] === '\r' && texto[i + 1] === '\n' ? 2 : 1;
    if (i >= n) break; // el salto de línea final no abre un registro vacío
  }
  return filas;
}

/** El separador con el que más encabezados coinciden con la plantilla (o, sin plantilla, el que más columnas da). */
export function detectarDelimitador(texto: string, p?: Plantilla): Delimitador {
  const fin = texto.search(/[\r\n]/);
  const cabecera = fin < 0 ? texto : texto.slice(0, fin);
  const conocidos = new Set(p?.columnas.map((c) => limpiarEncabezado(c.header)) ?? []);
  let mejor: Delimitador = ';';
  let puntaje = -1;
  for (const { valor } of DELIMITADORES) {
    const celdas = parsearCsv(cabecera, valor)[0] ?? [];
    const s = celdas.filter((c) => conocidos.has(limpiarEncabezado(c))).length * 1000 + (celdas.length > 1 ? celdas.length : 0);
    if (s > puntaje) { puntaje = s; mejor = valor; }
  }
  return mejor;
}

/** Lee la planilla en CSV. Acepta la línea «sep=;» que agrega Excel. `forzado` reemplaza al separador detectado. */
export function leerCsv(p: Plantilla, bytes: Uint8Array, forzado?: Delimitador) {
  const { texto: original, codificacion } = decodificar(bytes);
  let texto = original;
  let indicado: Delimitador | undefined;
  const sep = /^sep=(.)[ \t]*\r?\n/i.exec(texto);
  if (sep) { texto = texto.slice(sep[0].length); indicado = delimitadorDe(sep[1]); }
  const delimitador = forzado ?? indicado ?? detectarDelimitador(texto, p);
  const [cabecera = [], ...registros] = parsearCsv(texto, delimitador);
  const { claves, faltantes } = mapearEncabezados(p, cabecera);
  const filas: Record<string, string>[] = [];
  registros.forEach((r, i) => {
    const f = filaLeida(p, claves.map((k, col) => [k, r[col] ?? '']), i + 2);
    if (f) filas.push(f);
  });
  return { filas, faltantes, delimitador, codificacion };
}

/** Plantilla en CSV (UTF-8 con BOM, para que Excel respete las tildes): encabezados y la fila de ejemplo. */
export function construirPlantillaCsv(p: Plantilla, d: Delimitador = ';'): string {
  const celda = (v: string) => (/["\r\n]/.test(v) || v.includes(d) ? `"${v.replace(/"/g, '""')}"` : v);
  const linea = (xs: string[]) => xs.map(celda).join(d);
  return '﻿' + [
    linea(p.columnas.map((c) => c.header + (c.requerido ? ' *' : ''))),
    linea(p.columnas.map((c, i) => (i === 0 ? `EJEMPLO ${c.ejemplo}` : String(c.ejemplo)))),
  ].join('\r\n') + '\r\n';
}
