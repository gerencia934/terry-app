import { useMemo, useState } from 'react';
import { CalendarDays, Table2, Plus, ArrowRightCircle, GripVertical } from 'lucide-react';
import { MonthCalendar, ResponsiveTable, FilterBar, type Column } from '../components/data';
import { Badge, Button, ColorBadge, DefList, EstadoBadge, Field, Input, PageHeader, Select, Sheet, Tabs, useToast } from '../components/ui';
import { CLIENTES, ESTADOS_RUTA, HOY, RUTAS, SOLICITUDES, VEHICULOS, ZONAS, cliente, decl, estadoRuta, item, persona, sucursal, totalSolicitud, vehiculo, zona, type Ruta, type Solicitud } from '../data/mock';
import { cx, fmtCOP, fmtFecha, fmtFechaCorta, fmtNum } from '../lib/format';
import { uni } from './Declaraciones';

const COLOR_SOL: Record<string, string> = { PENDIENTE: '#B06A00', PROGRAMADA: '#2A78D6', RECOLECTADA: '#15803D', CANCELADA: '#BE2828' };

function VistaToggle({ v, set }: { v: 'tabla' | 'calendario'; set: (v: 'tabla' | 'calendario') => void }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      {([['tabla', <Table2 size={15} />, 'Tabla'], ['calendario', <CalendarDays size={15} />, 'Calendario']] as const).map(([k, ic, l]) => (
        <button key={k} onClick={() => set(k)} aria-pressed={v === k} className={cx('flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium', v === k ? 'bg-brand text-on-brand' : 'text-muted hover:text-fg')}>{ic}{l}</button>
      ))}
    </div>
  );
}

