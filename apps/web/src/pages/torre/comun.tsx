// Torre de control (oficina, modo servidor): tipos, catálogos y detalle de ruta compartidos.
import { useEffect, useState } from 'react';
import { MapPin, Pencil, FileStack, Trash2, Save, X } from 'lucide-react';
import { Badge, Button, ColorBadge, DefList, EstadoBadge, Field, Input, Select, Sheet, useToast } from '../../components/ui';
import { alCambiarSesion, api, tienePermiso } from '../../lib/api';
import { useRouter } from '../../lib/router';
import { fmtCOP, fmtFecha } from '../../lib/format';
import { cant, fechaHoraCo, horaCo, horaColumna, msg, useApi } from '../../lib/servidor';

// ---------- Tipos del API ----------
export interface Vehiculo { id: string; placa: string; marca: string | null; color: string; tipo: string; capacidad: string; unidadCap: string; proveedorId: string | null; activo: boolean }
export interface Persona { id: string; nombre: string; esConductor: boolean; esAuxiliar: boolean; licenciaVence: string | null; cursoMpVence: string | null }
export interface Zona { id: string; nombre: string; color: string }
export interface Etapa { id: string; nombre: string; color: string; orden: number; esFinal: boolean; cancela: boolean; rastreo: boolean }
export interface Ref { id: string; nombre: string }
export interface Destino { id: string; razonSocial: string; esPropio: boolean }
export interface Catalogos { vehiculos: Vehiculo[]; personal: Persona[]; zonas: Zona[]; etapas: Etapa[]; causales: Ref[]; destinos: Destino[]; arl: Ref[]; eps: Ref[] }

export interface LineaRuta {
  id: string; // ruta_item
  solicitudItem: { id: string; estado: string; cantidadEstimada: string | null; solicitud: { numero: number }; declaracion: { nombre: string; codigoInterno: string | null } };
}
export interface Parada {
  id: string; orden: number; estado: 'PENDIENTE' | 'ATENDIDA' | 'NO_ATENDIDA'; horaLlegada: string | null; observaciones: string | null;
  sucursal: { codigo: string | null; nombre: string; direccion: string | null; cliente: { razonSocial: string } }; items: LineaRuta[];
}
export interface RutaApi {
  id: string; codigo: string; fechaProgramada: string; horaProgramada: string | null; zonaId: string | null; vehiculoId: string | null; conductorId: string | null; auxiliarId: string | null;
  interna: boolean; valorFlete: string | null; kmInicial: number | null; kmFinal: number | null; horaSalida: string | null; horaLlegadaPlanta: string | null; observaciones: string | null;
  vehiculo: { placa: string; marca: string | null; color: string } | null; conductor: { nombre: string } | null; auxiliar: { nombre: string } | null; zona: { nombre: string } | null;
  estadoRecorrido: Etapa | null; paradas: Parada[];
}

// ---------- Catálogos (una sola carga por sesión) ----------
let cache: Promise<Catalogos> | null = null;

alCambiarSesion(() => { cache = null; });
const cargarCatalogos = async (): Promise<Catalogos> => {
  const [vehiculos, personal, zonas, ops] = await Promise.all([
    api<Vehiculo[]>('/vehiculos'), api<Persona[]>('/personal'), api<Zona[]>('/zonas'),
    api<Omit<Catalogos, 'vehiculos' | 'personal' | 'zonas'>>('/catalogos/operacion'),
  ]);
  return { vehiculos, personal, zonas, ...ops };
};
export function useCatalogos() {
  const [c, setC] = useState<Catalogos | null>(null);
  useEffect(() => {
    let vivo = true;
    (cache ??= cargarCatalogos()).then((x) => vivo && setC(x)).catch(() => { cache = null; });
    return () => { vivo = false; };
  }, []);
  return c;
}

// ---------- Piezas visuales ----------
export const SIN_VEHICULO = '#94A3B8';
export const Placa = ({ r }: { r: { vehiculo: { placa: string; color: string } | null } }) =>
  r.vehiculo ? <ColorBadge color={r.vehiculo.color}>{r.vehiculo.placa}</ColorBadge> : <Badge tone="warn">Sin vehículo</Badge>;
export const EtapaBadge = ({ e }: { e: Etapa | null }) => (e ? <ColorBadge color={e.color}>{e.nombre}</ColorBadge> : <Badge>—</Badge>);
export const lineasDe = (r: RutaApi) => r.paradas.reduce((s, p) => s + p.items.length, 0);
/** Licencia vencida a la fecha de la ruta. */
export const licenciaVencida = (p: Persona | undefined, fecha: string) => !!p?.licenciaVence && p.licenciaVence.slice(0, 10) < fecha.slice(0, 10);
export const nombreVehiculo = (v: Vehiculo) => `${v.placa} · ${v.tipo}${v.proveedorId ? ' (tercero)' : ''}`;

