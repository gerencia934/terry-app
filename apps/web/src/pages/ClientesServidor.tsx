// Clientes y sedes conectados al API (fase 1c). Nada se borra: un cliente o una sede se inactiva.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, Building2, Clock, FileText, Loader2, Mail, MapPin, Pencil, Phone, Plus, Star, Upload } from 'lucide-react';
import { dvNit } from '@terraviva/shared';
import { ResponsiveTable, FilterBar, type Column } from '../components/data';
import { Badge, Button, ColorBadge, DefList, Field, Input, PageHeader, Select, Sheet, useToast } from '../components/ui';
import { BuscarMunicipio, type MunicipioBuscado } from '../components/BuscarMunicipio';
import { api, ErrorApi, tienePermiso } from '../lib/api';
import { PieLista, horaColumna, useApi, usePaginado } from '../lib/servidor';
import { useRouter } from '../lib/router';
import { cx } from '../lib/format';
import { verDeclaracionesDe } from './DeclaracionesServidor';
import { FormUsuarioPortal, ListaUsuariosPortal, type UsuarioPortal } from './portal/UsuariosPortal';
import type { SedePortal } from './portal/PortalApp';

type Tipo = 'DIRECTO' | 'GESTOR';
interface Zona { id: string; nombre: string; color: string }
interface SedeResumen { id: string; nombre: string; codigo: string | null; esPrincipal: boolean; activa: boolean; zona: { nombre: string; color: string } | null; municipio: { nombre: string } | null }
interface ClienteFila {
  id: string; nit: string; dv: string | null; razonSocial: string; tipo: Tipo; sector: string | null; tipoNegociacion: string; formaPago: string;
  emailFacturacion: string | null; activo: boolean; asesor: { id: string; nombre: string } | null; sucursales: SedeResumen[]; _count: { declaraciones: number };
  representanteLegal: string | null;
}
interface Sede {
  id: string; nombre: string; codigo: string | null; esPrincipal: boolean; activa: boolean; clasificacion: string | null; generadorNit: string | null; generadorNombre: string | null;
  direccion: string | null; municipio: MunicipioBuscado | null; zonaId: string | null; zona: Zona | null;
  latitud: string | null; longitud: string | null; registroRespel: string | null; registroRcd: string | null; contacto: string | null; telefono: string | null; celular: string | null; emails: string | null;
  atencionLvDesde: string | null; atencionLvHasta: string | null; atencionFdDesde: string | null; atencionFdHasta: string | null; observaciones: string | null;
  _count: { declaraciones: number };
}
interface ClienteDetalle extends Omit<ClienteFila, 'sucursales' | '_count'> {
  sucursales: Sede[]; _count: { declaraciones: number; solicitudes: number; manifiestos: number }; declaracionesActivas: number;
}
type Panel = { vista: 'detalle'; id: string } | { vista: 'cliente'; id?: string } | { vista: 'sede'; clienteId: string; sedeId?: string }
  | { vista: 'portal'; clienteId: string; sedes: SedePortal[]; usuario?: UsuarioPortal; primero?: boolean };

const NEGOCIACION: Record<string, string> = { COBRO: 'Cobro', COMPRA: 'Compra', SIN_COSTO: 'Sin costo', CONTRATO: 'Por contrato' };
const PAGO: Record<string, string> = { CONTADO: 'Contado', CREDITO_30: 'Crédito 30 días', CREDITO_60: 'Crédito 60 días', CREDITO_90: 'Crédito 90 días' };
const CLASIFICACION: Record<string, string> = { RESIDENCIAL: 'Residencial', INDUSTRIAL: 'Industrial', INSTITUCIONAL: 'Institucional', COMERCIAL: 'Comercial' };
const CAMPOS: Record<string, string> = {
  nit: 'NIT', razonSocial: 'Razón social', emailFacturacion: 'Correo de facturación', sector: 'Sector', nombre: 'Nombre', codigo: 'Código', generadorNit: 'NIT del generador',
  municipioDane: 'Municipio', latitud: 'Latitud', longitud: 'Longitud', emails: 'Correos', telefono: 'Teléfono', celular: 'Celular',
  atencionLvDesde: 'Atención L-V desde', atencionLvHasta: 'Atención L-V hasta', atencionFdDesde: 'Fin de semana desde', atencionFdHasta: 'Fin de semana hasta',
};
/** Mensaje del API, con el detalle de cada campo inválido. */
function mensajeError(e: unknown, def: string) {
  if (!(e instanceof ErrorApi)) return def;
  const d = (e.datos as { detalles?: { campo: string; mensaje: string }[] } | undefined)?.detalles;
  return d?.length ? d.map((x) => `${CAMPOS[x.campo] ?? x.campo}: ${x.mensaje}`).join(' · ') : e.message;
}
const conDv = (c: { nit: string; dv: string | null }) => (c.dv ? `${c.nit}-${c.dv}` : c.nit);
const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const numero = (s: string) => { const t = s.trim().replace(',', '.'); return t === '' ? null : Number(t); };

