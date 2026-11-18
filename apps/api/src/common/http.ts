import {
  ArgumentsHost, BadRequestException, Catch, ExceptionFilter, HttpException, HttpStatus, Injectable, Logger, PipeTransform,
  SetMetadata, createParamDecorator, ExecutionContext,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { ZodError, type ZodSchema } from 'zod';

/** Usuario autenticado (lo pone el guard a partir del token). */
export interface Actor { id: string; empresaId: string; rol: string; permisos: string[]; nombre: string }
export const ActorActual = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => ctx.switchToHttp().getRequest().actor);

export const PUBLICO = 'publico';
/** Ruta sin autenticación (login, recuperación, salud). */
export const Publico = () => SetMetadata(PUBLICO, true);
export const PERMISO = 'permiso';
/** Exige un permiso del rol, p. ej. @Permiso('declaraciones.autorizar'). */
export const Permiso = (codigo: string) => SetMetadata(PERMISO, codigo);

/** Valida el cuerpo o la consulta con un esquema Zod y responde 400 con mensajes en español. */
@Injectable()
export class Zod implements PipeTransform {
  constructor(private readonly esquema: ZodSchema) {}
  transform(valor: unknown) {
    const r = this.esquema.safeParse(valor);
    if (!r.success) throw new BadRequestException({ mensaje: 'Datos inválidos', detalles: r.error.issues.map((i) => ({ campo: i.path.join('.'), mensaje: i.message })) });
    return r.data;
  }
}

/** Traduce errores de base de datos a respuestas HTTP claras. */
@Catch()
export class FiltroErrores implements ExceptionFilter {
  private readonly log = new Logger('Errores');
  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let cuerpo: Record<string, unknown> = { mensaje: 'Error interno. Intente de nuevo o contacte al administrador.' };

    if (err instanceof HttpException) {
      status = err.getStatus();
      const r = err.getResponse();
      cuerpo = typeof r === 'string' ? { mensaje: r } : (r as Record<string, unknown>).mensaje ? (r as Record<string, unknown>) : { mensaje: (r as { message?: unknown }).message ?? err.message };
    } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') { status = 409; cuerpo = { mensaje: `Ya existe un registro con ese valor (${(err.meta?.target as string[] | undefined)?.join(', ') ?? 'campo único'}).` }; }
      else if (err.code === 'P2025') { status = 404; cuerpo = { mensaje: 'Registro no encontrado.' }; }
      else if (err.code === 'P2003') { status = 409; cuerpo = { mensaje: 'El registro está relacionado con otros datos y no se puede modificar así.' }; }
      else if (err.code === 'P2010' || err.code === 'P2034') { const m = reglaNegocio(err.message); if (m) { status = 409; cuerpo = { mensaje: m }; } }
    } else if (err instanceof Prisma.PrismaClientUnknownRequestError) {
      const m = reglaNegocio(err.message);
      if (m) { status = 409; cuerpo = { mensaje: m }; }
    } else if (err instanceof ZodError) {
      status = 400; cuerpo = { mensaje: 'Datos inválidos', detalles: err.issues };
    }
    if (status >= 500) this.log.error(`${req.method} ${req.url}`, err instanceof Error ? err.stack : String(err));
    res.status(status).json(cuerpo);
  }
}

/** Extrae el mensaje de un RAISE EXCEPTION de los triggers de reglas de negocio (código P0001). */
export function reglaNegocio(msg: string): string | null {
  if (!/P0001|raise_exception/i.test(msg) && !/no puede salir|no está autorizada|justificaci/i.test(msg)) return null;
  // Prisma entrega: PostgresError { code: "P0001", message: "texto del RAISE", ... }
  const m = msg.match(/message:\s*"([^"]+)"/) ?? msg.match(/(La ruta[^"\n]+|La declaración[^"\n]+)/);
  return (m?.[1] ?? 'Operación bloqueada por una regla de negocio.').trim();
}

export const paginar = (q: { pagina?: number; porPagina?: number }) => {
  const porPagina = Math.min(Math.max(Number(q.porPagina) || 50, 1), 500);
  const pagina = Math.max(Number(q.pagina) || 1, 1);
  return { take: porPagina, skip: (pagina - 1) * porPagina, pagina, porPagina };
};
