// Módulos del ecosistema Terry-App y su estado. Cada módulo es una aplicación aparte (docs/ECOSISTEMA.md): el portal
// solo sabe su dirección, si ya acepta el pase y si responde. Un módulo caído no afecta a los demás.

export type IdModulo = 'residuos' | 'mantenimiento' | 'crm' | 'planta';
export const IDS_MODULOS: readonly IdModulo[] = ['residuos', 'mantenimiento', 'crm', 'planta'];

interface Definicion { id: IdModulo; nombre: string; descripcion: string; variable: string; defecto: string }
const DEFINICIONES: Definicion[] = [
  { id: 'residuos', nombre: 'Gestión de Residuos', descripcion: 'Recolección, manifiestos, certificados y portal de clientes', variable: 'MODULO_RESIDUOS_URL', defecto: 'https://residuos.terravivasas.net' },
  { id: 'mantenimiento', nombre: 'Mantenimiento', descripcion: 'Flota, maquinaria, órdenes de trabajo y preoperacionales', variable: 'MODULO_MANTENIMIENTO_URL', defecto: 'https://mantenimiento.terravivasas.net' },
  { id: 'crm', nombre: 'CRM Comercial', descripcion: 'Prospectos, visitas con check-in GPS y cotizaciones', variable: 'MODULO_CRM_URL', defecto: '' },
  { id: 'planta', nombre: 'Tratamiento y Planta', descripcion: 'Cronograma diario, formatos y cumplimiento ambiental', variable: 'MODULO_PLANTA_URL', defecto: '' },
];

export type EstadoModulo = 'disponible' | 'sin-respuesta' | 'proximamente';
export interface Modulo { id: IdModulo; nombre: string; descripcion: string; url: string | null; sso: boolean }

/** Los módulos con su dirección (variables MODULO_*_URL; vacía = próximamente) y si aceptan el pase (MODULOS_SSO). */
export function modulos(env: Record<string, unknown>): Modulo[] {
  const conSso = new Set(String(env.MODULOS_SSO ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  return DEFINICIONES.map((d) => {
    const valor = typeof env[d.variable] === 'string' ? (env[d.variable] as string).trim() : d.defecto;
    const url = /^https?:\/\/[^\s/]+/i.test(valor) ? valor.replace(/\/+$/, '') : null;
    return { id: d.id, nombre: d.nombre, descripcion: d.descripcion, url, sso: !!url && conSso.has(d.id) };
  });
}

// Estado de cada módulo: su /api/v1/salud, con 3 segundos de espera y 30 segundos de memoria (por copia del servidor)
const memoria = new Map<string, { estado: EstadoModulo; hasta: number }>();
export async function estado(m: Modulo, consultar: typeof fetch = fetch): Promise<EstadoModulo> {
  if (!m.url) return 'proximamente';
  const guardado = memoria.get(m.url);
  if (guardado && guardado.hasta > Date.now()) return guardado.estado;
  let e: EstadoModulo = 'sin-respuesta';
  try {
    const r = await consultar(`${m.url}/api/v1/salud`, { signal: AbortSignal.timeout(3000), headers: { accept: 'application/json' } });
    if (r.ok) e = 'disponible';
  } catch { /* sin respuesta: el cuadro sale en gris y los demás siguen */ }
  memoria.set(m.url, { estado: e, hasta: Date.now() + 30_000 });
  return e;
}
export const olvidarEstados = () => memoria.clear();

/**
 * Antes de firmar un pase (vale 60 s), el módulo debe estar despierto: un servidor en contenedor que se durmió puede tardar
 * más de un minuto en arrancar, y el pase vencería en el camino. Espera hasta 25 s por intento; la pantalla reintenta.
 */
export async function despertar(m: Modulo, consultar: typeof fetch = fetch, ms = 25_000): Promise<boolean> {
  if (!m.url) return false;
  try {
    const r = await consultar(`${m.url}/api/v1/salud`, { signal: AbortSignal.timeout(ms), headers: { accept: 'application/json' } });
    if (r.ok) { memoria.set(m.url, { estado: 'disponible', hasta: Date.now() + 30_000 }); return true; }
  } catch { /* sigue dormido o caído: la pantalla vuelve a intentar */ }
  return false;
}
