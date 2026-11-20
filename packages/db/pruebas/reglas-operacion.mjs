// Pruebas de las reglas de la cadena operativa que viven en la base de datos (fase 3-A).
// Recorre Solicitud → Ruta → Manifiesto → Conciliación → Acta escribiendo DIRECTO en la base,
// para demostrar que las reglas no dependen de la API ni de la app.
// Uso (base migrada y sembrada):  DATABASE_URL=postgresql://... node pruebas/reglas-operacion.mjs
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
let ok = 0, fallas = 0;
const prueba = (nombre, cond, extra = '') => { if (cond) { ok++; console.log(`  ✓ ${nombre}`); } else { fallas++; console.log(`  ✗ ${nombre} ${extra}`); } };
/** La operación debe fallar con un mensaje que cumpla el patrón. */
async function rechaza(nombre, fn, patron) {
  try { await fn(); prueba(nombre, false, '(no la rechazó)'); }
  catch (e) { const m = String(e?.message ?? e); prueba(nombre, patron.test(m), `(mensaje: ${m.split('\n').slice(-3).join(' ').slice(0, 300)})`); }
}
const id = async (modelo, where) => (await db[modelo].findFirstOrThrow({ where, select: { id: true } })).id;

const empresa = await db.empresa.findFirstOrThrow({ where: { nit: '901089780-8' } });
const E = empresa.id;
const sufijo = String(Date.now()).slice(-6);
const admin = await db.usuario.findFirstOrThrow({ where: { empresaId: E } });
const planta = await db.proveedor.findFirstOrThrow({ where: { empresaId: E, esPropio: true } });
const [vehiculo] = await db.vehiculo.findMany({ where: { empresaId: E }, take: 1 });
const etapa = Object.fromEntries((await db.estadoRecorrido.findMany({ where: { empresaId: E } })).map((e) => [e.nombre, e.id]));
const causal = await id('catalogoItem', { empresaId: E, tipo: 'CAUSAL' });
const arl = await id('entidadSeguridadSocial', { tipo: 'ARL' });
const eps = await id('entidadSeguridadSocial', { tipo: 'EPS' });

// ---------- Datos base: cliente, 2 sedes, 2 declaraciones autorizadas (una con solicitud automática) ----------
const cliente = await db.cliente.create({ data: { empresaId: E, nit: `9${sufijo}01`, razonSocial: `Cliente reglas ${sufijo}` } });
const sedeA = await db.sucursal.create({ data: { clienteId: cliente.id, codigo: 'A', nombre: 'Sede A', esPrincipal: true } });
const sedeB = await db.sucursal.create({ data: { clienteId: cliente.id, codigo: 'B', nombre: 'Sede B' } });
async function declaracion(nombre, extra = {}) {
  const d = await db.declaracion.create({ data: {
    empresaId: E, tipo: 'RESIDUO', clienteId: cliente.id, nombre, codigoInterno: `${nombre}-${sufijo}`,
    categoriaId: await id('categoriaDeclarado', { empresaId: E, codigo: 'NOPEL' }), tipoResiduoId: await id('tipoResiduo', { empresaId: E, codigo: 'IND' }),
    lineaServicioId: await id('lineaServicio', { empresaId: E, codigo: '01' }), tipoEmbalajeId: await id('tipoEmbalaje', { empresaId: E, codigo: 'CANECA' }),
    materialEmbalajeId: await id('materialEmbalaje', { empresaId: E, codigo: 'MET' }), estadoFisico: 'SOLIDO', inflamable: false, controladaEstupefacientes: false,
    descripcionProceso: 'Prueba', responsabilidadAceptada: true, aceptadaEn: new Date(), ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'disposicion')),
    sucursales: { create: [{ sucursalId: sedeA.id }] },
    disposiciones: { create: [{ disposicionId: await id('disposicion', { empresaId: E, codigo: extra.disposicion ?? 'BIO' }), principal: true }] },
    tarifas: { create: [{ precioUnitario: 500, tipoNegociacion: 'COBRO', formaPago: 'CONTADO', vigenteDesde: new Date('2026-01-01'), metricaId: await id('metrica', { empresaId: E, codigo: 'kg' }) }] },
  } });
  return db.declaracion.update({ where: { id: d.id }, data: { estado: 'AUTORIZADA', activa: true } });
}
const dAuto = await declaracion('AUTO', { solicitudAutomatica: true, frecuenciaDias: 30, cantidadFrecuencia: 100 });
const dSimple = await declaracion('SIMPLE');

console.log('\n1. Solicitudes y programación por línea');
const sol = await db.solicitud.create({ data: { empresaId: E, clase: 'FORMAL', clienteId: cliente.id, fechaSolicitada: new Date('2026-12-01'),
  items: { create: [{ declaracionId: dAuto.id, sucursalId: sedeA.id, cantidadEstimada: 100 }, { declaracionId: dSimple.id, sucursalId: sedeA.id, cantidadEstimada: 50 }] } }, include: { items: true } });
await rechaza('línea con declaración no asignada a la sede → rechazada', () =>
  db.solicitudItem.create({ data: { solicitudId: sol.id, declaracionId: dSimple.id, sucursalId: sedeB.id, cantidadEstimada: 1 } }), /no está asignada a esa sede/);
