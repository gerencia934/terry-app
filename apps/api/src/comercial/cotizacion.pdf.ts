// Cotización en PDF (módulo Comercial): el mismo marco de los documentos oficiales de Terra Viva (logo con NIT, QR de
// verificación y pie), los renglones con su tratamiento, unidad, cantidad estimada y precio, y las condiciones.
// Se arma solo desde el «contenido» guardado al enviarla (copia fija): el documento es reproducible.
import PDFDocument from 'pdfkit';
import { A4, GRIS, M, ROJO, VERDE, marcoTerraViva } from '../actas/pdf';
import { fechaLarga, nitConPuntos } from '../clientes/certificado-comercial.pdf';

export interface ContenidoCotizacion {
  version: 1;
  numero: string; // «BORRADOR» en la vista previa
  fecha: string; // AAAA-MM-DD (Colombia)
  validaHasta: string;
  ciudad: string | null;
  titulo: string;
  emisor: { razonSocial: string; nit: string; contacto?: { direccion?: string | null; municipio?: string | null; telefono?: string | null; correo?: string | null } };
  certificaciones?: { norma: string; numero: string; entidad?: string }[];
  cliente: { razonSocial: string; nit: string | null; ciudad: string | null; direccion: string | null };
  contacto: { nombre: string; cargo: string | null; correo: string | null; telefono: string | null } | null;
  asesor: { nombre: string; correo: string | null } | null;
  items: { descripcion: string; tratamiento: string | null; peligroso: boolean; unidad: string; cantidad: number | null; frecuencia: string | null; precio: number; subtotal: number | null }[];
  total: number;
  tipoNegociacion: string;
  formaPago: string;
  validezDias: number;
  condiciones: string | null;
  verificacion: { codigo: string; url: string };
}

