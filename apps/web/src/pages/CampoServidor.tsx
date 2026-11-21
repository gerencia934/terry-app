// App del conductor conectada al API (modo servidor). Pensada para el celular y para trabajar SIN SEÑAL:
// el «paquete del día» queda guardado en el teléfono y cada acción entra a una cola que se envía sola.
//
// Gerencia, 20-11-2026: la app de campo es un módulo aparte, solo en el celular. Trae únicamente la ruta del día (sin
// precios ni historial de clientes), el manifiesto se diligencia paso a paso con botones grandes, sin cantidades sugeridas
// (se anota lo real), y se imprime en sitio. Reportar «no había residuo» o «no me atendieron» toma un toque y no castiga.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertOctagon, ArrowLeft, Camera, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, CloudUpload, Eraser, Factory, Home, MapPin, Minus, Navigation, Phone, Plus,
  Printer, RefreshCw, Route, Satellite, Scale, ShieldAlert, Truck, Wifi, WifiOff,
} from 'lucide-react';
import { Badge, Button, Field, Input, Select, Sheet, useToast } from '../components/ui';
import { Logo } from '../components/AppShell';
import { useRouter, type RouteName } from '../lib/router';
import { api, ErrorApi, sesionActual } from '../lib/api';
import { cx } from '../lib/format';
import { borrarBorrador, descartar, encolar, guardarBorrador, guardarPaquete, leerBorrador, leerPaquete, listar, procesar, reintentar, useCola, type Operacion } from '../campo/cola';
import { comprimirFoto, detenerGps, iniciarGps } from '../campo/medios';
import { formatoGuardado, useImprimir, type DatosImpresion } from '../campo/ManifiestoImpreso';
import { AvisoNotificaciones } from '../components/Notificaciones';

// ---------- Tipos del paquete de campo (/campo/paquete): sin precios ni datos de oficina ----------
interface Etapa { id: string; nombre: string; color: string; orden: number; esFinal: boolean; cancela: boolean; rastreo: boolean }
interface ItemRuta { id: string; solicitudItem: { id: string; estado: string; cantidadEstimada: string | null; solicitud: { numero: number }; declaracion: { nombre: string; codigoInterno: string | null; esPeligroso: boolean } } }
interface Sede {
  id: string; codigo: string | null; nombre: string; direccion: string | null; latitud: string | null; longitud: string | null;
  contacto: string | null; telefono: string | null; celular: string | null; observaciones: string | null;
  atencionLvDesde: string | null; atencionLvHasta: string | null; atencionFdDesde: string | null; atencionFdHasta: string | null;
  municipio: { nombre: string } | null; cliente: { razonSocial: string };
}
interface Parada { id: string; orden: number; estado: 'PENDIENTE' | 'ATENDIDA' | 'NO_ATENDIDA'; sucursalId: string; sucursal: Sede; items: ItemRuta[]; ultimoFirmante: { nombre: string; documento: string } | null }
interface Ruta {
  id: string; codigo: string; fechaProgramada: string; kmInicial: number | null; kmFinal: number | null; vehiculoId: string | null;
  vehiculo: { placa: string; marca: string | null; tipo: string } | null; conductor: { nombre: string } | null; auxiliar: { nombre: string } | null;
  estadoRecorrido: Etapa | null; paradas: Parada[];
}
interface LineaMf {
  id: string; cantidad: string; embalajes: number | null;
  sucursal: { id: string; codigo: string | null; nombre: string; generadorNombre: string | null; generadorNit: string | null };
  declaracion: { nombre: string; esPeligroso: boolean; codigoY: { codigo: string } | null; codigoA: { codigo: string } | null };
  metrica: { abreviacion: string } | null; disposicion: { nombre: string } | null; tipoEmbalaje: { nombre: string } | null; solicitudItem: { id: string; cantidadEstimada: string | null } | null;
}
interface Manifiesto {
  id: string; numero: string; tipo: 'CARGUE' | 'DESCARGUE'; estado: 'PENDIENTE' | 'REALIZADO' | 'ANULADO'; fechaServicio: string; ordenCompra: string | null;
  horaLlegada: string | null; horaSalida: string | null; pesoEntrada: string | null; pesoSalida: string | null; pesoNeto: string | null;
  firmaNombre: string | null; firmaDocumento: string | null; realizadoEn: string | null; observaciones: string | null;
  cliente: { razonSocial: string; nit: string; dv: string | null }; destino: { razonSocial: string }; ruta: { codigo: string } | null;
  vehiculo: { placa: string; tipo: string } | null; conductor: { nombre: string; documento: string | null } | null; auxiliar: { nombre: string } | null;
  evidencias: { tipo: string }[]; items: LineaMf[];
}
interface Elemento { id: string; grupo: string; nombre: string; critico: boolean }
interface Catalogos { etapas: Etapa[]; arl: { id: string; nombre: string }[]; eps: { id: string; nombre: string }[]; causales: { id: string; nombre: string }[] }
interface Inspeccion { id: string; numero: string; vehiculoId: string; aprobado: boolean | null }
/** Lo diligenciado en el teléfono (borrador) y, al grabar, la copia para imprimir sin señal. */
interface Borrador {
  paso: number; cantidades: Record<string, string>; embalajes: Record<string, string>; quitados: Record<string, string>;
  pesoEntrada: string; pesoSalida: string; horaLlegada: string; horaSalida: string;
  firma: string; firmaNombre: string; firmaDocumento: string; otraPersona: boolean; observaciones: string; fotos: number;
}
interface Grabado extends Borrador { grabadoEn: string }
interface Paquete {
  fecha: string; usuarioId: string; actualizado: string; rutaSel: string | null;
  emisor: { razonSocial: string; nit: string; notaBascula: string | null };
  rutas: Ruta[]; manifiestos: Record<string, Manifiesto>; enCola: Record<string, boolean>; grabados: Record<string, Grabado>;
  catalogos: Catalogos; elementos: Elemento[]; inspecciones: Inspeccion[];
}

const hoy = () => new Date().toLocaleDateString('en-CA'); // AAAA-MM-DD en la hora del teléfono
const horaAhora = () => new Date().toTimeString().slice(0, 5);
const isoColombia = (fecha: string, hora: string) => `${fecha.slice(0, 10)}T${hora}:00-05:00`;
const num = (s: string) => Number(s.replace(',', '.'));
const SEL_MF = 'terry-go-mf-sel', SEL_PARADA = 'terry-go-parada-sel';
const horaCorta = (t: string | null) => (t ? t.slice(11, 16) || t.slice(0, 5) : '');

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

