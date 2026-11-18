import { useMemo, useState } from 'react';
import { FileDown, CheckCircle2, XCircle, Clock, AlertTriangle, FileSpreadsheet, Ban, Smartphone } from 'lucide-react';
import { ResponsiveTable, FilterBar, type Column } from '../components/data';
import { Badge, Button, ColorBadge, DefList, EstadoBadge, Field, Input, PageHeader, Select, Sheet, useToast } from '../components/ui';
import {
  CLIENTES, CONCILIACION, ESTADOS_RUTA, HOY, INVENTARIO, MANIFIESTOS, PREOPS, RUTAS, SOLICITUDES, VEHICULOS, cliente, decl, item, ordenCompra,
  persona, sucursal, tipoSolicitud, vehiculo, type LineaConciliacion, type Manifiesto, type Preop,
} from '../data/mock';
import { useRouter } from '../lib/router';
import { cx, diasEntre, fmtFecha, fmtFechaCorta, fmtNum } from '../lib/format';
import { uni } from './Declaraciones';

const solOf = (m: Manifiesto) => SOLICITUDES.find((s) => s.id === m.solicitudId)!;
const rutaOf = (m: Manifiesto) => RUTAS.find((r) => r.id === m.rutaId)!;
const etapa = (id: string) => ESTADOS_RUTA.find((e) => e.id === id)!;
const Placa = ({ id }: { id: string }) => <ColorBadge color={vehiculo(id).color}>{vehiculo(id).placa}</ColorBadge>;

// ---------------------------- INSPECCIONES ----------------------------
const Resultado = ({ p }: { p: Preop }) => p.aprobado === undefined ? <Badge tone="warn"><Clock size={12} /> Pendiente</Badge> : p.aprobado ? <Badge tone="ok"><CheckCircle2 size={12} /> Aprobada</Badge> : <Badge tone="bad"><XCircle size={12} /> No aprobada</Badge>;
export function Inspecciones() {
  const { go } = useRouter();
  const toast = useToast();
  const [f, setF] = useState({ desde: '2026-11-01', hasta: '2026-11-30', vehiculo: '', resultado: '' });
  const [sel, setSel] = useState<Preop | null>(null);
  const manifiestos = (p: Preop) => MANIFIESTOS.filter((m) => m.vehiculoId === p.vehiculoId && m.fecha === p.programada.slice(0, 10)).map((m) => m.numero);
  const rows = PREOPS.filter((p) => p.programada.slice(0, 10) >= f.desde && p.programada.slice(0, 10) <= f.hasta && (!f.vehiculo || p.vehiculoId === f.vehiculo) && (!f.resultado || String(p.aprobado ?? 'pend') === f.resultado));
  const cols: Column<Preop>[] = [
    { key: 'fecha', header: 'Programada', render: (p) => <span className="num font-medium">{fmtFechaCorta(p.programada)} · {p.programada.slice(11)}</span>, priority: 1 },
    { key: 'veh', header: 'Vehículo', render: (p) => <Placa id={p.vehiculoId} />, priority: 3 },
    { key: 'res', header: 'Resultado', render: (p) => <Resultado p={p} />, priority: 3 },
    { key: 'insp', header: 'Inspeccionó', render: (p) => persona(p.conductorId)?.nombre, priority: 2 },
    { key: 'real', header: 'Realizada', render: (p) => <span className="num text-muted">{p.real ? p.real.slice(11) : '—'}</span>, priority: 3 },
    { key: 'obs', header: 'Novedades', render: (p) => <span className="block max-w-[320px] truncate text-muted">{p.observaciones}</span>, priority: 3 },
    { key: 'mf', header: 'Manifiestos del día', render: (p) => <span className="num text-muted">{manifiestos(p).join(', ') || '—'}</span>, priority: 3 },
  ];
  return (
    <>
      <PageHeader eyebrow="Campo y HSEQ" title="Inspecciones vehiculares" subtitle="Inspección diaria antes de salir (PESV, Res. 40595 de 2022). Un ítem crítico no aprobado impide que el vehículo inicie el recorrido."
        actions={<Button onClick={() => go('campo-preop')}><Smartphone size={16} /> Abrir en la app del conductor</Button>} />
      <FilterBar active={[f.vehiculo, f.resultado].filter(Boolean).length} onClear={() => setF({ desde: '2026-11-01', hasta: '2026-11-30', vehiculo: '', resultado: '' })}>
        <Field label="Desde" id="in-d"><Input id="in-d" type="date" value={f.desde} onChange={(e) => setF((s) => ({ ...s, desde: e.target.value }))} /></Field>
        <Field label="Hasta" id="in-h"><Input id="in-h" type="date" value={f.hasta} onChange={(e) => setF((s) => ({ ...s, hasta: e.target.value }))} /></Field>
        <Field label="Vehículo" id="in-v"><Select id="in-v" value={f.vehiculo} onChange={(e) => setF((s) => ({ ...s, vehiculo: e.target.value }))}><option value="">Toda la flota</option>{VEHICULOS.map((v) => <option key={v.id} value={v.id}>{v.placa}</option>)}</Select></Field>
        <Field label="Resultado" id="in-r"><Select id="in-r" value={f.resultado} onChange={(e) => setF((s) => ({ ...s, resultado: e.target.value }))}><option value="">Todos</option><option value="true">Aprobada</option><option value="false">No aprobada</option><option value="pend">Pendiente</option></Select></Field>
      </FilterBar>
      <ResponsiveTable rows={rows} columns={cols} rowKey={(p) => p.id} onRowClick={setSel}
        cardTitle={(p) => <span className="num">{vehiculo(p.vehiculoId).placa} · {fmtFechaCorta(p.programada)}</span>} cardBadge={(p) => <Resultado p={p} />} cardMeta={(p) => p.observaciones} />
      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel ? `Inspección ${vehiculo(sel.vehiculoId).placa}` : ''} footer={<Button onClick={() => toast('PDF de la inspección generado.', 'info')}><FileDown size={16} /> PDF</Button>}>
        {sel && <DefList items={[['Vehículo', `${vehiculo(sel.vehiculoId).placa} · ${vehiculo(sel.vehiculoId).tipo}`], ['Programada', sel.programada], ['Realizada', sel.real ?? 'Pendiente'], ['Inspeccionó', persona(sel.conductorId)?.nombre], ['Auxiliar', persona(sel.auxiliarId)?.nombre ?? '—'], ['Resultado', <Resultado p={sel} />], ['Novedades', sel.observaciones], ['Manifiestos del día', manifiestos(sel).join(', ') || '—']]} />}
      </Sheet>
    </>
  );
}

