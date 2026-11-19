import { Fragment, createContext, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { X, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { cx } from '../lib/format';

// ---------------- Botones ----------------
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({ variant = 'secondary', size = 'md', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <button
      {...p}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
        size === 'sm' && 'h-8 px-3 text-[13px]', size === 'md' && 'h-10 px-4 text-sm', size === 'lg' && 'h-12 px-5 text-base',
        variant === 'primary' && 'bg-brand text-on-brand hover:bg-brand/90',
        variant === 'secondary' && 'bg-surface border border-line text-fg hover:bg-surface-2',
        variant === 'ghost' && 'text-muted hover:bg-surface-2 hover:text-fg',
        variant === 'danger' && 'bg-bad text-white hover:bg-bad/90',
        className,
      )}
    />
  );
}

// ---------------- Badges ----------------
export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral' | 'brand';
const TONE: Record<Tone, string> = {
  ok: 'bg-ok/10 text-ok ring-ok/25', warn: 'bg-warn/10 text-warn ring-warn/25', bad: 'bg-bad/10 text-bad ring-bad/25',
  info: 'bg-info/10 text-info ring-info/25', neutral: 'bg-surface-2 text-muted ring-line', brand: 'bg-brand-soft text-brand-ink ring-brand/20',
};
export function Badge({ tone = 'neutral', children, dot }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium ring-1 ring-inset whitespace-nowrap', TONE[tone])}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
/** Badge con color configurable desde la BD (estados de recorrido, zonas). */
export function ColorBadge({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium whitespace-nowrap ring-1 ring-inset"
      style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color: `color-mix(in srgb, ${color} 75%, rgb(var(--fg)))`, ['--tw-ring-color' as string]: `color-mix(in srgb, ${color} 35%, transparent)` }}>
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {children}
    </span>
  );
}

const ESTADO_TONE: Record<string, Tone> = {
  AUTORIZADA: 'ok', PENDIENTE: 'warn', RECHAZADA: 'bad', INACTIVA: 'neutral', BORRADOR: 'info',
  PROGRAMADA: 'info', RECOLECTADA: 'ok', CANCELADA: 'bad', EMITIDO: 'info', EN_TRANSITO: 'info', RECIBIDO: 'warn', CERRADO: 'ok',
  // Cadena operativa (servidor)
  EN_CURSO: 'info', PROGRAMADO: 'info', REALIZADO: 'ok', DESCARTADO: 'neutral', ANULADO: 'bad', ANULADA: 'bad', APROBADA: 'ok', EMITIDA: 'ok',
  ATENDIDA: 'ok', NO_ATENDIDA: 'bad', ABONADA: 'info', PAGADA: 'ok', NO_APROBADA: 'bad',
};
const ESTADO_LABEL: Record<string, string> = { EN_TRANSITO: 'En tránsito', RECIBIDO: 'Recibido en planta', EN_CURSO: 'En curso', NO_ATENDIDA: 'No atendida', NO_APROBADA: 'No aprobada' };
export const EstadoBadge = ({ estado }: { estado: string }) => (
  <Badge tone={ESTADO_TONE[estado] ?? 'neutral'} dot>{ESTADO_LABEL[estado] ?? estado.charAt(0) + estado.slice(1).toLowerCase()}</Badge>
);

// ---------------- Contenedores ----------------
export function Card({ className, children, title, action, pad = true }: { className?: string; children: ReactNode; title?: ReactNode; action?: ReactNode; pad?: boolean }) {
  return (
    <section className={cx('rounded-xl border border-line bg-surface min-w-0', className)}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
          {action}
        </header>
      )}
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: string; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-brand">{eyebrow}</p>}
        <h1 className="text-[22px] font-bold leading-tight text-brand-strong sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-[70ch] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

