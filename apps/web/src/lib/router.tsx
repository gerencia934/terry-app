import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

// Enrutamiento por hash plano (#inicio, #solicitudes…). Funciona en hosting estático
// y dentro del prototipo publicado. En producción puede migrarse a React Router sin tocar páginas.
export const ROUTES = [
  'login', 'recuperar', 'restablecer', 'inicio',
  'comercial', 'clientes', 'declaraciones', 'tarifas', 'exportar',
  'solicitudes', 'por-confirmar', 'programacion', 'programacion-tabla', 'seguimiento',
  'inspecciones', 'manifiestos',
  'recepcion', 'descargues', 'inventario', 'certificados', 'facturacion',
  'permisos',
  'indicadores', 'informes',
  'ajustes', 'importar', 'empresa', 'vehiculos', 'usuarios', 'roles', 'catalogos', 'etapas',
  'campo', 'campo-preop', 'campo-parada', 'campo-envios', 'campo-vehiculo', 'campo-bitacora', 'bitacora', 'campo-ayuda', 'ayuda', 'portal-ayuda', 'campo-mas',
  // Portal de clientes: solo lo usan los usuarios de un cliente (la oficina no entra y el cliente no sale de aquí)
  'portal', 'portal-sedes', 'portal-declaraciones', 'portal-solicitudes', 'portal-manifiestos', 'portal-certificados', 'portal-informes', 'portal-usuarios',
  'verificar', // pública: #verificar/<código del QR>
] as const;
export type RouteName = (typeof ROUTES)[number];
const VALID = new Set<string>(ROUTES);

/** Código del QR en «#verificar/<código>» o en la ruta «/verificar/<código>». */
export const codigoVerificacion = () =>
  (location.hash.match(/^#verificar\/([0-9a-fA-F]+)/)?.[1] ?? location.pathname.match(/\/verificar\/([0-9a-fA-F]+)\/?$/)?.[1] ?? '').toLowerCase();
const read = (): RouteName => {
  const h = location.hash.replace('#', '');
  if (h.startsWith('verificar') || /\/verificar\/[0-9a-fA-F]+\/?$/.test(location.pathname)) return 'verificar';
  return (VALID.has(h) ? h : 'login') as RouteName;
};

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
