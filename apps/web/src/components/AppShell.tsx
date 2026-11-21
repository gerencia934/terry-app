import { Warehouse } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Bell, Menu, X, Home, FileText, Tags, Truck, CalendarDays, ClipboardCheck, FileStack, Scale, BarChart3, Users, Car, UserCog,
  ListTree, ShieldCheck, Smartphone, Moon, Sun, Search, Upload, Download, Hourglass, Radar, Table2, Boxes, Settings,
  Building2, Award, Milestone, FileSpreadsheet, Server, FlaskConical, Receipt, Handshake, LayoutGrid, KeyRound, Timer, type LucideIcon,
} from 'lucide-react';
import { useRouter, type RouteName } from '../lib/router';
import { cx } from '../lib/format';
import { useAlertas } from '../lib/alertas';
import { MODO_REAL, PORTAL_URL, salir, salirDeTodos, sesionActual, tienePermiso } from '../lib/api';
import { VentanaDobleFactor } from './DobleFactor';
import { BotonAyuda } from './Ayuda';
import { Descargas } from './Descargas';
import { MODULO } from './Marca';
import { AvisoNotificaciones, OpcionNotificaciones } from './Notificaciones';
import { EnlaceAccesoHost } from './EnlaceAcceso';
import logoDark from '../assets/logo-dark.webp';
import logoLight from '../assets/logo-light.webp';

interface Item { route: RouteName; label: string; icon: LucideIcon; desc?: string; /** Solo se muestra con este permiso. */ permiso?: string }
interface Grupo { id: string; label: string; items: Item[] }
// Navegación organizada por la cadena de trazabilidad de Terra Viva: comercial → logística → campo → planta → cumplimiento.
export const GRUPOS: Grupo[] = [
  { id: 'inicio', label: '', items: [{ route: 'inicio', label: 'Inicio', icon: Home }] },
  { id: 'comercial', label: 'Comercial', items: [
    { route: 'comercial', label: 'Embudo comercial', icon: Handshake, desc: 'Prospectos, oportunidades, tareas y cotizaciones (reemplaza a Bigin)', permiso: 'comercial.gestionar' },
    { route: 'clientes', label: 'Clientes y sedes', icon: Users }, { route: 'declaraciones', label: 'Declaraciones', icon: FileText, desc: 'Residuos y servicios por sede' },
    { route: 'tarifas', label: 'Tarifas', icon: Tags, desc: 'Actualizar precios en bloque' },
    { route: 'facturacion', label: 'Facturación', icon: Receipt, desc: 'Siigo: manifiestos sin facturar, por pagar y pagados', permiso: 'finanzas.ver' },
    { route: 'exportar', label: 'Exportar', icon: Download }] },
  { id: 'logistica', label: 'Logística', items: [
    { route: 'solicitudes', label: 'Solicitudes', icon: Truck }, { route: 'por-confirmar', label: 'Por confirmar', icon: Hourglass, desc: 'Pedidos del portal y por frecuencia' },
    { route: 'programacion', label: 'Programación', icon: CalendarDays }, { route: 'programacion-tabla', label: 'Programación en tabla', icon: Table2 },
    { route: 'seguimiento', label: 'Seguimiento', icon: Radar, desc: 'Recorridos en curso' },
    { route: 'bitacora', label: 'Bitácora de tiempos', icon: Timer, desc: 'Tiempos muertos y tareas logísticas del equipo', permiso: 'bitacora.equipo' }] },
  { id: 'campo', label: 'Campo y HSEQ', items: [
    { route: 'inspecciones', label: 'Inspecciones vehiculares', icon: ClipboardCheck }, { route: 'manifiestos', label: 'Manifiestos de transporte', icon: FileStack }] },
  { id: 'planta', label: 'Planta Los Pinos', items: [
    { route: 'descargues', label: 'Recepción en planta', icon: Warehouse, desc: 'Descargas de transportadores externos, báscula, firmas y recibo' },
    { route: 'recepcion', label: 'Conciliación', icon: Scale, desc: 'Cargado contra báscula, precios y factura' }, { route: 'inventario', label: 'Inventario', icon: Boxes },
    { route: 'certificados', label: 'Certificados', icon: Award }] },
  { id: 'cumplimiento', label: 'Cumplimiento', items: [{ route: 'permisos', label: 'Permisos ambientales', icon: ShieldCheck }] },
  { id: 'analisis', label: 'Análisis', items: [{ route: 'indicadores', label: 'Indicadores', icon: BarChart3 }, { route: 'informes', label: 'Informes', icon: FileSpreadsheet }] },
  { id: 'ajustes', label: 'Ajustes', items: [
    { route: 'ajustes', label: 'Configuración', icon: Settings }, { route: 'importar', label: 'Importar datos', icon: Upload, desc: 'Plantillas de Excel' },
    { route: 'usuarios', label: 'Usuarios', icon: UserCog },
    { route: 'roles', label: 'Roles y permisos', icon: KeyRound, desc: 'Qué puede hacer cada rol: empresa, campo y portal de clientes', permiso: 'configuracion.editar' },
    { route: 'vehiculos', label: 'Flota', icon: Car },
    { route: 'catalogos', label: 'Catálogos', icon: ListTree }, { route: 'etapas', label: 'Etapas del recorrido', icon: Milestone }, { route: 'empresa', label: 'Datos de la empresa', icon: Building2 }] },
];
/** Secciones que ya leen y escriben en el servidor (el resto se conecta en la fase 1b). */
const CONECTADAS = new Set<RouteName>(['inicio', 'bitacora', 'ayuda', 'comercial', 'facturacion', 'indicadores', 'inventario', 'catalogos', 'etapas', 'clientes', 'tarifas', 'permisos', 'inspecciones', 'vehiculos', 'usuarios', 'roles', 'declaraciones', 'importar', 'solicitudes', 'por-confirmar', 'descargues', 'empresa', 'programacion', 'programacion-tabla', 'seguimiento', 'manifiestos', 'recepcion', 'certificados']);
const TODOS = GRUPOS.flatMap((g) => g.items.map((i) => ({ ...i, grupo: g.label })));
/** El ítem se ve si no pide permiso o si el usuario lo tiene (Facturación: solo Comercial, Facturación y Gerencia). */
const visible = (i: Item) => !i.permiso || !MODO_REAL || tienePermiso(i.permiso);

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

