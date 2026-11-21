// PDF del manifiesto de transporte / descarga y del recibo angosto (impresora térmica de 80 mm).
// Los dos comparten el número del manifiesto (TV####), como en la operación real (documentos reales §2).
// Formato propio de TERRY-GO: toma de los documentos reales el contenido y las reglas, no el diseño.
import PDFDocument from 'pdfkit';

export interface DatosManifiesto {
  numero: string; tipo: 'CARGUE' | 'DESCARGUE'; estado: 'PENDIENTE' | 'REALIZADO' | 'ANULADO'; fechaServicio: string;
  emisor: { razonSocial: string; nit: string; notaBascula: string | null };
  cliente: { razonSocial: string; nit: string };
  destino: string; ordenCompra: string | null; manifiestoCliente: string | null; ruta: string | null;
  transporte: {
    empresa: string; nit: string | null; placa: string | null; tipoVehiculo: string | null;
    conductor: string | null; conductorDocumento: string | null; arl: string | null; eps: string | null; auxiliar: string | null;
  };
  horaLlegada: string | null; horaSalida: string | null;
  bascula: { entrada: number | null; salida: number | null; neto: number | null };
  lineas: { generador: string; generadorNit: string | null; residuo: string; corrientes: string[]; cantidad: number; unidad: string; embalajes: string | null; tratamiento: string }[];
  observaciones: string | null;
  firmas: { titulo: string; nombre: string | null; documento: string | null; imagen: Buffer | null }[];
  realizadoEn: string | null; anulacion: string | null;
}

/** Nota de la báscula (respuesta C2): cita el certificado de calibración; vencido a la fecha del servicio, sale con alerta. */
export function notaBascula(configuracion: unknown, fechaServicio: Date): string | null {
  const conf = (configuracion ?? {}) as { notaBascula?: string; bascula?: { identificacion?: string; certificado?: string; fecha?: string; laboratorio?: string; vigenteHasta?: string } };
  const b = conf.bascula;
  const f = (iso: string) => iso.split('-').reverse().join('-');
  return b?.certificado?.trim()
    ? `${b.vigenteHasta && b.vigenteHasta < fechaServicio.toISOString().slice(0, 10) ? `ATENCIÓN: el certificado de calibración venció el ${f(b.vigenteHasta)}; HSEQ debe revisar este pesaje. ` : ''}`
      + `Pesaje en báscula ${b.identificacion?.trim() || ''}, calibrada según el certificado N.° ${b.certificado.trim()}${b.fecha ? ` del ${f(b.fecha)}` : ''}`
      + `${b.laboratorio?.trim() ? `, expedido por ${b.laboratorio.trim()}` : ''}${b.vigenteHasta ? `, vigente hasta ${f(b.vigenteHasta)}` : ''}.`
    : conf.notaBascula?.trim() || null;
}

