const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 });
export const fmtCOP = (v: number) => cop.format(v);
export const fmtNum = (v: number) => num.format(v);
export const fmtM = (v: number) => `$${num.format(v)} M`;
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const fmtFecha = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return `${d} ${MES[m - 1]} ${y}`; };
export const fmtFechaCorta = (iso: string) => { const [, m, d] = iso.slice(0, 10).split('-').map(Number); return `${d} ${MES[m - 1]}`; };
/** Fecha y hora de Colombia de un instante ISO: «19 nov 2026 15:45». */
export const fmtFechaHora = (iso: string) => { const f = new Date(iso).toLocaleString('sv-SE', { timeZone: 'America/Bogota' }); return `${fmtFecha(f)} ${f.slice(11, 16)}`; };
export const diasEntre = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
