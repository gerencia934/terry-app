// Torre de control: programación de rutas (calendario y líneas por programar), tabla y seguimiento del día.
import { useEffect, useMemo, useState } from 'react';
import { CalendarPlus, RefreshCw, Route, Ban, Download, Truck, CircleAlert, Clock3, CheckCircle2 } from 'lucide-react';
import { MonthCalendar, ResponsiveTable, FilterBar, type CalEvent, type Column } from '../../components/data';
import { Badge, Button, ColorBadge, Field, Input, Kpi, PageHeader, Select, Sheet, Tabs, useToast, Empty } from '../../components/ui';
import { api, tienePermiso } from '../../lib/api';
import { cx, fmtFecha, fmtFechaCorta } from '../../lib/format';
import { bajarArchivo, cant, finDeMes, horaCo, horaColumna, hoyCo, msg, sumarDias, useApi } from '../../lib/servidor';
import { CamposRuta, EtapaBadge, Placa, RutaDetalle, SIN_VEHICULO, cuerpoRuta, lineasDe, useCatalogos, type Catalogos, type FormRuta, type RutaApi } from './comun';

interface PendItem {
  id: string; cantidadEstimada: string | null; cantidadEmbalajes: number | null; jornada: 'AM' | 'PM' | 'DIA' | null; observaciones: string | null;
  sucursal: { id: string; codigo: string | null; nombre: string; direccion: string | null; municipio: { nombre: string } | null; zona: { nombre: string; color: string } | null };
  declaracion: { nombre: string; codigoInterno: string | null; disposiciones: { disposicion: { nombre: string } }[] };
  especificaciones: { especificacion: { abreviatura: string | null; nombre: string } }[];
}
interface PendSol { id: string; numero: number; fechaSolicitada: string; observaciones: string | null; cliente: { id: string; razonSocial: string }; pendientes: number; items: PendItem[] }
type LineaSel = PendItem & { sol: PendSol };

const JORNADA = { AM: 'Mañana', PM: 'Tarde', DIA: 'Todo el día' };
const formVacio = (fecha: string): FormRuta => ({ fechaProgramada: fecha, horaProgramada: '', zonaId: '', vehiculoId: '', conductorId: '', auxiliarId: '', valorFlete: '', observaciones: '', interna: false });

