// Portal de clientes (fase 3; requisitos de producción §2). Lo usa solo el personal de cada cliente: consulta y descarga
// lo suyo (declaraciones, solicitudes, manifiestos, certificados e informes). Doble barrera en el servidor: el API filtra
// por el cliente del token y la base (RLS) lo vuelve a filtrar. Aquí nada depende de datos que mande el navegador.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Award, BarChart3, Building2, FileStack, FileText, Home, Info, Loader2, MapPin, Menu, Moon, ShieldCheck, Sun, Truck, UserCog, X, type LucideIcon } from 'lucide-react';
import { Logo, useTheme } from '../../components/AppShell';
import { VentanaDobleFactor } from '../../components/DobleFactor';
import { Proteccion } from '../../components/Proteccion';
import { Button } from '../../components/ui';
import { salir, salirDeTodos } from '../../lib/api';
import { useApi } from '../../lib/servidor';
import { useRouter, type RouteName } from '../../lib/router';
import { cx } from '../../lib/format';
import { PortalCertificados, PortalDeclaraciones, PortalInformes, PortalInicio, PortalManifiestos, PortalSolicitudes } from './Consulta';
import { PortalUsuarios } from './UsuariosPortal';
import { PortalSedes } from './Sedes';
import { EnlaceAccesoHost } from '../../components/EnlaceAcceso';

export interface SedePortal { id: string; codigo: string | null; nombre: string; municipio?: { nombre: string } | null }
export interface YoPortal {
  usuario: { nombre: string; email: string; perfilPortal: 'ADMIN' | 'CONSULTA' };
  cliente: { id: string; razonSocial: string; nit: string; dv: string | null; tipo: 'DIRECTO' | 'GESTOR'; activo: boolean };
  perfil: 'ADMIN' | 'CONSULTA';
  /** Sedes que ve este usuario (todas las de su empresa si no está limitado). */
  sedes: SedePortal[];
  restringido: boolean;
  /** Cliente inactivo: aviso amable según el motivo (consulta y descarga; no pide servicios ni carga declaraciones). */
  aviso: string | null;
  /** Vuelve a leer «quién soy» (por ejemplo, después de crear o inactivar una sede). */
  recargar?: () => void;
}
/** Puede pedir servicios y cargar declaraciones: perfil Administrador y cliente activo. */
export const puedeEscribir = (yo: YoPortal) => yo.perfil === 'ADMIN' && yo.cliente.activo;
const Ctx = createContext<YoPortal | null>(null);
/** Quién está en el portal: su empresa, su perfil y las sedes que puede ver. */
export const usePortal = () => useContext(Ctx)!;
export const nitConDv = (c: { nit: string; dv: string | null }) => (c.dv ? `${c.nit}-${c.dv}` : c.nit);
export const PERFIL: Record<'ADMIN' | 'CONSULTA', string> = { ADMIN: 'Administrador', CONSULTA: 'Consulta' };

interface Item { route: RouteName; label: string; icon: LucideIcon; soloAdmin?: boolean }
const MENU: Item[] = [
  { route: 'portal', label: 'Inicio', icon: Home },
  { route: 'portal-sedes', label: 'Sedes', icon: Building2 },
  { route: 'portal-declaraciones', label: 'Declaraciones', icon: FileText },
  { route: 'portal-solicitudes', label: 'Solicitudes', icon: Truck },
  { route: 'portal-manifiestos', label: 'Manifiestos', icon: FileStack },
  { route: 'portal-certificados', label: 'Certificados', icon: Award },
  { route: 'portal-informes', label: 'Informes', icon: BarChart3 },
  { route: 'portal-usuarios', label: 'Usuarios', icon: UserCog, soloAdmin: true },
];
const RUTAS = new Set<RouteName>(MENU.map((m) => m.route));
/** Cambia de sección sin dejar la anterior en el historial (el botón «atrás» no vuelve a una ruta de oficina). */
const reemplazar = (r: RouteName) => location.replace(`#${r}`);

