import { useMemo, useState } from 'react';
import { FileDown, Plus, CheckCircle2, XCircle, Clock, AlertTriangle } from 'lucide-react';
import { ResponsiveTable, FilterBar, type Column } from '../components/data';
import { Badge, Button, DefList, EstadoBadge, Field, PageHeader, Select, Sheet, Tabs, useToast } from '../components/ui';
import { ACTAS, CLIENTES, CONCILIACION, MANIFIESTOS, PREOPS, SOLICITUDES, VEHICULOS, cliente, decl, item, persona, sucursal, vehiculo, type LineaConciliacion, type Manifiesto, type Preop } from '../data/mock';
import { cx, fmtFecha, fmtFechaCorta, fmtNum } from '../lib/format';
import { uni } from './Declaraciones';

const Paso = ({ v }: { v?: boolean }) => v === undefined
  ? <Badge tone="warn"><Clock size={12} /> Pendiente</Badge>
  : v ? <Badge tone="ok"><CheckCircle2 size={12} /> Sí</Badge> : <Badge tone="bad"><XCircle size={12} /> No</Badge>;

export function Preoperacionales() {
  const [f, setF] = useState({ vehiculo: '', resultado: '' });
  const [sel, setSel] = useState<Preop | null>(null);
  const rows = PREOPS.filter((p) => (!f.vehiculo || p.vehiculoId === f.vehiculo) && (!f.resultado || String(p.aprobado ?? 'pend') === f.resultado));
  const cols: Column<Preop>[] = [
    { key: 'veh', header: 'Vehículo', render: (p) => <span className="num font-medium">{vehiculo(p.vehiculoId).placa}</span>, priority: 3 },
    { key: 'tipo', header: 'Tipo', render: (p) => <span className="whitespace-nowrap text-muted">{vehiculo(p.vehiculoId).tipo}</span>, priority: 3 },
    { key: 'prog', header: 'Programada', render: (p) => <span className="num whitespace-nowrap">{fmtFechaCorta(p.programada)} {p.programada.slice(11)}</span>, priority: 2 },
    { key: 'real', header: 'Real', render: (p) => <span className="num whitespace-nowrap">{p.real ? `${fmtFechaCorta(p.real)} ${p.real.slice(11)}` : '—'}</span>, priority: 2 },
    { key: 'cond', header: 'Conductor', render: (p) => <span className="whitespace-nowrap">{persona(p.conductorId)?.nombre}</span>, priority: 2 },
    { key: 'aux', header: 'Auxiliar', render: (p) => <span className="whitespace-nowrap">{persona(p.auxiliarId)?.nombre ?? '—'}</span>, priority: 3 },
    { key: 'paso', header: '¿Pasó?', render: (p) => <Paso v={p.aprobado} />, priority: 3 },
    { key: 'obs', header: 'Observaciones', render: (p) => <span className="block max-w-[300px] truncate text-muted">{p.observaciones}</span>, priority: 3 },
  ];
  return (
    <>
      <PageHeader eyebrow="Operación HSEQ" title="Listas de chequeo preoperacionales" subtitle="Inspección diaria por vehículo y tripulación (PESV, Res. 40595 de 2022). Un ítem crítico en «No» bloquea la salida de la ruta." />
      <FilterBar active={Object.values(f).filter(Boolean).length} onClear={() => setF({ vehiculo: '', resultado: '' })}>
        <Field label="Vehículo" id="po-veh"><Select id="po-veh" value={f.vehiculo} onChange={(e) => setF((s) => ({ ...s, vehiculo: e.target.value }))}><option value="">Todos</option>{VEHICULOS.map((v) => <option key={v.id} value={v.id}>{v.placa}</option>)}</Select></Field>
        <Field label="Resultado" id="po-res"><Select id="po-res" value={f.resultado} onChange={(e) => setF((s) => ({ ...s, resultado: e.target.value }))}><option value="">Todos</option><option value="true">Aprobado</option><option value="false">No aprobado</option><option value="pend">Pendiente</option></Select></Field>
      </FilterBar>
      <ResponsiveTable rows={rows} columns={cols} rowKey={(p) => p.id} onRowClick={setSel}
        cardTitle={(p) => <span className="num">{vehiculo(p.vehiculoId).placa} · {vehiculo(p.vehiculoId).tipo}</span>} cardBadge={(p) => <Paso v={p.aprobado} />} cardMeta={(p) => p.observaciones} />
      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel ? `Preoperacional ${vehiculo(sel.vehiculoId).placa}` : ''}>
        {sel && <DefList items={[['Vehículo', `${vehiculo(sel.vehiculoId).placa} · ${vehiculo(sel.vehiculoId).tipo}`], ['Programada', sel.programada], ['Realizada', sel.real ?? 'Pendiente'], ['Conductor', persona(sel.conductorId)?.nombre], ['Auxiliar', persona(sel.auxiliarId)?.nombre ?? '—'], ['¿Pasó?', <Paso v={sel.aprobado} />], ['Observaciones', sel.observaciones]]} />}
      </Sheet>
    </>
  );
}

