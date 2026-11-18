import { useMemo, useState } from 'react';
import { Download, Truck, PackageOpen, MapPin, Navigation, Upload, CheckCircle2, Circle, Plus, CalendarDays, Table2 } from 'lucide-react';
import { MonthCalendar, ResponsiveTable, FilterBar, type Column } from '../components/data';
import { Badge, Button, ColorBadge, DefList, Field, Input, PageHeader, Select, Sheet, useToast, type Tone } from '../components/ui';
import {
  CLIENTES, ESTADOS_RUTA, HOY, RUTAS_MES, SOLICITUDES, VEHICULOS, ZONAS, cliente, decl, etiquetaEstado, horaRuta, item, jornada, manejo,
  ordenCompra, persona, sucursal, tipoSolicitud, totalSolicitud, vehiculo, zona, type Ruta, type Solicitud,
} from '../data/mock';
import { useRouter } from '../lib/router';
import { cx, fmtCOP, fmtFecha, fmtFechaCorta, fmtNum } from '../lib/format';
import { uni } from './Declaraciones';

// Colores propios del calendario de solicitudes
const LEYENDA_SOL = [
  { label: 'Recolección', color: '#1E7838' }, { label: 'Por frecuencia', color: '#0F8B8D' }, { label: 'Entrega en planta', color: '#6250D6' },
  { label: 'Pendiente', color: '#B06A00' }, { label: 'Cancelada', color: '#8A958F' },
];
const colorSol = (s: Solicitud) => {
  const e = etiquetaEstado(s);
  if (e === 'Cancelada') return '#8A958F';
  if (e === 'Pendiente' || e === 'Por confirmar') return '#B06A00';
  const t = tipoSolicitud(s); return t === 'Entrega en planta' ? '#6250D6' : t === 'Por frecuencia' ? '#0F8B8D' : '#1E7838';
};
const TONO: Record<string, Tone> = { Programada: 'info', Recolectada: 'ok', Pendiente: 'warn', 'Por confirmar': 'warn', Cancelada: 'neutral' };
const EstadoSol = ({ s }: { s: Solicitud }) => <Badge tone={TONO[etiquetaEstado(s)]} dot>{etiquetaEstado(s)}</Badge>;
const cantTotal = (s: Solicitud) => { const u = uni(item(decl(s.items[0].declId).itemId).unidad); return `${fmtNum(s.items.reduce((a, i) => a + i.cantidad, 0))} ${u}`; };
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function Vista({ v, set }: { v: 'tabla' | 'calendario'; set: (v: 'tabla' | 'calendario') => void }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      {([['tabla', Table2, 'Tabla'], ['calendario', CalendarDays, 'Calendario']] as const).map(([k, I, l]) => (
        <button key={k} onClick={() => set(k)} aria-pressed={v === k} className={cx('flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium', v === k ? 'bg-brand text-on-brand' : 'text-muted hover:text-fg')}><I size={15} />{l}</button>
      ))}
    </div>
  );
}

function NuevaSolicitud({ abierta, cerrar }: { abierta: boolean; cerrar: () => void }) {
  const toast = useToast();
  const [modo, setModo] = useState<'rec' | 'ent'>('rec');
  return (
    <Sheet open={abierta} onClose={cerrar} title="Nueva solicitud"
      footer={<Button variant="primary" onClick={() => { cerrar(); toast(modo === 'rec' ? 'Siguiente paso: cliente → sede → residuos autorizados → fecha y franja.' : 'Siguiente paso: cliente → residuos autorizados → fecha de llegada a planta.', 'info'); }}>Continuar</Button>}>
      <p className="mb-3 text-[13px] text-muted">Modalidad del servicio</p>
      <div className="grid gap-2">
        {([['rec', Truck, 'Recolección en la sede', 'Un vehículo de Terra Viva va por el residuo.'], ['ent', PackageOpen, 'Entrega en planta', 'El cliente lleva el residuo a PSA Los Pinos.']] as const).map(([k, I, t, d]) => (
          <label key={k} className={cx('flex cursor-pointer items-start gap-3 rounded-xl border p-3', modo === k ? 'border-brand bg-brand-soft/50' : 'border-line')}>
            <input type="radio" name="modo-sol" className="mt-1 accent-[rgb(var(--brand))]" checked={modo === k} onChange={() => setModo(k)} />
            <I size={20} className="mt-0.5 shrink-0 text-brand" /><span><span className="block font-medium">{t}</span><span className="block text-[13px] text-muted">{d}</span></span>
          </label>
        ))}
      </div>
    </Sheet>
  );
}

