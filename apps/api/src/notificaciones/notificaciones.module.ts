// Notificaciones push (Web Push con llaves VAPID) al celular o al computador de cada persona, aunque la app esté cerrada.
// Avisan de solicitudes de recolección nuevas, inspecciones no aprobadas y, cada mañana, las alertas del día por rol y los
// manifiestos por firmar. Sin llaves VAPID no hay avisos y todo lo demás sigue igual. Un aviso que falla nunca detiene
// la operación: se reintenta en el siguiente y, si el servicio dice que la suscripción venció, se borra.
import { Body, Controller, Delete, Get, Global, Headers, HttpCode, Injectable, Logger, Module, NotFoundException, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import webpush from 'web-push';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { ActorActual, PermiteCampo, Zod, type Actor } from '../common/http';
import type { Config } from '../config';

/** Lo que muestra el aviso. «ruta» es la sección de la app que abre al tocarlo; «etiqueta» agrupa avisos del mismo tema. */
export interface Aviso { titulo: string; cuerpo: string; ruta?: string; etiqueta?: string }

const Suscripcion = z.object({
  endpoint: z.string().trim().max(1000).regex(/^https:\/\/[^\s]+$/, 'Dirección de notificaciones no válida.'),
  keys: z.object({ p256dh: z.string().trim().min(20).max(200), auth: z.string().trim().min(8).max(100) }),
});
const Quitar = z.object({ endpoint: z.string().trim().max(1000) });
const MAX_FALLOS = 10;

@Injectable()
export class Notificaciones {
  private readonly log = new Logger('Notificaciones');
  private readonly llaves: boolean;
  /** Solo en pruebas automáticas (PUSH_PRUEBAS): los avisos se guardan aquí en vez de enviarse. */
  readonly enPruebas: (Aviso & { usuarioId: string })[] = [];

  constructor(private readonly db: PrismaService, private readonly cfg: ConfigService<Config, true>) {
    const publica = cfg.get('VAPID_PUBLICA', { infer: true }); const privada = cfg.get('VAPID_PRIVADA', { infer: true });
    this.llaves = !!(publica && privada);
    if (this.llaves) webpush.setVapidDetails(cfg.get('VAPID_CONTACTO', { infer: true }), publica, privada);
  }
  private get pruebas() { return this.cfg.get('PUSH_PRUEBAS', { infer: true }); }
  get activo() { return this.llaves || this.pruebas; }

  async configuracion(a: Actor) {
    const suscripciones = await this.db.suscripcionPush.count({ where: { usuarioId: a.id } });
    return { activo: this.activo, clavePublica: this.cfg.get('VAPID_PUBLICA', { infer: true }) || null, suscripciones };
  }

  async suscribir(a: Actor, s: z.infer<typeof Suscripcion>, agente?: string) {
    const datos = { empresaId: a.empresaId, usuarioId: a.id, p256dh: s.keys.p256dh, auth: s.keys.auth, agente: agente?.slice(0, 300) ?? null, fallos: 0 };
    await this.db.suscripcionPush.upsert({ where: { endpoint: s.endpoint }, create: { ...datos, endpoint: s.endpoint }, update: datos });
    return this.configuracion(a);
  }

  async quitar(a: Actor, endpoint: string) {
    await this.db.suscripcionPush.deleteMany({ where: { endpoint, usuarioId: a.id } });
  }

  /** Envía el aviso a todos los equipos de estas personas. Devuelve cuántos salieron; nunca lanza error. */
  async aUsuarios(usuarioIds: string[], aviso: Aviso): Promise<number> {
    if (!this.activo || !usuarioIds.length) return 0;
    try {
      const subs = await this.db.suscripcionPush.findMany({ where: { usuarioId: { in: [...new Set(usuarioIds)] } } });
      let enviados = 0;
      for (const s of subs) {
        if (this.pruebas) {
          this.enPruebas.push({ ...aviso, usuarioId: s.usuarioId }); if (this.enPruebas.length > 300) this.enPruebas.shift();
          enviados++; continue;
        }
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(aviso), { TTL: 86_400, urgency: 'normal' });
          enviados++;
          await this.db.suscripcionPush.update({ where: { id: s.id }, data: { ultimoEnvio: new Date(), fallos: 0 } });
        } catch (e) {
          const codigo = (e as { statusCode?: number }).statusCode;
          // 404 / 410: el navegador ya no tiene esa suscripción (la persona quitó el permiso o borró los datos)
          if (codigo === 404 || codigo === 410) { await this.db.suscripcionPush.deleteMany({ where: { id: s.id } }); continue; }
          const x = await this.db.suscripcionPush.update({ where: { id: s.id }, data: { fallos: { increment: 1 } } });
          if (x.fallos >= MAX_FALLOS) await this.db.suscripcionPush.deleteMany({ where: { id: s.id } });
          this.log.warn(`No se pudo enviar un aviso (${codigo ?? (e as Error).message})`);
        }
      }
      return enviados;
    } catch (e) {
      this.log.warn(`Avisos: ${(e as Error).message}`);
      return 0;
    }
  }

  /** A las personas activas de la empresa (no del portal) cuyo rol tiene alguno de estos permisos. */
  async aPermisos(empresaId: string, permisos: string[], aviso: Aviso, excepto?: string): Promise<number> {
    if (!this.activo) return 0;
    try {
      const usuarios = await this.db.usuario.findMany({
        where: { empresaId, activo: true, clienteId: null, suscripcionesPush: { some: {} }, rol: { permisos: { some: { permiso: { codigo: { in: ['*', ...permisos] } } } } } },
        select: { id: true },
      });
      return this.aUsuarios(usuarios.map((u) => u.id).filter((x) => x !== excepto), aviso);
    } catch (e) {
      this.log.warn(`Avisos: ${(e as Error).message}`);
      return 0;
    }
  }
}

