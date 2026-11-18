import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { EstadoDeclaracion, FormaPago, Prisma, TipoDeclaracion, TipoNegociacion } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { Auditoria } from '../common/servicios';
import { ActorActual, Permiso, Zod, paginar, type Actor } from '../common/http';

const Filtros = z.object({
  tipo: z.nativeEnum(TipoDeclaracion).optional(), clienteId: z.string().uuid().optional(), sucursalId: z.string().uuid().optional(),
  estado: z.nativeEnum(EstadoDeclaracion).optional(), numero: z.coerce.number().int().optional(), q: z.string().optional(),
  codigo: z.string().optional(), pagina: z.coerce.number().optional(), porPagina: z.coerce.number().optional(),
});
const Crear = z.object({
  tipo: z.nativeEnum(TipoDeclaracion), clienteId: z.string().uuid(), sucursalId: z.string().uuid(), residuoId: z.string().uuid(),
  tipoManejoId: z.string().uuid().optional(), destinoId: z.string().uuid().optional(), embalajeId: z.string().uuid().optional(),
  cantidadEstimada: z.number().nonnegative().optional(), frecuencia: z.string().max(15).optional(), vigenteHasta: z.coerce.date().optional(),
  precioUnitario: z.number().nonnegative().optional(),
});
const CambioEstado = z.object({ estado: z.enum(['AUTORIZADA', 'RECHAZADA', 'INACTIVA']), causalId: z.string().uuid().optional(), observacion: z.string().max(300).optional() });
const Tarifas = z.object({
  declaraciones: z.array(z.string().uuid()).min(1).max(2000),
  modo: z.enum(['porcentaje', 'fijo']), valor: z.number(), vigenteDesde: z.coerce.date(),
  tipoNegociacion: z.nativeEnum(TipoNegociacion).optional(), formaPago: z.nativeEnum(FormaPago).optional(),
});

/** Resultado de cruzar el tipo de manejo de una declaración con los permisos ambientales vigentes. */
export interface Cobertura { cubierto: boolean; aliado: boolean; permiso?: string; mensaje: string }

@Injectable()
export class DeclaracionesService {
  constructor(private readonly db: PrismaService, private readonly audit: Auditoria) {}

  async cobertura(empresaId: string, tipoManejoId: string | null): Promise<Cobertura> {
    if (!tipoManejoId) return { cubierto: false, aliado: false, mensaje: 'La declaración no tiene tipo de manejo.' };
    const m = await this.db.catalogoItem.findFirst({ where: { id: tipoManejoId, empresaId } });
    if (!m) return { cubierto: false, aliado: false, mensaje: 'Tipo de manejo no encontrado.' };
    const meta = (m.meta ?? {}) as { propio?: boolean; servicio?: boolean; requierePermiso?: boolean };
    if (meta.servicio) return { cubierto: true, aliado: false, mensaje: 'Servicio en sitio: no requiere permiso de disposición.' };
    if (meta.requierePermiso === false) return { cubierto: true, aliado: false, mensaje: `${m.nombre}: no requiere permiso de disposición; verifique el registro como prestador de aprovechamiento ante la Superservicios.` };
    if (meta.propio === false) return { cubierto: true, aliado: true, mensaje: `${m.nombre}: exigir licencia vigente y certificado del gestor aliado.` };
    const p = await this.db.permisoAmbiental.findFirst({
      where: { empresaId, manejosCubiertos: { has: m.codigo }, estado: { in: ['VIGENTE', 'POR_VENCER'] }, OR: [{ vence: null }, { vence: { gt: new Date() } }] },
    });
    return p ? { cubierto: true, aliado: false, permiso: p.acto, mensaje: `Cubierto por ${p.acto} (${p.autoridad}).` } : { cubierto: false, aliado: false, mensaje: `Ningún permiso vigente cubre «${m.nombre}».` };
  }

