// Archivos que sube el cliente desde el portal (ficha de seguridad, caracterización, orden de compra). El navegador
// recibe una referencia firmada y la devuelve al guardar: el servidor solo acepta archivos que subió ese mismo cliente.
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Config } from '../config';

/**
 * Referencia firmada de un archivo subido desde el portal: el navegador la devuelve al guardar la declaración o el
 * pedido, y el servidor comprueba que la subió ese mismo cliente (no acepta claves de archivos de otros).
 */
export class RefArchivos {
  private readonly clave: Buffer;
  constructor(cfg: ConfigService<Config, true>) {
    this.clave = createHmac('sha256', cfg.get('JWT_SECRET', { infer: true })).update('portal:archivos-subidos').digest();
  }
  firmar(clave: string, clienteId: string) {
    const datos = Buffer.from(JSON.stringify({ k: clave, c: clienteId, t: Math.floor(Date.now() / 1000) })).toString('base64url');
    return `${datos}.${createHmac('sha256', this.clave).update(datos).digest('base64url')}`;
  }
  /** Clave del archivo si la referencia es de este cliente y se subió en las últimas 24 horas. */
  leer(ref: string, clienteId: string): string {
    const [datos = '', firma = ''] = ref.split('.');
    const esperada = Buffer.from(createHmac('sha256', this.clave).update(datos).digest('base64url')), dada = Buffer.from(firma);
    const p = datos && dada.length === esperada.length && timingSafeEqual(dada, esperada)
      ? (() => { try { return JSON.parse(Buffer.from(datos, 'base64url').toString()) as { k: string; c: string; t: number }; } catch { return null; } })() : null;
    if (!p || p.c !== clienteId || p.t < Date.now() / 1000 - 86_400) throw new BadRequestException({ mensaje: 'El archivo adjunto no es válido o venció: súbalo de nuevo.' });
    return p.k;
  }
}
/** Clave del almacenamiento (no un enlace externo): «local:…» o «s3:…». */
export const esClaveAlmacen = (v: string | null | undefined) => !!v && /^(local|s3):/.test(v);