// ---------------------------- MANIFIESTOS ----------------------------
const ANULADOS = [{ numero: 'MT-2398', cliente: 'c6', fecha: '2026-11-03', motivo: 'Programación duplicada' }, { numero: 'MT-2399', cliente: 'c9', fecha: '2026-11-05', motivo: 'El cliente canceló antes de la salida' }];
export function Manifiestos() {
  const toast = useToast();
  const [f, setF] = useState({ desde: '2026-11-01', hasta: '2026-11-30', numero: '', cliente: '', vehiculo: '' });
  const [sel, setSel] = useState<Manifiesto | null>(null);
  const rows = useMemo(() => MANIFIESTOS.filter((m) => m.fecha >= f.desde && m.fecha <= f.hasta && (!f.numero || m.numero.includes(f.numero)) && (!f.cliente || solOf(m).clienteId === f.cliente) && (!f.vehiculo || m.vehiculoId === f.vehiculo))
    .sort((a, b) => b.fecha.localeCompare(a.fecha)), [f]);
  const cols: Column<Manifiesto>[] = [
    { key: 'num', header: 'Manifiesto', render: (m) => <span className="num font-semibold">{m.numero}</span>, priority: 3 },
    { key: 'fecha', header: 'Fecha', render: (m) => <span className="num">{fmtFechaCorta(m.fecha)}</span>, priority: 1 },
    { key: 'cli', header: 'Generador', render: (m) => <span className="block max-w-[200px] truncate font-medium">{cliente(solOf(m).clienteId).razonSocial}</span>, priority: 3 },
    { key: 'suc', header: 'Sede', render: (m) => sucursal(solOf(m).sucursalId).municipio, priority: 3 },
    { key: 'veh', header: 'Vehículo', render: (m) => <Placa id={m.vehiculoId} />, priority: 2 },
    { key: 'modo', header: 'Modalidad', render: (m) => tipoSolicitud(solOf(m)), priority: 3 },
    { key: 'est', header: 'Estado', render: (m) => <EstadoBadge estado={m.estado} />, priority: 3 },
    { key: 'etapa', header: 'Etapa del recorrido', render: (m) => <ColorBadge color={etapa(rutaOf(m).estadoId).color}>{etapa(rutaOf(m).estadoId).nombre}</ColorBadge>, priority: 3 },
    { key: 'sol', header: 'Solicitud', render: (m) => <span className="num text-muted">{solOf(m).numero}</span>, priority: 3 },
    { key: 'oc', header: 'Orden de compra', render: (m) => ordenCompra(solOf(m)) || '—', priority: 3 },
    { key: 'rndc', header: 'RNDC', render: (m) => <span className="num text-muted">{m.rndc ?? 'Por reportar'}</span>, priority: 3 },
  ];
  return (
    <>
      <PageHeader eyebrow="Campo y HSEQ" title="Manifiestos de transporte" subtitle="Se emiten desde la app al cargar en la sede del generador y se cierran al pesar en planta." />
      <FilterBar active={[f.numero, f.cliente, f.vehiculo].filter(Boolean).length} onClear={() => setF({ desde: '2026-11-01', hasta: '2026-11-30', numero: '', cliente: '', vehiculo: '' })}>
        <Field label="Desde" id="m-d"><Input id="m-d" type="date" value={f.desde} onChange={(e) => setF((s) => ({ ...s, desde: e.target.value }))} /></Field>
        <Field label="Hasta" id="m-h"><Input id="m-h" type="date" value={f.hasta} onChange={(e) => setF((s) => ({ ...s, hasta: e.target.value }))} /></Field>
        <Field label="N.º" id="m-n"><Input id="m-n" value={f.numero} onChange={(e) => setF((s) => ({ ...s, numero: e.target.value }))} placeholder="MT-2401" /></Field>
        <Field label="Generador" id="m-c"><Select id="m-c" value={f.cliente} onChange={(e) => setF((s) => ({ ...s, cliente: e.target.value }))}><option value="">Todos</option>{CLIENTES.map((c) => <option key={c.id} value={c.id}>{c.razonSocial}</option>)}</Select></Field>
        <Field label="Vehículo" id="m-v"><Select id="m-v" value={f.vehiculo} onChange={(e) => setF((s) => ({ ...s, vehiculo: e.target.value }))}><option value="">Toda la flota</option>{VEHICULOS.map((v) => <option key={v.id} value={v.id}>{v.placa}</option>)}</Select></Field>
      </FilterBar>
      <ResponsiveTable rows={rows} columns={cols} rowKey={(m) => m.id} onRowClick={setSel}
        cardTitle={(m) => <span className="num">{m.numero} · {cliente(solOf(m).clienteId).razonSocial}</span>} cardBadge={(m) => <EstadoBadge estado={m.estado} />} />
      <h2 className="mb-2 mt-7 text-[15px] font-semibold">Anulados</h2>
      <ResponsiveTable rows={ANULADOS} rowKey={(a) => a.numero} cardTitle={(a) => <span className="num">{a.numero}</span>} cardMeta={(a) => a.motivo}
        columns={[{ key: 'n', header: 'Manifiesto', render: (a) => <span className="num flex items-center gap-1.5"><Ban size={14} className="text-bad" />{a.numero}</span>, priority: 3 },
          { key: 'c', header: 'Generador', render: (a) => cliente(a.cliente).razonSocial, priority: 2 }, { key: 'f', header: 'Fecha', render: (a) => fmtFecha(a.fecha), priority: 1 }, { key: 'm', header: 'Motivo', render: (a) => a.motivo, priority: 3 }]} />
      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel ? `Manifiesto ${sel.numero}` : ''} footer={<Button variant="primary" onClick={() => toast('PDF del manifiesto generado.', 'info')}><FileDown size={16} /> Descargar PDF</Button>}>
        {sel && (() => { const s = solOf(sel); return (
          <div className="flex flex-col gap-5">
            <DefList items={[['Generador', cliente(s.clienteId).razonSocial], ['Sede', `${sucursal(s.sucursalId).nombre} · ${sucursal(s.sucursalId).municipio}`], ['Vehículo', `${vehiculo(sel.vehiculoId).placa} · ${vehiculo(sel.vehiculoId).tipo}`], ['Conductor', persona(sel.conductorId)?.nombre], ['Fecha', fmtFecha(sel.fecha)], ['Solicitud', s.numero], ['Destino', 'Parque de Saneamiento Ambiental Los Pinos'], ['RNDC', sel.rndc ?? 'Por reportar']]} />
            <div className="rounded-xl border border-line">{s.items.map((i) => { const it = item(decl(i.declId).itemId); return (
              <div key={i.declId} className="flex justify-between gap-3 border-b border-line px-3 py-2.5 text-[13px] last:border-0"><div className="min-w-0"><p className="font-medium">{it.nombre}</p><p className="text-muted">{it.corriente ?? 'No peligroso'}{it.onu ? ` · UN ${it.onu}` : ''}</p></div><span className="num shrink-0">{fmtNum(i.cantidad)} {uni(it.unidad)}</span></div>); })}</div>
          </div>); })()}
      </Sheet>
    </>
  );
}

