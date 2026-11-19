import { useEffect, useState } from 'react';
// Cliente del API de Terra Viva.
// Modo real: defina VITE_API_URL (ej. http://localhost:3000/api/v1) en apps/web/.env
// Modo demostración: sin VITE_API_URL la app usa los datos de src/data/mock.ts.

export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
export const MODO_REAL = API_URL.length > 0;

export interface Sesion {
  accessToken: string; refreshToken: string; expiraEnSeg: number;
  usuario: { id: string; nombre: string; email: string; rol: string; permisos: string[]; empresa: { razonSocial: string; nit: string };
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
let renovando: Promise<boolean> | null = null;
const oyentes = new Set<(s: Sesion | null) => void>();

function guardar(s: Sesion | null) {
  sesion = s;
  try { s ? localStorage.setItem(CLAVE, JSON.stringify(s)) : localStorage.removeItem(CLAVE); } catch { /* sin almacenamiento */ }
  oyentes.forEach((f) => f(s));
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

async function renovar(): Promise<boolean> {
  if (!sesion) return false;
  renovando ??= (async () => {
    try {
      const r = await fetch(`${API_URL}/auth/renovar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: sesion!.refreshToken }) });
      if (!r.ok) { guardar(null); return false; }
      guardar(await r.json()); return true;
    } catch { return false; } finally { setTimeout(() => { renovando = null; }, 0); }
  })();
  return renovando;
}

/** Llamada autenticada. Si el token venció, lo renueva una vez y reintenta. */
export async function api<T = unknown>(ruta: string, opciones: { metodo?: string; cuerpo?: unknown; form?: FormData; blob?: boolean } = {}, reintento = true): Promise<T> {
  const headers: Record<string, string> = {};
  if (sesion) headers.authorization = `Bearer ${sesion.accessToken}`;
  if (opciones.cuerpo !== undefined) headers['content-type'] = 'application/json';
  let r: Response;
  try {
    r = await fetch(`${API_URL}${ruta}`, { method: opciones.metodo ?? (opciones.cuerpo || opciones.form ? 'POST' : 'GET'), headers, body: opciones.form ?? (opciones.cuerpo !== undefined ? JSON.stringify(opciones.cuerpo) : undefined) });
  } catch {
    throw new ErrorApi(0, 'No hay conexión con el servidor. Verifique que el API esté encendido y la dirección en VITE_API_URL.');
  }
  if (r.status === 401 && reintento && sesion && !ruta.startsWith('/auth/')) {
    if (await renovar()) return api<T>(ruta, opciones, false);
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
