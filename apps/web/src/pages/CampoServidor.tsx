// App del conductor conectada al API (modo servidor). Pensada para el celular y para trabajar SIN SEÑAL:
// el «paquete del día» queda guardado en el teléfono y cada acción entra a una cola que se envía sola.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertOctagon, ArrowLeft, Camera, CheckCircle2, ChevronRight, ClipboardCheck, CloudUpload, Eraser, Factory, Home, MapPin, Navigation, RefreshCw, Route, Satellite, Scale, Wifi, WifiOff } from 'lucide-react';
import { Badge, Button, Field, Input, Select, useToast } from '../components/ui';
import { Logo } from '../components/AppShell';
import { useRouter } from '../lib/router';
import { api, ErrorApi, sesionActual, tienePermiso } from '../lib/api';
import { cx } from '../lib/format';
import { borrarBorrador, descartar, encolar, guardarBorrador, guardarPaquete, leerBorrador, leerPaquete, listar, procesar, reintentar, useCola, type Operacion } from '../campo/cola';
import { comprimirFoto, detenerGps, iniciarGps } from '../campo/medios';

// ---------- Tipos del API (solo lo que usa la app) ----------
interface Etapa { id: string; nombre: string; color: string; orden: number; esFinal: boolean; cancela: boolean; rastreo: boolean }
interface ItemRuta { id: string; solicitudItem: { id: string; estado: string; cantidadEstimada: string | null; solicitud: { numero: number }; declaracion: { nombre: string; codigoInterno: string | null } } }
interface Parada { id: string; orden: number; sucursal: { codigo: string | null; nombre: string; direccion: string | null; cliente: { razonSocial: string } }; items: ItemRuta[] }
interface Ruta {
  id: string; codigo: string; fechaProgramada: string; kmInicial: number | null; kmFinal: number | null; vehiculoId: string | null;
  vehiculo: { placa: string; marca: string | null } | null; conductor: { nombre: string } | null; auxiliar: { nombre: string } | null;
  estadoRecorrido: Etapa | null; paradas: Parada[];
}
interface LineaMf {
  id: string; cantidad: string; embalajes: number | null; sucursal: { id: string; nombre: string }; declaracion: { nombre: string; esPeligroso: boolean };
  metrica: { abreviacion: string } | null; disposicion: { nombre: string } | null; solicitudItem: { id: string } | null;
}
interface Manifiesto {
  id: string; numero: string; tipo: 'CARGUE' | 'DESCARGUE'; estado: 'PENDIENTE' | 'REALIZADO' | 'ANULADO'; fechaServicio: string;
  cliente: { razonSocial: string }; items: LineaMf[]; evidencias: { tipo: string }[];
  transporte: { empresaTransportadora: string; placa: string | null; conductorNombre: string | null; conductorDocumento: string | null; conductorArlId: string | null; conductorEpsId: string | null } | null;
}
interface Elemento { id: string; grupo: string; nombre: string; critico: boolean }
interface Catalogos { etapas: Etapa[]; arl: { id: string; nombre: string }[]; eps: { id: string; nombre: string }[] }
interface Inspeccion { id: string; numero: string; vehiculoId: string; aprobado: boolean | null }
interface Paquete {
  fecha: string; usuarioId: string; actualizado: string; rutaSel: string | null;
  rutas: Ruta[]; manifiestos: Record<string, Manifiesto>; enCola: Record<string, boolean>;
  catalogos: Catalogos; elementos: Elemento[]; inspecciones: Inspeccion[];
}

const hoy = () => new Date().toLocaleDateString('en-CA'); // AAAA-MM-DD en la hora del teléfono
const horaAhora = () => new Date().toTimeString().slice(0, 5);
const isoColombia = (fecha: string, hora: string) => `${fecha.slice(0, 10)}T${hora}:00-05:00`;
const SEL_MF = 'terry-go-mf-sel';

/** Envía de una vez si hay señal y nada pendiente del mismo grupo; si no, deja la acción en la cola. */
async function enviar<T>(op: Omit<Operacion, 'creadoEn' | 'intentos'>): Promise<{ enCola: boolean; respuesta?: T }> {
  const pendientesGrupo = (await listar()).some((o) => o.grupo === op.grupo);
  if (navigator.onLine && !pendientesGrupo) {
    try { return { enCola: false, respuesta: await api<T>(op.ruta, { metodo: op.metodo, cuerpo: op.cuerpo ?? {} }) }; }
    catch (e) { if (!(e instanceof ErrorApi) || e.status !== 0) throw e; }
  }
  await encolar(op);
  return { enCola: true };
}

