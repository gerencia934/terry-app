import { neon } from '@neondatabase/serverless';

/** Acceso a la base del portal: una consulta con parámetros $1, $2… que devuelve las filas. */
export interface Db { q<T = Record<string, unknown>>(texto: string, valores?: unknown[]): Promise<T[]> }

/** En Cloudflare: Neon por HTTP (sin conexiones abiertas; la base se apaga sola cuando nadie entra). */
export function dbNeon(url: string): Db {
  const sql = neon(url);
  return { q: async <T>(texto: string, valores: unknown[] = []) => (await sql.query(texto, valores)) as T[] };
}
