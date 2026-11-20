// Lo que se calcula con los puntos de Wialon de una ruta (sin base de datos, para poder probarlo aparte):
// - salida y llegada a la planta (geocerca de la planta, si está ubicada en Ajustes › Datos de la empresa);
// - llegada, salida y tiempo en sitio en cada parada (geocerca de la sede);
// - kilómetros recorridos (suma de tramos, sin el temblor del GPS quieto ni saltos imposibles);
// - puntos para el recorrido (uno cada 30 segundos como máximo);
// - paradas no programadas con RESPEL: quieto más de N minutos fuera de toda geocerca, después de recoger peligrosos;
// - desvíos: más de N km lejos del trayecto planta → paradas → planta durante 3 minutos o más.
import type { PuntoWialon } from './wialon';

export interface Lugar { lat: number; lng: number }
export interface ParametrosGps { radioPlantaM: number; radioSedeM: number; minutosParada: number; kmDesvio: number }
export const PARAMETROS_GPS: ParametrosGps = { radioPlantaM: 400, radioSedeM: 200, minutosParada: 15, kmDesvio: 5 };

export interface ParadaRuta { id: string; orden: number; lugar: Lugar | null; respel: boolean; atendida: boolean }
export interface EstadoParada { llegada: number | null; salida: number | null; dentroDesde: number | null; segundos: number }
export type TipoEventoGps = 'PARADA_NO_PROGRAMADA' | 'DESVIO';
export interface EventoGps {
  id: number | null; tipo: TipoEventoGps; inicio: number; fin: number | null; lat: number; lng: number; conRespel: boolean; detalle: Record<string, number>;
}
export interface EstadoRecorrido {
  enPlanta: boolean | null;
  salidaPlanta: number | null;
  llegadaPlanta: number | null;
  km: number;
  /** Último punto contado para los kilómetros. */
  ultimo: (Lugar & { t: number; vel: number | null }) | null;
  /** Hora del último punto guardado en el recorrido. */
  guardado: number | null;
  /** Dónde y desde cuándo está quieto (fuera de toda geocerca), con su evento si ya pasó el tiempo. */
  ancla: (Lugar & { t: number; evento: EventoGps | null }) | null;
  /** Desde cuándo está lejos del trayecto previsto, con la mayor distancia y su evento. */
  fuera: (Lugar & { t: number; maxKm: number; evento: EventoGps | null }) | null;
  paradas: Record<string, EstadoParada>;
}
export interface Contexto { horaSalida: number; planta: Lugar | null; paradas: ParadaRuta[]; p: ParametrosGps }

