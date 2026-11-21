import { useEffect, useState } from 'react';
// Cliente del API de Terra Viva.
// Modo real: defina VITE_API_URL (ej. http://localhost:3000/api/v1) en apps/web/.env
// Modo demostración: sin VITE_API_URL la app usa los datos de src/data/mock.ts.

export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
export const MODO_REAL = API_URL.length > 0;

export interface Sesion {
  accessToken: string; refreshToken: string; expiraEnSeg: number;
  usuario: { id: string; nombre: string; email: string; rol: string; permisos: string[]; empresa: { razonSocial: string; nit: string };
    /** Módulo del usuario según el acceso de su rol: administrador (oficina), app del conductor (campo) o portal de clientes. */
    acceso?: 'OFICINA' | 'CAMPO' | 'CLIENTE';
    /** Ley 1581: falta aceptar la versión vigente de la política de tratamiento de datos. */
    requiereAceptarDatos?: boolean; politicaDatos?: { version: string; url: string | null };
    /** Usuario del portal de clientes: su empresa y su perfil (administrador o consulta). La oficina no lo trae. */
    cliente?: { id: string; razonSocial: string; nit: string }; perfilPortal?: 'ADMIN' | 'CONSULTA' | null;
    /** Verificación en dos pasos obligatoria y aún sin configurar: la app muestra la pantalla para configurarla. */
    requiereConfigurar2fa?: boolean; dobleFactor?: { activo: boolean; obligatorio: boolean } };
}
/** Con la verificación en dos pasos activa, la contraseña sola no abre sesión: falta el código de la app. */
export interface Desafio2fa { requiere2fa: true; desafio: string }
export class ErrorApi extends Error {
  constructor(public status: number, mensaje: string, public datos?: unknown) { super(mensaje); }
}

const CLAVE = 'tv-sesion';
let sesion: Sesion | null = (() => { try { return JSON.parse(localStorage.getItem(CLAVE) ?? 'null'); } catch { return null; } })();
type Renovacion = 'ok' | 'cerrada' | 'sin-red';
let renovando: Promise<Renovacion> | null = null;
const oyentes = new Set<(s: Sesion | null) => void>();

function guardar(s: Sesion | null) {
  sesion = s;
  try { s ? localStorage.setItem(CLAVE, JSON.stringify(s)) : localStorage.removeItem(CLAVE); } catch { /* sin almacenamiento */ }
  oyentes.forEach((f) => f(s));
}
// Varias pestañas comparten la misma sesión (localStorage). Si otra pestaña entra (también desde el portal), renueva o sale,
// esta se entera al instante: así nunca presenta un token que otra ya cambió (el servidor lo tomaría por un robo).
const leerGuardada = (): Sesion | null => { try { return JSON.parse(localStorage.getItem(CLAVE) ?? 'null'); } catch { return null; } };
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== CLAVE && e.key !== null) return;
    sesion = leerGuardada();
    oyentes.forEach((f) => f(sesion));
  });
}
export const sesionActual = () => sesion;
export const alCambiarSesion = (f: (s: Sesion | null) => void) => { oyentes.add(f); return () => oyentes.delete(f); };
/** La sesión actual como estado de React (cambia al entrar, salir, renovar o aceptar la política de datos). */
export function useSesion() {
  const [s, setS] = useState<Sesion | null>(sesion);
  useEffect(() => { const quitar = alCambiarSesion(setS); return () => { quitar(); }; }, []);
  return s;
}
export const tienePermiso = (p: string) => !!sesion && (sesion.usuario.permisos.includes('*') || sesion.usuario.permisos.includes(p));
/**
 * Módulo al que entra una sesión: portal de clientes, app del conductor (campo) o administrador. Las sesiones guardadas
 * antes de que el servidor enviara el acceso se reconocen por el rol.
 */
export const moduloDe = (s: Sesion | null): 'CLIENTE' | 'CAMPO' | 'OFICINA' =>
  !s ? 'OFICINA' : s.usuario.cliente ? 'CLIENTE' : s.usuario.acceso ?? (s.usuario.rol === 'Conductor' || s.usuario.rol === 'Auxiliar' ? 'CAMPO' : 'OFICINA');

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** ¿Otra pestaña ya renovó o entró de nuevo? Entonces se usa su sesión en lugar de gastar un token ya cambiado. */
function adoptarDeOtraPestana(): boolean {
  const otra = leerGuardada();
  if (!otra || !sesion || otra.refreshToken === sesion.refreshToken) return false;
  sesion = otra; oyentes.forEach((f) => f(otra));
  return true;
}

