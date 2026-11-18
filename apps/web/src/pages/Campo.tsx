import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ClipboardCheck, Home, Building2, MapPin, Navigation, Phone, ChevronRight, CheckCircle2, AlertOctagon, Camera, Wifi, WifiOff, Factory, ArrowLeft, Eraser, Copy } from 'lucide-react';
import { Badge, Button, Field, Input, Select, useToast } from '../components/ui';
import { Logo } from '../components/AppShell';
import { useRouter } from '../lib/router';
import { useStore } from '../lib/store';
import { ELEMENTOS_CHEQUEO, HOY, RUTAS, SOLICITUDES, cliente, decl, item, persona, sucursal, vehiculo } from '../data/mock';
import { cx, fmtFecha, fmtNum } from '../lib/format';
import { uni } from './Declaraciones';

// Vista del conductor (PWA). Botones de 44 px o más, una columna, barra inferior, sin tablas.
const RUTA = RUTAS.find((r) => r.id === 'rt13')!;
const sol = (id: string) => SOLICITUDES.find((s) => s.id === id)!;

function CampoLayout({ children, title, back }: { children: ReactNode; title?: string; back?: boolean }) {
  const { route, go } = useRouter();
  const [online, setOnline] = useState(true);
  return (
    <div className="mx-auto flex min-h-full max-w-[560px] flex-col bg-bg">
      <header className="sticky z-30 border-b border-line bg-surface" style={{ top: 'env(safe-area-inset-top, 0px)' }}>
        <div className="safe-x flex h-14 items-center gap-2">
          {back ? <button onClick={() => go('campo')} className="-ml-2 rounded-lg p-2" aria-label="Volver"><ArrowLeft size={22} /></button> : <Logo className="h-7" />}
          {title && <h1 className="truncate text-[16px] font-semibold">{title}</h1>}
          <button onClick={() => setOnline((o) => !o)} className={cx('ml-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-medium', online ? 'bg-ok/10 text-ok' : 'bg-warn/10 text-warn')} aria-label="Simular conexión">
            {online ? <Wifi size={14} /> : <WifiOff size={14} />}{online ? 'En línea' : 'Sin señal · 2 en cola'}
          </button>
        </div>
      </header>
      <main className="safe-x flex-1 py-4 pb-28">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface safe-bottom" aria-label="Navegación de campo">
        <div className="mx-auto grid max-w-[560px] grid-cols-3" style={{ paddingLeft: 'env(safe-area-inset-left, 0px)', paddingRight: 'env(safe-area-inset-right, 0px)' }}>
          {([['campo', <Home size={22} />, 'Mi ruta'], ['campo-preop', <ClipboardCheck size={22} />, 'Preoperacional'], ['inicio', <Building2 size={22} />, 'Oficina']] as const).map(([r, ic, l]) => (
            <button key={r} onClick={() => go(r)} className={cx('flex h-16 flex-col items-center justify-center gap-1 text-[12px] font-medium', route === r || (r === 'campo' && route === 'campo-parada') ? 'text-brand' : 'text-muted')}>{ic}{l}</button>
          ))}
        </div>
      </nav>
    </div>
  );
}

