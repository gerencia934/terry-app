// Torre de control: certificados (actas). Solo certifican líneas de conciliaciones aprobadas; cada acta emitida lleva un QR
// que abre la página pública de verificación. Descarga masiva en ZIP y cargue de actas de gestores aliados.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Award, Ban, Copy, Download, ExternalLink, FilePlus2, FileUp, RefreshCw, Send, Trash2 } from 'lucide-react';
import { FilterBar, ResponsiveTable, type Column } from '../../components/data';
import { Badge, Button, DefList, EstadoBadge, Field, Input, PageHeader, Select, Sheet, useToast } from '../../components/ui';
import { api, tienePermiso } from '../../lib/api';
import { cx, fmtFecha, fmtFechaCorta } from '../../lib/format';
import { bajarArchivo, cant, fechaHoraCo, hoyCo, msg, useApi, verPdf } from '../../lib/servidor';
import { useCatalogos, useClientes, type ClienteRef, type Destino } from './comun';

type TipoActa = 'DISPOSICION' | 'APROVECHAMIENTO' | 'CONCILIACION';
const TIPOS: Record<TipoActa, string> = { DISPOSICION: 'Tratamiento y disposición final', APROVECHAMIENTO: 'Aprovechamiento', CONCILIACION: 'Conciliación de residuos' };
interface ActaFila {
  id: string; numero: string; tipo: TipoActa; origen: 'GENERADA' | 'CARGADA'; estado: 'BORRADOR' | 'EMITIDA' | 'ANULADA'; periodoDesde: string; periodoHasta: string;
  emitidaEn: string | null; cliente: { razonSocial: string }; destino: { razonSocial: string }; emitidaPor: { nombre: string } | null; _count: { items: number };
  generadorNit: string | null; generadorNombre: string | null;
}
interface ActaDetalle extends Omit<ActaFila, '_count' | 'cliente' | 'destino'> {
  codigoVerificacion: string; urlVerificacion: string; motivoAnulacion: string | null; anuladaEn: string | null; pdfSha256: string | null;
  cliente: { razonSocial: string; nit: string }; destino: { razonSocial: string }; cargadaPor: { nombre: string } | null;
  items: { id: string; cantidadConciliada: string | null; metrica: { abreviacion: string } | null; disposicion: { nombre: string } | null;
    conciliacion: { manifiesto: { numero: string; fechaServicio: string } };
    manifiestoItem: { declaracion: { nombre: string }; sucursal: { nombre: string }; metrica: { abreviacion: string } | null } }[];
}
interface Pendiente { id: string; manifiesto: string; fechaServicio: string; residuo: string; sede: string; cantidad: string | null; unidad: string | null; tratamiento: string | null }

const mesAnterior = () => { const h = hoyCo(); const [y, m] = h.split('-').map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); const f = new Date(Date.UTC(y, m - 1, 0)); return { desde: d.toISOString().slice(0, 10), hasta: f.toISOString().slice(0, 10) }; };

