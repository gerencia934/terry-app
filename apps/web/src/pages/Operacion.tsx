import { useMemo, useState } from 'react';
import { FileDown, CheckCircle2, XCircle, Clock, AlertTriangle, MessageSquareWarning, FileSpreadsheet, Ban } from 'lucide-react';
import { ResponsiveTable, FilterBar, type Column } from '../components/data';
import { Badge, Button, ColorBadge, DefList, Field, Input, PageHeader, Select, Sheet, useToast } from '../components/ui';
import { Fab } from '../components/AppShell';
import {
  CLIENTES, CONCILIACION, ESTADOS_RUTA, HOY, INVENTARIO, MANIFIESTOS, PREOPS, RUTAS, SOLICITUDES, VEHICULOS, cliente, decl, item, ordenCompra,
  persona, sucursal, tipoSolicitud, vehiculo, type LineaConciliacion, type Manifiesto, type Preop,
} from '../data/mock';
import { cx, diasEntre, fmtFecha, fmtNum } from '../lib/format';
import { uni } from './Declaraciones';

const vehTxt = (id: string) => `${vehiculo(id).marca.toUpperCase()} / ${vehiculo(id).placa}`;
const solOf = (m: Manifiesto) => SOLICITUDES.find((s) => s.id === m.solicitudId)!;
const rutaOf = (m: Manifiesto) => RUTAS.find((r) => r.id === m.rutaId)!;
const estRuta = (id: string) => ESTADOS_RUTA.find((e) => e.id === id)!;