const ruta1 = await db.ruta.create({ data: { empresaId: E, codigo: `RG1-${sufijo}`, fechaProgramada: new Date('2026-12-01'), estadoRecorridoId: etapa['Programada'] } });
const parada1 = await db.rutaParada.create({ data: { rutaId: ruta1.id, sucursalId: sedeA.id, orden: 1 } });
const [linea1, linea2] = sol.items;
await rechaza('programar una solicitud sin aprobar → rechazado', () =>
  db.rutaItem.create({ data: { rutaId: ruta1.id, paradaId: parada1.id, solicitudItemId: linea1.id } }), /no está aprobada/);
await db.solicitud.update({ where: { id: sol.id }, data: { aprobacion: 'APROBADA', aprobadaEn: new Date() } });
await db.rutaItem.create({ data: { rutaId: ruta1.id, paradaId: parada1.id, solicitudItemId: linea1.id } });
let s = await db.solicitud.findUniqueOrThrow({ where: { id: sol.id }, include: { items: true } });
prueba('programación parcial: la línea queda PROGRAMADA y la solicitud sigue PENDIENTE', s.items.find((i) => i.id === linea1.id).estado === 'PROGRAMADO' && s.estado === 'PENDIENTE');
await db.rutaItem.create({ data: { rutaId: ruta1.id, paradaId: parada1.id, solicitudItemId: linea2.id } });
s = await db.solicitud.findUniqueOrThrow({ where: { id: sol.id } });
prueba('con todas sus líneas en ruta la solicitud pasa a PROGRAMADA', s.estado === 'PROGRAMADA');
const ruta2 = await db.ruta.create({ data: { empresaId: E, codigo: `RG2-${sufijo}`, fechaProgramada: new Date('2026-12-02'), estadoRecorridoId: etapa['Programada'], vehiculoId: vehiculo.id, conductorId: admin.id } });
const parada2 = await db.rutaParada.create({ data: { rutaId: ruta2.id, sucursalId: sedeA.id, orden: 1 } });
await rechaza('la misma línea en otra ruta → rechazada', () =>
  db.rutaItem.create({ data: { rutaId: ruta2.id, paradaId: parada2.id, solicitudItemId: linea1.id } }), /ya está programada/);

console.log('\n2. Rutas y rastreo');
await rechaza('ruta sin vehículo ni conductor no sale', () => db.ruta.update({ where: { id: ruta1.id }, data: { estadoRecorridoId: etapa['En camino'] } }), /asigne vehículo y conductor/);
await rechaza('GPS con la ruta en una etapa sin rastreo → no se guarda', () =>
  db.rutaRastreo.create({ data: { rutaId: ruta1.id, latitud: 7.39, longitud: -73.5, registradoEn: new Date() } }), /etapa con rastreo/);
await db.ruta.update({ where: { id: ruta1.id }, data: { estadoRecorridoId: etapa['Cancelada'] } });
s = await db.solicitud.findUniqueOrThrow({ where: { id: sol.id }, include: { items: true } });
prueba('al cancelar la ruta sus líneas vuelven a PENDIENTE', s.estado === 'PENDIENTE' && s.items.every((i) => i.estado === 'PENDIENTE'));
for (const l of [linea1, linea2]) await db.rutaItem.create({ data: { rutaId: ruta2.id, paradaId: parada2.id, solicitudItemId: l.id } });
prueba('y se pueden programar en otra ruta', (await db.solicitud.findUniqueOrThrow({ where: { id: sol.id } })).estado === 'PROGRAMADA');
await db.preoperacional.create({ data: { vehiculoId: vehiculo.id, rutaId: ruta2.id, conductorId: admin.id, fechaProgramada: new Date('2026-12-02'), aprobado: true } });
const antesDeSalir = new Date(Date.now() - 1000);
await new Promise((r) => setTimeout(r, 20));
await db.ruta.update({ where: { id: ruta2.id }, data: { estadoRecorridoId: etapa['En camino'] } });
await new Promise((r) => setTimeout(r, 20));
const enCamino = new Date();
await db.rutaRastreo.create({ data: { rutaId: ruta2.id, latitud: 7.39, longitud: -73.5, registradoEn: enCamino } });
prueba('GPS en una etapa con rastreo sí se guarda', (await db.rutaRastreo.count({ where: { rutaId: ruta2.id } })) === 1);
await new Promise((r) => setTimeout(r, 20));
await db.ruta.update({ where: { id: ruta2.id }, data: { estadoRecorridoId: etapa['Donde el generador'] } });
await db.rutaRastreo.create({ data: { rutaId: ruta2.id, latitud: 7.40, longitud: -73.51, registradoEn: new Date(enCamino.getTime() + 5) } });
prueba('sin señal: el punto tomado «en camino» que llega después igual se guarda', (await db.rutaRastreo.count({ where: { rutaId: ruta2.id } })) === 2);
await rechaza('…pero uno tomado antes de salir de planta no', () =>
  db.rutaRastreo.create({ data: { rutaId: ruta2.id, latitud: 7.40, longitud: -73.51, registradoEn: antesDeSalir } }), /etapa con rastreo a esa hora/);
await rechaza('ni uno con hora en el futuro', () =>
  db.rutaRastreo.create({ data: { rutaId: ruta2.id, latitud: 7.40, longitud: -73.51, registradoEn: new Date(Date.now() + 3600e3) } }), /futuro/);

