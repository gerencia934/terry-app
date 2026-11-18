import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Bell, Menu, X, Home, FileText, Tags, Truck, CalendarDays, ClipboardCheck, FileStack, Scale, BarChart3, Users, Car, UserCog,
  ListTree, ShieldCheck, Smartphone, Moon, Sun, LogOut, Search, Star, Upload, Download, Clock, MapPin, Flag, FileSpreadsheet,
  FileCheck2, Boxes, Settings, ChevronDown, Building2, ListChecks, List, Plus, type LucideIcon,
} from 'lucide-react';
import { useRouter, type RouteName } from '../lib/router';
import { cx } from '../lib/format';
import { alertas } from '../lib/alertas';
import logoDark from '../assets/logo-dark.webp';
import logoLight from '../assets/logo-light.webp';

type Tool = [RouteName, string, LucideIcon];
interface Modulo { id: string; label: string; icon: LucideIcon; tools: Tool[]; enMenu?: boolean }
// Módulos y herramientas laterales tal como los organiza Grinclic.
export const MODULOS: Modulo[] = [
  { id: 'inicio', label: 'Inicio', icon: Home, tools: [['inicio', 'Inicio', Home]] },
  { id: 'declaraciones', label: 'Declaraciones', icon: FileText, enMenu: true, tools: [
    ['declaraciones', 'Residuos y servicios', List], ['cargues', 'Cargues masivos', Upload], ['exportable', 'Exportable detallado', Download],
    ['precios', 'Asignación masiva de precios', Tags], ['config-catalogos', 'Configuración', Settings]] },
  { id: 'solicitudes', label: 'Solicitudes', icon: Star, enMenu: true, tools: [
    ['solicitudes', 'Solicitudes', Truck], ['pre-solicitudes', 'Pre-solicitudes', Clock], ['cargues', 'Cargue masivo', Upload]] },
  { id: 'rutas', label: 'Rutas', icon: CalendarDays, enMenu: true, tools: [
    ['rutas', 'Rutas programadas', CalendarDays], ['rastreo', 'Rastreo de rutas', MapPin], ['informe-rutas', 'Informe de programación', FileSpreadsheet],
    ['estados-recorrido', 'Estados del recorrido', Flag]] },
  { id: 'chequeo', label: 'Chequeo', icon: ClipboardCheck, enMenu: true, tools: [['chequeo', 'Lista de chequeo interna', ClipboardCheck], ['config-catalogos', 'Elementos de chequeo', ListChecks]] },
  { id: 'manifiestos', label: 'Manifiesto', icon: FileStack, enMenu: true, tools: [['manifiestos', 'Manifiestos', FileStack]] },
  { id: 'conciliaciones', label: 'Conciliaciones', icon: Scale, enMenu: true, tools: [['conciliaciones', 'Conciliaciones', Scale]] },
  { id: 'actas', label: 'Actas', icon: FileCheck2, enMenu: true, tools: [['actas', 'Actas', FileCheck2]] },
  { id: 'inventario', label: 'Inventario', icon: Boxes, enMenu: true, tools: [['inventario', 'Inventario por bodega', Boxes]] },
  { id: 'reportes', label: 'Reportes', icon: BarChart3, enMenu: true, tools: [['informes', 'Informes', FileSpreadsheet], ['indicadores', 'Indicadores', BarChart3]] },
  { id: 'configuracion', label: 'Configuración', icon: Settings, tools: [
    ['configuracion', 'Configuraciones del sistema', Settings], ['config-permisos', 'Permisos ambientales', ShieldCheck], ['config-datos', 'Mis datos', Building2],
    ['config-clientes', 'Mis clientes', Users], ['config-vehiculos', 'Mis vehículos', Car], ['config-usuarios', 'Usuarios / roles', UserCog],
    ['config-catalogos', 'Catálogos operativos', ListTree], ['cargues', 'Cargues masivos', Upload]] },
];
const ACCESOS: [RouteName, string, LucideIcon][] = [
  ['config-clientes', 'Mis clientes', Users], ['config-vehiculos', 'Mis vehículos', Car], ['config-usuarios', 'Mis usuarios', UserCog],
  ['config-permisos', 'Permisos ambientales', ShieldCheck], ['cargues', 'Cargues masivos', Upload], ['configuracion', 'Configuraciones', Settings],
];

