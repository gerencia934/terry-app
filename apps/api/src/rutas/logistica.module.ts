import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AprobacionSolicitud, ClaseSolicitud, EstadoSolicitud, Jornada, Operacion, Prisma, ResultadoChequeo } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { Auditoria } from '../common/servicios';
import { Archivos, firmaDesdeDataUrl } from '../common/archivos';
import { Notificaciones } from '../notificaciones/notificaciones.module';
import { ActorActual, Permiso, Zod, paginar, type Actor } from '../common/http';

const Rango = z.object({ desde: z.coerce.date().optional(), hasta: z.coerce.date().optional(), pagina: z.coerce.number().optional(), porPagina: z.coerce.number().optional() });
const FiltroSol = Rango.extend({
  clienteId: z.string().uuid().optional(), estado: z.nativeEnum(EstadoSolicitud).optional(), aprobacion: z.nativeEnum(AprobacionSolicitud).optional(),
  clase: z.nativeEnum(ClaseSolicitud).optional(), operacion: z.nativeEnum(Operacion).optional(), numero: z.coerce.number().int().optional(),
});
const TransporteSol = z.object({
  empresaTransportadora: z.string().trim().min(2).max(200), nit: z.string().trim().regex(/^\d{6,15}$/, 'NIT de la transportadora: solo números, sin dígito de verificación.').optional(),
  tipoVehiculo: z.string().max(40).optional(),
  placa: z.string().trim().toUpperCase().regex(/^([A-Z]{3}\d{3}|[A-Z]{3}\d{2}[A-Z]|[RS]\d{5})$/, 'Placa inválida (ABC123).').optional(),
  conductorNombre: z.string().max(150).optional(), conductorDocumento: z.string().max(20).optional(), conductorArlId: z.string().uuid().optional(), conductorEpsId: z.string().uuid().optional(),
  auxiliarNombre: z.string().max(150).optional(), auxiliarDocumento: z.string().max(20).optional(), auxiliarArlId: z.string().uuid().optional(), auxiliarEpsId: z.string().uuid().optional(),
  telefono: z.string().max(20).optional(),
});
const CrearSol = z.object({
  clase: z.nativeEnum(ClaseSolicitud).default('FORMAL'), operacion: z.nativeEnum(Operacion).default('CARGA'), clienteId: z.string().uuid(),
  // Descarga en planta: destino y vehículo / tripulación del tercero
  destinoId: z.string().uuid().optional(), transporte: TransporteSol.optional(), telefonoContacto: z.string().max(20).optional(),
  sucursalId: z.string().uuid().optional(), // sede por defecto de las líneas que no traen la suya
  fechaSolicitada: z.coerce.date(), franjaHoraria: z.string().max(20).optional(),
  aprobacion: z.enum(['PENDIENTE', 'APROBADA']).default('PENDIENTE'), // aprobar al crear exige el permiso solicitudes.aprobar
  ordenCompra: z.string().max(40).optional(), observaciones: z.string().max(2000).optional(), notificarCliente: z.boolean().default(false),
  items: z.array(z.object({
    declaracionId: z.string().uuid(), sucursalId: z.string().uuid().optional(), cantidadEstimada: z.number().positive(),
    cantidadEmbalajes: z.number().int().nonnegative().optional(), jornada: z.nativeEnum(Jornada).optional(), observaciones: z.string().max(300).optional(),
  })).min(1),
});
const EstadoSol = z.object({ estado: z.nativeEnum(EstadoSolicitud), causalCancelacionId: z.string().uuid().optional() });
const AprobacionSol = z.object({ aprobacion: z.enum(['APROBADA', 'NO_APROBADA']), observaciones: z.string().max(2000).optional() });
const FiltroRuta = Rango.extend({ vehiculoId: z.string().uuid().optional(), zonaId: z.string().uuid().optional(), conductorId: z.string().uuid().optional() });
const CrearRuta = z.object({
  codigo: z.string().trim().toUpperCase().min(3).max(20).optional(), // sin código: R-AAAAMMDD-NN
  fechaProgramada: z.coerce.date(), horaProgramada: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora HH:MM').optional(), zonaId: z.string().uuid().optional(),
  vehiculoId: z.string().uuid().optional(), conductorId: z.string().uuid().optional(), auxiliarId: z.string().uuid().optional(), // «sin recursos»: se asignan después
  interna: z.boolean().default(false), valorFlete: z.number().nonnegative().optional(), observaciones: z.string().max(2000).optional(),
  // Programación por solicitud completa (sus líneas pendientes) o por líneas sueltas
  solicitudes: z.array(z.string().uuid()).default([]), items: z.array(z.string().uuid()).default([]),
}).refine((b) => b.solicitudes.length + b.items.length > 0, { message: 'Elija al menos una solicitud o una línea.' });
const puedeAprobar = (a: Actor) => a.permisos.includes('*') || a.permisos.includes('solicitudes.aprobar');
const EditarRuta = z.object({
  fechaProgramada: z.coerce.date().optional(), horaProgramada: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora HH:MM').nullish(), zonaId: z.string().uuid().nullish(),
  vehiculoId: z.string().uuid().nullish(), conductorId: z.string().uuid().nullish(), auxiliarId: z.string().uuid().nullish(),
  interna: z.boolean().optional(), valorFlete: z.number().nonnegative().nullish(), observaciones: z.string().max(2000).nullish(),
  frecuenciaDias: z.number().int().min(1).max(366).nullish(), recurrenteActiva: z.boolean().optional(),
});
const LineasRuta = z.object({ items: z.array(z.string().uuid()).min(1).max(500) });
const Rastreo = z.object({ puntos: z.array(z.object({
  latitud: z.number().min(-5).max(14), longitud: z.number().min(-82).max(-66), precisionM: z.number().nonnegative().max(100000).optional(),
  velocidadKmh: z.number().nonnegative().max(300).optional(), registradoEn: z.coerce.date(),
})).min(1).max(1000) });
const Pendientes = z.object({ clienteId: z.string().uuid().optional(), zonaId: z.string().uuid().optional(), q: z.string().max(100).optional(), limite: z.coerce.number().int().min(1).max(200).default(50) });
const Descartar = z.object({ causalId: z.string().uuid() });
const FiltroPreop = z.object({ vehiculoId: z.string().uuid().optional(), fecha: z.coerce.date() });
/** Vista de oficina de las inspecciones: por rango de fechas, vehículo y resultado, por páginas. */
const FiltroInspecciones = z.object({
  desde: z.coerce.date(), hasta: z.coerce.date(), vehiculoId: z.string().uuid().optional(), resultado: z.enum(['aprobada', 'no-aprobada', 'pendiente']).optional(),
  pagina: z.coerce.number().optional(), porPagina: z.coerce.number().optional(),
});
const EstadoRuta = z.object({ estadoRecorridoId: z.string().uuid(), kmInicial: z.number().int().optional(), kmFinal: z.number().int().optional() });
const Preop = z.object({
  vehiculoId: z.string().uuid(), rutaId: z.string().uuid().optional(), fechaProgramada: z.coerce.date(), km: z.number().int().nonnegative(), auxiliarId: z.string().uuid().optional(), observaciones: z.string().max(500).optional(),
  respuestas: z.array(z.object({ elementoId: z.string().uuid(), resultado: z.nativeEnum(ResultadoChequeo) })).min(1),
  // El teléfono genera el id: si el envío se repite (sin señal), no se duplica la inspección
  id: z.string().uuid().optional(),
  firma: z.string().max(600_000).optional(), // firma del conductor (PNG del celular)
});
const Parada = z.object({
  estado: z.enum(['ATENDIDA', 'NO_ATENDIDA']), latitud: z.number().optional(), longitud: z.number().optional(), observaciones: z.string().max(500).optional(),
  cantidades: z.array(z.object({ solicitudItemId: z.string().uuid(), cantidadReal: z.number().nonnegative() })).optional(),
});
const rango = (f: { desde?: Date; hasta?: Date }) => (f.desde || f.hasta ? { gte: f.desde, lte: f.hasta } : undefined);