console.log('\n3. Manifiesto de cargue');
const mf = await db.manifiesto.create({ data: { empresaId: E, tipo: 'CARGUE', rutaId: ruta2.id, clienteId: cliente.id, destinoId: planta.id, fechaServicio: new Date('2026-12-02'), vehiculoId: vehiculo.id, conductorId: admin.id } });
prueba(`la base asigna el consecutivo con el formato de Terra Viva (${mf.numero})`, /^TV\d{4,}$/.test(mf.numero));
await rechaza('línea de residuo no declarado en esa sede → rechazada', () =>
  db.manifiestoItem.create({ data: { manifiestoId: mf.id, declaracionId: dSimple.id, sucursalId: sedeB.id, cantidad: 10 } }), /no está asignada a esa sede/);
const kg = await id('metrica', { empresaId: E, codigo: 'kg' });
for (const l of [linea1, linea2]) await db.manifiestoItem.create({ data: { manifiestoId: mf.id, solicitudItemId: l.id, declaracionId: l.declaracionId, sucursalId: sedeA.id, cantidad: 100, metricaId: kg, precioUnitario: 500 } });
await rechaza('peso neto que no cuadra con entrada − salida → rechazado', () =>
  db.manifiesto.update({ where: { id: mf.id }, data: { pesoEntrada: 9000, pesoSalida: 7000, pesoNeto: 1500 } }), /chk_mf_peso_neto/);
await rechaza('grabar sin firma ni horas → rechazado y dice qué falta', () =>
  db.manifiesto.update({ where: { id: mf.id }, data: { estado: 'REALIZADO' } }), /falta la firma del conductor.*la hora de llegada/);
await db.manifiestoEvidencia.createMany({ data: [1, 2].map((n) => ({ manifiestoId: mf.id, tipo: 'FOTO', url: `s3://foto${n}.jpg` })) });
await rechaza('una tercera foto → rechazada', () => db.manifiestoEvidencia.create({ data: { manifiestoId: mf.id, tipo: 'FOTO', url: 's3://foto3.jpg' } }), /máximo de evidencias/);
const llegada = new Date('2026-12-02T09:00:00-05:00');
await db.manifiesto.update({ where: { id: mf.id }, data: { pesoEntrada: 9000, pesoSalida: 7000, pesoNeto: 2000, horaLlegada: llegada, horaSalida: new Date(llegada.getTime() + 3600e3),
  firmaUrl: 's3://firma.png', firmaNombre: 'Conductor de prueba', firmaDocumento: '123', estado: 'REALIZADO', realizadoPorId: admin.id } });
s = await db.solicitud.findUniqueOrThrow({ where: { id: sol.id }, include: { items: true } });
prueba('grabar: las líneas quedan REALIZADAS y la solicitud RECOLECTADA', s.estado === 'RECOLECTADA' && s.items.every((i) => i.estado === 'REALIZADO' && Number(i.cantidadReal) === 100));
const conc = await db.conciliacion.findUniqueOrThrow({ where: { manifiestoId: mf.id }, include: { items: true } });
prueba('grabar: se abre la conciliación en borrador con la cantidad cargada y el precio', conc.estado === 'BORRADOR' && conc.items.length === 2 && conc.items.every((i) => Number(i.cantidadCargada) === 100 && Number(i.precioUnitario) === 500 && i.tipoNegociacion === 'COBRO'));
const pre = await db.solicitud.findFirst({ where: { manifiestoOrigenId: mf.id }, include: { items: true } });
prueba('grabar: nace la solicitud recurrente (PRE) a 30 días para la declaración automática', pre?.clase === 'PRE' && pre.fechaSolicitada.toISOString().startsWith('2027-01-01') && pre.items.length === 1 && pre.items[0].declaracionId === dAuto.id);
await rechaza('cambiar un manifiesto grabado → rechazado', () => db.manifiesto.update({ where: { id: mf.id }, data: { pesoNeto: 1 } }), /ya fue grabado/);
await rechaza('agregarle líneas → rechazado', () => db.manifiestoItem.create({ data: { manifiestoId: mf.id, declaracionId: dSimple.id, sucursalId: sedeA.id, cantidad: 5 } }), /ya está grabado o anulado/);
await db.manifiestoEvidencia.create({ data: { manifiestoId: mf.id, tipo: 'PDF', url: 's3://escaneado.pdf' } });
prueba('el PDF escaneado sí puede llegar después de grabar', (await db.manifiestoEvidencia.count({ where: { manifiestoId: mf.id, tipo: 'PDF' } })) === 1);

console.log('\n4. Conciliación');
const [c1, c2] = conc.items;
await rechaza('aprobar sin cantidades conciliadas → rechazado', () => db.conciliacion.update({ where: { id: conc.id }, data: { estado: 'APROBADA' } }), /sin cantidad conciliada/);
await rechaza('diferencia de más de ±2 % sin justificación → rechazada', () => db.conciliacionItem.update({ where: { id: c1.id }, data: { cantidadConciliada: 90 } }), /chk_justificacion_diferencia/);
await db.conciliacionItem.update({ where: { id: c1.id }, data: { cantidadConciliada: 90, justificacion: 'Báscula de planta' } });
await db.conciliacionItem.update({ where: { id: c2.id }, data: { cantidadConciliada: 101 } });
await db.conciliacion.update({ where: { id: conc.id }, data: { estado: 'APROBADA', aprobadaPorId: admin.id } });
prueba('con cantidades y justificación se aprueba', (await db.conciliacion.findUniqueOrThrow({ where: { id: conc.id } })).estado === 'APROBADA');
await rechaza('cambiar cantidades después de aprobar → rechazado', () => db.conciliacionItem.update({ where: { id: c2.id }, data: { cantidadConciliada: 100 } }), /solo se pueden cambiar los datos de factura/);
await db.conciliacionItem.update({ where: { id: c2.id }, data: { facturaNumero: 'FE-100', facturaEmision: new Date('2026-12-05'), facturaVencimiento: new Date('2027-01-04'), estadoPago: 'PAGADA' } });
prueba('pero sí la factura y el pago (cartera)', (await db.conciliacionItem.findUniqueOrThrow({ where: { id: c2.id } })).estadoPago === 'PAGADA');
await rechaza('anular un manifiesto con la conciliación aprobada → rechazado', () =>
  db.manifiesto.update({ where: { id: mf.id }, data: { estado: 'ANULADO', motivoAnulacion: 'prueba' } }), /conciliación aprobada/);