export function Solicitudes() {
  const toast = useToast();
  const { go } = useRouter();
  const [vista, setVista] = useState<'tabla' | 'calendario'>('tabla');
  const [f, setF] = useState({ desde: '2026-11-01', hasta: '2026-11-30', cliente: '', numero: '', tipo: '', estado: '' });
  const [sel, setSel] = useState<Solicitud | null>(null);
  const [nueva, setNueva] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const formales = SOLICITUDES.filter((s) => s.clase === 'FORMAL');
  const rows = useMemo(() => formales.filter((s) => (!f.desde || s.fecha >= f.desde) && (!f.hasta || s.fecha <= f.hasta) && (!f.cliente || s.clienteId === f.cliente)
    && (!f.numero || String(s.numero).includes(f.numero)) && (!f.tipo || tipoSolicitud(s) === f.tipo) && (!f.estado || etiquetaEstado(s) === f.estado))
    .sort((a, b) => a.fecha.localeCompare(b.fecha)), [formales, f]);

  const cols: Column<Solicitud>[] = [
    { key: 'fecha', header: 'Fecha', render: (s) => <span className="num font-medium">{fmtFechaCorta(s.fecha)}</span>, priority: 1 },
    { key: 'nro', header: 'N.º', render: (s) => <span className="num text-muted">{s.numero}</span>, priority: 3 },
    { key: 'cliente', header: 'Cliente', render: (s) => <span className="block max-w-[220px] truncate font-medium">{cliente(s.clienteId).razonSocial}</span>, priority: 3 },
    { key: 'suc', header: 'Sede', render: (s) => <span className="block max-w-[200px] truncate">{sucursal(s.sucursalId).nombre} · {sucursal(s.sucursalId).municipio}</span>, priority: 3 },
    { key: 'res', header: 'Residuos', render: (s) => <span className="block max-w-[220px] truncate">{s.items.map((i) => item(decl(i.declId).itemId).nombre).join(', ')}</span>, priority: 3 },
    { key: 'cant', header: 'Cantidad', align: 'right', render: (s) => cantTotal(s), priority: 2 },
    { key: 'franja', header: 'Franja', render: (s) => <span className="text-muted">{s.franja}</span>, priority: 3 },
    { key: 'modo', header: 'Modalidad', render: (s) => tipoSolicitud(s), priority: 3 },
    { key: 'trat', header: 'Tratamiento', render: (s) => <span className="block max-w-[200px] truncate text-muted">{manejo(item(decl(s.items[0].declId).itemId).manejo).nombre}</span>, priority: 3 },
    { key: 'valor', header: 'Valor estimado', align: 'right', render: (s) => fmtCOP(totalSolicitud(s)), priority: 2 },
    { key: 'estado', header: 'Estado', render: (s) => <EstadoSol s={s} />, priority: 3 },
  ];

  return (
    <>
      <PageHeader eyebrow="Logística" title="Solicitudes" subtitle={`Servicios pedidos entre el ${fmtFecha(f.desde)} y el ${fmtFecha(f.hasta)}.`}
        actions={<><Button onClick={() => go('importar')}><Upload size={16} /> Importar</Button><Button onClick={() => toast('Excel de solicitudes generado con los filtros actuales.', 'info')}><Download size={16} /> Exportar</Button><Button variant="primary" onClick={() => setNueva(true)}><Plus size={16} /> Nueva solicitud</Button></>} />
      <FilterBar active={[f.cliente, f.numero, f.tipo, f.estado].filter(Boolean).length} onClear={() => setF({ desde: '2026-11-01', hasta: '2026-11-30', cliente: '', numero: '', tipo: '', estado: '' })}>
        <Field label="Desde" id="s-desde"><Input id="s-desde" type="date" value={f.desde} onChange={set('desde')} /></Field>
        <Field label="Hasta" id="s-hasta"><Input id="s-hasta" type="date" value={f.hasta} onChange={set('hasta')} /></Field>
        <Field label="Cliente" id="s-cli"><Select id="s-cli" value={f.cliente} onChange={set('cliente')}><option value="">Todos</option>{CLIENTES.map((c) => <option key={c.id} value={c.id}>{c.razonSocial}</option>)}</Select></Field>
        <Field label="N.º" id="s-num"><Input id="s-num" inputMode="numeric" value={f.numero} onChange={set('numero')} placeholder="5112" /></Field>
        <Field label="Modalidad" id="s-tipo"><Select id="s-tipo" value={f.tipo} onChange={set('tipo')}><option value="">Todas</option><option>Recolección</option><option>Por frecuencia</option><option>Entrega en planta</option></Select></Field>
        <Field label="Estado" id="s-est"><Select id="s-est" value={f.estado} onChange={set('estado')}><option value="">Todos</option><option>Pendiente</option><option>Programada</option><option>Recolectada</option><option>Cancelada</option></Select></Field>
      </FilterBar>
      <div className="mb-3 flex justify-end"><Vista v={vista} set={setVista} /></div>
      {vista === 'tabla' ? (
        <ResponsiveTable rows={rows} columns={cols} rowKey={(s) => s.id} onRowClick={setSel}
          cardTitle={(s) => cliente(s.clienteId).razonSocial} cardBadge={(s) => <EstadoSol s={s} />}
          cardMeta={(s) => <span className="num">{fmtFechaCorta(s.fecha)} · {sucursal(s.sucursalId).municipio} · {s.franja}</span>}
          footer={<div className="num flex justify-between text-[13px]"><span className="text-muted">Valor estimado del filtro</span><span className="font-semibold">{fmtCOP(rows.reduce((a, s) => a + totalSolicitud(s), 0))}</span></div>} />
      ) : (
        <MonthCalendar initial={HOY} today={HOY} legend={LEYENDA_SOL} onEvent={(id) => setSel(SOLICITUDES.find((s) => s.id === id) ?? null)}
          events={rows.map((s) => ({ id: s.id, date: s.fecha, label: cliente(s.clienteId).razonSocial, sub: `${jornada(s)} · ${sucursal(s.sucursalId).municipio}`, color: colorSol(s) }))} />
      )}
      <NuevaSolicitud abierta={nueva} cerrar={() => setNueva(false)} />
      <DetalleSolicitud sel={sel} onClose={() => setSel(null)} />
    </>
  );
}

