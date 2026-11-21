import { z } from 'zod';

/** Variables de entorno validadas al arrancar: si falta algo, el servidor no inicia y dice qué falta. */
/** Una variable vacía en el .env vale como no escrita: toma el valor por omisión. */
const sinVacio = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), s);
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
  MAIL_FROM: z.string().default('Terry-App · Terra Viva <no-responder@terravivasas.com>'),
  // Ley 1581: versión vigente de la política de tratamiento de datos (al cambiarla, se pide aceptar de nuevo) y su enlace.
  // Respuesta B1 de la gerencia: sin política publicada nadie entra. En producción el servidor no arranca sin ellas; en
  // desarrollo y pruebas se usa la versión «borrador» y la pantalla de aceptación lo advierte.
  POLITICA_DATOS_VERSION: z.string().trim().max(20).default(''),
  POLITICA_DATOS_URL: z.string().trim().default(''),
  // Entrada única del ecosistema Terry-App (docs/ECOSISTEMA.md): dirección del portal y su clave pública Ed25519 (la «x»
  // del JWK, en base64url). Sin ellas el pase del portal no se acepta y solo sirve la entrada propia de Residuos.
  PORTAL_URL: z.string().trim().default(''),
  PORTAL_CLAVE_PUBLICA: z.string().trim().regex(/^([A-Za-z0-9_-]{43})?$/, 'PORTAL_CLAVE_PUBLICA debe ser la «x» de un JWK Ed25519 (43 caracteres base64url)').default(''),
  NODE_ENV: z.string().default('development'),
  // Archivos (firmas, fotos, PDF). En desarrollo, carpeta local; en producción se cambia a S3 / R2.
  ALMACENAMIENTO_DIR: z.string().default('almacenamiento'),
  // Dónde se guardan los archivos nuevos: «local» (carpeta ALMACENAMIENTO_DIR, para desarrollo) o «s3» (S3, R2 o MinIO).
  // Los enlaces de descarga son firmados y vencen en 5 minutos; en S3 el archivo no pasa por el API.
  ALMACENAMIENTO: sinVacio(z.enum(['local', 's3']).default('local')),
  S3_BUCKET: z.string().trim().default(''),
  S3_REGION: z.string().trim().default('us-east-1'), // Cloudflare R2: «auto»
  S3_ENDPOINT: z.string().trim().default(''), // vacío = AWS; R2 o MinIO: su dirección
  S3_RUTA_EN_URL: sinVacio(z.enum(['true', 'false']).default('false')).transform((v) => v === 'true'), // MinIO: true
  S3_ACCESS_KEY_ID: z.string().trim().default(''), // vacío = credenciales del entorno (rol del servidor)
  S3_SECRET_ACCESS_KEY: z.string().trim().default(''),
  // Cloudflare R2 con sus propios nombres (equivalen a los S3_*): bucket, cuenta (arma la dirección si falta R2_ENDPOINT) y claves
  R2_BUCKET_NAME: z.string().trim().default(''), R2_ACCOUNT_ID: z.string().trim().default(''), R2_ENDPOINT: z.string().trim().default(''),
  R2_ACCESS_KEY_ID: z.string().trim().default(''), R2_SECRET_ACCESS_KEY: z.string().trim().default(''),
  // Correo diario de alertas por rol (la hora y si va se fijan en Ajustes › Datos de la empresa)
  RESUMEN_DIARIO: sinVacio(z.enum(['true', 'false']).default('true')).transform((v) => v === 'true'),
  // Avisos de errores del servidor: a estos correos (separados por coma); vacío = a los administradores de la empresa
  ALERTAS_CORREO: z.string().trim().default(''),
  // Solo para las pruebas automáticas: GET /salud/error-de-prueba responde un error interno (apagado en producción)
  PRUEBAS_ERRORES: sinVacio(z.enum(['true', 'false']).default('false')).transform((v) => v === 'true'),
  // Siigo Nube: facturas y pagos de los manifiestos. Las claves van solo en el .env del API (nunca en la web ni en git).
  SIIGO_URL: z.string().trim().url().default('https://api.siigo.com'),
  SIIGO_USERNAME: z.string().trim().default(''), SIIGO_ACCESS_KEY: z.string().trim().default(''), SIIGO_PARTNER_ID: z.string().trim().default(''),
  // NIT de la empresa dueña de la cuenta de Siigo: solo ella se sincroniza. Vacío = la única empresa de la instalación.
  SIIGO_EMPRESA_NIT: z.string().trim().default(''),
  // Sincronización diaria (a esta hora de Colombia, una vez por día aunque haya varias copias del API)
  SIIGO_SINCRONIZAR: sinVacio(z.enum(['true', 'false']).default('true')).transform((v) => v === 'true'),
  SIIGO_HORA: sinVacio(z.coerce.number().int().min(0).max(23).default(6)),
  // Wialon (GPS de la flota): API remota con un token de SOLO LECTURA, solo en el .env del API. Vacío = sin Wialon
  // (la operación sigue igual: las etapas las marca el conductor). Wialon Local usa otra dirección.
  WIALON_URL: z.string().trim().url().default('https://hst-api.wialon.com'),
  WIALON_TOKEN: z.string().trim().default(''),
  // NIT de la empresa dueña de la cuenta de Wialon. Vacío = la única empresa de la instalación.
  WIALON_EMPRESA_NIT: z.string().trim().default(''),
  // Consulta automática cada tantos segundos (30 a 300); false = solo con el botón «Actualizar» (pruebas)
  WIALON_CONSULTAR: sinVacio(z.enum(['true', 'false']).default('true')).transform((v) => v === 'true'),
  WIALON_INTERVALO: sinVacio(z.coerce.number().int().min(30).max(300).default(60)),
  // Mantenimiento (Portal Logístico): el preoperacional, los vehículos y las fallas viven allá. Residuos le pregunta de
  // servidor a servidor con un token propio (solo secreto del Worker). Vacío = sin conexión: ninguna ruta se abre sin una
  // excepción de la oficina. MANTENIMIENTO_VOLVER es la clave que Mantenimiento conoce para devolver al conductor a su ruta.
  MANTENIMIENTO_URL: z.string().trim().default(''),
  MANTENIMIENTO_TOKEN: z.string().trim().default(''),
  MANTENIMIENTO_VOLVER: z.string().trim().regex(/^[a-z-]{1,30}$/).default('residuos'),
  // Notificaciones push (Web Push): llaves VAPID (se generan una vez). Sin ellas no hay avisos y la app sigue igual.
  VAPID_PUBLICA: z.string().trim().default(''),
  VAPID_PRIVADA: z.string().trim().default(''),
  // Contacto que ven los servicios de push (Google, Apple, Mozilla): la página de Terra Viva, no un correo personal
  VAPID_CONTACTO: z.string().trim().default('https://terravivasas.net'),
  // Solo pruebas automáticas: no envía; guarda los avisos para revisarlos (GET /notificaciones/push/pruebas)
  PUSH_PRUEBAS: sinVacio(z.enum(['true', 'false']).default('false')).transform((v) => v === 'true'),
  // Formulario del sitio web (módulo Comercial): NIT de la empresa que recibe los prospectos. Vacío = la única empresa.
  FORMULARIO_WEB_EMPRESA_NIT: z.string().trim().default(''),
  // Cola de trabajos (ZIP, Excel): esta copia del API los procesa (en producción puede haber una copia solo para eso)
  TRABAJOS_PROCESAR: sinVacio(z.enum(['true', 'false']).default('true')).transform((v) => v === 'true'),
  TRABAJOS_SIMULTANEOS: sinVacio(z.coerce.number().int().min(1).max(8).default(2)),
  TRABAJOS_DIAS: sinVacio(z.coerce.number().int().min(1).max(90).default(7)), // días que se guarda el archivo preparado
  ARCHIVO_MAX_MB: z.coerce.number().default(10),
  // Límite de peticiones por minuto en cada pantalla: por usuario con sesión, por IP sin ella
  LIMITE_PETICIONES_MIN: z.coerce.number().int().min(10).default(300),
  // Techo por IP en ingreso / recuperar contraseña, sumando todos los correos (contra el rociado de contraseñas)
  LIMITE_INGRESOS_IP_MIN: z.coerce.number().int().min(5).default(60),
  // Verificación en dos pasos: clave para cifrar los secretos TOTP y la huella de los códigos de respaldo. Si falta, se
  // deriva de JWT_SECRET (cambiar cualquiera de las dos obliga a configurar de nuevo la verificación en dos pasos).
  CLAVE_2FA: z.string().trim().refine((v) => v === '' || v.length >= 32, 'CLAVE_2FA: mínimo 32 caracteres').default(''),
});
export type Config = z.infer<typeof Esquema>;

