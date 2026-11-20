// Módulo Comercial (reemplaza a Bigin; requisitos de producción 7.3).
// - Prospectos (empresas que pueden volverse clientes) con sus contactos; oportunidades por etapas; actividades y tareas.
// - Cotizaciones: se editan en borrador; al enviarlas toman número (COT-AAAA-NNNN), PDF con QR de verificación y copia
//   fija, y ya no cambian (regla en la base). La respuesta del cliente (aceptada o rechazada) se registra una vez.
// - Ganar una oportunidad crea el cliente con su sede principal y vuelve cada renglón de la cotización aceptada una
//   declaración con su tarifa: los servicios quedan para autorizar y los residuos en borrador (falta su caracterización).
// - El formulario del sitio web crea el prospecto, la oportunidad y la tarea de responder (con aviso a Comercial).
// - Importación de Bigin (CSV de empresas, contactos y negocios): primero muestra qué haría y luego lo hace; volver a
//   importar no duplica (se reconoce por el id de Bigin, el NIT o el nombre).
// Lo ven Comercial y Gerencia (permiso «comercial.gestionar»); el portal de clientes no lee estas tablas (RLS).
import {
  BadRequestException, Body, ConflictException, Controller, Get, Global, HttpCode, Injectable, Logger, Module, NotFoundException, Param, ParseUUIDPipe,
  Patch, Post, Query, StreamableFile, UploadedFiles, UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { EtapaOportunidad, FormaPago, OrigenProspecto, Prisma, TipoActividad, TipoCliente, TipoNegociacion } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { EsquemaDeclaracion, SECTORES, dvNit, sectorDe } from '@terraviva/shared';
import { PrismaService } from '../prisma/prisma.service';
import { Archivos } from '../common/archivos';
import { Auditoria, Correo } from '../common/servicios';
import { ActorActual, LimiteCredenciales, Permiso, Publico, Zod, fechaColombia, paginar, type Actor } from '../common/http';
import { DeclaracionesModule, DeclaracionesService } from '../declaraciones/declaraciones.module';
import type { Config } from '../config';
import type { Alerta } from '../permisos/cumplimiento.module';
import { leerContactos, leerEmpresas, leerNegocios, nombreEmpresa, normalizar, type ErrorBigin } from './bigin';
import { pdfCotizacion, type ContenidoCotizacion } from './cotizacion.pdf';

const ABIERTAS = ['NUEVA', 'CONTACTADA', 'COTIZADA', 'NEGOCIACION'] as const;
const DIA = 86_400_000;
/** Asunto de la tarea que crea el formulario del sitio web (cuenta en las alertas mientras no se haga). */
export const RESPONDER_WEB = 'Responder la solicitud del sitio web';
const NEGOCIACION: Record<TipoNegociacion, string> = { COBRO: 'cobro por la gestión', COMPRA: 'compra del material (aprovechables)', SIN_COSTO: 'sin costo', CONTRATO: 'por contrato' };
const PAGO: Record<FormaPago, string> = { CONTADO: 'de contado', CREDITO_30: 'crédito a 30 días', CREDITO_60: 'crédito a 60 días', CREDITO_90: 'crédito a 90 días' };

// ---------------- Datos de entrada ----------------
/** Texto opcional: '' borra el valor (null). */
const texto = (max: number) => z.string().trim().max(max).transform((s) => s || null).nullish();
const nitOpc = z.string().trim().regex(/^\d{6,10}$/, 'NIT sin puntos ni DV (6 a 10 dígitos)').or(z.literal('').transform(() => null)).nullish();
const correoOpc = z.string().trim().toLowerCase().email('Correo inválido').max(150).or(z.literal('').transform(() => null)).nullish();
const dane = z.string().regex(/^\d{5}$/, 'Código DANE de 5 dígitos').or(z.literal('').transform(() => null)).nullish();

const DatosContacto = z.object({ nombre: z.string().trim().min(2).max(150), cargo: texto(100), telefono: texto(30), correo: correoOpc, principal: z.boolean().optional() });
const DatosProspecto = z.object({
  razonSocial: z.string().trim().min(2).max(200), nit: nitOpc, sector: texto(60), municipioDane: dane, direccion: texto(300), telefono: texto(30),
  correo: correoOpc, sitioWeb: texto(200), representanteLegal: texto(150), origen: z.nativeEnum(OrigenProspecto).default('OTRO'),
  asesorId: z.string().uuid().nullish(), notas: texto(4000),
});
const NuevoProspecto = DatosProspecto.extend({ contacto: DatosContacto.omit({ principal: true }).optional() });
const EditarProspecto = DatosProspecto.partial().extend({ activo: z.boolean().optional() });
const EditarContacto = DatosContacto.partial().extend({ activo: z.boolean().optional() });
const FiltroProspectos = z.object({ q: z.string().trim().max(80).optional(), origen: z.nativeEnum(OrigenProspecto).optional(), pagina: z.coerce.number().optional(), porPagina: z.coerce.number().optional() });

const NuevaOportunidad = z.object({
  prospectoId: z.string().uuid().optional(), clienteId: z.string().uuid().optional(), // desde un cliente existente (ampliar sus servicios)
  titulo: z.string().trim().min(2).max(200), valorMensual: z.number().nonnegative().max(1e13).nullish(), cierreEstimado: z.coerce.date().nullish(),
  asesorId: z.string().uuid().nullish(), contactoId: z.string().uuid().nullish(), notas: texto(4000),
}).refine((b) => !!b.prospectoId !== !!b.clienteId, { message: 'Indique el prospecto o el cliente (uno de los dos).' });
const EditarOportunidad = z.object({
  titulo: z.string().trim().min(2).max(200).optional(), etapa: z.enum(ABIERTAS).optional(), valorMensual: z.number().nonnegative().max(1e13).nullish(),
  cierreEstimado: z.coerce.date().nullish(), asesorId: z.string().uuid().nullish(), contactoId: z.string().uuid().nullish(), notas: texto(4000),
});
const Perder = z.object({ motivo: z.string().trim().min(3, 'Escriba por qué se perdió (al menos 3 letras).').max(300) });
const FiltroEmbudo = z.object({ asesorId: z.string().uuid().optional(), q: z.string().trim().max(80).optional() });

const NuevaActividad = z.object({
  prospectoId: z.string().uuid().optional(), oportunidadId: z.string().uuid().optional(), tipo: z.nativeEnum(TipoActividad),
  asunto: z.string().trim().min(2).max(200), detalle: texto(4000), venceEn: z.coerce.date().nullish(), responsableId: z.string().uuid().nullish(),
}).refine((b) => b.prospectoId || b.oportunidadId, { message: 'Indique el prospecto o la oportunidad.' })
  .refine((b) => b.tipo !== 'TAREA' || b.venceEn, { message: 'Una tarea necesita su fecha.', path: ['venceEn'] });
const Completar = z.object({ resultado: texto(2000) });
const FiltroTareas = z.object({ todas: z.enum(['true', 'false']).optional() });

const ItemCotizacion = z.object({
  tipo: z.enum(['RESIDUO', 'SERVICIO']), catalogoId: z.string().uuid().nullish(), descripcion: z.string().trim().min(2).max(300),
  categoriaId: z.string().uuid().nullish(), lineaServicioId: z.string().uuid().nullish(), disposicionId: z.string().uuid().nullish(),
  esPeligroso: z.boolean().default(false), metricaId: z.string().uuid().nullish(), cantidadEstimada: z.number().positive().max(1e9).nullish(),
  frecuencia: texto(60), precioUnitario: z.number().nonnegative().max(1e12),
});
const DatosCotizacion = z.object({
  validezDias: z.number().int().min(1).max(365).default(30), tipoNegociacion: z.nativeEnum(TipoNegociacion).default('COBRO'),
  formaPago: z.nativeEnum(FormaPago).default('CONTADO'), condiciones: texto(4000),
  items: z.array(ItemCotizacion).min(1, 'Agregue al menos un renglón.').max(60),
});
const Responder = z.object({ aceptada: z.boolean(), motivo: texto(300) });
const Ganar = z.object({
  cotizacionId: z.string().uuid().nullish(), // sus renglones se vuelven declaraciones con tarifa
  cliente: z.object({
    nit: z.string().trim().regex(/^\d{6,10}$/, 'NIT sin puntos ni DV (6 a 10 dígitos)'), razonSocial: z.string().trim().min(2).max(200),
    representanteLegal: z.string().trim().min(3, 'Escriba el representante legal (si es persona natural, su propio nombre).').max(150),
    sector: texto(60), tipo: z.nativeEnum(TipoCliente).default('DIRECTO'), emailFacturacion: correoOpc,
  }).optional(),
  sede: z.object({ nombre: z.string().trim().min(2).max(150), direccion: texto(300), municipioDane: dane, contacto: texto(150), telefono: texto(20), emails: texto(200) }).optional(),
});
const FormularioWeb = z.object({
  empresa: z.string().trim().min(2, 'Escriba el nombre de la empresa.').max(200), nit: nitOpc, nombre: z.string().trim().min(2, 'Escriba su nombre.').max(150),
  cargo: texto(100), correo: correoOpc, telefono: texto(30), ciudad: texto(80), servicio: texto(200), mensaje: texto(2000),
  aceptaDatos: z.literal(true, { errorMap: () => ({ message: 'Debe aceptar la política de tratamiento de datos para que lo contactemos.' }) }),
  sitio: z.string().max(500).optional(), // trampa para robots: una persona no ve este campo
}).refine((b) => b.correo || b.telefono, { message: 'Deje un correo o un teléfono para contactarlo.', path: ['correo'] });
const Importar = z.object({ confirmar: z.enum(['true', 'false']).default('false') });

/** La importación de prueba se deshace al final: así la vista previa dice exactamente lo que haría. */
class SoloVistaPrevia extends Error { constructor(readonly resumen: unknown) { super('vista previa'); } }

@Injectable()
export class ComercialService {
  private readonly log = new Logger('Comercial');
  private empresaDelFormulario: Promise<string | null> | null = null;
  constructor(private readonly db: PrismaService, private readonly audit: Auditoria, private readonly archivos: Archivos, private readonly correo: Correo,
    private readonly declaraciones: DeclaracionesService, private readonly cfg: ConfigService<Config, true>) {}

  private sector(valor: string | null | undefined) {
    if (valor === undefined || valor === null) return valor;
    const s = sectorDe(valor);
    if (!s) throw new BadRequestException({ mensaje: `Elija el sector de la lista: ${SECTORES.join(', ')}.` });
    return s;
  }
  private async validarUsuario(a: Actor, id: string | null | undefined, que: string) {
    if (id && !(await this.db.usuario.findFirst({ where: { id, empresaId: a.empresaId, activo: true, clienteId: null } }))) {
      throw new BadRequestException({ mensaje: `${que} no existe o está inactivo.` });
    }
  }
  private async prospectoPropio(a: Actor, id: string) {
    const p = await this.db.prospecto.findFirst({ where: { id, empresaId: a.empresaId } });
    if (!p) throw new NotFoundException({ mensaje: 'Prospecto no encontrado.' });
    return p;
  }
  private async oportunidadPropia(a: Actor, id: string) {
    const o = await this.db.oportunidad.findFirst({ where: { id, empresaId: a.empresaId }, include: { prospecto: true } });
    if (!o) throw new NotFoundException({ mensaje: 'Oportunidad no encontrada.' });
    return o;
  }
  private async nitLibre(a: Actor, nit: string | null | undefined, menos?: string) {
    if (!nit) return;
    const otro = await this.db.prospecto.findFirst({ where: { empresaId: a.empresaId, nit, ...(menos ? { id: { not: menos } } : {}) }, select: { razonSocial: true } });
    if (otro) throw new ConflictException({ mensaje: `Ya existe el prospecto ${otro.razonSocial} con el NIT ${nit}.` });
  }

  // ---------------- Prospectos y contactos ----------------
  async prospectos(a: Actor, f: z.infer<typeof FiltroProspectos>) {
    const { take, skip } = paginar(f);
    const q = f.q?.trim();
    const where: Prisma.ProspectoWhereInput = {
      empresaId: a.empresaId, ...(f.origen ? { origen: f.origen } : {}),
      ...(q ? { OR: [{ razonSocial: { contains: q, mode: 'insensitive' } }, ...(/^\d{3,}$/.test(q) ? [{ nit: { startsWith: q } }] : []),
        { contactos: { some: { OR: [{ nombre: { contains: q, mode: 'insensitive' } }, { correo: { contains: q, mode: 'insensitive' } }] } } }] } : {}),
    };
    const [filas, total] = await Promise.all([
      this.db.prospecto.findMany({ where, orderBy: { creadoEn: 'desc' }, take, skip, select: {
        id: true, razonSocial: true, nit: true, sector: true, origen: true, telefono: true, correo: true, activo: true, creadoEn: true,
        cliente: { select: { id: true, razonSocial: true } }, asesor: { select: { id: true, nombre: true } },
        contactos: { where: { principal: true, activo: true }, take: 1, select: { nombre: true, cargo: true, telefono: true, correo: true } },
        _count: { select: { oportunidades: { where: { etapa: { in: [...ABIERTAS] } } } } },
      } }),
      this.db.prospecto.count({ where }),
    ]);
    return { filas, total };
  }

  async prospecto(a: Actor, id: string) {
    const p = await this.db.prospecto.findFirst({ where: { id, empresaId: a.empresaId }, include: {
      municipio: { select: { nombre: true, departamento: true } }, asesor: { select: { id: true, nombre: true } },
      cliente: { select: { id: true, razonSocial: true, activo: true } },
      contactos: { orderBy: [{ activo: 'desc' }, { principal: 'desc' }, { nombre: 'asc' }] },
      oportunidades: { orderBy: { creadoEn: 'desc' }, select: { id: true, titulo: true, etapa: true, valorMensual: true, cerradaEn: true, motivoPerdida: true, creadoEn: true } },
      actividades: { orderBy: { creadoEn: 'desc' }, take: 100, include: { responsable: { select: { nombre: true } }, creadoPor: { select: { nombre: true } }, oportunidad: { select: { titulo: true } } } },
    } });
    if (!p) throw new NotFoundException({ mensaje: 'Prospecto no encontrado.' });
    return p;
  }

  async crearProspecto(a: Actor, b: z.infer<typeof NuevoProspecto>) {
    const { contacto, ...datos } = b;
    await this.validarUsuario(a, datos.asesorId, 'El asesor comercial');
    await this.nitLibre(a, datos.nit);
    // Si ya es cliente (mismo NIT), el prospecto queda enlazado a él: la oportunidad amplía sus servicios
    const cliente = datos.nit ? await this.db.cliente.findUnique({ where: { empresaId_nit: { empresaId: a.empresaId, nit: datos.nit } }, select: { id: true } }) : null;
    if (cliente && (await this.db.prospecto.findFirst({ where: { clienteId: cliente.id }, select: { id: true } }))) {
      throw new ConflictException({ mensaje: 'Ese NIT ya es cliente y ya tiene su ficha comercial: abra la oportunidad desde esa ficha.' });
    }
    return this.db.$transaction(async (tx) => {
      const p = await tx.prospecto.create({ data: { ...datos, sector: this.sector(datos.sector), empresaId: a.empresaId, clienteId: cliente?.id ?? null, creadoPorId: a.id,
        asesorId: datos.asesorId ?? a.id } });
      if (contacto) await tx.contactoComercial.create({ data: { ...contacto, prospectoId: p.id, principal: true } });
      await this.audit.registrar(a, 'prospecto', p.id, 'CREAR', undefined, { razonSocial: p.razonSocial, nit: p.nit, origen: p.origen }, tx);
      return p;
    });
  }

  async editarProspecto(a: Actor, id: string, b: z.infer<typeof EditarProspecto>) {
    const p = await this.prospectoPropio(a, id);
    if (b.asesorId !== undefined) await this.validarUsuario(a, b.asesorId, 'El asesor comercial');
    if (b.nit !== undefined && b.nit !== p.nit) {
      if (p.clienteId) throw new BadRequestException({ mensaje: 'El prospecto ya es cliente: su NIT es el del cliente y no cambia aquí.' });
      await this.nitLibre(a, b.nit, id);
    }
    const r = await this.db.prospecto.update({ where: { id }, data: { ...b, ...(b.sector !== undefined ? { sector: this.sector(b.sector) } : {}) } });
    await this.audit.registrar(a, 'prospecto', id, 'EDITAR', { razonSocial: p.razonSocial, nit: p.nit, activo: p.activo }, b);
    return r;
  }

  async crearContacto(a: Actor, prospectoId: string, b: z.infer<typeof DatosContacto>) {
    await this.prospectoPropio(a, prospectoId);
    return this.db.$transaction(async (tx) => {
      const hay = await tx.contactoComercial.findFirst({ where: { prospectoId, principal: true, activo: true }, select: { id: true } });
      const principal = b.principal ?? !hay;
      if (principal && hay) await tx.contactoComercial.update({ where: { id: hay.id }, data: { principal: false } });
      return tx.contactoComercial.create({ data: { ...b, prospectoId, principal } });
    });
  }

  async editarContacto(a: Actor, id: string, b: z.infer<typeof EditarContacto>) {
    const c = await this.db.contactoComercial.findFirst({ where: { id, prospecto: { empresaId: a.empresaId } } });
    if (!c) throw new NotFoundException({ mensaje: 'Contacto no encontrado.' });
    return this.db.$transaction(async (tx) => {
      if (b.principal) await tx.contactoComercial.updateMany({ where: { prospectoId: c.prospectoId, principal: true, id: { not: id } }, data: { principal: false } });
      return tx.contactoComercial.update({ where: { id }, data: { ...b, ...(b.activo === false ? { principal: false } : {}) } });
    });
  }

  /** La ficha comercial de un cliente que ya existe (para ampliar sus servicios): se crea la primera vez. */
  async desdeCliente(a: Actor, clienteId: string) {
    const c = await this.db.cliente.findFirst({ where: { id: clienteId, empresaId: a.empresaId }, include: { sucursales: { where: { esPrincipal: true }, take: 1 } } });
    if (!c) throw new NotFoundException({ mensaje: 'Cliente no encontrado.' });
    const ya = await this.db.prospecto.findFirst({ where: { clienteId } });
    if (ya) return ya;
    const porNit = await this.db.prospecto.findFirst({ where: { empresaId: a.empresaId, nit: c.nit } });
    if (porNit) return this.db.prospecto.update({ where: { id: porNit.id }, data: { clienteId } });
    const s = c.sucursales[0];
    const p = await this.db.prospecto.create({ data: { empresaId: a.empresaId, razonSocial: c.razonSocial, nit: c.nit, sector: c.sector, representanteLegal: c.representanteLegal,
      municipioDane: s?.municipioDane ?? null, direccion: s?.direccion ?? null, clienteId, origen: 'OTRO', asesorId: c.asesorId ?? a.id, creadoPorId: a.id } });
    await this.audit.registrar(a, 'prospecto', p.id, 'CREAR', undefined, { desdeCliente: c.id });
    return p;
  }

  // ---------------- Oportunidades ----------------
  /** Embudo: las abiertas y las cerradas de los últimos 90 días, con su próxima tarea y su última cotización. */
  async embudo(a: Actor, f: z.infer<typeof FiltroEmbudo>) {
    const hace90 = new Date(Date.now() - 90 * DIA);
    const q = f.q?.trim();
    const filas = await this.db.oportunidad.findMany({
      where: { empresaId: a.empresaId, ...(f.asesorId ? { asesorId: f.asesorId } : {}), AND: [
        { OR: [{ etapa: { in: [...ABIERTAS] } }, { cerradaEn: { gte: hace90 } }] },
        ...(q ? [{ OR: [{ titulo: { contains: q, mode: 'insensitive' as const } }, { prospecto: { razonSocial: { contains: q, mode: 'insensitive' as const } } }] }] : []),
      ] },
      orderBy: { actualizadoEn: 'desc' }, take: 600,
      select: {
        id: true, titulo: true, etapa: true, valorMensual: true, cierreEstimado: true, cerradaEn: true, motivoPerdida: true, actualizadoEn: true, clienteId: true,
        prospecto: { select: { id: true, razonSocial: true, clienteId: true } }, asesor: { select: { id: true, nombre: true } },
        actividades: { where: { hechaEn: null }, orderBy: { venceEn: 'asc' }, take: 1, select: { asunto: true, venceEn: true } },
        cotizaciones: { orderBy: { creadoEn: 'desc' }, take: 1, select: { numero: true, estado: true } },
      },
    });
    const inicioMes = new Date(`${fechaColombia().toISOString().slice(0, 7)}-01T05:00:00Z`);
    const abiertas = filas.filter((o) => (ABIERTAS as readonly string[]).includes(o.etapa));
    const ganadas = filas.filter((o) => o.etapa === 'GANADA'), perdidas = filas.filter((o) => o.etapa === 'PERDIDA');
    const ganadasMes = ganadas.filter((o) => o.cerradaEn && o.cerradaEn >= inicioMes);
    const suma = (xs: typeof filas) => xs.reduce((s, o) => s + Number(o.valorMensual ?? 0), 0);
    return {
      oportunidades: filas,
      kpis: {
        abiertas: abiertas.length, valorAbierto: suma(abiertas), ganadasMes: ganadasMes.length, valorGanadoMes: suma(ganadasMes),
        tasaCierre: ganadas.length + perdidas.length ? Math.round((ganadas.length * 100) / (ganadas.length + perdidas.length)) : null,
      },
    };
  }

  async oportunidad(a: Actor, id: string) {
    const o = await this.db.oportunidad.findFirst({ where: { id, empresaId: a.empresaId }, include: {
      prospecto: { include: { contactos: { where: { activo: true }, orderBy: [{ principal: 'desc' }, { nombre: 'asc' }] }, cliente: { select: { id: true, razonSocial: true } },
        municipio: { select: { nombre: true, departamento: true } } } },
      contacto: true, asesor: { select: { id: true, nombre: true } }, cerradaPor: { select: { nombre: true } }, cliente: { select: { id: true, razonSocial: true } },
      cotizaciones: { orderBy: { creadoEn: 'desc' }, include: { creadoPor: { select: { nombre: true } }, items: { orderBy: { orden: 'asc' }, include: {
        catalogo: { select: { codigo: true, nombre: true } }, disposicion: { select: { nombre: true } }, metrica: { select: { abreviacion: true } } } } } },
      actividades: { orderBy: { creadoEn: 'desc' }, take: 100, include: { responsable: { select: { nombre: true } }, creadoPor: { select: { nombre: true } } } },
    } });
    if (!o) throw new NotFoundException({ mensaje: 'Oportunidad no encontrada.' });
    return o;
  }

  async crearOportunidad(a: Actor, b: z.infer<typeof NuevaOportunidad>) {
    const prospecto = b.clienteId ? await this.desdeCliente(a, b.clienteId) : await this.prospectoPropio(a, b.prospectoId!);
    await this.validarUsuario(a, b.asesorId, 'El asesor comercial');
    if (b.contactoId && !(await this.db.contactoComercial.findFirst({ where: { id: b.contactoId, prospectoId: prospecto.id } }))) {
      throw new BadRequestException({ mensaje: 'El contacto no es de este prospecto.' });
    }
    const { prospectoId: _p, clienteId: _c, ...datos } = b;
    const o = await this.db.oportunidad.create({ data: { ...datos, empresaId: a.empresaId, prospectoId: prospecto.id, asesorId: b.asesorId ?? prospecto.asesorId ?? a.id, creadoPorId: a.id } });
    await this.audit.registrar(a, 'oportunidad', o.id, 'CREAR', undefined, { titulo: o.titulo, prospecto: prospecto.razonSocial });
    return o;
  }

  async editarOportunidad(a: Actor, id: string, b: z.infer<typeof EditarOportunidad>) {
    const o = await this.oportunidadPropia(a, id);
    if (o.etapa === 'GANADA') throw new ConflictException({ mensaje: 'La oportunidad ya se ganó y creó el cliente: no se modifica (abra una nueva).' });
    if (b.asesorId !== undefined) await this.validarUsuario(a, b.asesorId, 'El asesor comercial');
    if (b.contactoId && !(await this.db.contactoComercial.findFirst({ where: { id: b.contactoId, prospectoId: o.prospectoId } }))) {
      throw new BadRequestException({ mensaje: 'El contacto no es de este prospecto.' });
    }
    // Volver a una etapa abierta reabre una oportunidad perdida
    const reabre = o.etapa === 'PERDIDA' && b.etapa !== undefined;
    const r = await this.db.oportunidad.update({ where: { id }, data: { ...b, ...(reabre ? { cerradaEn: null, cerradaPorId: null, motivoPerdida: null } : {}) } });
    await this.audit.registrar(a, 'oportunidad', id, reabre ? 'REABRIR' : 'EDITAR', { etapa: o.etapa, titulo: o.titulo }, b);
    return r;
  }

  async perder(a: Actor, id: string, motivo: string) {
    const o = await this.oportunidadPropia(a, id);
    if (o.etapa === 'GANADA') throw new ConflictException({ mensaje: 'La oportunidad ya se ganó: no se marca perdida.' });
    return this.db.$transaction(async (tx) => {
      const r = await tx.oportunidad.update({ where: { id }, data: { etapa: 'PERDIDA', motivoPerdida: motivo, cerradaEn: new Date(), cerradaPorId: a.id } });
      // Las tareas pendientes de una oportunidad perdida quedan hechas (con la razón)
      await tx.actividadComercial.updateMany({ where: { oportunidadId: id, hechaEn: null }, data: { hechaEn: new Date() } });
      await tx.actividadComercial.create({ data: { empresaId: a.empresaId, prospectoId: o.prospectoId, oportunidadId: id, tipo: 'NOTA', asunto: 'Oportunidad perdida',
        detalle: motivo, hechaEn: new Date(), responsableId: a.id, creadoPorId: a.id } });
      await this.audit.registrar(a, 'oportunidad', id, 'PERDER', { etapa: o.etapa }, { motivo }, tx);
      return r;
    });
  }

  /**
   * Ganar: crea el cliente (si aún no lo es) con su sede principal y vuelve cada renglón de la cotización aceptada una
   * declaración con su tarifa (servicios: para autorizar; residuos: en borrador, falta su caracterización). Todo junto.
   */
  async ganar(a: Actor, id: string, b: z.infer<typeof Ganar>) {
    const o = await this.oportunidadPropia(a, id);
    if (o.etapa === 'GANADA') throw new ConflictException({ mensaje: 'La oportunidad ya se ganó.' });
    const cot = b.cotizacionId ? await this.db.cotizacion.findFirst({ where: { id: b.cotizacionId, oportunidadId: id }, include: {
      items: { orderBy: { orden: 'asc' }, include: { catalogo: true } } } }) : null;
    if (b.cotizacionId && !cot) throw new BadRequestException({ mensaje: 'La cotización no es de esta oportunidad.' });
    if (cot?.estado === 'BORRADOR') throw new BadRequestException({ mensaje: 'Envíe primero la cotización: la que acepta el cliente es la cotización enviada, con número.' });
    if (cot?.estado === 'RECHAZADA') throw new BadRequestException({ mensaje: 'Esa cotización fue rechazada: elija la que aceptó el cliente.' });
    if (!o.prospecto.clienteId && (!b.cliente || !b.sede)) {
      throw new BadRequestException({ mensaje: 'Para crear el cliente indique sus datos (NIT, razón social y representante legal) y su sede principal.' });
    }
    if (b.cliente) await this.nitLibre(a, b.cliente.nit, o.prospectoId);
    const sector = b.cliente ? this.sector(b.cliente.sector) : undefined;
    const serv = await this.db.categoriaDeclarado.findFirst({ where: { empresaId: a.empresaId, codigo: 'SERV', activo: true }, select: { id: true } });
    const r = await this.db.$transaction(async (tx) => {
      let clienteId = o.prospecto.clienteId;
      let nuevoCliente = false;
      if (!clienteId) {
        const c = b.cliente!, s = b.sede!;
        const existente = await tx.cliente.findUnique({ where: { empresaId_nit: { empresaId: a.empresaId, nit: c.nit } } });
        if (existente) {
          if (!existente.activo) throw new BadRequestException({ mensaje: `${existente.razonSocial} ya es cliente pero está inactivo: actívelo en Clientes antes de ganar la oportunidad.` });
          clienteId = existente.id;
        } else {
          const nuevo = await tx.cliente.create({ data: {
            empresaId: a.empresaId, nit: c.nit, dv: dvNit(c.nit), razonSocial: c.razonSocial, tipo: c.tipo, sector: sector ?? null, representanteLegal: c.representanteLegal,
            emailFacturacion: c.emailFacturacion ?? null, tipoNegociacion: cot?.tipoNegociacion ?? 'COBRO', formaPago: cot?.formaPago ?? 'CONTADO', asesorId: o.asesorId ?? o.prospecto.asesorId,
          } });
          await this.audit.registrar(a, 'cliente', nuevo.id, 'CREAR', undefined, { razonSocial: nuevo.razonSocial, nit: nuevo.nit, desdeOportunidad: o.id }, tx);
          const sede = await tx.sucursal.create({ data: { clienteId: nuevo.id, nombre: s.nombre, codigo: 'C001', esPrincipal: true, direccion: s.direccion ?? null,
            municipioDane: s.municipioDane ?? null, contacto: s.contacto ?? null, telefono: s.telefono ?? null, emails: s.emails ?? null } });
          await this.audit.registrar(a, 'sucursal', sede.id, 'CREAR', undefined, { nombre: sede.nombre, desdeOportunidad: o.id }, tx);
          clienteId = nuevo.id; nuevoCliente = true;
        }
        await tx.prospecto.update({ where: { id: o.prospectoId }, data: { clienteId, nit: c.nit, razonSocial: c.razonSocial, representanteLegal: c.representanteLegal } });
      }
      const declaraciones: { id: string; numero: number; nombre: string; estado: string }[] = [];
      const omitidas: { descripcion: string; motivo: string }[] = [];
      if (cot) {
        const ya = new Set((await tx.declaracion.findMany({ where: { clienteId, catalogoId: { not: null }, estado: { notIn: ['RECHAZADA', 'ANULADA'] } }, select: { catalogoId: true } }))
          .map((d) => d.catalogoId));
        for (const it of cot.items) {
          const linea = it.lineaServicioId ?? it.catalogo?.lineaServicioId ?? null;
          const categoria = it.categoriaId ?? (it.tipo === 'SERVICIO' ? serv?.id : null) ?? null;
          if (!linea || !categoria) { omitidas.push({ descripcion: it.descripcion, motivo: 'le falta la línea de servicio o la categoría: créela en Declaraciones' }); continue; }
          if (it.catalogoId && ya.has(it.catalogoId)) { omitidas.push({ descripcion: it.descripcion, motivo: 'el cliente ya lo tiene declarado' }); continue; }
          const precio = { precioUnitario: Number(it.precioUnitario), metricaId: it.metricaId ?? null, tipoNegociacion: cot.tipoNegociacion, formaPago: cot.formaPago };
          const datos = it.tipo === 'SERVICIO'
            ? { tipo: 'SERVICIO', clienteId, alcanceSedes: 'TODAS', nombre: it.catalogo?.nombre ?? it.descripcion, catalogoId: it.catalogoId ?? null, categoriaId: categoria,
                lineaServicioId: linea, descripcionServicio: ((it.catalogo?.valores ?? {}) as { descripcion?: string }).descripcion || it.descripcion, precio,
                responsabilidadAceptada: true } // la registra quien gana la oportunidad, en nombre del cliente (queda en la auditoría)
            : { tipo: 'RESIDUO', borrador: true, clienteId, alcanceSedes: 'TODAS', nombre: it.descripcion, categoriaId: categoria, lineaServicioId: linea,
                esPeligroso: it.esPeligroso, disposiciones: it.disposicionId ? [{ disposicionId: it.disposicionId, principal: true }] : [], precio };
          const d = await this.declaraciones.crear(a, EsquemaDeclaracion.parse(datos), tx);
          declaraciones.push({ id: d.id, numero: d.numero, nombre: d.nombre, estado: d.estado });
        }
        if (cot.estado === 'ENVIADA') await tx.cotizacion.update({ where: { id: cot.id }, data: { estado: 'ACEPTADA', respondidaEn: new Date() } });
      }
      await tx.oportunidad.update({ where: { id }, data: { etapa: 'GANADA', cerradaEn: new Date(), cerradaPorId: a.id, clienteId, motivoPerdida: null } });
      await tx.actividadComercial.updateMany({ where: { oportunidadId: id, hechaEn: null }, data: { hechaEn: new Date() } });
      await tx.actividadComercial.create({ data: { empresaId: a.empresaId, prospectoId: o.prospectoId, oportunidadId: id, tipo: 'NOTA', asunto: 'Oportunidad ganada',
        detalle: `${nuevoCliente ? 'Se creó el cliente con su sede principal. ' : ''}${declaraciones.length ? `Declaraciones creadas con su tarifa: ${declaraciones.length}.` : ''}`.trim() || null,
        hechaEn: new Date(), responsableId: a.id, creadoPorId: a.id } });
      await this.audit.registrar(a, 'oportunidad', id, 'GANAR', { etapa: o.etapa }, { clienteId, nuevoCliente, cotizacion: cot?.numero ?? null, declaraciones: declaraciones.length, omitidas }, tx);
      return { clienteId, nuevoCliente, declaraciones, omitidas };
    }, { timeout: 60_000, maxWait: 10_000 });
    return r;
  }

  // ---------------- Actividades y tareas ----------------
  async crearActividad(a: Actor, b: z.infer<typeof NuevaActividad>) {
    const o = b.oportunidadId ? await this.oportunidadPropia(a, b.oportunidadId) : null;
    const prospectoId = o?.prospectoId ?? b.prospectoId!;
    if (!o) await this.prospectoPropio(a, prospectoId);
    else if (b.prospectoId && b.prospectoId !== o.prospectoId) throw new BadRequestException({ mensaje: 'La oportunidad no es de ese prospecto.' });
    await this.validarUsuario(a, b.responsableId, 'El responsable');
    // Con fecha: queda pendiente (tarea o seguimiento); sin fecha: es algo que ya se hizo (llamada, nota…)
    return this.db.actividadComercial.create({ data: {
      empresaId: a.empresaId, prospectoId, oportunidadId: o?.id ?? null, tipo: b.tipo, asunto: b.asunto, detalle: b.detalle ?? null,
      venceEn: b.venceEn ?? null, hechaEn: b.venceEn ? null : new Date(), responsableId: b.responsableId ?? a.id, creadoPorId: a.id,
    } });
  }

  async completar(a: Actor, id: string, resultado: string | null | undefined) {
    const x = await this.db.actividadComercial.findFirst({ where: { id, empresaId: a.empresaId } });
    if (!x) throw new NotFoundException({ mensaje: 'Actividad no encontrada.' });
    if (x.hechaEn) throw new ConflictException({ mensaje: 'Esa actividad ya está hecha.' });
    return this.db.actividadComercial.update({ where: { id }, data: { hechaEn: new Date(),
      ...(resultado ? { detalle: `${x.detalle ? `${x.detalle}\n` : ''}Resultado: ${resultado}` } : {}) } });
  }

  /** Tareas pendientes: las propias y las sin responsable (o las de todo el equipo). */
  tareas(a: Actor, todas: boolean) {
    return this.db.actividadComercial.findMany({
      where: { empresaId: a.empresaId, hechaEn: null, ...(todas ? {} : { OR: [{ responsableId: a.id }, { responsableId: null }] }) },
      orderBy: { venceEn: 'asc' }, take: 300,
      include: { prospecto: { select: { id: true, razonSocial: true } }, oportunidad: { select: { id: true, titulo: true } }, responsable: { select: { id: true, nombre: true } } },
    });
  }

  // ---------------- Cotizaciones ----------------
  private async validarItems(a: Actor, items: z.infer<typeof ItemCotizacion>[]) {
    const ids = (k: 'catalogoId' | 'categoriaId' | 'lineaServicioId' | 'disposicionId' | 'metricaId') => [...new Set(items.map((x) => x[k]).filter((x): x is string => !!x))];
    const e = { empresaId: a.empresaId };
    const [cat, catg, lin, dis, met] = await Promise.all([
      this.db.catalogoResiduo.count({ where: { ...e, id: { in: ids('catalogoId') } } }), this.db.categoriaDeclarado.count({ where: { ...e, id: { in: ids('categoriaId') } } }),
      this.db.lineaServicio.count({ where: { ...e, id: { in: ids('lineaServicioId') } } }), this.db.disposicion.count({ where: { ...e, id: { in: ids('disposicionId') } } }),
      this.db.metrica.count({ where: { ...e, uso: 'PRECIO', id: { in: ids('metricaId') } } }),
    ]);
    if (cat !== ids('catalogoId').length || catg !== ids('categoriaId').length || lin !== ids('lineaServicioId').length || dis !== ids('disposicionId').length
      || met !== ids('metricaId').length) throw new BadRequestException({ mensaje: 'Algún renglón usa un servicio, categoría, línea, tratamiento o unidad que no existe.' });
  }
  private total(items: { cantidadEstimada?: number | null; precioUnitario: number }[]) {
    return Math.round(items.reduce((s, x) => s + (x.cantidadEstimada ? x.cantidadEstimada * x.precioUnitario : 0), 0) * 100) / 100;
  }
  private filas(cotizacionId: string, items: z.infer<typeof ItemCotizacion>[]) {
    return items.map((x, i) => ({ ...x, cotizacionId, orden: i + 1, catalogoId: x.catalogoId ?? null, categoriaId: x.categoriaId ?? null, lineaServicioId: x.lineaServicioId ?? null,
      disposicionId: x.disposicionId ?? null, metricaId: x.metricaId ?? null, cantidadEstimada: x.cantidadEstimada ?? null, frecuencia: x.frecuencia ?? null }));
  }

  async crearCotizacion(a: Actor, oportunidadId: string, b: z.infer<typeof DatosCotizacion>) {
    const o = await this.oportunidadPropia(a, oportunidadId);
    if (o.etapa === 'GANADA' || o.etapa === 'PERDIDA') throw new ConflictException({ mensaje: 'La oportunidad está cerrada: reábrala para cotizar.' });
    await this.validarItems(a, b.items);
    return this.db.$transaction(async (tx) => {
      const { items, ...datos } = b;
      const c = await tx.cotizacion.create({ data: { ...datos, empresaId: a.empresaId, oportunidadId, totalEstimado: this.total(items), creadoPorId: a.id } });
      await tx.cotizacionItem.createMany({ data: this.filas(c.id, items) });
      await this.audit.registrar(a, 'cotizacion', c.id, 'CREAR', undefined, { oportunidad: o.titulo, renglones: items.length }, tx);
      return c;
    });
  }

  async editarCotizacion(a: Actor, id: string, b: z.infer<typeof DatosCotizacion>) {
    const c = await this.db.cotizacion.findFirst({ where: { id, empresaId: a.empresaId } });
    if (!c) throw new NotFoundException({ mensaje: 'Cotización no encontrada.' });
    if (c.estado !== 'BORRADOR') throw new ConflictException({ mensaje: 'La cotización ya se envió: no se cambia (haga una nueva).' });
    await this.validarItems(a, b.items);
    return this.db.$transaction(async (tx) => {
      const { items, ...datos } = b;
      await tx.cotizacionItem.deleteMany({ where: { cotizacionId: id } }); // un borrador se puede rehacer: aún no lo ha visto el cliente
      await tx.cotizacionItem.createMany({ data: this.filas(id, items) });
      return tx.cotizacion.update({ where: { id }, data: { ...datos, totalEstimado: this.total(items) } });
    });
  }

  private urlVerificacion(codigo: string) { return `${this.cfg.get('WEB_URL', { infer: true }).replace(/\/$/, '')}/#verificar/${codigo}`; }

  /** Lo que dice la cotización (sin número ni código, que se asignan al enviarla). */
  private async contenido(empresaId: string, cotizacionId: string): Promise<Omit<ContenidoCotizacion, 'numero' | 'verificacion'> & { oportunidadId: string; etapa: EtapaOportunidad; prospectoId: string; asesorId: string | null }> {
    const c = await this.db.cotizacion.findFirst({ where: { id: cotizacionId, empresaId }, include: {
      items: { orderBy: { orden: 'asc' }, include: { disposicion: { select: { nombre: true } }, metrica: { select: { abreviacion: true } } } },
      oportunidad: { include: { contacto: true, asesor: { select: { nombre: true, email: true } },
        prospecto: { include: { municipio: { select: { nombre: true, departamento: true } }, contactos: { where: { principal: true, activo: true }, take: 1 } } } } },
    } });
    if (!c) throw new NotFoundException({ mensaje: 'Cotización no encontrada.' });
    const empresa = await this.db.empresa.findUniqueOrThrow({ where: { id: empresaId }, select: { razonSocial: true, nit: true, configuracion: true } });
    const conf = (empresa.configuracion ?? {}) as { ciudadFirma?: string; contacto?: ContenidoCotizacion['emisor']['contacto']; certificaciones?: { norma: string; numero: string; entidad?: string; vence?: string }[] };
    const hoy = fechaColombia();
    const p = c.oportunidad.prospecto, contacto = c.oportunidad.contacto ?? p.contactos[0] ?? null;
    const items = c.items.map((it) => {
      const cantidad = it.cantidadEstimada === null ? null : Number(it.cantidadEstimada), precio = Number(it.precioUnitario);
      return { descripcion: it.descripcion, tratamiento: it.disposicion?.nombre ?? null, peligroso: it.esPeligroso, unidad: it.metrica?.abreviacion ?? 'servicio',
        cantidad, frecuencia: it.frecuencia, precio, subtotal: cantidad === null ? null : Math.round(cantidad * precio * 100) / 100 };
    });
    return {
      version: 1, fecha: hoy.toISOString().slice(0, 10), validaHasta: new Date(hoy.getTime() + c.validezDias * DIA).toISOString().slice(0, 10), ciudad: conf.ciudadFirma ?? null,
      titulo: c.oportunidad.titulo, emisor: { razonSocial: empresa.razonSocial, nit: empresa.nit, contacto: conf.contacto },
      certificaciones: (conf.certificaciones ?? []).filter((x) => x.numero?.trim() && (!x.vence || x.vence >= hoy.toISOString().slice(0, 10))).map(({ norma, numero, entidad }) => ({ norma, numero, entidad })),
      cliente: { razonSocial: p.razonSocial, nit: p.nit, ciudad: p.municipio ? `${p.municipio.nombre} (${p.municipio.departamento})` : null, direccion: p.direccion },
      contacto: contacto ? { nombre: contacto.nombre, cargo: contacto.cargo, correo: contacto.correo, telefono: contacto.telefono } : null,
      asesor: c.oportunidad.asesor ? { nombre: c.oportunidad.asesor.nombre, correo: c.oportunidad.asesor.email || null } : null,
      items, total: Math.round(items.reduce((s, x) => s + (x.subtotal ?? 0), 0) * 100) / 100,
      tipoNegociacion: NEGOCIACION[c.tipoNegociacion], formaPago: PAGO[c.formaPago], validezDias: c.validezDias, condiciones: c.condiciones,
      oportunidadId: c.oportunidadId, etapa: c.oportunidad.etapa, prospectoId: p.id, asesorId: c.oportunidad.asesorId,
    };
  }

  /** Vista previa de un borrador (sin número): para revisarla antes de enviarla. */
  async vistaPrevia(a: Actor, id: string) {
    const { oportunidadId: _o, etapa: _e, prospectoId: _p, asesorId: _a, ...base } = await this.contenido(a.empresaId, id);
    return pdfCotizacion({ ...base, numero: 'BORRADOR', verificacion: { codigo: '', url: this.cfg.get('WEB_URL', { infer: true }) } });
  }

  /**
   * Enviar: toma el número, arma el PDF con su código de verificación, guarda la copia fija y ya no cambia. La
   * oportunidad pasa a «cotizada» y queda la tarea de hacerle seguimiento en 5 días.
   */
  async enviar(a: Actor, id: string) {
    const c = await this.db.cotizacion.findFirst({ where: { id, empresaId: a.empresaId }, select: { estado: true } });
    if (!c) throw new NotFoundException({ mensaje: 'Cotización no encontrada.' });
    if (c.estado !== 'BORRADOR') throw new ConflictException({ mensaje: 'La cotización ya se envió.' });
    const { oportunidadId, etapa, prospectoId, asesorId, ...base } = await this.contenido(a.empresaId, id);
    if (etapa === 'GANADA' || etapa === 'PERDIDA') throw new ConflictException({ mensaje: 'La oportunidad está cerrada: reábrala para enviar cotizaciones.' });
    return this.db.$transaction(async (tx) => {
      const [{ numero }] = await tx.$queryRaw<{ numero: string }[]>`SELECT fn_siguiente_consecutivo(${a.empresaId}::uuid, 'COTIZACION') AS numero`;
      const codigo = randomBytes(12).toString('hex');
      const contenido: ContenidoCotizacion = { ...base, numero, verificacion: { codigo, url: this.urlVerificacion(codigo) } };
      const pdf = await pdfCotizacion(contenido);
      const g = await this.archivos.guardarGenerado(a.empresaId, 'cotizaciones', pdf, 'pdf');
      const r = await tx.cotizacion.update({ where: { id }, data: { estado: 'ENVIADA', numero, contenido: contenido as unknown as Prisma.InputJsonValue, pdfClave: g.clave,
        pdfSha256: createHash('sha256').update(pdf).digest('hex'), codigoVerificacion: codigo, enviadaEn: new Date(), enviadaPorId: a.id } });
      if (etapa === 'NUEVA' || etapa === 'CONTACTADA') await tx.oportunidad.update({ where: { id: oportunidadId }, data: { etapa: 'COTIZADA' } });
      await tx.actividadComercial.create({ data: { empresaId: a.empresaId, prospectoId, oportunidadId, tipo: 'CORREO', asunto: `Cotización ${numero} enviada`,
        hechaEn: new Date(), responsableId: a.id, creadoPorId: a.id } });
      await tx.actividadComercial.create({ data: { empresaId: a.empresaId, prospectoId, oportunidadId, tipo: 'TAREA', asunto: `Seguimiento a la cotización ${numero}`,
        venceEn: new Date(Date.now() + 5 * DIA), responsableId: asesorId ?? a.id, creadoPorId: a.id } });
      await this.audit.registrar(a, 'cotizacion', id, 'ENVIAR', undefined, { numero, total: contenido.total }, tx);
      return r;
    }, { timeout: 30_000 });
  }

  async responder(a: Actor, id: string, b: z.infer<typeof Responder>) {
    const c = await this.db.cotizacion.findFirst({ where: { id, empresaId: a.empresaId }, include: { oportunidad: { select: { prospectoId: true, etapa: true } } } });
    if (!c) throw new NotFoundException({ mensaje: 'Cotización no encontrada.' });
    if (c.estado !== 'ENVIADA') throw new ConflictException({ mensaje: c.estado === 'BORRADOR' ? 'La cotización aún no se ha enviado.' : 'La cotización ya tiene respuesta del cliente.' });
    if (!b.aceptada && !b.motivo) throw new BadRequestException({ mensaje: 'Escriba por qué la rechazó el cliente.' });
    return this.db.$transaction(async (tx) => {
      const r = await tx.cotizacion.update({ where: { id }, data: { estado: b.aceptada ? 'ACEPTADA' : 'RECHAZADA', respondidaEn: new Date(), motivoRechazo: b.aceptada ? null : b.motivo } });
      if (b.aceptada && (ABIERTAS as readonly string[]).includes(c.oportunidad.etapa)) await tx.oportunidad.update({ where: { id: c.oportunidadId }, data: { etapa: 'NEGOCIACION' } });
      await tx.actividadComercial.create({ data: { empresaId: a.empresaId, prospectoId: c.oportunidad.prospectoId, oportunidadId: c.oportunidadId, tipo: 'NOTA',
        asunto: `Cotización ${c.numero} ${b.aceptada ? 'aceptada' : 'rechazada'}`, detalle: b.motivo ?? null, hechaEn: new Date(), responsableId: a.id, creadoPorId: a.id } });
      await this.audit.registrar(a, 'cotizacion', id, b.aceptada ? 'ACEPTAR' : 'RECHAZAR', undefined, { numero: c.numero, motivo: b.motivo ?? null }, tx);
      return r;
    });
  }

  async enlace(a: Actor, id: string) {
    const c = await this.db.cotizacion.findFirst({ where: { id, empresaId: a.empresaId }, select: { numero: true, pdfClave: true } });
    if (!c?.pdfClave) throw new NotFoundException({ mensaje: 'La cotización aún no tiene PDF: envíela primero (o use la vista previa).' });
    return this.archivos.enlace(c.pdfClave, a.empresaId, { nombre: `Cotización ${c.numero}.pdf` });
  }

  // ---------------- Formulario del sitio web ----------------
  /** La empresa que recibe el formulario: la de FORMULARIO_WEB_EMPRESA_NIT o, si no se indica, la única de la instalación. */
  private empresaWeb() {
    this.empresaDelFormulario ??= (async () => {
      const nit = this.cfg.get('FORMULARIO_WEB_EMPRESA_NIT', { infer: true });
      const base = (x: string) => x.split('-')[0].replace(/\D/g, '');
      const empresas = await this.db.empresa.findMany({ select: { id: true, nit: true } });
      const e = nit ? empresas.find((x) => base(x.nit) === base(nit)) : empresas.length === 1 ? empresas[0] : undefined;
      if (!e) this.log.warn('Formulario del sitio web: indique FORMULARIO_WEB_EMPRESA_NIT (hay varias empresas o el NIT no coincide).');
      return e?.id ?? null;
    })().catch(() => { this.empresaDelFormulario = null; return null; });
    return this.empresaDelFormulario;
  }

  async formularioWeb(b: z.infer<typeof FormularioWeb>) {
    if (b.sitio?.trim()) return { recibido: true }; // un robot llenó el campo oculto: se responde igual y no se guarda nada
    const empresaId = await this.empresaWeb();
    if (!empresaId) throw new NotFoundException({ mensaje: 'El formulario no está disponible.' });
    const r = await this.db.$transaction(async (tx) => {
      let p = (b.nit ? await tx.prospecto.findFirst({ where: { empresaId, nit: b.nit } }) : null)
        ?? await tx.prospecto.findFirst({ where: { empresaId, razonSocial: { equals: b.empresa, mode: 'insensitive' } } });
      const nuevo = !p;
      if (!p) {
        const cliente = b.nit ? await tx.cliente.findUnique({ where: { empresaId_nit: { empresaId, nit: b.nit } }, select: { id: true } }) : null;
        const libre = cliente && !(await tx.prospecto.findFirst({ where: { clienteId: cliente.id }, select: { id: true } }));
        p = await tx.prospecto.create({ data: { empresaId, razonSocial: b.empresa, nit: b.nit ?? null, telefono: b.telefono ?? null, correo: b.correo ?? null, origen: 'WEB',
          clienteId: libre ? cliente!.id : null, notas: b.ciudad ? `Ciudad: ${b.ciudad}` : null } });
      }
      const contactos = await tx.contactoComercial.findMany({ where: { prospectoId: p.id } });
      let contacto = contactos.find((c) => (b.correo && c.correo?.toLowerCase() === b.correo) || normalizar(c.nombre) === normalizar(b.nombre));
      contacto ??= await tx.contactoComercial.create({ data: { prospectoId: p.id, nombre: b.nombre, cargo: b.cargo ?? null, telefono: b.telefono ?? null, correo: b.correo ?? null,
        principal: !contactos.some((c) => c.principal && c.activo) } });
      const o = await tx.oportunidad.create({ data: { empresaId, prospectoId: p.id, contactoId: contacto.id, asesorId: p.asesorId,
        titulo: (b.servicio ? `Sitio web: ${b.servicio}` : 'Solicitud desde el sitio web').slice(0, 200) } });
      const ahora = new Date();
      await tx.actividadComercial.create({ data: { empresaId, prospectoId: p.id, oportunidadId: o.id, tipo: 'NOTA', asunto: 'Mensaje del sitio web', hechaEn: ahora,
        detalle: [b.mensaje, b.servicio && `Servicio de interés: ${b.servicio}`, b.ciudad && `Ciudad: ${b.ciudad}`, [b.correo, b.telefono].filter(Boolean).join(' · '),
          `Aceptó la política de tratamiento de datos el ${ahora.toLocaleString('es-CO', { timeZone: 'America/Bogota' })}.`].filter(Boolean).join('\n') } });
      await tx.actividadComercial.create({ data: { empresaId, prospectoId: p.id, oportunidadId: o.id, tipo: 'TAREA', asunto: RESPONDER_WEB,
        venceEn: new Date(ahora.getTime() + DIA), responsableId: p.asesorId } });
      await this.audit.registrar(null, 'prospecto', p.id, 'FORMULARIO_WEB', undefined, { nuevo, oportunidad: o.id }, tx);
      return { prospecto: p, oportunidadId: o.id };
    });
    void this.avisarComercial(empresaId, r.prospecto.razonSocial, b).catch((e) => this.log.warn(`Aviso del formulario web: ${(e as Error).message}`));
    return { recibido: true };
  }

  private async avisarComercial(empresaId: string, empresa: string, b: z.infer<typeof FormularioWeb>) {
    const usuarios = await this.db.usuario.findMany({ where: { empresaId, activo: true, clienteId: null, rol: { permisos: { some: { permiso: { codigo: { in: ['comercial.gestionar', '*'] } } } } } },
      select: { email: true }, take: 20 });
    const web = this.cfg.get('WEB_URL', { infer: true }).replace(/\/$/, '');
    const texto = [`Llegó una solicitud desde el sitio web: ${empresa}.`, '', `Contacto: ${b.nombre}${b.cargo ? `, ${b.cargo}` : ''}`, `Correo: ${b.correo ?? '—'} · Teléfono: ${b.telefono ?? '—'}`,
      b.servicio ? `Servicio de interés: ${b.servicio}` : '', b.mensaje ? `Mensaje: ${b.mensaje}` : '', '', `Respóndala en Terry-App › Comercial: ${web}`].filter((x) => x !== '').join('\n');
    for (const u of usuarios) if (u.email) await this.correo.enviar(u.email, `Terry-App · Solicitud del sitio web: ${empresa}`.slice(0, 150), texto).catch(() => undefined);
  }

  // ---------------- Importación de Bigin ----------------
  async importarBigin(a: Actor, archivos: { empresas?: Express.Multer.File[]; contactos?: Express.Multer.File[]; negocios?: Express.Multer.File[] }, confirmar: boolean) {
    const f = { empresas: archivos.empresas?.[0], contactos: archivos.contactos?.[0], negocios: archivos.negocios?.[0] };
    if (!f.empresas && !f.contactos && !f.negocios) throw new BadRequestException({ mensaje: 'Suba al menos un archivo CSV exportado de Bigin (empresas, contactos o negocios).' });
    const errores: ErrorBigin[] = [];
    const e = f.empresas ? leerEmpresas(f.empresas.buffer) : { empresas: [], errores: [] };
    const c = f.contactos ? leerContactos(f.contactos.buffer) : { contactos: [], errores: [] };
    const n = f.negocios ? leerNegocios(f.negocios.buffer) : { negocios: [], errores: [] };
    errores.push(...e.errores, ...c.errores, ...n.errores);
    const resumen = {
      confirmado: confirmar,
      empresas: { leidas: e.empresas.length, nuevas: 0, existentes: 0, enlazadasACliente: 0 },
      contactos: { leidos: c.contactos.length, nuevos: 0, existentes: 0 },
      negocios: { leidos: n.negocios.length, nuevos: 0, existentes: 0, porEtapa: {} as Record<string, number> },
      errores,
    };
    try {
      await this.db.$transaction(async (tx) => {
        const [prospectos, clientes, usuarios, conProspecto] = await Promise.all([
          tx.prospecto.findMany({ where: { empresaId: a.empresaId }, select: { id: true, razonSocial: true, nit: true, biginId: true, clienteId: true, asesorId: true } }),
          tx.cliente.findMany({ where: { empresaId: a.empresaId }, select: { id: true, razonSocial: true, nit: true } }),
          tx.usuario.findMany({ where: { empresaId: a.empresaId, clienteId: null }, select: { id: true, nombre: true } }),
          tx.prospecto.findMany({ where: { empresaId: a.empresaId, clienteId: { not: null } }, select: { clienteId: true } }),
        ]);
        type P = (typeof prospectos)[number];
        const porBigin = new Map<string, P>(), porNit = new Map<string, P>(), porNombre = new Map<string, P>();
        const indexar = (p: P) => { if (p.biginId) porBigin.set(p.biginId, p); if (p.nit) porNit.set(p.nit, p); porNombre.set(nombreEmpresa(p.razonSocial), p); };
        prospectos.forEach(indexar);
        const clientePorNit = new Map(clientes.map((x) => [x.nit, x])), clientePorNombre = new Map(clientes.map((x) => [nombreEmpresa(x.razonSocial), x]));
        const clientesEnlazados = new Set(conProspecto.map((x) => x.clienteId!));
        const asesor = (nombre: string | null) => (nombre ? usuarios.find((u) => normalizar(u.nombre) === normalizar(nombre))?.id ?? null : null);
        const buscar = (biginId: string | null, nombre: string | null, nit: string | null = null) =>
          (biginId && porBigin.get(biginId)) || (nit && porNit.get(nit)) || (nombre && porNombre.get(nombreEmpresa(nombre))) || null;
        const crear = async (d: { razonSocial: string; nit?: string | null; biginId?: string | null; telefono?: string | null; sitioWeb?: string | null; direccion?: string | null; notas?: string | null; asesorId?: string | null }) => {
          const cl = (d.nit && clientePorNit.get(d.nit)) || clientePorNombre.get(nombreEmpresa(d.razonSocial));
          const clienteId = cl && !clientesEnlazados.has(cl.id) ? cl.id : null;
          if (clienteId) { clientesEnlazados.add(clienteId); resumen.empresas.enlazadasACliente++; }
          const nit = d.nit && !porNit.has(d.nit) ? d.nit : null;
          const p = await tx.prospecto.create({ data: { empresaId: a.empresaId, razonSocial: d.razonSocial, nit, biginId: d.biginId ?? null, telefono: d.telefono ?? null,
            sitioWeb: d.sitioWeb ?? null, direccion: d.direccion ?? null, notas: d.notas ?? null, origen: 'BIGIN', asesorId: d.asesorId ?? null, clienteId, creadoPorId: a.id },
            select: { id: true, razonSocial: true, nit: true, biginId: true, clienteId: true, asesorId: true } });
          indexar(p);
          resumen.empresas.nuevas++;
          return p;
        };

        for (const x of e.empresas) {
          const p = buscar(x.biginId, x.razonSocial, x.nit);
          if (p) {
            resumen.empresas.existentes++;
            if (x.biginId && !p.biginId && !porBigin.has(x.biginId)) { await tx.prospecto.update({ where: { id: p.id }, data: { biginId: x.biginId } }); p.biginId = x.biginId; porBigin.set(x.biginId, p); }
            continue;
          }
          await crear({ ...x, notas: [x.notas, x.ciudad && `Ciudad: ${x.ciudad}`].filter(Boolean).join('\n') || null, asesorId: asesor(x.asesor) });
        }

        const contactosDe = new Map<string, { id: string; nombre: string; correo: string | null; biginId: string | null; principal: boolean }[]>();
        const contactos = async (prospectoId: string) => {
          if (!contactosDe.has(prospectoId)) contactosDe.set(prospectoId, await tx.contactoComercial.findMany({ where: { prospectoId }, select: { id: true, nombre: true, correo: true, biginId: true, principal: true } }));
          return contactosDe.get(prospectoId)!;
        };
        for (const x of c.contactos) {
          let p = buscar(x.empresaBiginId, x.empresa);
          if (!p) {
            if (!x.empresa) { errores.push({ archivo: 'contactos', fila: x.fila, mensaje: `${x.nombre}: sin empresa.` }); continue; }
            p = await crear({ razonSocial: x.empresa, biginId: x.empresaBiginId });
          }
          const lista = await contactos(p.id);
          const igual = lista.find((y) => (x.biginId && y.biginId === x.biginId) || (x.correo && y.correo?.toLowerCase() === x.correo) || normalizar(y.nombre) === normalizar(x.nombre));
          if (igual) { resumen.contactos.existentes++; continue; }
          const nuevo = await tx.contactoComercial.create({ data: { prospectoId: p.id, nombre: x.nombre, cargo: x.cargo, telefono: x.telefono, correo: x.correo, biginId: x.biginId,
            principal: !lista.some((y) => y.principal) }, select: { id: true, nombre: true, correo: true, biginId: true, principal: true } });
          lista.push(nuevo);
          resumen.contactos.nuevos++;
        }

        const ops = new Set((await tx.oportunidad.findMany({ where: { empresaId: a.empresaId, biginId: { not: null } }, select: { biginId: true } })).map((y) => y.biginId!));
        for (const x of n.negocios) {
          if (x.biginId && ops.has(x.biginId)) { resumen.negocios.existentes++; continue; }
          let p = buscar(x.empresaBiginId, x.empresa);
          if (!p) {
            if (!x.empresa) { errores.push({ archivo: 'negocios', fila: x.fila, mensaje: `${x.titulo}: sin empresa.` }); continue; }
            p = await crear({ razonSocial: x.empresa, biginId: x.empresaBiginId, asesorId: asesor(x.asesor) });
          }
          const contacto = x.contacto ? (await contactos(p.id)).find((y) => normalizar(y.nombre) === normalizar(x.contacto!)) : undefined;
          const cerrada = x.etapa === 'GANADA' || x.etapa === 'PERDIDA';
          await tx.oportunidad.create({ data: {
            empresaId: a.empresaId, prospectoId: p.id, contactoId: contacto?.id ?? null, titulo: x.titulo, etapa: x.etapa, valorMensual: x.valor,
            cierreEstimado: !cerrada && x.cierre ? new Date(`${x.cierre}T00:00:00Z`) : null, asesorId: asesor(x.asesor) ?? p.asesorId, biginId: x.biginId,
            cerradaEn: cerrada ? (x.cierre ? new Date(`${x.cierre}T17:00:00Z`) : new Date()) : null, clienteId: x.etapa === 'GANADA' ? p.clienteId : null,
            motivoPerdida: x.etapa === 'PERDIDA' ? `Perdida en Bigin (${x.etapaBigin || 'sin etapa'})`.slice(0, 300) : null,
            notas: [x.notas, x.etapaBigin && `Etapa en Bigin: ${x.etapaBigin}`, x.valor !== null && `Valor del negocio en Bigin: ${x.valor.toLocaleString('es-CO')}`].filter(Boolean).join('\n') || null,
            creadoPorId: a.id,
          } });
          if (x.biginId) ops.add(x.biginId);
          resumen.negocios.nuevos++;
          resumen.negocios.porEtapa[x.etapa] = (resumen.negocios.porEtapa[x.etapa] ?? 0) + 1;
        }
        if (!confirmar) throw new SoloVistaPrevia(resumen);
        await this.audit.registrar(a, 'comercial', a.empresaId, 'IMPORTAR_BIGIN', undefined, { empresas: resumen.empresas, contactos: resumen.contactos,
          negocios: { nuevos: resumen.negocios.nuevos, existentes: resumen.negocios.existentes }, errores: errores.length }, tx);
      }, { timeout: 180_000, maxWait: 10_000 });
    } catch (x) {
      if (!(x instanceof SoloVistaPrevia)) throw x;
    }
    return { ...resumen, errores: errores.slice(0, 100), totalErrores: errores.length };
  }

  // ---------------- Alertas (Comercial y Gerencia) ----------------
  async alertas(empresaId: string): Promise<Alerta[]> {
    const ahora = new Date();
    const [vencidas, web, sinRespuesta] = await Promise.all([
      this.db.actividadComercial.count({ where: { empresaId, hechaEn: null, venceEn: { lt: ahora } } }),
      this.db.actividadComercial.count({ where: { empresaId, hechaEn: null, asunto: RESPONDER_WEB } }),
      this.db.cotizacion.count({ where: { empresaId, estado: 'ENVIADA', enviadaEn: { lt: new Date(ahora.getTime() - 15 * DIA) } } }),
    ]);
    const out: Alerta[] = [];
    if (web) out.push({ tipo: 'comercial', nivel: 'alta', titulo: `${web} ${web === 1 ? 'solicitud del sitio web' : 'solicitudes del sitio web'} por responder`,
      detalle: 'Llámelas o escríbales: entre más rápido, más probable el negocio. Están en Comercial › Tareas' });
    if (vencidas) out.push({ tipo: 'comercial', nivel: vencidas > 10 ? 'alta' : 'media', titulo: `${vencidas} ${vencidas === 1 ? 'tarea comercial vencida' : 'tareas comerciales vencidas'}`,
      detalle: 'Llamadas, visitas y seguimientos con la fecha pasada. Revíselos en Comercial › Tareas' });
    if (sinRespuesta) out.push({ tipo: 'comercial', nivel: 'info', titulo: `${sinRespuesta} ${sinRespuesta === 1 ? 'cotización enviada' : 'cotizaciones enviadas'} hace más de 15 días sin respuesta`,
      detalle: 'Haga seguimiento o registre si el cliente la aceptó o la rechazó' });
    return out;
  }
}

const csv = FileFieldsInterceptor([{ name: 'empresas', maxCount: 1 }, { name: 'contactos', maxCount: 1 }, { name: 'negocios', maxCount: 1 }], { limits: { fileSize: 10 * 1024 * 1024, files: 3 } });

@Controller('comercial')
class ComercialController {
  constructor(private readonly s: ComercialService) {}
  @Permiso('comercial.gestionar') @Get('prospectos') prospectos(@ActorActual() a: Actor, @Query(new Zod(FiltroProspectos)) f: z.infer<typeof FiltroProspectos>) { return this.s.prospectos(a, f); }
  @Permiso('comercial.gestionar') @Post('prospectos') crearProspecto(@ActorActual() a: Actor, @Body(new Zod(NuevoProspecto)) b: z.infer<typeof NuevoProspecto>) { return this.s.crearProspecto(a, b); }
  @Permiso('comercial.gestionar') @Post('prospectos/desde-cliente/:clienteId') desdeCliente(@ActorActual() a: Actor, @Param('clienteId', ParseUUIDPipe) id: string) { return this.s.desdeCliente(a, id); }
  @Permiso('comercial.gestionar') @Get('prospectos/:id') prospecto(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.prospecto(a, id); }
  @Permiso('comercial.gestionar') @Patch('prospectos/:id') editarProspecto(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(EditarProspecto)) b: z.infer<typeof EditarProspecto>) {
    return this.s.editarProspecto(a, id, b);
  }
  @Permiso('comercial.gestionar') @Post('prospectos/:id/contactos') crearContacto(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(DatosContacto)) b: z.infer<typeof DatosContacto>) {
    return this.s.crearContacto(a, id, b);
  }
  @Permiso('comercial.gestionar') @Patch('contactos/:id') editarContacto(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(EditarContacto)) b: z.infer<typeof EditarContacto>) {
    return this.s.editarContacto(a, id, b);
  }
  @Permiso('comercial.gestionar') @Get('embudo') embudo(@ActorActual() a: Actor, @Query(new Zod(FiltroEmbudo)) f: z.infer<typeof FiltroEmbudo>) { return this.s.embudo(a, f); }
  @Permiso('comercial.gestionar') @Post('oportunidades') crearOportunidad(@ActorActual() a: Actor, @Body(new Zod(NuevaOportunidad)) b: z.infer<typeof NuevaOportunidad>) { return this.s.crearOportunidad(a, b); }
  @Permiso('comercial.gestionar') @Get('oportunidades/:id') oportunidad(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.oportunidad(a, id); }
  @Permiso('comercial.gestionar') @Patch('oportunidades/:id') editarOportunidad(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(EditarOportunidad)) b: z.infer<typeof EditarOportunidad>) {
    return this.s.editarOportunidad(a, id, b);
  }
  @Permiso('comercial.gestionar') @Post('oportunidades/:id/perder') @HttpCode(200) perder(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Perder)) b: z.infer<typeof Perder>) {
    return this.s.perder(a, id, b.motivo);
  }
  @Permiso('comercial.gestionar') @Post('oportunidades/:id/ganar') @HttpCode(200) ganar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Ganar)) b: z.infer<typeof Ganar>) {
    return this.s.ganar(a, id, b);
  }
  @Permiso('comercial.gestionar') @Post('oportunidades/:id/cotizaciones') crearCotizacion(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(DatosCotizacion)) b: z.infer<typeof DatosCotizacion>) {
    return this.s.crearCotizacion(a, id, b);
  }
  @Permiso('comercial.gestionar') @Patch('cotizaciones/:id') editarCotizacion(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(DatosCotizacion)) b: z.infer<typeof DatosCotizacion>) {
    return this.s.editarCotizacion(a, id, b);
  }
  @Permiso('comercial.gestionar') @Get('cotizaciones/:id/vista-previa') async vistaPrevia(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return new StreamableFile(await this.s.vistaPrevia(a, id), { type: 'application/pdf', disposition: 'inline; filename="cotizacion-borrador.pdf"' });
  }
  @Permiso('comercial.gestionar') @Post('cotizaciones/:id/enviar') @HttpCode(200) enviar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.enviar(a, id); }
  @Permiso('comercial.gestionar') @Post('cotizaciones/:id/responder') @HttpCode(200) responder(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Responder)) b: z.infer<typeof Responder>) {
    return this.s.responder(a, id, b);
  }
  @Permiso('comercial.gestionar') @Post('cotizaciones/:id/enlace') @HttpCode(200) enlace(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.enlace(a, id); }
  @Permiso('comercial.gestionar') @Post('actividades') crearActividad(@ActorActual() a: Actor, @Body(new Zod(NuevaActividad)) b: z.infer<typeof NuevaActividad>) { return this.s.crearActividad(a, b); }
  @Permiso('comercial.gestionar') @Post('actividades/:id/hecha') @HttpCode(200) completar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Completar)) b: z.infer<typeof Completar>) {
    return this.s.completar(a, id, b.resultado);
  }
  @Permiso('comercial.gestionar') @Get('tareas') tareas(@ActorActual() a: Actor, @Query(new Zod(FiltroTareas)) f: z.infer<typeof FiltroTareas>) { return this.s.tareas(a, f.todas === 'true'); }
  @Permiso('comercial.gestionar') @Post('importar-bigin') @HttpCode(200) @UseInterceptors(csv)
  importar(@ActorActual() a: Actor, @Body(new Zod(Importar)) b: z.infer<typeof Importar>,
    @UploadedFiles() f: { empresas?: Express.Multer.File[]; contactos?: Express.Multer.File[]; negocios?: Express.Multer.File[] } = {}) {
    return this.s.importarBigin(a, f, b.confirmar === 'true');
  }
  /** Público: el formulario del sitio web (pocos envíos por minuto desde la misma dirección). */
  @Publico() @LimiteCredenciales(5) @Post('formulario-web') @HttpCode(201) formularioWeb(@Body(new Zod(FormularioWeb)) b: z.infer<typeof FormularioWeb>) { return this.s.formularioWeb(b); }
}

@Global()
@Module({ imports: [DeclaracionesModule], controllers: [ComercialController], providers: [ComercialService], exports: [ComercialService] })
export class ComercialModule {}
