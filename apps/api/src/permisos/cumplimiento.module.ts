import { Controller, Get, Injectable, Module, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { Auditoria } from '../common/servicios';
import { ActorActual, Permiso, Publico, Zod, type Actor } from '../common/http';

const dias = (f: Date) => Math.ceil((f.getTime() - Date.now()) / 86_400_000);
export interface Alerta { tipo: 'cumplimiento' | 'flota' | 'personal' | 'operacion'; nivel: 'alta' | 'media' | 'info'; titulo: string; detalle: string; fecha?: string; referencia?: string }

@Injectable()
class CumplimientoService {
  constructor(private readonly db: PrismaService, private readonly audit: Auditoria) {}

  permisos(a: Actor) {
    return this.db.permisoAmbiental.findMany({ where: { empresaId: a.empresaId }, orderBy: { acto: 'asc' }, include: { obligaciones: { orderBy: { proximaFecha: 'asc' } } } });
  }

  async cumplirObligacion(a: Actor, id: string) {
    const o = await this.db.obligacionPermiso.findFirstOrThrow({ where: { id, permiso: { empresaId: a.empresaId } } });
    const meses: Record<string, number> = { mensual: 1, trimestral: 3, semestral: 6, anual: 12 };
    const m = meses[o.periodicidad.toLowerCase()];
    const siguiente = m ? new Date(o.proximaFecha.getFullYear(), o.proximaFecha.getMonth() + m, o.proximaFecha.getDate()) : null;
    const r = await this.db.obligacionPermiso.update({ where: { id }, data: siguiente ? { proximaFecha: siguiente, cumplida: false } : { cumplida: true } });
    await this.audit.registrar(a, 'obligacion', id, 'CUMPLIDA', { fecha: o.proximaFecha }, { siguiente });
    return r;
  }

  /** Reglas de alerta. En producción las ejecuta también una tarea diaria que envía el resumen por correo. */
  async alertas(a: Actor): Promise<Alerta[]> {
    const lim30 = new Date(Date.now() + 30 * 86_400_000), lim45 = new Date(Date.now() + 45 * 86_400_000);
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0); const manana = new Date(hoy.getTime() + 86_400_000);
    const [obl, veh, per, pend, rutasHoy, preops] = await Promise.all([
      this.db.obligacionPermiso.findMany({ where: { cumplida: false, proximaFecha: { lte: lim30 }, permiso: { empresaId: a.empresaId } }, include: { permiso: true } }),
      this.db.vehiculo.findMany({ where: { empresaId: a.empresaId, activo: true, OR: [{ soatVence: { lte: lim30 } }, { rtmVence: { lte: lim30 } }, { polizaRcVence: { lte: lim30 } }] } }),
      this.db.usuario.findMany({ where: { empresaId: a.empresaId, activo: true, esConductor: true, OR: [{ licenciaVence: { lte: lim45 } }, { cursoMpVence: { lte: lim45 } }] } }),
      this.db.declaracion.count({ where: { empresaId: a.empresaId, estado: 'PENDIENTE' } }),
      this.db.ruta.findMany({ where: { empresaId: a.empresaId, fechaProgramada: { gte: hoy, lt: manana } }, include: { vehiculo: { select: { id: true, placa: true } } } }),
      this.db.preoperacional.findMany({ where: { fechaProgramada: { gte: hoy, lt: manana }, vehiculo: { empresaId: a.empresaId } }, select: { vehiculoId: true, aprobado: true } }),
    ]);
    const out: Alerta[] = [];
    const nivel = (d: number, alto = 15) => (d <= alto ? 'alta' : 'media') as Alerta['nivel'];
    obl.forEach((o) => out.push({ tipo: 'cumplimiento', nivel: nivel(dias(o.proximaFecha)), titulo: `${o.permiso.acto}: obligación en ${dias(o.proximaFecha)} días`, detalle: o.descripcion, fecha: o.proximaFecha.toISOString().slice(0, 10), referencia: o.id }));
    veh.forEach((v) => ([['SOAT', v.soatVence], ['Revisión técnico-mecánica', v.rtmVence], ['Póliza RC', v.polizaRcVence]] as const).forEach(([doc, f]) => {
      if (f && f <= lim30) out.push({ tipo: 'flota', nivel: nivel(dias(f)), titulo: `${v.placa}: ${doc} vence en ${dias(f)} días`, detalle: v.tipo, fecha: f.toISOString().slice(0, 10), referencia: v.id });
    }));
    per.forEach((u) => ([['Licencia de conducción', u.licenciaVence], ['Curso de mercancías peligrosas', u.cursoMpVence]] as const).forEach(([doc, f]) => {
      if (f && f <= lim45) out.push({ tipo: 'personal', nivel: nivel(dias(f)), titulo: `${u.nombre}: ${doc.toLowerCase()} vence en ${dias(f)} días`, detalle: 'Res. 1223 de 2014', fecha: f.toISOString().slice(0, 10), referencia: u.id });
    }));
    rutasHoy.filter((r) => !preops.some((p) => p.vehiculoId === r.vehiculo.id && p.aprobado)).forEach((r) =>
      out.push({ tipo: 'operacion', nivel: 'media', titulo: `Ruta ${r.codigo} (${r.vehiculo.placa}) sin preoperacional aprobado`, detalle: 'No puede salir hasta aprobar la inspección', referencia: r.id }));
    if (pend) out.push({ tipo: 'operacion', nivel: 'info', titulo: `${pend} declaraciones por autorizar`, detalle: 'Revisar ficha de caracterización y cobertura de permisos' });
    const orden = { alta: 0, media: 1, info: 2 };
    return out.sort((x, y) => orden[x.nivel] - orden[y.nivel]);
  }

  catalogo(a: Actor, tipo?: string) {
    return this.db.catalogoItem.findMany({ where: { empresaId: a.empresaId, tipo: tipo?.toUpperCase(), activo: true }, orderBy: [{ tipo: 'asc' }, { nombre: 'asc' }] });
  }
  residuos(a: Actor) {
    return this.db.catalogoResiduo.findMany({ where: { empresaId: a.empresaId }, orderBy: { codigo: 'asc' }, include: { lineaServicio: { select: { nombre: true } }, tipoManejo: { select: { nombre: true } } } });
  }
  vehiculos(a: Actor) { return this.db.vehiculo.findMany({ where: { empresaId: a.empresaId }, orderBy: { placa: 'asc' } }); }
  estadosRecorrido(a: Actor) { return this.db.estadoRecorrido.findMany({ where: { empresaId: a.empresaId }, orderBy: { orden: 'asc' } }); }
  elementosChequeo(a: Actor) { return this.db.elementoChequeo.findMany({ where: { empresaId: a.empresaId, activo: true }, orderBy: [{ grupo: 'asc' }, { nombre: 'asc' }] }); }
}

