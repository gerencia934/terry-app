// PDF del acta / certificado. Se genera SOLO desde el «contenido» guardado al emitir (copia fija),
// así el documento es reproducible aunque después cambien clientes, permisos o tarifas.
// Formato propio de TERRY-GO (provisional hasta que Terra Viva apruebe su formato oficial).
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

export interface ContenidoActa {
  version: 1;
  origen: 'GENERADA' | 'CARGADA';
  tipo: 'DISPOSICION' | 'CONCILIACION' | 'APROVECHAMIENTO';
  numero: string;
  emitidaEn: string;
  periodo: { desde: string; hasta: string };
  emisor: { razonSocial: string; nit: string };
  destino: { razonSocial: string; nit: string; municipio: string | null };
  cliente: { razonSocial: string; nit: string; dv: string | null };
  sedes: { codigo: string | null; nombre: string; direccion: string | null; municipio: string | null; latitud: number | null; longitud: number | null }[];
  lineas: {
    manifiesto: string; fechaServicio: string; residuo: string; codigoInterno: string | null; peligroso: boolean; corrientes: string[];
    sede: string; cantidad: number; unidad: string; tratamiento: string; soporte: string[];
  }[];
  totales: { unidad: string; cantidad: number }[];
  transporte: { manifiesto: string; vehiculo: string | null; transportador: string }[];
  marcoLegal: { acto: string; autoridad: string; alcance: string; vence: string | null }[];
  verificacion: { codigo: string; url: string };
}