export function ActasServidor() {
  const toast = useToast();
  const clientes = useClientes();
  const base = { clienteId: '', estado: '', numero: '', desde: '', hasta: '' };
  const [f, setF] = useState(base);
  const [num, setNum] = useState('');
  const lista = useApi<{ total: number; filas: ActaFila[] }>(`/actas?${new URLSearchParams({ porPagina: '300', ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) })}`);
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<string | null>(null);
  const [nueva, setNueva] = useState<'generar' | 'cargar' | null>(null);
  const emite = tienePermiso('actas.emitir');
  const activos = Object.values(f).filter(Boolean).length;
  const filas = lista.datos?.filas ?? [];
  const descargables = filas.filter((a) => elegidas.has(a.id) && a.estado !== 'BORRADOR');
  const zip = async () => {
    try { await bajarArchivo(`/actas/zip?ids=${descargables.map((a) => a.id).join(',')}`, `actas-${hoyCo()}.zip`); } catch (e) { toast(msg(e), 'warn'); }
  };
  const cols: Column<ActaFila>[] = [
    { key: 'num', header: 'Número', render: (a) => <span className="num font-medium">{a.numero}</span>, priority: 3 },
    { key: 'tipo', header: 'Tipo', render: (a) => TIPOS[a.tipo], priority: 2 },
    { key: 'cli', header: 'Cliente', render: (a) => <span className="block max-w-[220px] truncate">{a.generadorNombre ? <>{a.generadorNombre} <span className="text-muted">· vía {a.cliente.razonSocial}</span></> : a.cliente.razonSocial}</span>, priority: 3 },
    { key: 'dest', header: 'Gestor', render: (a) => <span className="block max-w-[180px] truncate">{a.destino.razonSocial}{a.origen === 'CARGADA' && <Badge tone="info">aliado</Badge>}</span>, priority: 3 },
    { key: 'per', header: 'Periodo', render: (a) => <span className="num">{fmtFechaCorta(a.periodoDesde)} – {fmtFechaCorta(a.periodoHasta)}</span>, priority: 1 },
    { key: 'lin', header: 'Líneas', align: 'right', render: (a) => a._count.items, priority: 3 },
    { key: 'emi', header: 'Emitida', render: (a) => (a.emitidaEn ? fechaHoraCo(a.emitidaEn) : '—'), priority: 3 },
    { key: 'est', header: 'Estado', render: (a) => <EstadoBadge estado={a.estado} />, priority: 3 },
  ];
  return (
    <>
      <PageHeader eyebrow="Planta Los Pinos" title="Certificados" subtitle="Actas de tratamiento, disposición final y aprovechamiento. Solo incluyen líneas de conciliaciones aprobadas y llevan un código QR para verificar su autenticidad."
        actions={<>
          {emite && <Button variant="primary" onClick={() => setNueva('generar')}><FilePlus2 size={16} /> Nueva acta</Button>}
          {emite && <Button onClick={() => setNueva('cargar')}><FileUp size={16} /> Cargar acta de aliado</Button>}
          <Button onClick={lista.recargar}><RefreshCw size={16} /> Actualizar</Button>
        </>} />
      <FilterBar active={activos} onClear={() => { setF(base); setNum(''); }}>
        <Field label="Cliente" id="ac-c"><Select id="ac-c" value={f.clienteId} onChange={(e) => setF((s) => ({ ...s, clienteId: e.target.value }))}><option value="">Todos</option>{clientes?.map((c) => <option key={c.id} value={c.id}>{c.razonSocial}</option>)}</Select></Field>
        <Field label="Estado" id="ac-e"><Select id="ac-e" value={f.estado} onChange={(e) => setF((s) => ({ ...s, estado: e.target.value }))}><option value="">Todos</option><option value="BORRADOR">Borrador</option><option value="EMITIDA">Emitidas</option><option value="ANULADA">Anuladas</option></Select></Field>
        <Field label="Periodo desde" id="ac-d"><Input id="ac-d" type="date" value={f.desde} onChange={(e) => setF((s) => ({ ...s, desde: e.target.value }))} /></Field>
        <Field label="Hasta" id="ac-h"><Input id="ac-h" type="date" value={f.hasta} onChange={(e) => setF((s) => ({ ...s, hasta: e.target.value }))} /></Field>
        <Field label="Número" id="ac-n"><Input id="ac-n" value={num} onChange={(e) => setNum(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setF((s) => ({ ...s, numero: num.trim() }))} onBlur={() => setF((s) => ({ ...s, numero: num.trim() }))} placeholder="ACT-…" /></Field>
      </FilterBar>
      {elegidas.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand/40 bg-brand-soft/40 px-4 py-2.5 text-sm">
          <span><b className="num">{elegidas.size}</b> {elegidas.size === 1 ? 'elegida' : 'elegidas'}{descargables.length < elegidas.size ? ` (${elegidas.size - descargables.length} en borrador no tienen PDF)` : ''}</span>
          <div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => setElegidas(new Set())}>Limpiar</Button><Button size="sm" variant="primary" disabled={!descargables.length} onClick={zip}><Download size={15} /> Descargar {descargables.length} en ZIP</Button></div>
        </div>
      )}
      {lista.error ? <p className="rounded-xl bg-bad/10 p-4 text-bad">{lista.error}</p>
        : !lista.datos ? <p className="p-6 text-center text-muted">Cargando…</p>
        : <ResponsiveTable rows={filas} columns={cols} rowKey={(a) => a.id} onRowClick={(a) => setSel(a.id)} selectable selected={elegidas} onSelectedChange={setElegidas}
            cardTitle={(a) => <span className="num">{a.numero}</span>} cardBadge={(a) => <EstadoBadge estado={a.estado} />} cardMeta={(a) => `${a.cliente.razonSocial} · ${TIPOS[a.tipo]}`}
            empty="No hay actas con estos filtros. Cree una con «Nueva acta» cuando haya conciliaciones aprobadas." />}
      <DetalleActa id={sel} onClose={() => setSel(null)} onCambio={lista.recargar} />
      {emite && <NuevaActa modo={nueva} clientes={clientes ?? []} onClose={() => setNueva(null)} onListo={(id) => { setNueva(null); lista.recargar(); setSel(id); }} />}
    </>
  );
}