console.log('\n5. Actas');
const acta = await db.acta.create({ data: { empresaId: E, tipo: 'DISPOSICION', clienteId: cliente.id, destinoId: planta.id, periodoDesde: new Date('2026-12-01'), periodoHasta: new Date('2026-12-31') } });
prueba(`la base asigna consecutivo y código de verificación (${acta.numero})`, /^PSAP\d{4}-\d+$/.test(acta.numero) && acta.codigoVerificacion.length === 24);
await rechaza('emitir un acta sin líneas → rechazado', () => db.acta.update({ where: { id: acta.id }, data: { estado: 'EMITIDA' } }), /no tiene líneas/);
await db.conciliacionItem.updateMany({ where: { conciliacionId: conc.id }, data: { actaId: acta.id } });
await rechaza('emitir sin el contenido certificado → rechazado', () => db.acta.update({ where: { id: acta.id }, data: { estado: 'EMITIDA' } }), /contenido certificado/);
await db.acta.update({ where: { id: acta.id }, data: { contenido: { lineas: 2 }, estado: 'EMITIDA', emitidaPorId: admin.id } });
prueba('con líneas aprobadas y contenido se emite', (await db.acta.findUniqueOrThrow({ where: { id: acta.id } })).estado === 'EMITIDA');
await rechaza('modificar un acta emitida → rechazado', () => db.acta.update({ where: { id: acta.id }, data: { periodoHasta: new Date('2027-01-31') } }), /ya fue emitida/);
await rechaza('devolver a borrador una conciliación ya certificada → rechazado', () => db.conciliacion.update({ where: { id: conc.id }, data: { estado: 'BORRADOR' } }), /acta emitida/);
await db.acta.update({ where: { id: acta.id }, data: { estado: 'ANULADA', motivoAnulacion: 'Prueba de anulación' } });
prueba('al anular el acta sus líneas quedan libres para otra', (await db.conciliacionItem.count({ where: { conciliacionId: conc.id, actaId: null } })) === 2);

console.log('\n6. Descargue en planta y anulación');
const sol2 = await db.solicitud.create({ data: { empresaId: E, clase: 'FORMAL', operacion: 'DESCARGA', clienteId: cliente.id, fechaSolicitada: new Date('2026-12-03'), aprobacion: 'APROBADA', aprobadaEn: new Date(),
  items: { create: [{ declaracionId: dSimple.id, sucursalId: sedeA.id, cantidadEstimada: 20 }] } }, include: { items: true } });
await rechaza('un descargue no lleva ruta', () => db.manifiesto.create({ data: { empresaId: E, tipo: 'DESCARGUE', rutaId: ruta2.id, clienteId: cliente.id, destinoId: planta.id, fechaServicio: new Date('2026-12-03') } }), /chk_mf_descargue_sin_ruta/);
const tercero = await db.transporteTercero.create({ data: { empresaId: E, empresaTransportadora: 'Transportes Prueba', placa: 'ABC123', conductorNombre: 'Conductor tercero', conductorDocumento: '999' } });
const mf2 = await db.manifiesto.create({ data: { empresaId: E, tipo: 'DESCARGUE', clienteId: cliente.id, destinoId: planta.id, fechaServicio: new Date('2026-12-03'), transporteId: tercero.id,
  items: { create: [{ solicitudItemId: sol2.items[0].id, declaracionId: dSimple.id, sucursalId: sedeA.id, cantidad: 20 }] } } });
const cierre = { horaLlegada: llegada, horaSalida: new Date(llegada.getTime() + 600e3), firmaUrl: 's3://f.png', firmaNombre: 'Tercero', firmaDocumento: '999', estado: 'REALIZADO' };
await rechaza('descargue sin peso neto ni ARL/EPS del conductor → no se graba', () => db.manifiesto.update({ where: { id: mf2.id }, data: cierre }), /peso neto.*ARL y EPS del conductor/);
await db.transporteTercero.update({ where: { id: tercero.id }, data: { conductorArlId: arl, conductorEpsId: eps } });
await rechaza('descargue sin la firma del receptor de Terra Viva → no se graba', () => db.manifiesto.update({ where: { id: mf2.id }, data: { ...cierre, pesoNeto: 20 } }), /chk_mf_descargue_receptor/);
await db.manifiesto.update({ where: { id: mf2.id }, data: { ...cierre, pesoNeto: 20, firmaReceptorUrl: 's3://r.png', receptorNombre: 'Receptor planta' } });
prueba('con báscula, seguridad social y las dos firmas se graba', (await db.manifiesto.findUniqueOrThrow({ where: { id: mf2.id } })).estado === 'REALIZADO');
await rechaza('anular sin causal ni motivo → rechazado', () => db.manifiesto.update({ where: { id: mf2.id }, data: { estado: 'ANULADO' } }), /chk_mf_anulado/);
await db.manifiesto.update({ where: { id: mf2.id }, data: { estado: 'ANULADO', causalAnulacionId: causal } });
const tras = await db.solicitudItem.findUniqueOrThrow({ where: { id: sol2.items[0].id } });
const concAnulada = await db.conciliacion.findUnique({ where: { manifiestoId: mf2.id }, include: { items: true } });
prueba('anular: la conciliación queda ANULADA (no se borra) y la línea vuelve a PENDIENTE',
  concAnulada?.estado === 'ANULADA' && concAnulada.items.length === 1 && tras.estado === 'PENDIENTE' && tras.cantidadReal === null);