function Navegacion({ route, go }: { route: RouteName; go: (r: RouteName) => void }) {
  return (
    <nav className="flex flex-col gap-4" aria-label="Navegación principal">
      {GRUPOS.map((g) => (
        <div key={g.id} className="flex flex-col gap-0.5">
          {g.label && <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.09em] text-subtle">{g.label}</p>}
          {g.items.filter(visible).map((it) => (
            <button key={it.route} onClick={() => go(it.route)} aria-current={route === it.route ? 'page' : undefined}
              className={cx('flex h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-[13.5px] transition-colors',
                route === it.route ? 'bg-brand-soft font-semibold text-brand-ink' : 'text-muted hover:bg-surface-2 hover:text-fg')}>
              <it.icon size={17} className={cx('shrink-0', route === it.route ? 'text-brand' : '')} /><span className="truncate">{it.label}</span>
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { route, go } = useRouter();
  const [drawer, setDrawer] = useState(false);
  const [bell, setBell] = useState(false);
  const [buscar, setBuscar] = useState(false);
  const [q, setQ] = useState('');
  const qRef = useRef<HTMLInputElement>(null);
  const { dark, toggle } = useTheme();
  const al = useAlertas();
  const actual = TODOS.find((i) => i.route === route);
  const usuario = sesionActual()?.usuario;
  const iniciales = (usuario?.nombre ?? 'Gerencia').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  useEffect(() => { setDrawer(false); setBell(false); setBuscar(false); setQ(''); }, [route]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setBuscar(true); } if (e.key === 'Escape') setBuscar(false); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  useEffect(() => { if (buscar) setTimeout(() => qRef.current?.focus(), 30); }, [buscar]);
  const resultados = useMemo(() => TODOS.filter(visible).filter((i) => `${i.grupo} ${i.label} ${i.desc ?? ''}`.toLowerCase().includes(q.toLowerCase())).slice(0, 9), [q]);
  const cerrarSesion = async () => { await salir(); go('login'); };
  const cerrarTodas = async () => { await salirDeTodos(); go('login'); };
  const [menuUsuario, setMenuUsuario] = useState(false);
  const [ver2fa, setVer2fa] = useState(false);
  useEffect(() => { setMenuUsuario(false); }, [route]);

  const Lateral = (
    <div className="flex h-full flex-col">
      <button onClick={() => go('inicio')} className="mb-5 px-2 text-left" aria-label="Terry-App Residuos: ir al inicio">
        <Logo className="h-10" />
        <span className="mt-1.5 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-subtle"><span className="h-0.5 w-4 rounded-full bg-brand-lime" aria-hidden />{MODULO}</span>
      </button>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1"><Navegacion route={route} go={go} /></div>
      <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
        <div className={cx('flex items-center gap-2 rounded-lg px-3 py-2 text-[12px]', MODO_REAL ? 'bg-ok/10 text-ok' : 'bg-warn/10 text-warn')}>
          {MODO_REAL ? <Server size={14} /> : <FlaskConical size={14} />}{MODO_REAL ? 'Conectado al servidor' : 'Modo demostración'}
        </div>
        {MODO_REAL && PORTAL_URL && (
          <a href={PORTAL_URL} className="flex h-9 items-center gap-3 rounded-lg px-3 text-[13px] text-muted hover:bg-surface-2" title="Volver al portal Terry-App: Residuos, Mantenimiento, CRM y Planta">
            <LayoutGrid size={16} />Portal Terry-App
          </a>
        )}
        <button onClick={() => go('campo')} className="flex h-9 items-center gap-3 rounded-lg px-3 text-[13px] text-muted hover:bg-surface-2"><Smartphone size={16} />App del conductor</button>
      </div>
    </div>
  );

  return (
    <div className="min-h-full lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="sticky top-0 hidden h-screen border-r border-line bg-surface px-3 py-5 lg:block">{Lateral}</aside>

      <div className="min-w-0">
        <header className="sticky z-30 border-b border-line bg-bg/90 backdrop-blur" style={{ top: 'env(safe-area-inset-top, 0px)' }}>
          <div className="safe-x flex h-14 items-center gap-2">
            <button className="-ml-2 rounded-lg p-2 lg:hidden" onClick={() => setDrawer(true)} aria-label="Abrir menú"><Menu size={22} /></button>
            <span className="lg:hidden"><Logo className="h-7" /></span>
            <p className="hidden min-w-0 truncate text-[13px] text-muted lg:block">{actual?.grupo && <>{actual.grupo} <span className="text-subtle">/</span> </>}<span className="font-medium text-fg">{actual?.label}</span></p>
            <button onClick={() => setBuscar(true)} className="ml-auto hidden h-9 w-72 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-[13px] text-subtle hover:border-brand/50 md:flex">
              <Search size={15} />Ir a…<kbd className="ml-auto rounded border border-line px-1.5 text-[11px]">Ctrl K</kbd>
            </button>
            <div className="ml-auto flex items-center md:ml-2">
              <button onClick={() => setBuscar(true)} className="rounded-lg p-2 text-muted hover:bg-surface-2 md:hidden" aria-label="Buscar"><Search size={19} /></button>
              <BotonAyuda acceso="OFICINA" ruta={route} verTodo={() => go('ayuda')} />
              <button onClick={toggle} className="rounded-lg p-2 text-muted hover:bg-surface-2" aria-label={dark ? 'Usar tema claro' : 'Usar tema oscuro'}>{dark ? <Sun size={19} /> : <Moon size={19} />}</button>
              <div className="relative">
                {MODO_REAL && <Descargas />}
                <button onClick={() => setBell((v) => !v)} className="relative rounded-lg p-2 text-muted hover:bg-surface-2" aria-label={`Alertas (${al.length})`} aria-expanded={bell}>
                  <Bell size={19} /><span className="num absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-bad px-1 text-[10px] font-semibold text-white">{al.length}</span>
                </button>
                {bell && (
                  <div className="absolute right-0 top-11 z-40 w-[min(360px,calc(100vw-32px))] rounded-xl border border-line bg-surface shadow-xl">
                    <div className="border-b border-line px-4 py-3 text-[14px] font-semibold">Alertas</div>
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
              <div className="relative">
                <button onClick={() => setMenuUsuario((v) => !v)} aria-expanded={menuUsuario} className="ml-1 flex h-9 items-center gap-2 rounded-full pl-1 pr-1 hover:bg-surface-2 sm:pr-3" title="Su cuenta">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-[11px] font-semibold text-on-brand">{iniciales}</span>
                  <span className="hidden text-[13px] text-muted sm:inline">Salir</span>
                </button>
                {menuUsuario && <div className="fixed inset-0 z-30" aria-hidden onClick={() => setMenuUsuario(false)} />}
                {menuUsuario && (
                  <div className="absolute right-0 top-11 z-40 w-64 rounded-xl border border-line bg-surface p-1.5 shadow-xl" onKeyDown={(e) => { if (e.key === 'Escape') setMenuUsuario(false); }}>
                    {usuario && <p className="px-3 py-2 text-[12px] text-muted">{usuario.nombre}<br />{usuario.rol}</p>}
                    {MODO_REAL && <OpcionNotificaciones />}
                    {MODO_REAL && <button onClick={() => { setMenuUsuario(false); setVer2fa(true); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-surface-2"><ShieldCheck size={15} className="text-brand" />Verificación en dos pasos</button>}
                    <button onClick={cerrarSesion} className="flex w-full rounded-lg px-3 py-2 text-left text-[13px] hover:bg-surface-2">Cerrar sesión</button>
                    {MODO_REAL && <button onClick={cerrarTodas} className="flex w-full rounded-lg px-3 py-2 text-left text-[13px] hover:bg-surface-2">Cerrar sesión en todos los dispositivos</button>}
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>
        <main className="safe-x mx-auto max-w-[1500px] py-5 pb-24 lg:py-7">
          {MODO_REAL && !CONECTADAS.has(route) && (
            <p className="mb-4 flex items-start gap-2 rounded-xl border border-warn/30 bg-warn/10 px-4 py-2.5 text-[13px] text-warn"><FlaskConical size={16} className="mt-px shrink-0" />Esta sección todavía muestra datos de ejemplo: lo que ve aquí no es de su empresa ni se guarda. Las demás secciones ya trabajan con el servidor.</p>
          )}
          <AvisoNotificaciones />
          {children}
        </main>
      </div>

      {MODO_REAL && <VentanaDobleFactor open={ver2fa} onClose={() => setVer2fa(false)} />}
      {MODO_REAL && <EnlaceAccesoHost />}

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <button className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} aria-label="Cerrar menú" />
          <div className="anim-slide relative h-full w-[84%] max-w-[300px] bg-surface px-3 pb-5" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)', paddingLeft: 'max(12px, env(safe-area-inset-left, 0px))' }}>
            <button onClick={() => setDrawer(false)} className="absolute right-2 top-3 rounded-lg p-2 text-muted" aria-label="Cerrar menú"><X size={20} /></button>
            {Lateral}
          </div>
        </div>
      )}

      {buscar && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Ir a una sección" onClick={() => setBuscar(false)}>
          <div className="anim-sheet w-full max-w-lg overflow-hidden rounded-2xl bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 border-b border-line px-4"><Search size={18} className="text-subtle" />
              <input ref={qRef} id="ir-a" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && resultados[0]) go(resultados[0].route); }} placeholder="Escriba una sección: tarifas, manifiestos, importar…" className="h-12 flex-1 bg-transparent text-[15px] focus:outline-none" />
            </div>
            <ul className="max-h-[50vh] overflow-y-auto p-2">
              {resultados.map((r) => (
                <li key={r.route}><button onClick={() => go(r.route)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-surface-2">
                  <r.icon size={17} className="text-brand" /><span className="flex-1"><span className="block text-[14px]">{r.label}</span>{r.desc && <span className="block text-[12px] text-muted">{r.desc}</span>}</span><span className="text-[12px] text-subtle">{r.grupo}</span>
                </button></li>
              ))}
              {!resultados.length && <li className="px-3 py-6 text-center text-muted">Sin coincidencias.</li>}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