// ---------------------------- CHEQUEO ----------------------------
export function Chequeo() {
  const toast = useToast();
  const [f, setF] = useState({ desde: '2026-11-01', hasta: '2026-11-30', vehiculo: '', documento: '' });
  const [sel, setSel] = useState<Preop | null>(null);
  const doc = (p: Preop) => 446 - PREOPS.indexOf(p);
  const mfs = (p: Preop) => MANIFIESTOS.filter((m) => m.vehiculoId === p.vehiculoId && m.fecha === p.programada.slice(0, 10)).map((m) => m.numero.replace('MT-', ''));
  const rows = PREOPS.filter((p) => p.programada.slice(0, 10) >= f.desde && p.programada.slice(0, 10) <= f.hasta && (!f.vehiculo || p.vehiculoId === f.vehiculo) && (!f.documento || String(doc(p)).includes(f.documento)));
  const Inc = ({ p }: { p: Preop }) => p.aprobado === undefined ? <Badge tone="warn"><Clock size={12} /> Pendiente</Badge> : p.aprobado ? <span className="font-semibold text-ok">NO</span> : <span className="font-semibold text-bad">SÍ</span>;
  const cols: Column<Preop>[] = [
    { key: 'nov', header: 'Novedad', align: 'center', render: (p) => p.aprobado === false || p.observaciones.toLowerCase().includes('desgaste') ? <MessageSquareWarning size={16} className="inline text-info" aria-label="Con novedad" /> : '', priority: 3 },
    { key: 'doc', header: 'Doc.', render: (p) => <span className="num font-semibold text-brand">{doc(p)}</span>, priority: 3 },
    { key: 'est', header: 'Estado', render: (p) => p.real ? 'Realizado' : <span className="text-warn">Pendiente</span>, priority: 3 },
    { key: 'veh', header: 'Vehículo', render: (p) => vehTxt(p.vehiculoId), priority: 3 },
    { key: 'prog', header: 'Fecha programada', render: (p) => <span className="num">{p.programada.slice(0, 10)}</span>, priority: 2 },
    { key: 'reg', header: 'Fecha registro', render: (p) => <span className="num">{p.real ?? '—'}</span>, priority: 3 },
    { key: 'elab', header: 'Elaboró', render: (p) => persona(p.conductorId)?.nombre.toUpperCase(), priority: 2 },
    { key: 'inc', header: '¿Incumple?', align: 'center', render: (p) => <Inc p={p} />, priority: 3 },
    { key: 'obs', header: 'Observación', render: (p) => <span className="block max-w-[320px] truncate text-muted">{p.observaciones}</span>, priority: 3 },
    { key: 'mf', header: 'MF', render: (p) => <span className="num">{mfs(p).join(', ') || '—'}</span>, priority: 3 },
  ];
  return (
    <>
      <PageHeader eyebrow="Chequeo" title="Lista de chequeo interna" subtitle="Preoperacional diario por vehículo (PESV, Res. 40595 de 2022). Si un ítem crítico incumple, la ruta no sale." />
      <FilterBar active={[f.vehiculo, f.documento].filter(Boolean).length} onClear={() => setF({ desde: '2026-11-01', hasta: '2026-11-30', vehiculo: '', documento: '' })}>
        <Field label="Desde" id="ch-d"><Input id="ch-d" type="date" value={f.desde} onChange={(e) => setF((s) => ({ ...s, desde: e.target.value }))} /></Field>
        <Field label="Hasta" id="ch-h"><Input id="ch-h" type="date" value={f.hasta} onChange={(e) => setF((s) => ({ ...s, hasta: e.target.value }))} /></Field>
        <Field label="Vehículo" id="ch-v"><Select id="ch-v" value={f.vehiculo} onChange={(e) => setF((s) => ({ ...s, vehiculo: e.target.value }))}><option value="">Seleccione</option>{VEHICULOS.map((v) => <option key={v.id} value={v.id}>{v.placa} · {v.marca}</option>)}</Select></Field>
        <Field label="Documento" id="ch-doc"><Input id="ch-doc" inputMode="numeric" value={f.documento} onChange={(e) => setF((s) => ({ ...s, documento: e.target.value }))} placeholder="Nº" /></Field>
      </FilterBar>
      <ResponsiveTable rows={rows} columns={cols} rowKey={(p) => p.id} onRowClick={setSel}
        cardTitle={(p) => <span className="num">Doc. {doc(p)} · {vehTxt(p.vehiculoId)}</span>} cardBadge={(p) => p.aprobado === undefined ? <Badge tone="warn">Pendiente</Badge> : p.aprobado ? <Badge tone="ok"><CheckCircle2 size={12} /> Cumple</Badge> : <Badge tone="bad"><XCircle size={12} /> Incumple</Badge>} cardMeta={(p) => p.observaciones} />
      <Fab label="Nueva lista de chequeo" onClick={() => toast('La lista de chequeo la diligencia el conductor desde la app de campo (Vista conductor › Preoperacional).', 'info')} />
      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel ? `Lista de chequeo ${doc(sel)}` : ''} footer={<Button onClick={() => toast('PDF de la lista de chequeo generado.', 'info')}><FileDown size={16} /> PDF</Button>}>
        {sel && <DefList items={[['Vehículo', vehTxt(sel.vehiculoId)], ['Programada', sel.programada], ['Registro', sel.real ?? 'Pendiente'], ['Elaboró', persona(sel.conductorId)?.nombre], ['Auxiliar', persona(sel.auxiliarId)?.nombre ?? '—'], ['¿Incumple?', <Inc p={sel} />], ['Observación', sel.observaciones], ['Manifiestos', mfs(sel).join(', ') || '—']]} />}
      </Sheet>
    </>
  );
}

