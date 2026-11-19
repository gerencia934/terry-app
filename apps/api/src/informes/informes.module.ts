import { Controller, ForbiddenException, Get, Injectable, Module, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Auditoria } from '../common/servicios';
import { ActorActual, Permiso, Zod, fechaColombia, type Actor } from '../common/http';

const id = z.string().uuid();
const Rango = z.object({
  desde: z.coerce.date(), hasta: z.coerce.date(), vehiculoId: id.optional(), conductorId: id.optional(), auxiliarId: id.optional(),
  formato: z.enum(['json', 'xlsx']).default('json'),
}).refine((f) => f.hasta >= f.desde && f.hasta.getTime() - f.desde.getTime() <= 400 * 86_400_000, { message: 'Rango inválido (máximo 400 días).' });
/** Indicadores: un rango de fechas de servicio (máximo 400 días) y, si se quiere, un cliente. */
const RangoIndicadores = z.object({ desde: z.coerce.date(), hasta: z.coerce.date(), clienteId: id.optional() })
  .refine((f) => f.hasta >= f.desde && f.hasta.getTime() - f.desde.getTime() <= 400 * 86_400_000, { message: 'Rango inválido (máximo 400 días).' });
const pct = (a: number, b: number) => (b ? Math.round((a * 10000) / b) / 100 : null);
const dia = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
class InformesService {
  constructor(private readonly db: PrismaService, private readonly audit: Auditoria) {}

