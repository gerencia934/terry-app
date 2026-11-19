import {
  ArgumentsHost, BadRequestException, Catch, ExceptionFilter, HttpException, HttpStatus, Injectable, Logger, PipeTransform,
  SetMetadata, applyDecorators, createParamDecorator, ExecutionContext,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { ZodError, type ZodSchema } from 'zod';

/** Usuario autenticado (lo pone el guard a partir del token). */
export interface Actor { id: string; empresaId: string; rol: string; permisos: string[]; nombre: string; sesionId?: string }
export const ActorActual = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => ctx.switchToHttp().getRequest().actor);

export const PUBLICO = 'publico';
/** Ruta sin autenticación (login, recuperación, salud). */
export const Publico = () => SetMetadata(PUBLICO, true);
export const PERMISO = 'permiso';
export const SIN_DATOS = 'sinAceptarDatos';
/** Ruta que se puede usar antes de aceptar la política de datos personales (Ley 1581): ver quién soy, aceptar, salir. */
export const SinAceptarDatos = () => SetMetadata(SIN_DATOS, true);
/** Exige un permiso del rol, p. ej. @Permiso('declaraciones.autorizar'). */
export const Permiso = (codigo: string) => SetMetadata(PERMISO, codigo);

export const TECHO_IP = 'techoPorIp';
/**
 * Rutas de credenciales (ingreso, recuperar y restablecer la contraseña): `porCuenta` intentos por minuto para cada
 * correo desde una misma IP —así una oficina que sale a internet por una sola IP no se bloquea entera— y además un techo
 * por IP para todos los correos juntos (LIMITE_INGRESOS_IP_MIN), contra el rociado de contraseñas.
 */
export const LimiteCredenciales = (porCuenta: number) => applyDecorators(Throttle({ default: { limit: porCuenta, ttl: 60_000 } }), SetMetadata(TECHO_IP, true));

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
      // Errores propios del framework (en inglés): se cambian por un mensaje claro en español
      if (!(typeof r === 'object' && (r as Record<string, unknown>).mensaje) && MENSAJES_HTTP[status]) cuerpo = { mensaje: MENSAJES_HTTP[status] };
    } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') { status = 409; cuerpo = { mensaje: `Ya existe un registro con ese valor (${(err.meta?.target as string[] | undefined)?.join(', ') ?? 'campo único'}).` }; }
      else if (err.code === 'P2025') { status = 404; cuerpo = { mensaje: 'Registro no encontrado.' }; }
      else if (err.code === 'P2003') { status = 409; cuerpo = { mensaje: 'El registro está relacionado con otros datos y no se puede modificar así.' }; }
      else if (err.code === 'P2010' || err.code === 'P2034' || err.code === 'P2004') { const m = reglaNegocio(err.message); if (m) { status = 409; cuerpo = { mensaje: m }; } }
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

/** Mensaje en español de los errores HTTP que lanza el framework sin texto propio. */
const MENSAJES_HTTP: Record<number, string> = {
  401: 'Su sesión no es válida o venció. Ingrese de nuevo.',
  403: 'No tiene permiso para esta acción.',
  404: 'No se encontró lo que busca.',
  413: 'El archivo es demasiado grande (máximo 10 MB).',
  429: 'Demasiados intentos seguidos. Espere un minuto y vuelva a intentar.',
};