await rechaza('una conciliación anulada no se modifica', () => db.conciliacionItem.update({ where: { id: concAnulada.items[0].id }, data: { cantidadConciliada: 1 } }), /está anulada/);
await rechaza('ni se aprueba', () => db.conciliacion.update({ where: { id: concAnulada.id }, data: { estado: 'APROBADA' } }), /está anulada/);
await rechaza('un manifiesto anulado no se modifica', () => db.manifiesto.update({ where: { id: mf2.id }, data: { observaciones: 'x' } }), /está anulado/);


console.log('\n7. Respuestas de la gerencia (19-11-2026): peligrosos, Los Pinos y cuatro ojos');
const peligroso = { esPeligroso: true, composicion: 'Hidrocarburo', fichaSeguridadUrl: 'https://lab/fds.pdf', codigoYId: await id('codigoClasificacion', { codigo: 'Y9' }), categoriaId: await id('categoriaDeclarado', { empresaId: E, codigo: 'RESPEL' }) };
await rechaza('un peligroso con biorremediación en Los Pinos no queda autorizado (Res. 000632, art. 6)', () => declaracion('PELIGROSO-BIO', peligroso), /sin características de peligrosidad/);
const dRespel = await declaracion('PELIGROSO-DF', { ...peligroso, disposicion: 'DF' });
prueba('un peligroso a celda de seguridad con un gestor aliado vigente sí queda autorizado', dRespel.estado === 'AUTORIZADA');
await rechaza('Los Pinos no recibe ni almacena un peligroso: manifiesto con destino a la planta → rechazado', () => db.manifiesto.create({ data: { empresaId: E, tipo: 'DESCARGUE', clienteId: cliente.id, destinoId: planta.id, fechaServicio: new Date('2026-12-04'), transporteId: tercero.id,
  items: { create: [{ declaracionId: dRespel.id, sucursalId: sedeA.id, cantidad: 5 }] } } }), /no puede recibir ni almacenar/);
const gestorDf = await db.proveedor.findFirstOrThrow({ where: { empresaId: E, nit: '901483038-1' } });
const mfAliado = await db.manifiesto.create({ data: { empresaId: E, tipo: 'DESCARGUE', clienteId: cliente.id, destinoId: gestorDf.id, fechaServicio: new Date('2026-12-04'), transporteId: tercero.id,
  items: { create: [{ declaracionId: dRespel.id, sucursalId: sedeA.id, cantidad: 5 }] } } });
prueba('…con destino al gestor aliado sí se registra', !!mfAliado.id);
await rechaza('BIO con hidrocarburos sin caracterización CRETIB → no queda autorizada', () => declaracion('HC-BIO', { contieneHidrocarburos: true }), /caracterización de peligrosidad/);
prueba('…con la caracterización cargada sí', (await declaracion('HC-BIO-OK', { contieneHidrocarburos: true, caracterizacionUrl: 'https://lab/cretib.pdf' })).estado === 'AUTORIZADA');
await rechaza('cuatro ojos: quien pidió la revisión no puede figurar como quien la autoriza', () => db.declaracion.update({ where: { id: dRespel.id }, data: { revisionPedidaPorId: admin.id, aprobadaPorId: admin.id } }), /chk_decl_cuatro_ojos/);

console.log('\n8. Fase C: cargue desde CSV y deshacer un cargue (nada se borra)');
const datosLote = (x = {}) => ({ empresaId: E, plantilla: 'decl-residuos', tipoCargue: 'DECLARACIONES', archivo: `reglas-${sufijo}.csv`, formato: 'CSV', delimitador: ';',
  estado: 'CONFIRMADO', filasLeidas: 1, filasOk: 1, filasError: 0, usuarioId: admin.id, ...x });