// =====================================================================
// Programación: calendario del mes + líneas aprobadas por programar
// =====================================================================
export function ProgramacionServidor() {
  const hoy = hoyCo();
  const cat = useCatalogos();
  const [vista, setVista] = useState<'calendario' | 'pendientes'>('calendario');
  const [mes, setMes] = useState(hoy.slice(0, 7));
  const rutas = useApi<RutaApi[]>(`/rutas?desde=${mes}-01&hasta=${finDeMes(mes)}`);
  const pend = useApi<PendSol[]>('/programacion/pendientes?limite=200');
  const [rutaSel, setRutaSel] = useState<string | null>(null);
  const [dia, setDia] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [programar, setProgramar] = useState(false);
  const [descartar, setDescartar] = useState<LineaSel | null>(null);
  const [q, setQ] = useState('');
  const [zona, setZona] = useState('');

  const recargar = () => { rutas.recargar(); pend.recargar(); };
  const lista = rutas.datos ?? [];
  const ruta = lista.find((r) => r.id === rutaSel) ?? null;
  const todas: LineaSel[] = useMemo(() => (pend.datos ?? []).flatMap((s) => s.items.map((i) => ({ ...i, sol: s }))), [pend.datos]);
  const elegidas = todas.filter((l) => sel.has(l.id));
  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (pend.datos ?? []).map((s) => ({ ...s, items: s.items.filter((i) =>
      (!zona || i.sucursal.zona?.nombre === zona) &&
      (!t || `${s.numero} ${s.cliente.razonSocial} ${i.sucursal.nombre} ${i.sucursal.codigo ?? ''} ${i.declaracion.nombre} ${i.declaracion.codigoInterno ?? ''}`.toLowerCase().includes(t))) }))
      .filter((s) => s.items.length);
  }, [pend.datos, q, zona]);

  const eventos: CalEvent[] = lista.map((r) => ({
    id: r.id, date: r.fechaProgramada.slice(0, 10), color: r.vehiculo?.color ?? SIN_VEHICULO,
    // En la celda del día cabe poco: placa y hora primero; el código y el conductor van en el detalle (y al pasar el mouse)
    label: [r.vehiculo?.placa ?? 'Sin vehículo', horaColumna(r.horaProgramada)].filter(Boolean).join(' · '), sub: [r.codigo, r.conductor?.nombre.split(' ')[0]].filter(Boolean).join(' · '),
  }));
  const leyenda = [...new Map(lista.filter((r) => r.vehiculo).map((r) => [r.vehiculo!.placa, r.vehiculo!.color])).entries()].map(([label, color]) => ({ label, color }));
  if (lista.some((r) => !r.vehiculo)) leyenda.push({ label: 'Sin vehículo', color: SIN_VEHICULO });
  const sinRecursos = lista.filter((r) => (!r.vehiculoId || !r.conductorId) && !r.estadoRecorrido?.esFinal && r.fechaProgramada.slice(0, 10) >= hoy).length;
  const atrasadas = (pend.datos ?? []).filter((s) => s.fechaSolicitada.slice(0, 10) < hoy).length;
  const toggle = (ids: string[], on: boolean) => setSel((s) => { const n = new Set(s); ids.forEach((i) => (on ? n.add(i) : n.delete(i))); return n; });

  return (
    <>
      <PageHeader eyebrow="Logística" title="Programación" subtitle="Rutas del mes por vehículo y líneas aprobadas que esperan ruta. Cada línea se programa en la parada de su sede."
        actions={<Button onClick={recargar}><RefreshCw size={16} /> Actualizar</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Rutas del mes" value={String(lista.length)} icon={<Route size={16} />} />
        <Kpi label="Sin vehículo o conductor" value={String(sinRecursos)} icon={<Truck size={16} />} hint="De hoy en adelante" />
        <Kpi label="Líneas por programar" value={String(todas.length)} icon={<CalendarPlus size={16} />} />
        <Kpi label="Solicitudes atrasadas" value={String(atrasadas)} icon={<CircleAlert size={16} />} hint="Fecha pedida ya pasó" />
      </div>
      <div className="mb-3"><Tabs value={vista} onChange={setVista} items={[{ value: 'calendario', label: 'Calendario' }, { value: 'pendientes', label: 'Por programar', count: todas.length }]} /></div>
      {(rutas.error || pend.error) && <p className="mb-3 rounded-xl bg-bad/10 p-3 text-bad">{rutas.error || pend.error}</p>}

      {vista === 'calendario' ? (
        <MonthCalendar events={eventos} initial={hoy} today={hoy} onEvent={setRutaSel} legend={leyenda} onMonth={setMes} onDay={setDia} />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3 sm:flex-row sm:items-end">
            <div className="flex-1"><Field label="Buscar" id="pp-q"><Input id="pp-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cliente, sede, residuo o número de solicitud" /></Field></div>
            <div className="sm:w-56"><Field label="Zona" id="pp-z"><Select id="pp-z" value={zona} onChange={(e) => setZona(e.target.value)}><option value="">Todas</option>{cat?.zonas.map((z) => <option key={z.id}>{z.nombre}</option>)}</Select></Field></div>
          </div>
          {!pend.datos ? <p className="p-6 text-center text-muted">Cargando…</p> : !filtradas.length ? <Empty>No hay líneas aprobadas esperando ruta{q || zona ? ' con estos filtros' : ''}.</Empty> : filtradas.map((s) => {
            const ids = s.items.map((i) => i.id); const todasSel = ids.every((i) => sel.has(i));
            return (
              <section key={s.id} className="rounded-xl border border-line bg-surface">
                <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2.5">
                  <input type="checkbox" aria-label={`Elegir todas las líneas de la solicitud ${s.numero}`} className="h-4 w-4 accent-[rgb(var(--brand))]" checked={todasSel} onChange={(e) => toggle(ids, e.target.checked)} />
                  <span className="num font-semibold">Sol. {s.numero}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{s.cliente.razonSocial}</span>
                  <span className={cx('text-[12px]', s.fechaSolicitada.slice(0, 10) < hoy ? 'font-medium text-bad' : 'text-muted')}>Para el {fmtFecha(s.fechaSolicitada)}</span>
                </header>
                <ul className="divide-y divide-line">
                  {s.items.map((i) => (
                    <li key={i.id} className={cx('flex items-start gap-3 px-3 py-2.5', sel.has(i.id) && 'bg-brand-soft/40')}>
                      <input type="checkbox" aria-label={`Elegir ${i.declaracion.nombre}`} className="mt-1 h-4 w-4 shrink-0 accent-[rgb(var(--brand))]" checked={sel.has(i.id)} onChange={(e) => toggle([i.id], e.target.checked)} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-medium">{i.declaracion.nombre}{i.declaracion.codigoInterno && <span className="num ml-1.5 text-[12px] text-muted">{i.declaracion.codigoInterno}</span>}</p>
                        <p className="text-[12px] text-muted">{i.sucursal.codigo ? `${i.sucursal.codigo} · ` : ''}{i.sucursal.nombre}{i.sucursal.municipio ? ` · ${i.sucursal.municipio.nombre}` : ''}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px]">
                          <span className="num">{cant(i.cantidadEstimada)} estimado</span>
                          {i.jornada && <Badge>{JORNADA[i.jornada]}</Badge>}
                          {i.sucursal.zona && <ColorBadge color={i.sucursal.zona.color}>{i.sucursal.zona.nombre}</ColorBadge>}
                          {i.especificaciones.map((e) => <Badge key={e.especificacion.nombre} tone="info">{e.especificacion.abreviatura ?? e.especificacion.nombre}</Badge>)}
                          {i.observaciones && <span className="text-muted">· {i.observaciones}</span>}
                        </div>
                      </div>
                      {tienePermiso('solicitudes.crear') && <Button size="sm" variant="ghost" onClick={() => setDescartar({ ...i, sol: s })} title="Descartar la línea"><Ban size={14} /><span className="hidden sm:inline">Descartar</span></Button>}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          {sel.size > 0 && (
            <div className="sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand/40 bg-surface px-4 py-3 shadow-lg">
              <span className="text-sm"><b className="num">{sel.size}</b> {sel.size === 1 ? 'línea' : 'líneas'} · <span className="num">{new Set(elegidas.map((l) => l.sucursal.id)).size}</span> {new Set(elegidas.map((l) => l.sucursal.id)).size === 1 ? 'sede' : 'sedes'}</span>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setSel(new Set())}>Limpiar</Button>
                {tienePermiso('rutas.programar') && <Button variant="primary" onClick={() => setProgramar(true)}><CalendarPlus size={16} /> Programar</Button>}
              </div>
            </div>
          )}
        </div>
      )}

      <RutaDetalle ruta={ruta} cat={cat} onClose={() => setRutaSel(null)} onCambio={recargar} />
      <Sheet open={!!dia} onClose={() => setDia(null)} title={dia ? `Rutas del ${fmtFecha(dia)}` : ''}
        footer={tienePermiso('rutas.programar') && <Button variant="primary" onClick={() => { setDia(null); setVista('pendientes'); }}><CalendarPlus size={16} /> Programar líneas</Button>}>
        <div className="flex flex-col gap-2">
          {lista.filter((r) => r.fechaProgramada.slice(0, 10) === dia).map((r) => (
            <button key={r.id} onClick={() => { setDia(null); setRutaSel(r.id); }} className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2.5 text-left hover:bg-surface-2">
              <span className="min-w-0"><span className="num block font-medium">{r.codigo}{r.horaProgramada ? ` · ${horaColumna(r.horaProgramada)}` : ''}</span>
                <span className="block truncate text-[12px] text-muted">{r.conductor?.nombre ?? 'Sin conductor'} · {r.paradas.length} paradas · {lineasDe(r)} líneas</span></span>
              <span className="flex shrink-0 flex-col items-end gap-1"><Placa r={r} /><EtapaBadge e={r.estadoRecorrido} /></span>
            </button>
          ))}
          {!lista.some((r) => r.fechaProgramada.slice(0, 10) === dia) && <p className="text-muted">No hay rutas ese día.</p>}
        </div>
      </Sheet>
      {cat && <ProgramarSheet abierta={programar} lineas={elegidas} cat={cat} onClose={() => setProgramar(false)}
        onListo={(id) => { setProgramar(false); setSel(new Set()); recargar(); if (id) { setVista('calendario'); setRutaSel(id); } }} />}
      {cat && <DescartarSheet linea={descartar} cat={cat} onClose={() => setDescartar(null)} onListo={() => { setDescartar(null); pend.recargar(); }} />}
    </>
  );
}

/** Programa las líneas elegidas en una ruta nueva (una parada por sede) o las agrega a una ruta del mismo día. */
function ProgramarSheet({ abierta, lineas, cat, onClose, onListo }: { abierta: boolean; lineas: LineaSel[]; cat: Catalogos; onClose: () => void; onListo: (rutaId?: string) => void }) {
  const toast = useToast();
  const sugerida = () => { const h = hoyCo(); const m = lineas.map((l) => l.sol.fechaSolicitada.slice(0, 10)).sort()[0] ?? h; return m < h ? h : m; };
  const [modo, setModo] = useState<'nueva' | 'existente'>('nueva');
  const [f, setF] = useState<FormRuta>(() => formVacio(sugerida()));
  const [codigo, setCodigo] = useState('');
  const [rutaEx, setRutaEx] = useState('');
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { if (abierta) { setF(formVacio(sugerida())); setCodigo(''); setRutaEx(''); } }, [abierta]); // eslint-disable-line react-hooks/exhaustive-deps
  const delDia = useApi<RutaApi[]>(abierta && modo === 'existente' && f.fechaProgramada ? `/rutas?desde=${f.fechaProgramada}&hasta=${f.fechaProgramada}` : null);
  const abiertas = (delDia.datos ?? []).filter((r) => !r.estadoRecorrido?.esFinal);
  const sedes = new Set(lineas.map((l) => l.sucursal.id)).size;
  const clientes = new Set(lineas.map((l) => l.sol.cliente.id)).size;

  const enviar = async () => {
    setOcupado(true);
    try {
      if (modo === 'nueva') {
        const r = await api<RutaApi>('/rutas', { cuerpo: { ...cuerpoRuta(f, false), codigo: codigo.trim() || undefined, items: lineas.map((l) => l.id) } });
        toast(`Ruta ${r.codigo} creada con ${lineas.length} ${lineas.length === 1 ? 'línea' : 'líneas'}.`);
        onListo(r.id);
      } else {
        await api(`/rutas/${rutaEx}/items`, { cuerpo: { items: lineas.map((l) => l.id) } });
        toast(`${lineas.length} ${lineas.length === 1 ? 'línea agregada' : 'líneas agregadas'} a la ruta.`);
        onListo(rutaEx);
      }
    } catch (e) { toast(msg(e), 'warn'); } finally { setOcupado(false); }
  };
  return (
    <Sheet open={abierta} onClose={onClose} title="Programar líneas"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={ocupado || !lineas.length || (modo === 'existente' && !rutaEx)} onClick={enviar}><CalendarPlus size={16} /> {modo === 'nueva' ? 'Crear ruta' : 'Agregar a la ruta'}</Button></>}>
      <div className="flex flex-col gap-4">
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-[13px]"><b className="num">{lineas.length}</b> {lineas.length === 1 ? 'línea' : 'líneas'} de <b className="num">{clientes}</b> {clientes === 1 ? 'cliente' : 'clientes'} en <b className="num">{sedes}</b> {sedes === 1 ? 'sede' : 'sedes'} (una parada por sede).</p>
        <Tabs value={modo} onChange={setModo} items={[{ value: 'nueva', label: 'Ruta nueva' }, { value: 'existente', label: 'Ruta existente' }]} />
        {modo === 'nueva' ? (
          <>
            <CamposRuta f={f} set={setF} cat={cat} id="pr" />
            <Field label="Código de la ruta" id="pr-cod" hint="Déjelo vacío y TERRY-GO la numera sola (R-AAAAMMDD-01)"><Input id="pr-cod" value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} maxLength={20} placeholder="Automático" /></Field>
            <p className="text-[12px] text-subtle">Puede programar sin vehículo ni conductor y asignarlos después: la ruta no sale hasta tenerlos y tener la inspección del vehículo aprobada.</p>
          </>
        ) : (
          <>
            <Field label="Fecha" id="pe-f"><Input id="pe-f" type="date" value={f.fechaProgramada} onChange={(e) => { setF((s) => ({ ...s, fechaProgramada: e.target.value })); setRutaEx(''); }} /></Field>
            <div className="flex flex-col gap-2">
              {delDia.cargando && <p className="text-muted">Cargando…</p>}
              {!delDia.cargando && !abiertas.length && <p className="text-muted">No hay rutas abiertas ese día. Cree una ruta nueva.</p>}
              {abiertas.map((r) => (
                <label key={r.id} className={cx('flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5', rutaEx === r.id ? 'border-brand bg-brand-soft/40' : 'border-line')}>
                  <input type="radio" name="pe-ruta" className="accent-[rgb(var(--brand))]" checked={rutaEx === r.id} onChange={() => setRutaEx(r.id)} />
                  <span className="min-w-0 flex-1"><span className="num block font-medium">{r.codigo}</span><span className="block truncate text-[12px] text-muted">{r.conductor?.nombre ?? 'Sin conductor'} · {r.paradas.length} paradas</span></span>
                  <Placa r={r} />
                </label>
              ))}
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

function DescartarSheet({ linea, cat, onClose, onListo }: { linea: LineaSel | null; cat: Catalogos; onClose: () => void; onListo: () => void }) {
  const toast = useToast();
  const [causal, setCausal] = useState('');
  useEffect(() => setCausal(''), [linea?.id]);
  const enviar = async () => {
    if (!linea) return;
    try { await api(`/solicitudes/items/${linea.id}/descartar`, { metodo: 'PATCH', cuerpo: { causalId: causal } }); toast('Línea descartada.'); onListo(); }
    catch (e) { toast(msg(e), 'warn'); }
  };
  return (
    <Sheet open={!!linea} onClose={onClose} title="Descartar línea" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="danger" disabled={!causal} onClick={enviar}><Ban size={16} /> Descartar</Button></>}>
      {linea && (
        <div className="flex flex-col gap-4">
          <p className="text-sm">{linea.declaracion.nombre} · {linea.sucursal.nombre} (solicitud {linea.sol.numero}, {linea.sol.cliente.razonSocial}). La línea deja de esperar ruta.</p>
          <Field label="Causal" id="dl-c"><Select id="dl-c" value={causal} onChange={(e) => setCausal(e.target.value)}><option value="">Elija la causal</option>{cat.causales.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</Select></Field>
        </div>
      )}
    </Sheet>
  );
}

// =====================================================================
// Programación en tabla: rutas por rango, con filtros y exportación de costos
// =====================================================================
export function ProgramacionTablaServidor() {
  const hoy = hoyCo();
  const cat = useCatalogos();
  const base = { desde: hoy, hasta: sumarDias(hoy, 14), vehiculoId: '', conductorId: '', zonaId: '' };
  const [f, setF] = useState(base);
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
  const rutas = useApi<RutaApi[]>(f.desde && f.hasta ? `/rutas?${qs}` : null);
  const [sel, setSel] = useState<string | null>(null);
  const toast = useToast();
  const activos = Object.entries(f).filter(([k, v]) => v && v !== (base as Record<string, string>)[k]).length;
  const cols: Column<RutaApi>[] = [
    { key: 'fecha', header: 'Fecha', render: (r) => <span className="num">{fmtFechaCorta(r.fechaProgramada)}{r.horaProgramada ? ` · ${horaColumna(r.horaProgramada)}` : ''}</span>, priority: 1 },
    { key: 'cod', header: 'Ruta', render: (r) => <span className="num font-medium">{r.codigo}</span>, priority: 3 },
    { key: 'veh', header: 'Vehículo', render: (r) => <Placa r={r} />, priority: 1 },
    { key: 'cond', header: 'Conductor', render: (r) => r.conductor?.nombre ?? <span className="text-warn">Sin asignar</span>, priority: 2 },
    { key: 'aux', header: 'Auxiliar', render: (r) => r.auxiliar?.nombre ?? '—', priority: 3 },
    { key: 'zona', header: 'Zona', render: (r) => r.zona?.nombre ?? '—', priority: 3 },
    { key: 'par', header: 'Paradas', align: 'right', render: (r) => r.paradas.length, priority: 2 },
    { key: 'lin', header: 'Líneas', align: 'right', render: (r) => lineasDe(r), priority: 3 },
    { key: 'etapa', header: 'Etapa', render: (r) => <EtapaBadge e={r.estadoRecorrido} />, priority: 3 },
  ];
  const exportar = async () => {
    try { await bajarArchivo(`/informes/rutas/costos?formato=xlsx&desde=${f.desde}&hasta=${f.hasta}${f.vehiculoId ? `&vehiculoId=${f.vehiculoId}` : ''}${f.conductorId ? `&conductorId=${f.conductorId}` : ''}`, `costos-rutas-${f.desde}-a-${f.hasta}.xlsx`); }
    catch (e) { toast(msg(e), 'warn'); }
  };
  return (
    <>
      <PageHeader eyebrow="Logística" title="Programación en tabla" subtitle="Las rutas en lista para revisar tripulaciones, zonas y avance. Exporte los costos de flete a Excel."
        actions={<>{tienePermiso('informes.ver') && <Button onClick={exportar}><Download size={16} /> Costos en Excel</Button>}<Button onClick={rutas.recargar}><RefreshCw size={16} /> Actualizar</Button></>} />
      <FilterBar active={activos} onClear={() => setF(base)}>
        <Field label="Desde" id="pt-d"><Input id="pt-d" type="date" value={f.desde} onChange={(e) => setF((s) => ({ ...s, desde: e.target.value }))} /></Field>
        <Field label="Hasta" id="pt-h"><Input id="pt-h" type="date" value={f.hasta} onChange={(e) => setF((s) => ({ ...s, hasta: e.target.value }))} /></Field>
        <Field label="Vehículo" id="pt-v"><Select id="pt-v" value={f.vehiculoId} onChange={(e) => setF((s) => ({ ...s, vehiculoId: e.target.value }))}><option value="">Todos</option>{cat?.vehiculos.map((v) => <option key={v.id} value={v.id}>{v.placa}</option>)}</Select></Field>
        <Field label="Conductor" id="pt-c"><Select id="pt-c" value={f.conductorId} onChange={(e) => setF((s) => ({ ...s, conductorId: e.target.value }))}><option value="">Todos</option>{cat?.personal.filter((p) => p.esConductor).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</Select></Field>
        <Field label="Zona" id="pt-z"><Select id="pt-z" value={f.zonaId} onChange={(e) => setF((s) => ({ ...s, zonaId: e.target.value }))}><option value="">Todas</option>{cat?.zonas.map((z) => <option key={z.id} value={z.id}>{z.nombre}</option>)}</Select></Field>
      </FilterBar>
      {rutas.error ? <p className="rounded-xl bg-bad/10 p-4 text-bad">{rutas.error}</p>
        : !rutas.datos ? <p className="p-6 text-center text-muted">Cargando…</p>
        : <ResponsiveTable rows={rutas.datos} columns={cols} rowKey={(r) => r.id} onRowClick={(r) => setSel(r.id)} cardTitle={(r) => <span className="num">{r.codigo}</span>} cardBadge={(r) => <EtapaBadge e={r.estadoRecorrido} />}
            cardMeta={(r) => `${fmtFecha(r.fechaProgramada)}${r.horaProgramada ? ` · ${horaColumna(r.horaProgramada)}` : ''}`} empty="No hay rutas en este rango." />}
      <RutaDetalle ruta={rutas.datos?.find((r) => r.id === sel) ?? null} cat={cat} onClose={() => setSel(null)} onCambio={rutas.recargar} />
    </>
  );
}

// =====================================================================
// Seguimiento: las rutas de hoy según las etapas que marca la app del conductor
// =====================================================================
export function SeguimientoServidor() {
  const hoy = hoyCo();
  const cat = useCatalogos();
  const rutas = useApi<RutaApi[]>(`/rutas?desde=${hoy}&hasta=${hoy}`);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => { const t = setInterval(rutas.recargar, 60_000); return () => clearInterval(t); }, [rutas.recargar]);
  const lista = rutas.datos ?? [];
  const inicial = Math.min(...(cat?.etapas.map((e) => e.orden) ?? [1]));
  const enCurso = lista.filter((r) => r.estadoRecorrido && !r.estadoRecorrido.esFinal && r.estadoRecorrido.orden > inicial);
  const terminadas = lista.filter((r) => r.estadoRecorrido?.esFinal);
  const sinRecursos = lista.filter((r) => !r.vehiculoId || !r.conductorId);
  return (
    <>
      <PageHeader eyebrow="Logística" title="Seguimiento" subtitle={`Rutas del ${fmtFecha(hoy)} según las etapas que marca la app del conductor. Se actualiza cada minuto.`}
        actions={<Button onClick={rutas.recargar}><RefreshCw size={16} /> Actualizar</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Programadas hoy" value={String(lista.length)} icon={<Route size={16} />} />
        <Kpi label="En curso" value={String(enCurso.length)} icon={<Clock3 size={16} />} />
        <Kpi label="Terminadas" value={String(terminadas.length)} icon={<CheckCircle2 size={16} />} />
        <Kpi label="Sin vehículo o conductor" value={String(sinRecursos.length)} icon={<CircleAlert size={16} />} />
      </div>
      {rutas.error && <p className="mb-3 rounded-xl bg-bad/10 p-3 text-bad">{rutas.error}</p>}
      {!rutas.datos ? <p className="p-6 text-center text-muted">Cargando…</p> : !lista.length ? <Empty>No hay rutas programadas para hoy.</Empty> : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {lista.map((r) => {
            const atendidas = r.paradas.filter((p) => p.estado !== 'PENDIENTE').length;
            const pct = r.paradas.length ? Math.round((atendidas * 100) / r.paradas.length) : 0;
            return (
              <button key={r.id} onClick={() => setSel(r.id)} className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 text-left hover:border-brand/50">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><p className="num font-semibold">{r.codigo}</p><p className="truncate text-[13px] text-muted">{r.conductor?.nombre ?? 'Sin conductor'}{r.auxiliar ? ` · ${r.auxiliar.nombre}` : ''}</p></div>
                  <Placa r={r} />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
                  <EtapaBadge e={r.estadoRecorrido} />
                  <span>Salida {horaCo(r.horaSalida)}</span>
                  {r.kmInicial !== null && <span className="num">Km {cant(r.kmInicial)}</span>}
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-[12px] text-muted"><span>Paradas atendidas</span><span className="num">{atendidas} de {r.paradas.length}</span></div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} /></div>
                </div>
              </button>
            );
          })}
        </div>
      )}
      <RutaDetalle ruta={lista.find((r) => r.id === sel) ?? null} cat={cat} onClose={() => setSel(null)} onCambio={rutas.recargar} />
    </>
  );
}