export function CampoHoy() {
  const { go } = useRouter();
  const toast = useToast();
  const { preopHoyAprobado, paradasAtendidas, setParadaSel } = useStore();
  const v = vehiculo(RUTA.vehiculoId);
  const hechas = RUTA.solicitudes.filter((s) => paradasAtendidas[s]).length;
  return (
    <CampoLayout>
      <p className="text-[13px] text-muted">{fmtFecha(HOY)}</p>
      <h1 className="mt-0.5 text-[22px] font-bold text-brand-strong">Hola, {persona(RUTA.conductorId)?.nombre.split(' ')[0]}</h1>
      <div className="mt-3 flex flex-wrap gap-2 text-[13px]">
        <span className="num rounded-lg bg-surface px-2.5 py-1 font-semibold ring-1 ring-line">{v.placa}</span>
        <span className="rounded-lg bg-surface px-2.5 py-1 ring-1 ring-line">{RUTA.codigo}</span>
        <span className="rounded-lg bg-surface px-2.5 py-1 ring-1 ring-line">Aux.: {persona(RUTA.auxiliarId)?.nombre}</span>
      </div>

      {preopHoyAprobado ? (
        <div className="mt-4 flex items-center gap-3 rounded-2xl bg-ok/10 p-4 text-ok"><CheckCircle2 size={24} className="shrink-0" /><div><p className="font-semibold">Preoperacional aprobado</p><p className="text-[13px] opacity-90">Puede iniciar el recorrido.</p></div></div>
      ) : (
        <button onClick={() => go('campo-preop')} className="mt-4 flex w-full items-center gap-3 rounded-2xl bg-warn/10 p-4 text-left text-warn ring-1 ring-warn/30">
          <AlertOctagon size={26} className="shrink-0" />
          <div className="flex-1"><p className="font-semibold">Diligencie el preoperacional</p><p className="text-[13px] opacity-90">La ruta no puede salir sin el chequeo aprobado.</p></div>
          <ChevronRight size={20} />
        </button>
      )}

      <div className="mb-2 mt-6 flex items-center justify-between">
        <h2 className="text-[16px] font-semibold">Paradas de hoy</h2>
        <span className="num text-[13px] text-muted">{hechas} de {RUTA.solicitudes.length} atendidas</span>
      </div>
      <div className="mb-4 h-2 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-brand transition-all" style={{ width: `${(hechas / RUTA.solicitudes.length) * 100}%` }} /></div>

      <ol className="flex flex-col gap-3">
        {RUTA.solicitudes.map((sid, i) => {
          const s = sol(sid); const su = sucursal(s.sucursalId); const done = paradasAtendidas[sid];
          return (
            <li key={sid} className={cx('rounded-2xl border bg-surface p-4', done ? 'border-ok/40' : 'border-line')}>
              <div className="flex items-start gap-3">
                <span className={cx('num flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold', done ? 'bg-ok text-white' : 'bg-brand-soft text-brand-ink')}>{done ? <CheckCircle2 size={18} /> : i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-snug">{cliente(s.clienteId).razonSocial}</p>
                  <p className="text-[13px] text-muted"><MapPin size={13} className="mr-1 inline" />{su.nombre} · {su.municipio}</p>
                  <p className="mt-1 text-[13px]">{s.franja} · {s.items.map((it) => item(decl(it.declId).itemId).nombre.split(' (')[0]).join(', ')}</p>
                  {done && <p className="mt-1 text-[13px] font-medium text-ok">Recolectado a las {done.hora} · manifiesto en cola</p>}
                </div>
              </div>
              {!done && (
                <div className="mt-3 grid grid-cols-[1fr_1fr_1.4fr] gap-2">
                  <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${su.nombre} ${su.municipio} Santander`)}`} target="_blank" rel="noreferrer" className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-line text-[13px] font-medium"><Navigation size={16} /> Ir</a>
                  <button onClick={() => { navigator.clipboard?.writeText(su.telefono).then(() => toast(`Teléfono ${su.telefono} copiado.`, 'info'), () => toast(`Contacto: ${su.contacto} · ${su.telefono}`, 'info')); }} className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-line text-[13px] font-medium"><Phone size={16} /> Llamar</button>
                  <Button variant="primary" className="h-11 rounded-xl" disabled={!preopHoyAprobado} onClick={() => { setParadaSel(sid); go('campo-parada'); }}>Atender</Button>
                </div>
              )}
            </li>
          );
        })}
        <li className="flex items-center gap-3 rounded-2xl border border-dashed border-line p-4 text-[14px] text-muted"><Factory size={22} className="shrink-0" /><div><p className="font-medium text-fg">Descarga en PSA Los Pinos</p><p className="text-[13px]">km 7.5 vía antigua Aprisa · Sabana de Torres</p></div></li>
      </ol>
    </CampoLayout>
  );
}