@Injectable()
class LogisticaService {
  constructor(private readonly db: PrismaService, private readonly audit: Auditoria, private readonly archivos: Archivos, private readonly notificaciones: Notificaciones) {}

  async solicitudes(a: Actor, f: z.infer<typeof FiltroSol>) {
    const { take, skip, pagina, porPagina } = paginar(f);
    const where: Prisma.SolicitudWhereInput = { empresaId: a.empresaId, clienteId: f.clienteId, estado: f.estado, aprobacion: f.aprobacion, clase: f.clase, operacion: f.operacion, numero: f.numero, fechaSolicitada: rango(f) };
    const [total, filas] = await this.db.$transaction([
      this.db.solicitud.count({ where }),
      this.db.solicitud.findMany({ where, take, skip, orderBy: { numero: 'desc' }, include: {
        cliente: { select: { razonSocial: true } },
        creadoPor: { select: { nombre: true, clienteId: true } }, // con clienteId: la pidió el cliente desde su portal
        items: { include: {
          sucursal: { select: { codigo: true, nombre: true, municipioDane: true } },
          declaracion: { select: { numero: true, nombre: true, codigoInterno: true, disposiciones: { where: { principal: true }, select: { disposicion: { select: { nombre: true } } } } } },
        } },
      } }),
    ]);
    return { total, pagina, porPagina, filas };
  }

