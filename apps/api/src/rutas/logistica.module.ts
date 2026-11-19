import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ClaseSolicitud, EstadoSolicitud, Operacion, Prisma, ResultadoChequeo } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { Auditoria } from '../common/servicios';
import { ActorActual, Permiso, Zod, paginar, type Actor } from '../common/http';

const Rango = z.object({ desde: z.coerce.date().optional(), hasta: z.coerce.date().optional(), pagina: z.coerce.number().optional(), porPagina: z.coerce.number().optional() });
const FiltroSol = Rango.extend({ clienteId: z.string().uuid().optional(), estado: z.nativeEnum(EstadoSolicitud).optional(), clase: z.nativeEnum(ClaseSolicitud).optional(), numero: z.coerce.number().int().optional() });
const CrearSol = z.object({
  clase: z.nativeEnum(ClaseSolicitud).default('FORMAL'), operacion: z.nativeEnum(Operacion).default('CARGA'), clienteId: z.string().uuid(), sucursalId: z.string().uuid(),
  fechaSolicitada: z.coerce.date(), franjaHoraria: z.string().max(20).optional(),
  items: z.array(z.object({ declaracionId: z.string().uuid(), cantidadEstimada: z.number().positive(), cantidadEmbalajes: z.number().int().nonnegative().optional() })).min(1),
});
const EstadoSol = z.object({ estado: z.nativeEnum(EstadoSolicitud), causalCancelacionId: z.string().uuid().optional() });
const FiltroRuta = Rango.extend({ vehiculoId: z.string().uuid().optional(), zonaId: z.string().uuid().optional(), conductorId: z.string().uuid().optional() });
const CrearRuta = z.object({
  codigo: z.string().min(3).max(20), fechaProgramada: z.coerce.date(), zonaId: z.string().uuid().optional(), vehiculoId: z.string().uuid(),
  conductorId: z.string().uuid(), auxiliarId: z.string().uuid().optional(), solicitudes: z.array(z.string().uuid()).min(1),
});
const EstadoRuta = z.object({ estadoRecorridoId: z.string().uuid(), kmInicial: z.number().int().optional(), kmFinal: z.number().int().optional() });
const Preop = z.object({
  vehiculoId: z.string().uuid(), rutaId: z.string().uuid().optional(), fechaProgramada: z.coerce.date(), km: z.number().int().nonnegative(), auxiliarId: z.string().uuid().optional(), observaciones: z.string().max(500).optional(),
  respuestas: z.array(z.object({ elementoId: z.string().uuid(), resultado: z.nativeEnum(ResultadoChequeo) })).min(1),
});
const Parada = z.object({
  estado: z.enum(['ATENDIDA', 'NO_ATENDIDA']), latitud: z.number().optional(), longitud: z.number().optional(), observaciones: z.string().max(500).optional(),
  cantidades: z.array(z.object({ solicitudItemId: z.string().uuid(), cantidadReal: z.number().nonnegative() })).optional(),
});
const rango = (f: { desde?: Date; hasta?: Date }) => (f.desde || f.hasta ? { gte: f.desde, lte: f.hasta } : undefined);

@Injectable()
class LogisticaService {
  constructor(private readonly db: PrismaService, private readonly audit: Auditoria) {}

  async solicitudes(a: Actor, f: z.infer<typeof FiltroSol>) {
    const { take, skip, pagina, porPagina } = paginar(f);
    const where: Prisma.SolicitudWhereInput = { empresaId: a.empresaId, clienteId: f.clienteId, estado: f.estado, clase: f.clase, numero: f.numero, fechaSolicitada: rango(f) };
    const [total, filas] = await this.db.$transaction([
      this.db.solicitud.count({ where }),
      this.db.solicitud.findMany({ where, take, skip, orderBy: { numero: 'desc' }, include: {
        cliente: { select: { razonSocial: true } }, sucursal: { select: { nombre: true, municipioDane: true } },
        items: { include: { declaracion: { select: { numero: true, nombre: true, codigoInterno: true, disposiciones: { where: { principal: true }, select: { disposicion: { select: { nombre: true } } } } } } } },
      } }),
    ]);
    return { total, pagina, porPagina, filas };
  }

