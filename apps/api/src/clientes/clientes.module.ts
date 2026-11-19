import { BadRequestException, Body, Controller, Get, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Injectable } from '@nestjs/common';
import { ClasificacionSede, FormaPago, Prisma, TipoCliente, TipoNegociacion } from '@prisma/client';
import { z } from 'zod';
import { dvNit } from '@terraviva/shared';
import { PrismaService } from '../prisma/prisma.service';
import { Auditoria, Municipios } from '../common/servicios';
import { ActorActual, Permiso, Zod, paginar, type Actor } from '../common/http';

const Filtros = z.object({
  q: z.string().optional(), tipo: z.nativeEnum(TipoCliente).optional(), activo: z.enum(['true', 'false']).optional(),
  pagina: z.coerce.number().optional(), porPagina: z.coerce.number().optional(),
});
/** Texto opcional: '' borra el valor (null). */
const textoOpc = (max: number) => z.string().trim().max(max).transform((s) => s || null).nullish();
const Comercial = z.object({
  razonSocial: z.string().trim().min(2).max(200), sector: textoOpc(60),
  tipo: z.nativeEnum(TipoCliente).default('DIRECTO'),
  tipoNegociacion: z.nativeEnum(TipoNegociacion).default('COBRO'), formaPago: z.nativeEnum(FormaPago).default('CONTADO'),
  emailFacturacion: z.string().trim().email('Correo de facturación inválido').or(z.literal('')).transform((s) => s || null).nullish(),
  asesorId: z.string().uuid().nullish(),
});
const Crear = Comercial.extend({ nit: z.string().regex(/^\d{6,10}$/, 'NIT sin puntos ni DV (6 a 10 dígitos)') });
const Editar = Comercial.partial().extend({
  activo: z.boolean().optional(),
  causalId: z.string().uuid().optional(), // al inactivar: motivo con el que se inactivan sus declaraciones
});
const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora HH:MM').transform((h) => new Date(`1970-01-01T${h}:00Z`));
const horaOpc = z.union([hora, z.literal('').transform(() => null)]).nullish();
const DatosSede = z.object({
  nombre: z.string().trim().min(2).max(150), codigo: z.string().regex(/^[A-Za-z0-9-]{1,20}$/, 'Código de 1 a 20 letras, números o guiones').transform((s) => s.toUpperCase()).or(z.literal('').transform(() => null)).nullish(),
  esPrincipal: z.boolean().default(false), clasificacion: z.nativeEnum(ClasificacionSede).nullish(),
  generadorNit: z.string().regex(/^\d{6,10}$/, 'NIT del generador sin puntos ni DV').or(z.literal('').transform(() => null)).nullish(), generadorNombre: textoOpc(200),
  direccion: textoOpc(300), municipioDane: z.string().regex(/^\d{5}$/, 'Código DANE de 5 dígitos').or(z.literal('').transform(() => null)).nullish(), zonaId: z.string().uuid().nullish(),
  latitud: z.number().min(-5).max(14).nullish(), longitud: z.number().min(-82).max(-66).nullish(), registroRespel: textoOpc(50),
  contacto: textoOpc(150), telefono: textoOpc(20), celular: textoOpc(20), emails: textoOpc(200),
  atencionLvDesde: horaOpc, atencionLvHasta: horaOpc, atencionFdDesde: horaOpc, atencionFdHasta: horaOpc, observaciones: textoOpc(1000),
});
const EditarSede = DatosSede.partial().extend({ activa: z.boolean().optional() });
const Busqueda = z.object({ q: z.string().max(60).default(''), departamento: z.string().max(60).optional() });

/** Valor comparable: los decimales de Prisma como número y las fechas como texto ISO. */
const comparable = (x: unknown) => (x instanceof Prisma.Decimal ? x.toNumber() : x instanceof Date ? x.toISOString() : x ?? null);
/** Lo que cambió entre dos registros (para la auditoría). */
function cambios(antes: object, despues: object) {
  const a: Record<string, unknown> = {}, d: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(despues)) {
    const previo = (antes as Record<string, unknown>)[k];
    if (v !== undefined && JSON.stringify(comparable(previo)) !== JSON.stringify(comparable(v))) { a[k] = comparable(previo); d[k] = comparable(v); }
  }
  return { antes: a, despues: d, hay: Object.keys(d).length > 0 };
}

