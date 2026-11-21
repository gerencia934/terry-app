// Portal de clientes: las sedes del cliente (autogestión, 20-11-2026). El administrador que ve toda la empresa crea
// sedes; cualquier administrador corrige las suyas (dirección, ubicación GPS, contactos, horarios) o las inactiva. La
// sede principal y la zona de ruta las maneja Terra Viva. El servidor y la base de datos vuelven a exigir todo esto.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Building2, ExternalLink, Loader2, LocateFixed, MapPin, Plus, Power, Star, User } from 'lucide-react';
import { Badge, Button, DefList, Field, Input, PageHeader, Select, Sheet, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { useApi } from '../../lib/servidor';
import { cx } from '../../lib/format';
import { puedeHacer, usePortal } from './PortalApp';
import { errorPortal } from './comun';

export interface SedeCompleta {
  id: string; codigo: string | null; nombre: string; esPrincipal: boolean; activa: boolean; clasificacion: string | null; generadorNit: string | null; generadorNombre: string | null;
  direccion: string | null; municipioDane: string | null; municipio: { nombre: string; departamento: string } | null; latitud: number | null; longitud: number | null;
  registroRespel: string | null; registroRcd: string | null; contacto: string | null; telefono: string | null; celular: string | null; emails: string | null;
  atencionLvDesde: string | null; atencionLvHasta: string | null; atencionFdDesde: string | null; atencionFdHasta: string | null; observaciones: string | null; declaracionesActivas: number;
}
const CLASIFICACION: Record<string, string> = { INDUSTRIAL: 'Industrial', COMERCIAL: 'Comercial', INSTITUCIONAL: 'Institucional', RESIDENCIAL: 'Residencial' };
const mapa = (s: { latitud: number | null; longitud: number | null }) => (s.latitud !== null && s.longitud !== null ? `https://www.google.com/maps?q=${s.latitud},${s.longitud}` : null);
const horario = (d: string | null, h: string | null) => (d && h ? `${d} a ${h}` : d ? `desde ${d}` : h ? `hasta ${h}` : null);

export function PortalSedes() {
  const yo = usePortal();
  const lista = useApi<SedeCompleta[]>('/portal/sedes');
  const [sel, setSel] = useState<SedeCompleta | null>(null);
  const [form, setForm] = useState<null | { sede?: SedeCompleta }>(null);
  const escribe = puedeHacer(yo, 'portal.sedes.gestionar');
  const activas = lista.datos?.filter((s) => s.activa) ?? [];
  const inactivas = lista.datos?.filter((s) => !s.activa) ?? [];
  const listo = () => { setForm(null); setSel(null); lista.recargar(); yo.recargar?.(); };
  return (
    <>
      <PageHeader title="Sedes" subtitle="Los lugares donde Terra Viva recoge sus residuos o presta sus servicios. Mantenga al día la dirección, la ubicación, los contactos y los horarios de recibo: así el conductor llega sin perderse."
        actions={escribe && !yo.restringido ? <Button variant="primary" onClick={() => setForm({})}><Plus size={16} /> Nueva sede</Button> : undefined} />
      {lista.error ? <p className="rounded-xl bg-bad/10 p-4 text-bad">{lista.error}</p> : !lista.datos ? (
        <p className="flex items-center gap-2 p-6 text-muted"><Loader2 size={16} className="animate-spin" />Cargando…</p>
      ) : !lista.datos.length ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-muted">Aún no tiene sedes registradas.{escribe && !yo.restringido ? ' Cree la primera con «Nueva sede».' : ''}</p>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{activas.map((s) => <TarjetaSede key={s.id} s={s} abrir={() => setSel(s)} />)}</div>
          {inactivas.length > 0 && (
            <details className="mt-6">
              <summary className="cursor-pointer text-[13px] font-medium text-muted">Sedes inactivas ({inactivas.length})</summary>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{inactivas.map((s) => <TarjetaSede key={s.id} s={s} abrir={() => setSel(s)} />)}</div>
            </details>
          )}
        </>
      )}
      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel?.nombre ?? ''}
        footer={sel && escribe ? <Button variant="primary" onClick={() => { setForm({ sede: sel }); setSel(null); }}>Corregir datos</Button> : undefined}>
        {sel && <DetalleSede s={sel} escribe={escribe} listo={listo} />}
      </Sheet>
      <Sheet open={!!form} onClose={() => setForm(null)} title={form?.sede ? `Corregir ${form.sede.nombre}` : 'Nueva sede'}>
        {form && <FormSede sede={form.sede} gestor={yo.cliente.tipo === 'GESTOR'} listo={listo} />}
      </Sheet>
    </>
  );
}

