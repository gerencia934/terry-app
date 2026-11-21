// Mesa de ayuda por rol (gerencia, 20-11-2026): «que la app se explique sola y reduzca las llamadas con dudas operativas».
// El botón «?» de cada pantalla abre la guía de esa pantalla; el centro de ayuda tiene todas las guías y las preguntas
// frecuentes del módulo; y siempre está a mano a quién llamar o escribir (se configura en Ajustes › Empresa).
import { useEffect, useMemo, useState } from 'react';
import { HelpCircle, LifeBuoy, MessageCircle, Mail, Phone, Search } from 'lucide-react';
import { AYUDA, guiasDe, type AccesoAyuda, type Guia } from '@terraviva/shared';
import { Button, Input, Sheet } from './ui';
import { api } from '../lib/api';
import { cx } from '../lib/format';

export interface ContactoAyuda { nombre: string | null; telefono: string | null; whatsapp: string | null; correo: string | null }
const CACHE = 'terry-go-contacto-ayuda';

/** El contacto de ayuda del módulo (guardado en el teléfono para cuando no haya señal). */
export function useContactoAyuda() {
  const [c, setC] = useState<ContactoAyuda | null>(() => { try { return JSON.parse(localStorage.getItem(CACHE) ?? 'null') as ContactoAyuda | null; } catch { return null; } });
  useEffect(() => {
    if (!navigator.onLine) return;
    api<ContactoAyuda>('/ayuda/contacto').then((x) => { setC(x); try { localStorage.setItem(CACHE, JSON.stringify(x)); } catch { /* sin espacio */ } }).catch(() => undefined);
  }, []);
  return c;
}

const digitos = (t: string) => t.replace(/[^\d+]/g, '');
/** WhatsApp con indicativo de Colombia si el número viene de 10 dígitos. */
const enlaceWhatsapp = (t: string) => { const d = t.replace(/\D/g, ''); return `https://wa.me/${d.length === 10 ? `57${d}` : d}`; };

/** Botones grandes para llamar o escribir a quien ayuda. */
export function ContactoBotones({ contacto, acceso }: { contacto: ContactoAyuda | null; acceso: AccesoAyuda }) {
  const quien = acceso === 'CLIENTE' ? 'Terra Viva' : 'su coordinador';
  if (!contacto || (!contacto.telefono && !contacto.whatsapp && !contacto.correo))
    return <p className="rounded-xl bg-surface-2 p-3 text-[13px] text-muted">{acceso === 'CLIENTE' ? 'Escríbale a su asesor comercial de Terra Viva.' : 'Si tiene una duda que no está aquí, llame a su coordinador.'}</p>;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] text-muted">¿No encontró la respuesta? Comuníquese con {contacto.nombre ? `${contacto.nombre} (${quien})` : quien}.</p>
      <div className="grid grid-cols-2 gap-2">
        {contacto.telefono && <a href={`tel:${digitos(contacto.telefono)}`} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-brand text-[14px] font-semibold text-on-brand"><Phone size={18} /> Llamar</a>}
        {contacto.whatsapp && <a href={enlaceWhatsapp(contacto.whatsapp)} target="_blank" rel="noreferrer" className="flex h-12 items-center justify-center gap-2 rounded-xl border border-line text-[14px] font-semibold"><MessageCircle size={18} /> WhatsApp</a>}
        {contacto.correo && <a href={`mailto:${contacto.correo}`} className="col-span-2 flex h-12 items-center justify-center gap-2 rounded-xl border border-line text-[14px] font-semibold"><Mail size={18} /> {contacto.correo}</a>}
      </div>
    </div>
  );
}

