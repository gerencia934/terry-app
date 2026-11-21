// Portal de clientes (19-11-2026). Requisitos de producción §2: el cliente consulta y descarga SOLO lo suyo.
// Doble barrera:
//   1. El API filtra cada consulta por el cliente del token (nunca por un id que mande el navegador) y por las sedes
//      permitidas del usuario; un documento de otro cliente responde 404.
//   2. Cada consulta corre en una transacción con app.cliente_id fijado: la base (RLS, migración
//      20261126000000_portal_clientes) solo deja ver las filas de ese cliente, aunque el API tuviera un error.
// Descargas: enlace firmado de 5 minutos, generado después de verificar que el documento es del cliente.
// Escritura (solo el perfil Administrador del cliente): cargar sus declaraciones (quedan en revisión, sin precio), pedir
// servicios (quedan «por confirmar») y cancelar los que nadie ha confirmado. La base limita además qué puede escribir una
// sesión del portal (migración 20261127000000_portal_escritura).
import {
  BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Jornada, Prisma, PerfilPortal } from '@prisma/client';
import type { Response } from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AVISO_CLIENTE_INACTIVO } from '@terraviva/shared';
import { PrismaService } from '../prisma/prisma.service';
import { Notificaciones } from '../notificaciones/notificaciones.module';
import { Auditoria } from '../common/servicios';
import { Archivos } from '../common/archivos';
import { ActorActual, Permiso, Publico, SoloPortal, Zod, fechaColombia, paginar, type Actor } from '../common/http';
import type { Config } from '../config';
import { AuthModule } from '../auth/auth.module';
import { AuthService, hashClave } from '../auth/auth.service';
import { ManifiestosModule, ManifiestosService } from '../manifiestos/manifiestos.module';
import { ImportacionModule, ImportacionService } from '../importacion/importacion.module';
import { CertificadoComercialModule, CertificadoComercialService } from '../clientes/certificado-comercial.module';
import { mensajePortal, retencionesCertificados } from '../finanzas/estado';
import { RefArchivos, esClaveAlmacen } from './archivos-portal';

type Tx = Prisma.TransactionClient;
const Pagina = z.object({ pagina: z.coerce.number().optional(), porPagina: z.coerce.number().optional() });
const FiltroDecl = Pagina.extend({ estado: z.enum(['AUTORIZADA', 'PENDIENTE', 'BORRADOR', 'RECHAZADA']).optional(), tipo: z.enum(['RESIDUO', 'SERVICIO']).optional(), q: z.string().max(80).optional(),
  activa: z.enum(['true', 'false']).optional() });
const FiltroFechas = Pagina.extend({ desde: z.coerce.date().optional(), hasta: z.coerce.date().optional() });
const FiltroAnio = Pagina.extend({ anio: z.coerce.number().int().min(2000).max(2100).optional() });
const FiltroInforme = z.object({ anio: z.coerce.number().int().min(2000).max(2100) });
const textoOpc = (max: number) => z.string().trim().max(max).transform((x) => x || null).nullish();
const DatosUsuario = z.object({
  nombre: z.string().trim().min(3).max(150), documento: z.string().trim().regex(/^[0-9A-Za-z.-]{4,20}$/, 'Documento de 4 a 20 caracteres'), telefono: textoOpc(20),
  // Rol del portal (Ajustes › Roles). «perfil» sigue sirviendo: ADMIN y CONSULTA eligen los dos roles predeterminados.
  rolId: z.string().uuid().optional(), perfil: z.nativeEnum(PerfilPortal).optional(), sucursalIds: z.array(z.string().uuid()).max(500).default([]),
});
const CrearUsuario = DatosUsuario.extend({ email: z.string().trim().toLowerCase().email('Correo inválido').max(150) });
const EditarUsuario = DatosUsuario.partial().extend({ activo: z.boolean().optional() });
const FiltroSol = Pagina.extend({
  estado: z.enum(['POR_CONFIRMAR', 'PENDIENTE', 'PROGRAMADA', 'EN_CURSO', 'RECOLECTADA', 'CANCELADA', 'NO_APROBADA']).optional(),
  operacion: z.enum(['CARGA', 'DESCARGA']).optional(), desde: z.coerce.date().optional(), hasta: z.coerce.date().optional(),
});
/** Vehículo y tripulación del cliente en una entrega en planta (lo exige la planta para dejarlo entrar). */
const TransportePortal = z.object({
  empresaTransportadora: z.string().trim().min(2, 'Escriba la empresa transportadora.').max(200),
  tipoVehiculo: textoOpc(40),
  placa: z.string().trim().toUpperCase().regex(/^([A-Z]{3}\d{3}|[A-Z]{3}\d{2}[A-Z]|[RS]\d{5})$/, 'Placa inválida (ABC123).'),
  conductorNombre: z.string().trim().min(3, 'Escriba el nombre del conductor.').max(150),
  conductorDocumento: z.string().trim().regex(/^[0-9A-Za-z.-]{4,20}$/, 'Cédula del conductor: de 4 a 20 caracteres.'),
  conductorArlId: z.string().uuid('Elija la ARL del conductor.'), conductorEpsId: z.string().uuid('Elija la EPS del conductor.'),
  auxiliarNombre: textoOpc(150), auxiliarDocumento: z.string().trim().regex(/^[0-9A-Za-z.-]{4,20}$/, 'Cédula del auxiliar: de 4 a 20 caracteres.').or(z.literal('').transform(() => null)).nullish(),
  auxiliarArlId: z.string().uuid().nullish(), auxiliarEpsId: z.string().uuid().nullish(),
});
const PedirServicio = z.object({
  /** CARGA: Terra Viva recoge en las sedes. DESCARGA: el cliente lleva el residuo a la planta en su propio vehículo. */
  operacion: z.enum(['CARGA', 'DESCARGA']).default('CARGA'),
  sucursalId: z.string().uuid('Elija la sede.').optional(), // sede de las líneas que no traen la suya
  fechaSolicitada: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha en formato AAAA-MM-DD.'),
  ordenCompra: textoOpc(40), observaciones: textoOpc(1000),
  destinoId: z.string().uuid().optional(), transporte: TransportePortal.optional(), telefonoContacto: textoOpc(20),
  /** Referencia de un PDF subido antes (orden de compra, remisión): undefined = sin cambio; null = quitarlo. */
  adjunto: z.string().max(1000).nullish(),
  items: z.array(z.object({
    declaracionId: z.string().uuid(), sucursalId: z.string().uuid().optional(),
    cantidadEstimada: z.number().positive('La cantidad debe ser mayor que cero.').max(1e9), jornada: z.nativeEnum(Jornada).optional(),
    especificacionIds: z.array(z.string().uuid()).max(10).default([]),
  })).min(1, 'Elija al menos un residuo o servicio.').max(50, 'Máximo 50 líneas por solicitud.'),
}).superRefine((b, ctx) => {
  if (b.operacion !== 'DESCARGA') return;
  if (!b.destinoId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['destinoId'], message: 'Elija la planta donde entrega.' });
  if (!b.transporte) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['transporte'], message: 'Indique el vehículo y el conductor que llevan el residuo.' });
  if (!b.telefonoContacto) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['telefonoContacto'], message: 'Indique un teléfono de contacto para la entrega.' });
});
const Cancelar = z.object({ motivo: z.string().trim().min(5, 'Cuéntenos el motivo (mínimo 5 caracteres).').max(300) });
/** Causal con la que queda una solicitud que cancela el propio cliente (se crea la primera vez que se usa). */
const CAUSAL_PORTAL = { codigo: 'CAU-PORTAL', nombre: 'Cancelada por el cliente desde el portal' };
type Documento = 'acta' | 'manifiesto' | 'comercial';

@Injectable()
export class PortalService {
  private readonly claveDescargas: string;
  /** Referencias firmadas de los archivos que sube el cliente (orden de compra, ficha de seguridad…). */
  readonly refs: RefArchivos;
  constructor(private readonly db: PrismaService, private readonly audit: Auditoria, private readonly auth: AuthService, private readonly archivos: Archivos,
    private readonly manifiestos: ManifiestosService, private readonly importacion: ImportacionService, private readonly jwt: JwtService, cfg: ConfigService<Config, true>,
    private readonly comercial: CertificadoComercialService, private readonly notificaciones: Notificaciones) {
    // Clave propia de los enlaces de descarga (distinta de la de las sesiones)
    this.claveDescargas = createHash('sha256').update(`${cfg.get('JWT_SECRET', { infer: true })}:descargas-portal`).digest('base64url');
    this.refs = new RefArchivos(cfg);
  }

