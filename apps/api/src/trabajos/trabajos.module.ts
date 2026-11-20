// Cola de trabajos (requisitos de producción §1). Los archivos pesados (ZIP de certificados, Excel) no se generan
// durante la petición: el usuario los pide, el API responde de inmediato y los prepara aparte; cuando están listos,
// «Mis descargas» entrega un enlace firmado de 5 minutos. Vive en PostgreSQL: cada copia del API toma un trabajo con
// FOR UPDATE SKIP LOCKED, así que dos copias nunca preparan el mismo. El archivo preparado es una copia y vence.
import {
  BadRequestException, Controller, ForbiddenException, Get, Global, HttpCode, HttpException, Injectable, Logger, Module, NotFoundException,
  type OnApplicationBootstrap, type OnModuleDestroy, Param, ParseUUIDPipe, Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type Trabajo } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Archivos, type TipoGenerado } from '../common/archivos';
import { ActorActual, type Actor } from '../common/http';
import type { Config } from '../config';

/** Lo que entrega quien prepara un trabajo: el archivo, con qué nombre se descarga y su tipo. */
export interface ArchivoPreparado { buf: Buffer; nombre: string; ext: TipoGenerado }
export interface TipoDeTrabajo<P> {
  /** Permiso que se exige al pedirlo y otra vez al prepararlo (el rol pudo cambiar entretanto). */
  permiso: string;
  preparar: (a: Actor, parametros: P) => Promise<ArchivoPreparado>;
}

const MAX_INTENTOS = 3;
const ATASCADO_MIN = 15; // un trabajo «en curso» por más tiempo se da por caído (la copia del API se reinició)
const tiene = (a: Actor, permiso: string) => a.permisos.includes('*') || a.permisos.includes(permiso);
const vista = (t: Trabajo) => ({
  id: t.id, tipo: t.tipo, titulo: t.titulo, estado: t.estado, error: t.estado === 'FALLIDO' ? t.error : null, nombre: t.nombre, bytes: t.bytes,
  creadoEn: t.creadoEn, terminadoEn: t.terminadoEn, venceEn: t.venceEn, descargadoEn: t.descargadoEn,
});

