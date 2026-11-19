import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { EstadoDeclaracion, FormaPago, Prisma, TipoDeclaracion, TipoNegociacion, type Proveedor } from '@prisma/client';
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
  peligroso: z.enum(['true', 'false']).optional(), // Los Pinos solo recibe residuos no peligrosos
});
const CambioEstado = z.object({ estado: z.enum(['AUTORIZADA', 'RECHAZADA']), causalId: z.string().uuid().optional(), observacion: z.string().max(300).optional() });
const CambioActiva = z.object({ activa: z.boolean(), causalId: z.string().uuid().optional() });
const ConsultaCobertura = z.object({
  disposiciones: z.string().transform((s) => s.split(',').filter(Boolean)).pipe(z.array(z.string().uuid()).max(20)),
  peligroso: z.enum(['true', 'false']).optional(), hidrocarburos: z.enum(['true', 'false']).optional(), caracterizacion: z.enum(['true', 'false']).optional(),
  tipoResiduoId: z.string().uuid().optional(),
});
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

/** Cómo queda cubierta legalmente cada disposición de la declaración (mismas reglas que fn_decl_autorizacion_check). */
export interface Cobertura { cubierto: boolean; mensaje: string; detalle: { codigo: string; nombre: string; cubierta: boolean; soporte: string }[] }
/** Lo que la cobertura necesita saber de la declaración. */
export interface ContextoCobertura { esPeligroso: boolean; contieneHidrocarburos: boolean; caracterizacion: boolean; tipoResiduoCodigo: string | null }

const ANULADA = 'La declaración está anulada (se deshizo el cargue que la creó)';
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
  cargue: { select: { archivo: true, revertidoEn: true, motivoReversion: true } }, // explica una anulada (cargue deshecho)
} satisfies Prisma.DeclaracionInclude;

@Injectable()
export class DeclaracionesService {
  constructor(private readonly db: PrismaService, private readonly audit: Auditoria) {}

  async cobertura(empresaId: string, declaracionId: string, db: Tx | PrismaService = this.db): Promise<Cobertura> {
    const d = await db.declaracion.findUniqueOrThrow({ where: { id: declaracionId }, select: {
      esPeligroso: true, contieneHidrocarburos: true, caracterizacionUrl: true, tipoResiduo: { select: { codigo: true } },
      disposiciones: { select: { disposicionId: true } } } });
    return this.coberturaDisposiciones(empresaId, d.disposiciones.map((x) => x.disposicionId), db, {
      esPeligroso: d.esPeligroso, contieneHidrocarburos: d.contieneHidrocarburos, caracterizacion: !!d.caracterizacionUrl?.trim(), tipoResiduoCodigo: d.tipoResiduo?.codigo ?? null });
  }