function DetalleActa({ id, onClose, onCambio }: { id: string | null; onClose: () => void; onCambio: () => void }) {
  const toast = useToast();
  const d = useApi<ActaDetalle>(id ? `/actas/${id}` : null);
  const [anular, setAnular] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [quitar, setQuitar] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { setAnular(false); setMotivo(''); setQuitar(null); }, [id]);
  const a = id && d.datos?.id === id ? d.datos : null;
  const emite = tienePermiso('actas.emitir');
  const hacer = async (fn: () => Promise<unknown>, ok: string) => {
    setOcupado(true);
    try { await fn(); toast(ok); d.recargar(); onCambio(); } catch (e) { toast(msg(e), 'warn'); } finally { setOcupado(false); }
  };
  const copiar = async () => { if (!a) return; try { await navigator.clipboard.writeText(a.urlVerificacion); toast('Enlace de verificación copiado.'); } catch { toast(a.urlVerificacion, 'info'); } };
  const pdf = (descargar: boolean) => a && (descargar ? bajarArchivo(`/actas/${a.id}/pdf`, `${a.numero}.pdf`) : verPdf(`/actas/${a.id}/pdf`)).catch((e) => toast(msg(e), 'warn'));
  const totales = useMemo(() => {
    const m = new Map<string, number>();
    a?.items.forEach((i) => { const u = i.metrica?.abreviacion ?? i.manifiestoItem.metrica?.abreviacion ?? 'sin unidad'; m.set(u, (m.get(u) ?? 0) + Number(i.cantidadConciliada ?? 0)); });
    return [...m.entries()];
  }, [a]);

  return (
    <Sheet open={!!id} onClose={onClose} title={a ? <span>Acta <span className="num">{a.numero}</span></span> : 'Acta'}
      footer={a && (anular
        ? <><Button onClick={() => setAnular(false)}>Volver</Button><Button variant="danger" disabled={ocupado || motivo.trim().length < 5} onClick={() => hacer(async () => { await api(`/actas/${a.id}/anular`, { cuerpo: { motivo: motivo.trim() } }); setAnular(false); }, `Acta ${a.numero} anulada.`)}><Ban size={16} /> Anular</Button></>
        : <>
            {a.estado === 'BORRADOR' && emite && <Button variant="primary" disabled={ocupado || !a.items.length} onClick={() => hacer(() => api(`/actas/${a.id}/emitir`, { cuerpo: {} }), `Acta ${a.numero} emitida con su PDF y código QR.`)}><Send size={16} /> Emitir</Button>}
            {a.estado !== 'BORRADOR' && <><Button onClick={() => pdf(false)}><ExternalLink size={16} /> Ver PDF</Button><Button onClick={() => pdf(true)}><Download size={16} /> Descargar</Button></>}
            {a.estado !== 'ANULADA' && emite && <Button variant="ghost" onClick={() => setAnular(true)}><Ban size={16} /> Anular</Button>}
          </>)}>
      {d.error && <p className="rounded-lg bg-bad/10 p-3 text-bad">{d.error}</p>}
      {!a ? !d.error && <p className="p-6 text-center text-muted">Cargando…</p> : anular ? (
        <div className="flex flex-col gap-4">
          <p className="rounded-lg bg-warn/10 p-3 text-[13px] text-warn">El acta quedará ANULADA y así lo mostrará la verificación pública del QR. Sus líneas quedan libres para certificarse en otra acta.</p>
          <Field label="Motivo de la anulación" id="aa-m" hint="Mínimo 5 caracteres"><Input id="aa-m" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} /></Field>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <DefList items={[
            ['Estado', <EstadoBadge estado={a.estado} />],
            ['Documento', `${TIPOS[a.tipo]}${a.origen === 'CARGADA' ? ' · cargada de un gestor aliado' : ''}`],
            ...(a.generadorNombre ? [['Generador', `${a.generadorNombre} · NIT ${a.generadorNit}`]] as [string, string][] : []),
            [a.generadorNombre ? 'Gestor (cliente)' : 'Cliente', `${a.cliente.razonSocial} · NIT ${a.cliente.nit}`],
            ['Gestor', a.destino.razonSocial],
            ['Periodo', `${fmtFecha(a.periodoDesde)} a ${fmtFecha(a.periodoHasta)}`],
            ...(a.emitidaEn ? [['Emitida', `${fechaHoraCo(a.emitidaEn)}${a.emitidaPor ? ` · ${a.emitidaPor.nombre}` : ''}`]] as [string, string][] : []),
            ...(a.cargadaPor ? [['Cargada por', a.cargadaPor.nombre]] as [string, string][] : []),
            ...(a.pdfSha256 ? [['Huella del PDF (SHA-256)', <span className="num break-all text-[11px]">{a.pdfSha256}</span>]] as [string, React.ReactNode][] : []),
            ...(a.estado === 'ANULADA' ? [['Anulación', `${fechaHoraCo(a.anuladaEn)} · ${a.motivoAnulacion ?? ''}`]] as [string, string][] : []),
            ...(a.estado !== 'BORRADOR' ? [['Verificación', <span className="flex flex-wrap items-center gap-2"><span className="num text-[12px]">{a.codigoVerificacion}</span>
              <Button size="sm" variant="ghost" onClick={copiar}><Copy size={14} /> Copiar enlace</Button>
              <a href={a.urlVerificacion} target="_blank" rel="noreferrer" className="text-[13px] font-medium text-brand underline">Abrir</a></span>]] as [string, React.ReactNode][] : []),
          ]} />
          {a.estado === 'BORRADOR' && <p className="rounded-lg bg-info/10 px-3 py-2 text-[13px] text-info">Revise las líneas y emita: al emitir se guarda una copia fija con el soporte legal vigente a la fecha de cada servicio y se genera el PDF con QR.</p>}
          <section className="flex flex-col gap-2">
            <h3 className="text-[13px] font-semibold uppercase tracking-[0.05em] text-muted">Lo que certifica ({a.items.length})</h3>
            {totales.length > 0 && <p className="num text-sm">{totales.map(([u, v]) => `${cant(v)} ${u}`).join(' · ')}</p>}
            {a.items.map((i) => (
              <div key={i.id} className="flex items-start justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[13px]">
                <div className="min-w-0">
                  <p className="truncate font-medium">{i.manifiestoItem.declaracion.nombre}</p>
                  <p className="truncate text-muted">{i.conciliacion.manifiesto.numero} · {fmtFechaCorta(i.conciliacion.manifiesto.fechaServicio)} · {i.manifiestoItem.sucursal.nombre}{i.disposicion ? ` · ${i.disposicion.nombre}` : ''}</p>
                </div>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="num font-medium">{cant(i.cantidadConciliada)} {i.metrica?.abreviacion ?? i.manifiestoItem.metrica?.abreviacion ?? ''}</span>
                  {a.estado === 'BORRADOR' && emite && (quitar === i.id
                    ? <><Button size="sm" variant="danger" disabled={ocupado} onClick={() => hacer(() => api(`/actas/${a.id}/items`, { cuerpo: { quitar: [i.id] } }), 'Línea quitada del acta.')}>Quitar</Button><Button size="sm" variant="ghost" onClick={() => setQuitar(null)}>No</Button></>
                    : <Button size="sm" variant="ghost" aria-label="Quitar la línea del acta" onClick={() => setQuitar(i.id)}><Trash2 size={14} /></Button>)}
                </span>
              </div>
            ))}
            {!a.items.length && <p className="text-[13px] text-subtle">{a.origen === 'CARGADA' ? 'El acta del aliado se cargó sin relacionar líneas.' : 'Sin líneas: agregue líneas o anule el borrador.'}</p>}
          </section>
        </div>
      )}
    </Sheet>
  );
}

