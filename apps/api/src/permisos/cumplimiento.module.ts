import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { EstadoPermiso, UnidadMedida } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { Auditoria } from '../common/servicios';
import { ActorActual, Permiso, Publico, Zod, fechaColombia, type Actor } from '../common/http';

const dias = (f: Date) => Math.ceil((f.getTime() - Date.now()) / 86_400_000);
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha AAAA-MM-DD').transform((x) => new Date(`${x}T00:00:00Z`));
const fechaOpc = z.union([z.literal('').transform(() => null), fecha]).nullish();
const urlOpc = z.union([z.literal('').transform(() => null), z.string().trim().url('Enlace inválido (empiece por https://)').max(500)]).nullish();
const textoOpc = (max: number) => z.string().trim().max(max).transform((x) => x || null).nullish();
/** Cumplimiento de una obligación: necesita algún soporte (radicado, enlace o nota). */
const Cumplimiento = z.object({
  cumplidaEn: fecha.optional(), radicado: textoOpc(80), soporteUrl: urlOpc, nota: textoOpc(500),
}).refine((b) => !!(b.radicado || b.soporteUrl || (b.nota && b.nota.length >= 10)), { message: 'Indique el radicado, el enlace al soporte o una nota de al menos 10 caracteres.', path: ['radicado'] });
const EditarPermiso = z.object({
  expedicion: fechaOpc, vence: fechaOpc, estado: z.nativeEnum(EstadoPermiso).optional(), documentoUrl: urlOpc, alcance: z.string().trim().min(10).max(4000).optional(),
});
const EditarAliado = z.object({
  licencia: textoOpc(300), licenciaAutoridad: textoOpc(80), licenciaIndefinida: z.boolean().optional(), licenciaVence: fechaOpc, licenciaUrl: urlOpc,
  alcance: textoOpc(4000), excluyeTiposResiduo: z.array(z.string().trim().toUpperCase().min(1).max(20)).max(20).optional(),
}).refine((b) => !(b.licenciaIndefinida && b.licenciaVence), { message: 'Una licencia indefinida no lleva fecha de vencimiento.', path: ['licenciaVence'] });
const DatosVehiculo = z.object({
  marca: textoOpc(40), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color en formato #RRGGBB').optional(), tipo: z.string().trim().min(2).max(40),
  capacidad: z.number().positive('La capacidad debe ser mayor que cero').max(1e6), unidadCap: z.nativeEnum(UnidadMedida).default('KG'), volumenM3: z.number().positive().max(1000).nullish(),
  proveedorId: z.string().uuid().nullish(), soatVence: fechaOpc, rtmVence: fechaOpc, polizaRcVence: fechaOpc,
});
const CrearVehiculo = DatosVehiculo.extend({ placa: z.string().transform((x) => x.replace(/[\s-]/g, '').toUpperCase()).pipe(z.string().regex(/^[A-Z]{3}\d{2}[A-Z0-9]$|^[A-Z]{2}\d{4}$|^[A-Z]\d{5}$/, 'Placa colombiana: AAA123, AAA12A, AA1234 o A12345')) });
const EditarVehiculo = DatosVehiculo.partial().extend({ activo: z.boolean().optional() });
/** Estado de la licencia de un gestor aliado, con la misma regla de fn_aliado_vigente (la que decide la cobertura). */
function estadoLicencia(p: { licencia: string | null; licenciaIndefinida: boolean; licenciaVence: Date | null }) {
  if (!p.licencia?.trim()) return { estado: 'SIN_LICENCIA' as const, cubre: false };
  if (p.licenciaIndefinida) return { estado: 'INDEFINIDA' as const, cubre: true };
  if (!p.licenciaVence) return { estado: 'SIN_VIGENCIA' as const, cubre: false };
  const d = Math.round((p.licenciaVence.getTime() - fechaColombia().getTime()) / 86_400_000);
  return d < 0 ? { estado: 'VENCIDA' as const, cubre: false, dias: d } : { estado: d <= 60 ? 'POR_VENCER' as const : 'VIGENTE' as const, cubre: true, dias: d };
}
export interface Alerta { tipo: 'cumplimiento' | 'flota' | 'personal' | 'operacion'; nivel: 'alta' | 'media' | 'info'; titulo: string; detalle: string; fecha?: string; referencia?: string }