/** Mensajes de las restricciones CHECK de la base de datos (código 23514). */
const CHECKS: Record<string, string> = {
  chk_cargue_formato: 'Un cargue en CSV debe registrar su separador.',
  chk_cargue_revertido: 'Para deshacer un cargue se registra quién, cuándo y el motivo (mínimo 10 caracteres).',
  chk_decl_residuo_completo: 'Faltan datos obligatorios del residuo (tipo, embalaje, material, estado físico, inflamable, sustancia controlada o proceso).',
  chk_decl_servicio_completo: 'Falta la descripción del servicio.',
  chk_decl_peligroso: 'Un residuo peligroso necesita la composición y una corriente Y o código A.',
  chk_decl_responsabilidad: 'El generador debe aceptar la declaración de responsabilidad.',
  chk_decl_activa_autorizada: 'Solo una declaración autorizada puede estar activa.',
  chk_decl_codigo_un: 'El código UN debe tener el formato UN y 4 dígitos.',
  chk_decl_densidad: 'Indique la densidad y su métrica, o ninguna.',
  chk_decl_densidad_pos: 'La densidad debe ser mayor que cero.',
  chk_decl_frecuencia: 'La frecuencia debe estar entre 1 y 366 días.',
  chk_decl_cantidad: 'La cantidad por frecuencia debe ser mayor que cero.',
  chk_decl_auto_frecuencia: 'La solicitud automática necesita la frecuencia en días.',
  chk_decl_fds_peligroso: 'Un residuo peligroso no se puede autorizar sin la ficha de datos de seguridad.',
  chk_item_cantidad: 'La cantidad de la línea debe ser mayor que cero.',
  chk_item_descarte_causal: 'Indique la causal para descartar la línea.',
  chk_sol_aprobada: 'Falta la fecha de aprobación de la solicitud.',
  chk_sol_cancelada: 'Indique la causal de cancelación.',
  chk_sol_pre_activacion: 'La solicitud recurrente necesita su fecha de activación.',
  chk_ruta_frecuencia: 'La frecuencia de la ruta debe estar entre 1 y 366 días.',
  chk_ruta_recurrente: 'Una ruta recurrente necesita su frecuencia en días.',
  chk_ruta_flete: 'El valor del flete no puede ser negativo.',
  chk_ruta_km: 'El kilometraje final no puede ser menor que el inicial.',
  chk_rastreo_coordenadas: 'Coordenadas fuera de Colombia.',
  chk_mf_pesos: 'Los pesos de báscula no pueden ser negativos.',
  chk_mf_peso_neto: 'El peso neto debe ser igual a la entrada menos la salida.',
  chk_mf_horas: 'La hora de salida no puede ser anterior a la de llegada.',
  chk_mf_descargue_sin_ruta: 'Un manifiesto de descargue no lleva ruta.',
  chk_mf_anulado: 'Indique la causal o el motivo de la anulación.',
  chk_mf_item_cantidad: 'La cantidad de la línea debe ser mayor que cero.',
  chk_mf_item_precio: 'El precio no puede ser negativo.',
  chk_conc_cantidad: 'La cantidad conciliada no puede ser negativa.',
  chk_conc_precio: 'El precio no puede ser negativo.',
  chk_conc_factura_fechas: 'El vencimiento de la factura no puede ser anterior a su emisión.',
  chk_justificacion_diferencia: 'La diferencia entre lo cargado y lo conciliado supera ±2 %: escriba la justificación.',
  chk_acta_periodo: 'El periodo del acta está invertido.',
  chk_acta_anulada: 'Indique el motivo de la anulación del acta.',
  chk_acta_cargada: 'Adjunte el archivo del acta del gestor.',
  ux_ruta_item_vigente: 'Esa línea ya está programada en otra ruta.',
  chk_tarifa_precio: 'El precio no puede ser negativo.',
  chk_tarifa_vigencia: 'La fecha final de la tarifa no puede ser anterior a la inicial.',
};

/** Extrae el mensaje de un RAISE EXCEPTION de los triggers (P0001) o de una restricción CHECK (23514). */
export function reglaNegocio(msg: string): string | null {
  const check = Object.keys(CHECKS).find((k) => msg.includes(k));
  if (check) return CHECKS[check];
  if (/ux_sucursal_principal/.test(msg)) return 'El cliente ya tiene una sede principal.';
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

/**
 * Fecha calendario de HOY en Colombia, para columnas DATE (medianoche UTC de ese día).
 * Evita el error de tomar la fecha UTC: después de las 7 p. m. en Colombia, en UTC ya es mañana.
 */
export const fechaColombia = (d: Date = new Date()) => new Date(`${d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })}T00:00:00Z`);