export function Solicitudes() {
  const toast = useToast();
  const [tab, setTab] = useState<'FORMAL' | 'PRE'>('FORMAL');
  const [vista, setVista] = useState<'tabla' | 'calendario'>('tabla');
  const [f, setF] = useState({ cliente: '', estado: '', operacion: '' });
  const [sel, setSel] = useState<Solicitud | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const base = SOLICITUDES.filter((s) => s.clase === tab);
  const rows = useMemo(() => base.filter((s) => (!f.cliente || s.clienteId === f.cliente) && (!f.estado || s.estado === f.estado) && (!f.operacion || s.operacion === f.operacion))
    .sort((a, b) => b.fecha.localeCompare(a.fecha)), [base, f]);

  const cols: Column<Solicitud>[] = [
    { key: 'nro', header: 'Nro', render: (s) => <span className="num font-medium">{s.numero}</span>, priority: 3 },
    { key: 'fecha', header: 'Fecha', render: (s) => <span className="num whitespace-nowrap">{fmtFechaCorta(s.fecha)}</span>, priority: 1 },
    { key: 'cliente', header: 'Cliente', render: (s) => <span className="block max-w-[220px] truncate">{cliente(s.clienteId).razonSocial}</span>, priority: 3 },
    { key: 'suc', header: 'Sucursal', render: (s) => <span className="whitespace-nowrap">{sucursal(s.sucursalId).nombre} · {sucursal(s.sucursalId).municipio}</span>, priority: 3 },
    { key: 'res', header: 'Residuos', render: (s) => <span className="block max-w-[260px] truncate">{s.items.map((i) => item(decl(i.declId).itemId).nombre).join(', ')}</span>, priority: 3 },
    { key: 'cant', header: 'Cantidad', align: 'right', render: (s) => s.items.map((i) => `${fmtNum(i.cantidad)} ${uni(item(decl(i.declId).itemId).unidad)}`).join(' + '), priority: 2 },
    { key: 'total', header: 'Total', align: 'right', render: (s) => fmtCOP(totalSolicitud(s)), priority: 2 },
    { key: 'franja', header: 'Franja', render: (s) => <span className="whitespace-nowrap text-muted">{s.franja}</span>, priority: 3 },
    { key: 'op', header: 'Operación', render: (s) => s.operacion === 'CARGA' ? 'Carga' : 'Descarga', priority: 3 },
    { key: 'estado', header: 'Estado', render: (s) => <EstadoBadge estado={s.estado} />, priority: 3 },
  ];
  const events = rows.filter((s) => s.estado !== 'CANCELADA' || vista === 'calendario').map((s) => ({ id: s.id, date: s.fecha, label: `${s.numero} · ${cliente(s.clienteId).razonSocial}`, sub: s.estado.toLowerCase(), color: COLOR_SOL[s.estado] }));

  return (
    <>
      <PageHeader eyebrow="Logística" title="Solicitudes de recolección" subtitle="Pre-solicitudes del cliente y solicitudes formales confirmadas, listas para programar en ruta."
        actions={<Button variant="primary" onClick={() => toast('Formulario de solicitud: elige cliente → sucursal → declaraciones autorizadas.', 'info')}><Plus size={16} /> Nueva solicitud</Button>} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onChange={(v) => { setTab(v); setSel(null); }} items={[{ value: 'FORMAL', label: 'Solicitudes formales', count: SOLICITUDES.filter((s) => s.clase === 'FORMAL').length }, { value: 'PRE', label: 'Pre-solicitudes', count: SOLICITUDES.filter((s) => s.clase === 'PRE').length }]} />
        <VistaToggle v={vista} set={setVista} />
      </div>
      <FilterBar active={Object.values(f).filter(Boolean).length} onClear={() => setF({ cliente: '', estado: '', operacion: '' })}>
        <Field label="Cliente" id="s-cliente"><Select id="s-cliente" value={f.cliente} onChange={set('cliente')}><option value="">Todos</option>{CLIENTES.map((c) => <option key={c.id} value={c.id}>{c.razonSocial}</option>)}</Select></Field>
        <Field label="Estado" id="s-estado"><Select id="s-estado" value={f.estado} onChange={set('estado')}><option value="">Todos</option>{Object.keys(COLOR_SOL).map((e) => <option key={e} value={e}>{e.charAt(0) + e.slice(1).toLowerCase()}</option>)}</Select></Field>
        <Field label="Operación" id="s-op"><Select id="s-op" value={f.operacion} onChange={set('operacion')}><option value="">Carga y descarga</option><option value="CARGA">Carga</option><option value="DESCARGA">Descarga</option></Select></Field>
      </FilterBar>
      {vista === 'tabla' ? (
        <ResponsiveTable rows={rows} columns={cols} rowKey={(s) => s.id} onRowClick={setSel}
          cardTitle={(s) => cliente(s.clienteId).razonSocial} cardBadge={(s) => <EstadoBadge estado={s.estado} />}
          cardMeta={(s) => <span className="num">N.º {s.numero} · {sucursal(s.sucursalId).municipio} · {s.franja}</span>}
          footer={<div className="num flex justify-between text-[13px]"><span className="text-muted">Total del filtro</span><span className="font-semibold">{fmtCOP(rows.reduce((a, s) => a + totalSolicitud(s), 0))}</span></div>} />
      ) : (
        <MonthCalendar events={events} initial={HOY} today={HOY} onEvent={(id) => setSel(SOLICITUDES.find((s) => s.id === id) ?? null)}
          legend={Object.entries(COLOR_SOL).map(([l, c]) => ({ label: l.charAt(0) + l.slice(1).toLowerCase(), color: c }))} />
      )}
      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel ? `${sel.clase === 'PRE' ? 'Pre-solicitud' : 'Solicitud'} ${sel.numero}` : ''}
        footer={sel && (sel.clase === 'PRE'
          ? <Button variant="primary" onClick={() => { toast(`Pre-solicitud ${sel.numero} convertida en solicitud formal.`); setSel(null); }}><ArrowRightCircle size={16} /> Convertir en solicitud formal</Button>
          : sel.estado === 'PENDIENTE' && <Button variant="primary" onClick={() => { toast(`Solicitud ${sel.numero} enviada a programación de rutas.`); setSel(null); }}><CalendarDays size={16} /> Programar en ruta</Button>)}>
        {sel && (
          <div className="flex flex-col gap-5">
            <div><p className="text-[17px] font-semibold">{cliente(sel.clienteId).razonSocial}</p><p className="text-muted">{sucursal(sel.sucursalId).nombre} · {sucursal(sel.sucursalId).municipio}</p><div className="mt-2"><EstadoBadge estado={sel.estado} /></div></div>
            <DefList items={[['Fecha', fmtFecha(sel.fecha)], ['Franja', sel.franja], ['Operación', sel.operacion === 'CARGA' ? 'Carga (recolección)' : 'Descarga'], ['Contacto', `${sucursal(sel.sucursalId).contacto} · ${sucursal(sel.sucursalId).telefono}`], ...(sel.causal ? [['Causal', sel.causal]] as [string, string][] : [])]} />
            <div className="rounded-xl border border-line">
              {sel.items.map((i) => { const d = decl(i.declId); const it = item(d.itemId); return (
                <div key={i.declId} className="flex justify-between gap-3 border-b border-line px-3 py-2.5 text-[13px] last:border-0">
                  <div className="min-w-0"><p className="font-medium">{it.nombre}</p><p className="text-muted">{fmtNum(i.cantidad)} {uni(it.unidad)} × {fmtCOP(d.precio)}</p></div>
                  <span className="num shrink-0 font-medium">{fmtCOP(i.cantidad * d.precio)}</span>
                </div>); })}
              <div className="num flex justify-between bg-surface-2 px-3 py-2.5 text-[14px] font-semibold"><span>Total</span><span>{fmtCOP(totalSolicitud(sel))}</span></div>
            </div>
          </div>
        )}
      </Sheet>
    </>
  );
}

