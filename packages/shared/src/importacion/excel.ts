import type ExcelJSNS from 'exceljs';
import type { Plantilla } from './definiciones';
import { CODIGOS_BASE } from '../declaraciones/catalogos';

// ExcelJS se carga solo cuando se usa (no pesa en el arranque de la app web; en el API se carga una vez).
type ExcelJS = typeof ExcelJSNS;
let lib: ExcelJS | null = null;
async function excel(): Promise<ExcelJS> {
  if (!lib) { const m = await import('exceljs'); lib = ((m as unknown as { default?: ExcelJS }).default ?? m) as ExcelJS; }
  return lib;
}

const VERDE = 'FF1E7838', VERDE_OSC = 'FF0C481E', CREMA = 'FFE2F1E5', GRIS = 'FF6B7A72';
const FILAS_VALIDACION = 2000;
const colLetra = (n: number) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

/** Genera la plantilla .xlsx: hoja «Plantilla» (para diligenciar), «Instrucciones» y «Listas» (oculta). */
export async function construirPlantilla(p: Plantilla): Promise<ArrayBuffer> {
  const X = await excel();
  const wb = new X.Workbook();
  wb.creator = 'Terra Viva S.A.S. E.S.P.'; wb.created = new Date();

  // ---- Hoja de listas (fuente de los desplegables) ----
  const listas = wb.addWorksheet('Listas', { state: 'veryHidden' });
  const rangoLista: Record<string, string> = {};
  let li = 1;
  // Columnas de código de un solo valor: desplegable con los códigos iniciales (el servidor valida contra los vigentes).
  const valores = (c: Plantilla['columnas'][number]) => c.opciones ?? (c.tipo === 'codigo' && !c.multiple && c.catalogo ? CODIGOS_BASE[c.catalogo] : undefined);
  p.columnas.filter((c) => valores(c)).forEach((c) => {
    const ops = valores(c)!;
    ops.forEach((o, i) => { listas.getCell(i + 1, li).value = o; });
    rangoLista[c.key] = `Listas!$${colLetra(li)}$1:$${colLetra(li)}$${ops.length}`;
    li++;
  });

  // ---- Hoja para diligenciar ----
  const ws = wb.addWorksheet('Plantilla', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = p.columnas.map((c) => ({ header: c.header + (c.requerido ? ' *' : ''), key: c.key, width: c.ancho ?? 16 }));
  const h = ws.getRow(1);
  h.height = 34;
  h.eachCell((cell, i) => {
    const req = p.columnas[i - 1].requerido;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Calibri', size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: req ? VERDE_OSC : VERDE } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF8FBF9A' } } };
    cell.note = p.columnas[i - 1].ayuda || (req ? 'Obligatorio' : 'Opcional');
  });
  // Fila de ejemplo (el lector la ignora porque empieza con «EJEMPLO»)
  const ej = ws.addRow(p.columnas.map((c, i) => (i === 0 ? `EJEMPLO ${c.ejemplo}` : c.ejemplo)));
  ej.eachCell((cell) => { cell.font = { italic: true, color: { argb: GRIS } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CREMA } }; });

  // Validaciones de datos (listas desplegables, números, fechas)
  p.columnas.forEach((c, i) => {
    const L = colLetra(i + 1);
    for (let r = 2; r <= FILAS_VALIDACION; r++) {
      const cell = ws.getCell(`${L}${r}`);
      if (rangoLista[c.key]) cell.dataValidation = { type: 'list', allowBlank: !c.requerido, formulae: [rangoLista[c.key]], showErrorMessage: c.tipo !== 'codigo' /* un código nuevo del catálogo no debe bloquearse en Excel */, errorTitle: c.header, error: 'Elija un valor de la lista.' };
      else if (c.tipo === 'numero') cell.dataValidation = { type: 'decimal', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [-1e12], showErrorMessage: true, error: 'Escriba un número.' };
      else if (c.tipo === 'fecha') cell.numFmt = 'yyyy-mm-dd';
      else if (c.tipo === 'texto') cell.numFmt = '@';
    }
  });
  ws.autoFilter = { from: 'A1', to: `${colLetra(p.columnas.length)}1` };

  // ---- Instrucciones ----
  const ins = wb.addWorksheet('Instrucciones');
  ins.columns = [{ width: 34 }, { width: 13 }, { width: 14 }, { width: 46 }, { width: 30 }];
  ins.mergeCells('A1:E1');
  ins.getCell('A1').value = `Terra Viva S.A.S. E.S.P. · Plantilla de cargue masivo: ${p.nombre}`;
  ins.getCell('A1').font = { bold: true, size: 14, color: { argb: VERDE_OSC } };
  ins.mergeCells('A2:E2');
  ins.getCell('A2').value = `${p.descripcion} Diligencie la hoja «Plantilla» desde la fila 3 (la fila 2 es un ejemplo y no se carga). No cambie los encabezados. Las columnas con * son obligatorias.`;
  ins.getCell('A2').alignment = { wrapText: true, vertical: 'top' };
  ins.getRow(2).height = 46;
  const hi = ins.addRow(['Columna', 'Obligatoria', 'Formato', 'Instrucción', 'Valores permitidos']);
  hi.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE } }; });
  p.columnas.forEach((c) => {
    const formato = { texto: 'Texto', numero: 'Número', fecha: 'AAAA-MM-DD', lista: 'Lista', email: 'Correo', si_no: 'Sí / No', codigo: c.multiple ? 'Códigos separados por ;' : 'Código' }[c.tipo];
    const permitidos = c.opciones?.join(' · ') ?? (c.catalogo ? CODIGOS_BASE[c.catalogo].join(' · ') : '');
    const r = ins.addRow([c.header, c.requerido ? 'Sí' : 'No', formato, c.ayuda, permitidos]);
    r.alignment = { wrapText: true, vertical: 'top' };
  });
  wb.views = [{ activeTab: 1, x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, visibility: 'visible' }];
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/** Lee la hoja «Plantilla» (o la primera) y devuelve filas como {key: texto}. */
export async function leerArchivo(p: Plantilla, buf: ArrayBuffer): Promise<{ filas: Record<string, string>[]; faltantes: string[] }> {
  const X = await excel();
  const wb = new X.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('Plantilla') ?? wb.worksheets.find((w) => w.state === 'visible')!;
  const limpia = (s: string) => s.replace(/\*/g, '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  const mapa = new Map<number, string>();
  ws.getRow(1).eachCell((cell, col) => {
    const c = p.columnas.find((x) => limpia(x.header) === limpia(String(cell.text ?? '')));
    if (c) mapa.set(col, c.key);
  });
  const faltantes = p.columnas.filter((c) => c.requerido && ![...mapa.values()].includes(c.key)).map((c) => c.header);
  const filas: Record<string, string>[] = [];
  ws.eachRow((row, r) => {
    if (r === 1) return;
    const f: Record<string, string> = {};
    let vacia = true;
    mapa.forEach((key, col) => {
      const cell = row.getCell(col);
      let v = '';
      if (cell.value instanceof Date) v = cell.value.toISOString().slice(0, 10);
      else if (cell.value && typeof cell.value === 'object' && 'result' in cell.value) v = String((cell.value as { result: unknown }).result ?? '');
      else v = String(cell.text ?? '').trim();
      if (v) vacia = false;
      f[key] = v;
    });
    const primera = f[p.columnas[0].key] ?? '';
    if (!vacia && !primera.toUpperCase().startsWith('EJEMPLO')) filas.push({ ...f, __fila: String(r) });
  });
  return { filas, faltantes };
}

/** Exporta filas con una columna de errores (para que el usuario corrija y vuelva a cargar). */
export async function exportarErrores(p: Plantilla, filas: { n: number; datos: Record<string, string>; errores: string[] }[]): Promise<ArrayBuffer> {
  const X = await excel();
  const wb = new X.Workbook();
  const ws = wb.addWorksheet('Plantilla');
  ws.columns = [...p.columnas.map((c) => ({ header: c.header + (c.requerido ? ' *' : ''), key: c.key, width: c.ancho ?? 16 })), { header: 'ERRORES (borre esta columna antes de recargar)', key: '_e', width: 60 }];
  ws.getRow(1).font = { bold: true };
  filas.forEach((f) => { const r = ws.addRow({ ...f.datos, _e: f.errores.join(' | ') }); r.getCell('_e').font = { color: { argb: 'FFBE2828' } }; });
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