function TarjetaSede({ s, abrir }: { s: SedeCompleta; abrir: () => void }) {
  return (
    <button onClick={abrir} className={cx('flex flex-col gap-2 rounded-xl border p-4 text-left text-[13px] transition-colors hover:border-brand/40 hover:bg-surface-2', s.activa ? 'border-line bg-surface' : 'border-dashed border-line opacity-75')}>
      <span className="flex items-start gap-2">
        <span className="rounded-lg bg-brand-soft p-2 text-brand-ink"><Building2 size={16} /></span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold leading-snug">{s.nombre}</span>
          <span className="text-[12px] text-muted">{[s.codigo, s.municipio ? `${s.municipio.nombre} (${s.municipio.departamento})` : null].filter(Boolean).join(' · ') || 'Sin municipio'}</span>
        </span>
        {s.esPrincipal && <Badge tone="brand"><Star size={11} /> Principal</Badge>}
        {!s.activa && <Badge>Inactiva</Badge>}
      </span>
      {s.direccion && <span className="flex items-start gap-1.5 text-muted"><MapPin size={13} className="mt-0.5 shrink-0" />{s.direccion}</span>}
      {(s.contacto || s.celular || s.telefono) && <span className="flex items-start gap-1.5 text-muted"><User size={13} className="mt-0.5 shrink-0" />{[s.contacto, s.celular ?? s.telefono].filter(Boolean).join(' · ')}</span>}
      <span className="mt-auto flex flex-wrap gap-1.5 pt-1">
        <Badge tone={s.declaracionesActivas ? 'ok' : 'neutral'}>{s.declaracionesActivas} {s.declaracionesActivas === 1 ? 'residuo o servicio autorizado' : 'residuos o servicios autorizados'}</Badge>
        {s.latitud === null && <Badge tone="warn">Sin ubicación GPS</Badge>}
      </span>
    </button>
  );
}