  async crearSolicitud(a: Actor, b: z.infer<typeof CrearSol>) {
    if (b.aprobacion === 'APROBADA' && !puedeAprobar(a)) throw new BadRequestException({ mensaje: 'Su rol no aprueba solicitudes: créela pendiente.' });
    const lineas = b.items.map((i) => ({ ...i, sucursalId: i.sucursalId ?? b.sucursalId }));
    if (lineas.some((i) => !i.sucursalId)) throw new BadRequestException({ mensaje: 'Indique la sede de cada línea.' });
    const decls = await this.db.declaracion.findMany({ where: { id: { in: lineas.map((i) => i.declaracionId) }, empresaId: a.empresaId, clienteId: b.clienteId }, include: { tarifas: { where: { vigenteDesde: { lte: b.fechaSolicitada }, OR: [{ vigenteHasta: null }, { vigenteHasta: { gte: b.fechaSolicitada } }] }, take: 1, orderBy: { vigenteDesde: "desc" } } } }); // tarifa vigente en la fecha del servicio
    const precio = (id: string) => decls.find((d) => d.id === id)?.tarifas[0]?.precioUnitario;
    const destino = b.destinoId ? await this.db.proveedor.findFirst({ where: { id: b.destinoId, empresaId: a.empresaId, esDestino: true } }) : null;
    if (b.destinoId && !destino) throw new BadRequestException({ mensaje: 'Destino de descarga no encontrado.' });
    if (destino && !destino.activo) throw new BadRequestException({ mensaje: `Ya no se trabaja con ${destino.razonSocial}: elija otro destino de descarga.` });
    const creada = await this.db.$transaction(async (tx) => {
      const transporteId = b.transporte ? (await tx.transporteTercero.create({ data: { ...b.transporte, empresaId: a.empresaId } })).id : undefined;
      const s = await tx.solicitud.create({ data: {
        empresaId: a.empresaId, clase: b.clase, operacion: b.operacion, clienteId: b.clienteId, fechaSolicitada: b.fechaSolicitada, franjaHoraria: b.franjaHoraria, creadoPorId: a.id,
        ordenCompra: b.ordenCompra, observaciones: b.observaciones, notificarCliente: b.notificarCliente,
        destinoId: b.destinoId, transporteId, telefonoContacto: b.telefonoContacto,
        aprobacion: b.aprobacion, aprobadaPorId: b.aprobacion === 'APROBADA' ? a.id : null, aprobadaEn: b.aprobacion === 'APROBADA' ? new Date() : null,
        totalEstimado: lineas.reduce((acc, i) => acc + i.cantidadEstimada * Number(precio(i.declaracionId) ?? 0), 0),
      } });
      // La base rechaza líneas con declaraciones no autorizadas, inactivas, de otro cliente o no asignadas a la sede.
      for (const i of lineas) await tx.solicitudItem.create({ data: {
        solicitudId: s.id, declaracionId: i.declaracionId, sucursalId: i.sucursalId!, cantidadEstimada: i.cantidadEstimada, cantidadEmbalajes: i.cantidadEmbalajes,
        jornada: i.jornada, observaciones: i.observaciones, precioUnitario: precio(i.declaracionId),
      } });
      await this.audit.registrar(a, 'solicitud', s.id, 'CREAR', undefined, { numero: s.numero, aprobacion: b.aprobacion }, tx);
      return s;
    });
    void this.avisarSolicitud(a, creada);
    return creada;
  }

  /** Aviso push a quienes programan y aprueban: hay una solicitud de recolección nueva. */
  private async avisarSolicitud(a: Actor, s: { numero: number; clase: string; clienteId: string; fechaSolicitada: Date; aprobacion: string }) {
    if (s.clase !== 'FORMAL') return;
    const cliente = await this.db.cliente.findUnique({ where: { id: s.clienteId }, select: { razonSocial: true } }).catch(() => null);
    await this.notificaciones.aPermisos(a.empresaId, ['solicitudes.crear', 'solicitudes.aprobar', 'rutas.programar'], {
      titulo: 'Nueva solicitud de recolección', cuerpo: `N.° ${s.numero} · ${cliente?.razonSocial ?? 'Cliente'} · para el ${s.fechaSolicitada.toISOString().slice(0, 10)}`,
      ruta: s.aprobacion === 'PENDIENTE' ? 'por-confirmar' : 'solicitudes', etiqueta: `solicitud-${s.numero}`,
    }, a.id);
  }

  async aprobarSolicitud(a: Actor, id: string, b: z.infer<typeof AprobacionSol>) {
    const s = await this.db.solicitud.findFirst({ where: { id, empresaId: a.empresaId } });
    if (!s) throw new NotFoundException({ mensaje: 'Solicitud no encontrada.' });
    if (s.estado !== 'PENDIENTE' || s.aprobacion === b.aprobacion) throw new BadRequestException({ mensaje: 'La solicitud ya fue programada, gestionada o tiene esa aprobación.' });
    const aprobada = b.aprobacion === 'APROBADA';
    const r = await this.db.solicitud.update({ where: { id }, data: {
      aprobacion: b.aprobacion, aprobadaPorId: aprobada ? a.id : null, aprobadaEn: aprobada ? new Date() : null,
      // Al aprobar una recurrente (PRE) queda formal y lista para programar
      clase: aprobada && s.clase === 'PRE' ? 'FORMAL' : s.clase, observaciones: b.observaciones ?? s.observaciones,
    } });
    await this.audit.registrar(a, 'solicitud', id, `APROBACION_${b.aprobacion}`, { aprobacion: s.aprobacion }, { aprobacion: b.aprobacion });
    return r;
  }

  async estadoSolicitud(a: Actor, id: string, b: z.infer<typeof EstadoSol>) {
    const s = await this.db.solicitud.findFirst({ where: { id, empresaId: a.empresaId } });
    if (!s) throw new NotFoundException({ mensaje: 'Solicitud no encontrada.' });
    if (b.estado === 'CANCELADA' && !b.causalCancelacionId) throw new BadRequestException({ mensaje: 'Indique la causal de cancelación.' });
    const r = await this.db.solicitud.update({ where: { id }, data: { estado: b.estado, causalCancelacionId: b.causalCancelacionId } });
    await this.audit.registrar(a, 'solicitud', id, `ESTADO_${b.estado}`, { estado: s.estado }, { estado: b.estado });
    return r;
  }

