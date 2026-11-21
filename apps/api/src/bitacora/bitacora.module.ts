// Bitácora de tiempos y tareas logísticas (gerencia, 20-11-2026): los «tiempos muertos» y las actividades que no son una
// recolección (trancón severo, espera en portería o autorización del cliente, compra de insumos…), para tener el soporte
// real de en qué se va el tiempo de la operación.
// Mismo estándar que la bitácora de actividades de Mantenimiento: el cronómetro corre en el celular y el registro llega
// completo (inicio y fin), también sin señal; tipos configurables; cada quien corrige lo suyo durante 7 días; los
// coordinadores ven al equipo, con el tiempo productivo contra el tiempo muerto de cada ruta.
import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { DIAS_CORRECCION_BITACORA } from '@terraviva/shared';
import { PrismaService } from '../prisma/prisma.service';
import { Auditoria } from '../common/servicios';
import { Archivos } from '../common/archivos';
import { ActorActual, Permiso, PermiteCampo, Zod, type Actor } from '../common/http';

const TIPO = 'TIEMPO_LOGISTICO';
const uuid = z.string().uuid();
const lat = z.number().min(-5).max(14), lng = z.number().min(-82).max(-66);
const DIA = 86_400_000;
const Rango = z.object({ desde: z.coerce.date(), hasta: z.coerce.date(), usuarioId: uuid.optional() })
  .refine((b) => b.hasta >= b.desde, { message: 'El rango está al revés.' })
  .refine((b) => b.hasta.getTime() - b.desde.getTime() <= 370 * DIA, { message: 'Máximo un año por consulta.' });
const Registro = z.object({
  id: uuid.optional(), // lo genera el teléfono: si el envío se repite sin señal, no se duplica
  tipoId: uuid, inicio: z.coerce.date(), fin: z.coerce.date(), nota: z.string().trim().max(500).optional(),
  rutaId: uuid.optional(), paradaId: uuid.optional(), vehiculoId: uuid.optional(),
  latInicio: lat.optional(), lngInicio: lng.optional(), latFin: lat.optional(), lngFin: lng.optional(),
  costo: z.number().int().nonnegative().max(1_000_000_000).optional(),
  usuarioId: uuid.optional(), // solo con «Bitácora del equipo»: registrar el tiempo de otra persona
}).refine((b) => b.fin >= b.inicio, { message: 'La hora de fin no puede ser antes del inicio.' })
  .refine((b) => b.fin.getTime() - b.inicio.getTime() <= DIA, { message: 'Un registro dura máximo 24 horas.' });
