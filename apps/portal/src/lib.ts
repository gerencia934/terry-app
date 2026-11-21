// Cliente del servidor del portal (/api/v1, misma dirección). La sesión va en una cookie que el navegador no deja leer.
export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export class ErrorApi extends Error {
  status: number; codigo?: string;
  constructor(status: number, mensaje: string, codigo?: string) { super(mensaje); this.status = status; this.codigo = codigo; }
}

export async function api<T = unknown>(ruta: string, cuerpo?: unknown, metodo?: string): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`/api/v1/${ruta}`, {
      method: metodo ?? (cuerpo !== undefined ? 'POST' : 'GET'),
      headers: cuerpo !== undefined ? { 'content-type': 'application/json' } : {},
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    });
  } catch { throw new ErrorApi(0, 'No hay conexión con el portal. Revise su internet e intente de nuevo.'); }
  const texto = await r.text();
  let d: { mensaje?: string; codigo?: string } | null = null;
  try { d = texto ? JSON.parse(texto) : null; } catch { /* respuesta sin JSON */ }
  if (!r.ok) throw new ErrorApi(r.status, d?.mensaje ?? `Error ${r.status}`, d?.codigo);
  return d as T;
}
export const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : 'Algo salió mal. Intente de nuevo.');

export type IdModulo = 'residuos' | 'mantenimiento' | 'crm' | 'planta';
export interface ModuloMenu {
  id: IdModulo; nombre: string; descripcion: string; acceso: boolean; url: string | null;
  estado: 'disponible' | 'sin-respuesta' | 'proximamente' | null;
}
export interface Yo {
  cuenta: { nombre: string; email: string; esAdmin: boolean; codigoDesde: string | null; codigosRespaldo: number };
  modulos: ModuloMenu[];
}
export interface CuentaAdmin {
  id: string; email: string; nombre: string; esAdmin: boolean; activa: boolean; conClave: boolean; conCodigo: boolean;
  ultimoIngreso: string | null; creadaEn: string; modulos: IdModulo[];
  /** «Olvidé mi contraseña» sin atender: cuándo la pidió. */
  restablecerPedidoEn?: string | null;
}
// Nombres oficiales del ERP Terry-App (estándar 4 de docs/ECOSISTEMA.md)
export const NOMBRES_MODULOS: Record<IdModulo, string> = { residuos: 'Residuos', mantenimiento: 'Mtto', crm: 'CRM', planta: 'Planta' };

export const fechaHora = (s: string | null) =>
  s ? new Date(s).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

/** Descarga un texto como archivo (los códigos de respaldo). */
export function descargarTexto(nombre: string, texto: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([texto], { type: 'text/plain;charset=utf-8' }));
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
