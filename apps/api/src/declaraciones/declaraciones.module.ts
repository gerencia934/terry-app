import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { EstadoDeclaracion, FormaPago, Prisma, TipoDeclaracion, TipoNegociacion } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { EsquemaDeclaracion, faltantesParaAutorizar } from '@terraviva/shared';
import { PrismaService } from '../prisma/prisma.service';
import { Auditoria } from '../common/servicios';
import { ActorActual, Permiso, Zod, fechaColombia, paginar, type Actor } from '../common/http';

type Tx = Prisma.TransactionClient;
type Datos = z.infer<typeof EsquemaDeclaracion>;

const Filtros = z.object({
  tipo: z.nativeEnum(TipoDeclaracion).optional(), clienteId: z.string().uuid().optional(), sucursalId: z.string().uuid().optional(),
  estado: z.nativeEnum(EstadoDeclaracion).optional(), activa: z.enum(['true', 'false']).optional(), numero: z.coerce.number().int().optional(),
  q: z.string().optional(), codigo: z.string().optional(), pagina: z.coerce.number().optional(), porPagina: z.coerce.number().optional(),
});
const CambioEstado = z.object({ estado: z.enum(['AUTORIZADA', 'RECHAZADA']), causalId: z.string().uuid().optional(), observacion: z.string().max(300).optional() });
const CambioActiva = z.object({ activa: z.boolean(), causalId: z.string().uuid().optional() });
const Tarifas = z.object({
  declaraciones: z.array(z.string().uuid()).min(1).max(2000),
  modo: z.enum(['porcentaje', 'fijo']), valor: z.number(), vigenteDesde: z.coerce.date(),
  tipoNegociacion: z.nativeEnum(TipoNegociacion).optional(), formaPago: z.nativeEnum(FormaPago).optional(),
});

const ServicioCatalogo = z.object({
  codigo: z.string().trim().toUpperCase().min(2).max(20), nombre: z.string().trim().min(3).max(200), lineaServicioId: z.string().uuid(),
  descripcion: z.string().trim().max(1000).optional(),
});
/** Asignación masiva (documentos reales, planilla DMR): los mismos servicios estándar para muchos clientes de una vez. */
const Asignacion = z.object({
  catalogoIds: z.array(z.string().uuid()).min(1).max(20),
  clienteIds: z.array(z.string().uuid()).min(1).max(500),
  alcanceSedes: z.enum(['TODAS', 'PRINCIPAL']).default('TODAS'),
  frecuenciaDias: z.number().int().min(1).max(366).optional(),
  solicitudAutomatica: z.boolean().default(false), // crea la solicitud cada «frecuenciaDias» (agrupada por sede y fecha)
  precio: z.object({ precioUnitario: z.number().nonnegative(), metricaId: z.string().uuid().nullish() }).optional(), // métrica vacía = GLOBAL
  autorizar: z.boolean().default(false),
}).refine((b) => b.catalogoIds.length * b.clienteIds.length <= 2000, { message: 'Máximo 2.000 declaraciones por asignación: divida los clientes en grupos.' })
  .refine((b) => !b.solicitudAutomatica || b.frecuenciaDias, { message: 'La solicitud automática necesita la frecuencia en días.', path: ['frecuenciaDias'] });

/** Cómo queda cubierta legalmente cada disposición de la declaración (misma regla que fn_disposicion_cubierta). */
export interface Cobertura { cubierto: boolean; mensaje: string; detalle: { codigo: string; nombre: string; cubierta: boolean; soporte: string }[] }

const hoy = () => fechaColombia();
const vigente = () => ({ vigenteDesde: { lte: hoy() }, OR: [{ vigenteHasta: null }, { vigenteHasta: { gte: hoy() } }] });

