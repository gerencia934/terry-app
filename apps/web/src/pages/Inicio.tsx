import { ArrowRight, Truck, Receipt, Weight, Route as RouteIcon, ChevronRight, CalendarClock, ShieldCheck, MapPin } from 'lucide-react';
import { Badge, Button, Card, ColorBadge, Kpi } from '../components/ui';
import { useRouter, type RouteName } from '../lib/router';
import { useAlertas } from '../lib/alertas';
import { ESTADOS_RUTA, HOY, MANIFIESTOS, PERMISOS, RUTAS_MES, SERIE_MENSUAL, SOLICITUDES, cliente, persona, sucursal, vehiculo } from '../data/mock';
import { sesionActual } from '../lib/api';
import { cx, diasEntre, fmtFecha, fmtNum } from '../lib/format';

const saludo = () => { const h = new Date().getHours(); return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'; };

export default function Inicio() {
  const { go } = useRouter();
  const al = useAlertas();
  const nombre = sesionActual()?.usuario.nombre.split(' ')[0] ?? 'Diego';
  const nov = SERIE_MENSUAL[11];
  const delMes = SOLICITUDES.filter((s) => s.fecha.startsWith('2026-11') && s.clase === 'FORMAL');
  // Cadena de trazabilidad del mes: cuántos servicios hay en cada eslabón.
  const cadena: { n: number; label: string; route: RouteName; hint: string }[] = [
    { n: delMes.length, label: 'Solicitados', route: 'solicitudes', hint: 'formales del mes' },
    { n: delMes.filter((s) => s.estado !== 'PENDIENTE' && s.estado !== 'CANCELADA').length, label: 'Programados', route: 'programacion', hint: 'con ruta asignada' },
    { n: MANIFIESTOS.filter((m) => m.estado !== 'EMITIDO').length, label: 'Recolectados', route: 'manifiestos', hint: 'con manifiesto en camino o cerrado' },
    { n: MANIFIESTOS.filter((m) => m.estado === 'CERRADO' || m.estado === 'RECIBIDO').length, label: 'Recibidos en planta', route: 'recepcion', hint: 'pesados en báscula' },
    { n: MANIFIESTOS.filter((m) => m.estado === 'CERRADO').filter((_, i) => i % 4 !== 3).length, label: 'Certificados', route: 'certificados', hint: 'enviados al cliente' },
  ];
  const max = Math.max(...cadena.map((c) => c.n), 1);
  const hoy = RUTAS_MES.filter((r) => r.fecha === HOY);
  const agenda = [
    { l: 'Hoy', n: hoy.length }, { l: 'Mañana', n: RUTAS_MES.filter((r) => r.fecha === '2026-11-19').length },
    { l: 'Próximos 7 días', n: RUTAS_MES.filter((r) => { const d = diasEntre(HOY, r.fecha); return d >= 2 && d <= 8; }).length },
  ];
  const est = (id: string) => ESTADOS_RUTA.find((e) => e.id === id)!;

  return (
    <>
      <div className="mb-6 flex flex-col gap-1">
        <p className="text-[13px] text-muted">{fmtFecha(HOY)}</p>
        <h1 className="text-[26px] font-bold text-brand-strong">{saludo()}, {nombre}</h1>
      </div>

      {/* Cadena de trazabilidad */}
      <Card className="mb-5">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-semibold">Cadena de trazabilidad · noviembre</h2>
          <p className="text-[12px] text-muted">Cada servicio debe llegar hasta «Certificados». Toque un eslabón para ver el detalle.</p>
        </div>
        <ol className="grid gap-2 sm:grid-cols-5">
          {cadena.map((c, i) => (
            <li key={c.label}>
              <button onClick={() => go(c.route)} className="group flex h-full w-full flex-col gap-2 rounded-xl border border-line p-3 text-left transition-colors hover:border-brand">
                <span className="flex items-center justify-between text-[12px] font-medium text-muted"><span>{i + 1}. {c.label}</span>{i < cadena.length - 1 && <ArrowRight size={14} className="hidden text-subtle sm:block" />}</span>
                <span className="num font-display text-[28px] font-semibold leading-none">{c.n}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full bg-brand" style={{ width: `${(c.n / max) * 100}%` }} /></span>
                <span className="text-[11px] text-subtle">{c.hint}</span>
              </button>
            </li>
          ))}
        </ol>
      </Card>

      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Servicios del mes" value={fmtNum(nov.servicios)} icon={<Truck size={16} />} hint="al 18 de noviembre" />
        <Kpi label="Facturado" value={`$${fmtNum(nov.facturado)} M`} icon={<Receipt size={16} />} hint="al 18 de noviembre" />
        <Kpi label="Gestionado" value={`${fmtNum(nov.toneladas)} t`} icon={<Weight size={16} />} hint="pesado en planta" />
        <Kpi label="Recorridos" value={String(RUTAS_MES.filter((r) => r.fecha.startsWith('2026-11')).length)} icon={<RouteIcon size={16} />} hint={`${hoy.length} hoy`} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card title="Operación de hoy" pad={false} action={<Button size="sm" variant="ghost" onClick={() => go('seguimiento')}>Seguimiento <ChevronRight size={15} /></Button>}>
            <ul className="divide-y divide-line">
              {hoy.map((r) => { const e = est(r.estadoId); const pasos = ESTADOS_RUTA.filter((x) => x.id !== 'e5'); const idx = pasos.findIndex((x) => x.id === r.estadoId); return (
                <li key={r.id} className="flex flex-col gap-2 px-4 py-3.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="num rounded-md px-2 py-0.5 text-[12px] font-semibold text-white" style={{ background: vehiculo(r.vehiculoId).color }}>{vehiculo(r.vehiculoId).placa}</span>
                    <span className="text-[13px] font-medium">{persona(r.conductorId)?.nombre}</span>
                    <span className="ml-auto"><ColorBadge color={e.color}>{e.nombre}</ColorBadge></span>
                  </div>
                  <p className="truncate text-[12px] text-muted"><MapPin size={12} className="mr-1 inline" />{r.solicitudes.map((s) => { const x = SOLICITUDES.find((y) => y.id === s)!; return `${cliente(x.clienteId).razonSocial} (${sucursal(x.sucursalId).municipio})`; }).join(' → ')} → PSA Los Pinos</p>
                  <div className="flex gap-1" aria-label={`Avance: ${e.nombre}`}>{pasos.map((p, i) => <span key={p.id} className={cx('h-1.5 flex-1 rounded-full', i <= idx ? 'bg-brand' : 'bg-surface-2')} />)}</div>
                </li>); })}
            </ul>
          </Card>
          <Card title="Agenda de recorridos" action={<CalendarClock size={17} className="text-subtle" />}>
            <div className="grid grid-cols-3 gap-3">
              {agenda.map((a) => <button key={a.l} onClick={() => go('programacion')} className="rounded-xl bg-surface-2 p-3 text-left hover:bg-brand-soft/60"><p className="num font-display text-[24px] font-semibold">{a.n}</p><p className="text-[12px] text-muted">{a.l}</p></button>)}
            </div>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Card title="Requiere atención" pad={false} action={<Badge tone="bad">{al.filter((a) => a.tone === 'bad').length} urgentes</Badge>}>
            <ul className="divide-y divide-line">
              {al.slice(0, 6).map((a) => (
                <li key={a.id}><button onClick={() => go(a.route)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-2">
                  <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', a.tone === 'bad' ? 'bg-bad' : a.tone === 'warn' ? 'bg-warn' : 'bg-info')} />
                  <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium">{a.titulo}</span><span className="block truncate text-[12px] text-muted">{a.detalle}</span></span>
                </button></li>
              ))}
            </ul>
          </Card>
          <Card title={<span className="flex items-center gap-2"><ShieldCheck size={16} className="text-brand" />Permisos ambientales</span>} action={<Button size="sm" variant="ghost" onClick={() => go('permisos')}>Ver todos</Button>}>
            <ul className="flex flex-col gap-3">
              {PERMISOS.map((p) => { const d = diasEntre(HOY, p.proximaObligacion.fecha); return (
                <li key={p.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="text-[13px] font-semibold">{p.acto}</p><p className="truncate text-[12px] text-muted">{p.proximaObligacion.descripcion}</p></div>
                  <Badge tone={d <= 15 ? 'bad' : d <= 30 ? 'warn' : 'ok'}>{d} días</Badge>
                </li>); })}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
