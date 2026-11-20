// Servidor de TERRY-GO en Cloudflare. Ver docs/DESPLIEGUE.md.
//
// Recorrido de una petición: navegador → residuos.terravivasas.net/api/... (Pages) → este Worker (enlace de servicio,
// sin dirección pública) → el Durable Object «principal» → el contenedor con el API de siempre (apps/api/Dockerfile).
//
// - Un solo Durable Object, creado en el oriente de Norteamérica: el contenedor corre donde corre su Durable Object,
//   así queda cerca de la base de datos (Neon, AWS Virginia).
// - Siempre encendido: el aviso de cada minuto (cron) y las peticiones lo mantienen vivo; si se cae, lo vuelven a
//   encender. Así corren solas la consulta a Wialon, la sincronización con Siigo, el correo diario y la cola de trabajos.
// - Al publicar una versión nueva (o cambiar una variable o clave del Worker), el contenedor anterior recibe la señal de
//   apagado (SIGTERM), termina lo que está haciendo y se enciende el nuevo. Mientras tanto las peticiones esperan.
import { DurableObject } from 'cloudflare:workers';

const PUERTO = 3000;
const SALUD = '/api/v1/salud';
/** Sin peticiones ni avisos durante este tiempo, Cloudflare apaga el contenedor (con el aviso de cada minuto no pasa). */
const INACTIVIDAD_MS = 15 * 60_000;
/** Lo máximo que se espera a que el servidor responda al encender (aplica las migraciones pendientes y luego abre). */
const ARRANQUE_MAX_MS = 4 * 60_000;
/** Primeros segundos del arranque en los que no se revisa si el contenedor sigue encendido (todavía se está creando). */
const ARRANQUE_GRACIA_MS = 15_000;
/** Al publicar: tiempo para que la versión anterior cierre con calma antes de apagarla a la fuerza. */
const CIERRE_MAX_MS = 60_000;
/** Tamaño: 1 vCPU y 3 GiB (el menor tamaño a la medida). Los ZIP de certificados y los PDF necesitan memoria. */
const INSTANCIA = { vcpu: 1, memoryMib: 3072, diskMb: 4000 };
const SIGTERM = 15;
/** Ruta interna del aviso de cada minuto (no empieza por /api: desde Pages no se puede llamar). */
const VIGILAR = '/__vigilar';

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Respuesta cuando el servidor no está disponible: el mismo formato de error que usa el API ({ mensaje }). */
function noDisponible(mensaje = 'El servidor se está encendiendo o actualizando. Intente de nuevo en un minuto.') {
  return Response.json({ mensaje }, { status: 503, headers: { 'retry-after': '30', 'cache-control': 'no-store' } });
}