const VERDE = '#0C481E', VERDE_CLARO = '#E2F1E5', GRIS = '#55615B';
const fecha = (iso: string) => { const [a, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${a}`; };
const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—');
const num = (v: number | null) => (v === null ? '—' : v.toLocaleString('es-CO', { maximumFractionDigits: 2 }));
const TITULO = { CARGUE: 'MANIFIESTO DE TRANSPORTE DE RESIDUOS', DESCARGUE: 'MANIFIESTO DE DESCARGA Y RECEPCIÓN DE RESIDUOS' } as const;

const terminar = (doc: PDFKit.PDFDocument) => {
  const partes: Buffer[] = [];
  doc.on('data', (b: Buffer) => partes.push(b));
  return new Promise<Buffer>((ok) => doc.on('end', () => ok(Buffer.concat(partes))));
};

/** Manifiesto completo, tamaño carta. */
export async function pdfManifiesto(d: DatosManifiesto): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'LETTER', margins: { top: 44, bottom: 56, left: 44, right: 44 }, bufferPages: true,
    info: { Title: `Manifiesto ${d.numero}`, Author: d.emisor.razonSocial, Creator: 'Terry-App Residuos' } });
  const listo = terminar(doc);
  const x0 = doc.page.margins.left, ancho = doc.page.width - x0 - doc.page.margins.right;

  doc.fillColor(VERDE).font('Helvetica-Bold').fontSize(14).text(d.emisor.razonSocial, x0, 44, { width: ancho - 140 });
  doc.font('Helvetica').fontSize(9).fillColor(GRIS).text(`NIT ${d.emisor.nit}`, { width: ancho - 140 });
  doc.font('Helvetica-Bold').fontSize(18).fillColor('black').text(d.numero, x0 + ancho - 140, 44, { width: 140, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor(GRIS).text(`Servicio: ${fecha(d.fechaServicio)}`, x0 + ancho - 140, doc.y, { width: 140, align: 'right' });
  doc.moveDown(1.2).font('Helvetica-Bold').fontSize(12).fillColor('black').text(TITULO[d.tipo], x0, doc.y, { width: ancho });
  if (d.estado === 'ANULADO') doc.font('Helvetica-Bold').fontSize(11).fillColor('#B42318').text(`ANULADO${d.anulacion ? ` · ${d.anulacion}` : ''}`, x0, doc.y, { width: ancho });
  if (d.estado === 'PENDIENTE') doc.font('Helvetica').fontSize(9).fillColor(GRIS).text('Borrador: aún no está grabado con firmas.', x0, doc.y, { width: ancho });

  const seccion = (t: string) => {
    if (doc.y > doc.page.height - doc.page.margins.bottom - 70) doc.addPage();
    doc.moveDown(0.7).font('Helvetica-Bold').fontSize(10.5).fillColor(VERDE).text(t, x0, doc.y, { width: ancho }).moveDown(0.25).fillColor('black').font('Helvetica').fontSize(9);
  };
  const par = (pares: [string, string][]) => {
    const col = ancho / 2;
    for (let i = 0; i < pares.length; i += 2) {
      const y = doc.y; let alto = 0;
      pares.slice(i, i + 2).forEach(([k, v], j) => {
        doc.font('Helvetica-Bold').fontSize(8).fillColor(GRIS).text(k, x0 + j * col, y, { width: col - 8 });
        doc.font('Helvetica').fontSize(9).fillColor('black').text(v || '—', x0 + j * col, doc.y, { width: col - 8 });
        alto = Math.max(alto, doc.y - y);
      });
      doc.y = y + alto + 3;
    }
    doc.x = x0;
  };

  seccion('Generador y destino');
  par([['Cliente', `${d.cliente.razonSocial} · NIT ${d.cliente.nit}`], ['Destino', d.destino],
    ['Orden de compra', d.ordenCompra ?? ''], ['Documento del cliente', d.manifiestoCliente ?? ''], ...(d.ruta ? [['Ruta', d.ruta] as [string, string]] : [])]);

  seccion(d.tipo === 'DESCARGUE' ? 'Transportador (externo)' : 'Transporte');
  const t = d.transporte;
  par([['Empresa transportadora', `${t.empresa}${t.nit ? ` · NIT ${t.nit}` : ''}`], ['Vehículo', [t.placa, t.tipoVehiculo].filter(Boolean).join(' · ')],
    ['Conductor', `${t.conductor ?? '—'}${t.conductorDocumento ? ` · CC ${t.conductorDocumento}` : ''}`], ['ARL / EPS del conductor', `${t.arl ?? '—'} / ${t.eps ?? '—'}`],
    ['Auxiliar', t.auxiliar ?? ''], ['Llegada / salida', `${hora(d.horaLlegada)} / ${hora(d.horaSalida)}`]]);

  seccion('Báscula (kg)');
  par([['Entrada (lleno)', num(d.bascula.entrada)], ['Salida (vacío)', num(d.bascula.salida)], ['Neto', num(d.bascula.neto)], ['Calibración', d.emisor.notaBascula ?? '']]);

  seccion('Residuos y servicios');
  const cols = [{ t: 'Generador', w: 0.25 }, { t: 'Residuo / servicio', w: 0.27 }, { t: 'Cantidad', w: 0.1, der: true }, { t: 'Unidad', w: 0.07 }, { t: 'Embalaje', w: 0.12 }, { t: 'Tratamiento', w: 0.19 }];
  const fila = (celdas: string[], encabezado = false) => {
    doc.font(encabezado ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    const alto = Math.max(...celdas.map((v, i) => doc.heightOfString(v || '—', { width: cols[i].w * ancho - 6 }))) + 6;
    if (doc.y + alto > doc.page.height - doc.page.margins.bottom) { doc.addPage(); if (!encabezado) fila(cols.map((k) => k.t), true); }
    const y = doc.y;
    if (encabezado) doc.rect(x0, y, ancho, alto).fill(VERDE_CLARO);
    let x = x0;
    celdas.forEach((v, i) => { doc.fillColor('black').text(v || '—', x + 3, y + 3, { width: cols[i].w * ancho - 6, align: cols[i].der ? 'right' : 'left' }); x += cols[i].w * ancho; });
    doc.moveTo(x0, y + alto).lineTo(x0 + ancho, y + alto).lineWidth(0.3).strokeColor('#B7C4BC').stroke();
    doc.y = y + alto;
  };
  fila(cols.map((k) => k.t), true);
  d.lineas.forEach((l) => fila([`${l.generador}${l.generadorNit ? ` · NIT ${l.generadorNit}` : ''}`, `${l.residuo}${l.corrientes.length ? ` (${l.corrientes.join(', ')})` : ''}`,
    num(l.cantidad), l.unidad, l.embalajes ?? '', l.tratamiento]));
  doc.x = x0;
  if (d.observaciones) { seccion('Observaciones'); doc.text(d.observaciones, x0, doc.y, { width: ancho }); }

  // Firmas
  if (doc.y > doc.page.height - doc.page.margins.bottom - 130) doc.addPage();
  doc.moveDown(1.2);
  const yF = doc.y, anchoF = (ancho - 24) / Math.max(d.firmas.length, 1);
  d.firmas.forEach((f, i) => {
    const x = x0 + i * (anchoF + 24);
    if (f.imagen) { try { doc.image(f.imagen, x, yF, { fit: [anchoF, 70] }); } catch { /* firma ilegible: se deja el espacio */ } }
    doc.moveTo(x, yF + 74).lineTo(x + anchoF, yF + 74).lineWidth(0.6).strokeColor('black').stroke();
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('black').text(f.titulo, x, yF + 78, { width: anchoF });
    doc.font('Helvetica').fontSize(8.5).text([f.nombre, f.documento ? `CC ${f.documento}` : null].filter(Boolean).join(' · ') || '—', x, doc.y, { width: anchoF });
  });
  doc.y = yF + 110;
  if (d.realizadoEn) doc.font('Helvetica').fontSize(8).fillColor(GRIS).text(`Grabado el ${hora(d.realizadoEn)}`, x0, doc.y, { width: ancho });

  const rango = doc.bufferedPageRange();
  for (let i = 0; i < rango.count; i++) {
    doc.switchToPage(rango.start + i);
    const margen = doc.page.margins.bottom; doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(7).fillColor(GRIS).text(`Manifiesto ${d.numero} · generado en Terry-App · Página ${i + 1} de ${rango.count}`, x0, doc.page.height - 38, { width: ancho, align: 'center', lineBreak: false });
    doc.page.margins.bottom = margen;
  }
  doc.end();
  return listo;
}

/** Recibo inmediato de la descarga: tiquete de 80 mm para impresora térmica (mismo número del manifiesto). */
export async function pdfRecibo(d: DatosManifiesto): Promise<Buffer> {
  const ancho = 204, x0 = 11; // 80 mm ≈ 227 pt de papel, con margen
  const alto = 220 + d.lineas.length * 30 + d.firmas.length * 60 + (d.observaciones ? 36 : 0) + (d.emisor.notaBascula ? 20 : 0);
  const doc = new PDFDocument({ size: [227, alto], margins: { top: 10, bottom: 10, left: x0, right: 12 }, info: { Title: `Recibo ${d.numero}`, Creator: 'Terry-App Residuos' } });
  const listo = terminar(doc);
  const centro = (t: string, tam = 8, negrita = false) => doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(tam).fillColor('black').text(t, x0, doc.y, { width: ancho, align: 'center' });
  const linea = () => { doc.moveDown(0.3); doc.moveTo(x0, doc.y).lineTo(x0 + ancho, doc.y).dash(2, { space: 2 }).lineWidth(0.5).strokeColor('black').stroke().undash(); doc.moveDown(0.4); };
  const kv = (k: string, v: string) => { doc.font('Helvetica-Bold').fontSize(7.5).text(`${k}: `, x0, doc.y, { width: ancho, continued: true }).font('Helvetica').text(v || '—'); };

  centro(d.emisor.razonSocial, 9, true); centro(`NIT ${d.emisor.nit}`, 7.5);
  linea();
  centro('RECIBO DE DESCARGA', 9, true); centro(d.numero, 13, true); centro(hora(d.horaSalida ?? d.realizadoEn), 7.5);
  if (d.estado === 'ANULADO') centro('*** ANULADO ***', 10, true);
  linea();
  kv('Cliente', `${d.cliente.razonSocial} (NIT ${d.cliente.nit})`);
  kv('Transportador', `${d.transporte.empresa}${d.transporte.nit ? ` (NIT ${d.transporte.nit})` : ''}`);
  kv('Placa', d.transporte.placa ?? ''); kv('Conductor', `${d.transporte.conductor ?? ''}${d.transporte.conductorDocumento ? ` · CC ${d.transporte.conductorDocumento}` : ''}`);
  kv('Llegada', hora(d.horaLlegada)); kv('Salida', hora(d.horaSalida));
  linea();
  for (const l of d.lineas) {
    doc.font('Helvetica-Bold').fontSize(7.5).text(l.residuo, x0, doc.y, { width: ancho });
    doc.font('Helvetica').fontSize(7.5).text(`${l.generador} · ${num(l.cantidad)} ${l.unidad}`, x0, doc.y, { width: ancho });
    doc.moveDown(0.2);
  }
  linea();
  kv('Peso entrada', `${num(d.bascula.entrada)} kg`); kv('Peso salida', `${num(d.bascula.salida)} kg`);
  doc.font('Helvetica-Bold').fontSize(9).text(`NETO: ${num(d.bascula.neto)} kg`, x0, doc.y, { width: ancho });
  if (d.emisor.notaBascula) doc.font('Helvetica').fontSize(6.5).text(d.emisor.notaBascula, x0, doc.y, { width: ancho });
  if (d.observaciones) { doc.moveDown(0.3); kv('Obs.', d.observaciones); }
  linea();
  for (const f of d.firmas) {
    const y = doc.y;
    if (f.imagen) { try { doc.image(f.imagen, x0 + 30, y, { fit: [ancho - 60, 34] }); } catch { /* sin imagen */ } }
    doc.y = y + 36; doc.moveTo(x0 + 20, doc.y).lineTo(x0 + ancho - 20, doc.y).lineWidth(0.5).stroke();
    doc.y += 3;
    centro(`${f.titulo}: ${f.nombre ?? '—'}${f.documento ? ` · CC ${f.documento}` : ''}`, 7);
    doc.moveDown(0.4);
  }
  centro('Documento generado en Terry-App. El manifiesto completo lleva el mismo número.', 6);
  doc.end();
  return listo;
}
