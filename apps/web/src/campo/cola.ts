// Cola sin señal de la app de campo.
// Cada acción del conductor (inspección, etapa, fotos, manifiesto, GPS) se guarda primero en el
// teléfono (IndexedDB) y se envía en orden cuando hay conexión. Si el servidor la rechaza por una
// regla del negocio, queda «con error» a la vista del conductor, junto con las de su mismo grupo.
import { useEffect, useState } from 'react';
import { api, ErrorApi } from '../lib/api';

export interface Operacion {
  id?: number;
  grupo: string; // p. ej. «mf:<id>»: si una falla, las siguientes del grupo esperan
  descripcion: string;
  metodo: 'POST' | 'PATCH';
  ruta: string;
  cuerpo?: unknown;
  form?: { campos: Record<string, string>; archivo: Blob; nombre: string };
  creadoEn: string;
  intentos: number;
  error?: string;
}

const DB = 'terry-go-campo', STORE = 'cola';
let dbp: Promise<IDBDatabase> | null = null;
function abrir(): Promise<IDBDatabase> {
  dbp ??= new Promise((ok, mal) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true }); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => mal(r.error);
  });
  return dbp;
}
async function tx<T>(modo: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await abrir();
  return new Promise((ok, mal) => {
    const t = db.transaction(STORE, modo); const r = fn(t.objectStore(STORE));
    r.onsuccess = () => ok(r.result); r.onerror = () => mal(r.error);
  });
}

const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach((f) => f());

export async function listar(): Promise<Operacion[]> { return (await tx('readonly', (s) => s.getAll())) as Operacion[]; }
export async function encolar(op: Omit<Operacion, 'creadoEn' | 'intentos'>) {
  await tx('readwrite', (s) => s.add({ ...op, creadoEn: new Date().toISOString(), intentos: 0 }));
  avisar();
  void procesar();
}
export async function descartar(id: number) { await tx('readwrite', (s) => s.delete(id)); avisar(); }
export async function reintentar(id: number) {
  const op = (await tx('readonly', (s) => s.get(id))) as Operacion | undefined;
  if (op) { await tx('readwrite', (s) => s.put({ ...op, error: undefined })); avisar(); void procesar(); }
}

let enCurso: Promise<void> | null = null;
/** Envía la cola en orden. Se detiene si no hay conexión; marca con error lo que el servidor rechace. */
export function procesar(): Promise<void> {
  enCurso ??= (async () => {
    try {
      const ops = (await listar()).sort((a, b) => a.id! - b.id!);
      const bloqueados = new Set(ops.filter((o) => o.error).map((o) => o.grupo));
      for (const op of ops) {
        if (op.error || bloqueados.has(op.grupo)) continue;
        try {
          if (op.form) {
            const f = new FormData();
            Object.entries(op.form.campos).forEach(([k, v]) => f.append(k, v));
            f.append('archivo', op.form.archivo, op.form.nombre);
            await api(op.ruta, { metodo: op.metodo, form: f });
          } else {
            await api(op.ruta, { metodo: op.metodo, cuerpo: op.cuerpo ?? {} });
          }
          await tx('readwrite', (s) => s.delete(op.id!));
        } catch (e) {
          // Sin señal o servidor encendiéndose (la sesión sigue): se reintenta después, sin marcarlo como fallido
          if (e instanceof ErrorApi && [0, 502, 503, 504].includes(e.status)) return;
          const mensaje = e instanceof Error ? e.message : 'Error desconocido';
          await tx('readwrite', (s) => s.put({ ...op, intentos: op.intentos + 1, error: mensaje }));
          bloqueados.add(op.grupo);
        } finally { avisar(); }
      }
    } finally { setTimeout(() => { enCurso = null; }, 0); }
  })();
  return enCurso;
}

// Reintento automático: al volver la señal y cada 30 s
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { void procesar(); });
  setInterval(() => { if (navigator.onLine) void procesar(); }, 30_000);
}

/** Estado de la conexión y de la cola, para mostrarlo en la barra de la app. */
export function useCola() {
  const [ops, setOps] = useState<Operacion[]>([]);
  const [enLinea, setEnLinea] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const cargar = () => { listar().then(setOps).catch(() => setOps([])); };
    const on = () => setEnLinea(true), off = () => setEnLinea(false);
    oyentes.add(cargar); cargar();
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { oyentes.delete(cargar); window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return { ops, enLinea, pendientes: ops.filter((o) => !o.error).length, errores: ops.filter((o) => o.error) };
}

// ---------- Paquete del día (copia local para trabajar sin señal) ----------
const PAQUETE = 'terry-go-paquete';
export function leerPaquete<T>(): T | null { try { return JSON.parse(localStorage.getItem(PAQUETE) ?? 'null') as T | null; } catch { return null; } }
export function guardarPaquete<T>(p: T) { try { localStorage.setItem(PAQUETE, JSON.stringify(p)); } catch { /* sin espacio: se trabaja con lo que haya */ } }

// Borradores de manifiesto (texto y firma) mientras el conductor los diligencia
const BORRADOR = (id: string) => `terry-go-borrador-${id}`;
export function leerBorrador<T>(id: string): T | null { try { return JSON.parse(localStorage.getItem(BORRADOR(id)) ?? 'null') as T | null; } catch { return null; } }
export function guardarBorrador<T>(id: string, b: T) { try { localStorage.setItem(BORRADOR(id), JSON.stringify(b)); } catch { /* sin espacio */ } }
export function borrarBorrador(id: string) { try { localStorage.removeItem(BORRADOR(id)); } catch { /* nada */ } }