/** Relaciones que se devuelven en el listado. */
const resumen = {
  cliente: { select: { id: true, razonSocial: true, nit: true, tipo: true } },
  sucursales: { select: { activa: true, sucursal: { select: { id: true, codigo: true, nombre: true, municipioDane: true } } } },
  categoria: { select: { codigo: true, nombre: true } },
  lineaServicio: { select: { codigo: true, nombre: true, unidadNegocio: { select: { codigo: true, nombre: true, sigla: true } } } },
  codigoY: { select: { codigo: true } }, codigoA: { select: { codigo: true } },
  disposiciones: { select: { principal: true, disposicion: { select: { id: true, codigo: true, nombre: true } } } },
  riesgos: { select: { riesgo: { select: { codigo: true } } } },
  causal: { select: { nombre: true } },
} satisfies Prisma.DeclaracionInclude;

@Injectable()
export class DeclaracionesService {
  constructor(private readonly db: PrismaService, private readonly audit: Auditoria) {}

  async cobertura(empresaId: string, declaracionId: string, db: Tx | PrismaService = this.db): Promise<Cobertura> {
    const disp = await db.declaracionDisposicion.findMany({
      where: { declaracionId },
      include: { disposicion: { include: { proveedor: true, permisos: { include: { permiso: true } } } } },
    });
    if (!disp.length) return { cubierto: false, mensaje: 'La declaración no tiene disposición o manejo.', detalle: [] };
    const h = hoy();
    const detalle = disp.map(({ disposicion: d }) => {
      if (!d.activo) return { codigo: d.codigo, nombre: d.nombre, cubierta: false, soporte: 'Disposición inactiva' };
      if (!d.requierePermiso) return { codigo: d.codigo, nombre: d.nombre, cubierta: true, soporte: d.soporteLegal ?? 'Objeto social' };
      if (!d.propia) {
        const p = d.proveedor;
        const ok = !!p && !!p.licencia?.trim() && !!p.licenciaVence && p.licenciaVence >= h;
        return { codigo: d.codigo, nombre: d.nombre, cubierta: ok, soporte: ok ? `Licencia del gestor ${p!.razonSocial} (${p!.licencia}) hasta ${p!.licenciaVence!.toISOString().slice(0, 10)}` : 'El gestor aliado no tiene licencia registrada y vigente' };
      }
      const permiso = d.permisos.map((x) => x.permiso).find((p) => p.empresaId === empresaId && ['VIGENTE', 'POR_VENCER'].includes(p.estado) && (!p.vence || p.vence >= h));
      return { codigo: d.codigo, nombre: d.nombre, cubierta: !!permiso, soporte: permiso ? `${permiso.acto} (${permiso.autoridad})` : 'Ningún permiso vigente la ampara' };
    });
    const sin = detalle.filter((x) => !x.cubierta);
    return { cubierto: !sin.length, detalle, mensaje: sin.length ? `Ningún permiso o licencia vigente cubre: ${sin.map((x) => x.nombre).join(', ')}.` : `Cubierta por ${detalle.map((x) => x.soporte).join('; ')}.` };
  }

  async listar(a: Actor, f: z.infer<typeof Filtros>) {
    const { take, skip, pagina, porPagina } = paginar(f);
    const where: Prisma.DeclaracionWhereInput = {
      empresaId: a.empresaId, tipo: f.tipo, clienteId: f.clienteId, estado: f.estado, numero: f.numero,
      activa: f.activa ? f.activa === 'true' : undefined,
      sucursales: f.sucursalId ? { some: { sucursalId: f.sucursalId } } : undefined,
      nombre: f.q ? { contains: f.q, mode: 'insensitive' } : undefined,
      codigoInterno: f.codigo ? { contains: f.codigo, mode: 'insensitive' } : undefined,
    };
    const [total, filas] = await this.db.$transaction([
      this.db.declaracion.count({ where }),
      this.db.declaracion.findMany({ where, take, skip, orderBy: { numero: 'desc' }, include: { ...resumen, tarifas: { where: vigente(), orderBy: { vigenteDesde: 'desc' }, take: 1, include: { metrica: { select: { codigo: true, abreviacion: true } } } } } }),
    ]);
    return { total, pagina, porPagina, filas: filas.map(({ tarifas, ...d }) => ({ ...d, tarifaVigente: tarifas[0] ?? null })) };
  }