  /**
   * Indicadores con datos reales, sobre las conciliaciones no anuladas (lo conciliado o, si aún no, lo cargado):
   * - toneladas: solo las líneas con métrica de masa (kg o ton, factor a kg); las demás unidades van aparte;
   * - facturado: valor de las líneas en «Cobro» y similares; comprado: las de «Compra» (aprovechables);
   * - servicios: manifiestos grabados (no anulados) por fecha de servicio.
   * Operación: inspecciones aprobadas y diferencia de báscula (planta contra lo cargado, en masa).
   */
  async indicadores(a: Actor, f: z.infer<typeof RangoIndicadores>) {
    const cliente = f.clienteId ?? null;
    const donde = Prisma.sql`c.empresa_id = ${a.empresaId}::uuid AND c.estado::text <> 'ANULADA' AND m.fecha_servicio BETWEEN ${f.desde}::date AND ${f.hasta}::date
      AND (${cliente}::uuid IS NULL OR m.cliente_id = ${cliente}::uuid)`;
    // Cantidad en kg de una línea (NULL si su métrica no es de masa) y su valor
    const kg = Prisma.sql`COALESCE(ci.cantidad_destino, ci.cantidad_origen) * COALESCE(mc.factor_a_kg, mm.factor_a_kg)`;
    const valor = Prisma.sql`round(COALESCE(ci.cantidad_destino, ci.cantidad_origen) * COALESCE(ci.precio_unitario, 0), 2)`;
    const base = Prisma.sql`FROM conciliaciones c JOIN manifiestos m ON m.id = c.manifiesto_id
      JOIN conciliacion_items ci ON ci.conciliacion_id = c.id JOIN manifiesto_items mi ON mi.id = ci.manifiesto_item_id
      LEFT JOIN metricas mc ON mc.id = ci.metrica_id LEFT JOIN metricas mm ON mm.id = mi.metrica_id`;
    type Mes = { mes: string; kg: Prisma.Decimal | null; facturado: Prisma.Decimal | null; comprado: Prisma.Decimal | null; servicios: bigint };
    type Fila = { nombre: string; kg: Prisma.Decimal | null; valor?: Prisma.Decimal | null; n?: bigint };
    type Unidad = { unidad: string; cantidad: Prisma.Decimal | null };
    const [meses, clientes, destinos, tratamientos, vehiculos, conductores, otras, bascula, inspecciones] = await Promise.all([
      this.db.$queryRaw<Mes[]>`SELECT to_char(m.fecha_servicio, 'YYYY-MM') AS mes, sum(${kg}) AS kg,
          sum(${valor}) FILTER (WHERE COALESCE(ci.tipo_negociacion::text, '') NOT IN ('COMPRA', 'SIN_COSTO', 'CONTRATO')) AS facturado,
          sum(${valor}) FILTER (WHERE ci.tipo_negociacion::text = 'COMPRA') AS comprado, count(DISTINCT m.id) AS servicios
        ${base} WHERE ${donde} GROUP BY 1 ORDER BY 1`,
      this.db.$queryRaw<Fila[]>`SELECT cl.razon_social AS nombre, sum(${kg}) AS kg,
          sum(${valor}) FILTER (WHERE COALESCE(ci.tipo_negociacion::text, '') NOT IN ('COMPRA', 'SIN_COSTO', 'CONTRATO')) AS valor
        ${base} JOIN clientes cl ON cl.id = m.cliente_id WHERE ${donde} GROUP BY 1 ORDER BY 2 DESC NULLS LAST LIMIT 10`,
      this.db.$queryRaw<Fila[]>`SELECT CASE WHEN p.es_propio THEN 'PSA Los Pinos (propio)' ELSE p.razon_social END AS nombre, sum(${kg}) AS kg
        ${base} JOIN proveedores p ON p.id = m.destino_id WHERE ${donde} GROUP BY 1 ORDER BY 2 DESC NULLS LAST`,
      this.db.$queryRaw<Fila[]>`SELECT COALESCE(d.nombre, 'Sin disposición') AS nombre, sum(${kg}) AS kg
        ${base} LEFT JOIN disposiciones d ON d.id = COALESCE(ci.disposicion_id, mi.disposicion_id) WHERE ${donde} GROUP BY 1 ORDER BY 2 DESC NULLS LAST`,
      this.db.$queryRaw<Fila[]>`SELECT COALESCE(v.placa, 'Sin vehículo (externo)') AS nombre, count(DISTINCT m.id) AS n, sum(${kg}) AS kg
        ${base} LEFT JOIN vehiculos v ON v.id = m.vehiculo_id WHERE ${donde} GROUP BY 1 ORDER BY 2 DESC`,
      this.db.$queryRaw<Fila[]>`SELECT u.nombre AS nombre, sum(${kg}) AS kg, count(DISTINCT m.id) AS n
        ${base} JOIN usuarios u ON u.id = m.conductor_id WHERE ${donde} GROUP BY 1 ORDER BY 2 DESC NULLS LAST LIMIT 10`,
      this.db.$queryRaw<Unidad[]>`SELECT COALESCE(mc.abreviacion, mm.abreviacion, 'sin unidad') AS unidad, sum(COALESCE(ci.cantidad_destino, ci.cantidad_origen)) AS cantidad
        ${base} WHERE ${donde} AND COALESCE(mc.factor_a_kg, mm.factor_a_kg) IS NULL GROUP BY 1 ORDER BY 2 DESC`,
      this.db.$queryRaw<{ cargado: Prisma.Decimal | null; conciliado: Prisma.Decimal | null }[]>`SELECT sum(ci.cantidad_origen * COALESCE(mc.factor_a_kg, mm.factor_a_kg)) AS cargado,
          sum(ci.cantidad_destino * COALESCE(mc.factor_a_kg, mm.factor_a_kg)) AS conciliado
        ${base} WHERE ${donde} AND ci.cantidad_destino IS NOT NULL`,
      this.db.preoperacional.groupBy({ by: ['aprobado'], where: { vehiculo: { empresaId: a.empresaId }, fechaProgramada: { gte: f.desde, lte: f.hasta } }, _count: true, orderBy: { aprobado: 'asc' } }),
    ]);
    const n = (v: Prisma.Decimal | bigint | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
    const t = (v: Prisma.Decimal | null | undefined) => Math.round(n(v) / 10) / 100; // kg → t con 2 decimales
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const serie = meses.map((x) => ({ mes: x.mes, toneladas: t(x.kg), facturado: r2(n(x.facturado)), comprado: r2(n(x.comprado)), servicios: n(x.servicios) }));
    const suma = (k: 'toneladas' | 'facturado' | 'comprado' | 'servicios') => r2(serie.reduce((acc, x) => acc + x[k], 0));
    const b = bascula[0];
    const insp = (v: boolean | null) => inspecciones.find((x) => x.aprobado === v)?._count ?? 0;
    return {
      desde: dia(f.desde), hasta: dia(f.hasta),
      totales: { toneladas: suma('toneladas'), facturado: suma('facturado'), comprado: suma('comprado'), servicios: suma('servicios') },
      serie,
      porCliente: clientes.map((x) => ({ nombre: x.nombre, toneladas: t(x.kg), facturado: r2(n(x.valor)) })),
      porDestino: destinos.map((x) => ({ nombre: x.nombre, toneladas: t(x.kg) })).filter((x) => x.toneladas > 0),
      porTratamiento: tratamientos.map((x) => ({ nombre: x.nombre, toneladas: t(x.kg) })).filter((x) => x.toneladas > 0),
      porVehiculo: vehiculos.map((x) => ({ nombre: x.nombre, servicios: n(x.n), toneladas: t(x.kg) })),
      porConductor: conductores.map((x) => ({ nombre: x.nombre, toneladas: t(x.kg), servicios: n(x.n) })),
      otrasUnidades: otras.map((x) => ({ unidad: x.unidad, cantidad: r2(n(x.cantidad)) })),
      operacion: {
        inspecciones: { aprobadas: insp(true), noAprobadas: insp(false), pendientes: insp(null), porcentajeAprobadas: pct(insp(true), insp(true) + insp(false)) },
        // Diferencia de báscula: (planta − cargado) / cargado, en masa; negativa = llegó menos de lo cargado
        diferenciaBascula: b && n(b.cargado) ? pct(n(b.conciliado) - n(b.cargado), n(b.cargado)) : null,
      },
    };
  }

  /**
   * Resumen de inicio. La cadena del mes cuenta líneas: solicitadas (formales, sin descartar), programadas o realizadas,
   * recolectadas (en un manifiesto realizado), pesadas en planta (conciliadas) y certificadas (en un acta emitida).
   * Las cifras de dinero y toneladas solo para quien ve informes («informes.ver»).
   */
  async inicio(a: Actor) {
    const hoy = fechaColombia();
    const diaMs = 86_400_000;
    const inicioMes = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1));
    const finMes = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + 1, 0));
    const verNegocio = a.permisos.includes('*') || a.permisos.includes('informes.ver');
    const E = a.empresaId;
    const itemsMes: Prisma.SolicitudItemWhereInput = { solicitud: { empresaId: E, clase: 'FORMAL', fechaSolicitada: { gte: inicioMes, lte: finMes } }, estado: { not: 'DESCARTADO' } };
    const conciliadasMes: Prisma.ConciliacionItemWhereInput = { conciliacion: { empresaId: E, estado: { not: 'ANULADA' }, manifiesto: { fechaServicio: { gte: inicioMes, lte: finMes } } } };
    const [solicitadas, programadas, recolectadas, pesadas, certificadas, recorridosMes, rutasHoy, manana, semana, obligaciones, negocio] = await Promise.all([
      this.db.solicitudItem.count({ where: itemsMes }),
      this.db.solicitudItem.count({ where: { ...itemsMes, estado: { in: ['PROGRAMADO', 'REALIZADO'] } } }),
      this.db.solicitudItem.count({ where: { ...itemsMes, estado: 'REALIZADO' } }),
      this.db.conciliacionItem.count({ where: { ...conciliadasMes, cantidadConciliada: { not: null } } }),
      this.db.conciliacionItem.count({ where: { ...conciliadasMes, acta: { estado: 'EMITIDA' } } }),
      this.db.ruta.count({ where: { empresaId: E, fechaProgramada: { gte: inicioMes, lte: finMes }, NOT: { estadoRecorrido: { cancela: true } } } }),
      this.db.ruta.findMany({ where: { empresaId: E, fechaProgramada: hoy }, orderBy: { codigo: 'asc' }, include: {
        vehiculo: { select: { placa: true, color: true } }, conductor: { select: { nombre: true } }, estadoRecorrido: { select: { nombre: true, color: true, orden: true, esFinal: true, cancela: true } },
        paradas: { orderBy: { orden: 'asc' }, select: { estado: true, sucursal: { select: { nombre: true, cliente: { select: { razonSocial: true } } } } } },
      } }),
      this.db.ruta.count({ where: { empresaId: E, fechaProgramada: new Date(hoy.getTime() + diaMs), NOT: { estadoRecorrido: { cancela: true } } } }),
      this.db.ruta.count({ where: { empresaId: E, fechaProgramada: { gte: new Date(hoy.getTime() + 2 * diaMs), lte: new Date(hoy.getTime() + 8 * diaMs) }, NOT: { estadoRecorrido: { cancela: true } } } }),
      this.db.obligacionPermiso.findMany({ where: { permiso: { empresaId: E }, cumplida: false, proximaFecha: { not: null } }, orderBy: { proximaFecha: 'asc' }, take: 5,
        select: { id: true, codigo: true, descripcion: true, proximaFecha: true, permiso: { select: { acto: true } } } }),
      verNegocio ? this.indicadores(a, { desde: inicioMes, hasta: finMes }) : Promise.resolve(null),
    ]);
    const etapas = await this.db.estadoRecorrido.count({ where: { empresaId: E, activo: true, cancela: false } });
    return {
      hoy: dia(hoy), mes: dia(inicioMes).slice(0, 7),
      cadena: { solicitadas, programadas, recolectadas, pesadas, certificadas },
      recorridosMes,
      negocio: negocio ? { ...negocio.totales, otrasUnidades: negocio.otrasUnidades } : null,
      rutasHoy: rutasHoy.map((r) => ({
        id: r.id, codigo: r.codigo, vehiculo: r.vehiculo, conductor: r.conductor?.nombre ?? null, etapa: r.estadoRecorrido, etapas,
        paradas: r.paradas.length, atendidas: r.paradas.filter((p) => p.estado !== 'PENDIENTE').length,
        clientes: [...new Set(r.paradas.map((p) => p.sucursal.cliente.razonSocial))].slice(0, 3),
      })),
      agenda: { hoy: rutasHoy.filter((r) => !r.estadoRecorrido?.cancela).length, manana, semana },
      obligaciones,
    };
  }

  /**
   * Lo que entró a la planta propia (Los Pinos) por tratamiento: masa (kg o toneladas), otras unidades, servicios y la
   * recepción más antigua y más reciente del rango. Solo entradas: el saldo por tratar depende de cómo se registre el
   * fin del tratamiento (pregunta abierta a la gerencia, docs/PREGUNTAS_GERENCIA.md).
   */
  async recepcionPlanta(a: Actor, f: z.infer<typeof RangoIndicadores>) {
    const cliente = f.clienteId ?? null;
    type Fila = { disposicion: string; codigo: string | null; mes: string; kg: Prisma.Decimal | null; otras: Prisma.Decimal | null; unidades: string | null; servicios: bigint; primera: Date; ultima: Date };
    const filas = await this.db.$queryRaw<Fila[]>`
      SELECT COALESCE(d.nombre, 'Sin tratamiento asignado') AS disposicion, d.codigo, to_char(m.fecha_servicio, 'YYYY-MM') AS mes,
             sum(COALESCE(ci.cantidad_destino, ci.cantidad_origen) * COALESCE(mc.factor_a_kg, mm.factor_a_kg)) AS kg,
             sum(COALESCE(ci.cantidad_destino, ci.cantidad_origen)) FILTER (WHERE COALESCE(mc.factor_a_kg, mm.factor_a_kg) IS NULL) AS otras,
             string_agg(DISTINCT COALESCE(mc.abreviacion, mm.abreviacion), ', ') FILTER (WHERE COALESCE(mc.factor_a_kg, mm.factor_a_kg) IS NULL) AS unidades,
             count(DISTINCT m.id) AS servicios, min(m.fecha_servicio) AS primera, max(m.fecha_servicio) AS ultima
        FROM conciliaciones c JOIN manifiestos m ON m.id = c.manifiesto_id JOIN proveedores p ON p.id = m.destino_id AND p.es_propio
        JOIN conciliacion_items ci ON ci.conciliacion_id = c.id JOIN manifiesto_items mi ON mi.id = ci.manifiesto_item_id
        LEFT JOIN metricas mc ON mc.id = ci.metrica_id LEFT JOIN metricas mm ON mm.id = mi.metrica_id
        LEFT JOIN disposiciones d ON d.id = COALESCE(ci.disposicion_id, mi.disposicion_id)
       WHERE c.empresa_id = ${a.empresaId}::uuid AND c.estado::text <> 'ANULADA' AND m.fecha_servicio BETWEEN ${f.desde}::date AND ${f.hasta}::date
         AND (${cliente}::uuid IS NULL OR m.cliente_id = ${cliente}::uuid)
       GROUP BY 1, 2, 3 ORDER BY 1, 3`;
    const n = (v: Prisma.Decimal | bigint | null) => (v === null ? 0 : Number(v));
    const porTratamiento = new Map<string, { tratamiento: string; codigo: string | null; toneladas: number; otras: number; unidades: Set<string>; servicios: number; primera: string; ultima: string; meses: { mes: string; toneladas: number }[] }>();
    for (const x of filas) {
      const t = porTratamiento.get(x.disposicion) ?? { tratamiento: x.disposicion, codigo: x.codigo, toneladas: 0, otras: 0, unidades: new Set<string>(), servicios: 0, primera: dia(x.primera), ultima: dia(x.ultima), meses: [] };
      t.toneladas += n(x.kg) / 1000; t.otras += n(x.otras); t.servicios += n(x.servicios);
      x.unidades?.split(', ').forEach((u) => t.unidades.add(u));
      if (dia(x.primera) < t.primera) t.primera = dia(x.primera);
      if (dia(x.ultima) > t.ultima) t.ultima = dia(x.ultima);
      t.meses.push({ mes: x.mes, toneladas: Math.round(n(x.kg) / 10) / 100 });
      porTratamiento.set(x.disposicion, t);
    }
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const tratamientos = [...porTratamiento.values()].map((t) => ({ ...t, toneladas: r2(t.toneladas), otras: r2(t.otras), unidades: [...t.unidades] }))
      .sort((x, y) => y.toneladas - x.toneladas);
    return { desde: dia(f.desde), hasta: dia(f.hasta), toneladas: r2(tratamientos.reduce((acc, t) => acc + t.toneladas, 0)), servicios: tratamientos.reduce((acc, t) => acc + t.servicios, 0), tratamientos };
  }

  private rutas(a: Actor, f: z.infer<typeof Rango>) {
    return this.db.ruta.findMany({
      where: { empresaId: a.empresaId, fechaProgramada: { gte: f.desde, lte: f.hasta }, vehiculoId: f.vehiculoId, conductorId: f.conductorId, auxiliarId: f.auxiliarId },
      orderBy: [{ fechaProgramada: 'asc' }, { codigo: 'asc' }],
      include: {
        vehiculo: { include: { proveedor: { select: { razonSocial: true, nit: true } } } }, conductor: { select: { nombre: true } }, auxiliar: { select: { nombre: true } },
        estadoRecorrido: { select: { nombre: true, cancela: true } },
        items: { select: { liberado: true, solicitudItem: { select: { estado: true } } } },
        preoperacionales: { select: { numero: true, aprobado: true } }, manifiestos: { where: { estado: { not: 'ANULADO' } }, select: { numero: true } },
      },
    });
  }

  /**
   * Rendimiento: planeados = líneas que alguna vez se asignaron a la ruta; habilitados = las que siguen asignadas;
   * ejecutados = las habilitadas que quedaron en un manifiesto grabado. % ruta = ejecutados ÷ habilitados;
   * % día y % rango suman todas las rutas del día o del rango.
   */
  async rendimiento(a: Actor, f: z.infer<typeof Rango>) {
    const rutas = await this.rutas(a, f);
    const filas = rutas.map((r) => {
      const habilitados = r.items.filter((i) => !i.liberado);
      const ejecutados = habilitados.filter((i) => i.solicitudItem.estado === 'REALIZADO').length;
      return {
        rutaId: r.id, fecha: dia(r.fechaProgramada), codigo: r.codigo, vehiculo: r.vehiculo?.placa ?? null, conductor: r.conductor?.nombre ?? null, auxiliar: r.auxiliar?.nombre ?? null,
        etapa: r.estadoRecorrido?.nombre ?? null, interna: r.interna, planeados: r.items.length, habilitados: habilitados.length, ejecutados,
        cumplimientoRuta: pct(ejecutados, habilitados.length),
        km: { inicial: r.kmInicial, final: r.kmFinal, recorridos: r.kmInicial !== null && r.kmFinal !== null ? r.kmFinal - r.kmInicial : null },
      };
    });
    const porDia = new Map<string, { h: number; e: number }>();
    filas.forEach((x) => { const d = porDia.get(x.fecha) ?? { h: 0, e: 0 }; d.h += x.habilitados; d.e += x.ejecutados; porDia.set(x.fecha, d); });
    const h = filas.reduce((s, x) => s + x.habilitados, 0), e = filas.reduce((s, x) => s + x.ejecutados, 0);
    return {
      rutas: filas.map((x) => ({ ...x, cumplimientoDia: pct(porDia.get(x.fecha)!.e, porDia.get(x.fecha)!.h) })),
      resumen: { rutas: filas.length, planeados: filas.reduce((s, x) => s + x.planeados, 0), habilitados: h, ejecutados: e, cumplimientoRango: pct(e, h),
        kmRecorridos: filas.reduce((s, x) => s + (x.km.recorridos ?? 0), 0) },
    };
  }

  /** Costos de flete por ruta (vehículos de terceros) con la inspección del día. */
  async costos(a: Actor, f: z.infer<typeof Rango>, res: Response) {
    const rutas = await this.rutas(a, f);
    const filas = rutas.map((r) => ({
      fecha: dia(r.fechaProgramada), hora: r.horaProgramada ? r.horaProgramada.toISOString().slice(11, 16) : null, codigo: r.codigo,
      placa: r.vehiculo?.placa ?? null, tipo: r.vehiculo?.tipo ?? null, marca: r.vehiculo?.marca ?? null,
      capacidadKg: r.vehiculo && r.vehiculo.unidadCap === 'KG' ? Number(r.vehiculo.capacidad) : null, volumenM3: r.vehiculo?.volumenM3 === null || !r.vehiculo ? null : Number(r.vehiculo.volumenM3),
      proveedor: r.vehiculo?.proveedor?.razonSocial ?? (r.vehiculo ? 'Propio' : null), nitProveedor: r.vehiculo?.proveedor?.nit ?? null,
      valorFlete: r.valorFlete === null ? null : Number(r.valorFlete), inspecciones: r.preoperacionales.map((p) => p.numero), manifiestos: r.manifiestos.map((m) => m.numero),
      cancelada: !!r.estadoRecorrido?.cancela,
    }));
    const total = filas.reduce((s, x) => s + (x.valorFlete ?? 0), 0);
    if (f.formato === 'json') return res.json({ rutas: filas, totalFletes: total });
    // Exportación a Excel: solo roles autorizados, y queda en la auditoría (requisitos de producción §4)
    if (!a.permisos.includes('*') && !a.permisos.includes('exportar.masivo')) throw new ForbiddenException({ mensaje: `Su rol (${a.rol}) no tiene el permiso «exportar.masivo».` });
    await this.audit.registrar(a, 'informe', 'costos-rutas', 'EXPORTAR', undefined, { desde: dia(f.desde), hasta: dia(f.hasta), rutas: filas.length });
    const wb = new ExcelJS.Workbook(); wb.creator = 'TERRY-GO · Terra Viva S.A.S. E.S.P.';
    const ws = wb.addWorksheet('Costos por ruta');
    ws.addRow([`Costos de flete por ruta · ${dia(f.desde)} a ${dia(f.hasta)}`]).font = { bold: true, size: 13 };
    ws.addRow([]);
    const enc = ws.addRow(['Fecha', 'Hora', 'Ruta', 'Placa', 'Tipo de vehículo', 'Marca', 'Capacidad (kg)', 'Volumen (m³)', 'Proveedor', 'NIT proveedor', 'Valor flete', 'Inspección', 'Manifiestos', 'Cancelada']);
    enc.font = { bold: true, color: { argb: 'FFFFFFFF' } }; enc.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E7838' } }; });
    filas.forEach((x) => ws.addRow([x.fecha, x.hora, x.codigo, x.placa, x.tipo, x.marca, x.capacidadKg, x.volumenM3, x.proveedor, x.nitProveedor, x.valorFlete, x.inspecciones.join(', '), x.manifiestos.join(', '), x.cancelada ? 'Sí' : 'No']));
    ws.addRow([]); ws.addRow(['Total fletes', '', '', '', '', '', '', '', '', '', total]).font = { bold: true };
    ws.columns.forEach((c, i) => { c.width = [11, 7, 14, 9, 18, 12, 13, 12, 28, 14, 13, 18, 22, 10][i] ?? 12; });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="costos-rutas-${dia(f.desde)}-${dia(f.hasta)}.xlsx"`);
    res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  }
}

@Controller('informes')
class InformesController {
  constructor(private readonly s: InformesService) {}
  @Permiso('informes.ver') @Get('recepcion-planta') recepcion(@ActorActual() a: Actor, @Query(new Zod(RangoIndicadores)) f: z.infer<typeof RangoIndicadores>) { return this.s.recepcionPlanta(a, f); }
  @Get('inicio') inicio(@ActorActual() a: Actor) { return this.s.inicio(a); }
  @Permiso('informes.ver') @Get('indicadores') indicadores(@ActorActual() a: Actor, @Query(new Zod(RangoIndicadores)) f: z.infer<typeof RangoIndicadores>) { return this.s.indicadores(a, f); }
  @Permiso('informes.ver') @Get('rutas/rendimiento') rendimiento(@ActorActual() a: Actor, @Query(new Zod(Rango)) f: z.infer<typeof Rango>) { return this.s.rendimiento(a, f); }
  @Permiso('informes.ver') @Get('rutas/costos') costos(@ActorActual() a: Actor, @Query(new Zod(Rango)) f: z.infer<typeof Rango>, @Res() res: Response) { return this.s.costos(a, f, res); }
}

@Module({ controllers: [InformesController], providers: [InformesService] })
export class InformesModule {}
