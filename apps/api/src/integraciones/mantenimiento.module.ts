// Conexión con Mantenimiento (docs/ECOSISTEMA.md): «todo junto pero no unido». Residuos guarda su propia copia de los
// vehículos en taller (Mantenimiento la envía) y deja en una bandeja de salida lo que le debe avisar (preoperacionales con
// NO OK y kilómetros). Si Mantenimiento no responde, Residuos sigue trabajando: consultar nunca bloquea más de 3 s.
import {
  BadRequestException, Body, ConflictException, Controller, Delete, Global, Headers, HttpCode, Injectable, Logger, Module,
  NotFoundException, Param, Put, UnauthorizedException, type OnApplicationBootstrap, type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Prisma } from '@prisma/client';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { Publico, Zod } from '../common/http';
import { Auditoria } from '../common/servicios';
import type { Config } from '../config';

export const placaNormal = (p: string) => p.toUpperCase().replace(/[^A-Z0-9]/g, '');
const fechaHoraCO = (d: Date) => d.toLocaleString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const ID_BLOQUEO = /^[A-Za-z0-9_.:-]{3,80}$/;

/** Ventana de taller que envía Mantenimiento (su `VentanaMantenimiento`). Los campos de más se ignoran. */
const Bloqueo = z.object({
  ordenId: z.string().trim().max(80).optional(),
  consecutivo: z.string().trim().max(40).optional(),
  placa: z.string().trim().min(3).max(20),
  desde: z.coerce.date(),
  hasta: z.coerce.date(),
  motivo: z.string().trim().min(1).max(500),
  tipo: z.string().trim().max(20).optional(),
  criticidad: z.string().trim().max(20).optional(),
  detieneOperacion: z.boolean().default(true),
  taller: z.string().trim().max(200).nullish(),
}).refine((b) => b.hasta > b.desde, { message: '«hasta» debe ser posterior a «desde».' });