/** Una guía paso a paso. */
export function GuiaVista({ g, abierta = false }: { g: Guia; abierta?: boolean }) {
  return (
    <details open={abierta} className="group rounded-xl bg-surface ring-1 ring-line">
      <summary className="flex cursor-pointer list-none items-center gap-2 p-3"><LifeBuoy size={18} className="shrink-0 text-brand" />
        <span className="min-w-0 flex-1"><span className="block text-[14px] font-semibold">{g.titulo}</span><span className="block text-[12px] text-muted">{g.resumen}</span></span>
        <span className="text-[12px] text-muted group-open:hidden">Ver</span></summary>
      <ol className="flex flex-col gap-2 px-3 pb-3 pl-9">
        {g.pasos.map((p, i) => <li key={i} className="list-decimal text-[14px] leading-snug marker:font-semibold marker:text-brand">{p}</li>)}
      </ol>
    </details>
  );
}

/** Botón «?» de la pantalla: abre las guías de esa pantalla, el contacto y el enlace a toda la ayuda. */
export function BotonAyuda({ acceso, ruta, verTodo, className }: { acceso: AccesoAyuda; ruta: string; verTodo: () => void; className?: string }) {
  const [abierta, setAbierta] = useState(false);
  const contacto = useContactoAyuda();
  const guias = guiasDe(acceso, ruta);
  return (
    <>
      <button type="button" onClick={() => setAbierta(true)} className={cx('rounded-lg p-2 text-muted hover:bg-surface-2', className)} aria-label="Ayuda de esta pantalla" title="Ayuda"><HelpCircle size={20} /></button>
      {abierta && (
        <Sheet open onClose={() => setAbierta(false)} title="Ayuda"
          footer={<Button className="w-full" onClick={() => { setAbierta(false); verTodo(); }}>Ver toda la ayuda y las preguntas frecuentes</Button>}>
          <div className="flex flex-col gap-3">
            {guias.length ? guias.map((g, i) => <GuiaVista key={g.id} g={g} abierta={i === 0} />)
              : <p className="text-[13px] text-muted">Esta pantalla no tiene una guía propia: vea toda la ayuda abajo.</p>}
            <ContactoBotones contacto={contacto} acceso={acceso} />
          </div>
        </Sheet>
      )}
    </>
  );
}

/** Centro de ayuda del módulo: contacto, búsqueda, guías paso a paso y preguntas frecuentes. */
export function CentroAyuda({ acceso }: { acceso: AccesoAyuda }) {
  const contacto = useContactoAyuda();
  const [q, setQ] = useState('');
  const { guias, preguntas } = AYUDA[acceso];
  const t = q.trim().toLowerCase();
  const g = useMemo(() => (t ? guias.filter((x) => `${x.titulo} ${x.resumen} ${x.pasos.join(' ')}`.toLowerCase().includes(t)) : guias), [t, guias]);
  const p = useMemo(() => (t ? preguntas.filter((x) => `${x.pregunta} ${x.respuesta}`.toLowerCase().includes(t)) : preguntas), [t, preguntas]);
  return (
    <div className="flex flex-col gap-4">
      <ContactoBotones contacto={contacto} acceso={acceso} />
      <div className="relative"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar: manifiesto, firma, señal…" className="pl-9" aria-label="Buscar en la ayuda" /></div>
      <section><h2 className="mb-2 text-[16px] font-semibold">Paso a paso</h2>
        <div className="flex flex-col gap-2">{g.map((x) => <GuiaVista key={x.id} g={x} />)}{!g.length && <p className="text-[13px] text-muted">Nada con esa búsqueda.</p>}</div></section>
      <section><h2 className="mb-2 text-[16px] font-semibold">Preguntas frecuentes</h2>
        <div className="flex flex-col gap-2">{p.map((x) => (
          <details key={x.pregunta} className="rounded-xl bg-surface p-3 ring-1 ring-line"><summary className="cursor-pointer text-[14px] font-semibold">{x.pregunta}</summary>
            <p className="mt-2 text-[14px] leading-snug">{x.respuesta}</p></details>))}
          {!p.length && <p className="text-[13px] text-muted">Nada con esa búsqueda.</p>}</div></section>
    </div>
  );
}