@Injectable()
class CumplimientoService {
  constructor(private readonly db: PrismaService, private readonly audit: Auditoria) {}

  /** Permisos con sus obligaciones (las de fecha más próxima primero) y el último cumplimiento de cada una. */
  permisos(a: Actor) {
    return this.db.permisoAmbiental.findMany({ where: { empresaId: a.empresaId }, orderBy: [{ estado: 'asc' }, { acto: 'asc' }], include: {
      obligaciones: { orderBy: [{ proximaFecha: { sort: 'asc', nulls: 'last' } }, { codigo: 'asc' }], include: {
        cumplimientos: { orderBy: { cumplidaEn: 'desc' }, take: 1, include: { usuario: { select: { nombre: true } } } }, _count: { select: { cumplimientos: true } } } },
      disposiciones: { include: { disposicion: { select: { codigo: true, nombre: true, activo: true } } } },
    } });
  }

  /** Vigencia, estado, documento o alcance de un permiso (al renovarlo o cuando la autoridad lo modifica). */
  async editarPermiso(a: Actor, id: string, b: z.infer<typeof EditarPermiso>) {
    const p = await this.db.permisoAmbiental.findFirst({ where: { id, empresaId: a.empresaId } });
    if (!p) throw new NotFoundException({ mensaje: 'Permiso no encontrado.' });
    const expedicion = b.expedicion !== undefined ? b.expedicion : p.expedicion, vence = b.vence !== undefined ? b.vence : p.vence;
    if (expedicion && vence && vence < expedicion) throw new BadRequestException({ mensaje: 'El vencimiento no puede ser anterior a la expedición.' });
    const r = await this.db.permisoAmbiental.update({ where: { id }, data: b });
    await this.audit.registrar(a, 'permiso_ambiental', id, 'EDITAR', { expedicion: p.expedicion, vence: p.vence, estado: p.estado, documentoUrl: p.documentoUrl }, b);
    return r;
  }

  /** Historial de cumplimiento de una obligación. */
  async historial(a: Actor, id: string) {
    const o = await this.db.obligacionPermiso.findFirst({ where: { id, permiso: { empresaId: a.empresaId } }, include: { permiso: { select: { acto: true } } } });
    if (!o) throw new NotFoundException({ mensaje: 'Obligación no encontrada.' });
    const cumplimientos = await this.db.obligacionCumplimiento.findMany({ where: { obligacionId: id }, orderBy: [{ cumplidaEn: 'desc' }, { creadoEn: 'desc' }], include: { usuario: { select: { nombre: true } } } });
    return { obligacion: o, cumplimientos };
  }

  /** Gestores aliados con su licencia, lo que gestionan y si hoy cubren (misma regla de la base). */
  async aliados(a: Actor) {
    const xs = await this.db.proveedor.findMany({ where: { empresaId: a.empresaId, esPropio: false, esDestino: true }, orderBy: { razonSocial: 'asc' },
      include: { disposicionesGestionadas: { include: { disposicion: { select: { codigo: true, nombre: true, activo: true } } } } } });
    return xs.map((p) => ({ ...p, vigencia: estadoLicencia(p) }));
  }