// ---------------------------- MANIFIESTOS ----------------------------
const ANULADOS = [{ numero: 'MT-2398', cliente: 'c6', fecha: '2026-11-03', causal: 'Programación duplicada; se eliminó la ruta relacionada' }, { numero: 'MT-2399', cliente: 'c9', fecha: '2026-11-05', causal: 'Cliente canceló el servicio antes de la salida' }];
export function Manifiestos() {
  const toast = useToast();
  const [f, setF] = useState({ desde: '2026-11-01', hasta: '2026-11-30', documento: '', cliente: '', tipo: '' });
  const [sel, setSel] = useState<Manifiesto | null>(null);
  const realizado = (m: Manifiesto) => m.estado === 'CERRADO' || m.estado === 'RECIBIDO';
  const rows = useMemo(() => MANIFIESTOS.filter((m) => m.fecha >= f.desde && m.fecha <= f.hasta && (!f.documento || m.numero.includes(f.documento)) && (!f.cliente || solOf(m).clienteId === f.cliente)
    && (!f.tipo || (tipoSolicitud(solOf(m)) === 'Descargue' ? 'Descargue' : 'Cargue') === f.tipo)).sort((a, b) => b.numero.localeCompare(a.numero)), [f]);
  const cols: Column<Manifiesto>[] = [
    { key: 'doc', header: 'Doc. MF', render: (m) => <span className="num font-semibold">{m.numero.replace('MT-', '')}</span>, priority: 3 },
    { key: 'tipo', header: 'Tipo', render: (m) => <span className="text-info">{tipoSolicitud(solOf(m)) === 'Descargue' ? 'Descargue' : 'Cargue'}</span>, priority: 3 },
    { key: 'cli', header: 'Cliente', render: (m) => <span className="block max-w-[200px] truncate font-medium">{cliente(solOf(m).clienteId).razonSocial}</span>, priority: 3 },
    { key: 'suc', header: 'Sucursales', render: (m) => sucursal(solOf(m).sucursalId).nombre, priority: 3 },
    { key: 'veh', header: 'Vehículo', render: (m) => `${vehiculo(m.vehiculoId).placa}/${vehiculo(m.vehiculoId).marca.toUpperCase()}`, priority: 2 },
    { key: 'fp', header: 'Fecha programación', render: (m) => <span className="num">{m.fecha}</span>, priority: 1 },
    { key: 'est', header: 'Estado', render: (m) => realizado(m) ? 'Realizado' : <span className="text-warn">Pendiente</span>, priority: 3 },
    { key: 'er', header: 'Estado del recorrido', render: (m) => <ColorBadge color={estRuta(rutaOf(m).estadoId).color}>{estRuta(rutaOf(m).estadoId).nombre}</ColorBadge>, priority: 3 },
    { key: 'sol', header: 'Solicitudes', render: (m) => <span className="num font-semibold text-brand">{solOf(m).numero}</span>, priority: 3 },
    { key: 'oc', header: 'Orden de compra', render: (m) => ordenCompra(solOf(m)) || '—', priority: 3 },
    { key: 'mc', header: 'Manifiesto cliente', render: (m) => realizado(m) ? m.numero.replace('MT-', '') : '—', priority: 3 },
    { key: 'sr', header: 'Sucursal recepción', render: () => 'PSA Los Pinos', priority: 3 },
    { key: 'rndc', header: 'RNDC', render: (m) => <span className="num text-muted">{m.rndc ?? 'Por reportar'}</span>, priority: 3 },
    { key: 'ca', header: 'Causal anulación', render: () => '—', priority: 3 },
  ];
  return (
    <>
      <PageHeader eyebrow="Manifiesto" title={`Manifiestos (${fmtFecha(f.desde)} – ${fmtFecha(f.hasta)})`} subtitle="Documento de transporte por cliente y placa, enlazado a la solicitud y al estado del recorrido." />
      <FilterBar active={[f.documento, f.cliente, f.tipo].filter(Boolean).length} onClear={() => setF({ desde: '2026-11-01', hasta: '2026-11-30', documento: '', cliente: '', tipo: '' })}>
        <Field label="Desde" id="m-d"><Input id="m-d" type="date" value={f.desde} onChange={(e) => setF((s) => ({ ...s, desde: e.target.value }))} /></Field>
        <Field label="Hasta" id="m-h"><Input id="m-h" type="date" value={f.hasta} onChange={(e) => setF((s) => ({ ...s, hasta: e.target.value }))} /></Field>
        <Field label="Documento" id="m-doc"><Input id="m-doc" value={f.documento} onChange={(e) => setF((s) => ({ ...s, documento: e.target.value }))} placeholder="Nº MF" /></Field>
        <Field label="Cliente" id="m-cli"><Select id="m-cli" value={f.cliente} onChange={(e) => setF((s) => ({ ...s, cliente: e.target.value }))}><option value="">Todos</option>{CLIENTES.map((c) => <option key={c.id} value={c.id}>{c.razonSocial}</option>)}</Select></Field>
        <Field label="Tipo de manifiesto" id="m-tipo"><Select id="m-tipo" value={f.tipo} onChange={(e) => setF((s) => ({ ...s, tipo: e.target.value }))}><option value="">Todos</option><option>Cargue</option><option>Descargue</option></Select></Field>
      </FilterBar>
      <ResponsiveTable rows={rows} columns={cols} rowKey={(m) => m.id} onRowClick={setSel}
        cardTitle={(m) => <span className="num">MF {m.numero.replace('MT-', '')} · {cliente(solOf(m).clienteId).razonSocial}</span>} cardBadge={(m) => <ColorBadge color={estRuta(rutaOf(m).estadoId).color}>{estRuta(rutaOf(m).estadoId).nombre}</ColorBadge>} />
      <h2 className="mb-2 mt-7 text-[15px] font-semibold">Informe de manifiestos anulados y programación relacionada eliminada</h2>
      <ResponsiveTable rows={ANULADOS} rowKey={(a) => a.numero} cardTitle={(a) => <span className="num">{a.numero}</span>} cardMeta={(a) => a.causal}
        columns={[{ key: 'n', header: 'Doc. MF', render: (a) => <span className="num flex items-center gap-1.5"><Ban size={14} className="text-bad" />{a.numero.replace('MT-', '')}</span>, priority: 3 },
          { key: 'c', header: 'Cliente', render: (a) => cliente(a.cliente).razonSocial, priority: 2 }, { key: 'f', header: 'Fecha', render: (a) => a.fecha, priority: 1 }, { key: 'ca', header: 'Causal anulación', render: (a) => a.causal, priority: 3 }]} />
      <Fab label="Emitir manifiesto" onClick={() => toast('El manifiesto se emite desde la ruta al confirmar la carga en campo, o manualmente aquí para descargues.', 'info')} />
      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel ? `Manifiesto ${sel.numero.replace('MT-', '')}` : ''} footer={<Button variant="primary" onClick={() => toast('PDF del manifiesto generado con la plantilla corporativa.', 'info')}><FileDown size={16} /> Descargar PDF</Button>}>
        {sel && (() => { const s = solOf(sel); return (
          <div className="flex flex-col gap-5">
            <DefList items={[['Generador', cliente(s.clienteId).razonSocial], ['Sucursal', `${sucursal(s.sucursalId).nombre} · ${sucursal(s.sucursalId).municipio}`], ['Vehículo', vehTxt(sel.vehiculoId)], ['Conductor', persona(sel.conductorId)?.nombre], ['Fecha', fmtFecha(sel.fecha)], ['Solicitud', s.numero], ['Destino', 'Parque de Saneamiento Ambiental Los Pinos'], ['RNDC', sel.rndc ?? 'Por reportar']]} />
            <div className="rounded-xl border border-line">{s.items.map((i) => { const it = item(decl(i.declId).itemId); return (
              <div key={i.declId} className="flex justify-between gap-3 border-b border-line px-3 py-2.5 text-[13px] last:border-0"><div className="min-w-0"><p className="font-medium">{it.nombre}</p><p className="text-muted">{it.corriente ?? 'No peligroso'}{it.onu ? ` · UN ${it.onu}` : ''}</p></div><span className="num shrink-0">{fmtNum(i.cantidad)} {uni(it.unidad)}</span></div>); })}</div>
          </div>); })()}
      </Sheet>
    </>
  );
}

