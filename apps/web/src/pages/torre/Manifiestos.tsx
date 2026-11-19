// Torre de control: manifiestos de transporte (lista, detalle con evidencias y firma, PDF escaneado y anulación).
import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Ban, Paperclip, Scale, FileText, AlertTriangle, Printer } from 'lucide-react';
import { FilterBar, ResponsiveTable, type Column } from '../../components/data';
import { Badge, Button, DefList, EstadoBadge, Field, Input, PageHeader, Select, Sheet, useToast } from '../../components/ui';
import { api, tienePermiso } from '../../lib/api';
import { useRouter } from '../../lib/router';
import { fmtCOP, fmtFecha, fmtFechaCorta } from '../../lib/format';
import { ImagenProtegida, cant, fechaHoraCo, hoyCo, msg, sumarDias, useApi, usePaginado, PieLista, verPdf } from '../../lib/servidor';
import { abrirArchivo } from '../../lib/trabajos';
import { CONC_OFICINA, MF_OFICINA, useCatalogos } from './comun';

interface MfFila {
  id: string; numero: string; tipo: 'CARGUE' | 'DESCARGUE'; estado: 'PENDIENTE' | 'REALIZADO' | 'ANULADO'; fechaServicio: string;
  cliente: { razonSocial: string }; ruta: { codigo: string } | null; vehiculo: { placa: string } | null; transporte: { placa: string | null; empresaTransportadora: string } | null;
  conciliacion: { estado: string } | null; lineas: number; sedes: string[]; solicitudes: number[];
}
interface Evidencia { id: string; tipo: 'FOTO' | 'PDF'; url: string; nombreArchivo: string | null; tomadaEn: string | null; createdAt: string }
interface MfDetalle {
  id: string; numero: string; tipo: 'CARGUE' | 'DESCARGUE'; estado: 'PENDIENTE' | 'REALIZADO' | 'ANULADO'; fechaServicio: string; tipoConciliacion: 'INTERNA' | 'EXTERNA';
  ordenCompra: string | null; manifiestoCliente: string | null; pesoEntrada: string | null; pesoSalida: string | null; pesoNeto: string | null;
  horaLlegada: string | null; horaSalida: string | null; observaciones: string | null; firmaUrl: string | null; firmaNombre: string | null; firmaDocumento: string | null;
  realizadoEn: string | null; motivoAnulacion: string | null; anuladoEn: string | null;
  cliente: { razonSocial: string; nit: string; dv: string | null }; destino: { razonSocial: string }; ruta: { codigo: string } | null;
  vehiculo: { placa: string; tipo: string } | null; conductor: { nombre: string; documento: string } | null; auxiliar: { nombre: string } | null;
  receptorNombre: string | null; receptorDocumento: string | null; firmaReceptorUrl: string | null;
  transporte: { empresaTransportadora: string; nit: string | null; placa: string | null; conductorNombre: string | null; conductorDocumento: string | null; auxiliarNombre: string | null;
    conductorArl: { nombre: string } | null; conductorEps: { nombre: string } | null } | null;
  causalAnulacion: { nombre: string } | null; conciliacion: { id: string; estado: string } | null; evidencias: Evidencia[];
  items: { id: string; cantidad: string; embalajes: number | null; precioUnitario: string | null; subtotal: number; observaciones: string | null;
    declaracion: { nombre: string; codigoInterno: string | null; esPeligroso: boolean }; sucursal: { codigo: string | null; nombre: string };
    metrica: { abreviacion: string } | null; disposicion: { nombre: string } | null; tipoEmbalaje: { nombre: string } | null;
    especificaciones: { especificacion: { abreviatura: string | null; nombre: string } }[]; solicitudItem: { solicitud: { numero: number } } | null }[];
  total: number;
}
const TIPO = { CARGUE: 'Cargue en la sede', DESCARGUE: 'Descargue en planta' };

