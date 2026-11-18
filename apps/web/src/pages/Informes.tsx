import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download, FileSpreadsheet, Mail, Wallet, ClipboardList, ShieldCheck } from 'lucide-react';
import { Button, Card, Field, Input, Kpi, PageHeader, Select, Tabs, useToast } from '../components/ui';
import { CAUSALES_CANCELACION, CLIENTES, DIST_MANEJO, RUTAS_MES, SERIE_MENSUAL, VEHICULOS } from '../data/mock';
import { fmtNum } from '../lib/format';

/** Lee los tokens de color actuales (cambian con el tema) para pasarlos a Recharts. */
function useChartColors() {
  const read = () => {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string) => `rgb(${cs.getPropertyValue(`--${n}`).trim().split(/\s+/).join(',')})`;
    return { brand: v('brand'), grid: v('chart-grid'), fg: v('fg'), muted: v('muted'), surface: v('surface'), line: v('line'), series: [1, 2, 3, 4, 5, 6].map((i) => v(`chart-${i}`)) };
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

function Filtros({ extra }: { extra?: React.ReactNode }) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-line bg-surface p-3 lg:grid-cols-5">
      <Field label="Desde" id="i-d"><Input id="i-d" type="date" defaultValue="2026-11-01" /></Field>
      <Field label="Hasta" id="i-h"><Input id="i-h" type="date" defaultValue="2026-11-18" /></Field>
      <Field label="Cliente" id="i-c"><Select id="i-c" defaultValue=""><option value="">Todos</option>{CLIENTES.map((c) => <option key={c.id} value={c.id}>{c.razonSocial}</option>)}</Select></Field>
      <Field label="Sede" id="i-s"><Select id="i-s" defaultValue=""><option value="">Todas</option></Select></Field>
      {extra}
    </div>
  );
}