// ---------------------------- RECEPCIÓN Y PESAJE ----------------------------
const pct = (l: LineaConciliacion) => ((l.destino - l.origen) / l.origen) * 100;
export function Recepcion() {
  const toast = useToast();
  const [lineas, setLineas] = useState(CONCILIACION);
  const [confirmados, setConfirmados] = useState<Set<string>>(new Set(['MT-2401', 'MT-2402', 'MT-2404']));
  const [cli, setCli] = useState('');
  const [sel, setSel] = useState<Manifiesto | null>(null);
  const [just, setJust] = useState<Record<string, string>>({});
  const recibidos = MANIFIESTOS.filter((m) => (m.estado === 'CERRADO' || m.estado === 'RECIBIDO') && (!cli || solOf(m).clienteId === cli)).sort((a, b) => b.fecha.localeCompare(a.fecha));
  const lineasDe = (m: Manifiesto): LineaConciliacion[] => { const l = lineas.filter((x) => x.manifiesto === m.numero); return l.length ? l : solOf(m).items.map((i) => ({ manifiesto: m.numero, clienteId: solOf(m).clienteId, itemId: decl(i.declId).itemId, unidad: uni(item(decl(i.declId).itemId).unidad), origen: i.cantidad, destino: i.cantidad })); };
  const peor = (m: Manifiesto) => Math.max(...lineasDe(m).map((l) => Math.abs(pct(l))));
  const pendiente = (m: Manifiesto) => lineasDe(m).some((l) => Math.abs(pct(l)) > 2 && !l.justificacion);
  const Estado = ({ m }: { m: Manifiesto }) => confirmados.has(m.numero) ? <Badge tone="ok">Confirmada</Badge> : pendiente(m) ? <Badge tone="bad"><AlertTriangle size={12} /> Diferencia</Badge> : <Badge tone="warn">Por confirmar</Badge>;
  const cols: Column<Manifiesto>[] = [
    { key: 'fecha', header: 'Llegada', render: (m) => <span className="num">{fmtFechaCorta(m.fecha)}</span>, priority: 1 },
    { key: 'mf', header: 'Manifiesto', render: (m) => <span className="num font-semibold">{m.numero}</span>, priority: 3 },
    { key: 'cli', header: 'Generador', render: (m) => <span className="block max-w-[200px] truncate font-medium">{cliente(solOf(m).clienteId).razonSocial}</span>, priority: 3 },
    { key: 'veh', header: 'Vehículo', render: (m) => <Placa id={m.vehiculoId} />, priority: 3 },
    { key: 'items', header: 'Ítems', align: 'center', render: (m) => lineasDe(m).length, priority: 3 },
    { key: 'dif', header: 'Mayor diferencia', align: 'right', render: (m) => <span className={cx(peor(m) > 2 && 'font-semibold text-bad')}>{fmtNum(peor(m))} %</span>, priority: 2 },
    { key: 'est', header: 'Recepción', render: (m) => <Estado m={m} />, priority: 3 },
  ];
  const confirmar = (m: Manifiesto) => {
    const nuevas = lineas.map((l) => (l.manifiesto === m.numero && just[l.itemId] ? { ...l, justificacion: just[l.itemId] } : l));
    if (nuevas.filter((l) => l.manifiesto === m.numero).some((l) => Math.abs(pct(l)) > 2 && !l.justificacion)) { toast('Hay diferencias de más de ±2 % sin explicación. Escríbala para confirmar.', 'warn'); return; }
    setLineas(nuevas); setConfirmados((s) => new Set(s).add(m.numero)); setSel(null); toast(`Recepción de ${m.numero} confirmada. Ya se puede emitir el certificado.`);
  };
  return (
    <>
      <PageHeader eyebrow="Planta Los Pinos" title="Recepción y pesaje" subtitle="Compare lo cargado en la sede (manifiesto) con lo pesado en la báscula de la planta. Por encima de ±2 % hay que explicar la diferencia."
        actions={<Button onClick={() => toast('Recepción del periodo exportada a Excel.', 'info')}><FileSpreadsheet size={16} /> Exportar</Button>} />
      <div className="mb-4 max-w-sm"><Field label="Generador" id="rc-c"><Select id="rc-c" value={cli} onChange={(e) => setCli(e.target.value)}><option value="">Todos</option>{CLIENTES.map((c) => <option key={c.id} value={c.id}>{c.razonSocial}</option>)}</Select></Field></div>
      <ResponsiveTable rows={recibidos} columns={cols} rowKey={(m) => m.id} onRowClick={(m) => { setSel(m); setJust({}); }}
        cardTitle={(m) => <span className="num">{m.numero} · {cliente(solOf(m).clienteId).razonSocial}</span>} cardBadge={(m) => <Estado m={m} />} />
      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel ? `Recepción ${sel.numero}` : ''}
        footer={sel && !confirmados.has(sel.numero) && <Button variant="primary" onClick={() => confirmar(sel)}>Confirmar recepción</Button>}>
        {sel && (
          <div className="flex flex-col gap-4">
            <DefList items={[['Generador', cliente(solOf(sel).clienteId).razonSocial], ['Sede', sucursal(solOf(sel).sucursalId).nombre], ['Vehículo', vehiculo(sel.vehiculoId).placa], ['Estado', confirmados.has(sel.numero) ? 'Confirmada' : 'Por confirmar']]} />
            {lineasDe(sel).map((l) => { const fuera = Math.abs(pct(l)) > 2; return (
              <div key={l.itemId} className={cx('rounded-xl border p-3', fuera && !l.justificacion ? 'border-bad' : 'border-line')}>
                <p className="font-medium">{item(l.itemId).nombre}</p>
                <div className="num mt-2 grid grid-cols-3 gap-2 text-[13px]"><span><span className="block text-[11px] text-subtle">En la sede</span>{fmtNum(l.origen)} {l.unidad}</span><span><span className="block text-[11px] text-subtle">En báscula</span>{fmtNum(l.destino)} {l.unidad}</span><span className={cx(fuera && 'font-semibold text-bad')}><span className="block text-[11px] text-subtle">Diferencia</span>{fmtNum(pct(l))} %</span></div>
                {fuera && (l.justificacion ? <p className="mt-2 text-[12px] text-info">Explicación: {l.justificacion}</p> : !confirmados.has(sel.numero) && (
                  <div className="mt-2"><Field label="¿Por qué difiere?" id={`j-${l.itemId}`}><Input id={`j-${l.itemId}`} value={just[l.itemId] ?? ''} onChange={(e) => setJust((s) => ({ ...s, [l.itemId]: e.target.value }))} placeholder="Ej. el lodo perdió agua en el trayecto" /></Field></div>))}
              </div>); })}
          </div>
        )}
      </Sheet>
    </>
  );
}

