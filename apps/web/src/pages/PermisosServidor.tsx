// Permisos ambientales, obligaciones y gestores aliados con datos reales (fase 1c). Prioridad 1 de la gerencia:
// cumplimiento estricto. Cada cumplimiento queda con su soporte en un historial que no se borra, y la vigencia de la
// licencia de cada aliado decide si sus disposiciones se pueden autorizar (misma regla de la base de datos).
import { useState, type FormEvent } from 'react';
import { AlertTriangle, CalendarClock, Check, ExternalLink, FileText, History, Loader2, Pencil, Plus, ShieldCheck, Upload } from 'lucide-react';
import { ResponsiveTable, type Column } from '../components/data';
import { Badge, Button, Card, Field, Input, PageHeader, Select, Sheet, Tabs, useToast, type Tone } from '../components/ui';
import { api, ErrorApi, tienePermiso } from '../lib/api';
import { hoyCo, useApi } from '../lib/servidor';
import { urlAbsoluta } from '../lib/trabajos';
import { useRouter } from '../lib/router';
import { cx, diasEntre, fmtFecha } from '../lib/format';

interface Cumplimiento { id: string; fechaProgramada: string | null; cumplidaEn: string; radicado: string | null; soporteUrl: string | null; nota: string | null; usuario: { nombre: string }; creadoEn: string }
interface Obligacion {
  id: string; descripcion: string; codigo: string | null; periodicidad: string; meses: number | null; articulo: string | null; proximaFecha: string | null;
  responsable: string | null; cumplida: boolean; cumplimientos: Cumplimiento[]; _count: { cumplimientos: number };
}
interface Permiso {
  id: string; acto: string; autoridad: string; alcance: string; expedicion: string | null; vence: string | null; estado: string; documentoUrl: string | null;
  obligaciones: Obligacion[]; disposiciones: { disposicion: { codigo: string; nombre: string; activo: boolean } }[];
}
interface Aliado {
  id: string; nit: string; razonSocial: string; licencia: string | null; licenciaAutoridad: string | null; licenciaIndefinida: boolean; licenciaVence: string | null;
  licenciaUrl: string | null; alcance: string | null; excluyeTiposResiduo: string[]; municipio: string | null;
  disposicionesGestionadas: { disposicion: { codigo: string; nombre: string; activo: boolean } }[];
  vigencia: { estado: 'SIN_LICENCIA' | 'INDEFINIDA' | 'SIN_VIGENCIA' | 'VENCIDA' | 'POR_VENCER' | 'VIGENTE'; cubre: boolean; dias?: number };
}
type Panel = { tipo: 'cumplir'; o: Obligacion; acto: string } | { tipo: 'historial'; o: Obligacion; acto: string } | { tipo: 'permiso'; p: Permiso } | { tipo: 'aliado'; a: Aliado }
  | { tipo: 'nuevoPermiso' } | { tipo: 'nuevoAliado' };
interface DisposicionCat { id: string; codigo: string; nombre: string; propia: boolean }

/** Abre el PDF guardado con su enlace firmado (5 minutos); si es un enlace externo, ese enlace. */
async function verDocumento(ruta: string) {
  const w = window.open('', '_blank');
  try { const e = await api<{ url: string }>(ruta); if (w) w.location.href = urlAbsoluta(e.url); else window.open(urlAbsoluta(e.url), '_blank'); }
  catch (x) { w?.close(); throw x; }
}
async function subirPdf(ruta: string, archivo: File) { const form = new FormData(); form.append('archivo', archivo); await api(ruta, { form }); }

/** Elegir el PDF del acto o de la licencia (se sube al guardar). */
function ElegirPdf({ id, archivo, onChange, actual }: { id: string; archivo: File | null; onChange: (f: File | null) => void; actual?: string | null }) {
  return (
    <Field label="PDF del documento" id={id} hint={actual ? 'Ya tiene un documento; si elige otro, lo reemplaza (el anterior queda en la auditoría).' : 'El acto o la licencia escaneada, máximo 15 MB.'}>
      <label htmlFor={id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-line px-3 py-2.5 text-[13px] hover:bg-surface-2">
        <Upload size={15} className="shrink-0 text-muted" /><span className="truncate">{archivo ? archivo.name : 'Elegir el PDF…'}</span>
      </label>
      <input id={id} type="file" accept="application/pdf" className="hidden" onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
    </Field>
  );
}
/** Tratamientos que ampara un acto o que hace un gestor. */
function ElegirDisposiciones({ opciones, elegidas, onChange }: { opciones: DisposicionCat[]; elegidas: string[]; onChange: (c: string[]) => void }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-[13px] font-medium">Tratamientos que ampara</legend>
      <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-lg border border-line p-2">{opciones.map((d) => (
        <label key={d.codigo} className="flex items-start gap-2 rounded-md px-1.5 py-1 text-[13px] hover:bg-surface-2">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--brand))]" checked={elegidas.includes(d.codigo)}
            onChange={(e) => onChange(e.target.checked ? [...elegidas, d.codigo] : elegidas.filter((c) => c !== d.codigo))} />
          <span><span className="num mr-1 text-muted">{d.codigo}</span>{d.nombre}</span>
        </label>))}
      </div>
    </fieldset>
  );
}

