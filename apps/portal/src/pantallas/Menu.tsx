import { useState } from 'react';
import { ArrowRight, Factory, Handshake, Loader2, Recycle, Wrench, type LucideIcon } from 'lucide-react';
import { Badge, Button } from '../componentes/ui';
import { api, cx, mensajeDe, type IdModulo, type ModuloMenu, type Yo } from '../lib';
import terrySaludo from '../assets/terry-saludo.webp';

const ICONOS: Record<IdModulo, LucideIcon> = { residuos: Recycle, mantenimiento: Wrench, crm: Handshake, planta: Factory };
const ESTADO: Record<NonNullable<ModuloMenu['estado']>, { texto: string; tono: 'ok' | 'warn' | 'neutral' }> = {
  disponible: { texto: 'Disponible', tono: 'ok' },
  'sin-respuesta': { texto: 'No responde ahora', tono: 'warn' },
  proximamente: { texto: 'Próximamente', tono: 'neutral' },
};

/** Menú del portal: los módulos que permite la cuenta. Un módulo que no responde sale en gris; los demás siguen igual. */
export function Menu({ yo }: { yo: Yo }) {
  const [abriendo, setAbriendo] = useState<IdModulo | null>(null);
  const [err, setErr] = useState('');
  const visibles = yo.modulos.filter((m) => m.acceso || m.estado === 'proximamente');
  const abrir = async (m: ModuloMenu) => {
    setErr(''); setAbriendo(m.id);
    try { window.location.assign((await api<{ url: string }>('pase', { modulo: m.id })).url); }
    catch (x) { setErr(mensajeDe(x)); setAbriendo(null); }
  };
  const nombre = yo.cuenta.nombre.split(' ')[0];
  return (
    <div className="mx-auto w-full max-w-5xl">
      <section className="flex items-center gap-5 overflow-hidden rounded-2xl bg-[#216840] px-6 py-6 text-white sm:px-8">
        <img src={terrySaludo} alt="" className="hidden h-28 w-28 shrink-0 rounded-2xl object-cover sm:block" />
        <div className="min-w-0">
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#D2FFAE]">Terry-App</p>
          <h1 className="mt-1 font-display text-[26px] font-bold leading-tight">Hola, {nombre}</h1>
          <p className="mt-1 text-white/85">¿A qué módulo quiere entrar? Cada uno trabaja por su cuenta: si uno se detiene, los demás siguen.</p>
        </div>
      </section>
      {err && <p className="mt-4 rounded-lg bg-bad/10 px-3 py-2 text-[13px] text-bad" role="alert">{err}</p>}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {visibles.map((m) => {
          const Icono = ICONOS[m.id];
          const e = ESTADO[m.estado ?? 'proximamente'];
          const apagado = m.estado !== 'disponible';
          const proximamente = m.estado === 'proximamente';
          return (
            <article key={m.id} className={cx('flex flex-col rounded-2xl border border-line bg-surface p-5 transition-shadow', !apagado && 'hover:shadow-md', apagado && 'opacity-70')}>
              <div className="flex items-start justify-between gap-3">
                <span className={cx('flex h-12 w-12 items-center justify-center rounded-xl', apagado ? 'bg-surface-2 text-subtle' : 'bg-brand-soft text-brand')}><Icono size={24} /></span>
                <Badge tone={e.tono} dot>{e.texto}</Badge>
              </div>
              <h2 className="mt-4 font-display text-[18px] font-bold text-fg">{m.nombre}</h2>
              <p className="mt-1 flex-1 text-[13px] text-muted">{m.descripcion}</p>
              <Button variant={apagado ? 'secondary' : 'primary'} className="mt-4 self-start" disabled={proximamente || abriendo !== null} onClick={() => abrir(m)}>
                {abriendo === m.id ? <><Loader2 size={16} className="animate-spin" /> Abriendo…</> : proximamente ? 'Próximamente' : <>Entrar <ArrowRight size={16} /></>}
              </Button>
            </article>
          );
        })}
      </div>
      {visibles.every((m) => !m.acceso) && (
        <p className="mt-6 rounded-xl border border-line bg-surface p-4 text-[13px] text-muted">Su cuenta todavía no tiene módulos asignados. Pídale al administrador del portal que le dé acceso.</p>
      )}
    </div>
  );
}