export function ClientesServidor() {
  const { go } = useRouter();
  const puedeEditar = tienePermiso('clientes.editar');
  const vacio = { q: '', tipo: '', activo: 'true' };
  const [f, setF] = useState(vacio);
  const [texto, setTexto] = useState('');
  const qs = new URLSearchParams({ ...(f.q && { q: f.q }), ...(f.tipo && { tipo: f.tipo }), ...(f.activo && { activo: f.activo }) });
  const lista = usePaginado<ClienteFila>(`/clientes?${qs}`);
  const [panel, setPanel] = useState<Panel | null>(null);
  const cols: Column<ClienteFila>[] = [
    { key: 'nit', header: 'NIT', render: (c) => <span className="num whitespace-nowrap">{conDv(c)}</span>, priority: 2 },
    { key: 'rs', header: 'Razón social', render: (c) => <span className="block max-w-[260px] truncate font-medium">{c.razonSocial}</span>, priority: 3 },
    { key: 'tipo', header: 'Tipo', render: (c) => <Badge tone={c.tipo === 'GESTOR' ? 'info' : 'neutral'}>{c.tipo === 'GESTOR' ? 'Gestor' : 'Directo'}</Badge>, priority: 2 },
    { key: 'sec', header: 'Sector', render: (c) => c.sector ?? '—', priority: 1 },
    { key: 'neg', header: 'Negociación', render: (c) => `${NEGOCIACION[c.tipoNegociacion] ?? c.tipoNegociacion} · ${PAGO[c.formaPago] ?? c.formaPago}`, priority: 2 },
    { key: 'sed', header: 'Sedes', render: (c) => (
      <span className="flex flex-wrap items-center gap-1">
        <span className="num mr-1">{c.sucursales.filter((s) => s.activa).length}</span>
        {[...new Map(c.sucursales.filter((s) => s.zona).map((s) => [s.zona!.nombre, s.zona!])).values()].slice(0, 3).map((z) => <ColorBadge key={z.nombre} color={z.color}>{z.nombre}</ColorBadge>)}
      </span>), priority: 2 },
    { key: 'dec', header: 'Declaraciones activas', align: 'right', render: (c) => <span className="num">{c._count.declaraciones}</span>, priority: 2 },
    { key: 'est', header: 'Estado', render: (c) => <Badge tone={c.activo ? 'ok' : 'neutral'}>{c.activo ? 'Activo' : 'Inactivo'}</Badge>, priority: 3 },
  ];
  const cerrar = () => setPanel(null);
  const titulo = !panel ? '' : panel.vista === 'detalle' ? 'Cliente' : panel.vista === 'cliente' ? (panel.id ? 'Editar cliente' : 'Nuevo cliente')
    : panel.vista === 'portal' ? (panel.usuario ? 'Usuario del portal' : 'Dar acceso al portal') : panel.sedeId ? 'Editar sede' : 'Nueva sede';

  return (
    <>
      <PageHeader eyebrow="Comercial" title="Clientes y sedes" subtitle="Generadores atendidos, sus sedes y las condiciones comerciales. Nada se borra: un cliente o una sede se inactiva."
        actions={<><Button onClick={() => go('importar')}><Upload size={16} /> Importar</Button>{puedeEditar && <Button variant="primary" onClick={() => setPanel({ vista: 'cliente' })}><Plus size={16} /> Nuevo cliente</Button>}</>} />
      <FilterBar active={Number(!!f.q) + Number(!!f.tipo) + Number(f.activo !== 'true')} onClear={() => { setF(vacio); setTexto(''); }}>
        <Field label="Buscar" id="cl-q"><Input id="cl-q" value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setF((s) => ({ ...s, q: texto.trim() }))}
          onBlur={() => setF((s) => ({ ...s, q: texto.trim() }))} placeholder="NIT o razón social · Enter" /></Field>
        <Field label="Tipo" id="cl-t"><Select id="cl-t" value={f.tipo} onChange={(e) => setF((s) => ({ ...s, tipo: e.target.value }))}><option value="">Todos</option><option value="DIRECTO">Directo</option><option value="GESTOR">Gestor</option></Select></Field>
        <Field label="Estado" id="cl-a"><Select id="cl-a" value={f.activo} onChange={(e) => setF((s) => ({ ...s, activo: e.target.value }))}><option value="true">Activos</option><option value="false">Inactivos</option><option value="">Todos</option></Select></Field>
      </FilterBar>
      {lista.error ? <p className="rounded-xl bg-bad/10 p-4 text-bad">{lista.error}</p>
        : !lista.filas ? <p className="p-6 text-center text-muted">Cargando…</p>
        : <ResponsiveTable rows={lista.filas} columns={cols} rowKey={(c) => c.id} onRowClick={(c) => setPanel({ vista: 'detalle', id: c.id })}
            cardTitle={(c) => c.razonSocial} cardBadge={(c) => <Badge tone={c.activo ? 'ok' : 'neutral'}>{c.activo ? `${c.sucursales.filter((s) => s.activa).length} sedes` : 'Inactivo'}</Badge>}
            cardMeta={(c) => `NIT ${conDv(c)} · ${c.tipo === 'GESTOR' ? 'Gestor' : 'Directo'} · ${c._count.declaraciones} declaraciones activas`}
            footer={<PieLista mostradas={lista.filas.length} total={lista.total} hayMas={lista.hayMas} cargando={lista.cargando} cargarMas={lista.cargarMas} />}
            empty="No hay clientes con estos filtros. Créelos aquí o impórtelos desde Excel en Ajustes › Importar datos." />}

      <Sheet open={!!panel} onClose={cerrar} title={titulo}>
        {panel?.vista === 'detalle' && <DetalleCliente id={panel.id} puedeEditar={puedeEditar} abrir={setPanel} />}
        {panel?.vista === 'cliente' && <FormularioCliente id={panel.id} volver={() => (panel.id ? setPanel({ vista: 'detalle', id: panel.id }) : cerrar())}
          alGuardar={(id) => { lista.recargar(); setPanel({ vista: 'detalle', id }); }} />}
        {panel?.vista === 'sede' && <FormularioSede clienteId={panel.clienteId} sedeId={panel.sedeId} volver={() => setPanel({ vista: 'detalle', id: panel.clienteId })}
          alGuardar={() => { lista.recargar(); setPanel({ vista: 'detalle', id: panel.clienteId }); }} />}
        {panel?.vista === 'portal' && (
          <div className="flex flex-col gap-4">
            <button onClick={() => setPanel({ vista: 'detalle', id: panel.clienteId })} className="inline-flex items-center gap-1.5 self-start text-[13px] font-medium text-muted hover:text-fg"><ArrowLeft size={15} /> Volver al cliente</button>
            {!panel.usuario && <p className="rounded-lg bg-surface-2 p-3 text-[13px] text-muted">El usuario recibe un correo para crear su contraseña y entra al portal a consultar y descargar solo lo de este cliente. Si es administrador, él mismo invita después a las demás personas de su empresa.</p>}
            <FormUsuarioPortal base={`/clientes/${panel.clienteId}/usuarios-portal`} sedes={panel.sedes} u={panel.usuario} perfilInicial={panel.primero ? 'ADMIN' : 'CONSULTA'} listo={() => setPanel({ vista: 'detalle', id: panel.clienteId })} />
          </div>
        )}
      </Sheet>
    </>
  );
}