// ---------------------------- CERTIFICADOS ----------------------------
export function Certificados() {
  const toast = useToast();
  const [cli, setCli] = useState('');
  const base = MANIFIESTOS.filter((m) => m.estado === 'CERRADO').map((m, i) => ({ m, numero: `CT-${String(1388 + i)}`, estado: i % 4 === 3 ? 'Borrador' : 'Enviado', tipo: item(decl(solOf(m).items[0].declId).itemId).linea === 'Aprovechables' ? 'Aprovechamiento' : 'Tratamiento y disposición final' }));
  const rows = base.filter((a) => !cli || solOf(a.m).clienteId === cli);
  return (
    <>
      <PageHeader eyebrow="Planta Los Pinos" title="Certificados" subtitle="Certificados de tratamiento, disposición final y aprovechamiento. Se emiten solo cuando la recepción está confirmada y se envían por correo al generador." />
      <div className="mb-4 max-w-sm"><Field label="Generador" id="ce-c"><Select id="ce-c" value={cli} onChange={(e) => setCli(e.target.value)}><option value="">Todos</option>{CLIENTES.map((c) => <option key={c.id} value={c.id}>{c.razonSocial}</option>)}</Select></Field></div>
      <ResponsiveTable rows={rows} rowKey={(a) => a.numero} onRowClick={(a) => toast(`${a.numero}: ${a.estado === 'Enviado' ? 'abriendo PDF firmado' : 'en borrador; revíselo y envíelo'}.`, 'info')}
        cardTitle={(a) => <span className="num">{a.numero} · {cliente(solOf(a.m).clienteId).razonSocial}</span>} cardBadge={(a) => <Badge tone={a.estado === 'Enviado' ? 'ok' : 'info'}>{a.estado}</Badge>}
        columns={[
          { key: 'n', header: 'Certificado', render: (a) => <span className="num font-medium">{a.numero}</span>, priority: 3 },
          { key: 'f', header: 'Servicio', render: (a) => <span className="num">{fmtFechaCorta(a.m.fecha)}</span>, priority: 1 },
          { key: 'c', header: 'Generador', render: (a) => cliente(solOf(a.m).clienteId).razonSocial, priority: 3 },
          { key: 's', header: 'Sede', render: (a) => sucursal(solOf(a.m).sucursalId).nombre, priority: 3 },
          { key: 't', header: 'Tipo', render: (a) => a.tipo, priority: 2 },
          { key: 'mf', header: 'Manifiesto', render: (a) => <span className="num text-muted">{a.m.numero}</span>, priority: 3 },
          { key: 'e', header: 'Estado', render: (a) => <Badge tone={a.estado === 'Enviado' ? 'ok' : 'info'}>{a.estado}</Badge>, priority: 3 },
        ]} />
    </>
  );
}

