// Fotos y GPS en el celular.
import { encolar } from './cola';

/** Reduce la foto de la cámara (máx. 1600 px, JPEG) para que pese poco y suba rápido con poca señal. */
export async function comprimirFoto(archivo: File, max = 1600, calidad = 0.8): Promise<Blob> {
  const url = URL.createObjectURL(archivo);
  try {
    const img = await new Promise<HTMLImageElement>((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = url; });
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise<Blob>((ok, mal) => c.toBlob((b) => (b ? ok(b) : mal(new Error('No se pudo procesar la foto'))), 'image/jpeg', calidad));
  } finally { URL.revokeObjectURL(url); }
}

// ---------- GPS: solo mientras la ruta está en una etapa con rastreo ----------
interface Punto { latitud: number; longitud: number; precisionM?: number; velocidadKmh?: number; registradoEn: string }
let vigilancia: number | null = null, rutaGps: string | null = null, lote: Punto[] = [], ultimo = 0;
let temporizador: ReturnType<typeof setInterval> | null = null;

function vaciarLote() {
  if (!rutaGps || !lote.length) return;
  const puntos = lote; lote = [];
  void encolar({ grupo: `gps:${rutaGps}`, descripcion: `Ubicación (${puntos.length} puntos)`, metodo: 'POST', ruta: `/rutas/${rutaGps}/rastreo`, cuerpo: { puntos } });
}

/** Empieza a registrar la ubicación cada ~30 s y la envía en lotes (también sin señal). */
export function iniciarGps(rutaId: string) {
  if (rutaGps === rutaId && vigilancia !== null) return;
  detenerGps();
  if (!('geolocation' in navigator)) return;
  rutaGps = rutaId;
  vigilancia = navigator.geolocation.watchPosition((p) => {
    if (Date.now() - ultimo < 30_000) return;
    ultimo = Date.now();
    const { latitude, longitude, accuracy, speed } = p.coords;
    if (latitude < -5 || latitude > 14 || longitude < -82 || longitude > -66) return; // fuera de Colombia: se ignora
    lote.push({ latitud: +latitude.toFixed(6), longitud: +longitude.toFixed(6), precisionM: accuracy ? +accuracy.toFixed(1) : undefined,
      velocidadKmh: speed !== null && speed >= 0 ? +(speed * 3.6).toFixed(1) : undefined, registradoEn: new Date(p.timestamp).toISOString() });
    if (lote.length >= 20) vaciarLote();
  }, () => undefined, { enableHighAccuracy: true, maximumAge: 15_000, timeout: 30_000 });
  temporizador = setInterval(vaciarLote, 120_000);
}

export function detenerGps() {
  vaciarLote();
  if (vigilancia !== null) navigator.geolocation.clearWatch(vigilancia);
  if (temporizador) clearInterval(temporizador);
  vigilancia = null; temporizador = null; rutaGps = null;
}
export const gpsActivo = () => vigilancia !== null;
