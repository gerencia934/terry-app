// GPS de la flota con Wialon (requisitos de producción 7.2). TERRY-GO solo LEE de Wialon, con un token de solo lectura que
// vive únicamente en el .env del API.
// - Cada 30 a 60 segundos: unidades y última posición de cada vehículo; las unidades cuyo nombre trae la placa se enlazan
//   solas con su vehículo (las demás, a mano en Flota).
// - Rutas en curso (y las recién terminadas, por los mensajes que llegan tarde): los mensajes de Wialon desde el último
//   procesado → recorrido real (solo en las etapas con rastreo, la misma regla del celular), kilómetros, llegada y salida
//   de cada parada y de la planta, paradas no programadas con RESPEL y desvíos (eventos que no se borran).
// - Si Wialon falla, la operación sigue (las etapas las marca el conductor) y se avisa en las alertas.
import {
  BadRequestException, Body, ConflictException, Controller, Get, Global, HttpException, HttpStatus, Injectable, Logger, Module, NotFoundException, Param,
  ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, type OnApplicationBootstrap, type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { Auditoria } from '../common/servicios';
import { ActorActual, Permiso, Zod, type Actor } from '../common/http';
import type { Config } from '../config';
import type { Alerta } from '../permisos/cumplimiento.module';
import { ErrorWialon, WialonCliente, aPunto, placaEnNombre, type PuntoWialon, type UnidadWialon } from './wialon';
import { PARAMETROS_GPS, estadoAJson, estadoDeJson, estadoInicial, procesar, type EstadoParada, type Lugar, type ParadaRuta, type ParametrosGps } from './recorrido';

const HORA = 3_600_000;
const ANTES_DE_SALIR = 2 * HORA; // se mira desde 2 horas antes de «En camino» para ver la salida real de la planta
const VENTANA_MAX = 48 * HORA; // una ruta que nadie cerró deja de recibir puntos a las 48 horas de salir
const GRACIA = 10 * 60_000; // al terminar la ruta se esperan 10 minutos por los mensajes que llegan tarde (sin señal)

interface UnidadGuardada { id: number; nombre: string; vehiculoId: string | null; placa: string | null; posicionEn: string | null }
interface DetalleEstado { unidades?: UnidadGuardada[] }
/** Ajustes › Datos de la empresa › GPS: ubicación de la planta y reglas de las geocercas y alertas. */
export interface ConfGps { plantaLatitud?: number | null; plantaLongitud?: number | null; radioPlantaM?: number; radioSedeM?: number; minutosParada?: number; kmDesvio?: number }
export interface ResumenCiclo { unidades: number; enlazadas: number; rutas: number; puntos: number; eventos: number; errores: number; omitido?: boolean }
interface RutaPorProcesar {
  id: string; codigo: string; vehiculo_id: string; unidad: number; hora_salida: Date; hora_llegada_planta: Date | null; es_final: boolean;
}

const horaCo = (d: Date) => d.toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hour12: false });
const num = (d: { toString(): string } | null | undefined) => (d === null || d === undefined ? null : Number(d));
const iso = (ms: number | null) => (ms === null ? null : new Date(ms));