const ESTADO_PERMISO: Record<string, [string, Tone]> = { VIGENTE: ['Vigente', 'ok'], POR_VENCER: ['Por vencer', 'warn'], VENCIDO: ['Vencido', 'bad'], EN_TRAMITE: ['En trámite', 'info'] };
const LICENCIA: Record<Aliado['vigencia']['estado'], [string, Tone]> = {
  INDEFINIDA: ['Indefinida', 'ok'], VIGENTE: ['Vigente', 'ok'], POR_VENCER: ['Por vencer', 'warn'], VENCIDA: ['Vencida', 'bad'], SIN_VIGENCIA: ['Falta la vigencia', 'bad'], SIN_LICENCIA: ['Sin licencia', 'bad'],
};
function mensajeError(e: unknown, def: string) {
  if (!(e instanceof ErrorApi)) return def;
  const d = (e.datos as { detalles?: { campo: string; mensaje: string }[] } | undefined)?.detalles;
  return d?.length ? d.map((x) => x.mensaje).join(' · ') : e.message;
}
/** Cuándo toca una obligación, con su urgencia. */
function Plazo({ o }: { o: Obligacion }) {
  if (o.cumplida) return <Badge tone="ok"><Check size={11} /> Cumplida</Badge>;
  if (!o.proximaFecha) return <Badge tone="neutral">{/evento/i.test(o.periodicidad) ? 'Por evento' : 'Permanente'}</Badge>;
  const d = diasEntre(hoyCo(), o.proximaFecha.slice(0, 10));
  const tono: Tone = d < 0 || d <= 15 ? 'bad' : d <= 30 ? 'warn' : 'neutral';
  return <Badge tone={tono}>{d < 0 ? `Vencida hace ${-d} días` : d === 0 ? 'Vence hoy' : `En ${d} días`}</Badge>;
}
const fechaCorta = (iso: string | null) => (iso ? fmtFecha(iso.slice(0, 10)) : '—');