  /** Licencia de un gestor aliado: de esto depende autorizar declaraciones con sus disposiciones. */
  async editarAliado(a: Actor, id: string, b: z.infer<typeof EditarAliado>) {
    const p = await this.db.proveedor.findFirst({ where: { id, empresaId: a.empresaId, esPropio: false } });
    if (!p) throw new NotFoundException({ mensaje: 'Gestor no encontrado.' });
    if (b.excluyeTiposResiduo?.length) {
      const validos = new Set((await this.db.tipoResiduo.findMany({ where: { empresaId: a.empresaId }, select: { codigo: true } })).map((t) => t.codigo.toUpperCase()));
      const malos = b.excluyeTiposResiduo.filter((c) => !validos.has(c));
      if (malos.length) throw new BadRequestException({ mensaje: `Tipos de residuo que no existen: ${malos.join(', ')}.` });
    }
    // Indefinida y fecha se excluyen: elegir una borra la otra
    const datos = { ...b, ...(b.licenciaIndefinida ? { licenciaVence: null } : {}), ...(b.licenciaVence ? { licenciaIndefinida: false } : {}) };
    const r = await this.db.proveedor.update({ where: { id }, data: datos });
    await this.audit.registrar(a, 'proveedor', id, 'LICENCIA',
      { licencia: p.licencia, licenciaAutoridad: p.licenciaAutoridad, licenciaVence: p.licenciaVence, licenciaIndefinida: p.licenciaIndefinida, excluyeTiposResiduo: p.excluyeTiposResiduo }, datos);
    return { ...r, vigencia: estadoLicencia(r) };
  }