function DetalleSolicitud({ sel, onClose }: { sel: Solicitud | null; onClose: () => void }) {
  const toast = useToast();
  return (
    <Sheet open={!!sel} onClose={onClose} title={sel ? `Solicitud ${sel.numero}` : ''}
      footer={sel && (etiquetaEstado(sel) === 'Pendiente' || etiquetaEstado(sel) === 'Por confirmar') && <Button variant="primary" onClick={() => { toast(`Solicitud ${sel.numero} enviada a programación.`); onClose(); }}>Programar</Button>}>
      {sel && (
        <div className="flex flex-col gap-5">
          <div><p className="text-[17px] font-semibold">{cliente(sel.clienteId).razonSocial}</p><p className="text-muted">{sucursal(sel.sucursalId).nombre} · {sucursal(sel.sucursalId).municipio}</p>
            <div className="mt-2 flex gap-2"><EstadoSol s={sel} /><Badge>{tipoSolicitud(sel)}</Badge></div></div>
          <DefList items={[['Fecha', fmtFecha(sel.fecha)], ['Franja', sel.franja], ['Orden de compra', ordenCompra(sel) || '—'], ['Contacto', `${sucursal(sel.sucursalId).contacto} · ${sucursal(sel.sucursalId).telefono}`], ...(sel.causal ? [['Motivo', sel.causal]] as [string, string][] : [])]} />
          <div className="rounded-xl border border-line">
            {sel.items.map((i) => { const d = decl(i.declId); const it = item(d.itemId); return (
              <div key={i.declId} className="flex justify-between gap-3 border-b border-line px-3 py-2.5 text-[13px] last:border-0">
                <div className="min-w-0"><p className="font-medium">{it.nombre}</p><p className="text-muted">{fmtNum(i.cantidad)} {uni(it.unidad)} · {manejo(it.manejo).nombre}</p></div>
                <span className="num shrink-0 font-medium">{fmtCOP(i.cantidad * d.precio)}</span>
              </div>); })}
            <div className="num flex justify-between bg-surface-2 px-3 py-2.5 text-[14px] font-semibold"><span>Total estimado</span><span>{fmtCOP(totalSolicitud(sel))}</span></div>
          </div>
        </div>
      )}
    </Sheet>
  );
}