  async rutas(a: Actor, f: z.infer<typeof FiltroRuta>) {
    return this.db.ruta.findMany({
      where: { empresaId: a.empresaId, vehiculoId: f.vehiculoId, zonaId: f.zonaId, conductorId: f.conductorId, fechaProgramada: rango(f) }, orderBy: [{ fechaProgramada: 'asc' }, { codigo: 'asc' }], take: 1000,
      include: { vehiculo: { select: { placa: true, marca: true, color: true } }, conductor: { select: { nombre: true } }, auxiliar: { select: { nombre: true } }, zona: { select: { nombre: true } }, estadoRecorrido: true,
        paradas: { orderBy: { orden: 'asc' }, include: {
          sucursal: { select: { codigo: true, nombre: true, direccion: true, latitud: true, longitud: true, cliente: { select: { razonSocial: true } } } },
          items: { where: { liberado: false }, include: { solicitudItem: { select: { id: true, estado: true, cantidadEstimada: true, solicitud: { select: { numero: true } }, declaracion: { select: { nombre: true, codigoInterno: true } } } } } },
        } } },
    });
  }

  /** Programa líneas de solicitud en una ruta: una parada por sede. La base valida aprobación, estado y sede de cada línea. */
  async crearRuta(a: Actor, b: z.infer<typeof CrearRuta>) {
    if (b.codigo && (await this.db.ruta.findFirst({ where: { empresaId: a.empresaId, codigo: b.codigo } }))) throw new BadRequestException({ mensaje: `Ya existe una ruta con el código ${b.codigo}: use otro o déjelo vacío para numerarla sola.` });
    const lineas = await this.db.solicitudItem.findMany({
      where: { OR: [{ id: { in: b.items } }, { solicitudId: { in: b.solicitudes }, estado: 'PENDIENTE' }], solicitud: { empresaId: a.empresaId } },
      orderBy: [{ solicitud: { numero: 'asc' } }, { id: 'asc' }],
    });
    if (!lineas.length) throw new BadRequestException({ mensaje: 'No hay líneas pendientes por programar en lo elegido.' });
    if (b.items.some((id) => !lineas.find((l) => l.id === id))) throw new BadRequestException({ mensaje: 'Alguna línea no existe o no es de su empresa.' });
    await this.validarRecursos(a, { vehiculo: b.vehiculoId, conductor: b.conductorId, auxiliar: b.auxiliarId, zona: b.zonaId });
    const codigo = b.codigo ?? (await this.codigoLibre(a.empresaId, b.fechaProgramada));
    const inicial = await this.db.estadoRecorrido.findFirst({ where: { empresaId: a.empresaId, activo: true }, orderBy: { orden: 'asc' } });
    const sedes = [...new Set(lineas.map((l) => l.sucursalId))];
    return this.db.$transaction(async (tx) => {
      const r = await tx.ruta.create({ data: {
        empresaId: a.empresaId, codigo, fechaProgramada: b.fechaProgramada, horaProgramada: b.horaProgramada ? new Date(`1970-01-01T${b.horaProgramada}:00Z`) : undefined,
        zonaId: b.zonaId, vehiculoId: b.vehiculoId, conductorId: b.conductorId, auxiliarId: b.auxiliarId, interna: b.interna, valorFlete: b.valorFlete, observaciones: b.observaciones, estadoRecorridoId: inicial?.id,
      } });
      for (const [i, sucursalId] of sedes.entries()) {
        const p = await tx.rutaParada.create({ data: { rutaId: r.id, sucursalId, orden: i + 1 } });
        for (const l of lineas.filter((x) => x.sucursalId === sucursalId)) await tx.rutaItem.create({ data: { rutaId: r.id, paradaId: p.id, solicitudItemId: l.id } });
      }
      await this.audit.registrar(a, 'ruta', r.id, 'CREAR', undefined, { codigo: r.codigo, paradas: sedes.length, lineas: lineas.length }, tx);
      return r;
    });
  }

  /** Vehículo, conductor, auxiliar y zona deben ser de la empresa y estar activos. */
  private async validarRecursos(a: Actor, ids: { vehiculo?: string | null; conductor?: string | null; auxiliar?: string | null; zona?: string | null }) {
    if (ids.vehiculo && !(await this.db.vehiculo.findFirst({ where: { id: ids.vehiculo, empresaId: a.empresaId, activo: true } }))) throw new BadRequestException({ mensaje: 'Vehículo no encontrado o inactivo.' });
    for (const u of [ids.conductor, ids.auxiliar]) if (u && !(await this.db.usuario.findFirst({ where: { id: u, empresaId: a.empresaId, activo: true } }))) throw new BadRequestException({ mensaje: 'Conductor o auxiliar no encontrado.' });
    if (ids.zona && !(await this.db.zona.findFirst({ where: { id: ids.zona, empresaId: a.empresaId } }))) throw new BadRequestException({ mensaje: 'Zona no encontrada.' });
  }

  /** Código automático de la ruta: R-AAAAMMDD-NN (consecutivo del día). */
  private async codigoLibre(empresaId: string, fecha: Date) {
    const base = `R-${fecha.toISOString().slice(0, 10).replace(/-/g, '')}-`;
    const usados = new Set((await this.db.ruta.findMany({ where: { empresaId, codigo: { startsWith: base } }, select: { codigo: true } })).map((r) => r.codigo));
    for (let n = 1; ; n++) { const c = `${base}${String(n).padStart(2, '0')}`; if (!usados.has(c)) return c; }
  }

  private async rutaPropia(a: Actor, id: string) {
    const r = await this.db.ruta.findFirst({ where: { id, empresaId: a.empresaId }, include: { estadoRecorrido: true } });
    if (!r) throw new NotFoundException({ mensaje: 'Ruta no encontrada.' });
    return r;
  }

