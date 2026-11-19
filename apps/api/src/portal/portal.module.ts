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
  BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Res,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Jornada, Prisma, PerfilPortal } from '@prisma/client';
import type { Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { Auditoria } from '../common/servicios';
import { Archivos } from '../common/archivos';
import { ActorActual, Permiso, Publico, SoloPortal, Zod, fechaColombia, paginar, type Actor } from '../common/http';
import type { Config } from '../config';
import { AuthModule } from '../auth/auth.module';
import { AuthService, hashClave } from '../auth/auth.service';
import { ManifiestosModule, ManifiestosService } from '../manifiestos/manifiestos.module';
import { ImportacionModule, ImportacionService } from '../importacion/importacion.module';

type Tx = Prisma.TransactionClient;
const Pagina = z.object({ pagina: z.coerce.number().optional(), porPagina: z.coerce.number().optional() });
const FiltroDecl = Pagina.extend({ estado: z.enum(['AUTORIZADA', 'PENDIENTE', 'BORRADOR', 'RECHAZADA']).optional(), tipo: z.enum(['RESIDUO', 'SERVICIO']).optional(), q: z.string().max(80).optional() });
const FiltroFechas = Pagina.extend({ desde: z.coerce.date().optional(), hasta: z.coerce.date().optional() });
const FiltroAnio = Pagina.extend({ anio: z.coerce.number().int().min(2000).max(2100).optional() });
const FiltroInforme = z.object({ anio: z.coerce.number().int().min(2000).max(2100) });
const textoOpc = (max: number) => z.string().trim().max(max).transform((x) => x || null).nullish();
const DatosUsuario = z.object({
  nombre: z.string().trim().min(3).max(150), documento: z.string().trim().regex(/^[0-9A-Za-z.-]{4,20}$/, 'Documento de 4 a 20 caracteres'), telefono: textoOpc(20),
  perfil: z.nativeEnum(PerfilPortal).default('CONSULTA'), sucursalIds: z.array(z.string().uuid()).max(500).default([]),
});
const CrearUsuario = DatosUsuario.extend({ email: z.string().trim().toLowerCase().email('Correo inválido').max(150) });
const EditarUsuario = DatosUsuario.partial().extend({ activo: z.boolean().optional() });
const PedirServicio = z.object({
  sucursalId: z.string().uuid('Elija la sede.'),
  fechaSolicitada: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha en formato AAAA-MM-DD.'),
  ordenCompra: textoOpc(40), observaciones: textoOpc(1000),
  items: z.array(z.object({
    declaracionId: z.string().uuid(), cantidadEstimada: z.number().positive('La cantidad debe ser mayor que cero.').max(1e9), jornada: z.nativeEnum(Jornada).optional(),
  })).min(1, 'Elija al menos un residuo o servicio.').max(50, 'Máximo 50 líneas por solicitud.'),
});
const Cancelar = z.object({ motivo: z.string().trim().min(5, 'Cuéntenos el motivo (mínimo 5 caracteres).').max(300) });
const ROL_PORTAL = 'Cliente (portal)';
/** Causal con la que queda una solicitud que cancela el propio cliente (se crea la primera vez que se usa). */
const CAUSAL_PORTAL = { codigo: 'CAU-PORTAL', nombre: 'Cancelada por el cliente desde el portal' };
type Documento = 'acta' | 'manifiesto';

@Injectable()
export class PortalService {
  private readonly claveDescargas: string;
  constructor(private readonly db: PrismaService, private readonly audit: Auditoria, private readonly auth: AuthService, private readonly archivos: Archivos,
    private readonly manifiestos: ManifiestosService, private readonly importacion: ImportacionService, private readonly jwt: JwtService, cfg: ConfigService<Config, true>) {
    // Clave propia de los enlaces de descarga (distinta de la de las sesiones)
    this.claveDescargas = createHash('sha256').update(`${cfg.get('JWT_SECRET', { infer: true })}:descargas-portal`).digest('base64url');
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

  /** Lo que escribe en el portal (cargar, pedir, cancelar, gestionar usuarios) lo hace solo el perfil Administrador. */
  private soloAdmin(a: Actor) {
    if (a.perfilPortal !== 'ADMIN') throw new ForbiddenException({ mensaje: 'Su perfil en el portal es de consulta: pídale a su administrador que lo haga o que le cambie el perfil.' });
  }

  /** Sedes que puede ver el usuario (vacío = todas las de su cliente). */
  private async sedes(tx: Tx | PrismaService, a: Actor) { return (await tx.usuarioSucursal.findMany({ where: { usuarioId: a.id }, select: { sucursalId: true } })).map((s) => s.sucursalId); }
  /**
   * Un administrador del portal limitado a unas sedes solo ve y gestiona usuarios limitados a esas mismas sedes: no puede
   * dar (ni darse, con otro correo) más acceso del que tiene. `mias` vacío = ve todas las sedes de su empresa.
   */
  private dentroDeSusSedes(mias: string[], suyas: string[]) { return !mias.length || (suyas.length > 0 && suyas.every((s) => mias.includes(s))); }

  async yo(a: Actor) {
    return this.conCliente(a, async (tx) => {
      const [cliente, sedes, permitidas, u] = await Promise.all([
        tx.cliente.findUniqueOrThrow({ where: { id: a.clienteId }, select: { id: true, razonSocial: true, nit: true, dv: true, tipo: true, activo: true } }),
        tx.sucursal.findMany({ where: { clienteId: a.clienteId, activa: true }, orderBy: [{ esPrincipal: 'desc' }, { nombre: 'asc' }], select: { id: true, codigo: true, nombre: true, municipio: { select: { nombre: true } } } }),
        this.sedes(tx, a),
        tx.usuario.findUniqueOrThrow({ where: { id: a.id }, select: { nombre: true, email: true, perfilPortal: true } }),
      ]);
      return { usuario: u, cliente, perfil: u.perfilPortal, sedes: permitidas.length ? sedes.filter((s) => permitidas.includes(s.id)) : sedes, restringido: permitidas.length > 0 };
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
    const { take, skip, pagina, porPagina } = paginar(f);
    return this.conCliente(a, async (tx) => {
      const sedes = await this.sedes(tx, a);
      const where: Prisma.DeclaracionWhereInput = {
        clienteId: a.clienteId, estado: f.estado ?? { not: 'ANULADA' }, tipo: f.tipo,
        ...(f.q ? { OR: [{ nombre: { contains: f.q, mode: 'insensitive' } }, { codigoInterno: { contains: f.q, mode: 'insensitive' } }] } : {}),
        ...(sedes.length ? { sucursales: { some: { sucursalId: { in: sedes } } } } : {}),
      };
      const hoy = fechaColombia();
      const [total, filas] = await Promise.all([
        tx.declaracion.count({ where }),
        tx.declaracion.findMany({ where, take, skip, orderBy: { numero: 'desc' }, select: {
          id: true, numero: true, tipo: true, nombre: true, codigoInterno: true, estado: true, activa: true, esPeligroso: true, frecuenciaDias: true, cantidadFrecuencia: true,
          lineaServicio: { select: { nombre: true } }, sucursales: { where: { activa: true }, select: { sucursal: { select: { id: true, codigo: true, nombre: true } } } },
          disposiciones: { select: { principal: true, disposicion: { select: { nombre: true } } } },
          tarifas: { where: { vigenteDesde: { lte: hoy }, OR: [{ vigenteHasta: null }, { vigenteHasta: { gte: hoy } }] }, take: 1, orderBy: { vigenteDesde: 'desc' }, select: { precioUnitario: true, metrica: { select: { abreviacion: true } } } },
        } }),
      ]);
      return { total, pagina, porPagina, filas: filas.map(({ tarifas, ...d }) => ({ ...d, precio: tarifas[0] ?? null })) };
    });
  }

  async declaracion(a: Actor, id: string) {
    return this.conCliente(a, async (tx) => {
      const sedes = await this.sedes(tx, a);
      const d = await tx.declaracion.findFirst({ where: { id, clienteId: a.clienteId, estado: { not: 'ANULADA' }, ...(sedes.length ? { sucursales: { some: { sucursalId: { in: sedes } } } } : {}) }, select: {
        id: true, numero: true, tipo: true, nombre: true, codigoInterno: true, estado: true, activa: true, esPeligroso: true, composicion: true, descripcionProceso: true,
        descripcionServicio: true, estadoFisico: true, frecuenciaDias: true, cantidadFrecuencia: true, fichaSeguridadUrl: true, observaciones: true, aprobadaEn: true,
        responsabilidadAceptada: true, aceptadaEn: true, categoria: { select: { nombre: true } }, tipoResiduo: { select: { nombre: true } }, lineaServicio: { select: { nombre: true } },
        codigoY: { select: { codigo: true, descripcion: true } }, codigoA: { select: { codigo: true, descripcion: true } }, tipoEmbalaje: { select: { nombre: true } },
        sucursales: { select: { activa: true, sucursal: { select: { codigo: true, nombre: true } } } }, disposiciones: { select: { principal: true, disposicion: { select: { nombre: true } } } },
        tarifas: { orderBy: { vigenteDesde: 'desc' }, select: { precioUnitario: true, vigenteDesde: true, vigenteHasta: true, metrica: { select: { abreviacion: true } } } },
      } });
      if (!d) throw new NotFoundException({ mensaje: 'Declaración no encontrada.' });
      // La clave interna del archivo no sale del servidor: el cliente solo sabe si la ficha está en el expediente
      const { fichaSeguridadUrl, ...resto } = d;
      return { ...resto, tieneFichaSeguridad: !!fichaSeguridadUrl };
    });
  }

  async solicitudes(a: Actor, f: z.infer<typeof Pagina>) {
    const { take, skip, pagina, porPagina } = paginar(f);
    return this.conCliente(a, async (tx) => {
      const sedes = await this.sedes(tx, a);
      const enSede = sedes.length ? { sucursalId: { in: sedes } } : {};
      const where: Prisma.SolicitudWhereInput = { clienteId: a.clienteId, ...(sedes.length ? { items: { some: enSede } } : {}) };
      const [total, filas] = await Promise.all([
        tx.solicitud.count({ where }),
        tx.solicitud.findMany({ where, take, skip, orderBy: [{ fechaSolicitada: 'desc' }, { numero: 'desc' }], select: {
          id: true, numero: true, clase: true, operacion: true, fechaSolicitada: true, aprobacion: true, estado: true, ordenCompra: true, observaciones: true,
          items: { where: enSede, select: { id: true, estado: true, cantidadEstimada: true, cantidadReal: true, declaracion: { select: { nombre: true, codigoInterno: true } }, sucursal: { select: { nombre: true } } } },
        } }),
      ]);
      return { total, pagina, porPagina, filas };
    });
  }

  async listaManifiestos(a: Actor, f: z.infer<typeof FiltroFechas>) {
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
      return { total, pagina, porPagina, filas };
    });
  }

  /**
   * Informe del año: lo gestionado por residuo y por mes. Vale lo conciliado en planta cuando la conciliación está
   * aprobada; mientras tanto, lo del manifiesto (y se cuenta como «por conciliar»). Se suma en la base: no trae líneas.
   */
  async informe(a: Actor, anio: number) {
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
    this.soloAdmin(a);
    const cliente = await this.conCliente(a, async (tx) => ({
      ...(await tx.cliente.findUniqueOrThrow({ where: { id: a.clienteId }, select: { id: true, nit: true } })), sedes: await this.sedes(tx, a),
    }));
    if (!confirmar) {
      const { plantilla: _p, ids: _i, nombres: _n, hash: _h, ...r } = await this.importacion.validarPortal(a, plantilla, cliente, file, delimitador);
      return r;
    }
    if (!acepta) throw new BadRequestException({ mensaje: 'Para cargar, acepte la declaración de responsabilidad del generador.' });
    return this.importacion.confirmarPortal(a, plantilla, cliente, (fn) => this.conCliente(a, fn, 120_000), file, delimitador);
  }

  // ---------------- Pedir servicios ----------------
  /** Lo que el usuario puede pedir: sus sedes activas y, en cada una, las declaraciones autorizadas y activas. */
  async opcionesPedido(a: Actor) {
    return this.conCliente(a, async (tx) => {
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
    });
  }

  /**
   * Pedido de servicio desde el portal: una sede, sus residuos o servicios autorizados y activos, la fecha deseada. Queda
   * PENDIENTE de aprobación («Por confirmar» en la oficina) con la tarifa vigente a esa fecha, como un pedido de la oficina.
   */
  async pedirServicio(a: Actor, b: z.infer<typeof PedirServicio>) {
    this.soloAdmin(a);
    const fecha = new Date(`${b.fechaSolicitada}T00:00:00Z`);
    const hoy = fechaColombia();
    if (Number.isNaN(fecha.getTime())) throw new BadRequestException({ mensaje: 'Fecha no válida.' });
    if (fecha < hoy) throw new BadRequestException({ mensaje: 'La fecha no puede ser anterior a hoy.' });
    if (fecha.getTime() > hoy.getTime() + 366 * 86_400_000) throw new BadRequestException({ mensaje: 'Pida el servicio con máximo un año de anticipación.' });
    const ids = b.items.map((i) => i.declaracionId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException({ mensaje: 'Cada residuo o servicio va una sola vez en la solicitud.' });
    return this.conCliente(a, async (tx) => {
      const sedes = await this.sedes(tx, a);
      const sede = (!sedes.length || sedes.includes(b.sucursalId))
        ? await tx.sucursal.findFirst({ where: { id: b.sucursalId, clienteId: a.clienteId, activa: true }, select: { id: true, nombre: true } }) : null;
      if (!sede) throw new NotFoundException({ mensaje: 'Sede no encontrada.' });
      const decls = await tx.declaracion.findMany({
        where: { id: { in: ids }, clienteId: a.clienteId, estado: 'AUTORIZADA', activa: true, sucursales: { some: { sucursalId: sede.id, activa: true } } },
        select: { id: true, tarifas: { where: { vigenteDesde: { lte: fecha }, OR: [{ vigenteHasta: null }, { vigenteHasta: { gte: fecha } }] }, take: 1, orderBy: { vigenteDesde: 'desc' }, select: { precioUnitario: true } } },
      });
      if (decls.length !== ids.length) throw new BadRequestException({ mensaje: `Algún residuo o servicio no está autorizado y activo para la sede «${sede.nombre}».` });
      const precio = (id: string) => decls.find((d) => d.id === id)?.tarifas[0]?.precioUnitario ?? null;
      const s = await tx.solicitud.create({ data: {
        empresaId: a.empresaId, clase: 'FORMAL', operacion: 'CARGA', clienteId: a.clienteId!, fechaSolicitada: fecha, aprobacion: 'PENDIENTE', creadoPorId: a.id,
        ordenCompra: b.ordenCompra ?? null, observaciones: b.observaciones ?? null,
        totalEstimado: b.items.reduce((acc, i) => acc + i.cantidadEstimada * Number(precio(i.declaracionId) ?? 0), 0),
      } });
      // La base vuelve a rechazar líneas con declaraciones no autorizadas, inactivas, de otro cliente o de otra sede
      for (const i of b.items) await tx.solicitudItem.create({ data: {
        solicitudId: s.id, declaracionId: i.declaracionId, sucursalId: sede.id, cantidadEstimada: i.cantidadEstimada, jornada: i.jornada ?? null, precioUnitario: precio(i.declaracionId),
      } });
      await this.audit.registrar(a, 'solicitud', s.id, 'CREAR_PORTAL', undefined, { numero: s.numero, sede: sede.nombre, lineas: b.items.length }, tx);
      return { id: s.id, numero: s.numero };
    });
  }

  /** El cliente cancela un pedido que Terra Viva aún no ha confirmado ni programado. Sus líneas quedan descartadas (regla de la base). */
  async cancelarSolicitud(a: Actor, id: string, motivo: string) {
    this.soloAdmin(a);
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
    await this.conCliente(a, async (tx) => {
      const sedes = await this.sedes(tx, a);
      const ok = tipo === 'acta'
        ? await tx.acta.findFirst({ where: { id, clienteId: a.clienteId, estado: 'EMITIDA', ...this.actaSede(sedes) }, select: { id: true } })
        : await tx.manifiesto.findFirst({ where: { id, clienteId: a.clienteId, estado: 'REALIZADO', ...(sedes.length ? { items: { some: { sucursalId: { in: sedes } } } } : {}) }, select: { id: true } });
      if (!ok) throw new NotFoundException({ mensaje: tipo === 'acta' ? 'Certificado no encontrado.' : 'Manifiesto no encontrado.' });
    });
    const token = await this.jwt.signAsync({ t: tipo, id, sub: a.id, emp: a.empresaId, cli: a.clienteId }, { secret: this.claveDescargas, expiresIn: '5m', issuer: 'terraviva-descargas' });
    return { url: `/descargas/${token}`, vence: new Date(Date.now() + 5 * 60_000).toISOString() };
  }

  /** Sirve el PDF de un enlace firmado vigente. Vuelve a verificar el cliente, con la segunda barrera. */
  async descargar(token: string, res: Response) {
    let p: { t: Documento; id: string; sub: string; emp: string; cli: string };
    try { p = await this.jwt.verifyAsync(token, { secret: this.claveDescargas, issuer: 'terraviva-descargas' }); }
    catch { throw new ForbiddenException({ mensaje: 'El enlace de descarga venció o no es válido. Pídalo de nuevo desde el portal.' }); }
    const a: Actor = { id: p.sub, empresaId: p.emp, clienteId: p.cli, rol: ROL_PORTAL, permisos: [], nombre: 'portal' };
    const doc = await this.conCliente(a, async (tx) => (p.t === 'acta'
      ? tx.acta.findFirst({ where: { id: p.id, clienteId: p.cli, estado: 'EMITIDA' }, select: { numero: true, pdfUrl: true, archivoUrl: true } })
      : tx.manifiesto.findFirst({ where: { id: p.id, clienteId: p.cli, estado: 'REALIZADO' }, select: { numero: true } })));
    if (!doc) throw new NotFoundException({ mensaje: 'Documento no encontrado.' });
    let buf: Buffer, nombre: string;
    if (p.t === 'acta') {
      const d = doc as { numero: string; pdfUrl: string | null; archivoUrl: string | null };
      const clave = d.pdfUrl ?? d.archivoUrl;
      if (!clave) throw new NotFoundException({ mensaje: 'El certificado aún no tiene PDF.' });
      buf = (await this.archivos.leer(clave, p.emp)).buf; nombre = `certificado-${d.numero}.pdf`;
    } else {
      const r = await this.manifiestos.pdfBuffer(a, p.id); buf = r.buf; nombre = `manifiesto-${r.numero}.pdf`;
    }
    await this.audit.registrar({ id: p.sub }, p.t === 'acta' ? 'acta' : 'manifiesto', p.id, 'DESCARGA_PORTAL');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nombre}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buf);
  }

  // ---------------- Usuarios del portal ----------------
  /** Usuarios de un cliente. Desde el portal (administrador del cliente) o desde la oficina (Clientes › ficha). */
  async usuarios(a: Actor, clienteId: string) {
    const consulta = async (db: Tx | PrismaService) => {
      const filas = await db.usuario.findMany({ where: { clienteId, empresaId: a.empresaId }, orderBy: [{ activo: 'desc' }, { nombre: 'asc' }], select: {
        id: true, nombre: true, email: true, documento: true, telefono: true, activo: true, perfilPortal: true, ultimoLogin: true, datosAceptadosEn: true, totpActivoDesde: true,
        sedesPortal: { select: { sucursal: { select: { id: true, codigo: true, nombre: true } } } },
      } });
      const mias = a.clienteId ? await this.sedes(db, a) : [];
      return filas.filter((u) => u.id === a.id || this.dentroDeSusSedes(mias, u.sedesPortal.map((s) => s.sucursal.id)));
    };
    return a.clienteId ? this.conCliente(a, consulta) : consulta(this.db);
  }

  private async validarSedes(db: Tx | PrismaService, clienteId: string, ids: string[]) {
    if (!ids.length) return;
    const n = await db.sucursal.count({ where: { id: { in: ids }, clienteId } });
    if (n !== new Set(ids).size) throw new BadRequestException({ mensaje: 'Alguna sede no es de este cliente.' });
  }

  async crearUsuario(a: Actor, clienteId: string, b: z.infer<typeof CrearUsuario>) {
    if (a.clienteId && a.perfilPortal !== 'ADMIN') throw new ForbiddenException({ mensaje: 'Solo el administrador de su empresa en el portal crea usuarios.' });
    const cliente = await this.db.cliente.findFirst({ where: { id: clienteId, empresaId: a.empresaId } });
    if (!cliente) throw new NotFoundException({ mensaje: 'Cliente no encontrado.' });
    if (await this.db.usuario.findUnique({ where: { email: b.email }, select: { id: true } })) throw new BadRequestException({ mensaje: `El correo ${b.email} ya tiene un usuario en TERRY-GO.` });
    const rol = await this.db.rol.findFirst({ where: { empresaId: a.empresaId, nombre: ROL_PORTAL } });
    if (!rol) throw new BadRequestException({ mensaje: `Falta el rol «${ROL_PORTAL}»: ejecute la siembra (npm run db:seed).` });
    const crear = async (db: Tx) => {
      await this.validarSedes(db, clienteId, b.sucursalIds);
      if (a.clienteId && !this.dentroDeSusSedes(await this.sedes(db, a), b.sucursalIds))
        throw new ForbiddenException({ mensaje: 'Usted ve solo algunas sedes: el usuario nuevo debe quedar limitado a sedes suyas.' });
      const u = await db.usuario.create({ data: {
        empresaId: a.empresaId, rolId: rol.id, clienteId, perfilPortal: b.perfil, nombre: b.nombre, documento: b.documento, telefono: b.telefono ?? null, email: b.email,
        passwordHash: await hashClave(randomBytes(32).toString('base64url')),
        sedesPortal: b.sucursalIds.length ? { create: [...new Set(b.sucursalIds)].map((sucursalId) => ({ sucursalId })) } : undefined,
      }, select: { id: true, nombre: true, email: true, perfilPortal: true } });
      await this.audit.registrar(a, 'usuario', u.id, 'CREAR_PORTAL', undefined, { clienteId, perfil: b.perfil, sedes: b.sucursalIds.length }, db);
      return u;
    };
    const u = a.clienteId ? await this.conCliente(a, crear) : await this.db.$transaction(crear);
    await this.auth.invitar(u.id);
    return u;
  }

  /**
   * Edita un usuario del portal: datos, perfil, sedes o activo. Nada se borra: inactivo no ingresa y sus sesiones se
   * cierran. Nadie se cambia el perfil ni se inactiva a sí mismo, y el cliente conserva al menos un administrador activo.
   */
  async editarUsuario(a: Actor, clienteId: string, id: string, b: z.infer<typeof EditarUsuario>) {
    if (a.clienteId && a.perfilPortal !== 'ADMIN') throw new ForbiddenException({ mensaje: 'Solo el administrador de su empresa en el portal edita usuarios.' });
    const editar = async (db: Tx) => {
      const u = await db.usuario.findFirst({ where: { id, clienteId, empresaId: a.empresaId } });
      if (!u) throw new NotFoundException({ mensaje: 'Usuario no encontrado.' });
      const antes = (await db.usuarioSucursal.findMany({ where: { usuarioId: id }, select: { sucursalId: true } })).map((s) => s.sucursalId).sort();
      const nuevas = b.sucursalIds ? [...new Set(b.sucursalIds)].sort() : null;
      const cambianSedes = !!nuevas && nuevas.join() !== antes.join();
      if (a.clienteId) {
        const mias = await this.sedes(db, a);
        if (id !== a.id && !this.dentroDeSusSedes(mias, antes)) throw new NotFoundException({ mensaje: 'Usuario no encontrado.' });
        if (cambianSedes && !this.dentroDeSusSedes(mias, nuevas!)) throw new ForbiddenException({ mensaje: 'Usted ve solo algunas sedes: el usuario debe quedar limitado a sedes suyas.' });
      }
      if (id === a.id && (b.activo === false || (b.perfil && b.perfil !== u.perfilPortal))) throw new BadRequestException({ mensaje: 'Nadie se inactiva ni se cambia el perfil a sí mismo.' });
      const dejaDeSerAdmin = u.activo && u.perfilPortal === 'ADMIN' && (b.activo === false || (b.perfil && b.perfil !== 'ADMIN'));
      if (dejaDeSerAdmin && !(await db.usuario.count({ where: { clienteId, activo: true, perfilPortal: 'ADMIN', id: { not: id } } })))
        throw new BadRequestException({ mensaje: 'Es el único administrador activo del portal de este cliente: primero dé ese perfil a otra persona.' });
      // Las sedes se leen en cada consulta: el cambio rige de inmediato, sin cerrar la sesión
      if (cambianSedes) {
        await this.validarSedes(db, clienteId, nuevas!);
        await db.usuarioSucursal.deleteMany({ where: { usuarioId: id } });
        if (nuevas!.length) await db.usuarioSucursal.createMany({ data: nuevas!.map((sucursalId) => ({ usuarioId: id, sucursalId })) });
      }
      const r = await db.usuario.update({ where: { id }, data: { nombre: b.nombre, documento: b.documento, telefono: b.telefono, perfilPortal: b.perfil, activo: b.activo },
        select: { id: true, nombre: true, email: true, activo: true, perfilPortal: true } });
      // El perfil va en el token: si cambia (o el usuario se inactiva), sus sesiones se cierran
      if ((b.activo === false && u.activo) || (b.perfil && b.perfil !== u.perfilPortal))
        await db.sesion.updateMany({ where: { usuarioId: id, revocadaEn: null }, data: { revocadaEn: new Date() } });
      const { sucursalIds: _s, ...datos } = b;
      await this.audit.registrar(a, 'usuario', id, b.activo === false && u.activo ? 'INACTIVAR_PORTAL' : 'EDITAR_PORTAL',
        { perfil: u.perfilPortal, activo: u.activo, ...(cambianSedes ? { sedes: antes } : {}) }, { ...datos, clienteId, ...(cambianSedes ? { sedes: nuevas } : {}) }, db);
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
    if (a.clienteId && a.perfilPortal !== 'ADMIN') throw new ForbiddenException({ mensaje: 'Solo el administrador de su empresa en el portal envía invitaciones.' });
    const u = await this.usuarioGestionable(a, clienteId, id);
    if (!u.activo) throw new BadRequestException({ mensaje: 'El usuario está inactivo: actívelo antes de enviarle la invitación.' });
    await this.auth.invitar(u.id);
    await this.audit.registrar(a, 'usuario', id, 'INVITACION_PORTAL');
  }

  /** Verificación en dos pasos de un usuario del portal que perdió el celular y sus códigos: la restablece su administrador o la oficina. */
  async restablecer2fa(a: Actor, clienteId: string, id: string) {
    if (a.clienteId && a.perfilPortal !== 'ADMIN') throw new ForbiddenException({ mensaje: 'Solo el administrador de su empresa en el portal la restablece.' });
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
  @Get('solicitudes') solicitudes(@ActorActual() a: Actor, @Query(new Zod(Pagina)) f: z.infer<typeof Pagina>) { return this.s.solicitudes(a, f); }
  @Get('manifiestos') manifiestos(@ActorActual() a: Actor, @Query(new Zod(FiltroFechas)) f: z.infer<typeof FiltroFechas>) { return this.s.listaManifiestos(a, f); }
  @Post('manifiestos/:id/enlace') enlaceManifiesto(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.enlace(a, 'manifiesto', id); }
  @Get('certificados') certificados(@ActorActual() a: Actor, @Query(new Zod(FiltroAnio)) f: z.infer<typeof FiltroAnio>) { return this.s.certificados(a, f); }
  @Post('certificados/:id/enlace') enlaceCertificado(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.enlace(a, 'acta', id); }
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
  @Post('solicitudes/:id/cancelar') cancelar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Cancelar)) b: z.infer<typeof Cancelar>) { return this.s.cancelarSolicitud(a, id, b.motivo); }
  @Get('usuarios') usuarios(@ActorActual() a: Actor) { return this.s.usuarios(a, a.clienteId!); }
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

@Module({ imports: [AuthModule, ManifiestosModule, ImportacionModule, JwtModule.register({})], controllers: [PortalController, UsuariosPortalOficinaController, DescargasController], providers: [PortalService] })
export class PortalModule {}
