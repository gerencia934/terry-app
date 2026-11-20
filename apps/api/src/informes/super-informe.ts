// Súper Informe de cumplimiento integral (respuesta de la gerencia, 20-11-2026): un solo Excel que sirve para las
// licencias ambientales (Res. 0632-2023, 0235-2024 y las de los gestores aliados), el Plan de Contingencia (PDC), ICONTEC,
// el Ministerio de Ambiente / IDEAM (RESPEL) y el PESV. Reemplaza los informes de auditoría separados.
//
// Formato base: el informe consolidado de Residuos más reciente de Terra Viva (INFORME GENERAL V.2 – TERRA VIVA S.A.S.
// E.S.P., p. ej. «INFORME DE AVSA ENERO A 18 NOV 2026»). La hoja «Informe general V2» repite su estructura exacta: título
// combinado en verde, «Fecha documento», encabezado blanco sobre verde #1D7E4D y las mismas columnas y anchos. Las demás
// hojas usan el mismo estilo. La hoja «PDC · Despachos MP» sigue el formato PDC-RE-F-01 (Decreto 1609 de 2002, art. 13 N).
import ExcelJS from 'exceljs';
import type { PrismaService } from '../prisma/prisma.service';
import type { Actor } from '../common/http';
import type { ArchivoPreparado } from '../trabajos/trabajos.module';
import { LOGO_TERRA_VIVA } from '../actas/logo';

const VERDE_TITULO = 'FF3C763D';
const VERDE_FECHA = 'FF62A75F';
const VERDE_ENCABEZADO = 'FF1D7E4D';
const BORDE: Partial<ExcelJS.Borders> = { top: { style: 'thin', color: { argb: 'FFD9E2DC' } }, bottom: { style: 'thin', color: { argb: 'FFD9E2DC' } }, left: { style: 'thin', color: { argb: 'FFD9E2DC' } }, right: { style: 'thin', color: { argb: 'FFD9E2DC' } } };

/** Catálogo del formato PDC-RE-F-01: número UN → clase y nombre apropiado de transporte. */
const UN: Record<string, { clase: string; nombre: string }> = {
  UN3082: { clase: '9', nombre: 'Residuo, sustancia líquida peligrosa para el medio ambiente, n.e.p.' },
  UN3077: { clase: '9', nombre: 'Residuo, sustancia sólida peligrosa para el medio ambiente, n.e.p.' },
  UN1993: { clase: '3', nombre: 'Residuo, líquido inflamable, n.e.p.' },
  UN1268: { clase: '3', nombre: 'Residuo, destilados de petróleo, n.e.p.' },
  UN3291: { clase: '6.2', nombre: 'Desechos clínicos, no especificados, n.e.p.' },
  UN2794: { clase: '8', nombre: 'Baterías húmedas, llenas de ácido' },
  UN1950: { clase: '2.1', nombre: 'Aerosoles' },
  UN2590: { clase: '9', nombre: 'Residuo, asbesto crisotilo' },
  UN1078: { clase: '2.2', nombre: 'Residuo, gas refrigerante, n.e.p.' },
  UN3506: { clase: '8', nombre: 'Residuo, mercurio contenido en artículos manufacturados' },
  UN3480: { clase: '9', nombre: 'Residuo, baterías de ion litio' },
  UN3090: { clase: '9', nombre: 'Residuo, baterías de metal litio' },
  // Además del formato: combustibles y otros que aparecen en las declaraciones de Terra Viva
  UN1202: { clase: '3', nombre: 'Gasóleo, combustible para motores diésel o aceite mineral para caldeo, ligero' },
  UN1203: { clase: '3', nombre: 'Gasolina' },
  UN1223: { clase: '3', nombre: 'Queroseno' },
  UN3175: { clase: '4.1', nombre: 'Sólidos que contienen líquido inflamable, n.e.p.' },
  UN1760: { clase: '8', nombre: 'Líquido corrosivo, n.e.p.' },
  UN2810: { clase: '6.1', nombre: 'Líquido tóxico, orgánico, n.e.p.' },
};

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const dia = (d: Date) => d.toISOString().slice(0, 10);
const r2 = (v: number) => Math.round(v * 100) / 100;
const carroceria = (tipo: string) => (/tanque|vactor|cisterna/i.test(tipo) ? 'Tanque' : /volqueta/i.test(tipo) ? 'Volco' : /estaca/i.test(tipo) ? 'Estacas' : /furg/i.test(tipo) ? 'Furgón' : tipo);
const tipoVehiculo = (tipo: string) => (/volqueta/i.test(tipo) ? 'Volqueta' : 'Camión');

