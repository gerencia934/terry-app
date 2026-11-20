// Cliente de la API remota de Wialon (GPS de la flota). SOLO LECTURA: TERRY-GO nunca escribe en Wialon.
// - Ingreso con un token (token/login): la sesión se reutiliza y, si vence, se vuelve a ingresar solo.
// - Unidades con su última posición (core/search_items) y mensajes de un intervalo (messages/load_interval).
// Referencia: https://sdk.wialon.com/wiki/en/sidebar/remoteapi/apiref/apiref

/** Posición de Wialon: «y» latitud, «x» longitud, «s» velocidad (km/h), «c» rumbo (grados), «t» hora (segundos). */
export interface PosicionWialon { t?: number; y: number; x: number; s?: number; c?: number; z?: number; sc?: number }
export interface UnidadWialon { id: number; nm: string; pos?: PosicionWialon | null }
interface MensajeWialon { t: number; pos?: PosicionWialon | null }
/** Punto ya convertido: hora en milisegundos. */
export interface PuntoWialon { t: number; lat: number; lng: number; vel: number | null; rumbo: number | null }

export class ErrorWialon extends Error {
  constructor(mensaje: string, readonly codigo?: number) { super(mensaje); }
}

const MENSAJES: Record<number, string> = {
  4: 'Wialon no aceptó la consulta (datos no válidos).',
  5: 'Wialon no pudo hacer la consulta en este momento.',
  6: 'Wialon tuvo un error desconocido.',
  7: 'El token de Wialon no tiene acceso a esa información.',
  8: 'Wialon no aceptó el token configurado en el servidor.',
};
const SESION_VENCIDA = new Set([1, 1011]); // sesión no válida o vencida: se vuelve a ingresar
const OCUPADO = 1003; // «una consulta a la vez»: se espera un momento y se repite
const MAX_MENSAJES = 20_000; // 48 horas con un mensaje cada 10 segundos caben de sobra
const espera = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** Convierte una posición de Wialon en un punto (descarta las vacías o imposibles). */
export function aPunto(t: number | undefined, pos?: PosicionWialon | null): PuntoWialon | null {
  if (!pos || typeof t !== 'number' || !Number.isFinite(t) || !Number.isFinite(pos.y) || !Number.isFinite(pos.x)) return null;
  if (Math.abs(pos.y) > 90 || Math.abs(pos.x) > 180 || (pos.y === 0 && pos.x === 0)) return null;
  return { t: t * 1000, lat: pos.y, lng: pos.x, vel: typeof pos.s === 'number' ? pos.s : null, rumbo: typeof pos.c === 'number' ? pos.c : null };
}

export class WialonCliente {
  private sid: string | null = null;
  private ingresando: Promise<string> | null = null;
  constructor(private readonly o: { url: string; token: string; pausaMs?: number }) {}

  get configurado() { return !!this.o.token; }

  private async peticion<T>(svc: string, params: unknown, sid?: string): Promise<T> {
    const cuerpo = new URLSearchParams({ svc, params: JSON.stringify(params) });
    if (sid) cuerpo.set('sid', sid);
    let r: Response;
    try {
      r = await fetch(`${this.o.url.replace(/\/+$/, '')}/wialon/ajax.html`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: cuerpo, signal: AbortSignal.timeout(25_000) });
    } catch { throw new ErrorWialon('No hay conexión con Wialon.'); }
    if (!r.ok) throw new ErrorWialon(`Wialon no respondió bien (código ${r.status}).`);
    let j: unknown;
    try { j = await r.json(); } catch { throw new ErrorWialon('Wialon respondió algo que no se entiende.'); }
    const error = (j as { error?: unknown } | null)?.error;
    if (typeof error === 'number' && error !== 0) throw new ErrorWialon(MENSAJES[error] ?? `Wialon respondió con el error ${error}.`, error);
    return j as T;
  }

  private ingresar() {
    this.ingresando ??= (async () => {
      try {
        const r = await this.peticion<{ eid?: string }>('token/login', { token: this.o.token });
        if (!r.eid) throw new ErrorWialon('Wialon no entregó la sesión.');
        this.sid = r.eid;
        return r.eid;
      } catch (e) {
        if (e instanceof ErrorWialon && e.codigo !== undefined && [1, 4, 7, 8].includes(e.codigo)) {
          throw new ErrorWialon('Wialon no aceptó el token configurado en el servidor (revise que esté vigente y sea de esta cuenta).', e.codigo);
        }
        throw e;
      } finally { this.ingresando = null; }
    })();
    return this.ingresando;
  }

  /** Una consulta con la sesión; si venció, ingresa de nuevo y la repite. */
  private async llamar<T>(svc: string, params: unknown): Promise<T> {
    for (let intento = 0; ; intento++) {
      const sid = this.sid ?? (await this.ingresar());
      try {
        return await this.peticion<T>(svc, params, sid);
      } catch (e) {
        if (!(e instanceof ErrorWialon) || intento >= 2) throw e;
        if (e.codigo !== undefined && SESION_VENCIDA.has(e.codigo)) { if (this.sid === sid) this.sid = null; continue; }
        if (e.codigo === OCUPADO) { await espera(this.o.pausaMs ?? 1000); continue; }
        throw e;
      }
    }
  }

  /** Las unidades que ve el token, con su última posición (marcas 0x1 básico y 0x400 último mensaje y posición). */
  async unidades(): Promise<UnidadWialon[]> {
    const r = await this.llamar<{ items?: UnidadWialon[] }>('core/search_items', {
      spec: { itemsType: 'avl_unit', propName: 'sys_name', propValueMask: '*', sortType: 'sys_name' }, force: 1, flags: 0x1 | 0x400, from: 0, to: 0 });
    return (r.items ?? []).filter((u) => typeof u?.id === 'number' && typeof u.nm === 'string');
  }

  /** Mensajes con posición de una unidad entre dos horas (milisegundos), en orden. */
  async puntos(unidadId: number, desde: number, hasta: number): Promise<PuntoWialon[]> {
    const r = await this.llamar<{ messages?: MensajeWialon[] }>('messages/load_interval', {
      itemId: unidadId, timeFrom: Math.floor(desde / 1000), timeTo: Math.floor(hasta / 1000), flags: 0x1, flagsMask: 0xff01, loadCount: MAX_MENSAJES });
    await this.llamar('messages/unload', {}).catch(() => undefined); // libera la memoria de la sesión en Wialon
    return (r.messages ?? []).map((m) => aPunto(m.t, m.pos)).filter((p): p is PuntoWialon => !!p).sort((a, b) => a.t - b.t);
  }
}

/** ¿El nombre de la unidad trae la placa? «USD855», «USD-855», «Furgón USD 855» sí; «XUSD8551» no. */
export function placaEnNombre(placa: string, nombre: string) {
  const p = placa.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (p.length < 5) return false;
  const patron = p.replace(/([A-Z])(?=\d)|(\d)(?=[A-Z])/g, '$1$2[\\s.-]?');
  return new RegExp(`(^|[^A-Z0-9])${patron}($|[^A-Z0-9])`).test(nombre.toUpperCase());
}
