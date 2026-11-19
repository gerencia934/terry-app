// Facturación con Siigo Nube (gerencia, 19-11-2026): manifiestos sin facturar, por pagar y pagados, con sus facturas.
// Solo Comercial, Facturación (financiero) y Gerencia («finanzas.ver»); sincronizar, enlazar una factura y marcar un
// manifiesto sin cobro, «finanzas.gestionar». El servidor lo exige igual: esta pantalla solo evita mostrar lo que no toca.
import { useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, ExternalLink, Link2, Loader2, RefreshCw, Unlink, Unlock } from 'lucide-react';
import { REGLAS_CERTIFICADO, type ReglaCertificado } from '@terraviva/shared';
import { ResponsiveTable, FilterBar, type Column } from '../components/data';
import { Badge, Button, Card, DefList, Field, Input, Kpi, PageHeader, Sheet, Tabs, useToast, type Tone } from '../components/ui';
import { api, tienePermiso } from '../lib/api';
import { PieLista, fechaHoraCo, msg, useApi, usePaginado } from '../lib/servidor';
import { fmtCOP, fmtFecha, fmtNum } from '../lib/format';

type Estado = 'SIN_FACTURAR' | 'POR_PAGAR' | 'PAGADO' | 'LIBRE' | 'TODOS';
interface Factura { id: string; nombre: string; fecha: string; vence: string | null; total: string; saldo: string; estado: 'PENDIENTE' | 'ABONADA' | 'PAGADA' | 'ANULADA'; estadoDian: string | null; urlPublica: string | null }
interface Fila {
  id: string; numero: string; tipo: string; fechaServicio: string; dias: number;
  cliente: { id: string; razonSocial: string; nit: string; reglaCertificado: ReglaCertificado; tipoNegociacion: string };
  finanzas: { facturado: boolean; estadoPago: 'PENDIENTE' | 'PAGADO' | 'LIBRE'; facturas: string[]; saldo: string | null; vence: string | null;
    libreMotivo: string | null; libreEn: string | null; librePor: { nombre: string } | null; actualizadoEn: string } | null;
  facturas: { origen: 'CITADO' | 'NUMERO' | 'MANUAL'; factura: Factura }[];
}
interface Sincronizacion { id: string; origen: string; estado: 'EN_CURSO' | 'LISTA' | 'FALLIDA'; iniciadaEn: string; terminadaEn: string | null; facturas: number; enlazadas: number; avisos: string[]; error: string | null; usuario: string | null }
interface EstadoSiigo { configurado: boolean; diaria: boolean; hora: number; ultima: Sincronizacion | null; ultimaLista: { terminadaEn: string; facturas: number; enlazadas: number } | null }
interface Resumen { sinFacturar: number; sinFacturarAtrasados: number; diasParaFacturar: number; porPagar: number; pagados: number; libres: number; saldoPendiente: string; facturasPendientes: number; siigo: EstadoSiigo }

const ESTADO_FACTURA: Record<Factura['estado'], [string, Tone]> = { PENDIENTE: ['Pendiente', 'warn'], ABONADA: ['Abonada', 'info'], PAGADA: ['Pagada', 'ok'], ANULADA: ['Anulada', 'neutral'] };
const ORIGEN: Record<'CITADO' | 'NUMERO' | 'MANUAL', string> = { CITADO: 'la factura cita el manifiesto', NUMERO: 'su número está en la conciliación', MANUAL: 'enlazada a mano' };
const estadoFila = (m: Fila): [string, Tone] => !m.finanzas || (!m.finanzas.facturado && m.finanzas.estadoPago !== 'LIBRE') ? ['Sin facturar', m.dias > 5 ? 'bad' : 'warn']
  : m.finanzas.estadoPago === 'LIBRE' ? ['Sin cobro', 'neutral'] : m.finanzas.estadoPago === 'PAGADO' ? ['Pagado', 'ok'] : ['Por pagar', 'info'];