@Injectable()
class ClientesService {
  constructor(private readonly db: PrismaService, private readonly audit: Auditoria, private readonly municipios: Municipios) {}

  async listar(a: Actor, f: z.infer<typeof Filtros>) {
    const { take, skip, pagina, porPagina } = paginar(f);
    const where: Prisma.ClienteWhereInput = {
      empresaId: a.empresaId, tipo: f.tipo, activo: f.activo ? f.activo === 'true' : undefined,
      ...(f.q ? { OR: [{ razonSocial: { contains: f.q, mode: 'insensitive' as const } }, { nit: { contains: f.q.replace(/\D/g, '') || f.q } }] } : {}),
    };
    const [total, filas] = await this.db.$transaction([
      this.db.cliente.count({ where }),
      this.db.cliente.findMany({ where, take, skip, orderBy: { razonSocial: 'asc' }, include: {
        asesor: { select: { id: true, nombre: true } },
        sucursales: { orderBy: [{ esPrincipal: 'desc' }, { nombre: 'asc' }], select: { id: true, nombre: true, codigo: true, esPrincipal: true, activa: true, zona: { select: { nombre: true, color: true } }, municipio: { select: { nombre: true } } } },
        _count: { select: { declaraciones: { where: { estado: 'AUTORIZADA', activa: true } } } },
      } }),
    ]);
    return { total, pagina, porPagina, filas };
  }

  async obtener(a: Actor, id: string) {
    const c = await this.db.cliente.findFirst({ where: { id, empresaId: a.empresaId }, include: {
      asesor: { select: { id: true, nombre: true } },
      sucursales: { orderBy: [{ esPrincipal: 'desc' }, { nombre: 'asc' }], include: { zona: true, municipio: true, _count: { select: { declaraciones: { where: { activa: true, declaracion: { estado: 'AUTORIZADA', activa: true } } } } } } },
      _count: { select: { declaraciones: { where: { estado: { not: 'ANULADA' } } }, solicitudes: true, manifiestos: true } },
    } });
    if (!c) throw new NotFoundException({ mensaje: 'Cliente no encontrado.' });
    const activas = await this.db.declaracion.count({ where: { clienteId: id, estado: 'AUTORIZADA', activa: true } });
    return { ...c, declaracionesActivas: activas };
  }

  private async validarAsesor(a: Actor, asesorId?: string | null) {
    if (asesorId && !(await this.db.usuario.findFirst({ where: { id: asesorId, empresaId: a.empresaId, activo: true } })))
      throw new BadRequestException({ mensaje: 'El asesor comercial no existe o está inactivo.' });
  }

  async crear(a: Actor, b: z.infer<typeof Crear>) {
    await this.validarAsesor(a, b.asesorId);
    if (await this.db.cliente.findUnique({ where: { empresaId_nit: { empresaId: a.empresaId, nit: b.nit } } }))
      throw new BadRequestException({ mensaje: `Ya existe un cliente con el NIT ${b.nit}.` });
    const c = await this.db.cliente.create({ data: { ...b, empresaId: a.empresaId, dv: dvNit(b.nit) } });
    await this.audit.registrar(a, 'cliente', c.id, 'CREAR', undefined, c);
    return c;
  }