// ---------------- Detalle ----------------
function DetalleCliente({ id, puedeEditar, abrir }: { id: string; puedeEditar: boolean; abrir: (p: Panel) => void }) {
  const { go } = useRouter();
  const { datos: c, error } = useApi<ClienteDetalle>(`/clientes/${id}`);
  if (error) return <p className="text-bad">{error}</p>;
  if (!c) return <p className="flex items-center gap-2 text-muted"><Loader2 size={16} className="animate-spin" />Cargando…</p>;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="font-display text-[18px] font-semibold leading-tight">{c.razonSocial}</p>
        <p className="mt-1 flex flex-wrap gap-1.5"><Badge tone={c.activo ? 'ok' : 'neutral'}>{c.activo ? 'Activo' : 'Inactivo'}</Badge><Badge tone={c.tipo === 'GESTOR' ? 'info' : 'neutral'}>{c.tipo === 'GESTOR' ? 'Gestor' : 'Cliente directo'}</Badge></p>
      </div>
      <DefList items={[
        ['NIT', <span className="num">{conDv(c)}</span>], ['Sector', c.sector ?? '—'],
        ['Negociación', NEGOCIACION[c.tipoNegociacion] ?? c.tipoNegociacion], ['Forma de pago', PAGO[c.formaPago] ?? c.formaPago],
        ['Correo de facturación', c.emailFacturacion ?? '—'], ['Asesor comercial', c.asesor?.nombre ?? '—'], ['Representante legal', c.representanteLegal ?? '—'],
        ['Declaraciones', `${c.declaracionesActivas} activas de ${c._count.declaraciones}`], ['Solicitudes · manifiestos', `${c._count.solicitudes} · ${c._count.manifiestos}`],
      ]} />
      <div className="flex flex-wrap gap-2">
        {puedeEditar && <Button size="sm" onClick={() => abrir({ vista: 'cliente', id: c.id })}><Pencil size={14} /> Editar cliente</Button>}
        <Button size="sm" variant="ghost" onClick={() => { verDeclaracionesDe({ id: c.id, razonSocial: c.razonSocial, nit: c.nit, tipo: c.tipo }); go('declaraciones'); }}><FileText size={14} /> Ver sus declaraciones</Button>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-[15px] font-semibold">Sedes ({c.sucursales.filter((s) => s.activa).length} activas)</h3>
          {puedeEditar && c.activo && <Button size="sm" onClick={() => abrir({ vista: 'sede', clienteId: c.id })}><Plus size={14} /> Nueva sede</Button>}
        </div>
        {!c.sucursales.length && <p className="text-[13px] text-muted">Sin sedes. Agregue al menos una: las declaraciones y los servicios se programan por sede.</p>}
        <ul className="flex flex-col gap-2">{c.sucursales.map((s) => <TarjetaSede key={s.id} s={s} gestor={c.tipo === 'GESTOR'} editar={puedeEditar ? () => abrir({ vista: 'sede', clienteId: c.id, sedeId: s.id }) : undefined} />)}</ul>
      </div>
      {puedeEditar && <SeccionPortal c={c} abrir={abrir} />}
    </div>
  );
}