export function PortalApp() {
  const { route } = useRouter();
  const yo = useApi<YoPortal>('/portal/yo');
  const propia = RUTAS.has(route) && (route !== 'portal-usuarios' || !yo.datos || yo.datos.perfil === 'ADMIN');
  useEffect(() => { if (!propia) reemplazar('portal'); }, [propia]);
  if (yo.error) return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg p-6 text-center">
      <Logo className="h-12" />
      <p className="max-w-sm text-bad">{yo.error}</p>
      <div className="flex gap-2"><Button onClick={() => yo.recargar()}>Reintentar</Button><Button variant="ghost" onClick={() => salir()}>Salir</Button></div>
    </div>
  );
  if (!yo.datos) return <div className="flex min-h-screen items-center justify-center gap-2 bg-bg text-muted"><Loader2 size={18} className="animate-spin" />Cargando su portal…</div>;
  const pagina = (() => {
    switch (route) {
      case 'portal-sedes': return <PortalSedes />;
      case 'portal-declaraciones': return <PortalDeclaraciones />;
      case 'portal-solicitudes': return <PortalSolicitudes />;
      case 'portal-manifiestos': return <PortalManifiestos />;
      case 'portal-certificados': return <PortalCertificados />;
      case 'portal-informes': return <PortalInformes />;
      case 'portal-usuarios': return yo.datos.perfil === 'ADMIN' ? <PortalUsuarios /> : <PortalInicio />;
      default: return <PortalInicio />;
    }
  })();
  return <Ctx.Provider value={{ ...yo.datos, recargar: yo.recargar }}><Marco><Proteccion key={route}>{pagina}</Proteccion></Marco></Ctx.Provider>;
}

