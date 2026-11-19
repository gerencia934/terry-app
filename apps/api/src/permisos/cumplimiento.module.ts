import { BadRequestException, Controller, Get, Injectable, Module, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { Auditoria } from '../common/servicios';
import { ActorActual, Permiso, Publico, Zod, fechaColombia, type Actor } from '../common/http';

const dias = (f: Date) => Math.ceil((f.getTime() - Date.now()) / 86_400_000);
export interface Alerta { tipo: 'cumplimiento' | 'flota' | 'personal' | 'operacion'; nivel: 'alta' | 'media' | 'info'; titulo: string; detalle: string; fecha?: string; referencia?: string }

@Injectable()
class CumplimientoService {
  constructor(private readonly db: PrismaService, private readonly audit: Auditoria) {}

  permisos(a: Actor) {
    return this.db.permisoAmbiental.findMany({ where: { empresaId: a.empresaId }, orderBy: { acto: 'asc' }, include: { obligaciones: { orderBy: { proximaFecha: 'asc' } }, disposiciones: { include: { disposicion: { select: { codigo: true, nombre: true } } } } } });
  }

  async cumplirObligacion(a: Actor, id: string) {
    const o = await this.db.obligacionPermiso.findFirstOrThrow({ where: { id, permiso: { empresaId: a.empresaId } } });
    if (!o.proximaFecha) throw new BadRequestException({ mensaje: 'Es una obligación permanente o por evento: no tiene una fecha que marcar como cumplida.' });
    const porTexto: Record<string, number> = { mensual: 1, trimestral: 3, semestral: 6, anual: 12 };
    const m = o.meses ?? porTexto[o.periodicidad.toLowerCase()];
    const f = o.proximaFecha;
    const siguiente = m ? new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + m, f.getUTCDate())) : null;
    const r = await this.db.obligacionPermiso.update({ where: { id }, data: siguiente ? { proximaFecha: siguiente, cumplida: false } : { cumplida: true } });
    await this.audit.registrar(a, 'obligacion', id, 'CUMPLIDA', { fecha: o.proximaFecha }, { siguiente });
    return r;
  }

  /** Reglas de alerta. En producción las ejecuta también una tarea diaria que envía el resumen por correo. */
  async alertas(a: Actor): Promise<Alerta[]> {
    const lim30 = new Date(Date.now() + 30 * 86_400_000), lim45 = new Date(Date.now() + 45 * 86_400_000);
    const hoy = fechaColombia(); const manana = new Date(hoy.getTime() + 86_400_000);
    const lim60 = new Date(Date.now() + 60 * 86_400_000);
    const [obl, veh, per, pend, rutasHoy, preops, aliados, empresa] = await Promise.all([
      this.db.obligacionPermiso.findMany({ where: { cumplida: false, proximaFecha: { not: null, lte: lim30 }, permiso: { empresaId: a.empresaId } }, include: { permiso: true } }),
      this.db.vehiculo.findMany({ where: { empresaId: a.empresaId, activo: true, OR: [{ soatVence: { lte: lim30 } }, { rtmVence: { lte: lim30 } }, { polizaRcVence: { lte: lim30 } }] } }),
      this.db.usuario.findMany({ where: { empresaId: a.empresaId, activo: true, esConductor: true, OR: [{ licenciaVence: { lte: lim45 } }, { cursoMpVence: { lte: lim45 } }] } }),
      this.db.declaracion.count({ where: { empresaId: a.empresaId, estado: 'PENDIENTE' } }),
      this.db.ruta.findMany({ where: { empresaId: a.empresaId, fechaProgramada: { gte: hoy, lt: manana } }, include: { vehiculo: { select: { id: true, placa: true } } } }),
      this.db.preoperacional.findMany({ where: { fechaProgramada: { gte: hoy, lt: manana }, vehiculo: { empresaId: a.empresaId } }, select: { vehiculoId: true, aprobado: true } }),
      // Gestores aliados de disposiciones activas (respuesta A5): licencia por vencer, vencida o sin vigencia registrada
      this.db.proveedor.findMany({ where: { empresaId: a.empresaId, esPropio: false, disposicionesGestionadas: { some: { disposicion: { activo: true } } } },
        include: { disposicionesGestionadas: { include: { disposicion: { select: { nombre: true, activo: true } } } } } }),
      this.db.empresa.findUniqueOrThrow({ where: { id: a.empresaId }, select: { configuracion: true } }),
    ]);
    const out: Alerta[] = [];
    const nivel = (d: number, alto = 15) => (d <= alto ? 'alta' : 'media') as Alerta['nivel'];
    const cuando = (d: number) => (d < 0 ? `venció hace ${-d} días` : d === 0 ? 'vence hoy' : `vence en ${d} días`);
    obl.forEach((o) => { const f = o.proximaFecha!; out.push({ tipo: 'cumplimiento', nivel: nivel(dias(f)), titulo: `${o.permiso.acto}: obligación ${dias(f) < 0 ? `vencida hace ${-dias(f)} días` : `en ${dias(f)} días`}${o.codigo ? ` (${o.codigo})` : ''}`, detalle: o.descripcion, fecha: f.toISOString().slice(0, 10), referencia: o.id }); });
    for (const p of aliados) {
      const que = p.disposicionesGestionadas.filter((x) => x.disposicion.activo).map((x) => x.disposicion.nombre.toLowerCase()).join(', ');
      if (p.licenciaIndefinida) continue;
      if (!p.licenciaVence) { out.push({ tipo: 'cumplimiento', nivel: 'media', titulo: `${p.razonSocial}: falta la vigencia de la licencia`, detalle: `Mientras no se registre, no se autorizan declaraciones de ${que}`, referencia: p.id }); continue; }
      if (p.licenciaVence <= lim60) out.push({ tipo: 'cumplimiento', nivel: nivel(dias(p.licenciaVence), 30), titulo: `${p.razonSocial}: la licencia ${cuando(dias(p.licenciaVence))}`,
        detalle: `Pida el acto que la prorrogue. Desde el día siguiente al vencimiento no se autorizan declaraciones de ${que} con este gestor`, fecha: p.licenciaVence.toISOString().slice(0, 10), referencia: p.id });
    }
    // Certificaciones del sistema de gestión y calibración de la báscula (Datos de la empresa; respuesta C2)
    const conf = (empresa.configuracion ?? {}) as { certificaciones?: { norma?: string; numero?: string; vence?: string }[]; bascula?: { certificado?: string; vigenteHasta?: string } };
    for (const c of conf.certificaciones ?? []) {
      if (!c?.numero?.trim() || !c.vence) continue;
      const f = new Date(`${c.vence}T00:00:00Z`);
      if (f <= lim60) out.push({ tipo: 'cumplimiento', nivel: nivel(dias(f), 30), titulo: `Certificado ${c.norma}: ${cuando(dias(f))}`, detalle: 'Mientras esté vencido, su sello no sale en los certificados', fecha: c.vence });
    }
    const b = conf.bascula;
    if (!b?.certificado?.trim() || !b.vigenteHasta) out.push({ tipo: 'cumplimiento', nivel: 'info', titulo: 'Falta el certificado de calibración de la báscula', detalle: 'Regístrelo en Ajustes › Datos de la empresa: el recibo de báscula lo cita' });
    else { const f = new Date(`${b.vigenteHasta}T00:00:00Z`); if (f <= lim30) out.push({ tipo: 'cumplimiento', nivel: nivel(dias(f)), titulo: `Calibración de la báscula: ${cuando(dias(f))}`, detalle: 'Con el certificado vencido, los recibos salen con alerta para que HSEQ revise el pesaje', fecha: b.vigenteHasta }); }
    veh.forEach((v) => ([['SOAT', v.soatVence], ['Revisión técnico-mecánica', v.rtmVence], ['Póliza RC', v.polizaRcVence]] as const).forEach(([doc, f]) => {
      if (f && f <= lim30) out.push({ tipo: 'flota', nivel: nivel(dias(f)), titulo: `${v.placa}: ${doc} vence en ${dias(f)} días`, detalle: v.tipo, fecha: f.toISOString().slice(0, 10), referencia: v.id });
    }));
    per.forEach((u) => ([['Licencia de conducción', u.licenciaVence], ['Curso de mercancías peligrosas', u.cursoMpVence]] as const).forEach(([doc, f]) => {
      if (f && f <= lim45) out.push({ tipo: 'personal', nivel: nivel(dias(f)), titulo: `${u.nombre}: ${doc.toLowerCase()} vence en ${dias(f)} días`, detalle: 'Res. 1223 de 2014', fecha: f.toISOString().slice(0, 10), referencia: u.id });
    }));
    rutasHoy.filter((r) => !r.vehiculo || !preops.some((p) => p.vehiculoId === r.vehiculo!.id && p.aprobado)).forEach((r) =>
      out.push(r.vehiculo
        ? { tipo: 'operacion', nivel: 'media', titulo: `Ruta ${r.codigo} (${r.vehiculo.placa}) sin preoperacional aprobado`, detalle: 'No puede salir hasta aprobar la inspección', referencia: r.id }
        : { tipo: 'operacion', nivel: 'alta', titulo: `Ruta ${r.codigo} sin vehículo asignado`, detalle: 'Asigne vehículo y conductor para que pueda salir', referencia: r.id }));
    if (pend) out.push({ tipo: 'operacion', nivel: 'info', titulo: `${pend} declaraciones por autorizar`, detalle: 'Revisar ficha de caracterización y cobertura de permisos' });
    const orden = { alta: 0, media: 1, info: 2 };
    return out.sort((x, y) => orden[x.nivel] - orden[y.nivel]);
  }

  catalogo(a: Actor, tipo?: string) {
    return this.db.catalogoItem.findMany({ where: { empresaId: a.empresaId, tipo: tipo?.toUpperCase(), activo: true }, orderBy: [{ tipo: 'asc' }, { nombre: 'asc' }] });
  }
  residuos(a: Actor) {
    return this.db.catalogoResiduo.findMany({ where: { empresaId: a.empresaId, activo: true }, orderBy: { codigo: 'asc' }, include: { lineaServicio: { select: { codigo: true, nombre: true } } } });
  }
  vehiculos(a: Actor) { return this.db.vehiculo.findMany({ where: { empresaId: a.empresaId }, orderBy: { placa: 'asc' } }); }
  /** Listas de la operación para la app de campo y la torre de control. */
  async operacion(a: Actor) {
    const [arl, eps, especificaciones, causales, destinos, etapas] = await Promise.all([
      this.db.entidadSeguridadSocial.findMany({ where: { tipo: 'ARL', activo: true }, orderBy: { nombre: 'asc' }, select: { id: true, nombre: true } }),
      this.db.entidadSeguridadSocial.findMany({ where: { tipo: 'EPS', activo: true }, orderBy: { nombre: 'asc' }, select: { id: true, nombre: true } }),
      this.db.especificacionAdicional.findMany({ where: { empresaId: a.empresaId, activo: true }, orderBy: { nombre: 'asc' } }),
      this.db.catalogoItem.findMany({ where: { empresaId: a.empresaId, tipo: 'CAUSAL', activo: true }, orderBy: { nombre: 'asc' }, select: { id: true, nombre: true } }),
      this.db.proveedor.findMany({ where: { empresaId: a.empresaId, esDestino: true }, orderBy: [{ esPropio: 'desc' }, { razonSocial: 'asc' }], select: { id: true, razonSocial: true, esPropio: true } }),
      this.db.estadoRecorrido.findMany({ where: { empresaId: a.empresaId, activo: true }, orderBy: { orden: 'asc' } }),
    ]);
    return { arl, eps, especificaciones, causales, destinos, etapas };
  }
  /** Conductores y auxiliares activos, para asignarlos a las rutas. */
  personal(a: Actor) {
    return this.db.usuario.findMany({ where: { empresaId: a.empresaId, activo: true, OR: [{ esConductor: true }, { esAuxiliar: true }] }, orderBy: { nombre: 'asc' },
      select: { id: true, nombre: true, esConductor: true, esAuxiliar: true, licenciaVence: true, cursoMpVence: true } });
  }
  zonas(a: Actor) { return this.db.zona.findMany({ where: { empresaId: a.empresaId }, orderBy: { nombre: 'asc' }, select: { id: true, nombre: true, color: true } }); }
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
  @Get('catalogos/operacion') operacion(@ActorActual() a: Actor) { return this.s.operacion(a); }
  @Get('vehiculos') vehiculos(@ActorActual() a: Actor) { return this.s.vehiculos(a); }
  @Get('personal') personal(@ActorActual() a: Actor) { return this.s.personal(a); }
  @Get('zonas') zonas(@ActorActual() a: Actor) { return this.s.zonas(a); }
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