export function Rutas() {
  const toast = useToast();
  const [tab, setTab] = useState<'calendario' | 'informe' | 'estados'>('informe');
  const [f, setF] = useState({ fecha: '', vehiculo: '', zona: '' });
  const [estados, setEstados] = useState(ESTADOS_RUTA);
  const [sel, setSel] = useState<Ruta | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const est = (id: string) => estados.find((e) => e.id === id) ?? estadoRuta(id);
  const rows = useMemo(() => RUTAS.filter((r) => (!f.fecha || r.fecha === f.fecha) && (!f.vehiculo || r.vehiculoId === f.vehiculo) && (!f.zona || r.zona === f.zona)).sort((a, b) => b.fecha.localeCompare(a.fecha)), [f]);
  const clientes = (r: Ruta) => r.solicitudes.map((s) => cliente(SOLICITUDES.find((x) => x.id === s)!.clienteId).razonSocial);

  const cols: Column<Ruta>[] = [
    { key: 'ruta', header: 'Ruta', render: (r) => <span className="num font-medium">{r.codigo}</span>, priority: 3 },
    { key: 'fecha', header: 'Fecha', render: (r) => <span className="num whitespace-nowrap">{fmtFechaCorta(r.fecha)}</span>, priority: 1 },
    { key: 'clientes', header: 'Clientes a visitar', render: (r) => <span className="block max-w-[280px] truncate">{clientes(r).join(' · ')}</span>, priority: 3 },
    { key: 'paradas', header: 'Paradas', align: 'center', render: (r) => r.solicitudes.length, priority: 3 },
    { key: 'conductor', header: 'Conductor', render: (r) => <span className="whitespace-nowrap">{persona(r.conductorId)?.nombre}</span>, priority: 2 },
    { key: 'aux', header: 'Auxiliar', render: (r) => <span className="whitespace-nowrap">{persona(r.auxiliarId)?.nombre ?? '—'}</span>, priority: 3 },
    { key: 'placa', header: 'Placa', render: (r) => <span className="num rounded-md bg-surface-2 px-2 py-0.5 font-medium">{vehiculo(r.vehiculoId).placa}</span>, priority: 2 },
    { key: 'zona', header: 'Zona', render: (r) => <span className="whitespace-nowrap">{zona(r.zona).nombre}</span>, priority: 3 },
    { key: 'estado', header: 'Estado', render: (r) => <ColorBadge color={est(r.estadoId).color}>{est(r.estadoId).nombre}</ColorBadge>, priority: 3 },
  ];

  return (
    <>
      <PageHeader eyebrow="Logística" title="Rutas programadas" subtitle="Programación de recorridos por vehículo, tripulación y zona."
        actions={<Button variant="primary" onClick={() => toast('Constructor de rutas: arrastre solicitudes pendientes al vehículo y ordene las paradas.', 'info')}><Plus size={16} /> Programar ruta</Button>} />
      <div className="mb-4"><Tabs value={tab} onChange={setTab} items={[{ value: 'informe', label: 'Informe de programación' }, { value: 'calendario', label: 'Calendario' }, { value: 'estados', label: 'Estados del recorrido' }]} /></div>
      {tab !== 'estados' && (
        <FilterBar active={Object.values(f).filter(Boolean).length} onClear={() => setF({ fecha: '', vehiculo: '', zona: '' })}>
          <Field label="Fecha" id="r-fecha"><Input id="r-fecha" type="date" value={f.fecha} onChange={set('fecha')} /></Field>
          <Field label="Vehículo" id="r-veh"><Select id="r-veh" value={f.vehiculo} onChange={set('vehiculo')}><option value="">Todos</option>{VEHICULOS.map((v) => <option key={v.id} value={v.id}>{v.placa} · {v.tipo}</option>)}</Select></Field>
          <Field label="Zona" id="r-zona"><Select id="r-zona" value={f.zona} onChange={set('zona')}><option value="">Todas</option>{ZONAS.map((z) => <option key={z.id} value={z.id}>{z.nombre}</option>)}</Select></Field>
        </FilterBar>
      )}
      {tab === 'informe' && (
        <ResponsiveTable rows={rows} columns={cols} rowKey={(r) => r.id} onRowClick={setSel}
          cardTitle={(r) => <span className="num">{r.codigo}</span>} cardBadge={(r) => <ColorBadge color={est(r.estadoId).color}>{est(r.estadoId).nombre}</ColorBadge>}
          cardMeta={(r) => clientes(r).join(' · ')} />
      )}
      {tab === 'calendario' && (
        <MonthCalendar initial={HOY} today={HOY} onEvent={(id) => setSel(RUTAS.find((r) => r.id === id) ?? null)}
          events={rows.map((r) => ({ id: r.id, date: r.fecha, label: `${r.codigo} · ${vehiculo(r.vehiculoId).placa}`, sub: persona(r.conductorId)?.nombre, color: est(r.estadoId).color }))}
          legend={estados.map((e) => ({ label: e.nombre, color: e.color }))} />
      )}
      {tab === 'estados' && (
        <div className="max-w-2xl rounded-xl border border-line bg-surface">
          <p className="border-b border-line px-4 py-3 text-[13px] text-muted">Defina el nombre y el color de cada estado. El orden determina el flujo del recorrido; un estado mayor a «Programada» exige preoperacional aprobado.</p>
          <ul className="divide-y divide-line">
            {estados.map((e, i) => (
              <li key={e.id} className="flex items-center gap-3 px-4 py-3">
                <GripVertical size={16} className="shrink-0 text-subtle" />
                <span className="num w-5 text-[13px] text-muted">{i + 1}</span>
                <Input id={`est-${e.id}`} aria-label="Nombre del estado" value={e.nombre} className="flex-1" onChange={(ev) => setEstados((s) => s.map((x) => x.id === e.id ? { ...x, nombre: ev.target.value } : x))} />
                <input id={`estc-${e.id}`} aria-label="Color" type="color" value={e.color} onChange={(ev) => setEstados((s) => s.map((x) => x.id === e.id ? { ...x, color: ev.target.value } : x))} className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-line bg-surface p-1" />
                <span className="hidden sm:block"><ColorBadge color={e.color}>{e.nombre || 'Sin nombre'}</ColorBadge></span>
              </li>
            ))}
          </ul>
          <div className="flex justify-end border-t border-line px-4 py-3"><Button variant="primary" onClick={() => toast('Estados del recorrido guardados.')}>Guardar estados</Button></div>
        </div>
      )}
      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel ? `Ruta ${sel.codigo}` : ''}>
        {sel && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2"><ColorBadge color={est(sel.estadoId).color}>{est(sel.estadoId).nombre}</ColorBadge><Badge>{zona(sel.zona).nombre}</Badge></div>
            <DefList items={[['Fecha', fmtFecha(sel.fecha)], ['Vehículo', `${vehiculo(sel.vehiculoId).placa} · ${vehiculo(sel.vehiculoId).tipo}`], ['Conductor', persona(sel.conductorId)?.nombre], ['Auxiliar', persona(sel.auxiliarId)?.nombre ?? '—'], ['Salida', sel.salida ?? 'Pendiente']]} />
            <div>
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">Paradas</p>
              <ol className="flex flex-col gap-2">
                {sel.solicitudes.map((sid, i) => { const s = SOLICITUDES.find((x) => x.id === sid)!; return (
                  <li key={sid} className="flex gap-3 rounded-xl border border-line p-3">
                    <span className="num flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[13px] font-semibold text-brand-ink">{i + 1}</span>
                    <div className="min-w-0 text-[13px]"><p className="font-medium">{cliente(s.clienteId).razonSocial}</p><p className="text-muted">{sucursal(s.sucursalId).nombre} · {sucursal(s.sucursalId).municipio} · {s.franja}</p></div>
                  </li>); })}
                <li className="flex gap-3 rounded-xl border border-dashed border-line p-3 text-[13px] text-muted"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2">P</span>Descarga en PSA Los Pinos · Sabana de Torres</li>
              </ol>
            </div>
          </div>
        )}
      </Sheet>
    </>
  );
}
