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
  MAIL_FROM: z.string().default('Terra Viva <no-responder@terravivasas.com>'),
});
export type Config = z.infer<typeof Esquema>;

export function validarConfig(env: Record<string, unknown>): Config {
  const r = Esquema.safeParse(env);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuración inválida. Revise el archivo .env:\n${msg}`);
  }
  return r.data;
}
