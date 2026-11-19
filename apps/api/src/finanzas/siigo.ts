// Cliente de la API de Siigo Nube (Colombia), solo lectura: TERRY-GO nunca escribe en Siigo.
// - Ingreso con usuario, clave de acceso y Partner-Id (POST /auth); el token dura 24 horas y se renueva solo.
// - Facturas de venta (/v1/invoices) y notas crédito (/v1/credit-notes), página por página y sin afanes (Siigo limita las
//   peticiones por minuto). El saldo de la factura («balance») dice si ya se pagó; una nota crédito por el total la anula.
// Las facturas de Terra Viva citan el manifiesto en sus observaciones («manifiesto 1830», «manifiestos 1830 1831»): así se
// cruza cada factura con su manifiesto, siempre que el NIT del cliente coincida.

export interface FacturaApi {
  id: string; name: string; date: string; total: number; balance: number;
  customer?: { identification?: string };
  observations?: string; items?: { description?: string }[];
  payments?: { due_date?: string; value?: number }[];
  stamp?: { status?: string }; public_url?: string;
  metadata?: { created?: string; last_updated?: string };
}
export interface NotaCreditoApi { id: string; name: string; total: number; invoice?: { id?: string; name?: string } }

export class ErrorSiigo extends Error {}
const espera = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

export class SiigoCliente {
  private token: { valor: string; vence: number } | null = null;
  constructor(private readonly o: { url: string; usuario: string; clave: string; partner: string; pausaMs?: number }) {}

  get configurado() { return !!(this.o.usuario && this.o.clave && this.o.partner); }

  private async autenticar() {
    if (this.token && this.token.vence > Date.now() + 120_000) return this.token.valor;
    let r: Response;
    try {
      r = await fetch(`${this.o.url.replace(/\/+$/, '')}/auth`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Partner-Id': this.o.partner },
        body: JSON.stringify({ username: this.o.usuario, access_key: this.o.clave }), signal: AbortSignal.timeout(30_000) });
    } catch { throw new ErrorSiigo('No hay conexión con Siigo. Intente de nuevo en unos minutos.'); }
    if (!r.ok) throw new ErrorSiigo([400, 401, 403].includes(r.status) ? 'Siigo no aceptó el usuario o la clave de acceso configurados en el servidor.' : `Siigo no respondió bien al ingresar (código ${r.status}).`);
    const j = (await r.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) throw new ErrorSiigo('Siigo no entregó el permiso de acceso.');
    this.token = { valor: j.access_token, vence: Date.now() + (j.expires_in ?? 86_400) * 1000 };
    return j.access_token;
  }

  private async get<T>(ruta: string, intento = 1): Promise<T> {
    const t = await this.autenticar();
    let r: Response;
    try {
      r = await fetch(`${this.o.url.replace(/\/+$/, '')}${ruta}`, { headers: { Authorization: `Bearer ${t}`, 'Partner-Id': this.o.partner }, signal: AbortSignal.timeout(60_000) });
    } catch {
      if (intento <= 2) { await espera(3_000 * intento); return this.get(ruta, intento + 1); }
      throw new ErrorSiigo('Siigo no respondió a tiempo. Intente de nuevo en unos minutos.');
    }
    if (r.status === 401 && intento === 1) { this.token = null; return this.get(ruta, 2); }
    if ((r.status === 429 || r.status >= 500) && intento <= 3) { await espera(5_000 * intento); return this.get(ruta, intento + 1); }
    if (!r.ok) throw new ErrorSiigo(`Siigo respondió con el código ${r.status} al consultar ${ruta.split('?')[0]}.`);
    return (await r.json()) as T;
  }

  /** Todas las páginas de facturas o de notas crédito (de 100 en 100). */
  async todas<T>(recurso: 'invoices' | 'credit-notes'): Promise<T[]> {
    const out: T[] = [];
    for (let p = 1; p <= 1000; p++) {
      const j = await this.get<{ pagination?: { total_results?: number }; results?: T[] }>(`/v1/${recurso}?page=${p}&page_size=100`);
      out.push(...(j.results ?? []));
      if (!j.results?.length || out.length >= (j.pagination?.total_results ?? 0)) break;
      await espera(this.o.pausaMs ?? 300);
    }
    return out;
  }

  /** Una factura por su nombre (FV-2-1234). */
  async facturaPorNombre(nombre: string) {
    const j = await this.get<{ results?: FacturaApi[] }>(`/v1/invoices?name=${encodeURIComponent(nombre)}`);
    return j.results?.find((f) => f.name?.toUpperCase() === nombre.toUpperCase()) ?? null;
  }
}

/**
 * Números de manifiesto que cita una factura: «manifiesto 1830», «manifiestos 1830 1831 y 1835», «manifiesto No. 1830»,
 * «manifiestos: 1830, 1831», «manifiestos 1830-1834» (rango corto) o con la sigla («TV1830»). Devuelve solo el número.
 */
export function manifiestosCitados(texto: string): string[] {
  const out = new Set<string>();
  const lista = /manifiestos?\b\s*(?:(?:n(?:o|ro|ros)?|n[°º])\.?\s*|#\s*|:\s*)*((?:(?:tv)?\s*-?\s*\d{1,7}(?:\s*(?:,|;|\/|\by\b|\be\b|-|–)\s*|\s+)?)+)/gi;
  for (const m of texto.matchAll(lista)) {
    for (const p of m[1].matchAll(/(?:tv)?\s*-?\s*(\d{1,7})(?:\s*[-–]\s*(?:tv)?\s*(\d{1,7}))?/gi)) {
      const a = Number(p[1]), b = p[2] ? Number(p[2]) : null;
      if (b !== null && b > a && b - a <= 60) for (let n = a; n <= b; n++) out.add(String(n));
      else { out.add(String(a)); if (b !== null) out.add(String(b)); }
    }
  }
  return [...out];
}

/** Estado de una factura en Siigo: anulada (notas crédito por el total), pagada (saldo 0), abonada o pendiente. */
export function estadoFactura(f: { total: number; balance: number }, notasCredito: number): 'PENDIENTE' | 'ABONADA' | 'PAGADA' | 'ANULADA' {
  if (notasCredito > 0 && notasCredito >= f.total - 1) return 'ANULADA';
  if (f.balance <= 0.5) return 'PAGADA';
  if (f.balance < f.total - notasCredito - 0.5) return 'ABONADA';
  return 'PENDIENTE';
}

/** Vencimiento: la primera fecha de pago de la factura (crédito); si no tiene, la fecha de la factura (contado). */
export function venceFactura(f: FacturaApi): string | null {
  const fechas = (f.payments ?? []).map((p) => p.due_date?.slice(0, 10)).filter((x): x is string => !!x && /^\d{4}-\d{2}-\d{2}$/.test(x)).sort();
  return fechas[0] ?? (f.date ? f.date.slice(0, 10) : null);
}