@Controller()
class CumplimientoController {
  constructor(private readonly s: CumplimientoService, private readonly db: PrismaService) {}
  @Get('permisos-ambientales') permisos(@ActorActual() a: Actor) { return this.s.permisos(a); }
  @Permiso('permisos.gestionar') @Patch('obligaciones/:id/cumplida') cumplir(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.cumplirObligacion(a, id); }
  @Get('alertas') alertas(@ActorActual() a: Actor) { return this.s.alertas(a); }
  @Get('catalogos') catalogo(@ActorActual() a: Actor, @Query(new Zod(z.object({ tipo: z.string().optional() }))) q: { tipo?: string }) { return this.s.catalogo(a, q.tipo); }
  @Get('catalogos/residuos') residuos(@ActorActual() a: Actor) { return this.s.residuos(a); }
  @Get('vehiculos') vehiculos(@ActorActual() a: Actor) { return this.s.vehiculos(a); }
  @Get('estados-recorrido') estados(@ActorActual() a: Actor) { return this.s.estadosRecorrido(a); }
  @Get('elementos-chequeo') elementos(@ActorActual() a: Actor) { return this.s.elementosChequeo(a); }

  /** Salud del servicio: usado por Docker y por el monitoreo. */
  @Publico() @Get('salud') async salud() {
    const t = Date.now();
    await this.db.$queryRaw`SELECT 1`;
    return { estado: 'ok', baseDeDatos: 'conectada', latenciaMs: Date.now() - t, version: process.env.npm_package_version ?? '0.2.0' };
  }
}

@Module({ controllers: [CumplimientoController], providers: [CumplimientoService] })
export class CumplimientoModule {}