await rechaza('un cargue en CSV sin su separador no se registra', () => db.cargueMasivo.create({ data: datosLote({ delimitador: null }) }), /chk_cargue_formato/);
const loteA = await db.cargueMasivo.create({ data: datosLote() });
const loteB = await db.cargueMasivo.create({ data: datosLote({ archivo: `reglas-${sufijo}-b.xlsx`, formato: 'XLSX', delimitador: null }) });
const dLote = await declaracion('LOTE', { cargueId: loteA.id });
const dLoteUso = await declaracion('LOTE-USO', { cargueId: loteB.id });
await db.solicitud.create({ data: { empresaId: E, clase: 'FORMAL', clienteId: cliente.id, fechaSolicitada: new Date('2026-12-05'), items: { create: [{ declaracionId: dLoteUso.id, sucursalId: sedeA.id }] } } });
await rechaza('una declaración que ya está en una solicitud no se anula', () => db.declaracion.update({ where: { id: dLoteUso.id }, data: { estado: 'ANULADA', activa: false } }), /ya tiene solicitudes o manifiestos/);
await rechaza('una anulada no queda activa', () => db.declaracion.update({ where: { id: dLote.id }, data: { estado: 'ANULADA' } }), /chk_decl_activa_autorizada/);
const anulada = await db.declaracion.update({ where: { id: dLote.id }, data: { estado: 'ANULADA', activa: false } });
prueba('sin uso, la declaración del lote se anula: queda como constancia, inactiva', anulada.estado === 'ANULADA' && !anulada.activa);
await rechaza('una anulada no se modifica (ni vuelve a autorizarse)', () => db.declaracion.update({ where: { id: dLote.id }, data: { estado: 'AUTORIZADA', activa: true } }), /está anulada/);
await rechaza('…ni sus precios', () => db.tarifa.create({ data: { declaracionId: dLote.id, precioUnitario: 1, tipoNegociacion: 'COBRO', formaPago: 'CONTADO', vigenteDesde: new Date('2027-01-01') } }), /está anulada/);
await rechaza('…ni sus sedes', () => db.declaracionSucursal.create({ data: { declaracionId: dLote.id, sucursalId: sedeB.id } }), /está anulada/);
const reuso = await declaracion('LOTE');
prueba('su código interno queda libre: el archivo corregido crea otra con el mismo código', reuso.codigoInterno === anulada.codigoInterno && reuso.id !== anulada.id);
await rechaza('…pero dos vigentes del mismo cliente no repiten código', () => declaracion('LOTE'), /Unique constraint/);
await rechaza('deshacer el lote exige el motivo', () => db.cargueMasivo.update({ where: { id: loteA.id }, data: { estado: 'REVERTIDO', revertidoEn: new Date(), revertidoPorId: admin.id } }), /chk_cargue_revertido/);
const deshecho = await db.cargueMasivo.update({ where: { id: loteA.id }, data: { estado: 'REVERTIDO', revertidoEn: new Date(), revertidoPorId: admin.id, motivoReversion: 'Prueba de reglas: archivo equivocado' } });
prueba('con sus declaraciones anuladas y el motivo, el lote queda deshecho', deshecho.estado === 'REVERTIDO');
await rechaza('un lote deshecho no cambia más', () => db.cargueMasivo.update({ where: { id: loteA.id }, data: { archivo: 'otro.csv' } }), /ya se deshizo/);
await rechaza('un lote con declaraciones sin anular no se deshace', () => db.cargueMasivo.update({ where: { id: loteB.id }, data: { estado: 'REVERTIDO', revertidoEn: new Date(), revertidoPorId: admin.id, motivoReversion: 'Prueba de reglas: no debe pasar' } }), /primero se anulan/);
const loteSedes = await db.cargueMasivo.create({ data: datosLote({ plantilla: 'sucursales', tipoCargue: 'SUCURSALES', formato: 'XLSX', delimitador: null }) });
await rechaza('solo se deshacen cargues de declaraciones', () => db.cargueMasivo.update({ where: { id: loteSedes.id }, data: { estado: 'REVERTIDO', revertidoEn: new Date(), revertidoPorId: admin.id, motivoReversion: 'Prueba de reglas: sedes' } }), /Solo se deshacen cargues de declaraciones/);

console.log('\n9. Historial de cumplimiento de obligaciones (fase 1c)');
const oblR = await db.obligacionPermiso.findFirstOrThrow({ where: { permiso: { empresaId: E } } });
await rechaza('un cumplimiento sin radicado, enlace ni nota no se registra', () => db.obligacionCumplimiento.create({ data: { obligacionId: oblR.id, cumplidaEn: new Date(), usuarioId: admin.id } }), /chk_cumplimiento_soporte/);
const cumR = await db.obligacionCumplimiento.create({ data: { obligacionId: oblR.id, cumplidaEn: new Date(), radicado: 'R-1', usuarioId: admin.id } });
prueba('con el radicado sí queda registrado', !!cumR.id);
await rechaza('…y el historial no se modifica', () => db.obligacionCumplimiento.update({ where: { id: cumR.id }, data: { radicado: 'R-2' } }), /no se modifica ni se borra/);
await rechaza('…ni se borra', () => db.obligacionCumplimiento.delete({ where: { id: cumR.id } }), /no se modifica ni se borra/);
await rechaza('…ni se borra la obligación que lo tiene', () => db.obligacionPermiso.delete({ where: { id: oblR.id } }), /Foreign key|violates|obligacion_cumplimientos/i);