/** Descarga la ruta del día, sus manifiestos y las listas, y los guarda en el teléfono. */
async function descargarPaquete(anterior: Paquete | null): Promise<Paquete> {
  const yo = sesionActual()!.usuario, f = hoy();
  let rutas = await api<Ruta[]>(`/rutas?desde=${f}&hasta=${f}&conductorId=${yo.id}`);
  if (!rutas.length && (tienePermiso('rutas.programar') || tienePermiso('manifiestos.operar'))) rutas = await api<Ruta[]>(`/rutas?desde=${f}&hasta=${f}`);
  const [catalogos, elementos] = await Promise.all([api<Catalogos>('/catalogos/operacion'), api<Elemento[]>('/elementos-chequeo')]);
  const manifiestos: Record<string, Manifiesto> = {};
  for (const r of rutas) {
    const lista = await api<{ filas: { id: string; estado: string }[] }>(`/manifiestos?rutaId=${r.id}&porPagina=100`);
    for (const m of lista.filas.filter((x) => x.estado !== 'ANULADO')) manifiestos[m.id] = await api<Manifiesto>(`/manifiestos/${m.id}`);
  }
  const vehiculos = [...new Set(rutas.map((r) => r.vehiculoId).filter(Boolean))] as string[];
  const inspecciones = (await Promise.all(vehiculos.map((v) => api<Inspeccion[]>(`/preoperacionales?vehiculoId=${v}&fecha=${f}`)))).flat();
  const rutaSel = anterior?.rutaSel && rutas.some((r) => r.id === anterior.rutaSel) ? anterior.rutaSel : rutas[0]?.id ?? null;
  const p: Paquete = { fecha: f, usuarioId: yo.id, actualizado: new Date().toISOString(), rutaSel, rutas, manifiestos, enCola: {}, catalogos, elementos, inspecciones };
  guardarPaquete(p);
  return p;
}