  /**
   * Edita los datos comerciales. El NIT no cambia (es la identidad del cliente: para otro NIT se crea otro cliente).
   * Inactivar no borra nada: sus declaraciones activas quedan inactivas con el motivo indicado, para que no se
   * programen más servicios (la base ya no deja autorizar ni cambiar declaraciones de un cliente inactivo).
   */
  async editar(a: Actor, id: string, b: z.infer<typeof Editar>) {
    const { causalId, ...datos } = b;
    await this.validarAsesor(a, datos.asesorId);
    return this.db.$transaction(async (tx) => {
      const c = await tx.cliente.findFirst({ where: { id, empresaId: a.empresaId }, include: { sucursales: { where: { activa: true }, select: { nombre: true, generadorNit: true } } } });
      if (!c) throw new NotFoundException({ mensaje: 'Cliente no encontrado.' });
      if (datos.tipo === 'GESTOR' && c.tipo !== 'GESTOR') {
        const sin = c.sucursales.filter((s) => !s.generadorNit).map((s) => s.nombre);
        if (sin.length) throw new BadRequestException({ mensaje: `Para pasarlo a gestor, cada sede activa debe tener el NIT del generador. Falta en: ${sin.slice(0, 5).join(', ')}${sin.length > 5 ? '…' : ''}.` });
      }
      let inactivadas = 0;
      if (datos.activo === false && c.activo) {
        const activas = await tx.declaracion.count({ where: { clienteId: id, estado: 'AUTORIZADA', activa: true } });
        if (activas) {
          if (!causalId) throw new BadRequestException({ mensaje: `El cliente tiene ${activas} declaraciones activas: indique el motivo con que se inactivan.` });
          if (!(await tx.catalogoItem.findFirst({ where: { id: causalId, empresaId: a.empresaId, tipo: 'CAUSAL' } }))) throw new BadRequestException({ mensaje: 'Motivo no válido.' });
          inactivadas = (await tx.declaracion.updateMany({ where: { clienteId: id, estado: 'AUTORIZADA', activa: true }, data: { activa: false, causalId } })).count;
        }
      }
      const { sucursales: _s, ...antes } = c;
      const d = cambios(antes, datos);
      if (!d.hay) return { ...c, inactivadas };
      const r = await tx.cliente.update({ where: { id }, data: datos });
      await this.audit.registrar(a, 'cliente', id, datos.activo === false && c.activo ? 'INACTIVAR' : datos.activo && !c.activo ? 'ACTIVAR' : 'EDITAR', d.antes, { ...d.despues, ...(inactivadas ? { declaracionesInactivadas: inactivadas } : {}) }, tx);
      return { ...r, inactivadas };
    });
  }

  private async validarSede(a: Actor, cliente: { tipo: TipoCliente }, b: Partial<z.infer<typeof DatosSede>>, actual?: { generadorNit: string | null }) {
    if (b.municipioDane && !(await this.municipios.existe(b.municipioDane)))
      throw new BadRequestException({ mensaje: `El municipio ${b.municipioDane} no está en la DIVIPOLA del DANE.` });
    if (b.zonaId && !(await this.db.zona.findFirst({ where: { id: b.zonaId, empresaId: a.empresaId } }))) throw new BadRequestException({ mensaje: 'Zona no válida.' });
    const nit = b.generadorNit !== undefined ? b.generadorNit : actual?.generadorNit;
    if (cliente.tipo === 'GESTOR' && !nit) throw new BadRequestException({ mensaje: 'En un cliente gestor, cada sede debe indicar el NIT del generador.' });
  }

  async crearSucursal(a: Actor, clienteId: string, b: z.infer<typeof DatosSede>) {
    const c = await this.obtener(a, clienteId);
    if (!c.activo) throw new BadRequestException({ mensaje: 'El cliente está inactivo: actívelo antes de agregarle sedes.' });
    await this.validarSede(a, c, b);
    if (b.codigo && c.sucursales.some((s) => s.codigo === b.codigo)) throw new BadRequestException({ mensaje: `El cliente ya tiene una sede con el código ${b.codigo}.` });
    return this.db.$transaction(async (tx) => {
      // La primera sede del cliente queda como principal si no se indicó otra; si esta es la principal, la anterior deja de serlo.
      const principal = b.esPrincipal || !c.sucursales.length;
      if (principal) await tx.sucursal.updateMany({ where: { clienteId, esPrincipal: true }, data: { esPrincipal: false } });
      const s = await tx.sucursal.create({ data: { ...b, esPrincipal: principal, clienteId } });
      await this.audit.registrar(a, 'sucursal', s.id, 'CREAR', undefined, s, tx);
      return s;
    });
  }