const solOf = (m: Manifiesto) => SOLICITUDES.find((s) => s.id === m.solicitudId)!;
export function Manifiestos() {
  const toast = useToast();
  const [f, setF] = useState({ cliente: '', placa: '', estado: '' });
  const [sel, setSel] = useState<Manifiesto | null>(null);
  const rows = useMemo(() => MANIFIESTOS.filter((m) => (!f.cliente || solOf(m).clienteId === f.cliente) && (!f.placa || m.vehiculoId === f.placa) && (!f.estado || m.estado === f.estado)).sort((a, b) => b.numero.localeCompare(a.numero)), [f]);
  const cols: Column<Manifiesto>[] = [
    { key: 'num', header: 'Manifiesto', render: (m) => <span className="num font-medium">{m.numero}</span>, priority: 3 },
    { key: 'fecha', header: 'Fecha', render: (m) => <span className="num whitespace-nowrap">{fmtFechaCorta(m.fecha)}</span>, priority: 1 },
    { key: 'cliente', header: 'Cliente', render: (m) => <span className="block max-w-[220px] truncate">{cliente(solOf(m).clienteId).razonSocial}</span>, priority: 3 },
    { key: 'suc', header: 'Sucursal', render: (m) => <span className="whitespace-nowrap">{sucursal(solOf(m).sucursalId).municipio}</span>, priority: 3 },
    { key: 'placa', header: 'Placa', render: (m) => <span className="num rounded-md bg-surface-2 px-2 py-0.5 font-medium">{vehiculo(m.vehiculoId).placa}</span>, priority: 2 },
    { key: 'cond', header: 'Conductor', render: (m) => <span className="whitespace-nowrap">{persona(m.conductorId)?.nombre}</span>, priority: 3 },
    { key: 'rndc', header: 'Consecutivo RNDC', render: (m) => <span className="num text-muted">{m.rndc ?? 'Por reportar'}</span>, priority: 3 },
    { key: 'dest', header: 'Destino', render: () => 'PSA Los Pinos', priority: 2 },
    { key: 'estado', header: 'Estado', render: (m) => <EstadoBadge estado={m.estado} />, priority: 3 },
  ];
  return (
    <>
      <PageHeader eyebrow="Operación HSEQ" title="Manifiestos de transporte" subtitle="Documento de transporte por cliente y placa, con reporte al RNDC y seguimiento hasta el recibo en planta."
        actions={<Button variant="primary" onClick={() => toast('El manifiesto se genera desde la ruta al confirmar la carga en campo.', 'info')}><Plus size={16} /> Emitir manifiesto</Button>} />
      <FilterBar active={Object.values(f).filter(Boolean).length} onClear={() => setF({ cliente: '', placa: '', estado: '' })}>
        <Field label="Cliente" id="m-cli"><Select id="m-cli" value={f.cliente} onChange={(e) => setF((s) => ({ ...s, cliente: e.target.value }))}><option value="">Todos</option>{CLIENTES.map((c) => <option key={c.id} value={c.id}>{c.razonSocial}</option>)}</Select></Field>
        <Field label="Placa" id="m-placa"><Select id="m-placa" value={f.placa} onChange={(e) => setF((s) => ({ ...s, placa: e.target.value }))}><option value="">Todas</option>{VEHICULOS.map((v) => <option key={v.id} value={v.id}>{v.placa}</option>)}</Select></Field>
        <Field label="Estado" id="m-est"><Select id="m-est" value={f.estado} onChange={(e) => setF((s) => ({ ...s, estado: e.target.value }))}><option value="">Todos</option><option value="EMITIDO">Emitido</option><option value="EN_TRANSITO">En tránsito</option><option value="RECIBIDO">Recibido en planta</option><option value="CERRADO">Cerrado</option></Select></Field>
      </FilterBar>
      <ResponsiveTable rows={rows} columns={cols} rowKey={(m) => m.id} onRowClick={setSel}
        cardTitle={(m) => <span className="num">{m.numero} · {cliente(solOf(m).clienteId).razonSocial}</span>} cardBadge={(m) => <EstadoBadge estado={m.estado} />} />
      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel ? `Manifiesto ${sel.numero}` : ''}
        footer={<Button variant="primary" onClick={() => toast('PDF del manifiesto generado con la plantilla corporativa.', 'info')}><FileDown size={16} /> Descargar PDF</Button>}>
        {sel && (() => { const s = solOf(sel); return (
          <div className="flex flex-col gap-5">
            <DefList items={[['Estado', <EstadoBadge estado={sel.estado} />], ['Fecha', fmtFecha(sel.fecha)], ['Generador', cliente(s.clienteId).razonSocial], ['Sucursal', `${sucursal(s.sucursalId).nombre} · ${sucursal(s.sucursalId).municipio}`], ['Vehículo', `${vehiculo(sel.vehiculoId).placa} · ${vehiculo(sel.vehiculoId).tipo}`], ['Conductor', persona(sel.conductorId)?.nombre], ['Destino', 'Parque de Saneamiento Ambiental Los Pinos'], ['RNDC', sel.rndc ?? 'Por reportar']]} />
            <div className="rounded-xl border border-line">{s.items.map((i) => { const it = item(decl(i.declId).itemId); return (
              <div key={i.declId} className="flex justify-between gap-3 border-b border-line px-3 py-2.5 text-[13px] last:border-0"><div className="min-w-0"><p className="font-medium">{it.nombre}</p><p className="text-muted">{it.corriente ?? 'No peligroso'}{it.onu ? ` · UN ${it.onu}` : ''}</p></div><span className="num shrink-0">{fmtNum(i.cantidad)} {uni(it.unidad)}</span></div>); })}</div>
          </div>); })()}
      </Sheet>
    </>
  );
}

