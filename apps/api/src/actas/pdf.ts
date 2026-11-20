// PDF del certificado con el modelo oficial de Terra Viva (certificado PSAP2026-296), mejorado:
// - la relación técnica suma las líneas iguales de un mismo manifiesto y llena la licencia o el permiso de cada una;
// - totales por unidad (no se suman metros cúbicos con kilos);
// - el respaldo legal cita solo los actos y los párrafos que aplican a los residuos del certificado;
// - si hay RCD, agrega la constancia del Anexo II de la Resolución 1257 de 2021.
// Se genera SOLO desde el «contenido» guardado al emitir (copia fija): el documento es reproducible aunque después
// cambien clientes, permisos o tarifas.
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { LOGO_TERRA_VIVA } from './logo';

type TipoRcd = 'EXCAVACION' | 'CIMENTACION' | 'PETREOS' | 'NO_PETREOS' | 'CONTAMINADO_RESPEL' | 'NO_APROVECHABLE' | 'PELIGROSO';
export interface BloqueRcd {
  gestor: { numero: string | null; razonSocial: string; nit: string; representante: string | null; direccion: string | null; telefono: string | null; correo: string | null;
    municipio: string | null; tipo: 'PUNTO_LIMPIO' | 'APROVECHAMIENTO' | 'DISPOSICION_FINAL' };
  generador: { numero: string | null; razonSocial: string; nit: string; representante: string | null; domicilio: string | null; telefono: string | null; correo: string | null; generacion: string[] };
  cantidades: { codigo: TipoRcd; numeral: string; nombre: string; toneladas: number }[];
  total: number;
  recepcion: { desde: string; hasta: string };
}
export interface ContenidoActa {
  /** 1 y 2: formatos anteriores. 3: modelo oficial de Terra Viva (actividades, NIT del transportador, fecha de los actos, RCD). */
  version: 1 | 2 | 3;
  origen: 'GENERADA' | 'CARGADA';
  tipo: 'DISPOSICION' | 'CONCILIACION' | 'APROVECHAMIENTO';
  numero: string;
  emitidaEn: string;
  periodo: { desde: string; hasta: string };
  emisor: { razonSocial: string; nit: string; contacto?: { direccion: string | null; municipio: string | null; telefono: string | null; correo: string | null } };
  destino: { razonSocial: string; nit: string; municipio: string | null };
  cliente: { razonSocial: string; nit: string; dv: string | null };
  /** Certificado de UN generador de un cliente gestor (su razón social encabeza el certificado). */
  generador?: { razonSocial: string; nit: string } | null;
  /** El cliente es un gestor con varios generadores (cada línea dice el suyo). */
  clienteGestor?: boolean;
  /** v3: actividades que hizo Terra Viva (recolección, transporte o recepción; tratamiento y disposición o aprovechamiento). */
  actividades?: string;
  sedes: { codigo: string | null; nombre: string; direccion: string | null; municipio: string | null; latitud: number | null; longitud: number | null }[];
  lineas: {
    manifiesto: string; fechaServicio: string; residuo: string; codigoInterno: string | null; peligroso: boolean; corrientes: string[];
    sede: string; cantidad: number; unidad: string; tratamiento: string; soporte: string[];
    generador?: string; generadorNit?: string | null;
    rcd?: boolean; tipoRcd?: TipoRcd | null; kgPorUnidad?: number | null; // v3
  }[];
  totales: { unidad: string; cantidad: number }[];
  transporte: { manifiesto: string; vehiculo: string | null; transportador: string; nit?: string | null }[];
  marcoLegal: { acto: string; autoridad: string; alcance: string; vence: string | null; expedicion?: string | null }[];
  verificacion: { codigo: string; url: string };
  /** Párrafos de respaldo legal que aplican a las disposiciones del certificado (con su versión). CERTIFICACION es la entrada. */
  textosLegales?: { codigo: string; version: number; titulo: string; texto: string }[];
  firma?: { ciudad: string | null; representante: string | null; cargo: string | null };
  certificaciones?: { norma: string; numero: string; entidad?: string; vence?: string }[];
  /** v3: constancia de RCD (una por generador) cuando el certificado tiene residuos de construcción y demolición. */
  rcd?: BloqueRcd[];
}