@Injectable()
export class Mantenimiento implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Mantenimiento');
  private reloj?: NodeJS.Timeout;
  private empresaDeLaFlota?: Promise<string | null>;
  private enviando = false;
  constructor(private readonly db: PrismaService, private readonly cfg: ConfigService<Config, true>, private readonly audit: Auditoria) {}

  private get url() { return this.cfg.get('MANTENIMIENTO_URL', { infer: true }).replace(/\/+$/, ''); }
  private get token() { return this.cfg.get('MANTENIMIENTO_INTEGRACION_TOKEN', { infer: true }); }
  get configurado() { return !!this.url && !!this.token; }

  /** La llave compartida, comparada en tiempo constante. Sin llave configurada no se acepta nada. */
  verificar(t: string | undefined) {
    const s = this.token;
    if (!s || !t || t.length !== s.length || !timingSafeEqual(Buffer.from(t), Buffer.from(s))) throw new UnauthorizedException({ mensaje: 'Llave de integración inválida.' });
  }

  /** La empresa dueña de la flota: la del NIT de MANTENIMIENTO_EMPRESA_NIT o, si la instalación tiene una sola, esa. */
  private empresaId() {
    this.empresaDeLaFlota ??= (async () => {
      const nit = this.cfg.get('MANTENIMIENTO_EMPRESA_NIT', { infer: true });
      const base = (x: string) => x.split('-')[0].replace(/\D/g, '');
      const empresas = await this.db.empresa.findMany({ select: { id: true, nit: true } });
      const e = nit ? empresas.find((x) => base(x.nit) === base(nit)) : empresas.length === 1 ? empresas[0] : undefined;
      return e?.id ?? null;
    })().catch(() => { this.empresaDeLaFlota = undefined; return null; });
    return this.empresaDeLaFlota;
  }

  private async vehiculoPorPlaca(empresaId: string, placa: string) {
    const p = placaNormal(placa);
    return (await this.db.vehiculo.findMany({ where: { empresaId }, select: { id: true, placa: true } })).find((v) => placaNormal(v.placa) === p) ?? null;
  }

  // --- Lo que llega de Mantenimiento
  async guardarBloqueo(id: string, b: z.infer<typeof Bloqueo>) {
    if (!ID_BLOQUEO.test(id)) throw new BadRequestException({ mensaje: 'Identificador de bloqueo no válido.' });
    const empresaId = await this.empresaId();
    if (!empresaId) throw new ConflictException({ mensaje: 'Residuos no sabe de qué empresa es la flota: configure MANTENIMIENTO_EMPRESA_NIT.' });
    const v = await this.vehiculoPorPlaca(empresaId, b.placa);
    const datos = {
      empresaId, vehiculoId: v?.id ?? null, placa: placaNormal(b.placa).slice(0, 12), ordenId: b.ordenId || null, consecutivo: b.consecutivo || null,
      desde: b.desde, hasta: b.hasta, motivo: b.motivo, tipo: b.tipo || null, criticidad: b.criticidad || null, detieneOperacion: b.detieneOperacion,
      taller: b.taller || null, liberadoEn: null, actualizadoEn: new Date(),
    };
    await this.db.bloqueoMantenimiento.upsert({ where: { id }, create: { id, ...datos }, update: datos });
    await this.audit.registrar(null, 'bloqueo_mantenimiento', id, 'GUARDAR', undefined, { placa: datos.placa, consecutivo: datos.consecutivo, desde: b.desde, hasta: b.hasta, vehiculo: !!v });
    return { ok: true, vehiculoEncontrado: !!v };
  }

  async liberarBloqueo(id: string) {
    if (!ID_BLOQUEO.test(id)) throw new BadRequestException({ mensaje: 'Identificador de bloqueo no válido.' });
    const r = await this.db.bloqueoMantenimiento.updateMany({ where: { id, liberadoEn: null }, data: { liberadoEn: new Date(), actualizadoEn: new Date() } });
    if (!r.count) throw new NotFoundException({ mensaje: 'Ese bloqueo no existe o ya estaba liberado.' });
    await this.audit.registrar(null, 'bloqueo_mantenimiento', id, 'LIBERAR');
  }

  /**
   * Antes de programar o reasignar una ruta: ¿el vehículo puede salir ese día?
   * - Bloquea (409) si hay una ventana de taller que detiene la operación ese día (copia propia: sirve aunque
   *   Mantenimiento esté caído).
   * - Bloquea si Mantenimiento responde que no está apto (SOAT o RTM vencidos, hallazgos críticos).
   * - Si Mantenimiento no responde en 3 s, deja programar y devuelve un aviso.
   */
  async revisarVehiculo(empresaId: string, vehiculoId: string, fecha: Date): Promise<{ aviso?: string }> {
    const dia = fecha.toISOString().slice(0, 10);
    const inicio = new Date(`${dia}T00:00:00-05:00`), fin = new Date(`${dia}T23:59:59-05:00`);
    const b = await this.db.bloqueoMantenimiento.findFirst({
      where: { empresaId, vehiculoId, liberadoEn: null, detieneOperacion: true, desde: { lte: fin }, hasta: { gte: inicio } }, orderBy: { desde: 'asc' },
    });
    if (b) throw new ConflictException({
      mensaje: `El vehículo ${b.placa} está en mantenimiento${b.consecutivo ? ` (${b.consecutivo})` : ''} del ${fechaHoraCO(b.desde)} al ${fechaHoraCO(b.hasta)}: ${b.motivo}. Elija otro vehículo u otra fecha.`,
      codigo: 'EN_MANTENIMIENTO',
    });
    // La disponibilidad en vivo solo importa para hoy en adelante (no para registrar rutas pasadas)
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    if (!this.configurado || dia < hoy) return {};
    const v = await this.db.vehiculo.findUnique({ where: { id: vehiculoId }, select: { placa: true } });
    if (!v) return {};
    let r: Response;
    try {
      r = await fetch(`${this.url}/api/v1/mto/integraciones/terrygo/vehiculos/${encodeURIComponent(placaNormal(v.placa))}/disponibilidad`, {
        headers: { 'x-integracion-token': this.token, accept: 'application/json' }, signal: AbortSignal.timeout(3000),
      });
    } catch { return { aviso: `Mantenimiento no respondió: revise el vehículo ${v.placa} antes de que salga.` }; }
    if (r.status === 404) return {}; // Mantenimiento no lleva ese vehículo
    if (!r.ok) return { aviso: `No se pudo consultar Mantenimiento (respondió ${r.status}): revise el vehículo ${v.placa} antes de que salga.` };
    const d = (await r.json().catch(() => ({}))) as { apto?: boolean; motivos?: unknown };
    if (d.apto === false) {
      const motivos = Array.isArray(d.motivos) ? d.motivos.filter((m): m is string => typeof m === 'string').join('; ') : '';
      throw new ConflictException({ mensaje: `Mantenimiento no deja salir el vehículo ${v.placa}: ${motivos || 'no está apto'}.`, codigo: 'NO_APTO' });
    }
    return {};
  }

  // --- Lo que Residuos le avisa a Mantenimiento (bandeja de salida con reintentos)
  /** Deja el aviso en la bandeja (la misma llave no se repite) y lo intenta enviar de inmediato. */
  async encolar(empresaId: string, tipo: 'PREOPERACIONAL' | 'LECTURA', llave: string, cuerpo: Prisma.InputJsonValue) {
    if (!this.configurado) return;
    await this.db.envioMantenimiento.createMany({ data: [{ empresaId, tipo, llave: llave.slice(0, 120), cuerpo }], skipDuplicates: true });
    setImmediate(() => void this.procesar());
  }

  /** Envía lo pendiente. Errores de datos (4xx) se dejan de reintentar; caídas y 5xx esperan cada vez más (hasta 1 h). */
  async procesar() {
    if (this.enviando || !this.configurado) return;
    this.enviando = true;
    try {
      const pendientes = await this.db.envioMantenimiento.findMany({ where: { enviadoEn: null, siguienteEn: { lte: new Date() } }, orderBy: { id: 'asc' }, take: 20 });
      for (const e of pendientes) {
        let error: string | null = null;
        let definitivo = false;
        try {
          const r = await fetch(`${this.url}/api/v1/mto/integraciones/terrygo/${e.tipo === 'PREOPERACIONAL' ? 'preoperacionales' : 'lecturas'}`, {
            method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', 'x-integracion-token': this.token },
            body: JSON.stringify(e.cuerpo), signal: AbortSignal.timeout(15_000),
          });
          if (!r.ok) {
            error = `Mantenimiento respondió ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`;
            definitivo = r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429;
          }
        } catch (x) { error = `Mantenimiento no respondió: ${(x as Error).message}`; }
        const intentos = e.intentos + 1;
        const espera = definitivo ? 365 * 86_400_000 : Math.min(60, 2 ** Math.min(intentos, 6)) * 60_000;
        await this.db.envioMantenimiento.update({ where: { id: e.id }, data: error
          ? { intentos, ultimoError: error.slice(0, 300), siguienteEn: new Date(Date.now() + espera) }
          : { intentos, ultimoError: null, enviadoEn: new Date() } });
      }
    } catch (x) { this.log.error(`Envíos a Mantenimiento: ${(x as Error).message}`); }
    finally { this.enviando = false; }
  }

  onApplicationBootstrap() {
    if (!this.configurado) return;
    this.reloj = setInterval(() => void this.procesar(), 60_000);
    this.reloj.unref?.();
  }
  onModuleDestroy() { if (this.reloj) clearInterval(this.reloj); }
}

/** Mantenimiento crea, actualiza (PUT, idempotente por el id) y libera (DELETE) las ventanas de taller. */
@Controller('integraciones/mantenimiento')
class IntegracionMantenimientoController {
  constructor(private readonly m: Mantenimiento) {}
  @Publico() @Throttle({ default: { limit: 120, ttl: 60_000 } }) @Put('bloqueos/:id') @HttpCode(200)
  guardar(@Headers('x-integracion-token') t: string | undefined, @Param('id') id: string, @Body(new Zod(Bloqueo)) b: z.infer<typeof Bloqueo>) {
    this.m.verificar(t);
    return this.m.guardarBloqueo(id, b);
  }
  @Publico() @Throttle({ default: { limit: 120, ttl: 60_000 } }) @Delete('bloqueos/:id') @HttpCode(204)
  async liberar(@Headers('x-integracion-token') t: string | undefined, @Param('id') id: string) {
    this.m.verificar(t);
    await this.m.liberarBloqueo(id);
  }
}

@Global()
@Module({ controllers: [IntegracionMantenimientoController], providers: [Mantenimiento], exports: [Mantenimiento] })
export class MantenimientoModule {}
