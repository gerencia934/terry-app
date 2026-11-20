import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { cx } from '../lib/format';

// Carrusel del inicio de sesión, el mismo de Terry-App Mantenimiento: los banners se leen de public/carrusel/carrusel.json
// (texto, imagen, color de fondo y fechas). Para cambiarlos no hay que tocar el código: se reemplaza la imagen y se edita
// ese archivo. Si no se puede leer (sin señal), quedan los banners de siempre.
export interface Banner { etiqueta?: string; titulo: string; texto?: string; imagen?: string; fondo?: string; enlace?: string; desde?: string; hasta?: string }
interface Config { segundos?: number; banners?: Banner[] }

const BASICOS: Banner[] = [
  { etiqueta: 'Bienvenido', titulo: 'Terry-App, toda la operación en un solo lugar', texto: 'Mantenimiento, residuos y gestión comercial de Terra Viva con trazabilidad de principio a fin.', imagen: 'terry-app.webp', fondo: '#1F5E3B' },
  { etiqueta: 'Terra Viva', titulo: 'Soluciones ambientales inteligentes', texto: 'Sostenibilidad, transparencia, innovación y responsabilidad ambiental en cada servicio.', fondo: '#1F4E5F' },
];
const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** Solo los banners vigentes hoy (desde / hasta incluidos) y con título. */
export const vigentes = (bs: Banner[], dia = hoy()) => bs.filter((b) => b?.titulo && (!b.desde || b.desde <= dia) && (!b.hasta || b.hasta >= dia));
const colorValido = (c?: string) => (c && /^#[0-9a-f]{3,8}$/i.test(c) ? c : '#1F5E3B');
const enlaceValido = (u?: string) => (u && /^https?:\/\//i.test(u) ? u : undefined);

export function Carrusel({ className }: { className?: string }) {
  const [banners, setBanners] = useState<Banner[]>(BASICOS);
  const [segundos, setSegundos] = useState(8);
  const [i, setI] = useState(0);
  const [pausado, setPausado] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [encima, setEncima] = useState(false);
  const raiz = useRef<HTMLElement>(null);

  useEffect(() => {
    let vivo = true;
    fetch('./carrusel/carrusel.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((c: Config) => {
        if (!vivo) return;
        const bs = vigentes(Array.isArray(c.banners) ? c.banners : []);
        if (bs.length) setBanners(bs);
        if (Number.isFinite(c.segundos)) setSegundos(Math.min(30, Math.max(3, Number(c.segundos))));
      })
      .catch(() => undefined);
    return () => { vivo = false; };
  }, []);

  const n = banners.length;
  const actual = useMemo(() => banners[Math.min(i, n - 1)] ?? BASICOS[0], [banners, i, n]);
  const ir = (k: number) => setI(((k % n) + n) % n);
  useEffect(() => {
    if (pausado || encima || n < 2) return;
    const t = setTimeout(() => setI((x) => (x + 1) % n), segundos * 1000);
    return () => clearTimeout(t);
  }, [i, pausado, encima, n, segundos]);

  const fondo = colorValido(actual.fondo);
  return (
    <section ref={raiz} aria-roledescription="carrusel" aria-label="Información de Terra Viva"
      onMouseEnter={() => setEncima(true)} onMouseLeave={() => setEncima(false)}
      onFocus={() => setEncima(true)} onBlur={(e) => { if (!raiz.current?.contains(e.relatedTarget as Node)) setEncima(false); }}
      className={cx('relative min-h-full flex-col overflow-hidden text-white transition-colors duration-500 motion-reduce:transition-none', className)} style={{ background: fondo }}>
      <p className="relative z-10 px-12 pt-10 text-[12px] font-semibold text-white/80">Terra Viva S.A.S. E.S.P.</p>
      {banners.map((b, k) => (
        <div key={`${b.titulo}-${k}`} role="group" aria-roledescription="diapositiva" aria-label={`${k + 1} de ${n}`} aria-hidden={k !== i}
          className={cx('absolute inset-0 flex transition-opacity duration-700 motion-reduce:transition-none', k === i ? 'opacity-100' : 'pointer-events-none opacity-0')}>
          <div className="relative z-10 flex w-[52%] flex-col justify-center pb-24 pl-12 pr-4">
            {b.etiqueta && <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-brand-mint">{b.etiqueta}</p>}
            <h2 className="mt-3 font-display text-[clamp(28px,3vw,40px)] font-extrabold leading-[1.12]">
              {enlaceValido(b.enlace) ? <a href={enlaceValido(b.enlace)} target="_blank" rel="noopener noreferrer" className="hover:underline" tabIndex={k === i ? 0 : -1}>{b.titulo}</a> : b.titulo}
            </h2>
            {b.texto && <p className="mt-4 max-w-[34ch] text-[15px] leading-relaxed text-white/85">{b.texto}</p>}
          </div>
          {b.imagen && (
            <img src={`./carrusel/${encodeURIComponent(b.imagen)}`} alt="" loading={k === 0 ? 'eager' : 'lazy'} decoding="async"
              className="absolute bottom-0 right-0 h-[88%] max-h-[900px] w-auto max-w-[62%] object-contain object-bottom" />
          )}
        </div>
      ))}
      {n > 1 && (
        <div className="absolute bottom-8 left-12 z-20 flex items-center gap-3">
          <button type="button" onClick={() => ir(i - 1)} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 hover:bg-white/25" aria-label="Banner anterior"><ChevronLeft size={18} /></button>
          <div className="flex items-center gap-1.5">
            {banners.map((b, k) => (
              <button key={k} type="button" onClick={() => ir(k)} aria-label={`Ver banner ${k + 1}: ${b.titulo}`} aria-current={k === i}
                className={cx('h-2 rounded-full transition-all motion-reduce:transition-none', k === i ? 'w-6 bg-brand-mint' : 'w-2 bg-white/50 hover:bg-white/80')} />
            ))}
          </div>
          <button type="button" onClick={() => ir(i + 1)} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 hover:bg-white/25" aria-label="Banner siguiente"><ChevronRight size={18} /></button>
          <button type="button" onClick={() => setPausado((p) => !p)} className="ml-1 flex h-9 w-9 items-center justify-center rounded-full bg-white/15 hover:bg-white/25" aria-label={pausado ? 'Reanudar el carrusel' : 'Pausar el carrusel'}>
            {pausado ? <Play size={15} /> : <Pause size={15} />}
          </button>
        </div>
      )}
      <p className="sr-only" aria-live={pausado ? 'polite' : 'off'}>{actual.titulo}</p>
    </section>
  );
}
