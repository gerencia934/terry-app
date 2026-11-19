// Torre de control: conciliación (bandeja y grilla editable). Lo cargado en la sede contra lo recibido en planta,
// con precios, negociación, factura y pago. Los totales se calculan con las mismas reglas que el API (@terraviva/shared).
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCheck, Download, Equal, RefreshCw, RotateCcw, Save, Scale, FileText, AlertTriangle } from 'lucide-react';
import { totalesConciliacion, diferenciaPct, valorLinea, TOLERANCIA_CONCILIACION_PCT, type LineaTotal, type Totales } from '@terraviva/shared';
import { FilterBar, ResponsiveTable, type Column } from '../../components/data';
import { BuscarCliente } from '../../components/BuscarCliente';
import { Badge, Button, Card, EstadoBadge, Field, Input, Kpi, PageHeader, Select, useToast } from '../../components/ui';
import { api, tienePermiso } from '../../lib/api';
import { useRouter } from '../../lib/router';
import { cx, fmtCOP, fmtFecha, fmtFechaCorta } from '../../lib/format';
import { cant, fechaHoraCo, hoyCo, msg, sumarDias, useApi, usePaginado, PieLista } from '../../lib/servidor';
import { pedirArchivo } from '../../lib/trabajos';
import { CONC_OFICINA, MF_OFICINA, } from './comun';

type Negociacion = 'COBRO' | 'COMPRA' | 'SIN_COSTO' | 'CONTRATO';
type Forma = 'CONTADO' | 'CREDITO_30' | 'CREDITO_60' | 'CREDITO_90';
interface LineaConc {
  id: string; cantidadCargada: string; cantidadConciliada: string | null; precioUnitario: string | null; tipoNegociacion: Negociacion | null; formaPago: Forma | null;
  ordenCompra: string | null; facturaNumero: string | null; facturaEmision: string | null; facturaVencimiento: string | null; estadoPago: 'PENDIENTE' | 'ABONADA' | 'PAGADA' | 'ANULADA';
  justificacion: string | null; metrica: { abreviacion: string } | null; disposicion: { nombre: string } | null; acta: { numero: string; estado: string } | null;
  manifiestoItem: { metrica: { abreviacion: string } | null; declaracion: { nombre: string; codigoInterno: string | null }; sucursal: { codigo: string | null; nombre: string } };
}
interface ConcDetalle {
  id: string; estado: 'BORRADOR' | 'APROBADA'; aprobadaEn: string | null; aprobadaPor: { nombre: string } | null;
  manifiesto: { id: string; numero: string; tipo: string; fechaServicio: string; tipoConciliacion: string; ordenCompra: string | null; pesoEntrada: string | null; pesoSalida: string | null; pesoNeto: string | null;
    cliente: { razonSocial: string; nit: string; asesor: { nombre: string } | null } };
  items: LineaConc[]; totales: Totales;
}
interface ConcFila {
  id: string; estado: 'BORRADOR' | 'APROBADA'; totales: Totales;
  manifiesto: { id: string; numero: string; fechaServicio: string; tipoConciliacion: string; cliente: { razonSocial: string; asesor: { nombre: string } | null }; destino: { razonSocial: string }; sedes: string[] };
}
interface Consolidado { conciliaciones: number; totales: Totales }

const NEGOCIACION: Record<Negociacion, string> = { COBRO: 'Cobro', COMPRA: 'Compra', SIN_COSTO: 'Sin costo', CONTRATO: 'Por contrato' };
const FORMA: Record<Forma, string> = { CONTADO: 'Contado', CREDITO_30: 'Crédito 30 días', CREDITO_60: 'Crédito 60 días', CREDITO_90: 'Crédito 90 días' };
const PAGO = { PENDIENTE: 'Pendiente', ABONADA: 'Abonada', PAGADA: 'Pagada', ANULADA: 'Anulada' };
const unidadDe = (l: LineaConc) => l.metrica?.abreviacion ?? l.manifiestoItem.metrica?.abreviacion ?? null;
const porUnidad = (t: Totales, campo: 'cargado' | 'conciliado') => t.porUnidad.map((u) => `${cant(u[campo])} ${u.unidad}`).join(' · ') || '—';

