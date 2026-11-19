import { BadRequestException, Controller, ForbiddenException, Get, Global, Injectable, Module, NotFoundException, Param, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Response } from 'express';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { Config } from '../config';
import { ActorActual, Publico, Zod, type Actor } from './http';

/** Prefijo global del API (main.ts): para redirigir a un enlace del almacenamiento local. */
export const PREFIJO_API = '/api/v1';

/** Tipos que se suben, reconocidos por su contenido (no por el nombre). */
const SUBIDOS = {
  png: { mime: 'image/png', firma: [0x89, 0x50, 0x4e, 0x47] },
  jpg: { mime: 'image/jpeg', firma: [0xff, 0xd8, 0xff] },
  webp: { mime: 'image/webp', firma: [0x52, 0x49, 0x46, 0x46] }, // RIFF…WEBP
  pdf: { mime: 'application/pdf', firma: [0x25, 0x50, 0x44, 0x46] }, // %PDF
} as const;
export type TipoArchivo = keyof typeof SUBIDOS;
/** Tipos que genera el sistema (ZIP, Excel, CSV de la cola de trabajos): no los escribe el usuario. */
export type TipoGenerado = 'pdf' | 'zip' | 'xlsx' | 'csv';
const MIME: Record<TipoArchivo | TipoGenerado, string> = {
  png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', pdf: 'application/pdf', zip: 'application/zip',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv; charset=utf-8',
};

/** Detecta el tipo real del archivo por sus primeros bytes. */
export function tipoDeArchivo(buf: Buffer): TipoArchivo | null {
  for (const [ext, t] of Object.entries(SUBIDOS) as [TipoArchivo, (typeof SUBIDOS)[TipoArchivo]][]) {
    if (t.firma.every((b, i) => buf[i] === b) && (ext !== 'webp' || buf.subarray(8, 12).toString('ascii') === 'WEBP')) return ext;
  }
  return null;
}

// Clave de archivo: «<almacén>:<empresa>/<carpeta>/<año>/<uuid>.<ext>». El almacén es «local» (carpeta del servidor, para
// desarrollo) o «s3» (S3, R2 o MinIO, para producción). Nunca se aceptan rutas escritas por el usuario.
const CLAVE = /^(local|s3):([0-9a-f-]{36})\/([a-z-]{2,30})\/(\d{4})\/([0-9a-f-]{36})\.(png|jpg|webp|pdf|zip|xlsx|csv)$/;
type Almacen = 'local' | 's3';
const partes = (clave: string) => {
  const m = CLAVE.exec(clave);
  return m ? { almacen: m[1] as Almacen, empresa: m[2], carpeta: m[3], ruta: clave.slice(clave.indexOf(':') + 1), ext: m[6] as TipoArchivo | TipoGenerado } : null;
};

/** Enlace de descarga: dirección (absoluta en S3; relativa al API en el almacén local) y hasta cuándo sirve. */
export interface Enlace { url: string; vence: string }
export interface OpcionesEnlace { nombre?: string; adjunto?: boolean; segundos?: number }

/**
 * Almacenamiento de los archivos de la operación (firmas, fotos, PDF de actas) y de los que prepara la cola de
 * trabajos (ZIP, Excel). Los archivos nunca son públicos: el API verifica el permiso y entrega un enlace firmado
 * que vence en 5 minutos. En S3 el enlace lo firma el almacenamiento y el archivo no pasa por el API; en el almacén
 * local (desarrollo) el enlace lo sirve el propio API.
 */
@Injectable()
export class Archivos {
  private readonly raiz: string;
  readonly maxBytes: number;
  private readonly almacen: Almacen;
  private readonly s3: S3Client | null;
  private readonly bucket: string;
  private readonly claveEnlaces: Buffer;
  constructor(cfg: ConfigService<Config, true>) {
    this.raiz = resolve(cfg.get('ALMACENAMIENTO_DIR', { infer: true }));
    this.maxBytes = cfg.get('ARCHIVO_MAX_MB', { infer: true }) * 1024 * 1024;
    this.almacen = cfg.get('ALMACENAMIENTO', { infer: true });
    this.bucket = cfg.get('S3_BUCKET', { infer: true });
    // Clave propia de los enlaces locales, distinta de la de las sesiones
    this.claveEnlaces = createHash('sha256').update(`${cfg.get('JWT_SECRET', { infer: true })}:enlaces-archivos`).digest();
    this.s3 = this.almacen === 's3' || this.bucket ? new S3Client({
      region: cfg.get('S3_REGION', { infer: true }),
      ...(cfg.get('S3_ENDPOINT', { infer: true }) ? { endpoint: cfg.get('S3_ENDPOINT', { infer: true }) } : {}),
      forcePathStyle: cfg.get('S3_RUTA_EN_URL', { infer: true }),
      ...(cfg.get('S3_ACCESS_KEY_ID', { infer: true }) ? { credentials: { accessKeyId: cfg.get('S3_ACCESS_KEY_ID', { infer: true }), secretAccessKey: cfg.get('S3_SECRET_ACCESS_KEY', { infer: true }) } } : {}),
    }) : null;
  }