// ---------------------------- CONCILIACIONES ----------------------------
const pct = (l: LineaConciliacion) => ((l.destino - l.origen) / l.origen) * 100;
export function Conciliaciones() {
  const toast = useToast();
  const [f, setF] = useState({ desde: '2026-11-01', hasta: HOY, cliente: '', manifiesto: '' });
  const [lineas, setLineas] = useState(CONCILIACION);
  const [conciliados, setConciliados] = useState<Set<string>>(new Set(['MT-2401', 'MT-2402', 'MT-2404']));
  const [sel, setSel] = useState<Manifiesto | null>(null);
  const [just, setJust] = useState<Record<string, string>>({});
  const realizados = MANIFIESTOS.filter((m) => m.estado === 'CERRADO' || m.estado === 'RECIBIDO');
  const rows = realizados.filter((m) => m.fecha >= f.desde && m.fecha <= f.hasta && (!f.cliente || solOf(m).clienteId === f.cliente) && (!f.manifiesto || m.numero.includes(f.manifiesto))).sort((a, b) => b.numero.localeCompare(a.numero));
  const lineasDe = (m: Manifiesto) => lineas.filter((l) => l.manifiesto === m.numero);
  const pendJust = (m: Manifiesto) => lineasDe(m).filter((l) => Math.abs(pct(l)) > 2 && !l.justificacion).length;
  const cols: Column<Manifiesto>[] = [
    { key: 'mf', header: 'MF', render: (m) => <span className="num font-semibold text-brand">{m.numero.replace('MT-', '')}</span>, priority: 3 },
    { key: 'cli', header: 'Cliente', render: (m) => <span className="block max-w-[180px] truncate font-medium">{cliente(solOf(m).clienteId).razonSocial}</span>, priority: 3 },
    { key: 'suc', header: 'Sucursal / generador', render: (m) => <span className="flex flex-col"><span className="font-medium">{sucursal(solOf(m).sucursalId).nombre}</span><span className="text-[12px] text-muted">{sucursal(solOf(m).sucursalId).municipio} / Santander</span></span>, priority: 3 },
    { key: 'cla', header: 'Clasificación interna', render: (m) => ['A', 'B', 'A', 'C'][solOf(m).numero % 4], priority: 3 },
    { key: 'est', header: 'Estado', render: () => 'Realizado', priority: 3 },
    { key: 'fs', header: 'Fecha servicio', render: (m) => <span className="num">{m.fecha}</span>, priority: 1 },
    { key: 'tipo', header: 'Tipo', render: (m) => tipoSolicitud(solOf(m)) === 'Descargue' ? 'Descargue' : 'Cargue', priority: 3 },
    { key: 'sol', header: 'Solicitud', render: (m) => <span className="num font-semibold text-brand">{solOf(m).numero}</span>, priority: 3 },
    { key: 'it', header: '# Ítems', align: 'center', render: (m) => solOf(m).items.length, priority: 3 },
    { key: 'as', header: 'Asesor cliente', render: () => 'Gerencia regional', priority: 3 },
    { key: 'dp', header: 'Destino/s programados', render: () => <Badge tone="info">TERRA VIVA SAS ESP</Badge>, priority: 3 },
    { key: 'dc', header: 'Destino/s conciliados', render: (m) => conciliados.has(m.numero) ? <Badge tone="ok">TERRA VIVA SAS ESP</Badge> : pendJust(m) ? <Badge tone="bad"><AlertTriangle size={12} /> Diferencia</Badge> : <span className="text-muted">Sin destino</span>, priority: 2 },
  ];
  const conciliar = (m: Manifiesto) => {
    const nuevas = lineas.map((l) => (l.manifiesto === m.numero && just[l.itemId] ? { ...l, justificacion: just[l.itemId] } : l));
    if (nuevas.filter((l) => l.manifiesto === m.numero).some((l) => Math.abs(pct(l)) > 2 && !l.justificacion)) { toast('Hay diferencias mayores a ±2 % sin justificar. Escriba la justificación para conciliar.', 'warn'); return; }
    setLineas(nuevas); setConciliados((s) => new Set(s).add(m.numero)); setSel(null); toast(`MF ${m.numero.replace('MT-', '')} conciliado con destino PSA Los Pinos. Ya se puede emitir el acta.`);
  };
  return (
    <>
      <PageHeader eyebrow="Conciliaciones" title={`Conciliaciones (${fmtFecha(f.desde)} – ${fmtFecha(f.hasta)})`} subtitle="Asigne el destino real de cada manifiesto y concilie la cantidad de origen con la báscula de planta."
        actions={<Button variant="primary" onClick={() => toast('Consolidado de conciliaciones generado en Excel.', 'info')}><FileSpreadsheet size={16} /> Consolidado de conciliaciones</Button>} />
      <FilterBar active={[f.cliente, f.manifiesto].filter(Boolean).length} onClear={() => setF({ desde: '2026-11-01', hasta: HOY, cliente: '', manifiesto: '' })}>
        <Field label="Desde" id="co-d"><Input id="co-d" type="date" value={f.desde} onChange={(e) => setF((s) => ({ ...s, desde: e.target.value }))} /></Field>
        <Field label="Hasta" id="co-h"><Input id="co-h" type="date" value={f.hasta} onChange={(e) => setF((s) => ({ ...s, hasta: e.target.value }))} /></Field>
        <Field label="Cliente" id="co-c"><Select id="co-c" value={f.cliente} onChange={(e) => setF((s) => ({ ...s, cliente: e.target.value }))}><option value="">Todos</option>{CLIENTES.map((c) => <option key={c.id} value={c.id}>{c.razonSocial}</option>)}</Select></Field>
        <Field label="Manifiesto" id="co-m"><Input id="co-m" value={f.manifiesto} onChange={(e) => setF((s) => ({ ...s, manifiesto: e.target.value }))} placeholder="Nº MF" /></Field>
      </FilterBar>
      <ResponsiveTable rows={rows} columns={cols} rowKey={(m) => m.id} onRowClick={(m) => { setSel(m); setJust({}); }}
        cardTitle={(m) => <span className="num">MF {m.numero.replace('MT-', '')} · {cliente(solOf(m).clienteId).razonSocial}</span>}
        cardBadge={(m) => conciliados.has(m.numero) ? <Badge tone="ok">Conciliado</Badge> : pendJust(m) ? <Badge tone="bad">Diferencia</Badge> : <Badge tone="warn">Pendiente</Badge>} />
      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel ? `Conciliar MF ${sel.numero.replace('MT-', '')}` : ''}
        footer={sel && !conciliados.has(sel.numero) && <Button variant="primary" onClick={() => conciliar(sel)}>Conciliar destino</Button>}>
        {sel && (
          <div className="flex flex-col gap-4">
            <DefList items={[['Cliente', cliente(solOf(sel).clienteId).razonSocial], ['Sucursal', sucursal(solOf(sel).sucursalId).nombre], ['Destino programado', 'TERRA VIVA SAS ESP · PSA Los Pinos'], ['Estado', conciliados.has(sel.numero) ? 'Conciliado' : 'Pendiente']]} />
            <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">Cantidades: origen (manifiesto) vs. destino (báscula)</p>
            {(lineasDe(sel).length ? lineasDe(sel) : solOf(sel).items.map((i): LineaConciliacion => ({ manifiesto: sel.numero, clienteId: solOf(sel).clienteId, itemId: decl(i.declId).itemId, unidad: uni(item(decl(i.declId).itemId).unidad), origen: i.cantidad, destino: i.cantidad }))).map((l) => {
              const fuera = Math.abs(pct(l)) > 2;
              return (
                <div key={l.itemId} className={cx('rounded-xl border p-3', fuera && !l.justificacion ? 'border-bad' : 'border-line')}>
                  <p className="font-medium">{item(l.itemId).nombre}</p>
                  <div className="num mt-1 grid grid-cols-3 gap-2 text-[13px]"><span><span className="block text-[11px] text-subtle">Origen</span>{fmtNum(l.origen)} {l.unidad}</span><span><span className="block text-[11px] text-subtle">Báscula</span>{fmtNum(l.destino)} {l.unidad}</span><span className={cx(fuera && 'font-semibold text-bad')}><span className="block text-[11px] text-subtle">Diferencia</span>{fmtNum(pct(l))} %</span></div>
                  {fuera && (l.justificacion ? <p className="mt-2 text-[12px] text-info">Justificación: {l.justificacion}</p> : !conciliados.has(sel.numero) && (
                    <Field label="Justificación (supera ±2 %)" id={`j-${l.itemId}`}><Input id={`j-${l.itemId}`} value={just[l.itemId] ?? ''} onChange={(e) => setJust((s) => ({ ...s, [l.itemId]: e.target.value }))} placeholder="Ej. pérdida de humedad en transporte" /></Field>))}
                </div>);
            })}
          </div>
        )}
      </Sheet>
    </>
  );
}

