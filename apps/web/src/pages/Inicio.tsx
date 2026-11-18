import { useState } from 'react';
import { FileText, ListOrdered, Scale, Search, MapPin, Truck, FileStack, BarChart3, Flag, Settings, Users, Building, Store, UserCog, Car, Shield, Bell, Tag, Phone, Mail, AtSign, Wrench, DollarSign } from 'lucide-react';
import { Badge, Button, Card } from '../components/ui';
import { useRouter, type RouteName } from '../lib/router';
import { alertas } from '../lib/alertas';
import { CLIENTES, CONCILIACION, EMPRESA, HOY, MANIFIESTOS, PERMISOS, PERSONAS, RUTAS_MES, SERIE_MENSUAL, SOLICITUDES, VEHICULOS } from '../data/mock';
import { useStore } from '../lib/store';
import { cx, diasEntre, fmtFecha, fmtNum } from '../lib/format';
import { Logo } from '../components/AppShell';

let recordatorioVisto = false;

export default function Inicio() {
  const { go } = useRouter();
  const { declaraciones } = useStore();
  const al = alertas();
  const [recordatorio, setRecordatorio] = useState(!recordatorioVisto);
  const nov = SERIE_MENSUAL[11];
  const manana = '2026-11-19';
  const rHoy = RUTAS_MES.filter((r) => r.fecha === HOY).length;
  const rManana = RUTAS_MES.filter((r) => r.fecha === manana).length;
  const r7 = RUTAS_MES.filter((r) => { const d = diasEntre(HOY, r.fecha); return d >= 2 && d <= 8; }).length;
  const rutasMes = RUTAS_MES.filter((r) => r.fecha.startsWith('2026-11')).length;
  const pendDecl = declaraciones.filter((d) => d.estado === 'PENDIENTE' || d.estado === 'BORRADOR').length;
  const pendSol = SOLICITUDES.filter((s) => s.estado === 'PENDIENTE').length;
  const pendConc = MANIFIESTOS.filter((m) => m.estado !== 'CERRADO').length + CONCILIACION.filter((c) => Math.abs((c.destino - c.origen) / c.origen) > 0.02 && !c.justificacion).length;
  const cerrar = () => { recordatorioVisto = true; setRecordatorio(false); };

  const accesos: [RouteName, string, typeof Users, number | null][] = [
    ['config-datos', 'Mis datos / Configuraciones', Settings, null],
    ['config-clientes', 'Mis clientes', Users, CLIENTES.length],
    ['config-catalogos', 'Mis proveedores / destinos', Building, 3],
    ['config-clientes', 'Sucursales', Store, CLIENTES.reduce((a, c) => a + c.sucursales.length, 0)],
    ['config-usuarios', 'Mis usuarios', UserCog, PERSONAS.length],
    ['config-vehiculos', 'Mis vehículos', Car, VEHICULOS.length],
    ['config-usuarios', 'Roles / Permisos', Shield, 8],
  ];

  return (
    <>
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        {/* Ficha de la empresa + accesos directos */}
        <Card>
          <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
            <div className="min-w-0">
              <Logo className="h-14" />
              <h1 className="mt-4 text-[20px] font-semibold text-fg">TERRA VIVA S.A.S. E.S.P.</h1>
              <dl className="mt-3 grid grid-cols-[120px_1fr] gap-x-3 gap-y-2 text-[13px]">
                <dt className="flex items-center gap-2 text-muted"><Tag size={14} />NIT</dt><dd className="num">901.089.780-8</dd>
                <dt className="flex items-center gap-2 text-muted"><MapPin size={14} />Planta</dt><dd>Parque de Saneamiento Ambiental Los Pinos · Vereda Villa de Leyva, Sabana de Torres</dd>
                <dt className="flex items-center gap-2 text-muted"><Building size={14} />Oficina</dt><dd>{EMPRESA.oficina}</dd>
                <dt className="flex items-center gap-2 text-muted"><Phone size={14} />Teléfono</dt><dd className="num">{EMPRESA.telefonos.join(' · ')}</dd>
                <dt className="flex items-center gap-2 text-muted"><Mail size={14} />Email logística</dt><dd className="break-all">operaciones@terravivasas.com</dd>
                <dt className="flex items-center gap-2 text-muted"><Wrench size={14} />Email técnico</dt><dd className="break-all">contacto@terravivasas.com</dd>
                <dt className="flex items-center gap-2 text-muted"><DollarSign size={14} />Email comercial</dt><dd className="break-all">gerenciaregional@terravivasas.com</dd>
              </dl>
            </div>
            <div className="min-w-0">
              <h2 className="mb-2 text-[15px] font-semibold">Accesos directos</h2>
              <ul className="divide-y divide-line rounded-xl border border-line">
                {accesos.map(([r, l, I, n]) => (
                  <li key={l}><button onClick={() => go(r)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-[13px] hover:bg-surface-2">
                    <I size={15} className="text-brand" /><span className="flex-1">{l}</span>{n !== null && <span className="num font-semibold text-muted">{n}</span>}
                  </button></li>
                ))}
              </ul>
            </div>
          </div>
        </Card>

        {/* Pendientes */}
        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
          {([[FileText, pendDecl, 'Declaraciones pendientes', 'declaraciones'], [ListOrdered, pendSol, 'Solicitudes pendientes', 'solicitudes'], [Scale, pendConc, 'Conciliaciones pendientes', 'conciliaciones']] as const).map(([I, n, l, r]) => (
            <button key={l} onClick={() => go(r)} className="group flex flex-col rounded-xl border border-brand/20 bg-brand-soft/70 text-left transition-colors hover:border-brand">
              <div className="flex items-start justify-between px-4 pt-3.5"><I size={26} className="text-brand" /><span className="num font-display text-[26px] font-semibold text-brand-ink">{n}</span></div>
              <p className="px-4 pb-2 text-right text-[13px] text-brand-ink">{l}</p>
              <p className="flex items-center justify-between border-t border-brand/15 px-4 py-1.5 text-[12px] text-brand">Más detalle <Search size={13} /></p>
            </button>
          ))}
        </div>
      </div>

      {/* Totales del mes */}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[[fmtNum(nov.servicios), 'Servicios (NOV)'], [`${fmtNum(nov.toneladas)} t`, 'Total gestionado (NOV)'], [String(rutasMes), 'Cantidad rutas (NOV)'], [`$${fmtNum(nov.facturado)} M`, 'Facturado (NOV)']].map(([v, l]) => (
          <div key={l} className="overflow-hidden rounded-xl border border-line bg-surface">
            <div className="num bg-brand px-4 py-3 text-right font-display text-[28px] font-semibold leading-none text-on-brand">{v}</div>
            <div className="px-4 py-2 text-right text-[13px] font-semibold text-brand-ink">{l}</div>
          </div>
        ))}
      </div>

      {/* Botones grandes */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {([[MapPin, 'Rastreo de rutas', 'rastreo'], [Truck, 'Solicitudes', 'solicitudes'], [FileStack, 'Manifiestos', 'manifiestos'], [BarChart3, 'Indicadores', 'indicadores']] as const).map(([I, l, r]) => (
          <button key={l} onClick={() => go(r)} className="flex h-20 flex-col items-center justify-center gap-1.5 rounded-2xl bg-brand text-[13px] font-semibold text-on-brand shadow-sm transition-transform hover:-translate-y-0.5"><I size={22} />{l}</button>
        ))}
        <button onClick={() => go('config-permisos')} className="col-span-2 flex h-20 flex-col items-center justify-center gap-1.5 rounded-2xl bg-accent text-[13px] font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5 sm:col-span-1"><Flag size={22} />Cifras de cumplimiento</button>
      </div>

      {/* Cumplimiento: alertas + permisos */}
      <div className="mt-5 grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Card title="Alertas y recordatorios" pad={false} action={<Badge tone="bad">{al.filter((a) => a.tone === 'bad').length} urgentes</Badge>}>
          <ul className="divide-y divide-line">
            {al.slice(0, 7).map((a) => (
              <li key={a.id}><button onClick={() => go(a.route)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-2">
                <span className={cx('mt-0.5 w-1 self-stretch shrink-0 rounded-full', a.tone === 'bad' ? 'bg-bad' : a.tone === 'warn' ? 'bg-warn' : 'bg-info')} />
                <span className="min-w-0 flex-1"><span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-subtle">{a.categoria}</span><span className="block text-[13px] font-medium">{a.titulo}</span><span className="block truncate text-[12px] text-muted">{a.detalle}</span></span>
              </button></li>
            ))}
          </ul>
        </Card>
        <Card title="Permisos ambientales" action={<Button size="sm" variant="ghost" onClick={() => go('config-permisos')}>Gestionar</Button>}>
          <ul className="flex flex-col gap-3">
            {PERMISOS.map((p) => { const d = diasEntre(HOY, p.proximaObligacion.fecha); return (
              <li key={p.id} className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="text-[13px] font-semibold">{p.acto} <span className="font-normal text-muted">· {p.autoridad}</span></p><p className="truncate text-[12px] text-muted">{p.proximaObligacion.descripcion}</p></div>
                <Badge tone={d <= 15 ? 'bad' : d <= 30 ? 'warn' : 'ok'}>{d} días</Badge>
              </li>); })}
          </ul>
        </Card>
      </div>

      {/* Recordatorio al ingresar */}
      {recordatorio && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="rec-t">
          <div className="anim-sheet w-full max-w-md rounded-2xl bg-surface shadow-2xl">
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5"><h2 id="rec-t" className="text-[16px] font-semibold">Recordatorio</h2><span className="text-[12px] text-muted">{fmtFecha(HOY)}</span></div>
            <div className="flex gap-4 px-5 py-4">
              <Bell size={40} className="shrink-0 text-warn" />
              <div className="text-[14px]">
                <p className="text-muted">El sistema detectó los siguientes recorridos programados:</p>
                <ul className="mt-2 flex flex-col gap-1.5">
                  <li className="flex items-baseline justify-between gap-6"><b>Para hoy</b><button onClick={() => { cerrar(); go('rutas'); }} className="num font-display text-[20px] font-semibold text-accent hover:underline">{rHoy}</button></li>
                  <li className="flex items-baseline justify-between gap-6"><b>Mañana</b><span className="num font-display text-[20px] font-semibold">{rManana}</span></li>
                  <li className="flex items-baseline justify-between gap-6"><b>Próximos 7 días <span className="text-[11px] font-normal text-muted">(sin hoy ni mañana)</span></b><span className="num font-display text-[20px] font-semibold">{r7}</span></li>
                </ul>
                <p className="mt-3 flex items-center gap-1.5 text-[12px] text-muted"><AtSign size={12} />También se envía por correo a logística cada mañana.</p>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
              <Button onClick={() => { cerrar(); go('rutas'); }}>Ver rutas</Button>
              <Button variant="primary" onClick={cerrar}>Enterado</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