function SignaturePad({ onChange }: { onChange: (signed: boolean) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  useEffect(() => {
    const c = ref.current!; const r = c.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
    c.width = r.width * dpr; c.height = r.height * dpr; const ctx = c.getContext('2d')!; ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--fg').trim().split(/\s+/).join(',').replace(/^/, 'rgb(') + ')';
  }, []);
  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  return (
    <div>
      <canvas ref={ref} className="h-36 w-full touch-none rounded-xl border border-dashed border-line bg-surface" aria-label="Área de firma"
        onPointerDown={(e) => { drawing.current = true; const ctx = ref.current!.getContext('2d')!; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); ref.current!.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (!drawing.current) return; const ctx = ref.current!.getContext('2d')!; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); onChange(true); }}
        onPointerUp={() => { drawing.current = false; }} />
      <button type="button" onClick={() => { const c = ref.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); onChange(false); }} className="mt-1.5 flex items-center gap-1.5 text-[13px] text-muted"><Eraser size={14} /> Borrar firma</button>
    </div>
  );
}

type Res = 'OK' | 'NO' | 'NA';
export function CampoPreop() {
  const { go } = useRouter();
  const toast = useToast();
  const { setPreopHoyAprobado } = useStore();
  const all = ELEMENTOS_CHEQUEO.flatMap((g) => g.items.map(([n, c]) => ({ grupo: g.grupo, nombre: n as string, critico: c as boolean })));
  const [res, setRes] = useState<Record<string, Res>>({});
  const [km, setKm] = useState('');
  const [firma, setFirma] = useState(false);
  const faltan = all.filter((e) => !res[e.nombre]).length;
  const fallaCritica = all.filter((e) => e.critico && res[e.nombre] === 'NO');
  const enviar = () => {
    if (fallaCritica.length) { setPreopHoyAprobado(false); toast(`No aprobado: ${fallaCritica[0].nombre}. La ruta queda bloqueada y se avisó a HSEQ.`, 'warn'); }
    else { setPreopHoyAprobado(true); toast('Preoperacional aprobado. Ya puede iniciar el recorrido.'); go('campo'); }
  };
  return (
    <CampoLayout title="Preoperacional" back>
      <p className="text-[13px] text-muted">{vehiculo(RUTA.vehiculoId).placa} · {vehiculo(RUTA.vehiculoId).tipo}</p>
      <button onClick={() => setRes(Object.fromEntries(all.map((e) => [e.nombre, 'OK'])))} className="mt-2 text-[13px] font-medium text-brand underline">Marcar todo como OK (demo)</button>
      {ELEMENTOS_CHEQUEO.map((g) => (
        <section key={g.grupo} className="mt-5">
          <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">{g.grupo}</h2>
          <ul className="flex flex-col gap-2">
            {g.items.map(([n, c]) => (
              <li key={n} className={cx('rounded-xl border bg-surface p-3', res[n] === 'NO' && c ? 'border-bad' : 'border-line')}>
                <p className="text-[14px] font-medium leading-snug">{n} {c && <span className="ml-1 align-middle"><Badge tone="bad">Crítico</Badge></span>}</p>
                <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup" aria-label={n}>
                  {(['OK', 'NO', 'NA'] as Res[]).map((r) => (
                    <button key={r} role="radio" aria-checked={res[n] === r} onClick={() => setRes((s) => ({ ...s, [n]: r }))}
                      className={cx('h-11 rounded-lg border text-[14px] font-semibold', res[n] === r
                        ? r === 'OK' ? 'border-ok bg-ok text-white' : r === 'NO' ? 'border-bad bg-bad text-white' : 'border-muted bg-muted text-surface'
                        : 'border-line text-muted')}>{r === 'NA' ? 'N/A' : r === 'NO' ? 'No' : 'OK'}</button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <div className="mt-5 flex flex-col gap-4">
        <Field label="Kilometraje inicial" id="pre-km"><Input id="pre-km" inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value.replace(/\D/g, ''))} placeholder="Ej. 184520" className="h-12 text-base" /></Field>
        <Field label="Firma del conductor" id="pre-firma"><SignaturePad onChange={setFirma} /></Field>
        {fallaCritica.length > 0 && <p className="rounded-xl bg-bad/10 p-3 text-[13px] text-bad">Hay {fallaCritica.length} ítem crítico en «No». Si envía así, la ruta queda bloqueada hasta que HSEQ autorice el vehículo de reemplazo.</p>}
        <Button variant="primary" size="lg" disabled={faltan > 0 || !km || !firma} onClick={enviar}>{faltan > 0 ? `Faltan ${faltan} ítems` : !km ? 'Escriba el kilometraje' : !firma ? 'Firme para enviar' : 'Enviar preoperacional'}</Button>
      </div>
    </CampoLayout>
  );
}

export function CampoParada() {
  const { go } = useRouter();
  const toast = useToast();
  const { paradaSel, marcarParada } = useStore();
  const s = sol(paradaSel); const su = sucursal(s.sucursalId);
  const [pesos, setPesos] = useState<Record<string, string>>({});
  const [fotos, setFotos] = useState(0);
  const [firma, setFirma] = useState(false);
  const [noAtendida, setNoAtendida] = useState(false);
  const total = Object.values(pesos).reduce((a, v) => a + (Number(v.replace(',', '.')) || 0), 0);
  const listo = s.items.every((i) => pesos[i.declId]) && firma;
  return (
    <CampoLayout title={cliente(s.clienteId).razonSocial} back>
      <p className="text-[13px] text-muted">{su.nombre} · {su.municipio} · {s.franja}</p>
      <div className="mt-3 flex items-center gap-2 rounded-xl bg-surface p-3 text-[13px] ring-1 ring-line">
        <MapPin size={16} className="shrink-0 text-ok" /><span className="flex-1">Llegada registrada con ubicación GPS</span>
        <button onClick={() => navigator.clipboard?.writeText(su.telefono).catch(() => {})} className="flex items-center gap-1 text-muted"><Copy size={13} /><span className="num">{su.telefono}</span></button>
      </div>

      <h2 className="mb-2 mt-5 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">Residuos a recolectar</h2>
      <ul className="flex flex-col gap-3">
        {s.items.map((i) => { const it = item(decl(i.declId).itemId); return (
          <li key={i.declId} className="rounded-xl border border-line bg-surface p-3">
            <p className="font-medium leading-snug">{it.nombre}</p>
            <p className="text-[13px] text-muted">{it.corriente ?? 'No peligroso'}{it.onu ? ` · UN ${it.onu}` : ''} · {decl(i.declId).embalaje}</p>
            <div className="mt-2 flex items-end gap-3">
              <Field label={`Cantidad real (${uni(it.unidad)})`} id={`peso-${i.declId}`}>
                <Input id={`peso-${i.declId}`} inputMode="decimal" className="h-12 text-lg" value={pesos[i.declId] ?? ''} onChange={(e) => setPesos((p) => ({ ...p, [i.declId]: e.target.value }))} placeholder={fmtNum(i.cantidad)} />
              </Field>
              <p className="pb-3 text-[13px] text-muted">Esperado: <span className="num">{fmtNum(i.cantidad)}</span></p>
            </div>
          </li>); })}
      </ul>

      <h2 className="mb-2 mt-5 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">Evidencias</h2>
      <label htmlFor="foto-input" className="flex h-14 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-surface text-[14px] font-medium">
        <Camera size={20} /> {fotos ? `${fotos} foto${fotos > 1 ? 's' : ''} adjunta${fotos > 1 ? 's' : ''}` : 'Foto de embalaje y rotulado'}
      </label>
      <input id="foto-input" type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={(e) => setFotos((n) => n + (e.target.files?.length ?? 0))} />
      <div className="mt-4"><Field label={`Firma de quien entrega (${su.contacto})`} id="firma-gen"><SignaturePad onChange={setFirma} /></Field></div>

      <div className="mt-6 flex flex-col gap-3">
        <Button variant="primary" size="lg" disabled={!listo} onClick={() => { marcarParada(s.id, total); toast('Recolección confirmada. El manifiesto quedó en cola para emitirse.'); go('campo'); }}>
          {listo ? 'Confirmar recolección' : 'Registre cantidades y firma'}
        </Button>
        {!noAtendida ? <Button size="lg" onClick={() => setNoAtendida(true)}>No se pudo atender</Button> : (
          <div className="rounded-xl border border-line bg-surface p-3">
            <Field label="Causal" id="causal-na"><Select id="causal-na"><option>Cliente no disponible en sitio</option><option>Residuo sin embalar o sin rotular</option><option>Acceso cerrado / vía en mal estado</option></Select></Field>
            <Button className="mt-3 w-full" variant="danger" onClick={() => { toast('Parada marcada como no atendida. Logística fue notificada.', 'warn'); go('campo'); }}>Registrar no atendida</Button>
          </div>
        )}
      </div>
    </CampoLayout>
  );
}