// ---------------------------- INVENTARIO ----------------------------
export function Inventario() {
  const rows = INVENTARIO.map((r) => ({ ...r, saldo: r.entradas - r.salidas, dias: diasEntre(r.ingresoMasAntiguo, HOY) }));
  return (
    <>
      <PageHeader eyebrow="Planta Los Pinos" title="Inventario" subtitle="Existencias por bodega: entran con cada recepción y salen con cada despacho a tratamiento o a un gestor aliado." />
      <ResponsiveTable rows={rows} rowKey={(r) => r.bodega + r.itemId} cardTitle={(r) => item(r.itemId).nombre} cardMeta={(r) => r.bodega}
        cardBadge={(r) => <Badge tone={r.dias > 180 ? 'bad' : r.dias > 90 ? 'warn' : 'ok'}>{r.dias} días</Badge>}
        columns={[
          { key: 'r', header: 'Residuo', render: (r) => <span className="font-medium">{item(r.itemId).nombre}</span>, priority: 3 },
          { key: 'b', header: 'Bodega', render: (r) => r.bodega, priority: 3 },
          { key: 'sa', header: 'Saldo', align: 'right', render: (r) => <span className="font-semibold">{fmtNum(r.saldo)} {uni(item(r.itemId).unidad)}</span>, priority: 1 },
          { key: 'e', header: 'Entró', align: 'right', render: (r) => `${fmtNum(r.entradas)} ${uni(item(r.itemId).unidad)}`, priority: 3 },
          { key: 's', header: 'Salió', align: 'right', render: (r) => `${fmtNum(r.salidas)} ${uni(item(r.itemId).unidad)}`, priority: 3 },
          { key: 'd', header: 'Antigüedad', align: 'right', render: (r) => <Badge tone={r.dias > 180 ? 'bad' : r.dias > 90 ? 'warn' : 'ok'}>{r.dias} días</Badge>, priority: 2 },
        ]} />
      <p className="mt-3 text-[12px] text-muted">Umbrales de alerta de demostración: 90 y 180 días. Ajústelos al tiempo máximo de almacenamiento que fije su licencia o permiso.</p>
    </>
  );
}