// Los avisos al celular también los usa la app de campo (cada quien solo maneja sus propios equipos)
@PermiteCampo()
@Controller('notificaciones/push')
class NotificacionesController {
  constructor(private readonly n: Notificaciones, private readonly cfg: ConfigService<Config, true>) {}
  @Get('configuracion') configuracion(@ActorActual() a: Actor) { return this.n.configuracion(a); }
  @Post('suscripciones') @HttpCode(201) suscribir(@ActorActual() a: Actor, @Body(new Zod(Suscripcion)) b: z.infer<typeof Suscripcion>, @Headers('user-agent') ua?: string) { return this.n.suscribir(a, b, ua); }
  @Delete('suscripciones') @HttpCode(204) async quitar(@ActorActual() a: Actor, @Body(new Zod(Quitar)) b: z.infer<typeof Quitar>) { await this.n.quitar(a, b.endpoint); }
  /** Aviso de prueba a los equipos de quien lo pide. */
  @Post('prueba') @HttpCode(200) async prueba(@ActorActual() a: Actor) {
    const enviados = await this.n.aUsuarios([a.id], { titulo: 'Terry-App · Gestión de Residuos', cuerpo: 'Los avisos quedaron activos en este equipo.', ruta: 'inicio', etiqueta: 'prueba' });
    return { enviados };
  }
  /** Solo pruebas automáticas: los avisos que se habrían enviado. */
  @Get('pruebas') pruebas(@ActorActual() a: Actor) {
    if (!this.cfg.get('PUSH_PRUEBAS', { infer: true }) || process.env.NODE_ENV === 'production') throw new NotFoundException({ mensaje: 'No existe.' });
    return this.n.enPruebas.filter((x) => x.usuarioId === a.id || a.permisos.includes('*'));
  }
}

@Global()
@Module({ controllers: [NotificacionesController], providers: [Notificaciones], exports: [Notificaciones] })
export class NotificacionesModule {}
