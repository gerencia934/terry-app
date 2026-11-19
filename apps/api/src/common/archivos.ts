import { BadRequestException, Controller, ForbiddenException, Get, Global, Injectable, Module, NotFoundException, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { Config } from '../config';
import { ActorActual, Zod, type Actor } from './http';

/** Tipos de archivo aceptados, reconocidos por su contenido (no por el nombre). */
const TIPOS = {
  png: { mime: 'image/png', firma: [0x89, 0x50, 0x4e, 0x47] },
  jpg: { mime: 'image/jpeg', firma: [0xff, 0xd8, 0xff] },
  webp: { mime: 'image/webp', firma: [0x52, 0x49, 0x46, 0x46] }, // RIFF…WEBP
  pdf: { mime: 'application/pdf', firma: [0x25, 0x50, 0x44, 0x46] }, // %PDF
} as const;
export type TipoArchivo = keyof typeof TIPOS;

/** Detecta el tipo real del archivo por sus primeros bytes. */
export function tipoDeArchivo(buf: Buffer): TipoArchivo | null {
  for (const [ext, t] of Object.entries(TIPOS) as [TipoArchivo, (typeof TIPOS)[TipoArchivo]][]) {
    if (t.firma.every((b, i) => buf[i] === b) && (ext !== 'webp' || buf.subarray(8, 12).toString('ascii') === 'WEBP')) return ext;
  }
  return null;
}

// Clave de archivo: «local:<empresa>/<carpeta>/<año>/<uuid>.<ext>». Nunca se aceptan rutas escritas por el usuario.
const CLAVE = /^local:([0-9a-f-]{36})\/([a-z-]{2,30})\/(\d{4})\/([0-9a-f-]{36})\.(png|jpg|webp|pdf)$/;

/**
 * Almacenamiento de archivos de la operación (firmas, fotos, PDF de actas).
 * Hoy guarda en una carpeta local separada por empresa; para producción se agrega un
 * almacenamiento S3 / R2 con la misma interfaz (guardar / leer).
 */
@Injectable()
export class Archivos {
  private readonly raiz: string;
  readonly maxBytes: number;
  constructor(cfg: ConfigService<Config, true>) {
    this.raiz = resolve(cfg.get('ALMACENAMIENTO_DIR', { infer: true }));
    this.maxBytes = cfg.get('ARCHIVO_MAX_MB', { infer: true }) * 1024 * 1024;
  }

  /** Guarda el archivo si su contenido es de un tipo permitido. Devuelve la clave para la base de datos. */
  async guardar(empresaId: string, carpeta: string, buf: Buffer, permitidos: TipoArchivo[]): Promise<{ clave: string; tipo: TipoArchivo; bytes: number }> {
    if (!buf.length) throw new BadRequestException({ mensaje: 'El archivo está vacío.' });
    if (buf.length > this.maxBytes) throw new BadRequestException({ mensaje: `El archivo supera ${Math.round(this.maxBytes / 1048576)} MB.` });
    const tipo = tipoDeArchivo(buf);
    if (!tipo || !permitidos.includes(tipo)) throw new BadRequestException({ mensaje: `Tipo de archivo no permitido. Se acepta: ${permitidos.join(', ').toUpperCase()}.` });
    const clave = `local:${empresaId}/${carpeta}/${new Date().getFullYear()}/${randomUUID()}.${tipo}`;
    const ruta = this.ruta(clave);
    await mkdir(dirname(ruta), { recursive: true });
    await writeFile(ruta, buf, { flag: 'wx' });
    return { clave, tipo, bytes: buf.length };
  }

  /** Lee un archivo verificando que pertenezca a la empresa de quien lo pide. */
  async leer(clave: string, empresaId: string): Promise<{ buf: Buffer; mime: string }> {
    const m = CLAVE.exec(clave);
    if (!m) throw new NotFoundException({ mensaje: 'Archivo no encontrado.' });
    if (m[1] !== empresaId) throw new ForbiddenException({ mensaje: 'Archivo de otra empresa.' });
    try { return { buf: await readFile(this.ruta(clave)), mime: TIPOS[m[5] as TipoArchivo].mime }; }
    catch { throw new NotFoundException({ mensaje: 'Archivo no encontrado.' }); }
  }

  private ruta(clave: string) {
    if (!CLAVE.test(clave)) throw new BadRequestException({ mensaje: 'Clave de archivo inválida.' });
    const ruta = resolve(this.raiz, clave.slice('local:'.length));
    if (!ruta.startsWith(this.raiz + sep)) throw new BadRequestException({ mensaje: 'Clave de archivo inválida.' });
    return ruta;
  }
}

/** Convierte una firma capturada en el celular («data:image/png;base64,…») en bytes. */
export function firmaDesdeDataUrl(dataUrl: string): Buffer {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!m) throw new BadRequestException({ mensaje: 'La firma debe ser una imagen PNG.' });
  return Buffer.from(m[1], 'base64');
}

@Controller('archivos')
class ArchivosController {
  constructor(private readonly archivos: Archivos) {}
  /** Descarga un archivo de la empresa del usuario (firma, foto, PDF). */
  @Get() async descargar(@ActorActual() a: Actor, @Query(new Zod(z.object({ clave: z.string().max(200) }))) q: { clave: string }, @Res() res: Response) {
    const { buf, mime } = await this.archivos.leer(q.clave, a.empresaId);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(buf);
  }
}

@Global()
@Module({ controllers: [ArchivosController], providers: [Archivos], exports: [Archivos] })
export class ArchivosModule {}
