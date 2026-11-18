import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, Kpi, PageHeader, Tabs } from '../components/ui';
import { CAUSALES_CANCELACION, DIST_MANEJO, SERIE_MENSUAL } from '../data/mock';
import { fmtNum } from '../lib/format';

/** Lee los tokens de color actuales (cambian con el tema) para pasarlos a Recharts. */
function useChartColors() {
  const read = () => {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string) => `rgb(${cs.getPropertyValue(`--${n}`).trim().split(/\s+/).join(',')})`;
    return { brand: v('brand'), grid: v('chart-grid'), fg: v('fg'), muted: v('muted'), surface: v('surface'), line: v('line'),
      series: [1, 2, 3, 4, 5, 6].map((i) => v(`chart-${i}`)) };
  };
  const [c, setC] = useState(read);
  useEffect(() => {
    const upd = () => setC(read());
    const mo = new MutationObserver(upd); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = window.matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener('change', upd);
    return () => { mo.disconnect(); mq.removeEventListener('change', upd); };
  }, []);
  return c;
}

const VEH = [{ n: 'TVL238 · hospitalario', v: 214 }, { n: 'TVL214 · RESPEL', v: 168 }, { n: 'TVQ905 · vactor', v: 131 }, { n: 'SXR512 · volqueta', v: 96 }, { n: 'WGN731 · USP', v: 88 }];
const COND = [{ n: 'Édgar Quintero', v: 221 }, { n: 'Wilson Carreño', v: 176 }, { n: 'Nelson Ardila', v: 172 }, { n: 'Fabián Rojas', v: 128 }];

