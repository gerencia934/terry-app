// Datos de la petición en curso (IP y navegador) para la auditoría, sin pasarlos por cada servicio.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

export interface ContextoPeticion { ip: string | null; agente: string | null }
export const contextoPeticion = new AsyncLocalStorage<ContextoPeticion>();

/** Middleware: cada petición corre dentro de su contexto (detrás de Cloudflare, `trust proxy` toma la IP real). */
export function middlewareContexto(req: Request, _res: Response, next: NextFunction) {
  contextoPeticion.run({ ip: req.ip?.slice(0, 64) ?? null, agente: req.headers['user-agent']?.slice(0, 300) ?? null }, next);
}
