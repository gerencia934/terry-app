// PDF del acta / certificado. Se genera SOLO desde el «contenido» guardado al emitir (copia fija),
// así el documento es reproducible aunque después cambien clientes, permisos o tarifas.
// Formato propio de TERRY-GO (provisional hasta que Terra Viva apruebe su formato oficial).
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

export interface ContenidoActa {
  /** 1: contenido de las primeras actas. 2: agrega generador, textos legales, firma y certificaciones (documentos reales). */
  version: 1 | 2;
  origen: 'GENERADA' | 'CARGADA';
  tipo: 'DISPOSICION' | 'CONCILIACION' | 'APROVECHAMIENTO';
  numero: string;
  emitidaEn: string;
  periodo: { desde: string; hasta: string };
  emisor: { razonSocial: string; nit: string };
  destino: { razonSocial: string; nit: string; municipio: string | null };
  cliente: { razonSocial: string; nit: string; dv: string | null };
  /** v2: certificado de UN generador de un cliente gestor (su razón social encabeza el certificado). */
  generador?: { razonSocial: string; nit: string } | null;
  /** v2: el cliente es un gestor con varios generadores (cada línea dice el suyo). */
  clienteGestor?: boolean;
  sedes: { codigo: string | null; nombre: string; direccion: string | null; municipio: string | null; latitud: number | null; longitud: number | null }[];
  lineas: {
    manifiesto: string; fechaServicio: string; residuo: string; codigoInterno: string | null; peligroso: boolean; corrientes: string[];
    sede: string; cantidad: number; unidad: string; tratamiento: string; soporte: string[];
    generador?: string; generadorNit?: string | null; // v2
  }[];
  totales: { unidad: string; cantidad: number }[];
  transporte: { manifiesto: string; vehiculo: string | null; transportador: string }[];
  marcoLegal: { acto: string; autoridad: string; alcance: string; vence: string | null }[];
  verificacion: { codigo: string; url: string };
  /** v2: párrafos de respaldo legal que aplican a las disposiciones del certificado (con su versión). */
  textosLegales?: { codigo: string; version: number; titulo: string; texto: string }[];
  firma?: { ciudad: string | null; representante: string | null; cargo: string | null };
  certificaciones?: { norma: string; numero: string }[];
}