  /**
   * Cobertura legal de una lista de disposiciones (el formulario la muestra en vivo, antes de guardar). Mismas reglas que la
   * base (fn_decl_autorizacion_check): permiso o licencia vigente; un residuo peligroso nunca con tratamiento propio en Los
   * Pinos (Res. DGL 000632 de 2023, art. 6); hidrocarburos; y que algún gestor aliado vigente reciba ese tipo de residuo.
   */
  async coberturaDisposiciones(empresaId: string, ids: string[], db: Tx | PrismaService = this.db, ctx?: ContextoCobertura): Promise<Cobertura> {
    const disps = ids.length ? await db.disposicion.findMany({
      where: { id: { in: ids }, empresaId },
      include: { gestores: { include: { proveedor: true } }, permisos: { include: { permiso: true } } },
    }) : [];
    if (!disps.length) return { cubierto: false, mensaje: 'La declaración no tiene disposición o manejo.', detalle: [] };
    const h = hoy();
    const aliadoVigente = (p: Proveedor) => !!p.licencia?.trim() && (p.licenciaIndefinida || (!!p.licenciaVence && p.licenciaVence >= h));
    const detalle = disps.map((d) => {
      const no = (soporte: string) => ({ codigo: d.codigo, nombre: d.nombre, cubierta: false, soporte });
      const si = (soporte: string) => ({ codigo: d.codigo, nombre: d.nombre, cubierta: true, soporte });
      if (!d.activo) return no(`Inactiva${d.soporteLegal ? `: ${d.soporteLegal}` : ''}`);
      if (ctx?.esPeligroso && !d.admitePeligrosos) return no('Solo admite residuos sin características de peligrosidad (Res. DGL 000632 de 2023, art. 6): los peligrosos van directo a un gestor aliado');
      if (ctx?.contieneHidrocarburos && d.hidrocarburos === 'NO_ADMITE') return no('No admite residuos con hidrocarburos');
      if (ctx?.contieneHidrocarburos && d.hidrocarburos === 'CON_CARACTERIZACION' && !ctx.caracterizacion) return no('Con hidrocarburos solo se admite con la caracterización de peligrosidad (CRETIB) negativa cargada');
      if (!d.requierePermiso) return si(d.soporteLegal ?? 'Objeto social');
      if (!d.propia) {
        const vigentes = d.gestores.map((g) => g.proveedor).filter(aliadoVigente);
        const aceptan = ctx?.tipoResiduoCodigo ? vigentes.filter((p) => !p.excluyeTiposResiduo.includes(ctx.tipoResiduoCodigo!)) : vigentes;
        if (aceptan.length) return si(aceptan.map((p) => `${p.razonSocial} (${p.licencia}; ${p.licenciaIndefinida ? 'vigencia indefinida' : `hasta ${p.licenciaVence!.toISOString().slice(0, 10)}`})`).join(' · '));
        return no(!d.gestores.length ? 'No hay gestor aliado registrado' : vigentes.length ? 'Ningún gestor aliado vigente recibe este tipo de residuo'
          : 'Ningún gestor aliado tiene la licencia registrada y vigente (falta la vigencia o venció)');
      }
      const permiso = d.permisos.map((x) => x.permiso).find((p) => p.empresaId === empresaId && ['VIGENTE', 'POR_VENCER'].includes(p.estado) && (!p.vence || p.vence >= h));
      return permiso ? si(`${permiso.acto} (${permiso.autoridad})`) : no('Ningún permiso vigente la ampara');
    });
    const sin = detalle.filter((x) => !x.cubierta);
    return { cubierto: !sin.length, detalle, mensaje: sin.length ? `No queda cubierta: ${sin.map((x) => `${x.nombre} (${x.soporte})`).join('; ')}.` : `Cubierta por ${detalle.map((x) => x.soporte).join('; ')}.` };
  }

  /** Contexto de cobertura para el formulario (antes de guardar): peligrosidad, hidrocarburos y tipo de residuo. */
  async contextoCobertura(a: Actor, q: z.infer<typeof ConsultaCobertura>): Promise<ContextoCobertura> {
    const tipo = q.tipoResiduoId ? await this.db.tipoResiduo.findFirst({ where: { id: q.tipoResiduoId, empresaId: a.empresaId }, select: { codigo: true } }) : null;
    return { esPeligroso: q.peligroso === 'true', contieneHidrocarburos: q.hidrocarburos === 'true', caracterizacion: q.caracterizacion === 'true', tipoResiduoCodigo: tipo?.codigo ?? null };
  }

