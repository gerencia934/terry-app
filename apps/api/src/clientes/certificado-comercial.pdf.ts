// Certificado comercial del cliente: el modelo PD-GG-F-01 de Terra Viva («ADM-26-27»), mejorado y dinámico (gerencia,
// 19-11-2026). Lo que corrige del modelo:
// - la frase de cumplimiento nombra al cliente (el modelo decía GEOASEO) y solo sale si no tiene facturas vencidas;
// - los servicios son los que el cliente tiene autorizados, separados entre lo que se trata en Los Pinos (con el acto que lo
//   ampara, tomado de los permisos vigentes) y lo que va a gestores aliados licenciados (sin nombrarlos);
// - ya no dice que Los Pinos trata residuos peligrosos, suelos contaminados o borras: la Res. DGL 000632 de 2023 (art. 6)
//   solo admite residuos sin características de peligrosidad;
// - número consecutivo, fecha en letras, código QR de verificación y el mismo marco del certificado oficial.
// Se arma solo desde el «contenido» guardado al expedirlo (copia fija): el documento es reproducible.
import PDFDocument from 'pdfkit';
import { A4, GRIS, M, MESES, ROJO, VERDE, marcoTerraViva } from '../actas/pdf';

export interface ContenidoCertificadoComercial {
  version: 1;
  numero: string;
  /** Día de expedición (AAAA-MM-DD, Colombia). */
  fecha: string;
  emisor: { razonSocial: string; nit: string; contacto?: { direccion?: string | null; municipio?: string | null; telefono?: string | null; correo?: string | null } };
  cliente: { razonSocial: string; nit: string };
  /** Primer servicio realizado: inicio de la relación comercial (si lo hay). */
  desde: string | null;
  /** Sin facturas vencidas: lleva la frase de cumplimiento satisfactorio. */
  alDia: boolean;
  /** Lo que se le presta: «propio» se trata en Los Pinos; si no, con gestores aliados licenciados. */
  servicios: { tratamiento: string; propio: boolean; residuos: string[]; mas: number }[];
  /** Actos propios vigentes que amparan lo que se trata en Los Pinos. */
  permisos: string[];
  /** Actos del transporte de residuos peligrosos (planes de contingencia). */
  transporte: string[];
  hayPeligrosos: boolean;
  /** El cliente aún no tiene servicios autorizados: se describen los servicios que Terra Viva le ofrece. */
  general: boolean;
  firma: { nombre: string | null; cargo: string; correo: string | null; ciudad: string | null };
  certificaciones?: { norma: string; numero: string; entidad?: string }[];
  verificacion: { codigo: string; url: string };
}

const UNIDADES = ['', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince',
  'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiún', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis',
  'veintisiete', 'veintiocho', 'veintinueve', 'treinta', 'treinta y un'];
