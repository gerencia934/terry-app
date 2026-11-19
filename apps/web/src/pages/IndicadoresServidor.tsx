// Indicadores e inicio con datos reales (fase 1c). Las cifras salen de las conciliaciones no anuladas: lo pesado en
// planta (o lo cargado, si aún no se concilia). Las toneladas cuentan solo las líneas en kg o toneladas; las demás
// unidades (galones, m³, unidades) se muestran aparte para no sumar peras con manzanas.
import { useState, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowRight, CalendarClock, ChevronRight, Info, MapPin, Receipt, Route as RouteIcon, ShieldCheck, Truck, Weight } from 'lucide-react';
import { Badge, Button, Card, ColorBadge, Field, Input, Kpi, PageHeader, Tabs } from '../components/ui';
import { BuscarCliente } from '../components/BuscarCliente';
import { useAlertas } from '../lib/alertas';
import { sesionActual, tienePermiso } from '../lib/api';
import { hoyCo, useApi } from '../lib/servidor';
import { useRouter, type RouteName } from '../lib/router';
import { cx, diasEntre, fmtFecha, fmtNum } from '../lib/format';
import { useChartColors } from './Informes';

interface Indicadores {
  desde: string; hasta: string;
  totales: { toneladas: number; facturado: number; comprado: number; servicios: number };
  serie: { mes: string; toneladas: number; facturado: number; comprado: number; servicios: number }[];
  porCliente: { nombre: string; toneladas: number; facturado: number }[];
  porDestino: { nombre: string; toneladas: number }[]; porTratamiento: { nombre: string; toneladas: number }[];
  porVehiculo: { nombre: string; servicios: number; toneladas: number }[]; porConductor: { nombre: string; toneladas: number; servicios: number }[];
  otrasUnidades: { unidad: string; cantidad: number }[];
  operacion: { inspecciones: { aprobadas: number; noAprobadas: number; pendientes: number; porcentajeAprobadas: number | null }; diferenciaBascula: number | null };
}
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const etiquetaMes = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${MESES[m - 1]} ${String(y).slice(2)}`; };
const millones = (v: number) => `$${fmtNum(Math.round(v / 100_000) / 10)} M`;

/** Gráficos con los colores del tema (claro u oscuro). */
function useGraficos() {
  const c = useChartColors();
  const axis = { stroke: c.line, tick: { fill: c.muted, fontSize: 12 }, tickLine: false };
  const tip = { contentStyle: { background: c.surface, border: `1px solid ${c.line}`, borderRadius: 10, fontSize: 13, color: c.fg }, labelStyle: { color: c.fg, fontWeight: 600 }, itemStyle: { color: c.fg } };
  const Barras = ({ rows, unidad }: { rows: { n: string; v: number }[]; unidad: string }) => (
    !rows.length ? <Vacio /> : <div style={{ height: Math.max(120, rows.length * 34) }}><ResponsiveContainer><BarChart data={rows} layout="vertical" margin={{ top: 0, right: 56, left: 8, bottom: 0 }} barCategoryGap="28%">
      <CartesianGrid horizontal={false} stroke={c.grid} /><XAxis type="number" {...axis} axisLine={false} /><YAxis type="category" dataKey="n" width={160} {...axis} axisLine={false} />
      <Tooltip {...tip} cursor={{ fill: c.grid, opacity: 0.5 }} formatter={(v: number) => [`${fmtNum(v)} ${unidad}`, '']} />
      <Bar isAnimationActive={false} dataKey="v" fill={c.brand} radius={[0, 4, 4, 0]} label={{ position: 'right', fill: c.muted, fontSize: 12, formatter: (v: number) => fmtNum(v) }} />
    </BarChart></ResponsiveContainer></div>
  );
  const Torta = ({ rows, unidad }: { rows: { nombre: string; valor: number }[]; unidad: string }) => (
    !rows.length ? <Vacio /> : <div className="grid items-center gap-4 sm:grid-cols-[180px_1fr]">
      <div className="h-44"><ResponsiveContainer><PieChart><Pie isAnimationActive={false} data={rows} dataKey="valor" nameKey="nombre" innerRadius="52%" outerRadius="90%" stroke={c.surface} strokeWidth={2}>
        {rows.map((_, i) => <Cell key={i} fill={c.series[i % c.series.length]} />)}</Pie><Tooltip {...tip} formatter={(v: number, n: string) => [`${fmtNum(v)} ${unidad}`, n]} /></PieChart></ResponsiveContainer></div>
      <ul className="flex flex-col gap-2">{rows.map((r, i) => <li key={r.nombre} className="flex items-center gap-2.5 text-[13px]"><span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: c.series[i % c.series.length] }} /><span className="min-w-0 flex-1 truncate">{r.nombre}</span><span className="num font-medium">{fmtNum(r.valor)} {unidad}</span></li>)}</ul>
    </div>
  );
  return { c, axis, tip, Barras, Torta };
}
const Vacio = () => <p className="py-6 text-center text-[13px] text-muted">Sin datos en el periodo.</p>;

export function IndicadoresServidor() {
  const { c, axis, tip, Barras, Torta } = useGraficos();
  const hoy = hoyCo();
  const [y, m] = hoy.split('-').map(Number);
  const vacio = { desde: new Date(Date.UTC(y, m - 12, 1)).toISOString().slice(0, 10), hasta: hoy, clienteId: '' };
  const [f, setF] = useState(vacio);
  const [tab, setTab] = useState<'negocio' | 'operacion'>('negocio');
  const puede = tienePermiso('informes.ver');
  const qs = new URLSearchParams({ desde: f.desde, hasta: f.hasta, ...(f.clienteId && { clienteId: f.clienteId }) }).toString();
  const { datos: d, error, cargando } = useApi<Indicadores>(puede && f.desde && f.hasta ? `/informes/indicadores?${qs}` : null);
  if (!puede) return <><PageHeader eyebrow="Análisis" title="Indicadores" /><p className="rounded-xl bg-surface-2 p-4 text-muted">Para ver los indicadores se necesita el permiso «informes.ver».</p></>;
  const serie = (d?.serie ?? []).map((x) => ({ ...x, mes: etiquetaMes(x.mes) }));
  return (
    <>
      <PageHeader eyebrow="Análisis" title="Indicadores" subtitle="Con lo conciliado en planta (o lo cargado, si aún no se concilia), por fecha de servicio. Las toneladas cuentan solo las líneas en kg o toneladas." />
      <div className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-line bg-surface p-3 lg:grid-cols-4">
        <Field label="Desde" id="ix-d"><Input id="ix-d" type="date" value={f.desde} max={f.hasta} onChange={(e) => setF((s) => ({ ...s, desde: e.target.value }))} /></Field>
        <Field label="Hasta" id="ix-h"><Input id="ix-h" type="date" value={f.hasta} min={f.desde} onChange={(e) => setF((s) => ({ ...s, hasta: e.target.value }))} /></Field>
        <div className="col-span-2"><Field label="Cliente" id="ix-c"><BuscarCliente id="ix-c" valor={f.clienteId} vacio="Todos" onChange={(x) => setF((s) => ({ ...s, clienteId: x?.id ?? '' }))} /></Field></div>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3"><Tabs value={tab} onChange={setTab} items={[{ value: 'negocio', label: 'Negocio' }, { value: 'operacion', label: 'Operación' }]} />{cargando && <span className="text-[13px] text-muted">Actualizando…</span>}</div>
      {error && <p className="rounded-xl bg-bad/10 p-4 text-bad">{error}</p>}
      {!d && !error && <p className="p-6 text-center text-muted">Cargando…</p>}
      {d && tab === 'negocio' && (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Kpi label="Gestionado" value={`${fmtNum(d.totales.toneladas)} t`} icon={<Weight size={16} />} hint="en kg o toneladas" />
            <Kpi label="Facturado" value={millones(d.totales.facturado)} icon={<Receipt size={16} />} hint="cobro de las líneas conciliadas" />
            <Kpi label="Servicios" value={fmtNum(d.totales.servicios)} icon={<Truck size={16} />} hint="manifiestos con conciliación" />
            <Kpi label="Compras de aprovechables" value={millones(d.totales.comprado)} icon={<Receipt size={16} />} hint="líneas en «Compra»" />
          </div>
          {d.otrasUnidades.length > 0 && <p className="flex items-start gap-2 text-[13px] text-muted"><Info size={14} className="mt-0.5 shrink-0" />Además, en otras unidades: {d.otrasUnidades.map((x) => `${fmtNum(x.cantidad)} ${x.unidad}`).join(' · ')}.</p>}
          <div className="grid gap-5 xl:grid-cols-2">
            <Card title="Toneladas y servicios por mes">{!serie.length ? <Vacio /> : <div className="h-64"><ResponsiveContainer><LineChart data={serie} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={c.grid} /><XAxis dataKey="mes" {...axis} /><YAxis yAxisId="t" {...axis} axisLine={false} /><YAxis yAxisId="s" orientation="right" {...axis} axisLine={false} />
              <Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 12 }} />
              <Line isAnimationActive={false} yAxisId="t" type="monotone" dataKey="toneladas" name="Toneladas" stroke={c.brand} strokeWidth={2} dot={false} />
              <Line isAnimationActive={false} yAxisId="s" type="monotone" dataKey="servicios" name="Servicios" stroke={c.series[2]} strokeWidth={2} dot={false} />
            </LineChart></ResponsiveContainer></div>}</Card>
            <Card title="Facturado y comprado por mes (millones COP)">{!serie.length ? <Vacio /> : <div className="h-64"><ResponsiveContainer><BarChart data={serie.map((x) => ({ ...x, facturado: Math.round(x.facturado / 100_000) / 10, comprado: Math.round(x.comprado / 100_000) / 10 }))} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={c.grid} /><XAxis dataKey="mes" {...axis} /><YAxis {...axis} axisLine={false} /><Tooltip {...tip} cursor={{ fill: c.grid, opacity: 0.5 }} /><Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar isAnimationActive={false} dataKey="facturado" name="Facturado" fill={c.brand} radius={[4, 4, 0, 0]} /><Bar isAnimationActive={false} dataKey="comprado" name="Comprado" fill={c.series[3]} radius={[4, 4, 0, 0]} />
            </BarChart></ResponsiveContainer></div>}</Card>
            <Card title="Toneladas por cliente (10 mayores)"><Barras rows={d.porCliente.filter((x) => x.toneladas > 0).map((x) => ({ n: x.nombre, v: x.toneladas }))} unidad="t" /></Card>
            <Card title="Facturación por cliente (millones COP)"><Barras rows={[...d.porCliente].filter((x) => x.facturado > 0).sort((a, b) => b.facturado - a.facturado).map((x) => ({ n: x.nombre, v: Math.round(x.facturado / 100_000) / 10 }))} unidad="M" /></Card>
            <Card title="Toneladas por destino"><Torta rows={d.porDestino.map((x) => ({ nombre: x.nombre, valor: x.toneladas }))} unidad="t" /></Card>
            <Card title="Toneladas por tratamiento"><Torta rows={d.porTratamiento.map((x) => ({ nombre: x.nombre, valor: x.toneladas }))} unidad="t" /></Card>
          </div>
        </div>
      )}
      {d && tab === 'operacion' && (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Kpi label="Servicios" value={fmtNum(d.totales.servicios)} icon={<Truck size={16} />} hint="manifiestos con conciliación" />
            <Kpi label="Inspecciones aprobadas" value={d.operacion.inspecciones.porcentajeAprobadas === null ? '—' : `${fmtNum(d.operacion.inspecciones.porcentajeAprobadas)} %`} icon={<ShieldCheck size={16} />}
              hint={`${d.operacion.inspecciones.aprobadas} aprobadas · ${d.operacion.inspecciones.noAprobadas} no`} />
            <Kpi label="Diferencia en báscula" value={d.operacion.diferenciaBascula === null ? '—' : `${d.operacion.diferenciaBascula > 0 ? '+' : ''}${fmtNum(d.operacion.diferenciaBascula)} %`} icon={<Weight size={16} />} hint="planta contra lo cargado" />
            <Kpi label="Gestionado" value={`${fmtNum(d.totales.toneladas)} t`} icon={<Weight size={16} />} hint="en kg o toneladas" />
          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            <Card title="Servicios por vehículo"><Barras rows={d.porVehiculo.map((x) => ({ n: x.nombre, v: x.servicios }))} unidad="servicios" /></Card>
            <Card title="Toneladas por conductor"><Barras rows={d.porConductor.filter((x) => x.toneladas > 0).map((x) => ({ n: x.nombre, v: x.toneladas }))} unidad="t" /></Card>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------- INICIO ----------------------------
interface Inicio {
  hoy: string; mes: string; recorridosMes: number;
  cadena: { solicitadas: number; programadas: number; recolectadas: number; pesadas: number; certificadas: number };
  negocio: { toneladas: number; facturado: number; servicios: number; comprado: number } | null;
  rutasHoy: { id: string; codigo: string; vehiculo: { placa: string; color: string } | null; conductor: string | null; etapa: { nombre: string; color: string; orden: number; esFinal: boolean; cancela: boolean } | null; etapas: number; paradas: number; atendidas: number; clientes: string[] }[];
  agenda: { hoy: number; manana: number; semana: number };
  obligaciones: { id: string; codigo: string | null; descripcion: string; proximaFecha: string; permiso: { acto: string } }[];
}
const saludo = () => { const h = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota', hour: 'numeric', hour12: false })); return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'; };

export function InicioServidor() {
  const { go } = useRouter();
  const al = useAlertas();
  const { datos: d, error } = useApi<Inicio>('/informes/inicio');
  const nombre = sesionActual()?.usuario.nombre.split(' ')[0] ?? '';
  const mesNombre = d ? `${MESES[Number(d.mes.slice(5, 7)) - 1]}` : '';
  const cadena: { n: number; label: string; route: RouteName; hint: string }[] = d ? [
    { n: d.cadena.solicitadas, label: 'Solicitadas', route: 'solicitudes', hint: 'líneas formales del mes' },
    { n: d.cadena.programadas, label: 'Programadas', route: 'programacion', hint: 'en una ruta o ya hechas' },
    { n: d.cadena.recolectadas, label: 'Recolectadas', route: 'manifiestos', hint: 'en un manifiesto grabado' },
    { n: d.cadena.pesadas, label: 'Pesadas en planta', route: 'recepcion', hint: 'conciliadas' },
    { n: d.cadena.certificadas, label: 'Certificadas', route: 'certificados', hint: 'en un acta emitida' },
  ] : [];
  const max = Math.max(...cadena.map((x) => x.n), 1);
  const caja = (t: ReactNode) => <Card><p className="text-muted">{t}</p></Card>;
  return (
    <>
      <div className="mb-6 flex flex-col gap-1">
        <p className="text-[13px] text-muted">{fmtFecha(hoyCo())}</p>
        <h1 className="text-[26px] font-bold text-brand-strong">{saludo()}{nombre ? `, ${nombre}` : ''}</h1>
      </div>
      {error && caja(error)}
      {d && (
        <>
          <Card className="mb-5">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[15px] font-semibold">Cadena de trazabilidad · {mesNombre}</h2>
              <p className="text-[12px] text-muted">Cada servicio debe llegar hasta «Certificadas». Toque un eslabón para ver el detalle.</p>
            </div>
            <ol className="grid gap-2 sm:grid-cols-5">
              {cadena.map((x, i) => (
                <li key={x.label}>
                  <button onClick={() => go(x.route)} className="group flex h-full w-full flex-col gap-2 rounded-xl border border-line p-3 text-left transition-colors hover:border-brand">
                    <span className="flex items-center justify-between text-[12px] font-medium text-muted"><span>{i + 1}. {x.label}</span>{i < cadena.length - 1 && <ArrowRight size={14} className="hidden text-subtle sm:block" />}</span>
                    <span className="num font-display text-[28px] font-semibold leading-none">{fmtNum(x.n)}</span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full bg-brand" style={{ width: `${(x.n / max) * 100}%` }} /></span>
                    <span className="text-[11px] text-subtle">{x.hint}</span>
                  </button>
                </li>
              ))}
            </ol>
          </Card>
          <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
            {d.negocio ? <>
              <Kpi label="Servicios del mes" value={fmtNum(d.negocio.servicios)} icon={<Truck size={16} />} hint="manifiestos con conciliación" />
              <Kpi label="Facturado del mes" value={millones(d.negocio.facturado)} icon={<Receipt size={16} />} hint="cobro conciliado" />
              <Kpi label="Gestionado" value={`${fmtNum(d.negocio.toneladas)} t`} icon={<Weight size={16} />} hint="en kg o toneladas" />
            </> : null}
            <Kpi label="Recorridos del mes" value={fmtNum(d.recorridosMes)} icon={<RouteIcon size={16} />} hint={`${d.agenda.hoy} hoy`} />
          </div>
          <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
            <div className="flex min-w-0 flex-col gap-5">
              <Card title="Operación de hoy" pad={false} action={<Button size="sm" variant="ghost" onClick={() => go('seguimiento')}>Seguimiento <ChevronRight size={15} /></Button>}>
                {!d.rutasHoy.length && <p className="px-4 py-6 text-center text-[13px] text-muted">No hay recorridos programados para hoy.</p>}
                <ul className="divide-y divide-line">
                  {d.rutasHoy.map((r) => (
                    <li key={r.id} className="flex flex-col gap-2 px-4 py-3.5">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {r.vehiculo ? <ColorBadge color={r.vehiculo.color}>{r.vehiculo.placa}</ColorBadge> : <Badge tone="bad">Sin vehículo</Badge>}
                        <span className="text-[13px] font-medium">{r.conductor ?? 'Sin conductor'}</span>
                        <span className="num text-[12px] text-muted">{r.codigo}</span>
                        <span className="ml-auto">{r.etapa ? <ColorBadge color={r.etapa.color}>{r.etapa.nombre}</ColorBadge> : <Badge>Programada</Badge>}</span>
                      </div>
                      {r.clientes.length > 0 && <p className="truncate text-[12px] text-muted"><MapPin size={12} className="mr-1 inline" />{r.clientes.join(' · ')}</p>}
                      <div className="flex items-center gap-2 text-[12px] text-muted">
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2"><span className={cx('block h-full rounded-full', r.etapa?.cancela ? 'bg-bad' : 'bg-brand')} style={{ width: `${r.paradas ? (r.atendidas / r.paradas) * 100 : 0}%` }} /></span>
                        <span className="num">{r.atendidas}/{r.paradas} paradas</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
              <Card title="Agenda de recorridos" action={<CalendarClock size={17} className="text-subtle" />}>
                <div className="grid grid-cols-3 gap-3">
                  {[['Hoy', d.agenda.hoy], ['Mañana', d.agenda.manana], ['Próximos 7 días', d.agenda.semana]].map(([l, n]) => (
                    <button key={l} onClick={() => go('programacion')} className="rounded-xl bg-surface-2 p-3 text-left hover:bg-brand-soft/60"><p className="num font-display text-[24px] font-semibold">{n}</p><p className="text-[12px] text-muted">{l}</p></button>
                  ))}
                </div>
              </Card>
            </div>
            <div className="flex min-w-0 flex-col gap-5">
              <Card title="Requiere atención" pad={false} action={<Badge tone="bad">{al.filter((a) => a.tone === 'bad').length} urgentes</Badge>}>
                {!al.length && <p className="px-4 py-6 text-center text-[13px] text-muted">Nada pendiente.</p>}
                <ul className="divide-y divide-line">
                  {al.slice(0, 6).map((a) => (
                    <li key={a.id}><button onClick={() => go(a.route)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-2">
                      <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', a.tone === 'bad' ? 'bg-bad' : a.tone === 'warn' ? 'bg-warn' : 'bg-info')} />
                      <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium">{a.titulo}</span><span className="block truncate text-[12px] text-muted">{a.detalle}</span></span>
                    </button></li>
                  ))}
                </ul>
              </Card>
              <Card title={<span className="flex items-center gap-2"><ShieldCheck size={16} className="text-brand" />Próximas obligaciones</span>} action={<Button size="sm" variant="ghost" onClick={() => go('permisos')}>Ver todas</Button>}>
                {!d.obligaciones.length && <p className="text-[13px] text-muted">No hay obligaciones con fecha pendientes.</p>}
                <ul className="flex flex-col gap-3">
                  {d.obligaciones.map((o) => { const n = diasEntre(d.hoy, o.proximaFecha.slice(0, 10)); return (
                    <li key={o.id} className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><p className="text-[13px] font-semibold">{o.permiso.acto}</p><p className="truncate text-[12px] text-muted">{o.codigo ? `${o.codigo} · ` : ''}{o.descripcion}</p></div>
                      <Badge tone={n < 0 || n <= 15 ? 'bad' : n <= 30 ? 'warn' : 'ok'}>{n < 0 ? `vencida` : `${n} días`}</Badge>
                    </li>); })}
                </ul>
              </Card>
            </div>
          </div>
        </>
      )}
    </>
  );
}
