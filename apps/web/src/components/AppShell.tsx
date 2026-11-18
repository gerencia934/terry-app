import { useEffect, useState, type ReactNode } from 'react';
import {
  Bell, Menu, X, Home, FileText, Tags, Truck, CalendarDays, ClipboardCheck, FileStack, Scale, BarChart3,
  Users, Car, UserCog, ListTree, ShieldCheck, Smartphone, Moon, Sun, LogOut, Search, Recycle,
} from 'lucide-react';
import { useRouter, type RouteName } from '../lib/router';
import { cx } from '../lib/format';
import { Badge } from './ui';
import { alertas } from '../lib/alertas';
import logoLight from '../assets/logo-light.webp';
import logoDark from '../assets/logo-dark.webp';

interface NavItem { route: RouteName; label: string; icon: ReactNode }
interface NavGroup { id: string; label: string; items: NavItem[] }
export const NAV: NavGroup[] = [
  { id: 'inicio', label: 'Inicio', items: [{ route: 'inicio', label: 'Panel principal', icon: <Home size={18} /> }] },
  { id: 'decl', label: 'Declaraciones', items: [
    { route: 'decl-residuos', label: 'Residuos', icon: <Recycle size={18} /> },
    { route: 'decl-servicios', label: 'Servicios', icon: <FileText size={18} /> },
    { route: 'precios', label: 'Asignación de precios', icon: <Tags size={18} /> }] },
  { id: 'log', label: 'Logística', items: [
    { route: 'solicitudes', label: 'Solicitudes', icon: <Truck size={18} /> },
    { route: 'rutas', label: 'Rutas programadas', icon: <CalendarDays size={18} /> }] },
  { id: 'op', label: 'Operación HSEQ', items: [
    { route: 'preoperacionales', label: 'Preoperacionales', icon: <ClipboardCheck size={18} /> },
    { route: 'manifiestos', label: 'Manifiestos', icon: <FileStack size={18} /> },
    { route: 'actas', label: 'Actas y conciliaciones', icon: <Scale size={18} /> }] },
  { id: 'inf', label: 'Informes', items: [{ route: 'informes', label: 'Indicadores', icon: <BarChart3 size={18} /> }] },
  { id: 'cfg', label: 'Configuración', items: [
    { route: 'config-permisos', label: 'Permisos ambientales', icon: <ShieldCheck size={18} /> },
    { route: 'config-clientes', label: 'Clientes y sucursales', icon: <Users size={18} /> },
    { route: 'config-vehiculos', label: 'Vehículos', icon: <Car size={18} /> },
    { route: 'config-usuarios', label: 'Usuarios y roles', icon: <UserCog size={18} /> },
    { route: 'config-catalogos', label: 'Catálogos operativos', icon: <ListTree size={18} /> }] },
];
const groupOf = (r: RouteName) => NAV.find((g) => g.items.some((i) => i.route === r)) ?? NAV[0];

