import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import nodemailer, { type Transporter } from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';
import type { Config } from '../config';
import type { Actor } from './http';

/** Bitácora de cambios (soporte ante la autoridad ambiental y Ley 1581 de 2012). */
@Injectable()
export class Auditoria {
  constructor(private readonly db: PrismaService) {}
  registrar(actor: Actor | { id: string } | null, entidad: string, entidadId: string, accion: string, antes?: unknown, despues?: unknown, tx?: Prisma.TransactionClient) {
    return (tx ?? this.db).auditoria.create({
      data: { usuarioId: actor?.id ?? null, entidad, entidadId, accion, antes: (antes ?? undefined) as Prisma.InputJsonValue, despues: (despues ?? undefined) as Prisma.InputJsonValue },
    });
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
@Module({ providers: [Auditoria, Correo], exports: [Auditoria, Correo] })
export class ComunModule {}