export function PorConfirmar() {
  const toast = useToast();
  const [cli, setCli] = useState('');
  const [sel, setSel] = useState<Solicitud | null>(null);
  const rows = SOLICITUDES.filter((s) => s.clase === 'PRE' && (!cli || s.clienteId === cli)).sort((a, b) => a.fecha.localeCompare(b.fecha));
  return (
    <>
      <PageHeader eyebrow="Logística" title="Por confirmar" subtitle="Pedidos que llegan del portal del cliente o que genera la frecuencia pactada. Confírmelos para que pasen a programación." />
      <div className="mb-4 max-w-sm"><Field label="Cliente" id="pc-c"><Select id="pc-c" value={cli} onChange={(e) => setCli(e.target.value)}><option value="">Todos</option>{CLIENTES.map((c) => <option key={c.id} value={c.id}>{c.razonSocial}</option>)}</Select></Field></div>
      <ResponsiveTable rows={rows} rowKey={(s) => s.id} onRowClick={setSel} cardTitle={(s) => cliente(s.clienteId).razonSocial} cardMeta={(s) => `Para el ${fmtFecha(s.fecha)}`}
        columns={[
          { key: 'p', header: 'Para el', render: (s) => <span className="num font-medium">{fmtFechaCorta(s.fecha)}</span>, priority: 1 },
          { key: 'c', header: 'Cliente', render: (s) => <span className="font-medium">{cliente(s.clienteId).razonSocial}</span>, priority: 3 },
          { key: 'v', header: 'Sede', render: (s) => sucursal(s.sucursalId).nombre, priority: 3 },
          { key: 'r', header: 'Residuo o servicio', render: (s) => item(decl(s.items[0].declId).itemId).nombre, priority: 2 },
          { key: 'a', header: 'Se activa', render: (s) => <span className="num text-muted">{fmtFechaCorta(addDays(s.fecha, -3))}</span>, priority: 3 },
          { key: 'o', header: 'Origen', render: (s) => (s.numero % 2 ? 'Portal del cliente' : 'Frecuencia pactada'), priority: 3 },
        ]} />
      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel ? `Pedido ${sel.numero}` : ''}
        footer={sel && <Button variant="primary" onClick={() => { toast(`Pedido ${sel.numero} confirmado como solicitud.`); setSel(null); }}>Confirmar solicitud</Button>}>
        {sel && <DefList items={[['Cliente', cliente(sel.clienteId).razonSocial], ['Sede', sucursal(sel.sucursalId).nombre], ['Residuo o servicio', item(decl(sel.items[0].declId).itemId).nombre], ['Cantidad', cantTotal(sel)], ['Para el', fmtFecha(sel.fecha)]]} />}
      </Sheet>
    </>
  );
}

// ---------------------------- PROGRAMACIÓN ----------------------------
const clientesRuta = (r: Ruta) => r.solicitudes.map((s) => cliente(SOLICITUDES.find((x) => x.id === s)!.clienteId).razonSocial);
const etapa = (id: string) => ESTADOS_RUTA.find((e) => e.id === id)!;
const evento = (r: Ruta) => `${vehiculo(r.vehiculoId).placa} · ${horaRuta(r)}`;