  async crearSolicitud(a: Actor, b: z.infer<typeof CrearSol>) {
    const decls = await this.db.declaracion.findMany({ where: { id: { in: b.items.map((i) => i.declaracionId) }, empresaId: a.empresaId, clienteId: b.clienteId, sucursales: { some: { sucursalId: b.sucursalId } } }, include: { tarifas: { where: { vigenteHasta: null }, take: 1, orderBy: { vigenteDesde: 'desc' } } } });
    if (decls.length !== b.items.length) throw new BadRequestException({ mensaje: 'Alguna declaración no está asignada a esa sede.' });
    return this.db.$transaction(async (tx) => {
      const s = await tx.solicitud.create({ data: {
        empresaId: a.empresaId, clase: b.clase, operacion: b.operacion, clienteId: b.clienteId, sucursalId: b.sucursalId, fechaSolicitada: b.fechaSolicitada, franjaHoraria: b.franjaHoraria, creadoPorId: a.id,
        totalEstimado: b.items.reduce((acc, i) => acc + i.cantidadEstimada * Number(decls.find((d) => d.id === i.declaracionId)!.tarifas[0]?.precioUnitario ?? 0), 0),
      } });
      // El trigger trg_item_declaracion_autorizada rechaza ítems de declaraciones no autorizadas.
      for (const i of b.items) await tx.solicitudItem.create({ data: { solicitudId: s.id, declaracionId: i.declaracionId, cantidadEstimada: i.cantidadEstimada, cantidadEmbalajes: i.cantidadEmbalajes, precioUnitario: decls.find((d) => d.id === i.declaracionId)!.tarifas[0]?.precioUnitario } });
      await this.audit.registrar(a, 'solicitud', s.id, 'CREAR', undefined, { numero: s.numero }, tx);
      return s;
    });
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
        paradas: { orderBy: { orden: 'asc' }, include: { solicitud: { select: { numero: true, cliente: { select: { razonSocial: true } }, sucursal: { select: { nombre: true } } } } } } },
    });
  }

  async crearRuta(a: Actor, b: z.infer<typeof CrearRuta>) {
    const sols = await this.db.solicitud.findMany({ where: { id: { in: b.solicitudes }, empresaId: a.empresaId, clase: 'FORMAL', estado: 'PENDIENTE' } });
    if (sols.length !== b.solicitudes.length) throw new BadRequestException({ mensaje: 'Solo se programan solicitudes formales pendientes de su empresa.' });
    const inicial = await this.db.estadoRecorrido.findFirst({ where: { empresaId: a.empresaId }, orderBy: { orden: 'asc' } });
    return this.db.$transaction(async (tx) => {
      const r = await tx.ruta.create({ data: { empresaId: a.empresaId, codigo: b.codigo, fechaProgramada: b.fechaProgramada, zonaId: b.zonaId, vehiculoId: b.vehiculoId, conductorId: b.conductorId, auxiliarId: b.auxiliarId, estadoRecorridoId: inicial?.id } });
      for (const [i, sid] of b.solicitudes.entries()) await tx.rutaParada.create({ data: { rutaId: r.id, solicitudId: sid, orden: i + 1 } });
      await tx.solicitud.updateMany({ where: { id: { in: b.solicitudes } }, data: { estado: 'PROGRAMADA' } });
      await this.audit.registrar(a, 'ruta', r.id, 'CREAR', undefined, { codigo: r.codigo, paradas: b.solicitudes.length }, tx);
      return r;
    });
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
  async preoperacional(a: Actor, b: z.infer<typeof Preop>) {
    const els = await this.db.elementoChequeo.findMany({ where: { empresaId: a.empresaId, id: { in: b.respuestas.map((r) => r.elementoId) } } });
    if (els.length !== b.respuestas.length) throw new BadRequestException({ mensaje: 'Hay elementos de chequeo que no existen.' });
    const fallaCritica = b.respuestas.filter((r) => r.resultado === 'NO_OK' && els.find((e) => e.id === r.elementoId)!.critico);
    const p = await this.db.preoperacional.create({ data: {
      vehiculoId: b.vehiculoId, rutaId: b.rutaId, conductorId: a.id, auxiliarId: b.auxiliarId, fechaProgramada: b.fechaProgramada, fechaReal: new Date(), km: b.km,
      aprobado: fallaCritica.length === 0, observaciones: b.observaciones, respuestas: { create: b.respuestas.map((r) => ({ elementoId: r.elementoId, resultado: r.resultado })) },
    } });
    await this.audit.registrar(a, 'preoperacional', p.id, p.aprobado ? 'APROBADO' : 'NO_APROBADO', undefined, { fallas: fallaCritica.map((f) => els.find((e) => e.id === f.elementoId)!.nombre) });
    return { ...p, fallasCriticas: fallaCritica.map((f) => els.find((e) => e.id === f.elementoId)!.nombre) };
  }

  async parada(a: Actor, id: string, b: z.infer<typeof Parada>) {
    const p = await this.db.rutaParada.findFirst({ where: { id, ruta: { empresaId: a.empresaId } } });
    if (!p) throw new NotFoundException({ mensaje: 'Parada no encontrada.' });
    return this.db.$transaction(async (tx) => {
      const r = await tx.rutaParada.update({ where: { id }, data: { estado: b.estado, horaLlegada: new Date(), latCheckin: b.latitud, lngCheckin: b.longitud, observaciones: b.observaciones } });
      for (const c of b.cantidades ?? []) await tx.solicitudItem.updateMany({ where: { id: c.solicitudItemId, solicitudId: p.solicitudId }, data: { cantidadReal: c.cantidadReal } });
      if (b.estado === 'ATENDIDA') await tx.solicitud.update({ where: { id: p.solicitudId }, data: { estado: 'RECOLECTADA' } });
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
  @Permiso('solicitudes.crear') @Patch('solicitudes/:id/estado') estadoSol(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(EstadoSol)) b: z.infer<typeof EstadoSol>) { return this.s.estadoSolicitud(a, id, b); }
  @Get('rutas') rutas(@ActorActual() a: Actor, @Query(new Zod(FiltroRuta)) f: z.infer<typeof FiltroRuta>) { return this.s.rutas(a, f); }
  @Permiso('rutas.programar') @Post('rutas') crearRuta(@ActorActual() a: Actor, @Body(new Zod(CrearRuta)) b: z.infer<typeof CrearRuta>) { return this.s.crearRuta(a, b); }
  @Permiso('rutas.operar') @Patch('rutas/:id/estado') estadoRuta(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(EstadoRuta)) b: z.infer<typeof EstadoRuta>) { return this.s.estadoRuta(a, id, b); }
  @Permiso('rutas.operar') @Post('preoperacionales') preop(@ActorActual() a: Actor, @Body(new Zod(Preop)) b: z.infer<typeof Preop>) { return this.s.preoperacional(a, b); }
  @Permiso('rutas.operar') @Patch('paradas/:id') parada(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Parada)) b: z.infer<typeof Parada>) { return this.s.parada(a, id, b); }
}

@Module({ controllers: [LogisticaController], providers: [LogisticaService] })
export class LogisticaModule {}
