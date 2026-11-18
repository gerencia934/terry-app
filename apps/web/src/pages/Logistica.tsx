import { useMemo, useState } from 'react';
import { Download, Truck, PackageOpen, MapPin, Navigation, Upload, CheckCircle2, Circle } from 'lucide-react';
import { MonthCalendar, ResponsiveTable, FilterBar, type Column } from '../components/data';
import { Badge, Button, ColorBadge, DefList, Field, Input, PageHeader, Select, Sheet, Tabs, useToast, type Tone } from '../components/ui';
import { Fab } from '../components/AppShell';
import {
  CLIENTES, ESTADOS_RUTA, HOY, RUTAS_MES, SOLICITUDES, VEHICULOS, ZONAS, cliente, decl, estadoGrinclic, horaRuta, item, jornada, manejo,
  ordenCompra, persona, sucursal, tipoSolicitud, totalSolicitud, vehiculo, zona, type Ruta, type Solicitud,
} from '../data/mock';
import { useRouter } from '../lib/router';
import { cx, fmtCOP, fmtFecha, fmtFechaCorta, fmtNum } from '../lib/format';
import { uni } from './Declaraciones';

// Colores del calendario de solicitudes (leyenda de Grinclic)
const LEYENDA_SOL = [
  { label: 'Cargas (Dir.)', color: '#F2790F' }, { label: 'Cargas (Aut.)', color: '#1E9BD7' }, { label: 'Descargas', color: '#1F8A3B' },
  { label: 'No aprobado o pendiente', color: '#E07A9B' }, { label: 'Descartadas', color: '#D92D20' },
];
const colorSol = (s: Solicitud) => {
  const e = estadoGrinclic(s);
  if (e === 'Descartada') return '#D92D20';
  if (e === 'No aprobado' || e === 'Pendiente') return '#E07A9B';
  const t = tipoSolicitud(s); return t === 'Descargue' ? '#1F8A3B' : t === 'Carga automática' ? '#1E9BD7' : '#F2790F';
};
const TONO_EST: Record<string, Tone> = { Gestionado: 'ok', Pendiente: 'warn', 'No aprobado': 'warn', Descartada: 'bad' };
const cantTotal = (s: Solicitud) => { const u = uni(item(decl(s.items[0].declId).itemId).unidad); return `${u} ${fmtNum(s.items.reduce((a, i) => a + i.cantidad, 0))}`; };