  /**
   * Registra el cumplimiento de una obligación con su soporte (historial que no se borra). Si tiene fecha, avanza a la
   * siguiente según la periodicidad (desde la fecha programada, no desde el día en que se cumplió); si no se repite,
   * queda cumplida. Las obligaciones por evento o permanentes solo suman el registro.
   */
  async cumplirObligacion(a: Actor, id: string, b: z.infer<typeof Cumplimiento>) {
    const o = await this.db.obligacionPermiso.findFirst({ where: { id, permiso: { empresaId: a.empresaId } } });
    if (!o) throw new NotFoundException({ mensaje: 'Obligación no encontrada.' });
    if (o.cumplida) throw new BadRequestException({ mensaje: 'Esta obligación ya está cumplida y no se repite.' });
    const hoy = fechaColombia();
    const cuando = b.cumplidaEn ?? hoy;
    if (cuando > hoy) throw new BadRequestException({ mensaje: 'La fecha de cumplimiento no puede ser futura.' });
    const porTexto: Record<string, number> = { mensual: 1, trimestral: 3, semestral: 6, anual: 12 };
    const m = o.meses ?? porTexto[o.periodicidad.toLowerCase()];
    const f = o.proximaFecha;
    const siguiente = f && m ? new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + m, f.getUTCDate())) : null;
    const [cumplimiento, r] = await this.db.$transaction([
      this.db.obligacionCumplimiento.create({ data: { obligacionId: id, fechaProgramada: f, cumplidaEn: cuando, radicado: b.radicado ?? null, soporteUrl: b.soporteUrl ?? null, nota: b.nota ?? null, usuarioId: a.id } }),
      this.db.obligacionPermiso.update({ where: { id }, data: !f ? {} : siguiente ? { proximaFecha: siguiente, cumplida: false } : { cumplida: true } }),
    ]);
    await this.audit.registrar(a, 'obligacion', id, 'CUMPLIDA', { fecha: f }, { cumplidaEn: cuando, radicado: b.radicado, siguiente });
    return { obligacion: r, cumplimiento, siguiente };
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
  vehiculos(a: Actor) { return this.db.vehiculo.findMany({ where: { empresaId: a.empresaId }, orderBy: [{ activo: 'desc' }, { placa: 'asc' }], include: { proveedor: { select: { id: true, razonSocial: true } } } }); }
  /** Transportadores (terceros) a los que pertenece un vehículo que no es propio. */
  transportadores(a: Actor) { return this.db.proveedor.findMany({ where: { empresaId: a.empresaId, esTransportador: true }, orderBy: { razonSocial: 'asc' }, select: { id: true, razonSocial: true, nit: true } }); }
  private async validarTransportador(a: Actor, proveedorId?: string | null) {
    if (proveedorId && !(await this.db.proveedor.findFirst({ where: { id: proveedorId, empresaId: a.empresaId, esTransportador: true } })))
      throw new BadRequestException({ mensaje: 'El transportador no existe.' });
  }
  async crearVehiculo(a: Actor, b: z.infer<typeof CrearVehiculo>) {
    await this.validarTransportador(a, b.proveedorId);
    if (await this.db.vehiculo.findUnique({ where: { placa: b.placa } })) throw new BadRequestException({ mensaje: `La placa ${b.placa} ya está registrada.` });
    const v = await this.db.vehiculo.create({ data: { ...b, empresaId: a.empresaId } });
    await this.audit.registrar(a, 'vehiculo', v.id, 'CREAR', undefined, v);
    return v;
  }
  /** Edita un vehículo. No se borra: se inactiva (deja de ofrecerse para programar rutas). La placa no cambia. */
  async editarVehiculo(a: Actor, id: string, b: z.infer<typeof EditarVehiculo>) {
    const v = await this.db.vehiculo.findFirst({ where: { id, empresaId: a.empresaId } });
    if (!v) throw new NotFoundException({ mensaje: 'Vehículo no encontrado.' });
    await this.validarTransportador(a, b.proveedorId);
    const r = await this.db.vehiculo.update({ where: { id }, data: b });
    await this.audit.registrar(a, 'vehiculo', id, b.activo === false && v.activo ? 'INACTIVAR' : 'EDITAR',
      { soatVence: v.soatVence, rtmVence: v.rtmVence, polizaRcVence: v.polizaRcVence, activo: v.activo, capacidad: v.capacidad }, b);
    return r;
  }
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
  @Permiso('permisos.gestionar') @Patch('permisos-ambientales/:id') editarPermiso(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(EditarPermiso)) b: z.infer<typeof EditarPermiso>) { return this.s.editarPermiso(a, id, b); }
  @Get('obligaciones/:id/cumplimientos') historial(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.historial(a, id); }
  @Permiso('permisos.gestionar') @Post('obligaciones/:id/cumplimientos') cumplir(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Cumplimiento)) b: z.infer<typeof Cumplimiento>) { return this.s.cumplirObligacion(a, id, b); }
  @Get('gestores-aliados') aliados(@ActorActual() a: Actor) { return this.s.aliados(a); }
  @Permiso('permisos.gestionar') @Patch('gestores-aliados/:id') editarAliado(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(EditarAliado)) b: z.infer<typeof EditarAliado>) { return this.s.editarAliado(a, id, b); }
  @Get('alertas') alertas(@ActorActual() a: Actor) { return this.s.alertas(a); }
  @Get('catalogos') catalogo(@ActorActual() a: Actor, @Query(new Zod(z.object({ tipo: z.string().optional() }))) q: { tipo?: string }) { return this.s.catalogo(a, q.tipo); }
  @Get('catalogos/residuos') residuos(@ActorActual() a: Actor) { return this.s.residuos(a); }
  @Get('catalogos/operacion') operacion(@ActorActual() a: Actor) { return this.s.operacion(a); }
  @Get('vehiculos') vehiculos(@ActorActual() a: Actor) { return this.s.vehiculos(a); }
  @Get('vehiculos/transportadores') transportadores(@ActorActual() a: Actor) { return this.s.transportadores(a); }
  @Permiso('rutas.programar') @Post('vehiculos') crearVehiculo(@ActorActual() a: Actor, @Body(new Zod(CrearVehiculo)) b: z.infer<typeof CrearVehiculo>) { return this.s.crearVehiculo(a, b); }
  @Permiso('rutas.programar') @Patch('vehiculos/:id') editarVehiculo(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(EditarVehiculo)) b: z.infer<typeof EditarVehiculo>) { return this.s.editarVehiculo(a, id, b); }
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