// ---------------------------- ACTAS ----------------------------
export function Actas() {
  const toast = useToast();
  const [f, setF] = useState({ desde: '2026-11-01', hasta: HOY, numero: '', cliente: '', estado: '' });
  const base = MANIFIESTOS.filter((m) => m.estado === 'CERRADO').map((m, i) => ({ m, numero: `AD-${String(388 + i).padStart(4, '0')}`, estado: i % 4 === 3 ? 'Borrador' : 'Emitida', tipo: item(decl(solOf(m).items[0].declId).itemId).linea === 'Aprovechables' ? 'Certificado de aprovechamiento' : 'Disposición final' }));
  const rows = base.filter((a) => a.m.fecha >= f.desde && a.m.fecha <= f.hasta && (!f.numero || a.numero.includes(f.numero)) && (!f.cliente || solOf(a.m).clienteId === f.cliente) && (!f.estado || a.estado === f.estado));
  return (
    <>
      <PageHeader eyebrow="Actas" title={`Actas (${fmtFecha(f.desde)} – ${fmtFecha(f.hasta)})`} subtitle="Actas y certificados de disposición final por manifiesto conciliado. Se envían al cliente por correo." />
      <FilterBar active={[f.numero, f.cliente, f.estado].filter(Boolean).length} onClear={() => setF({ desde: '2026-11-01', hasta: HOY, numero: '', cliente: '', estado: '' })}>
        <Field label="Desde" id="a-d"><Input id="a-d" type="date" value={f.desde} onChange={(e) => setF((s) => ({ ...s, desde: e.target.value }))} /></Field>
        <Field label="Hasta" id="a-h"><Input id="a-h" type="date" value={f.hasta} onChange={(e) => setF((s) => ({ ...s, hasta: e.target.value }))} /></Field>
        <Field label="No. acta" id="a-n"><Input id="a-n" value={f.numero} onChange={(e) => setF((s) => ({ ...s, numero: e.target.value }))} placeholder="AD-0388" /></Field>
        <Field label="Cliente" id="a-c"><Select id="a-c" value={f.cliente} onChange={(e) => setF((s) => ({ ...s, cliente: e.target.value }))}><option value="">Todos</option>{CLIENTES.map((c) => <option key={c.id} value={c.id}>{c.razonSocial}</option>)}</Select></Field>
        <Field label="Estado de acta" id="a-e"><Select id="a-e" value={f.estado} onChange={(e) => setF((s) => ({ ...s, estado: e.target.value }))}><option value="">Seleccione</option><option>Emitida</option><option>Borrador</option></Select></Field>
      </FilterBar>
      <ResponsiveTable rows={rows} rowKey={(a) => a.numero} onRowClick={(a) => toast(`${a.numero}: ${a.estado === 'Emitida' ? 'abriendo PDF firmado' : 'acta en borrador, revise y emita'}.`, 'info')}
        cardTitle={(a) => <span className="num">{a.numero} · {cliente(solOf(a.m).clienteId).razonSocial}</span>} cardBadge={(a) => <Badge tone={a.estado === 'Emitida' ? 'ok' : 'info'}>{a.estado}</Badge>}
        columns={[
          { key: 'mf', header: 'MF', render: (a) => <span className="num font-semibold text-brand">{a.m.numero.replace('MT-', '')}</span>, priority: 3 },
          { key: 'c', header: 'Cliente', render: (a) => cliente(solOf(a.m).clienteId).razonSocial, priority: 3 },
          { key: 's', header: 'Sucursal / generador', render: (a) => sucursal(solOf(a.m).sucursalId).nombre, priority: 3 },
          { key: 'e', header: 'Estado', render: (a) => <Badge tone={a.estado === 'Emitida' ? 'ok' : 'info'}>{a.estado}</Badge>, priority: 3 },
          { key: 'n', header: 'No. acta', render: (a) => <span className="num font-medium">{a.numero}</span>, priority: 2 },
          { key: 't', header: 'Tipo', render: (a) => a.tipo, priority: 2 },
          { key: 'f', header: 'Fecha servicio', render: (a) => <span className="num">{a.m.fecha}</span>, priority: 1 },
          { key: 'dp', header: 'Destinos programados', render: () => 'TERRA VIVA SAS ESP', priority: 3 },
          { key: 'dc', header: 'Destinos conciliados', render: () => 'PSA Los Pinos', priority: 3 },
          { key: 'v', header: 'Vehículo', render: (a) => vehiculo(a.m.vehiculoId).placa, priority: 3 },
        ]} />
    </>
  );
}