// =====================================================================
// Bandeja
// =====================================================================
export function ConciliacionServidor() {
  const [abierta, setAbierta] = useState<string | null>(null);
  useEffect(() => { try { const id = sessionStorage.getItem(CONC_OFICINA); if (id) { sessionStorage.removeItem(CONC_OFICINA); setAbierta(id); } } catch { /* sin almacenamiento */ } }, []);
  return abierta ? <Grilla id={abierta} volver={() => setAbierta(null)} /> : <Bandeja abrir={setAbierta} />;
}

function Bandeja({ abrir }: { abrir: (id: string) => void }) {
  const hoy = hoyCo();

  const base = { estado: 'BORRADOR', desde: sumarDias(hoy, -60), hasta: hoy, clienteId: '', manifiesto: '' };
  const [f, setF] = useState(base);
  const [mf, setMf] = useState('');
  const filtros = Object.fromEntries(Object.entries(f).filter(([, v]) => v));
  const lista = usePaginado<ConcFila>(`/conciliaciones?${new URLSearchParams(filtros)}`);
  const cons = useApi<Consolidado>(`/conciliaciones/consolidado?${new URLSearchParams(filtros)}`);
  const activos = Object.entries(f).filter(([k, v]) => v !== (base as Record<string, string>)[k]).length;
  const cols: Column<ConcFila>[] = [
    { key: 'mf', header: 'Manifiesto', render: (c) => <span className="num font-medium">{c.manifiesto.numero}</span>, priority: 3 },
    { key: 'fecha', header: 'Servicio', render: (c) => <span className="num">{fmtFechaCorta(c.manifiesto.fechaServicio)}</span>, priority: 1 },
    { key: 'cli', header: 'Cliente', render: (c) => <span className="block max-w-[220px] truncate">{c.manifiesto.cliente.razonSocial}</span>, priority: 3 },
    { key: 'ase', header: 'Asesor', render: (c) => c.manifiesto.cliente.asesor?.nombre ?? '—', priority: 3 },
    { key: 'sede', header: 'Generador', render: (c) => <span className="block max-w-[180px] truncate">{c.manifiesto.sedes.join(', ')}</span>, priority: 3 },
    { key: 'carg', header: 'Cargado', align: 'right', render: (c) => porUnidad(c.totales, 'cargado'), priority: 2 },
    { key: 'conc', header: 'Conciliado', align: 'right', render: (c) => porUnidad(c.totales, 'conciliado'), priority: 2 },
    { key: 'neto', header: 'Neto', align: 'right', render: (c) => fmtCOP(c.totales.neto), priority: 3 },
    { key: 'pend', header: 'Por completar', align: 'right', render: (c) => (c.totales.sinConciliar ? <Badge tone="warn">{c.totales.sinConciliar}</Badge> : '—'), priority: 3 },
    { key: 'est', header: 'Estado', render: (c) => <EstadoBadge estado={c.estado} />, priority: 3 },
  ];
  const t = cons.datos?.totales;
  return (
    <>
      <PageHeader eyebrow="Planta Los Pinos" title="Conciliación" subtitle={`Lo cargado en la sede contra lo recibido en planta, con precios y factura. Las diferencias de más de ±${TOLERANCIA_CONCILIACION_PCT} % se justifican; al aprobar se habilita el certificado.`}
        actions={<Button onClick={() => { lista.recargar(); cons.recargar(); }}><RefreshCw size={16} /> Actualizar</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Conciliaciones" value={cons.datos ? String(cons.datos.conciliaciones) : '…'} icon={<Scale size={16} />} hint="Con estos filtros" />
        <Kpi label="Cobro" value={t ? fmtCOP(t.cobro) : '…'} />
        <Kpi label="Compra" value={t ? fmtCOP(t.compra) : '…'} hint="Material que compra Terra Viva" />
        <Kpi label="Neto" value={t ? fmtCOP(t.neto) : '…'} hint="Cobro − compra" />
      </div>
      <FilterBar active={activos} onClear={() => { setF(base); setMf(''); }}>
        <Field label="Estado" id="cb-e"><Select id="cb-e" value={f.estado} onChange={(e) => setF((s) => ({ ...s, estado: e.target.value }))}><option value="">Todas</option><option value="BORRADOR">Borrador (por conciliar)</option><option value="APROBADA">Aprobadas</option></Select></Field>
        <Field label="Servicio desde" id="cb-d"><Input id="cb-d" type="date" value={f.desde} onChange={(e) => setF((s) => ({ ...s, desde: e.target.value }))} /></Field>
        <Field label="Hasta" id="cb-h"><Input id="cb-h" type="date" value={f.hasta} onChange={(e) => setF((s) => ({ ...s, hasta: e.target.value }))} /></Field>
        <Field label="Cliente" id="cb-c"><BuscarCliente id="cb-c" valor={f.clienteId} vacio="Todos" onChange={(c) => setF((s) => ({ ...s, clienteId: c?.id ?? '' }))} /></Field>
        <Field label="Manifiesto" id="cb-m"><Input id="cb-m" value={mf} onChange={(e) => setMf(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setF((s) => ({ ...s, manifiesto: mf.trim() }))} onBlur={() => setF((s) => ({ ...s, manifiesto: mf.trim() }))} placeholder="MF-…" /></Field>
      </FilterBar>
      {lista.error ? <p className="rounded-xl bg-bad/10 p-4 text-bad">{lista.error}</p>
        : !lista.filas ? <p className="p-6 text-center text-muted">Cargando…</p>
        : <ResponsiveTable rows={lista.filas} footer={<PieLista mostradas={lista.filas.length} total={lista.total} hayMas={lista.hayMas} cargando={lista.cargando} cargarMas={lista.cargarMas} />} columns={cols} rowKey={(c) => c.id} onRowClick={(c) => abrir(c.id)} cardTitle={(c) => <span className="num">{c.manifiesto.numero}</span>}
            cardBadge={(c) => <EstadoBadge estado={c.estado} />} cardMeta={(c) => `${c.manifiesto.cliente.razonSocial} · ${fmtFecha(c.manifiesto.fechaServicio)}`}
            empty={f.estado === 'BORRADOR' ? 'No hay conciliaciones por hacer con estos filtros. Se abren solas cuando el conductor graba el manifiesto.' : 'No hay conciliaciones con estos filtros.'} />}
    </>
  );
}

// =====================================================================
// Grilla de una conciliación
// =====================================================================
interface Editable {
  cantidadConciliada: string; precioUnitario: string; tipoNegociacion: string; formaPago: string; justificacion: string;
  ordenCompra: string; facturaNumero: string; facturaEmision: string; facturaVencimiento: string; estadoPago: string;
}
const CARTERA: (keyof Editable)[] = ['facturaNumero', 'facturaEmision', 'facturaVencimiento', 'estadoPago']; // lo único que cambia después de aprobar
const editable = (l: LineaConc): Editable => ({
  cantidadConciliada: l.cantidadConciliada ?? '', precioUnitario: l.precioUnitario ?? '', tipoNegociacion: l.tipoNegociacion ?? '', formaPago: l.formaPago ?? '',
  justificacion: l.justificacion ?? '', ordenCompra: l.ordenCompra ?? '', facturaNumero: l.facturaNumero ?? '', facturaEmision: l.facturaEmision?.slice(0, 10) ?? '',
  facturaVencimiento: l.facturaVencimiento?.slice(0, 10) ?? '', estadoPago: l.estadoPago,
});
const celda = 'h-8 w-full min-w-0 rounded-md border border-line bg-surface px-2 text-[13px] text-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted';

function Grilla({ id, volver }: { id: string; volver: () => void }) {
  const toast = useToast();
  const { go } = useRouter();
  const d = useApi<ConcDetalle>(`/conciliaciones/${id}`);
  const [cambios, setCambios] = useState<Record<string, Partial<Editable>>>({});
  const [ocupado, setOcupado] = useState(false);
  const c = d.datos;
  const aprobada = c?.estado === 'APROBADA';
  const gestiona = tienePermiso('conciliaciones.gestionar');
  const aprueba = tienePermiso('conciliaciones.aprobar');
  // Factura y pago: solo los ven Comercial, Facturación y Gerencia, y solo Facturación los registra
  const veFactura = tienePermiso('finanzas.ver'), registraFactura = tienePermiso('finanzas.gestionar');

  const valores = useMemo(() => new Map((c?.items ?? []).map((l) => [l.id, { ...editable(l), ...cambios[l.id] }])), [c, cambios]);
  const sucias = (c?.items ?? []).filter((l) => { const o = editable(l); const v = valores.get(l.id)!; return (Object.keys(o) as (keyof Editable)[]).some((k) => o[k] !== v[k]); });
  const dif = (l: LineaConc) => diferenciaPct(l.cantidadCargada, valores.get(l.id)!.cantidadConciliada || null);
  const sinJustificar = (l: LineaConc) => { const p = dif(l); return p !== null && Math.abs(p) > TOLERANCIA_CONCILIACION_PCT && !valores.get(l.id)!.justificacion.trim(); };
  const aTotal = (l: LineaConc): LineaTotal => {
    const v = valores.get(l.id)!;
    return { cantidadCargada: l.cantidadCargada, cantidadConciliada: v.cantidadConciliada || null, precioUnitario: v.precioUnitario || null, unidad: unidadDe(l),
      tipoNegociacion: (v.tipoNegociacion || null) as Negociacion | null, formaPago: (v.formaPago || null) as Forma | null };
  };
  const totales = c ? totalesConciliacion(c.items.map(aTotal), [c.manifiesto]) : null;
  const faltan = c?.items.filter(sinJustificar).length ?? 0;
  const set = (lid: string, k: keyof Editable, v: string) => setCambios((s) => ({ ...s, [lid]: { ...s[lid], [k]: v } }));
  const bloqueado = (k: keyof Editable) => (CARTERA.includes(k) ? !registraFactura : !gestiona || aprobada);

  const ejecutar = async (fn: () => Promise<ConcDetalle>, ok: string) => {
    setOcupado(true);
    try { d.setDatos(await fn()); setCambios({}); toast(ok); } catch (e) { toast(msg(e), 'warn'); } finally { setOcupado(false); }
  };
  const guardar = () => {
    if (faltan) { toast(`Justifique las diferencias de más de ±${TOLERANCIA_CONCILIACION_PCT} % (${faltan} ${faltan === 1 ? 'línea' : 'líneas'}).`, 'warn'); return; }
    const items = sucias.map((l) => {
      const o = editable(l); const v = valores.get(l.id)!; const x: Record<string, unknown> = { id: l.id };
      for (const k of Object.keys(o) as (keyof Editable)[]) if (o[k] !== v[k]) {
        x[k] = k === 'cantidadConciliada' || k === 'precioUnitario' ? (v[k] === '' ? null : Number(v[k])) : k === 'estadoPago' ? v[k] : v[k].trim() === '' ? null : v[k].trim();
      }
      return x;
    });
    return ejecutar(() => api<ConcDetalle>(`/conciliaciones/${id}/items`, { metodo: 'PATCH', cuerpo: { items } }), `${items.length} ${items.length === 1 ? 'línea guardada' : 'líneas guardadas'}.`);
  };
  const irManifiesto = () => { if (!c) return; try { sessionStorage.setItem(MF_OFICINA, c.manifiesto.id); } catch { /* sin almacenamiento */ } go('manifiestos'); };
  const excel = () => c && pedirArchivo(`/conciliaciones/${id}/excel`).then(() => toast('Preparando el Excel: se descarga solo cuando esté listo.')).catch((e) => toast(msg(e), 'warn'));

  if (d.error) return <><Button variant="ghost" onClick={volver}><ArrowLeft size={16} /> Bandeja</Button><p className="mt-3 rounded-xl bg-bad/10 p-4 text-bad">{d.error}</p></>;
  if (!c || !totales) return <p className="p-6 text-center text-muted">Cargando…</p>;

  /** Un campo editable de la línea (se usa en la tabla de escritorio y en las tarjetas del celular). */
  const campo = (l: LineaConc, k: keyof Editable, etiqueta: string) => {
    const v = valores.get(l.id)![k]; const dis = bloqueado(k) || ocupado; const idc = `cc-${l.id}-${k}`;
    const cambio = (e: { target: { value: string } }) => set(l.id, k, e.target.value);
    if (k === 'tipoNegociacion') return <select id={idc} aria-label={etiqueta} className={celda} value={v} disabled={dis} onChange={cambio}><option value="">—</option>{Object.entries(NEGOCIACION).map(([a, b]) => <option key={a} value={a}>{b}</option>)}</select>;
    if (k === 'formaPago') return <select id={idc} aria-label={etiqueta} className={celda} value={v} disabled={dis} onChange={cambio}><option value="">—</option>{Object.entries(FORMA).map(([a, b]) => <option key={a} value={a}>{b}</option>)}</select>;
    if (k === 'estadoPago') return <select id={idc} aria-label={etiqueta} className={celda} value={v} disabled={dis} onChange={cambio}>{Object.entries(PAGO).map(([a, b]) => <option key={a} value={a}>{b}</option>)}</select>;
    const num = k === 'cantidadConciliada' || k === 'precioUnitario'; const fecha = k === 'facturaEmision' || k === 'facturaVencimiento';
    return <input id={idc} aria-label={etiqueta} className={cx(celda, num && 'num text-right', k === 'justificacion' && sinJustificar(l) && 'border-bad ring-2 ring-bad/20')} value={v} disabled={dis} onChange={cambio}
      type={num ? 'number' : fecha ? 'date' : 'text'} min={num ? 0 : undefined} step={num ? '0.01' : undefined} maxLength={k === 'justificacion' ? 500 : k === 'ordenCompra' ? 40 : k === 'facturaNumero' ? 30 : undefined}
      placeholder={k === 'justificacion' && sinJustificar(l) ? 'Obligatoria' : undefined} />;
  };
  const Dif = ({ l }: { l: LineaConc }) => { const p = dif(l); return <span className={cx('num', p !== null && Math.abs(p) > TOLERANCIA_CONCILIACION_PCT ? 'font-semibold text-bad' : 'text-muted')}>{p === null ? '—' : `${p > 0 ? '+' : ''}${cant(p)} %`}</span>; };
  const valor = (l: LineaConc) => fmtCOP(valorLinea(aTotal(l)));
  const nombre = (l: LineaConc) => (
    <div className="min-w-0"><p className="truncate font-medium">{l.manifiestoItem.declaracion.nombre}</p>
      <p className="truncate text-[12px] text-muted">{l.manifiestoItem.sucursal.codigo ? `${l.manifiestoItem.sucursal.codigo} · ` : ''}{l.manifiestoItem.sucursal.nombre}{l.disposicion ? ` · ${l.disposicion.nombre}` : ''}</p></div>
  );

  return (
    <>
      <div className="mb-3"><Button variant="ghost" size="sm" onClick={volver}><ArrowLeft size={16} /> Bandeja de conciliación</Button></div>
      <PageHeader eyebrow="Conciliación" title={`Manifiesto ${c.manifiesto.numero}`}
        subtitle={`${c.manifiesto.cliente.razonSocial} · servicio del ${fmtFecha(c.manifiesto.fechaServicio)} · conciliación ${c.manifiesto.tipoConciliacion === 'INTERNA' ? 'interna' : 'externa'}${c.manifiesto.cliente.asesor ? ` · asesor ${c.manifiesto.cliente.asesor.nombre}` : ''}`}
        actions={<>
          <Button onClick={irManifiesto}><FileText size={16} /> Manifiesto</Button>
          <Button onClick={excel}><Download size={16} /> Excel</Button>
          {gestiona && !aprobada && <Button disabled={ocupado || sucias.length > 0} title={sucias.length ? 'Guarde los cambios primero' : 'Copia la cantidad cargada en las líneas sin cantidad conciliada'}
            onClick={() => ejecutar(() => api<ConcDetalle>(`/conciliaciones/${id}/igualar`, { cuerpo: { todas: false } }), 'Cantidades igualadas a lo cargado.')}><Equal size={16} /> Igualar cantidades</Button>}
          {gestiona && <Button variant={sucias.length ? 'primary' : 'secondary'} disabled={ocupado || !sucias.length} onClick={guardar}><Save size={16} /> Guardar{sucias.length ? ` (${sucias.length})` : ''}</Button>}
          {aprueba && !aprobada && <Button variant="primary" disabled={ocupado || sucias.length > 0 || totales.sinConciliar > 0 || faltan > 0}
            title={sucias.length ? 'Guarde los cambios primero' : totales.sinConciliar ? 'Hay líneas sin cantidad conciliada o sin precio' : undefined}
            onClick={() => ejecutar(() => api<ConcDetalle>(`/conciliaciones/${id}/aprobar`, { cuerpo: {} }), 'Conciliación aprobada: ya se puede certificar.')}><CheckCheck size={16} /> Aprobar</Button>}
          {aprueba && aprobada && <Button disabled={ocupado} onClick={() => ejecutar(() => api<ConcDetalle>(`/conciliaciones/${id}/reabrir`, { cuerpo: {} }), 'Conciliación reabierta en borrador.')}><RotateCcw size={16} /> Reabrir</Button>}
        </>} />

      <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
        <EstadoBadge estado={c.estado} />
        {aprobada && <span className="text-muted">Aprobada {fechaHoraCo(c.aprobadaEn)}{c.aprobadaPor ? ` por ${c.aprobadaPor.nombre}` : ''}. Solo se pueden cambiar la factura y el pago.</span>}
        {!aprobada && totales.sinConciliar > 0 && <span className="text-warn">{totales.sinConciliar} {totales.sinConciliar === 1 ? 'línea sin' : 'líneas sin'} cantidad conciliada o precio.</span>}
        {faltan > 0 && <span className="flex items-center gap-1 text-bad"><AlertTriangle size={14} />{faltan} {faltan === 1 ? 'diferencia' : 'diferencias'} de más de ±{TOLERANCIA_CONCILIACION_PCT} % sin justificar.</span>}
        {!gestiona && <Badge>Su rol solo consulta</Badge>}
      </div>

      {/* Escritorio: grilla */}
      <div className="hidden rounded-xl border border-line bg-surface md:block">
        <div className="scroll-x">
          <table className="w-full min-w-[1650px] border-collapse text-[13px]">
            <thead className="bg-surface-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted">
              <tr>
                {['Generador y residuo', 'Cargado', 'Conciliado', 'Dif.', 'Precio unitario', 'Valor', 'Negociación', 'Forma de pago', 'Justificación', 'Orden de compra', 'Factura', 'Emisión', 'Vencimiento', 'Pago', 'Acta']
                  .filter((h) => veFactura || !['Factura', 'Emisión', 'Vencimiento', 'Pago'].includes(h))
                  .map((h, i) => <th key={h} className={cx('whitespace-nowrap px-2 py-2.5 text-left', [1, 2, 3, 4, 5].includes(i) && 'text-right')}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {c.items.map((l) => (
                <tr key={l.id} className={cx('border-t border-line align-middle', sucias.includes(l) && 'bg-brand-soft/30')}>
                  <td className="w-[240px] max-w-[240px] px-2 py-2">{nombre(l)}</td>
                  <td className="num whitespace-nowrap px-2 text-right">{cant(l.cantidadCargada)} <span className="text-muted">{unidadDe(l) ?? ''}</span></td>
                  <td className="w-[110px] px-2">{campo(l, 'cantidadConciliada', 'Cantidad conciliada')}</td>
                  <td className="whitespace-nowrap px-2 text-right"><Dif l={l} /></td>
                  <td className="w-[120px] px-2">{campo(l, 'precioUnitario', 'Precio unitario')}</td>
                  <td className="num whitespace-nowrap px-2 text-right font-medium">{valor(l)}</td>
                  <td className="w-[110px] px-2">{campo(l, 'tipoNegociacion', 'Negociación')}</td>
                  <td className="w-[140px] px-2">{campo(l, 'formaPago', 'Forma de pago')}</td>
                  <td className="w-[200px] px-2">{campo(l, 'justificacion', 'Justificación')}</td>
                  <td className="w-[120px] px-2">{campo(l, 'ordenCompra', 'Orden de compra')}</td>
                  {veFactura && <>
                    <td className="w-[110px] px-2">{campo(l, 'facturaNumero', 'Factura')}</td>
                    <td className="w-[140px] px-2">{campo(l, 'facturaEmision', 'Emisión de la factura')}</td>
                    <td className="w-[140px] px-2">{campo(l, 'facturaVencimiento', 'Vencimiento de la factura')}</td>
                    <td className="w-[110px] px-2">{campo(l, 'estadoPago', 'Estado del pago')}</td>
                  </>}
                  <td className="num whitespace-nowrap px-2">{l.acta ? `${l.acta.numero}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Celular: una tarjeta por línea */}
      <div className="flex flex-col gap-3 md:hidden">
        {c.items.map((l) => (
          <article key={l.id} className={cx('flex flex-col gap-3 rounded-xl border bg-surface p-3.5', sucias.includes(l) ? 'border-brand' : 'border-line')}>
            {nombre(l)}
            <div className="flex justify-between text-[13px]"><span>Cargado <b className="num">{cant(l.cantidadCargada)} {unidadDe(l) ?? ''}</b></span><Dif l={l} /><span className="num font-medium">{valor(l)}</span></div>
            <div className="grid grid-cols-2 gap-2.5">
              {([['cantidadConciliada', 'Conciliado'], ['precioUnitario', 'Precio unitario'], ['tipoNegociacion', 'Negociación'], ['formaPago', 'Forma de pago'],
                ['facturaNumero', 'Factura'], ['estadoPago', 'Pago'], ['facturaEmision', 'Emisión'], ['facturaVencimiento', 'Vencimiento']] as [keyof Editable, string][])
                .filter(([k]) => veFactura || !CARTERA.includes(k)).map(([k, e]) => (
                <label key={k} className="flex min-w-0 flex-col gap-1 text-[12px] text-muted">{e}{campo(l, k, e)}</label>
              ))}
              <label className="col-span-2 flex flex-col gap-1 text-[12px] text-muted">Justificación{campo(l, 'justificacion', 'Justificación')}</label>
              <label className="col-span-2 flex flex-col gap-1 text-[12px] text-muted">Orden de compra{campo(l, 'ordenCompra', 'Orden de compra')}</label>
            </div>
          </article>
        ))}
      </div>

      {/* Totales: se recalculan mientras escribe */}
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card title="Cantidades por unidad">
          <ul className="flex flex-col gap-1.5 text-sm">
            {totales.porUnidad.map((u) => {
              const pend = c.items.filter((l) => (unidadDe(l) ?? 'sin unidad') === u.unidad && !valores.get(l.id)!.cantidadConciliada).length;
              return (
                <li key={u.unidad} className="num flex flex-wrap justify-between gap-x-3"><span className="text-muted">{u.unidad}</span>
                  {pend === c.items.filter((l) => (unidadDe(l) ?? 'sin unidad') === u.unidad).length
                    ? <span>{cant(u.cargado)} → <span className="text-warn">sin conciliar</span></span>
                    : <span>{cant(u.cargado)} → <b>{cant(u.conciliado)}</b> <span className={cx(u.diferencia ? 'text-warn' : 'text-muted')}>({u.diferencia > 0 ? '+' : ''}{cant(u.diferencia)})</span>{pend > 0 && <span className="text-warn"> · {pend} sin conciliar</span>}</span>}
                </li>
              );
            })}
          </ul>
        </Card>
        <Card title="Valores">
          <ul className="num flex flex-col gap-1.5 text-sm">
            <li className="flex justify-between"><span className="text-muted">Cobro</span><span>{fmtCOP(totales.cobro)}</span></li>
            <li className="flex justify-between"><span className="text-muted">Compra</span><span>{fmtCOP(totales.compra)}</span></li>
            <li className="flex justify-between border-t border-line pt-1.5 font-semibold"><span>Neto (cobro − compra)</span><span>{fmtCOP(totales.neto)}</span></li>
            <li className="flex justify-between"><span className="text-muted">Contado / crédito</span><span>{fmtCOP(totales.contado)} / {fmtCOP(totales.credito)}</span></li>
          </ul>
        </Card>
        <Card title="Báscula (kg)">
          <ul className="num flex flex-col gap-1.5 text-sm">
            <li className="flex justify-between"><span className="text-muted">Entrada (lleno)</span><span>{cant(totales.bascula.lleno)}</span></li>
            <li className="flex justify-between"><span className="text-muted">Salida (vacío)</span><span>{cant(totales.bascula.vacio)}</span></li>
            <li className="flex justify-between border-t border-line pt-1.5 font-semibold"><span>Neto</span><span>{cant(totales.bascula.neto)}</span></li>
          </ul>
        </Card>
      </div>
    </>
  );
}
