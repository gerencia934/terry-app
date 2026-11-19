import { Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Res, BadRequestException } from '@nestjs/common';
import { EstadoConciliacion, EstadoPago, FormaPago, Prisma, TipoNegociacion } from '@prisma/client';
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { totalesConciliacion, valorLinea, diferenciaPct, type LineaTotal } from '@terraviva/shared';
import { PrismaService } from '../prisma/prisma.service';
import { Auditoria } from '../common/servicios';
import { ActorActual, Permiso, Zod, paginar, type Actor } from '../common/http';

const id = z.string().uuid();
const dosDecimales = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
const Filtros = z.object({
  desde: z.coerce.date().optional(), hasta: z.coerce.date().optional(), clienteId: id.optional(), estado: z.nativeEnum(EstadoConciliacion).optional(),
  manifiesto: z.string().max(20).optional(), asesorId: id.optional(), pagina: z.coerce.number().optional(), porPagina: z.coerce.number().optional(),
});
const EditarItems = z.object({ items: z.array(z.object({
  id,
  cantidadConciliada: z.number().nonnegative().refine(dosDecimales, 'Máximo 2 decimales.').nullish(), metricaId: id.nullish(),
  precioUnitario: z.number().nonnegative().refine(dosDecimales, 'Máximo 2 decimales.').nullish(),
  tipoNegociacion: z.nativeEnum(TipoNegociacion).nullish(), formaPago: z.nativeEnum(FormaPago).nullish(), disposicionId: id.nullish(),
  ordenCompra: z.string().trim().max(40).nullish(), justificacion: z.string().trim().max(500).nullish(),
  facturaNumero: z.string().trim().max(30).nullish(), facturaEmision: z.coerce.date().nullish(), facturaVencimiento: z.coerce.date().nullish(),
  estadoPago: z.nativeEnum(EstadoPago).optional(),
})).min(1).max(500) });
const Igualar = z.object({ todas: z.boolean().default(false) }); // false = solo las líneas aún sin cantidad conciliada

const lineas = {
  orderBy: { id: 'asc' as const },
  include: {
    metrica: { select: { id: true, abreviacion: true } }, disposicion: { select: { id: true, codigo: true, nombre: true } }, acta: { select: { id: true, numero: true, estado: true } },
    manifiestoItem: { select: { id: true, cantidad: true, metrica: { select: { abreviacion: true } },
      declaracion: { select: { id: true, nombre: true, codigoInterno: true, tipo: true } }, sucursal: { select: { id: true, codigo: true, nombre: true, direccion: true } } } },
  },
} satisfies Prisma.Conciliacion$itemsArgs;

type LineaDb = Prisma.ConciliacionItemGetPayload<{ include: typeof lineas.include }>;
type ConPesos = { pesoEntrada: Prisma.Decimal | null; pesoSalida: Prisma.Decimal | null; pesoNeto: Prisma.Decimal | null };
const bascula = (m: ConPesos) => ({ pesoEntrada: m.pesoEntrada?.toString() ?? null, pesoSalida: m.pesoSalida?.toString() ?? null, pesoNeto: m.pesoNeto?.toString() ?? null });
const aTotal = (l: LineaDb): LineaTotal => ({
  cantidadCargada: l.cantidadCargada.toString(), cantidadConciliada: l.cantidadConciliada?.toString() ?? null, precioUnitario: l.precioUnitario?.toString() ?? null,
  unidad: l.metrica?.abreviacion ?? l.manifiestoItem.metrica?.abreviacion ?? null, tipoNegociacion: l.tipoNegociacion, formaPago: l.formaPago,
});

@Injectable()
class ConciliacionesService {
  constructor(private readonly db: PrismaService, private readonly audit: Auditoria) {}

  private async propia(a: Actor, id: string) {
    const c = await this.db.conciliacion.findFirst({ where: { id, empresaId: a.empresaId } });
    if (!c) throw new NotFoundException({ mensaje: 'Conciliación no encontrada.' });
    return c;
  }

  async listar(a: Actor, f: z.infer<typeof Filtros>) {
    const { take, skip, pagina, porPagina } = paginar(f);
    const where: Prisma.ConciliacionWhereInput = {
      empresaId: a.empresaId, estado: f.estado,
      manifiesto: {
        clienteId: f.clienteId, numero: f.manifiesto ? { contains: f.manifiesto, mode: 'insensitive' } : undefined,
        fechaServicio: f.desde || f.hasta ? { gte: f.desde, lte: f.hasta } : undefined, cliente: f.asesorId ? { asesorId: f.asesorId } : undefined,
      },
    };
    const [total, filas] = await this.db.$transaction([
      this.db.conciliacion.count({ where }),
      this.db.conciliacion.findMany({ where, take, skip, orderBy: { createdAt: 'desc' }, include: {
        manifiesto: { select: { id: true, numero: true, tipo: true, fechaServicio: true, tipoConciliacion: true, pesoEntrada: true, pesoSalida: true, pesoNeto: true,
          cliente: { select: { id: true, razonSocial: true, nit: true, camposExtra: true, asesor: { select: { nombre: true } } } }, destino: { select: { razonSocial: true } },
          items: { select: { sucursal: { select: { nombre: true, direccion: true } }, solicitudItem: { select: { solicitud: { select: { numero: true } } } } } } } },
        items: lineas,
      } }),
    ]);
    return { total, pagina, porPagina, filas: filas.map(({ items, manifiesto: { items: mItems, ...m }, ...c }) => ({
      ...c, manifiesto: { ...m, sedes: [...new Set(mItems.map((i) => i.sucursal.nombre))], solicitudes: [...new Set(mItems.map((i) => i.solicitudItem?.solicitud.numero).filter(Boolean))] },
      totales: totalesConciliacion(items.map(aTotal), [bascula(m)]),
    })) };
  }