  /** Segunda barrera: las consultas del portal corren con app.cliente_id y la base solo deja ver ese cliente. */
  conCliente<T>(a: Actor, fn: (tx: Tx) => Promise<T>, timeout = 20_000): Promise<T> {
    const cliente = a.clienteId;
    if (!cliente) throw new ForbiddenException({ mensaje: 'Solo para usuarios del portal de clientes.' });
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.cliente_id', ${cliente}, true)`;
      return fn(tx);
    }, { timeout, maxWait: 10_000 });
  }

  /**
   * Funciones del rol del usuario en el portal (las decide Terra Viva en Ajustes › Roles). Se leen de la base, con 15
   * segundos de memoria: un cambio de rol o de sus funciones rige casi de inmediato, sin cerrar la sesión.
   */
  private readonly memoriaPermisos = new Map<string, { hasta: number; permisos: string[]; rol: { id: string; nombre: string } }>();
  async permisosPortal(a: Actor) {
    const m = this.memoriaPermisos.get(a.id);
    if (m && m.hasta > Date.now()) return m;
    const u = await this.db.usuario.findUnique({ where: { id: a.id }, select: { rol: { select: { id: true, nombre: true, activo: true, acceso: true,
      permisos: { select: { permiso: { select: { codigo: true } } } } } } } });
    const permisos = u?.rol.activo && u.rol.acceso === 'CLIENTE' ? u.rol.permisos.map((p) => p.permiso.codigo).filter((c) => c.startsWith('portal.')) : [];
    const r = { hasta: Date.now() + 15_000, permisos, rol: { id: u?.rol.id ?? '', nombre: u?.rol.nombre ?? '' } };
    this.memoriaPermisos.set(a.id, r);
    return r;
  }
  async puede(a: Actor, ...codigos: string[]) { const p = (await this.permisosPortal(a)).permisos; return codigos.some((c) => p.includes(c)); }
  /** El rol del usuario en el portal debe tener alguna de estas funciones. */
  async exigir(a: Actor, ...codigos: string[]) {
    if (!(await this.puede(a, ...codigos)))
      throw new ForbiddenException({ mensaje: 'Su rol en el portal no incluye esta función: pídasela al administrador de su empresa en el portal.', codigo: 'SIN_FUNCION' });
  }

  /** Sedes que puede ver el usuario (vacío = todas las de su cliente). */
  async sedesDe(tx: Tx | PrismaService, a: Actor) { return this.sedes(tx, a); }
  private async sedes(tx: Tx | PrismaService, a: Actor) { return (await tx.usuarioSucursal.findMany({ where: { usuarioId: a.id }, select: { sucursalId: true } })).map((s) => s.sucursalId); }
  /**
   * Un administrador del portal limitado a unas sedes solo ve y gestiona usuarios limitados a esas mismas sedes: no puede
   * dar (ni darse, con otro correo) más acceso del que tiene. `mias` vacío = ve todas las sedes de su empresa.
   */
  private dentroDeSusSedes(mias: string[], suyas: string[]) { return !mias.length || (suyas.length > 0 && suyas.every((s) => mias.includes(s))); }

  /**
   * Cliente inactivo (gerencia, 19-11-2026): sigue consultando y descargando, pero no pide servicios ni carga
   * declaraciones. El aviso es amable y nunca muestra la nota interna de la oficina.
   */
  async exigirActivo(tx: Tx, a: Actor) {
    const c = await tx.cliente.findUniqueOrThrow({ where: { id: a.clienteId }, select: { activo: true, motivoInactivacion: true } });
    if (!c.activo) throw new ForbiddenException({ mensaje: AVISO_CLIENTE_INACTIVO[c.motivoInactivacion ?? 'OTRO'], codigo: 'CLIENTE_INACTIVO' });
  }

  async yo(a: Actor) {
    return this.conCliente(a, async (tx) => {
      const [{ motivoInactivacion, ...cliente }, sedes, permitidas, u] = await Promise.all([
        tx.cliente.findUniqueOrThrow({ where: { id: a.clienteId }, select: { id: true, razonSocial: true, nit: true, dv: true, tipo: true, activo: true, motivoInactivacion: true } }),
        tx.sucursal.findMany({ where: { clienteId: a.clienteId, activa: true }, orderBy: [{ esPrincipal: 'desc' }, { nombre: 'asc' }], select: { id: true, codigo: true, nombre: true, municipio: { select: { nombre: true } } } }),
        this.sedes(tx, a),
        tx.usuario.findUniqueOrThrow({ where: { id: a.id }, select: { nombre: true, email: true, perfilPortal: true } }),
      ]);
      const { permisos, rol } = await this.permisosPortal(a);
      return { usuario: u, cliente, rol, permisos, perfil: permisos.includes('portal.usuarios.gestionar') ? 'ADMIN' as const : 'CONSULTA' as const,
        sedes: permitidas.length ? sedes.filter((s) => permitidas.includes(s.id)) : sedes, restringido: permitidas.length > 0,
        aviso: cliente.activo ? null : AVISO_CLIENTE_INACTIVO[motivoInactivacion ?? 'OTRO'] };
    });
  }

  async resumen(a: Actor) {
    return this.conCliente(a, async (tx) => {
      const sedes = await this.sedes(tx, a);
      const hoy = fechaColombia();
      const inicioMes = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1));
      const inicioAnio = new Date(Date.UTC(hoy.getUTCFullYear(), 0, 1));
      const enSede = sedes.length ? { sucursalId: { in: sedes } } : {};
      const declSede = sedes.length ? { sucursales: { some: { sucursalId: { in: sedes } } } } : {};
      const [autorizadas, pendientes, solicitudes, servicios, certificados, proximos] = await Promise.all([
        tx.declaracion.count({ where: { clienteId: a.clienteId, estado: 'AUTORIZADA', activa: true, ...declSede } }),
        tx.declaracion.count({ where: { clienteId: a.clienteId, estado: 'PENDIENTE', ...declSede } }),
        tx.solicitud.count({ where: { clienteId: a.clienteId, estado: { in: ['PENDIENTE', 'PROGRAMADA'] }, ...(sedes.length ? { items: { some: enSede } } : {}) } }),
        tx.manifiesto.count({ where: { clienteId: a.clienteId, estado: 'REALIZADO', fechaServicio: { gte: inicioMes }, ...(sedes.length ? { items: { some: enSede } } : {}) } }),
        tx.acta.count({ where: { clienteId: a.clienteId, estado: 'EMITIDA', emitidaEn: { gte: inicioAnio }, ...this.actaSede(sedes) } }),
        tx.solicitudItem.findMany({ where: { solicitud: { clienteId: a.clienteId }, estado: 'PROGRAMADO', ...enSede, rutaItems: { some: { liberado: false, ruta: { fechaProgramada: { gte: hoy } } } } },
          take: 8, select: { id: true, cantidadEstimada: true, declaracion: { select: { nombre: true } }, sucursal: { select: { nombre: true } },
            rutaItems: { where: { liberado: false }, take: 1, select: { ruta: { select: { fechaProgramada: true } } } } } }),
      ]);
      return {
        declaraciones: { autorizadas, pendientes }, solicitudesAbiertas: solicitudes, serviciosDelMes: servicios, certificadosDelAnio: certificados,
        proximos: proximos.map((x) => ({ id: x.id, fecha: x.rutaItems[0]?.ruta.fechaProgramada ?? null, residuo: x.declaracion.nombre, sede: x.sucursal.nombre, cantidad: x.cantidadEstimada }))
          .sort((x, y) => String(x.fecha).localeCompare(String(y.fecha))),
      };
    });
  }

  /** Un acta es de las sedes del usuario si alguna de sus líneas salió de ellas. */
  private actaSede(sedes: string[]): Prisma.ActaWhereInput {
    return sedes.length ? { items: { some: { manifiestoItem: { sucursalId: { in: sedes } } } } } : {};
  }

  async declaraciones(a: Actor, f: z.infer<typeof FiltroDecl>) {
    await this.exigir(a, 'portal.declaraciones.ver');
    const precios = await this.puede(a, 'portal.precios.ver');
    const { take, skip, pagina, porPagina } = paginar(f);
    return this.conCliente(a, async (tx) => {
      const sedes = await this.sedes(tx, a);
      const where: Prisma.DeclaracionWhereInput = {
        clienteId: a.clienteId, estado: f.estado ?? { not: 'ANULADA' }, tipo: f.tipo, activa: f.activa ? f.activa === 'true' : undefined,
        ...(f.q ? { OR: [{ nombre: { contains: f.q, mode: 'insensitive' } }, { codigoInterno: { contains: f.q, mode: 'insensitive' } }] } : {}),
        ...(sedes.length ? { sucursales: { some: { sucursalId: { in: sedes } } } } : {}),
      };
      const hoy = fechaColombia();
      const [total, filas] = await Promise.all([
        tx.declaracion.count({ where }),
        tx.declaracion.findMany({ where, take, skip, orderBy: { numero: 'desc' }, select: {
          id: true, numero: true, tipo: true, nombre: true, codigoInterno: true, estado: true, activa: true, esPeligroso: true, frecuenciaDias: true, cantidadFrecuencia: true,
          estadoFisico: true, inflamable: true, fichaSeguridadUrl: true, codigoY: { select: { codigo: true } }, codigoA: { select: { codigo: true } },
          lineaServicio: { select: { nombre: true } }, sucursales: { where: { activa: true }, select: { sucursal: { select: { id: true, codigo: true, nombre: true } } } },
          disposiciones: { select: { principal: true, disposicion: { select: { nombre: true } } } },
          tarifas: { where: { vigenteDesde: { lte: hoy }, OR: [{ vigenteHasta: null }, { vigenteHasta: { gte: hoy } }] }, take: 1, orderBy: { vigenteDesde: 'desc' }, select: { precioUnitario: true, metrica: { select: { abreviacion: true } } } },
        } }),
      ]);
      // La clave interna del archivo no sale del servidor: solo si la ficha de seguridad está en el expediente
      return { total, pagina, porPagina, filas: filas.map(({ tarifas, fichaSeguridadUrl, ...d }) => ({ ...d, precio: precios ? tarifas[0] ?? null : null, tieneFichaSeguridad: !!fichaSeguridadUrl })) };
    });
  }

  async declaracion(a: Actor, id: string) {
    await this.exigir(a, 'portal.declaraciones.ver');
    const precios = await this.puede(a, 'portal.precios.ver');
    return this.conCliente(a, async (tx) => {
      const sedes = await this.sedes(tx, a);
      const d = await tx.declaracion.findFirst({ where: { id, clienteId: a.clienteId, estado: { not: 'ANULADA' }, ...(sedes.length ? { sucursales: { some: { sucursalId: { in: sedes } } } } : {}) }, select: {
        id: true, numero: true, tipo: true, nombre: true, codigoInterno: true, estado: true, activa: true, esPeligroso: true, composicion: true, descripcionProceso: true,
        descripcionServicio: true, estadoFisico: true, frecuenciaDias: true, cantidadFrecuencia: true, fichaSeguridadUrl: true, caracterizacionUrl: true, observaciones: true, aprobadaEn: true,
        inflamable: true, contieneHidrocarburos: true, codigoUn: true, riesgos: { select: { riesgo: { select: { nombre: true } } } }, presentacion: true, material: { select: { nombre: true } },
        responsabilidadAceptada: true, aceptadaEn: true, categoria: { select: { nombre: true } }, tipoResiduo: { select: { nombre: true } }, lineaServicio: { select: { nombre: true } },
        codigoY: { select: { codigo: true, descripcion: true } }, codigoA: { select: { codigo: true, descripcion: true } }, tipoEmbalaje: { select: { nombre: true } },
        sucursales: { select: { activa: true, sucursal: { select: { codigo: true, nombre: true } } } }, disposiciones: { select: { principal: true, disposicion: { select: { nombre: true } } } },
        tarifas: { orderBy: { vigenteDesde: 'desc' }, select: { precioUnitario: true, vigenteDesde: true, vigenteHasta: true, metrica: { select: { abreviacion: true } } } },
      } });
      if (!d) throw new NotFoundException({ mensaje: 'Declaración no encontrada.' });
      // La clave interna del archivo no sale del servidor: el cliente solo sabe si la ficha está en el expediente
      const { fichaSeguridadUrl, caracterizacionUrl, tarifas, ...resto } = d;
      return { ...resto, tarifas: precios ? tarifas : [], tieneFichaSeguridad: !!fichaSeguridadUrl, tieneCaracterizacion: !!caracterizacionUrl };
    });
  }

  async solicitudes(a: Actor, f: z.infer<typeof FiltroSol>) {
    await this.exigir(a, 'portal.solicitudes.ver');
    const precios = await this.puede(a, 'portal.precios.ver');
    const { take, skip, pagina, porPagina } = paginar(f);
    return this.conCliente(a, async (tx) => {
      const sedes = await this.sedes(tx, a);
      const enSede = sedes.length ? { sucursalId: { in: sedes } } : {};
      // «Por confirmar»: pedido que Terra Viva aún no aprueba; «No aprobada»: la aprobación se negó
      const estado: Prisma.SolicitudWhereInput = f.estado === 'POR_CONFIRMAR' ? { aprobacion: 'PENDIENTE', estado: 'PENDIENTE' }
        : f.estado === 'NO_APROBADA' ? { aprobacion: 'NO_APROBADA' }
        : f.estado === 'PENDIENTE' ? { aprobacion: 'APROBADA', estado: 'PENDIENTE' } : f.estado ? { estado: f.estado } : {};
      const where: Prisma.SolicitudWhereInput = {
        clienteId: a.clienteId, operacion: f.operacion, fechaSolicitada: { gte: f.desde, lte: f.hasta }, ...estado,
        ...(sedes.length ? { items: { some: enSede } } : {}),
      };
      const [total, filas] = await Promise.all([
        tx.solicitud.count({ where }),
        tx.solicitud.findMany({ where, take, skip, orderBy: [{ fechaSolicitada: 'desc' }, { numero: 'desc' }], select: {
          id: true, numero: true, clase: true, operacion: true, fechaSolicitada: true, aprobacion: true, estado: true, ordenCompra: true, observaciones: true,
          totalEstimado: true, telefonoContacto: true, adjuntoUrl: true, createdAt: true, destino: { select: { razonSocial: true } },
          transporte: { select: { empresaTransportadora: true, tipoVehiculo: true, placa: true, conductorNombre: true } },
          items: { where: enSede, select: { id: true, estado: true, cantidadEstimada: true, cantidadReal: true, jornada: true, declaracionId: true, sucursalId: true,
            declaracion: { select: { nombre: true, codigoInterno: true } }, sucursal: { select: { nombre: true } },
            especificaciones: { select: { especificacion: { select: { nombre: true } } } } } },
        } }),
      ]);
      return { total, pagina, porPagina, filas: filas.map(({ adjuntoUrl, totalEstimado, ...s }) => ({ ...s, totalEstimado: totalEstimado === null || !precios ? null : Number(totalEstimado), tieneAdjunto: !!adjuntoUrl })) };
    });
  }

  async listaManifiestos(a: Actor, f: z.infer<typeof FiltroFechas>) {
    await this.exigir(a, 'portal.manifiestos.ver');
    const { take, skip, pagina, porPagina } = paginar(f);
    return this.conCliente(a, async (tx) => {
      const sedes = await this.sedes(tx, a);
      const enSede = sedes.length ? { sucursalId: { in: sedes } } : {};
      const where: Prisma.ManifiestoWhereInput = {
        clienteId: a.clienteId, estado: { in: ['REALIZADO', 'ANULADO'] }, fechaServicio: { gte: f.desde, lte: f.hasta }, ...(sedes.length ? { items: { some: enSede } } : {}),
      };
      const [total, filas] = await Promise.all([
        tx.manifiesto.count({ where }),
        tx.manifiesto.findMany({ where, take, skip, orderBy: [{ fechaServicio: 'desc' }, { numero: 'desc' }], select: {
          id: true, numero: true, tipo: true, estado: true, fechaServicio: true, destino: { select: { razonSocial: true, esPropio: true } },
          items: { where: enSede, select: { id: true, cantidad: true, metrica: { select: { abreviacion: true } }, declaracion: { select: { nombre: true } }, sucursal: { select: { nombre: true } },
            conciliacion: { select: { cantidadConciliada: true } } } },
          conciliacion: { select: { estado: true } },
        } }),
      ]);
      return { total, pagina, porPagina, filas };
    });
  }

  async certificados(a: Actor, f: z.infer<typeof FiltroAnio>) {
    await this.exigir(a, 'portal.certificados.ver');
    const { take, skip, pagina, porPagina } = paginar(f);
    return this.conCliente(a, async (tx) => {
      const sedes = await this.sedes(tx, a);
      const where: Prisma.ActaWhereInput = {
        clienteId: a.clienteId, estado: 'EMITIDA', ...this.actaSede(sedes),
        ...(f.anio ? { periodoHasta: { gte: new Date(Date.UTC(f.anio, 0, 1)) }, periodoDesde: { lte: new Date(Date.UTC(f.anio, 11, 31)) } } : {}),
      };
      const [total, filas] = await Promise.all([
        tx.acta.count({ where }),
        tx.acta.findMany({ where, take, skip, orderBy: { emitidaEn: 'desc' }, select: {
          id: true, numero: true, tipo: true, periodoDesde: true, periodoHasta: true, emitidaEn: true, codigoVerificacion: true,
          destino: { select: { razonSocial: true, esPropio: true } }, _count: { select: { items: true } },
        } }),
      ]);
      // Regla del certificado del cliente (factura, pago o factura vencida): se ve, pero no se descarga (mensaje amable).
      // Se evalúa fuera de la sesión del portal: la base no le deja leer la información financiera interna.
      const empresa = await this.db.empresa.findUniqueOrThrow({ where: { id: a.empresaId }, select: { configuracion: true } });
      const retenidos = await retencionesCertificados(this.db, empresa.configuracion, filas.map((x) => x.id), 'PORTAL');
      return { total, pagina, porPagina, filas: filas.map((x) => {
        const r = retenidos.get(x.id);
        return { ...x, pendientePago: r ? { facturas: r.facturas, mensaje: mensajePortal(r) } : null };
      }) };
    });
  }

  /** Certificado retenido por la regla de su cliente: no se entrega el enlace (ni se sirve uno ya entregado). */
  private async exigirPago(_tx: Tx, a: Actor, actaId: string) {
    const empresa = await this.db.empresa.findUniqueOrThrow({ where: { id: a.empresaId }, select: { configuracion: true } });
    const r = (await retencionesCertificados(this.db, empresa.configuracion, [actaId], 'PORTAL')).get(actaId);
    if (r) throw new ForbiddenException({ mensaje: mensajePortal(r), codigo: r.motivo === 'FACTURA' ? 'PENDIENTE_FACTURA' : 'PENDIENTE_PAGO', facturas: r.facturas });
  }

  /**
   * Informe del año: lo gestionado por residuo y por mes. Vale lo conciliado en planta cuando la conciliación está
   * aprobada; mientras tanto, lo del manifiesto (y se cuenta como «por conciliar»). Se suma en la base: no trae líneas.
   */
  async informe(a: Actor, anio: number) {
    await this.exigir(a, 'portal.informes.ver');
    return this.conCliente(a, async (tx) => {
      const sedes = await this.sedes(tx, a);
      const enSede = sedes.length ? Prisma.sql`AND mi.sucursal_id = ANY(${sedes}::uuid[])` : Prisma.empty;
      const filas = await tx.$queryRaw<{ declaracion_id: string; numero: number; nombre: string; metrica: string | null; factor: string | null; mes: number; cantidad: string; servicios: number; por_conciliar: number }[]>`
        WITH lineas AS (
          SELECT mi.declaracion_id, mf.id AS manifiesto_id, EXTRACT(MONTH FROM mf.fecha_servicio)::int AS mes,
                 (c.estado = 'APROBADA' AND ci.cantidad_destino IS NOT NULL) AS conciliada,
                 CASE WHEN c.estado = 'APROBADA' AND ci.cantidad_destino IS NOT NULL THEN ci.cantidad_destino ELSE mi.cantidad_origen END AS cantidad,
                 CASE WHEN c.estado = 'APROBADA' AND ci.cantidad_destino IS NOT NULL THEN COALESCE(ci.metrica_id, mi.metrica_id) ELSE mi.metrica_id END AS metrica_id
          FROM manifiesto_items mi
          JOIN manifiestos mf ON mf.id = mi.manifiesto_id
          LEFT JOIN conciliacion_items ci ON ci.manifiesto_item_id = mi.id
          LEFT JOIN conciliaciones c ON c.id = ci.conciliacion_id
          WHERE mf.cliente_id = ${a.clienteId}::uuid AND mf.estado = 'REALIZADO'
            AND mf.fecha_servicio >= ${`${anio}-01-01`}::date AND mf.fecha_servicio < ${`${anio + 1}-01-01`}::date ${enSede}
        )
        SELECT l.declaracion_id, d.numero, d.nombre, me.abreviacion AS metrica, me.factor_a_kg::text AS factor, l.mes,
               SUM(l.cantidad)::text AS cantidad, COUNT(DISTINCT l.manifiesto_id)::int AS servicios, (COUNT(*) FILTER (WHERE NOT l.conciliada))::int AS por_conciliar
        FROM lineas l JOIN declaraciones d ON d.id = l.declaracion_id LEFT JOIN metricas me ON me.id = l.metrica_id
        GROUP BY l.declaracion_id, d.numero, d.nombre, me.abreviacion, me.factor_a_kg, l.mes
        ORDER BY d.numero, me.abreviacion, l.mes`;
      // Una fila por residuo y unidad, con los 12 meses
      const lineas = new Map<string, { declaracionId: string; numero: number; nombre: string; metrica: string | null; kgPorUnidad: number | null; meses: number[]; total: number; servicios: number; porConciliar: number }>();
      for (const f of filas) {
        const k = `${f.declaracion_id}|${f.metrica ?? ''}`;
        const l = lineas.get(k) ?? { declaracionId: f.declaracion_id, numero: f.numero, nombre: f.nombre, metrica: f.metrica, kgPorUnidad: f.factor === null ? null : Number(f.factor), meses: Array(12).fill(0), total: 0, servicios: 0, porConciliar: 0 };
        const c = Number(f.cantidad);
        l.meses[f.mes - 1] += c; l.total += c; l.servicios += f.servicios; l.porConciliar += f.por_conciliar;
        lineas.set(k, l);
      }
      const r2 = (x: number) => Math.round(x * 100) / 100;
      const lista = [...lineas.values()].map((l) => ({ ...l, meses: l.meses.map(r2), total: r2(l.total) }));
      const kgMes = Array.from({ length: 12 }, (_, i) => r2(lista.reduce((s, l) => s + (l.kgPorUnidad === null ? 0 : l.meses[i] * l.kgPorUnidad), 0)));
      return { anio, lineas: lista, kgPorMes: kgMes, totalKg: r2(kgMes.reduce((s, x) => s + x, 0)), sinConvertir: lista.filter((l) => l.kgPorUnidad === null).length,
        porConciliar: lista.reduce((s, l) => s + l.porConciliar, 0) };
    });
  }

  // ---------------- Cargue de sus declaraciones ----------------
  /**
   * Cargue de declaraciones desde el portal (fase C): la misma plantilla de la oficina sin NIT ni precio. Revisar no
   * guarda nada; confirmar exige aceptar la declaración de responsabilidad del generador y deja todo en revisión.
   */
  async cargueDeclaraciones(a: Actor, plantilla: string, file: Express.Multer.File | undefined, delimitador: string | undefined, confirmar: boolean, acepta: boolean) {
    await this.exigir(a, 'portal.declaraciones.gestionar');
    const cliente = await this.conCliente(a, async (tx) => {
      await this.exigirActivo(tx, a);
      return { ...(await tx.cliente.findUniqueOrThrow({ where: { id: a.clienteId }, select: { id: true, nit: true } })), sedes: await this.sedes(tx, a) };
    });
    if (!confirmar) {
      const { plantilla: _p, ids: _i, nombres: _n, hash: _h, ...r } = await this.importacion.validarPortal(a, plantilla, cliente, file, delimitador);
      return r;
    }
    if (!acepta) throw new BadRequestException({ mensaje: 'Para cargar, acepte la declaración de responsabilidad del generador.' });
    return this.importacion.confirmarPortal(a, plantilla, cliente, (fn) => this.conCliente(a, fn, 120_000), file, delimitador);
  }

  // ---------------- Pedir servicios ----------------
  /**
   * Lo que el usuario puede pedir: sus sedes activas y, en cada una, las declaraciones autorizadas y activas. Para una
   * entrega en planta: las plantas propias de Terra Viva que reciben, y las ARL y EPS del conductor y el auxiliar.
   */
  async opcionesPedido(a: Actor) {
    await this.exigir(a, 'portal.solicitudes.pedir', 'portal.entregas.pedir');
    const operaciones = [...(await this.puede(a, 'portal.solicitudes.pedir') ? ['CARGA' as const] : []), ...(await this.puede(a, 'portal.entregas.pedir') ? ['DESCARGA' as const] : [])];
    const [base, especificaciones, destinos, entidades] = await Promise.all([
      this.conCliente(a, async (tx) => {
        const sedes = await this.sedes(tx, a);
        const hoy = fechaColombia();
        const filas = await tx.sucursal.findMany({
          where: { clienteId: a.clienteId, activa: true, ...(sedes.length ? { id: { in: sedes } } : {}) }, orderBy: [{ esPrincipal: 'desc' }, { nombre: 'asc' }], take: 300,
          select: { id: true, codigo: true, nombre: true, municipio: { select: { nombre: true } },
            declaraciones: { where: { activa: true, declaracion: { estado: 'AUTORIZADA', activa: true } }, select: { declaracion: { select: {
              id: true, numero: true, nombre: true, codigoInterno: true, tipo: true,
              tarifas: { where: { vigenteDesde: { lte: hoy }, OR: [{ vigenteHasta: null }, { vigenteHasta: { gte: hoy } }] }, take: 1, orderBy: { vigenteDesde: 'desc' }, select: { metrica: { select: { abreviacion: true } } } },
            } } } } },
        });
        return { hoy: hoy.toISOString().slice(0, 10), sedes: filas.map((x) => ({
          id: x.id, codigo: x.codigo, nombre: x.nombre, municipio: x.municipio?.nombre ?? null,
          declaraciones: x.declaraciones.map(({ declaracion: d }) => ({ id: d.id, numero: d.numero, nombre: d.nombre, codigoInterno: d.codigoInterno, tipo: d.tipo, unidad: d.tarifas[0]?.metrica?.abreviacion ?? null }))
            .sort((p, q) => p.nombre.localeCompare(q.nombre, 'es')),
        })) };
      }),
      this.db.especificacionAdicional.findMany({ where: { empresaId: a.empresaId, activo: true }, orderBy: { nombre: 'asc' }, select: { id: true, nombre: true, descripcion: true } }),
      this.db.proveedor.findMany({ where: { empresaId: a.empresaId, esDestino: true, esPropio: true, activo: true }, orderBy: { razonSocial: 'asc' }, select: { id: true, razonSocial: true } }),
      this.db.entidadSeguridadSocial.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' }, select: { id: true, tipo: true, nombre: true } }),
    ]);
    return { ...base, operaciones, especificaciones, destinos, arl: entidades.filter((e) => e.tipo === 'ARL').map(({ tipo: _t, ...e }) => e), eps: entidades.filter((e) => e.tipo === 'EPS').map(({ tipo: _t, ...e }) => e) };
  }

  /** Revisa fecha, sedes, residuos, especificaciones, destino y adjunto de un pedido; devuelve sus líneas con precio. */
  private async validarPedido(tx: Tx, a: Actor, b: z.infer<typeof PedirServicio>) {
    const fecha = new Date(`${b.fechaSolicitada}T00:00:00Z`);
    const hoy = fechaColombia();
    if (Number.isNaN(fecha.getTime())) throw new BadRequestException({ mensaje: 'Fecha no válida.' });
    if (fecha < hoy) throw new BadRequestException({ mensaje: 'La fecha no puede ser anterior a hoy.' });
    if (fecha.getTime() > hoy.getTime() + 366 * 86_400_000) throw new BadRequestException({ mensaje: 'Pida el servicio con máximo un año de anticipación.' });
    const lineas = b.items.map((i) => ({ ...i, sucursalId: i.sucursalId ?? b.sucursalId }));
    if (lineas.some((l) => !l.sucursalId)) throw new BadRequestException({ mensaje: 'Indique la sede de cada residuo o servicio.' });
    const claves = lineas.map((l) => `${l.declaracionId}|${l.sucursalId}`);
    if (new Set(claves).size !== claves.length) throw new BadRequestException({ mensaje: 'Cada residuo o servicio va una sola vez por sede en la solicitud.' });
    const mias = await this.sedes(tx, a);
    const idsSede = [...new Set(lineas.map((l) => l.sucursalId!))];
    const sedes = (!mias.length || idsSede.every((s) => mias.includes(s)))
      ? await tx.sucursal.findMany({ where: { id: { in: idsSede }, clienteId: a.clienteId, activa: true }, select: { id: true, nombre: true } }) : [];
    if (sedes.length !== idsSede.length) throw new NotFoundException({ mensaje: 'Alguna sede no existe, está inactiva o usted no la ve.' });
    const decls = await tx.declaracion.findMany({
      where: { id: { in: [...new Set(lineas.map((l) => l.declaracionId))] }, clienteId: a.clienteId, estado: 'AUTORIZADA', activa: true },
      select: { id: true, nombre: true, sucursales: { where: { activa: true }, select: { sucursalId: true } },
        tarifas: { where: { vigenteDesde: { lte: fecha }, OR: [{ vigenteHasta: null }, { vigenteHasta: { gte: fecha } }] }, take: 1, orderBy: { vigenteDesde: 'desc' }, select: { precioUnitario: true } } },
    });
    for (const l of lineas) {
      const d = decls.find((x) => x.id === l.declaracionId);
      const sede = sedes.find((s) => s.id === l.sucursalId)!;
      if (!d || !d.sucursales.some((s) => s.sucursalId === l.sucursalId))
        throw new BadRequestException({ mensaje: `Algún residuo o servicio no está autorizado y activo para la sede «${sede.nombre}».` });
    }
    const esp = [...new Set(lineas.flatMap((l) => l.especificacionIds))];
    if (esp.length && (await this.db.especificacionAdicional.count({ where: { id: { in: esp }, empresaId: a.empresaId, activo: true } })) !== esp.length)
      throw new BadRequestException({ mensaje: 'Alguna especificación adicional no es válida.' });
    if (b.operacion === 'DESCARGA') {
      const destino = await this.db.proveedor.findFirst({ where: { id: b.destinoId, empresaId: a.empresaId, esDestino: true, esPropio: true, activo: true }, select: { id: true } });
      if (!destino) throw new BadRequestException({ mensaje: 'Elija una planta de Terra Viva para la entrega.' });
      const t = b.transporte!;
      const ids = [...new Set([t.conductorArlId, t.conductorEpsId, t.auxiliarArlId, t.auxiliarEpsId].filter((x): x is string => !!x))];
      if ((await this.db.entidadSeguridadSocial.count({ where: { id: { in: ids } } })) !== ids.length) throw new BadRequestException({ mensaje: 'Revise la ARL y la EPS.' });
    }
    const precio = (id: string) => decls.find((d) => d.id === id)?.tarifas[0]?.precioUnitario ?? null;
    return { fecha, lineas, precio, sedes };
  }

  /** Vehículo de un tercero: se inserta sin leerlo de vuelta (la base aún no lo ve como del cliente) y se enlaza. */
  private async registrarTransporte(tx: Tx, a: Actor, t: z.infer<typeof TransportePortal>) {
    const id = randomUUID();
    await tx.transporteTercero.createMany({ data: [{
      id, empresaId: a.empresaId, empresaTransportadora: t.empresaTransportadora, tipoVehiculo: t.tipoVehiculo ?? null, placa: t.placa,
      conductorNombre: t.conductorNombre, conductorDocumento: t.conductorDocumento, conductorArlId: t.conductorArlId, conductorEpsId: t.conductorEpsId,
      auxiliarNombre: t.auxiliarNombre ?? null, auxiliarDocumento: t.auxiliarDocumento ?? null, auxiliarArlId: t.auxiliarArlId ?? null, auxiliarEpsId: t.auxiliarEpsId ?? null,
    }] });
    return id;
  }

  /** Crea las líneas del pedido (con sus especificaciones adicionales). La base vuelve a exigir que estén autorizadas. */
  private async crearLineas(tx: Tx, solicitudId: string, v: Awaited<ReturnType<PortalService['validarPedido']>>) {
    for (const i of v.lineas) await tx.solicitudItem.create({ data: {
      solicitudId, declaracionId: i.declaracionId, sucursalId: i.sucursalId!, cantidadEstimada: i.cantidadEstimada, jornada: i.jornada ?? null, precioUnitario: v.precio(i.declaracionId),
      ...(i.especificacionIds.length ? { especificaciones: { create: [...new Set(i.especificacionIds)].map((especificacionId) => ({ especificacionId })) } } : {}),
    }, select: { id: true } });
  }

  /**
   * Pedido de servicio desde el portal: recolección en sus sedes (CARGA) o entrega en planta con su propio vehículo
   * (DESCARGA). Puede llevar residuos de varias sedes. Queda PENDIENTE de aprobación («Por confirmar» en la oficina) con
   * la tarifa vigente a esa fecha, como un pedido de la oficina.
   */
  async pedirServicio(a: Actor, b: z.infer<typeof PedirServicio>) {
    await this.exigir(a, b.operacion === 'DESCARGA' ? 'portal.entregas.pedir' : 'portal.solicitudes.pedir');
    const adjunto = b.adjunto ? this.refs.leer(b.adjunto, a.clienteId!) : null;
    const r = await this.conCliente(a, async (tx) => {
      await this.exigirActivo(tx, a);
      const v = await this.validarPedido(tx, a, b);
      const transporteId = b.operacion === 'DESCARGA' ? await this.registrarTransporte(tx, a, b.transporte!) : null;
      const s = await tx.solicitud.create({ data: {
        empresaId: a.empresaId, clase: 'FORMAL', operacion: b.operacion, clienteId: a.clienteId!, fechaSolicitada: v.fecha, aprobacion: 'PENDIENTE', creadoPorId: a.id,
        ordenCompra: b.ordenCompra ?? null, observaciones: b.observaciones ?? null, adjuntoUrl: adjunto,
        destinoId: b.operacion === 'DESCARGA' ? b.destinoId! : null, transporteId, telefonoContacto: b.telefonoContacto ?? null,
        totalEstimado: v.lineas.reduce((acc, i) => acc + i.cantidadEstimada * Number(v.precio(i.declaracionId) ?? 0), 0),
      }, select: { id: true, numero: true } });
      await this.crearLineas(tx, s.id, v);
      await this.audit.registrar(a, 'solicitud', s.id, 'CREAR_PORTAL', undefined, { numero: s.numero, operacion: b.operacion, sedes: v.sedes.map((x) => x.nombre), lineas: v.lineas.length }, tx);
      return { id: s.id, numero: s.numero };
    });
    // Aviso push a quienes aprueban: un pedido nuevo del portal espera su confirmación
    void this.db.cliente.findUnique({ where: { id: a.clienteId! }, select: { razonSocial: true } }).then((c) => this.notificaciones.aPermisos(a.empresaId, ['solicitudes.aprobar', 'solicitudes.crear'], {
      titulo: b.operacion === 'DESCARGA' ? 'Entrega en planta pedida desde el portal' : 'Pedido nuevo desde el portal',
      cuerpo: `N.° ${r.numero} · ${c?.razonSocial ?? 'Cliente'} · para el ${b.fechaSolicitada}`, ruta: 'por-confirmar', etiqueta: `solicitud-${r.numero}`,
    })).catch(() => undefined);
    return r;
  }

  /** Pedido del cliente que el usuario puede ver: de sus sedes si está limitado. */
  private async solicitudVisible(tx: Tx, a: Actor, id: string) {
    const mias = await this.sedes(tx, a);
    const s = await tx.solicitud.findFirst({ where: { id, clienteId: a.clienteId }, include: {
      items: { include: { especificaciones: { select: { especificacionId: true } } } },
      transporte: true,
    } });
    if (!s || (mias.length && !s.items.every((i) => mias.includes(i.sucursalId)))) throw new NotFoundException({ mensaje: 'Solicitud no encontrada.' });
    return s;
  }

  /** Datos de un pedido para editarlo (mientras nadie lo confirma) o para pedirlo de nuevo. */
  async formularioSolicitud(a: Actor, id: string) {
    await this.exigir(a, 'portal.solicitudes.ver');
    return this.conCliente(a, async (tx) => {
      const s = await this.solicitudVisible(tx, a, id);
      const t = s.transporte;
      return {
        id: s.id, numero: s.numero, operacion: s.operacion, fechaSolicitada: s.fechaSolicitada.toISOString().slice(0, 10), ordenCompra: s.ordenCompra, observaciones: s.observaciones,
        editable: s.clase === 'FORMAL' && s.aprobacion === 'PENDIENTE' && s.estado === 'PENDIENTE', destinoId: s.destinoId, telefonoContacto: s.telefonoContacto, tieneAdjunto: !!s.adjuntoUrl,
        transporte: t ? { empresaTransportadora: t.empresaTransportadora, tipoVehiculo: t.tipoVehiculo, placa: t.placa, conductorNombre: t.conductorNombre, conductorDocumento: t.conductorDocumento,
          conductorArlId: t.conductorArlId, conductorEpsId: t.conductorEpsId, auxiliarNombre: t.auxiliarNombre, auxiliarDocumento: t.auxiliarDocumento, auxiliarArlId: t.auxiliarArlId, auxiliarEpsId: t.auxiliarEpsId } : null,
        items: s.items.filter((i) => i.estado !== 'DESCARTADO').map((i) => ({ declaracionId: i.declaracionId, sucursalId: i.sucursalId, cantidadEstimada: Number(i.cantidadEstimada),
          jornada: i.jornada, especificacionIds: i.especificaciones.map((e) => e.especificacionId) })),
      };
    });
  }

  /**
   * Edita un pedido que Terra Viva aún no ha confirmado: fecha, líneas, orden de compra, observaciones, adjunto y (en una
   * entrega en planta) el vehículo. No cambia el tipo (recolección o entrega).
   */
  async editarSolicitud(a: Actor, id: string, b: z.infer<typeof PedirServicio>) {
    await this.exigir(a, b.operacion === 'DESCARGA' ? 'portal.entregas.pedir' : 'portal.solicitudes.pedir');
    const adjunto = b.adjunto === undefined ? undefined : b.adjunto === null ? null : this.refs.leer(b.adjunto, a.clienteId!);
    return this.conCliente(a, async (tx) => {
      await this.exigirActivo(tx, a);
      const s = await this.solicitudVisible(tx, a, id);
      if (s.clase !== 'FORMAL' || s.aprobacion !== 'PENDIENTE' || s.estado !== 'PENDIENTE')
        throw new BadRequestException({ mensaje: 'Terra Viva ya confirmó, programó o cerró esta solicitud: para cambiarla, comuníquese con su asesor.' });
      if (b.operacion !== s.operacion) throw new BadRequestException({ mensaje: 'No se cambia el tipo de la solicitud (recolección o entrega en planta): cancélela y pida otra.' });
      const v = await this.validarPedido(tx, a, b);
      // Vehículo: si cambió, se registra uno nuevo (el anterior queda como constancia)
      const t = b.transporte, ant = s.transporte as Record<string, unknown> | null;
      const mismoTransporte = !!t && !!ant && (Object.keys(t) as (keyof typeof t)[]).every((k) => (t[k] ?? null) === (ant[k] ?? null));
      const transporteId = s.operacion === 'DESCARGA' ? (mismoTransporte ? s.transporteId : await this.registrarTransporte(tx, a, t!)) : null;
      // Líneas: primero las nuevas y luego se quitan las anteriores (la solicitud nunca queda sin líneas)
      const anteriores = s.items.map((i) => i.id);
      await this.crearLineas(tx, id, v);
      if (anteriores.length) await tx.solicitudItem.deleteMany({ where: { id: { in: anteriores }, solicitudId: id } });
      await tx.solicitud.update({ where: { id }, data: {
        fechaSolicitada: v.fecha, ordenCompra: b.ordenCompra ?? null, observaciones: b.observaciones ?? null, ...(adjunto !== undefined ? { adjuntoUrl: adjunto } : {}),
        destinoId: s.operacion === 'DESCARGA' ? b.destinoId! : null, transporteId, telefonoContacto: b.telefonoContacto ?? null,
        totalEstimado: v.lineas.reduce((acc, i) => acc + i.cantidadEstimada * Number(v.precio(i.declaracionId) ?? 0), 0),
      } });
      await this.audit.registrar(a, 'solicitud', id, 'EDITAR_PORTAL',
        { fecha: s.fechaSolicitada.toISOString().slice(0, 10), lineas: anteriores.length, ordenCompra: s.ordenCompra },
        { fecha: b.fechaSolicitada, lineas: v.lineas.length, ordenCompra: b.ordenCompra ?? null, ...(transporteId !== s.transporteId ? { vehiculo: 'nuevo' } : {}) }, tx);
      return { id, numero: s.numero };
    });
  }

  /** Enlace (5 minutos) al PDF que el cliente adjuntó a su pedido. */
  async adjuntoSolicitud(a: Actor, id: string) {
    await this.exigir(a, 'portal.solicitudes.ver');
    const s = await this.conCliente(a, (tx) => this.solicitudVisible(tx, a, id));
    if (!s.adjuntoUrl || !esClaveAlmacen(s.adjuntoUrl)) throw new NotFoundException({ mensaje: 'La solicitud no tiene adjunto.' });
    const ext = s.adjuntoUrl.slice(s.adjuntoUrl.lastIndexOf('.') + 1);
    return this.archivos.enlace(s.adjuntoUrl, a.empresaId, { nombre: `solicitud-${s.numero}-adjunto.${ext}` });
  }

  /** El cliente cancela un pedido que Terra Viva aún no ha confirmado ni programado. Sus líneas quedan descartadas (regla de la base). */
  async cancelarSolicitud(a: Actor, id: string, motivo: string) {
    await this.exigir(a, 'portal.solicitudes.pedir', 'portal.entregas.pedir');
    return this.conCliente(a, async (tx) => {
      const sedes = await this.sedes(tx, a);
      const s = await tx.solicitud.findFirst({ where: { id, clienteId: a.clienteId }, select: { id: true, numero: true, estado: true, aprobacion: true, observaciones: true, items: { select: { sucursalId: true } } } });
      // Un usuario limitado a unas sedes solo cancela pedidos de sus sedes
      if (!s || (sedes.length && !s.items.every((i) => sedes.includes(i.sucursalId)))) throw new NotFoundException({ mensaje: 'Solicitud no encontrada.' });
      if (s.estado === 'CANCELADA') throw new BadRequestException({ mensaje: 'La solicitud ya está cancelada.' });
      if (s.estado !== 'PENDIENTE' || s.aprobacion !== 'PENDIENTE')
        throw new BadRequestException({ mensaje: 'Terra Viva ya confirmó o programó esta solicitud: para cancelarla, comuníquese con su asesor.' });
      const causal = await tx.catalogoItem.upsert({
        where: { empresaId_tipo_codigo: { empresaId: a.empresaId, tipo: 'CAUSAL', codigo: CAUSAL_PORTAL.codigo } }, update: {},
        create: { empresaId: a.empresaId, tipo: 'CAUSAL', ...CAUSAL_PORTAL }, select: { id: true },
      });
      await tx.solicitud.update({ where: { id }, data: {
        estado: 'CANCELADA', causalCancelacionId: causal.id, observaciones: [s.observaciones, `Cancelada por el cliente desde el portal: ${motivo}`].filter(Boolean).join('\n'),
      } });
      await this.audit.registrar(a, 'solicitud', id, 'CANCELAR_PORTAL', { estado: s.estado }, { estado: 'CANCELADA', motivo }, tx);
      return { id, numero: s.numero, estado: 'CANCELADA' as const };
    });
  }

  // ---------------- Descargas con enlace firmado ----------------
  /** Verifica que el documento sea del cliente (y de sus sedes) y entrega un enlace firmado de 5 minutos. */
  async enlace(a: Actor, tipo: Documento, id: string) {
    await this.exigir(a, tipo === 'acta' ? 'portal.certificados.ver' : 'portal.manifiestos.ver');
    await this.conCliente(a, async (tx) => {
      const sedes = await this.sedes(tx, a);
      const ok = tipo === 'acta'
        ? await tx.acta.findFirst({ where: { id, clienteId: a.clienteId, estado: 'EMITIDA', ...this.actaSede(sedes) }, select: { id: true } })
        : await tx.manifiesto.findFirst({ where: { id, clienteId: a.clienteId, estado: 'REALIZADO', ...(sedes.length ? { items: { some: { sucursalId: { in: sedes } } } } : {}) }, select: { id: true } });
      if (!ok) throw new NotFoundException({ mensaje: tipo === 'acta' ? 'Certificado no encontrado.' : 'Manifiesto no encontrado.' });
      if (tipo === 'acta') await this.exigirPago(tx, a, id);
    });
    const token = await this.jwt.signAsync({ t: tipo, id, sub: a.id, emp: a.empresaId, cli: a.clienteId }, { secret: this.claveDescargas, expiresIn: '5m', issuer: 'terraviva-descargas' });
    return { url: `/descargas/${token}`, vence: new Date(Date.now() + 5 * 60_000).toISOString() };
  }

  /**
   * Certificación comercial con Terra Viva (gerencia, 19-11-2026): cualquier usuario del portal la descarga. Si ya se
   * expidió hoy, es la misma. Un cliente inactivo no la recibe (aviso amable).
   */
  async certificadoComercial(a: Actor) {
    await this.exigir(a, 'portal.certificados.ver');
    await this.conCliente(a, (tx) => this.exigirActivo(tx, a));
    const r = await this.comercial.expedir(a.empresaId, a.clienteId!, { id: a.id }, 'PORTAL');
    const token = await this.jwt.signAsync({ t: 'comercial', id: r.id, sub: a.id, emp: a.empresaId, cli: a.clienteId }, { secret: this.claveDescargas, expiresIn: '5m', issuer: 'terraviva-descargas' });
    return { numero: r.numero, url: `/descargas/${token}`, vence: new Date(Date.now() + 5 * 60_000).toISOString() };
  }

  /** Sirve el PDF de un enlace firmado vigente. Vuelve a verificar el cliente, con la segunda barrera. */
  async descargar(token: string, res: Response) {
    let p: { t: Documento; id: string; sub: string; emp: string; cli: string };
    try { p = await this.jwt.verifyAsync(token, { secret: this.claveDescargas, issuer: 'terraviva-descargas' }); }
    catch { throw new ForbiddenException({ mensaje: 'El enlace de descarga venció o no es válido. Pídalo de nuevo desde el portal.' }); }
    const a: Actor = { id: p.sub, empresaId: p.emp, clienteId: p.cli, rol: 'Portal de clientes', permisos: [], nombre: 'portal' };
    if (p.t === 'comercial') {
      const cc = await this.conCliente(a, (tx) => tx.certificadoComercial.findFirst({ where: { id: p.id, clienteId: p.cli }, select: { numero: true, pdfUrl: true } }));
      if (!cc) throw new NotFoundException({ mensaje: 'Documento no encontrado.' });
      await this.audit.registrar({ id: p.sub }, 'certificado_comercial', p.id, 'DESCARGA_PORTAL');
      return this.archivos.servir(res, cc.pdfUrl, p.emp, { nombre: `certificado-comercial-${cc.numero}.pdf` });
    }
    const doc = await this.conCliente(a, async (tx) => {
      if (p.t !== 'acta') return tx.manifiesto.findFirst({ where: { id: p.id, clienteId: p.cli, estado: 'REALIZADO' }, select: { numero: true } });
      const acta = await tx.acta.findFirst({ where: { id: p.id, clienteId: p.cli, estado: 'EMITIDA' }, select: { numero: true, pdfUrl: true, archivoUrl: true } });
      if (acta) await this.exigirPago(tx, a, p.id);
      return acta;
    });
    if (!doc) throw new NotFoundException({ mensaje: 'Documento no encontrado.' });
    if (p.t === 'acta') {
      // El PDF guardado se entrega con un enlace firmado del almacenamiento (en S3 no pasa por el API)
      const d = doc as { numero: string; pdfUrl: string | null; archivoUrl: string | null };
      const clave = d.pdfUrl ?? d.archivoUrl;
      if (!clave) throw new NotFoundException({ mensaje: 'El certificado aún no tiene PDF.' });
      await this.audit.registrar({ id: p.sub }, 'acta', p.id, 'DESCARGA_PORTAL');
      return this.archivos.servir(res, clave, p.emp, { nombre: `certificado-${d.numero}.pdf` });
    }
    // El manifiesto se arma en el momento (no está guardado): sale del API
    const r = await this.manifiestos.pdfBuffer(a, p.id);
    const buf = r.buf, nombre = `manifiesto-${r.numero}.pdf`;
    await this.audit.registrar({ id: p.sub }, 'manifiesto', p.id, 'DESCARGA_PORTAL');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nombre}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buf);
  }

  // ---------------- Usuarios del portal ----------------
  /** Usuarios de un cliente. Desde el portal (administrador del cliente) o desde la oficina (Clientes › ficha). */
  async usuarios(a: Actor, clienteId: string) {
    if (a.clienteId) await this.exigir(a, 'portal.usuarios.gestionar');
    const consulta = async (db: Tx | PrismaService) => {
      const filas = await db.usuario.findMany({ where: { clienteId, empresaId: a.empresaId }, orderBy: [{ activo: 'desc' }, { nombre: 'asc' }], select: {
        id: true, nombre: true, email: true, documento: true, telefono: true, activo: true, perfilPortal: true, ultimoLogin: true, datosAceptadosEn: true, totpActivoDesde: true,
        rol: { select: { id: true, nombre: true } }, sedesPortal: { select: { sucursal: { select: { id: true, codigo: true, nombre: true } } } },
      } });
      const mias = a.clienteId ? await this.sedes(db, a) : [];
      return filas.filter((u) => u.id === a.id || this.dentroDeSusSedes(mias, u.sedesPortal.map((s) => s.sucursal.id)));
    };
    return a.clienteId ? this.conCliente(a, consulta) : consulta(this.db);
  }

  /** Roles del portal que se pueden dar a un usuario (activos, de acceso CLIENTE), con sus funciones. */
  async rolesPortal(a: Actor) {
    if (a.clienteId) await this.exigir(a, 'portal.usuarios.gestionar');
    const roles = await this.db.rol.findMany({ where: { empresaId: a.empresaId, acceso: 'CLIENTE', activo: true }, orderBy: [{ predeterminado: 'desc' }, { nombre: 'asc' }],
      select: { id: true, nombre: true, descripcion: true, clave: true, permisos: { select: { permiso: { select: { codigo: true } } } } } });
    return roles.map(({ permisos, ...r }) => ({ ...r, permisos: permisos.map((p) => p.permiso.codigo) }));
  }

  /**
   * Rol del portal de un usuario: el elegido (activo y de acceso CLIENTE) o, con «perfil» (como antes), el predeterminado
   * equivalente. El perfil que se guarda sale del rol: ADMIN si puede gestionar los usuarios de su empresa.
   */
  private async rolPortal(db: Tx | PrismaService, empresaId: string, b: { rolId?: string; perfil?: 'ADMIN' | 'CONSULTA' }, porDefecto: 'ADMIN' | 'CONSULTA' | null) {
    const perfil = b.perfil ?? porDefecto;
    if (!b.rolId && !perfil) return null;
    const r = await db.rol.findFirst({ where: { empresaId, acceso: 'CLIENTE', ...(b.rolId ? { id: b.rolId } : { clave: perfil === 'ADMIN' ? 'CLIENTE_ADMIN' : 'CLIENTE_CONSULTA' }) },
      select: { id: true, nombre: true, activo: true, permisos: { select: { permiso: { select: { codigo: true } } } } } });
    if (!r || !r.activo) throw new BadRequestException({ mensaje: 'Elija un rol del portal que esté activo.' });
    return { id: r.id, nombre: r.nombre, perfil: r.permisos.some((p) => p.permiso.codigo === 'portal.usuarios.gestionar') ? 'ADMIN' as const : 'CONSULTA' as const };
  }

  private async validarSedes(db: Tx | PrismaService, clienteId: string, ids: string[]) {
    if (!ids.length) return;
    const n = await db.sucursal.count({ where: { id: { in: ids }, clienteId } });
    if (n !== new Set(ids).size) throw new BadRequestException({ mensaje: 'Alguna sede no es de este cliente.' });
  }

  async crearUsuario(a: Actor, clienteId: string, b: z.infer<typeof CrearUsuario>) {
    if (a.clienteId) await this.exigir(a, 'portal.usuarios.gestionar');
    const cliente = await this.db.cliente.findFirst({ where: { id: clienteId, empresaId: a.empresaId } });
    if (!cliente) throw new NotFoundException({ mensaje: 'Cliente no encontrado.' });
    if (await this.db.usuario.findUnique({ where: { email: b.email }, select: { id: true } })) throw new BadRequestException({ mensaje: `El correo ${b.email} ya tiene un usuario en TERRY-GO.` });
    const rol = (await this.rolPortal(this.db, a.empresaId, b, 'CONSULTA'))!;
    const crear = async (db: Tx) => {
      await this.validarSedes(db, clienteId, b.sucursalIds);
      if (a.clienteId && !this.dentroDeSusSedes(await this.sedes(db, a), b.sucursalIds))
        throw new ForbiddenException({ mensaje: 'Usted ve solo algunas sedes: el usuario nuevo debe quedar limitado a sedes suyas.' });
      const u = await db.usuario.create({ data: {
        empresaId: a.empresaId, rolId: rol.id, clienteId, perfilPortal: rol.perfil, nombre: b.nombre, documento: b.documento, telefono: b.telefono ?? null, email: b.email,
        passwordHash: await hashClave(randomBytes(32).toString('base64url')),
        sedesPortal: b.sucursalIds.length ? { create: [...new Set(b.sucursalIds)].map((sucursalId) => ({ sucursalId })) } : undefined,
      }, select: { id: true, nombre: true, email: true, perfilPortal: true, rol: { select: { id: true, nombre: true } } } });
      await this.audit.registrar(a, 'usuario', u.id, 'CREAR_PORTAL', undefined, { clienteId, rol: rol.nombre, sedes: b.sucursalIds.length }, db);
      return u;
    };
    const u = a.clienteId ? await this.conCliente(a, crear) : await this.db.$transaction(crear);
    const invitacion = await this.auth.invitar(u.id);
    return { ...u, invitacion };
  }

  /**
   * Edita un usuario del portal: datos, rol, sedes o activo. Nada se borra: inactivo no ingresa y sus sesiones se
   * cierran. Nadie se cambia el rol ni se inactiva a sí mismo, y el cliente conserva al menos una persona activa que
   * gestiona sus usuarios.
   */
  async editarUsuario(a: Actor, clienteId: string, id: string, b: z.infer<typeof EditarUsuario>) {
    if (a.clienteId) await this.exigir(a, 'portal.usuarios.gestionar');
    const editar = async (db: Tx) => {
      const u = await db.usuario.findFirst({ where: { id, clienteId, empresaId: a.empresaId }, include: { rol: { select: { nombre: true, permisos: { select: { permiso: { select: { codigo: true } } } } } } } });
      if (!u) throw new NotFoundException({ mensaje: 'Usuario no encontrado.' });
      const nuevoRol = await this.rolPortal(db, a.empresaId, b, null);
      const cambiaRol = !!nuevoRol && nuevoRol.id !== u.rolId;
      const gestionaba = u.rol.permisos.some((p) => p.permiso.codigo === 'portal.usuarios.gestionar');
      const antes = (await db.usuarioSucursal.findMany({ where: { usuarioId: id }, select: { sucursalId: true } })).map((s) => s.sucursalId).sort();
      const nuevas = b.sucursalIds ? [...new Set(b.sucursalIds)].sort() : null;
      const cambianSedes = !!nuevas && nuevas.join() !== antes.join();
      if (a.clienteId) {
        const mias = await this.sedes(db, a);
        if (id !== a.id && !this.dentroDeSusSedes(mias, antes)) throw new NotFoundException({ mensaje: 'Usuario no encontrado.' });
        if (cambianSedes && !this.dentroDeSusSedes(mias, nuevas!)) throw new ForbiddenException({ mensaje: 'Usted ve solo algunas sedes: el usuario debe quedar limitado a sedes suyas.' });
      }
      if (id === a.id && (b.activo === false || cambiaRol)) throw new BadRequestException({ mensaje: 'Nadie se inactiva ni se cambia el rol a sí mismo.' });
      const dejaDeGestionar = u.activo && gestionaba && (b.activo === false || (cambiaRol && nuevoRol!.perfil !== 'ADMIN'));
      if (dejaDeGestionar && !(await db.usuario.count({ where: { clienteId, activo: true, id: { not: id }, rol: { permisos: { some: { permiso: { codigo: 'portal.usuarios.gestionar' } } } } } })))
        throw new BadRequestException({ mensaje: 'Es la única persona activa que gestiona los usuarios del portal de este cliente: primero dé ese rol a otra persona.' });
      // Las sedes se leen en cada consulta: el cambio rige de inmediato, sin cerrar la sesión
      if (cambianSedes) {
        await this.validarSedes(db, clienteId, nuevas!);
        await db.usuarioSucursal.deleteMany({ where: { usuarioId: id } });
        if (nuevas!.length) await db.usuarioSucursal.createMany({ data: nuevas!.map((sucursalId) => ({ usuarioId: id, sucursalId })) });
      }
      const r = await db.usuario.update({ where: { id }, data: { nombre: b.nombre, documento: b.documento, telefono: b.telefono, activo: b.activo,
        ...(cambiaRol ? { rolId: nuevoRol!.id, perfilPortal: nuevoRol!.perfil } : {}) },
        select: { id: true, nombre: true, email: true, activo: true, perfilPortal: true, rol: { select: { id: true, nombre: true } } } });
      // El perfil va en el token: si cambia el rol (o el usuario se inactiva), sus sesiones se cierran
      if ((b.activo === false && u.activo) || cambiaRol)
        await db.sesion.updateMany({ where: { usuarioId: id, revocadaEn: null }, data: { revocadaEn: new Date() } });
      const { sucursalIds: _s, rolId: _r, perfil: _p, ...datos } = b;
      await this.audit.registrar(a, 'usuario', id, b.activo === false && u.activo ? 'INACTIVAR_PORTAL' : 'EDITAR_PORTAL',
        { rol: u.rol.nombre, activo: u.activo, ...(cambianSedes ? { sedes: antes } : {}) },
        { ...datos, clienteId, ...(cambiaRol ? { rol: nuevoRol!.nombre } : {}), ...(cambianSedes ? { sedes: nuevas } : {}) }, db);
      return r;
    };
    return a.clienteId ? this.conCliente(a, editar) : this.db.$transaction(editar);
  }

  /** Usuario del portal de ese cliente que quien pide puede gestionar (el administrador del portal, solo dentro de sus sedes). */
  private async usuarioGestionable(a: Actor, clienteId: string, id: string) {
    const buscar = async (db: Tx | PrismaService) => {
      const u = await db.usuario.findFirst({ where: { id, clienteId, empresaId: a.empresaId }, select: { id: true, activo: true, sedesPortal: { select: { sucursalId: true } } } });
      if (u && a.clienteId && u.id !== a.id && !this.dentroDeSusSedes(await this.sedes(db, a), u.sedesPortal.map((s) => s.sucursalId))) return null;
      return u;
    };
    const u = a.clienteId ? await this.conCliente(a, buscar) : await buscar(this.db);
    if (!u) throw new NotFoundException({ mensaje: 'Usuario no encontrado.' });
    return u;
  }

  async reenviarInvitacion(a: Actor, clienteId: string, id: string) {
    if (a.clienteId) await this.exigir(a, 'portal.usuarios.gestionar');
    const u = await this.usuarioGestionable(a, clienteId, id);
    if (!u.activo) throw new BadRequestException({ mensaje: 'El usuario está inactivo: actívelo antes de enviarle la invitación.' });
    const invitacion = await this.auth.invitar(u.id);
    await this.audit.registrar(a, 'usuario', id, 'INVITACION_PORTAL', undefined, { porCorreo: invitacion.enviada });
    return invitacion;
  }

  /** Verificación en dos pasos de un usuario del portal que perdió el celular y sus códigos: la restablece su administrador o la oficina. */
  async restablecer2fa(a: Actor, clienteId: string, id: string) {
    if (a.clienteId) await this.exigir(a, 'portal.usuarios.gestionar');
    const u = await this.usuarioGestionable(a, clienteId, id);
    return this.auth.restablecer2fa(a, u.id);
  }
}