export function PermisosServidor() {
  const { go } = useRouter();
  const puede = tienePermiso('permisos.gestionar');
  const [vista, setVista] = useState<'permisos' | 'obligaciones' | 'aliados'>('permisos');
  const permisos = useApi<Permiso[]>('/permisos-ambientales');
  const aliados = useApi<Aliado[]>(vista === 'aliados' ? '/gestores-aliados' : null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [filtroObl, setFiltroObl] = useState<'proximas' | 'todas'>('proximas');
  const listo = () => { setPanel(null); permisos.recargar(); if (vista === 'aliados') aliados.recargar(); };
  const todas = (permisos.datos ?? []).flatMap((p) => p.obligaciones.map((o) => ({ ...o, acto: p.acto })));
  const conFecha = todas.filter((o) => o.proximaFecha && !o.cumplida).sort((x, y) => x.proximaFecha!.localeCompare(y.proximaFecha!));
  const vencidas = conFecha.filter((o) => o.proximaFecha!.slice(0, 10) < hoyCo()).length;
  const prox30 = conFecha.filter((o) => { const d = diasEntre(hoyCo(), o.proximaFecha!.slice(0, 10)); return d >= 0 && d <= 30; }).length;
  const listaObl = filtroObl === 'proximas' ? conFecha.filter((o) => diasEntre(hoyCo(), o.proximaFecha!.slice(0, 10)) <= 90) : todas;

  const colsObl: Column<Obligacion & { acto: string }>[] = [
    { key: 'f', header: 'Fecha', render: (o) => <span className="flex flex-col"><span className="num">{fechaCorta(o.proximaFecha)}</span><Plazo o={o} /></span>, priority: 3 },
    { key: 'o', header: 'Obligación', render: (o) => <span className="block max-w-[380px]">{o.codigo && <span className="num mr-1.5 text-muted">{o.codigo}</span>}{o.descripcion}</span>, priority: 3 },
    { key: 'p', header: 'Permiso', render: (o) => <span className="block max-w-[200px] truncate text-muted">{o.acto}</span>, priority: 2 },
    { key: 'per', header: 'Periodicidad', render: (o) => o.periodicidad, priority: 1 },
    { key: 'u', header: 'Último cumplimiento', render: (o) => (o.cumplimientos[0] ? `${fechaCorta(o.cumplimientos[0].cumplidaEn)}${o.cumplimientos[0].radicado ? ` · ${o.cumplimientos[0].radicado}` : ''}` : '—'), priority: 1 },
  ];

  return (
    <>
      <PageHeader eyebrow="Cumplimiento" title="Permisos ambientales"
        subtitle="Actos que amparan los tratamientos de Los Pinos, sus obligaciones con fecha y los gestores aliados con su licencia. Una declaración solo se autoriza si su disposición está cubierta hoy."
        actions={puede ? <>
          <Button onClick={() => setPanel({ tipo: 'nuevoPermiso' })}><Plus size={16} /> Permiso o licencia propia</Button>
          <Button onClick={() => { setVista('aliados'); setPanel({ tipo: 'nuevoAliado' }); }}><Plus size={16} /> Gestor aliado</Button>
        </> : undefined} />
      {permisos.datos && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Card><p className="text-[12px] text-muted">Permisos</p><p className="num font-display text-2xl font-semibold">{permisos.datos.length}</p></Card>
          <Card><p className="text-[12px] text-muted">Obligaciones vencidas</p><p className={cx('num font-display text-2xl font-semibold', vencidas ? 'text-bad' : 'text-ok')}>{vencidas}</p></Card>
          <Card><p className="text-[12px] text-muted">Vencen en 30 días</p><p className={cx('num font-display text-2xl font-semibold', prox30 ? 'text-warn' : '')}>{prox30}</p></Card>
          <Card><p className="text-[12px] text-muted">Sellos ISO y báscula</p><button className="mt-1 text-[13px] text-brand underline" onClick={() => go('empresa')}>Datos de la empresa</button></Card>
        </div>
      )}
      <div className="mb-4"><Tabs value={vista} onChange={setVista} items={[{ value: 'permisos', label: 'Permisos' }, { value: 'obligaciones', label: 'Obligaciones', count: conFecha.length }, { value: 'aliados', label: 'Gestores aliados' }]} /></div>
      {permisos.error && <p className="rounded-xl bg-bad/10 p-4 text-bad">{permisos.error}</p>}
      {!permisos.datos && !permisos.error && <p className="p-6 text-center text-muted">Cargando…</p>}

      {vista === 'permisos' && permisos.datos && (
        <div className="grid gap-4 xl:grid-cols-2">
          {permisos.datos.map((p) => {
            const [etq, tono] = ESTADO_PERMISO[p.estado] ?? [p.estado, 'neutral'];
            const venceEn = p.vence ? diasEntre(hoyCo(), p.vence.slice(0, 10)) : null;
            const ampara = (p.estado === 'VIGENTE' || p.estado === 'POR_VENCER') && (venceEn === null || venceEn >= 0);
            return (
              <Card key={p.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3"><span className="rounded-xl bg-brand-soft p-2.5 text-brand-ink"><ShieldCheck size={20} /></span>
                    <div className="min-w-0"><p className="font-display text-[16px] font-semibold leading-tight">{p.acto}</p><p className="text-[13px] text-muted">{p.autoridad}{p.expedicion ? ` · expedido el ${fechaCorta(p.expedicion)}` : ''}</p></div></div>
                  <Badge tone={tono} dot>{etq}</Badge>
                </div>
                <p className="mt-3 text-[13px]">{p.alcance}</p>
                <p className={cx('mt-2 text-[13px]', venceEn !== null && venceEn <= 60 ? 'text-warn' : 'text-muted')}>
                  {p.vence ? `Vence el ${fechaCorta(p.vence)}${venceEn !== null ? (venceEn < 0 ? ` (venció hace ${-venceEn} días)` : ` (en ${venceEn} días)`) : ''}` : 'Sin fecha de vencimiento registrada'}
                  {!ampara && <span className="ml-1 font-medium text-bad">· Hoy no ampara sus disposiciones.</span>}
                </p>
                {p.disposiciones.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{p.disposiciones.map((d) => <Badge key={d.disposicion.codigo} tone={d.disposicion.activo ? 'brand' : 'neutral'}>{d.disposicion.codigo} · {d.disposicion.nombre}</Badge>)}</div>}
                <div className="mt-4 flex flex-col gap-2">
                  {p.obligaciones.map((o) => (
                    <div key={o.id} className={cx('flex flex-wrap items-start gap-x-3 gap-y-1 rounded-lg p-2.5 text-[13px]', o.proximaFecha && !o.cumplida && diasEntre(hoyCo(), o.proximaFecha.slice(0, 10)) <= 15 ? 'bg-bad/10' : 'bg-surface-2')}>
                      <CalendarClock size={16} className="mt-0.5 shrink-0 text-muted" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{o.codigo && <span className="num mr-1.5 text-muted">{o.codigo}</span>}{o.descripcion}</p>
                        <p className="text-muted">{o.periodicidad}{o.articulo ? ` · ${o.articulo}` : ''}{o.proximaFecha ? ` · ${fechaCorta(o.proximaFecha)}` : ''}</p>
                        {o.cumplimientos[0] && <p className="text-subtle">Último: {fechaCorta(o.cumplimientos[0].cumplidaEn)}{o.cumplimientos[0].radicado ? ` · radicado ${o.cumplimientos[0].radicado}` : ''} · {o.cumplimientos[0].usuario.nombre}</p>}
                      </div>
                      <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                        <Plazo o={o} />
                        {puede && !o.cumplida && <Button size="sm" onClick={() => setPanel({ tipo: 'cumplir', o, acto: p.acto })}><Check size={13} /> Registrar</Button>}
                        {o._count.cumplimientos > 0 && <Button size="sm" variant="ghost" onClick={() => setPanel({ tipo: 'historial', o, acto: p.acto })}><History size={13} /> {o._count.cumplimientos}</Button>}
                      </span>
                    </div>
                  ))}
                  {!p.obligaciones.length && <p className="text-[13px] text-muted">Sin obligaciones registradas.</p>}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {p.documentoUrl && <Button size="sm" onClick={() => verDocumento(`/permisos-ambientales/${p.id}/documento`).catch(() => undefined)}><FileText size={14} /> Ver el acto</Button>}
                  {puede && <Button size="sm" variant="ghost" onClick={() => setPanel({ tipo: 'permiso', p })}><Pencil size={13} /> Vigencia y documento</Button>}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {vista === 'obligaciones' && permisos.datos && (
        <>
          <div className="mb-3 flex gap-2"><Button size="sm" variant={filtroObl === 'proximas' ? 'primary' : 'secondary'} onClick={() => setFiltroObl('proximas')}>Vencidas y próximos 90 días</Button><Button size="sm" variant={filtroObl === 'todas' ? 'primary' : 'secondary'} onClick={() => setFiltroObl('todas')}>Todas ({todas.length})</Button></div>
          <ResponsiveTable rows={listaObl} columns={colsObl} rowKey={(o) => o.id} cardTitle={(o) => o.descripcion} cardBadge={(o) => <Plazo o={o} />}
            cardMeta={(o) => `${o.codigo ?? ''} ${o.acto} · ${fechaCorta(o.proximaFecha)}`} onRowClick={(o) => setPanel(puede && !o.cumplida ? { tipo: 'cumplir', o, acto: o.acto } : { tipo: 'historial', o, acto: o.acto })}
            empty="No hay obligaciones vencidas ni para los próximos 90 días." />
        </>
      )}

      {vista === 'aliados' && (aliados.error ? <p className="rounded-xl bg-bad/10 p-4 text-bad">{aliados.error}</p> : !aliados.datos ? <p className="p-6 text-center text-muted">Cargando…</p> : (
        <>
          {aliados.datos.some((x) => !x.vigencia.cubre && x.disposicionesGestionadas.some((d) => d.disposicion.activo)) && (
            <p className="mb-3 flex items-start gap-2 rounded-xl bg-warn/10 px-4 py-2.5 text-[13px] text-warn"><AlertTriangle size={16} className="mt-px shrink-0" />Hay gestores sin licencia vigente registrada: mientras tanto no se autorizan declaraciones de lo que gestionan. Registre la vigencia de la licencia (fecha o indefinida).</p>
          )}
          <ResponsiveTable rows={aliados.datos} rowKey={(x) => x.id} onRowClick={puede ? (x) => setPanel({ tipo: 'aliado', a: x }) : undefined}
            cardTitle={(x) => x.razonSocial} cardBadge={(x) => <Badge tone={LICENCIA[x.vigencia.estado][1]}>{LICENCIA[x.vigencia.estado][0]}</Badge>}
            cardMeta={(x) => `${x.disposicionesGestionadas.map((d) => d.disposicion.codigo).join(', ')} · ${x.licenciaVence ? `vence ${fechaCorta(x.licenciaVence)}` : x.licenciaIndefinida ? 'indefinida' : 'sin vigencia'}`}
            columns={[
              { key: 'rs', header: 'Gestor', render: (x) => <span className="flex flex-col"><span className="font-medium">{x.razonSocial}</span><span className="num text-[12px] text-muted">NIT {x.nit}</span></span>, priority: 3 },
              { key: 'g', header: 'Gestiona', render: (x) => <span className="flex flex-wrap gap-1">{x.disposicionesGestionadas.map((d) => <Badge key={d.disposicion.codigo} tone={d.disposicion.activo ? 'brand' : 'neutral'}>{d.disposicion.codigo}</Badge>)}</span>, priority: 3 },
              { key: 'l', header: 'Licencia', render: (x) => <span className="block max-w-[260px] text-[13px]">{x.licencia ?? '—'}{x.licenciaAutoridad ? <span className="text-muted"> · {x.licenciaAutoridad}</span> : null}</span>, priority: 2 },
              { key: 'v', header: 'Vigencia', render: (x) => (
                <span className="flex flex-col gap-0.5">
                  <Badge tone={LICENCIA[x.vigencia.estado][1]}>{LICENCIA[x.vigencia.estado][0]}</Badge>
                  <span className="text-[12px] text-muted">{x.licenciaVence ? `hasta ${fechaCorta(x.licenciaVence)}` : x.licenciaIndefinida ? 'sin término' : 'no cubre'}</span>
                </span>), priority: 3 },
              { key: 'e', header: 'No recibe', render: (x) => (x.excluyeTiposResiduo.length ? x.excluyeTiposResiduo.join(', ') : '—'), priority: 1 },
            ]} />
          {!puede && <p className="mt-2 text-[12px] text-muted">Para registrar la licencia de un gestor se necesita el permiso «permisos.gestionar» (HSEQ o Administración).</p>}
        </>
      ))}

      <Sheet open={!!panel} onClose={() => setPanel(null)} title={!panel ? '' : panel.tipo === 'cumplir' ? 'Registrar cumplimiento' : panel.tipo === 'historial' ? 'Historial de cumplimiento' : panel.tipo === 'permiso' ? 'Vigencia y documento del permiso'
        : panel.tipo === 'nuevoPermiso' ? 'Permiso o licencia propia' : panel.tipo === 'nuevoAliado' ? 'Gestor aliado nuevo' : 'Licencia del gestor aliado'}>
        {panel?.tipo === 'cumplir' && <FormCumplir o={panel.o} acto={panel.acto} listo={listo} />}
        {panel?.tipo === 'historial' && <HistorialObligacion o={panel.o} acto={panel.acto} />}
        {panel?.tipo === 'permiso' && <FormPermiso p={panel.p} listo={listo} />}
        {panel?.tipo === 'aliado' && <FormAliado x={panel.a} listo={listo} />}
        {panel?.tipo === 'nuevoPermiso' && <FormNuevoPermiso listo={listo} />}
        {panel?.tipo === 'nuevoAliado' && <FormNuevoAliado listo={listo} />}
      </Sheet>
    </>
  );
}

function FormCumplir({ o, acto, listo }: { o: Obligacion; acto: string; listo: () => void }) {
  const toast = useToast();
  const [v, setV] = useState({ cumplidaEn: hoyCo(), radicado: '', soporteUrl: '', nota: '' });
  const [enviando, setEnviando] = useState(false);
  const soporte = !!(v.radicado.trim() || v.soporteUrl.trim() || v.nota.trim().length >= 10);
  const guardar = async (e: FormEvent) => {
    e.preventDefault(); setEnviando(true);
    try {
      const r = await api<{ siguiente: string | null }>(`/obligaciones/${o.id}/cumplimientos`, { metodo: 'POST', cuerpo: v });
      toast(r.siguiente ? `Cumplimiento registrado. La próxima fecha es el ${fechaCorta(r.siguiente)}.` : 'Cumplimiento registrado.');
      listo();
    } catch (err) { toast(mensajeError(err, 'No se pudo registrar.'), 'warn'); }
    setEnviando(false);
  };
  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      <div className="rounded-lg bg-surface-2 p-3 text-[13px]"><p className="font-medium">{o.codigo && <span className="num mr-1.5 text-muted">{o.codigo}</span>}{o.descripcion}</p><p className="text-muted">{acto} · {o.periodicidad}{o.proximaFecha ? ` · programada el ${fechaCorta(o.proximaFecha)}` : ''}</p></div>
      <Field label="Fecha en que se cumplió" id="oc-f"><Input id="oc-f" type="date" max={hoyCo()} value={v.cumplidaEn} onChange={(e) => setV((x) => ({ ...x, cumplidaEn: e.target.value }))} required /></Field>
      <Field label="Radicado ante la autoridad" id="oc-r" hint="Número o consecutivo con que la CAS recibió el informe."><Input id="oc-r" value={v.radicado} maxLength={80} onChange={(e) => setV((x) => ({ ...x, radicado: e.target.value }))} /></Field>
      <Field label="Enlace al soporte" id="oc-u" hint="Oficio, informe o constancia (enlace de Drive, por ejemplo)."><Input id="oc-u" type="url" value={v.soporteUrl} maxLength={500} onChange={(e) => setV((x) => ({ ...x, soporteUrl: e.target.value }))} placeholder="https://" /></Field>
      <Field label="Nota" id="oc-n"><Input id="oc-n" value={v.nota} maxLength={500} onChange={(e) => setV((x) => ({ ...x, nota: e.target.value }))} /></Field>
      {!soporte && <p className="text-[12px] text-muted">Indique el radicado, el enlace al soporte o una nota de al menos 10 caracteres: queda como evidencia y no se puede borrar.</p>}
      <div className="flex justify-end border-t border-line pt-3"><Button type="submit" variant="primary" disabled={!soporte || enviando}>{enviando && <Loader2 size={16} className="animate-spin" />}Registrar cumplimiento</Button></div>
    </form>
  );
}

function HistorialObligacion({ o, acto }: { o: Obligacion; acto: string }) {
  const h = useApi<{ cumplimientos: Cumplimiento[] }>(`/obligaciones/${o.id}/cumplimientos`);
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg bg-surface-2 p-3 text-[13px]"><p className="font-medium">{o.codigo && <span className="num mr-1.5 text-muted">{o.codigo}</span>}{o.descripcion}</p><p className="text-muted">{acto} · {o.periodicidad}</p></div>
      {h.error && <p className="text-bad">{h.error}</p>}
      {!h.datos && !h.error && <p className="flex items-center gap-2 text-muted"><Loader2 size={16} className="animate-spin" />Cargando…</p>}
      {h.datos && !h.datos.cumplimientos.length && <p className="text-muted">Todavía no tiene cumplimientos registrados.</p>}
      <ul className="flex flex-col gap-2">{h.datos?.cumplimientos.map((c) => (
        <li key={c.id} className="rounded-xl border border-line p-3 text-[13px]">
          <p className="font-medium">Cumplida el {fechaCorta(c.cumplidaEn)}{c.fechaProgramada ? <span className="font-normal text-muted"> · programada el {fechaCorta(c.fechaProgramada)}</span> : null}</p>
          {c.radicado && <p>Radicado: <span className="num">{c.radicado}</span></p>}
          {c.soporteUrl && <a className="inline-flex items-center gap-1 text-brand underline" href={c.soporteUrl} target="_blank" rel="noreferrer"><ExternalLink size={12} /> Soporte</a>}
          {c.nota && <p className="text-muted">{c.nota}</p>}
          <p className="text-subtle">Registró: {c.usuario.nombre}</p>
        </li>))}
      </ul>
      <p className="text-[12px] text-muted">El historial no se modifica ni se borra: es el soporte ante la autoridad ambiental.</p>
    </div>
  );
}

function FormPermiso({ p, listo }: { p: Permiso; listo: () => void }) {
  const toast = useToast();
  const guardado = !!p.documentoUrl && !/^https?:/.test(p.documentoUrl);
  const [v, setV] = useState({ expedicion: p.expedicion?.slice(0, 10) ?? '', vence: p.vence?.slice(0, 10) ?? '', estado: p.estado, documentoUrl: guardado ? '' : p.documentoUrl ?? '' });
  const [archivo, setArchivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const guardar = async (e: FormEvent) => {
    e.preventDefault(); setEnviando(true);
    try {
      const { documentoUrl, ...resto } = v;
      await api(`/permisos-ambientales/${p.id}`, { metodo: 'PATCH', cuerpo: { ...resto, ...(guardado && !documentoUrl ? {} : { documentoUrl }) } });
      if (archivo) await subirPdf(`/permisos-ambientales/${p.id}/documento`, archivo);
      toast(archivo ? 'Permiso actualizado, con su PDF.' : 'Permiso actualizado.'); listo();
    }
    catch (err) { toast(mensajeError(err, 'No se pudo guardar.'), 'warn'); }
    setEnviando(false);
  };
  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      <p className="font-medium">{p.acto}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Expedición" id="pp-e"><Input id="pp-e" type="date" value={v.expedicion} onChange={(e) => setV((x) => ({ ...x, expedicion: e.target.value }))} /></Field>
        <Field label="Vence" id="pp-v" hint="Vacío si el acto no fija término."><Input id="pp-v" type="date" value={v.vence} onChange={(e) => setV((x) => ({ ...x, vence: e.target.value }))} /></Field>
      </div>
      <Field label="Estado" id="pp-s"><Select id="pp-s" value={v.estado} onChange={(e) => setV((x) => ({ ...x, estado: e.target.value }))}>{Object.entries(ESTADO_PERMISO).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
      <ElegirPdf id="pp-pdf" archivo={archivo} onChange={setArchivo} actual={p.documentoUrl} />
      {!guardado && <Field label="O un enlace al acto (si está publicado)" id="pp-d"><Input id="pp-d" type="url" value={v.documentoUrl} onChange={(e) => setV((x) => ({ ...x, documentoUrl: e.target.value }))} placeholder="https://" /></Field>}
      <p className="text-[12px] text-muted">Ampara sus disposiciones mientras esté «vigente» o «por vencer» y no haya pasado la fecha de vencimiento. «En trámite» o «vencido» no amparan: no se autorizan declaraciones con esas disposiciones.</p>
      <div className="flex justify-end border-t border-line pt-3"><Button type="submit" variant="primary" disabled={enviando}>{enviando && <Loader2 size={16} className="animate-spin" />}Guardar</Button></div>
    </form>
  );
}

function FormAliado({ x, listo }: { x: Aliado; listo: () => void }) {
  const toast = useToast();
  const tipos = useApi<{ tiposResiduo: { codigo: string; nombre: string }[]; disposiciones: DisposicionCat[] }>('/declaraciones/catalogos');
  const guardado = !!x.licenciaUrl && !/^https?:/.test(x.licenciaUrl);
  const [v, setV] = useState({ razonSocial: x.razonSocial, municipio: x.municipio ?? '', licencia: x.licencia ?? '', licenciaAutoridad: x.licenciaAutoridad ?? '', licenciaIndefinida: x.licenciaIndefinida,
    licenciaVence: x.licenciaVence?.slice(0, 10) ?? '', licenciaUrl: guardado ? '' : x.licenciaUrl ?? '', excluyeTiposResiduo: x.excluyeTiposResiduo, disposiciones: x.disposicionesGestionadas.map((d) => d.disposicion.codigo) });
  const [archivo, setArchivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const guardar = async (e: FormEvent) => {
    e.preventDefault(); setEnviando(true);
    try {
      const { licenciaUrl, ...resto } = v;
      const r = await api<{ vigencia: Aliado['vigencia'] }>(`/gestores-aliados/${x.id}`, { metodo: 'PATCH', cuerpo: { ...resto, ...(guardado && !licenciaUrl ? {} : { licenciaUrl }), licenciaVence: v.licenciaIndefinida ? '' : v.licenciaVence } });
      if (archivo) await subirPdf(`/gestores-aliados/${x.id}/licencia`, archivo);
      toast(r.vigencia.cubre ? `Licencia guardada: ${x.razonSocial} cubre sus disposiciones.` : `Licencia guardada, pero ${x.razonSocial} todavía no cubre: falta una vigencia actual.`, r.vigencia.cubre ? undefined : 'warn');
      listo();
    } catch (err) { toast(mensajeError(err, 'No se pudo guardar.'), 'warn'); }
    setEnviando(false);
  };
  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      <p className="text-[13px] text-muted">NIT {x.nit}{x.licenciaUrl && <> · <button type="button" className="font-medium text-brand underline" onClick={() => verDocumento(`/gestores-aliados/${x.id}/licencia`).catch(() => undefined)}>ver la licencia</button></>}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Razón social" id="ga-r"><Input id="ga-r" value={v.razonSocial} maxLength={200} onChange={(e) => setV((s) => ({ ...s, razonSocial: e.target.value }))} /></Field>
        <Field label="Municipio de la planta" id="ga-m"><Input id="ga-m" value={v.municipio} maxLength={80} onChange={(e) => setV((s) => ({ ...s, municipio: e.target.value }))} /></Field>
      </div>
      <ElegirDisposiciones opciones={(tipos.datos?.disposiciones ?? []).filter((d) => !d.propia)} elegidas={v.disposiciones} onChange={(c) => setV((s) => ({ ...s, disposiciones: c }))} />
      <Field label="Licencia (acto, número y fecha)" id="ga-l"><Input id="ga-l" value={v.licencia} maxLength={300} onChange={(e) => setV((s) => ({ ...s, licencia: e.target.value }))} /></Field>
      <Field label="Autoridad que la expidió" id="ga-a"><Input id="ga-a" value={v.licenciaAutoridad} maxLength={80} onChange={(e) => setV((s) => ({ ...s, licenciaAutoridad: e.target.value }))} placeholder="CDMB, Corpocesar, CAR…" /></Field>
      <label className="flex items-start gap-2 text-[13px]"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--brand))]" checked={v.licenciaIndefinida} onChange={(e) => setV((s) => ({ ...s, licenciaIndefinida: e.target.checked, licenciaVence: e.target.checked ? '' : s.licenciaVence }))} />
        <span>Licencia sin término (vida útil del proyecto)</span></label>
      {!v.licenciaIndefinida && <Field label="Vence" id="ga-v" hint="Sin esta fecha (o «sin término») el gestor no cubre: no se autorizan declaraciones de lo que gestiona."><Input id="ga-v" type="date" value={v.licenciaVence} onChange={(e) => setV((s) => ({ ...s, licenciaVence: e.target.value }))} /></Field>}
      <ElegirPdf id="ga-pdf" archivo={archivo} onChange={setArchivo} actual={x.licenciaUrl} />
      {!guardado && <Field label="O un enlace a la licencia (si está publicada)" id="ga-u"><Input id="ga-u" type="url" value={v.licenciaUrl} onChange={(e) => setV((s) => ({ ...s, licenciaUrl: e.target.value }))} placeholder="https://" /></Field>}
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-[13px] font-medium">Tipos de residuo que no recibe</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">{(tipos.datos?.tiposResiduo ?? []).map((t) => (
          <label key={t.codigo} className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--brand))]" checked={v.excluyeTiposResiduo.includes(t.codigo)}
            onChange={(e) => setV((s) => ({ ...s, excluyeTiposResiduo: e.target.checked ? [...s.excluyeTiposResiduo, t.codigo] : s.excluyeTiposResiduo.filter((c) => c !== t.codigo) }))} />{t.nombre}</label>))}
        </div>
      </fieldset>
      <div className="flex justify-end border-t border-line pt-3"><Button type="submit" variant="primary" disabled={enviando}>{enviando && <Loader2 size={16} className="animate-spin" />}Guardar licencia</Button></div>
    </form>
  );
}