export function Solicitudes() {
  const toast = useToast();
  const { go } = useRouter();
  const [f, setF] = useState({ desde: '2026-11-01', hasta: '2026-11-30', cliente: '', documento: '', tipo: '', estado: '' });
  const [sel, setSel] = useState<Solicitud | null>(null);
  const [nueva, setNueva] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const formales = SOLICITUDES.filter((s) => s.clase === 'FORMAL');
  const rows = useMemo(() => formales.filter((s) => (!f.desde || s.fecha >= f.desde) && (!f.hasta || s.fecha <= f.hasta) && (!f.cliente || s.clienteId === f.cliente)
    && (!f.documento || String(s.numero).includes(f.documento)) && (!f.tipo || tipoSolicitud(s) === f.tipo) && (!f.estado || estadoGrinclic(s) === f.estado))
    .sort((a, b) => b.numero - a.numero), [formales, f]);

  const cols: Column<Solicitud>[] = [
    { key: 'nro', header: 'Nº', render: (s) => <span className="num font-semibold text-brand">{s.numero}</span>, priority: 3 },
    { key: 'estado', header: 'Estado', render: (s) => <Badge tone={TONO_EST[estadoGrinclic(s)]}>{estadoGrinclic(s)}</Badge>, priority: 3 },
    { key: 'tipo', header: 'Tipo', render: (s) => <span className="text-info">{tipoSolicitud(s)}</span>, priority: 2 },
    { key: 'cliente', header: 'Cliente', render: (s) => <span className="block max-w-[220px] truncate font-medium">{cliente(s.clienteId).razonSocial}</span>, priority: 3 },
    { key: 'reg', header: 'Fecha registro', render: (s) => <span className="num text-muted">{fmtFechaCorta(addDays(s.fecha, -2))}</span>, priority: 3 },
    { key: 'fecha', header: 'Fecha servicio aprox.', render: (s) => <span className="num">{fmtFechaCorta(s.fecha)}</span>, priority: 1 },
    { key: 'res', header: 'Residuo', render: (s) => <span className="block max-w-[220px] truncate">{s.items.map((i) => item(decl(i.declId).itemId).nombre).join(', ')}</span>, priority: 3 },
    { key: 'oc', header: 'Orden de compra', render: (s) => ordenCompra(s) || '—', priority: 3 },
    { key: 'total', header: 'Total de la solicitud', align: 'right', render: (s) => cantTotal(s), priority: 2 },
    { key: 'jornada', header: 'Jornada', align: 'center', render: (s) => jornada(s), priority: 3 },
    { key: 'manejo', header: 'Manejo y disp.', render: (s) => <span className="block max-w-[220px] truncate">{manejo(item(decl(s.items[0].declId).itemId).manejo).nombre}</span>, priority: 3 },
    { key: 'suc', header: 'Sucursales', render: (s) => <span className="block max-w-[200px] truncate">{sucursal(s.sucursalId).nombre} · {sucursal(s.sucursalId).municipio}</span>, priority: 3 },
    { key: 'obs', header: 'Observaciones', render: (s) => <span className="text-muted">{s.causal ?? '—'}</span>, priority: 3 },
    { key: 'items', header: 'Número de ítems', align: 'center', render: (s) => s.items.length, priority: 3 },
    { key: 'valor', header: 'Valor estimado', align: 'right', render: (s) => fmtCOP(totalSolicitud(s)), priority: 3 },
  ];
  const pendientes = SOLICITUDES.filter((s) => s.clase === 'FORMAL' || s.estado === 'PENDIENTE');

  return (
    <>
      <PageHeader eyebrow="Solicitudes" title={`Solicitudes (${fmtFecha(f.desde)} – ${fmtFecha(f.hasta)})`} subtitle="Solicitudes de carga y descarga por cliente, con el calendario de pendientes."
        actions={<><Button onClick={() => go('cargues')}><Upload size={16} /> Cargue masivo</Button><Button onClick={() => toast('Excel de solicitudes generado con los filtros actuales.', 'info')}><Download size={16} /> Exportar Excel</Button></>} />
      <FilterBar active={Object.values(f).filter(Boolean).length - 2} onClear={() => setF({ desde: '2026-11-01', hasta: '2026-11-30', cliente: '', documento: '', tipo: '', estado: '' })}>
        <Field label="Desde" id="s-desde"><Input id="s-desde" type="date" value={f.desde} onChange={set('desde')} /></Field>
        <Field label="Hasta" id="s-hasta"><Input id="s-hasta" type="date" value={f.hasta} onChange={set('hasta')} /></Field>
        <Field label="Cliente" id="s-cli"><Select id="s-cli" value={f.cliente} onChange={set('cliente')}><option value="">Todos</option>{CLIENTES.map((c) => <option key={c.id} value={c.id}>{c.razonSocial}</option>)}</Select></Field>
        <Field label="Documento" id="s-doc"><Input id="s-doc" inputMode="numeric" value={f.documento} onChange={set('documento')} placeholder="Nº solicitud" /></Field>
        <Field label="Tipo de solicitud" id="s-tipo"><Select id="s-tipo" value={f.tipo} onChange={set('tipo')}><option value="">Seleccione</option><option>Carga directa</option><option>Carga automática</option><option>Descargue</option></Select></Field>
        <Field label="Estado" id="s-est"><Select id="s-est" value={f.estado} onChange={set('estado')}><option value="">Seleccione</option><option>Gestionado</option><option>Pendiente</option><option>Descartada</option></Select></Field>
      </FilterBar>
      <ResponsiveTable rows={rows} columns={cols} rowKey={(s) => s.id} onRowClick={setSel}
        cardTitle={(s) => cliente(s.clienteId).razonSocial} cardBadge={(s) => <Badge tone={TONO_EST[estadoGrinclic(s)]}>{estadoGrinclic(s)}</Badge>}
        cardMeta={(s) => <span className="num">Nº {s.numero} · {tipoSolicitud(s)} · {jornada(s)} · {sucursal(s.sucursalId).municipio}</span>} />

      <h2 className="mb-2 mt-7 text-[16px] font-semibold">Calendario de solicitudes pendientes</h2>
      <MonthCalendar initial={HOY} today={HOY} legend={LEYENDA_SOL} onEvent={(id) => setSel(SOLICITUDES.find((s) => s.id === id) ?? null)}
        events={pendientes.map((s) => ({ id: s.id, date: s.fecha, label: `${jornada(s).toLowerCase()} Nº ${s.numero} · ${cliente(s.clienteId).razonSocial}`, sub: sucursal(s.sucursalId).municipio, color: colorSol(s) }))} />

      <Fab label="Nueva solicitud" onClick={() => setNueva(true)} />
      {nueva && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="ns-t">
          <div className="anim-sheet w-full max-w-md rounded-2xl bg-surface p-6 text-center shadow-2xl">
            <h2 id="ns-t" className="text-[17px] font-semibold text-brand-ink">¿Desea crear una solicitud de carga o descarga?</h2>
            <div className="mt-5 grid grid-cols-2 gap-3">
              {([[Truck, 'Carga'], [PackageOpen, 'Descarga']] as const).map(([I, l]) => (
                <button key={l} onClick={() => { setNueva(false); toast(`Nueva solicitud de ${l.toLowerCase()}: cliente → sucursal → residuos declarados y autorizados → fecha y jornada.`, 'info'); }} className="flex flex-col items-center gap-2 rounded-xl border-2 border-line p-4 font-semibold hover:border-brand hover:bg-brand-soft/50"><I size={28} className="text-brand" />{l}</button>
              ))}
            </div>
            <Button variant="ghost" className="mt-4" onClick={() => setNueva(false)}>Cancelar</Button>
          </div>
        </div>
      )}
      <DetalleSolicitud sel={sel} onClose={() => setSel(null)} />
    </>
  );
}