export class ServidorApi extends DurableObject<Env> {
  private preparando: Promise<void> | null = null;
  /** El servidor del contenedor ya respondió desde que este objeto está en memoria. */
  private listo = false;
  /** Imagen y huella de las variables con las que se encendió el contenedor (para saber si hay que reiniciarlo). */
  private versionEnUso: string | undefined;
  /** Huella (SHA-256) de las variables y claves de este despliegue del Worker: las claves nunca se guardan tal cual. */
  private huellaVariables = '';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Si el objeto vuelve a memoria con el contenedor encendido, renueva su tiempo de vida (se pierde al reiniciarse)
    ctx.blockConcurrencyWhile(async () => {
      this.versionEnUso = await ctx.storage.get<string>('version');
      const v = this.variables();
      const texto = JSON.stringify(Object.keys(v).sort().map((k) => [k, v[k]]));
      const huella = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
      this.huellaVariables = [...new Uint8Array(huella)].map((b) => b.toString(16).padStart(2, '0')).join('');
      if (ctx.container?.running) await ctx.container.setInactivityTimeout(INACTIVIDAD_MS);
    });
  }

  /** Versión que debe estar corriendo: la imagen publicada más las variables y claves actuales del Worker. */
  private versionPublicada() {
    const imagen = this.contenedor.images.api;
    if (!imagen) throw new Error('No hay imagen «api» publicada (revise wrangler.jsonc)');
    return { imagen, version: `${imagen}#${this.huellaVariables}` };
  }

  override async fetch(peticion: Request): Promise<Response> {
    const url = new URL(peticion.url);
    if (url.pathname !== VIGILAR && !url.pathname.startsWith('/api/')) return Response.json({ mensaje: 'No existe.' }, { status: 404 });
    try {
      await this.preparar();
    } catch (e) {
      console.error(`El servidor no está disponible: ${(e as Error).message}`);
      return noDisponible();
    }
    if (url.pathname === VIGILAR) return new Response('ok');

    const headers = new Headers(peticion.headers);
    headers.delete('host');
    const sinCuerpo = peticion.method === 'GET' || peticion.method === 'HEAD';
    const destino = new Request(`http://contenedor${url.pathname}${url.search}`, {
      method: peticion.method, headers, body: sinCuerpo ? null : peticion.body,
      // Las redirecciones (p. ej. a un enlace firmado de R2) van al navegador tal cual
      redirect: 'manual',
    });
    try {
      return await this.contenedor.getTcpPort(PUERTO).fetch(destino);
    } catch (e) {
      // El contenedor se cayó a mitad de camino: la próxima petición (o el aviso de cada minuto) lo enciende de nuevo
      this.listo = false;
      console.error(`El contenedor no respondió: ${(e as Error).message}`);
      return noDisponible();
    }
  }

  private get contenedor(): Container {
    if (!this.ctx.container) throw new Error('Este Durable Object no tiene contenedor (revise wrangler.jsonc)');
    return this.ctx.container;
  }

  /** Deja el contenedor encendido, con la versión publicada y respondiendo. Las peticiones simultáneas esperan juntas. */
  private preparar(): Promise<void> {
    if (this.listo && this.contenedor.running && this.versionEnUso === this.versionPublicada().version) return Promise.resolve();
    this.preparando ??= this.encender().finally(() => { this.preparando = null; });
    return this.preparando;
  }

  private async encender() {
    const c = this.contenedor;
    const { imagen, version } = this.versionPublicada();
    if (c.running && this.versionEnUso !== version) {
      console.log('Hay una versión nueva (imagen, variables o claves): se apaga con calma la anterior');
      this.listo = false;
      await this.apagar();
    }
    if (!c.running) {
      this.listo = false;
      c.start({ image: imagen, instance: INSTANCIA, enableInternet: true, env: this.variables() });
      this.versionEnUso = version;
      await this.ctx.storage.put('version', version);
      console.log('Contenedor encendido; esperando a que el servidor responda');
    }
    await c.setInactivityTimeout(INACTIVIDAD_MS);
    if (!this.listo) {
      await this.esperarRespuesta();
      this.listo = true;
      console.log('El servidor responde');
    }
  }

  /** Espera a que el servidor conteste (cualquier respuesta sirve: si la base no responde, lo dirá su salud). */
  private async esperarRespuesta() {
    const c = this.contenedor;
    const inicio = Date.now();
    while (Date.now() - inicio < ARRANQUE_MAX_MS) {
      if (!c.running && Date.now() - inicio > ARRANQUE_GRACIA_MS) throw new Error('El contenedor se detuvo al encender: revise su registro en Cloudflare');
      try {
        const r = await c.getTcpPort(PUERTO).fetch(`http://contenedor${SALUD}`, { signal: AbortSignal.timeout(3000) });
        await r.body?.cancel();
        return;
      } catch {
        await espera(500);
      }
    }
    throw new Error('El servidor no respondió a tiempo');
  }

  /** Apagado ordenado: SIGTERM (el servidor cierra conexiones y su cola) y, si no termina a tiempo, a la fuerza. */
  private async apagar() {
    const c = this.contenedor;
    c.signal(SIGTERM);
    const inicio = Date.now();
    while (c.running && Date.now() - inicio < CIERRE_MAX_MS) await espera(500);
    if (c.running) {
      console.warn('La versión anterior no cerró a tiempo: se apaga a la fuerza');
      await c.destroy();
      while (c.running) await espera(250);
    }
  }

  /** Variables del servidor: las de wrangler.jsonc («vars») y las claves guardadas en Cloudflare («secrets»). */
  private variables(): Record<string, string> {
    const v: Record<string, string> = {};
    for (const [k, x] of Object.entries(this.env)) if (typeof x === 'string') v[k] = x;
    return v;
  }
}

/** El único servidor, creado la primera vez en el oriente de Norteamérica (cerca de la base de datos). */
const servidor = (env: Env) => env.SERVIDOR.getByName('principal', { locationHint: 'enam' });

export default {
  fetch(peticion, env) {
    return servidor(env).fetch(peticion);
  },
  scheduled(_evento, env, ctx) {
    ctx.waitUntil(servidor(env).fetch(`http://interno${VIGILAR}`).then((r) => r.body?.cancel()));
  },
} satisfies ExportedHandler<Env>;
