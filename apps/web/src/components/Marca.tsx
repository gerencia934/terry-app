import { cx } from '../lib/format';
import terryIcono from '../assets/terry-icono.webp';

/** Nombre del módulo dentro del ERP Terry-App (estándar 4: Terry-App Residuos, Mtto, CRM, HSEQ; todos usan este mismo sello). */
export const MODULO = 'Residuos';

/** Marca del ecosistema: Terry, «Terry-App» y el módulo debajo, como en Terry-App Mtto. */
export function MarcaTerryApp({ className, compacta }: { className?: string; compacta?: boolean }) {
  return (
    <div className={cx('flex items-center gap-3', className)}>
      <img src={terryIcono} alt="" className={cx('rounded-2xl shadow-sm', compacta ? 'h-10 w-10 rounded-xl' : 'h-14 w-14')} />
      <div>
        <p className={cx('font-display font-extrabold leading-none tracking-tight', compacta ? 'text-[20px]' : 'text-[28px]')}>
          <span className="text-brand">Terry</span><span className="text-brand-lime">-App</span>
        </p>
        <p className="mt-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-subtle">
          <span className="h-0.5 w-5 rounded-full bg-brand-lime" aria-hidden />{MODULO}
        </p>
      </div>
    </div>
  );
}