export function Logo({ className = 'h-9' }: { className?: string }) {
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

export function AppShell({ children }: { children: ReactNode }) {
  const { route, go } = useRouter();
  const [drawer, setDrawer] = useState(false);
  const [bell, setBell] = useState(false);
  const { dark, toggle } = useTheme();
  const group = groupOf(route);
  const al = alertas();
  useEffect(() => { setDrawer(false); setBell(false); }, [route]);

  const NavLinks = ({ items }: { items: NavItem[] }) => (
    <>
      {items.map((it) => (
        <button key={it.route} onClick={() => go(it.route)} aria-current={route === it.route ? 'page' : undefined}
          className={cx('flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-[14px] transition-colors',
            route === it.route ? 'bg-brand-soft font-semibold text-brand-ink' : 'text-muted hover:bg-surface-2 hover:text-fg')}>
          {it.icon}<span className="truncate">{it.label}</span>
        </button>
      ))}
    </>
  );

  return (
    <div className="min-h-full">
      {/* ---------------- Barra superior ---------------- */}
      <header className="sticky z-30 border-b border-line bg-surface/95 backdrop-blur" style={{ top: 'env(safe-area-inset-top, 0px)' }}>
        <div className="safe-x mx-auto flex h-16 max-w-[1600px] items-center gap-3">
          <button className="-ml-2 rounded-lg p-2 text-fg lg:hidden" onClick={() => setDrawer(true)} aria-label="Abrir menú"><Menu size={22} /></button>
          <button onClick={() => go('inicio')} aria-label="Ir al inicio" className="shrink-0"><Logo className="h-8 sm:h-9" /></button>
          <nav className="ml-4 hidden items-center gap-1 lg:flex" aria-label="Módulos">
            {NAV.map((g) => (
              <button key={g.id} onClick={() => go(g.items[0].route)}
                className={cx('h-9 whitespace-nowrap rounded-lg px-3 text-[14px] font-medium transition-colors',
                  g.id === group.id ? 'bg-brand text-on-brand' : 'text-muted hover:bg-surface-2 hover:text-fg')}>
                {g.label}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <div className="relative mr-2 hidden 2xl:block">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
              <input id="buscar-global" placeholder="Buscar cliente, manifiesto, placa…" className="h-9 w-64 rounded-lg border border-line bg-surface-2 pl-9 pr-3 text-[13px] focus:border-brand focus:outline-none" />
            </div>
            <span className="mr-1 hidden sm:inline-flex"><Badge tone="warn">Datos de demostración</Badge></span>
            <button onClick={() => go('campo')} className="hidden items-center gap-1.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-brand-ink hover:bg-brand-soft md:flex">
              <Smartphone size={17} /> Vista conductor
            </button>
            <button onClick={toggle} className="rounded-lg p-2 text-muted hover:bg-surface-2" aria-label={dark ? 'Usar tema claro' : 'Usar tema oscuro'}>{dark ? <Sun size={19} /> : <Moon size={19} />}</button>
            <div className="relative">
              <button onClick={() => setBell((v) => !v)} className="relative rounded-lg p-2 text-muted hover:bg-surface-2" aria-label={`Alertas (${al.length})`} aria-expanded={bell}>
                <Bell size={19} />
                <span className="num absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-bad px-1 text-[10px] font-semibold text-white">{al.length}</span>
              </button>
              {bell && (
                <div className="absolute right-0 top-11 z-40 w-[min(360px,calc(100vw-32px))] rounded-xl border border-line bg-surface shadow-xl">
                  <div className="border-b border-line px-4 py-3 text-[14px] font-semibold">Alertas y recordatorios</div>
                  <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
                    {al.map((a) => (
                      <li key={a.id}>
                        <button onClick={() => go(a.route)} className="flex w-full gap-3 px-4 py-3 text-left hover:bg-surface-2">
                          <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', a.tone === 'bad' ? 'bg-bad' : a.tone === 'warn' ? 'bg-warn' : 'bg-info')} />
                          <span className="min-w-0"><span className="block text-[13px] font-medium text-fg">{a.titulo}</span><span className="block text-[12px] text-muted">{a.detalle}</span></span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <button onClick={() => go('login')} className="ml-1 flex h-9 w-9 items-center justify-center rounded-full bg-brand-soft text-[13px] font-semibold text-brand-ink" aria-label="Cerrar sesión" title="Diego · Gerencia — cerrar sesión">DG</button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1600px]">
        {/* ---------------- Menú lateral (submódulos) ---------------- */}
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r border-line px-3 py-5 lg:flex">
          <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">{group.label}</p>
          <NavLinks items={group.items} />
          <div className="mt-auto rounded-xl bg-brand-soft p-3 text-[12px] text-brand-ink">
            <p className="font-semibold">PSA Los Pinos</p>
            <p className="mt-0.5 opacity-80">Planta propia · Sabana de Torres</p>
          </div>
        </aside>

        <main className="safe-x min-w-0 flex-1 py-5 pb-24 lg:py-7">{children}</main>
      </div>

      {/* ---------------- Drawer móvil (hamburguesa) ---------------- */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <button className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} aria-label="Cerrar menú" />
          <nav className="anim-slide relative flex h-full w-[84%] max-w-[320px] flex-col overflow-y-auto bg-surface px-3 pb-6" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)', paddingLeft: 'max(12px, env(safe-area-inset-left, 0px))' }}>
            <div className="mb-3 flex items-center justify-between px-1">
              <Logo className="h-8" />
              <button onClick={() => setDrawer(false)} className="rounded-lg p-2 text-muted" aria-label="Cerrar menú"><X size={20} /></button>
            </div>
            <button onClick={() => go('campo')} className="mb-3 flex h-11 items-center gap-3 rounded-lg bg-brand px-3 text-[14px] font-medium text-on-brand"><Smartphone size={18} /> Vista conductor (campo)</button>
            {NAV.map((g) => (
              <div key={g.id} className="mb-2">
                <p className="mb-1 mt-2 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">{g.label}</p>
                <NavLinks items={g.items} />
              </div>
            ))}
            <button onClick={() => go('login')} className="mt-2 flex h-10 items-center gap-3 rounded-lg px-3 text-[14px] text-muted"><LogOut size={18} /> Cerrar sesión</button>
          </nav>
        </div>
      )}
    </div>
  );
}