  async obtener(a: Actor, id: string) {
    const d = await this.db.declaracion.findFirst({
      where: { id, empresaId: a.empresaId },
      include: {
        ...resumen, tipoResiduo: true, catalogo: true, tipoEmbalaje: true, material: true, metricaDensidad: true,
        etiquetados: { include: { sistema: true } }, riesgos: { include: { riesgo: true } },
        codigoY: true, codigoA: true, tarifas: { orderBy: { vigenteDesde: 'desc' }, include: { metrica: true } },
      },
    });
    if (!d) throw new NotFoundException({ mensaje: 'Declaración no encontrada.' });
    return { ...d, cobertura: await this.cobertura(a.empresaId, id) };
  }

  /** Sedes según el alcance elegido. Verifica que sean del cliente. */
  private async sedes(tx: Tx, clienteId: string, b: Pick<Datos, 'alcanceSedes' | 'sucursalIds'>) {
    if (b.alcanceSedes === 'TODAS') return (await tx.sucursal.findMany({ where: { clienteId, activa: true }, select: { id: true } })).map((s) => s.id);
    if (b.alcanceSedes === 'PRINCIPAL') {
      const p = await tx.sucursal.findFirst({ where: { clienteId, esPrincipal: true }, select: { id: true } });
      if (!p) throw new BadRequestException({ mensaje: 'El cliente no tiene sede principal. Márquela o elija las sedes.' });
      return [p.id];
    }
    const ids = [...new Set(b.sucursalIds)];
    const n = await tx.sucursal.count({ where: { id: { in: ids }, clienteId } });
    if (n !== ids.length) throw new BadRequestException({ mensaje: 'Alguna sede no pertenece a ese cliente.' });
    return ids;
  }

  /** Columnas propias de la declaración a partir de los datos del formulario. */
  private columnas(b: Datos) {
    const { borrador: _b, sucursalIds: _s, disposiciones: _d, riesgoIds: _r, etiquetadoIds: _e, precio: _p, responsabilidadAceptada: _ra, ...resto } = b;
    return resto;
  }

  /** Crea una declaración completa (formulario de 8 secciones) en una sola transacción. */
  async crear(a: Actor, b: Datos, tx?: Tx, cargueId?: string) {
    const ejecutar = async (t: Tx) => {
      const cliente = await t.cliente.findFirst({ where: { id: b.clienteId, empresaId: a.empresaId } });
      if (!cliente) throw new BadRequestException({ mensaje: 'Cliente no encontrado.' });
      const sedes = await this.sedes(t, cliente.id, b);
      const d = await t.declaracion.create({ data: {
        ...this.columnas(b), empresaId: a.empresaId, estado: b.borrador ? 'BORRADOR' : 'PENDIENTE', creadoPorId: a.id, cargueId,
        responsabilidadAceptada: b.responsabilidadAceptada, aceptadaPorId: b.responsabilidadAceptada ? a.id : null, aceptadaEn: b.responsabilidadAceptada ? new Date() : null,
      } });
      await this.hijos(t, d.id, sedes, b);
      if (b.precio) await t.tarifa.create({ data: {
        declaracionId: d.id, precioUnitario: b.precio.precioUnitario, metricaId: b.precio.metricaId ?? null, vigenteDesde: hoy(), asignadoPorId: a.id,
        tipoNegociacion: b.precio.tipoNegociacion ?? cliente.tipoNegociacion, formaPago: b.precio.formaPago ?? cliente.formaPago,
      } });
      await this.audit.registrar(a, 'declaracion', d.id, 'CREAR', undefined, { numero: d.numero, estado: d.estado, cargueId }, t);
      return d;
    };
    return tx ? ejecutar(tx) : this.db.$transaction(ejecutar);
  }