const TITULOS = {
  DISPOSICION: 'CERTIFICADO DE TRATAMIENTO Y DISPOSICIÓN FINAL',
  APROVECHAMIENTO: 'CERTIFICADO DE APROVECHAMIENTO',
  CONCILIACION: 'ACTA DE CONCILIACIÓN DE RESIDUOS',
} as const;
const VERDE = '#0C481E', VERDE_CLARO = '#E2F1E5', GRIS = '#55615B';
/** Fechas calendario (DATE): se leen tal cual. */
const fecha = (iso: string) => { const [a, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${a}`; };
/** Instantes (emisión): se muestran en hora de Colombia, no en UTC. */
const fechaInstante = (iso: string) => new Date(iso).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric' });
const num = (v: number) => v.toLocaleString('es-CO', { maximumFractionDigits: 2 });
const fechaLarga = (iso: string) => new Date(iso).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'long', year: 'numeric' });

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
  doc.font('Helvetica').fontSize(10).text(`N.º ${c.numero} · Emitido el ${fechaInstante(c.emitidaEn)} · Periodo ${fecha(c.periodo.desde)} a ${fecha(c.periodo.hasta)}`, { width: ancho - 120 });
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
  const nitCliente = `${c.cliente.nit}${c.cliente.dv ? `-${c.cliente.dv}` : ''}`;
  if (c.generador) {
    // Cliente gestor: el certificado es del generador; el gestor figura como quien contrató el servicio
    doc.font('Helvetica-Bold').text(`${c.generador.razonSocial} · NIT ${c.generador.nit}`, x0, doc.y, { width: ancho })
      .font('Helvetica').text(`Gestor que contrató el servicio: ${c.cliente.razonSocial} · NIT ${nitCliente}`, x0, doc.y, { width: ancho }).moveDown(0.3);
  } else {
    doc.text(`${c.cliente.razonSocial} · NIT ${nitCliente}${c.clienteGestor ? ' (gestor: el generador de cada residuo va en la relación)' : ''}`, x0, doc.y, { width: ancho }).moveDown(0.3);
  }
  tabla([{ t: 'Sede', w: 0.26 }, { t: 'Dirección', w: 0.32 }, { t: 'Municipio', w: 0.18 }, { t: 'Coordenadas', w: 0.24 }],
    c.sedes.map((s) => [`${s.codigo ? `${s.codigo} · ` : ''}${s.nombre}`, s.direccion ?? '', s.municipio ?? '',
      s.latitud !== null && s.longitud !== null ? `${s.latitud.toFixed(5)}, ${s.longitud.toFixed(5)}` : 'Sin registro']));

  // ---------- 2. Residuos ----------
  seccion('2. Residuos y servicios gestionados');
  if (c.clienteGestor && !c.generador) {
    // Consolidado del gestor: cada línea con su generador
    tabla([{ t: 'Manifiesto', w: 0.12 }, { t: 'Fecha', w: 0.08 }, { t: 'Generador', w: 0.17 }, { t: 'Residuo / servicio', w: 0.17 }, { t: 'Cantidad', w: 0.08, der: true },
      { t: 'Unidad', w: 0.06 }, { t: 'Tratamiento', w: 0.14 }, { t: 'Licencia y/o permiso', w: 0.18 }],
      c.lineas.map((l) => [l.manifiesto, fecha(l.fechaServicio), `${l.generador ?? l.sede}${l.generadorNit ? ` · NIT ${l.generadorNit}` : ''}`,
        `${l.residuo}${l.corrientes.length ? ` (${l.corrientes.join(', ')})` : ''}${l.peligroso ? ' · RESPEL' : ''}`, num(l.cantidad), l.unidad, l.tratamiento, l.soporte.join('; ')]));
  } else {
    tabla([{ t: 'Manifiesto', w: 0.13 }, { t: 'Fecha', w: 0.09 }, { t: 'Residuo / servicio', w: 0.22 }, { t: 'Cantidad', w: 0.08, der: true }, { t: 'Unidad', w: 0.07 },
      { t: 'Tratamiento', w: 0.18 }, { t: c.version >= 2 ? 'Licencia y/o permiso' : 'Soporte legal', w: 0.23 }],
      c.lineas.map((l) => [l.manifiesto, fecha(l.fechaServicio), `${l.residuo}${l.corrientes.length ? ` (${l.corrientes.join(', ')})` : ''}${l.peligroso ? ' · RESPEL' : ''}`,
        num(l.cantidad), l.unidad, l.tratamiento, l.soporte.join('; ')]));
  }
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
    (peligrosos && !c.textosLegales ? ' Los residuos peligrosos se gestionaron conforme al Decreto 1076 de 2015 (Libro 2, Parte 2, Título 6) y a la Ley 1252 de 2008.' : ''),
    x0, doc.y, { width: ancho, align: 'justify' });
  // v2: solo los párrafos que aplican a las disposiciones de este certificado (administrados en Ajustes, con versión)
  for (const t of c.textosLegales ?? []) {
    if (doc.y > doc.page.height - doc.page.margins.bottom - 50) doc.addPage();
    doc.moveDown(0.4).font('Helvetica-Bold').fontSize(9).text(t.titulo, x0, doc.y, { width: ancho })
      .font('Helvetica').text(t.texto, x0, doc.y, { width: ancho, align: 'justify' });
  }

  // ---------- Firma ----------
  if (doc.y > doc.page.height - doc.page.margins.bottom - 110) doc.addPage();
  if (c.firma?.ciudad) doc.moveDown(0.8).font('Helvetica').fontSize(9).text(`Lugar y fecha: ${c.firma.ciudad}, ${fechaLarga(c.emitidaEn)}.`, x0, doc.y, { width: ancho });
  doc.moveDown(3.2);
  const yf = doc.y;
  doc.moveTo(x0, yf).lineTo(x0 + 220, yf).lineWidth(0.6).strokeColor('black').stroke();
  doc.font('Helvetica-Bold').fontSize(9).text(c.firma?.representante || 'Representante legal', x0, yf + 4)
    .font('Helvetica').text(c.firma?.representante ? (c.firma.cargo || 'Representante legal') : c.emisor.razonSocial);
  if (c.firma?.representante) doc.text(c.emisor.razonSocial);
  // Certificaciones del sistema de gestión (solo las que tienen número)
  const sellos = (c.certificaciones ?? []).filter((x) => x.numero?.trim());
  if (sellos.length) doc.moveDown(0.8).fontSize(7.5).fillColor(GRIS).text(`Sistema de gestión certificado: ${sellos.map((x) => `${x.norma} (certificado ${x.numero})`).join(' · ')}`, x0, doc.y, { width: ancho }).fillColor('black');

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