  /** Guarda un archivo subido si su contenido es de un tipo permitido. Devuelve la clave para la base de datos. */
  async guardar(empresaId: string, carpeta: string, buf: Buffer, permitidos: TipoArchivo[]): Promise<{ clave: string; tipo: TipoArchivo; bytes: number }> {
    if (!buf.length) throw new BadRequestException({ mensaje: 'El archivo está vacío.' });
    if (buf.length > this.maxBytes) throw new BadRequestException({ mensaje: `El archivo supera ${Math.round(this.maxBytes / 1048576)} MB.` });
    const tipo = tipoDeArchivo(buf);
    if (!tipo || !permitidos.includes(tipo)) throw new BadRequestException({ mensaje: `Tipo de archivo no permitido. Se acepta: ${permitidos.join(', ').toUpperCase()}.` });
    const clave = await this.escribir(empresaId, carpeta, buf, tipo);
    return { clave, tipo, bytes: buf.length };
  }

  /** Guarda un archivo que preparó el sistema (ZIP, Excel, PDF): su contenido no viene del usuario. */
  async guardarGenerado(empresaId: string, carpeta: string, buf: Buffer, ext: TipoGenerado): Promise<{ clave: string; bytes: number }> {
    return { clave: await this.escribir(empresaId, carpeta, buf, ext), bytes: buf.length };
  }

  private async escribir(empresaId: string, carpeta: string, buf: Buffer, ext: TipoArchivo | TipoGenerado) {
    const clave = `${this.almacen}:${empresaId}/${carpeta}/${new Date().getFullYear()}/${randomUUID()}.${ext}`;
    const p = partes(clave);
    if (!p) throw new BadRequestException({ mensaje: 'Clave de archivo inválida.' });
    if (p.almacen === 's3') {
      await this.cliente().send(new PutObjectCommand({ Bucket: this.bucket, Key: p.ruta, Body: buf, ContentType: MIME[ext] }));
    } else {
      const ruta = this.rutaLocal(p.ruta);
      await mkdir(dirname(ruta), { recursive: true });
      await writeFile(ruta, buf, { flag: 'wx' });
    }
    return clave;
  }

  /** Lee un archivo verificando que pertenezca a la empresa de quien lo pide (lo usa el API para armar PDF y ZIP). */
  async leer(clave: string, empresaId: string): Promise<{ buf: Buffer; mime: string }> {
    const p = this.propio(clave, empresaId);
    try {
      if (p.almacen === 's3') {
        const r = await this.cliente().send(new GetObjectCommand({ Bucket: this.bucket, Key: p.ruta }));
        return { buf: Buffer.from(await r.Body!.transformToByteArray()), mime: MIME[p.ext] };
      }
      return { buf: await readFile(this.rutaLocal(p.ruta)), mime: MIME[p.ext] };
    } catch { throw new NotFoundException({ mensaje: 'Archivo no encontrado.' }); }
  }

  /**
   * Borra un archivo preparado por la cola de trabajos cuando vence (es una copia: lo legal no se borra). Solo
   * acepta la carpeta «trabajos».
   */
  async borrarGenerado(clave: string, empresaId: string) {
    const p = this.propio(clave, empresaId);
    if (p.carpeta !== 'trabajos') throw new ForbiddenException({ mensaje: 'Solo se borran los archivos preparados por la cola de trabajos.' });
    if (p.almacen === 's3') await this.cliente().send(new DeleteObjectCommand({ Bucket: this.bucket, Key: p.ruta }));
    else await unlink(this.rutaLocal(p.ruta)).catch(() => undefined);
  }

  /**
   * Enlace firmado de 5 minutos. Quien lo pide ya verificó el permiso. En S3 lo firma el almacenamiento (el archivo
   * no pasa por el API); en el almacén local lo sirve `GET /archivos/d/:token`.
   */
  async enlace(clave: string, empresaId: string, o: OpcionesEnlace = {}): Promise<Enlace> {
    const p = this.propio(clave, empresaId);
    const segundos = Math.min(Math.max(o.segundos ?? 300, 30), 3600);
    const vence = new Date(Date.now() + segundos * 1000).toISOString();
    const nombre = (o.nombre ?? `archivo.${p.ext}`).replace(/[^\w.\- ()áéíóúÁÉÍÓÚñÑ]/g, '_').slice(0, 120);
    const disposicion = `${o.adjunto ? 'attachment' : 'inline'}; filename="${nombre.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(nombre)}`;
    if (p.almacen === 's3') {
      const url = await getSignedUrl(this.cliente(), new GetObjectCommand({ Bucket: this.bucket, Key: p.ruta, ResponseContentDisposition: disposicion, ResponseContentType: MIME[p.ext] }), { expiresIn: segundos });
      return { url, vence };
    }
    const datos = Buffer.from(JSON.stringify({ k: clave, e: empresaId, d: disposicion, x: Math.floor(Date.now() / 1000) + segundos })).toString('base64url');
    return { url: `/archivos/d/${datos}.${this.firma(datos)}`, vence };
  }

