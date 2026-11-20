// Mapa de la flota (Leaflet con los mapas de OpenStreetMap). Se carga aparte (lazy): las demás pantallas no lo descargan.
// En producción, con muchas personas mirando, conviene un proveedor de mapas propio: VITE_MAPA_TILES cambia la dirección.
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface CapasMapa {
  vehiculos?: { id: string; lat: number; lng: number; color: string; etiqueta: string; detalle?: string; viejo?: boolean }[];
  sitios?: { lat: number; lng: number; radioM?: number; etiqueta: string; tipo: 'planta' | 'sede' }[];
  recorrido?: [number, number][];
  eventos?: { lat: number; lng: number; etiqueta: string }[];
}

const TILES: string = import.meta.env.VITE_MAPA_TILES || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export default function Mapa({ capas, alto = 360, onVehiculo }: { capas: CapasMapa; alto?: number; onVehiculo?: (id: string) => void }) {
  const caja = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const grupo = useRef<L.LayerGroup | null>(null);
  const ajustado = useRef(0); // cuántos puntos había la última vez que se encuadró
  const tocado = useRef(false); // la persona ya movió o acercó el mapa
  const alClic = useRef(onVehiculo);
  alClic.current = onVehiculo;

  useEffect(() => {
    const div = caja.current;
    if (!div) return;
    const m = L.map(div, { scrollWheelZoom: false }).setView([7.1, -73.6], 7); // Magdalena Medio, mientras llegan los datos
    L.tileLayer(TILES, { maxZoom: 18, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>' }).addTo(m);
    grupo.current = L.layerGroup().addTo(m);
    mapa.current = m;
    m.on('focus', () => m.scrollWheelZoom.enable());
    m.on('blur', () => m.scrollWheelZoom.disable());
    const marcar = () => { tocado.current = true; };
    div.addEventListener('pointerdown', marcar);
    div.addEventListener('wheel', marcar, { passive: true });
    return () => {
      div.removeEventListener('pointerdown', marcar); div.removeEventListener('wheel', marcar);
      m.remove(); mapa.current = null; grupo.current = null; ajustado.current = 0; tocado.current = false;
    };
  }, []);

  useEffect(() => {
    const m = mapa.current, g = grupo.current;
    if (!m || !g) return;
    g.clearLayers();
    const puntos: L.LatLngExpression[] = [];
    for (const s of capas.sitios ?? []) {
      const color = s.tipo === 'planta' ? '#1E7838' : '#1E9BD7';
      if (s.radioM) L.circle([s.lat, s.lng], { radius: s.radioM, color, weight: 1, fillOpacity: 0.12 }).addTo(g);
      L.circleMarker([s.lat, s.lng], { radius: 5, color, weight: 2, fillColor: '#fff', fillOpacity: 1 }).bindTooltip(esc(s.etiqueta)).addTo(g);
      puntos.push([s.lat, s.lng]);
    }
    if (capas.recorrido && capas.recorrido.length > 1) {
      L.polyline(capas.recorrido, { color: '#2F49C9', weight: 3, opacity: 0.8 }).addTo(g);
      puntos.push(...capas.recorrido);
    }
    for (const e of capas.eventos ?? []) {
      L.circleMarker([e.lat, e.lng], { radius: 7, color: '#D92D20', weight: 2, fillColor: '#D92D20', fillOpacity: 0.35 }).bindTooltip(esc(e.etiqueta)).addTo(g);
      puntos.push([e.lat, e.lng]);
    }
    for (const v of capas.vehiculos ?? []) {
      const mk = L.circleMarker([v.lat, v.lng], { radius: 9, color: '#fff', weight: 2, fillColor: v.color, fillOpacity: v.viejo ? 0.45 : 1 })
        .bindTooltip(`<b>${esc(v.etiqueta)}</b>${v.detalle ? `<br>${esc(v.detalle)}` : ''}`, { permanent: true, direction: 'top', offset: [0, -8], opacity: v.viejo ? 0.7 : 0.95 })
        .addTo(g);
      if (alClic.current) mk.on('click', () => alClic.current?.(v.id));
      puntos.push([v.lat, v.lng]);
    }
    // Se encuadra al llegar los datos y cuando aparecen más (otra sede, otro vehículo), mientras la persona no haya movido
    // el mapa: después se respeta su acercamiento aunque las posiciones se actualicen
    if (puntos.length && (!ajustado.current || (!tocado.current && puntos.length > ajustado.current))) {
      m.fitBounds(L.latLngBounds(puntos), { padding: [30, 30], maxZoom: 14 });
      ajustado.current = puntos.length;
    }
  }, [capas]);

  return <div ref={caja} style={{ height: alto }} className="isolate z-0 w-full overflow-hidden rounded-xl border border-line" role="region" aria-label="Mapa" />;
}
