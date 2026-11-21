// Portal Logístico ↔ Mantenimiento (gerencia, 21-11-2026). El preoperacional, los vehículos y los reportes de fallas viven en
// Mantenimiento (mantenimiento.terravivasas.net): Residuos no guarda tablas propias de eso. Este módulo es el puente:
// - le pregunta a Mantenimiento, de servidor a servidor y en máximo 3 s, si el vehículo de la ruta tiene preoperacional
//   apto ese día. Manda el ÚLTIMO del día, y lo debe haber hecho el conductor o el auxiliar de la ruta;
// - deja anotado en la misma ruta qué la autorizó (el preoperacional o una excepción de la oficina con su motivo);
// - arma los enlaces a las pantallas de Mantenimiento del vehículo (preoperacional, reportar falla, hoja de vida);
// - le envía a Mantenimiento el kilometraje que toma el conductor, para no capturarlo dos veces.
// Regla de Terra Viva: sin preoperacional apto no hay ruta ni manifiesto. Si Mantenimiento no responde, la ruta sigue con lo
// último confirmado; si nunca se confirmó, queda bloqueada y solo la oficina puede autorizar la salida, con su motivo.
import { BadRequestException, Body, ConflictException, Controller, Injectable, Logger, Module, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { Auditoria } from '../common/servicios';
import { Notificaciones } from '../notificaciones/notificaciones.module';
import { ActorActual, Permiso, Zod, type Actor } from '../common/http';
import type { Config } from '../config';

/** uuidv5, igual al de Mantenimiento (apps/api/src/common/llaves.ts): la misma placa da el mismo id de activo allá. */
function uuidv5(nombre: string, espacio: string) {
  const ns = Buffer.from(espacio.replace(/-/g, ''), 'hex');
  const h = createHash('sha1').update(Buffer.concat([ns, Buffer.from(nombre, 'utf8')])).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
const RAIZ = uuidv5('terravivasas.co', '6ba7b810-9dad-11d1-80b4-00c04fd430c8');
export const placaLimpia = (p: string) => p.toUpperCase().replace(/[^A-Z0-9]/g, '');
/** Id del vehículo en Mantenimiento a partir de la placa (regla común del ecosistema). */
export const activoDePlaca = (placa: string) => uuidv5(`activo:${placaLimpia(placa)}`, RAIZ);
const dia = (d: Date) => d.toISOString().slice(0, 10);
const hora = (iso: string | Date) => new Date(iso).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit' });

/** Respuesta de Mantenimiento: GET /mto/integraciones/terrygo/vehiculos/:placa/preoperacional?fecha= */
export interface PreopMantenimiento {
  placa: string; activoId: string; fecha: string; realizados: number; aprobado: boolean;
  ultimo: { id: string; terminadoEn: string; aprobado: boolean; fallas: number; criticas: number; usuario: { email: string; nombre: string } } | null;
  disponibilidad: { apto: boolean; estadoOperativo: string; motivos: string[] } | null;
}
type Consulta = { tipo: 'ok'; datos: PreopMantenimiento } | { tipo: 'no-registrado' } | { tipo: 'sin-respuesta'; motivo: string };

@Injectable()
export class MantenimientoCliente {
  private readonly log = new Logger('Mantenimiento');
  constructor(private readonly cfg: ConfigService<Config, true>) {}
  private get url() { return this.cfg.get('MANTENIMIENTO_URL', { infer: true }).replace(/\/+$/, ''); }
  private get token() { return this.cfg.get('MANTENIMIENTO_TOKEN', { infer: true }); }
  get conectado() { return !!(this.url && this.token); }
  /** Dirección de las pantallas de Mantenimiento (es la misma del API) o null si Residuos no está conectado. */
  get web() { return this.url || null; }
  get volver() { return this.cfg.get('MANTENIMIENTO_VOLVER', { infer: true }); }

  private pedir(ruta: string, init?: { method: string; body: string }) {
    return fetch(`${this.url}/api/v1/mto/integraciones/terrygo${ruta}`, {
      method: init?.method ?? 'GET', body: init?.body, signal: AbortSignal.timeout(3000),
      headers: { 'x-integracion-token': this.token, ...(init?.body ? { 'content-type': 'application/json' } : {}) },
    });
  }

  /** ¿El vehículo tiene preoperacional apto ese día? Nunca espera más de 3 s ni lanza error: dice si no hubo respuesta. */
  async preoperacionalDelDia(placa: string, fecha: string): Promise<Consulta> {
    if (!this.conectado) return { tipo: 'sin-respuesta', motivo: 'Residuos todavía no está conectado con Mantenimiento' };
    try {
      const r = await this.pedir(`/vehiculos/${encodeURIComponent(placaLimpia(placa))}/preoperacional?fecha=${fecha}`);
      if (r.status === 404) return { tipo: 'no-registrado' };
      if (!r.ok) {
        this.log.warn(`Mantenimiento respondió ${r.status} a la consulta del preoperacional de ${placa}`);
        return { tipo: 'sin-respuesta', motivo: r.status === 503 ? 'Mantenimiento se está encendiendo' : `Mantenimiento respondió con un error (${r.status})` };
      }
      return { tipo: 'ok', datos: (await r.json()) as PreopMantenimiento };
    } catch (e) {
      this.log.warn(`Mantenimiento no respondió: ${(e as Error).message}`);
      return { tipo: 'sin-respuesta', motivo: 'Mantenimiento no respondió a tiempo' };
    }
  }

  /** Kilometraje de la ruta → lectura del medidor en Mantenimiento (allá es idempotente por la hora). No bloquea nada. */
  async enviarKm(placa: string, km: number, leidaEn: Date, rutaId: string) {
    if (!this.conectado) return false;
    try {
      const r = await this.pedir('/lecturas', { method: 'POST', body: JSON.stringify({ placa: placaLimpia(placa), tipo: 'KM', valor: km, leidaEn: leidaEn.toISOString(), fuente: 'RUTA', refId: rutaId }) });
      if (!r.ok) this.log.warn(`Mantenimiento no recibió el kilometraje de ${placa} (${r.status})`);
      return r.ok;
    } catch { return false; }
  }
}

export type EstadoPreop = (
  | { abierta: true; via: 'PREOPERACIONAL' | 'EXCEPCION'; detalle: string; confirmado: boolean }
  | { abierta: false; codigo: 'SIN_VEHICULO' | 'SIN_PREOPERACIONAL' | 'NO_APTO' | 'OTRA_PERSONA' | 'NO_REGISTRADO' | 'SIN_RESPUESTA'; mensaje: string }
) & { placa: string | null; enlaces: EnlacesMantenimiento | null };
export interface EnlacesMantenimiento { preoperacional: string; reportar: string; vehiculo: string; reportes: string }

const seleccion = {
  id: true, codigo: true, empresaId: true, fechaProgramada: true, preopAutorizacion: true, preopReferencia: true, preopDetalle: true,
  vehiculo: { select: { placa: true } }, conductor: { select: { email: true } }, auxiliar: { select: { email: true } },
} satisfies Prisma.RutaSelect;
type RutaPreop = Prisma.RutaGetPayload<{ select: typeof seleccion }>;

@Injectable()
export class PreopRutas {
  constructor(private readonly db: PrismaService, private readonly mto: MantenimientoCliente, private readonly audit: Auditoria, private readonly avisos: Notificaciones) {}

  get conectado() { return this.mto.conectado; }

  /** Pantallas de Mantenimiento de ese vehículo, con el regreso al Portal Logístico («Mi ruta»). */
  enlaces(placa: string | null | undefined, activoId?: string): EnlacesMantenimiento | null {
    const web = this.mto.web;
    if (!web || !placa) return null;
    const id = activoId ?? activoDePlaca(placa);
    const base = `${web}/?volver=${encodeURIComponent(this.mto.volver)}#campo`;
    return { preoperacional: `${base}-preop-${id}`, reportar: `${base}-reportar-${id}`, vehiculo: `${base}-vehiculos-${id}`, reportes: `${base}-reportes` };
  }

  /** Pantallas generales de Mantenimiento (sin vehículo): para el conductor que hoy no tiene ruta. */
  enlacesGenerales() {
    const web = this.mto.web;
    if (!web) return null;
    const base = `${web}/?volver=${encodeURIComponent(this.mto.volver)}#campo`;
    return { preoperacional: `${base}-preop`, reportar: `${base}-reportar`, vehiculos: `${base}-vehiculos`, reportes: `${base}-reportes` };
  }

  async evaluar(rutaId: string, consultar = true): Promise<EstadoPreop> {
    const r = await this.db.ruta.findUnique({ where: { id: rutaId }, select: seleccion });
    if (!r) throw new NotFoundException({ mensaje: 'Ruta no encontrada.' });
    return this.evaluarRuta(r, consultar);
  }

  /**
   * ¿La ruta puede abrirse? Con «consultar», le pregunta a Mantenimiento y deja anotado en la ruta el resultado.
   * Una excepción de la oficina manda sobre todo; si Mantenimiento no responde, vale lo último confirmado.
   */
  async evaluarRuta(r: RutaPreop, consultar = true): Promise<EstadoPreop> {
    const placa = r.vehiculo?.placa ?? null;
    const enlaces = this.enlaces(placa);
    if (r.preopAutorizacion === 'EXCEPCION') return { abierta: true, via: 'EXCEPCION', detalle: r.preopDetalle ?? '', confirmado: true, placa, enlaces };
    if (!placa) return { abierta: false, codigo: 'SIN_VEHICULO', mensaje: 'La ruta no tiene vehículo asignado: avise al coordinador.', placa, enlaces };
    const confirmadaAntes = r.preopAutorizacion === 'PREOPERACIONAL';
    const sinPreop = { abierta: false as const, codigo: 'SIN_PREOPERACIONAL' as const, mensaje: `Haga el preoperacional del ${placa}: sin él, la ruta no se abre.`, placa, enlaces };
    if (!consultar) return confirmadaAntes ? { abierta: true, via: 'PREOPERACIONAL', detalle: r.preopDetalle ?? '', confirmado: false, placa, enlaces } : sinPreop;

    const c = await this.mto.preoperacionalDelDia(placa, dia(r.fechaProgramada));
    if (c.tipo === 'sin-respuesta') {
      if (confirmadaAntes) return { abierta: true, via: 'PREOPERACIONAL', detalle: r.preopDetalle ?? '', confirmado: false, placa, enlaces };
      return { abierta: false, codigo: 'SIN_RESPUESTA', placa, enlaces,
        mensaje: `No se pudo confirmar el preoperacional con Mantenimiento (${c.motivo}). Intente de nuevo en un momento; si sigue, llame a su coordinador.` };
    }
    if (c.tipo === 'no-registrado') {
      await this.anotar(r, null);
      return { abierta: false, codigo: 'NO_REGISTRADO', mensaje: `El vehículo ${placa} no está registrado en Mantenimiento: avise a su coordinador.`, placa, enlaces };
    }
    const enl = this.enlaces(placa, c.datos.activoId);
    const u = c.datos.ultimo;
    if (!u) { await this.anotar(r, null); return { ...sinPreop, enlaces: enl }; }
    if (!u.aprobado) {
      await this.anotar(r, null);
      return { abierta: false, codigo: 'NO_APTO', placa, enlaces: enl,
        mensaje: `El preoperacional del ${placa} de las ${hora(u.terminadoEn)} salió NO APTO: el vehículo no puede salir. Avise a su coordinador; si se corrige la falla, haga uno nuevo.` };
    }
    const tripulacion = [r.conductor?.email, r.auxiliar?.email].filter((x): x is string => !!x).map((x) => x.toLowerCase());
    if (!tripulacion.includes(u.usuario.email.toLowerCase())) {
      await this.anotar(r, null);
      return { abierta: false, codigo: 'OTRA_PERSONA', placa, enlaces: enl,
        mensaje: `El preoperacional del ${placa} de hoy lo hizo ${u.usuario.nombre}: lo debe hacer el conductor o el auxiliar de la ruta.` };
    }
    const detalle = `Apto · ${hora(u.terminadoEn)} · ${u.usuario.nombre}`.slice(0, 300);
    await this.anotar(r, { ref: u.id, detalle });
    return { abierta: true, via: 'PREOPERACIONAL', detalle, confirmado: true, placa, enlaces: enl };
  }

  /** Deja en la ruta qué la autorizó (o lo quita). La regla de la base no deja salir una ruta sin esa anotación. */
  private async anotar(r: RutaPreop, v: { ref: string; detalle: string } | null) {
    if (v ? r.preopAutorizacion === 'PREOPERACIONAL' && r.preopReferencia === v.ref && r.preopDetalle === v.detalle : r.preopAutorizacion === null) return;
    await this.db.ruta.update({ where: { id: r.id }, data: v
      ? { preopAutorizacion: 'PREOPERACIONAL', preopReferencia: v.ref, preopDetalle: v.detalle, preopAutorizadoEn: new Date(), preopAutorizadoPorId: null }
      : { preopAutorizacion: null, preopReferencia: null, preopDetalle: null, preopAutorizadoEn: null, preopAutorizadoPorId: null } });
    r.preopAutorizacion = v ? 'PREOPERACIONAL' : null; r.preopReferencia = v?.ref ?? null; r.preopDetalle = v?.detalle ?? null;
  }

  /** Para salir a ruta o abrir manifiestos: sin preoperacional apto (ni excepción de la oficina) → 409 PREOPERACIONAL. */
  async asegurar(rutaId: string) {
    const e = await this.evaluar(rutaId, true);
    if (!e.abierta) throw new ConflictException({ codigo: 'PREOPERACIONAL', mensaje: e.mensaje });
    return e;
  }

  /** Emergencia (p. ej. Mantenimiento no responde): la oficina deja salir la ruta sin preoperacional, con su motivo. */
  async excepcion(a: Actor, rutaId: string, motivo: string) {
    const r = await this.db.ruta.findFirst({ where: { id: rutaId, empresaId: a.empresaId }, select: { ...seleccion, estadoRecorrido: { select: { esFinal: true } } } });
    if (!r) throw new NotFoundException({ mensaje: 'Ruta no encontrada.' });
    if (r.estadoRecorrido?.esFinal) throw new BadRequestException({ mensaje: 'La ruta ya terminó.' });
    const detalle = motivo.trim().slice(0, 300);
    await this.db.ruta.update({ where: { id: r.id }, data: { preopAutorizacion: 'EXCEPCION', preopDetalle: detalle, preopReferencia: null, preopAutorizadoPorId: a.id, preopAutorizadoEn: new Date() } });
    await this.audit.registrar(a, 'ruta', r.id, 'EXCEPCION_PREOP', { autorizacion: r.preopAutorizacion }, { motivo: detalle });
    void this.avisos.aPermisos(a.empresaId, ['rutas.programar'], { titulo: `Ruta ${r.codigo}: salida sin preoperacional`, cuerpo: detalle, ruta: 'seguimiento', etiqueta: `excepcion-${r.id}` }, a.id)
      .catch(() => undefined);
    return this.evaluar(r.id, false);
  }

  /** Kilometraje que tomó el conductor: a Mantenimiento, sin esperar ni bloquear. */
  enviarKm(placa: string | null | undefined, km: number | undefined, rutaId: string) {
    if (!placa || km === undefined) return;
    void this.mto.enviarKm(placa, km, new Date(), rutaId);
  }
}

const Excepcion = z.object({ motivo: z.string().trim().min(10, 'Explique el motivo (mínimo 10 caracteres).').max(300) });

@Controller('rutas')
class PreopRutasController {
  constructor(private readonly s: PreopRutas, private readonly db: PrismaService) {}

  private async propia(a: Actor, id: string) {
    if (!(await this.db.ruta.count({ where: { id, empresaId: a.empresaId } }))) throw new NotFoundException({ mensaje: 'Ruta no encontrada.' });
  }

  /** La oficina le vuelve a preguntar a Mantenimiento (detalle de la ruta › «Consultar Mantenimiento»). */
  @Permiso('rutas.programar') @Post(':id/preoperacional/consultar')
  async consultar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { await this.propia(a, id); return this.s.evaluar(id, true); }

  @Permiso('rutas.autorizar_sin_preop') @Post(':id/preoperacional/excepcion')
  excepcion(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Excepcion)) b: z.infer<typeof Excepcion>) { return this.s.excepcion(a, id, b.motivo); }
}

@Module({ controllers: [PreopRutasController], providers: [MantenimientoCliente, PreopRutas], exports: [MantenimientoCliente, PreopRutas] })
export class MantenimientoModule {}
