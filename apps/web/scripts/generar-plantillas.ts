// Genera las plantillas .xlsx en docs/plantillas y hace una prueba de ida y vuelta:
// llena una plantilla con filas buenas y malas, la vuelve a leer y valida.
// Uso: npx tsx scripts/generar-plantillas.ts
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { PLANTILLAS, plantilla, validarFilas, dvNit } from '../../../packages/shared/src/importacion/definiciones';
import { construirPlantilla, leerArchivo } from '../../../packages/shared/src/importacion/excel';
import { contextoActual } from '../src/cargues/contexto';

const out = resolve(import.meta.dirname, '../../../docs/plantillas');
mkdirSync(out, { recursive: true });

for (const p of PLANTILLAS) {
  const buf = await construirPlantilla(p);
  writeFileSync(resolve(out, p.archivo), Buffer.from(buf));
  console.log(`✓ ${p.archivo} (${p.columnas.length} columnas)`);
}

// ---- Prueba: DV de Terra Viva (NIT 901089780-8) ----
console.log(`\nDV 901089780 → ${dvNit('901089780')} (esperado 8)`);

// ---- Prueba de ida y vuelta con la plantilla de declaraciones ----
const p = plantilla('decl-residuos');
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(await construirPlantilla(p));
const ws = wb.getWorksheet('Plantilla')!;
const filas: (string | number)[][] = [
  ['900112345', 'Planta extractora', 'RP-018', 'Lodos aceitosos', 'Semisólido / lodo', 'Peligroso (RESPEL)', 'Industrial', 'Lodos', 'Gestión de residuos', 'Biorremediación (landfarming)', 'Big bag 1 m³', 'Sí', 'Y18', '', 'No', 'kg', 8000, 'Mensual', 780, ''],
  ['900112345', 'Planta extractora', 'RP-018', 'Duplicada', 'Semisólido / lodo', '', '', 'Lodos', '', 'Biorremediación (landfarming)', '', 'Sí', 'Y18', '', '', 'kg', 1, '', 1, ''],
  ['999999999', 'Sede X', 'RP-001', 'Cliente inexistente', 'Sólido', '', '', 'RESPEL', '', 'Incineración (gestor aliado)', '', 'Sí', 'Y99', '', '', 'kg', 'mucho', '', '', ''],
  ['804009876', 'Sede Cabecera', 'RH-001', 'Biosanitarios', 'Sólido', '', '', 'Hospitalarios y biomédicos', '', 'Incineración (gestor aliado)', 'Bolsa roja', 'Sí', 'Y1', '', 'No', 'kg', 1800, 'Semanal', 3200, ''],
];
filas.forEach((f, i) => ws.getRow(3 + i).values = f);
const lleno = await wb.xlsx.writeBuffer();
const { filas: leidas, faltantes } = await leerArchivo(p, lleno as ArrayBuffer);
const res = validarFilas(p, leidas, contextoActual());
console.log(`\nIda y vuelta «${p.nombre}»: ${leidas.length} filas leídas, columnas faltantes: ${faltantes.length}`);
res.forEach((r) => console.log(`  fila ${r.n}: ${r.errores.length ? '✗ ' + r.errores.join(' · ') : '✓ válida'}${r.advertencias.length ? '  ⚠ ' + r.advertencias.join(' · ') : ''}`));
