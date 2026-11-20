// Comercial (reemplaza a Bigin): embudo de oportunidades por etapas, prospectos con sus contactos, tareas, cotizaciones en
// PDF y «ganar»: crea el cliente con su sede y sus declaraciones con tarifa, sin volver a digitar. También importa Bigin.
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Building2, CalendarClock, CheckCircle2, Eye, FileDown, Loader2, Plus, Save, Send, Trash2, Trophy, Upload, UserPlus, X, XCircle } from 'lucide-react';
import { SECTORES } from '@terraviva/shared';
import { Badge, Button, Card, DefList, Empty, Field, Input, Kpi, PageHeader, Select, Sheet, Tabs, useToast, type Tone } from '../components/ui';
import { BuscarMunicipio, type MunicipioBuscado } from '../components/BuscarMunicipio';
import { api } from '../lib/api';
import { cx, fmtCOP, fmtFecha } from '../lib/format';
import { fechaHoraCo, msg, useApi, usePaginado, PieLista } from '../lib/servidor';
import { abrirPdfGuardado } from '../lib/trabajos';
import { useRouter } from '../lib/router';

// ---------- Tipos del API ----------
type Etapa = 'NUEVA' | 'CONTACTADA' | 'COTIZADA' | 'NEGOCIACION' | 'GANADA' | 'PERDIDA';
type TipoActividad = 'LLAMADA' | 'VISITA' | 'CORREO' | 'REUNION' | 'WHATSAPP' | 'TAREA' | 'NOTA';
interface Ref { id: string; nombre: string }
interface OpFila {
  id: string; titulo: string; etapa: Etapa; valorMensual: string | null; cierreEstimado: string | null; cerradaEn: string | null; motivoPerdida: string | null;
  prospecto: { id: string; razonSocial: string; clienteId: string | null }; asesor: Ref | null;
  actividades: { asunto: string; venceEn: string | null }[]; cotizaciones: { numero: string | null; estado: string }[];
}
interface Embudo { oportunidades: OpFila[]; kpis: { abiertas: number; valorAbierto: number; ganadasMes: number; valorGanadoMes: number; tasaCierre: number | null } }
interface Contacto { id: string; nombre: string; cargo: string | null; telefono: string | null; correo: string | null; principal: boolean; activo: boolean }
interface Actividad {
  id: string; tipo: TipoActividad; asunto: string; detalle: string | null; venceEn: string | null; hechaEn: string | null; creadoEn: string;
  responsable: { nombre: string } | null; creadoPor?: { nombre: string } | null; oportunidad?: { titulo: string } | null;
}
interface ProspectoFila {
  id: string; razonSocial: string; nit: string | null; sector: string | null; origen: string; telefono: string | null; correo: string | null; activo: boolean; creadoEn: string;
  cliente: { id: string; razonSocial: string } | null; asesor: Ref | null; contactos: Omit<Contacto, 'id' | 'principal' | 'activo'>[]; _count: { oportunidades: number };
}
interface Prospecto {
  id: string; razonSocial: string; nit: string | null; sector: string | null; origen: string; telefono: string | null; correo: string | null; sitioWeb: string | null; direccion: string | null;
  representanteLegal: string | null; notas: string | null; activo: boolean; municipioDane: string | null; municipio: { nombre: string; departamento: string } | null;
  asesor: Ref | null; cliente: { id: string; razonSocial: string; activo: boolean } | null; contactos: Contacto[];
  oportunidades: { id: string; titulo: string; etapa: Etapa; valorMensual: string | null; cerradaEn: string | null; motivoPerdida: string | null; creadoEn: string }[];
  actividades: Actividad[];
}
interface ItemCot {
  tipo: 'RESIDUO' | 'SERVICIO'; catalogoId: string | null; descripcion: string; categoriaId: string | null; lineaServicioId: string | null; disposicionId: string | null;
  esPeligroso: boolean; metricaId: string | null; cantidadEstimada: string | null; frecuencia: string | null; precioUnitario: string;
  catalogo?: { nombre: string } | null; disposicion?: { nombre: string } | null; metrica?: { abreviacion: string } | null;
}
interface Cotizacion {
  id: string; numero: string | null; estado: 'BORRADOR' | 'ENVIADA' | 'ACEPTADA' | 'RECHAZADA'; validezDias: number; tipoNegociacion: string; formaPago: string;
  condiciones: string | null; totalEstimado: string; enviadaEn: string | null; respondidaEn: string | null; motivoRechazo: string | null; creadoEn: string; items: ItemCot[];
}
interface Oportunidad {
  id: string; titulo: string; etapa: Etapa; valorMensual: string | null; cierreEstimado: string | null; motivoPerdida: string | null; cerradaEn: string | null; notas: string | null;
  contactoId: string | null; asesor: Ref | null; cliente: { id: string; razonSocial: string } | null; cerradaPor: { nombre: string } | null;
  prospecto: Prospecto & { contactos: Contacto[] }; contacto: Contacto | null; cotizaciones: Cotizacion[]; actividades: Actividad[];
}
interface Catalogos {
  categorias: { id: string; codigo: string; nombre: string }[]; lineas: { id: string; codigo: string; nombre: string }[];
  disposiciones: { id: string; codigo: string; nombre: string }[]; metricasPrecio: { id: string; abreviacion: string; nombre: string }[];
}
interface Servicio { id: string; codigo: string; nombre: string; lineaServicioId: string | null }

// ---------- Textos ----------
const ETAPAS: { id: Etapa; nombre: string; tono: Tone }[] = [
  { id: 'NUEVA', nombre: 'Nueva', tono: 'neutral' }, { id: 'CONTACTADA', nombre: 'Contactada', tono: 'info' }, { id: 'COTIZADA', nombre: 'Cotizada', tono: 'brand' },
  { id: 'NEGOCIACION', nombre: 'En negociación', tono: 'warn' }, { id: 'GANADA', nombre: 'Ganada', tono: 'ok' }, { id: 'PERDIDA', nombre: 'Perdida', tono: 'bad' },
];
const ABIERTAS = ETAPAS.slice(0, 4);
const etapa = (e: Etapa) => ETAPAS.find((x) => x.id === e)!;
const ORIGENES: Record<string, string> = { WEB: 'Sitio web', BIGIN: 'Bigin', REFERIDO: 'Referido', LLAMADA: 'Llamada', VISITA: 'Visita', EVENTO: 'Evento o feria', OTRO: 'Otro' };
const TIPOS: Record<TipoActividad, string> = { LLAMADA: 'Llamada', VISITA: 'Visita', CORREO: 'Correo', REUNION: 'Reunión', WHATSAPP: 'WhatsApp', TAREA: 'Tarea', NOTA: 'Nota' };
const PAGOS: Record<string, string> = { CONTADO: 'De contado', CREDITO_30: 'Crédito 30 días', CREDITO_60: 'Crédito 60 días', CREDITO_90: 'Crédito 90 días' };
const NEGOCIACIONES: Record<string, string> = { COBRO: 'Cobro por la gestión', COMPRA: 'Compra del material', SIN_COSTO: 'Sin costo', CONTRATO: 'Por contrato' };
const ESTADO_COT: Record<Cotizacion['estado'], { t: string; tono: Tone }> = {
  BORRADOR: { t: 'Borrador', tono: 'neutral' }, ENVIADA: { t: 'Enviada', tono: 'info' }, ACEPTADA: { t: 'Aceptada', tono: 'ok' }, RECHAZADA: { t: 'Rechazada', tono: 'bad' },
};
const pesos = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? '—' : fmtCOP(Number(v)));
const vencida = (iso: string | null) => !!iso && new Date(iso).getTime() < Date.now();
const num = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));
const area = 'min-h-[80px] w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';

