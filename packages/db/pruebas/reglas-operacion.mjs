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

await db.$disconnect();
console.log(`\n${ok} pruebas correctas, ${fallas} fallidas`);
process.exit(fallas ? 1 : 0);
