// Avisos automáticos de errores del servidor (requisitos de producción: registro de errores y alertas por errores 5xx).
// Cada error inesperado (el que responde «Error interno») queda en errores_servidor con quién, dónde y cuándo; la pila
// queda solo en el registro del servidor. Al administrador (o a ALERTAS_CORREO) le llega un correo la primera vez que
// aparece un error y, si se repite, a lo sumo uno cada hora por error: así no se llena el buzón.
import { Controller, Get, Global, Injectable, Logger, Module, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { Correo } from '../common/servicios';
import { Publico, avisoErrores, type ErrorInesperado } from '../common/http';
import type { Config } from '../config';

const UNA_HORA = 60 * 60_000;

@Injectable()
export class Monitoreo implements OnModuleInit {
  private readonly log = new Logger('Monitoreo');
  constructor(private readonly db: PrismaService, private readonly correo: Correo, private readonly cfg: ConfigService<Config, true>) {}

  onModuleInit() { avisoErrores.registrar = (e) => { void this.registrar(e).catch((x) => this.log.error(`No se pudo registrar el error: ${(x as Error).message}`)); }; }

  /** Ruta sin consulta y con los identificadores cambiados por «:id» (agrupa el mismo error en registros distintos). */
  private static ruta(url: string) { return url.split('?')[0].replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id').replace(/\/\d+(?=\/|$)/g, '/:n').slice(0, 300); }

  async registrar(e: ErrorInesperado) {
    const ruta = Monitoreo.ruta(e.ruta);
    const mensaje = (e.mensaje || 'Error sin mensaje').replace(/\s+/g, ' ').slice(0, 500);
    const firma = createHash('sha256').update(`${e.metodo} ${ruta} ${mensaje.slice(0, 200)} ${e.origen ?? ''}`).digest('hex').slice(0, 16);
    const x = await this.db.errorServidor.create({ data: { empresaId: e.empresaId ?? null, usuarioId: e.usuarioId ?? null, metodo: e.metodo.slice(0, 10), ruta, mensaje, firma, ip: e.ip ?? null } });
    const para = await this.destinatarios(e.empresaId ?? null);
    if (!para.length) return;
    // Un aviso por error y por hora como máximo. El candado por firma evita dos avisos cuando el error llega dos veces
    // al mismo tiempo (o en dos copias del API).
    const avisar = await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${firma}))`;
      if (await tx.errorServidor.findFirst({ where: { firma, avisado: true, fecha: { gte: new Date(Date.now() - UNA_HORA) } }, select: { id: true } })) return false;
      await tx.errorServidor.update({ where: { id: x.id }, data: { avisado: true } });
      return true;
    });
    if (!avisar) return;
    const repeticiones = await this.db.errorServidor.count({ where: { firma, fecha: { gte: new Date(Date.now() - 24 * UNA_HORA) } } });
    const cuando = x.fecha.toLocaleString('es-CO', { timeZone: 'America/Bogota' });
    const texto = [
      'Terry-App · Gestión de Residuos tuvo un error inesperado y la persona vio «Error interno».', '',
      `Cuándo: ${cuando}`, `Dónde: ${e.metodo} ${ruta}`, `Error: ${mensaje}`,
      `Veces en las últimas 24 horas: ${repeticiones}`, '',
      'El detalle técnico quedó en el registro del servidor. Si se repite, avise a quien da soporte a la plataforma.',
      'Este aviso se envía a lo sumo una vez por hora por cada error.',
    ].join('\n');
    for (const p of para) await this.correo.enviar(p, `Terry-App · Error del servidor: ${e.metodo} ${ruta}`.slice(0, 150), texto).catch(() => undefined);
  }

  /** ALERTAS_CORREO (separados por coma) o, si no hay, los administradores activos de la empresa (o de todas). */
  private async destinatarios(empresaId: string | null) {
    const fijos = this.cfg.get('ALERTAS_CORREO', { infer: true }).split(',').map((x) => x.trim()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
    if (fijos.length) return fijos;
    const admins = await this.db.usuario.findMany({ where: { activo: true, clienteId: null, ...(empresaId ? { empresaId } : {}), rol: { permisos: { some: { permiso: { codigo: '*' } } } } },
      select: { email: true }, take: 10 });
    return admins.map((u) => u.email).filter(Boolean);
  }
}

/** Solo con PRUEBAS_ERRORES=true (pruebas automáticas): un error interno de verdad, para probar el aviso de punta a punta. */
@Controller('salud')
class PruebaErrores {
  constructor(private readonly cfg: ConfigService<Config, true>) {}
  @Publico() @Get('error-de-prueba') error() {
    if (!this.cfg.get('PRUEBAS_ERRORES', { infer: true }) || process.env.NODE_ENV === 'production') throw new NotFoundException({ mensaje: 'No existe.' });
    throw new Error('Error de prueba del monitoreo');
  }
}

@Global()
@Module({ controllers: [PruebaErrores], providers: [Monitoreo], exports: [Monitoreo] })
export class MonitoreoModule {}