  private async hijos(tx: Tx, declaracionId: string, sedes: string[], b: Datos) {
    if (sedes.length) await tx.declaracionSucursal.createMany({ data: sedes.map((sucursalId) => ({ declaracionId, sucursalId })) });
    if (b.disposiciones.length) {
      const hayPrincipal = b.disposiciones.some((x) => x.principal);
      await tx.declaracionDisposicion.createMany({ data: b.disposiciones.map((x, i) => ({ declaracionId, disposicionId: x.disposicionId, principal: hayPrincipal ? x.principal : i === 0 })) });
    }
    if (b.riesgoIds.length) await tx.declaracionRiesgo.createMany({ data: [...new Set(b.riesgoIds)].map((riesgoId) => ({ declaracionId, riesgoId })) });
    if (b.etiquetadoIds.length) await tx.declaracionEtiquetado.createMany({ data: [...new Set(b.etiquetadoIds)].map((sistemaId) => ({ declaracionId, sistemaId })) });
  }

  /** Autoriza o rechaza. Al autorizar se activa; la base vuelve a verificar la cobertura al confirmar. */
  async cambiarEstado(a: Actor, id: string, b: z.infer<typeof CambioEstado>) {
    const d = await this.db.declaracion.findFirst({ where: { id, empresaId: a.empresaId }, include: { _count: { select: { sucursales: true, disposiciones: true } }, tarifas: { where: vigente(), take: 1 } } });
    if (!d) throw new NotFoundException({ mensaje: 'Declaración no encontrada.' });
    if (d.estado === 'BORRADOR') throw new BadRequestException({ mensaje: 'La declaración está en borrador: el cliente debe enviarla primero.' });
    if (b.estado === 'AUTORIZADA') {
      const faltan = faltantesParaAutorizar({ tipo: d.tipo, esPeligroso: d.esPeligroso, fichaSeguridadUrl: d.fichaSeguridadUrl, sedes: d._count.sucursales, disposiciones: d._count.disposiciones, tarifaVigente: d.tarifas.length > 0 });
      if (faltan.length) throw new BadRequestException({ mensaje: `No se puede autorizar: ${faltan.join('; ')}.` });
      if (d.tipo === 'RESIDUO') {
        const c = await this.cobertura(a.empresaId, id);
        if (!c.cubierto) throw new ForbiddenException({ mensaje: `No se puede autorizar: ${c.mensaje} Revise el permiso ambiental o la licencia del gestor.`, cobertura: c });
      }
    }
    const autorizada = b.estado === 'AUTORIZADA';
    const nuevo = await this.db.declaracion.update({ where: { id }, data: {
      estado: b.estado, activa: autorizada, causalId: autorizada ? null : b.causalId ?? null,
      aprobadaPorId: autorizada ? a.id : null, aprobadaEn: autorizada ? new Date() : null,
      observaciones: b.observacion ?? d.observaciones,
    } });
    await this.audit.registrar(a, 'declaracion', id, `ESTADO_${b.estado}`, { estado: d.estado }, { estado: b.estado, observacion: b.observacion });
    return nuevo;
  }