  async listar(a: Actor, f: z.infer<typeof Filtros>) {
    const { take, skip, pagina, porPagina } = paginar(f);
    const where: Prisma.DeclaracionWhereInput = {
      empresaId: a.empresaId, tipo: f.tipo, clienteId: f.clienteId, sucursalId: f.sucursalId, estado: f.estado, numero: f.numero,
      residuo: f.q || f.codigo ? { nombre: f.q ? { contains: f.q, mode: 'insensitive' } : undefined, codigo: f.codigo ? { contains: f.codigo, mode: 'insensitive' } : undefined } : undefined,
    };
    const hoy = new Date();
    const [total, filas] = await this.db.$transaction([
      this.db.declaracion.count({ where }),
      this.db.declaracion.findMany({
        where, take, skip, orderBy: { numero: 'desc' },
        include: {
          cliente: { select: { id: true, razonSocial: true, nit: true } }, sucursal: { select: { id: true, nombre: true, municipioDane: true } },
          residuo: { select: { codigo: true, nombre: true, corriente: true, peligrosidad: true, unidad: true, numeroOnu: true, estadoFisico: true, lineaServicio: { select: { nombre: true } } } },
          tipoManejo: { select: { id: true, codigo: true, nombre: true } }, embalaje: { select: { nombre: true } }, causal: { select: { nombre: true } },
          tarifas: { where: { vigenteDesde: { lte: hoy }, OR: [{ vigenteHasta: null }, { vigenteHasta: { gte: hoy } }] }, orderBy: { vigenteDesde: 'desc' }, take: 1 },
        },
      }),
    ]);
    return { total, pagina, porPagina, filas: filas.map(({ tarifas, ...d }) => ({ ...d, tarifaVigente: tarifas[0] ?? null })) };
  }

  async obtener(a: Actor, id: string) {
    const d = await this.db.declaracion.findFirst({ where: { id, empresaId: a.empresaId }, include: { cliente: true, sucursal: true, residuo: true, tipoManejo: true, embalaje: true, destino: true, tarifas: { orderBy: { vigenteDesde: 'desc' } } } });
    if (!d) throw new NotFoundException({ mensaje: 'Declaración no encontrada.' });
    return { ...d, cobertura: await this.cobertura(a.empresaId, d.tipoManejoId ?? d.residuo.tipoManejoId) };
  }

  async crear(a: Actor, b: z.infer<typeof Crear>) {
    const suc = await this.db.sucursal.findFirst({ where: { id: b.sucursalId, clienteId: b.clienteId, cliente: { empresaId: a.empresaId } } });
    if (!suc) throw new BadRequestException({ mensaje: 'La sucursal no pertenece a ese cliente.' });
    const res = await this.db.catalogoResiduo.findFirst({ where: { id: b.residuoId, empresaId: a.empresaId } });
    if (!res) throw new BadRequestException({ mensaje: 'Residuo o servicio no existe en el catálogo.' });
    const cliente = await this.db.cliente.findUniqueOrThrow({ where: { id: b.clienteId } });
    return this.db.$transaction(async (tx) => {
      const d = await tx.declaracion.create({ data: {
        empresaId: a.empresaId, tipo: b.tipo, clienteId: b.clienteId, sucursalId: b.sucursalId, residuoId: b.residuoId, estado: 'PENDIENTE',
        tipoManejoId: b.tipoManejoId ?? res.tipoManejoId, destinoId: b.destinoId, embalajeId: b.embalajeId, cantidadEstimada: b.cantidadEstimada, frecuencia: b.frecuencia, vigenteHasta: b.vigenteHasta,
      } });
      if (b.precioUnitario !== undefined) await tx.tarifa.create({ data: { declaracionId: d.id, precioUnitario: b.precioUnitario, tipoNegociacion: cliente.tipoNegociacion, formaPago: cliente.formaPago, vigenteDesde: new Date(), asignadoPorId: a.id } });
      await this.audit.registrar(a, 'declaracion', d.id, 'CREAR', undefined, d, tx);
      return d;
    });
  }

