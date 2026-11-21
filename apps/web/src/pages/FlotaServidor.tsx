// Flota e inspecciones vehiculares con datos reales (fase 1c).
// - Inspecciones: vista de oficina de los preoperacionales que diligencian los conductores en la app de campo.
// - Flota: vehículos con sus vencimientos (SOAT, revisión técnico-mecánica, póliza), crear y editar; nada se borra.
import { useState, type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Loader2, Pencil, Plus, RefreshCw, Satellite, Smartphone, XCircle } from 'lucide-react';
import { ResponsiveTable, FilterBar, type Column } from '../components/data';
import { Badge, Button, Card, ColorBadge, DefList, Field, Input, PageHeader, Select, Sheet, useToast } from '../components/ui';
import { api, ErrorApi, tienePermiso } from '../lib/api';
import { ImagenProtegida, PieLista, fechaHoraCo, hoyCo, useApi, usePaginado } from '../lib/servidor';
import { useRouter } from '../lib/router';
import { cx, diasEntre, fmtFecha, fmtNum } from '../lib/format';
import { hace, type EstadoGps } from '../components/gps';

interface Vehiculo {
  id: string; placa: string; marca: string | null; color: string; tipo: string; capacidad: string; unidadCap: string; volumenM3: string | null; activo: boolean;
  soatVence: string | null; rtmVence: string | null; polizaRcVence: string | null; proveedor: { id: string; razonSocial: string } | null;
}
interface Inspeccion {
  id: string; numero: string; fechaProgramada: string; fechaReal: string | null; aprobado: boolean | null; km: number | null; observaciones: string | null;
  vehiculo: { placa: string; color: string; tipo: string }; conductor: { nombre: string }; auxiliar: { nombre: string } | null; ruta: { codigo: string } | null; _count: { respuestas: number };
}
interface InspeccionDetalle extends Omit<Inspeccion, '_count'> {
  firmaUrl: string | null;
  respuestas: { resultado: 'OK' | 'NO_OK' | 'NA'; observacion: string | null; fotoUrl: string | null; elemento: { grupo: string; nombre: string; critico: boolean } }[];
}
const UNIDAD: Record<string, string> = { KG: 'kg', TON: 't', M3: 'm³', GAL: 'gal', L: 'L', UND: 'und' };
const TIPOS = ['Furgón', 'Furgón RESPEL', 'Camión estacas', 'Volqueta', 'Carrotanque / vactor', 'Camioneta', 'Tractocamión'];
const fecha = (iso: string | null) => (iso ? fmtFecha(iso.slice(0, 10)) : '—');
function mensajeError(e: unknown, def: string) {
  if (!(e instanceof ErrorApi)) return def;
  const d = (e.datos as { detalles?: { campo: string; mensaje: string }[] } | undefined)?.detalles;
  return d?.length ? d.map((x) => x.mensaje).join(' · ') : e.message;
}
/** Vencimiento de un documento con su alerta (el sistema avisa 30 días antes). */
function Vence({ f }: { f: string | null }) {
  if (!f) return <span className="text-bad">Sin fecha</span>;
  const d = diasEntre(hoyCo(), f.slice(0, 10));
  return (
    <span className="flex flex-col">
      <span className="num whitespace-nowrap">{fecha(f)}</span>
      {d < 0 ? <span className="text-[11px] font-medium text-bad">vencido hace {-d} días</span> : d <= 30 ? <span className={cx('text-[11px] font-medium', d <= 15 ? 'text-bad' : 'text-warn')}>vence en {d} días</span> : null}
    </span>
  );
}
const Resultado = ({ a }: { a: boolean | null }) => (a === null ? <Badge tone="warn"><Clock size={12} /> Pendiente</Badge> : a ? <Badge tone="ok"><CheckCircle2 size={12} /> Aprobada</Badge> : <Badge tone="bad"><XCircle size={12} /> No aprobada</Badge>);