console.log('\n10. Portal de clientes: usuarios del cliente y barrera en la base');
const [rolBase] = await db.$queryRaw`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
prueba('la base se usa con un usuario sin superusuario ni BYPASSRLS (si no, la RLS no actúa)', !rolBase.rolsuper && !rolBase.rolbypassrls, JSON.stringify(rolBase));
const rolPortal = await db.rol.findFirstOrThrow({ where: { empresaId: E, nombre: 'Cliente (portal)' } });
const datosPortal = (x) => ({ empresaId: E, rolId: rolPortal.id, nombre: 'Portal reglas', documento: '9' + sufijo, email: `portal.${x}.${sufijo}@reglas.test`, passwordHash: 'x', clienteId: cliente.id, perfilPortal: 'CONSULTA' });
await rechaza('un usuario del portal lleva su perfil (y uno de oficina no lo lleva)', () => db.usuario.create({ data: { ...datosPortal('a'), perfilPortal: null } }), /chk_usuario_portal/);
await rechaza('un usuario del portal no es conductor ni auxiliar', () => db.usuario.create({ data: { ...datosPortal('b'), esConductor: true } }), /chk_usuario_portal_campo/);
const otroCliente = await db.cliente.create({ data: { empresaId: E, nit: `8${sufijo}02`, razonSocial: `Otro cliente reglas ${sufijo}` } });
const sedeOtro = await db.sucursal.create({ data: { clienteId: otroCliente.id, nombre: 'Sede de otro cliente' } });
const usuarioPortal = await db.usuario.create({ data: datosPortal('c') });
await rechaza('no se le asigna una sede de otro cliente', () => db.usuarioSucursal.create({ data: { usuarioId: usuarioPortal.id, sucursalId: sedeOtro.id } }), /no es del cliente/);
const vista = await db.$transaction(async (tx) => { await tx.$executeRaw`SELECT set_config('app.cliente_id', ${otroCliente.id}, true)`; return { suyos: await tx.sucursal.count(), ajenas: await tx.declaracion.count({ where: { clienteId: cliente.id } }) }; });
prueba('RLS: con la sesión de un cliente, la base solo muestra sus filas', vista.suyos === 1 && vista.ajenas === 0, JSON.stringify(vista));

// Lo que puede escribir una sesión del portal (migración 20261127000000_portal_escritura), además del aislamiento
const comoCliente = (fn) => db.$transaction(async (tx) => { await tx.$executeRaw`SELECT set_config('app.cliente_id', ${cliente.id}, true)`; return fn(tx); });
const RLS = /row-level security|seguridad de registros/i;
await rechaza('portal: el cliente no fija tarifas (las fija Terra Viva)', () => comoCliente((tx) => tx.tarifa.create({ data: {
  declaracionId: dSimple.id, precioUnitario: 1, tipoNegociacion: 'COBRO', formaPago: 'CONTADO', vigenteDesde: new Date('2027-01-01'), metricaId: kg } })), RLS);
const cambioDecl = await comoCliente((tx) => tx.declaracion.updateMany({ where: { id: dSimple.id }, data: { observaciones: 'Cambiada desde el portal' } }));
prueba('portal: no cambia una declaración ya creada (la revisa y la autoriza Terra Viva)', cambioDecl.count === 0, JSON.stringify(cambioDecl));
await rechaza('portal: no crea una solicitud ya aprobada (queda por confirmar)', () => comoCliente((tx) => tx.solicitud.create({ data: {
  empresaId: E, clase: 'FORMAL', clienteId: cliente.id, fechaSolicitada: new Date('2027-01-15'), aprobacion: 'APROBADA', aprobadaEn: new Date() } })), RLS);
const pedido = await comoCliente(async (tx) => {
  const p = await tx.solicitud.create({ data: { empresaId: E, clase: 'FORMAL', clienteId: cliente.id, fechaSolicitada: new Date('2027-01-15') } });
  await tx.solicitudItem.create({ data: { solicitudId: p.id, declaracionId: dSimple.id, sucursalId: sedeA.id, cantidadEstimada: 10 } });
  return p;
});
await comoCliente((tx) => tx.solicitud.update({ where: { id: pedido.id }, data: { estado: 'CANCELADA', causalCancelacionId: causal } }));
const cancelado = await db.solicitud.findUniqueOrThrow({ where: { id: pedido.id }, include: { items: true } });
prueba('portal: pide un servicio (pendiente) y lo cancela; la base descarta sus líneas', cancelado.estado === 'CANCELADA' && cancelado.items.length === 1
  && cancelado.items.every((i) => i.estado === 'DESCARTADO'), JSON.stringify({ estado: cancelado.estado, lineas: cancelado.items.map((i) => i.estado) }));
const [cambioSol, cambioMf, cambioUsuario] = await comoCliente(async (tx) => [
  await tx.solicitud.updateMany({ where: { id: sol.id }, data: { observaciones: 'Cambiada desde el portal' } }),
  await tx.manifiesto.updateMany({ where: { clienteId: cliente.id }, data: { observaciones: 'Cambiado desde el portal' } }),
  await tx.usuario.updateMany({ where: { id: admin.id }, data: { telefono: '3000000000' } }),
]);
prueba('portal: no cambia solicitudes ya confirmadas, ni manifiestos, ni usuarios de Terra Viva', cambioSol.count === 0 && cambioMf.count === 0 && cambioUsuario.count === 0,
  JSON.stringify([cambioSol.count, cambioMf.count, cambioUsuario.count]));

console.log('\n11. Verificación en dos pasos: coherente en la base');
const conDosPasos = await db.usuario.create({ data: { empresaId: E, rolId: admin.rolId, nombre: 'Dos pasos reglas', documento: '7' + sufijo, email: `dos.pasos.${sufijo}@reglas.test`, passwordHash: 'x' } });
await rechaza('no queda «activa desde» sin la clave guardada', () => db.usuario.update({ where: { id: conDosPasos.id }, data: { totpActivoDesde: new Date() } }), /chk_totp_activo/);
await rechaza('…ni la clave guardada sin la fecha en que se activó', () => db.usuario.update({ where: { id: conDosPasos.id }, data: { totpSecreto: 'iv.tag.datos' } }), /chk_totp_activo/);
const activa = await db.usuario.update({ where: { id: conDosPasos.id }, data: { totpSecreto: 'iv.tag.datos', totpActivoDesde: new Date(), codigosRespaldo: { create: [{ codigoHash: 'a'.repeat(64) }] } }, include: { codigosRespaldo: true } });
prueba('activa: clave y fecha juntas, con sus códigos de respaldo', !!activa.totpActivoDesde && activa.codigosRespaldo.length === 1 && activa.codigosRespaldo[0].usadoEn === null);

console.log('\n12. Cola de trabajos y certificados sujetos al pago');
const trabajo = (data) => db.trabajo.create({ data: { empresaId: E, usuarioId: admin.id, tipo: 'ZIP_ACTAS', titulo: 'Prueba de reglas', ...data } });
await rechaza('un trabajo listo lleva su archivo, el nombre con que se descarga y hasta cuándo', () => trabajo({ estado: 'LISTO' }), /chk_trabajo_listo/);
await rechaza('…y uno fallido, el motivo', () => trabajo({ estado: 'FALLIDO' }), /chk_trabajo_fallido/);
const pendiente = await trabajo({});
prueba('un trabajo nuevo queda pendiente en la cola', pendiente.estado === 'PENDIENTE' && pendiente.intentos === 0);
const actaViva = await db.acta.findFirst({ where: { empresaId: E, estado: { not: 'ANULADA' } } });
if (actaViva) await rechaza('liberar la descarga de un certificado deja quién y cuándo', () => db.acta.update({ where: { id: actaViva.id }, data: { descargaLiberadaEn: new Date() } }), /chk_acta_liberada/);

console.log('\n13. GPS de la flota (Wialon): la evidencia no se borra');
const [otroVehiculo] = await db.vehiculo.findMany({ where: { empresaId: E, id: { not: vehiculo.id } }, take: 1 });
const unidad = 900000 + Number(sufijo.slice(-3));
await db.vehiculo.update({ where: { id: vehiculo.id }, data: { wialonUnidadId: unidad } });
await rechaza('una unidad de Wialon es de un solo vehículo', () => db.vehiculo.update({ where: { id: otroVehiculo.id }, data: { wialonUnidadId: unidad } }), /Unique constraint|ux_vehiculos_wialon/);
await db.vehiculo.update({ where: { id: vehiculo.id }, data: { wialonUnidadId: null } });
const tWialon = new Date(enCamino.getTime() + 10);
await db.rutaRastreo.create({ data: { rutaId: ruta2.id, latitud: 7.41, longitud: -73.52, registradoEn: tWialon, fuente: 'WIALON' } });
await rechaza('el mismo punto de Wialon no se guarda dos veces', () =>
  db.rutaRastreo.create({ data: { rutaId: ruta2.id, latitud: 7.41, longitud: -73.52, registradoEn: tWialon, fuente: 'WIALON' } }), /Unique constraint|ux_rastreo_wialon/);
await rechaza('…y cada punto dice de dónde vino (celular o Wialon)', () =>
  db.rutaRastreo.create({ data: { rutaId: ruta2.id, latitud: 7.41, longitud: -73.52, registradoEn: new Date(tWialon.getTime() + 1), fuente: 'OTRO' } }), /chk_rastreo_fuente/);
const evGps = await db.eventoGps.create({ data: { empresaId: E, rutaId: ruta2.id, vehiculoId: vehiculo.id, tipo: 'PARADA_NO_PROGRAMADA', inicio: new Date(Date.now() - 3600e3),
  latitud: 7.4, longitud: -73.5, conRespel: true } });
await rechaza('un evento del GPS (parada no programada o desvío) no se borra', () => db.eventoGps.delete({ where: { id: evGps.id } }), /no se borran/);
await rechaza('…ni se cambia cuándo pasó', () => db.eventoGps.update({ where: { id: evGps.id }, data: { inicio: new Date() } }), /no se cambia/);
await rechaza('…ni su tipo', () => db.eventoGps.update({ where: { id: evGps.id }, data: { tipo: 'DESVIO' } }), /no se cambia/);
await rechaza('marcarlo revisado pide la explicación', () => db.eventoGps.update({ where: { id: evGps.id }, data: { revisadoPor: admin.id, revisadoEn: new Date(), nota: ' ' } }), /chk_egps_revision/);
await db.eventoGps.update({ where: { id: evGps.id }, data: { fin: new Date(), revisadoPor: admin.id, revisadoEn: new Date(), nota: 'Tanqueo autorizado' } });
await rechaza('cerrado, su hora de fin no cambia', () => db.eventoGps.update({ where: { id: evGps.id }, data: { fin: new Date(Date.now() + 1000) } }), /ya se cerr/);
await rechaza('revisado, la revisión no cambia', () => db.eventoGps.update({ where: { id: evGps.id }, data: { nota: 'Otra explicación' } }), /ya fue revisado/);
await rechaza('solo hay dos tipos de evento: parada no programada y desvío', () =>
  db.eventoGps.create({ data: { empresaId: E, rutaId: ruta2.id, vehiculoId: vehiculo.id, tipo: 'OTRO', inicio: new Date(), latitud: 7.4, longitud: -73.5 } }), /chk_egps_tipo/);

await db.$disconnect();
console.log(`\n${ok} pruebas correctas, ${fallas} fallidas`);
process.exit(fallas ? 1 : 0);