function Marco({ children }: { children: ReactNode }) {
  const { route, go } = useRouter();
  const yo = usePortal();
  const { dark, toggle } = useTheme();
  const [menu, setMenu] = useState(false);
  const [cuenta, setCuenta] = useState(false);
  const [ver2fa, setVer2fa] = useState(false);
  useEffect(() => { setMenu(false); setCuenta(false); }, [route]);
  const items = MENU.filter((m) => !m.soloAdmin || yo.perfil === 'ADMIN');
  const actual = items.find((i) => i.route === route);
  const iniciales = yo.usuario.nombre.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const cerrar = async (todas: boolean) => { if (todas) await salirDeTodos(); else await salir(); go('login'); };

  const Lateral = (
    <div className="flex h-full flex-col">
      <button onClick={() => go('portal')} className="mb-4 px-2 text-left" aria-label="Portal de clientes: ir al inicio">
        <Logo className="h-10" />
        <span className="mt-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-subtle">Portal de clientes</span>
      </button>
      <div className="mb-4 rounded-xl border border-brand/15 bg-brand-soft px-3 py-2.5">
        <p className="text-[13px] font-semibold leading-snug text-brand-ink">{yo.cliente.razonSocial}</p>
        <p className="num mt-0.5 text-[12px] text-brand-ink/80">NIT {nitConDv(yo.cliente)}</p>
      </div>
      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto" aria-label="Secciones del portal">
        {items.map((it) => (
          <button key={it.route} onClick={() => go(it.route)} aria-current={route === it.route ? 'page' : undefined}
            className={cx('flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-[14px] transition-colors',
              route === it.route ? 'bg-brand-soft font-semibold text-brand-ink' : 'text-muted hover:bg-surface-2 hover:text-fg')}>
            <it.icon size={18} className={cx('shrink-0', route === it.route ? 'text-brand' : '')} /><span className="truncate">{it.label}</span>
          </button>
        ))}
      </nav>
      <div className="mt-4 border-t border-line pt-3 text-[12px] text-muted">
        {yo.restringido
          ? <p className="flex items-start gap-1.5"><MapPin size={13} className="mt-0.5 shrink-0" /><span>Usted ve la información de {yo.sedes.length === 1 ? 'la sede' : 'las sedes'} {yo.sedes.map((s) => s.nombre).join(', ')}.</span></p>
          : <p className="flex items-start gap-1.5"><MapPin size={13} className="mt-0.5 shrink-0" /><span>Usted ve la información de todas las sedes de su empresa.</span></p>}
      </div>
    </div>
  );

  return (
    <div className="min-h-full lg:grid lg:grid-cols-[250px_1fr]">
      <aside className="sticky top-0 hidden h-screen border-r border-line bg-surface px-3 py-5 lg:block">{Lateral}</aside>
      <div className="min-w-0">
        <header className="sticky z-30 border-b border-line bg-bg/90 backdrop-blur" style={{ top: 'env(safe-area-inset-top, 0px)' }}>
          <div className="safe-x flex h-14 items-center gap-2">
            <button className="-ml-2 rounded-lg p-2 lg:hidden" onClick={() => setMenu(true)} aria-label="Abrir menú"><Menu size={22} /></button>
            <span className="lg:hidden"><Logo className="h-7" /></span>
            <p className="hidden min-w-0 truncate text-[13px] text-muted lg:block">Portal de clientes <span className="text-subtle">/</span> <span className="font-medium text-fg">{actual?.label}</span></p>
            <div className="ml-auto flex items-center">
              <button onClick={toggle} className="rounded-lg p-2 text-muted hover:bg-surface-2" aria-label={dark ? 'Usar tema claro' : 'Usar tema oscuro'}>{dark ? <Sun size={19} /> : <Moon size={19} />}</button>
              <div className="relative">
                <button onClick={() => setCuenta((v) => !v)} aria-expanded={cuenta} className="ml-1 flex h-9 items-center gap-2 rounded-full pl-1 pr-1 hover:bg-surface-2 sm:pr-3" title="Su cuenta">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-[11px] font-semibold text-on-brand">{iniciales}</span>
                  <span className="hidden max-w-[160px] truncate text-[13px] text-muted sm:inline">{yo.usuario.nombre}</span>
                </button>
                {cuenta && <div className="fixed inset-0 z-30" aria-hidden onClick={() => setCuenta(false)} />}
                {cuenta && (
                  <div className="absolute right-0 top-11 z-40 w-72 rounded-xl border border-line bg-surface p-1.5 shadow-xl" onKeyDown={(e) => { if (e.key === 'Escape') setCuenta(false); }}>
                    <div className="px-3 py-2 text-[12px] text-muted">
                      <p className="text-[13px] font-medium text-fg">{yo.usuario.nombre}</p>
                      <p className="truncate">{yo.usuario.email}</p>
                      <p>{PERFIL[yo.perfil]} · {yo.cliente.razonSocial}</p>
                    </div>
                    <button onClick={() => { setCuenta(false); setVer2fa(true); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-surface-2"><ShieldCheck size={15} className="text-brand" />Verificación en dos pasos</button>
                    <button onClick={() => cerrar(false)} className="flex w-full rounded-lg px-3 py-2 text-left text-[13px] hover:bg-surface-2">Cerrar sesión</button>
                    <button onClick={() => cerrar(true)} className="flex w-full rounded-lg px-3 py-2 text-left text-[13px] hover:bg-surface-2">Cerrar sesión en todos los dispositivos</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>
        <main className="safe-x mx-auto max-w-[1300px] py-5 pb-24 lg:py-7">
          {yo.aviso && <p role="status" className="mb-5 flex items-start gap-2.5 rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-[13px] leading-relaxed"><Info size={17} className="mt-0.5 shrink-0 text-warn" /><span>{yo.aviso}</span></p>}
          {children}
        </main>
      </div>

      <VentanaDobleFactor open={ver2fa} onClose={() => setVer2fa(false)} />

      {menu && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <button className="absolute inset-0 bg-black/40" onClick={() => setMenu(false)} aria-label="Cerrar menú" />
          <div className="anim-slide relative h-full w-[84%] max-w-[300px] bg-surface px-3 pb-5" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)', paddingLeft: 'max(12px, env(safe-area-inset-left, 0px))' }}>
            <button onClick={() => setMenu(false)} className="absolute right-2 top-3 rounded-lg p-2 text-muted" aria-label="Cerrar menú"><X size={20} /></button>
            {Lateral}
          </div>
        </div>
      )}
      <EnlaceAccesoHost />
    </div>
  );
}
