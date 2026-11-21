// Torre de control: solicitudes de servicio (crear, aprobar, cancelar) y «Por confirmar» (las que esperan aprobación,
// incluidas las recurrentes que genera TERRY-GO al grabar un manifiesto).
import { useEffect, useMemo, useState } from 'react';
import { Check, Plus, RefreshCw, X, Ban } from 'lucide-react';
import { FilterBar, ResponsiveTable, type Column } from '../../components/data';
import { Badge, Button, DefList, EstadoBadge, Field, Input, PageHeader, Select, Sheet, useToast } from '../../components/ui';
import { API_URL, api, tienePermiso } from '../../lib/api';
import { useRouter } from '../../lib/router';
import { cx, fmtCOP, fmtFecha, fmtFechaCorta } from '../../lib/format';
import { cant, hoyCo, msg, sumarDias, useApi, usePaginado, PieLista } from '../../lib/servidor';
import { useCatalogos } from './comun';
import { BuscarCliente } from '../../components/BuscarCliente';

type Jornada = 'AM' | 'PM' | 'DIA';
const JORNADA: Record<Jornada, string> = { AM: 'Mañana', PM: 'Tarde', DIA: 'Todo el día' };
interface SolItem {
  id: string; estado: string; cantidadEstimada: string | null; cantidadReal: string | null; jornada: Jornada | null; precioUnitario: string | null; observaciones: string | null;
  sucursal: { codigo: string | null; nombre: string }; declaracion: { numero: number; nombre: string; codigoInterno: string | null };
  especificaciones?: { especificacion: { nombre: string } }[];
}
interface Sol {
  id: string; numero: number; clase: 'PRE' | 'FORMAL'; operacion: 'CARGA' | 'DESCARGA'; fechaSolicitada: string; aprobacion: 'PENDIENTE' | 'APROBADA' | 'NO_APROBADA';
  estado: string; totalEstimado: string | null; ordenCompra: string | null; observaciones: string | null; createdAt: string; cliente: { razonSocial: string }; items: SolItem[];
  /** Con clienteId: la pidió el cliente desde su portal. */
  creadoPor?: { nombre: string; clienteId: string | null } | null;
  /** PDF que adjuntó el cliente (orden de compra, remisión): clave del almacenamiento. */
  adjuntoUrl?: string | null; telefonoContacto?: string | null; destino?: { razonSocial: string } | null;
  transporte?: { empresaTransportadora: string; tipoVehiculo: string | null; placa: string | null; conductorNombre: string | null; conductorDocumento: string | null; auxiliarNombre: string | null; auxiliarDocumento: string | null } | null;
}
const desdePortal = (s: Sol) => !!s.creadoPor?.clienteId;
interface DeclCliente {
  id: string; numero: number; nombre: string; codigoInterno: string | null; activa: boolean;
  sucursales: { activa: boolean; sucursal: { id: string; codigo: string | null; nombre: string } }[];
  tarifaVigente: { precioUnitario: string; metrica: { abreviacion: string } | null } | null;
}
const sedes = (s: Sol) => [...new Set(s.items.map((i) => i.sucursal.codigo ?? i.sucursal.nombre))].join(', ');