  /** Asignar recursos (vehículo, conductor, auxiliar), flete, fecha u hora. */
  async editarRuta(a: Actor, id: string, b: z.infer<typeof EditarRuta>) {
    const r = await this.rutaPropia(a, id);
    if (r.estadoRecorrido?.esFinal) throw new BadRequestException({ mensaje: `La ruta ${r.codigo} ya terminó o fue cancelada.` });
    await this.validarRecursos(a, { vehiculo: b.vehiculoId, conductor: b.conductorId, auxiliar: b.auxiliarId, zona: b.zonaId });
    const { horaProgramada, ...resto } = b;
    const act = await this.db.ruta.update({ where: { id }, data: { ...resto, horaProgramada: horaProgramada === undefined ? undefined : horaProgramada === null ? null : new Date(`1970-01-01T${horaProgramada}:00Z`) } });
    await this.audit.registrar(a, 'ruta', id, 'EDITAR', undefined, b);
    return act;
  }

  /** Agrega líneas a una ruta existente: usa la parada de la sede o crea una al final. */
  async agregarLineas(a: Actor, id: string, b: z.infer<typeof LineasRuta>) {
    const r = await this.rutaPropia(a, id);
    const lineas = await this.db.solicitudItem.findMany({ where: { id: { in: b.items }, solicitud: { empresaId: a.empresaId } } });
    if (lineas.length !== new Set(b.items).size) throw new BadRequestException({ mensaje: 'Alguna línea no existe o no es de su empresa.' });
    await this.db.$transaction(async (tx) => {
      const paradas = await tx.rutaParada.findMany({ where: { rutaId: r.id }, orderBy: { orden: 'asc' } });
      let orden = paradas.at(-1)?.orden ?? 0;
      for (const l of lineas) {
        let p = paradas.find((x) => x.sucursalId === l.sucursalId);
        if (!p) { p = await tx.rutaParada.create({ data: { rutaId: r.id, sucursalId: l.sucursalId, orden: ++orden } }); paradas.push(p); }
        await tx.rutaItem.create({ data: { rutaId: r.id, paradaId: p.id, solicitudItemId: l.id } }); // la base valida aprobación, estado y sede
      }
      await this.audit.registrar(a, 'ruta', id, 'AGREGAR_LINEAS', undefined, { lineas: lineas.length }, tx);
    });
    return { agregadas: lineas.length };
  }

  /** Quita una línea de la ruta (vuelve a pendiente). Si ya está en un manifiesto, primero se anula el manifiesto. */
  async quitarLinea(a: Actor, id: string, rutaItemId: string) {
    await this.rutaPropia(a, id);
    const ri = await this.db.rutaItem.findFirst({ where: { id: rutaItemId, rutaId: id, liberado: false }, include: { solicitudItem: { include: { manifiestoItems: { where: { manifiesto: { estado: { not: 'ANULADO' } } } } } } } });
    if (!ri) throw new NotFoundException({ mensaje: 'La línea no está programada en esta ruta.' });
    if (ri.solicitudItem.manifiestoItems.length) throw new BadRequestException({ mensaje: 'La línea ya está en un manifiesto: anúlelo o quítela del manifiesto primero.' });
    await this.db.rutaItem.update({ where: { id: rutaItemId }, data: { liberado: true } });
    await this.audit.registrar(a, 'ruta', id, 'QUITAR_LINEA', { rutaItemId });
    return { ok: true };
  }

  /** Puntos GPS en lote (la app los acumula sin señal). La base acepta solo los tomados en etapas con rastreo. */
  async rastreo(a: Actor, id: string, b: z.infer<typeof Rastreo>) {
    const r = await this.rutaPropia(a, id);
    if (!a.permisos.includes('*') && r.conductorId !== a.id && r.auxiliarId !== a.id) throw new BadRequestException({ mensaje: 'Solo el conductor o el auxiliar de la ruta envían su ubicación.' });
    let guardados = 0; const rechazados: { registradoEn: Date; motivo: string }[] = [];
    for (const p of b.puntos.sort((x, y) => x.registradoEn.getTime() - y.registradoEn.getTime())) {
      try { await this.db.rutaRastreo.create({ data: { ...p, rutaId: id, vehiculoId: r.vehiculoId } }); guardados++; }
      catch (e) { rechazados.push({ registradoEn: p.registradoEn, motivo: String((e as Error).message).match(/(La ruta[^"\n]+|La hora[^"\n]+)/)?.[1] ?? 'Rechazado' }); }
    }
    return { guardados, rechazados };
  }

  async verRastreo(a: Actor, id: string) {
    await this.rutaPropia(a, id);
    return this.db.rutaRastreo.findMany({ where: { rutaId: id }, orderBy: { registradoEn: 'asc' }, take: 20000,
      select: { latitud: true, longitud: true, precisionM: true, velocidadKmh: true, registradoEn: true, fuente: true } });
  }