/**
 * Quién del cliente entra al portal (solo para quien administra clientes: son datos personales). La oficina da el primer
 * acceso; después el administrador del cliente invita a los demás.
 */
function SeccionPortal({ c, abrir }: { c: ClienteDetalle; abrir: (p: Panel) => void }) {
  const lista = useApi<UsuarioPortal[]>(`/clientes/${c.id}/usuarios-portal`);
  const sedes: SedePortal[] = c.sucursales.filter((s) => s.activa).map((s) => ({ id: s.id, codigo: s.codigo, nombre: s.nombre, municipio: s.municipio ? { nombre: s.municipio.nombre } : null }));
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold">Portal de clientes</h3>
        {c.activo && <Button size="sm" onClick={() => abrir({ vista: 'portal', clienteId: c.id, sedes, primero: !lista.datos?.some((u) => u.activo && u.perfilPortal === 'ADMIN') })}><Plus size={14} /> Dar acceso</Button>}
      </div>
      <ListaUsuariosPortal lista={lista} abrir={(u) => abrir({ vista: 'portal', clienteId: c.id, sedes, usuario: u })}
        vacio="Este cliente aún no entra al portal. Dé acceso a su primer administrador: él invita después a las demás personas de su empresa." />
    </div>
  );
}

function TarjetaSede({ s, gestor, editar }: { s: Sede; gestor: boolean; editar?: () => void }) {
  const horario = (d: string | null, h: string | null) => (d && h ? `${horaColumna(d)} a ${horaColumna(h)}` : '');
  const lv = horario(s.atencionLvDesde, s.atencionLvHasta), fd = horario(s.atencionFdDesde, s.atencionFdHasta);
  const fila = (icono: ReactNode, t: ReactNode) => <p className="flex items-start gap-1.5 text-muted"><span className="mt-0.5 shrink-0">{icono}</span><span className="min-w-0">{t}</span></p>;
  return (
    <li className={cx('rounded-xl border p-3 text-[13px]', s.activa ? 'border-line' : 'border-dashed border-line opacity-70')}>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 font-medium">{s.codigo && <span className="num mr-1.5 text-muted">{s.codigo}</span>}{s.nombre}</p>
        <span className="flex shrink-0 items-center gap-1">
          {s.esPrincipal && <Badge tone="brand"><Star size={11} /> Principal</Badge>}
          {!s.activa && <Badge>Inactiva</Badge>}
          {editar && <button onClick={editar} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label={`Editar la sede ${s.nombre}`}><Pencil size={14} /></button>}
        </span>
      </div>
      <div className="mt-1.5 flex flex-col gap-1">
        {gestor && s.generadorNit && fila(<Building2 size={13} />, <>Generador: {s.generadorNombre ?? '—'} · NIT <span className="num">{s.generadorNit}</span></>)}
        {(s.direccion || s.municipio) && fila(<MapPin size={13} />, <>
          {/* La dirección de una sede importada ya trae el municipio: no se repite */}
          {[s.direccion, s.municipio && !sinTildes(s.direccion ?? '').includes(sinTildes(s.municipio.nombre)) && `${s.municipio.nombre} (${s.municipio.departamento})`].filter(Boolean).join(' · ')}
          {s.latitud && s.longitud && <> · <a className="text-brand underline" href={`https://www.google.com/maps?q=${s.latitud},${s.longitud}`} target="_blank" rel="noreferrer">ver en el mapa</a></>}
        </>)}
        {s.zona && <p><ColorBadge color={s.zona.color}>{s.zona.nombre}</ColorBadge></p>}
        {(s.contacto || s.telefono || s.celular) && fila(<Phone size={13} />, [s.contacto, s.telefono, s.celular].filter(Boolean).join(' · '))}
        {s.emails && fila(<Mail size={13} />, s.emails)}
        {(lv || fd) && fila(<Clock size={13} />, [lv && `L-V ${lv}`, fd && `fin de semana ${fd}`].filter(Boolean).join(' · '))}
        <p className="text-subtle">{s._count.declaraciones} declaraciones activas{s.registroRespel ? ` · Registro RESPEL ${s.registroRespel}` : ''}{s.clasificacion ? ` · ${CLASIFICACION[s.clasificacion]}` : ''}</p>
      </div>
    </li>
  );
}