/** Título, fecha y encabezado con el estilo del INFORME GENERAL V.2 de Terra Viva. Devuelve la hoja lista para filas. */
function hoja(wb: ExcelJS.Workbook, nombre: string, titulo: string, fechaDocumento: string, columnas: { t: string; w: number }[], logo: number) {
  const ws = wb.addWorksheet(nombre, { views: [{ state: 'frozen', ySplit: 3 }] });
  const ultima = Math.max(2, Math.min(columnas.length, 10));
  ws.getRow(1).height = 30;
  ws.mergeCells(1, 2, 1, ultima);
  const t = ws.getCell(1, 2); t.value = titulo; t.font = { bold: true, size: 14, color: { argb: VERDE_TITULO } }; t.alignment = { vertical: 'middle' };
  ws.mergeCells(2, 1, 2, ultima);
  const f = ws.getCell(2, 1); f.value = `Fecha documento: ${fechaDocumento}`; f.font = { bold: true, size: 10, color: { argb: VERDE_FECHA } };
  const enc = ws.getRow(3);
  columnas.forEach((c, i) => {
    const celda = enc.getCell(i + 1); celda.value = c.t;
    celda.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE_ENCABEZADO } };
    celda.alignment = { vertical: 'middle', wrapText: true }; celda.border = BORDE;
    ws.getColumn(i + 1).width = c.w;
  });
  enc.height = 30;
  ws.addImage(logo, { tl: { col: 0.1, row: 0.1 }, ext: { width: 96, height: 30 } });
  return ws;
}
/** Agrega una fila de datos con el formato del informe (fechas AAAA/MM/DD, números con separador de miles). */
function fila(ws: ExcelJS.Worksheet, valores: unknown[], negrita = true) {
  const r = ws.addRow(valores);
  r.eachCell({ includeEmpty: false }, (c) => {
    c.font = { bold: negrita, size: 11 }; c.border = BORDE;
    if (c.value instanceof Date) { c.numFmt = 'yyyy/mm/dd'; c.alignment = { horizontal: 'right' }; }
    else if (typeof c.value === 'number') c.numFmt = Number.isInteger(c.value) ? '#,##0' : '#,##0.00';
  });
  return r;
}
const vacia = (ws: ExcelJS.Worksheet, texto: string) => { const r = ws.addRow([texto]); r.font = { italic: true, color: { argb: 'FF667066' } }; };