/** Descarga la ruta del día, sus manifiestos y las listas (una sola consulta a la puerta de campo) y los guarda en el teléfono. */
async function descargarPaquete(anterior: Paquete | null): Promise<Paquete> {
  const yo = sesionActual()!.usuario, f = hoy();
  const d = await api<{ emisor: Paquete['emisor']; rutas: Ruta[]; manifiestos: Manifiesto[]; catalogos: Catalogos; elementos: Elemento[]; inspecciones: Inspeccion[] }>(`/campo/paquete?fecha=${f}`);
  const mismoDia = anterior?.fecha === f && anterior.usuarioId === yo.id;
  const manifiestos: Record<string, Manifiesto> = Object.fromEntries(d.manifiestos.map((m) => [m.id, m]));
  // Lo grabado en el teléfono que aún no llega al servidor sigue «por enviar»; lo grabado se conserva para imprimir
  const enCola = mismoDia ? Object.fromEntries(Object.entries(anterior.enCola).filter(([id]) => manifiestos[id]?.estado === 'PENDIENTE')) : {};
  const rutaSel = anterior?.rutaSel && d.rutas.some((r) => r.id === anterior.rutaSel) ? anterior.rutaSel : d.rutas[0]?.id ?? null;
  const p: Paquete = { fecha: f, usuarioId: yo.id, actualizado: new Date().toISOString(), rutaSel, emisor: d.emisor, rutas: d.rutas, manifiestos, enCola,
    grabados: mismoDia ? anterior.grabados ?? {} : {}, catalogos: d.catalogos, elementos: d.elementos, inspecciones: d.inspecciones };
  guardarPaquete(p);
  return p;
}