export function Logo({ className = 'h-9', onDark }: { className?: string; onDark?: boolean }) {
  if (onDark) return <img src={logoDark} alt="Terra Viva S.A.S. E.S.P." className={cx('w-auto', className)} />;
  return (
    <span className="inline-flex items-center">
      <img src={logoLight} alt="Terra Viva S.A.S. E.S.P." className={cx('logo-light w-auto', className)} />
      <img src={logoDark} alt="Terra Viva S.A.S. E.S.P." className={cx('logo-dark w-auto', className)} />
    </span>
  );
}

export function useTheme() {
  const [dark, setDark] = useState(() => {
    try { const s = localStorage.getItem('tv-theme'); if (s) return s === 'dark'; } catch { /* sin storage */ }
    const attr = document.documentElement.getAttribute('data-theme'); if (attr) return attr === 'dark';
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    try { localStorage.setItem('tv-theme', dark ? 'dark' : 'light'); } catch { /* sin storage */ }
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

/** Botón flotante de acción principal (el «+» naranja de Grinclic). */
export function Fab({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} aria-label={label} title={label}
      className="fixed z-40 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-lg transition-transform hover:scale-105"
      style={{ right: 'max(20px, calc(env(safe-area-inset-right, 0px) + 20px))', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)' }}>
      <Plus size={26} />
    </button>
  );
}

let ultimoModulo = 'inicio';
export function AppShell({ children }: { children: ReactNode }) {
  const { route, go } = useRouter();
  const [drawer, setDrawer] = useState(false);
  const [bell, setBell] = useState(false);
  const [reportes, setReportes] = useState(false);
  const [accesos, setAccesos] = useState(false);
  const [q, setQ] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const { dark, toggle } = useTheme();
  const al = alertas();

  const modulo = useMemo(() => {
    const actual = MODULOS.find((m) => m.id === ultimoModulo);
    const m = actual?.tools.some((t) => t[0] === route) ? actual : MODULOS.find((x) => x.tools.some((t) => t[0] === route)) ?? MODULOS[0];
    ultimoModulo = m.id; return m;
  }, [route]);
  useEffect(() => { setDrawer(false); setBell(false); setReportes(false); setQ(''); }, [route]);

  const busqueda = q.trim() ? MODULOS.flatMap((m) => m.tools.map((t) => ({ m, t }))).filter(({ m, t }) => `${m.label} ${t[1]}`.toLowerCase().includes(q.toLowerCase())).slice(0, 8) : [];

  return (
    <div className="min-h-full">
      {/* ---------------- Barra superior ---------------- */}
      <header className="sticky z-30 bg-nav text-white shadow-sm" style={{ top: 'env(safe-area-inset-top, 0px)' }}>
        <div className="safe-x mx-auto flex h-14 max-w-[1680px] items-center gap-2">
          <button className="-ml-2 rounded-lg p-2 xl:hidden" onClick={() => setDrawer(true)} aria-label="Abrir menú"><Menu size={22} /></button>
          <button onClick={() => go('inicio')} aria-label="Ir al inicio" className="shrink-0 rounded-lg bg-white px-2 py-1"><img src={logoLight} alt="Terra Viva S.A.S. E.S.P." className="h-7 w-auto" /></button>
          <nav className="ml-2 hidden min-w-0 items-center xl:flex 2xl:ml-3" aria-label="Módulos">
            {MODULOS.filter((m) => m.enMenu && m.id !== 'reportes').map((m) => (
              <button key={m.id} onClick={() => { ultimoModulo = m.id; go(m.tools[0][0]); }}
                className={cx('flex h-9 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[13px] font-medium transition-colors 2xl:px-2.5',
                  modulo.id === m.id ? 'bg-white/20 text-white' : 'text-white/85 hover:bg-white/10 hover:text-white')}>
                <m.icon size={15} className="hidden 2xl:block" />{m.label}
              </button>
            ))}
            <div className="relative">
              <button onClick={() => setReportes((v) => !v)} aria-expanded={reportes}
                className={cx('flex h-9 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium 2xl:px-2.5', modulo.id === 'reportes' ? 'bg-white/20' : 'text-white/85 hover:bg-white/10')}>
                <BarChart3 size={15} className="hidden 2xl:block" />Reportes<ChevronDown size={14} />
              </button>
              {reportes && (
                <div className="absolute left-0 top-10 z-40 w-44 overflow-hidden rounded-lg border border-line bg-surface text-fg shadow-xl">
                  <button onClick={() => go('informes')} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] hover:bg-surface-2"><FileSpreadsheet size={15} />Informes</button>
                  <button onClick={() => go('indicadores')} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] hover:bg-surface-2"><BarChart3 size={15} />Indicadores</button>
                </div>
              )}
            </div>
          </nav>
          <div className="relative ml-auto hidden md:block xl:hidden 2xl:block">
            <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-white/70" />
            <input ref={searchRef} id="buscar-modulo" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar módulo…"
              onKeyDown={(e) => { if (e.key === 'Enter' && busqueda[0]) go(busqueda[0].t[0]); }}
              className="h-8 w-44 rounded-md border border-white/25 bg-white/10 pl-8 pr-2 text-[13px] text-white placeholder:text-white/60 focus:bg-white focus:text-fg focus:outline-none 2xl:w-56" />
            {busqueda.length > 0 && (
              <ul className="absolute right-0 top-10 z-40 w-72 overflow-hidden rounded-lg border border-line bg-surface text-fg shadow-xl">
                {busqueda.map(({ m, t }) => { const I = t[2]; return (
                  <li key={m.id + t[0] + t[1]}><button onClick={() => { ultimoModulo = m.id; go(t[0]); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-surface-2"><I size={15} className="text-brand" /><span className="text-muted">{m.label} ›</span>{t[1]}</button></li>
                ); })}
              </ul>
            )}
          </div>
          <div className="ml-auto flex shrink-0 items-center md:ml-1 xl:ml-auto 2xl:ml-1">
            <button onClick={() => go('inicio')} className="rounded-md p-2 hover:bg-white/10" aria-label="Inicio" title="Inicio"><Home size={18} /></button>
            <button onClick={() => go('configuracion')} className="rounded-md p-2 hover:bg-white/10" aria-label="Configuraciones" title="Configuraciones"><Settings size={18} /></button>
            <button onClick={() => go('campo')} className="hidden rounded-md p-2 hover:bg-white/10 sm:block" aria-label="Vista conductor" title="Vista conductor (app de campo)"><Smartphone size={18} /></button>
            <button onClick={toggle} className="rounded-md p-2 hover:bg-white/10" aria-label={dark ? 'Usar tema claro' : 'Usar tema oscuro'}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
            <div className="relative">
              <button onClick={() => setBell((v) => !v)} className="relative rounded-md p-2 hover:bg-white/10" aria-label={`Alertas (${al.length})`} aria-expanded={bell}>
                <Bell size={18} />
                <span className="num absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold">{al.length}</span>
              </button>
              {bell && (
                <div className="absolute right-0 top-11 z-40 w-[min(360px,calc(100vw-32px))] rounded-xl border border-line bg-surface text-fg shadow-xl">
                  <div className="border-b border-line px-4 py-3 text-[14px] font-semibold">Alertas y recordatorios</div>
                  <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
                    {al.map((a) => (
                      <li key={a.id}><button onClick={() => go(a.route)} className="flex w-full gap-3 px-4 py-3 text-left hover:bg-surface-2">
                        <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', a.tone === 'bad' ? 'bg-bad' : a.tone === 'warn' ? 'bg-warn' : 'bg-info')} />
                        <span className="min-w-0"><span className="block text-[13px] font-medium">{a.titulo}</span><span className="block text-[12px] text-muted">{a.detalle}</span></span>
                      </button></li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <button onClick={() => go('login')} className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-[12px] font-semibold" aria-label="Cerrar sesión" title="Gerencia — cerrar sesión">DG</button>
          </div>
        </div>
      </header>

      {/* ---------------- Accesos directos (barra desplegable) ---------------- */}
      <div className="border-b border-line bg-brand-soft/70">
        <div className="safe-x mx-auto max-w-[1680px]">
          <button onClick={() => setAccesos((v) => !v)} aria-expanded={accesos} className="flex h-8 items-center gap-1.5 text-[12px] font-semibold text-brand-ink">
            <ChevronDown size={14} className={cx('transition-transform', !accesos && '-rotate-90')} /> Accesos directos
            <span className="ml-2 hidden rounded-full bg-warn/15 px-2 py-px text-[11px] font-medium text-warn sm:inline">Datos de demostración</span>
          </button>
          {accesos && (
            <div className="flex flex-wrap gap-2 pb-2.5">
              {ACCESOS.map(([r, l, I]) => <button key={l} onClick={() => go(r)} className="flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[12px] font-medium hover:border-brand"><I size={14} className="text-brand" />{l}</button>)}
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto flex max-w-[1680px]">
        {/* ---------------- Herramientas del módulo ---------------- */}
        {modulo.id !== 'inicio' && (
          <aside className="sticky top-14 hidden h-[calc(100vh-5.5rem)] w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-line bg-surface/60 px-2.5 py-4 lg:flex">
            <p className="mb-1 flex items-center gap-2 px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle"><modulo.icon size={13} />{modulo.label}</p>
            {modulo.tools.map(([r, l, I]) => (
              <button key={r + l} onClick={() => go(r)} aria-current={route === r ? 'page' : undefined}
                className={cx('flex min-h-10 w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors',
                  route === r ? 'bg-brand text-on-brand font-semibold' : 'text-muted hover:bg-surface-2 hover:text-fg')}>
                <I size={17} className="shrink-0" /><span>{l}</span>
              </button>
            ))}
            <div className="mt-auto rounded-xl bg-brand-soft p-3 text-[12px] text-brand-ink">
              <p className="font-semibold">PSA Los Pinos</p>
              <p className="mt-0.5 opacity-80">Planta propia · Sabana de Torres</p>
            </div>
          </aside>
        )}
        <main className="safe-x min-w-0 flex-1 py-5 pb-28 lg:py-6">
          {/* Herramientas del módulo en móvil/tablet: fila desplazable */}
          {modulo.id !== 'inicio' && modulo.tools.length > 1 && (
            <div className="scroll-x -mx-1 mb-4 px-1 lg:hidden">
              <div className="flex gap-2">
                {modulo.tools.map(([r, l, I]) => (
                  <button key={r + l} onClick={() => go(r)} className={cx('flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium', route === r ? 'border-brand bg-brand text-on-brand' : 'border-line bg-surface text-muted')}><I size={15} />{l}</button>
                ))}
              </div>
            </div>
          )}
          {children}
        </main>
      </div>

      {/* ---------------- Drawer móvil ---------------- */}
      {drawer && (
        <div className="fixed inset-0 z-50 xl:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <button className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} aria-label="Cerrar menú" />
          <nav className="anim-slide relative flex h-full w-[86%] max-w-[330px] flex-col overflow-y-auto bg-surface px-3 pb-6" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)', paddingLeft: 'max(12px, env(safe-area-inset-left, 0px))' }}>
            <div className="mb-3 flex items-center justify-between px-1"><Logo className="h-8" /><button onClick={() => setDrawer(false)} className="rounded-lg p-2 text-muted" aria-label="Cerrar menú"><X size={20} /></button></div>
            <button onClick={() => go('campo')} className="mb-3 flex h-11 items-center gap-3 rounded-lg bg-brand px-3 text-[14px] font-medium text-on-brand"><Smartphone size={18} /> Vista conductor (campo)</button>
            {MODULOS.map((m) => (
              <details key={m.id} open={m.id === modulo.id} className="group mb-1">
                <summary className="flex h-10 cursor-pointer list-none items-center gap-3 rounded-lg px-3 text-[14px] font-medium text-fg hover:bg-surface-2">
                  <m.icon size={18} className="text-brand" />{m.label}<ChevronDown size={15} className="ml-auto text-subtle transition-transform group-open:rotate-180" />
                </summary>
                <div className="ml-6 border-l border-line pl-2">
                  {m.tools.map(([r, l]) => (
                    <button key={r + l} onClick={() => { ultimoModulo = m.id; go(r); }} className={cx('flex h-9 w-full items-center rounded-md px-3 text-left text-[13px]', route === r && m.id === modulo.id ? 'bg-brand-soft font-semibold text-brand-ink' : 'text-muted')}>{l}</button>
                  ))}
                </div>
              </details>
            ))}
            <button onClick={() => go('login')} className="mt-2 flex h-10 items-center gap-3 rounded-lg px-3 text-[14px] text-muted"><LogOut size={18} /> Cerrar sesión</button>
          </nav>
        </div>
      )}
    </div>
  );
}
