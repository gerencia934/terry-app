import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import nodemailer, { type Transporter } from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';
import type { Config } from '../config';
import type { Actor } from './http';
import { contextoPeticion } from './contexto';
import { claveMunicipio } from '@terraviva/shared';

/** Bitácora de cambios (soporte ante la autoridad ambiental y Ley 1581 de 2012). Guarda también la IP y el navegador
 *  de la petición; la base impide modificarla o borrarla (requisitos de producción §3). */
@Injectable()
export class Auditoria {
  constructor(private readonly db: PrismaService) {}
  registrar(actor: Actor | { id: string } | null, entidad: string, entidadId: string, accion: string, antes?: unknown, despues?: unknown, tx?: Prisma.TransactionClient) {
    return (tx ?? this.db).auditoria.create({
      data: { usuarioId: actor?.id ?? null, entidad, entidadId, accion, antes: (antes ?? undefined) as Prisma.InputJsonValue, despues: (despues ?? undefined) as Prisma.InputJsonValue,
        ip: contextoPeticion.getStore()?.ip ?? null, agente: contextoPeticion.getStore()?.agente ?? null },
    });
  }
  /** Varios eventos de la misma acción en un solo INSERT (p. ej., las declaraciones de un cargue que se deshace). */
  registrarVarios(actor: Actor | { id: string } | null, entidad: string, accion: string, eventos: { entidadId: string; antes?: unknown; despues?: unknown }[], tx?: Prisma.TransactionClient) {
    const ctx = contextoPeticion.getStore();
    return (tx ?? this.db).auditoria.createMany({ data: eventos.map((e) => ({
      usuarioId: actor?.id ?? null, entidad, entidadId: e.entidadId, accion,
      antes: (e.antes ?? undefined) as Prisma.InputJsonValue, despues: (e.despues ?? undefined) as Prisma.InputJsonValue,
      ip: ctx?.ip ?? null, agente: ctx?.agente ?? null,
    })) });
  }
}

/** Municipios de la DIVIPOLA del DANE (tabla estática): se cargan una vez y se buscan sin importar tildes ni mayúsculas. */
export interface MunicipioDane { codigoDane: string; nombre: string; departamento: string }
const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
@Injectable()
export class Municipios {
  private lista?: Promise<(MunicipioDane & { clave: string; depto: string })[]>;
  constructor(private readonly db: PrismaService) {}
  private todos() {
    this.lista ??= this.db.municipio.findMany({ orderBy: [{ departamento: 'asc' }, { nombre: 'asc' }] })
      .then((xs) => xs.map((m) => ({ ...m, clave: sinTildes(m.nombre), depto: sinTildes(m.departamento) })))
      .catch((e) => { this.lista = undefined; throw e; });
    return this.lista;
  }
  /** Hasta `limite` municipios cuyo nombre contiene el texto (primero los que empiezan por él). */
  async buscar(q: string, departamento?: string, limite = 20): Promise<MunicipioDane[]> {
    const t = sinTildes(q), d = departamento ? sinTildes(departamento) : '';
    const xs = (await this.todos()).filter((m) => (!d || m.depto === d) && (!t || m.clave.includes(t) || m.codigoDane.startsWith(t)));
    xs.sort((x, y) => Number(!x.clave.startsWith(t)) - Number(!y.clave.startsWith(t)));
    return xs.slice(0, limite).map(({ codigoDane, nombre, departamento: dep }) => ({ codigoDane, nombre, departamento: dep }));
  }
  /** Código DANE de un municipio escrito por su código (68655) o por su nombre y departamento, sin importar tildes. */
  async resolver(municipio?: string, departamento?: string): Promise<string | null> {
    const m = (municipio ?? '').trim();
    if (!m) return null;
    const xs = await this.todos();
    if (/^\d{5}$/.test(m)) return xs.some((x) => x.codigoDane === m) ? m : null;
    const t = sinTildes(m), d = sinTildes(departamento ?? '');
    const encontrados = xs.filter((x) => x.clave === t && (!d || x.depto === d));
    return encontrados.length === 1 ? encontrados[0].codigoDane : null;
  }
  async existe(codigoDane: string) { return (await this.todos()).some((x) => x.codigoDane === codigoDane); }
  /** Claves «municipio|departamento» y códigos DANE, para avisar en la revisión de un cargue de sedes. */
  async claves(): Promise<Set<string>> {
    const xs = await this.todos();
    return new Set([...xs.map((x) => claveMunicipio(x.nombre, x.departamento)), ...xs.map((x) => x.codigoDane)]);
  }
}

/** Correo transaccional. Sin SMTP configurado, escribe el mensaje en la consola (útil en desarrollo). */
@Injectable()
export class Correo {
  private readonly log = new Logger('Correo');
  private transporte: Transporter | null = null;
  constructor(private readonly cfg: ConfigService<Config, true>) {
    const host = this.cfg.get('SMTP_HOST', { infer: true });
    if (host) this.transporte = nodemailer.createTransport({ host, port: this.cfg.get('SMTP_PORT', { infer: true }), auth: { user: this.cfg.get('SMTP_USER', { infer: true }), pass: this.cfg.get('SMTP_PASS', { infer: true }) } });
  }
  async enviar(para: string, asunto: string, texto: string) {
    if (!this.transporte) { this.log.log(`(sin SMTP) Para: ${para} · ${asunto}\n${texto}`); return; }
    await this.transporte.sendMail({ from: this.cfg.get('MAIL_FROM', { infer: true }), to: para, subject: asunto, text: texto });
  }
}

@Global()
@Module({ providers: [Auditoria, Correo, Municipios], exports: [Auditoria, Correo, Municipios] })
export class ComunModule {}