function FiltrosRutas({ f, setF }: { f: Record<string, string>; setF: (fn: (s: Record<string, string>) => Record<string, string>) => void }) {
  const set = (k: string) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <FilterBar active={Object.entries(f).filter(([k, v]) => v && !['desde', 'hasta'].includes(k)).length} onClear={() => setF(() => ({ desde: '2026-11-01', hasta: '2026-11-30' }))}>
      <Field label="Desde" id="r-d"><Input id="r-d" type="date" value={f.desde ?? ''} onChange={set('desde')} /></Field>
      <Field label="Hasta" id="r-h"><Input id="r-h" type="date" value={f.hasta ?? ''} onChange={set('hasta')} /></Field>
      <Field label="Vehículo" id="r-v"><Select id="r-v" value={f.vehiculo ?? ''} onChange={set('vehiculo')}><option value="">Toda la flota</option>{VEHICULOS.map((v) => <option key={v.id} value={v.id}>{v.placa} · {v.tipo}</option>)}</Select></Field>
      <Field label="Zona" id="r-z"><Select id="r-z" value={f.zona ?? ''} onChange={set('zona')}><option value="">Todas</option>{ZONAS.map((z) => <option key={z.id} value={z.id}>{z.nombre}</option>)}</Select></Field>
      <Field label="Cliente" id="r-c"><Select id="r-c" value={f.cliente ?? ''} onChange={set('cliente')}><option value="">Todos</option>{CLIENTES.map((c) => <option key={c.id} value={c.id}>{c.razonSocial}</option>)}</Select></Field>
    </FilterBar>
  );
}
const filtrarRutas = (f: Record<string, string>) => RUTAS_MES.filter((r) => (!f.desde || r.fecha >= f.desde) && (!f.hasta || r.fecha <= f.hasta) && (!f.zona || r.zona === f.zona)
  && (!f.vehiculo || r.vehiculoId === f.vehiculo) && (!f.cliente || r.solicitudes.some((s) => SOLICITUDES.find((x) => x.id === s)?.clienteId === f.cliente)));

export function Programacion() {
  const toast = useToast();
  const [f, setF] = useState<Record<string, string>>({ desde: '2026-11-01', hasta: '2026-11-30' });
  const [incompletas, setIncompletas] = useState(false);
  const [sel, setSel] = useState<Ruta | null>(null);
  const rows = filtrarRutas(f).filter((r) => !incompletas || !r.auxiliarId);
  return (
    <>
      <PageHeader eyebrow="Logística" title="Programación" subtitle="Recorridos del mes por vehículo. Cada vehículo conserva su color."
        actions={<Button variant="primary" onClick={() => toast('Arme la ruta: vehículo, tripulación y solicitudes pendientes en el orden de visita.', 'info')}><Plus size={16} /> Programar recorrido</Button>} />
      <FiltrosRutas f={f} setF={setF} />
      <label className="mb-3 flex items-center gap-2 text-[13px] text-muted"><input id="r-inc" type="checkbox" checked={incompletas} onChange={(e) => setIncompletas(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--brand))]" /> Solo recorridos con tripulación incompleta</label>
      <MonthCalendar initial={HOY} today={HOY} onEvent={(id) => setSel(RUTAS_MES.find((r) => r.id === id) ?? null)}
        legend={VEHICULOS.map((v) => ({ label: v.placa, color: v.color }))}
        events={rows.map((r) => ({ id: r.id, date: r.fecha, label: evento(r), sub: clientesRuta(r)[0], color: r.estadoId === 'e5' ? '#8A958F' : vehiculo(r.vehiculoId).color }))} />
      <DetalleRuta sel={sel} onClose={() => setSel(null)} />
    </>
  );
}