/** Clave para abrir un manifiesto desde otra pantalla. */
export const MF_OFICINA = 'terry-go-mf-oficina';
export const CONC_OFICINA = 'terry-go-conc-oficina';

interface MfFila { id: string; numero: string; estado: string; cliente: { razonSocial: string } }
interface PuntoGps { latitud: string; longitud: string; registradoEn: string; velocidadKmh: string | null }

/** Formulario de recursos de una ruta (vehículo, tripulación, zona, fecha y hora, flete). */
export interface FormRuta { fechaProgramada: string; horaProgramada: string; zonaId: string; vehiculoId: string; conductorId: string; auxiliarId: string; valorFlete: string; observaciones: string; interna: boolean }
export const formDeRuta = (r: RutaApi): FormRuta => ({
  fechaProgramada: r.fechaProgramada.slice(0, 10), horaProgramada: horaColumna(r.horaProgramada), zonaId: r.zonaId ?? '', vehiculoId: r.vehiculoId ?? '',
  conductorId: r.conductorId ?? '', auxiliarId: r.auxiliarId ?? '', valorFlete: r.valorFlete ?? '', observaciones: r.observaciones ?? '', interna: r.interna,
});

export function CamposRuta({ f, set, cat, id }: { f: FormRuta; set: (fn: (f: FormRuta) => FormRuta) => void; cat: Catalogos; id: string }) {
  const veh = cat.vehiculos.find((v) => v.id === f.vehiculoId);
  const cond = cat.personal.find((p) => p.id === f.conductorId);
  const campo = <K extends keyof FormRuta>(k: K) => (e: { target: { value: string } }) => set((s) => ({ ...s, [k]: e.target.value }));
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Fecha" id={`${id}-f`}><Input id={`${id}-f`} type="date" value={f.fechaProgramada} onChange={campo('fechaProgramada')} /></Field>
      <Field label="Hora de salida" id={`${id}-h`} hint="Opcional"><Input id={`${id}-h`} type="time" value={f.horaProgramada} onChange={campo('horaProgramada')} /></Field>
      <Field label="Vehículo" id={`${id}-v`}>
        <Select id={`${id}-v`} value={f.vehiculoId} onChange={campo('vehiculoId')}>
          <option value="">Sin asignar</option>
          {cat.vehiculos.filter((v) => v.activo || v.id === f.vehiculoId).map((v) => <option key={v.id} value={v.id}>{nombreVehiculo(v)}</option>)}
        </Select>
      </Field>
      <Field label="Zona" id={`${id}-z`}>
        <Select id={`${id}-z`} value={f.zonaId} onChange={campo('zonaId')}><option value="">Sin zona</option>{cat.zonas.map((z) => <option key={z.id} value={z.id}>{z.nombre}</option>)}</Select>
      </Field>
      <Field label="Conductor" id={`${id}-c`} hint={licenciaVencida(cond, f.fechaProgramada) ? '⚠ Licencia vencida a esa fecha' : undefined}>
        <Select id={`${id}-c`} value={f.conductorId} onChange={campo('conductorId')}>
          <option value="">Sin asignar</option>
          {cat.personal.filter((p) => p.esConductor || p.id === f.conductorId).map((p) => <option key={p.id} value={p.id}>{p.nombre}{licenciaVencida(p, f.fechaProgramada) ? ' (licencia vencida)' : ''}</option>)}
        </Select>
      </Field>
      <Field label="Auxiliar" id={`${id}-a`}>
        <Select id={`${id}-a`} value={f.auxiliarId} onChange={campo('auxiliarId')}>
          <option value="">Sin auxiliar</option>
          {cat.personal.filter((p) => p.id !== f.conductorId).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </Select>
      </Field>
      {veh?.proveedorId && (
        <Field label="Valor del flete (COP)" id={`${id}-fl`} hint="Vehículo de un tercero"><Input id={`${id}-fl`} type="number" min={0} step={1000} value={f.valorFlete} onChange={campo('valorFlete')} /></Field>
      )}
      <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--brand))]" checked={f.interna} onChange={(e) => set((s) => ({ ...s, interna: e.target.checked }))} />Movimiento interno en planta</label>
      <div className="sm:col-span-2"><Field label="Observaciones" id={`${id}-o`}><Input id={`${id}-o`} value={f.observaciones} onChange={campo('observaciones')} maxLength={2000} /></Field></div>
    </div>
  );
}
/** Cuerpo para crear o editar la ruta: los vacíos se envían como «sin asignar». */
export const cuerpoRuta = (f: FormRuta, editar: boolean) => {
  const o = (v: string) => (v ? v : editar ? null : undefined);
  return {
    fechaProgramada: f.fechaProgramada, horaProgramada: o(f.horaProgramada), zonaId: o(f.zonaId), vehiculoId: o(f.vehiculoId), conductorId: o(f.conductorId), auxiliarId: o(f.auxiliarId),
    valorFlete: f.valorFlete ? Number(f.valorFlete) : editar ? null : undefined, observaciones: f.observaciones || (editar ? null : undefined), interna: f.interna,
  };
};

