// GPS de la flota (Wialon): tipos del API, textos y piezas que comparten Seguimiento, el detalle de la ruta y Flota.
import { Suspense, lazy, useState } from 'react';
import { CheckCircle2, MapPin } from 'lucide-react';
import { Badge, Button, Input, useToast } from './ui';
import { api, tienePermiso } from '../lib/api';
import { fechaHoraCo, horaCo, msg } from '../lib/servidor';
import type { CapasMapa } from './Mapa';

export interface PosicionGps { lat: number; lng: number; velocidad: number | null; rumbo: number | null; posicionEn: string }
export interface EventoGpsApi {
  id: number; tipo: 'PARADA_NO_PROGRAMADA' | 'DESVIO'; inicio: string; fin: string | null; lat: number; lng: number; conRespel: boolean;
  minutos: number; distanciaKm: number | null; revisadoEn: string | null; nota: string | null; revisadoPor: string | null;
}
export interface ParadaGpsApi { llegada: string | null; salida: string | null; enSitio: boolean; minutos: number }
export interface RutaGpsApi {
  km: number | null; puntos: number; salidaPlanta: string | null; llegadaPlanta: string | null; procesadoHasta: string | null; cerrada: boolean;
  paradas: Record<string, ParadaGpsApi>; eventos: EventoGpsApi[];
}
export interface PlantaGps { lat: number; lng: number; radioM: number }
export interface SeguimientoGps {
  configurado: boolean; ultimoOk: string | null; error: string | null; planta: PlantaGps | null; radioSedeM: number;
  vehiculos: ({ id: string; placa: string; color: string } & PosicionGps)[]; rutas: Record<string, RutaGpsApi>;
}
export interface RutaGpsDetalle extends RutaGpsApi {
  configurado: boolean; vehiculoEnlazado: boolean; posicion: PosicionGps | null; planta: PlantaGps | null; radioSedeM: number;
  sitios: { paradaId: string; orden: number; nombre: string; lat: number | null; lng: number | null }[];
}
export interface EstadoGps {
  configurado: boolean; conectado: boolean; intervaloS: number; ultimoOk: string | null; ultimoIntento: string | null; error: string | null; fallosSeguidos: number;
  unidades: { id: number; nombre: string; posicionEn: string | null }[];
  vehiculos: { id: string; placa: string; color: string; activo: boolean; unidadId: number | null; unidadNombre: string | null; posicion: PosicionGps | null }[];
  geocercas: { planta: { lat: number; lng: number } | null; radioPlantaM: number; radioSedeM: number; minutosParada: number; kmDesvio: number };
}

/** «hace 3 min», «hace 2 h 10 min», «hace 3 días». */
export function hace(iso: string | null | undefined) {
  if (!iso) return '—';
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return 'hace menos de 1 min';
  if (min < 60) return `hace ${min} min`;
  if (min < 48 * 60) return `hace ${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
  return `hace ${Math.floor(min / 1440)} días`;
}
/** Una posición de hace más de 30 minutos ya no es «en vivo». */
export const posicionVieja = (iso: string) => Date.now() - new Date(iso).getTime() > 30 * 60_000;
export const kmTexto = (km: number) => km.toLocaleString('es-CO', { maximumFractionDigits: 1 });
export const enlaceMapa = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`;

export function textoEvento(e: EventoGpsApi) {
  const respel = e.conRespel ? ' con RESPEL' : '';
  return e.tipo === 'PARADA_NO_PROGRAMADA'
    ? `${e.fin ? 'Estuvo' : 'Lleva'} ${e.minutos} min detenido fuera de ruta${respel}`
    : `${e.fin ? 'Se desvió' : 'Va desviado'}${e.distanciaKm ? ` ${kmTexto(e.distanciaKm)} km` : ''} de su ruta${respel}${e.fin ? ` (${e.minutos} min)` : ''}`;
}

const MapaPerezoso = lazy(() => import('./Mapa'));
/** El mapa se descarga solo cuando se muestra. */
export function MapaGps(p: { capas: CapasMapa; alto?: number; onVehiculo?: (id: string) => void }) {
  return (
    <Suspense fallback={<div style={{ height: p.alto ?? 360 }} className="grid w-full place-items-center rounded-xl border border-line bg-surface-2 text-[13px] text-muted">Cargando el mapa…</div>}>
      <MapaPerezoso {...p} />
    </Suspense>
  );
}

/** Un evento del GPS con su revisión: quien programa deja la explicación (queda quién y cuándo; no se cambia). */
export function EventoGpsFila({ e, placa, ruta, onRevisado }: { e: EventoGpsApi; placa?: string; ruta?: string; onRevisado: () => void }) {
  const toast = useToast();
  const [nota, setNota] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const revisar = async () => {
    setEnviando(true);
    try { await api(`/gps/eventos/${e.id}`, { metodo: 'PATCH', cuerpo: { nota } }); toast('Evento revisado.'); setAbierto(false); onRevisado(); }
    catch (x) { toast(msg(x), 'warn'); }
    setEnviando(false);
  };
  const urgente = !e.fin && !e.revisadoEn;
  return (
    <div className={`rounded-lg border p-3 text-[13px] ${urgente ? 'border-bad/40 bg-bad/5' : 'border-line'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{placa ? <span className="num">{placa} · </span> : null}{textoEvento(e)}</p>
          <p className="text-muted">{ruta ? `Ruta ${ruta} · ` : ''}desde {fechaHoraCo(e.inicio)}{e.fin ? ` hasta las ${horaCo(e.fin)}` : ''} ·{' '}
            <a className="text-brand underline" target="_blank" rel="noreferrer" href={enlaceMapa(e.lat, e.lng)}>ver el lugar</a></p>
        </div>
        {e.revisadoEn ? <Badge tone="ok"><CheckCircle2 size={12} /> Revisado</Badge> : <Badge tone={urgente ? 'bad' : 'warn'}>{urgente ? 'En curso' : 'Por revisar'}</Badge>}
      </div>
      {e.revisadoEn && <p className="mt-1.5 text-muted">«{e.nota}» — {e.revisadoPor ?? 'Oficina'}, {fechaHoraCo(e.revisadoEn)}</p>}
      {!e.revisadoEn && tienePermiso('rutas.programar') && (abierto
        ? <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Input value={nota} onChange={(x) => setNota(x.target.value)} maxLength={300} placeholder="Qué pasó: tanqueo autorizado, trancón, desvío por cierre de vía…" aria-label="Explicación del evento" />
            <Button size="sm" variant="primary" disabled={enviando || nota.trim().length < 3} onClick={revisar}>Marcar revisado</Button>
          </div>
        : <Button size="sm" className="mt-2" onClick={() => setAbierto(true)}>Revisar y explicar</Button>)}
    </div>
  );
}

/** Línea corta de la posición de un vehículo: hora, velocidad y (fuera de un botón) enlace al mapa. */
export function PosicionLinea({ p, enlace = true }: { p: PosicionGps; enlace?: boolean }) {
  return (
    <span className={posicionVieja(p.posicionEn) ? 'text-warn' : ''}>
      <MapPin size={13} className="mr-0.5 inline -translate-y-px" />GPS {hace(p.posicionEn)}
      {p.velocidad !== null && <> · {p.velocidad > 3 ? `${Math.round(p.velocidad)} km/h` : 'detenido'}</>}
      {enlace && <> · <a className="text-brand underline" target="_blank" rel="noreferrer" href={enlaceMapa(p.lat, p.lng)}>mapa</a></>}
    </span>
  );
}