/** «a los diecinueve (19) días del mes de noviembre de 2026», como en los documentos oficiales. */
export function fechaEnLetras(iso: string) {
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  return d === 1 ? `al primer (1) día del mes de ${MESES[m - 1]} de ${a}` : `a los ${UNIDADES[d]} (${String(d).padStart(2, '0')}) días del mes de ${MESES[m - 1]} de ${a}`;
}
/** «15 de agosto de 2023». */
export const fechaLarga = (iso: string) => { const [a, m, d] = iso.slice(0, 10).split('-').map(Number); return `${d} de ${MESES[m - 1]} de ${a}`; };
/** «901089780-8» → «901.089.780-8». */
export const nitConPuntos = (nit: string) => { const [base, dv] = nit.split('-'); const b = base.replace(/\B(?=(\d{3})+(?!\d))/g, '.'); return dv ? `${b}-${dv}` : b; };
/** «a, b y c». */
const enumerar = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}` : xs[0] ?? '');

export async function pdfCertificadoComercial(c: ContenidoCertificadoComercial): Promise<Buffer> {
  const doc = new PDFDocument({ size: A4, margins: { top: M.arriba, bottom: M.abajo, left: M.izq, right: M.der }, bufferPages: true,
    info: { Title: `Certificado comercial ${c.numero}`, Author: c.emisor.razonSocial, Creator: 'Terry-App Residuos', Subject: `Verificación: ${c.verificacion.url}` } });
  const partes: Buffer[] = [];
  doc.on('data', (b: Buffer) => partes.push(b));
  const listo = new Promise<Buffer>((ok) => doc.on('end', () => ok(Buffer.concat(partes))));
  const W = A4[0] - M.izq - M.der, x0 = M.izq;
  const asegurar = (alto: number) => { if (doc.y + alto > A4[1] - M.abajo) doc.addPage(); };
  const parrafo = (t: string, o: PDFKit.Mixins.TextOptions = {}) => { doc.font('Helvetica').fontSize(9.5).fillColor('black').text(t, x0, doc.y, { width: W, align: 'justify', lineGap: 1.5, ...o }); doc.moveDown(0.6); };
  /** Párrafo que empieza con un nombre en negrita (como el modelo oficial). */
  const conNegrita = (antes: string, negrita: string, despues: string, align: 'justify' | 'left' = 'justify') => {
    doc.font('Helvetica').fontSize(9.5).fillColor('black').text(antes, x0, doc.y, { width: W, align, lineGap: 1.5, continued: true })
      .font('Helvetica-Bold').text(negrita, { continued: true }).font('Helvetica').text(despues);
    doc.moveDown(0.6);
  };
  const vineta = (rotulo: string, valor: string) => {
    asegurar(16);
    const y = doc.y;
    doc.circle(x0 + 12, y + 4.4, 1.6).fill('black');
    if (valor) doc.fillColor('black').font('Helvetica-Bold').fontSize(9).text(`${rotulo}: `, x0 + 22, y, { width: W - 22, continued: true, lineGap: 1.5 }).font('Helvetica').text(valor);
    else doc.fillColor('black').font('Helvetica').fontSize(9).text(rotulo, x0 + 22, y, { width: W - 22, lineGap: 1.5 });
    doc.moveDown(0.15);
  };
  const emisor = c.emisor.razonSocial, cliente = c.cliente.razonSocial;

  // ---------- Título y número ----------
  doc.font('Helvetica-Bold').fontSize(13).fillColor('black').text('CERTIFICADO COMERCIAL', x0, M.arriba, { width: W, align: 'center' });
  doc.fontSize(11).fillColor(ROJO).text(`N.º ${c.numero}`, { width: W, align: 'center' });
  doc.moveDown(1.3);

  // ---------- Quien certifica ----------
  conNegrita(`El suscrito ${c.firma.cargo} de `, emisor, `, identificada con NIT ${nitConPuntos(c.emisor.nit)},`, 'left');
  doc.moveDown(0.2).font('Helvetica-Bold').fontSize(10.5).fillColor('black').text('CERTIFICA QUE:', x0, doc.y, { width: W, align: 'center' });
  doc.moveDown(0.7);

  // ---------- Relación comercial y cumplimiento ----------
  conNegrita('La empresa ', cliente, `, identificada con NIT ${nitConPuntos(c.cliente.nit)}, mantiene una relación comercial vigente con ${emisor}${c.desde ? ` desde el ${fechaLarga(c.desde)}` : ''}.`);
  if (c.alDia) parrafo(`Durante el periodo de nuestra relación comercial, ${cliente} ha demostrado un cumplimiento satisfactorio de sus obligaciones contractuales, manteniendo excelentes relaciones comerciales con nuestra compañía.`);

  // ---------- Servicios ----------
  const propios = c.servicios.filter((s) => s.propio), aliados = c.servicios.filter((s) => !s.propio);
  const amparo = c.permisos.length ? `, al amparo de ${enumerar(c.permisos)}` : '';
  parrafo(c.general
    ? `${emisor} pone a disposición de ${cliente} sus servicios de recolección, transporte, tratamiento y disposición final de residuos:`
    : `${emisor} presta a ${cliente} los servicios de recolección, transporte, tratamiento y disposición final de los residuos y servicios que tiene autorizados:`);
  const lista = (s: ContenidoCertificadoComercial['servicios'][number]) => vineta(s.tratamiento, s.residuos.length ? `${s.residuos.join('; ')}${s.mas ? `; y ${s.mas} más` : ''}.` : '');
  if (propios.length) {
    asegurar(40);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('black').text(`En el Parque de Saneamiento Ambiental Los Pinos (Sabana de Torres, Santander)${amparo}:`, x0, doc.y, { width: W, align: 'justify', lineGap: 1.5 });
    doc.moveDown(0.3);
    propios.forEach(lista);
    doc.moveDown(0.4);
  }
  if (aliados.length) {
    asegurar(40);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('black').text('Con gestores aliados que cuentan con licencia ambiental vigente para cada tratamiento:', x0, doc.y, { width: W, lineGap: 1.5 });
    doc.moveDown(0.3);
    aliados.forEach(lista);
    doc.moveDown(0.4);
  }
  doc.moveDown(0.3);
  if (c.hayPeligrosos || aliados.length) parrafo(`Los residuos peligrosos los recolecta y transporta ${emisor} conforme al Decreto 1079 de 2015${c.transporte.length ? ` y a sus planes de contingencia, registrados con ${enumerar(c.transporte)},` : ','} y los entrega para su tratamiento y disposición final a gestores aliados con licencia ambiental vigente, que expiden su propio certificado. En Los Pinos solo se tratan residuos sin características de peligrosidad (Resolución DGL No. 000632 de 2023 de la CAS, artículo sexto).`);

  // ---------- Lugar, fecha y firma ----------
  asegurar(115);
  parrafo(`Se expide a solicitud del interesado${c.firma.ciudad ? ` en ${c.firma.ciudad},` : ''} ${fechaEnLetras(c.fecha)}. Este certificado refleja la relación comercial a la fecha de su expedición.`, { align: 'left' });
  doc.moveDown(2.2);
  const yf = doc.y;
  doc.moveTo(x0, yf).lineTo(x0 + 210, yf).lineWidth(0.6).strokeColor('black').stroke();
  doc.y = yf + 4;
  if (c.firma.nombre) doc.font('Helvetica-Bold').fontSize(10).fillColor('black').text(c.firma.nombre, x0, doc.y, { width: 320 });
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(VERDE).text(c.firma.cargo, x0, doc.y, { width: 320 });
  doc.font('Helvetica').fontSize(8.5).fillColor(GRIS).text(emisor, x0, doc.y, { width: 320 });
  if (c.firma.correo) doc.text(c.firma.correo, x0, doc.y, { width: 320 });
  doc.moveDown(1.2).font('Helvetica').fontSize(7.5).fillColor(GRIS)
    .text(`Verifique su autenticidad con el código QR o en ${c.verificacion.url} (código ${c.verificacion.codigo}).`, x0, doc.y, { width: W });

  await marcoTerraViva(doc, { numero: c.numero, nit: c.emisor.nit, url: c.verificacion.url, documento: 'certificado comercial', certificaciones: c.certificaciones, contacto: c.emisor.contacto });
  doc.end();
  return listo;
}