  /** Activa o inactiva una declaración autorizada (p. ej., el cliente cambió de operador). */
  async cambiarActiva(a: Actor, id: string, b: z.infer<typeof CambioActiva>) {
    const d = await this.db.declaracion.findFirst({ where: { id, empresaId: a.empresaId } });
    if (!d) throw new NotFoundException({ mensaje: 'Declaración no encontrada.' });
    if (b.activa && d.estado !== 'AUTORIZADA') throw new BadRequestException({ mensaje: 'Solo se puede activar una declaración autorizada.' });
    if (!b.activa && !b.causalId) throw new BadRequestException({ mensaje: 'Indique la causal de inactivación.' });
    const r = await this.db.declaracion.update({ where: { id }, data: { activa: b.activa, causalId: b.activa ? null : b.causalId } });
    await this.audit.registrar(a, 'declaracion', id, b.activa ? 'ACTIVAR' : 'INACTIVAR', { activa: d.activa }, { activa: b.activa });
    return r;
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
        await tx.tarifa.create({ data: { declaracionId: d.id, precioUnitario: precio, metricaId: actual?.metricaId ?? null, tipoNegociacion: b.tipoNegociacion ?? actual?.tipoNegociacion ?? d.cliente.tipoNegociacion, formaPago: b.formaPago ?? actual?.formaPago ?? d.cliente.formaPago, vigenteDesde: b.vigenteDesde, loteAsignacionId: lote, asignadoPorId: a.id } });
      }
      await this.audit.registrar(a, 'tarifa', lote, 'ASIGNACION_MASIVA', undefined, { cantidad: decls.length, modo: b.modo, valor: b.valor }, tx);
    });
    return { lote, actualizadas: decls.length };
  }

  /** Servicios estándar del catálogo propio (alquiler de vacuum, trampas de grasa, fumigación…). */
  catalogoServicios(a: Actor) {
    return this.db.catalogoResiduo.findMany({ where: { empresaId: a.empresaId, tipo: 'SERVICIO', activo: true }, orderBy: { nombre: 'asc' },
      include: { lineaServicio: { select: { codigo: true, nombre: true } } } });
  }

  async crearServicioCatalogo(a: Actor, b: z.infer<typeof ServicioCatalogo>) {
    if (!(await this.db.lineaServicio.findFirst({ where: { id: b.lineaServicioId, empresaId: a.empresaId, activo: true } }))) throw new BadRequestException({ mensaje: 'Línea de servicio no encontrada.' });
    if (await this.db.catalogoResiduo.findFirst({ where: { empresaId: a.empresaId, codigo: b.codigo } })) throw new BadRequestException({ mensaje: `Ya existe un servicio con el código ${b.codigo}.` });
    const s = await this.db.catalogoResiduo.create({ data: {
      empresaId: a.empresaId, tipo: 'SERVICIO', codigo: b.codigo, nombre: b.nombre, lineaServicioId: b.lineaServicioId, valores: { descripcion: b.descripcion || b.nombre },
    }, include: { lineaServicio: { select: { codigo: true, nombre: true } } } });
    await this.audit.registrar(a, 'catalogo_residuo', s.id, 'CREAR', undefined, { codigo: s.codigo, nombre: s.nombre });
    return s;
  }

  /**
   * Asignación masiva: cada servicio elegido queda declarado para cada cliente, con los valores por defecto.
   * Omite (y explica) los clientes que ya lo tienen o que no tienen la sede pedida. Todo en una transacción.
   */
  async asignacionMasiva(a: Actor, b: z.infer<typeof Asignacion>) {
    if (b.autorizar && !a.permisos.includes('*') && !a.permisos.includes('declaraciones.autorizar')) throw new ForbiddenException({ mensaje: 'Su rol no autoriza declaraciones: asígnelas sin autorizar.' });
    if (b.autorizar && !b.precio) throw new BadRequestException({ mensaje: 'Para autorizar de una vez indique el precio (0 si se factura por contrato).' });
    const [servicios, clientes, categoria] = await Promise.all([
      this.db.catalogoResiduo.findMany({ where: { id: { in: b.catalogoIds }, empresaId: a.empresaId, tipo: 'SERVICIO', activo: true }, orderBy: { nombre: 'asc' } }),
      this.db.cliente.findMany({ where: { id: { in: b.clienteIds }, empresaId: a.empresaId }, orderBy: { razonSocial: 'asc' }, include: {
        sucursales: { where: { activa: true }, select: { id: true, esPrincipal: true } },
        declaraciones: { where: { catalogoId: { in: b.catalogoIds }, estado: { not: 'RECHAZADA' } }, select: { catalogoId: true } } } }),
      this.db.categoriaDeclarado.findFirst({ where: { empresaId: a.empresaId, codigo: 'SERV', activo: true } }),
    ]);
    if (servicios.length !== new Set(b.catalogoIds).size) throw new BadRequestException({ mensaje: 'Algún servicio no existe en el catálogo o está inactivo.' });
    if (clientes.length !== new Set(b.clienteIds).size) throw new BadRequestException({ mensaje: 'Algún cliente no existe o no es de su empresa.' });
    if (!categoria) throw new BadRequestException({ mensaje: 'Falta la categoría «SERV» (Servicios) en los catálogos.' });
    if (b.precio?.metricaId && !(await this.db.metrica.findFirst({ where: { id: b.precio.metricaId, empresaId: a.empresaId, uso: 'PRECIO', activo: true } })))
      throw new BadRequestException({ mensaje: 'Métrica de precio no encontrada.' });
    const omitidas: { cliente: string; servicio: string; motivo: string }[] = [];
    let creadas = 0, autorizadas = 0;
    await this.db.$transaction(async (tx) => {
      for (const c of clientes) {
        const sinSede = b.alcanceSedes === 'PRINCIPAL' ? !c.sucursales.some((s) => s.esPrincipal) : !c.sucursales.length;
        for (const s of servicios) {
          const omitir = (motivo: string) => omitidas.push({ cliente: c.razonSocial, servicio: s.nombre, motivo });
          if (sinSede) { omitir(b.alcanceSedes === 'PRINCIPAL' ? 'el cliente no tiene sede principal' : 'el cliente no tiene sedes activas'); continue; }
          if (c.declaraciones.some((d) => d.catalogoId === s.id)) { omitir('ya lo tiene declarado'); continue; }
          if (!s.lineaServicioId) { omitir('el servicio del catálogo no tiene línea de servicio'); continue; }
          const v = (s.valores ?? {}) as { descripcion?: string };
          const d = await this.crear(a, EsquemaDeclaracion.parse({
            tipo: 'SERVICIO', clienteId: c.id, alcanceSedes: b.alcanceSedes, nombre: s.nombre, catalogoId: s.id, categoriaId: categoria.id,
            lineaServicioId: s.lineaServicioId, frecuenciaDias: b.frecuenciaDias ?? null, solicitudAutomatica: b.solicitudAutomatica, descripcionServicio: v.descripcion || s.nombre,
            precio: b.precio ? { precioUnitario: b.precio.precioUnitario, metricaId: b.precio.metricaId ?? null } : null,
            responsabilidadAceptada: true, // la registra quien asigna, en nombre del cliente (queda en la auditoría)
          }), tx);
          creadas++;
          if (b.autorizar) {
            await tx.declaracion.update({ where: { id: d.id }, data: { estado: 'AUTORIZADA', activa: true, aprobadaPorId: a.id, aprobadaEn: new Date() } });
            autorizadas++;
          }
        }
      }
      await this.audit.registrar(a, 'declaracion', randomUUID(), 'ASIGNACION_MASIVA', undefined, { servicios: servicios.map((s) => s.codigo), clientes: clientes.length, creadas, autorizadas, omitidas: omitidas.length }, tx);
    }, { timeout: 180_000, maxWait: 10_000 });
    return { creadas, autorizadas, omitidas };
  }

  /** Listas del formulario de 8 secciones (solo activas). */
  async catalogos(a: Actor) {
    const e = { empresaId: a.empresaId, activo: true };
    const orden = { codigo: 'asc' } as const;
    const [categorias, tiposResiduo, lineas, metricas, tiposEmbalaje, materiales, disposiciones, riesgos, etiquetado, codigos, causales] = await Promise.all([
      this.db.categoriaDeclarado.findMany({ where: e, orderBy: orden }),
      this.db.tipoResiduo.findMany({ where: e, orderBy: orden }),
      this.db.lineaServicio.findMany({ where: e, orderBy: orden, include: { unidadNegocio: { select: { codigo: true, nombre: true, sigla: true } } } }),
      this.db.metrica.findMany({ where: e, orderBy: orden }),
      this.db.tipoEmbalaje.findMany({ where: e, orderBy: { nombre: 'asc' } }),
      this.db.materialEmbalaje.findMany({ where: e, orderBy: { nombre: 'asc' } }),
      this.db.disposicion.findMany({ where: e, orderBy: orden, select: { id: true, codigo: true, nombre: true, requierePermiso: true, propia: true, soporteLegal: true } }),
      this.db.riesgo.findMany({ orderBy: orden }),
      this.db.sistemaEtiquetado.findMany({ orderBy: orden }),
      this.db.codigoClasificacion.findMany({ where: { activo: true }, orderBy: orden }),
      this.db.catalogoItem.findMany({ where: { ...e, tipo: 'CAUSAL' }, orderBy: { nombre: 'asc' } }),
    ]);
    return {
      categorias, tiposResiduo, lineas, tiposEmbalaje, materiales, disposiciones, riesgos, etiquetado, causales,
      metricasPrecio: metricas.filter((m) => m.uso === 'PRECIO'), metricasDensidad: metricas.filter((m) => m.uso === 'DENSIDAD'),
      corrientesY: codigos.filter((c) => c.tipo === 'Y'), codigosA: codigos.filter((c) => c.tipo === 'A'),
    };
  }
}

