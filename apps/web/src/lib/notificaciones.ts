// Notificaciones push en la web y en el celular (app instalada): pedir permiso, suscribir este equipo y apagarlas.
// El aviso lo muestra el service worker (public/sw.js), aunque la app esté cerrada. En iPhone solo funcionan con la app
// agregada a la pantalla de inicio (iOS 16.4 o más reciente).
import { api } from './api';

export interface ConfigPush { activo: boolean; clavePublica: string | null; suscripciones: number }
export type EstadoPush = 'no-soportado' | 'requiere-instalar' | 'bloqueado' | 'pendiente' | 'activo' | 'inactivo';

const esIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const instalada = () => matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
export const pushSoportado = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** Clave VAPID (base64url) → bytes, como la pide el navegador. */
function bytesClave(base64: string) {
  const relleno = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + relleno).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registro() {
  const r = await navigator.serviceWorker.getRegistration();
  return r ?? navigator.serviceWorker.register('./sw.js');
}

/** Cómo están los avisos en este equipo. */
export async function estadoPush(): Promise<EstadoPush> {
  if (!pushSoportado()) return esIos() && !instalada() ? 'requiere-instalar' : 'no-soportado';
  if (Notification.permission === 'denied') return 'bloqueado';
  if (Notification.permission === 'default') return 'pendiente';
  const r = await navigator.serviceWorker.getRegistration();
  const s = await r?.pushManager.getSubscription();
  return s ? 'activo' : 'inactivo';
}

/** Pide el permiso (debe llamarse desde un clic) y registra este equipo en el servidor. */
export async function activarPush(): Promise<EstadoPush> {
  const cfg = await api<ConfigPush>('/notificaciones/push/configuracion');
  if (!cfg.activo || !cfg.clavePublica) throw new Error('Los avisos todavía no están activos en el servidor.');
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') return permiso === 'denied' ? 'bloqueado' : 'pendiente';
  const r = await registro();
  await navigator.serviceWorker.ready;
  const existente = await r.pushManager.getSubscription();
  const s = existente ?? await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytesClave(cfg.clavePublica) });
  const json = s.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api('/notificaciones/push/suscripciones', { cuerpo: { endpoint: json.endpoint, keys: json.keys } });
  return 'activo';
}

/** Apaga los avisos en este equipo (los demás equipos de la persona siguen igual). */
export async function desactivarPush(): Promise<EstadoPush> {
  const r = await navigator.serviceWorker.getRegistration();
  const s = await r?.pushManager.getSubscription();
  if (s) {
    await api('/notificaciones/push/suscripciones', { metodo: 'DELETE', cuerpo: { endpoint: s.endpoint } }).catch(() => undefined);
    await s.unsubscribe().catch(() => undefined);
  }
  return 'inactivo';
}

export const probarPush = () => api<{ enviados: number }>('/notificaciones/push/prueba', { cuerpo: {} });