/** Paquete del día compartido por las pantallas de campo. */
function usePaquete() {
  const toast = useToast();
  const [p, setP] = useState<Paquete | null>(() => { const x = leerPaquete<Paquete>(); return x && x.usuarioId === sesionActual()?.usuario.id && x.emisor ? { ...x, grabados: x.grabados ?? {} } : null; });
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

/** La parada de un manifiesto: la que tiene sus líneas de solicitud. */
const paradaDe = (r: Ruta | null, m: Manifiesto) => r?.paradas.find((pa) => pa.items.some((it) => m.items.some((i) => i.solicitudItem?.id === it.solicitudItem.id))) ?? null;
const mfDeParada = (p: Paquete, pa: Parada) => Object.values(p.manifiestos).find((m) => m.items.some((i) => pa.items.some((it) => it.solicitudItem.id === i.solicitudItem?.id)));

/** Datos del manifiesto en papel: lo grabado en el teléfono (sin señal) o, si ya no está, lo que trae el servidor. */
function datosImpresion(p: Paquete, m: Manifiesto, g: Grabado | undefined): DatosImpresion {
  const n = (s: string | null | undefined) => (s ? num(String(s)) : null);
  const entrada = g ? n(g.pesoEntrada) : n(m.pesoEntrada), salida = g ? n(g.pesoSalida) : n(m.pesoSalida);
  const vivos = m.items.filter((i) => !g?.quitados[i.id]);
  return {
    numero: m.numero, fechaServicio: m.fechaServicio, anulado: m.estado === 'ANULADO' ? 'Parada no atendida' : null,
    emisor: p.emisor, cliente: { razonSocial: m.cliente.razonSocial, nit: `${m.cliente.nit}${m.cliente.dv ? `-${m.cliente.dv}` : ''}` },
    destino: m.destino.razonSocial, ruta: m.ruta?.codigo ?? null, ordenCompra: m.ordenCompra,
    transporte: { empresa: p.emisor.razonSocial, nit: p.emisor.nit, placa: m.vehiculo?.placa ?? null, tipoVehiculo: m.vehiculo?.tipo ?? null,
      conductor: m.conductor?.nombre ?? null, conductorDocumento: m.conductor?.documento ?? null, auxiliar: m.auxiliar?.nombre ?? null },
    horaLlegada: g?.horaLlegada ? isoColombia(m.fechaServicio, g.horaLlegada) : m.horaLlegada,
    horaSalida: g?.horaSalida ? isoColombia(m.fechaServicio, g.horaSalida) : m.horaSalida,
    bascula: { entrada, salida, neto: entrada !== null && salida !== null ? Math.round((entrada - salida) * 100) / 100 : n(m.pesoNeto) },
    lineas: vivos.map((i) => {
      const emb = g ? g.embalajes[i.id] : i.embalajes?.toString();
      return {
        generador: i.sucursal.generadorNombre ?? `${i.sucursal.codigo ? `${i.sucursal.codigo} · ` : ''}${i.sucursal.nombre}`, generadorNit: i.sucursal.generadorNit,
        residuo: i.declaracion.nombre, peligroso: i.declaracion.esPeligroso, corrientes: [i.declaracion.codigoY?.codigo, i.declaracion.codigoA?.codigo].filter((x): x is string => !!x),
        cantidad: g ? num(g.cantidades[i.id] ?? '0') : Number(i.cantidad), unidad: i.metrica?.abreviacion ?? 'und',
        embalajes: emb ? `${emb} ${i.tipoEmbalaje?.nombre ?? ''}`.trim() : null, tratamiento: i.disposicion?.nombre ?? '—',
      };
    }),
    noRecogidos: g ? Object.values(g.quitados) : [],
    observaciones: g ? g.observaciones.trim() || null : m.observaciones,
    firma: { nombre: g?.firmaNombre ?? m.firmaNombre, documento: g?.firmaDocumento ?? m.firmaDocumento, imagen: g?.firma || null },
    grabadoEn: g?.grabadoEn ?? m.realizadoEn, copia: 'Copia para el cliente',
  };
}

// ======================= Marco de la app de campo =======================
// Barra inferior del celular (estándar de Mantenimiento): máximo 6 casillas
const NAV: [RouteName, ReactNode, string, RouteName[]][] = [
  ['campo', <Home size={22} />, 'Mi ruta', ['campo-parada']],
  ['campo-preop', <ClipboardCheck size={22} />, 'Inspección', []],
  ['campo-vehiculo', <Truck size={22} />, 'Mi vehículo', []],
  ['campo-envios', <CloudUpload size={22} />, 'Envíos', []],
];

function CampoLayout({ children, title, back, pie }: { children: ReactNode; title?: string; back?: boolean; pie?: ReactNode }) {
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
      <main className={cx('safe-x flex-1 py-4', pie ? 'pb-44' : 'pb-28')}><AvisoNotificaciones />{children}</main>
      {pie && <div className="fixed inset-x-0 bottom-16 z-30 border-t border-line bg-surface/95 backdrop-blur"><div className="safe-x mx-auto max-w-[560px] py-2.5">{pie}</div></div>}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface safe-bottom" aria-label="Navegación de campo">
        <div className="mx-auto grid max-w-[560px]" style={{ gridTemplateColumns: `repeat(${NAV.length}, minmax(0, 1fr))` }}>
          {NAV.map(([r, ic, l, tambien]) => (
            <button key={r} onClick={() => go(r)} className={cx('flex h-16 flex-col items-center justify-center gap-1 text-[12px] font-medium', route === r || tambien.includes(route) ? 'text-brand' : 'text-muted')}>{ic}{l}</button>
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
  const { imprimir, elemento } = useImprimir();
  const [pidiendoKm, setPidiendoKm] = useState<Etapa | null>(null);
  const [km, setKm] = useState('');
  const etapa = ruta?.estadoRecorrido ?? null;

  // GPS solo mientras la ruta esté en una etapa con rastreo
  useEffect(() => { if (ruta && etapa?.rastreo) iniciarGps(ruta.id); else detenerGps(); }, [ruta?.id, etapa?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!p) return <CampoLayout><Vacio cargando={cargando} actualizar={() => actualizar()} texto="Descargue la ruta del día con señal (en planta) para trabajar sin conexión." /></CampoLayout>;
  if (!ruta) return <CampoLayout><Vacio cargando={cargando} actualizar={() => actualizar()} texto="No tiene rutas programadas para hoy." /></CampoLayout>;

  const inspeccion = p.inspecciones.find((i) => i.vehiculoId === ruta.vehiculoId && i.aprobado);
  const siguientes = p.catalogos.etapas.filter((e) => e.orden > (etapa?.orden ?? 0) || (e.esFinal && !etapa?.esFinal));
  const hechos = ruta.paradas.filter((pa) => { const m = mfDeParada(p, pa); return pa.estado === 'NO_ATENDIDA' || (m && (m.estado !== 'PENDIENTE' || p.enCola[m.id])); }).length;

  const cambiarEtapa = async (e: Etapa, kmValor?: number) => {
    const sale = (etapa?.orden ?? 1) <= 1 && e.orden > 1 && !e.esFinal;
    const termina = e.esFinal && !e.cancela;
    const cuerpo = { estadoRecorridoId: e.id, ...(sale && kmValor !== undefined ? { kmInicial: kmValor } : {}), ...(termina && kmValor !== undefined ? { kmFinal: kmValor } : {}) };
    try {
      const r = await enviar({ grupo: `ruta:${ruta.id}`, descripcion: `Etapa «${e.nombre}» · ${ruta.codigo}`, metodo: 'PATCH', ruta: `/campo/rutas/${ruta.id}/estado`, cuerpo });
      cambiar((x) => ({ ...x, rutas: x.rutas.map((rr) => rr.id === ruta.id ? { ...rr, estadoRecorrido: e } : rr) }));
      toast(r.enCola ? `Etapa «${e.nombre}» guardada en el teléfono: se enviará al volver la señal.` : `Etapa «${e.nombre}».`);
    } catch (err) { toast(err instanceof ErrorApi ? err.message : 'No se pudo cambiar la etapa.', 'warn'); }
    setPidiendoKm(null); setKm('');
  };
  const abrirManifiestos = async () => {
    if (!navigator.onLine) { toast('Necesita señal para abrir los manifiestos de la ruta.', 'warn'); return; }
    try { await api(`/campo/rutas/${ruta.id}/manifiestos`, { metodo: 'POST' }); await actualizar(true); toast('Manifiestos listos en el teléfono.'); }
    catch (e) { toast(e instanceof ErrorApi ? e.message : 'No se pudieron crear los manifiestos.', 'warn'); }
  };
  const atender = (pa: Parada, m: Manifiesto) => { sessionStorage.setItem(SEL_MF, m.id); sessionStorage.setItem(SEL_PARADA, pa.id); go('campo-parada'); };

  return (
    <CampoLayout>
      {elemento}
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

      <div className="mb-2 mt-6 flex items-center justify-between"><h2 className="text-[16px] font-semibold">Paradas</h2><span className="num text-[13px] text-muted">{hechos} de {ruta.paradas.length} atendidas</span></div>
      <div className="mb-4 h-2 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-brand transition-all" style={{ width: `${ruta.paradas.length ? (hechos / ruta.paradas.length) * 100 : 0}%` }} /></div>
      {!Object.keys(p.manifiestos).length && ruta.paradas.some((pa) => pa.items.length) && (
        <Button variant="primary" className="mb-3 h-12 w-full rounded-xl" onClick={abrirManifiestos}>Abrir los manifiestos de la ruta</Button>
      )}
      <ol className="flex flex-col gap-3">
        {ruta.paradas.map((pa) => {
          const m = mfDeParada(p, pa);
          const noAtendida = pa.estado === 'NO_ATENDIDA' || m?.estado === 'ANULADO';
          const listo = !noAtendida && m && (m.estado === 'REALIZADO' || p.enCola[m.id]);
          const s = pa.sucursal;
          const destino = s.latitud && s.longitud ? `https://www.google.com/maps/dir/?api=1&destination=${s.latitud},${s.longitud}`
            : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${s.direccion ?? s.nombre} ${s.municipio?.nombre ?? ''}`)}`;
          const tel = s.celular || s.telefono;
          return (
            <li key={pa.id} className={cx('rounded-2xl border bg-surface p-4', listo ? 'border-ok/40' : noAtendida ? 'border-warn/40' : 'border-line')}>
              <div className="flex items-start gap-3">
                <span className={cx('num flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold', listo ? 'bg-ok text-white' : noAtendida ? 'bg-warn text-white' : 'bg-brand-soft text-brand-ink')}>{listo ? <CheckCircle2 size={18} /> : pa.orden}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-snug">{s.cliente.razonSocial}</p>
                  <p className="text-[13px] text-muted"><MapPin size={13} className="mr-1 inline" />{s.codigo ? `${s.codigo} · ` : ''}{s.nombre}{s.direccion ? ` · ${s.direccion}` : ''}{s.municipio ? `, ${s.municipio.nombre}` : ''}</p>
                  <p className="mt-1 text-[13px]">{pa.items.map((it) => it.solicitudItem.declaracion.nombre).join(', ') || 'Sin líneas'}</p>
                  {m && <p className={cx('mt-1 text-[13px] font-medium', listo ? 'text-ok' : noAtendida ? 'text-warn' : 'text-muted')}>
                    Manifiesto {m.numero}{noAtendida ? ' · parada no atendida' : m.estado === 'REALIZADO' ? ' · grabado' : p.enCola[m.id] ? ' · grabado en el teléfono, por enviar' : ''}</p>}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-[1fr_1fr_1.4fr] gap-2">
                <a href={destino} target="_blank" rel="noreferrer" className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-line text-[13px] font-medium"><Navigation size={16} /> Llegar</a>
                {tel ? <a href={`tel:${tel.replace(/[^\d+]/g, '')}`} className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-line text-[13px] font-medium"><Phone size={16} /> Llamar</a>
                  : <span className="flex h-11 items-center justify-center rounded-xl border border-dashed border-line text-[12px] text-subtle">Sin teléfono</span>}
                {listo && m ? (
                  <Button className="h-11 rounded-xl" onClick={() => imprimir(datosImpresion(p, m, p.grabados[m.id]), formatoGuardado())}><Printer size={16} /> Imprimir</Button>
                ) : (
                  <Button variant="primary" className="h-11 rounded-xl" disabled={!m || noAtendida} onClick={() => m && atender(pa, m)}>{noAtendida ? 'No atendida' : 'Atender'}</Button>
                )}
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
  // Fotos por elemento (sobre todo de las fallas) y firma del conductor: se suben al almacenamiento, también sin señal
  const [fotos, setFotos] = useState<Record<string, { blob: Blob; url: string }>>({});
  const [firma, setFirma] = useState('');
  const tomarFoto = async (elementoId: string, archivo?: File) => {
    if (!archivo) return;
    try { const blob = await comprimirFoto(archivo); setFotos((s) => ({ ...s, [elementoId]: { blob, url: URL.createObjectURL(blob) } })); }
    catch { toast('No se pudo leer la foto.', 'warn'); }
  };
  if (!p || !ruta) return <CampoLayout title="Inspección" back><p className="mt-6 text-center text-muted">Primero descargue la ruta del día.</p></CampoLayout>;
  if (!ruta.vehiculoId) return <CampoLayout title="Inspección" back><p className="mt-6 text-center text-muted">La ruta aún no tiene vehículo asignado.</p></CampoLayout>;
  const grupos = [...new Set(p.elementos.map((e) => e.grupo))];
  const faltan = p.elementos.filter((e) => !res[e.id]).length;
  const criticasMal = p.elementos.filter((e) => e.critico && res[e.id] === 'NO_OK');
  const enviarInspeccion = async () => {
    setEnviando(true);
    const id = crypto.randomUUID(); // el mismo id en cada reintento: la inspección no se duplica
    const cuerpo = { id, firma, vehiculoId: ruta.vehiculoId, rutaId: ruta.id, fechaProgramada: hoy(), km: Number(km), observaciones: obs || undefined, respuestas: p.elementos.map((e) => ({ elementoId: e.id, resultado: res[e.id] })) };
    try {
      const r = await enviar<{ id: string; numero: string; aprobado: boolean; fallasCriticas: string[] }>({ grupo: `ruta:${ruta.id}`, descripcion: `Inspección del vehículo ${ruta.vehiculo?.placa ?? ''}`, metodo: 'POST', ruta: '/campo/preoperacionales', cuerpo });
      // Las fotos van después, en orden y en la misma cola (si no hay señal, esperan a la inspección)
      let n = 0;
      for (const [elementoId, f] of Object.entries(fotos)) {
        const el = p.elementos.find((x) => x.id === elementoId);
        await encolar({ grupo: `ruta:${ruta.id}`, descripcion: `Foto de la inspección · ${el?.nombre ?? ''}`, metodo: 'POST', ruta: `/campo/preoperacionales/${id}/fotos`,
          form: { campos: { elementoId }, archivo: f.blob, nombre: `inspeccion-${id.slice(0, 8)}-${++n}.jpg` } });
      }
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
                <div className="mt-2 grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
                  {([['OK', 'Bien'], ['NO_OK', 'Falla'], ['NA', 'No aplica']] as [Res, string][]).map(([v, l]) => (
                    <button key={v} onClick={() => setRes((s) => ({ ...s, [e.id]: v }))} className={cx('h-11 rounded-lg text-[14px] font-semibold ring-1',
                      res[e.id] === v ? (v === 'OK' ? 'bg-ok text-white ring-ok' : v === 'NO_OK' ? 'bg-bad text-white ring-bad' : 'bg-muted text-white ring-muted') : 'ring-line')}>{l}</button>
                  ))}
                  <label className={cx('flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg ring-1', fotos[e.id] ? 'bg-brand-soft text-brand-ink ring-brand' : res[e.id] === 'NO_OK' ? 'text-bad ring-bad' : 'text-muted ring-line')}
                    aria-label={`Foto de ${e.nombre}`} title="Tomar una foto">
                    <Camera size={18} /><input type="file" accept="image/*" capture="environment" className="hidden" onChange={(ev) => tomarFoto(e.id, ev.target.files?.[0])} />
                  </label>
                </div>
                {fotos[e.id] && <img src={fotos[e.id].url} alt={`Foto de ${e.nombre}`} className="mt-2 h-24 w-32 rounded-lg object-cover" />}
                {res[e.id] === 'NO_OK' && !fotos[e.id] && <p className="mt-1.5 text-[12px] text-bad">Tome una foto de la falla.</p>}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <div className="mt-5 flex flex-col gap-3">
        <Field label="Kilometraje actual" id="km-i"><Input id="km-i" inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value.replace(/\D/g, ''))} /></Field>
        <Field label="Observaciones" id="obs-i"><Input id="obs-i" value={obs} maxLength={500} onChange={(e) => setObs(e.target.value)} /></Field>
        {criticasMal.length > 0 && <p className="rounded-xl bg-bad/10 p-3 text-[13px] text-bad">Falla crítica: {criticasMal.map((e) => e.nombre).join(', ')}. La inspección quedará no aprobada.</p>}
        <div><p className="mb-1.5 text-[13px] font-medium">Firma del conductor</p><Firma valor={firma} onChange={setFirma} /></div>
        <Button variant="primary" className="h-12 rounded-xl" disabled={!!faltan || !km || !firma || enviando} onClick={enviarInspeccion}>{faltan ? `Faltan ${faltan} elementos` : !firma ? 'Falta su firma' : enviando ? 'Enviando…' : 'Enviar inspección'}</Button>
      </div>
    </CampoLayout>
  );
}

// ======================= Manifiesto en campo: paso a paso =======================
const PASOS = ['Llegada', 'Residuos', 'Báscula', 'Firma', 'Resumen'] as const;
type Novedad = { tipo: 'ITEM'; itemId: string; residuo: string } | { tipo: 'PARADA' };

export function CampoManifiestoServidor() {
  const { go } = useRouter();
  const toast = useToast();
  const { p, ruta, cambiar } = usePaquete();
  const { imprimir, elemento } = useImprimir();
  const id = sessionStorage.getItem(SEL_MF) ?? '';
  const m = p?.manifiestos[id];
  const parada = p?.rutas.flatMap((r) => r.paradas).find((x) => x.id === sessionStorage.getItem(SEL_PARADA)) ?? (m ? paradaDe(ruta, m) : null);
  const inicial = useMemo<Borrador>(() => leerBorrador<Borrador>(id) ?? {
    paso: 0, cantidades: {}, embalajes: {}, quitados: {}, pesoEntrada: '', pesoSalida: '', horaLlegada: '', horaSalida: '',
    firma: '', firmaNombre: parada?.ultimoFirmante?.nombre ?? '', firmaDocumento: parada?.ultimoFirmante?.documento ?? '', otraPersona: !parada?.ultimoFirmante,
    observaciones: '', fotos: m?.evidencias.filter((e) => e.tipo === 'FOTO').length ?? 0,
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [b, setB] = useState<Borrador>(inicial);
  const [miniaturas, setMiniaturas] = useState<string[]>([]);
  const [novedad, setNovedad] = useState<Novedad | null>(null);
  const [grabando, setGrabando] = useState(false);
  const [grabado, setGrabado] = useState(false);
  const set = (patch: Partial<Borrador>) => setB((x) => { const n = { ...x, ...patch }; guardarBorrador(id, n); return n; });

  if (!p || !m) return <CampoLayout title="Manifiesto" back><p className="mt-6 text-center text-muted">Manifiesto no disponible en el teléfono. Actualice la ruta con señal.</p></CampoLayout>;
  const s = parada?.sucursal;
  const vivos = m.items.filter((i) => !b.quitados[i.id]);
  const unidad = (i: LineaMf) => i.metrica?.abreviacion ?? 'und';
  const estimada = (i: LineaMf) => (i.solicitudItem?.cantidadEstimada ? Number(i.solicitudItem.cantidadEstimada) : null);
  const neto = b.pesoEntrada && b.pesoSalida ? Math.round((num(b.pesoEntrada) - num(b.pesoSalida)) * 100) / 100 : null;
  // Aviso suave (no bloquea): una cantidad muy distinta a lo que estimó el cliente se confirma, no se corrige sola
  const distintas = vivos.filter((i) => { const e = estimada(i), r = num(b.cantidades[i.id] ?? ''); return e && r > 0 && (r > e * 2 || r < e / 2); });

  const listoPaso = [
    !!b.horaLlegada,
    vivos.length > 0 && vivos.every((i) => num(b.cantidades[i.id] ?? '') > 0),
    neto === null || neto >= 0,
    !!b.firma && b.firmaNombre.trim().length >= 3 && b.firmaDocumento.trim().length >= 3,
    !!b.horaSalida && b.horaSalida >= b.horaLlegada,
  ];
  const paso = Math.min(b.paso, PASOS.length - 1);

  const tomarFoto = async (f?: File) => {
    if (!f) return;
    if (b.fotos >= 2) { toast('Ya hay 2 fotos (el máximo).', 'warn'); return; }
    try {
      const blob = await comprimirFoto(f);
      await encolar({ grupo: `mf:${id}`, descripcion: `Foto ${b.fotos + 1} · ${m.numero}`, metodo: 'POST', ruta: `/campo/manifiestos/${id}/evidencias`,
        form: { campos: { tipo: 'FOTO', tomadaEn: new Date().toISOString() }, archivo: blob, nombre: `foto-${m.numero}-${b.fotos + 1}.jpg` } });
      setMiniaturas((x) => [...x, URL.createObjectURL(blob)]);
      set({ fotos: b.fotos + 1 });
      void procesar();
    } catch { toast('No se pudo procesar la foto.', 'warn'); }
  };

  /** Novedad en sitio: un residuo que no se recogió o la parada sin atender. Va a la cola (también sin señal). */
  const reportar = async (n: Novedad, cuerpo: { causalId?: string; nota?: string }, texto: string) => {
    const grupo = `mf:${id}`;
    try {
      if (n.tipo === 'ITEM') {
        await encolar({ grupo, descripcion: `No se recogió ${n.residuo} · ${m.numero}`, metodo: 'POST', ruta: `/campo/manifiestos/${id}/items/${n.itemId}/no-recogido`, cuerpo });
        if (vivos.length === 1 && vivos[0].id === n.itemId) {
          // Era lo único por recoger: el servidor anula el manifiesto y deja la parada como no atendida
          cambiar((x) => ({ ...x, manifiestos: { ...x.manifiestos, [id]: { ...x.manifiestos[id], estado: 'ANULADO' } },
            rutas: x.rutas.map((r) => ({ ...r, paradas: r.paradas.map((pa) => pa.id === parada?.id ? { ...pa, estado: 'NO_ATENDIDA' } : pa) })) }));
          borrarBorrador(id);
          toast('No quedó nada por recoger: la parada queda como no atendida y el coordinador recibe el aviso.');
          go('campo');
        } else {
          set({ quitados: { ...b.quitados, [n.itemId]: `${n.residuo}: ${texto}` } });
          toast('Novedad anotada en el manifiesto. El coordinador recibe el aviso.');
        }
      } else {
        if (!parada) { toast('No se encontró la parada en el teléfono: actualice la ruta.', 'warn'); return; }
        await encolar({ grupo, descripcion: `Parada no atendida · ${s?.nombre ?? ''}`, metodo: 'POST', ruta: `/campo/paradas/${parada.id}/no-atendida`, cuerpo });
        cambiar((x) => ({ ...x, manifiestos: { ...x.manifiestos, [id]: { ...x.manifiestos[id], estado: 'ANULADO' } },
          rutas: x.rutas.map((r) => ({ ...r, paradas: r.paradas.map((pa) => pa.id === parada.id ? { ...pa, estado: 'NO_ATENDIDA' } : pa) })) }));
        borrarBorrador(id);
        toast('Parada marcada como no atendida. El coordinador recibe el aviso.');
        go('campo');
      }
      void procesar();
    } catch { toast('No se pudo guardar la novedad en el teléfono.', 'warn'); }
    setNovedad(null);
  };

  const grabar = async () => {
    setGrabando(true);
    const grupo = `mf:${id}`;
    try {
      for (const i of vivos) {
        const cantidad = num(b.cantidades[i.id]); const embalajes = b.embalajes[i.id] ? Number(b.embalajes[i.id]) : null;
        if (cantidad !== Number(i.cantidad) || embalajes !== i.embalajes)
          await encolar({ grupo, descripcion: `Cantidad de ${i.declaracion.nombre} · ${m.numero}`, metodo: 'PATCH', ruta: `/campo/manifiestos/${id}/items/${i.id}`, cuerpo: { cantidad, embalajes } });
      }
      await encolar({ grupo, descripcion: `Grabar manifiesto ${m.numero}`, metodo: 'POST', ruta: `/campo/manifiestos/${id}/grabar`, cuerpo: {
        firma: b.firma, firmaNombre: b.firmaNombre.trim(), firmaDocumento: b.firmaDocumento.trim(),
        horaLlegada: isoColombia(m.fechaServicio, b.horaLlegada), horaSalida: isoColombia(m.fechaServicio, b.horaSalida),
        ...(b.pesoEntrada ? { pesoEntrada: num(b.pesoEntrada) } : {}), ...(b.pesoSalida ? { pesoSalida: num(b.pesoSalida) } : {}), ...(b.observaciones.trim() ? { observaciones: b.observaciones.trim() } : {}),
      } });
      // Copia de lo grabado en el teléfono: se imprime ya, aun sin señal
      cambiar((x) => ({ ...x, enCola: { ...x.enCola, [id]: true }, grabados: { ...x.grabados, [id]: { ...b, grabadoEn: new Date().toISOString() } } }));
      borrarBorrador(id);
      await procesar();
      const quedan = (await listar()).filter((o) => o.grupo === grupo);
      if (quedan.some((o) => o.error)) toast(`El servidor rechazó el manifiesto: ${quedan.find((o) => o.error)!.error}. Revíselo en «Envíos».`, 'warn');
      else toast(quedan.length ? 'Manifiesto guardado en el teléfono: se enviará al volver la señal.' : `Manifiesto ${m.numero} grabado.`);
      setGrabado(true);
    } catch { toast('No se pudo guardar el manifiesto en el teléfono.', 'warn'); }
    finally { setGrabando(false); }
  };

  // ---- Grabado: imprimir en sitio ----
  if (grabado || p.grabados[id]) {
    const datos = datosImpresion(p, m, p.grabados[id]);
    return (
      <CampoLayout title={`Manifiesto ${m.numero}`} back>
        {elemento}
        <div className="mt-6 flex flex-col items-center gap-3 text-center">
          <CheckCircle2 size={44} className="text-ok" />
          <p className="text-[18px] font-semibold">Manifiesto {m.numero} grabado</p>
          <p className="max-w-[320px] text-[14px] text-muted">Imprima la copia para el cliente. Funciona sin señal: el oficial queda en el servidor con el mismo número.</p>
        </div>
        <div className="mt-6 grid gap-2">
          <Button variant="primary" className="h-12 rounded-xl" onClick={() => imprimir(datos, 'TIQUETE')}><Printer size={18} /> Imprimir tiquete (80 mm)</Button>
          <Button className="h-12 rounded-xl" onClick={() => imprimir(datos, 'CARTA')}><Printer size={18} /> Imprimir en carta</Button>
          <Button variant="ghost" className="h-12 rounded-xl" onClick={() => go('campo')}>Volver a mi ruta</Button>
        </div>
      </CampoLayout>
    );
  }

  const pie = paso < PASOS.length - 1 ? (
    <div className="grid grid-cols-[auto_1fr] gap-2">
      <Button className="h-12 rounded-xl" disabled={paso === 0} onClick={() => set({ paso: paso - 1 })} aria-label="Paso anterior"><ChevronLeft size={18} /></Button>
      <Button variant="primary" className="h-12 rounded-xl text-[15px]" disabled={!listoPaso[paso]} onClick={() => set({ paso: paso + 1 })}>Siguiente: {PASOS[paso + 1]} <ChevronRight size={18} /></Button>
    </div>
  ) : (
    <div className="grid grid-cols-[auto_1fr] gap-2">
      <Button className="h-12 rounded-xl" onClick={() => set({ paso: paso - 1 })} aria-label="Paso anterior"><ChevronLeft size={18} /></Button>
      <Button variant="primary" className="h-12 rounded-xl text-[15px]" disabled={!listoPaso.every(Boolean) || grabando} onClick={grabar}>{grabando ? 'Guardando…' : 'Grabar manifiesto'}</Button>
    </div>
  );

  return (
    <CampoLayout title={`Manifiesto ${m.numero}`} back pie={pie}>
      {/* Avance: un paso por pantalla, cada uno con lo mínimo */}
      <ol className="mb-4 grid grid-cols-5 gap-1" aria-label="Pasos del manifiesto">
        {PASOS.map((t, i) => (
          <li key={t}><button type="button" disabled={i > paso && !listoPaso.slice(0, i).every(Boolean)} onClick={() => set({ paso: i })}
            className={cx('flex w-full flex-col items-center gap-1 text-[11px] font-medium', i === paso ? 'text-brand' : i < paso ? 'text-ok' : 'text-subtle')}>
            <span className={cx('h-1.5 w-full rounded-full', i < paso ? 'bg-ok' : i === paso ? 'bg-brand' : 'bg-line')} />{t}
          </button></li>
        ))}
      </ol>
      <p className="font-semibold leading-snug">{m.cliente.razonSocial}</p>
      <p className="text-[13px] text-muted">{s ? `${s.codigo ? `${s.codigo} · ` : ''}${s.nombre}` : m.items[0]?.sucursal.nombre}</p>

      {paso === 0 && (
        <Seccion titulo="Llegada a la sede" icono={<MapPin size={16} />}>
          {s && (
            <div className="rounded-xl bg-surface p-3 text-[14px] ring-1 ring-line">
              {s.direccion && <p>{s.direccion}{s.municipio ? `, ${s.municipio.nombre}` : ''}</p>}
              {(s.atencionLvDesde || s.atencionFdDesde) && <p className="mt-1 text-[13px] text-muted">Horario: {s.atencionLvDesde ? `L-V ${horaCorta(s.atencionLvDesde)}–${horaCorta(s.atencionLvHasta)}` : ''}{s.atencionFdDesde ? ` · S-D ${horaCorta(s.atencionFdDesde)}–${horaCorta(s.atencionFdHasta)}` : ''}</p>}
              {s.observaciones && <p className="mt-1 text-[13px]">Indicaciones: {s.observaciones}</p>}
              {s.contacto && <p className="mt-1 text-[13px]">Recibe: {s.contacto}{(s.celular || s.telefono) && <a className="ml-2 font-medium text-brand" href={`tel:${(s.celular || s.telefono)!.replace(/[^\d+]/g, '')}`}>Llamar</a>}</p>}
            </div>
          )}
          {b.horaLlegada ? (
            <div className="flex items-center gap-3 rounded-xl bg-ok/10 p-3 text-ok"><CheckCircle2 size={22} />
              <div className="flex-1"><p className="font-semibold">Llegada a las {b.horaLlegada}</p></div>
              <Input type="time" aria-label="Hora de llegada" className="w-[110px]" value={b.horaLlegada} onChange={(e) => set({ horaLlegada: e.target.value })} />
            </div>
          ) : (
            <Button variant="primary" className="h-14 rounded-xl text-[16px]" onClick={() => set({ horaLlegada: horaAhora() })}>Llegué: marcar la hora</Button>
          )}
          <button type="button" onClick={() => setNovedad({ tipo: 'PARADA' })} className="mt-1 flex h-12 items-center justify-center gap-2 rounded-xl border border-warn/40 text-[14px] font-medium text-warn">
            <ShieldAlert size={18} /> No me atendieron (cerrado, sin autorización…)
          </button>
        </Seccion>
      )}

      {paso === 1 && (
        <Seccion titulo="¿Qué se recoge?">
          <p className="text-[13px] text-muted">Anote la cantidad real. Si un residuo no estaba, repórtelo: no pasa nada.</p>
          {vivos.map((i) => {
            const e = estimada(i);
            const emb = Number(b.embalajes[i.id] || 0);
            return (
              <div key={i.id} className="rounded-xl bg-surface p-3 ring-1 ring-line">
                <p className="text-[15px] font-semibold">{i.declaracion.nombre}{i.declaracion.esPeligroso && <span className="ml-2"><Badge tone="warn">RESPEL</Badge></span>}</p>
                <p className="text-[12px] text-muted">{[i.tipoEmbalaje?.nombre, i.disposicion?.nombre].filter(Boolean).join(' · ')}</p>
                <div className="mt-2 grid grid-cols-[1.2fr_1fr] gap-2">
                  <Field label={`Cantidad real (${unidad(i)})`} id={`c-${i.id}`}>
                    <Input id={`c-${i.id}`} inputMode="decimal" className="h-12 text-[18px] font-semibold" placeholder={e ? `Estimó ${e.toLocaleString('es-CO')}` : '0'}
                      value={b.cantidades[i.id] ?? ''} onChange={(ev) => set({ cantidades: { ...b.cantidades, [i.id]: ev.target.value.replace(/[^\d.,]/g, '') } })} />
                  </Field>
                  <div><p className="mb-1.5 text-[13px] font-medium">Embalajes</p>
                    <div className="flex h-12 items-center justify-between rounded-lg ring-1 ring-line">
                      <button type="button" className="flex h-12 w-11 items-center justify-center" aria-label="Uno menos" onClick={() => set({ embalajes: { ...b.embalajes, [i.id]: emb > 0 ? String(emb - 1) : '' } })}><Minus size={18} /></button>
                      <span className="num text-[18px] font-semibold">{emb}</span>
                      <button type="button" className="flex h-12 w-11 items-center justify-center" aria-label="Uno más" onClick={() => set({ embalajes: { ...b.embalajes, [i.id]: String(emb + 1) } })}><Plus size={18} /></button>
                    </div>
                  </div>
                </div>
                <button type="button" onClick={() => setNovedad({ tipo: 'ITEM', itemId: i.id, residuo: i.declaracion.nombre })} className="mt-2 text-[13px] font-medium text-warn underline">No había este residuo / no se recogió</button>
              </div>
            );
          })}
          {Object.values(b.quitados).map((q) => <p key={q} className="rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-muted">No se recogió · {q}</p>)}
          {!vivos.length && (
            <div className="rounded-xl bg-warn/10 p-3 text-[13px] text-warn">No se recogió nada en esta parada.
              <Button className="mt-2 w-full" onClick={() => setNovedad({ tipo: 'PARADA' })}>Marcar la parada como no atendida</Button></div>
          )}
        </Seccion>
      )}

      {paso === 2 && (
        <Seccion titulo="Báscula y fotos de respaldo" icono={<Scale size={16} />}>
          <p className="text-[13px] text-muted">Si en la sede pasa por báscula, anote los pesos (kg). Si no, siga.</p>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Entrada" id="pe"><Input id="pe" inputMode="decimal" value={b.pesoEntrada} onChange={(e) => set({ pesoEntrada: e.target.value.replace(/[^\d.,]/g, '') })} /></Field>
            <Field label="Salida" id="ps"><Input id="ps" inputMode="decimal" value={b.pesoSalida} onChange={(e) => set({ pesoSalida: e.target.value.replace(/[^\d.,]/g, '') })} /></Field>
            <Field label="Neto" id="pn"><Input id="pn" readOnly value={neto === null ? '' : neto.toLocaleString('es-CO')} className="bg-surface-2" /></Field>
          </div>
          {neto !== null && neto < 0 && <p className="text-[13px] text-bad">La salida pesa más que la entrada: revise los pesos.</p>}
          <div className="flex gap-2">{miniaturas.map((u) => <img key={u} src={u} alt="Foto de respaldo" className="h-20 w-20 rounded-lg object-cover ring-1 ring-line" />)}</div>
          {b.fotos < 2 ? (
            <label className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-line text-[14px] font-medium">
              <Camera size={18} /> Foto de la báscula o de la carga ({b.fotos} de 2)
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { void tomarFoto(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
          ) : <p className="text-[13px] text-ok">2 fotos de respaldo tomadas.</p>}
        </Seccion>
      )}

      {paso === 3 && (
        <Seccion titulo="Firma de quien entrega">
          {!b.otraPersona && b.firmaNombre ? (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-surface p-3 ring-1 ring-line">
              <div><p className="text-[15px] font-semibold">{b.firmaNombre}</p><p className="text-[13px] text-muted">CC {b.firmaDocumento}</p></div>
              <button type="button" className="text-[13px] font-medium text-brand underline" onClick={() => set({ otraPersona: true, firmaNombre: '', firmaDocumento: '' })}>Es otra persona</button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Nombre" id="fn"><Input id="fn" value={b.firmaNombre} maxLength={150} onChange={(e) => set({ firmaNombre: e.target.value })} /></Field>
              <Field label="Cédula" id="fd"><Input id="fd" inputMode="numeric" value={b.firmaDocumento} maxLength={20} onChange={(e) => set({ firmaDocumento: e.target.value })} /></Field>
            </div>
          )}
          <Firma valor={b.firma} onChange={(v) => set({ firma: v })} />
          <Field label="Observaciones (opcional)" id="mo"><Input id="mo" value={b.observaciones} maxLength={1500} onChange={(e) => set({ observaciones: e.target.value })} /></Field>
        </Seccion>
      )}

      {paso === 4 && (
        <Seccion titulo="Revise y grabe">
          <div className="rounded-xl bg-surface p-3 text-[14px] ring-1 ring-line">
            <p>Llegada: <b>{b.horaLlegada}</b></p>
            {vivos.map((i) => <p key={i.id}>{i.declaracion.nombre}: <b className="num">{num(b.cantidades[i.id] ?? '0').toLocaleString('es-CO')} {unidad(i)}</b>{b.embalajes[i.id] ? ` · ${b.embalajes[i.id]} embalajes` : ''}</p>)}
            {Object.values(b.quitados).map((q) => <p key={q} className="text-muted">No se recogió · {q}</p>)}
            {neto !== null && <p>Báscula: neto <b className="num">{neto.toLocaleString('es-CO')} kg</b></p>}
            <p>Fotos de respaldo: {b.fotos}</p>
            <p>Firma: {b.firmaNombre} · CC {b.firmaDocumento}</p>
          </div>
          {distintas.map((i) => (
            <p key={i.id} className="rounded-xl bg-warn/10 p-3 text-[13px] text-warn">{i.declaracion.nombre}: anotó {num(b.cantidades[i.id]).toLocaleString('es-CO')} {unidad(i)} y el cliente estimó {estimada(i)!.toLocaleString('es-CO')}. Si es lo real, está bien: grábelo así.</p>
          ))}
          {b.fotos === 0 && <p className="rounded-xl bg-info/10 p-3 text-[13px] text-info">Sin foto de respaldo. Puede tomarla en el paso «Báscula».</p>}
          {b.horaSalida ? (
            <div className="flex items-center gap-3 rounded-xl bg-ok/10 p-3 text-ok"><CheckCircle2 size={22} /><p className="flex-1 font-semibold">Salida a las {b.horaSalida}</p>
              <Input type="time" aria-label="Hora de salida" className="w-[110px]" value={b.horaSalida} onChange={(e) => set({ horaSalida: e.target.value })} /></div>
          ) : (
            <Button variant="primary" className="h-14 rounded-xl text-[16px]" onClick={() => set({ horaSalida: horaAhora() })}>Marcar la hora de salida</Button>
          )}
          {b.horaSalida && b.horaSalida < b.horaLlegada && <p className="text-[13px] text-bad">La salida no puede ser antes de la llegada ({b.horaLlegada}).</p>}
          <p className="text-center text-[12px] text-subtle">Al grabar ya no se puede modificar. Funciona sin señal: se envía solo al recuperarla.</p>
        </Seccion>
      )}

      <HojaNovedad novedad={novedad} causales={p.catalogos.causales ?? []} alCerrar={() => setNovedad(null)} alConfirmar={reportar} />
    </CampoLayout>
  );
}

/** Reportar una novedad con un toque: la causal de la lista o qué pasó en pocas palabras. Sin castigo. */
function HojaNovedad({ novedad, causales, alCerrar, alConfirmar }: {
  novedad: Novedad | null; causales: { id: string; nombre: string }[]; alCerrar: () => void;
  alConfirmar: (n: Novedad, cuerpo: { causalId?: string; nota?: string }, texto: string) => void;
}) {
  const [causalId, setCausalId] = useState('');
  const [nota, setNota] = useState('');
  useEffect(() => { setCausalId(''); setNota(''); }, [novedad]);
  if (!novedad) return null;
  const causal = causales.find((c) => c.id === causalId);
  const texto = [causal?.nombre, nota.trim()].filter(Boolean).join(' · ');
  return (
    <Sheet open onClose={alCerrar} title={novedad.tipo === 'ITEM' ? `No se recogió: ${novedad.residuo}` : 'Parada no atendida'}
      footer={<Button variant="primary" className="h-12 w-full rounded-xl" disabled={!causalId && nota.trim().length < 3} onClick={() => alConfirmar(novedad, { ...(causalId ? { causalId } : {}), ...(nota.trim() ? { nota: nota.trim() } : {}) }, texto)}>Reportar</Button>}>
      <p className="mb-3 text-[13px] text-muted">{novedad.tipo === 'ITEM' ? 'Queda escrito en el manifiesto y el coordinador lo reprograma si hace falta.' : 'El manifiesto de esta parada se anula con el motivo y el coordinador recibe el aviso.'}</p>
      <div className="flex flex-col gap-2">
        {causales.map((c) => (
          <button key={c.id} type="button" onClick={() => setCausalId(c.id === causalId ? '' : c.id)}
            className={cx('flex min-h-12 items-center rounded-xl px-3 text-left text-[14px] font-medium ring-1', c.id === causalId ? 'bg-brand-soft text-brand-ink ring-brand' : 'ring-line')}>{c.nombre}</button>
        ))}
        <Field label={causales.length ? 'O escriba qué pasó' : 'Qué pasó'} id="nov-nota"><Input id="nov-nota" value={nota} maxLength={300} onChange={(e) => setNota(e.target.value)} placeholder="Ej.: la portería no autorizó el ingreso" /></Field>
      </div>
    </Sheet>
  );
}

function Seccion({ titulo, icono, children }: { titulo: string; icono?: ReactNode; children: ReactNode }) {
  return <section className="mt-4"><h2 className="mb-2 flex items-center gap-1.5 text-[16px] font-semibold">{icono}{titulo}</h2><div className="flex flex-col gap-2.5">{children}</div></section>;
}

/** Firma táctil: se guarda como imagen PNG (fondo transparente, trazo oscuro). */
export function Firma({ valor, onChange }: { valor: string; onChange: (dataUrl: string) => void }) {
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

// ======================= Mi vehículo: mantenimiento en solo lectura =======================
interface MiVehiculo {
  vehiculo: { id: string; placa: string; marca: string | null; tipo: string; soatVence: string | null; rtmVence: string | null; polizaRcVence: string | null } | null;
  inspecciones: { id: string; numero: string; fechaProgramada: string; aprobado: boolean | null; km: number | null; observaciones: string | null; conductor: { nombre: string } | null; fallas: { nombre: string; critico: boolean }[] }[];
}
const MI_VEHICULO = 'terry-go-mi-vehiculo';

/** «Todos somos supervisores» en mantenimiento (gerencia, 20-11-2026): vencimientos e inspecciones del vehículo, solo para consultar. */
export function CampoVehiculoServidor() {
  const toast = useToast();
  const [d, setD] = useState<MiVehiculo | null>(() => { try { return JSON.parse(localStorage.getItem(MI_VEHICULO) ?? 'null') as MiVehiculo | null; } catch { return null; } });
  const [cargando, setCargando] = useState(false);
  const cargar = async (silencioso = false) => {
    if (!navigator.onLine) { if (!silencioso) toast('Sin señal: se muestra la última consulta guardada.', 'warn'); return; }
    setCargando(true);
    try { const x = await api<MiVehiculo>(`/campo/mi-vehiculo?fecha=${hoy()}`); setD(x); try { localStorage.setItem(MI_VEHICULO, JSON.stringify(x)); } catch { /* sin espacio */ } }
    catch (e) { if (!silencioso) toast(e instanceof ErrorApi ? e.message : 'No se pudo consultar.', 'warn'); }
    finally { setCargando(false); }
  };
  useEffect(() => { void cargar(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const vence = (f: string | null, nombre: string) => {
    if (!f) return <li className="flex items-center justify-between rounded-xl bg-surface p-3 ring-1 ring-line"><span>{nombre}</span><Badge tone="neutral">Sin fecha</Badge></li>;
    const dias = Math.round((new Date(`${f.slice(0, 10)}T00:00:00`).getTime() - new Date(`${hoy()}T00:00:00`).getTime()) / 86_400_000);
    const fecha = f.slice(0, 10).split('-').reverse().join('/');
    return (
      <li className="flex items-center justify-between rounded-xl bg-surface p-3 ring-1 ring-line"><span>{nombre}</span>
        {dias < 0 ? <Badge tone="bad">Vencido el {fecha}</Badge> : dias <= 30 ? <Badge tone="warn">Vence en {dias} días</Badge> : <Badge tone="ok">Al día hasta {fecha}</Badge>}</li>
    );
  };
  return (
    <CampoLayout title="Mi vehículo">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] text-muted">Solo consulta. Para reportar una falla, hágalo en la inspección o avise al coordinador.</p>
        <button onClick={() => cargar()} disabled={cargando} className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] text-muted ring-1 ring-line" aria-label="Actualizar"><RefreshCw size={15} className={cx(cargando && 'animate-spin')} /></button>
      </div>
      {!d?.vehiculo ? (
        <p className="mt-8 text-center text-muted">{cargando ? 'Consultando…' : 'No tiene un vehículo asignado en sus rutas.'}</p>
      ) : (
        <>
          <div className="mt-4 rounded-2xl bg-surface p-4 ring-1 ring-line">
            <p className="num text-[22px] font-bold">{d.vehiculo.placa}</p>
            <p className="text-[13px] text-muted">{[d.vehiculo.tipo, d.vehiculo.marca].filter(Boolean).join(' · ')}</p>
          </div>
          <Seccion titulo="Documentos">
            <ul className="flex flex-col gap-2">{vence(d.vehiculo.soatVence, 'SOAT')}{vence(d.vehiculo.rtmVence, 'Revisión técnico-mecánica')}{vence(d.vehiculo.polizaRcVence, 'Póliza de responsabilidad civil')}</ul>
          </Seccion>
          <Seccion titulo="Últimas inspecciones">
            {!d.inspecciones.length && <p className="text-[13px] text-muted">Aún no hay inspecciones.</p>}
            <ul className="flex flex-col gap-2">
              {d.inspecciones.map((i) => (
                <li key={i.id} className="rounded-xl bg-surface p-3 ring-1 ring-line">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[14px] font-medium">{i.fechaProgramada.slice(0, 10).split('-').reverse().join('/')} · {i.numero}</p>
                    {i.aprobado === false ? <Badge tone="bad">No aprobada</Badge> : i.aprobado ? <Badge tone="ok">Aprobada</Badge> : <Badge tone="neutral">Pendiente</Badge>}
                  </div>
                  <p className="text-[12px] text-muted">{i.conductor?.nombre ?? ''}{i.km ? ` · ${i.km.toLocaleString('es-CO')} km` : ''}</p>
                  {i.fallas.length > 0 && <p className="mt-1 text-[13px] text-bad">Fallas: {i.fallas.map((f) => `${f.nombre}${f.critico ? ' (crítica)' : ''}`).join(', ')}</p>}
                  {i.observaciones && <p className="mt-1 text-[13px]">{i.observaciones}</p>}
                </li>
              ))}
            </ul>
          </Seccion>
        </>
      )}
    </CampoLayout>
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

