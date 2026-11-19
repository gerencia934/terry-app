import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { EstadoPermiso, UnidadMedida } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { Auditoria } from '../common/servicios';
import { Archivos } from '../common/archivos';
import { ActorActual, Permiso, Publico, Zod, fechaColombia, type Actor } from '../common/http';
import { veFinanzas } from '../finanzas/estado';
import { DIAS_PARA_FACTURAR } from '../finanzas/finanzas.module';

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
/** Códigos de disposición (tratamientos) que ampara un acto o que hace un gestor. */
const Codigos = z.array(z.string().trim().toUpperCase().min(1).max(20)).max(30);
/** Permiso o licencia propia nuevo: renovación, modificación o una licencia nueva (p. ej. celda de seguridad o autoclave). */
const CrearPermiso = z.object({
  acto: z.string().trim().min(5, 'Escriba el acto: tipo, número y año (p. ej. «Resolución DGL No. 000632 de 2023»).').max(60),
  autoridad: z.string().trim().min(2).max(80), alcance: z.string().trim().min(10, 'Describa qué autoriza (mínimo 10 caracteres).').max(4000),
  expedicion: fechaOpc, vence: fechaOpc, estado: z.nativeEnum(EstadoPermiso).default('VIGENTE'), disposiciones: Codigos.default([]),
});
const Nit = z.string().trim().regex(/^\d{6,10}(-\d)?$/, 'NIT sin puntos, con o sin dígito de verificación (900123456-7).');
/** Acto que ampara al gestor; vacío = aún no se tiene (el gestor queda registrado, pero no cubre). */
const Licencia = z.union([z.literal('').transform(() => null), z.string().trim().min(5, 'Escriba el acto que lo ampara: número, fecha y modificaciones.').max(300)]).nullish();
/**
 * Gestor aliado nuevo (planta de un tercero). La licencia y lo que gestiona pueden quedar para después (gerencia, 19-11-2026:
 * «si no consigues la información de licencias, avancemos sin ella»): mientras no tenga la licencia vigente, no cubre.
 */
const CrearAliado = z.object({
  nit: Nit, razonSocial: z.string().trim().min(3).max(200), municipio: textoOpc(80),
  licencia: Licencia, licenciaAutoridad: textoOpc(80),
  licenciaIndefinida: z.boolean().default(false), licenciaVence: fechaOpc, alcance: textoOpc(4000),
  excluyeTiposResiduo: z.array(z.string().trim().toUpperCase().min(1).max(20)).max(20).default([]),
  disposiciones: Codigos.default([]),
  soporteComercial: textoOpc(200), soporteComercialFecha: fechaOpc,
}).refine((b) => !(b.licenciaIndefinida && b.licenciaVence), { message: 'Una licencia indefinida no lleva fecha de vencimiento.', path: ['licenciaVence'] })
  .refine((b) => !b.licencia || b.licenciaIndefinida || !!b.licenciaVence, { message: 'Indique hasta cuándo vale la licencia, o márquela «sin término» (vida útil del proyecto).', path: ['licenciaVence'] })
  .refine((b) => !b.licencia || !!b.licenciaAutoridad, { message: 'Indique la autoridad que expidió la licencia.', path: ['licenciaAutoridad'] });