function DetalleSolicitud({ sel, onClose }: { sel: Solicitud | null; onClose: () => void }) {
  const toast = useToast();
  return (
    <Sheet open={!!sel} onClose={onClose} title={sel ? `${sel.clase === 'PRE' ? 'Pre-solicitud' : 'Solicitud'} ${sel.numero}` : ''}
      footer={sel && estadoGrinclic(sel) !== 'Gestionado' && estadoGrinclic(sel) !== 'Descartada' && <Button variant="primary" onClick={() => { toast(`Solicitud ${sel.numero} enviada a programación de rutas.`); onClose(); }}>Programar en ruta</Button>}>
      {sel && (
        <div className="flex flex-col gap-5">
          <div><p className="text-[17px] font-semibold">{cliente(sel.clienteId).razonSocial}</p><p className="text-muted">{sucursal(sel.sucursalId).nombre} · {sucursal(sel.sucursalId).municipio}</p>
            <div className="mt-2 flex gap-2"><Badge tone={TONO_EST[estadoGrinclic(sel)]}>{estadoGrinclic(sel)}</Badge><Badge tone="info">{tipoSolicitud(sel)}</Badge></div></div>
          <DefList items={[['Fecha servicio aprox.', fmtFecha(sel.fecha)], ['Jornada', `${jornada(sel)} · ${sel.franja}`], ['Orden de compra', ordenCompra(sel) || '—'], ['Contacto', `${sucursal(sel.sucursalId).contacto} · ${sucursal(sel.sucursalId).telefono}`], ...(sel.causal ? [['Causal', sel.causal]] as [string, string][] : [])]} />
          <div className="rounded-xl border border-line">
            {sel.items.map((i) => { const d = decl(i.declId); const it = item(d.itemId); return (
              <div key={i.declId} className="flex justify-between gap-3 border-b border-line px-3 py-2.5 text-[13px] last:border-0">
                <div className="min-w-0"><p className="font-medium">{it.nombre}</p><p className="text-muted">{fmtNum(i.cantidad)} {uni(it.unidad)} · {manejo(it.manejo).nombre}</p></div>
                <span className="num shrink-0 font-medium">{fmtCOP(i.cantidad * d.precio)}</span>
              </div>); })}
            <div className="num flex justify-between bg-surface-2 px-3 py-2.5 text-[14px] font-semibold"><span>Total</span><span>{fmtCOP(totalSolicitud(sel))}</span></div>
          </div>
        </div>
      )}
    </Sheet>
  );
}