  /**
   * Edita una sede. Inactivarla no borra nada: deja de recibir servicios (sus vínculos con declaraciones vigentes se
   * inactivan). La sede principal no se inactiva: primero se marca otra como principal.
   */
  async editarSucursal(a: Actor, clienteId: string, sucursalId: string, b: z.infer<typeof EditarSede>) {
    const c = await this.obtener(a, clienteId);
    const s = c.sucursales.find((x) => x.id === sucursalId);
    if (!s) throw new NotFoundException({ mensaje: 'Sede no encontrada para este cliente.' });
    await this.validarSede(a, c, b, s);
    if (b.codigo && c.sucursales.some((x) => x.id !== sucursalId && x.codigo === b.codigo)) throw new BadRequestException({ mensaje: `El cliente ya tiene otra sede con el código ${b.codigo}.` });
    if (b.activa === false && (s.esPrincipal && b.esPrincipal !== false)) throw new BadRequestException({ mensaje: 'Es la sede principal: marque otra como principal antes de inactivarla.' });
    if (b.esPrincipal === false && s.esPrincipal) throw new BadRequestException({ mensaje: 'Para cambiar la sede principal, marque como principal la otra sede.' });
    if (b.esPrincipal && (b.activa === false || (!s.activa && b.activa !== true))) throw new BadRequestException({ mensaje: 'Una sede inactiva no puede ser la principal.' });
    return this.db.$transaction(async (tx) => {
      if (b.esPrincipal && !s.esPrincipal) await tx.sucursal.updateMany({ where: { clienteId, esPrincipal: true }, data: { esPrincipal: false } });
      let vinculos = 0;
      if (b.activa === false && s.activa)
        vinculos = (await tx.declaracionSucursal.updateMany({ where: { sucursalId, activa: true, declaracion: { estado: { not: 'ANULADA' } } }, data: { activa: false } })).count;
      const { zona: _z, municipio: _m, _count: _c, ...antes } = s;
      const d = cambios(antes, b);
      if (!d.hay) return s;
      const r = await tx.sucursal.update({ where: { id: sucursalId }, data: b });
      await this.audit.registrar(a, 'sucursal', sucursalId, b.activa === false && s.activa ? 'INACTIVAR' : b.activa && !s.activa ? 'ACTIVAR' : 'EDITAR', d.antes, { ...d.despues, ...(vinculos ? { vinculosInactivados: vinculos } : {}) }, tx);
      return r;
    });
  }

  /** Personas que pueden figurar como asesor comercial: usuarios activos de oficina. */
  asesores(a: Actor) {
    return this.db.usuario.findMany({ where: { empresaId: a.empresaId, activo: true, esConductor: false, esAuxiliar: false }, orderBy: { nombre: 'asc' }, select: { id: true, nombre: true, rol: { select: { nombre: true } } } });
  }
  /** Sectores ya usados, para sugerirlos al escribir. */
  async sectores(a: Actor) {
    const r = await this.db.cliente.groupBy({ by: ['sector'], where: { empresaId: a.empresaId, sector: { not: null } }, _count: true, orderBy: { _count: { sector: 'desc' } }, take: 40 });
    return r.map((x) => x.sector!).filter(Boolean);
  }
}

@Controller('clientes')
class ClientesController {
  constructor(private readonly s: ClientesService) {}
  @Get() listar(@ActorActual() a: Actor, @Query(new Zod(Filtros)) f: z.infer<typeof Filtros>) { return this.s.listar(a, f); }
  @Get('asesores') asesores(@ActorActual() a: Actor) { return this.s.asesores(a); }
  @Get('sectores') sectores(@ActorActual() a: Actor) { return this.s.sectores(a); }
  @Get(':id') obtener(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.obtener(a, id); }
  @Permiso('clientes.editar') @Post() crear(@ActorActual() a: Actor, @Body(new Zod(Crear)) b: z.infer<typeof Crear>) { return this.s.crear(a, b); }
  @Permiso('clientes.editar') @Patch(':id') editar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Editar)) b: z.infer<typeof Editar>) { return this.s.editar(a, id, b); }
  @Permiso('clientes.editar') @Post(':id/sucursales') sucursal(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(DatosSede)) b: z.infer<typeof DatosSede>) { return this.s.crearSucursal(a, id, b); }
  @Permiso('clientes.editar') @Patch(':id/sucursales/:sucursalId')
  editarSucursal(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('sucursalId', ParseUUIDPipe) sid: string, @Body(new Zod(EditarSede)) b: z.infer<typeof EditarSede>) {
    return this.s.editarSucursal(a, id, sid, b);
  }
}

/** Municipios de la DIVIPOLA del DANE, para elegir el de una sede (buscador). */
@Controller('municipios')
class MunicipiosController {
  constructor(private readonly m: Municipios) {}
  @Get() buscar(@Query(new Zod(Busqueda)) q: z.infer<typeof Busqueda>) { return this.m.buscar(q.q, q.departamento); }
}

@Module({ controllers: [ClientesController, MunicipiosController], providers: [ClientesService] })
export class ClientesModule {}