// ---------------------------- INVENTARIO ----------------------------
export function Inventario() {
  const rows = INVENTARIO.map((r) => ({ ...r, saldo: r.entradas - r.salidas, dias: diasEntre(r.ingresoMasAntiguo, HOY) }));
  return (
    <>
      <PageHeader eyebrow="Inventario" title="Inventario de residuos por bodega" subtitle="Entradas por manifiesto recibido y salidas por despacho a tratamiento o gestor aliado. Controla el tiempo de almacenamiento." />
      <ResponsiveTable rows={rows} rowKey={(r) => r.bodega + r.itemId} cardTitle={(r) => item(r.itemId).nombre} cardMeta={(r) => r.bodega}
        cardBadge={(r) => <Badge tone={r.dias > 180 ? 'bad' : r.dias > 90 ? 'warn' : 'ok'}>{r.dias} días</Badge>}
        columns={[
          { key: 'b', header: 'Bodega', render: (r) => r.bodega, priority: 3 },
          { key: 'r', header: 'Residuo', render: (r) => <span className="font-medium">{item(r.itemId).nombre}</span>, priority: 3 },
          { key: 'e', header: 'Entradas', align: 'right', render: (r) => `${fmtNum(r.entradas)} ${uni(item(r.itemId).unidad)}`, priority: 3 },
          { key: 's', header: 'Salidas', align: 'right', render: (r) => `${fmtNum(r.salidas)} ${uni(item(r.itemId).unidad)}`, priority: 3 },
          { key: 'sa', header: 'Saldo', align: 'right', render: (r) => <span className="font-semibold">{fmtNum(r.saldo)} {uni(item(r.itemId).unidad)}</span>, priority: 1 },
          { key: 'i', header: 'Ingreso más antiguo', render: (r) => fmtFecha(r.ingresoMasAntiguo), priority: 3 },
          { key: 'd', header: 'Días en almacenamiento', align: 'right', render: (r) => <Badge tone={r.dias > 180 ? 'bad' : r.dias > 90 ? 'warn' : 'ok'}>{r.dias} días</Badge>, priority: 2 },
        ]} />
      <p className="mt-3 text-[12px] text-muted">Umbrales de alerta de demostración: 90 y 180 días. Ajústelos al tiempo máximo de almacenamiento que fije su licencia o permiso.</p>
    </>
  );
}
