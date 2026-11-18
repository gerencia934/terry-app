import { Truck, Receipt, Route, Weight, Users, Car, UserCog, ShieldCheck, Plus, ChevronRight, MapPin } from 'lucide-react';
import { Card, ColorBadge, Kpi, PageHeader, Button, Badge } from '../components/ui';
import { useRouter } from '../lib/router';
import { alertas } from '../lib/alertas';
import { HOY, RUTAS, SERIE_MENSUAL, PERMISOS, estadoRuta, vehiculo, persona, zona, SOLICITUDES, cliente, sucursal } from '../data/mock';
import { cx, diasEntre, fmtFecha } from '../lib/format';

export default function Inicio() {
  const { go } = useRouter();
  const al = alertas();
  const nov = SERIE_MENSUAL[11]; const oct = SERIE_MENSUAL[10];
  const rutasHoy = RUTAS.filter((r) => r.fecha === HOY);
  const rutasMes = RUTAS.filter((r) => r.fecha.startsWith('2026-11')).length;
  // Comparación justa: mes en curso (18 días) contra el mismo número de días de octubre.
  const prop = 18 / 31;
  const pct = (a: number, b: number) => `${Math.abs(Math.round(((a - b * prop) / (b * prop)) * 100))} %`;

  return (
    <>
      <PageHeader eyebrow={`Miércoles, ${fmtFecha(HOY)}`} title="Buenos días, Diego" subtitle="Resumen de la operación, el cumplimiento y la facturación del mes en curso."
        actions={<Button variant="primary" onClick={() => go('solicitudes')}><Plus size={16} /> Nueva solicitud</Button>} />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Servicios del mes" value={String(nov.servicios)} icon={<Truck size={16} />} delta={{ v: pct(nov.servicios, oct.servicios), up: nov.servicios > oct.servicios * prop }} hint="vs. mismo corte oct." />
        <Kpi label="Total facturado" value={`$${nov.facturado} M`} icon={<Receipt size={16} />} delta={{ v: pct(nov.facturado, oct.facturado), up: nov.facturado > oct.facturado * prop }} hint="vs. mismo corte oct." />
        <Kpi label="Rutas del mes" value={String(rutasMes)} icon={<Route size={16} />} hint={`${rutasHoy.length} hoy`} />
        <Kpi label="Toneladas gestionadas" value={`${nov.toneladas} t`} icon={<Weight size={16} />} delta={{ v: pct(nov.toneladas, oct.toneladas), up: nov.toneladas > oct.toneladas * prop }} hint="vs. mismo corte oct." />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card title="Recorridos de hoy" pad={false} action={<Button size="sm" variant="ghost" onClick={() => go('rutas')}>Ver programación <ChevronRight size={15} /></Button>}>
            <ul className="divide-y divide-line">
              {rutasHoy.map((r) => {
                const e = estadoRuta(r.estadoId); const v = vehiculo(r.vehiculoId);
                const paradas = r.solicitudes.map((s) => SOLICITUDES.find((x) => x.id === s)!);
                return (
                  <li key={r.id} className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4">
                    <div className="flex items-center gap-3 sm:w-44 sm:shrink-0">
                      <span className="num whitespace-nowrap font-display text-[15px] font-semibold">{r.codigo}</span>
                      <ColorBadge color={e.color}>{e.nombre}</ColorBadge>
                    </div>
                    <div className="min-w-0 flex-1 text-[13px]">
                      <p className="truncate font-medium text-fg">{paradas.map((p) => cliente(p.clienteId).razonSocial).join(' · ')}</p>
                      <p className="truncate text-muted"><MapPin size={12} className="mr-1 inline" />{paradas.map((p) => sucursal(p.sucursalId).municipio).join(', ')} · {zona(r.zona).nombre}</p>
                    </div>
                    <div className="flex items-center gap-3 text-[13px] text-muted sm:w-56 sm:justify-end">
                      <span className="num rounded-md bg-surface-2 px-2 py-0.5 font-medium text-fg">{v.placa}</span>
                      <span className="truncate">{persona(r.conductorId)?.nombre}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card title="Accesos rápidos">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { l: 'Mis clientes', i: <Users size={20} />, r: 'config-clientes' as const },
                { l: 'Vehículos', i: <Car size={20} />, r: 'config-vehiculos' as const },
                { l: 'Usuarios', i: <UserCog size={20} />, r: 'config-usuarios' as const },
                { l: 'Permisos', i: <ShieldCheck size={20} />, r: 'config-permisos' as const },
              ].map((a) => (
                <button key={a.l} onClick={() => go(a.r)} className="flex flex-col items-start gap-3 rounded-xl border border-line p-3.5 text-left transition-colors hover:border-brand hover:bg-brand-soft/40">
                  <span className="rounded-lg bg-brand-soft p-2 text-brand-ink">{a.i}</span>
                  <span className="text-[14px] font-medium">{a.l}</span>
                </button>
              ))}
            </div>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Card title="Alertas y recordatorios" pad={false} action={<Badge tone="bad">{al.filter((a) => a.tone === 'bad').length} urgentes</Badge>}>
            <ul className="divide-y divide-line">
              {al.slice(0, 8).map((a) => (
                <li key={a.id}>
                  <button onClick={() => go(a.route)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-2">
                    <span className={cx('mt-0.5 w-1 self-stretch shrink-0 rounded-full', a.tone === 'bad' ? 'bg-bad' : a.tone === 'warn' ? 'bg-warn' : 'bg-info')} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2"><span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-subtle">{a.categoria}</span></span>
                      <span className="block text-[13px] font-medium text-fg">{a.titulo}</span>
                      <span className="block truncate text-[12px] text-muted">{a.detalle}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Permisos ambientales" action={<Button size="sm" variant="ghost" onClick={() => go('config-permisos')}>Gestionar</Button>}>
            <ul className="flex flex-col gap-3">
              {PERMISOS.map((p) => {
                const d = diasEntre(HOY, p.proximaObligacion.fecha);
                return (
                  <li key={p.id} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold">{p.acto} <span className="font-normal text-muted">· {p.autoridad}</span></p>
                      <p className="truncate text-[12px] text-muted">{p.proximaObligacion.descripcion}</p>
                    </div>
                    <Badge tone={d <= 15 ? 'bad' : d <= 30 ? 'warn' : 'ok'}>{d} días</Badge>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
