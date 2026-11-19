import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, ChevronRight as Chevron, SlidersHorizontal, Columns3 } from 'lucide-react';
import { Button, Sheet } from './ui';
import { cx } from '../lib/format';

/**
 * ResponsiveTable — estrategia mobile-first para tablas masivas.
 * ≥ md: tabla completa con scroll horizontal propio y columnas ocultables.
 * < md: tarjetas. Título + estado arriba; solo columnas priority ≤ 2 en el cuerpo;
 *       el resto aparece al tocar la tarjeta (hoja inferior con el detalle).
 */
export interface Column<T> {
  key: string; header: string; render: (row: T) => ReactNode;
  priority?: 1 | 2 | 3; align?: 'left' | 'right' | 'center'; width?: string;
}
interface Props<T> {
  rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string;
  cardTitle: (r: T) => ReactNode; cardBadge?: (r: T) => ReactNode; cardMeta?: (r: T) => ReactNode;
  onRowClick?: (r: T) => void; selectable?: boolean; selected?: Set<string>; onSelectedChange?: (s: Set<string>) => void;
  empty?: ReactNode; footer?: ReactNode;
}
export function ResponsiveTable<T>({ rows, columns, rowKey, cardTitle, cardBadge, cardMeta, onRowClick, selectable, selected, onSelectedChange, empty, footer }: Props<T>) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [colMenu, setColMenu] = useState(false);
  const visible = columns.filter((c) => !hidden.has(c.key));
  const cardCols = columns.filter((c) => (c.priority ?? 3) <= 2);
  const allSel = selectable && rows.length > 0 && rows.every((r) => selected?.has(rowKey(r)));
  const toggle = (k: string) => { const s = new Set(selected); s.has(k) ? s.delete(k) : s.add(k); onSelectedChange?.(s); };
  const toggleAll = () => onSelectedChange?.(allSel ? new Set() : new Set(rows.map(rowKey)));

  if (!rows.length) return <div className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-muted">{empty ?? 'Sin resultados para estos filtros.'}</div>;

  return (
    <div className="min-w-0">
      {/* ---------- Escritorio ---------- */}
      <div className="hidden rounded-xl border border-line bg-surface md:block">
        <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2 text-[12px] text-muted">
          <span className="num">{rows.length} registros</span>
          <div className="relative">
            <Button size="sm" variant="ghost" onClick={() => setColMenu((v) => !v)} aria-expanded={colMenu}><Columns3 size={15} /> Columnas</Button>
            {colMenu && (
              <div className="absolute right-0 top-9 z-20 w-56 rounded-xl border border-line bg-surface p-2 shadow-lg">
                {columns.map((c) => (
                  <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-fg hover:bg-surface-2">
                    <input type="checkbox" className="accent-[rgb(var(--brand))]" checked={!hidden.has(c.key)}
                      onChange={() => { const h = new Set(hidden); h.has(c.key) ? h.delete(c.key) : h.add(c.key); setHidden(h); }} />
                    {c.header}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="scroll-x max-h-[65vh] overflow-y-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead className="sticky top-0 z-10 bg-surface-2">
              <tr>
                {selectable && <th className="w-10 px-3 py-2.5"><input type="checkbox" aria-label="Seleccionar todo" className="accent-[rgb(var(--brand))]" checked={!!allSel} onChange={toggleAll} /></th>}
                {visible.map((c) => (
                  <th key={c.key} style={{ width: c.width }} className={cx('whitespace-nowrap px-3 py-2.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted', c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left')}>{c.header}</th>
                ))}
                {onRowClick && <th className="w-8" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const k = rowKey(r);
                return (
                  <tr key={k} onClick={() => onRowClick?.(r)} className={cx('border-t border-line', onRowClick && 'cursor-pointer hover:bg-brand-soft/40', selected?.has(k) && 'bg-brand-soft/60')}>
                    {selectable && <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label="Seleccionar" className="accent-[rgb(var(--brand))]" checked={!!selected?.has(k)} onChange={() => toggle(k)} /></td>}
                    {visible.map((c) => (
                      <td key={c.key} className={cx('whitespace-nowrap px-3 py-2.5 align-middle', c.align === 'right' ? 'num text-right' : c.align === 'center' ? 'text-center' : 'text-left')}>{c.render(r)}</td>
                    ))}
                    {onRowClick && <td className="pr-3 text-subtle"><Chevron size={16} /></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {footer && <div className="border-t border-line px-3 py-2.5">{footer}</div>}
      </div>

      {/* ---------- Móvil: tarjetas ---------- */}
      <div className="flex flex-col gap-2.5 md:hidden">
        {selectable && (
          <label className="flex items-center gap-2 px-1 text-[13px] text-muted">
            <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--brand))]" checked={!!allSel} onChange={toggleAll} /> Seleccionar los {rows.length}
          </label>
        )}
        {rows.map((r) => {
          const k = rowKey(r);
          return (
            <article key={k} className={cx('flex gap-3 rounded-xl border bg-surface p-3.5', selected?.has(k) ? 'border-brand' : 'border-line')}>
              {selectable && <input type="checkbox" aria-label="Seleccionar" className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--brand))]" checked={!!selected?.has(k)} onChange={() => toggle(k)} />}
              <button className="flex min-w-0 flex-1 flex-col gap-2 text-left" onClick={() => onRowClick?.(r)} disabled={!onRowClick}>
                <div className="flex w-full items-start justify-between gap-2">
                  <div className="min-w-0 font-medium leading-snug text-fg">{cardTitle(r)}</div>
                  {cardBadge && <div className="shrink-0">{cardBadge(r)}</div>}
                </div>
                {cardMeta && <div className="text-[12px] text-muted">{cardMeta(r)}</div>}
                <dl className="grid w-full grid-cols-2 gap-x-3 gap-y-1.5 text-[13px]">
                  {cardCols.map((c) => (
                    <div key={c.key} className="min-w-0">
                      <dt className="text-[11px] uppercase tracking-[0.04em] text-subtle">{c.header}</dt>
                      <dd className="min-w-0 truncate text-fg">{c.render(r)}</dd>
                    </div>
                  ))}
                </dl>
              </button>
            </article>
          );
        })}
        {footer && <div className="rounded-xl border border-line bg-surface px-3 py-2.5">{footer}</div>}
      </div>
    </div>
  );
}

/** Filtros: en escritorio una fila de campos; en móvil un botón que abre una hoja inferior. */
export function FilterBar({ children, active, onClear }: { children: ReactNode; active: number; onClear: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="mb-4 hidden rounded-xl border border-line bg-surface p-3 md:block">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">{children}</div>
        {active > 0 && <div className="mt-2 flex justify-end"><Button size="sm" variant="ghost" onClick={onClear}>Limpiar {active} filtro{active > 1 ? 's' : ''}</Button></div>}
      </div>
      <div className="mb-3 flex gap-2 md:hidden">
        <Button className="flex-1" onClick={() => setOpen(true)}><SlidersHorizontal size={16} /> Filtros{active ? ` (${active})` : ''}</Button>
        {active > 0 && <Button variant="ghost" onClick={onClear}>Limpiar</Button>}
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} title="Filtros" footer={<Button variant="primary" className="w-full" onClick={() => setOpen(false)}>Ver resultados</Button>}>
        <div className="flex flex-col gap-4">{children}</div>
      </Sheet>
    </>
  );
}

/** Calendario mensual. En móvil cambia a agenda (lista por día). */
export interface CalEvent { id: string; date: string; label: string; sub?: string; color: string }
const DOW = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
export function MonthCalendar({ events, initial, today, onEvent, legend, onMonth, onDay }: {
  events: CalEvent[]; initial: string; today: string; onEvent?: (id: string) => void; legend?: { label: string; color: string }[];
  /** Avisa el mes visible («AAAA-MM») para cargar sus datos. */ onMonth?: (ym: string) => void;
  /** Clic en el número del día (por ejemplo, para programar esa fecha). */ onDay?: (date: string) => void;
}) {
  const [ym, setYm] = useState(() => { const [y, m] = initial.split('-').map(Number); return { y, m: m - 1 }; });
  useEffect(() => { onMonth?.(`${ym.y}-${String(ym.m + 1).padStart(2, '0')}`); }, [ym.y, ym.m]); // eslint-disable-line react-hooks/exhaustive-deps
  const byDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    events.forEach((e) => { const a = map.get(e.date) ?? []; a.push(e); map.set(e.date, a); });
    return map;
  }, [events]);
  const first = new Date(Date.UTC(ym.y, ym.m, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(ym.y, ym.m + 1, 0)).getUTCDate();
  const iso = (d: number) => `${ym.y}-${String(ym.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const cells = Array.from({ length: Math.ceil((offset + days) / 7) * 7 }, (_, i) => i - offset + 1);
  const shift = (n: number) => setYm(({ y, m }) => { const t = m + n; return { y: y + Math.floor(t / 12), m: ((t % 12) + 12) % 12 }; });
  const monthDays = Array.from({ length: days }, (_, i) => iso(i + 1)).filter((d) => byDay.has(d));

  return (
    <div className="rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => shift(-1)} aria-label="Mes anterior"><ChevronLeft size={16} /></Button>
          <h3 className="min-w-[150px] text-center text-[15px] font-semibold">{MESES[ym.m]} {ym.y}</h3>
          <Button size="sm" variant="ghost" onClick={() => shift(1)} aria-label="Mes siguiente"><ChevronRight size={16} /></Button>
        </div>
        {legend && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted">
            {legend.map((l) => <span key={l.label} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: l.color }} />{l.label}</span>)}
          </div>
        )}
      </div>
      {/* Grilla (≥ md) */}
      <div className="hidden md:block">
        <div className="grid grid-cols-7 border-b border-line bg-surface-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">
          {DOW.map((d) => <div key={d} className="px-2 py-1.5">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            const inMonth = d >= 1 && d <= days; const date = inMonth ? iso(d) : ''; const ev = byDay.get(date) ?? [];
            return (
              <div key={i} className={cx('min-h-[104px] border-b border-r border-line p-1.5', !inMonth && 'bg-surface-2/50', i % 7 === 6 && 'border-r-0')}>
                {inMonth && (onDay
                  ? <button onClick={() => onDay(date)} title="Ver o programar este día" className={cx('num mb-1 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[12px] hover:ring-2 hover:ring-brand/40', date === today ? 'bg-brand font-semibold text-on-brand' : 'text-muted')}>{d}</button>
                  : <div className={cx('num mb-1 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[12px]', date === today ? 'bg-brand font-semibold text-on-brand' : 'text-muted')}>{d}</div>)}
                <div className="flex flex-col gap-1">
                  {ev.slice(0, 3).map((e) => (
                    <button key={e.id} onClick={() => onEvent?.(e.id)} title={`${e.label}${e.sub ? ' · ' + e.sub : ''}`}
                      className="truncate rounded-md px-1.5 py-0.5 text-left text-[11px] font-medium hover:brightness-95"
                      style={{ background: `color-mix(in srgb, ${e.color} 16%, rgb(var(--surface)))`, color: 'rgb(var(--fg))', boxShadow: `inset 3px 0 0 ${e.color}` }}>
                      {e.label}
                    </button>
                  ))}
                  {ev.length > 3 && <span className="px-1 text-[11px] text-muted">+{ev.length - 3} más</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {/* Agenda (< md) */}
      <div className="divide-y divide-line md:hidden">
        {monthDays.length === 0 && <p className="p-4 text-center text-muted">Sin eventos este mes.</p>}
        {monthDays.map((date) => (
          <div key={date} className="flex gap-3 px-3 py-3">
            <div className={cx('num flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg text-[11px]', date === today ? 'bg-brand text-on-brand' : 'bg-surface-2 text-muted')}>
              <span className="text-[15px] font-semibold leading-none">{Number(date.slice(8))}</span>
              {DOW[(new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7]}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              {byDay.get(date)!.map((e) => (
                <button key={e.id} onClick={() => onEvent?.(e.id)} className="flex min-w-0 items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-left text-[13px]" style={{ boxShadow: `inset 3px 0 0 ${e.color}` }}>
                  <span className="min-w-0 flex-1 truncate font-medium">{e.label}</span>
                  {e.sub && <span className="shrink-0 text-[12px] text-muted">{e.sub}</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