const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export function PreSolicitudes() {
  const toast = useToast();
  const [f, setF] = useState({ desde: '', hasta: '', cliente: '' });
  const [sel, setSel] = useState<Solicitud | null>(null);
  const rows = SOLICITUDES.filter((s) => s.clase === 'PRE').filter((s) => (!f.desde || s.fecha >= f.desde) && (!f.hasta || s.fecha <= f.hasta) && (!f.cliente || s.clienteId === f.cliente));
  return (
    <>
      <PageHeader eyebrow="Solicitudes" title="Pre-solicitudes" subtitle="Solicitudes que el cliente registra desde el portal o por frecuencia, antes de confirmarse como solicitud formal." />
      <FilterBar active={Object.values(f).filter(Boolean).length} onClear={() => setF({ desde: '', hasta: '', cliente: '' })}>
        <Field label="Desde" id="ps-d"><Input id="ps-d" type="date" value={f.desde} onChange={(e) => setF((s) => ({ ...s, desde: e.target.value }))} /></Field>
        <Field label="Hasta" id="ps-h"><Input id="ps-h" type="date" value={f.hasta} onChange={(e) => setF((s) => ({ ...s, hasta: e.target.value }))} /></Field>
        <Field label="Cliente" id="ps-c"><Select id="ps-c" value={f.cliente} onChange={(e) => setF((s) => ({ ...s, cliente: e.target.value }))}><option value="">Seleccione</option>{CLIENTES.map((c) => <option key={c.id} value={c.id}>{c.razonSocial}</option>)}</Select></Field>
      </FilterBar>
      <ResponsiveTable rows={rows} rowKey={(s) => s.id} onRowClick={setSel} cardTitle={(s) => cliente(s.clienteId).razonSocial} cardMeta={(s) => `Próximo servicio: ${fmtFecha(s.fecha)}`}
        columns={[
          { key: 'c', header: 'Cliente', render: (s) => <span className="font-medium">{cliente(s.clienteId).razonSocial}</span>, priority: 3 },
          { key: 'p', header: 'Fecha próx. servicio', render: (s) => <span className="num font-semibold text-bad">{fmtFechaCorta(s.fecha)}</span>, priority: 1 },
          { key: 'a', header: 'Fecha activación aprox.', render: (s) => <span className="num">{fmtFechaCorta(addDays(s.fecha, -3))}</span>, priority: 2 },
          { key: 'r', header: 'Residuo', render: (s) => item(decl(s.items[0].declId).itemId).nombre, priority: 2 },
          { key: 's', header: 'Servicios adicionales', render: () => '—', priority: 3 },
          { key: 'v', header: 'Varias sucursales', render: (s) => sucursal(s.sucursalId).nombre, priority: 3 },
          { key: 'f', header: 'Fecha registro', render: (s) => <span className="num text-muted">{fmtFechaCorta(addDays(s.fecha, -10))}</span>, priority: 3 },
          { key: 'm', header: 'Manifiesto relacionado', render: () => '—', priority: 3 },
        ]} />
      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel ? `Pre-solicitud ${sel.numero}` : ''}
        footer={sel && <Button variant="primary" onClick={() => { toast(`Pre-solicitud ${sel.numero} convertida en solicitud formal.`); setSel(null); }}>Convertir en solicitud formal</Button>}>
        {sel && <DefList items={[['Cliente', cliente(sel.clienteId).razonSocial], ['Sucursal', sucursal(sel.sucursalId).nombre], ['Residuo', item(decl(sel.items[0].declId).itemId).nombre], ['Cantidad', cantTotal(sel)], ['Próximo servicio', fmtFecha(sel.fecha)]]} />}
      </Sheet>
    </>
  );
}