export function SolicitudesServidor({ porConfirmar = false }: { porConfirmar?: boolean }) {
  const hoy = hoyCo();
  const base = porConfirmar
    ? { desde: '', hasta: '', estado: 'PENDIENTE', aprobacion: 'PENDIENTE', clienteId: '', numero: '' }
    : { desde: sumarDias(hoy, -30), hasta: sumarDias(hoy, 30), estado: '', aprobacion: '', clienteId: '', numero: '' };
  const [f, setF] = useState(base);
  const [num, setNum] = useState('');
  const lista = usePaginado<Sol>(`/solicitudes?${new URLSearchParams(Object.fromEntries(Object.entries(f).filter(([, v]) => v)))}`);
  const [sel, setSel] = useState<string | null>(null);
  const [nueva, setNueva] = useState(false);
  const activos = Object.entries(f).filter(([k, v]) => v !== (base as Record<string, string>)[k]).length;
  const filas = lista.filas ?? [];
  const cols: Column<Sol>[] = [
    { key: 'n', header: 'N.º', render: (s) => <span className="num font-medium">{s.numero}</span>, priority: 3 },
    { key: 'f', header: 'Para el', render: (s) => <span className={cx('num', s.fechaSolicitada.slice(0, 10) < hoy && s.estado === 'PENDIENTE' && 'text-bad')}>{fmtFechaCorta(s.fechaSolicitada)}</span>, priority: 1 },
    { key: 'cli', header: 'Cliente', render: (s) => <span className="block max-w-[220px] truncate">{s.cliente.razonSocial}</span>, priority: 3 },
    { key: 'clase', header: 'Origen', render: (s) => (s.clase === 'PRE' ? <Badge tone="info">Recurrente</Badge> : desdePortal(s) ? <Badge tone="brand">Portal del cliente</Badge> : s.operacion === 'DESCARGA' ? 'Descarga en planta' : 'Recolección'), priority: 2 },
    { key: 'sedes', header: 'Sedes', render: (s) => <span className="block max-w-[160px] truncate">{sedes(s)}</span>, priority: 3 },
    { key: 'lin', header: 'Líneas', align: 'right', render: (s) => s.items.length, priority: 3 },
    { key: 'tot', header: 'Estimado', align: 'right', render: (s) => (s.totalEstimado ? fmtCOP(Number(s.totalEstimado)) : '—'), priority: 3 },
    { key: 'apr', header: 'Aprobación', render: (s) => <EstadoBadge estado={s.aprobacion} />, priority: 2 },
    { key: 'est', header: 'Avance', render: (s) => <EstadoBadge estado={s.estado} />, priority: 3 },
  ];
  return (
    <>
      <PageHeader eyebrow="Logística" title={porConfirmar ? 'Por confirmar' : 'Solicitudes'}
        subtitle={porConfirmar
          ? 'Solicitudes que esperan la aprobación comercial: las recurrentes que Terry-App crea al grabar un manifiesto y las que se registraron sin aprobar. Al aprobarlas pasan a «por programar».'
          : 'Servicios pedidos por los clientes. La aprobación comercial va aparte del avance: cada línea se programa en una ruta y queda realizada al grabar su manifiesto.'}
        actions={<>{tienePermiso('solicitudes.crear') && !porConfirmar && <Button variant="primary" onClick={() => setNueva(true)}><Plus size={16} /> Nueva solicitud</Button>}<Button onClick={lista.recargar}><RefreshCw size={16} /> Actualizar</Button></>} />
      <FilterBar active={activos} onClear={() => { setF(base); setNum(''); }}>
        <Field label="Para el, desde" id="so-d"><Input id="so-d" type="date" value={f.desde} onChange={(e) => setF((s) => ({ ...s, desde: e.target.value }))} /></Field>
        <Field label="Hasta" id="so-h"><Input id="so-h" type="date" value={f.hasta} onChange={(e) => setF((s) => ({ ...s, hasta: e.target.value }))} /></Field>
        <Field label="Cliente" id="so-c"><BuscarCliente id="so-c" valor={f.clienteId} vacio="Todos" onChange={(c) => setF((s) => ({ ...s, clienteId: c?.id ?? '' }))} /></Field>
        <Field label="Aprobación" id="so-a"><Select id="so-a" value={f.aprobacion} onChange={(e) => setF((s) => ({ ...s, aprobacion: e.target.value }))}><option value="">Todas</option><option value="PENDIENTE">Pendiente</option><option value="APROBADA">Aprobada</option><option value="NO_APROBADA">No aprobada</option></Select></Field>
        <Field label="Avance" id="so-e"><Select id="so-e" value={f.estado} onChange={(e) => setF((s) => ({ ...s, estado: e.target.value }))}><option value="">Todos</option>{['PENDIENTE', 'PROGRAMADA', 'EN_CURSO', 'RECOLECTADA', 'CANCELADA'].map((x) => <option key={x} value={x}>{x === 'EN_CURSO' ? 'En curso' : x.charAt(0) + x.slice(1).toLowerCase()}</option>)}</Select></Field>
        <Field label="Número" id="so-n"><Input id="so-n" type="number" value={num} onChange={(e) => setNum(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setF((s) => ({ ...s, numero: num.trim() }))} onBlur={() => setF((s) => ({ ...s, numero: num.trim() }))} /></Field>
      </FilterBar>
      {lista.error ? <p className="rounded-xl bg-bad/10 p-4 text-bad">{lista.error}</p>
        : !lista.filas ? <p className="p-6 text-center text-muted">Cargando…</p>
        : <ResponsiveTable rows={filas} columns={cols} rowKey={(s) => s.id} onRowClick={(s) => setSel(s.id)} footer={<PieLista mostradas={filas.length} total={lista.total} hayMas={lista.hayMas} cargando={lista.cargando} cargarMas={lista.cargarMas} />} cardTitle={(s) => <span>Sol. <span className="num">{s.numero}</span> · {s.cliente.razonSocial}</span>}
            cardBadge={(s) => <EstadoBadge estado={s.aprobacion} />} cardMeta={(s) => `Para el ${fmtFecha(s.fechaSolicitada)} · ${sedes(s)}`}
            empty={porConfirmar ? 'No hay solicitudes esperando aprobación.' : 'No hay solicitudes con estos filtros.'} />}
      <DetalleSolicitud s={filas.find((x) => x.id === sel) ?? null} onClose={() => setSel(null)} onCambio={lista.recargar} />
      {tienePermiso('solicitudes.crear') && <NuevaSolicitud abierta={nueva} onClose={() => setNueva(false)} onListo={() => { setNueva(false); lista.recargar(); }} />}
    </>
  );
}

function DetalleSolicitud({ s, onClose, onCambio }: { s: Sol | null; onClose: () => void; onCambio: () => void }) {
  const toast = useToast();
  const { go } = useRouter();
  const cat = useCatalogos();
  const [cancelar, setCancelar] = useState(false);
  const [causal, setCausal] = useState('');
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { setCancelar(false); setCausal(''); }, [s?.id]);
  const hacer = async (fn: () => Promise<unknown>, ok: string) => {
    setOcupado(true);
    try { await fn(); toast(ok); onCambio(); } catch (e) { toast(msg(e), 'warn'); } finally { setOcupado(false); }
  };
  // Recolección: la aprueba el Líder de Operaciones; entrega en planta: la autoriza el Jefe de Planta
  const aprobable = s && s.aprobacion === 'PENDIENTE' && s.estado === 'PENDIENTE' && tienePermiso(s.operacion === 'DESCARGA' ? 'solicitudes.autorizar_entrega' : 'solicitudes.aprobar');
  const cancelable = s && !['RECOLECTADA', 'CANCELADA'].includes(s.estado) && tienePermiso('solicitudes.crear');
  return (
    <Sheet open={!!s} onClose={onClose} title={s ? `Solicitud ${s.numero}` : ''}
      footer={s && (cancelar
        ? <><Button onClick={() => setCancelar(false)}>Volver</Button><Button variant="danger" disabled={ocupado || !causal} onClick={() => hacer(() => api(`/solicitudes/${s.id}/estado`, { metodo: 'PATCH', cuerpo: { estado: 'CANCELADA', causalCancelacionId: causal } }), `Solicitud ${s.numero} cancelada.`)}><Ban size={16} /> Cancelar solicitud</Button></>
        : <>
            {aprobable && <Button disabled={ocupado} onClick={() => hacer(() => api(`/solicitudes/${s.id}/aprobacion`, { metodo: 'PATCH', cuerpo: { aprobacion: 'NO_APROBADA' } }), `Solicitud ${s.numero} no aprobada.`)}><X size={16} /> No aprobar</Button>}
            {aprobable && <Button variant="primary" disabled={ocupado} onClick={() => hacer(() => api(`/solicitudes/${s.id}/aprobacion`, { metodo: 'PATCH', cuerpo: { aprobacion: 'APROBADA' } }), `Solicitud ${s.numero} aprobada: ya está en «por programar».`)}><Check size={16} /> Aprobar</Button>}
            {s.aprobacion === 'APROBADA' && s.estado === 'PENDIENTE' && s.operacion === 'CARGA' && <Button onClick={() => go('programacion')}>Ir a programar</Button>}
            {cancelable && <Button variant="ghost" onClick={() => setCancelar(true)}><Ban size={16} /> Cancelar</Button>}
          </>)}>
      {s && (cancelar ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm">Las líneas que no se hayan realizado dejan de esperar ruta. Si alguna ya está en una ruta o en un manifiesto, el sistema le dirá qué hacer primero.</p>
          <Field label="Causal" id="sc-c"><Select id="sc-c" value={causal} onChange={(e) => setCausal(e.target.value)}><option value="">Elija la causal</option>{cat?.causales.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</Select></Field>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <DefList items={[
            ['Cliente', s.cliente.razonSocial],
            ['Para el', fmtFecha(s.fechaSolicitada)],
            ['Origen', s.clase === 'PRE' ? 'Recurrente (la generó Terry-App al grabar un manifiesto)' : desdePortal(s) ? `Pedida por el cliente desde su portal (${s.creadoPor!.nombre})` : s.operacion === 'DESCARGA' ? 'Descarga en planta' : 'Recolección en la sede'],
            ['Aprobación', <EstadoBadge estado={s.aprobacion} />],
            ['Avance', <EstadoBadge estado={s.estado} />],
            ...(s.ordenCompra ? [['Orden de compra', s.ordenCompra]] as [string, string][] : []),
            ...(s.totalEstimado ? [['Total estimado', fmtCOP(Number(s.totalEstimado))]] as [string, string][] : []),
            ...(s.observaciones ? [['Observaciones', s.observaciones]] as [string, string][] : []),
            ...(s.operacion === 'DESCARGA' ? [
              ['Planta', s.destino?.razonSocial ?? '—'],
              ['Vehículo', s.transporte ? [s.transporte.placa, s.transporte.tipoVehiculo, s.transporte.empresaTransportadora].filter(Boolean).join(' · ') : '—'],
              ['Conductor', s.transporte?.conductorNombre ? [s.transporte.conductorNombre, s.transporte.conductorDocumento && 'C.C. ' + s.transporte.conductorDocumento].filter(Boolean).join(' · ') : '—'],
              ...(s.transporte?.auxiliarNombre ? [['Auxiliar', [s.transporte.auxiliarNombre, s.transporte.auxiliarDocumento && 'C.C. ' + s.transporte.auxiliarDocumento].filter(Boolean).join(' · ')]] : []),
              ['Teléfono de contacto', s.telefonoContacto ?? '—'],
            ] as [string, string][] : []),
          ]} />
          {s.adjuntoUrl && <AdjuntoCliente clave={s.adjuntoUrl} numero={s.numero} />}
          <section className="flex flex-col gap-2">
            <h3 className="text-[13px] font-semibold uppercase tracking-[0.05em] text-muted">Líneas</h3>
            {s.items.map((i) => (
              <div key={i.id} className="flex items-start justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[13px]">
                <div className="min-w-0"><p className="truncate font-medium">{i.declaracion.nombre}{i.declaracion.codigoInterno ? <span className="num ml-1 text-muted">{i.declaracion.codigoInterno}</span> : null}</p>
                  <p className="truncate text-muted">{i.sucursal.codigo ? `${i.sucursal.codigo} · ` : ''}{i.sucursal.nombre}{i.jornada ? ` · ${JORNADA[i.jornada]}` : ''} · {cant(i.cantidadReal ?? i.cantidadEstimada)}{i.cantidadReal ? ' recogido' : ' estimado'}</p>
                  {!!i.especificaciones?.length && <p className="truncate text-[12px] text-subtle">{i.especificaciones.map((e) => e.especificacion.nombre).join(' · ')}</p>}</div>
                <EstadoBadge estado={i.estado} />
              </div>
            ))}
          </section>
        </div>
      ))}
    </Sheet>
  );
}