const pesos = (n: number) => `$ ${n.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const cantidad = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 2 });

export async function pdfCotizacion(c: ContenidoCotizacion): Promise<Buffer> {
  const borrador = c.numero === 'BORRADOR';
  const doc = new PDFDocument({ size: A4, margins: { top: M.arriba, bottom: M.abajo, left: M.izq, right: M.der }, bufferPages: true,
    info: { Title: `Cotización ${c.numero}`, Author: c.emisor.razonSocial, Creator: 'Terry-App · Gestión de Residuos', Subject: c.titulo } });
  const partes: Buffer[] = [];
  doc.on('data', (b: Buffer) => partes.push(b));
  const listo = new Promise<Buffer>((ok) => doc.on('end', () => ok(Buffer.concat(partes))));
  const W = A4[0] - M.izq - M.der, x0 = M.izq;
  const asegurar = (alto: number) => { if (doc.y + alto > A4[1] - M.abajo) doc.addPage(); };
  const parrafo = (t: string, o: PDFKit.Mixins.TextOptions = {}) => { doc.font('Helvetica').fontSize(9.5).fillColor('black').text(t, x0, doc.y, { width: W, align: 'justify', lineGap: 1.5, ...o }); doc.moveDown(0.5); };

  // ---------- Título, número y destinatario ----------
  doc.font('Helvetica-Bold').fontSize(13).fillColor('black').text('COTIZACIÓN', x0, M.arriba, { width: W, align: 'center' });
  doc.fontSize(11).fillColor(borrador ? GRIS : ROJO).text(borrador ? 'BORRADOR (sin número: aún no se ha enviado)' : `N.º ${c.numero}`, { width: W, align: 'center' });
  doc.moveDown(1);
  doc.font('Helvetica').fontSize(9.5).fillColor('black').text(`${c.ciudad ? `${c.ciudad}, ` : ''}${fechaLarga(c.fecha)}`, x0, doc.y, { width: W });
  doc.moveDown(0.8);
  doc.text('Señores', x0, doc.y, { width: W });
  doc.font('Helvetica-Bold').text(c.cliente.razonSocial, { width: W });
  doc.font('Helvetica');
  if (c.cliente.nit) doc.text(`NIT ${nitConPuntos(c.cliente.nit)}`, { width: W });
  const dondeCliente = [c.cliente.direccion, c.cliente.ciudad].filter(Boolean).join(', ');
  if (dondeCliente) doc.text(dondeCliente, { width: W });
  if (c.contacto) doc.text(`Atención: ${c.contacto.nombre}${c.contacto.cargo ? `, ${c.contacto.cargo}` : ''}`, { width: W });
  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').text('Asunto: ', x0, doc.y, { width: W, continued: true }).font('Helvetica').text(c.titulo);
  doc.moveDown(0.8);
  parrafo(`Atendiendo su solicitud, ${c.emisor.razonSocial} presenta su propuesta para la recolección, transporte, tratamiento y disposición final de los residuos y los servicios que se describen:`);

  // ---------- Tabla de renglones ----------
  const cols = [
    { t: 'Residuo o servicio', w: 0.30 }, { t: 'Tratamiento', w: 0.20 }, { t: 'Unidad', w: 0.10 }, { t: 'Cant. estimada', w: 0.12, d: true },
    { t: 'Precio unitario', w: 0.14, d: true }, { t: 'Subtotal estimado', w: 0.14, d: true },
  ].map((x) => ({ ...x, w: x.w * W }));
  const xs = cols.reduce<number[]>((acc, col, i) => [...acc, i ? acc[i - 1] + cols[i - 1].w : x0], []);
  const fila = (valores: string[], o: { negrita?: boolean; fondo?: string; color?: string } = {}) => {
    doc.font(o.negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.2);
    const alto = Math.max(...valores.map((v, i) => doc.heightOfString(v || ' ', { width: cols[i].w - 6 }))) + 6;
    asegurar(alto + 2);
    const y = doc.y;
    if (o.fondo) doc.rect(x0, y, W, alto).fill(o.fondo);
    valores.forEach((v, i) => doc.fillColor(o.color ?? 'black').font(o.negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.2)
      .text(v, xs[i] + 3, y + 3, { width: cols[i].w - 6, align: cols[i].d ? 'right' : 'left' }));
    doc.moveTo(x0, y + alto).lineTo(x0 + W, y + alto).lineWidth(0.4).strokeColor('#C9D2CC').stroke();
    doc.y = y + alto;
  };
  fila(cols.map((x) => x.t), { negrita: true, fondo: VERDE, color: 'white' });
  for (const it of c.items) {
    fila([
      `${it.descripcion}${it.peligroso ? ' (peligroso)' : ''}${it.frecuencia ? `\nFrecuencia: ${it.frecuencia}` : ''}`,
      it.tratamiento ?? '—', it.unidad, it.cantidad !== null ? cantidad(it.cantidad) : '—', pesos(it.precio), it.subtotal !== null ? pesos(it.subtotal) : '—',
    ]);
  }
  doc.moveDown(0.4);
  if (c.total > 0) {
    asegurar(18);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('black').text(`Total estimado por periodo (antes de IVA): ${pesos(c.total)}`, x0, doc.y, { width: W, align: 'right' });
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(7.5).fillColor(GRIS).text('El total es una estimación con las cantidades indicadas: se factura lo realmente recibido y pesado en báscula.', x0, doc.y, { width: W, align: 'right' });
  }
  doc.moveDown(1);

  // ---------- Condiciones ----------
  asegurar(80);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('black').text('Condiciones', x0, doc.y, { width: W });
  doc.moveDown(0.3);
  const condiciones = [
    `Validez de la oferta: ${c.validezDias} días, hasta el ${fechaLarga(c.validaHasta)}.`,
    `Forma de pago: ${c.formaPago}. Negociación: ${c.tipoNegociacion}.`,
    'Los valores son antes de IVA; el IVA se liquida en la factura según aplique.',
    'Los precios aplican a los residuos descritos. El servicio inicia con la declaración del residuo autorizada (ficha y caracterización); si las características cambian, se revisa la tarifa.',
    'Los certificados de tratamiento y disposición final se expiden por cada servicio realizado.',
  ];
  for (const t of condiciones) {
    asegurar(16);
    const y = doc.y;
    doc.circle(x0 + 6, y + 4.2, 1.5).fill('black');
    doc.font('Helvetica').fontSize(8.8).fillColor('black').text(t, x0 + 14, y, { width: W - 14, lineGap: 1.2 });
    doc.moveDown(0.15);
  }
  if (c.condiciones) { doc.moveDown(0.3); parrafo(c.condiciones); }

  // ---------- Firma ----------
  doc.moveDown(1);
  asegurar(70);
  doc.font('Helvetica').fontSize(9.5).fillColor('black').text('Cordialmente,', x0, doc.y, { width: W });
  doc.moveDown(2);
  if (c.asesor) {
    doc.font('Helvetica-Bold').fontSize(9.5).text(c.asesor.nombre, x0, doc.y, { width: 320 });
    doc.font('Helvetica').fontSize(8.5).fillColor(GRIS).text('Asesor comercial', x0, doc.y, { width: 320 });
    if (c.asesor.correo) doc.text(c.asesor.correo, x0, doc.y, { width: 320 });
  }
  doc.font('Helvetica').fontSize(8.5).fillColor(GRIS).text(c.emisor.razonSocial, x0, doc.y, { width: 320 });
  if (!borrador) {
    doc.moveDown(1).font('Helvetica').fontSize(7.5).fillColor(GRIS)
      .text(`Verifique su autenticidad con el código QR o en ${c.verificacion.url} (código ${c.verificacion.codigo}).`, x0, doc.y, { width: W });
  }

  await marcoTerraViva(doc, { numero: c.numero, nit: c.emisor.nit, url: c.verificacion.url, documento: 'cotización', certificaciones: c.certificaciones, contacto: c.emisor.contacto });
  doc.end();
  return listo;
}
