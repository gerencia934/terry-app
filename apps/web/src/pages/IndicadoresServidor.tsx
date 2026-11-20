// Indicadores e inicio con datos reales (fase 1c). Las cifras salen de las conciliaciones no anuladas: lo pesado en
// planta (o lo cargado, si aún no se concilia). Las toneladas cuentan solo las líneas en kg o toneladas; las demás
// unidades (galones, m³, unidades) se muestran aparte para no sumar peras con manzanas.
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Info, Receipt, ShieldCheck, Truck, Weight } from 'lucide-react';
import { Card, Field, Input, Kpi, PageHeader, Tabs } from '../components/ui';
import { BuscarCliente } from '../components/BuscarCliente';
import { tienePermiso } from '../lib/api';
import { hoyCo, useApi } from '../lib/servidor';
import { fmtNum } from '../lib/format';
import { useChartColors } from './Informes';

export interface Indicadores {
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
