import type { ReactNode } from 'react';
import { cx } from '../lib';
import { Carrusel } from './Carrusel';
import logoLight from '../assets/logo-light.webp';
import logoDark from '../assets/logo-dark.webp';
import terryIcono from '../assets/terry-icono.webp';

/** Logo de Terra Viva: versión clara u oscura según el tema. */
export function Logo({ className = 'h-9' }: { className?: string }) {
  return (
    <span className="inline-flex items-center">
      <img src={logoLight} alt="Terra Viva S.A.S. E.S.P." className={cx('logo-light w-auto', className)} />
      <img src={logoDark} alt="Terra Viva S.A.S. E.S.P." className={cx('logo-dark w-auto', className)} />
    </span>
  );
}

/** Marca del ecosistema: Terry, «Terry-App» y debajo el nombre de la sección (aquí, el portal). */
export function MarcaTerryApp({ className, compacta, seccion = 'Portal' }: { className?: string; compacta?: boolean; seccion?: string }) {
  return (
    <div className={cx('flex items-center gap-3', className)}>
      <img src={terryIcono} alt="" className={cx('rounded-2xl shadow-sm', compacta ? 'h-10 w-10 rounded-xl' : 'h-14 w-14')} />
      <div>
        <p className={cx('font-display font-extrabold leading-none tracking-tight', compacta ? 'text-[20px]' : 'text-[28px]')}>
          <span className="text-brand">Terry</span><span className="text-brand-lime">-App</span>
        </p>
        <p className="mt-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-subtle">
          <span className="h-0.5 w-5 rounded-full bg-brand-lime" aria-hidden />{seccion}
        </p>
      </div>
    </div>
  );
}

/** Pantalla dividida del ingreso: formulario a la izquierda (blanco) y carrusel a la derecha, como en los módulos. */
export function PantallaIngreso({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-full bg-surface lg:grid-cols-[minmax(440px,0.85fr)_1fr]">
      <main className="safe-x flex min-h-full flex-col py-8 lg:px-12">
        <Logo className="h-11 self-start" />
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[400px]">{children}</div>
        </div>
        <p className="text-[12px] text-subtle">© {new Date().getFullYear()} Terra Viva S.A.S. E.S.P. · Soluciones ambientales inteligentes</p>
      </main>
      <Carrusel className="hidden lg:flex" />
    </div>
  );
}

/** Aviso de error o de éxito dentro de un formulario. */
export function Aviso({ tono = 'bad', children }: { tono?: 'bad' | 'ok' | 'info'; children: ReactNode }) {
  if (!children) return null;
  const color = tono === 'bad' ? 'bg-bad/10 text-bad' : tono === 'ok' ? 'bg-ok/10 text-ok' : 'bg-info/10 text-info';
  return <p className={cx('rounded-lg px-3 py-2 text-[13px]', color)} role={tono === 'bad' ? 'alert' : 'status'}>{children}</p>;
}