  /** Responde con el archivo: en S3, redirige a un enlace firmado corto; en el almacén local, lo envía. */
  async servir(res: Response, clave: string, empresaId: string, o: OpcionesEnlace = {}) {
    const p = this.propio(clave, empresaId);
    const e = await this.enlace(clave, empresaId, { ...o, segundos: 60 });
    res.setHeader('Cache-Control', 'private, no-store');
    if (p.almacen === 's3') return res.redirect(302, e.url);
    return res.redirect(302, `${PREFIJO_API}${e.url}`);
  }

  /** Sirve el archivo de un enlace local vigente (desarrollo; en S3 el enlace va directo al almacenamiento). */
  async descargarEnlace(token: string, res: Response) {
    const [datos = '', firma = ''] = token.split('.');
    const dada = Buffer.from(firma), esperada = Buffer.from(this.firma(datos));
    const valida = !!datos && dada.length === esperada.length && timingSafeEqual(dada, esperada);
    const p = valida ? (() => { try { return JSON.parse(Buffer.from(datos, 'base64url').toString()) as { k: string; e: string; d: string; x: number }; } catch { return null; } })() : null;
    if (!p || p.x < Date.now() / 1000) throw new ForbiddenException({ mensaje: 'El enlace de descarga venció o no es válido. Pídalo de nuevo.' });
    const { buf, mime } = await this.leer(p.k, p.e);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', p.d);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buf);
  }

  private firma(datos: string) { return createHmac('sha256', this.claveEnlaces).update(datos).digest('base64url'); }

  private propio(clave: string, empresaId: string) {
    const p = partes(clave);
    if (!p) throw new NotFoundException({ mensaje: 'Archivo no encontrado.' });
    if (p.empresa !== empresaId) throw new ForbiddenException({ mensaje: 'Archivo de otra empresa.' });
    return p;
  }

  private cliente() {
    if (!this.s3 || !this.bucket) throw new BadRequestException({ mensaje: 'El almacenamiento S3 no está configurado (S3_BUCKET).' });
    return this.s3;
  }

  private rutaLocal(ruta: string) {
    const r = resolve(this.raiz, ruta);
    if (!r.startsWith(this.raiz + sep)) throw new BadRequestException({ mensaje: 'Clave de archivo inválida.' });
    return r;
  }
}

/** Convierte una firma capturada en el celular («data:image/png;base64,…») en bytes. */
export function firmaDesdeDataUrl(dataUrl: string): Buffer {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!m) throw new BadRequestException({ mensaje: 'La firma debe ser una imagen PNG.' });
  return Buffer.from(m[1], 'base64');
}

const ClaveArchivo = z.object({ clave: z.string().max(200), nombre: z.string().max(120).optional(), adjunto: z.enum(['true', 'false']).optional() });

@Controller('archivos')
class ArchivosController {
  constructor(private readonly archivos: Archivos) {}
  /** Enlace firmado (5 minutos) a un archivo de la empresa del usuario: firma, foto o PDF. */
  @Get('enlace') enlace(@ActorActual() a: Actor, @Query(new Zod(ClaveArchivo)) q: z.infer<typeof ClaveArchivo>) {
    return this.archivos.enlace(q.clave, a.empresaId, { nombre: q.nombre, adjunto: q.adjunto === 'true' });
  }
  /** Compatibilidad: verifica la empresa y redirige al enlace firmado (el archivo no pasa por aquí en S3). */
  @Get() descargar(@ActorActual() a: Actor, @Query(new Zod(ClaveArchivo)) q: z.infer<typeof ClaveArchivo>, @Res() res: Response) {
    return this.archivos.servir(res, q.clave, a.empresaId, { nombre: q.nombre, adjunto: q.adjunto === 'true' });
  }
  /** Enlace firmado del almacén local (desarrollo). El token es la autorización: sin sesión. */
  @Publico() @Get('d/:token') porEnlace(@Param('token') token: string, @Res() res: Response) { return this.archivos.descargarEnlace(token, res); }
}

@Global()
@Module({ controllers: [ArchivosController], providers: [Archivos], exports: [Archivos] })
export class ArchivosModule {}
