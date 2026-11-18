import { Body, Controller, Get, Module, NotFoundException, Param, ParseUUIDPipe, Post, Query, Injectable } from '@nestjs/common';
import { FormaPago, TipoNegociacion } from '@prisma/client';
import { z } from 'zod';
import { dvNit } from '@terraviva/shared';
import { PrismaService } from '../prisma/prisma.service';
import { Auditoria } from '../common/servicios';
import { ActorActual, Permiso, Zod, paginar, type Actor } from '../common/http';

const Filtros = z.object({ q: z.string().optional(), pagina: z.coerce.number().optional(), porPagina: z.coerce.number().optional() });
const Crear = z.object({
  nit: z.string().regex(/^\d{6,10}$/, 'NIT sin puntos ni DV (6 a 10 dígitos)'), razonSocial: z.string().min(2).max(200), sector: z.string().max(60).optional(),
  tipoNegociacion: z.nativeEnum(TipoNegociacion).default('COBRO'), formaPago: z.nativeEnum(FormaPago).default('CONTADO'), emailFacturacion: z.string().email().optional(),
});
const CrearSucursal = z.object({
  nombre: z.string().min(2).max(150), direccion: z.string().max(250).optional(), municipioDane: z.string().length(5).optional(), zonaId: z.string().uuid().optional(),
  latitud: z.number().min(-5).max(14).optional(), longitud: z.number().min(-82).max(-66).optional(), registroRespel: z.string().max(50).optional(),
  contacto: z.string().max(150).optional(), telefono: z.string().max(20).optional(), horario: z.string().max(100).optional(),
});

@Injectable()
class ClientesService {
  constructor(private readonly db: PrismaService, private readonly audit: Auditoria) {}
  async listar(a: Actor, f: z.infer<typeof Filtros>) {
    const { take, skip, pagina, porPagina } = paginar(f);
    const where = { empresaId: a.empresaId, ...(f.q ? { OR: [{ razonSocial: { contains: f.q, mode: 'insensitive' as const } }, { nit: { contains: f.q } }] } : {}) };
    const [total, filas] = await this.db.$transaction([
      this.db.cliente.count({ where }),
      this.db.cliente.findMany({ where, take, skip, orderBy: { razonSocial: 'asc' }, include: { sucursales: { select: { id: true, nombre: true, zona: { select: { nombre: true, color: true } } } } } }),
    ]);
    return { total, pagina, porPagina, filas };
  }
  async obtener(a: Actor, id: string) {
    const c = await this.db.cliente.findFirst({ where: { id, empresaId: a.empresaId }, include: { sucursales: { include: { zona: true } } } });
    if (!c) throw new NotFoundException({ mensaje: 'Cliente no encontrado.' });
    return c;
  }
  async crear(a: Actor, b: z.infer<typeof Crear>) {
    const c = await this.db.cliente.create({ data: { ...b, empresaId: a.empresaId, dv: dvNit(b.nit) } });
    await this.audit.registrar(a, 'cliente', c.id, 'CREAR', undefined, c);
    return c;
  }
  async crearSucursal(a: Actor, clienteId: string, b: z.infer<typeof CrearSucursal>) {
    await this.obtener(a, clienteId);
    const s = await this.db.sucursal.create({ data: { ...b, clienteId } });
    await this.audit.registrar(a, 'sucursal', s.id, 'CREAR', undefined, s);
    return s;
  }
}

@Controller('clientes')
class ClientesController {
  constructor(private readonly s: ClientesService) {}
  @Get() listar(@ActorActual() a: Actor, @Query(new Zod(Filtros)) f: z.infer<typeof Filtros>) { return this.s.listar(a, f); }
  @Get(':id') obtener(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.obtener(a, id); }
  @Permiso('clientes.editar') @Post() crear(@ActorActual() a: Actor, @Body(new Zod(Crear)) b: z.infer<typeof Crear>) { return this.s.crear(a, b); }
  @Permiso('clientes.editar') @Post(':id/sucursales') sucursal(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(CrearSucursal)) b: z.infer<typeof CrearSucursal>) { return this.s.crearSucursal(a, id, b); }
}

@Module({ controllers: [ClientesController], providers: [ClientesService] })
export class ClientesModule {}