// ---------------------------- INSPECCIONES ----------------------------
export function InspeccionesServidor() {
  const { go } = useRouter();
  const hoy = hoyCo();
  const vacio = { desde: `${hoy.slice(0, 8)}01`, hasta: hoy, vehiculoId: '', resultado: '' };
  const [f, setF] = useState(vacio);
  const vehiculos = useApi<Vehiculo[]>('/vehiculos');
  const qs = new URLSearchParams({ desde: f.desde, hasta: f.hasta, ...(f.vehiculoId && { vehiculoId: f.vehiculoId }), ...(f.resultado && { resultado: f.resultado }) }).toString();
  const lista = usePaginado<Inspeccion>(f.desde && f.hasta ? `/inspecciones?${qs}` : null);
  const resumen = useApi<{ resumen: { aprobadas: number; noAprobadas: number; pendientes: number } }>(f.desde && f.hasta ? `/inspecciones?${qs}&porPagina=1` : null);
  const [sel, setSel] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const cols: Column<Inspeccion>[] = [
    { key: 'f', header: 'Fecha', render: (p) => <span className="flex flex-col"><span className="num font-medium">{fecha(p.fechaProgramada)}</span><span className="text-[12px] text-muted">{p.fechaReal ? fechaHoraCo(p.fechaReal) : 'sin diligenciar'}</span></span>, priority: 3 },
    { key: 'v', header: 'Vehículo', render: (p) => <ColorBadge color={p.vehiculo.color}>{p.vehiculo.placa}</ColorBadge>, priority: 3 },
    { key: 'r', header: 'Resultado', render: (p) => <Resultado a={p.aprobado} />, priority: 3 },
    { key: 'c', header: 'Inspeccionó', render: (p) => p.conductor.nombre, priority: 2 },
    { key: 'ru', header: 'Ruta', render: (p) => <span className="num text-muted">{p.ruta?.codigo ?? '—'}</span>, priority: 1 },
    { key: 'k', header: 'Km', align: 'right', render: (p) => (p.km !== null ? fmtNum(p.km) : '—'), priority: 1 },
    { key: 'n', header: 'Novedades', render: (p) => <span className="block max-w-[280px] truncate text-muted">{p._count.respuestas ? `${p._count.respuestas} ítems no OK` : ''}{p._count.respuestas && p.observaciones ? ' · ' : ''}{p.observaciones ?? (p._count.respuestas ? '' : '—')}</span>, priority: 2 },
  ];
  const r = resumen.datos?.resumen;
  return (
    <>
      <PageHeader eyebrow="Campo y HSEQ" title="Inspecciones vehiculares" subtitle="Inspección diaria antes de salir (PESV, Res. 40595 de 2022). La diligencia el conductor en la app de campo; un ítem crítico no aprobado impide que la ruta salga."
        actions={<Button onClick={() => go('campo')}><Smartphone size={16} /> Abrir el Portal Logístico</Button>} />
      <FilterBar active={[f.vehiculoId, f.resultado].filter(Boolean).length + Number(f.desde !== vacio.desde || f.hasta !== vacio.hasta)} onClear={() => setF(vacio)}>
        <Field label="Desde" id="in-d"><Input id="in-d" type="date" value={f.desde} max={f.hasta} onChange={set('desde')} /></Field>
        <Field label="Hasta" id="in-h"><Input id="in-h" type="date" value={f.hasta} min={f.desde} onChange={set('hasta')} /></Field>
        <Field label="Vehículo" id="in-v"><Select id="in-v" value={f.vehiculoId} onChange={set('vehiculoId')}><option value="">Todos</option>{(vehiculos.datos ?? []).map((v) => <option key={v.id} value={v.id}>{v.placa} · {v.tipo}</option>)}</Select></Field>
        <Field label="Resultado" id="in-r"><Select id="in-r" value={f.resultado} onChange={set('resultado')}><option value="">Todos</option><option value="aprobada">Aprobada</option><option value="no-aprobada">No aprobada</option><option value="pendiente">Pendiente</option></Select></Field>
      </FilterBar>
      {r && (
        <div className="mb-4 grid grid-cols-3 gap-3">
          <Card><p className="text-[12px] text-muted">Aprobadas</p><p className="num font-display text-2xl font-semibold text-ok">{r.aprobadas}</p></Card>
          <Card><p className="text-[12px] text-muted">No aprobadas</p><p className={cx('num font-display text-2xl font-semibold', r.noAprobadas ? 'text-bad' : '')}>{r.noAprobadas}</p></Card>
          <Card><p className="text-[12px] text-muted">Pendientes</p><p className="num font-display text-2xl font-semibold">{r.pendientes}</p></Card>
        </div>
      )}
      {lista.error ? <p className="rounded-xl bg-bad/10 p-4 text-bad">{lista.error}</p>
        : !lista.filas ? <p className="p-6 text-center text-muted">Cargando…</p>
        : <ResponsiveTable rows={lista.filas} columns={cols} rowKey={(p) => p.id} onRowClick={(p) => setSel(p.id)} cardTitle={(p) => `${p.vehiculo.placa} · ${fecha(p.fechaProgramada)}`}
            cardBadge={(p) => <Resultado a={p.aprobado} />} cardMeta={(p) => `${p.conductor.nombre}${p.ruta ? ` · ${p.ruta.codigo}` : ''}${p._count.respuestas ? ` · ${p._count.respuestas} no OK` : ''}`}
            footer={<PieLista mostradas={lista.filas.length} total={lista.total} hayMas={lista.hayMas} cargando={lista.cargando} cargarMas={lista.cargarMas} />}
            empty="No hay inspecciones en ese periodo con estos filtros." />}
      <Sheet open={!!sel} onClose={() => setSel(null)} title="Inspección vehicular">{sel && <DetalleInspeccion id={sel} />}</Sheet>
    </>
  );
}