/**
 * Renueva el token de acceso (estándar 1 del ERP Terry-App, igual que Mantenimiento). La sesión SOLO se cierra cuando el
 * servidor confirma que ya no es válida (la persona salió, cambió la clave o un administrador la cerró). Si el servidor
 * se está encendiendo, no hay señal o la respuesta se pierde, la sesión se conserva y se reintenta: el servidor recupera
 * la renovación perdida. Las pestañas renuevan por turnos (Web Locks) para no gastar el mismo token dos veces.
 */
function renovar(): Promise<Renovacion> {
  if (!sesion) return Promise.resolve('cerrada');
  renovando ??= (async (): Promise<Renovacion> => {
    const tarea = async (): Promise<Renovacion> => {
      if (adoptarDeOtraPestana()) return 'ok';
      for (const pausa of [0, 1500, 4000, 8000]) {
        if (pausa) await esperar(pausa);
        if (!sesion) return 'cerrada';
        let r: Response;
        try { r = await fetch(`${API_URL}/auth/renovar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: sesion.refreshToken }) }); }
        catch { continue; } // sin señal: se reintenta
        if (r.ok) { guardar(await r.json()); return 'ok'; }
        if (r.status !== 401) continue; // servidor encendiéndose (503) u otro error pasajero: la sesión sigue
        const d = (await r.json().catch(() => ({}))) as { codigo?: string };
        if (adoptarDeOtraPestana()) return 'ok';
        // Otra pestaña acaba de renovar: se espera a que guarde su sesión y se usa esa
        if (d.codigo === 'YA_RENOVADA') { await esperar(1500); return adoptarDeOtraPestana() ? 'ok' : 'sin-red'; }
        guardar(null);
        return 'cerrada';
      }
      return 'sin-red';
    };
    try {
      // Una sola pestaña renueva a la vez (Web Locks); las demás esperan y toman la sesión nueva
      const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
      return locks ? await locks.request('tv-renovar-sesion', tarea) : await tarea();
    } catch { return 'sin-red'; } finally { setTimeout(() => { renovando = null; }, 0); }
  })();
  return renovando;
}

/** Segundos que le quedan al token de acceso (se leen del propio JWT). */
function segundosRestantes(): number {
  try {
    const p = JSON.parse(atob(sesion!.accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    return (p.exp ?? 0) - Date.now() / 1000;
  } catch { return 0; }
}

/**
 * Renueva antes de que el token venza: cada minuto con la app a la vista, al volver a ella (celular en segundo plano),
 * al recuperar la señal y al enfocar la ventana. Así nunca aparece «sesión vencida» por haber dejado la app quieta.
 */
function mantenerSesionViva() {
  const revisar = () => {
    if (!sesion || renovando || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    if (segundosRestantes() < 240) void renovar();
  };
  setInterval(() => { if (document.visibilityState === 'visible') revisar(); }, 60_000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') revisar(); });
  window.addEventListener('online', revisar);
  window.addEventListener('focus', revisar);
  revisar();
}
if (MODO_REAL && typeof window !== 'undefined') mantenerSesionViva();

export const RECONECTANDO = 'Reconectando con el servidor… Su sesión sigue abierta; intente de nuevo en unos segundos.';

/** Llamada autenticada. Si el token venció, lo renueva una vez y reintenta. */
export async function api<T = unknown>(ruta: string, opciones: { metodo?: string; cuerpo?: unknown; form?: FormData; blob?: boolean } = {}, reintento = true): Promise<T> {
  const headers: Record<string, string> = {};
  if (sesion) headers.authorization = `Bearer ${sesion.accessToken}`;
  if (opciones.cuerpo !== undefined) headers['content-type'] = 'application/json';
  let r: Response;
  try {
    r = await fetch(`${API_URL}${ruta}`, { method: opciones.metodo ?? (opciones.cuerpo || opciones.form ? 'POST' : 'GET'), headers, body: opciones.form ?? (opciones.cuerpo !== undefined ? JSON.stringify(opciones.cuerpo) : undefined) });
  } catch {
    throw new ErrorApi(0, 'Sin conexión con el servidor. Revise la señal: su sesión sigue abierta.');
  }
  if (r.status === 401 && reintento && sesion && !ruta.startsWith('/auth/')) {
    const res = await renovar();
    if (res === 'ok') return api<T>(ruta, opciones, false);
    if (res === 'sin-red') throw new ErrorApi(503, RECONECTANDO);
  }
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    // Sesión de antes de aceptar la política de datos: la app muestra la pantalla para aceptarla
    if (r.status === 403 && (d as { codigo?: string }).codigo === 'ACEPTAR_DATOS' && sesion && !sesion.usuario.requiereAceptarDatos)
      guardar({ ...sesion, usuario: { ...sesion.usuario, requiereAceptarDatos: true } });
    // Verificación en dos pasos obligatoria sin configurar: la app muestra la pantalla para configurarla
    if (r.status === 403 && (d as { codigo?: string }).codigo === 'CONFIGURAR_2FA' && sesion && !sesion.usuario.requiereConfigurar2fa)
      guardar({ ...sesion, usuario: { ...sesion.usuario, requiereConfigurar2fa: true } });
    throw new ErrorApi(r.status, (d as { mensaje?: string }).mensaje ?? `Error ${r.status}`, d);
  }
  if (opciones.blob) return (await r.blob()) as T;
  if (r.status === 204) return undefined as T;
  return r.json() as Promise<T>;
}

/** Primer paso del ingreso. Si la cuenta tiene verificación en dos pasos, devuelve el desafío para pedir el código. */
export async function ingresar(email: string, clave: string): Promise<Sesion | Desafio2fa> {
  const r = await api<Sesion | Desafio2fa>('/auth/login', { cuerpo: { email, clave } });
  if ('requiere2fa' in r) return r;
  guardar(r);
  return r;
}
/** Dirección del portal Terry-App (entrada única del ecosistema; docs/ECOSISTEMA.md). Vacía: sin portal. */
export const PORTAL_URL: string = (import.meta.env.VITE_PORTAL_URL as string | undefined)?.replace(/\/$/, '') ?? '';
// Pase del portal («…/#sso=…»): se lee una sola vez al abrir la app y se quita de la barra de direcciones antes de que el
// enrutador la lea (no queda en el historial ni se comparte por error al copiar la dirección).
const paseInicial = (() => {
  if (typeof location === 'undefined') return '';
  const m = location.hash.match(/^#sso=([A-Za-z0-9_.-]{40,4000})$/);
  if (!m) return '';
  history.replaceState(null, '', `${location.pathname}${location.search}#inicio`);
  return m[1];
})();
export const paseDelPortal = () => paseInicial;
/** Entrada única: cambia el pase del portal por una sesión de Residuos (si había otra sesión en este equipo, la cierra). */
export async function ingresarConPortal(pase: string) {
  const anterior = sesion;
  const nueva = await api<Sesion>('/auth/portal', { cuerpo: { pase } });
  guardar(nueva);
  if (anterior && anterior.refreshToken !== nueva.refreshToken) void api('/auth/salir', { cuerpo: { refreshToken: anterior.refreshToken } }).catch(() => undefined);
  return nueva;
}
/** Segundo paso: el código de la app de autenticación (o uno de respaldo). */
export async function verificarDobleFactor(desafio: string, codigo: string) {
  guardar(await api<Sesion>('/auth/2fa/verificar', { cuerpo: { desafio, codigo } }));
  return sesion!;
}
/** Reemplaza la sesión (por ejemplo, la nueva que entrega el servidor al activar la verificación en dos pasos). */
export const reemplazarSesion = (s: Sesion) => guardar(s);
/** Ley 1581: acepta la versión vigente de la política de datos; el servidor entrega una sesión nueva. */
export async function aceptarPoliticaDatos() {
  if (!sesion) return;
  guardar(await api<Sesion>('/auth/aceptar-datos', { cuerpo: { version: sesion.usuario.politicaDatos?.version ?? '' } }));
}
/** Cierra la sesión en todos los dispositivos (por ejemplo, si se perdió el celular). */
export async function salirDeTodos() {
  await api('/auth/salir-todos', { cuerpo: {} }).catch(() => undefined);
  guardar(null);
}

export async function salir() {
  const s = sesion;
  guardar(null);
  if (s) await api('/auth/salir', { cuerpo: { refreshToken: s.refreshToken } }).catch(() => undefined);
}
