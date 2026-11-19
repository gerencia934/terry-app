import { Controller, ForbiddenException, Get, Injectable, Module, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { Auditoria } from '../common/servicios';
import { ActorActual, Permiso, Zod, type Actor } from '../common/http';

const id = z.string().uuid();
const Rango = z.object({
  desde: z.coerce.date(), hasta: z.coerce.date(), vehiculoId: id.optional(), conductorId: id.optional(), auxiliarId: id.optional(),
  formato: z.enum(['json', 'xlsx']).default('json'),
}).refine((f) => f.hasta >= f.desde && f.hasta.getTime() - f.desde.getTime() <= 400 * 86_400_000, { message: 'Rango inválido (máximo 400 días).' });
const pct = (a: number, b: number) => (b ? Math.round((a * 10000) / b) / 100 : null);
const dia = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
class InformesService {
  constructor(private readonly db: PrismaService, private readonly audit: Auditoria) {}

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
  @Permiso('informes.ver') @Get('rutas/rendimiento') rendimiento(@ActorActual() a: Actor, @Query(new Zod(Rango)) f: z.infer<typeof Rango>) { return this.s.rendimiento(a, f); }
  @Permiso('informes.ver') @Get('rutas/costos') costos(@ActorActual() a: Actor, @Query(new Zod(Rango)) f: z.infer<typeof Rango>, @Res() res: Response) { return this.s.costos(a, f, res); }
}

@Module({ controllers: [InformesController], providers: [InformesService] })
export class InformesModule {}
