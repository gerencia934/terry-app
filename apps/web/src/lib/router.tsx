import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

// Enrutamiento por hash plano (#inicio, #solicitudes…). Funciona en hosting estático
// y dentro del prototipo publicado. En producción puede migrarse a React Router sin tocar páginas.
export type RouteName =
  | 'login' | 'recuperar' | 'inicio'
  | 'decl-residuos' | 'decl-servicios' | 'precios'
  | 'solicitudes' | 'rutas'
  | 'preoperacionales' | 'manifiestos' | 'actas'
  | 'informes'
  | 'config-clientes' | 'config-vehiculos' | 'config-usuarios' | 'config-catalogos' | 'config-permisos'
  | 'campo' | 'campo-preop' | 'campo-parada';

const VALID = new Set<string>(['login', 'recuperar', 'inicio', 'decl-residuos', 'decl-servicios', 'precios', 'solicitudes', 'rutas',
  'preoperacionales', 'manifiestos', 'actas', 'informes', 'config-clientes', 'config-vehiculos', 'config-usuarios',
  'config-catalogos', 'config-permisos', 'campo', 'campo-preop', 'campo-parada']);

const read = (): RouteName => { const h = location.hash.replace('#', ''); return (VALID.has(h) ? h : 'login') as RouteName; };

const Ctx = createContext<{ route: RouteName; go: (r: RouteName) => void }>({ route: 'login', go: () => {} });

export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<RouteName>(read);
  useEffect(() => {
    const on = () => { setRoute(read()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = (r: RouteName) => { if (location.hash === `#${r}`) setRoute(r); else location.hash = r; };
  return <Ctx.Provider value={{ route, go }}>{children}</Ctx.Provider>;
}
export const useRouter = () => useContext(Ctx);