const RADIO_TIERRA_KM = 6371.0088;
const rad = (g: number) => (g * Math.PI) / 180;
export function distanciaKm(a: Lugar, b: Lugar) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_TIERRA_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** Distancia (km) de un punto al tramo a–b. Proyección plana local: basta para decenas de kilómetros. */
export function distanciaTramoKm(p: Lugar, a: Lugar, b: Lugar) {
  const kx = Math.cos(rad((a.lat + b.lat) / 2)) * 111.32, ky = 110.574;
  const [px, py, ax, ay, bx, by] = [p.lng * kx, p.lat * ky, a.lng * kx, a.lat * ky, b.lng * kx, b.lat * ky];
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
export function distanciaTrayectoKm(p: Lugar, tray: Lugar[]) {
  let min = Infinity;
  for (let i = 1; i < tray.length; i++) min = Math.min(min, distanciaTramoKm(p, tray[i - 1], tray[i]));
  return min;
}
/** Dentro de una geocerca, con margen para salir: el GPS que tiembla en el borde no marca entradas y salidas falsas. */
const dentro = (dKm: number, radioM: number, estabaDentro: boolean) => dKm * 1000 <= (estabaDentro ? radioM + Math.max(50, radioM * 0.3) : radioM);

const QUIETO_KMH = 5; // a esta velocidad o menos, el vehículo está detenido
const RADIO_ANCLA_KM = 0.15; // moverse menos de 150 m no cuenta como seguir el viaje
const MINUTOS_DESVIO = 3; // lejos del trayecto al menos 3 minutos (no un punto suelto)
const MAX_KMH = 160; // un tramo más rápido que esto es un salto del GPS: no se cuenta
const CADA_PUNTO_MS = 30_000;
const redondear = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

export function estadoInicial(): EstadoRecorrido {
  return { enPlanta: null, salidaPlanta: null, llegadaPlanta: null, km: 0, ultimo: null, guardado: null, ancla: null, fuera: null, paradas: {} };
}

/** Trayecto previsto: planta → paradas en su orden → planta (solo las que tienen ubicación). */
export function trayecto(ctx: Contexto): Lugar[] {
  const ps = ctx.paradas.filter((p) => p.lugar).sort((a, b) => a.orden - b.orden).map((p) => p.lugar!);
  return ctx.planta ? [ctx.planta, ...ps, ctx.planta] : ps;
}

/**
 * Procesa los puntos nuevos (en orden) sobre el estado de la ruta. Devuelve los puntos para el recorrido, los eventos
 * nuevos o que cambiaron y las paradas cuya llegada o salida cambió. «ahora» es el final de la ventana: si el vehículo
 * quedó quieto sin mandar mensajes (motor apagado), la parada cuenta hasta esa hora.
 */
export function procesar(ctx: Contexto, e: EstadoRecorrido, puntos: PuntoWialon[], ahora: number) {
  const guardar: PuntoWialon[] = [];
  const tocados = new Set<EventoGps>();
  const paradasCambiadas = new Set<string>();
  const tray = trayecto(ctx);
  const lleva = () => ctx.paradas.some((p) => p.respel && (p.atendida || e.paradas[p.id]?.salida != null));
  const nuevo = (tipo: TipoEventoGps, l: Lugar & { t: number }, conRespel: boolean, detalle: Record<string, number> = {}) => {
    const ev: EventoGps = { id: null, tipo, inicio: l.t, fin: null, lat: l.lat, lng: l.lng, conRespel, detalle };
    tocados.add(ev);
    return ev;
  };
  const cerrar = (ev: EventoGps | null | undefined, t: number, extra: Record<string, number> = {}) => {
    if (!ev || ev.fin !== null) return;
    ev.fin = Math.max(t, ev.inicio);
    ev.detalle = { ...ev.detalle, ...extra, minutos: Math.round((ev.fin - ev.inicio) / 60_000) };
    tocados.add(ev);
  };
  const abrirParada = (t: number) => {
    if (e.ancla && !e.ancla.evento && t - e.ancla.t >= ctx.p.minutosParada * 60_000 && lleva()) {
      e.ancla.evento = nuevo('PARADA_NO_PROGRAMADA', e.ancla, true, { minutos: Math.round((t - e.ancla.t) / 60_000) });
    }
  };
  let previo = -Infinity;

  for (const pt of puntos) {
    if (pt.t <= previo) continue; // repetido o desordenado
    previo = pt.t;

    // 1) Planta: la salida puede ser un poco antes de que el conductor marque «En camino»
    if (ctx.planta) {
      const ahoraDentro = dentro(distanciaKm(pt, ctx.planta), ctx.p.radioPlantaM, e.enPlanta === true);
      if (e.enPlanta === true && !ahoraDentro && e.salidaPlanta === null) {
        e.salidaPlanta = pt.t;
        if (e.llegadaPlanta !== null && e.llegadaPlanta < pt.t) e.llegadaPlanta = null; // entró de paso antes de salir
      }
      if (e.enPlanta === false && ahoraDentro && pt.t >= ctx.horaSalida) e.llegadaPlanta = pt.t; // vale la última llegada
      e.enPlanta = ahoraDentro;
    }
    if (pt.t < ctx.horaSalida) continue; // antes de salir solo cuenta la planta

    // 2) Paradas: llegada (la primera), salida (la última) y tiempo en sitio (suma de las visitas)
    let enSede = false;
    for (const pa of ctx.paradas) {
      if (!pa.lugar) continue;
      const s = (e.paradas[pa.id] ??= { llegada: null, salida: null, dentroDesde: null, segundos: 0 });
      const ahoraDentro = dentro(distanciaKm(pt, pa.lugar), ctx.p.radioSedeM, s.dentroDesde !== null);
      if (ahoraDentro) {
        enSede = true;
        if (s.dentroDesde === null) { s.dentroDesde = pt.t; s.llegada ??= pt.t; paradasCambiadas.add(pa.id); }
      } else if (s.dentroDesde !== null) {
        s.salida = pt.t; s.segundos += Math.round((pt.t - s.dentroDesde) / 1000); s.dentroDesde = null; paradasCambiadas.add(pa.id);
      }
    }
    const enGeocerca = enSede || e.enPlanta === true;

    // 3) Kilómetros
    if (e.ultimo) {
      const d = distanciaKm(e.ultimo, pt), horas = (pt.t - e.ultimo.t) / 3_600_000;
      const temblor = d < 0.05 && (pt.vel ?? 0) < 3 && (e.ultimo.vel ?? 0) < 3;
      if (horas > 0 && !temblor && d / horas <= MAX_KMH) e.km += d;
    }
    e.ultimo = { t: pt.t, lat: pt.lat, lng: pt.lng, vel: pt.vel };

    // 4) Recorrido: un punto cada 30 segundos como máximo
    if (e.guardado === null || pt.t - e.guardado >= CADA_PUNTO_MS) { guardar.push(pt); e.guardado = pt.t; }

    // 5) Parada no programada (solo cuenta fuera de las geocercas)
    if (enGeocerca) { cerrar(e.ancla?.evento, pt.t); e.ancla = null; }
    else if ((pt.vel ?? 0) <= QUIETO_KMH) {
      if (!e.ancla || distanciaKm(e.ancla, pt) > RADIO_ANCLA_KM) { cerrar(e.ancla?.evento, pt.t); e.ancla = { lat: pt.lat, lng: pt.lng, t: pt.t, evento: null }; }
    } else if (e.ancla && distanciaKm(e.ancla, pt) > RADIO_ANCLA_KM) { cerrar(e.ancla.evento, pt.t); e.ancla = null; }
    abrirParada(pt.t);

    // 6) Desvío: lejos del trayecto previsto
    if (tray.length >= 2) {
      const d = distanciaTrayectoKm(pt, tray);
      if (d > ctx.p.kmDesvio && !enGeocerca) {
        if (!e.fuera) e.fuera = { lat: pt.lat, lng: pt.lng, t: pt.t, maxKm: d, evento: null };
        if (d > e.fuera.maxKm + 0.5 && e.fuera.evento) { e.fuera.evento.detalle = { ...e.fuera.evento.detalle, distanciaKm: redondear(d) }; tocados.add(e.fuera.evento); }
        e.fuera.maxKm = Math.max(e.fuera.maxKm, d);
        if (!e.fuera.evento && pt.t - e.fuera.t >= MINUTOS_DESVIO * 60_000) e.fuera.evento = nuevo('DESVIO', e.fuera, lleva(), { distanciaKm: redondear(e.fuera.maxKm) });
      } else if (e.fuera) {
        cerrar(e.fuera.evento, pt.t, { distanciaKm: redondear(e.fuera.maxKm) });
        e.fuera = null;
      }
    }
  }
  // Quieto sin mandar mensajes: la parada sigue contando hasta el final de la ventana
  if (e.ultimo && (e.ultimo.vel ?? 0) <= QUIETO_KMH) abrirParada(ahora);
  return { guardar, eventos: [...tocados], paradasCambiadas };
}

// ---------- Guardar y recuperar el estado (columna «estado» de rutas_gps) ----------
interface EstadoJson {
  enPlanta?: boolean | null; ultimo?: EstadoRecorrido['ultimo']; guardado?: number | null;
  ancla?: (Lugar & { t: number; eventoId: number | null }) | null;
  fuera?: (Lugar & { t: number; maxKm: number; eventoId: number | null }) | null;
}
export function estadoAJson(e: EstadoRecorrido): EstadoJson {
  return {
    enPlanta: e.enPlanta, ultimo: e.ultimo, guardado: e.guardado,
    ancla: e.ancla && { lat: e.ancla.lat, lng: e.ancla.lng, t: e.ancla.t, eventoId: e.ancla.evento?.id ?? null },
    fuera: e.fuera && { lat: e.fuera.lat, lng: e.fuera.lng, t: e.fuera.t, maxKm: e.fuera.maxKm, eventoId: e.fuera.evento?.id ?? null },
  };
}
export function estadoDeJson(j: unknown, c: { km: number; salidaPlanta: number | null; llegadaPlanta: number | null }, paradas: Record<string, EstadoParada>): EstadoRecorrido {
  const x = (j ?? {}) as EstadoJson;
  // Un evento abierto se recupera con lo mínimo para cerrarlo (la base guarda el resto)
  const abierto = (id: number | null | undefined, tipo: TipoEventoGps, l: Lugar & { t: number }): EventoGps | null =>
    (id ? { id, tipo, inicio: l.t, fin: null, lat: l.lat, lng: l.lng, conRespel: tipo === 'PARADA_NO_PROGRAMADA', detalle: {} } : null);
  return {
    enPlanta: x.enPlanta ?? null, salidaPlanta: c.salidaPlanta, llegadaPlanta: c.llegadaPlanta, km: c.km,
    ultimo: x.ultimo ?? null, guardado: x.guardado ?? null,
    ancla: x.ancla ? { lat: x.ancla.lat, lng: x.ancla.lng, t: x.ancla.t, evento: abierto(x.ancla.eventoId, 'PARADA_NO_PROGRAMADA', x.ancla) } : null,
    fuera: x.fuera ? { lat: x.fuera.lat, lng: x.fuera.lng, t: x.fuera.t, maxKm: x.fuera.maxKm, evento: abierto(x.fuera.eventoId, 'DESVIO', x.fuera) } : null,
    paradas,
  };
}