export function FacturacionServidor() {
  const toast = useToast();
  const gestiona = tienePermiso('finanzas.gestionar');
  const resumen = useApi<Resumen>('/finanzas/resumen');
  const [estado, setEstado] = useState<Estado>('SIN_FACTURAR');
  const [texto, setTexto] = useState('');
  const [q, setQ] = useState('');
  const qs = new URLSearchParams({ estado, ...(q && { q }) }).toString();
  const lista = usePaginado<Fila>(`/finanzas/manifiestos?${qs}`);
  const [sel, setSel] = useState<Fila | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  const siigo = resumen.datos?.siigo;
  const enCurso = siigo?.ultima?.estado === 'EN_CURSO';

  // Mientras Siigo sincroniza, se revisa cada 4 segundos; al terminar se recargan las cifras y la lista
  useEffect(() => {
    if (!enCurso) return;
    const t = setInterval(async () => {
      const s = await api<EstadoSiigo>('/finanzas/siigo').catch(() => null);
      if (s && s.ultima?.estado !== 'EN_CURSO') {
        clearInterval(t); resumen.recargar(); lista.recargar();
        toast(s.ultima?.estado === 'LISTA' ? `Sincronización lista: ${fmtNum(s.ultima.facturas)} facturas revisadas.` : s.ultima?.error ?? 'La sincronización falló.', s.ultima?.estado === 'LISTA' ? 'ok' : 'warn');
      }
    }, 4000);
    return () => clearInterval(t);
  }, [enCurso]); // eslint-disable-line react-hooks/exhaustive-deps

  const sincronizar = async () => {
    setSincronizando(true);
    try { await api('/finanzas/siigo/sincronizar', { cuerpo: {} }); toast('Sincronizando con Siigo: tarda unos segundos.'); resumen.recargar(); }
    catch (e) { toast(msg(e, 'No se pudo sincronizar.'), 'warn'); }
    setSincronizando(false);
  };

  const cols: Column<Fila>[] = [
    { key: 'n', header: 'Manifiesto', render: (m) => <span className="num font-medium">{m.numero}</span>, priority: 3 },
    { key: 'f', header: 'Servicio', render: (m) => <span className="flex flex-col"><span className="whitespace-nowrap">{fmtFecha(m.fechaServicio.slice(0, 10))}</span><span className="text-[12px] text-muted">hace {m.dias} {m.dias === 1 ? 'día' : 'días'}</span></span>, priority: 2 },
    { key: 'c', header: 'Cliente', render: (m) => <span className="flex max-w-[260px] flex-col"><span className="truncate">{m.cliente.razonSocial}</span><span className="text-[12px] text-muted">{REGLAS_CERTIFICADO[m.cliente.reglaCertificado].nombre}</span></span>, priority: 3 },
    { key: 'fa', header: 'Facturas', render: (m) => (m.facturas.length || m.finanzas?.facturas.length
      ? <span className="flex flex-wrap gap-1">{m.facturas.map((x) => <Badge key={x.factura.id} tone={ESTADO_FACTURA[x.factura.estado][1]}>{x.factura.nombre}</Badge>)}
          {(m.finanzas?.facturas ?? []).filter((n) => !m.facturas.some((x) => x.factura.nombre === n)).map((n) => <Badge key={n}>{n}</Badge>)}</span>
      : '—'), priority: 2 },
    { key: 's', header: 'Saldo', align: 'right', render: (m) => (m.finanzas?.saldo && Number(m.finanzas.saldo) > 0 ? <span className="num whitespace-nowrap">{fmtCOP(Number(m.finanzas.saldo))}</span> : '—'), priority: 1 },
    { key: 'v', header: 'Vence', render: (m) => (m.finanzas?.vence ? fmtFecha(m.finanzas.vence.slice(0, 10)) : '—'), priority: 1 },
    { key: 'e', header: 'Estado', render: (m) => { const [t, tono] = estadoFila(m); return <Badge tone={tono}>{t}</Badge>; }, priority: 3 },
  ];

  const r = resumen.datos;
  return (
    <>
      <PageHeader eyebrow="Comercial" title="Facturación" subtitle="Cruza los manifiestos realizados con las facturas de Siigo: cuáles faltan por facturar, cuáles están por pagar y cuáles están pagados. La regla del certificado de cada cliente usa esto."
        actions={gestiona ? <Button variant="primary" disabled={!siigo?.configurado || enCurso || sincronizando} onClick={sincronizar}>
          {enCurso || sincronizando ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}{enCurso ? 'Sincronizando…' : 'Sincronizar con Siigo'}</Button> : undefined} />
      {resumen.error && <p className="mb-3 rounded-xl bg-bad/10 p-3 text-bad">{resumen.error}</p>}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Sin facturar" value={r ? fmtNum(r.sinFacturar) : '…'} hint={r ? `${fmtNum(r.sinFacturarAtrasados)} con más de ${r.diasParaFacturar} días` : undefined} />
        <Kpi label="Facturados por pagar" value={r ? fmtNum(r.porPagar) : '…'} hint={r && Number(r.saldoPendiente) > 0 ? `Saldo ${fmtCOP(Number(r.saldoPendiente))}` : undefined} />
        <Kpi label="Pagados" value={r ? fmtNum(r.pagados) : '…'} />
        <Kpi label="Sin cobro" value={r ? fmtNum(r.libres) : '…'} hint="Marcados por facturación" />
      </div>
      <p className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
        {!siigo ? 'Consultando Siigo…' : !siigo.configurado ? <span className="text-warn">Siigo no está configurado en el servidor.</span>
          : <>
            <span>Siigo conectado{siigo.diaria ? ` · se sincroniza solo cada día desde las ${siigo.hora}:00` : ''}.</span>
            {siigo.ultimaLista && <span>Última sincronización: {fechaHoraCo(siigo.ultimaLista.terminadaEn)} ({fmtNum(siigo.ultimaLista.facturas)} facturas revisadas, {fmtNum(siigo.ultimaLista.enlazadas)} manifiestos con factura).</span>}
            {siigo.ultima?.estado === 'FALLIDA' && <span className="text-bad">La última falló: {siigo.ultima.error}</span>}
          </>}
      </p>
      {!!siigo?.ultima?.avisos?.length && (
        <details className="mb-4 rounded-xl border border-warn/30 bg-warn/5 px-4 py-2.5 text-[13px]">
          <summary className="flex cursor-pointer items-center gap-2 font-medium text-warn"><AlertTriangle size={15} />{siigo.ultima.avisos.length} {siigo.ultima.avisos.length === 1 ? 'aviso' : 'avisos'} de la última sincronización</summary>
          <ul className="mt-2 list-disc pl-5 text-muted">{siigo.ultima.avisos.slice(0, 30).map((x) => <li key={x}>{x}</li>)}</ul>
        </details>
      )}
      <div className="mb-3"><Tabs value={estado} onChange={(v) => setEstado(v as Estado)} items={[
        { value: 'SIN_FACTURAR', label: 'Sin facturar', count: r?.sinFacturar }, { value: 'POR_PAGAR', label: 'Por pagar', count: r?.porPagar },
        { value: 'PAGADO', label: 'Pagados' }, { value: 'LIBRE', label: 'Sin cobro' }, { value: 'TODOS', label: 'Todos' },
      ]} /></div>
      <FilterBar active={Number(!!q)} onClear={() => { setQ(''); setTexto(''); }}>
        <Field label="Buscar" id="fa-q"><Input id="fa-q" value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setQ(texto.trim())} onBlur={() => setQ(texto.trim())} placeholder="Manifiesto o cliente · Enter" /></Field>
      </FilterBar>
      {lista.error ? <p className="rounded-xl bg-bad/10 p-4 text-bad">{lista.error}</p> : !lista.filas ? <p className="p-6 text-center text-muted">Cargando…</p>
        : <ResponsiveTable rows={lista.filas} columns={cols} rowKey={(m) => m.id} onRowClick={setSel} cardTitle={(m) => <span>Manifiesto <span className="num">{m.numero}</span></span>}
            cardBadge={(m) => { const [t, tono] = estadoFila(m); return <Badge tone={tono}>{t}</Badge>; }} cardMeta={(m) => `${m.cliente.razonSocial} · ${fmtFecha(m.fechaServicio.slice(0, 10))}`}
            empty={estado === 'SIN_FACTURAR' ? 'No hay manifiestos sin facturar.' : 'Sin manifiestos en este estado.'}
            footer={<PieLista mostradas={lista.filas.length} total={lista.total} hayMas={lista.hayMas} cargando={lista.cargando} cargarMas={lista.cargarMas} />} />}
      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel ? `Manifiesto ${sel.numero}` : ''}>
        {sel && <Detalle m={sel} gestiona={gestiona} listo={(m) => { setSel(m); lista.recargar(); resumen.recargar(); }} />}
      </Sheet>
    </>
  );
}