/** Paquete del día compartido por las pantallas de campo. */
function usePaquete() {
  const toast = useToast();
  const [p, setP] = useState<Paquete | null>(() => { const x = leerPaquete<Paquete>(); return x && x.usuarioId === sesionActual()?.usuario.id ? x : null; });
  const [cargando, setCargando] = useState(false);
  const actualizar = async (silencioso = false) => {
    if (!navigator.onLine) { if (!silencioso) toast('Sin señal: se trabaja con la copia guardada en el teléfono.', 'warn'); return; }
    setCargando(true);
    try { setP(await descargarPaquete(leerPaquete<Paquete>())); if (!silencioso) toast('Ruta del día actualizada.'); }
    catch (e) { if (!silencioso) toast(e instanceof ErrorApi ? e.message : 'No se pudo actualizar.', 'warn'); }
    finally { setCargando(false); }
  };
  useEffect(() => { if (!p || p.fecha !== hoy()) void actualizar(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const cambiar = (fn: (x: Paquete) => Paquete) => setP((x) => { if (!x) return x; const n = fn(x); guardarPaquete(n); return n; });
  const ruta = p?.rutas.find((r) => r.id === p.rutaSel) ?? null;
  return { p, ruta, cargando, actualizar, cambiar };
}

function CampoLayout({ children, title, back }: { children: ReactNode; title?: string; back?: boolean }) {
  const { route, go } = useRouter();
  const { enLinea, pendientes, errores } = useCola();
  return (
    <div className="mx-auto flex min-h-full max-w-[560px] flex-col bg-bg">
      <header className="sticky z-30 border-b border-line bg-surface" style={{ top: 'env(safe-area-inset-top, 0px)' }}>
        <div className="safe-x flex h-14 items-center gap-2">
          {back ? <button onClick={() => go('campo')} className="-ml-2 rounded-lg p-2" aria-label="Volver"><ArrowLeft size={22} /></button> : <Logo className="h-7" />}
          {title && <h1 className="truncate text-[16px] font-semibold">{title}</h1>}
          <button onClick={() => go('campo-envios')} className={cx('ml-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-medium',
            errores.length ? 'bg-bad/10 text-bad' : !enLinea || pendientes ? 'bg-warn/10 text-warn' : 'bg-ok/10 text-ok')} aria-label="Envíos pendientes">
            {enLinea ? <Wifi size={14} /> : <WifiOff size={14} />}
            {errores.length ? `${errores.length} con error` : pendientes ? `${pendientes} por enviar` : enLinea ? 'En línea' : 'Sin señal'}
          </button>
        </div>
      </header>
      <main className="safe-x flex-1 py-4 pb-28">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface safe-bottom" aria-label="Navegación de campo">
        <div className="mx-auto grid max-w-[560px] grid-cols-3">
          {([['campo', <Home size={22} />, 'Mi ruta'], ['campo-preop', <ClipboardCheck size={22} />, 'Inspección'], ['campo-envios', <CloudUpload size={22} />, 'Envíos']] as const).map(([r, ic, l]) => (
            <button key={r} onClick={() => go(r)} className={cx('flex h-16 flex-col items-center justify-center gap-1 text-[12px] font-medium', route === r || (r === 'campo' && route === 'campo-parada') ? 'text-brand' : 'text-muted')}>{ic}{l}</button>
          ))}
        </div>
      </nav>
    </div>
  );
}

// ======================= Ruta del día =======================
export function CampoRutaServidor() {
  const { go } = useRouter();
  const toast = useToast();
  const { p, ruta, cargando, actualizar, cambiar } = usePaquete();
  const [pidiendoKm, setPidiendoKm] = useState<Etapa | null>(null);
  const [km, setKm] = useState('');
  const etapa = ruta?.estadoRecorrido ?? null;

  // GPS solo mientras la ruta esté en una etapa con rastreo
  useEffect(() => { if (ruta && etapa?.rastreo) iniciarGps(ruta.id); else detenerGps(); }, [ruta?.id, etapa?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!p) return <CampoLayout><Vacio cargando={cargando} actualizar={() => actualizar()} texto="Descargue la ruta del día con señal (en planta) para trabajar sin conexión." /></CampoLayout>;
  if (!ruta) return <CampoLayout><Vacio cargando={cargando} actualizar={() => actualizar()} texto="No tiene rutas programadas para hoy." /></CampoLayout>;

  const inspeccion = p.inspecciones.find((i) => i.vehiculoId === ruta.vehiculoId && i.aprobado);
  const siguientes = p.catalogos.etapas.filter((e) => e.orden > (etapa?.orden ?? 0) || (e.esFinal && !etapa?.esFinal));
  // El manifiesto de la parada es el que contiene sus líneas de solicitud
  const mfDeParada = (pa: Parada) => Object.values(p.manifiestos).find((m) => m.items.some((i) => pa.items.some((it) => it.solicitudItem.id === i.solicitudItem?.id)));
  const hechos = ruta.paradas.filter((pa) => { const m = mfDeParada(pa); return m && (m.estado === 'REALIZADO' || p.enCola[m.id]); }).length;

  const cambiarEtapa = async (e: Etapa, kmValor?: number) => {
    const sale = (etapa?.orden ?? 1) <= 1 && e.orden > 1 && !e.esFinal;
    const termina = e.esFinal && !e.cancela;
    const cuerpo = { estadoRecorridoId: e.id, ...(sale && kmValor !== undefined ? { kmInicial: kmValor } : {}), ...(termina && kmValor !== undefined ? { kmFinal: kmValor } : {}) };
    try {
      const r = await enviar({ grupo: `ruta:${ruta.id}`, descripcion: `Etapa «${e.nombre}» · ${ruta.codigo}`, metodo: 'PATCH', ruta: `/rutas/${ruta.id}/estado`, cuerpo });
      cambiar((x) => ({ ...x, rutas: x.rutas.map((rr) => rr.id === ruta.id ? { ...rr, estadoRecorrido: e } : rr) }));
      toast(r.enCola ? `Etapa «${e.nombre}» guardada en el teléfono: se enviará al volver la señal.` : `Etapa «${e.nombre}».`);
    } catch (err) { toast(err instanceof ErrorApi ? err.message : 'No se pudo cambiar la etapa.', 'warn'); }
    setPidiendoKm(null); setKm('');
  };
  const abrirManifiestos = async () => {
    if (!navigator.onLine) { toast('Necesita señal para abrir los manifiestos de la ruta.', 'warn'); return; }
    try { await api('/manifiestos/desde-ruta', { cuerpo: { rutaId: ruta.id } }); await actualizar(true); toast('Manifiestos listos en el teléfono.'); }
    catch (e) { toast(e instanceof ErrorApi ? e.message : 'No se pudieron crear los manifiestos.', 'warn'); }
  };

  return (
    <CampoLayout>
      <div className="flex items-start justify-between gap-2">
        <div><p className="text-[13px] text-muted">{new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1 className="mt-0.5 text-[22px] font-bold text-brand-strong">Hola, {sesionActual()?.usuario.nombre.split(' ')[0]}</h1></div>
        <button onClick={() => actualizar()} disabled={cargando} className="mt-1 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] text-muted ring-1 ring-line" aria-label="Actualizar ruta"><RefreshCw size={15} className={cx(cargando && 'animate-spin')} /> Actualizar</button>
      </div>
      {p.rutas.length > 1 && <div className="mt-3"><Select value={ruta.id} onChange={(e) => cambiar((x) => ({ ...x, rutaSel: e.target.value }))} aria-label="Ruta">{p.rutas.map((r) => <option key={r.id} value={r.id}>{r.codigo} · {r.vehiculo?.placa ?? 'sin vehículo'}</option>)}</Select></div>}
      <div className="mt-3 flex flex-wrap gap-2 text-[13px]">
        <span className="num rounded-lg bg-surface px-2.5 py-1 font-semibold ring-1 ring-line">{ruta.vehiculo?.placa ?? 'Sin vehículo'}</span>
        <span className="rounded-lg bg-surface px-2.5 py-1 ring-1 ring-line"><Route size={13} className="mr-1 inline" />{ruta.codigo}</span>
        {ruta.auxiliar && <span className="rounded-lg bg-surface px-2.5 py-1 ring-1 ring-line">Aux.: {ruta.auxiliar.nombre}</span>}
        {etapa && <span className="rounded-lg px-2.5 py-1 font-medium text-white" style={{ background: etapa.color }}>{etapa.nombre}</span>}
        {etapa?.rastreo && <span className="flex items-center gap-1 rounded-lg bg-info/10 px-2.5 py-1 text-info"><Satellite size={13} /> GPS activo</span>}
      </div>

      {inspeccion ? (
        <div className="mt-4 flex items-center gap-3 rounded-2xl bg-ok/10 p-4 text-ok"><CheckCircle2 size={24} className="shrink-0" /><div><p className="font-semibold">Inspección {inspeccion.numero} aprobada</p><p className="text-[13px] opacity-90">El vehículo puede salir.</p></div></div>
      ) : (
        <button onClick={() => go('campo-preop')} className="mt-4 flex w-full items-center gap-3 rounded-2xl bg-warn/10 p-4 text-left text-warn ring-1 ring-warn/30">
          <AlertOctagon size={26} className="shrink-0" /><div className="flex-1"><p className="font-semibold">Haga la inspección del vehículo</p><p className="text-[13px] opacity-90">La ruta no sale sin la inspección aprobada.</p></div><ChevronRight size={20} />
        </button>
      )}

      {!etapa?.esFinal && siguientes.length > 0 && (
        <div className="mt-4"><p className="mb-2 text-[13px] font-medium text-muted">Cambiar etapa</p>
          <div className="grid grid-cols-2 gap-2">
            {siguientes.map((e) => (
              <button key={e.id} onClick={() => { const pide = ((etapa?.orden ?? 1) <= 1 && e.orden > 1 && !e.esFinal) || (e.esFinal && !e.cancela); if (pide) setPidiendoKm(e); else void cambiarEtapa(e); }}
                className="flex h-12 items-center justify-center gap-2 rounded-xl border text-[14px] font-semibold" style={{ borderColor: e.color, color: e.color }}>{e.nombre}</button>
            ))}
          </div>
          {pidiendoKm && (
            <div className="mt-3 rounded-2xl bg-surface p-4 ring-1 ring-line">
              <Field label={`Kilometraje ${pidiendoKm.esFinal ? 'final' : 'inicial'} (odómetro)`} id="km"><Input id="km" inputMode="numeric" value={km} onChange={(x) => setKm(x.target.value.replace(/\D/g, ''))} placeholder="Ej. 184600" /></Field>
              <div className="mt-3 grid grid-cols-2 gap-2"><Button onClick={() => setPidiendoKm(null)}>Cancelar</Button><Button variant="primary" disabled={!km} onClick={() => cambiarEtapa(pidiendoKm, Number(km))}>Confirmar</Button></div>
            </div>
          )}
        </div>
      )}

      <div className="mb-2 mt-6 flex items-center justify-between"><h2 className="text-[16px] font-semibold">Paradas</h2><span className="num text-[13px] text-muted">{hechos} de {ruta.paradas.length} con manifiesto grabado</span></div>
      <div className="mb-4 h-2 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-brand transition-all" style={{ width: `${ruta.paradas.length ? (hechos / ruta.paradas.length) * 100 : 0}%` }} /></div>
      {!Object.keys(p.manifiestos).length && ruta.paradas.some((pa) => pa.items.length) && (
        <Button variant="primary" className="mb-3 h-12 w-full rounded-xl" onClick={abrirManifiestos}>Abrir los manifiestos de la ruta</Button>
      )}
      <ol className="flex flex-col gap-3">
        {ruta.paradas.map((pa) => {
          const m = mfDeParada(pa); const listo = m && (m.estado === 'REALIZADO' || p.enCola[m.id]);
          const destino = encodeURIComponent(`${pa.sucursal.direccion ?? pa.sucursal.nombre} ${pa.sucursal.cliente.razonSocial}`);
          return (
            <li key={pa.id} className={cx('rounded-2xl border bg-surface p-4', listo ? 'border-ok/40' : 'border-line')}>
              <div className="flex items-start gap-3">
                <span className={cx('num flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold', listo ? 'bg-ok text-white' : 'bg-brand-soft text-brand-ink')}>{listo ? <CheckCircle2 size={18} /> : pa.orden}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-snug">{pa.sucursal.cliente.razonSocial}</p>
                  <p className="text-[13px] text-muted"><MapPin size={13} className="mr-1 inline" />{pa.sucursal.codigo ? `${pa.sucursal.codigo} · ` : ''}{pa.sucursal.nombre}{pa.sucursal.direccion ? ` · ${pa.sucursal.direccion}` : ''}</p>
                  <p className="mt-1 text-[13px]">{pa.items.map((it) => it.solicitudItem.declaracion.nombre).join(', ') || 'Sin líneas'}</p>
                  {m && <p className={cx('mt-1 text-[13px] font-medium', listo ? 'text-ok' : 'text-muted')}>Manifiesto {m.numero}{m.estado === 'REALIZADO' ? ' · grabado' : p.enCola[m.id] ? ' · grabado en el teléfono, por enviar' : ''}</p>}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-[1fr_1.6fr] gap-2">
                <a href={`https://www.google.com/maps/search/?api=1&query=${destino}`} target="_blank" rel="noreferrer" className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-line text-[13px] font-medium"><Navigation size={16} /> Cómo llegar</a>
                <Button variant="primary" className="h-11 rounded-xl" disabled={!m || !!listo} onClick={() => { sessionStorage.setItem(SEL_MF, m!.id); go('campo-parada'); }}>{listo ? 'Atendida' : 'Diligenciar manifiesto'}</Button>
              </div>
            </li>
          );
        })}
        <li className="flex items-center gap-3 rounded-2xl border border-dashed border-line p-4 text-[14px] text-muted"><Factory size={22} className="shrink-0" /><div><p className="font-medium text-fg">Descarga en planta</p><p className="text-[13px]">Al llegar, cambie la etapa a la final con el kilometraje.</p></div></li>
      </ol>
      <p className="mt-4 text-center text-[12px] text-subtle">Copia guardada en el teléfono: {new Date(p.actualizado).toLocaleString('es-CO', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}</p>
    </CampoLayout>
  );
}

function Vacio({ cargando, actualizar, texto }: { cargando: boolean; actualizar: () => void; texto: string }) {
  return (
    <div className="mt-10 flex flex-col items-center gap-4 text-center">
      <Route size={40} className="text-muted" /><p className="max-w-[300px] text-muted">{texto}</p>
      <Button variant="primary" onClick={actualizar} disabled={cargando}><RefreshCw size={16} className={cx(cargando && 'animate-spin')} /> {cargando ? 'Descargando…' : 'Descargar ruta del día'}</Button>
    </div>
  );
}

// ======================= Inspección del vehículo =======================
type Res = 'OK' | 'NO_OK' | 'NA';
export function CampoInspeccionServidor() {
  const { go } = useRouter();
  const toast = useToast();
  const { p, ruta, cambiar } = usePaquete();
  const [res, setRes] = useState<Record<string, Res>>({});
  const [km, setKm] = useState('');
  const [obs, setObs] = useState('');
  const [enviando, setEnviando] = useState(false);
  if (!p || !ruta) return <CampoLayout title="Inspección" back><p className="mt-6 text-center text-muted">Primero descargue la ruta del día.</p></CampoLayout>;
  if (!ruta.vehiculoId) return <CampoLayout title="Inspección" back><p className="mt-6 text-center text-muted">La ruta aún no tiene vehículo asignado.</p></CampoLayout>;
  const grupos = [...new Set(p.elementos.map((e) => e.grupo))];
  const faltan = p.elementos.filter((e) => !res[e.id]).length;
  const criticasMal = p.elementos.filter((e) => e.critico && res[e.id] === 'NO_OK');
  const enviarInspeccion = async () => {
    setEnviando(true);
    const cuerpo = { vehiculoId: ruta.vehiculoId, rutaId: ruta.id, fechaProgramada: hoy(), km: Number(km), observaciones: obs || undefined, respuestas: p.elementos.map((e) => ({ elementoId: e.id, resultado: res[e.id] })) };
    try {
      const r = await enviar<{ id: string; numero: string; aprobado: boolean; fallasCriticas: string[] }>({ grupo: `ruta:${ruta.id}`, descripcion: `Inspección del vehículo ${ruta.vehiculo?.placa ?? ''}`, metodo: 'POST', ruta: '/preoperacionales', cuerpo });
      const aprobado = r.respuesta ? r.respuesta.aprobado : !criticasMal.length;
      if (r.respuesta) cambiar((x) => ({ ...x, inspecciones: [...x.inspecciones, { id: r.respuesta!.id, numero: r.respuesta!.numero, vehiculoId: ruta.vehiculoId!, aprobado }] }));
      else if (aprobado) cambiar((x) => ({ ...x, inspecciones: [...x.inspecciones, { id: 'local', numero: '(por enviar)', vehiculoId: ruta.vehiculoId!, aprobado: true }] }));
      if (!aprobado) toast(`No aprobada: ${criticasMal.map((e) => e.nombre).join(', ')}. El vehículo no puede salir.`, 'warn');
      else { toast(r.enCola ? 'Inspección guardada en el teléfono: se enviará al volver la señal.' : 'Inspección aprobada.'); go('campo'); }
    } catch (e) { toast(e instanceof ErrorApi ? e.message : 'No se pudo enviar la inspección.', 'warn'); }
    finally { setEnviando(false); }
  };
  return (
    <CampoLayout title="Inspección del vehículo" back>
      <p className="text-[13px] text-muted">{ruta.vehiculo?.placa} · {ruta.codigo}. Marque cada elemento. Los marcados como <b>críticos</b> impiden la salida si fallan.</p>
      {grupos.map((g) => (
        <section key={g} className="mt-4"><h2 className="mb-2 text-[15px] font-semibold">{g}</h2>
          <ul className="flex flex-col gap-2">
            {p.elementos.filter((e) => e.grupo === g).map((e) => (
              <li key={e.id} className="rounded-xl bg-surface p-3 ring-1 ring-line">
                <p className="text-[14px] font-medium">{e.nombre}{e.critico && <span className="ml-2"><Badge tone="bad">Crítico</Badge></span>}</p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {([['OK', 'Bien'], ['NO_OK', 'Falla'], ['NA', 'No aplica']] as [Res, string][]).map(([v, l]) => (
                    <button key={v} onClick={() => setRes((s) => ({ ...s, [e.id]: v }))} className={cx('h-11 rounded-lg text-[14px] font-semibold ring-1',
                      res[e.id] === v ? (v === 'OK' ? 'bg-ok text-white ring-ok' : v === 'NO_OK' ? 'bg-bad text-white ring-bad' : 'bg-muted text-white ring-muted') : 'ring-line')}>{l}</button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <div className="mt-5 flex flex-col gap-3">
        <Field label="Kilometraje actual" id="km-i"><Input id="km-i" inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value.replace(/\D/g, ''))} /></Field>
        <Field label="Observaciones" id="obs-i"><Input id="obs-i" value={obs} maxLength={500} onChange={(e) => setObs(e.target.value)} /></Field>
        {criticasMal.length > 0 && <p className="rounded-xl bg-bad/10 p-3 text-[13px] text-bad">Falla crítica: {criticasMal.map((e) => e.nombre).join(', ')}. La inspección quedará no aprobada.</p>}
        <Button variant="primary" className="h-12 rounded-xl" disabled={!!faltan || !km || enviando} onClick={enviarInspeccion}>{faltan ? `Faltan ${faltan} elementos` : enviando ? 'Enviando…' : 'Enviar inspección'}</Button>
      </div>
    </CampoLayout>
  );
}

// ======================= Manifiesto en campo =======================
interface Borrador {
  cantidades: Record<string, string>; embalajes: Record<string, string>; pesoEntrada: string; pesoSalida: string;
  horaLlegada: string; horaSalida: string; firma: string; firmaNombre: string; firmaDocumento: string; observaciones: string; fotos: number;
  conductorArlId: string; conductorEpsId: string;
}
const num = (s: string) => Number(s.replace(',', '.'));

export function CampoManifiestoServidor() {
  const { go } = useRouter();
  const toast = useToast();
  const { p, cambiar } = usePaquete();
  const id = sessionStorage.getItem(SEL_MF) ?? '';
  const m = p?.manifiestos[id];
  const inicial = useMemo<Borrador>(() => leerBorrador<Borrador>(id) ?? {
    cantidades: Object.fromEntries((m?.items ?? []).map((i) => [i.id, String(Number(i.cantidad))])), embalajes: Object.fromEntries((m?.items ?? []).map((i) => [i.id, i.embalajes?.toString() ?? ''])),
    pesoEntrada: '', pesoSalida: '', horaLlegada: '', horaSalida: '', firma: '', firmaNombre: '', firmaDocumento: '', observaciones: '', fotos: m?.evidencias.filter((e) => e.tipo === 'FOTO').length ?? 0,
    conductorArlId: m?.transporte?.conductorArlId ?? '', conductorEpsId: m?.transporte?.conductorEpsId ?? '',
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [b, setB] = useState<Borrador>(inicial);
  const [miniaturas, setMiniaturas] = useState<string[]>([]);
  const [grabando, setGrabando] = useState(false);
  const set = <K extends keyof Borrador>(k: K, v: Borrador[K]) => setB((x) => { const n = { ...x, [k]: v }; guardarBorrador(id, n); return n; });

  if (!p || !m) return <CampoLayout title="Manifiesto" back><p className="mt-6 text-center text-muted">Manifiesto no disponible en el teléfono. Actualice la ruta con señal.</p></CampoLayout>;
  const descargue = m.tipo === 'DESCARGUE';
  const neto = b.pesoEntrada && b.pesoSalida ? Math.round((num(b.pesoEntrada) - num(b.pesoSalida)) * 100) / 100 : null;
  const faltan = [
    ...m.items.filter((i) => !(num(b.cantidades[i.id] ?? '0') > 0)).map((i) => `cantidad de ${i.declaracion.nombre}`),
    ...(!b.horaLlegada ? ['hora de llegada'] : []), ...(!b.horaSalida ? ['hora de salida'] : []),
    ...(b.horaLlegada && b.horaSalida && b.horaSalida < b.horaLlegada ? ['salida antes que la llegada'] : []),
    ...(descargue && neto === null ? ['peso de entrada y salida'] : []), ...(neto !== null && neto < 0 ? ['la salida pesa más que la entrada'] : []),
    ...(descargue && (!b.conductorArlId || !b.conductorEpsId) ? ['ARL y EPS del conductor'] : []),
    ...(!b.firma ? ['firma'] : []), ...(b.firmaNombre.trim().length < 3 ? ['nombre de quien firma'] : []), ...(b.firmaDocumento.trim().length < 3 ? ['identificación de quien firma'] : []),
  ];

  const tomarFoto = async (f?: File) => {
    if (!f) return;
    if (b.fotos >= 2) { toast('Ya hay 2 fotos (el máximo).', 'warn'); return; }
    try {
      const blob = await comprimirFoto(f);
      await encolar({ grupo: `mf:${id}`, descripcion: `Foto ${b.fotos + 1} · ${m.numero}`, metodo: 'POST', ruta: `/manifiestos/${id}/evidencias`,
        form: { campos: { tipo: 'FOTO', tomadaEn: new Date().toISOString() }, archivo: blob, nombre: `foto-${m.numero}-${b.fotos + 1}.jpg` } });
      setMiniaturas((x) => [...x, URL.createObjectURL(blob)]);
      set('fotos', b.fotos + 1);
    } catch { toast('No se pudo procesar la foto.', 'warn'); }
  };

  const grabar = async () => {
    setGrabando(true);
    const grupo = `mf:${id}`;
    try {
      for (const i of m.items) {
        const cantidad = num(b.cantidades[i.id]); const embalajes = b.embalajes[i.id] ? Number(b.embalajes[i.id]) : null;
        if (cantidad !== Number(i.cantidad) || embalajes !== i.embalajes)
          await encolar({ grupo, descripcion: `Cantidad de ${i.declaracion.nombre} · ${m.numero}`, metodo: 'PATCH', ruta: `/manifiestos/${id}/items/${i.id}`, cuerpo: { cantidad, embalajes } });
      }
      if (descargue && m.transporte && (b.conductorArlId !== (m.transporte.conductorArlId ?? '') || b.conductorEpsId !== (m.transporte.conductorEpsId ?? '')))
        await encolar({ grupo, descripcion: `Seguridad social del conductor · ${m.numero}`, metodo: 'PATCH', ruta: `/manifiestos/${id}`,
          cuerpo: { transporte: { empresaTransportadora: m.transporte.empresaTransportadora, placa: m.transporte.placa ?? undefined, conductorNombre: m.transporte.conductorNombre ?? undefined,
            conductorDocumento: m.transporte.conductorDocumento ?? undefined, conductorArlId: b.conductorArlId, conductorEpsId: b.conductorEpsId } } });
      await encolar({ grupo, descripcion: `Grabar manifiesto ${m.numero}`, metodo: 'POST', ruta: `/manifiestos/${id}/grabar`, cuerpo: {
        firma: b.firma, firmaNombre: b.firmaNombre.trim(), firmaDocumento: b.firmaDocumento.trim(),
        horaLlegada: isoColombia(m.fechaServicio, b.horaLlegada), horaSalida: isoColombia(m.fechaServicio, b.horaSalida),
        ...(b.pesoEntrada ? { pesoEntrada: num(b.pesoEntrada) } : {}), ...(b.pesoSalida ? { pesoSalida: num(b.pesoSalida) } : {}), ...(b.observaciones ? { observaciones: b.observaciones } : {}),
      } });
      cambiar((x) => ({ ...x, enCola: { ...x.enCola, [id]: true } }));
      borrarBorrador(id);
      await procesar();
      const quedan = (await listar()).filter((o) => o.grupo === grupo);
      if (quedan.some((o) => o.error)) toast(`El servidor rechazó el manifiesto: ${quedan.find((o) => o.error)!.error}. Revíselo en «Envíos».`, 'warn');
      else toast(quedan.length ? 'Manifiesto grabado en el teléfono: se enviará al volver la señal.' : `Manifiesto ${m.numero} grabado.`);
      go('campo');
    } catch { toast('No se pudo guardar el manifiesto en el teléfono.', 'warn'); }
    finally { setGrabando(false); }
  };

  return (
    <CampoLayout title={`Manifiesto ${m.numero}`} back>
      <p className="font-semibold">{m.cliente.razonSocial}</p>
      <p className="text-[13px] text-muted">{descargue ? 'Descargue en planta' : 'Cargue en la sede'} · {m.items[0]?.sucursal.nombre}</p>

      <Seccion titulo="Residuos recogidos">
        {m.items.map((i) => (
          <div key={i.id} className="rounded-xl bg-surface p-3 ring-1 ring-line">
            <p className="text-[14px] font-medium">{i.declaracion.nombre}{i.declaracion.esPeligroso && <span className="ml-2"><Badge tone="warn">RESPEL</Badge></span>}</p>
            <p className="text-[12px] text-muted">{i.disposicion?.nombre ?? ''}</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Field label={`Cantidad (${i.metrica?.abreviacion ?? 'und'})`} id={`c-${i.id}`}><Input id={`c-${i.id}`} inputMode="decimal" value={b.cantidades[i.id] ?? ''} onChange={(e) => set('cantidades', { ...b.cantidades, [i.id]: e.target.value.replace(/[^\d.,]/g, '') })} /></Field>
              <Field label="Embalajes" id={`e-${i.id}`}><Input id={`e-${i.id}`} inputMode="numeric" value={b.embalajes[i.id] ?? ''} onChange={(e) => set('embalajes', { ...b.embalajes, [i.id]: e.target.value.replace(/\D/g, '') })} /></Field>
            </div>
          </div>
        ))}
      </Seccion>

      <Seccion titulo="Horas">
        <div className="grid grid-cols-2 gap-2">
          {(['horaLlegada', 'horaSalida'] as const).map((k) => (
            <div key={k}><Field label={k === 'horaLlegada' ? 'Llegada' : 'Salida'} id={k}><Input id={k} type="time" value={b[k]} onChange={(e) => set(k, e.target.value)} /></Field>
              {!b[k] && <button onClick={() => set(k, horaAhora())} className="mt-1 text-[13px] font-medium text-brand">Marcar ahora</button>}</div>
          ))}
        </div>
      </Seccion>

      <Seccion titulo={`Báscula (kg)${descargue ? '' : ' · opcional'}`} icono={<Scale size={16} />}>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Entrada" id="pe"><Input id="pe" inputMode="decimal" value={b.pesoEntrada} onChange={(e) => set('pesoEntrada', e.target.value.replace(/[^\d.,]/g, ''))} /></Field>
          <Field label="Salida" id="ps"><Input id="ps" inputMode="decimal" value={b.pesoSalida} onChange={(e) => set('pesoSalida', e.target.value.replace(/[^\d.,]/g, ''))} /></Field>
          <Field label="Neto" id="pn"><Input id="pn" readOnly value={neto === null ? '' : neto.toLocaleString('es-CO')} className="bg-surface-2" /></Field>
        </div>
      </Seccion>

      {descargue && (
        <Seccion titulo="Seguridad social del conductor">
          <p className="text-[13px] text-muted">{m.transporte?.conductorNombre ?? 'Conductor'} · {m.transporte?.empresaTransportadora}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Field label="ARL" id="arl"><Select id="arl" value={b.conductorArlId} onChange={(e) => set('conductorArlId', e.target.value)}><option value="">Elija…</option>{p.catalogos.arl.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</Select></Field>
            <Field label="EPS" id="eps"><Select id="eps" value={b.conductorEpsId} onChange={(e) => set('conductorEpsId', e.target.value)}><option value="">Elija…</option>{p.catalogos.eps.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</Select></Field>
          </div>
        </Seccion>
      )}

      <Seccion titulo={`Fotos (${b.fotos} de 2)`} icono={<Camera size={16} />}>
        <div className="flex gap-2">{miniaturas.map((u) => <img key={u} src={u} alt="Foto de evidencia" className="h-20 w-20 rounded-lg object-cover ring-1 ring-line" />)}</div>
        {b.fotos < 2 && (
          <label className="mt-2 flex h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-line text-[14px] font-medium">
            <Camera size={18} /> Tomar foto
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { void tomarFoto(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        )}
      </Seccion>

      <Seccion titulo="Firma de quien entrega">
        <Firma valor={b.firma} onChange={(v) => set('firma', v)} />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Field label="Nombre" id="fn"><Input id="fn" value={b.firmaNombre} maxLength={150} onChange={(e) => set('firmaNombre', e.target.value)} /></Field>
          <Field label="Identificación" id="fd"><Input id="fd" inputMode="numeric" value={b.firmaDocumento} maxLength={20} onChange={(e) => set('firmaDocumento', e.target.value)} /></Field>
        </div>
        <Field label="Observaciones" id="mo"><Input id="mo" value={b.observaciones} maxLength={2000} onChange={(e) => set('observaciones', e.target.value)} /></Field>
      </Seccion>

      {faltan.length > 0 && <p className="mt-4 rounded-xl bg-warn/10 p-3 text-[13px] text-warn">Falta: {faltan.join(', ')}.</p>}
      <Button variant="primary" className="mt-4 h-12 w-full rounded-xl" disabled={!!faltan.length || grabando} onClick={grabar}>{grabando ? 'Guardando…' : 'Grabar manifiesto'}</Button>
      <p className="mt-2 text-center text-[12px] text-subtle">Al grabar ya no se puede modificar. Funciona sin señal: se envía solo al recuperarla.</p>
    </CampoLayout>
  );
}

function Seccion({ titulo, icono, children }: { titulo: string; icono?: ReactNode; children: ReactNode }) {
  return <section className="mt-5"><h2 className="mb-2 flex items-center gap-1.5 text-[15px] font-semibold">{icono}{titulo}</h2><div className="flex flex-col gap-2">{children}</div></section>;
}

/** Firma táctil: se guarda como imagen PNG (fondo transparente, trazo oscuro). */
function Firma({ valor, onChange }: { valor: string; onChange: (dataUrl: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const dibujando = useRef(false);
  useEffect(() => {
    const c = ref.current!; const r = c.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = r.width * dpr; c.height = r.height * dpr;
    const ctx = c.getContext('2d')!; ctx.scale(dpr, dpr); ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111827';
    if (valor) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, r.width, r.height); img.src = valor; }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
  return (
    <div>
      <canvas ref={ref} className="h-40 w-full touch-none rounded-xl border border-dashed border-line bg-white" aria-label="Área de firma: firme con el dedo"
        onPointerDown={(e) => { dibujando.current = true; const ctx = ref.current!.getContext('2d')!; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); ref.current!.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (!dibujando.current) return; const ctx = ref.current!.getContext('2d')!; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); }}
        onPointerUp={() => { if (!dibujando.current) return; dibujando.current = false; onChange(ref.current!.toDataURL('image/png')); }} />
      <button type="button" onClick={() => { const c = ref.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); onChange(''); }} className="mt-1.5 flex items-center gap-1.5 text-[13px] text-muted"><Eraser size={14} /> Borrar firma</button>
    </div>
  );
}

// ======================= Envíos pendientes =======================
export function CampoEnviosServidor() {
  const toast = useToast();
  const { ops, enLinea, pendientes, errores } = useCola();
  return (
    <CampoLayout title="Envíos" back>
      <div className={cx('flex items-center gap-3 rounded-2xl p-4', enLinea ? 'bg-ok/10 text-ok' : 'bg-warn/10 text-warn')}>
        {enLinea ? <Wifi size={22} /> : <WifiOff size={22} />}
        <div><p className="font-semibold">{enLinea ? 'Con señal' : 'Sin señal'}</p><p className="text-[13px] opacity-90">{pendientes ? `${pendientes} ${pendientes === 1 ? 'acción' : 'acciones'} por enviar.` : 'Todo enviado.'} {enLinea && pendientes ? 'Se están enviando.' : !enLinea ? 'Se enviarán solas al recuperar la señal.' : ''}</p></div>
      </div>
      {enLinea && pendientes > 0 && <Button className="mt-3 w-full" onClick={() => { void procesar(); }}><RefreshCw size={16} /> Enviar ahora</Button>}
      {errores.length > 0 && <p className="mt-4 text-[13px] text-bad">El servidor rechazó {errores.length} {errores.length === 1 ? 'acción' : 'acciones'}. Corrija el dato o descártela; las siguientes del mismo manifiesto esperan.</p>}
      <ul className="mt-3 flex flex-col gap-2">
        {ops.sort((a, b) => a.id! - b.id!).map((o) => (
          <li key={o.id} className={cx('rounded-xl bg-surface p-3 ring-1', o.error ? 'ring-bad/40' : 'ring-line')}>
            <p className="text-[14px] font-medium">{o.descripcion}</p>
            <p className="text-[12px] text-muted">{new Date(o.creadoEn).toLocaleString('es-CO', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}{o.intentos ? ` · ${o.intentos} intento(s)` : ''}</p>
            {o.error && <>
              <p className="mt-1 text-[13px] text-bad">{o.error}</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button onClick={() => { void reintentar(o.id!); }}>Reintentar</Button>
                <Button onClick={() => { if (confirm('¿Descartar esta acción? No se enviará al servidor.')) { void descartar(o.id!); toast('Acción descartada.'); } }}>Descartar</Button>
              </div>
            </>}
          </li>
        ))}
      </ul>
      {!ops.length && <p className="mt-6 text-center text-muted">No hay nada pendiente.</p>}
    </CampoLayout>
  );
}