export default function Informes() {
  const c = useChartColors();
  const [tab, setTab] = useState<'gen' | 'op'>('gen');
  const axis = { stroke: c.line, tick: { fill: c.muted, fontSize: 12 }, tickLine: false };
  const tip = { contentStyle: { background: c.surface, border: `1px solid ${c.line}`, borderRadius: 10, fontSize: 13, color: c.fg }, labelStyle: { color: c.fg, fontWeight: 600 }, itemStyle: { color: c.fg } };
  const data = SERIE_MENSUAL.map((d, i) => ({ ...d, mes: i === 11 ? 'Nov*' : d.mes }));
  const tot = (k: 'servicios' | 'facturado' | 'comprado' | 'toneladas') => SERIE_MENSUAL.reduce((a, d) => a + d[k], 0);

  return (
    <>
      <PageHeader eyebrow="Informes" title="Indicadores de gestión" subtitle="Últimos 12 meses (dic 2025 – nov 2026). *Noviembre es el mes en curso, con corte al día 18." />
      <div className="mb-4"><Tabs value={tab} onChange={setTab} items={[{ value: 'gen', label: 'Indicadores generales' }, { value: 'op', label: 'Indicadores operativos' }]} /></div>

      {tab === 'gen' ? (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Kpi label="Total de servicios" value={fmtNum(tot('servicios'))} hint="12 meses" />
            <Kpi label="Total facturado" value={`$${fmtNum(tot('facturado') / 1000)} mil M`} hint="COP, 12 meses" />
            <Kpi label="Total comprado" value={`$${fmtNum(tot('comprado'))} M`} hint="material aprovechable" />
            <Kpi label="Toneladas gestionadas" value={`${fmtNum(tot('toneladas'))} t`} hint="12 meses" />
          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            <Card title="Servicios por mes">
              <div className="h-64"><ResponsiveContainer><BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barCategoryGap="22%">
                <CartesianGrid vertical={false} stroke={c.grid} /><XAxis dataKey="mes" {...axis} /><YAxis {...axis} axisLine={false} />
                <Tooltip {...tip} cursor={{ fill: c.grid, opacity: 0.5 }} formatter={(v: number) => [fmtNum(v), 'Servicios']} />
                <Bar isAnimationActive={false} dataKey="servicios" fill={c.brand} radius={[4, 4, 0, 0]} />
              </BarChart></ResponsiveContainer></div>
            </Card>
            <Card title="Facturado y comprado (millones COP)">
              <div className="h-64"><ResponsiveContainer><LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={c.grid} /><XAxis dataKey="mes" {...axis} /><YAxis {...axis} axisLine={false} />
                <Tooltip {...tip} formatter={(v: number, n: string) => [`$${fmtNum(v)} M`, n]} />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: c.muted }} />
                <Line isAnimationActive={false} name="Facturado" dataKey="facturado" stroke={c.series[0]} strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: c.surface, strokeWidth: 2 }} />
                <Line isAnimationActive={false} name="Comprado" dataKey="comprado" stroke={c.series[1]} strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: c.surface, strokeWidth: 2 }} />
              </LineChart></ResponsiveContainer></div>
            </Card>
            <Card title="Distribución por tipo de manejo (% de toneladas)" className="xl:col-span-2">
              <div className="grid items-center gap-4 md:grid-cols-[280px_1fr]">
                <div className="h-60"><ResponsiveContainer><PieChart>
                  <Pie isAnimationActive={false} data={DIST_MANEJO} dataKey="valor" nameKey="nombre" innerRadius="55%" outerRadius="90%" paddingAngle={1} stroke={c.surface} strokeWidth={2}>
                    {DIST_MANEJO.map((_, i) => <Cell key={i} fill={c.series[i]} />)}
                  </Pie><Tooltip {...tip} formatter={(v: number, n: string) => [`${v} %`, n]} />
                </PieChart></ResponsiveContainer></div>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {DIST_MANEJO.map((d, i) => (
                    <li key={d.nombre} className="flex items-center gap-2.5 text-[13px]"><span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: c.series[i] }} /><span className="flex-1 text-fg">{d.nombre}</span><span className="num font-medium text-fg">{d.valor} %</span></li>
                  ))}
                </ul>
              </div>
            </Card>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Kpi label="Preoperacionales aprobados" value="96 %" hint="primer intento, 30 días" />
            <Kpi label="Servicios por vehículo" value={fmtNum(tot('servicios') / 5)} hint="promedio, 5 vehículos" />
            <Kpi label="Diferencia de conciliación" value="−0,9 %" hint="promedio origen vs. báscula" />
            <Kpi label="Cancelaciones" value={String(CAUSALES_CANCELACION.reduce((a, x) => a + x.valor, 0))} hint="12 meses" />
          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            {([['Servicios por vehículo', VEH], ['Servicios por conductor', COND]] as const).map(([t, rows]) => (
              <Card key={t} title={t}>
                <div className="h-60"><ResponsiveContainer><BarChart data={rows as unknown as { n: string; v: number }[]} layout="vertical" margin={{ top: 0, right: 36, left: 8, bottom: 0 }} barCategoryGap="28%">
                  <CartesianGrid horizontal={false} stroke={c.grid} /><XAxis type="number" {...axis} axisLine={false} /><YAxis type="category" dataKey="n" width={150} {...axis} axisLine={false} />
                  <Tooltip {...tip} cursor={{ fill: c.grid, opacity: 0.5 }} formatter={(v: number) => [fmtNum(v), 'Servicios']} />
                  <Bar isAnimationActive={false} dataKey="v" fill={c.brand} radius={[0, 4, 4, 0]} label={{ position: 'right', fill: c.muted, fontSize: 12 }} />
                </BarChart></ResponsiveContainer></div>
              </Card>
            ))}
            <Card title="Toneladas gestionadas por mes">
              <div className="h-60"><ResponsiveContainer><LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={c.grid} /><XAxis dataKey="mes" {...axis} /><YAxis {...axis} axisLine={false} />
                <Tooltip {...tip} formatter={(v: number) => [`${fmtNum(v)} t`, 'Toneladas']} />
                <Line isAnimationActive={false} dataKey="toneladas" stroke={c.brand} strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: c.surface, strokeWidth: 2 }} />
              </LineChart></ResponsiveContainer></div>
            </Card>
            <Card title="Causales de cancelación">
              <div className="grid items-center gap-4 sm:grid-cols-[200px_1fr]">
                <div className="h-48"><ResponsiveContainer><PieChart>
                  <Pie isAnimationActive={false} data={CAUSALES_CANCELACION} dataKey="valor" nameKey="nombre" innerRadius="55%" outerRadius="90%" stroke={c.surface} strokeWidth={2}>
                    {CAUSALES_CANCELACION.map((_, i) => <Cell key={i} fill={c.series[i]} />)}
                  </Pie><Tooltip {...tip} />
                </PieChart></ResponsiveContainer></div>
                <ul className="flex flex-col gap-2">
                  {CAUSALES_CANCELACION.map((d, i) => <li key={d.nombre} className="flex items-center gap-2.5 text-[13px]"><span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: c.series[i] }} /><span className="flex-1">{d.nombre}</span><span className="num font-medium">{d.valor}</span></li>)}
                </ul>
              </div>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