const Correccion = z.object({
  tipoId: uuid.optional(), inicio: z.coerce.date().optional(), fin: z.coerce.date().optional(), nota: z.string().trim().max(500).nullish(), costo: z.number().int().nonnegative().max(1_000_000_000).nullish(),
});
const Tipo = z.object({ nombre: z.string().trim().min(3).max(150), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color en formato #RRGGBB.').optional() });
const EditarTipo = Tipo.partial().extend({ activo: z.boolean().optional() });

const seleccion = {
  id: true, usuarioId: true, inicio: true, fin: true, nota: true, costo: true, fotoUrl: true, rutaId: true, vehiculoId: true, creadoEn: true,
  tipo: { select: { id: true, codigo: true, nombre: true, color: true } }, usuario: { select: { id: true, nombre: true } }, registradoPor: { select: { id: true, nombre: true } },
  ruta: { select: { id: true, codigo: true, fechaProgramada: true } }, vehiculo: { select: { id: true, placa: true } },
} satisfies Prisma.TiempoLogisticoSelect;
type Fila = Prisma.TiempoLogisticoGetPayload<{ select: typeof seleccion }>;
const minutos = (t: { inicio: Date; fin: Date }) => Math.max(0, Math.round((t.fin.getTime() - t.inicio.getTime()) / 60_000));
const conMinutos = (t: Fila) => ({ ...t, minutos: minutos(t), costo: t.costo === null ? null : Number(t.costo) });
// Las fechas llegan como AAAA-MM-DD: el día es el de Colombia (UTC−5, sin horario de verano), no el día en UTC
const COLOMBIA = 5 * 3_600_000;
const inicioDelDia = (d: Date) => new Date(d.getTime() + COLOMBIA);
const finDelDia = (d: Date) => new Date(d.getTime() + COLOMBIA + DIA - 1);

@Injectable()
export class BitacoraService {
  constructor(private readonly db: PrismaService, private readonly audit: Auditoria, private readonly archivos: Archivos) {}

  private equipo(a: Actor) { return a.permisos.includes('*') || a.permisos.includes('bitacora.equipo'); }
  private exigirRegistro(a: Actor) {
    if (!this.equipo(a) && !a.permisos.includes('bitacora.registrar'))
      throw new ForbiddenException({ mensaje: `Su rol (${a.rol}) no tiene la función «Registrar tiempos y tareas».` });
  }

  /** Un registro que la persona puede corregir: el suyo de los últimos 7 días, o cualquiera si ve al equipo. */
  private async propio(a: Actor, id: string) {
    const t = await this.db.tiempoLogistico.findFirst({ where: { id, empresaId: a.empresaId } });
    if (!t) throw new NotFoundException({ mensaje: 'Registro no encontrado.' });
    if (!this.equipo(a)) {
      if (t.usuarioId !== a.id) throw new ForbiddenException({ mensaje: 'Solo puede corregir sus propios registros.' });
      if (t.inicio.getTime() < Date.now() - DIAS_CORRECCION_BITACORA * DIA)
        throw new ForbiddenException({ mensaje: `Pasaron más de ${DIAS_CORRECCION_BITACORA} días: pídale la corrección a su coordinador.` });
    }
    return t;
  }

  async tipos(a: Actor, todos = false) {
    if (!todos) this.exigirRegistro(a);
    return this.db.catalogoItem.findMany({ where: { empresaId: a.empresaId, tipo: TIPO, ...(todos ? {} : { activo: true }) }, orderBy: { nombre: 'asc' },
      select: { id: true, codigo: true, nombre: true, color: true, activo: true } });
  }

  async crearTipo(a: Actor, b: z.infer<typeof Tipo>) {
    const base = b.nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 14) || 'TIPO';
    const usados = new Set((await this.db.catalogoItem.findMany({ where: { empresaId: a.empresaId, tipo: TIPO }, select: { codigo: true, nombre: true } })).flatMap((x) => [x.codigo, x.nombre.toLowerCase()]));
    if (usados.has(b.nombre.toLowerCase())) throw new BadRequestException({ mensaje: 'Ya existe un tipo con ese nombre.' });
    let codigo = base; for (let n = 2; usados.has(codigo); n++) codigo = `${base.slice(0, 12)}${n}`;
    const t = await this.db.catalogoItem.create({ data: { empresaId: a.empresaId, tipo: TIPO, codigo, nombre: b.nombre, color: b.color ?? '#667085' }, select: { id: true, codigo: true, nombre: true, color: true, activo: true } });
    await this.audit.registrar(a, 'tipo_tiempo', t.id, 'CREAR', undefined, { nombre: t.nombre });
    return t;
  }

  async editarTipo(a: Actor, id: string, b: z.infer<typeof EditarTipo>) {
    const t = await this.db.catalogoItem.findFirst({ where: { id, empresaId: a.empresaId, tipo: TIPO } });
    if (!t) throw new NotFoundException({ mensaje: 'Tipo no encontrado.' });
    const r = await this.db.catalogoItem.update({ where: { id }, data: b, select: { id: true, codigo: true, nombre: true, color: true, activo: true } });
    await this.audit.registrar(a, 'tipo_tiempo', id, 'EDITAR', { nombre: t.nombre, activo: t.activo }, b);
    return r;
  }

  async registrar(a: Actor, b: z.infer<typeof Registro>) {
    this.exigirRegistro(a);
    if (b.id) {
      const ya = await this.db.tiempoLogistico.findFirst({ where: { id: b.id, empresaId: a.empresaId }, select: seleccion });
      if (ya) return conMinutos(ya); // reenvío desde la cola sin señal
    }
    const usuarioId = b.usuarioId ?? a.id;
    if (usuarioId !== a.id) {
      if (!this.equipo(a)) throw new ForbiddenException({ mensaje: 'Registrar el tiempo de otra persona es de quien tiene «Bitácora del equipo».' });
      if (!(await this.db.usuario.findFirst({ where: { id: usuarioId, empresaId: a.empresaId, activo: true, clienteId: null } }))) throw new BadRequestException({ mensaje: 'Persona no encontrada.' });
    }
    if (b.inicio.getTime() > Date.now() + 10 * 60_000 || b.fin.getTime() > Date.now() + 10 * 60_000) throw new BadRequestException({ mensaje: 'No se registran tiempos en el futuro.' });
    if (!(await this.db.catalogoItem.findFirst({ where: { id: b.tipoId, empresaId: a.empresaId, tipo: TIPO, activo: true } }))) throw new BadRequestException({ mensaje: 'Tipo de tiempo no encontrado o inactivo.' });
    if (b.rutaId) {
      const r = await this.db.ruta.findFirst({ where: { id: b.rutaId, empresaId: a.empresaId }, select: { conductorId: true, auxiliarId: true } });
      if (!r) throw new BadRequestException({ mensaje: 'Ruta no encontrada.' });
      // Campo solo amarra el tiempo a una ruta suya
      if (a.acceso === 'CAMPO' && r.conductorId !== a.id && r.auxiliarId !== a.id) throw new ForbiddenException({ mensaje: 'Esa ruta no está asignada a usted.' });
    }
    if (b.paradaId && !(await this.db.rutaParada.findFirst({ where: { id: b.paradaId, ruta: { empresaId: a.empresaId }, ...(b.rutaId ? { rutaId: b.rutaId } : {}) } })))
      throw new BadRequestException({ mensaje: 'Parada no encontrada.' });
    if (b.vehiculoId && !(await this.db.vehiculo.findFirst({ where: { id: b.vehiculoId, empresaId: a.empresaId } }))) throw new BadRequestException({ mensaje: 'Vehículo no encontrado.' });
    const { usuarioId: _u, ...datos } = b;
    const t = await this.db.tiempoLogistico.create({ data: { ...datos, empresaId: a.empresaId, usuarioId, registradoPorId: a.id }, select: seleccion });
    await this.audit.registrar(a, 'tiempo', t.id, 'CREAR', undefined, { tipo: t.tipo.nombre, minutos: minutos(t), usuario: usuarioId });
    return conMinutos(t);
  }

  async mios(a: Actor, q: z.infer<typeof Rango>) {
    this.exigirRegistro(a);
    const filas = await this.db.tiempoLogistico.findMany({ where: { empresaId: a.empresaId, usuarioId: a.id, inicio: { gte: inicioDelDia(q.desde), lte: finDelDia(q.hasta) } },
      orderBy: { inicio: 'desc' }, take: 500, select: seleccion });
    return filas.map(conMinutos);
  }

  async corregir(a: Actor, id: string, b: z.infer<typeof Correccion>) {
    const t = await this.propio(a, id);
    const inicio = b.inicio ?? t.inicio, fin = b.fin ?? t.fin;
    if (fin < inicio) throw new BadRequestException({ mensaje: 'La hora de fin no puede ser antes del inicio.' });
    if (fin.getTime() - inicio.getTime() > DIA) throw new BadRequestException({ mensaje: 'Un registro dura máximo 24 horas.' });
    if (b.tipoId && !(await this.db.catalogoItem.findFirst({ where: { id: b.tipoId, empresaId: a.empresaId, tipo: TIPO, activo: true } }))) throw new BadRequestException({ mensaje: 'Tipo de tiempo no encontrado o inactivo.' });
    const r = await this.db.tiempoLogistico.update({ where: { id }, data: b, select: seleccion });
    await this.audit.registrar(a, 'tiempo', id, 'CORREGIR', { tipoId: t.tipoId, inicio: t.inicio, fin: t.fin, nota: t.nota }, b);
    return conMinutos(r);
  }

  async borrar(a: Actor, id: string) {
    const t = await this.propio(a, id);
    await this.db.tiempoLogistico.delete({ where: { id } });
    await this.audit.registrar(a, 'tiempo', id, 'BORRAR', { tipoId: t.tipoId, usuarioId: t.usuarioId, inicio: t.inicio, fin: t.fin, nota: t.nota });
    return { ok: true };
  }

  async foto(a: Actor, id: string, file?: Express.Multer.File) {
    if (!file) throw new BadRequestException({ mensaje: 'Adjunte la foto.' });
    await this.propio(a, id);
    const g = await this.archivos.guardar(a.empresaId, 'bitacora', file.buffer, ['jpg', 'png', 'webp']);
    await this.db.tiempoLogistico.update({ where: { id }, data: { fotoUrl: g.clave } });
    return { id, fotoUrl: g.clave };
  }

  /** Vista del equipo: el detalle y los totales por tipo, persona, vehículo y ruta (tiempo productivo contra tiempo muerto). */
  async delEquipo(a: Actor, q: z.infer<typeof Rango>) {
    const hasta = finDelDia(q.hasta);
    const filas = (await this.db.tiempoLogistico.findMany({ where: { empresaId: a.empresaId, usuarioId: q.usuarioId, inicio: { gte: inicioDelDia(q.desde), lte: hasta } },
      orderBy: { inicio: 'desc' }, take: 5000, select: seleccion })).map(conMinutos);
    const sumar = <K extends string>(clave: (t: (typeof filas)[number]) => K | null, extra: (t: (typeof filas)[number]) => Record<string, unknown> = () => ({})) => {
      const m = new Map<K, { minutos: number; veces: number } & Record<string, unknown>>();
      for (const t of filas) { const k = clave(t); if (k === null) continue; const x = m.get(k) ?? { ...extra(t), minutos: 0, veces: 0 }; x.minutos += t.minutos; x.veces++; m.set(k, x); }
      return [...m.values()].sort((x, y) => y.minutos - x.minutos);
    };
    // Rutas del periodo: duración (salida de planta → llegada a planta) contra los tiempos muertos amarrados a cada una
    const rutas = await this.db.ruta.findMany({ where: { empresaId: a.empresaId, fechaProgramada: { gte: q.desde, lte: q.hasta }, OR: [{ horaSalida: { not: null } }, { tiempos: { some: {} } }] },
      orderBy: { fechaProgramada: 'desc' }, take: 1000,
      select: { id: true, codigo: true, fechaProgramada: true, horaSalida: true, horaLlegadaPlanta: true, vehiculo: { select: { placa: true } }, conductor: { select: { nombre: true } } } });
    const muertoDe = new Map<string, number>();
    for (const t of filas) if (t.rutaId) muertoDe.set(t.rutaId, (muertoDe.get(t.rutaId) ?? 0) + t.minutos);
    const porRuta = rutas.map((r) => {
      const duracion = r.horaSalida && r.horaLlegadaPlanta ? minutos({ inicio: r.horaSalida, fin: r.horaLlegadaPlanta }) : null;
      const muerto = muertoDe.get(r.id) ?? 0;
      return { id: r.id, codigo: r.codigo, fecha: r.fechaProgramada, placa: r.vehiculo?.placa ?? null, conductor: r.conductor?.nombre ?? null, duracion, muerto,
        productivo: duracion === null ? null : Math.max(0, duracion - muerto), pctMuerto: duracion ? Math.round((muerto * 1000) / duracion) / 10 : null };
    });
    const conDuracion = porRuta.filter((r) => r.duracion !== null);
    const totalRutas = conDuracion.reduce((s, r) => s + r.duracion!, 0), muertoRutas = conDuracion.reduce((s, r) => s + r.muerto, 0);
    return {
      desde: q.desde, hasta: q.hasta, filas,
      total: { minutos: filas.reduce((s, t) => s + t.minutos, 0), registros: filas.length, costo: filas.reduce((s, t) => s + (t.costo ?? 0), 0),
        rutas: { minutos: totalRutas, muerto: muertoRutas, pctMuerto: totalRutas ? Math.round((muertoRutas * 1000) / totalRutas) / 10 : null } },
      porTipo: sumar((t) => t.tipo.id, (t) => ({ tipo: t.tipo.nombre, color: t.tipo.color })),
      porPersona: sumar((t) => t.usuario.id, (t) => ({ persona: t.usuario.nombre })),
      porVehiculo: sumar((t) => t.vehiculo?.id ?? null, (t) => ({ placa: t.vehiculo!.placa })),
      porRuta,
    };
  }
}

@Controller('bitacora')
class BitacoraController {
  constructor(private readonly s: BitacoraService) {}
  // Lo que usa el celular (campo y oficina): el servicio exige «Registrar tiempos y tareas» o «Bitácora del equipo»
  @PermiteCampo() @Get('tipos') tipos(@ActorActual() a: Actor) { return this.s.tipos(a); }
  @PermiteCampo() @Get('mios') mios(@ActorActual() a: Actor, @Query(new Zod(Rango)) q: z.infer<typeof Rango>) { return this.s.mios(a, q); }
  @PermiteCampo() @Post() registrar(@ActorActual() a: Actor, @Body(new Zod(Registro)) b: z.infer<typeof Registro>) { return this.s.registrar(a, b); }
  @PermiteCampo() @Patch(':id') corregir(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Correccion)) b: z.infer<typeof Correccion>) { return this.s.corregir(a, id, b); }
  @PermiteCampo() @Delete(':id') borrar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.borrar(a, id); }
  @PermiteCampo() @Post(':id/foto') @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: 12 * 1024 * 1024, files: 1 } }))
  foto(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() f?: Express.Multer.File) { return this.s.foto(a, id, f); }
  // Oficina: el equipo y la lista de tipos
  @Permiso('bitacora.equipo') @Get('equipo') equipo(@ActorActual() a: Actor, @Query(new Zod(Rango)) q: z.infer<typeof Rango>) { return this.s.delEquipo(a, q); }
  @Permiso('configuracion.editar') @Get('tipos/todos') todos(@ActorActual() a: Actor) { return this.s.tipos(a, true); }
  @Permiso('configuracion.editar') @Post('tipos') crearTipo(@ActorActual() a: Actor, @Body(new Zod(Tipo)) b: z.infer<typeof Tipo>) { return this.s.crearTipo(a, b); }
  @Permiso('configuracion.editar') @Patch('tipos/:id') editarTipo(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(EditarTipo)) b: z.infer<typeof EditarTipo>) { return this.s.editarTipo(a, id, b); }
}

@Module({ controllers: [BitacoraController], providers: [BitacoraService] })
export class BitacoraModule {}