export function ManifiestosServidor() {
  const hoy = hoyCo();
  const base = { desde: sumarDias(hoy, -30), hasta: sumarDias(hoy, 7), estado: '', tipo: '', numero: '' };
  const [f, setF] = useState(base);
  const [num, setNum] = useState('');
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(f).filter(([, v]) => v)));
  const lista = usePaginado<MfFila>(`/manifiestos?${qs}`);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => { try { const id = sessionStorage.getItem(MF_OFICINA); if (id) { sessionStorage.removeItem(MF_OFICINA); setSel(id); } } catch { /* sin almacenamiento */ } }, []);
  const activos = Object.entries(f).filter(([k, v]) => v && v !== (base as Record<string, string>)[k]).length;
  const placa = (m: MfFila) => m.vehiculo?.placa ?? m.transporte?.placa ?? '—';
  const cols: Column<MfFila>[] = [
    { key: 'num', header: 'Número', render: (m) => <span className="num font-medium">{m.numero}</span>, priority: 3 },
    { key: 'fecha', header: 'Servicio', render: (m) => <span className="num">{fmtFechaCorta(m.fechaServicio)}</span>, priority: 1 },
    { key: 'tipo', header: 'Tipo', render: (m) => (m.tipo === 'CARGUE' ? 'Cargue' : 'Descargue'), priority: 2 },
    { key: 'cli', header: 'Cliente', render: (m) => <span className="block max-w-[220px] truncate">{m.cliente.razonSocial}</span>, priority: 3 },
    { key: 'sedes', header: 'Generador', render: (m) => <span className="block max-w-[180px] truncate">{m.sedes.join(', ')}</span>, priority: 3 },
    { key: 'ruta', header: 'Ruta', render: (m) => <span className="num">{m.ruta?.codigo ?? '—'}</span>, priority: 3 },
    { key: 'placa', header: 'Placa', render: (m) => <span className="num">{placa(m)}</span>, priority: 2 },
    { key: 'lin', header: 'Líneas', align: 'right', render: (m) => m.lineas, priority: 3 },
    { key: 'conc', header: 'Conciliación', render: (m) => (m.conciliacion ? <EstadoBadge estado={m.conciliacion.estado} /> : '—'), priority: 3 },
    { key: 'est', header: 'Estado', render: (m) => <EstadoBadge estado={m.estado} />, priority: 3 },
  ];
  return (
    <>
      <PageHeader eyebrow="Campo y HSEQ" title="Manifiestos de transporte" subtitle="Se abren por ruta y los graba el conductor con firma, horas y báscula. Al grabarse abren la conciliación del servicio."
        actions={<Button onClick={lista.recargar}><RefreshCw size={16} /> Actualizar</Button>} />
      <FilterBar active={activos} onClear={() => { setF(base); setNum(''); }}>
        <Field label="Servicio desde" id="mf-d"><Input id="mf-d" type="date" value={f.desde} onChange={(e) => setF((s) => ({ ...s, desde: e.target.value }))} /></Field>
        <Field label="Hasta" id="mf-h"><Input id="mf-h" type="date" value={f.hasta} onChange={(e) => setF((s) => ({ ...s, hasta: e.target.value }))} /></Field>
        <Field label="Estado" id="mf-e"><Select id="mf-e" value={f.estado} onChange={(e) => setF((s) => ({ ...s, estado: e.target.value }))}><option value="">Todos</option><option value="PENDIENTE">Pendientes</option><option value="REALIZADO">Realizados</option><option value="ANULADO">Anulados</option></Select></Field>
        <Field label="Tipo" id="mf-t"><Select id="mf-t" value={f.tipo} onChange={(e) => setF((s) => ({ ...s, tipo: e.target.value }))}><option value="">Todos</option><option value="CARGUE">Cargue</option><option value="DESCARGUE">Descargue</option></Select></Field>
        <Field label="Número" id="mf-n"><Input id="mf-n" value={num} onChange={(e) => setNum(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setF((s) => ({ ...s, numero: num.trim() }))} onBlur={() => setF((s) => ({ ...s, numero: num.trim() }))} placeholder="MF-…" /></Field>
      </FilterBar>
      {lista.error ? <p className="rounded-xl bg-bad/10 p-4 text-bad">{lista.error}</p>
        : !lista.filas ? <p className="p-6 text-center text-muted">Cargando…</p>
        : <ResponsiveTable rows={lista.filas} footer={<PieLista mostradas={lista.filas.length} total={lista.total} hayMas={lista.hayMas} cargando={lista.cargando} cargarMas={lista.cargarMas} />} columns={cols} rowKey={(m) => m.id} onRowClick={(m) => setSel(m.id)} cardTitle={(m) => <span className="num">{m.numero}</span>}
            cardBadge={(m) => <EstadoBadge estado={m.estado} />} cardMeta={(m) => `${m.cliente.razonSocial} · ${fmtFecha(m.fechaServicio)}`} empty="No hay manifiestos con estos filtros." />}
      <DetalleManifiesto id={sel} onClose={() => setSel(null)} onCambio={lista.recargar} />
    </>
  );
}