  async listar(a: Actor, f: z.infer<typeof Filtros>) {
    const { take, skip, pagina, porPagina } = paginar(f);
    const where: Prisma.DeclaracionWhereInput = {
      empresaId: a.empresaId, tipo: f.tipo, clienteId: f.clienteId, numero: f.numero,
      estado: f.estado ?? { not: 'ANULADA' }, // las anuladas (cargue deshecho) solo con el filtro «Anulada»
      activa: f.activa ? f.activa === 'true' : undefined,
      esPeligroso: f.peligroso ? f.peligroso === 'true' : undefined,
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
        aceptadaPor: { select: { nombre: true } }, aprobadaPor: { select: { nombre: true } }, creadoPor: { select: { nombre: true } },
        cargue: { select: { id: true, archivo: true, creadoEn: true, estado: true, revertidoEn: true, motivoReversion: true, revertidoPor: { select: { nombre: true } } } },
      },
    });
    if (!d) throw new NotFoundException({ mensaje: 'Declaración no encontrada.' });
    const h = hoy();
    const tarifaVigente = d.tarifas.find((t) => t.vigenteDesde <= h && (!t.vigenteHasta || t.vigenteHasta >= h)) ?? null;
    return { ...d, tarifaVigente, cobertura: await this.cobertura(a.empresaId, id) };
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

  /**
   * Edita una declaración desde el formulario de 8 secciones. No cambia el cliente ni el tipo.
   * - Borrador, pendiente o rechazada: queda en borrador o vuelve a revisión (pendiente).
   * - Autorizada: si la edita quien puede autorizar, sigue autorizada y se revisa de nuevo su cobertura legal; si la edita
   *   otro rol, o el cambio es crítico (peligrosidad, corriente, hidrocarburos, disposición, sedes o unidad de medida),
   *   vuelve a «pendiente» (inactiva) y la autoriza otra persona (respuesta D2 de la gerencia).
   * - El precio nunca se sobrescribe: un cambio crea una vigencia nueva desde hoy (el mismo día, corrige la de hoy).
   */
  async editar(a: Actor, id: string, b: Datos) {
    const puedeAutorizar = a.permisos.includes('*') || a.permisos.includes('declaraciones.autorizar');
    return this.db.$transaction(async (t) => {
      const d = await t.declaracion.findFirst({ where: { id, empresaId: a.empresaId }, include: {
        cliente: true, sucursales: true, disposiciones: true,
        tarifas: { where: vigente(), orderBy: { vigenteDesde: 'desc' }, take: 1 },
      } });
      if (!d) throw new NotFoundException({ mensaje: 'Declaración no encontrada.' });
      if (d.estado === 'ANULADA') throw new BadRequestException({ mensaje: `${ANULADA}: no se modifica. Cree una nueva.` });
      if (b.clienteId !== d.clienteId) throw new BadRequestException({ mensaje: 'No se puede cambiar el cliente de una declaración: cree una nueva para el otro cliente.' });
      if (b.tipo !== d.tipo) throw new BadRequestException({ mensaje: 'No se puede cambiar el tipo (residuo o servicio) de una declaración.' });
      const autorizada = d.estado === 'AUTORIZADA';
      if (autorizada && b.borrador) throw new BadRequestException({ mensaje: 'Una declaración autorizada no vuelve a borrador.' });
      const sedes = await this.sedes(t, d.clienteId, b);
      const hayPrincipal = b.disposiciones.some((x) => x.principal);
      const disp = b.disposiciones.map((x, i) => ({ disposicionId: x.disposicionId, principal: hayPrincipal ? x.principal : i === 0 }));
      const actual = d.tarifas[0];

      // Respuesta D2 de la gerencia: un cambio crítico devuelve la declaración autorizada a revisión aunque lo haga HSEQ, y
      // la autoriza otra persona (la base lo exige con chk_decl_cuatro_ojos). Los demás cambios de quien autoriza la dejan autorizada.
      const firma = (xs: { disposicionId: string; principal: boolean }[]) => JSON.stringify(xs.map((x) => `${x.disposicionId}:${x.principal}`).sort());
      const mismas = (x: string[], y: string[]) => x.length === y.length && x.every((v) => y.includes(v));
      const criticos = [
        d.esPeligroso !== b.esPeligroso && 'la peligrosidad',
        ((d.codigoYId ?? null) !== (b.codigoYId ?? null) || (d.codigoAId ?? null) !== (b.codigoAId ?? null)) && 'la corriente Y/A',
        (d.contieneHidrocarburos !== b.contieneHidrocarburos || (d.caracterizacionUrl ?? null) !== (b.caracterizacionUrl ?? null)) && 'los hidrocarburos o su caracterización',
        firma(d.disposiciones) !== firma(disp) && 'la disposición o tratamiento',
        (d.alcanceSedes !== b.alcanceSedes || !mismas(d.sucursales.map((s) => s.sucursalId), sedes)) && 'el generador o las sedes',
        !!b.precio && !!actual && (actual.metricaId ?? null) !== (b.precio.metricaId ?? null) && 'la unidad de medida',
      ].filter(Boolean) as string[];
      const sigueAutorizada = autorizada && puedeAutorizar && !criticos.length;
      const vuelveARevision = autorizada && !sigueAutorizada;
      const estado = sigueAutorizada ? 'AUTORIZADA' : b.borrador ? 'BORRADOR' : 'PENDIENTE';

      // Qué columnas cambian (para la auditoría)
      const cols = this.columnas(b) as Record<string, unknown>;
      const norm = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : Prisma.Decimal.isDecimal(v) ? Number(v) : v);
      const previo = d as unknown as Record<string, unknown>;
      const cambiados = Object.keys(cols).filter((k) => JSON.stringify(norm(previo[k])) !== JSON.stringify(norm(cols[k])));

      // Responsabilidad: se conserva quién la aceptó primero; desmarcarla solo es posible en borrador
      const responsabilidad = b.responsabilidadAceptada
        ? (d.responsabilidadAceptada ? {} : { responsabilidadAceptada: true, aceptadaPorId: a.id, aceptadaEn: new Date() })
        : { responsabilidadAceptada: false, aceptadaPorId: null, aceptadaEn: null };
      await t.declaracion.update({ where: { id }, data: {
        ...this.columnas(b), ...responsabilidad, estado,
        ...(b.borrador ? {} : { origenFase1: false }), // completa: deja de ser «convertida de la fase 1»
        ...(sigueAutorizada ? {} : { activa: false, aprobadaPorId: null, aprobadaEn: null, causalId: null }),
        ...(vuelveARevision ? { revisionPedidaPorId: a.id } : {}),
      } });

      // Sedes: quita las que ya no van y agrega las nuevas (las que siguen conservan si están suspendidas)
      const sedesAntes = new Set(d.sucursales.map((s) => s.sucursalId)), sedesDespues = new Set(sedes);
      const sedesQuitar = [...sedesAntes].filter((s) => !sedesDespues.has(s)), sedesAgregar = [...sedesDespues].filter((s) => !sedesAntes.has(s));
      if (sedesQuitar.length) await t.declaracionSucursal.deleteMany({ where: { declaracionId: id, sucursalId: { in: sedesQuitar } } });
      if (sedesAgregar.length) await t.declaracionSucursal.createMany({ data: sedesAgregar.map((sucursalId) => ({ declaracionId: id, sucursalId })) });

      // Disposiciones: la marcada (o la primera) es la principal
      const dispAntes = new Map(d.disposiciones.map((x) => [x.disposicionId, x.principal]));
      const dispQuitar = [...dispAntes.keys()].filter((k) => !disp.some((x) => x.disposicionId === k));
      if (dispQuitar.length) await t.declaracionDisposicion.deleteMany({ where: { declaracionId: id, disposicionId: { in: dispQuitar } } });
      for (const x of disp) {
        if (!dispAntes.has(x.disposicionId)) await t.declaracionDisposicion.create({ data: { declaracionId: id, ...x } });
        else if (dispAntes.get(x.disposicionId) !== x.principal) await t.declaracionDisposicion.update({ where: { declaracionId_disposicionId: { declaracionId: id, disposicionId: x.disposicionId } }, data: { principal: x.principal } });
      }
      // Riesgos y sistemas de etiquetado: se reemplazan
      await t.declaracionRiesgo.deleteMany({ where: { declaracionId: id } });
      if (b.riesgoIds.length) await t.declaracionRiesgo.createMany({ data: [...new Set(b.riesgoIds)].map((riesgoId) => ({ declaracionId: id, riesgoId })) });
      await t.declaracionEtiquetado.deleteMany({ where: { declaracionId: id } });
      if (b.etiquetadoIds.length) await t.declaracionEtiquetado.createMany({ data: [...new Set(b.etiquetadoIds)].map((sistemaId) => ({ declaracionId: id, sistemaId })) });

      // Precio: solo si cambió. Nueva vigencia desde hoy; si la vigente empezó hoy, se corrige esa misma
      let precioCambio = false;
      if (b.precio) {
        const p = {
          precioUnitario: b.precio.precioUnitario, metricaId: b.precio.metricaId ?? null,
          tipoNegociacion: b.precio.tipoNegociacion ?? actual?.tipoNegociacion ?? d.cliente.tipoNegociacion,
          formaPago: b.precio.formaPago ?? actual?.formaPago ?? d.cliente.formaPago,
        };
        precioCambio = !actual || Number(actual.precioUnitario) !== p.precioUnitario || actual.metricaId !== p.metricaId
          || actual.tipoNegociacion !== p.tipoNegociacion || actual.formaPago !== p.formaPago;
        if (precioCambio) {
          const h = hoy();
          if (actual && actual.vigenteDesde >= h) await t.tarifa.update({ where: { id: actual.id }, data: { ...p, asignadoPorId: a.id } });
          else {
            const ayer = new Date(h.getTime() - 86_400_000);
            if (actual) await t.tarifa.update({ where: { id: actual.id }, data: { vigenteHasta: ayer } });
            // Si ya hay un cambio programado a futuro (asignación masiva), la nueva vigencia termina el día antes
            const futura = await t.tarifa.findFirst({ where: { declaracionId: id, vigenteDesde: { gt: h } }, orderBy: { vigenteDesde: 'asc' } });
            await t.tarifa.create({ data: { declaracionId: id, ...p, vigenteDesde: h, vigenteHasta: futura ? new Date(futura.vigenteDesde.getTime() - 86_400_000) : null, asignadoPorId: a.id } });
          }
        }
      }

      // Autorizada que sigue autorizada: debe quedar completa y con cobertura legal (la base lo vuelve a revisar al confirmar)
      if (sigueAutorizada) {
        const conPrecio = await t.tarifa.count({ where: { declaracionId: id, ...vigente() } });
        const faltan = faltantesParaAutorizar({ tipo: d.tipo, esPeligroso: b.esPeligroso, fichaSeguridadUrl: b.fichaSeguridadUrl ?? null, sedes: sedes.length, disposiciones: disp.length, tarifaVigente: conPrecio > 0 });
        if (faltan.length) throw new BadRequestException({ mensaje: `La declaración está autorizada y quedaría incompleta: ${faltan.join('; ')}.` });
        if (d.tipo === 'RESIDUO') {
          const c = await this.cobertura(a.empresaId, id, t);
          if (!c.cubierto) throw new ForbiddenException({ mensaje: `No se puede guardar: ${c.mensaje} Revise el permiso ambiental o la licencia del gestor.`, cobertura: c });
        }
      }

      await this.audit.registrar(a, 'declaracion', id, 'EDITAR',
        { estado: d.estado, activa: d.activa, ...Object.fromEntries(cambiados.map((k) => [k, norm(previo[k])])),
          sedes: d.sucursales.length, disposiciones: d.disposiciones.length, ...(precioCambio ? { precio: actual ? Number(actual.precioUnitario) : null } : {}) },
        { estado, ...Object.fromEntries(cambiados.map((k) => [k, norm(cols[k])])), sedes: sedes.length, disposiciones: disp.length,
          ...(precioCambio ? { precio: b.precio?.precioUnitario ?? null } : {}),
          ...(vuelveARevision ? { nota: criticos.length ? `Cambio crítico (${criticos.join(', ')}): vuelve a revisión y la autoriza otra persona` : 'Editada por un rol que no autoriza: vuelve a revisión' } : {}) }, t);
      return { ...(await t.declaracion.findUniqueOrThrow({ where: { id } })), cambiosCriticos: vuelveARevision ? criticos : [] };
    });
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
    if (d.estado === 'ANULADA') throw new BadRequestException({ mensaje: `${ANULADA}: no se autoriza ni se rechaza.` });
    if (b.estado === 'AUTORIZADA') {
      if (d.revisionPedidaPorId === a.id)
        throw new ForbiddenException({ mensaje: 'Esta declaración volvió a revisión por un cambio crítico que hizo usted: la debe autorizar otra persona con ese permiso.' });
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
    if (d.estado === 'ANULADA') throw new BadRequestException({ mensaje: `${ANULADA}: no se activa ni se inactiva.` });
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
    const anuladas = decls.filter((d) => d.estado === 'ANULADA').map((d) => `N.° ${d.numero}`);
    if (anuladas.length) throw new BadRequestException({ mensaje: `Declaraciones anuladas (cargue deshecho): ${anuladas.slice(0, 10).join(', ')}. Quítelas de la selección.` });
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
        declaraciones: { where: { catalogoId: { in: b.catalogoIds }, estado: { notIn: ['RECHAZADA', 'ANULADA'] } }, select: { catalogoId: true } } } }),
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
  @Get('cobertura') async coberturaDe(@ActorActual() a: Actor, @Query(new Zod(ConsultaCobertura)) q: z.infer<typeof ConsultaCobertura>) {
    return this.s.coberturaDisposiciones(a.empresaId, q.disposiciones, undefined, await this.s.contextoCobertura(a, q));
  }
  @Get(':id') obtener(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.obtener(a, id); }
  @Permiso('declaraciones.crear') @Post() crear(@ActorActual() a: Actor, @Body(new Zod(EsquemaDeclaracion)) b: Datos) { return this.s.crear(a, b); }
  @Permiso('declaraciones.crear') @Put(':id') editar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(EsquemaDeclaracion)) b: Datos) { return this.s.editar(a, id, b); }
  @Permiso('declaraciones.autorizar') @Patch(':id/estado') estado(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(CambioEstado)) b: z.infer<typeof CambioEstado>) { return this.s.cambiarEstado(a, id, b); }
  @Permiso('declaraciones.autorizar') @Patch(':id/activa') activa(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(CambioActiva)) b: z.infer<typeof CambioActiva>) { return this.s.cambiarActiva(a, id, b); }
  @Permiso('tarifas.asignar') @Post('tarifas/masivas') tarifas(@ActorActual() a: Actor, @Body(new Zod(Tarifas)) b: z.infer<typeof Tarifas>) { return this.s.tarifasMasivas(a, b); }
}

@Module({ controllers: [DeclaracionesController], providers: [DeclaracionesService], exports: [DeclaracionesService] })
export class DeclaracionesModule {}