// ---------------------------- RUTAS ----------------------------
const clientesRuta = (r: Ruta) => r.solicitudes.map((s) => cliente(SOLICITUDES.find((x) => x.id === s)!.clienteId).razonSocial);
const estRuta = (id: string) => ESTADOS_RUTA.find((e) => e.id === id)!;

function FiltrosRutas({ f, setF }: { f: Record<string, string>; setF: (fn: (s: Record<string, string>) => Record<string, string>) => void }) {
  const set = (k: string) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <FilterBar active={Object.entries(f).filter(([k, v]) => v && !['desde', 'hasta'].includes(k)).length} onClear={() => setF(() => ({ desde: '2026-11-01', hasta: '2026-11-30' }))}>
      <Field label="Desde" id="r-d"><Input id="r-d" type="date" value={f.desde ?? ''} onChange={set('desde')} /></Field>
      <Field label="Hasta" id="r-h"><Input id="r-h" type="date" value={f.hasta ?? ''} onChange={set('hasta')} /></Field>
      <Field label="Cliente" id="r-c"><Select id="r-c" value={f.cliente ?? ''} onChange={set('cliente')}><option value="">Seleccione</option>{CLIENTES.map((c) => <option key={c.id} value={c.id}>{c.razonSocial}</option>)}</Select></Field>
      <Field label="Zona" id="r-z"><Select id="r-z" value={f.zona ?? ''} onChange={set('zona')}><option value="">Todas</option>{ZONAS.map((z) => <option key={z.id} value={z.id}>{z.nombre}</option>)}</Select></Field>
      <Field label="Vehículo" id="r-v"><Select id="r-v" value={f.vehiculo ?? ''} onChange={set('vehiculo')}><option value="">Todos</option>{VEHICULOS.map((v) => <option key={v.id} value={v.id}>{v.placa} · {v.marca}</option>)}</Select></Field>
      <Field label="Código ruta" id="r-cod"><Input id="r-cod" value={f.codigo ?? ''} onChange={set('codigo')} placeholder="R-1118" /></Field>
    </FilterBar>
  );
}
const filtrarRutas = (f: Record<string, string>) => RUTAS_MES.filter((r) => (!f.desde || r.fecha >= f.desde) && (!f.hasta || r.fecha <= f.hasta) && (!f.zona || r.zona === f.zona)
  && (!f.vehiculo || r.vehiculoId === f.vehiculo) && (!f.codigo || r.codigo.toLowerCase().includes(f.codigo.toLowerCase()))
  && (!f.cliente || r.solicitudes.some((s) => SOLICITUDES.find((x) => x.id === s)?.clienteId === f.cliente)));

export function Rutas() {
  const toast = useToast();
  const [f, setF] = useState<Record<string, string>>({ desde: '2026-11-01', hasta: '2026-11-30' });
  const [sinRecursos, setSinRecursos] = useState(false);
  const [sel, setSel] = useState<Ruta | null>(null);
  const rows = filtrarRutas(f).filter((r) => !sinRecursos || !r.auxiliarId);
  return (
    <>
      <PageHeader eyebrow="Rutas" title={`Rutas programadas (${fmtFecha(f.desde ?? HOY)} – ${fmtFecha(f.hasta ?? HOY)})`} subtitle="Cada vehículo tiene su color. Toque una ruta para ver paradas, tripulación y estado." />
      <FiltrosRutas f={f} setF={setF} />
      <label className="mb-3 flex items-center gap-2 text-[13px] text-muted"><input id="r-sinrec" type="checkbox" checked={sinRecursos} onChange={(e) => setSinRecursos(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--brand))]" /> Solo rutas sin recursos completos (sin auxiliar asignado)</label>
      <MonthCalendar initial={HOY} today={HOY} onEvent={(id) => setSel(RUTAS_MES.find((r) => r.id === id) ?? null)}
        legend={VEHICULOS.map((v) => ({ label: `${v.placa} ${v.marca}`, color: v.color }))}
        events={rows.map((r) => ({ id: r.id, date: r.fecha, label: `${horaRuta(r)} ${vehiculo(r.vehiculoId).placa} ${vehiculo(r.vehiculoId).marca.toUpperCase()}`, sub: estRuta(r.estadoId).nombre, color: r.estadoId === 'e5' ? '#5A5A5A' : vehiculo(r.vehiculoId).color }))} />
      <Fab label="Programar ruta" onClick={() => toast('Constructor de ruta: elija vehículo, tripulación y arrastre solicitudes pendientes en el orden de visita.', 'info')} />
      <DetalleRuta sel={sel} onClose={() => setSel(null)} />
    </>
  );
}