function DetalleInspeccion({ id }: { id: string }) {
  const { datos: p, error } = useApi<InspeccionDetalle>(`/inspecciones/${id}`);
  if (error) return <p className="text-bad">{error}</p>;
  if (!p) return <p className="flex items-center gap-2 text-muted"><Loader2 size={16} className="animate-spin" />Cargando…</p>;
  const grupos = [...new Set(p.respuestas.map((x) => x.elemento.grupo))];
  const fallas = p.respuestas.filter((x) => x.resultado === 'NO_OK');
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2"><ColorBadge color={p.vehiculo.color}>{p.vehiculo.placa}</ColorBadge><Resultado a={p.aprobado} /></div>
      <DefList items={[
        ['N.º', <span className="num">{p.numero || '—'}</span>], ['Programada', fecha(p.fechaProgramada)], ['Diligenciada', p.fechaReal ? fechaHoraCo(p.fechaReal) : '—'],
        ['Conductor', p.conductor.nombre], ['Auxiliar', p.auxiliar?.nombre ?? '—'], ['Ruta', p.ruta?.codigo ?? '—'], ['Kilometraje', p.km !== null ? fmtNum(p.km) : '—'],
        ['Observaciones', p.observaciones ?? '—'],
      ]} />
      {fallas.length > 0 && (
        <div className="rounded-lg bg-bad/10 p-3 text-[13px] text-bad">
          <p className="flex items-center gap-1.5 font-medium"><AlertTriangle size={15} /> {fallas.length} {fallas.length === 1 ? 'ítem no aprobado' : 'ítems no aprobados'}</p>
          <ul className="mt-1 list-disc pl-5">{fallas.map((x) => <li key={x.elemento.nombre}>{x.elemento.nombre}{x.elemento.critico ? ' (crítico: la ruta no sale)' : ''}{x.observacion ? `: ${x.observacion}` : ''}</li>)}</ul>
        </div>
      )}
      {p.firmaUrl && <div><p className="mb-1 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">Firma del conductor</p><ImagenProtegida clave={p.firmaUrl} alt="Firma del conductor" className="h-20 w-56 rounded-lg border border-line bg-white object-contain" /></div>}
      {grupos.map((g) => (
        <div key={g}>
          <p className="mb-1 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">{g}</p>
          <ul className="divide-y divide-line rounded-lg border border-line text-[13px]">
            {p.respuestas.filter((x) => x.elemento.grupo === g).map((x) => (
              <li key={x.elemento.nombre} className="flex flex-col gap-1.5 px-3 py-1.5">
                <span className="flex items-center justify-between gap-2">
                  <span className="min-w-0">{x.elemento.nombre}{x.elemento.critico && <span className="ml-1.5 text-[11px] text-warn">crítico</span>}</span>
                  <Badge tone={x.resultado === 'OK' ? 'ok' : x.resultado === 'NO_OK' ? 'bad' : 'neutral'}>{x.resultado === 'NO_OK' ? 'No OK' : x.resultado === 'NA' ? 'No aplica' : 'OK'}</Badge>
                </span>
                {x.fotoUrl && <ImagenProtegida clave={x.fotoUrl} alt={`Foto de ${x.elemento.nombre}`} className="h-32 w-44 rounded-lg border border-line object-cover" />}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ---------------------------- FLOTA ----------------------------
export function FlotaServidor() {
  const { go } = useRouter();
  const toast = useToast();
  const puede = tienePermiso('rutas.programar');
  const vehiculos = useApi<Vehiculo[]>('/vehiculos');
  const [panel, setPanel] = useState<null | { id?: string }>(null);
  // GPS de Wialon: estado de la conexión, unidades de la cuenta y la unidad de cada vehículo
  const gps = useApi<EstadoGps>(puede ? '/gps/estado' : null);
  const [actualizando, setActualizando] = useState(false);
  const actualizar = async () => {
    setActualizando(true);
    try {
      const r = await api<{ unidades: number; enlazadas: number; omitido?: boolean }>('/gps/actualizar', { cuerpo: {} });
      toast(r.omitido ? 'Wialon se está consultando en este momento: en un minuto verá los datos.' : `Wialon respondió: ${r.unidades} ${r.unidades === 1 ? 'unidad' : 'unidades'}${r.enlazadas ? `, ${r.enlazadas} enlazada${r.enlazadas === 1 ? '' : 's'} por la placa` : ''}.`, 'ok');
    } catch (e) { toast(mensajeError(e, 'No se pudo consultar Wialon.'), 'warn'); }
    gps.recargar();
    setActualizando(false);
  };
  const g = gps.datos?.configurado ? gps.datos : null;
  const activos = (vehiculos.datos ?? []).filter((v) => v.activo);
  const hoy = hoyCo();
  const porVencer = activos.filter((v) => [v.soatVence, v.rtmVence, v.polizaRcVence].some((f) => !f || diasEntre(hoy, f.slice(0, 10)) <= 30)).length;
  const cols: Column<Vehiculo>[] = [
    { key: 'p', header: 'Placa', render: (v) => <ColorBadge color={v.color}>{v.placa}</ColorBadge>, priority: 3 },
    { key: 'm', header: 'Marca', render: (v) => v.marca ?? '—', priority: 1 },
    { key: 't', header: 'Tipo', render: (v) => v.tipo, priority: 3 },
    { key: 'c', header: 'Capacidad', align: 'right', render: (v) => `${fmtNum(Number(v.capacidad))} ${UNIDAD[v.unidadCap] ?? v.unidadCap}`, priority: 2 },
    { key: 'pr', header: 'Propietario', render: (v) => (v.proveedor ? <span className="block max-w-[160px] truncate">{v.proveedor.razonSocial}</span> : 'Propio'), priority: 1 },
    { key: 's', header: 'SOAT', render: (v) => <Vence f={v.soatVence} />, priority: 2 },
    { key: 'r', header: 'Revisión técnico-mecánica', render: (v) => <Vence f={v.rtmVence} />, priority: 2 },
    { key: 'po', header: 'Póliza RC', render: (v) => <Vence f={v.polizaRcVence} />, priority: 1 },
    ...(g ? [{ key: 'g', header: 'GPS (Wialon)', priority: 2, render: (v: Vehiculo) => {
      const x = g.vehiculos.find((y) => y.id === v.id);
      return x?.unidadId
        ? <span className="block max-w-[180px] text-[13px]"><span className="block truncate">{x.unidadNombre ?? `Unidad ${x.unidadId}`}</span><span className="text-[12px] text-muted">{x.posicion ? `Posición ${hace(x.posicion.posicionEn)}` : 'Sin posición todavía'}</span></span>
        : <Badge tone="neutral">Sin enlazar</Badge>;
    } } as Column<Vehiculo>] : []),
    { key: 'e', header: 'Estado', render: (v) => <Badge tone={v.activo ? 'ok' : 'neutral'}>{v.activo ? 'Activo' : 'Inactivo'}</Badge>, priority: 2 },
  ];
  return (
    <>
      <PageHeader eyebrow="Ajustes" title="Flota" subtitle="Vehículos con su color en la programación y el control de vencimientos: el sistema avisa 30 días antes. Nada se borra: un vehículo se inactiva."
        actions={<><Button onClick={() => go('importar')}>Importar</Button>{puede && <Button variant="primary" onClick={() => setPanel({})}><Plus size={16} /> Nuevo vehículo</Button>}</>} />
      {g && (() => {
        const enlazados = g.vehiculos.filter((v) => v.unidadId).length;
        const tono = g.conectado ? 'bg-ok/10 text-ok' : g.ultimoOk || g.fallosSeguidos ? 'bg-warn/10 text-warn' : 'bg-surface-2 text-muted';
        return (
          <div className={cx('mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-2.5 text-[13px]', tono)}>
            <span className="flex items-start gap-2"><Satellite size={16} className="mt-px shrink-0" />
              {g.conectado ? `GPS de Wialon conectado: ${g.unidades.length} ${g.unidades.length === 1 ? 'unidad' : 'unidades'} en la cuenta, ${enlazados} ${enlazados === 1 ? 'enlazada' : 'enlazadas'} a vehículos. Posiciones ${hace(g.ultimoOk)}.`
                : g.ultimoOk || g.fallosSeguidos ? `Wialon no responde${g.ultimoOk ? ` desde hace ${hace(g.ultimoOk).replace('hace ', '')}` : ''}: ${g.error ?? 'sin respuesta'} La operación sigue con las etapas del conductor.`
                : 'Conectando con Wialon: en un minuto aparecen las unidades y las posiciones.'}</span>
            <Button size="sm" disabled={actualizando} onClick={actualizar}><RefreshCw size={14} className={actualizando ? 'animate-spin' : ''} /> Actualizar ahora</Button>
          </div>
        );
      })()}
      {vehiculos.datos && porVencer > 0 && <p className="mb-3 flex items-start gap-2 rounded-xl bg-warn/10 px-4 py-2.5 text-[13px] text-warn"><AlertTriangle size={16} className="mt-px shrink-0" />{porVencer} {porVencer === 1 ? 'vehículo activo tiene' : 'vehículos activos tienen'} un documento vencido, por vencer en 30 días o sin fecha registrada.</p>}
      {vehiculos.error ? <p className="rounded-xl bg-bad/10 p-4 text-bad">{vehiculos.error}</p>
        : !vehiculos.datos ? <p className="p-6 text-center text-muted">Cargando…</p>
        : <ResponsiveTable rows={vehiculos.datos} columns={cols} rowKey={(v) => v.id} onRowClick={puede ? (v) => setPanel({ id: v.id }) : undefined}
            cardTitle={(v) => <span className="num">{v.placa} · {v.tipo}</span>} cardBadge={(v) => <Badge tone={v.activo ? 'ok' : 'neutral'}>{v.activo ? 'Activo' : 'Inactivo'}</Badge>}
            cardMeta={(v) => `SOAT ${fecha(v.soatVence)} · RTM ${fecha(v.rtmVence)}`} empty="No hay vehículos. Créelos aquí o impórtelos desde Excel." />}
      <Sheet open={!!panel} onClose={() => setPanel(null)} title={panel?.id ? 'Editar vehículo' : 'Nuevo vehículo'}>
        {panel && <FormVehiculo v={panel.id ? vehiculos.datos?.find((x) => x.id === panel.id) : undefined} gps={g} listo={() => { setPanel(null); vehiculos.recargar(); gps.recargar(); }} />}
      </Sheet>
    </>
  );
}

function FormVehiculo({ v, gps, listo }: { v?: Vehiculo; gps?: EstadoGps | null; listo: () => void }) {
  const toast = useToast();
  const actual = v ? gps?.vehiculos.find((x) => x.id === v.id) : undefined;
  const unidadAntes = actual?.unidadId ? String(actual.unidadId) : '';
  const [unidad, setUnidad] = useState(unidadAntes);
  const transportadores = useApi<{ id: string; razonSocial: string; nit: string }[]>('/vehiculos/transportadores');
  const [x, setX] = useState({
    placa: v?.placa ?? '', marca: v?.marca ?? '', tipo: v?.tipo ?? '', capacidad: v ? String(Number(v.capacidad)) : '', unidadCap: v?.unidadCap ?? 'KG', volumenM3: v?.volumenM3 ? String(Number(v.volumenM3)) : '',
    color: v?.color ?? '#1E7838', proveedorId: v?.proveedor?.id ?? '', soatVence: v?.soatVence?.slice(0, 10) ?? '', rtmVence: v?.rtmVence?.slice(0, 10) ?? '', polizaRcVence: v?.polizaRcVence?.slice(0, 10) ?? '', activo: v?.activo ?? true,
  });
  const [enviando, setEnviando] = useState(false);
  const set = (k: keyof typeof x) => (e: { target: { value: string } }) => setX((s) => ({ ...s, [k]: e.target.value }));
  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    const capacidad = Number(x.capacidad.replace(',', '.')), volumen = x.volumenM3.trim() ? Number(x.volumenM3.replace(',', '.')) : null;
    if (!(capacidad > 0)) { toast('Escriba la capacidad (un número mayor que cero).', 'warn'); return; }
    setEnviando(true);
    const datos = { marca: x.marca, tipo: x.tipo, capacidad, unidadCap: x.unidadCap, volumenM3: volumen, color: x.color, proveedorId: x.proveedorId || null, soatVence: x.soatVence, rtmVence: x.rtmVence, polizaRcVence: x.polizaRcVence };
    try {
      if (v) await api(`/vehiculos/${v.id}`, { metodo: 'PATCH', cuerpo: { ...datos, activo: x.activo } });
      if (v && gps && unidad !== unidadAntes) await api(`/vehiculos/${v.id}/wialon`, { metodo: 'PATCH', cuerpo: { unidadId: unidad ? Number(unidad) : null } });
      else await api('/vehiculos', { metodo: 'POST', cuerpo: { ...datos, placa: x.placa } });
      toast(v ? (v.activo && !x.activo ? `${v.placa} inactivo: ya no se ofrece para programar rutas.` : 'Vehículo actualizado.') : 'Vehículo creado.');
      listo();
    } catch (err) { toast(mensajeError(err, 'No se pudo guardar.'), 'warn'); }
    setEnviando(false);
  };
  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      {v ? <p className="text-[13px] text-muted">Placa <span className="num font-medium text-fg">{v.placa}</span>: no cambia.</p>
        : <Field label="Placa" id="fv-p"><Input id="fv-p" value={x.placa} onChange={(e) => setX((s) => ({ ...s, placa: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) }))} placeholder="ABC123" required /></Field>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tipo" id="fv-t"><Input id="fv-t" list="fv-tipos" value={x.tipo} onChange={set('tipo')} maxLength={40} required /></Field>
        <datalist id="fv-tipos">{TIPOS.map((t) => <option key={t} value={t} />)}</datalist>
        <Field label="Marca" id="fv-m"><Input id="fv-m" value={x.marca} onChange={set('marca')} maxLength={40} /></Field>
        <Field label="Capacidad" id="fv-c"><Input id="fv-c" inputMode="decimal" value={x.capacidad} onChange={set('capacidad')} required /></Field>
        <Field label="Unidad" id="fv-u"><Select id="fv-u" value={x.unidadCap} onChange={set('unidadCap')}>{Object.entries(UNIDAD).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="Volumen (m³)" id="fv-vol"><Input id="fv-vol" inputMode="decimal" value={x.volumenM3} onChange={set('volumenM3')} /></Field>
        <Field label="Color en la programación" id="fv-col"><Input id="fv-col" type="color" value={x.color} onChange={set('color')} className="p-1" /></Field>
      </div>
      <Field label="Propietario" id="fv-pr" hint="Un vehículo de un transportador tercero cobra flete."><Select id="fv-pr" value={x.proveedorId} onChange={set('proveedorId')}><option value="">Propio de Terra Viva</option>{(transportadores.datos ?? []).map((t) => <option key={t.id} value={t.id}>{t.razonSocial}</option>)}</Select></Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="SOAT vence" id="fv-s"><Input id="fv-s" type="date" value={x.soatVence} onChange={set('soatVence')} /></Field>
        <Field label="Técnico-mecánica vence" id="fv-r"><Input id="fv-r" type="date" value={x.rtmVence} onChange={set('rtmVence')} /></Field>
        <Field label="Póliza RC vence" id="fv-po"><Input id="fv-po" type="date" value={x.polizaRcVence} onChange={set('polizaRcVence')} /></Field>
      </div>
      {v && gps && (
        <Field label="Unidad de Wialon (GPS)" id="fv-w" hint="Se enlaza sola si el nombre de la unidad en Wialon trae la placa; si no, elíjala aquí.">
          <Select id="fv-w" value={unidad} onChange={(e) => setUnidad(e.target.value)}>
            <option value="">Sin enlazar</option>
            {actual?.unidadId && !gps.unidades.some((u) => u.id === actual.unidadId) && <option value={actual.unidadId}>{actual.unidadNombre ?? actual.unidadId} (ya no está en la cuenta)</option>}
            {gps.unidades.map((u) => {
              const otro = gps.vehiculos.find((y) => y.unidadId === u.id && y.id !== v.id);
              const vieja = !u.posicionEn || Date.now() - new Date(u.posicionEn).getTime() > 30 * 86_400_000; // p. ej. el equipo viejo 2G
              return <option key={u.id} value={u.id} disabled={!!otro}>{u.nombre}{otro ? ` (en ${otro.placa})` : vieja ? ' (no reporta hace más de 30 días)' : ''}</option>;
            })}
          </Select>
        </Field>
      )}
      {v && (
        <label className="flex items-start gap-2 rounded-lg border border-line p-3 text-[13px]">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--brand))]" checked={x.activo} onChange={(e) => setX((s) => ({ ...s, activo: e.target.checked }))} />
          <span><span className="font-medium">Vehículo activo</span><br /><span className="text-muted">Inactivo no se borra: deja de ofrecerse para programar rutas y sale de las alertas.</span></span>
        </label>
      )}
      <div className="flex justify-end border-t border-line pt-3"><Button type="submit" variant={v?.activo && !x.activo ? 'danger' : 'primary'} disabled={enviando}>{enviando ? <Loader2 size={16} className="animate-spin" /> : v ? <Pencil size={16} /> : <Plus size={16} />}{v ? (v.activo && !x.activo ? 'Inactivar vehículo' : 'Guardar cambios') : 'Crear vehículo'}</Button></div>
    </form>
  );
}
