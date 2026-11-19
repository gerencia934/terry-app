import { z } from 'zod';

/** Variables de entorno validadas al arrancar: si falta algo, el servidor no inicia y dice qué falta. */
const Esquema = z.object({
  DATABASE_URL: z.string().url('DATABASE_URL debe ser una URL de PostgreSQL'),
  PORT: z.coerce.number().default(3000),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  WEB_URL: z.string().default('http://localhost:5173'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  JWT_ACCESS_MIN: z.coerce.number().default(15),
  REFRESH_DIAS: z.coerce.number().default(30),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  MAIL_FROM: z.string().default('TERRY-GO · Terra Viva <no-responder@terravivasas.com>'),
  // Ley 1581: versión vigente de la política de tratamiento de datos (al cambiarla, se pide aceptar de nuevo) y su enlace.
  // Respuesta B1 de la gerencia: sin política publicada nadie entra. En producción el servidor no arranca sin ellas; en
  // desarrollo y pruebas se usa la versión «borrador» y la pantalla de aceptación lo advierte.
  POLITICA_DATOS_VERSION: z.string().trim().max(20).default(''),
  POLITICA_DATOS_URL: z.string().trim().default(''),
  NODE_ENV: z.string().default('development'),
  // Archivos (firmas, fotos, PDF). En desarrollo, carpeta local; en producción se cambia a S3 / R2.
  ALMACENAMIENTO_DIR: z.string().default('almacenamiento'),
  ARCHIVO_MAX_MB: z.coerce.number().default(10),
  // Límite de peticiones por minuto en cada pantalla: por usuario con sesión, por IP sin ella
  LIMITE_PETICIONES_MIN: z.coerce.number().int().min(10).default(300),
  // Techo por IP en ingreso / recuperar contraseña, sumando todos los correos (contra el rociado de contraseñas)
  LIMITE_INGRESOS_IP_MIN: z.coerce.number().int().min(5).default(60),
});
export type Config = z.infer<typeof Esquema>;

export function validarConfig(env: Record<string, unknown>): Config {
  const r = Esquema.safeParse(env);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuración inválida. Revise el archivo .env:\n${msg}`);
  }
  if (!r.data.POLITICA_DATOS_VERSION || !r.data.POLITICA_DATOS_URL) {
    if (r.data.NODE_ENV === 'production')
      throw new Error('Falta la política de tratamiento de datos (Ley 1581): defina POLITICA_DATOS_URL y POLITICA_DATOS_VERSION. Sin ella nadie puede entrar.');
    return { ...r.data, POLITICA_DATOS_VERSION: r.data.POLITICA_DATOS_VERSION || 'borrador' };
  }
  return r.data;
}