function DetalleManifiesto({ id, onClose, onCambio }: { id: string | null; onClose: () => void; onCambio: () => void }) {
  const toast = useToast();
  const { go } = useRouter();
  const cat = useCatalogos();
  const d = useApi<MfDetalle>(id ? `/manifiestos/${id}` : null);
  const [anular, setAnular] = useState(false);
  const [causal, setCausal] = useState('');
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const archivo = useRef<HTMLInputElement>(null);
  useEffect(() => { setAnular(false); setCausal(''); setMotivo(''); }, [id]);
  const m = id && d.datos?.id === id ? d.datos : null;

  const hacer = async (fn: () => Promise<unknown>, ok: string) => {
    setOcupado(true);
    try { await fn(); toast(ok); d.recargar(); onCambio(); } catch (e) { toast(msg(e), 'warn'); } finally { setOcupado(false); }
  };
  const enviarAnular = () => m && hacer(async () => {
    await api(`/manifiestos/${m.id}/anular`, { cuerpo: { causalId: causal || undefined, motivo: motivo.trim() || undefined } }); setAnular(false);
  }, `Manifiesto ${m.numero} anulado: sus líneas vuelven a pendientes.`);
  const subirPdf = (file: File) => m && hacer(async () => {
    const form = new FormData(); form.append('archivo', file); form.append('tipo', 'PDF');
    await api(`/manifiestos/${m.id}/evidencias`, { form });
  }, 'PDF adjuntado al manifiesto.');
  const irConciliacion = () => { if (!m?.conciliacion) return; try { sessionStorage.setItem(CONC_OFICINA, m.conciliacion.id); } catch { /* sin almacenamiento */ } go('recepcion'); };
  const fotos = m?.evidencias.filter((e) => e.tipo === 'FOTO') ?? [];
  const pdfs = m?.evidencias.filter((e) => e.tipo === 'PDF') ?? [];
  const puedeAnular = tienePermiso('manifiestos.anular') && m && m.estado !== 'ANULADO';

  return (
    <Sheet open={!!id} onClose={onClose} title={m ? <span>Manifiesto <span className="num">{m.numero}</span></span> : 'Manifiesto'}
      footer={m && (anular
        ? <><Button onClick={() => setAnular(false)}>Volver</Button><Button variant="danger" disabled={ocupado || (!causal && motivo.trim().length < 3)} onClick={enviarAnular}><Ban size={16} /> Anular</Button></>
        : <>
            <Button onClick={() => verPdf(`/manifiestos/${m.id}/pdf`).catch((x) => toast(msg(x), 'warn'))}><FileText size={16} /> PDF</Button>
            {m.tipo === 'DESCARGUE' && m.estado !== 'PENDIENTE' && <Button onClick={() => verPdf(`/manifiestos/${m.id}/recibo`).catch((x) => toast(msg(x), 'warn'))}><Printer size={16} /> Recibo</Button>}
            {m.conciliacion && <Button onClick={irConciliacion}><Scale size={16} /> Conciliación</Button>}
            {tienePermiso('manifiestos.operar') && m.estado !== 'ANULADO' && !pdfs.length && <Button disabled={ocupado} onClick={() => archivo.current?.click()}><Paperclip size={16} /> Adjuntar PDF</Button>}
            {puedeAnular && <Button variant="ghost" onClick={() => setAnular(true)}><Ban size={16} /> Anular</Button>}
          </>)}>
      <input ref={archivo} type="file" accept="application/pdf" className="hidden" onChange={(e) => { const x = e.target.files?.[0]; e.target.value = ''; if (x) subirPdf(x); }} />
      {d.error && <p className="rounded-lg bg-bad/10 p-3 text-bad">{d.error}</p>}
      {!m ? !d.error && <p className="p-6 text-center text-muted">Cargando…</p> : anular ? (
        <div className="flex flex-col gap-4">
          <p className="flex gap-2 rounded-lg bg-warn/10 p-3 text-[13px] text-warn"><AlertTriangle size={16} className="mt-px shrink-0" />Al anular, las líneas vuelven a «por programar» y, si ya estaba realizado, se borra su conciliación en borrador. No se puede anular si la conciliación ya fue aprobada.</p>
          <Field label="Causal" id="an-c"><Select id="an-c" value={causal} onChange={(e) => setCausal(e.target.value)}><option value="">Elija la causal (o escriba el motivo)</option>{cat?.causales.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</Select></Field>
          <Field label="Motivo" id="an-m"><Input id="an-m" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} placeholder="Ej.: el cliente canceló antes de la salida" /></Field>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <DefList items={[
            ['Estado', <EstadoBadge estado={m.estado} />],
            ['Tipo', `${TIPO[m.tipo]} · conciliación ${m.tipoConciliacion === 'INTERNA' ? 'interna' : 'externa'}`],
            ['Servicio', fmtFecha(m.fechaServicio)],
            ['Cliente', `${m.cliente.razonSocial} · NIT ${m.cliente.nit}${m.cliente.dv ? `-${m.cliente.dv}` : ''}`],
            ['Destino', m.destino.razonSocial],
            ...(m.ruta ? [['Ruta', m.ruta.codigo]] as [string, string][] : []),
            ['Vehículo', m.vehiculo ? `${m.vehiculo.placa} · ${m.vehiculo.tipo}` : m.transporte ? `${m.transporte.placa ?? 'Sin placa'} · ${m.transporte.empresaTransportadora}${m.transporte.nit ? ` (NIT ${m.transporte.nit})` : ''}` : '—'],
            ['Conductor', m.conductor ? `${m.conductor.nombre} · CC ${m.conductor.documento}` : m.transporte?.conductorNombre ? `${m.transporte.conductorNombre}${m.transporte.conductorDocumento ? ` · CC ${m.transporte.conductorDocumento}` : ''}` : '—'],
            ...(m.transporte ? [['ARL / EPS', `${m.transporte.conductorArl?.nombre ?? 'Sin ARL'} / ${m.transporte.conductorEps?.nombre ?? 'Sin EPS'}`]] as [string, string][] : []),
            ['Auxiliar', m.auxiliar?.nombre ?? m.transporte?.auxiliarNombre ?? '—'],
            ['Llegada / salida', `${fechaHoraCo(m.horaLlegada)} / ${fechaHoraCo(m.horaSalida)}`],
            ['Báscula (kg)', m.pesoEntrada || m.pesoSalida ? `Lleno ${cant(m.pesoEntrada)} · vacío ${cant(m.pesoSalida)} · neto ${cant(m.pesoNeto)}` : '—'],
            ...(m.ordenCompra ? [['Orden de compra', m.ordenCompra]] as [string, string][] : []),
            ...(m.manifiestoCliente ? [['Documento del cliente', m.manifiestoCliente]] as [string, string][] : []),
            ...(m.observaciones ? [['Observaciones', m.observaciones]] as [string, string][] : []),
            ...(m.realizadoEn ? [['Grabado', `${fechaHoraCo(m.realizadoEn)} · firmó ${m.firmaNombre ?? ''}${m.firmaDocumento ? ` (CC ${m.firmaDocumento})` : ''}`]] as [string, string][] : []),
            ...(m.estado === 'ANULADO' ? [['Anulación', `${fechaHoraCo(m.anuladoEn)} · ${[m.causalAnulacion?.nombre, m.motivoAnulacion].filter(Boolean).join(' · ')}`]] as [string, string][] : []),
          ]} />
          {(m.firmaUrl || m.firmaReceptorUrl) && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {m.firmaReceptorUrl && <div><p className="mb-1 text-[12px] text-muted">Recibe por Terra Viva: {m.receptorNombre}{m.receptorDocumento ? ` (CC ${m.receptorDocumento})` : ''}</p><ImagenProtegida clave={m.firmaReceptorUrl} alt="Firma del receptor" className="h-24 w-full rounded-lg border border-line bg-white object-contain" /></div>}
              {m.firmaUrl && <div><p className="mb-1 text-[12px] text-muted">{m.tipo === 'DESCARGUE' ? 'Entrega' : 'Conductor'}: {m.firmaNombre}</p><ImagenProtegida clave={m.firmaUrl} alt="Firma de quien entrega" className="h-24 w-full rounded-lg border border-line bg-white object-contain" /></div>}
            </div>
          )}

          <section className="flex flex-col gap-2">
            <h3 className="text-[13px] font-semibold uppercase tracking-[0.05em] text-muted">Residuos y servicios</h3>
            {m.items.map((i) => (
              <div key={i.id} className="rounded-xl border border-line p-3 text-[13px]">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">{i.declaracion.nombre}{i.declaracion.esPeligroso && <span className="ml-1.5"><Badge tone="bad">Peligroso</Badge></span>}</p>
                  <span className="num shrink-0 font-semibold">{cant(i.cantidad)} {i.metrica?.abreviacion ?? ''}</span>
                </div>
                <p className="text-muted">{i.sucursal.codigo ? `${i.sucursal.codigo} · ` : ''}{i.sucursal.nombre}{i.solicitudItem ? ` · Sol. ${i.solicitudItem.solicitud.numero}` : ''}</p>
                <p className="text-muted">{[i.disposicion?.nombre, i.embalajes !== null ? `${i.embalajes} ${i.tipoEmbalaje?.nombre ?? 'embalajes'}` : null, ...i.especificaciones.map((e) => e.especificacion.abreviatura ?? e.especificacion.nombre)].filter(Boolean).join(' · ')}</p>
                {i.precioUnitario && <p className="num mt-1 text-right">{fmtCOP(Number(i.precioUnitario))} × {cant(i.cantidad)} = <b>{fmtCOP(i.subtotal)}</b></p>}
              </div>
            ))}
            {m.total > 0 && <p className="num text-right text-sm">Total estimado: <b>{fmtCOP(m.total)}</b></p>}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-[13px] font-semibold uppercase tracking-[0.05em] text-muted">Evidencias</h3>
            {!fotos.length && !pdfs.length && <p className="text-[13px] text-subtle">Sin fotos ni documentos.</p>}
            {fotos.length > 0 && <div className="grid grid-cols-2 gap-2">{fotos.map((e) => <ImagenProtegida key={e.id} clave={e.url} alt={`Foto del ${fechaHoraCo(e.tomadaEn ?? e.createdAt)}`} className="aspect-[4/3] w-full rounded-lg border border-line object-cover" />)}</div>}
            {pdfs.map((e) => (
              <Button key={e.id} size="sm" className="self-start" onClick={() => abrirArchivo(e.url, e.nombreArchivo ?? 'documento.pdf').catch((x) => toast(msg(x), 'warn'))}><FileText size={15} /> {e.nombreArchivo ?? 'Documento PDF'}</Button>
            ))}
          </section>
        </div>
      )}
    </Sheet>
  );
}