export async function prepararSuperInforme(db: PrismaService, a: Actor, desde: Date, hasta: Date, webUrl: string): Promise<{ archivo: ArchivoPreparado; conteos: Record<string, number> }> {
  const E = a.empresaId;
  const finExclusivo = new Date(hasta.getTime() + 86_400_000);
  const [empresa, lineas, actas, comerciales, preops, vehiculos, permisos, gestores] = await Promise.all([
    db.empresa.findUniqueOrThrow({ where: { id: E }, select: { razonSocial: true, nit: true } }),
    db.manifiestoItem.findMany({
      where: { manifiesto: { empresaId: E, estado: { not: 'ANULADO' }, fechaServicio: { gte: desde, lte: hasta } } },
      orderBy: [{ manifiesto: { fechaServicio: 'asc' } }, { manifiesto: { numero: 'asc' } }],
      include: {
        manifiesto: { select: { numero: true, tipo: true, estado: true, fechaServicio: true, ordenCompra: true, observaciones: true, realizadoEn: true, receptorNombre: true,
          cliente: { select: { razonSocial: true, nit: true } }, conductor: { select: { nombre: true } },
          vehiculo: { select: { placa: true, marca: true, tipo: true, proveedorId: true } },
          destino: { select: { razonSocial: true, esPropio: true, municipio: true } } } },
        sucursal: { select: { nombre: true, generadorNit: true, registroRespel: true, municipio: { select: { nombre: true } } } },
        metrica: { select: { abreviacion: true, factorAKg: true } },
        disposicion: { select: { nombre: true } },
        declaracion: { select: { nombre: true, esPeligroso: true, codigoUn: true, codigoY: { select: { codigo: true, descripcion: true } }, codigoA: { select: { codigo: true } } } },
        conciliacion: { select: { cantidadConciliada: true, facturaNumero: true, ordenCompra: true, estadoPago: true,
          conciliacion: { select: { estado: true } }, metrica: { select: { abreviacion: true, factorAKg: true } }, disposicion: { select: { nombre: true } },
          acta: { select: { numero: true, estado: true, emitidaEn: true } } } },
      },
    }),
    db.acta.findMany({ where: { empresaId: E, estado: { in: ['EMITIDA', 'ANULADA'] }, emitidaEn: { gte: desde, lt: finExclusivo } }, orderBy: { emitidaEn: 'asc' },
      include: { cliente: { select: { razonSocial: true, nit: true } }, destino: { select: { razonSocial: true } },
        items: { select: { cantidadConciliada: true, cantidadCargada: true, metrica: { select: { factorAKg: true } } } } } }),
    db.certificadoComercial.findMany({ where: { empresaId: E, fecha: { gte: desde, lte: hasta } }, orderBy: { fecha: 'asc' }, include: { cliente: { select: { razonSocial: true, nit: true } } } }),
    db.preoperacional.findMany({ where: { vehiculo: { empresaId: E }, fechaProgramada: { gte: desde, lte: hasta } }, orderBy: [{ fechaProgramada: 'asc' }],
      include: { vehiculo: { select: { placa: true } }, conductor: { select: { nombre: true } } } }),
    db.vehiculo.findMany({ where: { empresaId: E, activo: true }, orderBy: { placa: 'asc' }, include: { proveedor: { select: { razonSocial: true } } } }),
    db.permisoAmbiental.findMany({ where: { empresaId: E }, orderBy: { acto: 'asc' }, include: { obligaciones: { orderBy: { proximaFecha: 'asc' } } } }),
    db.proveedor.findMany({ where: { empresaId: E, esDestino: true, activo: true }, orderBy: [{ esPropio: 'desc' }, { razonSocial: 'asc' }],
      select: { razonSocial: true, nit: true, esPropio: true, licencia: true, licenciaAutoridad: true, licenciaVence: true, licenciaIndefinida: true, municipio: true } }),
  ]);

  const ahora = new Date();
  const fechaDocumento = ahora.toLocaleString('sv-SE', { timeZone: 'America/Bogota' });
  const hoy = dia(new Date(ahora.toLocaleString('en-US', { timeZone: 'America/Bogota' })));
  const wb = new ExcelJS.Workbook(); wb.creator = 'Terry-App · Gestión de Residuos · Terra Viva S.A.S. E.S.P.'; wb.created = ahora;
  const logo = wb.addImage({ buffer: LOGO_TERRA_VIVA as unknown as ExcelJS.Buffer, extension: 'png' });
  const periodo = `${dia(desde)} a ${dia(hasta)}`;

  // Cifras de cada línea: lo conciliado en planta si la conciliación sigue vigente; si no, lo cargado
  const datos = lineas.map((l) => {
    const ci = l.conciliacion && l.conciliacion.conciliacion.estado !== 'ANULADA' ? l.conciliacion : null;
    const cantidad = n(ci?.cantidadConciliada) ?? n(l.cantidad) ?? 0;
    const metrica = ci?.metrica ?? l.metrica;
    const factor = n(metrica?.factorAKg);
    return { l, ci, cantidad, unidad: metrica?.abreviacion ?? '', kg: factor !== null ? cantidad * factor : null, disposicion: ci?.disposicion?.nombre ?? l.disposicion?.nombre ?? '' };
  });
  const kgTotal = datos.reduce((s, d) => s + (d.kg ?? 0), 0);
  const servicios = new Set(lineas.map((l) => l.manifiestoId)).size;
  const peligrosas = datos.filter((d) => d.l.declaracion.esPeligroso);
  const despachosMp = peligrosas.filter((d) => d.l.manifiesto.tipo === 'CARGUE');
  const preAprob = preops.filter((p) => p.aprobado === true).length;
  const preNo = preops.filter((p) => p.aprobado === false).length;
  const actasEmitidas = actas.filter((x) => x.estado === 'EMITIDA');
  const vencidaPermiso = (v: Date | null) => !!v && dia(v) < hoy;
  const obligacionesVencidas = permisos.flatMap((p) => p.obligaciones).filter((o) => !o.cumplida && o.proximaFecha && dia(o.proximaFecha) < hoy).length;

  // 1. Resumen de cumplimiento
  const res = hoja(wb, 'Resumen', `SÚPER INFORME DE CUMPLIMIENTO INTEGRAL – ${empresa.razonSocial}`, fechaDocumento, [{ t: 'Concepto', w: 46 }, { t: 'Valor', w: 22 }, { t: 'Detalle', w: 70 }], logo);
  const filasResumen: [string, string | number, string][] = [
    ['Empresa', empresa.razonSocial, `NIT ${empresa.nit}`],
    ['Periodo (fecha de servicio)', periodo, `Generado por ${a.nombre} con Terry-App · Gestión de Residuos`],
    ['Toneladas gestionadas', r2(kgTotal / 1000), 'Líneas en kg o toneladas: lo conciliado en planta o, si aún no, lo cargado'],
    ['Servicios (manifiestos)', servicios, `${lineas.length} líneas de residuos y servicios`],
    ['Clientes atendidos', new Set(lineas.map((l) => l.manifiesto.cliente.nit)).size, ''],
    ['Certificados de disposición emitidos', actasEmitidas.length, `${actas.length - actasEmitidas.length} anulados en el periodo`],
    ['Certificados comerciales', comerciales.length, ''],
    ['Despachos de mercancías peligrosas', despachosMp.length, 'Formato PDC-RE-F-01 (Decreto 1609 de 2002, art. 13 N)'],
    ['Inspecciones preoperacionales', preops.length, `${preAprob} aprobadas · ${preNo} no aprobadas · ${preops.length - preAprob - preNo} sin realizar`],
    ['Licencias y permisos ambientales', permisos.length, `${permisos.filter((p) => vencidaPermiso(p.vence)).length} vencidos · ${obligacionesVencidas} obligaciones vencidas sin cumplir`],
  ];
  filasResumen.forEach((x) => fila(res, x, false));
  res.addRow([]);
  const marcoT = res.addRow(['Marco de cumplimiento', 'Hojas de este informe', 'Qué evidencia']);
  marcoT.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE_ENCABEZADO } }; c.border = BORDE; });
  ([
    ['Licencias ambientales (Res. 0632-2023 Los Pinos, Res. 0235-2024 gestor RCD y licencias de los aliados)', 'Licencias · Informe general V2 · Trazabilidad', 'Vigencias, obligaciones y su cumplimiento; qué entró, de dónde, cuánto y con qué tratamiento'],
    ['Plan de Contingencia (PDC)', 'PDC · Despachos MP · PESV', 'Registro estadístico de despachos de mercancías peligrosas y estado de la flota'],
    ['ICONTEC (calidad, ambiente y seguridad)', 'Resumen · Trazabilidad · Certificados', 'Trazabilidad de cada servicio de la solicitud al certificado, con evidencias numeradas'],
    ['Ministerio de Ambiente / IDEAM (RESPEL)', 'RESPEL · Certificados', 'Residuos peligrosos por corriente Y/A, cantidades y generadores con registro'],
    ['PESV (seguridad vial)', 'PESV', 'Inspecciones preoperacionales, conductores y documentos de los vehículos (SOAT, RTM, póliza RC)'],
  ] as [string, string, string][]).forEach((x) => fila(res, x, false));
  res.getColumn(3).alignment = { wrapText: true, vertical: 'top' }; res.getColumn(1).alignment = { wrapText: true, vertical: 'top' };

  // 2. Informe general V2: la estructura exacta del consolidado de Terra Viva
  const ig = hoja(wb, 'Informe general V2', 'INFORME GENERAL V.2-TERRA VIVA S.A.S. E.S.P', fechaDocumento, [
    { t: 'Fecha', w: 15 }, { t: 'Manifiesto', w: 12 }, { t: 'FACTURA ', w: 13 }, { t: 'ORDEN O.', w: 15 }, { t: 'Tipo', w: 10 }, { t: 'Cliente', w: 15 },
    { t: 'Sucursal', w: 64 }, { t: 'Cantidad', w: 10 }, { t: 'Unidad', w: 9 }, { t: 'Vehículo/Placa', w: 19 }, { t: 'RECAUDO', w: 12 }, { t: 'Observaciones', w: 84 },
  ], logo);
  for (const d of datos) {
    const m = d.l.manifiesto;
    fila(ig, [m.fechaServicio, m.numero, d.ci?.facturaNumero ?? '', d.ci?.ordenCompra ?? m.ordenCompra ?? '', m.tipo === 'DESCARGUE' ? 'Descargue' : 'Cargue',
      m.cliente.razonSocial, d.l.sucursal.nombre, r2(d.cantidad), d.unidad, m.vehiculo ? `${m.vehiculo.placa} ${(m.vehiculo.marca ?? '').toUpperCase()}`.trim() : '',
      d.ci?.estadoPago === 'PAGADA' ? 'SI' : d.ci?.estadoPago === 'ABONADA' ? 'ABONO' : '', [d.l.observaciones, m.observaciones].filter(Boolean).join(' · ')]);
  }
  if (!datos.length) vacia(ig, 'Sin servicios en el periodo.');

  // 3. Trazabilidad: de la sede del cliente al certificado
  const tz = hoja(wb, 'Trazabilidad', `TRAZABILIDAD DE RESIDUOS · ${periodo}`, fechaDocumento, [
    { t: 'Fecha de servicio', w: 14 }, { t: 'Manifiesto', w: 12 }, { t: 'Estado', w: 12 }, { t: 'Cliente', w: 30 }, { t: 'NIT', w: 14 }, { t: 'Sede generadora', w: 34 },
    { t: 'Municipio', w: 16 }, { t: 'Residuo o servicio', w: 34 }, { t: 'Peligroso', w: 10 }, { t: 'Cargado', w: 11 }, { t: 'Conciliado', w: 11 }, { t: 'Unidad', w: 8 },
    { t: 'Tratamiento', w: 26 }, { t: 'Destino', w: 28 }, { t: 'Recibido', w: 20 }, { t: 'Certificado', w: 14 }, { t: 'Factura', w: 13 },
  ], logo);
  for (const d of datos) {
    const m = d.l.manifiesto;
    fila(tz, [m.fechaServicio, m.numero, m.estado === 'REALIZADO' ? 'Grabado' : 'Pendiente', m.cliente.razonSocial, m.cliente.nit, d.l.sucursal.nombre, d.l.sucursal.municipio?.nombre ?? '',
      d.l.declaracion.nombre, d.l.declaracion.esPeligroso ? 'Sí' : 'No', r2(n(d.l.cantidad) ?? 0), d.ci?.cantidadConciliada !== null && d.ci?.cantidadConciliada !== undefined ? r2(n(d.ci.cantidadConciliada) ?? 0) : '',
      d.unidad, d.disposicion, m.destino.razonSocial, m.realizadoEn ? `${dia(m.realizadoEn)}${m.receptorNombre ? ` · ${m.receptorNombre}` : ''}` : '',
      d.ci?.acta?.estado === 'EMITIDA' ? d.ci.acta.numero : '', d.ci?.facturaNumero ?? ''], false);
  }
  if (!datos.length) vacia(tz, 'Sin servicios en el periodo.');

  // 4. Certificados de disposición (actas) y certificados comerciales
  const ce = hoja(wb, 'Certificados', `CERTIFICADOS EMITIDOS · ${periodo}`, fechaDocumento, [
    { t: 'Certificado', w: 14 }, { t: 'Emitido', w: 13 }, { t: 'Estado', w: 11 }, { t: 'Tipo', w: 18 }, { t: 'Cliente', w: 34 }, { t: 'NIT', w: 14 },
    { t: 'Periodo certificado', w: 24 }, { t: 'Destino', w: 30 }, { t: 'Líneas', w: 9 }, { t: 'Toneladas', w: 11 }, { t: 'Verificación', w: 60 },
  ], logo);
  for (const x of actas) {
    const kg = x.items.reduce((s, i) => { const f = n(i.metrica?.factorAKg); return f === null ? s : s + (n(i.cantidadConciliada) ?? n(i.cantidadCargada) ?? 0) * f; }, 0);
    fila(ce, [x.numero, x.emitidaEn ? new Date(Date.UTC(x.emitidaEn.getUTCFullYear(), x.emitidaEn.getUTCMonth(), x.emitidaEn.getUTCDate())) : '', x.estado === 'EMITIDA' ? 'Emitido' : 'Anulado',
      `${x.tipo}${x.origen === 'CARGADA' ? ' (aliado)' : ''}`, x.cliente.razonSocial, x.cliente.nit, `${dia(x.periodoDesde)} a ${dia(x.periodoHasta)}`, x.destino.razonSocial,
      x.items.length, r2(kg / 1000), `${webUrl.replace(/\/$/, '')}/#verificar/${x.codigoVerificacion}`], false);
  }
  if (!actas.length) vacia(ce, 'Sin certificados de disposición emitidos en el periodo.');
  ce.addRow([]);
  const cct = ce.addRow(['Certificados comerciales']); cct.font = { bold: true, color: { argb: VERDE_TITULO } };
  for (const x of comerciales) fila(ce, [x.numero, x.fecha, 'Emitido', 'Comercial', x.cliente.razonSocial, x.cliente.nit, '', '', '', '', `${webUrl.replace(/\/$/, '')}/#verificar/${x.codigoVerificacion}`], false);
  if (!comerciales.length) vacia(ce, 'Sin certificados comerciales en el periodo.');

  // 5. PDC: registro estadístico de despachos de mercancías peligrosas (formato PDC-RE-F-01)
  const pdc = hoja(wb, 'PDC · Despachos MP', 'REGISTRO ESTADÍSTICO DE DESPACHOS DE MERCANCÍAS PELIGROSAS (Decreto 1609 de 2002, art. 13, lit. N)', fechaDocumento, [
    { t: 'N.°', w: 6 }, { t: 'FECHA DEL DESPACHO', w: 14 }, { t: 'N.° MANIFIESTO / REMESA', w: 16 }, { t: 'PLACA', w: 10 }, { t: 'TIPO DE VEHÍCULO', w: 13 }, { t: 'CARROCERÍA', w: 12 },
    { t: 'PROPIO / CONTRATADO', w: 13 }, { t: 'NÚMERO UN', w: 11 }, { t: 'CLASE', w: 8 }, { t: 'NOMBRE APROPIADO DE TRANSPORTE', w: 46 }, { t: 'CANTIDAD', w: 11 },
    { t: 'UNIDAD (gal, kg, unid.)', w: 11 }, { t: 'PESO (kg)', w: 11 }, { t: 'REMITENTE (GENERADOR)', w: 34 }, { t: 'MUNICIPIO DE ORIGEN', w: 18 }, { t: 'MUNICIPIO DE DESTINO', w: 18 }, { t: 'GESTOR DE DESTINO', w: 34 },
  ], logo);
  despachosMp.forEach((d, i) => {
    const m = d.l.manifiesto; const un = (d.l.declaracion.codigoUn ?? '').toUpperCase().replace(/\s+/g, '');
    fila(pdc, [i + 1, m.fechaServicio, m.numero, m.vehiculo?.placa ?? '', m.vehiculo ? tipoVehiculo(m.vehiculo.tipo) : '', m.vehiculo ? carroceria(m.vehiculo.tipo) : '',
      m.vehiculo ? (m.vehiculo.proveedorId ? 'Contratado' : 'Propio') : '', un, UN[un]?.clase ?? '', UN[un]?.nombre ?? d.l.declaracion.nombre, r2(d.cantidad), d.unidad,
      d.kg !== null ? r2(d.kg) : '', m.cliente.razonSocial, d.l.sucursal.municipio?.nombre ?? '', m.destino.municipio ?? '', m.destino.razonSocial], false);
  });
  if (!despachosMp.length) vacia(pdc, 'Sin despachos de residuos peligrosos en el periodo.');

  // 6. RESPEL (Ministerio de Ambiente / IDEAM): residuos peligrosos por corriente
  const rp = hoja(wb, 'RESPEL', `RESIDUOS PELIGROSOS GESTIONADOS · ${periodo}`, fechaDocumento, [
    { t: 'Corriente Y', w: 10 }, { t: 'Código A', w: 10 }, { t: 'Descripción de la corriente', w: 46 }, { t: 'Residuo declarado', w: 36 }, { t: 'Cantidad', w: 11 }, { t: 'Unidad', w: 8 },
    { t: 'Kilogramos', w: 12 }, { t: 'Servicios', w: 10 }, { t: 'Generadores', w: 11 }, { t: 'Con registro RESPEL', w: 14 }, { t: 'Tratamiento', w: 28 },
  ], logo);
  const grupos = new Map<string, { y: string; a: string; desc: string; residuo: string; cantidad: number; unidad: string; kg: number | null; manif: Set<string>; gen: Set<string>; reg: Set<string>; trat: Set<string> }>();
  for (const d of peligrosas) {
    const dec = d.l.declaracion; const k = `${dec.codigoY?.codigo ?? ''}|${dec.codigoA?.codigo ?? ''}|${dec.nombre}|${d.unidad}`;
    const g = grupos.get(k) ?? { y: dec.codigoY?.codigo ?? '', a: dec.codigoA?.codigo ?? '', desc: dec.codigoY?.descripcion ?? '', residuo: dec.nombre, cantidad: 0, unidad: d.unidad, kg: 0, manif: new Set(), gen: new Set(), reg: new Set(), trat: new Set() };
    g.cantidad += d.cantidad; g.kg = d.kg === null || g.kg === null ? null : g.kg + d.kg;
    g.manif.add(d.l.manifiestoId); g.gen.add(d.l.sucursalId); if (d.l.sucursal.registroRespel) g.reg.add(d.l.sucursalId); if (d.disposicion) g.trat.add(d.disposicion);
    grupos.set(k, g);
  }
  for (const g of [...grupos.values()].sort((x, y) => x.y.localeCompare(y.y) || x.residuo.localeCompare(y.residuo)))
    fila(rp, [g.y, g.a, g.desc, g.residuo, r2(g.cantidad), g.unidad, g.kg !== null ? r2(g.kg) : '', g.manif.size, g.gen.size, g.reg.size, [...g.trat].join(', ')], false);
  if (!grupos.size) vacia(rp, 'Sin residuos peligrosos en el periodo.');

  // 7. PESV: inspecciones preoperacionales y documentos de la flota
  const pv = hoja(wb, 'PESV', `PESV · INSPECCIONES PREOPERACIONALES · ${periodo}`, fechaDocumento, [
    { t: 'Fecha', w: 12 }, { t: 'Inspección', w: 12 }, { t: 'Placa', w: 10 }, { t: 'Conductor', w: 30 }, { t: 'Resultado', w: 14 }, { t: 'Kilometraje', w: 12 }, { t: 'Observaciones', w: 60 },
  ], logo);
  for (const p of preops) fila(pv, [p.fechaProgramada, p.numero, p.vehiculo.placa, p.conductor.nombre, p.aprobado === true ? 'Aprobada' : p.aprobado === false ? 'No aprobada' : 'Sin realizar', p.km ?? '', p.observaciones ?? ''], false);
  if (!preops.length) vacia(pv, 'Sin inspecciones en el periodo.');
  pv.addRow([]);
  const vt = pv.addRow(['Placa', 'Tipo', 'Propio / contratado', 'SOAT vence', 'RTM vence', 'Póliza RC vence', 'Estado de documentos']);
  vt.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE_ENCABEZADO } }; c.border = BORDE; });
  for (const v of vehiculos) {
    const vencidos = [['SOAT', v.soatVence], ['RTM', v.rtmVence], ['Póliza RC', v.polizaRcVence]].filter(([, f]) => f instanceof Date && dia(f) < hoy).map(([t]) => t);
    fila(pv, [v.placa, v.tipo, v.proveedorId ? `Contratado (${v.proveedor?.razonSocial ?? ''})` : 'Propio', v.soatVence ?? '', v.rtmVence ?? '', v.polizaRcVence ?? '', vencidos.length ? `Vencido: ${vencidos.join(', ')}` : 'Al día'], false);
  }

  // 8. Licencias y permisos ambientales (propios y de los gestores aliados)
  const li = hoja(wb, 'Licencias', 'LICENCIAS Y PERMISOS AMBIENTALES', fechaDocumento, [
    { t: 'Acto administrativo', w: 30 }, { t: 'Autoridad', w: 12 }, { t: 'Alcance', w: 60 }, { t: 'Expedición', w: 12 }, { t: 'Vence', w: 12 }, { t: 'Estado', w: 12 },
  ], logo);
  for (const p of permisos) fila(li, [p.acto, p.autoridad, p.alcance, p.expedicion ?? '', p.vence ?? 'Sin término', vencidaPermiso(p.vence) ? 'Vencido' : p.estado === 'VIGENTE' ? 'Vigente' : p.estado], false);
  if (!permisos.length) vacia(li, 'Sin permisos registrados.');
  li.addRow([]);
  const ot = li.addRow(['Obligación', 'Código', 'Descripción', 'Periodicidad', 'Próxima fecha', 'Estado']);
  ot.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE_ENCABEZADO } }; c.border = BORDE; });
  for (const p of permisos) for (const o of p.obligaciones)
    fila(li, [p.acto, o.codigo ?? '', o.descripcion, o.periodicidad, o.proximaFecha ?? '', o.cumplida ? 'Cumplida' : o.proximaFecha && dia(o.proximaFecha) < hoy ? 'Vencida' : 'Pendiente'], false);
  li.addRow([]);
  const gt = li.addRow(['Gestor de destino', 'NIT', 'Licencia', 'Autoridad', 'Vence', 'Estado']);
  gt.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE_ENCABEZADO } }; c.border = BORDE; });
  for (const g of gestores)
    fila(li, [`${g.razonSocial}${g.esPropio ? ' (propio)' : ''}`, g.nit, g.licencia ?? '', g.licenciaAutoridad ?? '', g.licenciaIndefinida ? 'Indefinida' : g.licenciaVence ?? '',
      g.licenciaIndefinida ? 'Vigente' : !g.licenciaVence ? 'Sin fecha' : dia(g.licenciaVence) < hoy ? 'Vencida' : 'Vigente'], false);

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return {
    archivo: { buf, nombre: `super-informe-terra-viva-${dia(desde)}-a-${dia(hasta)}.xlsx`, ext: 'xlsx' },
    conteos: { lineas: lineas.length, servicios, certificados: actasEmitidas.length, despachosMp: despachosMp.length, inspecciones: preops.length, permisos: permisos.length },
  };
}