const pct = (l: LineaConciliacion) => ((l.destino - l.origen) / l.origen) * 100;
export function Actas() {
  const toast = useToast();
  const [tab, setTab] = useState<'conc' | 'actas'>('conc');
  const [lineas, setLineas] = useState(CONCILIACION);
  const [sel, setSel] = useState<LineaConciliacion | null>(null);
  const [just, setJust] = useState('');
  const estado = (l: LineaConciliacion) => Math.abs(pct(l)) <= 2 ? 'ok' : l.justificacion ? 'just' : 'req';
  const cols: Column<LineaConciliacion>[] = [
    { key: 'man', header: 'Manifiesto', render: (l) => <span className="num font-medium">{l.manifiesto}</span>, priority: 3 },
    { key: 'cli', header: 'Cliente', render: (l) => <span className="block max-w-[200px] truncate">{cliente(l.clienteId).razonSocial}</span>, priority: 3 },
    { key: 'res', header: 'Residuo', render: (l) => <span className="block max-w-[220px] truncate">{item(l.itemId).nombre}</span>, priority: 3 },
    { key: 'ori', header: 'Origen', align: 'right', render: (l) => `${fmtNum(l.origen)} ${l.unidad}`, priority: 1 },
    { key: 'des', header: 'Destino (báscula)', align: 'right', render: (l) => `${fmtNum(l.destino)} ${l.unidad}`, priority: 1 },
    { key: 'dif', header: 'Diferencia', align: 'right', render: (l) => <span className={cx(Math.abs(pct(l)) > 2 && 'font-semibold text-bad')}>{l.destino - l.origen > 0 ? '+' : ''}{fmtNum(l.destino - l.origen)} ({fmtNum(pct(l))} %)</span>, priority: 2 },
    { key: 'est', header: 'Estado', render: (l) => estado(l) === 'ok' ? <Badge tone="ok">Dentro de ±2 %</Badge> : estado(l) === 'just' ? <Badge tone="info">Justificada</Badge> : <Badge tone="bad"><AlertTriangle size={12} /> Requiere justificación</Badge>, priority: 3 },
  ];
  const pend = lineas.filter((l) => estado(l) === 'req').length;
  return (
    <>
      <PageHeader eyebrow="Operación HSEQ" title="Actas y conciliaciones" subtitle="Conciliación de cantidades entre el manifiesto de origen y la báscula de la planta, y emisión de actas y certificados de disposición final."
        actions={<Button variant="primary" disabled={tab === 'conc' && pend > 0} onClick={() => toast('Acta de conciliación generada y enviada al cliente para firma.')}><FileDown size={16} /> Emitir acta</Button>} />
      <div className="mb-4"><Tabs value={tab} onChange={setTab} items={[{ value: 'conc', label: 'Conciliación origen vs. destino', count: pend }, { value: 'actas', label: 'Actas y certificados', count: ACTAS.length }]} /></div>
      {tab === 'conc' ? (
        <>
          {pend > 0 && <p className="mb-3 flex items-start gap-2 rounded-xl bg-bad/10 px-4 py-3 text-[13px] text-bad"><AlertTriangle size={17} className="shrink-0" /> {pend} línea supera la tolerancia de ±2 % sin justificación. El acta no se puede emitir hasta resolverla (la base de datos lo exige con una restricción).</p>}
          <ResponsiveTable rows={lineas} columns={cols} rowKey={(l) => l.manifiesto + l.itemId} onRowClick={(l) => { setSel(l); setJust(l.justificacion ?? ''); }}
            cardTitle={(l) => item(l.itemId).nombre} cardMeta={(l) => `${l.manifiesto} · ${cliente(l.clienteId).razonSocial}`} cardBadge={(l) => estado(l) === 'req' ? <Badge tone="bad">Justificar</Badge> : <Badge tone="ok">OK</Badge>} />
        </>
      ) : (
        <ResponsiveTable rows={ACTAS} rowKey={(a) => a.numero} cardTitle={(a) => <span className="num">{a.numero} · {a.tipo}</span>} cardBadge={(a) => <Badge tone={a.estado === 'Emitida' ? 'ok' : a.estado === 'En revisión' ? 'warn' : 'info'}>{a.estado}</Badge>}
          onRowClick={(a) => toast(`Abriendo ${a.numero} (PDF firmado).`, 'info')}
          columns={[
            { key: 'n', header: 'Número', render: (a) => <span className="num font-medium">{a.numero}</span>, priority: 3 },
            { key: 't', header: 'Tipo', render: (a) => a.tipo, priority: 3 },
            { key: 'c', header: 'Cliente', render: (a) => cliente(a.clienteId).razonSocial, priority: 1 },
            { key: 'p', header: 'Periodo', render: (a) => a.periodo, priority: 2 },
            { key: 'd', header: 'Destino', render: (a) => a.destino, priority: 3 },
            { key: 'e', header: 'Estado', render: (a) => <Badge tone={a.estado === 'Emitida' ? 'ok' : a.estado === 'En revisión' ? 'warn' : 'info'}>{a.estado}</Badge>, priority: 3 },
          ]} />
      )}
      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel ? `Conciliación ${sel.manifiesto}` : ''}
        footer={sel && Math.abs(pct(sel)) > 2 && <Button variant="primary" disabled={!just.trim()} onClick={() => { setLineas((ls) => ls.map((l) => l === sel ? { ...l, justificacion: just } : l)); setSel(null); toast('Justificación registrada en la auditoría.'); }}>Guardar justificación</Button>}>
        {sel && (
          <div className="flex flex-col gap-5">
            <DefList items={[['Cliente', cliente(sel.clienteId).razonSocial], ['Residuo', item(sel.itemId).nombre], ['Origen (manifiesto)', `${fmtNum(sel.origen)} ${sel.unidad}`], ['Destino (báscula)', `${fmtNum(sel.destino)} ${sel.unidad}`], ['Diferencia', `${fmtNum(sel.destino - sel.origen)} ${sel.unidad} (${fmtNum(pct(sel))} %)`]]} />
            {Math.abs(pct(sel)) > 2 && (
              <Field label="Justificación de la diferencia" id="conc-just" hint="Ej.: pérdida de humedad, error de báscula del cliente, derrame atendido (adjuntar reporte).">
                <textarea id="conc-just" value={just} onChange={(e) => setJust(e.target.value)} rows={4} className="w-full rounded-lg border border-line bg-surface p-3 text-sm focus:border-brand focus:outline-none" />
              </Field>
            )}
          </div>
        )}
      </Sheet>
    </>
  );
}