  async obtener(a: Actor, id: string) {
    const c = await this.db.conciliacion.findFirst({ where: { id, empresaId: a.empresaId }, include: {
      aprobadaPor: { select: { nombre: true } },
      manifiesto: { select: { id: true, numero: true, tipo: true, fechaServicio: true, tipoConciliacion: true, ordenCompra: true, pesoEntrada: true, pesoSalida: true, pesoNeto: true,
        cliente: { select: { id: true, razonSocial: true, nit: true, asesor: { select: { nombre: true } } } } } },
      items: lineas,
    } });
    if (!c) throw new NotFoundException({ mensaje: 'Conciliación no encontrada.' });
    return {
      ...c,
      items: c.items.map((l) => ({ ...l, valor: valorLinea(aTotal(l)), diferenciaPct: diferenciaPct(l.cantidadCargada.toString(), l.cantidadConciliada?.toString() ?? null) })),
      totales: totalesConciliacion(c.items.map(aTotal), [bascula(c.manifiesto)]),
    };
  }

  /** Edita varias líneas a la vez (grilla). La base bloquea cantidades y precios si ya está aprobada y exige justificar diferencias de más de ±2 %. */
  async editarItems(a: Actor, id: string, b: z.infer<typeof EditarItems>) {
    await this.propia(a, id);
    await this.db.$transaction(async (tx) => {
      for (const { id: itemId, ...datos } of b.items) {
        const r = await tx.conciliacionItem.updateMany({ where: { id: itemId, conciliacionId: id }, data: datos });
        if (!r.count) throw new BadRequestException({ mensaje: 'Alguna línea no es de esta conciliación.' });
      }
      await this.audit.registrar(a, 'conciliacion', id, 'EDITAR', undefined, { lineas: b.items.length }, tx);
    });
    return this.obtener(a, id);
  }

  /** «Igualar cantidades»: la cantidad conciliada toma el valor de la cargada. */
  async igualar(a: Actor, id: string, b: z.infer<typeof Igualar>) {
    await this.propia(a, id);
    const n = await this.db.$executeRaw`UPDATE conciliacion_items SET cantidad_destino = cantidad_origen
      WHERE conciliacion_id = ${id}::uuid AND (cantidad_destino IS NULL OR ${b.todas})`;
    await this.audit.registrar(a, 'conciliacion', id, 'IGUALAR', undefined, { lineas: n, todas: b.todas });
    return this.obtener(a, id);
  }

  async cambiarEstado(a: Actor, id: string, estado: EstadoConciliacion) {
    const c = await this.propia(a, id);
    if (c.estado === 'ANULADA') throw new BadRequestException({ mensaje: 'La conciliación está anulada: se anuló su manifiesto.' });
    if (c.estado === estado) throw new BadRequestException({ mensaje: estado === 'APROBADA' ? 'La conciliación ya está aprobada.' : 'La conciliación ya está en borrador.' });
    await this.db.conciliacion.update({ where: { id }, data: { estado, aprobadaPorId: estado === 'APROBADA' ? a.id : null } });
    await this.audit.registrar(a, 'conciliacion', id, estado === 'APROBADA' ? 'APROBAR' : 'REABRIR', { estado: c.estado }, { estado });
    return this.obtener(a, id);
  }

  /** Consolidado de varias conciliaciones (por periodo y cliente). */
  async consolidado(a: Actor, f: z.infer<typeof Filtros>) {
    const cs = await this.db.conciliacion.findMany({
      where: { empresaId: a.empresaId, estado: f.estado ?? { not: 'ANULADA' }, manifiesto: { clienteId: f.clienteId, fechaServicio: f.desde || f.hasta ? { gte: f.desde, lte: f.hasta } : undefined } },
      include: { manifiesto: { select: { pesoEntrada: true, pesoSalida: true, pesoNeto: true, cliente: { select: { id: true, razonSocial: true } } } }, items: lineas },
      take: 5000,
    });
    const porCliente = new Map<string, { cliente: string; conciliaciones: typeof cs }>();
    for (const c of cs) {
      const k = c.manifiesto.cliente.id;
      const g = porCliente.get(k) ?? { cliente: c.manifiesto.cliente.razonSocial, conciliaciones: [] };
      g.conciliaciones.push(c); porCliente.set(k, g);
    }
    const tot = (xs: typeof cs) => totalesConciliacion(xs.flatMap((c) => c.items.map(aTotal)), xs.map((c) => bascula(c.manifiesto)));
    return {
      conciliaciones: cs.length, totales: tot(cs),
      clientes: [...porCliente.entries()].map(([clienteId, g]) => ({ clienteId, cliente: g.cliente, conciliaciones: g.conciliaciones.length, totales: tot(g.conciliaciones) }))
        .sort((x, y) => y.totales.neto - x.totales.neto),
    };
  }