  /** Líneas pendientes por programar: solicitudes aprobadas de carga, con su contador de pendientes. */
  async pendientes(a: Actor, f: z.infer<typeof Pendientes>) {
    const sols = await this.db.solicitud.findMany({
      where: { empresaId: a.empresaId, clase: 'FORMAL', operacion: 'CARGA', aprobacion: 'APROBADA', estado: { not: 'CANCELADA' }, clienteId: f.clienteId,
        cliente: f.q ? { razonSocial: { contains: f.q, mode: 'insensitive' } } : undefined,
        items: { some: { estado: 'PENDIENTE', sucursal: f.zonaId ? { zonaId: f.zonaId } : undefined } } },
      orderBy: [{ fechaSolicitada: 'asc' }, { numero: 'asc' }], take: f.limite,
      include: { cliente: { select: { id: true, razonSocial: true } }, items: { where: { estado: 'PENDIENTE' }, include: {
        sucursal: { select: { id: true, codigo: true, nombre: true, direccion: true, municipio: { select: { nombre: true } }, zona: { select: { nombre: true, color: true } } } },
        declaracion: { select: { nombre: true, codigoInterno: true, disposiciones: { where: { principal: true }, select: { disposicion: { select: { nombre: true } } } } } },
        especificaciones: { select: { especificacion: { select: { abreviatura: true, nombre: true } } } },
      } } },
    });
    return sols.map((s) => ({ ...s, pendientes: s.items.length }));
  }

  async descartarLinea(a: Actor, itemId: string, b: z.infer<typeof Descartar>) {
    const i = await this.db.solicitudItem.findFirst({ where: { id: itemId, solicitud: { empresaId: a.empresaId } } });
    if (!i) throw new NotFoundException({ mensaje: 'Línea no encontrada.' });
    if (i.estado !== 'PENDIENTE') throw new BadRequestException({ mensaje: 'Solo se descartan líneas pendientes (quítela de la ruta primero).' });
    if (!(await this.db.catalogoItem.findFirst({ where: { id: b.causalId, empresaId: a.empresaId, tipo: 'CAUSAL' } }))) throw new BadRequestException({ mensaje: 'Causal no encontrada.' });
    const r = await this.db.solicitudItem.update({ where: { id: itemId }, data: { estado: 'DESCARTADO', causalDescarteId: b.causalId } });
    await this.audit.registrar(a, 'solicitud_item', itemId, 'DESCARTAR', { estado: i.estado }, { causal: b.causalId });
    return r;
  }

  /** El trigger trg_bloqueo_preoperacional impide avanzar la ruta sin preoperacional aprobado. */
  async estadoRuta(a: Actor, id: string, b: z.infer<typeof EstadoRuta>) {
    const r = await this.db.ruta.findFirst({ where: { id, empresaId: a.empresaId } });
    if (!r) throw new NotFoundException({ mensaje: 'Ruta no encontrada.' });
    const e = await this.db.estadoRecorrido.findFirst({ where: { id: b.estadoRecorridoId, empresaId: a.empresaId } });
    if (!e) throw new BadRequestException({ mensaje: 'Estado del recorrido no válido.' });
    const act = await this.db.ruta.update({ where: { id }, data: { estadoRecorridoId: e.id, kmInicial: b.kmInicial, kmFinal: b.kmFinal, horaSalida: e.orden === 2 && !r.horaSalida ? new Date() : undefined, horaLlegadaPlanta: e.esFinal ? new Date() : undefined } });
    await this.audit.registrar(a, 'ruta', id, 'ESTADO', { estado: r.estadoRecorridoId }, { estado: e.nombre });
    return act;
  }

  /** Preoperacional: si un elemento crítico sale NO_OK, queda «no aprobado» y la ruta no puede salir. */
  /** Inspecciones del día de un vehículo (para la app del conductor). */
  inspecciones(a: Actor, f: z.infer<typeof FiltroPreop>) {
    return this.db.preoperacional.findMany({ where: { vehiculo: { empresaId: a.empresaId }, vehiculoId: f.vehiculoId, fechaProgramada: f.fecha }, orderBy: { fechaReal: 'desc' },
      select: { id: true, numero: true, vehiculoId: true, rutaId: true, fechaProgramada: true, fechaReal: true, aprobado: true, km: true, observaciones: true } });
  }

  async listarInspecciones(a: Actor, f: z.infer<typeof FiltroInspecciones>) {
    const { take, skip, pagina, porPagina } = paginar(f);
    const where: Prisma.PreoperacionalWhereInput = {
      vehiculo: { empresaId: a.empresaId }, vehiculoId: f.vehiculoId, fechaProgramada: { gte: f.desde, lte: f.hasta },
      aprobado: f.resultado === 'aprobada' ? true : f.resultado === 'no-aprobada' ? false : f.resultado === 'pendiente' ? null : undefined,
    };
    const [total, filas, resumen] = await this.db.$transaction([
      this.db.preoperacional.count({ where }),
      this.db.preoperacional.findMany({ where, take, skip, orderBy: [{ fechaProgramada: 'desc' }, { fechaReal: 'desc' }], include: {
        vehiculo: { select: { placa: true, color: true, tipo: true } }, conductor: { select: { nombre: true } }, auxiliar: { select: { nombre: true } },
        ruta: { select: { codigo: true } }, _count: { select: { respuestas: { where: { resultado: 'NO_OK' } } } },
      } }),
      this.db.preoperacional.groupBy({ by: ['aprobado'], where, _count: true, orderBy: { aprobado: 'asc' } }),
    ]);
    const cuenta = (v: boolean | null) => resumen.find((x) => x.aprobado === v)?._count ?? 0;
    return { total, pagina, porPagina, filas, resumen: { aprobadas: cuenta(true), noAprobadas: cuenta(false), pendientes: cuenta(null) } };
  }