const TITULOS = {
  DISPOSICION: 'CERTIFICADO DE GESTIÓN INTEGRAL, TRATAMIENTO Y DISPOSICIÓN FINAL',
  APROVECHAMIENTO: 'CERTIFICADO DE GESTIÓN INTEGRAL Y APROVECHAMIENTO',
  CONCILIACION: 'ACTA DE CONCILIACIÓN DE RESIDUOS',
} as const;
// Colores del modelo oficial: tabla azul, número en rojo, firma en verde
const AZUL = '#1F5FA8', AZUL_CLARO = '#E8F0FA', LINEA = '#9AA8B4';
export const VERDE = '#1E9E4A', ROJO = '#D0021B', GRIS = '#55615B';
export const A4: [number, number] = [595.28, 841.89];
export const M = { arriba: 122, abajo: 92, izq: 52, der: 92 };
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Fechas calendario (DATE): se leen tal cual. */
const fecha = (iso: string) => { const [a, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${a}`; };
/** Instantes (emisión) en hora de Colombia. */
const enColombia = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
const num = (v: number, dec = 2) => v.toLocaleString('es-CO', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const cantidad = (v: number) => v.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
const unidadBonita = (u: string) => (u === 'm3' ? 'm³' : u);

/** Suma las líneas iguales de un mismo manifiesto (el modelo anterior repetía 32 veces la misma línea). */
function agrupar(c: ContenidoActa, conGenerador: boolean) {
  const grupos = new Map<string, ContenidoActa['lineas'][number]>();
  for (const l of c.lineas) {
    const k = [l.manifiesto, l.fechaServicio, l.residuo, l.corrientes.join(','), l.peligroso, l.unidad, l.tratamiento, l.soporte.join(';'), conGenerador ? `${l.generador}|${l.generadorNit}` : ''].join('|');
    const g = grupos.get(k);
    if (g) g.cantidad = Math.round((g.cantidad + l.cantidad) * 1000) / 1000; else grupos.set(k, { ...l });
  }
  return [...grupos.values()];
}

/** Datos del marco que va en todas las hojas de los documentos de Terra Viva. */
export interface Marco {
  numero: string; nit: string; url: string;
  /** Cómo se llama el documento en el texto bajo el QR (por omisión, «certificado»). */
  documento?: string;
  certificaciones?: { norma: string; numero: string; entidad?: string }[];
  contacto?: { direccion?: string | null; municipio?: string | null; telefono?: string | null; correo?: string | null };
}

/** Marco del modelo oficial en todas las hojas: logo con NIT, QR de verificación, sellos, onda de la marca y pie. */
export async function marcoTerraViva(doc: PDFKit.PDFDocument, m: Marco) {
  const W = A4[0] - M.izq - M.der, x0 = M.izq;
  const qr = await QRCode.toBuffer(m.url, { type: 'png', errorCorrectionLevel: 'M', margin: 1, width: 300 });
  const sellos = (m.certificaciones ?? []).filter((x) => x.numero?.trim());
  const rango = doc.bufferedPageRange();
  for (let i = 0; i < rango.count; i++) {
    doc.switchToPage(rango.start + i);
    const margen = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // escribir dentro del margen sin que pdfkit cree otra página
    // Encabezado: logo con NIT y QR de verificación
    doc.image(LOGO_TERRA_VIVA, x0, 34, { width: 178 });
    doc.font('Helvetica').fontSize(6.5).fillColor(GRIS).text(`NIT: ${m.nit}`, x0 + 40, 92, { width: 120, lineBreak: false });
    doc.image(qr, A4[0] - M.der - 58, 28, { width: 64 });
    doc.font('Helvetica').fontSize(6).fillColor(GRIS).text(`Verifique la autenticidad del ${m.documento ?? 'certificado'} N.º ${m.numero}`, A4[0] - M.der - 110, 94, { width: 150, align: 'right', lineBreak: false });
    // Sellos del sistema de gestión, en la columna derecha (texto propio: no se usan logotipos de terceros)
    let ys = 250;
    for (const s of sellos) {
      const xs = A4[0] - 76;
      doc.roundedRect(xs, ys, 56, 40, 6).fillAndStroke(AZUL_CLARO, AZUL);
      doc.font('Helvetica-Bold').fontSize(7).fillColor(AZUL).text(s.norma.replace(/:\d{4}$/, ''), xs + 2, ys + 9, { width: 52, align: 'center', lineBreak: true });
      if (s.entidad) doc.font('Helvetica').fontSize(5.5).fillColor(AZUL).text(s.entidad, xs + 2, ys + 29, { width: 52, align: 'center', lineBreak: false });
      doc.font('Helvetica').fontSize(5.5).fillColor(GRIS).text(s.numero, xs - 6, ys + 43, { width: 68, align: 'center', lineBreak: false });
      ys += 66;
    }
    // Onda inferior con los colores de la marca
    const H = A4[1], AN = A4[0];
    doc.save();
    doc.fillColor('#7FB8E6', 0.22).moveTo(0, H - 46).bezierCurveTo(AN * 0.28, H - 88, AN * 0.6, H - 6, AN, H - 58).lineTo(AN, H).lineTo(0, H).fill();
    doc.fillColor('#9ED36A', 0.2).moveTo(0, H - 24).bezierCurveTo(AN * 0.35, H - 64, AN * 0.7, H + 4, AN, H - 34).lineTo(AN, H).lineTo(0, H).fill();
    doc.fillColor('#F2D46B', 0.18).moveTo(0, H - 10).bezierCurveTo(AN * 0.4, H - 40, AN * 0.75, H + 10, AN, H - 16).lineTo(AN, H).lineTo(0, H).fill();
    doc.restore();
    // Pie
    const contacto = m.contacto;
    const lineaContacto = [contacto?.direccion, contacto?.municipio, contacto?.telefono, contacto?.correo].filter(Boolean).join(' · ');
    doc.font('Helvetica').fontSize(6.5).fillColor(GRIS, 1);
    if (lineaContacto) doc.text(lineaContacto, x0, H - 62, { width: W + 40, lineBreak: false });
    doc.text(`Documento generado en Terry-App · Gestión de Residuos. Verifique su autenticidad en ${m.url}`, x0, H - 52, { width: W - 30, lineBreak: false })
      .text(`Página ${i + 1} de ${rango.count}`, x0 + W - 60, H - 52, { width: 100, align: 'right', lineBreak: false });
    doc.page.margins.bottom = margen;
  }
}

export async function pdfActa(c: ContenidoActa): Promise<Buffer> {
  const doc = new PDFDocument({ size: A4, margins: { top: M.arriba, bottom: M.abajo, left: M.izq, right: M.der }, bufferPages: true,
    info: { Title: `${TITULOS[c.tipo]} ${c.numero}`, Author: c.emisor.razonSocial, Creator: 'Terry-App · Gestión de Residuos', Subject: `Verificación: ${c.verificacion.url}` } });
  const partes: Buffer[] = [];
  doc.on('data', (b: Buffer) => partes.push(b));
  const listo = new Promise<Buffer>((ok) => doc.on('end', () => ok(Buffer.concat(partes))));
  const W = A4[0] - M.izq - M.der, x0 = M.izq;
  const fin = () => A4[1] - M.abajo;
  /** Salta de página si no caben `alto` puntos. */
  const asegurar = (alto: number) => { if (doc.y + alto > fin()) doc.addPage(); };
  const parrafo = (t: string, opciones: PDFKit.Mixins.TextOptions = {}) => doc.font('Helvetica').fontSize(9).fillColor('black').text(t, x0, doc.y, { width: W, align: 'justify', ...opciones });
  const seccion = (t: string) => { asegurar(48); doc.moveDown(0.9).font('Helvetica-Bold').fontSize(9.5).fillColor('black').text(t, x0, doc.y, { width: W }).moveDown(0.4); };
  /** Viñeta con rótulo en negrita, como en el modelo oficial. */
  const vineta = (rotulo: string, valor: string) => {
    asegurar(14);
    const y = doc.y;
    doc.circle(x0 + 12, y + 4.2, 1.6).fill('black');
    doc.fillColor('black').font('Helvetica-Bold').fontSize(9).text(`${rotulo}: `, x0 + 22, y, { width: W - 22, continued: true }).font('Helvetica').text(valor);
  };
  const nitEmisor = c.emisor.nit;
  const nitCliente = `${c.cliente.nit}${c.cliente.dv ? `-${c.cliente.dv}` : ''}`;

  // ---------- Título ----------
  doc.font('Helvetica-Bold').fontSize(11).fillColor('black').text(TITULOS[c.tipo], x0, M.arriba, { width: W, align: 'center' });
  doc.fillColor(ROJO).text(`${c.tipo === 'CONCILIACION' ? 'ACTA' : 'CERTIFICADO'} N.º ${c.numero}`, { width: W, align: 'center' });
  doc.moveDown(0.3).font('Helvetica').fontSize(8).fillColor(GRIS)
    .text(`Periodo de los servicios: ${fecha(c.periodo.desde)} a ${fecha(c.periodo.hasta)} · Emitido el ${fecha(enColombia(c.emitidaEn))}`, { width: W, align: 'center' });

  // ---------- Entrada (texto CERTIFICACION del modelo oficial) ----------
  const textos = c.textosLegales ?? [];
  const entrada = textos.find((t) => t.codigo === 'CERTIFICACION');
  doc.moveDown(1.4);
  if (entrada) {
    // El nombre y el NIT del emisor van en negrita, como en el modelo oficial
    const cabeza = `${c.emisor.razonSocial}, NIT ${nitEmisor}`;
    if (entrada.texto.startsWith(cabeza)) doc.font('Helvetica-Bold').fontSize(9).fillColor('black').text(cabeza, x0, doc.y, { width: W, align: 'justify', continued: true }).font('Helvetica').text(entrada.texto.slice(cabeza.length));
    else parrafo(entrada.texto);
  } else {
    parrafo(`${c.emisor.razonSocial}, NIT ${nitEmisor}, certifica que recibió y gestionó los residuos relacionados a continuación, mediante los tratamientos indicados y al amparo de los actos administrativos citados.`);
  }

  // ---------- 1. Generador ----------
  seccion('1. INFORMACIÓN DEL GENERADOR:');
  const principal = c.sedes[0];
  if (c.generador) {
    vineta('RAZÓN SOCIAL', c.generador.razonSocial);
    vineta('NIT', c.generador.nit);
    vineta('GESTOR QUE CONTRATÓ EL SERVICIO', `${c.cliente.razonSocial}, NIT ${nitCliente}`);
  } else {
    vineta('RAZÓN SOCIAL', c.cliente.razonSocial);
    vineta('NIT', nitCliente);
    if (c.clienteGestor) vineta('GENERADORES', 'el cliente es un gestor: cada línea de la relación indica el generador que la produjo');
  }
  if (principal?.municipio) vineta('CIUDAD', `${principal.municipio.replace(/ \((.+)\)$/, ' - $1')} - Colombia`);
  const sedes = c.sedes.slice(0, 8);
  for (const s of sedes) {
    const coord = s.latitud !== null && s.longitud !== null ? ` (${s.latitud.toFixed(5)}, ${s.longitud.toFixed(5)})` : '';
    vineta(c.sedes.length > 1 ? 'SEDE' : 'SEDE DE GENERACIÓN', `${s.codigo ? `${s.codigo} · ` : ''}${s.nombre}${s.direccion ? ` — ${s.direccion}` : ''}${coord}`);
  }
  if (c.sedes.length > sedes.length) vineta('OTRAS SEDES', `${c.sedes.length - sedes.length} más (ver la relación técnica)`);

  // ---------- 2. Relación técnica ----------
  seccion('2. RELACIÓN TÉCNICA DE RESIDUOS GESTIONADOS:');
  const conGenerador = !!c.clienteGestor && !c.generador;
  const filas = agrupar(c, conGenerador);
  const cols = [
    { t: 'Manifiesto', w: 0.11, al: 'center' as const }, { t: 'Fecha de servicio', w: 0.11, al: 'center' as const }, { t: 'Tipo de residuo', w: 0.26, al: 'left' as const },
    { t: 'Und', w: 0.07, al: 'center' as const }, { t: 'Cantidad', w: 0.1, al: 'right' as const }, { t: 'Tecnología de tratamiento', w: 0.17, al: 'center' as const },
    { t: 'Licencia y/o permiso', w: 0.18, al: 'center' as const },
  ];
  const pad = 3;
  const fila = (celdas: string[], encabezado = false) => {
    doc.font(encabezado ? 'Helvetica-Bold' : 'Helvetica').fontSize(encabezado ? 7.8 : 7.5);
    const alto = Math.max(...celdas.map((v, i) => doc.heightOfString(v || '—', { width: cols[i].w * W - pad * 2 }))) + pad * 2;
    if (doc.y + alto > fin()) { doc.addPage(); if (!encabezado) fila(cols.map((k) => k.t), true); }
    const y = doc.y;
    if (encabezado) doc.rect(x0, y, W, alto).fill(AZUL);
    let x = x0;
    celdas.forEach((v, i) => {
      doc.fillColor(encabezado ? 'white' : 'black').font(encabezado || i === 0 ? 'Helvetica-Bold' : 'Helvetica')
        .text(v || '—', x + pad, y + pad, { width: cols[i].w * W - pad * 2, align: encabezado ? 'center' : cols[i].al });
      x += cols[i].w * W;
    });
    // Rejilla completa, como en el modelo oficial
    doc.lineWidth(0.4).strokeColor(LINEA).rect(x0, y, W, alto).stroke();
    x = x0;
    for (const k of cols.slice(0, -1)) { x += k.w * W; doc.moveTo(x, y).lineTo(x, y + alto).stroke(); }
    doc.y = y + alto;
  };
  fila(cols.map((k) => k.t), true);
  for (const l of filas) {
    const residuo = `${l.residuo}${l.corrientes.length ? ` (${l.corrientes.join(', ')})` : ''}${l.peligroso ? ' · RESPEL' : ''}`
      + (l.codigoInterno ? `\nSu código: ${l.codigoInterno}` : '') + (conGenerador && l.generador ? `\nGenerador: ${l.generador}${l.generadorNit ? `, NIT ${l.generadorNit}` : ''}` : '');
    fila([l.manifiesto, fecha(l.fechaServicio), residuo, unidadBonita(l.unidad), cantidad(l.cantidad), l.tratamiento, l.soporte.join('; ')]);
  }
  // Total por unidad
  asegurar(18);
  const yt = doc.y;
  const total = c.totales.map((t) => `${cantidad(t.cantidad)} ${unidadBonita(t.unidad)}`).join(' · ');
  doc.font('Helvetica-Bold').fontSize(8).fillColor('black').text(`TOTAL: ${total}`, x0, yt + 4, { width: W, align: 'center' });
  doc.lineWidth(0.4).strokeColor(LINEA).rect(x0, yt, W, doc.y - yt + 3).stroke();
  doc.y += 3;

  // ---------- Transporte ----------
  if (c.transporte.length) {
    const porEmpresa = new Map<string, { transportador: string; nit: string | null; vehiculos: Set<string>; manifiestos: string[] }>();
    for (const t of c.transporte) {
      const k = `${t.transportador}|${t.nit ?? ''}`;
      const x = porEmpresa.get(k) ?? { transportador: t.transportador, nit: t.nit ?? null, vehiculos: new Set<string>(), manifiestos: [] };
      if (t.vehiculo) x.vehiculos.add(t.vehiculo); x.manifiestos.push(t.manifiesto); porEmpresa.set(k, x);
    }
    const empresas = [...porEmpresa.values()];
    const desc = (e: (typeof empresas)[number]) => `${e.transportador.toUpperCase()}${e.nit ? `, NIT ${e.nit}` : ''}${e.vehiculos.size ? ` (vehículo ${[...e.vehiculos].join(', ')})` : ''}`;
    asegurar(30);
    doc.moveDown(0.9);
    if (empresas.length === 1) doc.font('Helvetica-Bold').fontSize(8.5).fillColor('black').text(`EMPRESA QUE REALIZÓ EL TRANSPORTE: ${desc(empresas[0])}`, x0, doc.y, { width: W });
    else {
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('black').text('EMPRESAS QUE REALIZARON EL TRANSPORTE:', x0, doc.y, { width: W });
      for (const e of empresas) vineta(desc(e), `manifiestos ${e.manifiestos.join(', ')}`);
    }
  }

  // ---------- 3. Respaldo legal ----------
  seccion('3. RESPALDO LEGAL Y PERMISOS AMBIENTALES');
  parrafo(`${c.emisor.razonSocial} certifica que los procesos de tratamiento y disposición de este certificado se encuentran amparados bajo los siguientes actos administrativos:`);
  doc.moveDown(0.3);
  for (const p of c.marcoLegal) {
    const cuando = [p.expedicion ? fecha(p.expedicion) : null, p.autoridad].filter(Boolean).join(' - ');
    vineta(`${p.acto.toUpperCase().replace(/\bNO\./g, 'No.')}${cuando ? ` (${cuando})` : ''}`, `${p.alcance}${p.vence ? `. Vigente hasta ${fecha(p.vence)}` : ''}.`);
  }
  const aliado = c.lineas.some((l) => /gestor aliado/i.test(l.tratamiento));
  if (!c.marcoLegal.length && aliado) parrafo('Los tratamientos los realizaron gestores aliados con licencia vigente, citada en cada línea de la relación técnica.');

  // ---------- 4… Párrafos que aplican a este certificado ----------
  let n = 4;
  for (const t of textos.filter((x) => x.codigo !== 'CERTIFICACION')) {
    seccion(`${n++}. ${t.titulo.toUpperCase()}`);
    parrafo(t.texto);
  }

  // ---------- Firma ----------
  asegurar(120);
  doc.moveDown(1.4);
  const hoy = enColombia(c.emitidaEn).split('-').map(Number);
  const ciudad = c.firma?.ciudad;
  parrafo(ciudad
    ? `Para constancia de lo anterior, se firma en ${ciudad}, a los ${String(hoy[2]).padStart(2, '0')} días del mes de ${MESES[hoy[1] - 1]} del año ${hoy[0]}.`
    : `Para constancia de lo anterior, se firma a los ${String(hoy[2]).padStart(2, '0')} días del mes de ${MESES[hoy[1] - 1]} del año ${hoy[0]}.`, { align: 'left' });
  doc.moveDown(3);
  const yf = doc.y;
  doc.moveTo(x0, yf).lineTo(x0 + 210, yf).lineWidth(0.6).strokeColor('black').stroke();
  doc.y = yf + 4;
  if (c.firma?.representante) doc.font('Helvetica-Bold').fontSize(9).fillColor('black').text(c.firma.representante, x0, doc.y, { width: 300 });
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(VERDE).text(c.firma?.cargo || 'Representante Legal', x0, doc.y, { width: 300 });
  doc.font('Helvetica').fontSize(8.5).fillColor(GRIS).text(c.emisor.razonSocial, x0, doc.y, { width: 300 });

  // ---------- Constancia de RCD (Anexo II, Res. 1257 de 2021) ----------
  for (const b of c.rcd ?? []) constanciaRcd(doc, c, b, W, x0);

  // ---------- Encabezado, sellos, onda y pie en todas las hojas ----------
  await marcoTerraViva(doc, { numero: c.numero, nit: nitEmisor, url: c.verificacion.url, certificaciones: c.certificaciones, contacto: c.emisor.contacto });
  doc.end();
  return listo;
}

/** Constancia del gestor de RCD al generador: Anexo II de la Resolución 1257 de 2021 (modifica la Res. 0472 de 2017). */
function constanciaRcd(doc: PDFKit.PDFDocument, c: ContenidoActa, b: BloqueRcd, W: number, x0: number) {
  doc.addPage();
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor('black').text('CONSTANCIA DE GESTIÓN DE RESIDUOS DE CONSTRUCCIÓN Y DEMOLICIÓN – RCD', x0, M.arriba, { width: W, align: 'center' });
  doc.font('Helvetica').fontSize(8).fillColor(GRIS)
    .text('Anexo II – Formato constancia gestores. Resolución 1257 de 2021, que modifica la Resolución 0472 de 2017.', { width: W, align: 'center' })
    .fillColor(ROJO).font('Helvetica-Bold').text(`Hace parte del certificado N.º ${c.numero}`, { width: W, align: 'center' });
  doc.moveDown(0.6);
  const pad = 3, c1 = 0.46;
  const titulo = (t: string) => {
    const y = doc.y;
    doc.rect(x0, y, W, 14).fill(AZUL);
    doc.font('Helvetica-Bold').fontSize(8).fillColor('white').text(t, x0, y + 3.5, { width: W, align: 'center' });
    doc.y = y + 14;
  };
  const par = (rotulo: string, valor: string, negrita = false) => {
    doc.font('Helvetica').fontSize(7.5);
    const alto = Math.max(doc.heightOfString(rotulo, { width: c1 * W - pad * 2 }), doc.heightOfString(valor || '—', { width: (1 - c1) * W - pad * 2 })) + pad * 2;
    const y = doc.y;
    doc.rect(x0, y, c1 * W, alto).fill(AZUL_CLARO);
    doc.fillColor('black').font('Helvetica').text(rotulo, x0 + pad, y + pad, { width: c1 * W - pad * 2 });
    doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').text(valor || '—', x0 + c1 * W + pad, y + pad, { width: (1 - c1) * W - pad * 2 });
    doc.lineWidth(0.4).strokeColor(LINEA).rect(x0, y, W, alto).stroke().moveTo(x0 + c1 * W, y).lineTo(x0 + c1 * W, y + alto).stroke();
    doc.y = y + alto;
  };
  const casilla = (x: number, y: number, marcada: boolean) => {
    doc.lineWidth(0.6).strokeColor('black').rect(x, y, 8, 8).stroke();
    if (marcada) doc.moveTo(x + 1.5, y + 1.5).lineTo(x + 6.5, y + 6.5).moveTo(x + 6.5, y + 1.5).lineTo(x + 1.5, y + 6.5).stroke();
  };
  const g = b.gestor;
  titulo('DATOS BÁSICOS DEL GESTOR');
  par('Número único asignado al gestor por la autoridad ambiental', g.numero ?? 'No registrado');
  par('Nombre o razón social', g.razonSocial, true);
  par('Documento de identificación o NIT', g.nit);
  par('Representante legal', g.representante ?? '');
  par('Dirección', g.direccion ?? '');
  par('Teléfono', g.telefono ?? '');
  par('Correo electrónico', g.correo ?? '');
  par('Municipio o distrito', g.municipio ?? '');
  // Tipo de gestor con casillas
  const y = doc.y;
  doc.rect(x0, y, c1 * W, 20).fill(AZUL_CLARO);
  doc.fillColor('black').font('Helvetica').fontSize(8).text('Tipo de gestor', x0 + pad, y + 6, { width: c1 * W - pad * 2 });
  const opciones: [BloqueRcd['gestor']['tipo'], string][] = [['PUNTO_LIMPIO', 'Punto limpio'], ['APROVECHAMIENTO', 'Planta de aprovechamiento'], ['DISPOSICION_FINAL', 'Disposición final']];
  let xo = x0 + c1 * W + pad;
  for (const [k, t] of opciones) { casilla(xo, y + 6, g.tipo === k); doc.fillColor("black").fontSize(7.5).text(t, xo + 11, y + 6.5, { lineBreak: false }); xo += doc.widthOfString(t) + 19; }
  doc.lineWidth(0.4).strokeColor(LINEA).rect(x0, y, W, 20).stroke().moveTo(x0 + c1 * W, y).lineTo(x0 + c1 * W, y + 20).stroke();
  doc.y = y + 20;

  doc.moveDown(0.5);
  const ge = b.generador;
  titulo('DATOS BÁSICOS DEL GENERADOR');
  par('Número único asignado al generador por la autoridad ambiental competente por proyecto', ge.numero ?? 'No registrado');
  par('Nombre o razón social', ge.razonSocial, true);
  par('Documento de identificación o NIT', ge.nit);
  par('Representante legal', ge.representante ?? '');
  par('Dirección de domicilio', ge.domicilio ?? '');
  par('Teléfono', ge.telefono ?? '');
  par('Correo electrónico', ge.correo ?? '');
  par('Dirección de generación de RCD', ge.generacion.join('\n'));

  doc.moveDown(0.5);
  titulo('CANTIDADES DE RCD RECIBIDOS DEL GENERADOR POR TIPO');
  const fila = (t: string, v: string, estilo: 'grupo' | 'tipo' | 'total') => {
    doc.font(estilo === 'tipo' ? 'Helvetica' : 'Helvetica-Bold').fontSize(7.5);
    const ancho1 = 0.78 * W;
    const alto = doc.heightOfString(t, { width: ancho1 - pad * 2 - (estilo === 'tipo' ? 10 : 0) }) + pad * 2;
    if (doc.y + alto > A4[1] - M.abajo) doc.addPage();
    const yy = doc.y;
    if (estilo !== 'tipo') doc.rect(x0, yy, W, alto).fill(AZUL_CLARO);
    doc.fillColor('black').text(t, x0 + pad + (estilo === 'tipo' ? 10 : 0), yy + pad, { width: ancho1 - pad * 2 - (estilo === 'tipo' ? 10 : 0) });
    doc.text(v, x0 + ancho1 + pad, yy + pad, { width: W - ancho1 - pad * 2, align: 'right' });
    doc.lineWidth(0.4).strokeColor(LINEA).rect(x0, yy, W, alto).stroke().moveTo(x0 + ancho1, yy).lineTo(x0 + ancho1, yy + alto).stroke();
    doc.y = yy + alto;
  };
  fila('Tipo de residuo', 'Cantidad (t)', 'grupo');
  fila('1. Residuos de construcción y demolición – RCD susceptibles de aprovechamiento:', '', 'grupo');
  for (const x of b.cantidades.filter((q) => q.numeral.startsWith('1.'))) fila(`${x.numeral} ${x.nombre}`, num(x.toneladas, 3), 'tipo');
  fila('2. Residuos de construcción y demolición – RCD no susceptibles de aprovechamiento:', '', 'grupo');
  for (const x of b.cantidades.filter((q) => q.numeral.startsWith('2.'))) fila(`${x.numeral} ${x.nombre}`, num(x.toneladas, 3), 'tipo');
  fila('Total RCD recibidos (t)', num(b.total, 3), 'total');
  fila('Fecha de recepción de los RCD', b.recepcion.desde === b.recepcion.hasta ? fecha(b.recepcion.desde) : `${fecha(b.recepcion.desde)} a ${fecha(b.recepcion.hasta)}`, 'total');

  if (doc.y > A4[1] - M.abajo - 70) doc.addPage();
  doc.moveDown(0.8).font('Helvetica').fontSize(9).fillColor('black').text('Cordialmente,', x0, doc.y);
  doc.moveDown(2);
  const yf = doc.y;
  doc.moveTo(x0, yf).lineTo(x0 + 210, yf).lineWidth(0.6).strokeColor('black').stroke();
  doc.y = yf + 4;
  if (g.representante) doc.font('Helvetica-Bold').fontSize(9).text(g.representante, x0, doc.y, { width: 300 });
  doc.font('Helvetica-Bold').fontSize(9).fillColor(VERDE).text(c.firma?.cargo || 'Representante Legal', x0, doc.y, { width: 300 });
  doc.font('Helvetica').fontSize(8.5).fillColor(GRIS).text(g.razonSocial, x0, doc.y, { width: 300 });
}
