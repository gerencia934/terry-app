// Cola de trabajos en la web: los archivos pesados (ZIP de certificados, Excel) se piden, el servidor los prepara
// aparte y «Descargas» avisa cuando están listos. Lo que se pidió en esta pestaña se descarga solo al terminar.
// Los archivos guardados (PDF de actas, fotos, firmas) se abren con un enlace firmado de 5 minutos.
import { useEffect, useState } from 'react';
import { API_URL, api } from './api';

export interface Trabajo {
  id: string; tipo: string; titulo: string; estado: 'PENDIENTE' | 'EN_CURSO' | 'LISTO' | 'FALLIDO' | 'VENCIDO';
  error: string | null; nombre: string | null; bytes: number | null; creadoEn: string; terminadoEn: string | null; venceEn: string | null; descargadoEn: string | null;
}
export interface Enlace { url: string; vence: string }

/** El almacén local entrega enlaces relativos al API; S3, direcciones completas. */
export const urlAbsoluta = (url: string) => (url.startsWith('/') ? `${API_URL}${url}` : url);

let lista: Trabajo[] | null = null;
const pedidosAqui = new Set<string>();
const oyentes = new Set<(t: Trabajo[] | null) => void>();
const avisos = new Set<(t: Trabajo) => void>();
let reloj: ReturnType<typeof setTimeout> | null = null;
const avisar = () => oyentes.forEach((f) => f(lista));
export const enCola = (t: Trabajo) => t.estado === 'PENDIENTE' || t.estado === 'EN_CURSO';

/** Abre (o descarga) un enlace firmado sin salir de la página. */
export function abrirEnlace(url: string, nuevaPestana = false) {
  const a = document.createElement('a');
  a.href = urlAbsoluta(url); a.rel = 'noopener';
  if (nuevaPestana) a.target = '_blank';
  document.body.appendChild(a); a.click(); a.remove();
}

/** Descarga lo preparado: pide su enlace firmado (5 minutos). */
export async function descargarTrabajo(id: string) {
  const e = await api<Enlace>(`/trabajos/${id}/enlace`, { cuerpo: {} });
  abrirEnlace(e.url);
  if (lista) { lista = lista.map((t) => (t.id === id && !t.descargadoEn ? { ...t, descargadoEn: new Date().toISOString() } : t)); avisar(); }
}

async function refrescar() {
  reloj = null;
  try {
    const nueva = await api<Trabajo[]>('/trabajos');
    const antes = new Map((lista ?? []).map((t) => [t.id, t.estado]));
    lista = nueva; avisar();
    for (const t of nueva) {
      if (!pedidosAqui.has(t.id) || enCola(t) || antes.get(t.id) === t.estado) continue;
      pedidosAqui.delete(t.id);
      avisos.forEach((f) => f(t));
      if (t.estado === 'LISTO') descargarTrabajo(t.id).catch(() => undefined);
    }
  } catch { /* sin conexión: se reintenta */ }
  if (lista?.some(enCola)) programar(1500);
}
function programar(ms: number) { if (!reloj) reloj = setTimeout(refrescar, ms); }

/** Pide preparar un archivo (ZIP, Excel). Se descarga solo cuando esté listo si la página sigue abierta. */
export async function pedirArchivo(ruta: string, cuerpo: unknown = {}) {
  const t = await api<Trabajo>(ruta, { cuerpo });
  pedidosAqui.add(t.id);
  lista = [t, ...(lista ?? []).filter((x) => x.id !== t.id)]; avisar();
  programar(800);
  return t;
}

/** «Mis descargas» como estado de React; `alTerminar` avisa lo que se pidió en esta pestaña. */
export function useTrabajos(alTerminar?: (t: Trabajo) => void) {
  const [t, setT] = useState(lista);
  useEffect(() => {
    oyentes.add(setT);
    if (lista === null) refrescar(); else if (lista.some(enCola)) programar(800);
    return () => { oyentes.delete(setT); };
  }, []);
  useEffect(() => {
    if (!alTerminar) return;
    avisos.add(alTerminar);
    return () => { avisos.delete(alTerminar); };
  }, [alTerminar]);
  return { trabajos: t, recargar: refrescar };
}

/** PDF guardado (acta): enlace firmado. La pestaña se abre antes de esperar para que el navegador no la bloquee. */
export async function abrirPdfGuardado(rutaEnlace: string, descargar = false) {
  if (descargar) { abrirEnlace((await api<Enlace>(rutaEnlace, { cuerpo: { descargar: true } })).url); return; }
  const w = window.open('', '_blank');
  try {
    const e = await api<Enlace>(rutaEnlace, { cuerpo: { descargar: false } });
    if (w) w.location.href = urlAbsoluta(e.url); else abrirEnlace(e.url, true);
  } catch (x) { w?.close(); throw x; }
}

/** Archivo guardado (foto, firma, PDF de evidencia): enlace firmado de 5 minutos. */
export const enlaceArchivo = (clave: string, o: { nombre?: string; adjunto?: boolean } = {}) =>
  api<Enlace>(`/archivos/enlace?${new URLSearchParams({ clave, ...(o.nombre ? { nombre: o.nombre } : {}), ...(o.adjunto ? { adjunto: 'true' } : {}) })}`);
export async function abrirArchivo(clave: string, nombre?: string) {
  const w = window.open('', '_blank');
  try { const e = await enlaceArchivo(clave, { nombre }); if (w) w.location.href = urlAbsoluta(e.url); else abrirEnlace(e.url, true); }
  catch (x) { w?.close(); throw x; }
}