interface LineaForm { incluir: boolean; sucursalId: string; cantidad: string; jornada: string }

/** Nueva solicitud de recolección: residuos autorizados del cliente, con la sede de cada línea. */
function NuevaSolicitud({ abierta, onClose, onListo }: { abierta: boolean; onClose: () => void; onListo: () => void }) {
  const toast = useToast();
  const [clienteId, setClienteId] = useState('');
  const [fecha, setFecha] = useState(hoyCo());
  const [oc, setOc] = useState('');
  const [obs, setObs] = useState('');
  const [aprobar, setAprobar] = useState(tienePermiso('solicitudes.aprobar'));
  const [lineas, setLineas] = useState<Record<string, LineaForm>>({});
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { if (abierta) { setClienteId(''); setFecha(hoyCo()); setOc(''); setObs(''); setLineas({}); setAprobar(tienePermiso('solicitudes.aprobar')); } }, [abierta]);
  const decls = useApi<{ filas: DeclCliente[] }>(abierta && clienteId ? `/declaraciones?clienteId=${clienteId}&estado=AUTORIZADA&activa=true&porPagina=200` : null);
  const disponibles = useMemo(() => (decls.datos?.filas ?? []).map((d) => ({ ...d, sedes: d.sucursales.filter((x) => x.activa).map((x) => x.sucursal) })).filter((d) => d.sedes.length), [decls.datos]);
  const linea = (d: { id: string; sedes: { id: string }[] }): LineaForm => lineas[d.id] ?? { incluir: false, sucursalId: d.sedes.length === 1 ? d.sedes[0].id : '', cantidad: '', jornada: '' };
  const set = (d: { id: string; sedes: { id: string }[] }, cambio: Partial<LineaForm>) => setLineas((s) => ({ ...s, [d.id]: { ...linea(d), ...cambio } }));
  const elegidas = disponibles.filter((d) => linea(d).incluir);
  const completas = elegidas.length > 0 && elegidas.every((d) => linea(d).sucursalId && Number(linea(d).cantidad) > 0);
  const total = elegidas.reduce((s, d) => s + Number(linea(d).cantidad || 0) * Number(d.tarifaVigente?.precioUnitario ?? 0), 0);

  const enviar = async () => {
    setOcupado(true);
    try {
      const r = await api<{ numero: number }>('/solicitudes', { cuerpo: {
        clienteId, fechaSolicitada: fecha, aprobacion: aprobar ? 'APROBADA' : 'PENDIENTE', ordenCompra: oc.trim() || undefined, observaciones: obs.trim() || undefined,
        items: elegidas.map((d) => { const l = linea(d); return { declaracionId: d.id, sucursalId: l.sucursalId, cantidadEstimada: Number(l.cantidad), jornada: l.jornada || undefined }; }),
      } });
      toast(`Solicitud ${r.numero} creada${aprobar ? ' y aprobada: ya está en «por programar»' : ': queda por confirmar'}.`);
      onListo();
    } catch (e) { toast(msg(e), 'warn'); } finally { setOcupado(false); }
  };
  return (
    <Sheet open={abierta} onClose={onClose} title="Nueva solicitud de recolección"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={ocupado || !completas || !fecha} onClick={enviar}><Plus size={16} /> Crear{aprobar ? ' y aprobar' : ''}</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Cliente" id="ns-c"><BuscarCliente id="ns-c" valor={clienteId} vacio="Escriba el nombre o el NIT" onChange={(c) => { setClienteId(c?.id ?? ''); setLineas({}); }} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fecha del servicio" id="ns-f"><Input id="ns-f" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></Field>
          <Field label="Orden de compra" id="ns-oc" hint="Opcional"><Input id="ns-oc" value={oc} onChange={(e) => setOc(e.target.value)} maxLength={40} /></Field>
        </div>
        {clienteId && (
          <section className="flex flex-col gap-2">
            <h3 className="text-[13px] font-semibold uppercase tracking-[0.05em] text-muted">Residuos y servicios autorizados</h3>
            {decls.cargando && <p className="text-muted">Cargando…</p>}
            {decls.datos && !disponibles.length && <p className="rounded-lg bg-warn/10 px-3 py-2 text-[13px] text-warn">El cliente no tiene declaraciones autorizadas y activas asignadas a una sede. Revíselas en Comercial › Declaraciones.</p>}
            {disponibles.map((d) => {
              const l = linea(d); const unidad = d.tarifaVigente?.metrica?.abreviacion ?? '';
              return (
                <div key={d.id} className={cx('flex flex-col gap-2 rounded-xl border p-3', l.incluir ? 'border-brand bg-brand-soft/30' : 'border-line')}>
                  <label className="flex cursor-pointer items-start gap-2.5 text-[14px]">
                    <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--brand))]" checked={l.incluir} onChange={(e) => set(d, { incluir: e.target.checked })} />
                    <span className="min-w-0 flex-1"><span className="font-medium">{d.nombre}</span>{d.codigoInterno && <span className="num ml-1.5 text-[12px] text-muted">{d.codigoInterno}</span>}
                      {d.tarifaVigente && <span className="block text-[12px] text-muted">Tarifa vigente {fmtCOP(Number(d.tarifaVigente.precioUnitario))}{unidad ? ` / ${unidad}` : ''}</span>}</span>
                  </label>
                  {l.incluir && (
                    <div className="grid grid-cols-1 gap-2 pl-6 sm:grid-cols-3">
                      <Select aria-label="Sede" value={l.sucursalId} onChange={(e) => set(d, { sucursalId: e.target.value })}><option value="">Sede…</option>{d.sedes.map((x) => <option key={x.id} value={x.id}>{x.codigo ? `${x.codigo} · ` : ''}{x.nombre}</option>)}</Select>
                      <Input aria-label={`Cantidad estimada${unidad ? ` (${unidad})` : ''}`} type="number" min={0} step="0.01" placeholder={`Cantidad${unidad ? ` (${unidad})` : ''}`} value={l.cantidad} onChange={(e) => set(d, { cantidad: e.target.value })} />
                      <Select aria-label="Jornada" value={l.jornada} onChange={(e) => set(d, { jornada: e.target.value })}><option value="">Jornada…</option>{Object.entries(JORNADA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        )}
        <Field label="Observaciones" id="ns-o"><Input id="ns-o" value={obs} onChange={(e) => setObs(e.target.value)} maxLength={2000} /></Field>
        {tienePermiso('solicitudes.aprobar') && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--brand))]" checked={aprobar} onChange={(e) => setAprobar(e.target.checked)} />Aprobarla de una vez (queda lista para programar)</label>}
        {elegidas.length > 0 && <p className="num text-right text-sm">Total estimado: <b>{fmtCOP(total)}</b></p>}
      </div>
    </Sheet>
  );
}

/** PDF que el cliente adjuntó a su pedido desde el portal: enlace firmado de 5 minutos. */
function AdjuntoCliente({ clave, numero }: { clave: string; numero: number }) {
  const toast = useToast();
  const abrir = async () => {
    const v = window.open('', '_blank');
    try {
      const nombre = 'solicitud-' + numero + '-adjunto' + clave.slice(clave.lastIndexOf('.'));
      const r = await api<{ url: string }>('/archivos/enlace?clave=' + encodeURIComponent(clave) + '&nombre=' + encodeURIComponent(nombre));
      const destino = /^https?:/i.test(r.url) ? r.url : API_URL + r.url;
      if (v) { v.opener = null; v.location.href = destino; } else window.location.assign(destino);
    } catch (e) { v?.close(); toast(msg(e, 'No se pudo abrir el adjunto.'), 'warn'); }
  };
  return <div><Button size="sm" onClick={abrir}>Ver el PDF que adjuntó el cliente</Button></div>;
}