  async excel(a: Actor, id: string, res: Response) {
    const c = await this.obtener(a, id);
    const wb = new ExcelJS.Workbook(); wb.creator = 'TERRY-GO · Terra Viva S.A.S. E.S.P.';
    const ws = wb.addWorksheet('Conciliación');
    ws.addRow([`Conciliación del manifiesto ${c.manifiesto.numero} · ${c.manifiesto.cliente.razonSocial} (NIT ${c.manifiesto.cliente.nit})`]).font = { bold: true, size: 13 };
    ws.addRow([`Fecha de servicio: ${c.manifiesto.fechaServicio.toISOString().slice(0, 10)} · Estado: ${c.estado}`]);
    ws.addRow([]);
    const h = ws.addRow(['Generador', 'Residuo / servicio', 'Cant. cargada', 'Cant. conciliada', 'Unidad', 'Dif. %', 'Precio unitario', 'Valor', 'Negociación', 'Forma de pago', 'Disposición', 'Orden de compra', 'Factura', 'Emisión', 'Vencimiento', 'Estado de pago', 'Justificación']);
    h.font = { bold: true, color: { argb: 'FFFFFFFF' } }; h.eachCell((x) => { x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E7838' } }; });
    for (const l of c.items) ws.addRow([
      l.manifiestoItem.sucursal.nombre, l.manifiestoItem.declaracion.nombre, Number(l.cantidadCargada), l.cantidadConciliada === null ? null : Number(l.cantidadConciliada),
      l.metrica?.abreviacion ?? l.manifiestoItem.metrica?.abreviacion ?? '', l.diferenciaPct, l.precioUnitario === null ? null : Number(l.precioUnitario), l.valor,
      l.tipoNegociacion ?? '', l.formaPago ?? '', l.disposicion?.nombre ?? '', l.ordenCompra ?? '', l.facturaNumero ?? '',
      l.facturaEmision?.toISOString().slice(0, 10) ?? '', l.facturaVencimiento?.toISOString().slice(0, 10) ?? '', l.estadoPago, l.justificacion ?? '',
    ]);
    ws.addRow([]);
    const t = c.totales;
    for (const u of t.porUnidad) ws.addRow([`Total ${u.unidad}`, '', u.cargado, u.conciliado]);
    ws.addRow(['Total cobro', '', '', '', '', '', '', t.cobro]); ws.addRow(['Total compra', '', '', '', '', '', '', t.compra]);
    ws.addRow(['Contado', '', '', '', '', '', '', t.contado]); ws.addRow(['Crédito', '', '', '', '', '', '', t.credito]); ws.addRow(['Neto (cobro − compra)', '', '', '', '', '', '', t.neto]);
    ws.addRow(['Báscula: lleno / vacío / neto (kg)', '', t.bascula.lleno, t.bascula.vacio, t.bascula.neto]);
    ws.columns.forEach((col, i) => { col.width = [24, 32, 12, 14, 8, 8, 14, 14, 12, 14, 28, 14, 12, 12, 12, 12, 30][i] ?? 12; });
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="conciliacion-${c.manifiesto.numero}.xlsx"`);
    res.send(buf);
  }
}

@Controller('conciliaciones')
class ConciliacionesController {
  constructor(private readonly s: ConciliacionesService) {}
  @Get() listar(@ActorActual() a: Actor, @Query(new Zod(Filtros)) f: z.infer<typeof Filtros>) { return this.s.listar(a, f); }
  @Get('consolidado') consolidado(@ActorActual() a: Actor, @Query(new Zod(Filtros)) f: z.infer<typeof Filtros>) { return this.s.consolidado(a, f); }
  @Get(':id') obtener(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.obtener(a, id); }
  @Get(':id/excel') excel(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) { return this.s.excel(a, id, res); }
  @Permiso('conciliaciones.gestionar') @Patch(':id/items') editar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(EditarItems)) b: z.infer<typeof EditarItems>) { return this.s.editarItems(a, id, b); }
  @Permiso('conciliaciones.gestionar') @Post(':id/igualar') igualar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Igualar)) b: z.infer<typeof Igualar>) { return this.s.igualar(a, id, b); }
  @Permiso('conciliaciones.aprobar') @Post(':id/aprobar') aprobar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.cambiarEstado(a, id, 'APROBADA'); }
  @Permiso('conciliaciones.aprobar') @Post(':id/reabrir') reabrir(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.cambiarEstado(a, id, 'BORRADOR'); }
}

@Module({ controllers: [ConciliacionesController], providers: [ConciliacionesService] })
export class ConciliacionesModule {}