  async cambiarEstado(a: Actor, id: string, b: z.infer<typeof CambioEstado>) {
    const d = await this.db.declaracion.findFirst({ where: { id, empresaId: a.empresaId }, include: { residuo: true } });
    if (!d) throw new NotFoundException({ mensaje: 'Declaración no encontrada.' });
    if (b.estado === 'AUTORIZADA') {
      const c = await this.cobertura(a.empresaId, d.tipoManejoId ?? d.residuo.tipoManejoId);
      if (!c.cubierto) throw new ForbiddenException({ mensaje: `No se puede autorizar: ${c.mensaje}`, cobertura: c });
    }
    const nuevo = await this.db.declaracion.update({ where: { id }, data: {
      estado: b.estado, causalId: b.estado === 'AUTORIZADA' ? null : b.causalId,
      autorizacion: b.estado === 'AUTORIZADA' ? `AUT-${new Date().getFullYear()}-${String(d.numero).padStart(5, '0')}` : d.autorizacion,
    } });
    await this.audit.registrar(a, 'declaracion', id, `ESTADO_${b.estado}`, { estado: d.estado }, { estado: b.estado, observacion: b.observacion });
    return nuevo;
  }

  /** Asignación masiva: cierra la tarifa vigente y crea una nueva por declaración. Nunca sobrescribe precios. */
  async tarifasMasivas(a: Actor, b: z.infer<typeof Tarifas>) {
    const decls = await this.db.declaracion.findMany({ where: { id: { in: b.declaraciones }, empresaId: a.empresaId }, include: { cliente: true, tarifas: { where: { vigenteHasta: null }, orderBy: { vigenteDesde: 'desc' }, take: 1 } } });
    if (decls.length !== b.declaraciones.length) throw new BadRequestException({ mensaje: 'Alguna declaración no existe o no es de su empresa.' });
    const lote = randomUUID();
    const dia = new Date(b.vigenteDesde.getTime() - 86_400_000);
    await this.db.$transaction(async (tx) => {
      for (const d of decls) {
        const actual = d.tarifas[0];
        const base = actual ? Number(actual.precioUnitario) : 0;
        const precio = b.modo === 'fijo' ? b.valor : Math.round(base * (1 + b.valor / 100) / 10) * 10;
        if (precio < 0) throw new BadRequestException({ mensaje: 'El precio resultante no puede ser negativo.' });
        if (actual) await tx.tarifa.update({ where: { id: actual.id }, data: { vigenteHasta: dia } });
        await tx.tarifa.create({ data: { declaracionId: d.id, precioUnitario: precio, tipoNegociacion: b.tipoNegociacion ?? actual?.tipoNegociacion ?? d.cliente.tipoNegociacion, formaPago: b.formaPago ?? actual?.formaPago ?? d.cliente.formaPago, vigenteDesde: b.vigenteDesde, loteAsignacionId: lote, asignadoPorId: a.id } });
      }
      await this.audit.registrar(a, 'tarifa', lote, 'ASIGNACION_MASIVA', undefined, { cantidad: decls.length, modo: b.modo, valor: b.valor }, tx);
    });
    return { lote, actualizadas: decls.length };
  }
}

@Controller('declaraciones')
class DeclaracionesController {
  constructor(private readonly s: DeclaracionesService) {}
  @Get() listar(@ActorActual() a: Actor, @Query(new Zod(Filtros)) f: z.infer<typeof Filtros>) { return this.s.listar(a, f); }
  @Get(':id') obtener(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.obtener(a, id); }
  @Permiso('declaraciones.crear') @Post() crear(@ActorActual() a: Actor, @Body(new Zod(Crear)) b: z.infer<typeof Crear>) { return this.s.crear(a, b); }
  @Permiso('declaraciones.autorizar') @Patch(':id/estado') estado(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(CambioEstado)) b: z.infer<typeof CambioEstado>) { return this.s.cambiarEstado(a, id, b); }
  @Permiso('tarifas.asignar') @Post('tarifas/masivas') tarifas(@ActorActual() a: Actor, @Body(new Zod(Tarifas)) b: z.infer<typeof Tarifas>) { return this.s.tarifasMasivas(a, b); }
}

@Module({ controllers: [DeclaracionesController], providers: [DeclaracionesService], exports: [DeclaracionesService] })
export class DeclaracionesModule {}