const Enlazar = z.object({ unidadId: z.number().int().positive().nullable() });
const Revisar = z.object({ nota: z.string().trim().min(3, 'Escriba qué pasó (al menos 3 letras).').max(300) });
const Fecha = z.object({ fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

@Injectable()
export class GpsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Wialon');
  private readonly wialon: WialonCliente;
  private reloj: NodeJS.Timeout | null = null;
  private empresaDeWialon: Promise<string | null> | null = null;
  private enCurso: Promise<ResumenCiclo> | null = null;

  constructor(private readonly db: PrismaService, private readonly audit: Auditoria, private readonly cfg: ConfigService<Config, true>) {
    this.wialon = new WialonCliente({ url: cfg.get('WIALON_URL', { infer: true }), token: cfg.get('WIALON_TOKEN', { infer: true }) });
  }

  /**
   * La empresa dueña de la cuenta de Wialon: la del NIT de WIALON_EMPRESA_NIT o, si no se indica, la única de la
   * instalación. Con varias empresas y sin ese NIT, Wialon queda apagado: la flota de una empresa nunca pasa a otra.
   */
  private empresaWialon() {
    this.empresaDeWialon ??= (async () => {
      if (!this.wialon.configurado) return null;
      const nit = this.cfg.get('WIALON_EMPRESA_NIT', { infer: true });
      const base = (x: string) => x.split('-')[0].replace(/\D/g, '');
      const empresas = await this.db.empresa.findMany({ select: { id: true, nit: true } });
      const e = nit ? empresas.find((x) => base(x.nit) === base(nit)) : empresas.length === 1 ? empresas[0] : undefined;
      if (!e) this.log.warn(nit ? `WIALON_EMPRESA_NIT (${nit}) no corresponde a ninguna empresa: Wialon queda apagado.` : 'Hay varias empresas: indique WIALON_EMPRESA_NIT para usar Wialon.');
      return e?.id ?? null;
    })().catch(() => { this.empresaDeWialon = null; return null; });
    return this.empresaDeWialon;
  }
  /** ¿Esta empresa usa la cuenta de Wialon configurada? */
  async conWialon(empresaId: string) { return (await this.empresaWialon()) === empresaId; }
  private get intervaloMs() { return this.cfg.get('WIALON_INTERVALO', { infer: true }) * 1000; }

  onApplicationBootstrap() {
    if (!this.wialon.configurado || !this.cfg.get('WIALON_CONSULTAR', { infer: true })) return;
    this.reloj = setInterval(() => void this.automatico(), this.intervaloMs);
    this.reloj.unref?.();
    setTimeout(() => void this.automatico(), 20_000).unref?.();
  }
  onModuleDestroy() { if (this.reloj) clearInterval(this.reloj); }

  private async automatico() {
    try {
      const id = await this.empresaWialon();
      if (id) await this.actualizar(id);
    } catch (e) { this.log.warn(`Consulta a Wialon: ${(e as Error).message}`); }
  }

  /** Botón «Actualizar ahora». Si Wialon falla responde 424 (no es un error de TERRY-GO): la operación sigue igual. */
  async actualizarAhora(a: Actor) {
    if (!(await this.conWialon(a.empresaId))) throw new BadRequestException({ mensaje: 'Wialon no está configurado para su empresa en el servidor (token de solo lectura y NIT de la empresa).' });
    try {
      return await this.actualizar(a.empresaId);
    } catch (e) {
      throw new HttpException({ mensaje: `${(e as Error).message} La operación sigue igual y la consulta se repite sola en un momento.` }, HttpStatus.FAILED_DEPENDENCY);
    }
  }

  /** Una consulta a la vez en esta copia del API (si ya hay una en curso, se espera esa). */
  actualizar(empresaId: string): Promise<ResumenCiclo> {
    this.enCurso ??= this.ciclo(empresaId).finally(() => { this.enCurso = null; });
    return this.enCurso;
  }

  private async ciclo(empresaId: string): Promise<ResumenCiclo> {
    // Entre copias del API: solo una consulta a la vez («ocupado_hasta» vence solo si una copia se cae a mitad de camino)
    const [libre] = await this.db.$queryRaw<{ ok: number }[]>`
      INSERT INTO wialon_estado (empresa_id, ultimo_intento, ocupado_hasta) VALUES (${empresaId}::uuid, now(), now() + interval '3 minutes')
      ON CONFLICT (empresa_id) DO UPDATE SET ultimo_intento = now(), ocupado_hasta = EXCLUDED.ocupado_hasta
        WHERE wialon_estado.ocupado_hasta IS NULL OR wialon_estado.ocupado_hasta < now()
      RETURNING 1 AS ok`;
    if (!libre) return { unidades: 0, enlazadas: 0, rutas: 0, puntos: 0, eventos: 0, errores: 0, omitido: true };
    try {
      const { resumen, detalle } = await this.consultar(empresaId);
      await this.db.wialonEstado.update({ where: { empresaId }, data: { ultimoOk: new Date(), fallosSeguidos: 0, error: null, ocupadoHasta: null, detalle: detalle as Prisma.InputJsonValue } });
      return resumen;
    } catch (e) {
      const mensaje = e instanceof ErrorWialon ? e.message : `No se pudieron procesar los datos de Wialon (${(e as Error).message}).`;
      if (!(e instanceof ErrorWialon)) this.log.error(mensaje, (e as Error).stack);
      await this.db.wialonEstado.update({ where: { empresaId }, data: { fallosSeguidos: { increment: 1 }, error: mensaje.slice(0, 300), ocupadoHasta: null } }).catch(() => undefined);
      throw e instanceof ErrorWialon ? e : new ErrorWialon(mensaje);
    }
  }

  private async consultar(empresaId: string) {
    const unidades = await this.wialon.unidades();
    const vehiculos = await this.db.vehiculo.findMany({ where: { empresaId }, select: { id: true, placa: true, activo: true, wialonUnidadId: true, wialonNombre: true } });
    const enlazadas = await this.enlazarPorPlaca(unidades, vehiculos);
    const porUnidad = new Map(unidades.map((u) => [u.id, u]));

    // Última posición de cada vehículo enlazado (y el nombre de la unidad al día)
    const filas: object[] = [];
    for (const v of vehiculos) {
      const u = v.wialonUnidadId ? porUnidad.get(v.wialonUnidadId) : undefined;
      if (!u) continue;
      if (u.nm.slice(0, 100) !== v.wialonNombre) await this.db.vehiculo.update({ where: { id: v.id }, data: { wialonNombre: u.nm.slice(0, 100) } });
      const p = aPunto(u.pos?.t, u.pos);
      if (p) filas.push({ vehiculo_id: v.id, unidad_id: u.id, lat: p.lat, lng: p.lng, vel: p.vel, rumbo: p.rumbo === null ? null : Math.round(p.rumbo) % 360, t: new Date(p.t).toISOString() });
    }
    if (filas.length) await this.db.$executeRaw`
      INSERT INTO vehiculos_gps (vehiculo_id, unidad_id, latitud, longitud, velocidad_kmh, rumbo, posicion_en, actualizado_en)
      SELECT f.vehiculo_id, f.unidad_id, f.lat, f.lng, f.vel, f.rumbo, f.t, now()
        FROM jsonb_to_recordset(${JSON.stringify(filas)}::jsonb) AS f(vehiculo_id uuid, unidad_id int, lat numeric, lng numeric, vel numeric, rumbo int, t timestamptz)
      ON CONFLICT (vehiculo_id) DO UPDATE SET unidad_id = EXCLUDED.unidad_id, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud,
        velocidad_kmh = EXCLUDED.velocidad_kmh, rumbo = EXCLUDED.rumbo, posicion_en = EXCLUDED.posicion_en, actualizado_en = now()
      WHERE vehiculos_gps.posicion_en <= EXCLUDED.posicion_en OR vehiculos_gps.unidad_id <> EXCLUDED.unidad_id`;

    const rutas = await this.procesarRutas(empresaId, porUnidad);
    const placaDe = new Map(vehiculos.filter((v) => v.wialonUnidadId).map((v) => [v.wialonUnidadId!, v]));
    const detalle: DetalleEstado = {
      unidades: unidades.slice(0, 1000).map((u) => ({ id: u.id, nombre: u.nm.slice(0, 100), vehiculoId: placaDe.get(u.id)?.id ?? null, placa: placaDe.get(u.id)?.placa ?? null,
        posicionEn: typeof u.pos?.t === 'number' ? new Date(u.pos.t * 1000).toISOString() : null })),
    };
    return { resumen: { unidades: unidades.length, enlazadas, ...rutas }, detalle };
  }

  /** Enlaza solas las unidades cuyo nombre trae la placa de un vehículo activo sin unidad (solo si no hay duda). */
  private async enlazarPorPlaca(unidades: UnidadWialon[], vehiculos: { id: string; placa: string; activo: boolean; wialonUnidadId: number | null; wialonNombre: string | null }[]) {
    const usadas = new Set(vehiculos.map((v) => v.wialonUnidadId).filter((x): x is number => !!x));
    const libres = vehiculos.filter((v) => v.activo && !v.wialonUnidadId);
    const porVehiculo = new Map<string, UnidadWialon[]>();
    for (const u of unidades) {
      if (usadas.has(u.id)) continue;
      const coinciden = libres.filter((v) => placaEnNombre(v.placa, u.nm));
      if (coinciden.length === 1) porVehiculo.set(coinciden[0].id, [...(porVehiculo.get(coinciden[0].id) ?? []), u]);
    }
    if (!porVehiculo.size) return 0;
    // Si alguien soltó a mano la unidad de un vehículo, no se vuelve a enlazar solo (la placa en el nombre no era suya)
    const soltados = new Set((await this.db.auditoria.findMany({ where: { entidad: 'vehiculo', accion: 'DESENLAZAR_WIALON', entidadId: { in: [...porVehiculo.keys()] } },
      select: { entidadId: true } })).map((x) => x.entidadId));
    let n = 0;
    for (const [vehiculoId, us] of porVehiculo) {
      if (us.length !== 1 || soltados.has(vehiculoId)) continue; // dos unidades con la misma placa: se enlaza a mano
      const v = vehiculos.find((x) => x.id === vehiculoId)!;
      const u = us[0];
      try {
        await this.db.vehiculo.update({ where: { id: v.id, wialonUnidadId: null }, data: { wialonUnidadId: u.id, wialonNombre: u.nm.slice(0, 100) } });
        await this.audit.registrar(null, 'vehiculo', v.id, 'ENLAZAR_WIALON', undefined, { unidad: u.id, nombre: u.nm, automatico: true });
        v.wialonUnidadId = u.id; v.wialonNombre = u.nm.slice(0, 100); n++;
      } catch { /* otra copia del API lo enlazó o la unidad ya está en otro vehículo */ }
    }
    return n;
  }

  /** Ajustes de la empresa: ubicación de la planta y reglas (con los valores por omisión). */
  async parametros(empresaId: string): Promise<{ planta: Lugar | null; p: ParametrosGps }> {
    const e = await this.db.empresa.findUniqueOrThrow({ where: { id: empresaId }, select: { configuracion: true } });
    const g = ((e.configuracion ?? {}) as { gps?: ConfGps }).gps ?? {};
    const planta = typeof g.plantaLatitud === 'number' && typeof g.plantaLongitud === 'number' ? { lat: g.plantaLatitud, lng: g.plantaLongitud } : null;
    return { planta, p: { radioPlantaM: g.radioPlantaM ?? PARAMETROS_GPS.radioPlantaM, radioSedeM: g.radioSedeM ?? PARAMETROS_GPS.radioSedeM,
      minutosParada: g.minutosParada ?? PARAMETROS_GPS.minutosParada, kmDesvio: g.kmDesvio ?? PARAMETROS_GPS.kmDesvio } };
  }

  /**
   * Rutas que salieron en los últimos 3 días con vehículo enlazado: las que siguen en curso y las terminadas a las que
   * les falta el último tramo. Si un vehículo tiene dos rutas abiertas, cada punto es de la que salió después.
   */
  private async procesarRutas(empresaId: string, porUnidad: Map<number, UnidadWialon>) {
    const res = { rutas: 0, puntos: 0, eventos: 0, errores: 0 };
    const rutas = await this.db.$queryRaw<RutaPorProcesar[]>`
      SELECT r.id::text, r.codigo, r.vehiculo_id::text, v.wialon_unidad_id AS unidad, r.hora_salida, r.hora_llegada_planta, e.es_final
        FROM rutas r
        JOIN estados_recorrido e ON e.id = r.estado_recorrido_id
        JOIN vehiculos v ON v.id = r.vehiculo_id
        LEFT JOIN rutas_gps g ON g.ruta_id = r.id
       WHERE r.empresa_id = ${empresaId}::uuid AND r.hora_salida IS NOT NULL AND v.wialon_unidad_id IS NOT NULL
         AND r.hora_salida > now() - interval '3 days' AND (g.ruta_id IS NULL OR NOT g.cerrada)
       ORDER BY r.vehiculo_id, r.hora_salida`;
    if (!rutas.length) return res;
    const ids = rutas.map((r) => r.id);
    const [conf, previos, paradas] = await Promise.all([
      this.parametros(empresaId),
      this.db.rutaGps.findMany({ where: { rutaId: { in: ids } } }),
      this.db.rutaParada.findMany({ where: { rutaId: { in: ids } }, select: { id: true, rutaId: true, orden: true, estado: true, gps: true,
        sucursal: { select: { latitud: true, longitud: true } },
        items: { where: { liberado: false }, select: { solicitudItem: { select: { declaracion: { select: { esPeligroso: true } } } } } } } }),
    ]);
    const ahora = Date.now();
    for (let i = 0; i < rutas.length; i++) {
      const r = rutas[i], siguiente = rutas[i + 1]?.vehiculo_id === r.vehiculo_id ? rutas[i + 1] : undefined;
      try {
        const salida = r.hora_salida.getTime();
        const fin = Math.min(ahora, salida + VENTANA_MAX, siguiente ? siguiente.hora_salida.getTime() : Infinity, r.es_final ? (r.hora_llegada_planta?.getTime() ?? ahora) : Infinity);
        const cortada = fin < ahora && (r.es_final || !!siguiente || fin === salida + VENTANA_MAX);
        const g = previos.find((x) => x.rutaId === r.id);
        const desde = g ? g.procesadoHasta.getTime() : salida - ANTES_DE_SALIR;
        const suyas = paradas.filter((p) => p.rutaId === r.id);
        const ctx = {
          horaSalida: salida, planta: conf.planta, p: conf.p,
          paradas: suyas.map((p): ParadaRuta => ({ id: p.id, orden: p.orden, atendida: p.estado === 'ATENDIDA',
            lugar: p.sucursal.latitud !== null && p.sucursal.longitud !== null ? { lat: Number(p.sucursal.latitud), lng: Number(p.sucursal.longitud) } : null,
            respel: p.items.some((it) => it.solicitudItem.declaracion.esPeligroso) })),
        };
        const estadoParadas: Record<string, EstadoParada> = Object.fromEntries(suyas.filter((p) => p.gps).map((p) => [p.id, {
          llegada: p.gps!.llegada?.getTime() ?? null, salida: p.gps!.salida?.getTime() ?? null, dentroDesde: p.gps!.dentroDesde?.getTime() ?? null, segundos: p.gps!.segundosEnSitio }]));
        const est = g ? estadoDeJson(g.estado, { km: Number(g.km), salidaPlanta: g.salidaPlanta?.getTime() ?? null, llegadaPlanta: g.llegadaPlanta?.getTime() ?? null }, estadoParadas)
          : { ...estadoInicial(), paradas: estadoParadas };

        let puntos: PuntoWialon[] = [];
        if (fin > desde) {
          try { puntos = await this.wialon.puntos(r.unidad, desde + 1000, fin); }
          catch (e) {
            if (!(e instanceof ErrorWialon)) throw e;
            // Respaldo: al menos la última posición, si cae en la ventana
            const u = porUnidad.get(r.unidad), p = aPunto(u?.pos?.t, u?.pos);
            puntos = p && p.t > desde && p.t <= fin ? [p] : [];
            res.errores++;
          }
        }
        const x = procesar(ctx, est, puntos, fin);
        const procesadoHasta = new Date(puntos.length ? Math.max(desde, puntos[puntos.length - 1].t) : desde);
        const cerrada = cortada && ahora - fin > GRACIA;
        await this.db.$transaction(async (tx) => {
          for (const ev of x.eventos) {
            if (ev.id === null) {
              const nuevo = await tx.eventoGps.create({ data: { empresaId, rutaId: r.id, vehiculoId: r.vehiculo_id, tipo: ev.tipo, inicio: new Date(ev.inicio), fin: iso(ev.fin),
                latitud: ev.lat, longitud: ev.lng, conRespel: ev.conRespel, detalle: ev.detalle }, select: { id: true } });
              ev.id = nuevo.id;
              res.eventos++;
            } else {
              await tx.$executeRaw`UPDATE eventos_gps SET fin = ${iso(ev.fin)}, detalle = detalle || ${JSON.stringify(ev.detalle)}::jsonb WHERE id = ${ev.id} AND fin IS NULL`;
            }
          }
          let nuevos = 0;
          if (x.guardar.length) {
            const json = JSON.stringify(x.guardar.map((p) => ({ lat: p.lat, lng: p.lng, vel: p.vel === null ? null : Math.min(p.vel, 999), t: new Date(p.t).toISOString() })));
            // La misma regla del celular (solo en etapas con rastreo), filtrada aquí para no rechazar el lote entero
            nuevos = await tx.$executeRaw`
              INSERT INTO ruta_rastreo (ruta_id, vehiculo_id, latitud, longitud, velocidad_kmh, registrado_en, fuente)
              SELECT ${r.id}::uuid, ${r.vehiculo_id}::uuid, p.lat, p.lng, p.vel, p.t, 'WIALON'
                FROM jsonb_to_recordset(${json}::jsonb) AS p(lat numeric, lng numeric, vel numeric, t timestamptz)
               WHERE p.t <= now() + interval '10 minutes'
                 AND COALESCE((SELECT e.rastreo FROM ruta_eventos ev JOIN estados_recorrido e ON e.id = ev.estado_recorrido_id
                                WHERE ev.ruta_id = ${r.id}::uuid AND ev.desde <= p.t ORDER BY ev.desde DESC, ev.id DESC LIMIT 1), false)
              ON CONFLICT (ruta_id, registrado_en) WHERE fuente = 'WIALON' DO NOTHING`;
          }
          const datos = { vehiculoId: r.vehiculo_id, unidadId: r.unidad, procesadoHasta, km: Math.round(est.km * 100) / 100, salidaPlanta: iso(est.salidaPlanta),
            llegadaPlanta: iso(est.llegadaPlanta), estado: estadoAJson(est) as Prisma.InputJsonValue, cerrada, actualizadoEn: new Date() };
          await tx.rutaGps.upsert({ where: { rutaId: r.id }, create: { rutaId: r.id, ...datos, puntos: nuevos }, update: { ...datos, puntos: { increment: nuevos } } });
          for (const id of x.paradasCambiadas) {
            const s = est.paradas[id];
            const d = { llegada: iso(s.llegada), salida: iso(s.salida), dentroDesde: iso(s.dentroDesde), segundosEnSitio: s.segundos, actualizadoEn: new Date() };
            await tx.paradaGps.upsert({ where: { paradaId: id }, create: { paradaId: id, rutaId: r.id, ...d }, update: d });
          }
          res.puntos += nuevos;
        });
        res.rutas++;
      } catch (e) {
        res.errores++;
        this.log.error(`Ruta ${r.codigo}: ${(e as Error).message}`, (e as Error).stack);
      }
    }
    return res;
  }

  // ---------------- Consultas para las pantallas ----------------
  /** Flota: estado de la conexión, unidades de la cuenta y vehículos con su unidad y última posición. */
  async estado(a: Actor) {
    const configurado = await this.conWialon(a.empresaId);
    const [est, vehiculos, conf] = await Promise.all([
      this.db.wialonEstado.findUnique({ where: { empresaId: a.empresaId } }),
      this.db.vehiculo.findMany({ where: { empresaId: a.empresaId }, orderBy: { placa: 'asc' },
        select: { id: true, placa: true, color: true, activo: true, wialonUnidadId: true, wialonNombre: true, gps: true } }),
      this.parametros(a.empresaId),
    ]);
    const intervaloS = this.cfg.get('WIALON_INTERVALO', { infer: true });
    return {
      configurado, intervaloS,
      conectado: configurado && !!est?.ultimoOk && est.fallosSeguidos === 0 && Date.now() - est.ultimoOk.getTime() < Math.max(10 * 60_000, 5 * intervaloS * 1000),
      ultimoOk: est?.ultimoOk ?? null, ultimoIntento: est?.ultimoIntento ?? null, error: est?.error ?? null, fallosSeguidos: est?.fallosSeguidos ?? 0,
      unidades: configurado ? (((est?.detalle ?? {}) as DetalleEstado).unidades ?? []) : [],
      vehiculos: vehiculos.map((v) => ({ id: v.id, placa: v.placa, color: v.color, activo: v.activo, unidadId: v.wialonUnidadId, unidadNombre: v.wialonNombre, posicion: posicion(v.gps) })),
      geocercas: { planta: conf.planta, ...conf.p },
    };
  }

  /** Seguimiento del día: posición de cada vehículo y, por ruta, kilómetros, planta, paradas y eventos del GPS. */
  async seguimiento(a: Actor, fecha: string) {
    const dia = new Date(`${fecha}T00:00:00Z`);
    const [configurado, est, conf, vehiculos, rutas] = await Promise.all([
      this.conWialon(a.empresaId),
      this.db.wialonEstado.findUnique({ where: { empresaId: a.empresaId }, select: { ultimoOk: true, fallosSeguidos: true, error: true } }),
      this.parametros(a.empresaId),
      this.db.vehiculo.findMany({ where: { empresaId: a.empresaId, gps: { isNot: null } }, select: { id: true, placa: true, color: true, gps: true } }),
      this.db.ruta.findMany({ where: { empresaId: a.empresaId, fechaProgramada: dia }, select: { id: true, gps: true, paradasGps: true,
        eventosGps: { orderBy: { inicio: 'asc' }, include: { revisor: { select: { nombre: true } } } } } }),
    ]);
    return {
      configurado, ultimoOk: est?.ultimoOk ?? null, error: est?.fallosSeguidos ? est.error : null,
      planta: conf.planta ? { ...conf.planta, radioM: conf.p.radioPlantaM } : null, radioSedeM: conf.p.radioSedeM,
      vehiculos: vehiculos.map((v) => ({ id: v.id, placa: v.placa, color: v.color, ...posicion(v.gps)! })),
      rutas: Object.fromEntries(rutas.map((r) => [r.id, resumenRuta(r)])),
    };
  }

  /** Detalle de una ruta: el resumen del GPS, la ubicación de cada parada y la del vehículo ahora. */
  async ruta(a: Actor, id: string) {
    const r = await this.db.ruta.findFirst({ where: { id, empresaId: a.empresaId }, select: { id: true, gps: true, paradasGps: true,
      eventosGps: { orderBy: { inicio: 'asc' }, include: { revisor: { select: { nombre: true } } } },
      vehiculo: { select: { placa: true, wialonUnidadId: true, gps: true } },
      paradas: { orderBy: { orden: 'asc' }, select: { id: true, orden: true, sucursal: { select: { nombre: true, latitud: true, longitud: true } } } } } });
    if (!r) throw new NotFoundException({ mensaje: 'Ruta no encontrada.' });
    const conf = await this.parametros(a.empresaId);
    return {
      ...resumenRuta(r), configurado: await this.conWialon(a.empresaId), vehiculoEnlazado: !!r.vehiculo?.wialonUnidadId, posicion: posicion(r.vehiculo?.gps ?? null),
      planta: conf.planta ? { ...conf.planta, radioM: conf.p.radioPlantaM } : null, radioSedeM: conf.p.radioSedeM,
      sitios: r.paradas.map((p) => ({ paradaId: p.id, orden: p.orden, nombre: p.sucursal.nombre, lat: num(p.sucursal.latitud), lng: num(p.sucursal.longitud) })),
    };
  }

  // ---------------- Acciones ----------------
  /** Flota: enlazar (o soltar) la unidad de Wialon de un vehículo, cuando el nombre de la unidad no trae la placa. */
  async enlazar(a: Actor, vehiculoId: string, unidadId: number | null) {
    const v = await this.db.vehiculo.findFirst({ where: { id: vehiculoId, empresaId: a.empresaId } });
    if (!v) throw new NotFoundException({ mensaje: 'Vehículo no encontrado.' });
    if (unidadId === v.wialonUnidadId) return { id: v.id, unidadId, unidadNombre: v.wialonNombre };
    let nombre: string | null = null;
    if (unidadId !== null) {
      if (!(await this.conWialon(a.empresaId))) throw new BadRequestException({ mensaje: 'Wialon no está configurado para su empresa en el servidor.' });
      const est = await this.db.wialonEstado.findUnique({ where: { empresaId: a.empresaId }, select: { detalle: true } });
      const u = ((est?.detalle ?? {}) as DetalleEstado).unidades?.find((x) => x.id === unidadId);
      if (!u) throw new BadRequestException({ mensaje: 'Esa unidad no está en la cuenta de Wialon. Actualice la lista e intente de nuevo.' });
      const otro = await this.db.vehiculo.findFirst({ where: { empresaId: a.empresaId, wialonUnidadId: unidadId, id: { not: v.id } }, select: { placa: true } });
      if (otro) throw new ConflictException({ mensaje: `La unidad «${u.nombre}» ya está enlazada al vehículo ${otro.placa}. Suéltela allá primero.` });
      nombre = u.nombre;
    }
    await this.db.$transaction(async (tx) => {
      await tx.vehiculo.update({ where: { id: v.id }, data: { wialonUnidadId: unidadId, wialonNombre: nombre } });
      await tx.vehiculoGps.deleteMany({ where: { vehiculoId: v.id } }); // la posición era de la unidad anterior
      await this.audit.registrar(a, 'vehiculo', v.id, unidadId === null ? 'DESENLAZAR_WIALON' : 'ENLAZAR_WIALON',
        { unidad: v.wialonUnidadId, nombre: v.wialonNombre }, { unidad: unidadId, nombre }, tx);
    });
    return { id: v.id, unidadId, unidadNombre: nombre };
  }

  /** Seguimiento: marcar revisado un evento del GPS con la explicación (queda quién y cuándo; no se cambia después). */
  async revisar(a: Actor, id: number, nota: string) {
    const ev = await this.db.eventoGps.findFirst({ where: { id, empresaId: a.empresaId } });
    if (!ev) throw new NotFoundException({ mensaje: 'Evento no encontrado.' });
    if (ev.revisadoEn) throw new ConflictException({ mensaje: 'Este evento ya fue revisado.' });
    const r = await this.db.eventoGps.update({ where: { id }, data: { revisadoPor: a.id, revisadoEn: new Date(), nota } });
    await this.audit.registrar(a, 'evento_gps', String(id), 'REVISAR', undefined, { nota });
    return { id: r.id, revisadoEn: r.revisadoEn, nota: r.nota };
  }

  // ---------------- Alertas (Logística y Gerencia) ----------------
  async alertas(empresaId: string): Promise<Alerta[]> {
    if (!(await this.conWialon(empresaId))) return [];
    const out: Alerta[] = [];
    const [est, eventos, sinUnidad] = await Promise.all([
      this.db.wialonEstado.findUnique({ where: { empresaId } }),
      this.db.eventoGps.findMany({ where: { empresaId, revisadoEn: null, inicio: { gte: new Date(Date.now() - 7 * 24 * HORA) } }, orderBy: { inicio: 'desc' }, take: 30,
        include: { vehiculo: { select: { placa: true } }, ruta: { select: { codigo: true } } } }),
      this.db.ruta.findMany({ where: { empresaId, horaSalida: { gte: new Date(Date.now() - 2 * 24 * HORA) }, estadoRecorrido: { esFinal: false }, vehiculo: { wialonUnidadId: null } },
        select: { codigo: true, vehiculo: { select: { placa: true } } } }),
    ]);
    const limite = Date.now() - Math.max(10 * 60_000, 5 * this.intervaloMs);
    if (est && (est.fallosSeguidos >= 3 || (est.ultimoOk ? est.ultimoOk.getTime() < limite : est.fallosSeguidos > 0))) {
      out.push({ tipo: 'gps', nivel: 'alta', titulo: est.ultimoOk ? `Wialon no responde desde las ${horaCo(est.ultimoOk)}` : 'TERRY-GO no ha podido conectarse con Wialon',
        detalle: `${est.error ?? 'Sin respuesta.'} Las posiciones no se actualizan; la operación sigue: el conductor marca las etapas en la app` });
    }
    for (const e of eventos) {
      const abierto = !e.fin, min = Math.round(((e.fin ?? new Date()).getTime() - e.inicio.getTime()) / 60_000);
      const d = (e.detalle ?? {}) as { distanciaKm?: number };
      out.push(e.tipo === 'PARADA_NO_PROGRAMADA'
        ? { tipo: 'gps', nivel: abierto ? 'alta' : 'media', titulo: `${e.vehiculo.placa} ${abierto ? 'lleva' : 'estuvo'} ${min} min detenido fuera de ruta con RESPEL`,
            detalle: `Ruta ${e.ruta.codigo}, desde las ${horaCo(e.inicio)}. Revíselo en Seguimiento y deje la explicación`, referencia: `${e.id}` }
        : { tipo: 'gps', nivel: abierto && e.conRespel ? 'alta' : 'media',
            titulo: `${e.vehiculo.placa} ${abierto ? 'va' : 'fue'} ${d.distanciaKm ? `a ${String(d.distanciaKm).replace('.', ',')} km` : 'lejos'} de su ruta${e.conRespel ? ' con RESPEL' : ''}`,
            detalle: `Ruta ${e.ruta.codigo}, desde las ${horaCo(e.inicio)}${abierto ? '' : ` (${min} min)`}. Revíselo en Seguimiento y deje la explicación`, referencia: `${e.id}` });
    }
    if (sinUnidad.length) {
      const placas = [...new Set(sinUnidad.map((r) => r.vehiculo?.placa).filter(Boolean))].join(', ');
      out.push({ tipo: 'flota', nivel: 'info', titulo: `${sinUnidad.length === 1 ? 'Una ruta en curso va' : `${sinUnidad.length} rutas en curso van`} en vehículos sin GPS de Wialon`,
        detalle: `${placas}: enlace su unidad de Wialon en Ajustes › Flota para ver la posición y el recorrido` });
    }
    return out;
  }
}

/** Posición de un vehículo para las pantallas. */
function posicion(g: { latitud: unknown; longitud: unknown; velocidadKmh: unknown; rumbo: number | null; posicionEn: Date } | null) {
  return g ? { lat: Number(g.latitud), lng: Number(g.longitud), velocidad: g.velocidadKmh === null || g.velocidadKmh === undefined ? null : Number(g.velocidadKmh),
    rumbo: g.rumbo, posicionEn: g.posicionEn } : null;
}

type RutaConGps = {
  gps: { km: unknown; puntos: number; salidaPlanta: Date | null; llegadaPlanta: Date | null; procesadoHasta: Date; cerrada: boolean } | null;
  paradasGps: { paradaId: string; llegada: Date | null; salida: Date | null; dentroDesde: Date | null; segundosEnSitio: number }[];
  eventosGps: { id: number; tipo: string; inicio: Date; fin: Date | null; latitud: unknown; longitud: unknown; conRespel: boolean; detalle: unknown;
    revisadoEn: Date | null; nota: string | null; revisor: { nombre: string } | null }[];
};
function resumenRuta(r: RutaConGps) {
  const ahora = Date.now();
  return {
    km: r.gps ? Number(r.gps.km) : null, puntos: r.gps?.puntos ?? 0, salidaPlanta: r.gps?.salidaPlanta ?? null, llegadaPlanta: r.gps?.llegadaPlanta ?? null,
    procesadoHasta: r.gps?.procesadoHasta ?? null, cerrada: r.gps?.cerrada ?? false,
    paradas: Object.fromEntries(r.paradasGps.map((p) => [p.paradaId, {
      llegada: p.llegada, salida: p.dentroDesde ? null : p.salida, enSitio: !!p.dentroDesde,
      minutos: Math.round((p.segundosEnSitio + (p.dentroDesde ? Math.max(0, ahora - p.dentroDesde.getTime()) / 1000 : 0)) / 60),
    }])),
    eventos: r.eventosGps.map((e) => {
      const d = (e.detalle ?? {}) as { distanciaKm?: number };
      return { id: e.id, tipo: e.tipo, inicio: e.inicio, fin: e.fin, lat: Number(e.latitud), lng: Number(e.longitud), conRespel: e.conRespel,
        minutos: Math.round(((e.fin?.getTime() ?? ahora) - e.inicio.getTime()) / 60_000), distanciaKm: d.distanciaKm ?? null,
        revisadoEn: e.revisadoEn, nota: e.nota, revisadoPor: e.revisor?.nombre ?? null };
    }),
  };
}

@Controller()
class GpsController {
  constructor(private readonly s: GpsService) {}
  @Permiso('rutas.programar') @Get('gps/estado') estado(@ActorActual() a: Actor) { return this.s.estado(a); }
  @Permiso('rutas.programar') @Post('gps/actualizar') actualizar(@ActorActual() a: Actor) { return this.s.actualizarAhora(a); }
  @Permiso('rutas.programar') @Get('gps/seguimiento') seguimiento(@ActorActual() a: Actor, @Query(new Zod(Fecha)) q: z.infer<typeof Fecha>) { return this.s.seguimiento(a, q.fecha); }
  @Permiso('rutas.programar') @Get('rutas/:id/gps') ruta(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.ruta(a, id); }
  @Permiso('rutas.programar') @Patch('gps/eventos/:id') revisar(@ActorActual() a: Actor, @Param('id', ParseIntPipe) id: number, @Body(new Zod(Revisar)) b: z.infer<typeof Revisar>) {
    return this.s.revisar(a, id, b.nota);
  }
  @Permiso('rutas.programar') @Patch('vehiculos/:id/wialon') enlazar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Enlazar)) b: z.infer<typeof Enlazar>) {
    return this.s.enlazar(a, id, b.unidadId);
  }
}

@Global()
@Module({ controllers: [GpsController], providers: [GpsService], exports: [GpsService] })
export class GpsModule {}
