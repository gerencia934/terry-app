import { useCallback, useEffect, useState } from 'react';
import { LayoutGrid, LogOut, UserRound, Users } from 'lucide-react';
import { ToastProvider } from './componentes/ui';
import { Logo, MarcaTerryApp } from './componentes/Marca';
import { api, cx, ErrorApi, mensajeDe, type Yo } from './lib';
import { CrearClave, Ingreso } from './pantallas/Ingreso';
import { Menu } from './pantallas/Menu';
import { MiCuenta } from './pantallas/MiCuenta';
import { Cuentas } from './pantallas/Cuentas';

type Vista = 'menu' | 'mi-cuenta' | 'cuentas';
const vistaDelHash = (): Vista => (location.hash === '#mi-cuenta' ? 'mi-cuenta' : location.hash === '#cuentas' ? 'cuentas' : 'menu');

export default function App() {
  // Enlace de invitación (…/#clave=…): se lee una vez y se quita de la barra de direcciones
  const [token, setToken] = useState(() => {
    const m = location.hash.match(/^#clave=([A-Za-z0-9_-]{40,60})$/);
    if (m) history.replaceState(null, '', location.pathname);
    return m?.[1] ?? '';
  });
  const [yo, setYo] = useState<Yo | null | 'cargando'>('cargando');
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [vista, setVista] = useState<Vista>(vistaDelHash);

  const cargar = useCallback(async () => {
    try { setYo(await api<Yo>('yo')); setError(''); }
    catch (x) { if (x instanceof ErrorApi && x.status === 401) setYo(null); else { setYo(null); setError(mensajeDe(x)); } }
  }, []);
  useEffect(() => { if (!token) void cargar(); }, [cargar, token]);
  useEffect(() => {
    const f = () => setVista(vistaDelHash());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  const ir = (v: Vista) => { location.hash = v === 'menu' ? '' : v; setVista(v); };
  const salir = async () => { await api('salir', {}).catch(() => undefined); setYo(null); ir('menu'); };

  if (token) return <CrearClave token={token} alTerminar={(m) => { setToken(''); setAviso(m); setYo(null); }} />;
  if (yo === 'cargando') return <div className="flex min-h-full items-center justify-center"><MarcaTerryApp /></div>;
  if (!yo) return <Ingreso avisoInicial={aviso || error} alEntrar={() => { setAviso(''); void cargar(); ir('menu'); }} />;

  const enlaces: { v: Vista; texto: string; icono: typeof LayoutGrid; solo?: boolean }[] = [
    { v: 'menu', texto: 'Módulos', icono: LayoutGrid },
    { v: 'mi-cuenta', texto: 'Mi cuenta', icono: UserRound },
    { v: 'cuentas', texto: 'Cuentas', icono: Users, solo: true },
  ];
  return (
    <ToastProvider>
      <div className="flex min-h-full flex-col">
        <header className="safe-x sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur">
          <div className="mx-auto flex h-16 w-full max-w-5xl items-center gap-3">
            <button onClick={() => ir('menu')} className="flex items-center gap-3" aria-label="Ir a los módulos"><MarcaTerryApp compacta /></button>
            <nav className="ml-auto flex items-center gap-1">
              {enlaces.filter((e) => !e.solo || yo.cuenta.esAdmin).map((e) => (
                <button key={e.v} onClick={() => ir(e.v)} aria-current={vista === e.v ? 'page' : undefined}
                  className={cx('flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] font-medium', vista === e.v ? 'bg-brand-soft text-brand-ink' : 'text-muted hover:bg-surface-2 hover:text-fg')}>
                  <e.icono size={16} /><span className="hidden sm:inline">{e.texto}</span>
                </button>
              ))}
              <button onClick={salir} className="flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] font-medium text-muted hover:bg-surface-2 hover:text-fg" aria-label="Salir">
                <LogOut size={16} /><span className="hidden sm:inline">Salir</span>
              </button>
            </nav>
          </div>
        </header>
        <main className="safe-x flex-1 py-6">
          {vista === 'menu' && <Menu yo={yo} />}
          {vista === 'mi-cuenta' && <MiCuenta yo={yo} alCambiar={cargar} />}
          {vista === 'cuentas' && yo.cuenta.esAdmin && <Cuentas />}
        </main>
        <footer className="safe-x border-t border-line py-4">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 text-[12px] text-subtle">
            <span>© {new Date().getFullYear()} Terra Viva S.A.S. E.S.P. · Soluciones ambientales inteligentes</span>
            <Logo className="h-6" />
          </div>
        </footer>
      </div>
    </ToastProvider>
  );
}