/** Hoja con el detalle de una ruta: recursos, paradas con sus líneas, manifiestos y última ubicación GPS. */
export function RutaDetalle({ ruta, cat, onClose, onCambio }: { ruta: RutaApi | null; cat: Catalogos | null; onClose: () => void; onCambio: () => void }) {
  const toast = useToast();
  const { go } = useRouter();
  const [editar, setEditar] = useState(false);
  const [f, setF] = useState<FormRuta | null>(null);
  const [quitar, setQuitar] = useState<string | null>(null);
  const [gps, setGps] = useState<PuntoGps | 'sin' | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const mfs = useApi<{ filas: MfFila[] }>(ruta ? `/manifiestos?rutaId=${ruta.id}&porPagina=100` : null);
  useEffect(() => { setEditar(false); setQuitar(null); setGps(null); setF(ruta ? formDeRuta(ruta) : null); }, [ruta?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ruta) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;
  const final = !!ruta.estadoRecorrido?.esFinal;
  const programa = tienePermiso('rutas.programar') && !final;

  const accion = async (fn: () => Promise<unknown>, ok: string) => {
    setOcupado(true);
    try { await fn(); if (ok) toast(ok); onCambio(); mfs.recargar(); } catch (e) { toast(msg(e), 'warn'); } finally { setOcupado(false); }
  };
  const guardar = () => f && accion(async () => { await api(`/rutas/${ruta.id}`, { metodo: 'PATCH', cuerpo: cuerpoRuta(f, true) }); setEditar(false); }, `Ruta ${ruta.codigo} actualizada.`);
  const quitarLinea = (ri: string) => accion(() => api(`/rutas/${ruta.id}/items/${ri}`, { metodo: 'DELETE' }), 'Línea quitada: vuelve a «por programar».').then(() => setQuitar(null));
  const abrirManifiestos = () => accion(async () => {
    const r = await api<{ numero: string }[]>('/manifiestos/desde-ruta', { cuerpo: { rutaId: ruta.id } });
    toast(`${r.length === 1 ? 'Manifiesto' : 'Manifiestos'} ${r.map((m) => m.numero).join(', ')} listo${r.length === 1 ? '' : 's'} para el conductor.`);
  }, '');
  const verGps = async () => {
    try { const ps = await api<PuntoGps[]>(`/rutas/${ruta.id}/rastreo`); setGps(ps.length ? ps[ps.length - 1] : 'sin'); } catch (e) { toast(msg(e), 'warn'); }
  };
  const irManifiesto = (id: string) => { try { sessionStorage.setItem(MF_OFICINA, id); } catch { /* sin almacenamiento */ } go('manifiestos'); };

  return (
    <Sheet open onClose={onClose} title={<span>Ruta <span className="num">{ruta.codigo}</span></span>}
      footer={editar
        ? <><Button onClick={() => { setEditar(false); setF(formDeRuta(ruta)); }}><X size={16} /> Cancelar</Button><Button variant="primary" disabled={ocupado} onClick={guardar}><Save size={16} /> Guardar</Button></>
        : <>
            {programa && <Button onClick={() => setEditar(true)}><Pencil size={16} /> Asignar o editar</Button>}
            {tienePermiso('manifiestos.operar') && !final && ruta.paradas.some((p) => p.items.some((i) => i.solicitudItem.estado === 'PROGRAMADO')) &&
              <Button disabled={ocupado} onClick={abrirManifiestos} title="Un manifiesto por parada con las líneas que aún no lo tienen"><FileStack size={16} /> Abrir manifiestos</Button>}
          </>}>
      {editar && f && cat ? <CamposRuta f={f} set={(fn) => setF((s) => (s ? fn(s) : s))} cat={cat} id="rd" /> : (
        <div className="flex flex-col gap-5">
          <DefList items={[
            ['Fecha', `${fmtFecha(ruta.fechaProgramada)}${ruta.horaProgramada ? ` · ${horaColumna(ruta.horaProgramada)}` : ''}`],
            ['Etapa', <EtapaBadge e={ruta.estadoRecorrido} />],
            ['Vehículo', <Placa r={ruta} />],
            ['Conductor', ruta.conductor?.nombre ?? <Badge tone="warn">Sin asignar</Badge>],
            ['Auxiliar', ruta.auxiliar?.nombre ?? '—'],
            ['Zona', ruta.zona?.nombre ?? '—'],
            ...(ruta.valorFlete ? [['Flete', fmtCOP(Number(ruta.valorFlete))]] as [string, string][] : []),
            ...(ruta.interna ? [['Tipo', 'Movimiento interno en planta']] as [string, string][] : []),
            ['Kilometraje', ruta.kmInicial !== null ? `${cant(ruta.kmInicial)} → ${ruta.kmFinal !== null ? cant(ruta.kmFinal) : '…'}${ruta.kmFinal !== null ? ` (${cant(ruta.kmFinal - ruta.kmInicial)} km)` : ''}` : '—'],
            ['Salida / llegada', `${horaCo(ruta.horaSalida)} / ${horaCo(ruta.horaLlegadaPlanta)}`],
            ...(ruta.observaciones ? [['Observaciones', ruta.observaciones]] as [string, string][] : []),
          ]} />
          {(!ruta.vehiculoId || !ruta.conductorId) && !final && <p className="rounded-lg bg-warn/10 px-3 py-2 text-[13px] text-warn">La ruta no puede salir hasta tener vehículo y conductor.</p>}

          <section className="flex flex-col gap-2">
            <h3 className="text-[13px] font-semibold uppercase tracking-[0.05em] text-muted">Paradas</h3>
            {ruta.paradas.map((p) => (
              <div key={p.id} className="rounded-xl border border-line p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium"><span className="num text-muted">{p.orden}.</span> {p.sucursal.cliente.razonSocial}</p>
                    <p className="text-[12px] text-muted">{p.sucursal.codigo ? `${p.sucursal.codigo} · ` : ''}{p.sucursal.nombre}{p.sucursal.direccion ? ` · ${p.sucursal.direccion}` : ''}</p>
                  </div>
                  <EstadoBadge estado={p.estado} />
                </div>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {p.items.map((it) => (
                    <li key={it.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[13px]">
                      <span className="min-w-0 truncate">{it.solicitudItem.declaracion.nombre} <span className="text-muted">· Sol. {it.solicitudItem.solicitud.numero} · {cant(it.solicitudItem.cantidadEstimada)}</span></span>
                      {quitar === it.id
                        ? <span className="flex shrink-0 items-center gap-1"><span className="text-[12px] text-muted">¿Quitar?</span><Button size="sm" variant="danger" disabled={ocupado} onClick={() => quitarLinea(it.id)}>Sí</Button><Button size="sm" variant="ghost" onClick={() => setQuitar(null)}>No</Button></span>
                        : programa && it.solicitudItem.estado === 'PROGRAMADO'
                          ? <Button size="sm" variant="ghost" onClick={() => setQuitar(it.id)} aria-label="Quitar la línea de la ruta"><Trash2 size={14} /></Button>
                          : <EstadoBadge estado={it.solicitudItem.estado} />}
                    </li>
                  ))}
                  {!p.items.length && <li className="text-[12px] text-subtle">Sin líneas en esta parada.</li>}
                </ul>
              </div>
            ))}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-[13px] font-semibold uppercase tracking-[0.05em] text-muted">Manifiestos</h3>
            {mfs.datos?.filas.length ? mfs.datos.filas.map((m) => (
              <button key={m.id} onClick={() => irManifiesto(m.id)} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-left text-[13px] hover:bg-surface-2">
                <span className="min-w-0 truncate"><span className="num font-medium">{m.numero}</span> · {m.cliente.razonSocial}</span><EstadoBadge estado={m.estado} />
              </button>
            )) : <p className="text-[13px] text-subtle">{mfs.cargando ? 'Cargando…' : 'Aún no hay manifiestos de esta ruta.'}</p>}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-[13px] font-semibold uppercase tracking-[0.05em] text-muted">Ubicación</h3>
            {gps === null && <Button size="sm" className="self-start" onClick={verGps}><MapPin size={15} /> Ver la última ubicación</Button>}
            {gps === 'sin' && <p className="text-[13px] text-subtle">Sin puntos GPS: el rastreo funciona solo en las etapas con rastreo y con la app abierta.</p>}
            {gps && gps !== 'sin' && (
              <p className="text-[13px]">{fechaHoraCo(gps.registradoEn)}{gps.velocidadKmh ? ` · ${cant(gps.velocidadKmh)} km/h` : ''} ·{' '}
                <a className="font-medium text-brand underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${gps.latitud},${gps.longitud}`}>abrir en el mapa</a></p>
            )}
          </section>
        </div>
      )}
    </Sheet>
  );
}