@Injectable()
export class Trabajos implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Trabajos');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly tipos = new Map<string, TipoDeTrabajo<any>>();
  private reloj: NodeJS.Timeout | null = null;
  private enCurso = 0;
  private revisando = false;
  private ultimoMantenimiento = 0;
  constructor(private readonly db: PrismaService, private readonly archivos: Archivos, private readonly cfg: ConfigService<Config, true>) {}

  /** Cada módulo registra los trabajos que sabe preparar (ZIP de certificados, Excel de conciliación…). */
  registrar<P>(tipo: string, t: TipoDeTrabajo<P>) { this.tipos.set(tipo, t); }

  /** Pide preparar un archivo. Responde de inmediato con el trabajo pendiente. */
  async encolar(a: Actor, tipo: string, titulo: string, parametros: Prisma.InputJsonValue) {
    const t = this.tipos.get(tipo);
    if (!t) throw new BadRequestException({ mensaje: `Trabajo desconocido: ${tipo}.` });
    if (!tiene(a, t.permiso)) throw new ForbiddenException({ mensaje: `Su rol (${a.rol}) no tiene el permiso «${t.permiso}».` });
    const x = await this.db.trabajo.create({ data: { empresaId: a.empresaId, usuarioId: a.id, tipo, titulo: titulo.slice(0, 200), parametros } });
    setImmediate(() => void this.revisar());
    return vista(x);
  }

  /** «Mis descargas»: lo que el usuario pidió en los últimos 30 días. */
  async listar(a: Actor) {
    const xs = await this.db.trabajo.findMany({ where: { usuarioId: a.id, creadoEn: { gte: new Date(Date.now() - 30 * 86_400_000) } }, orderBy: { creadoEn: 'desc' }, take: 30 });
    return xs.map(vista);
  }

  async obtener(a: Actor, id: string) { return vista(await this.propio(a, id)); }

  /** Enlace firmado de 5 minutos al archivo preparado. */
  async enlace(a: Actor, id: string) {
    const t = await this.propio(a, id);
    const vencido = t.estado === 'VENCIDO' || (t.estado === 'LISTO' && !!t.venceEn && t.venceEn < new Date());
    if (vencido || t.estado !== 'LISTO' || !t.archivo || !t.nombre) {
      throw new BadRequestException({ mensaje: vencido ? 'El archivo ya venció: pídalo de nuevo.' : t.estado === 'FALLIDO' ? t.error ?? 'No se pudo preparar.' : 'El archivo aún se está preparando.' });
    }
    if (!t.descargadoEn) await this.db.trabajo.update({ where: { id }, data: { descargadoEn: new Date() } });
    return this.archivos.enlace(t.archivo, t.empresaId, { nombre: t.nombre, adjunto: true });
  }

  private async propio(a: Actor, id: string) {
    const t = await this.db.trabajo.findFirst({ where: { id, usuarioId: a.id, empresaId: a.empresaId } });
    if (!t) throw new NotFoundException({ mensaje: 'Descarga no encontrada.' });
    return t;
  }

  // ---------------- Quien prepara ----------------
  onApplicationBootstrap() {
    if (!this.cfg.get('TRABAJOS_PROCESAR', { infer: true })) return;
    this.reloj = setInterval(() => void this.revisar(), 2000);
    this.reloj.unref?.();
  }
  onModuleDestroy() { if (this.reloj) clearInterval(this.reloj); }

  /** Toma trabajos pendientes mientras haya cupo. */
  async revisar() {
    if (!this.cfg.get('TRABAJOS_PROCESAR', { infer: true }) || this.revisando) return;
    this.revisando = true;
    try {
      if (Date.now() - this.ultimoMantenimiento > 60_000) { this.ultimoMantenimiento = Date.now(); await this.mantenimiento(); }
      const cupo = this.cfg.get('TRABAJOS_SIMULTANEOS', { infer: true });
      while (this.enCurso < cupo) {
        const t = await this.tomar();
        if (!t) break;
        this.enCurso++;
        void this.ejecutar(t).finally(() => { this.enCurso--; setImmediate(() => void this.revisar()); });
      }
    } catch (e) {
      this.log.error(`No se pudo revisar la cola: ${(e as Error).message}`);
    } finally { this.revisando = false; }
  }

  private async tomar() {
    const [t] = await this.db.$queryRaw<{ id: string; empresa_id: string; usuario_id: string; tipo: string; parametros: unknown; intentos: number }[]>`
      UPDATE trabajos SET estado = 'EN_CURSO', iniciado_en = now(), intentos = intentos + 1
      WHERE id = (SELECT id FROM trabajos WHERE estado = 'PENDIENTE' ORDER BY creado_en FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id, empresa_id, usuario_id, tipo, parametros, intentos`;
    return t ?? null;
  }

  private async ejecutar(t: { id: string; empresa_id: string; usuario_id: string; tipo: string; parametros: unknown; intentos: number }) {
    try {
      const tipo = this.tipos.get(t.tipo);
      if (!tipo) throw new BadRequestException({ mensaje: `Trabajo desconocido: ${t.tipo}.` });
      const a = await this.actor(t.usuario_id);
      if (!tiene(a, tipo.permiso)) throw new ForbiddenException({ mensaje: `Su rol ya no tiene el permiso «${tipo.permiso}».` });
      const r = await tipo.preparar(a, t.parametros);
      const g = await this.archivos.guardarGenerado(t.empresa_id, 'trabajos', r.buf, r.ext);
      const dias = this.cfg.get('TRABAJOS_DIAS', { infer: true });
      await this.db.trabajo.update({ where: { id: t.id }, data: {
        estado: 'LISTO', archivo: g.clave, nombre: r.nombre.slice(0, 200), bytes: g.bytes, error: null, terminadoEn: new Date(), venceEn: new Date(Date.now() + dias * 86_400_000),
      } });
    } catch (e) {
      // Validación o permisos: no se reintenta. Un error inesperado se reintenta hasta 3 veces.
      const definitivo = e instanceof HttpException || t.intentos >= MAX_INTENTOS;
      const mensaje = e instanceof HttpException ? ((e.getResponse() as { mensaje?: string }).mensaje ?? e.message) : 'No se pudo preparar el archivo.';
      if (!(e instanceof HttpException)) this.log.error(`Trabajo ${t.id} (${t.tipo}), intento ${t.intentos}: ${(e as Error).stack ?? e}`);
      await this.db.trabajo.update({ where: { id: t.id }, data: definitivo
        ? { estado: 'FALLIDO', error: mensaje.slice(0, 500), terminadoEn: new Date() }
        : { estado: 'PENDIENTE', error: mensaje.slice(0, 500) } }).catch(() => undefined);
    }
  }

  /** Quien lo pidió, con su rol de hoy (si lo inactivaron, no se prepara). */
  private async actor(usuarioId: string): Promise<Actor> {
    const u = await this.db.usuario.findUnique({ where: { id: usuarioId }, include: { rol: { include: { permisos: { include: { permiso: { select: { codigo: true } } } } } } } });
    if (!u || !u.activo) throw new ForbiddenException({ mensaje: 'El usuario que lo pidió está inactivo.' });
    return {
      id: u.id, empresaId: u.empresaId, rol: u.rol.nombre, nombre: u.nombre, permisos: u.clienteId ? [] : u.rol.permisos.map((p) => p.permiso.codigo),
      ...(u.clienteId ? { clienteId: u.clienteId, perfilPortal: u.perfilPortal ?? 'CONSULTA' } : {}),
    };
  }

  /** Reintenta lo que quedó «en curso» por una copia caída y borra los archivos preparados que vencieron. */
  private async mantenimiento() {
    await this.db.$executeRaw`
      UPDATE trabajos SET estado = CASE WHEN intentos < ${MAX_INTENTOS} THEN 'PENDIENTE'::"EstadoTrabajo" ELSE 'FALLIDO'::"EstadoTrabajo" END,
        error = 'No terminó a tiempo.', terminado_en = CASE WHEN intentos < ${MAX_INTENTOS} THEN NULL ELSE now() END
      WHERE estado = 'EN_CURSO' AND iniciado_en < now() - make_interval(mins => ${ATASCADO_MIN}::int)`; // el número llega como bigint y make_interval pide int
    const vencidos = await this.db.trabajo.findMany({ where: { estado: 'LISTO', venceEn: { lt: new Date() } }, take: 100 });
    for (const v of vencidos) {
      if (v.archivo) await this.archivos.borrarGenerado(v.archivo, v.empresaId).catch((e) => this.log.warn(`No se borró ${v.archivo}: ${(e as Error).message}`));
      await this.db.trabajo.update({ where: { id: v.id }, data: { estado: 'VENCIDO', archivo: null } });
    }
  }
}

@Controller('trabajos')
class TrabajosController {
  constructor(private readonly t: Trabajos) {}
  @Get() listar(@ActorActual() a: Actor) { return this.t.listar(a); }
  @Get(':id') obtener(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.t.obtener(a, id); }
  @Post(':id/enlace') @HttpCode(200) enlace(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.t.enlace(a, id); }
}

@Global()
@Module({ controllers: [TrabajosController], providers: [Trabajos], exports: [Trabajos] })
export class TrabajosModule {}