function Detalle({ m, gestiona, listo }: { m: Fila; gestiona: boolean; listo: (m: Fila) => void }) {
  const toast = useToast();
  const [factura, setFactura] = useState('');
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const hacer = async (fn: () => Promise<Fila>, ok: string) => {
    setOcupado(true);
    try { listo(await fn()); toast(ok, 'ok'); } catch (e) { toast(msg(e, 'No se pudo guardar.'), 'warn'); }
    setOcupado(false);
  };
  const enlazar = (e: FormEvent) => { e.preventDefault(); void hacer(() => api<Fila>(`/finanzas/manifiestos/${m.id}/facturas`, { cuerpo: { factura: factura.trim() } }), `Factura ${factura.trim().toUpperCase()} enlazada.`).then(() => setFactura('')); };
  const libre = (e: FormEvent) => { e.preventDefault(); void hacer(() => api<Fila>(`/finanzas/manifiestos/${m.id}/libre`, { cuerpo: { motivo } }), 'Marcado sin cobro: ya no retiene el certificado.').then(() => setMotivo('')); };
  const [estado, tono] = estadoFila(m);
  return (
    <div className="flex flex-col gap-5">
      <p className="flex flex-wrap items-center gap-2"><Badge tone={tono}>{estado}</Badge><span className="text-[13px] text-muted">{m.cliente.razonSocial} · NIT {m.cliente.nit}</span></p>
      <DefList items={[
        ['Servicio', `${fmtFecha(m.fechaServicio.slice(0, 10))} (hace ${m.dias} ${m.dias === 1 ? 'día' : 'días'})`],
        ['Regla del certificado', REGLAS_CERTIFICADO[m.cliente.reglaCertificado].nombre],
        ...(m.finanzas?.libreEn ? [['Sin cobro', `${m.finanzas.libreMotivo ?? ''} · ${m.finanzas.librePor?.nombre ?? ''}, ${fechaHoraCo(m.finanzas.libreEn)}`]] as [string, string][] : []),
        ...(m.finanzas ? [['Actualizado', fechaHoraCo(m.finanzas.actualizadoEn)]] as [string, string][] : []),
      ]} />
      <Card title="Facturas">
        {!m.facturas.length && !m.finanzas?.facturas.length ? <p className="text-[13px] text-muted">Ninguna factura de Siigo lo cita todavía.</p> : (
          <ul className="flex flex-col gap-2">
            {m.facturas.map((x) => (
              <li key={x.factura.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-2.5 text-[13px]">
                <span className="flex flex-col">
                  <span className="flex items-center gap-2"><span className="num font-medium">{x.factura.nombre}</span><Badge tone={ESTADO_FACTURA[x.factura.estado][1]}>{ESTADO_FACTURA[x.factura.estado][0]}</Badge></span>
                  <span className="text-muted">{fmtFecha(x.factura.fecha.slice(0, 10))}{x.factura.vence ? ` · vence ${fmtFecha(x.factura.vence.slice(0, 10))}` : ''} · total {fmtCOP(Number(x.factura.total))}{Number(x.factura.saldo) > 0 ? ` · saldo ${fmtCOP(Number(x.factura.saldo))}` : ''}</span>
                  <span className="text-[12px] text-subtle">{ORIGEN[x.origen]}</span>
                </span>
                <span className="flex items-center gap-1">
                  {x.factura.urlPublica && <a href={x.factura.urlPublica} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] font-medium text-brand underline">Ver <ExternalLink size={13} /></a>}
                  {gestiona && x.origen === 'MANUAL' && <Button size="sm" variant="ghost" disabled={ocupado} aria-label={`Quitar el enlace de ${x.factura.nombre}`}
                    onClick={() => hacer(() => api<Fila>(`/finanzas/manifiestos/${m.id}/facturas/${x.factura.id}`, { metodo: 'DELETE' }), 'Enlace quitado.')}><Unlink size={14} /></Button>}
                </span>
              </li>
            ))}
            {(m.finanzas?.facturas ?? []).filter((n) => !m.facturas.some((x) => x.factura.nombre === n)).map((n) => (
              <li key={n} className="rounded-lg border border-line p-2.5 text-[13px]"><span className="num font-medium">{n}</span> <span className="text-muted">· registrada en la conciliación (no está en Siigo)</span></li>
            ))}
          </ul>
        )}
      </Card>
      {gestiona && (
        <>
          <form onSubmit={enlazar} className="flex flex-col gap-2">
            <Field label="Enlazar una factura de Siigo" id="fa-n" hint="Si la factura no cita este manifiesto. Debe ser del mismo cliente."><Input id="fa-n" value={factura} onChange={(e) => setFactura(e.target.value)} placeholder="FV-2-1234" maxLength={30} /></Field>
            <Button type="submit" className="self-start" disabled={ocupado || !factura.trim()}><Link2 size={14} /> Enlazar</Button>
          </form>
          {m.finanzas?.libreEn
            ? <Button className="self-start" disabled={ocupado} onClick={() => hacer(() => api<Fila>(`/finanzas/manifiestos/${m.id}/libre`, { metodo: 'DELETE' }), 'Ya no está marcado sin cobro.')}>Quitar «sin cobro»</Button>
            : <form onSubmit={libre} className="flex flex-col gap-2 border-t border-line pt-4">
                <Field label="Marcar sin cobro" id="fa-l" hint="Servicio gratuito, acuerdo especial o cortesía: deja de contar como pendiente y no retiene el certificado. Queda quién y por qué.">
                  <Input id="fa-l" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo" maxLength={300} /></Field>
                <Button type="submit" className="self-start" disabled={ocupado || motivo.trim().length < 5}><Unlock size={14} /> Marcar sin cobro</Button>
              </form>}
        </>
      )}
    </div>
  );
}