/** Nueva acta generada por TERRY-GO (borrador con las líneas aprobadas elegidas) o acta de un gestor aliado (PDF). */
function NuevaActa({ modo, clientes, onClose, onListo }: { modo: 'generar' | 'cargar' | null; clientes: ClienteRef[]; onClose: () => void; onListo: (id: string) => void }) {
  const toast = useToast();
  const cat = useCatalogos();
  const [f, setF] = useState(() => ({ clienteId: '', tipo: 'DISPOSICION' as TipoActa, destinoId: '', ...mesAnterior() }));
  const [porGenerador, setPorGenerador] = useState(true);
  const gestor = clientes.find((c) => c.id === f.clienteId)?.tipo === 'GESTOR';
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const [archivo, setArchivo] = useState<File | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const cargar = modo === 'cargar';
  useEffect(() => { if (modo) { setF({ clienteId: '', tipo: 'DISPOSICION', destinoId: '', ...mesAnterior() }); setArchivo(null); } }, [modo]);
  const pend = useApi<Pendiente[]>(modo && f.clienteId && f.desde && f.hasta ? `/actas/pendientes?clienteId=${f.clienteId}&desde=${f.desde}&hasta=${f.hasta}` : null);
  // En una acta generada se proponen todas las líneas; en una cargada, ninguna (se relacionan solo si el aliado las certifica).
  useEffect(() => { setElegidas(new Set(cargar ? [] : (pend.datos ?? []).map((p) => p.id))); }, [pend.datos, cargar]);
  const destinos: Destino[] = (cat?.destinos ?? []).filter((x) => !x.esPropio); // la planta propia es la opción vacía
  const listo = !!f.clienteId && f.desde <= f.hasta && (cargar ? !!f.destinoId && !!archivo : elegidas.size > 0);

  const enviar = async () => {
    setOcupado(true);
    try {
      if (cargar) {
        const form = new FormData();
        form.append('archivo', archivo!); form.append('tipo', f.tipo); form.append('clienteId', f.clienteId); form.append('destinoId', f.destinoId);
        form.append('periodoDesde', f.desde); form.append('periodoHasta', f.hasta);
        if (elegidas.size) form.append('conciliacionItemIds', [...elegidas].join(','));
        const r = await api<{ id: string; numero: string }>('/actas/cargar', { form });
        toast(`Acta ${r.numero} del aliado cargada y emitida.`); onListo(r.id);
      } else {
        const r = await api<{ id: string; numero: string; actas?: { numero: string }[] }>('/actas', { cuerpo: { tipo: f.tipo, clienteId: f.clienteId, destinoId: f.destinoId || undefined, periodoDesde: f.desde, periodoHasta: f.hasta, conciliacionItemIds: [...elegidas], porGenerador: gestor && porGenerador } });
        toast(r.actas && r.actas.length > 1 ? `${r.actas.length} actas creadas en borrador, una por generador (${r.actas.map((x) => x.numero).join(', ')}).` : `Acta ${r.numero} creada en borrador: revísela y emítala.`); onListo(r.id);
      }
    } catch (e) { toast(msg(e), 'warn'); } finally { setOcupado(false); }
  };
  const toggle = (id: string) => setElegidas((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <Sheet open={!!modo} onClose={onClose} title={cargar ? 'Cargar acta de un gestor aliado' : 'Nueva acta'}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={ocupado || !listo} onClick={enviar}>{cargar ? <><FileUp size={16} /> Cargar</> : <><Award size={16} /> Crear borrador</>}</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Cliente" id="na-c"><Select id="na-c" value={f.clienteId} onChange={(e) => setF((s) => ({ ...s, clienteId: e.target.value }))}><option value="">Elija el cliente</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.razonSocial}</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Periodo desde" id="na-d"><Input id="na-d" type="date" value={f.desde} onChange={(e) => setF((s) => ({ ...s, desde: e.target.value }))} /></Field>
          <Field label="Hasta" id="na-h"><Input id="na-h" type="date" value={f.hasta} onChange={(e) => setF((s) => ({ ...s, hasta: e.target.value }))} /></Field>
        </div>
        {gestor && !cargar && (
          <label className="flex items-start gap-2 rounded-lg bg-info/10 px-3 py-2 text-[13px]"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--brand))]" checked={porGenerador} onChange={(e) => setPorGenerador(e.target.checked)} />
            <span>Es un cliente gestor: <b>un certificado por cada generador</b>, a nombre del generador (lo que el gestor entrega a sus clientes). Sin marcar, sale uno consolidado con el generador de cada línea.</span></label>
        )}
        <Field label="Tipo de documento" id="na-t"><Select id="na-t" value={f.tipo} onChange={(e) => setF((s) => ({ ...s, tipo: e.target.value as TipoActa }))}>{Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label={cargar ? 'Gestor aliado' : 'Gestor que certifica'} id="na-g" hint={cargar ? undefined : 'Vacío: la planta propia'}>
          <Select id="na-g" value={f.destinoId} onChange={(e) => setF((s) => ({ ...s, destinoId: e.target.value }))}><option value="">{cargar ? 'Elija el gestor' : 'Planta propia'}</option>{destinos.map((x) => <option key={x.id} value={x.id}>{x.razonSocial}</option>)}</Select>
        </Field>
        {cargar && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-muted">PDF del acta del aliado</span>
            <input ref={input} type="file" accept="application/pdf" className="hidden" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
            <Button className="self-start" onClick={() => input.current?.click()}><FileUp size={16} /> {archivo ? archivo.name : 'Elegir archivo'}</Button>
          </div>
        )}
        {f.clienteId && (
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[13px] font-semibold uppercase tracking-[0.05em] text-muted">{cargar ? 'Líneas que certifica (opcional)' : 'Líneas aprobadas sin certificar'}</h3>
              {!!pend.datos?.length && <Button size="sm" variant="ghost" onClick={() => setElegidas(elegidas.size === pend.datos!.length ? new Set() : new Set(pend.datos!.map((p) => p.id)))}>{elegidas.size === pend.datos.length ? 'Ninguna' : 'Todas'}</Button>}
            </div>
            {pend.cargando && <p className="text-muted">Cargando…</p>}
            {pend.datos && !pend.datos.length && <p className="rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-muted">No hay líneas de conciliaciones aprobadas sin certificar para este cliente en el periodo.</p>}
            {pend.datos?.map((p) => (
              <label key={p.id} className={cx('flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-[13px]', elegidas.has(p.id) ? 'border-brand bg-brand-soft/40' : 'border-line')}>
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--brand))]" checked={elegidas.has(p.id)} onChange={() => toggle(p.id)} />
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{p.residuo}</span><span className="block truncate text-muted">{p.manifiesto} · {fmtFechaCorta(p.fechaServicio)} · {p.sede}{p.tratamiento ? ` · ${p.tratamiento}` : ''}</span></span>
                <span className="num shrink-0">{cant(p.cantidad)} {p.unidad ?? ''}</span>
              </label>
            ))}
          </section>
        )}
      </div>
    </Sheet>
  );
}