export function Informes() {
  const toast = useToast();
  const items: [typeof FileSpreadsheet, string, string][] = [
    [FileSpreadsheet, 'Consolidado de servicios', 'Cada servicio con su residuo, cantidad, tratamiento, destino y valor, por cliente y sede.'],
    [Wallet, 'Cartera por cliente', 'Facturado, recaudado y saldo según la forma de pago pactada.'],
    [Mail, 'Trazabilidad de envíos al cliente', 'Certificados y manifiestos enviados a cada generador, con fecha de envío y de apertura.'],
    [ClipboardList, 'Informe para el IDEAM / CAR', 'Cantidades gestionadas por corriente Y/A y tipo de manejo para los informes a la autoridad ambiental.'],
    [ShieldCheck, 'Cumplimiento de permisos', 'Obligaciones de cada permiso de la CAS con su fecha y estado.'],
  ];
  return (
    <>
      <PageHeader eyebrow="Análisis" title="Informes" subtitle="Cada informe se descarga en Excel con los filtros seleccionados." />
      <Filtros extra={<Field label="Manifiesto" id="i-m"><Input id="i-m" placeholder="MT-2401" /></Field>} />
      <Card title="Informes disponibles" pad={false}>
        <ul className="divide-y divide-line">
          {items.map(([I, t, d]) => (
            <li key={t} className="flex items-center gap-3 px-4 py-3">
              <I size={20} className="shrink-0 text-brand" />
              <div className="min-w-0 flex-1"><p className="text-[14px] font-medium">{t}</p><p className="text-[12px] text-muted">{d}</p></div>
              <Button size="sm" variant="primary" onClick={() => toast(`«${t}» generado en Excel.`, 'info')} aria-label={`Descargar ${t}`}><Download size={15} /><span className="hidden sm:inline">Descargar</span></Button>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

export default function Indicadores() {
  const c = useChartColors();
  const toast = useToast();
  const [tab, setTab] = useState<'gen' | 'op'>('gen');
  const axis = { stroke: c.line, tick: { fill: c.muted, fontSize: 12 }, tickLine: false };
  const tip = { contentStyle: { background: c.surface, border: `1px solid ${c.line}`, borderRadius: 10, fontSize: 13, color: c.fg }, labelStyle: { color: c.fg, fontWeight: 600 }, itemStyle: { color: c.fg } };
  const data = SERIE_MENSUAL.map((d, i) => ({ ...d, mes: i === 11 ? 'Nov*' : d.mes }));
  const nov = SERIE_MENSUAL[11];
  const porVeh = VEHICULOS.map((v) => ({ n: `${v.placa} ${v.marca}`, v: RUTAS_MES.filter((r) => r.vehiculoId === v.id && r.fecha <= '2026-11-18').length, color: v.color }));
  const totVeh = porVeh.reduce((a, x) => a + x.v, 0);
  const porCliente = [{ n: 'Campo Las Monas', v: 52.4 }, { n: 'Agroind. La Esperanza', v: 31.8 }, { n: 'Lácteos del Oriente', v: 22.1 }, { n: 'Recuperadora Ecociclo', v: 19.6 }, { n: 'Clínica Santa Lucía', v: 11.3 }];
  const porCond = [{ n: 'Wilson Carreño', v: 41.2 }, { n: 'Édgar Quintero', v: 38.5 }, { n: 'Nelson Ardila', v: 51.7 }, { n: 'Fabián Rojas', v: 39.6 }];
  const Barras = ({ rows, unidad, color }: { rows: { n: string; v: number }[]; unidad: string; color?: string }) => (
    <div className="h-60"><ResponsiveContainer><BarChart data={rows} layout="vertical" margin={{ top: 0, right: 44, left: 8, bottom: 0 }} barCategoryGap="28%">
      <CartesianGrid horizontal={false} stroke={c.grid} /><XAxis type="number" {...axis} axisLine={false} /><YAxis type="category" dataKey="n" width={150} {...axis} axisLine={false} />
      <Tooltip {...tip} cursor={{ fill: c.grid, opacity: 0.5 }} formatter={(v: number) => [`${fmtNum(v)} ${unidad}`, '']} />
      <Bar isAnimationActive={false} dataKey="v" fill={color ?? c.brand} radius={[0, 4, 4, 0]} label={{ position: 'right', fill: c.muted, fontSize: 12, formatter: (v: number) => fmtNum(v) }} />
    </BarChart></ResponsiveContainer></div>
  );
  const Torta = ({ rows, unidad }: { rows: { nombre: string; valor: number; color?: string }[]; unidad: string }) => (
    <div className="grid items-center gap-4 sm:grid-cols-[200px_1fr]">
      <div className="h-48"><ResponsiveContainer><PieChart><Pie isAnimationActive={false} data={rows} dataKey="valor" nameKey="nombre" innerRadius="52%" outerRadius="90%" stroke={c.surface} strokeWidth={2}>
        {rows.map((r, i) => <Cell key={i} fill={r.color ?? c.series[i]} />)}</Pie><Tooltip {...tip} formatter={(v: number, n: string) => [`${fmtNum(v)} ${unidad}`, n]} /></PieChart></ResponsiveContainer></div>
      <ul className="flex flex-col gap-2">{rows.map((r, i) => <li key={r.nombre} className="flex items-center gap-2.5 text-[13px]"><span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: r.color ?? c.series[i] }} /><span className="flex-1">{r.nombre}</span><span className="num font-medium">{fmtNum(r.valor)} {unidad}</span></li>)}</ul>
    </div>
  );

  return (
    <>
      <PageHeader eyebrow="Análisis" title="Indicadores" subtitle="Doce meses de operación. *Noviembre va con corte al día 18." />
      <Filtros />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={tab} onChange={setTab} items={[{ value: 'gen', label: 'Negocio' }, { value: 'op', label: 'Operación' }]} />
        <Button size="sm" onClick={() => toast('Indicadores exportados a Excel.', 'info')}><Download size={15} /> Exportar</Button>
      </div>
      {tab === 'gen' ? (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Gestionado" value={`${fmtNum(nov.toneladas)} t`} hint="noviembre*" /><Kpi label="Facturado" value={`$${fmtNum(nov.facturado)} M`} hint="noviembre*" />
            <Kpi label="Servicios" value={fmtNum(nov.servicios)} hint="noviembre*" /><Kpi label="Compras de aprovechables" value={`$${fmtNum(nov.comprado)} M`} hint="noviembre*" />
          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            <Card title="Toneladas por cliente"><Barras rows={porCliente} unidad="t" /></Card>
            <Card title="Toneladas por destino final"><Torta unidad="t" rows={[{ nombre: 'PSA Los Pinos (propio)', valor: 158.2 }, { nombre: 'Gestor aliado · incineración', valor: 8.1 }, { nombre: 'Gestor aliado · RAEE y celda', valor: 4.7 }]} /></Card>
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
                <Tooltip {...tip} formatter={(v: number, n: string) => [`$${fmtNum(v)} M`, n]} /><Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: c.muted }} />
                <Line isAnimationActive={false} name="Facturado" dataKey="facturado" stroke={c.series[0]} strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: c.surface, strokeWidth: 2 }} />
                <Line isAnimationActive={false} name="Comprado" dataKey="comprado" stroke={c.series[1]} strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: c.surface, strokeWidth: 2 }} />
              </LineChart></ResponsiveContainer></div>
            </Card>
            <Card title="Facturación por cliente (millones COP)"><Barras rows={[{ n: 'Campo Las Monas', v: 96.4 }, { n: 'Agroind. La Esperanza', v: 51.2 }, { n: 'Lácteos del Oriente', v: 38.7 }, { n: 'Clínica Santa Lucía', v: 33.9 }, { n: 'Constructora Altos', v: 21.5 }]} unidad="M" /></Card>
            <Card title="Toneladas por comercial"><Barras rows={[{ n: 'Gerencia regional', v: 112.6 }, { n: 'Comercial Bucaramanga', v: 41.9 }, { n: 'Comercial Barrancabermeja', v: 16.5 }]} unidad="t" /></Card>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Recorridos" value={String(totVeh)} hint="al 18 nov" /><Kpi label="Servicios por recorrido" value={fmtNum(nov.servicios / Math.max(totVeh, 1))} hint="promedio" />
            <Kpi label="Inspecciones aprobadas" value="96 %" hint="primer intento" /><Kpi label="Diferencia en báscula" value="−0,9 %" hint="promedio" />
          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            <Card title="Recorridos por vehículo"><Barras rows={porVeh} unidad="servicios" /></Card>
            <Card title="Participación de cada vehículo"><Torta unidad="rutas" rows={porVeh.map((v) => ({ nombre: v.n, valor: v.v, color: v.color }))} /></Card>
            <Card title="Toneladas por conductor"><Barras rows={porCond} unidad="t" /></Card>
            <Card title="Toneladas por auxiliar"><Barras rows={[{ n: 'Yesid Galvis', v: 63.1 }, { n: 'Camilo Pérez', v: 49.8 }, { n: 'Jhon Fredy Mora', v: 44.0 }]} unidad="t" /></Card>
            <Card title="Toneladas por tratamiento (%)"><Torta unidad="%" rows={DIST_MANEJO.map((d) => ({ nombre: d.nombre, valor: d.valor }))} /></Card>
            <Card title="Motivos de cancelación"><Torta unidad="" rows={CAUSALES_CANCELACION.map((d) => ({ nombre: d.nombre, valor: d.valor }))} /></Card>
          </div>
        </div>
      )}
    </>
  );
}