function DetalleRuta({ sel, onClose }: { sel: Ruta | null; onClose: () => void }) {
  return (
    <Sheet open={!!sel} onClose={onClose} title={sel ? `Ruta ${sel.codigo}` : ''}>
      {sel && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap gap-2"><ColorBadge color={estRuta(sel.estadoId).color}>{estRuta(sel.estadoId).nombre}</ColorBadge><ColorBadge color={vehiculo(sel.vehiculoId).color}>{vehiculo(sel.vehiculoId).placa} {vehiculo(sel.vehiculoId).marca}</ColorBadge><Badge>{zona(sel.zona).nombre}</Badge></div>
          <DefList items={[['Fecha', `${fmtFecha(sel.fecha)} · ${horaRuta(sel)}`], ['Vehículo', `${vehiculo(sel.vehiculoId).placa} · ${vehiculo(sel.vehiculoId).tipo}`], ['Conductor', persona(sel.conductorId)?.nombre], ['Auxiliar', persona(sel.auxiliarId)?.nombre ?? 'Sin asignar']]} />
          <ol className="flex flex-col gap-2">
            {sel.solicitudes.map((sid, i) => { const s = SOLICITUDES.find((x) => x.id === sid)!; return (
              <li key={sid} className="flex gap-3 rounded-xl border border-line p-3"><span className="num flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[13px] font-semibold text-brand-ink">{i + 1}</span>
                <div className="min-w-0 text-[13px]"><p className="font-medium">{cliente(s.clienteId).razonSocial}</p><p className="text-muted">{sucursal(s.sucursalId).nombre} · {sucursal(s.sucursalId).municipio} · Sol. {s.numero}</p></div></li>); })}
            <li className="flex gap-3 rounded-xl border border-dashed border-line p-3 text-[13px] text-muted"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2">P</span>Descarga en PSA Los Pinos · Sabana de Torres</li>
          </ol>
        </div>
      )}
    </Sheet>
  );
}

export function InformeRutas() {
  const toast = useToast();
  const [f, setF] = useState<Record<string, string>>({ desde: '2026-11-15', hasta: '2026-11-21' });
  const [sel, setSel] = useState<Ruta | null>(null);
  const rows = filtrarRutas(f).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const cols: Column<Ruta>[] = [
    { key: 'ruta', header: 'Ruta', render: (r) => <span className="num font-medium">{r.codigo}</span>, priority: 3 },
    { key: 'fecha', header: 'Fecha', render: (r) => <span className="num">{fmtFechaCorta(r.fecha)} · {horaRuta(r)}</span>, priority: 1 },
    { key: 'clientes', header: 'Clientes a visitar', render: (r) => <span className="block max-w-[280px] truncate">{clientesRuta(r).join(' · ')}</span>, priority: 3 },
    { key: 'conductor', header: 'Conductor', render: (r) => persona(r.conductorId)?.nombre, priority: 2 },
    { key: 'aux', header: 'Auxiliar', render: (r) => persona(r.auxiliarId)?.nombre ?? <span className="text-bad">Sin asignar</span>, priority: 3 },
    { key: 'placa', header: 'Placa', render: (r) => <ColorBadge color={vehiculo(r.vehiculoId).color}>{vehiculo(r.vehiculoId).placa}</ColorBadge>, priority: 2 },
    { key: 'zona', header: 'Zona', render: (r) => zona(r.zona).nombre, priority: 3 },
    { key: 'estado', header: 'Estado', render: (r) => <ColorBadge color={estRuta(r.estadoId).color}>{estRuta(r.estadoId).nombre}</ColorBadge>, priority: 3 },
  ];
  return (
    <>
      <PageHeader eyebrow="Rutas" title="Informe de programación" subtitle="Ruta, fecha, clientes a visitar, conductor, auxiliar y placa."
        actions={<Button onClick={() => toast('Informe de programación exportado a Excel.', 'info')}><Download size={16} /> Exportar</Button>} />
      <FiltrosRutas f={f} setF={setF} />
      <ResponsiveTable rows={rows} columns={cols} rowKey={(r) => r.id} onRowClick={setSel} cardTitle={(r) => <span className="num">{r.codigo} · {vehiculo(r.vehiculoId).placa}</span>}
        cardBadge={(r) => <ColorBadge color={estRuta(r.estadoId).color}>{estRuta(r.estadoId).nombre}</ColorBadge>} cardMeta={(r) => clientesRuta(r).join(' · ')} />
      <DetalleRuta sel={sel} onClose={() => setSel(null)} />
    </>
  );
}