/**
 * Permiso o licencia propia nuevo: una renovación, una modificación o una licencia nueva de Los Pinos (p. ej. la de celda
 * de seguridad, autoclave y biorremediación). Ampara los tratamientos que se marquen mientras esté vigente.
 */
function FormNuevoPermiso({ listo }: { listo: () => void }) {
  const toast = useToast();
  const cat = useApi<{ disposiciones: DisposicionCat[] }>('/declaraciones/catalogos');
  const [v, setV] = useState({ acto: '', autoridad: 'CAS', alcance: '', expedicion: '', vence: '', estado: 'VIGENTE', disposiciones: [] as string[] });
  const [archivo, setArchivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const guardar = async (e: FormEvent) => {
    e.preventDefault(); setEnviando(true);
    try {
      const p = await api<{ id: string }>('/permisos-ambientales', { cuerpo: v });
      if (archivo) await subirPdf(`/permisos-ambientales/${p.id}/documento`, archivo);
      toast(`Registrado «${v.acto}»${v.disposiciones.length ? `: ampara ${v.disposiciones.join(', ')} mientras esté vigente` : ''}.`, 'ok'); listo();
    } catch (err) { toast(mensajeError(err, 'No se pudo registrar.'), 'warn'); }
    setEnviando(false);
  };
  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      <p className="text-[13px] text-muted">Para una licencia o permiso nuevo de Terra Viva: una renovación, una modificación o una licencia nueva (por ejemplo, la de celda de seguridad, autoclave y biorremediación). Los certificados lo citan en las líneas de los tratamientos que ampare, mientras esté vigente.</p>
      <Field label="Acto (tipo, número y año)" id="np-a"><Input id="np-a" value={v.acto} onChange={set('acto')} maxLength={60} required placeholder="Resolución DGL No. 000123 de 2027" /></Field>
      <Field label="Autoridad que lo expidió" id="np-au"><Input id="np-au" value={v.autoridad} onChange={set('autoridad')} maxLength={80} required placeholder="CAS, ANLA, CDMB…" /></Field>
      <Field label="Qué autoriza" id="np-al"><textarea id="np-al" value={v.alcance} onChange={set('alcance')} maxLength={4000} required className="min-h-[90px] w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" /></Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Expedición" id="np-e"><Input id="np-e" type="date" value={v.expedicion} onChange={set('expedicion')} /></Field>
        <Field label="Vence" id="np-v" hint="Vacío si no fija término."><Input id="np-v" type="date" value={v.vence} onChange={set('vence')} /></Field>
        <Field label="Estado" id="np-s"><Select id="np-s" value={v.estado} onChange={set('estado')}>{Object.entries(ESTADO_PERMISO).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
      </div>
      <ElegirDisposiciones opciones={cat.datos?.disposiciones ?? []} elegidas={v.disposiciones} onChange={(c) => setV((s) => ({ ...s, disposiciones: c }))} />
      <ElegirPdf id="np-pdf" archivo={archivo} onChange={setArchivo} />
      <div className="flex justify-end border-t border-line pt-3"><Button type="submit" variant="primary" disabled={enviando}>{enviando && <Loader2 size={16} className="animate-spin" />}Registrar</Button></div>
    </form>
  );
}

/** Gestor aliado nuevo: la planta de un tercero, su licencia (con su PDF) y los tratamientos que hace. */
function FormNuevoAliado({ listo }: { listo: () => void }) {
  const toast = useToast();
  const cat = useApi<{ disposiciones: DisposicionCat[] }>('/declaraciones/catalogos');
  const [v, setV] = useState({ nit: '', razonSocial: '', municipio: '', licencia: '', licenciaAutoridad: '', licenciaIndefinida: false, licenciaVence: '', alcance: '', disposiciones: [] as string[] });
  const [archivo, setArchivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const set = (k: 'nit' | 'razonSocial' | 'municipio' | 'licencia' | 'licenciaAutoridad' | 'licenciaVence' | 'alcance') => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const guardar = async (e: FormEvent) => {
    e.preventDefault(); setEnviando(true);
    try {
      const r = await api<{ id: string; vigencia: Aliado['vigencia'] }>('/gestores-aliados', { cuerpo: { ...v, licenciaVence: v.licenciaIndefinida ? '' : v.licenciaVence } });
      if (archivo) await subirPdf(`/gestores-aliados/${r.id}/licencia`, archivo);
      toast(r.vigencia.cubre ? `${v.razonSocial} quedó registrado y cubre lo que gestiona.` : `${v.razonSocial} quedó registrado, pero aún no cubre: falta una vigencia actual.`, r.vigencia.cubre ? 'ok' : 'warn'); listo();
    } catch (err) { toast(mensajeError(err, 'No se pudo registrar.'), 'warn'); }
    setEnviando(false);
  };
  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="NIT" id="na-n"><Input id="na-n" value={v.nit} onChange={set('nit')} maxLength={15} required placeholder="900123456-7" /></Field>
        <Field label="Municipio de la planta" id="na-m"><Input id="na-m" value={v.municipio} onChange={set('municipio')} maxLength={80} /></Field>
      </div>
      <Field label="Razón social" id="na-r"><Input id="na-r" value={v.razonSocial} onChange={set('razonSocial')} maxLength={200} required /></Field>
      <Field label="Licencia (acto, número, fecha y modificaciones)" id="na-l"><Input id="na-l" value={v.licencia} onChange={set('licencia')} maxLength={300} required /></Field>
      <Field label="Autoridad que la expidió" id="na-a"><Input id="na-a" value={v.licenciaAutoridad} onChange={set('licenciaAutoridad')} maxLength={80} required placeholder="CDMB, Corpocesar, ANLA…" /></Field>
      <label className="flex items-start gap-2 text-[13px]"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--brand))]" checked={v.licenciaIndefinida} onChange={(e) => setV((s) => ({ ...s, licenciaIndefinida: e.target.checked, licenciaVence: e.target.checked ? '' : s.licenciaVence }))} />
        <span>Licencia sin término (vida útil del proyecto)</span></label>
      {!v.licenciaIndefinida && <Field label="Vence" id="na-v" hint="Sin esta fecha (o «sin término») el gestor no cubre."><Input id="na-v" type="date" value={v.licenciaVence} onChange={set('licenciaVence')} /></Field>}
      <ElegirDisposiciones opciones={(cat.datos?.disposiciones ?? []).filter((d) => !d.propia)} elegidas={v.disposiciones} onChange={(c) => setV((s) => ({ ...s, disposiciones: c }))} />
      <Field label="Qué recibe y qué no (opcional)" id="na-al"><textarea id="na-al" value={v.alcance} onChange={set('alcance')} maxLength={4000} className="min-h-[70px] w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" /></Field>
      <ElegirPdf id="na-pdf" archivo={archivo} onChange={setArchivo} />
      <div className="flex justify-end border-t border-line pt-3"><Button type="submit" variant="primary" disabled={enviando}>{enviando && <Loader2 size={16} className="animate-spin" />}Registrar gestor</Button></div>
    </form>
  );
}
