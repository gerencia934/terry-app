import { Body, Controller, Get, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, BadRequestException, ForbiddenException } from '@nestjs/common';
import { EstadoConciliacion, EstadoPago, FormaPago, Prisma, TipoNegociacion } from '@prisma/client';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { totalesConciliacion, valorLinea, diferenciaPct, type LineaTotal } from '@terraviva/shared';
import { PrismaService } from '../prisma/prisma.service';
import { Auditoria } from '../common/servicios';
import { ActorActual, Permiso, Zod, paginar, type Actor } from '../common/http';
import { Trabajos, type ArchivoPreparado } from '../trabajos/trabajos.module';
import { gestionaFinanzas, recalcularFinanzas, veFinanzas } from '../finanzas/estado';

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
  constructor(private readonly db: PrismaService, private readonly audit: Auditoria, private readonly trabajos: Trabajos) {
    // El Excel se prepara en la cola de trabajos, no durante la petición (requisitos de producción §1)
    this.trabajos.registrar<{ id: string }>('EXCEL_CONCILIACION', { permiso: 'exportar.masivo', preparar: (a, p) => this.excelPreparado(a, p.id) });
  }

  async encolarExcel(a: Actor, id: string) {
    const c = await this.obtener(a, id);
    return this.trabajos.encolar(a, 'EXCEL_CONCILIACION', `Conciliación del manifiesto ${c.manifiesto.numero} en Excel`, { id });
  }

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
    const ve = veFinanzas(a);
    return {
      ...c,
      // Factura y pago: solo para Comercial, Facturación y Gerencia
      items: c.items.map((l) => { const x = { ...l, valor: valorLinea(aTotal(l)), diferenciaPct: diferenciaPct(l.cantidadCargada.toString(), l.cantidadConciliada?.toString() ?? null) }; return ve ? x : { ...x, facturaNumero: undefined, facturaEmision: undefined, facturaVencimiento: undefined, estadoPago: undefined }; }),
      totales: totalesConciliacion(c.items.map(aTotal), [bascula(c.manifiesto)]),
    };
  }

  /** Edita varias líneas a la vez (grilla). La base bloquea cantidades y precios si ya está aprobada y exige justificar diferencias de más de ±2 %. */
  async editarItems(a: Actor, id: string, b: z.infer<typeof EditarItems>) {
    const conc = await this.propia(a, id);
    const tocaFactura = b.items.some((l) => l.facturaNumero !== undefined || l.facturaEmision !== undefined || l.facturaVencimiento !== undefined || l.estadoPago !== undefined);
    if (tocaFactura && !gestionaFinanzas(a)) throw new ForbiddenException({ mensaje: 'Registrar facturas y pagos le corresponde a Facturación (permiso «finanzas.gestionar»).' });
    await this.db.$transaction(async (tx) => {
      for (const { id: itemId, ...datos } of b.items) {
        const r = await tx.conciliacionItem.updateMany({ where: { id: itemId, conciliacionId: id }, data: datos });
        if (!r.count) throw new BadRequestException({ mensaje: 'Alguna línea no es de esta conciliación.' });
      }
      await this.audit.registrar(a, 'conciliacion', id, 'EDITAR', undefined, { lineas: b.items.length }, tx);
    });
    if (tocaFactura) await recalcularFinanzas(this.db, a.empresaId, [conc.manifiestoId]);
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

  /**
   * Consolidado de varias conciliaciones (por periodo y cliente), sumado en la base: no trae las conciliaciones a
   * memoria, así sirve con miles de clientes. Mismas reglas que totalesConciliacion (@terraviva/shared).
   */
  async consolidado(a: Actor, f: z.infer<typeof Filtros>) {
    const estado = f.estado ?? null, cliente = f.clienteId ?? null, desde = f.desde ?? null, hasta = f.hasta ?? null;
    const donde = Prisma.sql`c.empresa_id = ${a.empresaId}::uuid
      AND ((${estado}::text IS NULL AND c.estado::text <> 'ANULADA') OR c.estado::text = ${estado}::text)
      AND (${cliente}::uuid IS NULL OR m.cliente_id = ${cliente}::uuid)
      AND (${desde}::date IS NULL OR m.fecha_servicio >= ${desde}::date)
      AND (${hasta}::date IS NULL OR m.fecha_servicio <= ${hasta}::date)`;
    type Grupo = { cliente_id: string; unidad: string; tipo: string | null; forma: string | null; lineas: bigint; cargado: Prisma.Decimal | null; conciliado: Prisma.Decimal | null; valor: Prisma.Decimal | null; sin_conciliar: bigint };
    type PorCliente = { cliente_id: string; razon_social: string; conciliaciones: bigint; lleno: Prisma.Decimal | null; vacio: Prisma.Decimal | null; neto: Prisma.Decimal | null };
    const [grupos, clientes] = await Promise.all([
      this.db.$queryRaw<Grupo[]>`
        SELECT m.cliente_id, COALESCE(mc.abreviacion, mm.abreviacion, 'sin unidad') AS unidad, ci.tipo_negociacion::text AS tipo, ci.forma_pago::text AS forma,
               count(*) AS lineas, sum(ci.cantidad_origen) AS cargado, sum(COALESCE(ci.cantidad_destino, 0)) AS conciliado,
               sum(round(COALESCE(ci.cantidad_destino, ci.cantidad_origen) * COALESCE(ci.precio_unitario, 0), 2)) AS valor,
               count(*) FILTER (WHERE ci.cantidad_destino IS NULL OR (ci.precio_unitario IS NULL AND COALESCE(ci.tipo_negociacion::text, '') NOT IN ('SIN_COSTO', 'CONTRATO'))) AS sin_conciliar
          FROM conciliaciones c JOIN manifiestos m ON m.id = c.manifiesto_id
          JOIN conciliacion_items ci ON ci.conciliacion_id = c.id JOIN manifiesto_items mi ON mi.id = ci.manifiesto_item_id
          LEFT JOIN metricas mc ON mc.id = ci.metrica_id LEFT JOIN metricas mm ON mm.id = mi.metrica_id
         WHERE ${donde}
         GROUP BY 1, 2, 3, 4`,
      this.db.$queryRaw<PorCliente[]>`
        SELECT m.cliente_id, cl.razon_social, count(*) AS conciliaciones, sum(COALESCE(m.peso_entrada, 0)) AS lleno, sum(COALESCE(m.peso_salida, 0)) AS vacio,
               sum(COALESCE(m.peso_neto, COALESCE(m.peso_entrada, 0) - COALESCE(m.peso_salida, 0))) AS neto
          FROM conciliaciones c JOIN manifiestos m ON m.id = c.manifiesto_id JOIN clientes cl ON cl.id = m.cliente_id
         WHERE ${donde}
         GROUP BY 1, 2`,
    ]);
    const n = (v: Prisma.Decimal | bigint | null) => (v === null ? 0 : Number(v));
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const SIN_VALOR = new Set(['SIN_COSTO', 'CONTRATO']);
    const totales = (gs: Grupo[], b: PorCliente[]) => {
      const unidades = new Map<string, { cargado: number; conciliado: number }>();
      let cobro = 0, compra = 0, contado = 0, credito = 0, lineas = 0, sinConciliar = 0;
      for (const g of gs) {
        const u = unidades.get(g.unidad) ?? { cargado: 0, conciliado: 0 };
        u.cargado += n(g.cargado); u.conciliado += n(g.conciliado); unidades.set(g.unidad, u);
        lineas += n(g.lineas); sinConciliar += n(g.sin_conciliar);
        const valor = n(g.valor);
        if (g.tipo === 'COMPRA') compra += valor; else if (!SIN_VALOR.has(g.tipo ?? '')) cobro += valor;
        if (!SIN_VALOR.has(g.tipo ?? '')) { if (!g.forma || g.forma === 'CONTADO') contado += valor; else credito += valor; }
      }
      return {
        lineas, sinConciliar,
        porUnidad: [...unidades.entries()].map(([unidad, v]) => ({ unidad, cargado: r2(v.cargado), conciliado: r2(v.conciliado), diferencia: r2(v.conciliado - v.cargado) })),
        cobro: r2(cobro), compra: r2(compra), contado: r2(contado), credito: r2(credito), neto: r2(cobro - compra),
        bascula: { lleno: r2(b.reduce((x, y) => x + n(y.lleno), 0)), vacio: r2(b.reduce((x, y) => x + n(y.vacio), 0)), neto: r2(b.reduce((x, y) => x + n(y.neto), 0)) },
      };
    };
    return {
      conciliaciones: clientes.reduce((x, c) => x + n(c.conciliaciones), 0), totales: totales(grupos, clientes),
      clientes: clientes.map((c) => ({ clienteId: c.cliente_id, cliente: c.razon_social, conciliaciones: n(c.conciliaciones),
        totales: totales(grupos.filter((g) => g.cliente_id === c.cliente_id), [c]) })).sort((x, y) => y.totales.neto - x.totales.neto),
    };
  }

  private async excelPreparado(a: Actor, id: string): Promise<ArchivoPreparado> {
    const c = await this.obtener(a, id);
    const wb = new ExcelJS.Workbook(); wb.creator = 'TERRY-GO · Terra Viva S.A.S. E.S.P.';
    const ws = wb.addWorksheet('Conciliación');
    ws.addRow([`Conciliación del manifiesto ${c.manifiesto.numero} · ${c.manifiesto.cliente.razonSocial} (NIT ${c.manifiesto.cliente.nit})`]).font = { bold: true, size: 13 };
    ws.addRow([`Fecha de servicio: ${c.manifiesto.fechaServicio.toISOString().slice(0, 10)} · Estado: ${c.estado}`]);
    ws.addRow([]);
    const ve = veFinanzas(a);
    const columnas = ['Generador', 'Residuo / servicio', 'Cant. cargada', 'Cant. conciliada', 'Unidad', 'Dif. %', 'Precio unitario', 'Valor', 'Negociación', 'Forma de pago', 'Disposición', 'Orden de compra', 'Factura', 'Emisión', 'Vencimiento', 'Estado de pago', 'Justificación'];
    const QUITAR = new Set([12, 13, 14, 15]); // factura, emisión, vencimiento y estado de pago
    const filtra = <T,>(xs: T[]) => (ve ? xs : xs.filter((_, i) => !QUITAR.has(i)));
    const h = ws.addRow(filtra(columnas));
    h.font = { bold: true, color: { argb: 'FFFFFFFF' } }; h.eachCell((x) => { x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E7838' } }; });
    for (const l of c.items) ws.addRow(filtra([
      l.manifiestoItem.sucursal.nombre, l.manifiestoItem.declaracion.nombre, Number(l.cantidadCargada), l.cantidadConciliada === null ? null : Number(l.cantidadConciliada),
      l.metrica?.abreviacion ?? l.manifiestoItem.metrica?.abreviacion ?? '', l.diferenciaPct, l.precioUnitario === null ? null : Number(l.precioUnitario), l.valor,
      l.tipoNegociacion ?? '', l.formaPago ?? '', l.disposicion?.nombre ?? '', l.ordenCompra ?? '', l.facturaNumero ?? '',
      ve ? l.facturaEmision?.toISOString().slice(0, 10) ?? '' : '', ve ? l.facturaVencimiento?.toISOString().slice(0, 10) ?? '' : '', ve ? l.estadoPago ?? '' : '', l.justificacion ?? '',
    ]));
    ws.addRow([]);
    const t = c.totales;
    for (const u of t.porUnidad) ws.addRow([`Total ${u.unidad}`, '', u.cargado, u.conciliado]);
    ws.addRow(['Total cobro', '', '', '', '', '', '', t.cobro]); ws.addRow(['Total compra', '', '', '', '', '', '', t.compra]);
    ws.addRow(['Contado', '', '', '', '', '', '', t.contado]); ws.addRow(['Crédito', '', '', '', '', '', '', t.credito]); ws.addRow(['Neto (cobro − compra)', '', '', '', '', '', '', t.neto]);
    ws.addRow(['Báscula: lleno / vacío / neto (kg)', '', t.bascula.lleno, t.bascula.vacio, t.bascula.neto]);
    ws.columns.forEach((col, i) => { col.width = [24, 32, 12, 14, 8, 8, 14, 14, 12, 14, 28, 14, 12, 12, 12, 12, 30][i] ?? 12; });
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    await this.audit.registrar(a, 'conciliacion', id, 'EXPORTAR', undefined, { formato: 'xlsx' });
    return { buf, nombre: `conciliacion-${c.manifiesto.numero}.xlsx`, ext: 'xlsx' };
  }
}

@Controller('conciliaciones')
class ConciliacionesController {
  constructor(private readonly s: ConciliacionesService) {}
  @Get() listar(@ActorActual() a: Actor, @Query(new Zod(Filtros)) f: z.infer<typeof Filtros>) { return this.s.listar(a, f); }
  @Get('consolidado') consolidado(@ActorActual() a: Actor, @Query(new Zod(Filtros)) f: z.infer<typeof Filtros>) { return this.s.consolidado(a, f); }
  @Get(':id') obtener(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.obtener(a, id); }
  @Permiso('exportar.masivo') @Post(':id/excel') @HttpCode(202) excel(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.encolarExcel(a, id); }
  @Permiso('conciliaciones.gestionar') @Patch(':id/items') editar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(EditarItems)) b: z.infer<typeof EditarItems>) { return this.s.editarItems(a, id, b); }
  @Permiso('conciliaciones.gestionar') @Post(':id/igualar') igualar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Igualar)) b: z.infer<typeof Igualar>) { return this.s.igualar(a, id, b); }
  @Permiso('conciliaciones.aprobar') @Post(':id/aprobar') aprobar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.cambiarEstado(a, id, 'APROBADA'); }
  @Permiso('conciliaciones.aprobar') @Post(':id/reabrir') reabrir(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.cambiarEstado(a, id, 'BORRADOR'); }
}

@Module({ controllers: [ConciliacionesController], providers: [ConciliacionesService] })
export class ConciliacionesModule {}