const archivo = FileInterceptor('archivo', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

/** Rutas del portal: solo usuarios de un cliente (el guard global responde 403 a cualquier otra ruta). */
@Controller('portal')
@SoloPortal()
class PortalController {
  constructor(private readonly s: PortalService) {}
  @Get('yo') yo(@ActorActual() a: Actor) { return this.s.yo(a); }
  @Get('resumen') resumen(@ActorActual() a: Actor) { return this.s.resumen(a); }
  @Get('declaraciones') declaraciones(@ActorActual() a: Actor, @Query(new Zod(FiltroDecl)) f: z.infer<typeof FiltroDecl>) { return this.s.declaraciones(a, f); }
  @Get('declaraciones/:id') declaracion(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.declaracion(a, id); }
  @Get('solicitudes') solicitudes(@ActorActual() a: Actor, @Query(new Zod(FiltroSol)) f: z.infer<typeof FiltroSol>) { return this.s.solicitudes(a, f); }
  @Get('manifiestos') manifiestos(@ActorActual() a: Actor, @Query(new Zod(FiltroFechas)) f: z.infer<typeof FiltroFechas>) { return this.s.listaManifiestos(a, f); }
  @Post('manifiestos/:id/enlace') enlaceManifiesto(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.enlace(a, 'manifiesto', id); }
  @Get('certificados') certificados(@ActorActual() a: Actor, @Query(new Zod(FiltroAnio)) f: z.infer<typeof FiltroAnio>) { return this.s.certificados(a, f); }
  @Post('certificados/:id/enlace') enlaceCertificado(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.enlace(a, 'acta', id); }
  @Post('certificado-comercial') certificadoComercial(@ActorActual() a: Actor) { return this.s.certificadoComercial(a); }
  @Get('informe') informe(@ActorActual() a: Actor, @Query(new Zod(FiltroInforme)) f: z.infer<typeof FiltroInforme>) { return this.s.informe(a, f.anio); }
  // Cargue de sus declaraciones (plantilla decl-residuos o decl-servicios del portal): revisar y confirmar
  @Post('declaraciones/cargue/:plantilla/vista-previa') @UseInterceptors(archivo)
  previaCargue(@ActorActual() a: Actor, @Param('plantilla') p: string, @Body('delimitador') d?: string, @UploadedFile() f?: Express.Multer.File) {
    return this.s.cargueDeclaraciones(a, p, f, d, false, false);
  }
  @Post('declaraciones/cargue/:plantilla/confirmar') @UseInterceptors(archivo)
  confirmarCargue(@ActorActual() a: Actor, @Param('plantilla') p: string, @Body('delimitador') d?: string, @Body('aceptaResponsabilidad') acepta?: string, @UploadedFile() f?: Express.Multer.File) {
    return this.s.cargueDeclaraciones(a, p, f, d, true, acepta === 'true');
  }
  @Get('solicitudes/opciones') opciones(@ActorActual() a: Actor) { return this.s.opcionesPedido(a); }
  @Post('solicitudes') pedir(@ActorActual() a: Actor, @Body(new Zod(PedirServicio)) b: z.infer<typeof PedirServicio>) { return this.s.pedirServicio(a, b); }
  @Get('solicitudes/:id/formulario') formularioSolicitud(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.formularioSolicitud(a, id); }
  @Put('solicitudes/:id') editarSolicitud(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(PedirServicio)) b: z.infer<typeof PedirServicio>) { return this.s.editarSolicitud(a, id, b); }
  @Post('solicitudes/:id/adjunto/enlace') @HttpCode(200) adjunto(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.adjuntoSolicitud(a, id); }
  @Post('solicitudes/:id/cancelar') cancelar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Cancelar)) b: z.infer<typeof Cancelar>) { return this.s.cancelarSolicitud(a, id, b.motivo); }
  @Get('usuarios') usuarios(@ActorActual() a: Actor) { return this.s.usuarios(a, a.clienteId!); }
  @Get('roles') roles(@ActorActual() a: Actor) { return this.s.rolesPortal(a); }
  @Post('usuarios') crearUsuario(@ActorActual() a: Actor, @Body(new Zod(CrearUsuario)) b: z.infer<typeof CrearUsuario>) { return this.s.crearUsuario(a, a.clienteId!, b); }
  @Patch('usuarios/:id') editarUsuario(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(EditarUsuario)) b: z.infer<typeof EditarUsuario>) { return this.s.editarUsuario(a, a.clienteId!, id, b); }
  @Post('usuarios/:id/invitacion') reenviar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.reenviarInvitacion(a, a.clienteId!, id); }
  @Post('usuarios/:id/2fa/restablecer') restablecer2fa(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.restablecer2fa(a, a.clienteId!, id); }
}