// ---------------- Formulario del cliente ----------------
function FormularioCliente({ id, volver, alGuardar }: { id?: string; volver: () => void; alGuardar: (id: string) => void }) {
  const toast = useToast();
  const actual = useApi<ClienteDetalle>(id ? `/clientes/${id}` : null);
  const asesores = useApi<{ id: string; nombre: string; rol: { nombre: string } }[]>('/clientes/asesores');
  const sectores = useApi<string[]>('/clientes/sectores');
  const [v, setV] = useState({ nit: '', razonSocial: '', tipo: 'DIRECTO' as Tipo, sector: '', tipoNegociacion: 'COBRO', formaPago: 'CONTADO', emailFacturacion: '', asesorId: '', representanteLegal: '', activo: true, causalId: '' });
  const [enviando, setEnviando] = useState(false);
  const c = actual.datos;
  useEffect(() => {
    if (c) setV({ nit: c.nit, razonSocial: c.razonSocial, tipo: c.tipo, sector: c.sector ?? '', tipoNegociacion: c.tipoNegociacion, formaPago: c.formaPago,
      emailFacturacion: c.emailFacturacion ?? '', asesorId: c.asesor?.id ?? '', representanteLegal: c.representanteLegal ?? '', activo: c.activo, causalId: '' });
  }, [c]);
  const inactivando = !!c && c.activo && !v.activo;
  const causales = useApi<{ id: string; nombre: string }[]>(inactivando && c.declaracionesActivas ? '/catalogos?tipo=CAUSAL' : null);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const nitValido = /^\d{6,10}$/.test(v.nit);
  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    const datos = { razonSocial: v.razonSocial, tipo: v.tipo, sector: v.sector, tipoNegociacion: v.tipoNegociacion, formaPago: v.formaPago, emailFacturacion: v.emailFacturacion, asesorId: v.asesorId || null, representanteLegal: v.representanteLegal };
    try {
      if (id) {
        const r = await api<{ id: string; inactivadas: number }>(`/clientes/${id}`, { metodo: 'PATCH', cuerpo: { ...datos, activo: v.activo, ...(v.causalId && { causalId: v.causalId }) } });
        toast(r.inactivadas ? `Cliente inactivo: ${r.inactivadas} declaraciones quedaron inactivas.` : 'Cliente actualizado.');
        alGuardar(id);
      } else {
        const r = await api<{ id: string }>('/clientes', { metodo: 'POST', cuerpo: { ...datos, nit: v.nit } });
        toast('Cliente creado. Agréguele sus sedes.');
        alGuardar(r.id);
      }
    } catch (err) { toast(mensajeError(err, 'No se pudo guardar el cliente.'), 'warn'); }
    setEnviando(false);
  };
  if (id && !c) return <p className="flex items-center gap-2 text-muted"><Loader2 size={16} className="animate-spin" />Cargando…</p>;
  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      <Button type="button" variant="ghost" size="sm" className="self-start" onClick={volver}><ArrowLeft size={14} /> Volver</Button>
      {id ? <p className="text-[13px] text-muted">NIT <span className="num font-medium text-fg">{conDv(c!)}</span>: el NIT no cambia; para otro NIT se crea otro cliente.</p>
        : <Field label="NIT (sin puntos ni dígito de verificación)" id="fc-nit" hint={nitValido ? `Dígito de verificación: ${dvNit(v.nit)}` : '6 a 10 dígitos'}>
            <Input id="fc-nit" inputMode="numeric" value={v.nit} onChange={(e) => setV((s) => ({ ...s, nit: e.target.value.replace(/\D/g, '').slice(0, 10) }))} required />
          </Field>}
      <Field label="Razón social" id="fc-rs"><Input id="fc-rs" value={v.razonSocial} onChange={set('razonSocial')} maxLength={200} required /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tipo" id="fc-tipo" hint={v.tipo === 'GESTOR' ? 'Cada sede representa a un generador tercero (con su NIT).' : undefined}>
          <Select id="fc-tipo" value={v.tipo} onChange={set('tipo')}><option value="DIRECTO">Cliente directo (generador)</option><option value="GESTOR">Gestor</option></Select>
        </Field>
        <Field label="Sector" id="fc-sec"><Input id="fc-sec" list="fc-sectores" value={v.sector} onChange={set('sector')} maxLength={60} placeholder="Hidrocarburos, palma, salud…" /></Field>
        <datalist id="fc-sectores">{(sectores.datos ?? []).map((s) => <option key={s} value={s} />)}</datalist>
        <Field label="Negociación" id="fc-neg"><Select id="fc-neg" value={v.tipoNegociacion} onChange={set('tipoNegociacion')}>{Object.entries(NEGOCIACION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="Forma de pago" id="fc-pago"><Select id="fc-pago" value={v.formaPago} onChange={set('formaPago')}>{Object.entries(PAGO).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
      </div>
      <Field label="Correo de facturación" id="fc-mail"><Input id="fc-mail" type="email" value={v.emailFacturacion} onChange={set('emailFacturacion')} maxLength={150} /></Field>
      <Field label="Representante legal" id="fc-rep" hint="Lo pide la constancia de RCD del certificado (Anexo II de la Res. 1257 de 2021)."><Input id="fc-rep" value={v.representanteLegal} onChange={set('representanteLegal')} maxLength={150} /></Field>
      <Field label="Asesor comercial" id="fc-ase" hint="Aparece en las conciliaciones e informes por comercial.">
        <Select id="fc-ase" value={v.asesorId} onChange={set('asesorId')}><option value="">Sin asesor</option>{(asesores.datos ?? []).map((u) => <option key={u.id} value={u.id}>{u.nombre} · {u.rol.nombre}</option>)}</Select>
      </Field>
      {id && (
        <label className="flex items-start gap-2 rounded-lg border border-line p-3 text-[13px]">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--brand))]" checked={v.activo} onChange={(e) => setV((s) => ({ ...s, activo: e.target.checked, causalId: '' }))} />
          <span><span className="font-medium">Cliente activo</span><br /><span className="text-muted">Inactivo no se borra: sus declaraciones activas quedan inactivas y ya no se le programan servicios.</span></span>
        </label>
      )}
      {inactivando && c!.declaracionesActivas > 0 && (
        <Field label={`Motivo para inactivar sus ${c!.declaracionesActivas} declaraciones activas`} id="fc-causal">
          <Select id="fc-causal" value={v.causalId} onChange={set('causalId')} required><option value="">Elija el motivo</option>{(causales.datos ?? []).map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</Select>
        </Field>
      )}
      <div className="flex justify-end gap-2 border-t border-line pt-3">
        <Button type="button" onClick={volver}>Cancelar</Button>
        <Button type="submit" variant={inactivando ? 'danger' : 'primary'} disabled={enviando || (!id && !nitValido) || (inactivando && c!.declaracionesActivas > 0 && !v.causalId)}>
          {enviando && <Loader2 size={16} className="animate-spin" />}{inactivando ? 'Inactivar cliente' : id ? 'Guardar cambios' : 'Crear cliente'}
        </Button>
      </div>
    </form>
  );
}