export function Exportable() {
  const toast = useToast();
  const items: [string, string][] = [
    ['Declaraciones de residuos (detallado)', 'Todas las columnas: cliente, sucursal, corriente Y/A, CRETIB, manejo, embalaje, precio vigente, autorización.'],
    ['Declaraciones de servicios (detallado)', 'Frecuencia, programación automática, cantidad promedio y precio.'],
    ['Tarifas e historial de precios', 'Cada vigencia con su lote de asignación y usuario.'],
    ['Declaraciones listas para recargar', 'Mismo formato de la plantilla de importación: edite en Excel y vuelva a subir.'],
  ];
  return (
    <>
      <PageHeader eyebrow="Comercial" title="Exportar" subtitle="Descargue declaraciones y tarifas con todas sus columnas para revisión, auditoría o edición en Excel." />
      <Filtros />
      <Card pad={false}><ul className="divide-y divide-line">{items.map(([t, d]) => (
        <li key={t} className="flex items-center gap-3 px-4 py-3"><FileSpreadsheet size={20} className="shrink-0 text-brand" /><div className="min-w-0 flex-1"><p className="text-[14px] font-medium">{t}</p><p className="text-[12px] text-muted">{d}</p></div>
          <Button size="sm" variant="primary" onClick={() => toast(`«${t}» exportado a Excel.`, 'info')}><Download size={15} /><span className="hidden sm:inline">Exportar</span></Button></li>))}</ul></Card>
    </>
  );
}