/**
 * La oficina de Terra Viva da acceso al portal a cada cliente (su primer administrador) desde la ficha del cliente.
 * Son datos personales (Ley 1581): los ve y gestiona solo quien administra clientes.
 */
@Controller('clientes/:clienteId/usuarios-portal')
class UsuariosPortalOficinaController {
  constructor(private readonly s: PortalService) {}
  @Permiso('clientes.editar') @Get() listar(@ActorActual() a: Actor, @Param('clienteId', ParseUUIDPipe) c: string) { return this.s.usuarios(a, c); }
  @Permiso('clientes.editar') @Get('roles') roles(@ActorActual() a: Actor) { return this.s.rolesPortal(a); }
  @Permiso('clientes.editar') @Post() crear(@ActorActual() a: Actor, @Param('clienteId', ParseUUIDPipe) c: string, @Body(new Zod(CrearUsuario)) b: z.infer<typeof CrearUsuario>) { return this.s.crearUsuario(a, c, b); }
  @Permiso('clientes.editar') @Patch(':id') editar(@ActorActual() a: Actor, @Param('clienteId', ParseUUIDPipe) c: string, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(EditarUsuario)) b: z.infer<typeof EditarUsuario>) { return this.s.editarUsuario(a, c, id, b); }
  @Permiso('clientes.editar') @Post(':id/invitacion') reenviar(@ActorActual() a: Actor, @Param('clienteId', ParseUUIDPipe) c: string, @Param('id', ParseUUIDPipe) id: string) { return this.s.reenviarInvitacion(a, c, id); }
  @Permiso('clientes.editar') @Post(':id/2fa/restablecer') restablecer2fa(@ActorActual() a: Actor, @Param('clienteId', ParseUUIDPipe) c: string, @Param('id', ParseUUIDPipe) id: string) { return this.s.restablecer2fa(a, c, id); }
}

/** Descarga con enlace firmado: pública, porque la firma (5 minutos) ya prueba que se verificó el permiso. */
@Controller('descargas')
class DescargasController {
  constructor(private readonly s: PortalService) {}
  @Publico() @Get(':token') descargar(@Param('token') token: string, @Res() res: Response) { return this.s.descargar(token, res); }
}

@Module({ imports: [AuthModule, ManifiestosModule, ImportacionModule, CertificadoComercialModule, JwtModule.register({})], controllers: [PortalController, UsuariosPortalOficinaController, DescargasController], providers: [PortalService], exports: [PortalService] })
export class PortalModule {}