function DetalleSede({ s, escribe, listo }: { s: SedeCompleta; escribe: boolean; listo: () => void }) {
  const toast = useToast();
  const [ocupado, setOcupado] = useState(false);
  const enlace = mapa(s);
  const cambiarActiva = async () => {
    if (s.activa && !window.confirm(`¿Inactivar la sede «${s.nombre}»? Deja de recibir servicios y sus residuos dejan de pedirse en ella. Puede reactivarla después.`)) return;
    setOcupado(true);
    try {
      await api(`/portal/sedes/${s.id}`, { metodo: 'PATCH', cuerpo: { activa: !s.activa } });
      toast(s.activa ? `Sede ${s.nombre} inactivada.` : `Sede ${s.nombre} reactivada. Si necesita pedir allí residuos que antes tenía, pídale a Terra Viva que los habilite de nuevo.`);
      listo();
    } catch (e) { toast(errorPortal(e, 'No se pudo cambiar la sede.'), 'warn'); }
    setOcupado(false);
  };
  return (
    <div className="flex flex-col gap-5">
      <p className="flex flex-wrap gap-1.5">{s.esPrincipal && <Badge tone="brand"><Star size={11} /> Sede principal</Badge>}<Badge tone={s.activa ? 'ok' : 'neutral'} dot>{s.activa ? 'Activa' : 'Inactiva'}</Badge>
        {s.clasificacion && <Badge>{CLASIFICACION[s.clasificacion] ?? s.clasificacion}</Badge>}</p>
      <DefList items={[
        ['Código', s.codigo ?? '—'],
        ...(s.generadorNit || s.generadorNombre ? [['Generador', `${s.generadorNombre ?? ''}${s.generadorNit ? ` · NIT ${s.generadorNit}` : ''}`] as [string, string]] : []),
        ['Dirección', s.direccion ?? '—'], ['Municipio', s.municipio ? `${s.municipio.nombre} (${s.municipio.departamento})` : '—'],
        ['Ubicación GPS', enlace ? <a href={enlace} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand underline-offset-2 hover:underline"><span className="num">{s.latitud?.toFixed(5)}, {s.longitud?.toFixed(5)}</span><ExternalLink size={12} /></a> : 'Sin ubicación: agréguela para que el conductor llegue sin perderse'],
        ['Contacto', s.contacto ?? '—'], ['Teléfonos', [s.celular, s.telefono].filter(Boolean).join(' · ') || '—'], ['Correos', s.emails ?? '—'],
        ['Horario lunes a viernes', horario(s.atencionLvDesde, s.atencionLvHasta) ?? '—'], ['Horario fines de semana', horario(s.atencionFdDesde, s.atencionFdHasta) ?? '—'],
        ['Registro RESPEL (IDEAM)', s.registroRespel ?? '—'], ...(s.registroRcd ? [['Registro de generador RCD', s.registroRcd] as [string, string]] : []),
        ['Residuos y servicios autorizados aquí', String(s.declaracionesActivas)],
      ]} />
      {s.observaciones && <p className="rounded-lg bg-surface-2 p-3 text-[13px] text-muted">{s.observaciones}</p>}
      {escribe && !s.esPrincipal && (
        <Button variant={s.activa ? 'danger' : 'secondary'} size="sm" disabled={ocupado} onClick={cambiarActiva}>
          {ocupado ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />}{s.activa ? 'Inactivar esta sede' : 'Reactivar esta sede'}
        </Button>
      )}
      {s.esPrincipal && <p className="text-[12px] text-subtle">La sede principal no se inactiva. Si cambió, pídale a Terra Viva que la actualice.</p>}
    </div>
  );
}

interface Municipio { codigoDane: string; nombre: string; departamento: string }
const vacia = { nombre: '', codigo: '', clasificacion: '', generadorNit: '', generadorNombre: '', direccion: '', municipioDane: '', municipioTexto: '', latitud: '', longitud: '',
  contacto: '', telefono: '', celular: '', emails: '', atencionLvDesde: '', atencionLvHasta: '', atencionFdDesde: '', atencionFdHasta: '', registroRespel: '', registroRcd: '', observaciones: '' };

function FormSede({ sede, gestor, listo }: { sede?: SedeCompleta; gestor: boolean; listo: () => void }) {
  const toast = useToast();
  const [f, setF] = useState(() => sede ? {
    ...vacia, ...Object.fromEntries(Object.entries(sede).filter(([k]) => k in vacia).map(([k, v]) => [k, v === null ? '' : String(v)])),
    municipioTexto: sede.municipio ? `${sede.municipio.nombre} (${sede.municipio.departamento})` : '',
  } as typeof vacia : vacia);
  const [ocupado, setOcupado] = useState(false);
  const [ubicando, setUbicando] = useState(false);
  const set = (c: Partial<typeof vacia>) => setF((s) => ({ ...s, ...c }));
  const ubicar = () => {
    if (!navigator.geolocation) { toast('Este navegador no da la ubicación: escriba la latitud y la longitud.', 'warn'); return; }
    setUbicando(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { set({ latitud: p.coords.latitude.toFixed(6), longitud: p.coords.longitude.toFixed(6) }); setUbicando(false); toast(`Ubicación tomada (precisión de unos ${Math.round(p.coords.accuracy)} m). Revísela en el mapa.`); },
      () => { setUbicando(false); toast('No se pudo tomar la ubicación: dé permiso al navegador o escríbala.', 'warn'); },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  };
  const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
  const enlace = num(f.latitud) !== null && num(f.longitud) !== null ? mapa({ latitud: num(f.latitud), longitud: num(f.longitud) }) : null;
  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    const lat = num(f.latitud), lon = num(f.longitud);
    if ((lat === null) !== (lon === null) || (lat !== null && (Number.isNaN(lat) || Number.isNaN(lon!)))) { toast('Escriba la latitud y la longitud (o use su ubicación actual).', 'warn'); return; }
    if (f.municipioTexto.trim() && !f.municipioDane) { toast('Elija el municipio de la lista.', 'warn'); return; }
    const cuerpo = {
      nombre: f.nombre.trim(), codigo: f.codigo.trim(), clasificacion: f.clasificacion || null, ...(gestor ? { generadorNit: f.generadorNit.trim(), generadorNombre: f.generadorNombre.trim() } : {}),
      direccion: f.direccion.trim(), municipioDane: f.municipioDane, latitud: lat, longitud: lon, contacto: f.contacto.trim(), telefono: f.telefono.trim(), celular: f.celular.trim(), emails: f.emails.trim(),
      atencionLvDesde: f.atencionLvDesde, atencionLvHasta: f.atencionLvHasta, atencionFdDesde: f.atencionFdDesde, atencionFdHasta: f.atencionFdHasta,
      registroRespel: f.registroRespel.trim(), registroRcd: f.registroRcd.trim(), observaciones: f.observaciones.trim(),
    };
    setOcupado(true);
    try {
      if (sede) await api(`/portal/sedes/${sede.id}`, { metodo: 'PATCH', cuerpo });
      else await api('/portal/sedes', { cuerpo });
      toast(sede ? 'Sede actualizada.' : 'Sede creada. Terra Viva le asigna la ruta; ya puede incluirla en sus declaraciones.');
      listo();
    } catch (x) { toast(errorPortal(x, 'No se pudo guardar la sede.'), 'warn'); }
    setOcupado(false);
  };
  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
        <Field label="Nombre de la sede *" id="fs-n"><Input id="fs-n" required minLength={2} maxLength={150} value={f.nombre} onChange={(e) => set({ nombre: e.target.value })} placeholder="Ej.: Planta Girón" /></Field>
        <Field label="Código" id="fs-c" hint="Opcional"><Input id="fs-c" maxLength={20} value={f.codigo} onChange={(e) => set({ codigo: e.target.value })} placeholder="C004" /></Field>
      </div>
      {gestor && (
        <div className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-2">
          <p className="text-[12px] text-muted sm:col-span-2">Su empresa es gestora: cada sede representa a un generador.</p>
          <Field label="NIT del generador *" id="fs-gn"><Input id="fs-gn" inputMode="numeric" value={f.generadorNit} onChange={(e) => set({ generadorNit: e.target.value.replace(/\D/g, '') })} placeholder="Sin dígito de verificación" /></Field>
          <Field label="Nombre del generador" id="fs-gr"><Input id="fs-gr" maxLength={200} value={f.generadorNombre} onChange={(e) => set({ generadorNombre: e.target.value })} /></Field>
        </div>
      )}
      <Field label="Tipo de sede" id="fs-cl"><Select id="fs-cl" value={f.clasificacion} onChange={(e) => set({ clasificacion: e.target.value })}>
        <option value="">Sin indicar</option>{Object.entries(CLASIFICACION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </Select></Field>
      <Field label="Dirección" id="fs-d"><Input id="fs-d" maxLength={300} value={f.direccion} onChange={(e) => set({ direccion: e.target.value })} placeholder="Calle, número, barrio o kilómetro y vía" /></Field>
      <BuscarMunicipio texto={f.municipioTexto} onTexto={(t) => set({ municipioTexto: t, municipioDane: '' })} onElegir={(m) => set({ municipioTexto: `${m.nombre} (${m.departamento})`, municipioDane: m.codigoDane })} />
      <fieldset className="flex flex-col gap-2 rounded-xl border border-line p-3">
        <legend className="px-1 text-[12px] font-medium text-muted">Ubicación GPS (para que el conductor llegue)</legend>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Latitud" id="fs-la"><Input id="fs-la" inputMode="decimal" value={f.latitud} onChange={(e) => set({ latitud: e.target.value })} placeholder="7.119349" /></Field>
          <Field label="Longitud" id="fs-lo"><Input id="fs-lo" inputMode="decimal" value={f.longitud} onChange={(e) => set({ longitud: e.target.value })} placeholder="-73.122742" /></Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={ubicar} disabled={ubicando}>{ubicando ? <Loader2 size={14} className="animate-spin" /> : <LocateFixed size={14} />}Usar mi ubicación actual</Button>
          {enlace && <a href={enlace} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] text-brand hover:underline">Ver en el mapa <ExternalLink size={12} /></a>}
        </div>
        <p className="text-[12px] text-subtle">Si está en la sede, use su ubicación actual. Si no, búsquela en el mapa y copie las coordenadas.</p>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Persona de contacto" id="fs-pc"><Input id="fs-pc" maxLength={150} value={f.contacto} onChange={(e) => set({ contacto: e.target.value })} /></Field>
        <Field label="Celular" id="fs-ce"><Input id="fs-ce" inputMode="tel" maxLength={20} value={f.celular} onChange={(e) => set({ celular: e.target.value })} /></Field>
        <Field label="Teléfono fijo" id="fs-te"><Input id="fs-te" inputMode="tel" maxLength={20} value={f.telefono} onChange={(e) => set({ telefono: e.target.value })} /></Field>
        <Field label="Correos" id="fs-em" hint="Separados por coma"><Input id="fs-em" maxLength={200} value={f.emails} onChange={(e) => set({ emails: e.target.value })} /></Field>
      </div>
      <fieldset className="grid grid-cols-2 gap-3 rounded-xl border border-line p-3">
        <legend className="px-1 text-[12px] font-medium text-muted">Horario de recibo</legend>
        <Field label="Lunes a viernes, desde" id="fs-h1"><Input id="fs-h1" type="time" value={f.atencionLvDesde} onChange={(e) => set({ atencionLvDesde: e.target.value })} /></Field>
        <Field label="hasta" id="fs-h2"><Input id="fs-h2" type="time" value={f.atencionLvHasta} onChange={(e) => set({ atencionLvHasta: e.target.value })} /></Field>
        <Field label="Fines de semana, desde" id="fs-h3"><Input id="fs-h3" type="time" value={f.atencionFdDesde} onChange={(e) => set({ atencionFdDesde: e.target.value })} /></Field>
        <Field label="hasta" id="fs-h4"><Input id="fs-h4" type="time" value={f.atencionFdHasta} onChange={(e) => set({ atencionFdHasta: e.target.value })} /></Field>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Registro RESPEL (IDEAM)" id="fs-rr"><Input id="fs-rr" maxLength={50} value={f.registroRespel} onChange={(e) => set({ registroRespel: e.target.value })} /></Field>
        <Field label="Registro de generador RCD" id="fs-rc" hint="Solo obras con RCD"><Input id="fs-rc" maxLength={50} value={f.registroRcd} onChange={(e) => set({ registroRcd: e.target.value })} /></Field>
      </div>
      <Field label="Indicaciones para llegar o para el recibo" id="fs-ob"><textarea id="fs-ob" className="min-h-[72px] w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20" maxLength={1000} value={f.observaciones} onChange={(e) => set({ observaciones: e.target.value })} placeholder="Ej.: entrar por la portería 2; preguntar por el almacenista" /></Field>
      <div className="flex justify-end border-t border-line pt-3">
        <Button type="submit" variant="primary" disabled={ocupado || f.nombre.trim().length < 2}>{ocupado && <Loader2 size={16} className="animate-spin" />}{sede ? 'Guardar cambios' : 'Crear sede'}</Button>
      </div>
    </form>
  );
}

/** Municipio de la DIVIPOLA: se escribe y se elige de la lista (sin tildes ni mayúsculas). */
function BuscarMunicipio({ texto, onTexto, onElegir }: { texto: string; onTexto: (t: string) => void; onElegir: (m: Municipio) => void }) {
  const [opciones, setOpciones] = useState<Municipio[]>([]);
  const [abierto, setAbierto] = useState(false);
  const pedido = useRef(0);
  useEffect(() => {
    const q = texto.trim();
    if (q.length < 2 || /\(.+\)$/.test(q)) { setOpciones([]); return; }
    const n = ++pedido.current;
    const t = setTimeout(() => { api<Municipio[]>(`/portal/municipios?q=${encodeURIComponent(q)}`).then((r) => { if (n === pedido.current) setOpciones(r); }).catch(() => undefined); }, 250);
    return () => clearTimeout(t);
  }, [texto]);
  return (
    <div className="relative">
      <Field label="Municipio" id="fs-mu"><Input id="fs-mu" autoComplete="off" value={texto} onFocus={() => setAbierto(true)} onBlur={() => setTimeout(() => setAbierto(false), 150)}
        onChange={(e) => { onTexto(e.target.value); setAbierto(true); }} placeholder="Escriba y elija de la lista" /></Field>
      {abierto && opciones.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-xl">
          {opciones.map((m) => (
            <li key={m.codigoDane}><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onElegir(m); setAbierto(false); }}
              className="flex w-full justify-between gap-2 px-3 py-2 text-left text-[13px] hover:bg-surface-2"><span>{m.nombre}</span><span className="text-muted">{m.departamento}</span></button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

