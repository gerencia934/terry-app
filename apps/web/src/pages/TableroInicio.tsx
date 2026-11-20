// Tablero de inicio de Terry-App · Gestión de Residuos, inspirado en los tableros de Wialon: paneles con números grandes
// arriba, anillos limpios y la tendencia por mes. Terry da la bienvenida. Las cifras salen del servidor:
// /informes/inicio (operación del día y del mes) y /informes/indicadores (lo conciliado en planta).
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, ArrowRight, Award, CalendarClock, ChevronRight, ClipboardSignature, ExternalLink, Inbox, MapPin, Route as RouteIcon, ShieldCheck, Truck, Weight } from 'lucide-react';
import { Badge, Button, Card, ColorBadge } from '../components/ui';
import { SuperInforme } from '../components/SuperInforme';
import { useAlertas } from '../lib/alertas';
import { sesionActual, tienePermiso } from '../lib/api';
import { hoyCo, useApi } from '../lib/servidor';
import { useRouter, type RouteName } from '../lib/router';
import { cx, diasEntre, fmtFecha, fmtNum } from '../lib/format';
import type { Indicadores } from './IndicadoresServidor';
import terrySaludo from '../assets/terry-saludo.webp';

interface Inicio {
  hoy: string; mes: string; recorridosMes: number;
  cadena: { solicitadas: number; programadas: number; recolectadas: number; pesadas: number; certificadas: number };
  negocio: { toneladas: number; facturado: number; servicios: number; comprado: number } | null;
  rutasHoy: { id: string; codigo: string; vehiculo: { placa: string; color: string } | null; conductor: string | null; etapa: { nombre: string; color: string; orden: number; esFinal: boolean; cancela: boolean } | null; etapas: number; paradas: number; atendidas: number; clientes: string[] }[];
  agenda: { hoy: number; manana: number; semana: number };
  obligaciones: { id: string; codigo: string | null; descripcion: string; proximaFecha: string; permiso: { acto: string } }[];
  kpis: { certificadosMes: number; solicitudesPendientes: number; manifiestosPorFirmar: number };
  accesos: { etiqueta: string; url: string }[];
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const mesCorto = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${MESES[m - 1].slice(0, 3)} ${String(y).slice(2)}`; };
const saludo = () => { const h = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota', hour: 'numeric', hour12: false })); return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'; };
const restarMeses = (dia: string, n: number) => { const [y, m] = dia.split('-').map(Number); return new Date(Date.UTC(y, m - 1 - n, 1)).toISOString().slice(0, 10); };
/** Último día del mes (los números del mes del servidor cuentan el mes completo: así cuadran con los gráficos). */
const finDeMes = (dia: string) => { const [y, m] = dia.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

/** Colores del tema actual (claro u oscuro) para los gráficos: paleta de la marca validada contra daltonismo. */
function useColores() {
  const leer = () => {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string) => `rgb(${cs.getPropertyValue(`--${n}`).trim().split(/\s+/).join(',')})`;
    return { series: [1, 2, 3, 4, 5].map((i) => v(`serie-${i}`)), otros: v('serie-otros'), grid: v('chart-grid'), muted: v('muted'), fg: v('fg'), surface: v('surface'), line: v('line') };
  };
  const [c, setC] = useState(leer);
  useEffect(() => {
    const upd = () => setC(leer());
    const mo = new MutationObserver(upd); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = window.matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener('change', upd);
    return () => { mo.disconnect(); mq.removeEventListener('change', upd); };
  }, []);
  return c;
}

type Tono = 'marca' | 'alerta' | 'urgente' | 'info';
const TONOS: Record<Tono, string> = { marca: 'bg-brand-soft text-brand-ink', alerta: 'bg-warn/15 text-warn', urgente: 'bg-bad/15 text-bad', info: 'bg-info/15 text-info' };

/** Panel de número grande (como los de Wialon). Lleva a la sección del dato. */
function Panel({ etiqueta, valor, unidad, icono, tono = 'marca', ayuda, onClick }: { etiqueta: string; valor: string; unidad?: string; icono: ReactNode; tono?: Tono; ayuda?: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="group flex min-w-0 flex-col justify-between gap-3 rounded-2xl border border-line bg-surface p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <span className="flex items-start justify-between gap-2">
        <span className="text-[11.5px] font-semibold uppercase leading-tight tracking-[0.08em] text-muted">{etiqueta}</span>
        <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', TONOS[tono])}>{icono}</span>
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className="num font-display text-[34px] font-extrabold leading-none text-fg">{valor}</span>
        {unidad && <span className="text-[14px] font-semibold text-muted">{unidad}</span>}
      </span>
      {ayuda && <span className="text-[12px] text-subtle">{ayuda}</span>}
    </button>
  );
}

const Vacio = () => <p className="py-10 text-center text-[13px] text-muted">Sin datos en el periodo.</p>;

/**
 * Anillo de composición: hasta 5 partes con nombre y «Otros». El color sigue a cada parte (no a su puesto): el mapa de
 * colores sale del último año, así un cambio de periodo no repinta las partes que siguen.
 */
function Anillo({ filas, unidad, mapa, c }: { filas: { nombre: string; valor: number }[]; unidad: string; mapa: Map<string, string>; c: ReturnType<typeof useColores> }) {
  const datos = useMemo(() => {
    const propias = new Map<string, number>(); let otros = 0;
    for (const f of filas) { if (f.valor <= 0) continue; if (mapa.has(f.nombre)) propias.set(f.nombre, (propias.get(f.nombre) ?? 0) + f.valor); else otros += f.valor; }
    const lista = [...mapa.keys()].filter((n) => propias.has(n)).map((n) => ({ nombre: n, valor: propias.get(n)!, color: mapa.get(n)! }));
    if (otros > 0) lista.push({ nombre: 'Otros', valor: Math.round(otros * 100) / 100, color: c.otros });
    return lista;
  }, [filas, mapa, c.otros]);
  const total = datos.reduce((s, d) => s + d.valor, 0);
  if (!datos.length) return <Vacio />;
  return (
    <div className="flex min-w-0 flex-col items-center gap-4">
      <div className="relative h-44 w-44 shrink-0">
        <ResponsiveContainer><PieChart>
          <Pie isAnimationActive={false} data={datos} dataKey="valor" nameKey="nombre" innerRadius="70%" outerRadius="100%" paddingAngle={datos.length > 1 ? 1.5 : 0} stroke={c.surface} strokeWidth={2} startAngle={90} endAngle={-270}>
            {datos.map((d) => <Cell key={d.nombre} fill={d.color} />)}
          </Pie>
          <Tooltip contentStyle={{ background: c.surface, border: `1px solid ${c.line}`, borderRadius: 10, fontSize: 13, color: c.fg }} itemStyle={{ color: c.fg }}
            formatter={(v: number, n: string) => [`${fmtNum(v)} ${unidad} · ${fmtNum(Math.round((v / total) * 1000) / 10)} %`, n]} />
        </PieChart></ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="num font-display text-[22px] font-extrabold leading-none">{fmtNum(Math.round(total * 10) / 10)}</span>
          <span className="mt-1 text-[11px] text-muted">{unidad} en total</span>
        </div>
      </div>
      <ul className="flex w-full min-w-0 flex-col gap-2">
        {datos.map((d) => (
          <li key={d.nombre} className="flex items-center gap-2.5 text-[13px]">
            <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: d.color }} aria-hidden />
            <span className="min-w-0 flex-1 truncate" title={d.nombre}>{d.nombre}</span>
            <span className="num font-semibold">{fmtNum(d.valor)} {unidad}</span>
            <span className="num w-12 text-right text-[12px] text-muted">{fmtNum(Math.round((d.valor / total) * 1000) / 10)} %</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Mapa estable nombre → color: las 5 partes más grandes del último año. */
const mapaColores = (filas: { nombre: string; toneladas: number }[], c: ReturnType<typeof useColores>) =>
  new Map([...filas].filter((f) => f.toneladas > 0).sort((a, b) => b.toneladas - a.toneladas).slice(0, 5).map((f, i) => [f.nombre, c.series[i]] as const));

type Periodo = 'mes' | 'trimestre' | 'anio';
const PERIODOS: { v: Periodo; l: string }[] = [{ v: 'mes', l: 'Este mes' }, { v: 'trimestre', l: 'Últimos 3 meses' }, { v: 'anio', l: 'Último año' }];

export function TableroInicio() {
  const { go } = useRouter();
  const al = useAlertas();
  const c = useColores();
  const hoy = hoyCo();
  const verNegocio = tienePermiso('informes.ver');
  const { datos: d, error } = useApi<Inicio>('/informes/inicio');
  // Tendencia: los últimos 12 meses (y el mapa de colores de las partes). Anillos: el periodo elegido.
  const desdeAnio = restarMeses(hoy, 11);
  const hasta = finDeMes(hoy);
  const { datos: anio } = useApi<Indicadores>(verNegocio ? `/informes/indicadores?desde=${desdeAnio}&hasta=${hasta}` : null);
  const [periodo, setPeriodo] = useState<Periodo>('mes');
  const desde = periodo === 'mes' ? `${hoy.slice(0, 7)}-01` : periodo === 'trimestre' ? restarMeses(hoy, 2) : desdeAnio;
  const { datos: per } = useApi<Indicadores>(verNegocio && periodo !== 'anio' ? `/informes/indicadores?desde=${desde}&hasta=${hasta}` : null);
  const sel = periodo === 'anio' ? anio : per;
  const nombre = sesionActual()?.usuario.nombre.split(' ')[0] ?? '';
  const urgentes = al.filter((a) => a.tone === 'bad').length;
  const mesNombre = d ? MESES[Number(d.mes.slice(5, 7)) - 1] : '';
  const mapaTrat = useMemo(() => mapaColores(anio?.porTratamiento ?? [], c), [anio, c]);
  const mapaCli = useMemo(() => mapaColores(anio?.porCliente ?? [], c), [anio, c]);
  const serie = (anio?.serie ?? []).map((x) => ({ mes: mesCorto(x.mes), toneladas: x.toneladas }));

  const cadena: { n: number; label: string; route: RouteName }[] = d ? [
    { n: d.cadena.solicitadas, label: 'Solicitadas', route: 'solicitudes' }, { n: d.cadena.programadas, label: 'Programadas', route: 'programacion' },
    { n: d.cadena.recolectadas, label: 'Recolectadas', route: 'manifiestos' }, { n: d.cadena.pesadas, label: 'Pesadas en planta', route: 'recepcion' },
    { n: d.cadena.certificadas, label: 'Certificadas', route: 'certificados' },
  ] : [];
  const maxCadena = Math.max(...cadena.map((x) => x.n), 1);

  return (
    <>
      {/* Bienvenida con Terry */}
      <section className="relative mb-5 overflow-hidden rounded-2xl bg-[#216840] text-white">
        <div className="relative z-10 max-w-[68%] p-6 sm:max-w-[60%] sm:p-8">
          <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-brand-mint">{fmtFecha(hoy)}</p>
          <h1 className="mt-2 font-display text-[26px] font-extrabold leading-tight sm:text-[32px]">{saludo()}{nombre ? `, ${nombre}` : ''}</h1>
          <p className="mt-2 text-[14px] leading-relaxed text-white/85">Soy Terry. Así va la gestión de residuos de Terra Viva{mesNombre ? ` en ${mesNombre}` : ''}.</p>
          {d?.negocio && <p className="num mt-3 text-[13px] font-semibold text-white/90">{fmtNum(d.negocio.toneladas)} t gestionadas · {fmtNum(d.negocio.servicios)} servicios · {fmtNum(d.kpis.certificadosMes)} certificados</p>}
        </div>
        <img src={terrySaludo} alt="Terry, la mascota de Terra Viva" className="absolute -bottom-2 right-0 h-[112%] w-auto max-w-[40%] object-contain object-bottom sm:right-6" />
      </section>

      {error && <Card className="mb-5"><p className="text-bad">{error}</p></Card>}
      {!d && !error && <p className="p-6 text-center text-muted">Cargando el tablero…</p>}
      {d && (
        <>
          {/* Paneles de números grandes */}
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
            {d.negocio
              ? <><Panel etiqueta="Gestionado del mes" valor={fmtNum(d.negocio.toneladas)} unidad="t" icono={<Weight size={18} />} ayuda="pesado o cargado, en kg y t" onClick={() => go('indicadores')} />
                <Panel etiqueta="Servicios del mes" valor={fmtNum(d.negocio.servicios)} icono={<Truck size={18} />} ayuda="manifiestos conciliados" onClick={() => go('manifiestos')} /></>
              : <Panel etiqueta="Recorridos del mes" valor={fmtNum(d.recorridosMes)} icono={<RouteIcon size={18} />} ayuda={`${d.agenda.hoy} hoy`} onClick={() => go('programacion')} />}
            <Panel etiqueta="Certificados emitidos" valor={fmtNum(d.kpis.certificadosMes)} icono={<Award size={18} />} ayuda={`actas del mes de ${mesNombre}`} onClick={() => go('certificados')} />
            <Panel etiqueta="Solicitudes por programar" valor={fmtNum(d.kpis.solicitudesPendientes)} icono={<Inbox size={18} />} tono={d.kpis.solicitudesPendientes ? 'info' : 'marca'} ayuda="formales sin ruta" onClick={() => go('solicitudes')} />
            <Panel etiqueta="Manifiestos por grabar" valor={fmtNum(d.kpis.manifiestosPorFirmar)} icono={<ClipboardSignature size={18} />} tono={d.kpis.manifiestosPorFirmar ? 'alerta' : 'marca'} ayuda={d.kpis.manifiestosPorFirmar ? 'faltan la firma y el cierre' : 'todos grabados'} onClick={() => go('manifiestos')} />
            <Panel etiqueta="Alertas urgentes" valor={fmtNum(urgentes)} icono={<AlertTriangle size={18} />} tono={urgentes ? 'urgente' : 'marca'} ayuda={`${al.length} alertas en total`} onClick={() => go('permisos')} />
          </div>

          {/* Gráficos: tendencia y composición */}
          {verNegocio && (
            <div className="mb-5 grid gap-5 xl:grid-cols-[1.25fr_1fr_1fr]">
              <Card title="Toneladas gestionadas por mes">
                {!serie.length ? <Vacio /> : <div className="h-56"><ResponsiveContainer><BarChart data={serie} margin={{ top: 22, right: 4, left: -18, bottom: 0 }} barCategoryGap="30%">
                  <CartesianGrid vertical={false} stroke={c.grid} />
                  <XAxis dataKey="mes" stroke={c.line} tick={{ fill: c.muted, fontSize: 11 }} tickLine={false} />
                  <YAxis stroke={c.line} tick={{ fill: c.muted, fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip cursor={{ fill: c.grid, opacity: 0.5 }} contentStyle={{ background: c.surface, border: `1px solid ${c.line}`, borderRadius: 10, fontSize: 13, color: c.fg }} labelStyle={{ color: c.fg, fontWeight: 600 }} formatter={(v: number) => [`${fmtNum(v)} t`, 'Gestionado']} />
                  <Bar isAnimationActive={false} dataKey="toneladas" fill={c.series[0]} radius={[4, 4, 0, 0]}>
                    <LabelList dataKey="toneladas" position="top" fill={c.muted} fontSize={11} formatter={(v: number) => fmtNum(v)}
                      content={(p) => p.index === serie.length - 1 ? <text x={Number(p.x) + Number(p.width) / 2} y={Number(p.y) - 6} textAnchor="middle" fill={c.fg} fontSize={12} fontWeight={600}>{fmtNum(Number(p.value))} t</text> : null} />
                  </Bar>
                </BarChart></ResponsiveContainer></div>}
              </Card>
              <Card title="Por tratamiento" action={<SelectorPeriodo periodo={periodo} onChange={setPeriodo} />}>
                {!sel ? <p className="py-10 text-center text-muted">Cargando…</p> : <Anillo filas={sel.porTratamiento.map((x) => ({ nombre: x.nombre, valor: x.toneladas }))} unidad="t" mapa={mapaTrat} c={c} />}
              </Card>
              <Card title="Por cliente" action={<SelectorPeriodo periodo={periodo} onChange={setPeriodo} />}>
                {!sel ? <p className="py-10 text-center text-muted">Cargando…</p> : <Anillo filas={sel.porCliente.map((x) => ({ nombre: x.nombre, valor: x.toneladas }))} unidad="t" mapa={mapaCli} c={c} />}
              </Card>
            </div>
          )}

          {/* Cadena de trazabilidad del mes */}
          <Card className="mb-5" title={`Cadena de trazabilidad · ${mesNombre}`} action={<span className="hidden text-[12px] text-muted sm:inline">Cada servicio debe llegar hasta «Certificadas»</span>}>
            <ol className="grid gap-2 sm:grid-cols-5">
              {cadena.map((x, i) => (
                <li key={x.label}>
                  <button onClick={() => go(x.route)} className="flex h-full w-full flex-col gap-2 rounded-xl border border-line p-3 text-left transition-colors hover:border-brand">
                    <span className="flex items-center justify-between text-[12px] font-medium text-muted"><span>{i + 1}. {x.label}</span>{i < cadena.length - 1 && <ArrowRight size={14} className="hidden text-subtle sm:block" />}</span>
                    <span className="num font-display text-[26px] font-bold leading-none">{fmtNum(x.n)}</span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full bg-brand" style={{ width: `${(x.n / maxCadena) * 100}%` }} /></span>
                  </button>
                </li>
              ))}
            </ol>
          </Card>

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
                  {([['Hoy', d.agenda.hoy], ['Mañana', d.agenda.manana], ['Próximos 7 días', d.agenda.semana]] as const).map(([l, n]) => (
                    <button key={l} onClick={() => go('programacion')} className="rounded-xl bg-surface-2 p-3 text-left hover:bg-brand-soft/60"><p className="num font-display text-[24px] font-bold">{n}</p><p className="text-[12px] text-muted">{l}</p></button>
                  ))}
                </div>
              </Card>
              <Card title={<span className="flex items-center gap-2"><ShieldCheck size={16} className="text-brand" />Próximas obligaciones</span>} action={<Button size="sm" variant="ghost" onClick={() => go('permisos')}>Ver todas</Button>}>
                {!d.obligaciones.length && <p className="text-[13px] text-muted">No hay obligaciones con fecha pendientes.</p>}
                <ul className="flex flex-col gap-3">
                  {d.obligaciones.map((o) => { const n = diasEntre(d.hoy, o.proximaFecha.slice(0, 10)); return (
                    <li key={o.id} className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><p className="text-[13px] font-semibold">{o.permiso.acto}</p><p className="truncate text-[12px] text-muted">{o.codigo ? `${o.codigo} · ` : ''}{o.descripcion}</p></div>
                      <Badge tone={n < 0 || n <= 15 ? 'bad' : n <= 30 ? 'warn' : 'ok'}>{n < 0 ? 'vencida' : `${n} días`}</Badge>
                    </li>); })}
                </ul>
              </Card>
            </div>
            <div className="flex min-w-0 flex-col gap-5">
              <SuperInforme />
              <Card title="Accesos rápidos">
                <div className="grid grid-cols-2 gap-2">
                  {d.accesos.map((a) => (
                    <a key={a.url + a.etiqueta} href={a.url} target="_blank" rel="noopener noreferrer"
                      className="flex min-h-11 items-center justify-between gap-2 rounded-xl border border-line px-3 py-2.5 text-[13px] font-semibold text-fg transition-colors hover:border-brand hover:bg-brand-soft/50">
                      <span className="min-w-0 truncate">{a.etiqueta}</span><ExternalLink size={14} className="shrink-0 text-subtle" aria-hidden />
                    </a>
                  ))}
                </div>
                {!d.accesos.length && <p className="text-[13px] text-muted">No hay accesos configurados.</p>}
                <p className="mt-2 text-[11px] text-subtle">Se abren en otra pestaña. Se cambian en Ajustes › Datos de la empresa.</p>
              </Card>
              <Card title="Requiere atención" pad={false} action={<Badge tone="bad">{urgentes} urgentes</Badge>}>
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
            </div>
          </div>
        </>
      )}
    </>
  );
}

function SelectorPeriodo({ periodo, onChange }: { periodo: Periodo; onChange: (p: Periodo) => void }) {
  return (
    <select value={periodo} onChange={(e) => onChange(e.target.value as Periodo)} aria-label="Periodo de los anillos"
      className="h-8 rounded-lg border border-line bg-surface px-2 text-[12px] text-fg focus:border-brand focus:outline-none">
      {PERIODOS.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
    </select>
  );
}