  async inspeccion(a: Actor, id: string) {
    const p = await this.db.preoperacional.findFirst({ where: { id, vehiculo: { empresaId: a.empresaId } }, include: {
      vehiculo: { select: { placa: true, color: true, tipo: true, marca: true } }, conductor: { select: { nombre: true } }, auxiliar: { select: { nombre: true } },
      ruta: { select: { codigo: true, fechaProgramada: true } },
      respuestas: { include: { elemento: { select: { grupo: true, nombre: true, critico: true } } } },
    } });
    if (!p) throw new NotFoundException({ mensaje: 'Inspección no encontrada.' });
    p.respuestas.sort((x, y) => x.elemento.grupo.localeCompare(y.elemento.grupo) || x.elemento.nombre.localeCompare(y.elemento.nombre));
    return p;
  }

  async preoperacional(a: Actor, b: z.infer<typeof Preop>) {
    // Reenvío desde la cola sin señal: si ya llegó, se responde lo mismo
    if (b.id) {
      const ya = await this.db.preoperacional.findFirst({ where: { id: b.id, vehiculo: { empresaId: a.empresaId } }, include: { respuestas: { include: { elemento: true } } } });
      if (ya) {
        const { respuestas, ...p } = ya;
        return { ...p, fallasCriticas: respuestas.filter((r) => r.resultado === 'NO_OK' && r.elemento.critico).map((r) => r.elemento.nombre) };
      }
    }
    const els = await this.db.elementoChequeo.findMany({ where: { empresaId: a.empresaId, id: { in: b.respuestas.map((r) => r.elementoId) } } });
    if (els.length !== b.respuestas.length) throw new BadRequestException({ mensaje: 'Hay elementos de chequeo que no existen.' });
    const fallaCritica = b.respuestas.filter((r) => r.resultado === 'NO_OK' && els.find((e) => e.id === r.elementoId)!.critico);
    // La firma va al almacenamiento (Cloudflare R2 en producción); en la base queda su clave
    const firma = b.firma ? await this.archivos.guardar(a.empresaId, 'firmas', firmaDesdeDataUrl(b.firma), ['png']) : null;
    const p = await this.db.preoperacional.create({ data: {
      ...(b.id ? { id: b.id } : {}), firmaUrl: firma?.clave ?? null, vehiculoId: b.vehiculoId, rutaId: b.rutaId, conductorId: a.id, auxiliarId: b.auxiliarId, fechaProgramada: b.fechaProgramada, fechaReal: new Date(), km: b.km,
      aprobado: fallaCritica.length === 0, observaciones: b.observaciones, respuestas: { create: b.respuestas.map((r) => ({ elementoId: r.elementoId, resultado: r.resultado })) },
    } });
    await this.audit.registrar(a, 'preoperacional', p.id, p.aprobado ? 'APROBADO' : 'NO_APROBADO', undefined, { fallas: fallaCritica.map((f) => els.find((e) => e.id === f.elementoId)!.nombre) });
    // Aviso push a programación (flota): el vehículo no debe salir sin revisar las fallas críticas
    if (!p.aprobado) void this.db.vehiculo.findUnique({ where: { id: b.vehiculoId }, select: { placa: true } }).then((v) => this.notificaciones.aPermisos(a.empresaId, ['rutas.programar'], {
      titulo: `Inspección no aprobada · ${v?.placa ?? 'vehículo'}`, cuerpo: `Fallas críticas: ${fallaCritica.map((f) => els.find((e) => e.id === f.elementoId)!.nombre).join(', ')}`,
      ruta: 'inspecciones', etiqueta: `preoperacional-${p.id}`,
    }, a.id)).catch(() => undefined);
    return { ...p, fallasCriticas: fallaCritica.map((f) => els.find((e) => e.id === f.elementoId)!.nombre) };
  }

  /** Foto de un elemento de la inspección (sobre todo de una falla). Se guarda en el almacenamiento y reemplaza la anterior. */
  async fotoPreop(a: Actor, id: string, elementoId: string | undefined, archivo?: Express.Multer.File) {
    if (!archivo) throw new BadRequestException({ mensaje: 'Adjunte la foto.' });
    if (!elementoId || !/^[0-9a-f-]{36}$/i.test(elementoId)) throw new BadRequestException({ mensaje: 'Indique el elemento de la foto.' });
    const p = await this.db.preoperacional.findFirst({ where: { id, vehiculo: { empresaId: a.empresaId } } });
    if (!p) throw new NotFoundException({ mensaje: 'Inspección no encontrada.' });
    if (p.conductorId !== a.id && !a.permisos.includes('*') && !a.permisos.includes('rutas.programar'))
      throw new ForbiddenException({ mensaje: 'Solo el conductor que hizo la inspección agrega sus fotos.' });
    const clave = { preoperacionalId_elementoId: { preoperacionalId: id, elementoId } };
    const r = await this.db.preopRespuesta.findUnique({ where: clave });
    if (!r) throw new NotFoundException({ mensaje: 'Ese elemento no está en la inspección.' });
    const g = await this.archivos.guardar(a.empresaId, 'preoperacionales', archivo.buffer, ['jpg', 'png', 'webp']);
    await this.db.preopRespuesta.update({ where: clave, data: { fotoUrl: g.clave } });
    await this.audit.registrar(a, 'preoperacional', id, 'FOTO', { elementoId, foto: r.fotoUrl }, { elementoId, foto: g.clave });
    return { elementoId, fotoUrl: g.clave };
  }