@Controller('declaraciones')
class DeclaracionesController {
  constructor(private readonly s: DeclaracionesService) {}
  @Get() listar(@ActorActual() a: Actor, @Query(new Zod(Filtros)) f: z.infer<typeof Filtros>) { return this.s.listar(a, f); }
  @Get('catalogos') catalogos(@ActorActual() a: Actor) { return this.s.catalogos(a); }
  @Get('catalogo-servicios') catalogoServicios(@ActorActual() a: Actor) { return this.s.catalogoServicios(a); }
  @Permiso('declaraciones.crear') @Post('catalogo-servicios') crearServicio(@ActorActual() a: Actor, @Body(new Zod(ServicioCatalogo)) b: z.infer<typeof ServicioCatalogo>) { return this.s.crearServicioCatalogo(a, b); }
  @Permiso('declaraciones.crear') @Post('asignacion-masiva') asignacion(@ActorActual() a: Actor, @Body(new Zod(Asignacion)) b: z.infer<typeof Asignacion>) { return this.s.asignacionMasiva(a, b); }
  @Get(':id') obtener(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.obtener(a, id); }
  @Permiso('declaraciones.crear') @Post() crear(@ActorActual() a: Actor, @Body(new Zod(EsquemaDeclaracion)) b: Datos) { return this.s.crear(a, b); }
  @Permiso('declaraciones.autorizar') @Patch(':id/estado') estado(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(CambioEstado)) b: z.infer<typeof CambioEstado>) { return this.s.cambiarEstado(a, id, b); }
  @Permiso('declaraciones.autorizar') @Patch(':id/activa') activa(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(CambioActiva)) b: z.infer<typeof CambioActiva>) { return this.s.cambiarActiva(a, id, b); }
  @Permiso('tarifas.asignar') @Post('tarifas/masivas') tarifas(@ActorActual() a: Actor, @Body(new Zod(Tarifas)) b: z.infer<typeof Tarifas>) { return this.s.tarifasMasivas(a, b); }
}

@Module({ controllers: [DeclaracionesController], providers: [DeclaracionesService], exports: [DeclaracionesService] })
export class DeclaracionesModule {}
