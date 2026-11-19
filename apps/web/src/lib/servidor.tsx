// Utilidades de las pantallas de oficina conectadas al API (torre de control).
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ErrorApi } from './api';
import { enlaceArchivo, urlAbsoluta } from './trabajos';
import { cx } from './format';
import { Button } from '../components/ui';

/** Mensaje legible de un error del API. */
export const msg = (e: unknown, def = 'No se pudo completar.') => (e instanceof ErrorApi ? e.message : def);

/** Carga un recurso del API (o nada si la ruta es null) y permite recargarlo. Ignora respuestas viejas. */
export function useApi<T>(ruta: string | null) {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const turno = useRef(0);
  const recargar = useCallback(async () => {
    if (!ruta) { setDatos(null); return; }
    const t = ++turno.current;
    setCargando(true); setError('');
    try { const d = await api<T>(ruta); if (t === turno.current) setDatos(d); }
    catch (e) { if (t === turno.current) setError(msg(e, 'No se pudo cargar.')); }
    finally { if (t === turno.current) setCargando(false); }
  }, [ruta]);
  useEffect(() => { recargar(); }, [recargar]);
  return { datos, error, cargando, recargar, setDatos };
}

/** Descarga un archivo protegido del API (PDF, Excel, ZIP) con la sesión actual. */
export async function bajarArchivo(ruta: string, nombre: string) {
  const blob = await api<Blob>(ruta, { blob: true });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = nombre; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
}

/** Abre un PDF protegido en otra pestaña. La pestaña se abre antes de esperar para que el navegador no la bloquee. */
export async function verPdf(ruta: string) {
  const w = window.open('', '_blank');
  try {
    const blob = await api<Blob>(ruta, { blob: true });
    const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
    if (w) w.location.href = url; else window.location.assign(url);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) { w?.close(); throw e; }
}

/** Dirección de un archivo guardado (foto, firma): enlace firmado de 5 minutos; la imagen se carga directo de ahí. */
export function useArchivoUrl(clave: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!clave) return;
    let vivo = true;
    enlaceArchivo(clave).then((e) => { if (vivo) setUrl(urlAbsoluta(e.url)); }).catch(() => undefined);
    return () => { vivo = false; };
  }, [clave]);
  return url;
}
export function ImagenProtegida({ clave, alt, className }: { clave: string; alt: string; className?: string }) {
  const url = useArchivoUrl(clave);
  return url ? <img src={url} alt={alt} className={className} /> : <div className={cx('animate-pulse rounded-lg bg-surface-2', className)} aria-label={`Cargando ${alt}`} />;
}

// ---------- Fechas (siempre en hora de Colombia) ----------
export const hoyCo = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
export const sumarDias = (iso: string, n: number) => { const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const finDeMes = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
export const horaCo = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hour12: false }) : '—');
export const fechaHoraCo = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—');
/** Columna TIME de la base («1970-01-01T07:30:00.000Z») → «07:30». */
export const horaColumna = (iso: string | null | undefined) => (iso ? iso.slice(11, 16) : '');

/** Número con hasta 2 decimales, o «—». */
export const cant = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('es-CO', { maximumFractionDigits: 2 }));

/**
 * Listado por páginas con «Cargar más» (requisitos de producción §1: ningún listado pide todo de una vez).
 * `ruta` sin `pagina` ni `porPagina`; el API responde { total, filas }.
 */
export function usePaginado<T>(ruta: string | null, porPagina = 50) {
  const [filas, setFilas] = useState<T[] | null>(null);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const turno = useRef(0);
  const pedir = useCallback(async (p: number, agregar: boolean) => {
    if (!ruta) { setFilas(null); return; }
    const t = ++turno.current;
    setCargando(true); setError('');
    try {
      const r = await api<{ total: number; filas: T[] }>(`${ruta}${ruta.includes('?') ? '&' : '?'}pagina=${p}&porPagina=${porPagina}`);
      if (t !== turno.current) return;
      setTotal(r.total); setPagina(p); setFilas((f) => (agregar && f ? [...f, ...r.filas] : r.filas));
    } catch (e) { if (t === turno.current) setError(msg(e, 'No se pudo cargar.')); }
    finally { if (t === turno.current) setCargando(false); }
  }, [ruta, porPagina]);
  useEffect(() => { pedir(1, false); }, [pedir]);
  const recargar = useCallback(() => pedir(1, false), [pedir]);
  return { filas, total, error, cargando, hayMas: !!filas && filas.length < total, cargarMas: () => pedir(pagina + 1, true), recargar };
}

export function PieLista({ mostradas, total, hayMas, cargando, cargarMas }: { mostradas: number; total: number; hayMas: boolean; cargando: boolean; cargarMas: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted">
      <span>Mostrando <b className="num text-fg">{mostradas}</b> de <b className="num text-fg">{total}</b></span>
      {hayMas && <Button size="sm" disabled={cargando} onClick={cargarMas}>{cargando ? 'Cargando…' : 'Cargar más'}</Button>}
    </div>
  );
}