  async parada(a: Actor, id: string, b: z.infer<typeof Parada>) {
    const p = await this.db.rutaParada.findFirst({ where: { id, ruta: { empresaId: a.empresaId } } });
    if (!p) throw new NotFoundException({ mensaje: 'Parada no encontrada.' });
    return this.db.$transaction(async (tx) => {
      const r = await tx.rutaParada.update({ where: { id }, data: { estado: b.estado, horaLlegada: new Date(), latCheckin: b.latitud, lngCheckin: b.longitud, observaciones: b.observaciones } });
      // Cantidad pesada en campo de las líneas de esta parada. La línea queda «realizada» al grabar el manifiesto.
      for (const c of b.cantidades ?? []) await tx.solicitudItem.updateMany({ where: { id: c.solicitudItemId, rutaItems: { some: { paradaId: id, liberado: false } } }, data: { cantidadReal: c.cantidadReal } });
      await this.audit.registrar(a, 'parada', id, b.estado, undefined, b, tx);
      return r;
    });
  }
}

@Controller()
class LogisticaController {
  constructor(private readonly s: LogisticaService) {}
  @Get('solicitudes') solicitudes(@ActorActual() a: Actor, @Query(new Zod(FiltroSol)) f: z.infer<typeof FiltroSol>) { return this.s.solicitudes(a, f); }
  @Permiso('solicitudes.crear') @Post('solicitudes') crearSol(@ActorActual() a: Actor, @Body(new Zod(CrearSol)) b: z.infer<typeof CrearSol>) { return this.s.crearSolicitud(a, b); }
  @Permiso('solicitudes.aprobar') @Patch('solicitudes/:id/aprobacion') aprobarSol(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(AprobacionSol)) b: z.infer<typeof AprobacionSol>) { return this.s.aprobarSolicitud(a, id, b); }
  @Permiso('solicitudes.crear') @Patch('solicitudes/:id/estado') estadoSol(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(EstadoSol)) b: z.infer<typeof EstadoSol>) { return this.s.estadoSolicitud(a, id, b); }
  @Get('rutas') rutas(@ActorActual() a: Actor, @Query(new Zod(FiltroRuta)) f: z.infer<typeof FiltroRuta>) { return this.s.rutas(a, f); }
  @Get('programacion/pendientes') pendientes(@ActorActual() a: Actor, @Query(new Zod(Pendientes)) f: z.infer<typeof Pendientes>) { return this.s.pendientes(a, f); }
  @Permiso('solicitudes.crear') @Patch('solicitudes/items/:id/descartar') descartar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Descartar)) b: z.infer<typeof Descartar>) { return this.s.descartarLinea(a, id, b); }
  @Permiso('rutas.programar') @Patch('rutas/:id') editarRuta(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(EditarRuta)) b: z.infer<typeof EditarRuta>) { return this.s.editarRuta(a, id, b); }
  @Permiso('rutas.programar') @Post('rutas/:id/items') agregarLineas(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(LineasRuta)) b: z.infer<typeof LineasRuta>) { return this.s.agregarLineas(a, id, b); }
  @Permiso('rutas.programar') @Delete('rutas/:id/items/:rutaItemId') quitarLinea(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('rutaItemId', ParseUUIDPipe) ri: string) { return this.s.quitarLinea(a, id, ri); }
  @Permiso('rutas.operar') @Post('rutas/:id/rastreo') rastreo(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Rastreo)) b: z.infer<typeof Rastreo>) { return this.s.rastreo(a, id, b); }
  @Get('rutas/:id/rastreo') verRastreo(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.verRastreo(a, id); }
  @Permiso('rutas.programar') @Post('rutas') crearRuta(@ActorActual() a: Actor, @Body(new Zod(CrearRuta)) b: z.infer<typeof CrearRuta>) { return this.s.crearRuta(a, b); }
  @Permiso('rutas.operar') @Patch('rutas/:id/estado') estadoRuta(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(EstadoRuta)) b: z.infer<typeof EstadoRuta>) { return this.s.estadoRuta(a, id, b); }
  @Get('preoperacionales') inspecciones(@ActorActual() a: Actor, @Query(new Zod(FiltroPreop)) f: z.infer<typeof FiltroPreop>) { return this.s.inspecciones(a, f); }
  @Get('inspecciones') listarInspecciones(@ActorActual() a: Actor, @Query(new Zod(FiltroInspecciones)) f: z.infer<typeof FiltroInspecciones>) { return this.s.listarInspecciones(a, f); }
  @Get('inspecciones/:id') inspeccion(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.inspeccion(a, id); }
  @Permiso('rutas.operar') @Post('preoperacionales/:id/fotos') @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: 12 * 1024 * 1024, files: 1 } }))
  fotoPreop(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body('elementoId') elementoId?: string, @UploadedFile() f?: Express.Multer.File) { return this.s.fotoPreop(a, id, elementoId, f); }
  @Permiso('rutas.operar') @Post('preoperacionales') preop(@ActorActual() a: Actor, @Body(new Zod(Preop)) b: z.infer<typeof Preop>) { return this.s.preoperacional(a, b); }
  @Permiso('rutas.operar') @Patch('paradas/:id') parada(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Parada)) b: z.infer<typeof Parada>) { return this.s.parada(a, id, b); }
}

@Module({ controllers: [LogisticaController], providers: [LogisticaService] })
export class LogisticaModule {}
