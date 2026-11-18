import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

// Enrutamiento por hash plano (#inicio, #solicitudes…). Funciona en hosting estático
// y dentro del prototipo publicado. En producción puede migrarse a React Router sin tocar páginas.
export const ROUTES = [
  'login', 'recuperar', 'inicio',
  'declaraciones', 'precios', 'cargues', 'exportable',
  'solicitudes', 'pre-solicitudes',
  'rutas', 'rastreo', 'informe-rutas', 'estados-recorrido',
  'chequeo', 'manifiestos', 'conciliaciones', 'actas', 'inventario',
  'informes', 'indicadores',
  'configuracion', 'config-clientes', 'config-vehiculos', 'config-usuarios', 'config-catalogos', 'config-permisos', 'config-datos',
  'campo', 'campo-preop', 'campo-parada',
] as const;
export type RouteName = (typeof ROUTES)[number];
const VALID = new Set<string>(ROUTES);

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