function DetalleRuta({ sel, onClose }: { sel: Ruta | null; onClose: () => void }) {
  return (
    <Sheet open={!!sel} onClose={onClose} title={sel ? `Recorrido ${sel.codigo}` : ''}>
      {sel && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap gap-2"><ColorBadge color={etapa(sel.estadoId).color}>{etapa(sel.estadoId).nombre}</ColorBadge><ColorBadge color={vehiculo(sel.vehiculoId).color}>{vehiculo(sel.vehiculoId).placa}</ColorBadge><Badge>{zona(sel.zona).nombre}</Badge></div>
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

export function ProgramacionTabla() {
  const toast = useToast();
  const [f, setF] = useState<Record<string, string>>({ desde: '2026-11-15', hasta: '2026-11-21' });
  const [sel, setSel] = useState<Ruta | null>(null);
  const rows = filtrarRutas(f).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const cols: Column<Ruta>[] = [
    { key: 'fecha', header: 'Fecha', render: (r) => <span className="num font-medium">{fmtFechaCorta(r.fecha)} · {horaRuta(r)}</span>, priority: 1 },
    { key: 'placa', header: 'Vehículo', render: (r) => <ColorBadge color={vehiculo(r.vehiculoId).color}>{vehiculo(r.vehiculoId).placa}</ColorBadge>, priority: 2 },
    { key: 'conductor', header: 'Conductor', render: (r) => persona(r.conductorId)?.nombre, priority: 2 },
    { key: 'aux', header: 'Auxiliar', render: (r) => persona(r.auxiliarId)?.nombre ?? <span className="text-bad">Sin asignar</span>, priority: 3 },
    { key: 'clientes', header: 'Paradas', render: (r) => <span className="block max-w-[300px] truncate">{clientesRuta(r).join(' → ')}</span>, priority: 3 },
    { key: 'zona', header: 'Zona', render: (r) => zona(r.zona).nombre, priority: 3 },
    { key: 'etapa', header: 'Etapa', render: (r) => <ColorBadge color={etapa(r.estadoId).color}>{etapa(r.estadoId).nombre}</ColorBadge>, priority: 3 },
    { key: 'ruta', header: 'Código', render: (r) => <span className="num text-muted">{r.codigo}</span>, priority: 3 },
  ];
  return (
    <>
      <PageHeader eyebrow="Logística" title="Programación en tabla" subtitle="La misma programación en formato de lista, para revisar tripulaciones y exportar."
        actions={<Button onClick={() => toast('Programación exportada a Excel.', 'info')}><Download size={16} /> Exportar</Button>} />
      <FiltrosRutas f={f} setF={setF} />
      <ResponsiveTable rows={rows} columns={cols} rowKey={(r) => r.id} onRowClick={setSel} cardTitle={(r) => <span className="num">{fmtFechaCorta(r.fecha)} · {vehiculo(r.vehiculoId).placa}</span>}
        cardBadge={(r) => <ColorBadge color={etapa(r.estadoId).color}>{etapa(r.estadoId).nombre}</ColorBadge>} cardMeta={(r) => clientesRuta(r).join(' → ')} />
      <DetalleRuta sel={sel} onClose={() => setSel(null)} />
    </>
  );
}

export function Seguimiento() {
  const [sel, setSel] = useState<Ruta | null>(null);
  const hoy = RUTAS_MES.filter((r) => r.fecha === HOY);
  const recientes = RUTAS_MES.filter((r) => r.fecha < HOY && r.fecha >= '2026-11-12').sort((a, b) => b.fecha.localeCompare(a.fecha));
  const pasos = (r: Ruta) => { const o = etapa(r.estadoId).orden; return ESTADOS_RUTA.filter((e) => e.id !== 'e5').map((e, i) => ({ ...e, hecho: r.estadoId !== 'e5' && e.orden <= o, hora: `${6 + i * 2}:${i % 2 ? '35' : '10'}` })); };
  const Tarjeta = ({ r }: { r: Ruta }) => { const e = etapa(r.estadoId); const p = pasos(r); const idx = p.filter((x) => x.hecho).length; return (
    <button onClick={() => setSel(r)} className="flex w-full min-w-0 flex-col gap-3 rounded-xl border border-line bg-surface p-4 text-left hover:border-brand">
      <div className="flex items-center gap-2"><span className="num rounded-md px-2 py-0.5 text-[12px] font-semibold text-white" style={{ background: vehiculo(r.vehiculoId).color }}>{vehiculo(r.vehiculoId).placa}</span><span className="text-[13px] font-medium">{persona(r.conductorId)?.nombre}</span><span className="ml-auto"><ColorBadge color={e.color}>{e.nombre}</ColorBadge></span></div>
      <p className="truncate text-[12px] text-muted">{clientesRuta(r).join(' → ')}</p>
      <div className="flex gap-1">{p.map((x, i) => <span key={x.id} className={cx('h-1.5 flex-1 rounded-full', i < idx ? 'bg-brand' : 'bg-surface-2')} />)}</div>
    </button>); };
  return (
    <>
      <PageHeader eyebrow="Logística" title="Seguimiento" subtitle="Recorridos de hoy según las etapas que reporta la app del conductor." />
      <h2 className="mb-3 text-[15px] font-semibold">Hoy · {fmtFecha(HOY)}</h2>
      <div className="mb-7 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{hoy.map((r) => <Tarjeta key={r.id} r={r} />)}</div>
      <h2 className="mb-3 text-[15px] font-semibold">Últimos días</h2>
      <ResponsiveTable rows={recientes} rowKey={(r) => r.id} onRowClick={setSel} cardTitle={(r) => `${vehiculo(r.vehiculoId).placa} · ${fmtFechaCorta(r.fecha)}`} cardBadge={(r) => <ColorBadge color={etapa(r.estadoId).color}>{etapa(r.estadoId).nombre}</ColorBadge>}
        columns={[
          { key: 'f', header: 'Fecha', render: (r) => fmtFecha(r.fecha), priority: 1 },
          { key: 'v', header: 'Vehículo', render: (r) => <ColorBadge color={vehiculo(r.vehiculoId).color}>{vehiculo(r.vehiculoId).placa}</ColorBadge>, priority: 3 },
          { key: 'c', header: 'Conductor', render: (r) => persona(r.conductorId)?.nombre, priority: 2 },
          { key: 'p', header: 'Paradas', align: 'center', render: (r) => r.solicitudes.length, priority: 3 },
          { key: 'e', header: 'Etapa final', render: (r) => <ColorBadge color={etapa(r.estadoId).color}>{etapa(r.estadoId).nombre}</ColorBadge>, priority: 3 },
        ]} />
      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel ? `${vehiculo(sel.vehiculoId).placa} · ${fmtFecha(sel.fecha)}` : ''}>
        {sel && (
          <div className="flex flex-col gap-5">
            <div className="rounded-xl bg-surface-2 p-3 text-[13px]"><p className="flex items-center gap-2 font-medium"><Navigation size={15} className="text-brand" />Última ubicación</p><p className="mt-1 text-muted">{sel.estadoId === 'e1' ? 'El recorrido aún no inicia.' : `${sucursal(SOLICITUDES.find((s) => s.id === sel.solicitudes[0])!.sucursalId).municipio} · la app envía la ubicación mientras la etapa lo tenga activado.`}</p></div>
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

export function Etapas() {
  const toast = useToast();
  const [estados, setEstados] = useState(ESTADOS_RUTA);
  const upd = (id: string, k: string, v: string | boolean) => setEstados((s) => s.map((x) => x.id === id ? { ...x, [k]: v } : x));
  return (
    <>
      <PageHeader eyebrow="Ajustes" title="Etapas del recorrido" subtitle="Las etapas que el conductor marca en la app. Las etapas intermedias exigen inspección vehicular aprobada; las finales (descargado, cancelada) no." />
      <div className="flex max-w-3xl flex-col gap-3">
        {estados.map((e, i) => (
          <div key={e.id} className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center">
            <span className="num flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-semibold text-white" style={{ background: e.color }}>{i + 1}</span>
            <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
              <Input id={`en-${e.id}`} aria-label="Nombre" value={e.nombre} onChange={(ev) => upd(e.id, 'nombre', ev.target.value)} className="h-9" />
              <Input id={`ed-${e.id}`} aria-label="Descripción" value={e.descripcion} onChange={(ev) => upd(e.id, 'descripcion', ev.target.value)} className="h-9" />
            </div>
            <div className="flex items-center gap-3">
              <input id={`ec-${e.id}`} aria-label="Color" type="color" value={e.color} onChange={(ev) => upd(e.id, 'color', ev.target.value)} className="h-9 w-12 cursor-pointer rounded-md border border-line bg-surface p-1" />
              <label className="flex items-center gap-2 text-[13px] text-muted"><input id={`er-${e.id}`} type="checkbox" checked={e.rastreo} onChange={(ev) => upd(e.id, 'rastreo', ev.target.checked)} className="h-4 w-4 accent-[rgb(var(--brand))]" />Envía GPS</label>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex max-w-3xl justify-end"><Button variant="primary" onClick={() => toast('Etapas guardadas.')}>Guardar</Button></div>
    </>
  );
}