// ---------------- Formulario de la sede ----------------
function FormularioSede({ clienteId, sedeId, volver, alGuardar }: { clienteId: string; sedeId?: string; volver: () => void; alGuardar: () => void }) {
  const toast = useToast();
  const cliente = useApi<ClienteDetalle>(`/clientes/${clienteId}`);
  const zonas = useApi<Zona[]>('/zonas');
  const vacia = { nombre: '', codigo: '', esPrincipal: false, clasificacion: '', generadorNit: '', generadorNombre: '', direccion: '', zonaId: '', latitud: '', longitud: '',
    registroRespel: '', registroRcd: '', contacto: '', telefono: '', celular: '', emails: '', atencionLvDesde: '', atencionLvHasta: '', atencionFdDesde: '', atencionFdHasta: '', observaciones: '', activa: true };
  const [v, setV] = useState(vacia);
  const [municipio, setMunicipio] = useState<MunicipioBuscado | null>(null);
  const [enviando, setEnviando] = useState(false);
  const c = cliente.datos;
  const s = sedeId ? c?.sucursales.find((x) => x.id === sedeId) : undefined;
  useEffect(() => {
    if (!s) return;
    setV({ nombre: s.nombre, codigo: s.codigo ?? '', esPrincipal: s.esPrincipal, clasificacion: s.clasificacion ?? '', generadorNit: s.generadorNit ?? '', generadorNombre: s.generadorNombre ?? '',
      direccion: s.direccion ?? '', zonaId: s.zonaId ?? '', latitud: s.latitud ?? '', longitud: s.longitud ?? '', registroRespel: s.registroRespel ?? '', registroRcd: s.registroRcd ?? '', contacto: s.contacto ?? '',
      telefono: s.telefono ?? '', celular: s.celular ?? '', emails: s.emails ?? '', atencionLvDesde: horaColumna(s.atencionLvDesde), atencionLvHasta: horaColumna(s.atencionLvHasta),
      atencionFdDesde: horaColumna(s.atencionFdDesde), atencionFdHasta: horaColumna(s.atencionFdHasta), observaciones: s.observaciones ?? '', activa: s.activa });
    setMunicipio(s.municipio ? { codigoDane: s.municipio.codigoDane, nombre: s.municipio.nombre, departamento: s.municipio.departamento } : null);
  }, [s?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const gestor = c?.tipo === 'GESTOR';
  const primera = !!c && !c.sucursales.length;
  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    const lat = numero(v.latitud), lng = numero(v.longitud);
    if ((lat === null) !== (lng === null) || (lat !== null && (Number.isNaN(lat) || Number.isNaN(lng)))) { toast('Escriba la latitud y la longitud juntas, en grados decimales (7,1234 y -73,5678).', 'warn'); return; }
    setEnviando(true);
    const { activa, ...resto } = v;
    const cuerpo = { ...resto, clasificacion: v.clasificacion || null, zonaId: v.zonaId || null, municipioDane: municipio?.codigoDane ?? null, latitud: lat, longitud: lng,
      esPrincipal: v.esPrincipal || primera, ...(sedeId && { activa }), ...(!gestor && { generadorNit: '', generadorNombre: '' }) };
    try {
      if (sedeId) await api(`/clientes/${clienteId}/sucursales/${sedeId}`, { metodo: 'PATCH', cuerpo });
      else await api(`/clientes/${clienteId}/sucursales`, { metodo: 'POST', cuerpo });
      toast(sedeId ? (s?.activa && !activa ? 'Sede inactiva: ya no recibe servicios.' : 'Sede actualizada.') : 'Sede creada.');
      alGuardar();
    } catch (err) { toast(mensajeError(err, 'No se pudo guardar la sede.'), 'warn'); }
    setEnviando(false);
  };
  if (!c || (sedeId && !s)) return cliente.error ? <p className="text-bad">{cliente.error}</p> : <p className="flex items-center gap-2 text-muted"><Loader2 size={16} className="animate-spin" />Cargando…</p>;
  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      <Button type="button" variant="ghost" size="sm" className="self-start" onClick={volver}><ArrowLeft size={14} /> Volver a {c.razonSocial}</Button>
      <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
        <Field label="Nombre de la sede" id="fs-nom"><Input id="fs-nom" value={v.nombre} onChange={set('nombre')} maxLength={150} required placeholder="Planta extractora" /></Field>
        <Field label="Código" id="fs-cod" hint="C001: se usa en las plantillas"><Input id="fs-cod" value={v.codigo} onChange={(e) => setV((x) => ({ ...x, codigo: e.target.value.toUpperCase() }))} maxLength={20} /></Field>
      </div>
      {gestor && (
        <div className="grid gap-4 rounded-lg bg-info/5 p-3 sm:grid-cols-2">
          <Field label="NIT del generador" id="fs-gnit" hint="Cliente gestor: la sede representa a un generador tercero."><Input id="fs-gnit" inputMode="numeric" value={v.generadorNit} onChange={(e) => setV((x) => ({ ...x, generadorNit: e.target.value.replace(/\D/g, '').slice(0, 10) }))} required /></Field>
          <Field label="Nombre del generador" id="fs-gnom"><Input id="fs-gnom" value={v.generadorNombre} onChange={set('generadorNombre')} maxLength={200} /></Field>
        </div>
      )}
      <Field label="Dirección" id="fs-dir"><Input id="fs-dir" value={v.direccion} onChange={set('direccion')} maxLength={300} placeholder="Km 4 vía Puerto Wilches" /></Field>
      <Field label="Municipio" id="fs-mun" hint="DIVIPOLA del DANE"><BuscarMunicipio id="fs-mun" valor={municipio} onChange={setMunicipio} /></Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Zona" id="fs-zona"><Select id="fs-zona" value={v.zonaId} onChange={set('zonaId')}><option value="">Sin zona</option>{(zonas.datos ?? []).map((z) => <option key={z.id} value={z.id}>{z.nombre}</option>)}</Select></Field>
        <Field label="Latitud" id="fs-lat"><Input id="fs-lat" inputMode="decimal" value={v.latitud} onChange={set('latitud')} placeholder="7,3912" /></Field>
        <Field label="Longitud" id="fs-lng"><Input id="fs-lng" inputMode="decimal" value={v.longitud} onChange={set('longitud')} placeholder="-73,4987" /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Contacto" id="fs-con"><Input id="fs-con" value={v.contacto} onChange={set('contacto')} maxLength={150} /></Field>
        <Field label="Correos (separados por coma)" id="fs-mails"><Input id="fs-mails" value={v.emails} onChange={set('emails')} maxLength={200} /></Field>
        <Field label="Teléfono" id="fs-tel"><Input id="fs-tel" inputMode="tel" value={v.telefono} onChange={set('telefono')} maxLength={20} /></Field>
        <Field label="Celular" id="fs-cel"><Input id="fs-cel" inputMode="tel" value={v.celular} onChange={set('celular')} maxLength={20} /></Field>
      </div>
      <fieldset className="grid gap-4 sm:grid-cols-4">
        <legend className="mb-1 text-[13px] font-medium">Horario de atención</legend>
        <Field label="L-V desde" id="fs-lvd"><Input id="fs-lvd" type="time" value={v.atencionLvDesde} onChange={set('atencionLvDesde')} /></Field>
        <Field label="L-V hasta" id="fs-lvh"><Input id="fs-lvh" type="time" value={v.atencionLvHasta} onChange={set('atencionLvHasta')} /></Field>
        <Field label="Fin de semana desde" id="fs-fdd"><Input id="fs-fdd" type="time" value={v.atencionFdDesde} onChange={set('atencionFdDesde')} /></Field>
        <Field label="Fin de semana hasta" id="fs-fdh"><Input id="fs-fdh" type="time" value={v.atencionFdHasta} onChange={set('atencionFdHasta')} /></Field>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Clasificación" id="fs-clas"><Select id="fs-clas" value={v.clasificacion} onChange={set('clasificacion')}><option value="">Sin clasificar</option>{Object.entries(CLASIFICACION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="Registro de generador RESPEL (IDEAM)" id="fs-respel"><Input id="fs-respel" value={v.registroRespel} onChange={set('registroRespel')} maxLength={50} /></Field>
        <Field label="N.º único de generador de RCD" id="fs-rcd" hint="El que asignó la autoridad ambiental al proyecto, si lo tiene. Va en la constancia de RCD."><Input id="fs-rcd" value={v.registroRcd} onChange={set('registroRcd')} maxLength={50} /></Field>
      </div>
      <Field label="Observaciones" id="fs-obs"><Input id="fs-obs" value={v.observaciones} onChange={set('observaciones')} maxLength={1000} placeholder="Pasar primero por portería" /></Field>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--brand))]" checked={v.esPrincipal || primera} disabled={primera || (!!s?.esPrincipal)} onChange={(e) => setV((x) => ({ ...x, esPrincipal: e.target.checked }))} />
        Sede principal{primera ? ' (es la primera del cliente)' : s?.esPrincipal ? ' (para cambiarla, marque otra sede como principal)' : ''}
      </label>
      {sedeId && (
        <label className="flex items-start gap-2 rounded-lg border border-line p-3 text-[13px]">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--brand))]" checked={v.activa} disabled={!!s?.esPrincipal && v.activa} onChange={(e) => setV((x) => ({ ...x, activa: e.target.checked }))} />
          <span><span className="font-medium">Sede activa</span><br /><span className="text-muted">{s?.esPrincipal ? 'La sede principal no se inactiva.' : 'Inactiva no se borra: deja de recibir servicios y sus declaraciones ya no se programan en ella.'}</span></span>
        </label>
      )}
      <div className="flex justify-end gap-2 border-t border-line pt-3">
        <Button type="button" onClick={volver}>Cancelar</Button>
        <Button type="submit" variant={sedeId && s?.activa && !v.activa ? 'danger' : 'primary'} disabled={enviando}>{enviando && <Loader2 size={16} className="animate-spin" />}{sedeId ? (s?.activa && !v.activa ? 'Inactivar sede' : 'Guardar cambios') : 'Crear sede'}</Button>
      </div>
    </form>
  );
}