export function validarConfig(env: Record<string, unknown>): Config {
  const r = Esquema.safeParse(env);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuración inválida. Revise el archivo .env:\n${msg}`);
  }
  // Cloudflare R2: sus nombres llenan los S3_* que falten (la dirección sale de la cuenta si no viene escrita)
  const d = r.data;
  if (d.R2_BUCKET_NAME && !d.S3_BUCKET) {
    d.S3_BUCKET = d.R2_BUCKET_NAME;
    d.S3_ENDPOINT ||= d.R2_ENDPOINT.replace(/\/+$/, '') || (d.R2_ACCOUNT_ID ? `https://${d.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : '');
    d.S3_ACCESS_KEY_ID ||= d.R2_ACCESS_KEY_ID; d.S3_SECRET_ACCESS_KEY ||= d.R2_SECRET_ACCESS_KEY;
    if (d.S3_REGION === 'us-east-1') d.S3_REGION = 'auto';
  }
  if (d.ALMACENAMIENTO === 's3' && !d.S3_BUCKET) throw new Error('ALMACENAMIENTO=s3 necesita S3_BUCKET o R2_BUCKET_NAME (y la dirección si no es AWS).');
  if (d.ALMACENAMIENTO === 's3' && !d.S3_ENDPOINT && d.R2_ACCOUNT_ID) throw new Error('Cloudflare R2 necesita R2_ENDPOINT o R2_ACCOUNT_ID.');
  if (!r.data.POLITICA_DATOS_VERSION || !r.data.POLITICA_DATOS_URL) {
    if (r.data.NODE_ENV === 'production')
      throw new Error('Falta la política de tratamiento de datos (Ley 1581): defina POLITICA_DATOS_URL y POLITICA_DATOS_VERSION. Sin ella nadie puede entrar.');
    return { ...r.data, POLITICA_DATOS_VERSION: r.data.POLITICA_DATOS_VERSION || 'borrador' };
  }
  return r.data;
}