/** Ficha del gestor: licencia, lo que gestiona, el NIT (si se sembró sin confirmar) y si se trabaja hoy con él. */
const EditarAliado = z.object({
  nit: Nit.optional(), activo: z.boolean().optional(),
  razonSocial: z.string().trim().min(3).max(200).optional(), municipio: textoOpc(80), disposiciones: Codigos.optional(),
  soporteComercial: textoOpc(200), soporteComercialFecha: fechaOpc,
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
/**
 * Estado de la licencia de un gestor aliado y si hoy cubre, con la misma regla de fn_aliado_vigente (la que decide la
 * cobertura): se trabaja con él y la licencia está registrada y vigente.
 */
function estadoLicencia(p: { activo: boolean; licencia: string | null; licenciaIndefinida: boolean; licenciaVence: Date | null }) {
  const e = estadoDelActo(p);
  return p.activo ? e : { ...e, cubre: false };
}
function estadoDelActo(p: { licencia: string | null; licenciaIndefinida: boolean; licenciaVence: Date | null }) {
  if (!p.licencia?.trim()) return { estado: 'SIN_LICENCIA' as const, cubre: false };
  if (p.licenciaIndefinida) return { estado: 'INDEFINIDA' as const, cubre: true };
  if (!p.licenciaVence) return { estado: 'SIN_VIGENCIA' as const, cubre: false };
  const d = Math.round((p.licenciaVence.getTime() - fechaColombia().getTime()) / 86_400_000);
  return d < 0 ? { estado: 'VENCIDA' as const, cubre: false, dias: d } : { estado: d <= 60 ? 'POR_VENCER' as const : 'VIGENTE' as const, cubre: true, dias: d };
}
export interface Alerta { tipo: 'cumplimiento' | 'flota' | 'personal' | 'operacion' | 'finanzas'; nivel: 'alta' | 'media' | 'info'; titulo: string; detalle: string; fecha?: string; referencia?: string }

@Injectable()
class CumplimientoService {
  constructor(private readonly db: PrismaService, private readonly audit: Auditoria, private readonly archivos: Archivos) {}

  /** Disposiciones de la empresa por código (para ligar un acto o un gestor a lo que ampara). */
  private async disposicionesPorCodigo(a: Actor, codigos: string[], soloDeAliados = false) {
    const ds = await this.db.disposicion.findMany({ where: { empresaId: a.empresaId, codigo: { in: codigos } } });
    const faltan = codigos.filter((c) => !ds.some((d) => d.codigo === c));
    if (faltan.length) throw new BadRequestException({ mensaje: `Tratamientos que no existen: ${faltan.join(', ')}.` });
    const propias = soloDeAliados ? ds.filter((d) => d.propia) : [];
    if (propias.length) throw new BadRequestException({ mensaje: `${propias.map((d) => d.codigo).join(', ')} lo hace Terra Viva en Los Pinos: un gestor aliado no lo ampara (regístrelo como permiso propio).` });
    return ds;
  }

  /** Permiso o licencia propia nuevo (renovación, modificación o una licencia nueva, como la de celda de seguridad, autoclave y biorremediación). */
  async crearPermiso(a: Actor, b: z.infer<typeof CrearPermiso>) {
    if (b.expedicion && b.vence && b.vence < b.expedicion) throw new BadRequestException({ mensaje: 'El vencimiento no puede ser anterior a la expedición.' });
    if (await this.db.permisoAmbiental.findFirst({ where: { empresaId: a.empresaId, acto: b.acto } })) throw new BadRequestException({ mensaje: `Ya está registrado «${b.acto}».` });
    const ds = await this.disposicionesPorCodigo(a, b.disposiciones);
    const { disposiciones: _d, ...datos } = b;
    const p = await this.db.permisoAmbiental.create({ data: { ...datos, empresaId: a.empresaId, disposiciones: { create: ds.map((d) => ({ disposicionId: d.id })) } } });
    await this.audit.registrar(a, 'permiso_ambiental', p.id, 'CREAR', undefined, { ...datos, disposiciones: b.disposiciones });
    return p;
  }

  /** PDF del acto (permiso propio) o de la licencia (gestor aliado): se guarda en el almacenamiento y se ve con enlace firmado. */
  async subirDocumento(a: Actor, tipo: 'permiso' | 'aliado', id: string, archivo?: Express.Multer.File) {
    if (!archivo) throw new BadRequestException({ mensaje: 'Adjunte el PDF.' });
    const x = tipo === 'permiso' ? await this.db.permisoAmbiental.findFirst({ where: { id, empresaId: a.empresaId } }) : await this.db.proveedor.findFirst({ where: { id, empresaId: a.empresaId, esPropio: false } });
    if (!x) throw new NotFoundException({ mensaje: tipo === 'permiso' ? 'Permiso no encontrado.' : 'Gestor no encontrado.' });
    const g = await this.archivos.guardar(a.empresaId, tipo === 'permiso' ? 'permisos' : 'licencias', archivo.buffer, ['pdf']);
    const antes = tipo === 'permiso' ? (x as { documentoUrl: string | null }).documentoUrl : (x as { licenciaUrl: string | null }).licenciaUrl;
    if (tipo === 'permiso') await this.db.permisoAmbiental.update({ where: { id }, data: { documentoUrl: g.clave } });
    else await this.db.proveedor.update({ where: { id }, data: { licenciaUrl: g.clave } });
    await this.audit.registrar(a, tipo === 'permiso' ? 'permiso_ambiental' : 'proveedor', id, 'DOCUMENTO', { documento: antes }, { documento: g.clave, bytes: g.bytes });
    return { documento: g.clave };
  }

  /** Ver el PDF: si está guardado, enlace firmado de 5 minutos; si es un enlace externo, ese enlace. */
  async enlaceDocumento(a: Actor, tipo: 'permiso' | 'aliado', id: string) {
    const x = tipo === 'permiso' ? await this.db.permisoAmbiental.findFirst({ where: { id, empresaId: a.empresaId } }) : await this.db.proveedor.findFirst({ where: { id, empresaId: a.empresaId, esPropio: false } });
    const doc = !x ? null : tipo === 'permiso' ? (x as { documentoUrl: string | null }).documentoUrl : (x as { licenciaUrl: string | null }).licenciaUrl;
    if (!doc) throw new NotFoundException({ mensaje: 'No tiene el documento registrado.' });
    if (/^https?:\/\//.test(doc)) return { url: doc, vence: null };
    return this.archivos.enlace(doc, a.empresaId, { nombre: `${tipo === 'permiso' ? (x as { acto: string }).acto : `licencia ${(x as { razonSocial: string }).razonSocial}`}.pdf` });
  }

  /** ¿Otro proveedor ya tiene ese NIT (con o sin dígito de verificación)? */
  private async nitOcupado(a: Actor, nit: string, excepto?: string) {
    const base = nit.split('-')[0];
    if (await this.db.proveedor.findFirst({ where: { empresaId: a.empresaId, ...(excepto ? { id: { not: excepto } } : {}), OR: [{ nit: base }, { nit: { startsWith: `${base}-` } }] } }))
      throw new BadRequestException({ mensaje: `Ya existe un gestor o proveedor con el NIT ${nit}.` });
  }

  /** Gestor aliado nuevo, con o sin su licencia (si no está registrada y vigente, no cubre: no se autorizan sus disposiciones). */
  async crearAliado(a: Actor, b: z.infer<typeof CrearAliado>) {
    await this.nitOcupado(a, b.nit);
    if (b.excluyeTiposResiduo.length) await this.validarTipos(a, b.excluyeTiposResiduo);
    const ds = await this.disposicionesPorCodigo(a, b.disposiciones, true);
    const { disposiciones: _d, ...datos } = b;
    const p = await this.db.proveedor.create({ data: { ...datos, empresaId: a.empresaId, esDestino: true, esPropio: false, disposicionesGestionadas: { create: ds.map((d) => ({ disposicionId: d.id })) } } });
    await this.audit.registrar(a, 'proveedor', p.id, 'CREAR', undefined, { ...datos, disposiciones: b.disposiciones });
    return { ...p, vigencia: estadoLicencia(p) };
  }

  private async validarTipos(a: Actor, codigos: string[]) {
    const validos = new Set((await this.db.tipoResiduo.findMany({ where: { empresaId: a.empresaId }, select: { codigo: true } })).map((t) => t.codigo.toUpperCase()));
    const malos = codigos.filter((c) => !validos.has(c));
    if (malos.length) throw new BadRequestException({ mensaje: `Tipos de residuo que no existen: ${malos.join(', ')}.` });
  }

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
    const xs = await this.db.proveedor.findMany({ where: { empresaId: a.empresaId, esPropio: false, esDestino: true }, orderBy: [{ activo: 'desc' }, { razonSocial: 'asc' }],
      include: { disposicionesGestionadas: { include: { disposicion: { select: { codigo: true, nombre: true, activo: true } } } } } });
    return xs.map((p) => ({ ...p, vigencia: estadoLicencia(p) }));
  }

  /**
   * Licencia de un gestor aliado: de esto depende autorizar declaraciones con sus disposiciones. Inactivarlo (ya no se
   * trabaja con él) le quita la cobertura y lo saca de los destinos de servicios nuevos; sus certificados se conservan.
   */
  async editarAliado(a: Actor, id: string, b: z.infer<typeof EditarAliado>) {
    const p = await this.db.proveedor.findFirst({ where: { id, empresaId: a.empresaId, esPropio: false } });
    if (!p) throw new NotFoundException({ mensaje: 'Gestor no encontrado.' });
    if (b.nit && b.nit !== p.nit) await this.nitOcupado(a, b.nit, id);
    if (b.excluyeTiposResiduo?.length) {
      const validos = new Set((await this.db.tipoResiduo.findMany({ where: { empresaId: a.empresaId }, select: { codigo: true } })).map((t) => t.codigo.toUpperCase()));
      const malos = b.excluyeTiposResiduo.filter((c) => !validos.has(c));
      if (malos.length) throw new BadRequestException({ mensaje: `Tipos de residuo que no existen: ${malos.join(', ')}.` });
    }
    // Indefinida y fecha se excluyen: elegir una borra la otra
    const { disposiciones, ...resto } = b;
    const datos = { ...resto, ...(b.licenciaIndefinida ? { licenciaVence: null } : {}), ...(b.licenciaVence ? { licenciaIndefinida: false } : {}) };
    const ds = disposiciones ? await this.disposicionesPorCodigo(a, disposiciones, true) : null;
    const antes = ds ? (await this.db.disposicionGestor.findMany({ where: { proveedorId: id }, include: { disposicion: { select: { codigo: true } } } })).map((x) => x.disposicion.codigo) : null;
    const r = await this.db.$transaction(async (tx) => {
      if (ds) {
        await tx.disposicionGestor.deleteMany({ where: { proveedorId: id, disposicionId: { notIn: ds.map((d) => d.id) } } });
        await tx.disposicionGestor.createMany({ data: ds.map((d) => ({ disposicionId: d.id, proveedorId: id })), skipDuplicates: true });
      }
      return tx.proveedor.update({ where: { id }, data: datos });
    });
    if (ds) await this.audit.registrar(a, 'proveedor', id, 'DISPOSICIONES', { disposiciones: antes }, { disposiciones });
    if (b.activo !== undefined && b.activo !== p.activo) await this.audit.registrar(a, 'proveedor', id, b.activo ? 'ACTIVAR' : 'INACTIVAR', { activo: p.activo }, { activo: b.activo });
    if (b.nit && b.nit !== p.nit) await this.audit.registrar(a, 'proveedor', id, 'NIT', { nit: p.nit }, { nit: b.nit });
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
      this.db.proveedor.findMany({ where: { empresaId: a.empresaId, esPropio: false, esDestino: true, activo: true },
        include: { disposicionesGestionadas: { include: { disposicion: { select: { nombre: true, activo: true } } } } } }),
      this.db.empresa.findUniqueOrThrow({ where: { id: a.empresaId }, select: { configuracion: true } }),
    ]);
    const out: Alerta[] = [];
    const nivel = (d: number, alto = 15) => (d <= alto ? 'alta' : 'media') as Alerta['nivel'];
    const cuando = (d: number) => (d < 0 ? `venció hace ${-d} días` : d === 0 ? 'vence hoy' : `vence en ${d} días`);
    obl.forEach((o) => { const f = o.proximaFecha!; out.push({ tipo: 'cumplimiento', nivel: nivel(dias(f)), titulo: `${o.permiso.acto}: obligación ${dias(f) < 0 ? `vencida hace ${-dias(f)} días` : `en ${dias(f)} días`}${o.codigo ? ` (${o.codigo})` : ''}`, detalle: o.descripcion, fecha: f.toISOString().slice(0, 10), referencia: o.id }); });
    for (const p of aliados) {
      const activas = p.disposicionesGestionadas.filter((x) => x.disposicion.activo);
      if (p.disposicionesGestionadas.length && !activas.length) continue; // solo gestiona tratamientos que ya no se ofrecen
      const que = activas.map((x) => x.disposicion.nombre.toLowerCase()).join(', ');
      const faltan = [!/^\d/.test(p.nit) && 'el NIT', !activas.length && 'qué tratamientos hace', !p.licencia?.trim() && 'la licencia'].filter(Boolean) as string[];
      if (faltan.length) {
        out.push({ tipo: 'cumplimiento', nivel: activas.length ? 'media' : 'info', titulo: `${p.razonSocial}: falta registrar ${faltan.join(', ').replace(/, ([^,]*)$/, ' y $1')}`,
          detalle: activas.length ? `Mientras no tenga la licencia vigente, no cubre ${que}` : 'Complételo en Permisos › Gestores aliados: mientras tanto no cubre ningún tratamiento', referencia: p.id });
        continue;
      }
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
    // Facturación (Siigo): solo la ven Comercial, Facturación y Gerencia
    if (veFinanzas(a)) {
      const antes = new Date(hoy.getTime() - DIAS_PARA_FACTURAR * 86_400_000);
      const [sinFacturar, ultima] = await Promise.all([
        this.db.manifiesto.count({ where: { empresaId: a.empresaId, estado: 'REALIZADO', fechaServicio: { lt: antes },
          OR: [{ finanzas: null }, { finanzas: { facturado: false, estadoPago: { not: 'LIBRE' } } }] } }),
        this.db.sincronizacionSiigo.findFirst({ where: { empresaId: a.empresaId }, orderBy: { iniciadaEn: 'desc' }, select: { estado: true, error: true } }),
      ]);
      if (sinFacturar) out.push({ tipo: 'finanzas', nivel: sinFacturar > 20 ? 'alta' : 'media', titulo: `${sinFacturar} ${sinFacturar === 1 ? 'manifiesto sin facturar' : 'manifiestos sin facturar'}`,
        detalle: `Realizados hace más de ${DIAS_PARA_FACTURAR} días y sin factura en Siigo. Revíselos en Facturación` });
      if (ultima?.estado === 'FALLIDA') out.push({ tipo: 'finanzas', nivel: 'alta', titulo: 'La última sincronización con Siigo falló', detalle: ultima.error ?? 'Vuelva a intentarlo desde Facturación' });
    }
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
      this.db.proveedor.findMany({ where: { empresaId: a.empresaId, esDestino: true }, orderBy: [{ esPropio: 'desc' }, { activo: 'desc' }, { razonSocial: 'asc' }], select: { id: true, razonSocial: true, esPropio: true, activo: true } }),
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

const pdf = FileInterceptor('archivo', { limits: { fileSize: 15 * 1024 * 1024, files: 1 } });

@Controller()
class CumplimientoController {
  constructor(private readonly s: CumplimientoService, private readonly db: PrismaService) {}
  @Get('permisos-ambientales') permisos(@ActorActual() a: Actor) { return this.s.permisos(a); }
  @Permiso('permisos.gestionar') @Patch('permisos-ambientales/:id') editarPermiso(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(EditarPermiso)) b: z.infer<typeof EditarPermiso>) { return this.s.editarPermiso(a, id, b); }
  @Get('obligaciones/:id/cumplimientos') historial(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.historial(a, id); }
  @Permiso('permisos.gestionar') @Post('obligaciones/:id/cumplimientos') cumplir(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Cumplimiento)) b: z.infer<typeof Cumplimiento>) { return this.s.cumplirObligacion(a, id, b); }
  @Permiso('permisos.gestionar') @Post('permisos-ambientales') crearPermiso(@ActorActual() a: Actor, @Body(new Zod(CrearPermiso)) b: z.infer<typeof CrearPermiso>) { return this.s.crearPermiso(a, b); }
  @Permiso('permisos.gestionar') @Post('permisos-ambientales/:id/documento') @UseInterceptors(pdf)
  subirActo(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() f?: Express.Multer.File) { return this.s.subirDocumento(a, 'permiso', id, f); }
  @Get('permisos-ambientales/:id/documento') verActo(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.enlaceDocumento(a, 'permiso', id); }
  @Get('gestores-aliados') aliados(@ActorActual() a: Actor) { return this.s.aliados(a); }
  @Permiso('permisos.gestionar') @Post('gestores-aliados') crearAliado(@ActorActual() a: Actor, @Body(new Zod(CrearAliado)) b: z.infer<typeof CrearAliado>) { return this.s.crearAliado(a, b); }
  @Permiso('permisos.gestionar') @Post('gestores-aliados/:id/licencia') @UseInterceptors(pdf)
  subirLicencia(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() f?: Express.Multer.File) { return this.s.subirDocumento(a, 'aliado', id, f); }
  @Get('gestores-aliados/:id/licencia') verLicencia(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.enlaceDocumento(a, 'aliado', id); }
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