export function Rastreo() {
  const [tab, setTab] = useState<'vehiculo' | 'carga' | 'descarga' | 'estados'>('vehiculo');
  const [desde, setDesde] = useState('2026-11-12');
  const [hasta, setHasta] = useState(HOY);
  const [sel, setSel] = useState<Ruta | null>(null);
  const rows = RUTAS_MES.filter((r) => r.fecha >= desde && r.fecha <= hasta).sort((a, b) => b.fecha.localeCompare(a.fecha));
  const pasos = (r: Ruta) => { const o = estRuta(r.estadoId).orden; return ESTADOS_RUTA.filter((e) => e.id !== 'e5').map((e, i) => ({ ...e, hecho: r.estadoId !== 'e5' && e.orden <= o, hora: `${6 + i * 2}:${i % 2 ? '35' : '10'}` })); };
  return (
    <>
      <PageHeader eyebrow="Rutas" title="Rastreo de rutas" subtitle="Seguimiento de cada recorrido: estados reportados desde la app del conductor, cargas y descargas." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Desde" id="ra-d"><Input id="ra-d" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></Field>
        <Field label="Hasta" id="ra-h"><Input id="ra-h" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></Field>
      </div>
      <div className="mb-4"><Tabs value={tab} onChange={setTab} items={[{ value: 'vehiculo', label: 'Vehículo' }, { value: 'carga', label: 'Carga' }, { value: 'descarga', label: 'Descarga' }, { value: 'estados', label: 'Estados' }]} /></div>
      <ResponsiveTable rows={rows} rowKey={(r) => r.id} onRowClick={setSel}
        cardTitle={(r) => `${vehiculo(r.vehiculoId).marca.toUpperCase()} · ${vehiculo(r.vehiculoId).placa}`} cardBadge={(r) => <ColorBadge color={estRuta(r.estadoId).color}>{estRuta(r.estadoId).nombre}</ColorBadge>}
        columns={[
          { key: 'r', header: 'Rutas programadas', render: (r) => <span className="font-medium text-brand">{vehiculo(r.vehiculoId).marca.toUpperCase()} – {vehiculo(r.vehiculoId).placa}</span>, priority: 3 },
          { key: 'f', header: 'Fecha', render: (r) => fmtFecha(r.fecha), priority: 1 },
          ...(tab === 'carga' ? [{ key: 'c', header: 'Cargas', render: (r: Ruta) => `${r.solicitudes.length} parada${r.solicitudes.length > 1 ? 's' : ''}`, priority: 2 as const }] : []),
          ...(tab === 'descarga' ? [{ key: 'd', header: 'Descarga', render: () => 'PSA Los Pinos', priority: 2 as const }] : []),
          { key: 'e', header: 'Estado actual', render: (r) => <ColorBadge color={estRuta(r.estadoId).color}>{estRuta(r.estadoId).nombre}</ColorBadge>, priority: 2 },
          { key: 'c2', header: 'Conductor', render: (r) => persona(r.conductorId)?.nombre, priority: 3 },
        ]} />
      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel ? `${vehiculo(sel.vehiculoId).placa} · ${fmtFecha(sel.fecha)}` : ''}>
        {sel && (
          <div className="flex flex-col gap-5">
            <div className="rounded-xl bg-surface-2 p-3 text-[13px]"><p className="flex items-center gap-2 font-medium"><Navigation size={15} className="text-brand" />Última ubicación reportada</p><p className="mt-1 text-muted">{sel.estadoId === 'e1' ? 'La ruta aún no inicia.' : `${sucursal(SOLICITUDES.find((s) => s.id === sel.solicitudes[0])!.sucursalId).municipio} · reporte GPS cada 5 min mientras el estado tenga rastreo continuo.`}</p></div>
            <ol className="relative ml-3 border-l-2 border-line">
              {pasos(sel).map((p) => (
                <li key={p.id} className="mb-4 ml-5">
                  <span className="absolute -left-[11px] flex h-5 w-5 items-center justify-center rounded-full bg-surface">{p.hecho ? <CheckCircle2 size={20} style={{ color: p.color }} /> : <Circle size={18} className="text-line" />}</span>
                  <p className={cx('text-[14px] font-medium', !p.hecho && 'text-subtle')}>{p.nombre}</p>
                  <p className="text-[12px] text-muted">{p.hecho ? p.hora : 'Pendiente'} · {p.descripcion}</p>
                </li>
              ))}
            </ol>
            <div className="flex flex-col gap-2">{sel.solicitudes.map((sid) => { const s = SOLICITUDES.find((x) => x.id === sid)!; return <div key={sid} className="flex items-center gap-2 rounded-lg border border-line p-2.5 text-[13px]"><MapPin size={15} className="text-brand" />{cliente(s.clienteId).razonSocial} · {sucursal(s.sucursalId).municipio}</div>; })}</div>
          </div>
        )}
      </Sheet>
    </>
  );
}