export function ComercialServidor() {
  const [vista, setVista] = useState<'embudo' | 'prospectos' | 'tareas'>('embudo');
  const [opSel, setOpSel] = useState<string | null>(null);
  const [prosSel, setProsSel] = useState<string | null>(null);
  const [nuevoPros, setNuevoPros] = useState(false);
  const [nuevaOp, setNuevaOp] = useState<{ prospectoId?: string } | null>(null);
  const [importar, setImportar] = useState(false);
  const [version, setVersion] = useState(0); // recarga las listas tras un cambio
  const embudo = useApi<Embudo>(`/comercial/embudo?v=${version}`);
  const cambio = () => setVersion((v) => v + 1);
  const k = embudo.datos?.kpis;
  return (
    <>
      <PageHeader eyebrow="Comercial" title="Embudo comercial"
        subtitle="Prospectos, oportunidades, tareas y cotizaciones. Al ganar una oportunidad se crean el cliente, su sede y sus declaraciones con la tarifa cotizada."
        actions={<>
          <Button onClick={() => setImportar(true)}><Upload size={16} /> Importar de Bigin</Button>
          <Button onClick={() => setNuevoPros(true)}><UserPlus size={16} /> Nuevo prospecto</Button>
          <Button variant="primary" onClick={() => setNuevaOp({})}><Plus size={16} /> Nueva oportunidad</Button>
        </>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Oportunidades abiertas" value={k ? String(k.abiertas) : '…'} />
        <Kpi label="Valor mensual en el embudo" value={k ? fmtCOP(k.valorAbierto) : '…'} />
        <Kpi label="Ganadas este mes" value={k ? String(k.ganadasMes) : '…'} hint={k?.valorGanadoMes ? `${fmtCOP(k.valorGanadoMes)} al mes` : undefined} />
        <Kpi label="Tasa de cierre (90 días)" value={k ? (k.tasaCierre === null ? '—' : `${k.tasaCierre} %`) : '…'} />
      </div>
      <div className="mb-4"><Tabs value={vista} onChange={setVista} items={[{ value: 'embudo', label: 'Embudo' }, { value: 'prospectos', label: 'Prospectos' }, { value: 'tareas', label: 'Tareas' }]} /></div>
      {vista === 'embudo' && (embudo.error ? <p className="rounded-xl bg-bad/10 p-4 text-bad">{embudo.error}</p> : <Tablero datos={embudo.datos} abrir={setOpSel} />)}
      {vista === 'prospectos' && <ListaProspectos version={version} abrir={setProsSel} />}
      {vista === 'tareas' && <ListaTareas version={version} abrirOp={setOpSel} abrirPros={setProsSel} onCambio={cambio} />}
      <OportunidadHoja id={opSel} onClose={() => setOpSel(null)} onCambio={cambio} abrirProspecto={(id) => { setOpSel(null); setProsSel(id); }} />
      <ProspectoHoja id={prosSel} onClose={() => setProsSel(null)} onCambio={cambio} abrirOp={(id) => { setProsSel(null); setOpSel(id); }}
        nuevaOp={(id) => setNuevaOp({ prospectoId: id })} />
      <NuevoProspecto open={nuevoPros} onClose={() => setNuevoPros(false)} listo={(id) => { setNuevoPros(false); cambio(); setProsSel(id); }} />
      <NuevaOportunidad datos={nuevaOp} onClose={() => setNuevaOp(null)} listo={(id) => { setNuevaOp(null); cambio(); setProsSel(null); setOpSel(id); }} />
      <ImportarBigin open={importar} onClose={() => setImportar(false)} listo={() => { setImportar(false); cambio(); }} />
    </>
  );
}

// =====================================================================
// Embudo: una columna por etapa abierta y las cerradas recientes
// =====================================================================
function Tablero({ datos, abrir }: { datos: Embudo | null; abrir: (id: string) => void }) {
  if (!datos) return <p className="p-6 text-center text-muted">Cargando…</p>;
  const cerradas = datos.oportunidades.filter((o) => o.etapa === 'GANADA' || o.etapa === 'PERDIDA');
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {ABIERTAS.map((e) => {
          const ops = datos.oportunidades.filter((o) => o.etapa === e.id);
          return (
            <section key={e.id} className="flex min-w-0 flex-col gap-2 rounded-xl bg-surface-2/60 p-2.5">
              <header className="flex items-center justify-between px-1">
                <Badge tone={e.tono} dot>{e.nombre}</Badge>
                <span className="num text-[12px] text-muted">{ops.length} · {fmtCOP(ops.reduce((s, o) => s + Number(o.valorMensual ?? 0), 0))}</span>
              </header>
              {ops.map((o) => <TarjetaOp key={o.id} o={o} abrir={abrir} />)}
              {!ops.length && <p className="px-1 py-3 text-center text-[12px] text-subtle">Sin oportunidades.</p>}
            </section>
          );
        })}
      </div>
      {cerradas.length > 0 && (
        <Card title="Cerradas en los últimos 90 días">
          <ul className="flex flex-col divide-y divide-line">
            {cerradas.map((o) => (
              <li key={o.id}><button onClick={() => abrir(o.id)} className="flex w-full items-center justify-between gap-2 py-2 text-left text-[13px] hover:bg-surface-2">
                <span className="min-w-0 truncate"><span className="font-medium">{o.prospecto.razonSocial}</span> · {o.titulo}{o.motivoPerdida ? <span className="text-muted"> · {o.motivoPerdida}</span> : null}</span>
                <span className="flex shrink-0 items-center gap-2">{o.valorMensual && <span className="num text-muted">{pesos(o.valorMensual)}</span>}<Badge tone={etapa(o.etapa).tono}>{etapa(o.etapa).nombre}</Badge></span>
              </button></li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function TarjetaOp({ o, abrir }: { o: OpFila; abrir: (id: string) => void }) {
  const prox = o.actividades[0], cot = o.cotizaciones[0];
  return (
    <button onClick={() => abrir(o.id)} className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface p-3 text-left hover:border-brand/50">
      <span className="text-[13px] font-semibold leading-snug">{o.titulo}</span>
      <span className="flex items-center gap-1 truncate text-[12px] text-muted"><Building2 size={12} className="shrink-0" />{o.prospecto.razonSocial}{o.prospecto.clienteId ? ' · cliente' : ''}</span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
        {o.valorMensual && <span className="num font-medium">{pesos(o.valorMensual)}/mes</span>}
        {cot && <Badge tone={ESTADO_COT[cot.estado as Cotizacion['estado']]?.tono ?? 'neutral'}>{cot.numero ?? 'Borrador'}</Badge>}
      </span>
      {prox && <span className={cx('flex items-center gap-1 text-[12px]', vencida(prox.venceEn) ? 'font-medium text-bad' : 'text-muted')}>
        <CalendarClock size={12} className="shrink-0" />{prox.asunto}{prox.venceEn ? ` · ${fechaHoraCo(prox.venceEn)}` : ''}</span>}
      {o.asesor && <span className="text-[11px] text-subtle">{o.asesor.nombre}</span>}
    </button>
  );
}

// =====================================================================
// Prospectos
// =====================================================================
function ListaProspectos({ version, abrir }: { version: number; abrir: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [buscar, setBuscar] = useState('');
  const [origen, setOrigen] = useState('');
  useEffect(() => { const t = setTimeout(() => setBuscar(q.trim()), 350); return () => clearTimeout(t); }, [q]);
  const p = usePaginado<ProspectoFila>(`/comercial/prospectos?v=${version}${buscar ? `&q=${encodeURIComponent(buscar)}` : ''}${origen ? `&origen=${origen}` : ''}`);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Input className="max-w-sm" placeholder="Buscar por empresa, NIT, contacto o correo" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar prospectos" />
        <Select className="w-auto" value={origen} onChange={(e) => setOrigen(e.target.value)} aria-label="Origen"><option value="">Todos los orígenes</option>
          {Object.entries(ORIGENES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
      </div>
      {p.error ? <p className="rounded-xl bg-bad/10 p-4 text-bad">{p.error}</p> : !p.filas ? <p className="p-6 text-center text-muted">Cargando…</p> : !p.filas.length ? <Empty>No hay prospectos con ese filtro.</Empty> : (
        <ul className="flex flex-col gap-2">
          {p.filas.map((x) => (
            <li key={x.id}><button onClick={() => abrir(x.id)} className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface p-3 text-left hover:border-brand/50">
              <span className="min-w-0">
                <span className="block font-medium">{x.razonSocial}{x.nit ? <span className="num text-muted"> · NIT {x.nit}</span> : null}</span>
                <span className="block truncate text-[12px] text-muted">{x.contactos[0] ? `${x.contactos[0].nombre}${x.contactos[0].cargo ? `, ${x.contactos[0].cargo}` : ''}${x.contactos[0].telefono ? ` · ${x.contactos[0].telefono}` : ''}` : 'Sin contacto'}
                  {x.asesor ? ` · ${x.asesor.nombre}` : ''}</span>
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                {x.cliente && <Badge tone="ok">Cliente</Badge>}
                {!x.activo && <Badge tone="neutral">Inactivo</Badge>}
                <Badge tone={x.origen === 'WEB' ? 'brand' : 'neutral'}>{ORIGENES[x.origen] ?? x.origen}</Badge>
                {x._count.oportunidades > 0 && <Badge tone="info">{x._count.oportunidades} abierta{x._count.oportunidades === 1 ? '' : 's'}</Badge>}
              </span>
            </button></li>
          ))}
        </ul>
      )}
      {p.filas && <PieLista mostradas={p.filas.length} total={p.total} hayMas={p.hayMas} cargando={p.cargando} cargarMas={p.cargarMas} />}
    </div>
  );
}

function ProspectoHoja({ id, onClose, onCambio, abrirOp, nuevaOp }: { id: string | null; onClose: () => void; onCambio: () => void; abrirOp: (id: string) => void; nuevaOp: (prospectoId: string) => void }) {
  const toast = useToast();
  const { go } = useRouter();
  const p = useApi<Prospecto>(id ? `/comercial/prospectos/${id}` : null);
  const [editar, setEditar] = useState(false);
  const [contacto, setContacto] = useState(false);
  useEffect(() => { setEditar(false); setContacto(false); }, [id]);
  if (!id) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;
  const x = p.datos;
  const recargar = () => { p.recargar(); onCambio(); };
  return (
    <Sheet open onClose={onClose} title={x ? x.razonSocial : 'Prospecto'}
      footer={x && !editar ? <><Button onClick={() => setEditar(true)}>Editar datos</Button><Button variant="primary" onClick={() => nuevaOp(x.id)}><Plus size={16} /> Nueva oportunidad</Button></> : undefined}>
      {!x ? <p className="p-6 text-center text-muted">{p.error || 'Cargando…'}</p> : editar ? <FormProspecto p={x} listo={() => { setEditar(false); recargar(); }} cancelar={() => setEditar(false)} /> : (
        <div className="flex flex-col gap-5">
          {x.cliente && <p className="flex items-center gap-2 rounded-lg bg-ok/10 px-3 py-2 text-[13px] text-ok"><CheckCircle2 size={16} />Ya es cliente: {x.cliente.razonSocial}.
            <button className="font-medium underline" onClick={() => go('clientes')}>Ver clientes</button></p>}
          <DefList items={[
            ['NIT', x.nit ?? '—'], ['Sector', x.sector ?? '—'], ['Origen', ORIGENES[x.origen] ?? x.origen], ['Asesor', x.asesor?.nombre ?? '—'],
            ['Teléfono', x.telefono ?? '—'], ['Correo', x.correo ?? '—'], ['Ubicación', [x.direccion, x.municipio && `${x.municipio.nombre} (${x.municipio.departamento})`].filter(Boolean).join(', ') || '—'],
            ['Representante legal', x.representanteLegal ?? '—'], ...(x.notas ? [['Notas', <span className="whitespace-pre-line">{x.notas}</span>]] as [string, ReactNode][] : []),
          ]} />
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between"><h3 className="text-[13px] font-semibold uppercase tracking-[0.05em] text-muted">Contactos</h3>
              {!contacto && <Button size="sm" variant="ghost" onClick={() => setContacto(true)}><Plus size={14} /> Agregar</Button>}</div>
            {contacto && <FormContacto prospectoId={x.id} listo={() => { setContacto(false); recargar(); }} cancelar={() => setContacto(false)} />}
            {x.contactos.map((c) => (
              <div key={c.id} className={cx('flex items-start justify-between gap-2 rounded-lg border border-line p-2.5 text-[13px]', !c.activo && 'opacity-60')}>
                <span className="min-w-0"><span className="font-medium">{c.nombre}</span>{c.cargo ? <span className="text-muted">, {c.cargo}</span> : null}
                  <span className="block text-muted">{[c.telefono, c.correo].filter(Boolean).join(' · ') || 'Sin teléfono ni correo'}</span></span>
                <span className="flex shrink-0 items-center gap-1">
                  {c.principal ? <Badge tone="brand">Principal</Badge> : c.activo && <Button size="sm" variant="ghost" onClick={async () => {
                    try { await api(`/comercial/contactos/${c.id}`, { metodo: 'PATCH', cuerpo: { principal: true } }); recargar(); } catch (e) { toast(msg(e), 'warn'); } }}>Hacer principal</Button>}
                  {c.activo && !c.principal && <Button size="sm" variant="ghost" aria-label="Inactivar contacto" onClick={async () => {
                    try { await api(`/comercial/contactos/${c.id}`, { metodo: 'PATCH', cuerpo: { activo: false } }); recargar(); } catch (e) { toast(msg(e), 'warn'); } }}><Trash2 size={14} /></Button>}
                </span>
              </div>
            ))}
            {!x.contactos.length && !contacto && <p className="text-[13px] text-subtle">Sin contactos.</p>}
          </section>
          <section className="flex flex-col gap-2">
            <h3 className="text-[13px] font-semibold uppercase tracking-[0.05em] text-muted">Oportunidades</h3>
            {x.oportunidades.map((o) => (
              <button key={o.id} onClick={() => abrirOp(o.id)} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-left text-[13px] hover:bg-surface-2">
                <span className="min-w-0 truncate">{o.titulo}{o.valorMensual ? <span className="num text-muted"> · {pesos(o.valorMensual)}/mes</span> : null}</span>
                <Badge tone={etapa(o.etapa).tono}>{etapa(o.etapa).nombre}</Badge>
              </button>
            ))}
            {!x.oportunidades.length && <p className="text-[13px] text-subtle">Aún no tiene oportunidades.</p>}
          </section>
          <Actividades prospectoId={x.id} lista={x.actividades} onCambio={recargar} />
        </div>
      )}
    </Sheet>
  );
}

/** Datos del prospecto (nuevo o editado). */
function FormProspecto({ p, listo, cancelar }: { p?: Prospecto; listo: (id: string) => void; cancelar?: () => void }) {
  const toast = useToast();
  const asesores = useApi<Ref[]>('/clientes/asesores');
  const [f, setF] = useState({
    razonSocial: p?.razonSocial ?? '', nit: p?.nit ?? '', sector: p?.sector ?? '', telefono: p?.telefono ?? '', correo: p?.correo ?? '', sitioWeb: p?.sitioWeb ?? '',
    direccion: p?.direccion ?? '', representanteLegal: p?.representanteLegal ?? '', origen: p?.origen ?? 'OTRO', asesorId: p?.asesor?.id ?? '', notas: p?.notas ?? '',
    contactoNombre: '', contactoCargo: '', contactoTelefono: '', contactoCorreo: '',
  });
  const [municipio, setMunicipio] = useState<MunicipioBuscado | null>(p?.municipio && p.municipioDane ? { codigoDane: p.municipioDane, ...p.municipio } : null);
  const [enviando, setEnviando] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    const datos = { razonSocial: f.razonSocial, nit: f.nit.replace(/\D/g, ''), sector: f.sector, telefono: f.telefono, correo: f.correo, sitioWeb: f.sitioWeb, direccion: f.direccion,
      representanteLegal: f.representanteLegal, origen: f.origen, asesorId: f.asesorId || null, notas: f.notas, municipioDane: municipio?.codigoDane ?? '' };
    try {
      if (p) { await api(`/comercial/prospectos/${p.id}`, { metodo: 'PATCH', cuerpo: datos }); toast('Prospecto actualizado.'); listo(p.id); }
      else {
        const r = await api<{ id: string }>('/comercial/prospectos', { cuerpo: { ...datos, ...(f.contactoNombre.trim() ? { contacto: { nombre: f.contactoNombre, cargo: f.contactoCargo,
          telefono: f.contactoTelefono, correo: f.contactoCorreo } } : {}) } });
        toast('Prospecto creado.'); listo(r.id);
      }
    } catch (x) { toast(msg(x), 'warn'); }
    setEnviando(false);
  };
  return (
    <form onSubmit={guardar} className="flex flex-col gap-3">
      <Field label="Empresa (razón social)" id="cp-rs"><Input id="cp-rs" value={f.razonSocial} onChange={set('razonSocial')} required maxLength={200} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="NIT (sin DV)" id="cp-nit" hint="Si aún no lo conoce, déjelo vacío"><Input id="cp-nit" inputMode="numeric" value={f.nit} onChange={set('nit')} maxLength={12} /></Field>
        <Field label="Sector" id="cp-sec"><Select id="cp-sec" value={f.sector} onChange={set('sector')}><option value="">Sin definir</option>{SECTORES.map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
        <Field label="Teléfono" id="cp-tel"><Input id="cp-tel" value={f.telefono} onChange={set('telefono')} maxLength={30} /></Field>
        <Field label="Correo" id="cp-co"><Input id="cp-co" type="email" value={f.correo} onChange={set('correo')} maxLength={150} /></Field>
        <Field label="Municipio" id="cp-mun"><BuscarMunicipio id="cp-mun" valor={municipio} onChange={setMunicipio} /></Field>
        <Field label="Dirección" id="cp-dir"><Input id="cp-dir" value={f.direccion} onChange={set('direccion')} maxLength={300} /></Field>
        <Field label="Representante legal" id="cp-rl"><Input id="cp-rl" value={f.representanteLegal} onChange={set('representanteLegal')} maxLength={150} /></Field>
        <Field label="Sitio web" id="cp-web"><Input id="cp-web" value={f.sitioWeb} onChange={set('sitioWeb')} maxLength={200} /></Field>
        <Field label="Cómo llegó" id="cp-or"><Select id="cp-or" value={f.origen} onChange={set('origen')}>{Object.entries(ORIGENES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Asesor" id="cp-as"><Select id="cp-as" value={f.asesorId} onChange={set('asesorId')}><option value="">Quien lo crea</option>{(asesores.datos ?? []).map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}</Select></Field>
      </div>
      <Field label="Notas" id="cp-no"><textarea id="cp-no" className={area} value={f.notas} onChange={set('notas')} maxLength={4000} /></Field>
      {!p && (
        <fieldset className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-2">
          <legend className="px-1 text-[13px] font-medium">Contacto principal</legend>
          <Field label="Nombre" id="cp-cn"><Input id="cp-cn" value={f.contactoNombre} onChange={set('contactoNombre')} maxLength={150} /></Field>
          <Field label="Cargo" id="cp-cc"><Input id="cp-cc" value={f.contactoCargo} onChange={set('contactoCargo')} maxLength={100} /></Field>
          <Field label="Teléfono" id="cp-ct"><Input id="cp-ct" value={f.contactoTelefono} onChange={set('contactoTelefono')} maxLength={30} /></Field>
          <Field label="Correo" id="cp-ce"><Input id="cp-ce" type="email" value={f.contactoCorreo} onChange={set('contactoCorreo')} maxLength={150} /></Field>
        </fieldset>
      )}
      <div className="flex justify-end gap-2 border-t border-line pt-3">
        {cancelar && <Button type="button" onClick={cancelar}><X size={16} /> Cancelar</Button>}
        <Button type="submit" variant="primary" disabled={enviando}>{enviando ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}{p ? 'Guardar' : 'Crear prospecto'}</Button>
      </div>
    </form>
  );
}

function FormContacto({ prospectoId, listo, cancelar }: { prospectoId: string; listo: () => void; cancelar: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ nombre: '', cargo: '', telefono: '', correo: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    try { await api(`/comercial/prospectos/${prospectoId}/contactos`, { cuerpo: f }); toast('Contacto agregado.'); listo(); } catch (x) { toast(msg(x), 'warn'); }
  };
  return (
    <form onSubmit={guardar} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-2">
      <Input placeholder="Nombre" aria-label="Nombre del contacto" value={f.nombre} onChange={set('nombre')} required maxLength={150} />
      <Input placeholder="Cargo" aria-label="Cargo" value={f.cargo} onChange={set('cargo')} maxLength={100} />
      <Input placeholder="Teléfono" aria-label="Teléfono" value={f.telefono} onChange={set('telefono')} maxLength={30} />
      <Input placeholder="Correo" aria-label="Correo" type="email" value={f.correo} onChange={set('correo')} maxLength={150} />
      <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" size="sm" onClick={cancelar}>Cancelar</Button><Button type="submit" size="sm" variant="primary">Agregar</Button></div>
    </form>
  );
}

function NuevoProspecto({ open, onClose, listo }: { open: boolean; onClose: () => void; listo: (id: string) => void }) {
  return <Sheet open={open} onClose={onClose} title="Nuevo prospecto">{open && <FormProspecto listo={listo} />}</Sheet>;
}

// =====================================================================
// Actividades y tareas
// =====================================================================
function Actividades({ prospectoId, oportunidadId, lista, onCambio }: { prospectoId?: string; oportunidadId?: string; lista: Actividad[]; onCambio: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ tipo: 'LLAMADA' as TipoActividad, asunto: '', detalle: '', vence: '' });
  const [abierto, setAbierto] = useState(false);
  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api('/comercial/actividades', { cuerpo: { prospectoId, oportunidadId, tipo: f.tipo, asunto: f.asunto, detalle: f.detalle, venceEn: f.vence ? new Date(f.vence).toISOString() : null } });
      setF({ tipo: 'LLAMADA', asunto: '', detalle: '', vence: '' }); setAbierto(false); onCambio();
    } catch (x) { toast(msg(x), 'warn'); }
  };
  const hecha = async (a: Actividad) => {
    const resultado = window.prompt('¿Qué resultado tuvo? (opcional)') ?? '';
    try { await api(`/comercial/actividades/${a.id}/hecha`, { cuerpo: { resultado } }); onCambio(); } catch (x) { toast(msg(x), 'warn'); }
  };
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between"><h3 className="text-[13px] font-semibold uppercase tracking-[0.05em] text-muted">Actividades y tareas</h3>
        {!abierto && <Button size="sm" variant="ghost" onClick={() => setAbierto(true)}><Plus size={14} /> Registrar</Button>}</div>
      {abierto && (
        <form onSubmit={guardar} className="flex flex-col gap-2 rounded-lg border border-line p-3">
          <div className="grid gap-2 sm:grid-cols-[150px_1fr]">
            <Select aria-label="Tipo" value={f.tipo} onChange={(e) => setF((s) => ({ ...s, tipo: e.target.value as TipoActividad }))}>
              {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
            <Input aria-label="Asunto" placeholder="Asunto: llamada de seguimiento, visita a la planta…" value={f.asunto} onChange={(e) => setF((s) => ({ ...s, asunto: e.target.value }))} required maxLength={200} />
          </div>
          <textarea className={area} aria-label="Detalle" placeholder="Detalle (opcional)" value={f.detalle} onChange={(e) => setF((s) => ({ ...s, detalle: e.target.value }))} maxLength={4000} />
          <div className="flex flex-wrap items-end justify-between gap-2">
            <Field label={f.tipo === 'TAREA' ? 'Fecha (obligatoria)' : 'Programar para (vacío = ya se hizo)'} id="act-v">
              <Input id="act-v" type="datetime-local" value={f.vence} onChange={(e) => setF((s) => ({ ...s, vence: e.target.value }))} required={f.tipo === 'TAREA'} />
            </Field>
            <span className="flex gap-2"><Button type="button" size="sm" onClick={() => setAbierto(false)}>Cancelar</Button><Button type="submit" size="sm" variant="primary">Guardar</Button></span>
          </div>
        </form>
      )}
      <ol className="flex flex-col gap-1.5">
        {lista.map((a) => (
          <li key={a.id} className={cx('rounded-lg border p-2.5 text-[13px]', !a.hechaEn && vencida(a.venceEn) ? 'border-bad/40 bg-bad/5' : 'border-line')}>
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0"><Badge tone={a.hechaEn ? 'neutral' : 'warn'}>{TIPOS[a.tipo]}</Badge> <span className="font-medium">{a.asunto}</span></span>
              {!a.hechaEn && <Button size="sm" variant="ghost" onClick={() => hecha(a)}><CheckCircle2 size={14} /> Hecha</Button>}
            </div>
            {a.detalle && <p className="mt-1 whitespace-pre-line text-muted">{a.detalle}</p>}
            <p className="mt-1 text-[12px] text-subtle">{a.hechaEn ? `Hecha ${fechaHoraCo(a.hechaEn)}` : `Para ${fechaHoraCo(a.venceEn)}`}{a.responsable ? ` · ${a.responsable.nombre}` : ''}{a.oportunidad ? ` · ${a.oportunidad.titulo}` : ''}</p>
          </li>
        ))}
        {!lista.length && <li className="text-[13px] text-subtle">Sin actividades todavía.</li>}
      </ol>
    </section>
  );
}

function ListaTareas({ version, abrirOp, abrirPros, onCambio }: { version: number; abrirOp: (id: string) => void; abrirPros: (id: string) => void; onCambio: () => void }) {
  const toast = useToast();
  const [todas, setTodas] = useState(false);
  const t = useApi<(Actividad & { prospecto: { id: string; razonSocial: string }; oportunidad: { id: string; titulo: string } | null })[]>(`/comercial/tareas?todas=${todas}&v=${version}`);
  const hecha = async (id: string) => {
    const resultado = window.prompt('¿Qué resultado tuvo? (opcional)') ?? '';
    try { await api(`/comercial/actividades/${id}/hecha`, { cuerpo: { resultado } }); t.recargar(); onCambio(); } catch (x) { toast(msg(x), 'warn'); }
  };
  return (
    <div className="flex flex-col gap-3">
      <Tabs value={todas ? 'todas' : 'mias'} onChange={(v) => setTodas(v === 'todas')} items={[{ value: 'mias', label: 'Mis tareas' }, { value: 'todas', label: 'Todo el equipo' }]} />
      {t.error ? <p className="rounded-xl bg-bad/10 p-4 text-bad">{t.error}</p> : !t.datos ? <p className="p-6 text-center text-muted">Cargando…</p> : !t.datos.length ? <Empty>No hay tareas pendientes.</Empty> : (
        <ul className="flex flex-col gap-2">
          {t.datos.map((a) => (
            <li key={a.id} className={cx('flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-surface p-3', vencida(a.venceEn) ? 'border-bad/40' : 'border-line')}>
              <span className="min-w-0">
                <span className="block font-medium"><Badge tone={vencida(a.venceEn) ? 'bad' : 'warn'}>{TIPOS[a.tipo]}</Badge> {a.asunto}</span>
                <span className="block text-[12px] text-muted">{fechaHoraCo(a.venceEn)} · <button className="underline" onClick={() => abrirPros(a.prospecto.id)}>{a.prospecto.razonSocial}</button>
                  {a.oportunidad ? <> · <button className="underline" onClick={() => abrirOp(a.oportunidad!.id)}>{a.oportunidad.titulo}</button></> : null}{a.responsable ? ` · ${a.responsable.nombre}` : ' · sin responsable'}</span>
              </span>
              <Button size="sm" onClick={() => hecha(a.id)}><CheckCircle2 size={14} /> Hecha</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// =====================================================================
// Oportunidad: datos, etapa, actividades, cotizaciones y ganar o perder
// =====================================================================
function OportunidadHoja({ id, onClose, onCambio, abrirProspecto }: { id: string | null; onClose: () => void; onCambio: () => void; abrirProspecto: (id: string) => void }) {
  const toast = useToast();
  const o = useApi<Oportunidad>(id ? `/comercial/oportunidades/${id}` : null);
  const [cot, setCot] = useState<Cotizacion | 'nueva' | null>(null);
  const [ganar, setGanar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { setCot(null); setGanar(false); }, [id]);
  if (!id) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;
  const x = o.datos;
  const cerrada = x?.etapa === 'GANADA' || x?.etapa === 'PERDIDA';
  const recargar = () => { o.recargar(); onCambio(); };
  const accion = async (fn: () => Promise<unknown>, ok: string) => {
    setOcupado(true);
    try { await fn(); if (ok) toast(ok); recargar(); } catch (e) { toast(msg(e), 'warn'); } finally { setOcupado(false); }
  };
  const cambiar = (datos: Record<string, unknown>) => accion(() => api(`/comercial/oportunidades/${id}`, { metodo: 'PATCH', cuerpo: datos }), 'Oportunidad actualizada.');
  const perder = () => {
    const motivo = window.prompt('¿Por qué se perdió? (precio, otro gestor, no tenía el residuo…)');
    if (motivo !== null) void accion(() => api(`/comercial/oportunidades/${id}/perder`, { cuerpo: { motivo } }), 'Oportunidad marcada perdida.');
  };
  const vistaPrevia = async (c: Cotizacion) => {
    const w = window.open('', '_blank');
    try { const b = await api<Blob>(`/comercial/cotizaciones/${c.id}/vista-previa`, { blob: true }); const u = URL.createObjectURL(b); if (w) w.location.href = u; else window.open(u, '_blank'); }
    catch (e) { w?.close(); toast(msg(e), 'warn'); }
  };
  const responder = (c: Cotizacion, aceptada: boolean) => {
    const motivo = aceptada ? '' : window.prompt('¿Por qué la rechazó el cliente?');
    if (motivo === null) return;
    void accion(() => api(`/comercial/cotizaciones/${c.id}/responder`, { cuerpo: { aceptada, motivo } }), aceptada ? 'Cotización aceptada: ya puede ganar la oportunidad.' : 'Cotización rechazada.');
  };
  return (
    <Sheet open onClose={onClose} title={x ? x.titulo : 'Oportunidad'}
      footer={x && !cerrada && !cot && !ganar ? <>
        <Button disabled={ocupado} onClick={perder}><XCircle size={16} /> Perdida</Button>
        <Button variant="primary" disabled={ocupado} onClick={() => setGanar(true)}><Trophy size={16} /> Ganar y crear cliente</Button>
      </> : undefined}>
      {!x ? <p className="p-6 text-center text-muted">{o.error || 'Cargando…'}</p>
        : cot ? <EditorCotizacion oportunidadId={x.id} cot={cot === 'nueva' ? null : cot} listo={() => { setCot(null); recargar(); }} cancelar={() => setCot(null)} />
        : ganar ? <GanarOportunidad o={x} listo={() => { setGanar(false); recargar(); }} cancelar={() => setGanar(false)} />
        : (
          <div className="flex flex-col gap-5">
            <DefList items={[
              ['Empresa', <button className="text-left font-medium text-brand underline" onClick={() => abrirProspecto(x.prospecto.id)}>{x.prospecto.razonSocial}</button>],
              ['Etapa', cerrada ? <Badge tone={etapa(x.etapa).tono}>{etapa(x.etapa).nombre}</Badge> : (
                <Select aria-label="Etapa" value={x.etapa} disabled={ocupado} onChange={(e) => void cambiar({ etapa: e.target.value })} className="h-8 w-auto">
                  {ABIERTAS.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}</Select>)],
              ['Valor mensual', x.valorMensual ? pesos(x.valorMensual) : '—'], ['Cierre estimado', x.cierreEstimado ? fmtFecha(x.cierreEstimado) : '—'],
              ['Contacto', x.contacto ? `${x.contacto.nombre}${x.contacto.cargo ? `, ${x.contacto.cargo}` : ''}` : (x.prospecto.contactos[0]?.nombre ?? '—')],
              ['Asesor', x.asesor?.nombre ?? '—'],
              ...(x.etapa === 'PERDIDA' ? [['Motivo', x.motivoPerdida ?? '—']] as [string, ReactNode][] : []),
              ...(x.cliente ? [['Cliente', x.cliente.razonSocial]] as [string, ReactNode][] : []),
              ...(x.cerradaEn ? [['Cerrada', `${fechaHoraCo(x.cerradaEn)}${x.cerradaPor ? ` · ${x.cerradaPor.nombre}` : ''}`]] as [string, ReactNode][] : []),
            ]} />
            {!cerrada && <ValorYCierre o={x} guardar={cambiar} />}
            {x.etapa === 'PERDIDA' && <Button className="self-start" disabled={ocupado} onClick={() => void cambiar({ etapa: 'CONTACTADA' })}>Reabrir la oportunidad</Button>}
            <section className="flex flex-col gap-2">
              <div className="flex items-center justify-between"><h3 className="text-[13px] font-semibold uppercase tracking-[0.05em] text-muted">Cotizaciones</h3>
                {!cerrada && <Button size="sm" variant="ghost" onClick={() => setCot('nueva')}><Plus size={14} /> Nueva cotización</Button>}</div>
              {x.cotizaciones.map((c) => (
                <div key={c.id} className="rounded-lg border border-line p-3 text-[13px]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span><span className="num font-medium">{c.numero ?? 'Borrador'}</span> · {c.items.length} {c.items.length === 1 ? 'renglón' : 'renglones'} · <span className="num">{pesos(c.totalEstimado)}</span></span>
                    <Badge tone={ESTADO_COT[c.estado].tono}>{ESTADO_COT[c.estado].t}</Badge>
                  </div>
                  <p className="mt-1 text-[12px] text-muted">{c.items.map((i) => i.catalogo?.nombre ?? i.descripcion).join(' · ')}</p>
                  {c.motivoRechazo && <p className="mt-1 text-[12px] text-bad">Rechazo: {c.motivoRechazo}</p>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {c.estado === 'BORRADOR' ? <>
                      {!cerrada && <Button size="sm" onClick={() => setCot(c)}>Editar</Button>}
                      <Button size="sm" onClick={() => void vistaPrevia(c)}><Eye size={14} /> Vista previa</Button>
                      {!cerrada && <Button size="sm" variant="primary" disabled={ocupado} onClick={() => void accion(() => api(`/comercial/cotizaciones/${c.id}/enviar`, { cuerpo: {} }),
                        'Cotización enviada: ya tiene número y PDF. Descárguela y envíela al cliente.')}><Send size={14} /> Generar PDF y marcar enviada</Button>}
                    </> : <Button size="sm" onClick={() => void abrirPdfGuardado(`/comercial/cotizaciones/${c.id}/enlace`).catch((e) => toast(msg(e), 'warn'))}><FileDown size={14} /> PDF</Button>}
                    {c.estado === 'ENVIADA' && !cerrada && <>
                      <Button size="sm" disabled={ocupado} onClick={() => responder(c, true)}><CheckCircle2 size={14} /> La aceptó</Button>
                      <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => responder(c, false)}><XCircle size={14} /> La rechazó</Button>
                    </>}
                  </div>
                </div>
              ))}
              {!x.cotizaciones.length && <p className="text-[13px] text-subtle">Aún no hay cotizaciones.</p>}
            </section>
            <Actividades oportunidadId={x.id} lista={x.actividades} onCambio={recargar} />
          </div>
        )}
    </Sheet>
  );
}

function ValorYCierre({ o, guardar }: { o: Oportunidad; guardar: (d: Record<string, unknown>) => Promise<void> }) {
  const [valor, setValor] = useState(o.valorMensual ? String(Number(o.valorMensual)) : '');
  const [cierre, setCierre] = useState(o.cierreEstimado?.slice(0, 10) ?? '');
  const cambio = valor !== (o.valorMensual ? String(Number(o.valorMensual)) : '') || cierre !== (o.cierreEstimado?.slice(0, 10) ?? '');
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Valor mensual estimado" id="op-v"><Input id="op-v" inputMode="numeric" value={valor} onChange={(e) => setValor(e.target.value)} className="w-44" /></Field>
      <Field label="Cierre estimado" id="op-c"><Input id="op-c" type="date" value={cierre} onChange={(e) => setCierre(e.target.value)} /></Field>
      {cambio && <Button size="sm" variant="primary" onClick={() => void guardar({ valorMensual: valor.trim() ? num(valor) : null, cierreEstimado: cierre || null })}><Save size={14} /> Guardar</Button>}
    </div>
  );
}

// ---------- Cotización: renglones del catálogo o residuos con su tratamiento, unidad y precio ----------
const itemVacio = (): ItemCot => ({ tipo: 'SERVICIO', catalogoId: null, descripcion: '', categoriaId: null, lineaServicioId: null, disposicionId: null, esPeligroso: false,
  metricaId: null, cantidadEstimada: null, frecuencia: null, precioUnitario: '' });

function EditorCotizacion({ oportunidadId, cot, listo, cancelar }: { oportunidadId: string; cot: Cotizacion | null; listo: () => void; cancelar: () => void }) {
  const toast = useToast();
  const cat = useApi<Catalogos>('/declaraciones/catalogos');
  const servicios = useApi<Servicio[]>('/declaraciones/catalogo-servicios');
  const [f, setF] = useState({ validezDias: String(cot?.validezDias ?? 30), formaPago: cot?.formaPago ?? 'CONTADO', tipoNegociacion: cot?.tipoNegociacion ?? 'COBRO', condiciones: cot?.condiciones ?? '' });
  const [items, setItems] = useState<ItemCot[]>(cot?.items.length ? cot.items.map((i) => ({ ...i, precioUnitario: String(Number(i.precioUnitario)),
    cantidadEstimada: i.cantidadEstimada === null ? null : String(Number(i.cantidadEstimada)) })) : [itemVacio()]);
  const [enviando, setEnviando] = useState(false);
  const setItem = (i: number, d: Partial<ItemCot>) => setItems((xs) => xs.map((x, k) => (k === i ? { ...x, ...d } : x)));
  const total = useMemo(() => items.reduce((s, x) => s + (x.cantidadEstimada && x.precioUnitario ? num(x.cantidadEstimada) * num(x.precioUnitario) : 0), 0), [items]);
  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    const malos = items.findIndex((x) => !x.descripcion.trim() || x.precioUnitario.trim() === '' || !(num(x.precioUnitario) >= 0));
    if (malos >= 0) { toast(`Renglón ${malos + 1}: escriba la descripción y el precio.`, 'warn'); return; }
    setEnviando(true);
    const cuerpo = {
      validezDias: Number(f.validezDias) || 30, formaPago: f.formaPago, tipoNegociacion: f.tipoNegociacion, condiciones: f.condiciones,
      items: items.map((x) => ({ tipo: x.tipo, catalogoId: x.tipo === 'SERVICIO' ? x.catalogoId : null, descripcion: x.descripcion.trim(),
        categoriaId: x.tipo === 'RESIDUO' ? x.categoriaId : null, lineaServicioId: x.tipo === 'RESIDUO' ? x.lineaServicioId : null,
        disposicionId: x.tipo === 'RESIDUO' ? x.disposicionId : null, esPeligroso: x.tipo === 'RESIDUO' && x.esPeligroso, metricaId: x.metricaId,
        cantidadEstimada: x.cantidadEstimada?.trim() ? num(x.cantidadEstimada) : null, frecuencia: x.frecuencia ?? '', precioUnitario: num(x.precioUnitario) })),
    };
    try {
      if (cot) await api(`/comercial/cotizaciones/${cot.id}`, { metodo: 'PATCH', cuerpo });
      else await api(`/comercial/oportunidades/${oportunidadId}/cotizaciones`, { cuerpo });
      toast('Cotización guardada en borrador. Revise la vista previa y luego envíela.'); listo();
    } catch (x) { toast(msg(x), 'warn'); }
    setEnviando(false);
  };
  const c = cat.datos;
  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      <h3 className="font-semibold">{cot ? 'Editar el borrador' : 'Nueva cotización'}</h3>
      {items.map((x, i) => (
        <fieldset key={i} className="flex flex-col gap-2 rounded-lg border border-line p-3">
          <div className="flex items-center justify-between gap-2">
            <legend className="text-[13px] font-medium">Renglón {i + 1}</legend>
            {items.length > 1 && <Button type="button" size="sm" variant="ghost" aria-label="Quitar el renglón" onClick={() => setItems((xs) => xs.filter((_, k) => k !== i))}><Trash2 size={14} /></Button>}
          </div>
          <div className="grid gap-2 sm:grid-cols-[140px_1fr]">
            <Select aria-label="Tipo" value={x.tipo} onChange={(e) => setItem(i, { tipo: e.target.value as ItemCot['tipo'], catalogoId: null })}>
              <option value="SERVICIO">Servicio</option><option value="RESIDUO">Residuo</option></Select>
            {x.tipo === 'SERVICIO'
              ? <Select aria-label="Servicio del catálogo" value={x.catalogoId ?? ''} onChange={(e) => { const s = servicios.datos?.find((y) => y.id === e.target.value);
                  setItem(i, { catalogoId: s?.id ?? null, descripcion: s?.nombre ?? x.descripcion }); }}>
                  <option value="">Elija el servicio…</option>{(servicios.datos ?? []).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</Select>
              : <Input aria-label="Residuo" placeholder="Residuo: lodos aceitosos, aceite usado…" value={x.descripcion} onChange={(e) => setItem(i, { descripcion: e.target.value })} maxLength={300} />}
          </div>
          {x.tipo === 'RESIDUO' && c && (
            <div className="grid gap-2 sm:grid-cols-3">
              <Select aria-label="Categoría" value={x.categoriaId ?? ''} onChange={(e) => setItem(i, { categoriaId: e.target.value || null })}>
                <option value="">Categoría…</option>{c.categorias.map((y) => <option key={y.id} value={y.id}>{y.nombre}</option>)}</Select>
              <Select aria-label="Línea de servicio" value={x.lineaServicioId ?? ''} onChange={(e) => setItem(i, { lineaServicioId: e.target.value || null })}>
                <option value="">Línea de servicio…</option>{c.lineas.map((y) => <option key={y.id} value={y.id}>{y.codigo} · {y.nombre}</option>)}</Select>
              <Select aria-label="Tratamiento" value={x.disposicionId ?? ''} onChange={(e) => setItem(i, { disposicionId: e.target.value || null })}>
                <option value="">Tratamiento…</option>{c.disposiciones.map((y) => <option key={y.id} value={y.id}>{y.nombre}</option>)}</Select>
              <label className="flex items-center gap-2 text-[13px] sm:col-span-3"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--brand))]" checked={x.esPeligroso}
                onChange={(e) => setItem(i, { esPeligroso: e.target.checked })} /> Residuo peligroso</label>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Select aria-label="Unidad del precio" value={x.metricaId ?? ''} onChange={(e) => setItem(i, { metricaId: e.target.value || null })}>
              <option value="">Por servicio</option>{(c?.metricasPrecio ?? []).map((m) => <option key={m.id} value={m.id}>Por {m.abreviacion}</option>)}</Select>
            <Input aria-label="Cantidad estimada" placeholder="Cantidad estimada" inputMode="decimal" value={x.cantidadEstimada ?? ''} onChange={(e) => setItem(i, { cantidadEstimada: e.target.value })} />
            <Input aria-label="Frecuencia" placeholder="Frecuencia (mensual…)" value={x.frecuencia ?? ''} onChange={(e) => setItem(i, { frecuencia: e.target.value })} maxLength={60} />
            <Input aria-label="Precio unitario" placeholder="Precio unitario" inputMode="decimal" value={x.precioUnitario} onChange={(e) => setItem(i, { precioUnitario: e.target.value })} required />
          </div>
        </fieldset>
      ))}
      <Button type="button" className="self-start" onClick={() => setItems((xs) => [...xs, itemVacio()])}><Plus size={16} /> Agregar renglón</Button>
      <p className="text-right text-[13px]">Total estimado por periodo (con las cantidades): <span className="num font-semibold">{fmtCOP(total)}</span></p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Validez (días)" id="ct-v"><Input id="ct-v" inputMode="numeric" value={f.validezDias} onChange={(e) => setF((s) => ({ ...s, validezDias: e.target.value }))} /></Field>
        <Field label="Forma de pago" id="ct-p"><Select id="ct-p" value={f.formaPago} onChange={(e) => setF((s) => ({ ...s, formaPago: e.target.value }))}>
          {Object.entries(PAGOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Negociación" id="ct-n"><Select id="ct-n" value={f.tipoNegociacion} onChange={(e) => setF((s) => ({ ...s, tipoNegociacion: e.target.value }))}>
          {Object.entries(NEGOCIACIONES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
      </div>
      <Field label="Condiciones adicionales (salen en el PDF)" id="ct-c"><textarea id="ct-c" className={area} value={f.condiciones} onChange={(e) => setF((s) => ({ ...s, condiciones: e.target.value }))} maxLength={4000} /></Field>
      <div className="flex justify-end gap-2 border-t border-line pt-3">
        <Button type="button" onClick={cancelar}><X size={16} /> Cancelar</Button>
        <Button type="submit" variant="primary" disabled={enviando}>{enviando ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}Guardar borrador</Button>
      </div>
    </form>
  );
}

// ---------- Ganar: cliente, sede principal y declaraciones con tarifa ----------
function GanarOportunidad({ o, listo, cancelar }: { o: Oportunidad; listo: () => void; cancelar: () => void }) {
  const toast = useToast();
  const { go } = useRouter();
  const yaCliente = !!o.prospecto.cliente;
  const elegibles = o.cotizaciones.filter((c) => c.estado === 'ENVIADA' || c.estado === 'ACEPTADA');
  const [cotizacionId, setCotizacionId] = useState((elegibles.find((c) => c.estado === 'ACEPTADA') ?? elegibles[0])?.id ?? '');
  const contacto = o.contacto ?? o.prospecto.contactos[0] ?? null;
  const [f, setF] = useState({
    nit: o.prospecto.nit ?? '', razonSocial: o.prospecto.razonSocial, representanteLegal: o.prospecto.representanteLegal ?? '', sector: o.prospecto.sector ?? '',
    emailFacturacion: o.prospecto.correo ?? '', tipo: 'DIRECTO', sedeNombre: 'Sede principal', direccion: o.prospecto.direccion ?? '',
    contacto: contacto?.nombre ?? '', telefono: contacto?.telefono ?? o.prospecto.telefono ?? '', emails: contacto?.correo ?? '',
  });
  const [municipio, setMunicipio] = useState<MunicipioBuscado | null>(o.prospecto.municipio && o.prospecto.municipioDane ? { codigoDane: o.prospecto.municipioDane, ...o.prospecto.municipio } : null);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ nuevoCliente: boolean; declaraciones: { numero: number; nombre: string; estado: string }[]; omitidas: { descripcion: string; motivo: string }[] } | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const confirmar = async (e: FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    try {
      const r = await api<NonNullable<typeof resultado>>(`/comercial/oportunidades/${o.id}/ganar`, { cuerpo: {
        cotizacionId: cotizacionId || null,
        ...(yaCliente ? {} : {
          cliente: { nit: f.nit.replace(/\D/g, ''), razonSocial: f.razonSocial, representanteLegal: f.representanteLegal, sector: f.sector, emailFacturacion: f.emailFacturacion, tipo: f.tipo },
          sede: { nombre: f.sedeNombre, direccion: f.direccion, municipioDane: municipio?.codigoDane ?? '', contacto: f.contacto, telefono: f.telefono, emails: f.emails },
        }),
      } });
      setResultado(r);
    } catch (x) { toast(msg(x), 'warn'); }
    setEnviando(false);
  };
  if (resultado) return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-2 rounded-lg bg-ok/10 px-3 py-2 text-ok"><Trophy size={18} /> ¡Oportunidad ganada!{resultado.nuevoCliente ? ' Se creó el cliente con su sede principal.' : ''}</p>
      {resultado.declaraciones.length > 0 && <div className="text-[13px]"><p className="mb-1 font-medium">Declaraciones creadas con su tarifa:</p>
        <ul className="list-disc pl-5">{resultado.declaraciones.map((d) => <li key={d.numero}>N.º {d.numero} · {d.nombre} · {d.estado === 'BORRADOR' ? 'en borrador (falta la caracterización del residuo)' : 'para autorizar'}</li>)}</ul></div>}
      {resultado.omitidas.length > 0 && <div className="rounded-lg bg-warn/10 p-3 text-[13px] text-warn"><p className="font-medium">No se volvieron declaración:</p>
        <ul className="list-disc pl-5">{resultado.omitidas.map((d, k) => <li key={k}>{d.descripcion}: {d.motivo}</li>)}</ul></div>}
      <div className="flex flex-wrap justify-end gap-2"><Button onClick={() => go('declaraciones')}>Ver declaraciones</Button><Button onClick={() => go('clientes')}>Ver clientes</Button><Button variant="primary" onClick={listo}>Listo</Button></div>
    </div>
  );
  return (
    <form onSubmit={confirmar} className="flex flex-col gap-4">
      <h3 className="font-semibold">Ganar y crear el cliente</h3>
      <Field label="Cotización que aceptó el cliente" id="g-c" hint="Cada renglón se vuelve una declaración con su tarifa (los residuos quedan en borrador hasta completar su caracterización).">
        <Select id="g-c" value={cotizacionId} onChange={(e) => setCotizacionId(e.target.value)}>
          <option value="">Sin cotización (solo crear el cliente)</option>
          {elegibles.map((c) => <option key={c.id} value={c.id}>{c.numero} · {ESTADO_COT[c.estado].t} · {pesos(c.totalEstimado)}</option>)}
        </Select>
      </Field>
      {yaCliente ? <p className="rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-muted">Ya es cliente: las declaraciones se agregan a sus sedes.</p> : <>
        <fieldset className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-2">
          <legend className="px-1 text-[13px] font-medium">Cliente</legend>
          <Field label="NIT (sin DV)" id="g-nit"><Input id="g-nit" inputMode="numeric" value={f.nit} onChange={set('nit')} required maxLength={12} /></Field>
          <Field label="Razón social" id="g-rs"><Input id="g-rs" value={f.razonSocial} onChange={set('razonSocial')} required maxLength={200} /></Field>
          <Field label="Representante legal" id="g-rl" hint="Si es persona natural, su propio nombre"><Input id="g-rl" value={f.representanteLegal} onChange={set('representanteLegal')} required maxLength={150} /></Field>
          <Field label="Sector" id="g-sec"><Select id="g-sec" value={f.sector} onChange={set('sector')}><option value="">Sin definir</option>{SECTORES.map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
          <Field label="Correo de facturación" id="g-ef"><Input id="g-ef" type="email" value={f.emailFacturacion} onChange={set('emailFacturacion')} maxLength={150} /></Field>
          <Field label="Tipo" id="g-t"><Select id="g-t" value={f.tipo} onChange={set('tipo')}><option value="DIRECTO">Generador directo</option><option value="GESTOR">Gestor (sus sedes son generadores)</option></Select></Field>
        </fieldset>
        <fieldset className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-2">
          <legend className="px-1 text-[13px] font-medium">Sede principal</legend>
          <Field label="Nombre" id="g-sn"><Input id="g-sn" value={f.sedeNombre} onChange={set('sedeNombre')} required maxLength={150} /></Field>
          <Field label="Municipio" id="g-mun"><BuscarMunicipio id="g-mun" valor={municipio} onChange={setMunicipio} /></Field>
          <Field label="Dirección" id="g-dir"><Input id="g-dir" value={f.direccion} onChange={set('direccion')} maxLength={300} /></Field>
          <Field label="Contacto" id="g-con"><Input id="g-con" value={f.contacto} onChange={set('contacto')} maxLength={150} /></Field>
          <Field label="Teléfono" id="g-tel"><Input id="g-tel" value={f.telefono} onChange={set('telefono')} maxLength={20} /></Field>
          <Field label="Correos" id="g-em"><Input id="g-em" value={f.emails} onChange={set('emails')} maxLength={200} /></Field>
        </fieldset>
      </>}
      <div className="flex justify-end gap-2 border-t border-line pt-3">
        <Button type="button" onClick={cancelar}><X size={16} /> Cancelar</Button>
        <Button type="submit" variant="primary" disabled={enviando}>{enviando ? <Loader2 size={16} className="animate-spin" /> : <Trophy size={16} />}Ganar la oportunidad</Button>
      </div>
    </form>
  );
}

// ---------- Nueva oportunidad: de un prospecto o de un cliente que ya existe ----------
function NuevaOportunidad({ datos, onClose, listo }: { datos: { prospectoId?: string } | null; onClose: () => void; listo: (id: string) => void }) {
  const toast = useToast();
  const [modo, setModo] = useState<'prospecto' | 'cliente'>('prospecto');
  const [q, setQ] = useState('');
  const [elegido, setElegido] = useState<{ id: string; nombre: string } | null>(null);
  const [f, setF] = useState({ titulo: '', valor: '', cierre: '' });
  const [enviando, setEnviando] = useState(false);
  useEffect(() => { setModo('prospecto'); setQ(''); setElegido(null); setF({ titulo: '', valor: '', cierre: '' }); }, [datos]);
  const fijo = datos?.prospectoId;
  const buscarP = useApi<{ filas: { id: string; razonSocial: string; nit: string | null }[] }>(!fijo && datos && modo === 'prospecto' && q.trim().length >= 2 ? `/comercial/prospectos?q=${encodeURIComponent(q.trim())}&porPagina=8` : null);
  const buscarC = useApi<{ filas: { id: string; razonSocial: string; nit: string }[] }>(!fijo && datos && modo === 'cliente' && q.trim().length >= 2 ? `/clientes?q=${encodeURIComponent(q.trim())}&porPagina=8` : null);
  const opciones = modo === 'prospecto' ? (buscarP.datos?.filas ?? []).map((x) => ({ id: x.id, nombre: x.razonSocial, nit: x.nit })) : (buscarC.datos?.filas ?? []).map((x) => ({ id: x.id, nombre: x.razonSocial, nit: x.nit }));
  const crear = async (e: FormEvent) => {
    e.preventDefault();
    const destino = fijo ? { prospectoId: fijo } : elegido ? (modo === 'prospecto' ? { prospectoId: elegido.id } : { clienteId: elegido.id }) : null;
    if (!destino) { toast('Elija el prospecto o el cliente.', 'warn'); return; }
    setEnviando(true);
    try {
      const r = await api<{ id: string }>('/comercial/oportunidades', { cuerpo: { ...destino, titulo: f.titulo, valorMensual: f.valor.trim() ? num(f.valor) : null, cierreEstimado: f.cierre || null } });
      toast('Oportunidad creada.'); listo(r.id);
    } catch (x) { toast(msg(x), 'warn'); }
    setEnviando(false);
  };
  return (
    <Sheet open={!!datos} onClose={onClose} title="Nueva oportunidad">
      {datos && (
        <form onSubmit={crear} className="flex flex-col gap-4">
          {!fijo && <>
            <Tabs value={modo} onChange={(v) => { setModo(v); setElegido(null); setQ(''); }} items={[{ value: 'prospecto', label: 'Prospecto' }, { value: 'cliente', label: 'Cliente que ya existe' }]} />
            {elegido ? <p className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-[13px]"><span className="font-medium">{elegido.nombre}</span>
              <Button type="button" size="sm" variant="ghost" onClick={() => setElegido(null)}>Cambiar</Button></p> : <>
              <Input placeholder={modo === 'prospecto' ? 'Buscar el prospecto (nombre o NIT)' : 'Buscar el cliente (nombre o NIT)'} aria-label="Buscar" value={q} onChange={(e) => setQ(e.target.value)} />
              <ul className="flex flex-col gap-1">{opciones.map((x) => <li key={x.id}><button type="button" onClick={() => setElegido(x)}
                className="w-full rounded-lg border border-line px-3 py-2 text-left text-[13px] hover:bg-surface-2">{x.nombre}{x.nit ? <span className="num text-muted"> · {x.nit}</span> : null}</button></li>)}</ul>
              {modo === 'prospecto' && <p className="text-[12px] text-muted">¿No está? Créelo con «Nuevo prospecto».</p>}
            </>}
          </>}
          <Field label="Qué se ofrece" id="no-t"><Input id="no-t" placeholder="Ej.: recolección mensual de lodos y aceites" value={f.titulo} onChange={(e) => setF((s) => ({ ...s, titulo: e.target.value }))} required maxLength={200} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Valor mensual estimado" id="no-v"><Input id="no-v" inputMode="numeric" value={f.valor} onChange={(e) => setF((s) => ({ ...s, valor: e.target.value }))} /></Field>
            <Field label="Cierre estimado" id="no-c"><Input id="no-c" type="date" value={f.cierre} onChange={(e) => setF((s) => ({ ...s, cierre: e.target.value }))} /></Field>
          </div>
          <div className="flex justify-end border-t border-line pt-3"><Button type="submit" variant="primary" disabled={enviando}>{enviando ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}Crear oportunidad</Button></div>
        </form>
      )}
    </Sheet>
  );
}

// ---------- Importar de Bigin ----------
interface ResumenBigin {
  confirmado: boolean; empresas: { leidas: number; nuevas: number; existentes: number; enlazadasACliente: number }; contactos: { leidos: number; nuevos: number; existentes: number };
  negocios: { leidos: number; nuevos: number; existentes: number; porEtapa: Record<string, number> }; errores: { archivo: string; fila: number; mensaje: string }[]; totalErrores: number;
}
function ImportarBigin({ open, onClose, listo }: { open: boolean; onClose: () => void; listo: () => void }) {
  const toast = useToast();
  const [archivos, setArchivos] = useState<{ empresas?: File; contactos?: File; negocios?: File }>({});
  const [resumen, setResumen] = useState<ResumenBigin | null>(null);
  const [enviando, setEnviando] = useState(false);
  useEffect(() => { if (open) { setArchivos({}); setResumen(null); } }, [open]);
  const enviar = async (confirmar: boolean) => {
    const fo = new FormData();
    (['empresas', 'contactos', 'negocios'] as const).forEach((k) => { const a = archivos[k]; if (a) fo.append(k, a); });
    if (confirmar) fo.append('confirmar', 'true');
    setEnviando(true);
    try {
      const r = await api<ResumenBigin>('/comercial/importar-bigin', { form: fo });
      if (confirmar) { toast(`Importado de Bigin: ${r.empresas.nuevas} empresas, ${r.contactos.nuevos} contactos y ${r.negocios.nuevos} negocios nuevos.`, 'ok'); listo(); }
      else setResumen(r);
    } catch (x) { toast(msg(x), 'warn'); }
    setEnviando(false);
  };
  const hay = !!(archivos.empresas || archivos.contactos || archivos.negocios);
  return (
    <Sheet open={open} onClose={onClose} title="Importar de Bigin">
      <div className="flex flex-col gap-4 text-[13px]">
        <p className="text-muted">En Bigin, exporte a CSV las empresas, los contactos y los negocios (pipelines). Súbalos aquí: primero verá qué se va a crear y nada se guarda hasta que confirme.
          Volver a importar no duplica: se reconoce cada registro por su id de Bigin, el NIT o el nombre.</p>
        {(['empresas', 'contactos', 'negocios'] as const).map((k) => (
          <Field key={k} label={{ empresas: 'Empresas (Companies)', contactos: 'Contactos (Contacts)', negocios: 'Negocios (Deals o Pipelines)' }[k]} id={`bg-${k}`}>
            <input id={`bg-${k}`} type="file" accept=".csv,text/csv" className="text-[13px]" onChange={(e) => { setArchivos((s) => ({ ...s, [k]: e.target.files?.[0] })); setResumen(null); }} />
          </Field>
        ))}
        {resumen && (
          <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
            <p className="font-medium">Esto es lo que se va a importar:</p>
            <ul className="list-disc pl-5">
              <li>Empresas: {resumen.empresas.nuevas} nuevas, {resumen.empresas.existentes} ya estaban{resumen.empresas.enlazadasACliente ? `, ${resumen.empresas.enlazadasACliente} se enlazan a su cliente` : ''}.</li>
              <li>Contactos: {resumen.contactos.nuevos} nuevos, {resumen.contactos.existentes} ya estaban.</li>
              <li>Negocios: {resumen.negocios.nuevos} nuevos, {resumen.negocios.existentes} ya estaban{Object.keys(resumen.negocios.porEtapa).length ? ` (${Object.entries(resumen.negocios.porEtapa).map(([e, n]) => `${etapa(e as Etapa)?.nombre ?? e}: ${n}`).join(', ')})` : ''}.</li>
            </ul>
            {resumen.totalErrores > 0 && <div className="rounded-lg bg-warn/10 p-2 text-warn"><p className="font-medium">{resumen.totalErrores} filas no se pueden importar:</p>
              <ul className="list-disc pl-5">{resumen.errores.slice(0, 8).map((e, k) => <li key={k}>{e.archivo}, fila {e.fila}: {e.mensaje}</li>)}</ul></div>}
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-line pt-3">
          {!resumen ? <Button variant="primary" disabled={!hay || enviando} onClick={() => void enviar(false)}>{enviando ? <Loader2 size={16} className="animate-spin" /> : <Eye size={16} />}Revisar</Button>
            : <Button variant="primary" disabled={enviando} onClick={() => void enviar(true)}>{enviando ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}Importar</Button>}
        </div>
      </div>
    </Sheet>
  );
}