const TITULOS = {
  DISPOSICION: 'CERTIFICADO DE TRATAMIENTO Y DISPOSICIÓN FINAL',
  APROVECHAMIENTO: 'CERTIFICADO DE APROVECHAMIENTO',
  CONCILIACION: 'ACTA DE CONCILIACIÓN DE RESIDUOS',
} as const;
const VERDE = '#0C481E', VERDE_CLARO = '#E2F1E5', GRIS = '#55615B';
const fecha = (iso: string) => { const [a, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${a}`; };
const num = (v: number) => v.toLocaleString('es-CO', { maximumFractionDigits: 2 });

export async function pdfActa(c: ContenidoActa): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'LETTER', margins: { top: 48, bottom: 60, left: 48, right: 48 }, bufferPages: true,
    info: { Title: `${TITULOS[c.tipo]} ${c.numero}`, Author: c.emisor.razonSocial, Creator: 'TERRY-GO', Subject: `Verificación: ${c.verificacion.url}` } });
  const partes: Buffer[] = [];
  doc.on('data', (b: Buffer) => partes.push(b));
  const listo = new Promise<Buffer>((ok) => doc.on('end', () => ok(Buffer.concat(partes))));
  const ancho = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const x0 = doc.page.margins.left;

  // ---------- Encabezado con QR ----------
  const qr = await QRCode.toBuffer(c.verificacion.url, { type: 'png', errorCorrectionLevel: 'M', margin: 1, width: 300 });
  doc.image(qr, x0 + ancho - 92, 44, { width: 92 });
  doc.fontSize(7).fillColor(GRIS).text('Verifique este documento', x0 + ancho - 110, 140, { width: 110, align: 'center' })
    .text(c.verificacion.codigo, x0 + ancho - 110, doc.y, { width: 110, align: 'center' });
  doc.fillColor(VERDE).font('Helvetica-Bold').fontSize(15).text(c.emisor.razonSocial, x0, 50, { width: ancho - 120 });
  doc.font('Helvetica').fontSize(9).fillColor(GRIS).text(`NIT ${c.emisor.nit} · Planta: ${c.destino.razonSocial}${c.destino.municipio ? ` (${c.destino.municipio})` : ''}`, { width: ancho - 120 });
  doc.moveDown(0.8).font('Helvetica-Bold').fontSize(13).fillColor('black').text(TITULOS[c.tipo], { width: ancho - 120 });
  doc.font('Helvetica').fontSize(10).text(`N.º ${c.numero} · Emitido el ${fecha(c.emitidaEn)} · Periodo ${fecha(c.periodo.desde)} a ${fecha(c.periodo.hasta)}`, { width: ancho - 120 });
  if (c.origen === 'CARGADA') doc.fontSize(8).fillColor(GRIS).text('Acta emitida por el gestor aliado; el original se conserva adjunto en TERRY-GO.', { width: ancho - 120 });
  doc.y = Math.max(doc.y, 168);

  const seccion = (t: string) => {
    if (doc.y > doc.page.height - doc.page.margins.bottom - 60) doc.addPage();
    doc.moveDown(0.6).font('Helvetica-Bold').fontSize(11).fillColor(VERDE).text(t, x0, doc.y, { width: ancho }).moveDown(0.3).fillColor('black').font('Helvetica').fontSize(9);
  };
  /** Tabla simple con salto de página y encabezado repetido. */
  const tabla = (cols: { t: string; w: number; der?: boolean }[], filas: string[][]) => {
    const pad = 3, fin = () => doc.page.height - doc.page.margins.bottom;
    const fila = (celdas: string[], encabezado = false) => {
      doc.font(encabezado ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
      const alto = Math.max(...celdas.map((v, i) => doc.heightOfString(v || '—', { width: cols[i].w * ancho - pad * 2 }))) + pad * 2;
      if (doc.y + alto > fin()) { doc.addPage(); if (!encabezado) fila(cols.map((k) => k.t), true); }
      const y = doc.y;
      if (encabezado) doc.rect(x0, y, ancho, alto).fill(VERDE_CLARO).fillColor('black');
      let x = x0;
      celdas.forEach((v, i) => { doc.fillColor('black').text(v || '—', x + pad, y + pad, { width: cols[i].w * ancho - pad * 2, align: cols[i].der ? 'right' : 'left' }); x += cols[i].w * ancho; });
      doc.moveTo(x0, y + alto).lineTo(x0 + ancho, y + alto).lineWidth(0.3).strokeColor('#B7C4BC').stroke();
      doc.y = y + alto;
    };
    fila(cols.map((k) => k.t), true);
    filas.forEach((f) => fila(f));
    doc.x = x0;
  };

  // ---------- 1. Generador ----------
  seccion('1. Generador');
  doc.text(`${c.cliente.razonSocial} · NIT ${c.cliente.nit}${c.cliente.dv ? `-${c.cliente.dv}` : ''}`, x0, doc.y, { width: ancho }).moveDown(0.3);
  tabla([{ t: 'Sede', w: 0.26 }, { t: 'Dirección', w: 0.32 }, { t: 'Municipio', w: 0.18 }, { t: 'Coordenadas', w: 0.24 }],
    c.sedes.map((s) => [`${s.codigo ? `${s.codigo} · ` : ''}${s.nombre}`, s.direccion ?? '', s.municipio ?? '',
      s.latitud !== null && s.longitud !== null ? `${s.latitud.toFixed(5)}, ${s.longitud.toFixed(5)}` : 'Sin registro']));

  // ---------- 2. Residuos ----------
  seccion('2. Residuos y servicios gestionados');
  tabla([{ t: 'Manifiesto', w: 0.13 }, { t: 'Fecha', w: 0.09 }, { t: 'Residuo / servicio', w: 0.22 }, { t: 'Cantidad', w: 0.08, der: true }, { t: 'Unidad', w: 0.07 },
    { t: 'Tratamiento', w: 0.18 }, { t: 'Soporte legal', w: 0.23 }],
    c.lineas.map((l) => [l.manifiesto, fecha(l.fechaServicio), `${l.residuo}${l.corrientes.length ? ` (${l.corrientes.join(', ')})` : ''}${l.peligroso ? ' · RESPEL' : ''}`,
      num(l.cantidad), l.unidad, l.tratamiento, l.soporte.join('; ')]));
  doc.moveDown(0.3).font('Helvetica-Bold').fontSize(9).text(`Total: ${c.totales.map((t) => `${num(t.cantidad)} ${t.unidad}`).join(' · ')}`, x0, doc.y, { width: ancho });

  // ---------- 3. Transporte ----------
  if (c.transporte.length) {
    seccion('3. Transporte');
    tabla([{ t: 'Manifiesto', w: 0.2 }, { t: 'Vehículo', w: 0.25 }, { t: 'Transportador', w: 0.55 }], c.transporte.map((t) => [t.manifiesto, t.vehiculo ?? '', t.transportador]));
  }

  // ---------- 4. Marco legal y declaración ----------
  seccion(`${c.transporte.length ? 4 : 3}. Marco legal`);
  for (const p of c.marcoLegal) doc.text(`• ${p.acto} (${p.autoridad}): ${p.alcance}${p.vence ? `. Vigente hasta ${fecha(p.vence)}` : ''}.`, x0, doc.y, { width: ancho });
  const peligrosos = c.lineas.some((l) => l.peligroso);
  doc.moveDown(0.5).text(
    `${c.emisor.razonSocial} certifica que recibió y gestionó los residuos y servicios relacionados en este documento, en las cantidades ` +
    `conciliadas con el generador, mediante los tratamientos indicados y al amparo de los actos administrativos citados.` +
    (peligrosos ? ' Los residuos peligrosos se gestionaron conforme al Decreto 1076 de 2015 (Libro 2, Parte 2, Título 6) y a la Ley 1252 de 2008.' : ''),
    x0, doc.y, { width: ancho, align: 'justify' });

  // ---------- Firma ----------
  if (doc.y > doc.page.height - doc.page.margins.bottom - 90) doc.addPage();
  doc.moveDown(3.5);
  const yf = doc.y;
  doc.moveTo(x0, yf).lineTo(x0 + 220, yf).lineWidth(0.6).strokeColor('black').stroke();
  doc.font('Helvetica-Bold').fontSize(9).text('Representante legal', x0, yf + 4).font('Helvetica').text(c.emisor.razonSocial);

  // ---------- Pie de página en todas las hojas ----------
  const rango = doc.bufferedPageRange();
  for (let i = 0; i < rango.count; i++) {
    doc.switchToPage(rango.start + i);
    const margen = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // escribir dentro del margen sin que pdfkit cree otra página
    const y = doc.page.height - 42;
    doc.font('Helvetica').fontSize(7).fillColor(GRIS)
      .text(`Documento generado en TERRY-GO. Verifique su autenticidad en ${c.verificacion.url}`, x0, y, { width: ancho - 70, lineBreak: false })
      .text(`Página ${i + 1} de ${rango.count}`, x0 + ancho - 70, y, { width: 70, align: 'right', lineBreak: false });
    doc.page.margins.bottom = margen;
  }
  doc.end();
  return listo;
}