// ---------------- Formularios ----------------
export function Field({ label, children, hint, id }: { label: string; children: ReactNode; hint?: string; id?: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5" htmlFor={id}>
      <span className="text-[12px] font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="text-[12px] text-subtle">{hint}</span>}
    </label>
  );
}
const inputCls = 'h-10 w-full min-w-0 rounded-lg border border-line bg-surface px-3 text-sm text-fg placeholder:text-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';
export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(inputCls, className)} />;
export const Select = ({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...p} className={cx(inputCls, 'pr-8', className)}>{children}</select>
);

// ---------------- Pestañas ----------------
export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: string; count?: number }[] }) {
  return (
    <div className="scroll-x -mx-1 px-1">
      <div role="tablist" className="inline-flex gap-1 rounded-lg bg-surface-2 p-1">
        {items.map((it) => (
          <button key={it.value} role="tab" aria-selected={value === it.value} onClick={() => onChange(it.value)}
            className={cx('flex h-8 items-center gap-2 whitespace-nowrap rounded-md px-3 text-[13px] font-medium transition-colors',
              value === it.value ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg')}>
            {it.label}
            {it.count !== undefined && <span className={cx('num rounded-full px-1.5 text-[11px]', value === it.value ? 'bg-brand-soft text-brand-ink' : 'bg-line/70')}>{it.count}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------- Hoja lateral / inferior ----------------
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k); document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-stretch md:justify-end" role="dialog" aria-modal="true">
      <button aria-label="Cerrar" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="anim-sheet relative flex max-h-[88vh] w-full flex-col rounded-t-2xl bg-surface shadow-2xl md:max-h-none md:w-[480px] md:rounded-none md:rounded-l-2xl safe-bottom">
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line md:hidden" />
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="min-w-0 text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-2 text-muted hover:bg-surface-2" aria-label="Cerrar"><X size={18} /></button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

/** Lista definición etiqueta → valor (detalle en hojas). */
export function DefList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(110px,40%)_1fr] gap-x-4 gap-y-2.5 text-sm">
      {items.map(([k, v]) => (<Fragment key={k}><dt className="text-muted">{k}</dt><dd className="min-w-0 break-words text-fg">{v}</dd></Fragment>))}
    </dl>
  );
}

// ---------------- KPI ----------------
export function Kpi({ label, value, delta, icon, hint }: { label: string; value: string; delta?: { v: string; up: boolean; good?: boolean }; icon?: ReactNode; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-muted">{label}</span>
        {icon && <span className="rounded-lg bg-brand-soft p-1.5 text-brand-ink">{icon}</span>}
      </div>
      <div className="num font-display text-[26px] font-semibold leading-none text-fg">{value}</div>
      {(delta || hint) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
          {delta && <span className={cx('num whitespace-nowrap font-medium', (delta.good ?? delta.up) ? 'text-ok' : 'text-bad')}>{delta.up ? '▲' : '▼'} {delta.v}</span>}
          {hint && <span className="text-subtle">{hint}</span>}
        </div>
      )}
    </div>
  );
}

// ---------------- Avisos ----------------
type ToastT = { id: number; msg: string; tone: 'ok' | 'warn' | 'info' };
const ToastCtx = createContext<(msg: string, tone?: ToastT['tone']) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, set] = useState<ToastT[]>([]);
  const push = useCallback((msg: string, tone: ToastT['tone'] = 'ok') => {
    const id = Date.now() + Math.random();
    set((s) => [...s, { id, msg, tone }]);
    setTimeout(() => set((s) => s.filter((t) => t.id !== id)), 3800);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 safe-bottom md:items-end" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="anim-sheet pointer-events-auto flex max-w-md items-start gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-sm shadow-lg">
            {t.tone === 'ok' ? <CheckCircle2 size={18} className="mt-px shrink-0 text-ok" /> : t.tone === 'warn' ? <AlertTriangle size={18} className="mt-px shrink-0 text-warn" /> : <Info size={18} className="mt-px shrink-0 text-info" />}
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-muted">{children}</div>;
}