export function EstadosRecorrido() {
  const toast = useToast();
  const [estados, setEstados] = useState(ESTADOS_RUTA.filter((e) => e.id !== 'e1'));
  const upd = (id: string, k: string, v: string | boolean) => setEstados((s) => s.map((x) => x.id === id ? { ...x, [k]: v } : x));
  return (
    <>
      <PageHeader eyebrow="Rutas" title="Estado del recorrido" subtitle="Estados que reporta el conductor desde la app. Los que tienen rastreo continuo envían la ubicación GPS durante el recorrido." />
      <div className="scroll-x rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[720px] text-[13px]">
          <thead className="bg-surface-2 text-left text-[12px] uppercase tracking-[0.04em] text-muted"><tr><th className="px-3 py-2.5">Nombre</th><th className="px-3 py-2.5">Color</th><th className="px-3 py-2.5">Descripción</th><th className="px-3 py-2.5 text-center">Orden</th><th className="px-3 py-2.5 text-center">Rastreo continuo</th><th className="px-3 py-2.5 text-center">Estado</th></tr></thead>
          <tbody>
            {estados.map((e) => (
              <tr key={e.id} className="border-t border-line">
                <td className="px-3 py-2"><Input id={`en-${e.id}`} aria-label="Nombre" value={e.nombre} onChange={(ev) => upd(e.id, 'nombre', ev.target.value)} className="h-9" /></td>
                <td className="px-3 py-2"><input id={`ec-${e.id}`} aria-label="Color" type="color" value={e.color} onChange={(ev) => upd(e.id, 'color', ev.target.value)} className="h-9 w-16 cursor-pointer rounded-md border border-line bg-surface p-1" /></td>
                <td className="px-3 py-2"><Input id={`ed-${e.id}`} aria-label="Descripción" value={e.descripcion} onChange={(ev) => upd(e.id, 'descripcion', ev.target.value)} className="h-9" /></td>
                <td className="num px-3 py-2 text-center">{e.orden}</td>
                <td className="px-3 py-2 text-center"><label className="inline-flex items-center gap-2"><input id={`er-${e.id}`} type="checkbox" checked={e.rastreo} onChange={(ev) => upd(e.id, 'rastreo', ev.target.checked)} className="h-4 w-4 accent-[rgb(var(--brand))]" />{e.rastreo ? 'Activado' : 'Desactivado'}</label></td>
                <td className="px-3 py-2 text-center"><Badge tone="ok">Activo</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex justify-end"><Button variant="primary" onClick={() => toast('Estados del recorrido guardados.')}>Guardar</Button></div>
    </>
  );
}
