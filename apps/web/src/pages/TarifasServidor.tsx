// Tarifas con datos reales (fase 1c). Cada cambio crea una vigencia nueva desde hoy o una fecha futura: un precio que
// ya pudo facturarse no se cambia (regla del API). El historial de cada declaración queda completo.
import { useCallback, useMemo, useState } from 'react';
import { CalendarClock, CheckSquare, History, Loader2, Tags } from 'lucide-react';
import { ResponsiveTable, FilterBar, type Column } from '../components/data';
import { Badge, Button, Card, Field, Input, PageHeader, Select, Sheet, Tabs, useToast } from '../components/ui';
import { BuscarCliente } from '../components/BuscarCliente';
import { api, ErrorApi, tienePermiso } from '../lib/api';
import { PieLista, hoyCo, useApi, usePaginado } from '../lib/servidor';
import { cx, fmtCOP, fmtFecha } from '../lib/format';

interface Tarifa {
  id: string; precioUnitario: string; vigenteDesde: string; vigenteHasta: string | null; tipoNegociacion: string; formaPago: string;
  metrica: { codigo: string; abreviacion: string } | null; asignadoPor?: { nombre: string } | null;
}
interface DeclTarifa {
  id: string; numero: number; tipo: 'RESIDUO' | 'SERVICIO'; estado: string; activa: boolean; nombre: string; codigoInterno: string | null;
  frecuenciaDias: number | null; cantidadFrecuencia: string | null;
  cliente: { id: string; razonSocial: string; nit: string }; sucursales: { sucursal: { codigo: string | null; nombre: string } }[];
  lineaServicio: { codigo: string; nombre: string };
  tarifaVigente: Tarifa | null; tarifaProgramada: Tarifa | null;
}
const NEG: Record<string, string> = { COBRO: 'Cobro', COMPRA: 'Compra', SIN_COSTO: 'Sin costo', CONTRATO: 'Por contrato' };
const PAGO: Record<string, string> = { CONTADO: 'Contado', CREDITO_30: 'Crédito 30 d', CREDITO_60: 'Crédito 60 d', CREDITO_90: 'Crédito 90 d' };
const precio = (t: Tarifa | null) => (t ? `${fmtCOP(Number(t.precioUnitario))}${t.metrica ? ` / ${t.metrica.abreviacion}` : ' (global)'}` : '—');
/** Precio sobre el que se calcula un ajuste: el último asignado (el programado, si lo hay). */
const base = (d: DeclTarifa) => d.tarifaProgramada ?? d.tarifaVigente;
/** Cantidad estimada en un mes, con la cantidad por frecuencia de la declaración. */
const porMes = (d: DeclTarifa) => {
  const c = Number(d.cantidadFrecuencia ?? 0);
  return c > 0 ? (d.frecuenciaDias ? (c * 30) / d.frecuenciaDias : c) : 0;
};
const primeroDelMesSiguiente = () => { const [y, m] = hoyCo().split('-').map(Number); return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10); };

export function TarifasServidor() {
  const toast = useToast();
  const puedeAsignar = tienePermiso('tarifas.asignar');
  const catalogos = useApi<{ lineas: { id: string; codigo: string; nombre: string }[] }>('/declaraciones/catalogos');
  const [tipo, setTipo] = useState<'RESIDUO' | 'SERVICIO'>('RESIDUO');
  const vacio = { clienteId: '', lineaServicioId: '', negociacion: '', formaPago: '', estado: 'autorizadas' };
  const [f, setF] = useState(vacio);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF((s) => ({ ...s, [k]: e.target.value })); setSel(new Set()); };
  const qs = new URLSearchParams({ tipo, ...(f.clienteId && { clienteId: f.clienteId }), ...(f.lineaServicioId && { lineaServicioId: f.lineaServicioId }),
    ...(f.negociacion && { negociacion: f.negociacion }), ...(f.formaPago && { formaPago: f.formaPago }),
    ...(f.estado === 'autorizadas' ? { estado: 'AUTORIZADA', activa: 'true' } : f.estado === 'pendientes' ? { estado: 'PENDIENTE' } : {}) }).toString();
  const lista = usePaginado<DeclTarifa>(`/declaraciones?${qs}`);
  const [todasFiltradas, setTodasFiltradas] = useState(false);
  const [modo, setModo] = useState<'porcentaje' | 'fijo'>('porcentaje');
  const [valor, setValor] = useState('5');
  const [desde, setDesde] = useState(primeroDelMesSiguiente);
  const [negNueva, setNegNueva] = useState('');
  const [pagoNuevo, setPagoNuevo] = useState('');
  const [confirmar, setConfirmar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [historial, setHistorial] = useState<DeclTarifa | null>(null);

  const v = Number(valor.replace(',', '.'));
  const valido = valor.trim() !== '' && Number.isFinite(v) && (modo === 'porcentaje' ? v > -100 : v >= 0);
  const nuevo = useCallback((d: DeclTarifa) => {
    const b = base(d);
    if (modo === 'fijo') return v;
    return b ? Math.round((Number(b.precioUnitario) * (1 + v / 100)) / 10) * 10 : null;
  }, [modo, v]);
  const visibles = lista.filas ?? [];
  const elegidas = visibles.filter((d) => sel.has(d.id));
  const impacto = elegidas.reduce((a, d) => { const n = nuevo(d), b = base(d); return a + (n !== null && b ? (n - Number(b.precioUnitario)) * porMes(d) : 0); }, 0);
  const fueraDeVista = sel.size - elegidas.length;
  const sinBase = modo === 'porcentaje' ? elegidas.filter((d) => !base(d)).length : 0;
  const fechaValida = desde >= hoyCo();

  const cols: Column<DeclTarifa>[] = useMemo(() => [
    { key: 'n', header: 'N.º', render: (d) => <span className="num">{d.numero}</span>, priority: 2 },
    { key: 'cli', header: 'Cliente', render: (d) => <span className="block max-w-[200px] truncate">{d.cliente.razonSocial}</span>, priority: 2 },
    { key: 'item', header: tipo === 'RESIDUO' ? 'Residuo' : 'Servicio', render: (d) => <span className="block max-w-[220px] truncate font-medium">{d.codigoInterno ? `${d.codigoInterno} · ` : ''}{d.nombre}</span>, priority: 3 },
    { key: 'sed', header: 'Sedes', render: (d) => <span className="block max-w-[120px] truncate text-muted">{d.sucursales.map((s) => s.sucursal.codigo ?? s.sucursal.nombre).join(', ') || '—'}</span>, priority: 1 },
    { key: 'cond', header: 'Condiciones', render: (d) => { const t = base(d); return t ? `${NEG[t.tipoNegociacion] ?? t.tipoNegociacion} · ${PAGO[t.formaPago] ?? t.formaPago}` : '—'; }, priority: 1 },
    { key: 'act', header: 'Precio vigente', align: 'right', priority: 3, render: (d) => (
      <span className="flex flex-col items-end">
        <span className="num whitespace-nowrap">{precio(d.tarifaVigente)}</span>
        {d.tarifaProgramada && <span className="flex items-center gap-1 whitespace-nowrap text-[11px] text-info"><CalendarClock size={11} />{precio(d.tarifaProgramada)} desde {fmtFecha(d.tarifaProgramada.vigenteDesde)}</span>}
      </span>) },
    { key: 'nue', header: 'Precio nuevo', align: 'right', priority: 3, render: (d) => {
      if (!sel.has(d.id) || !valido) return <span className="text-subtle">—</span>;
      const n = nuevo(d), b = base(d);
      if (n === null) return <span className="text-[12px] text-bad">sin precio base</span>;
      return <span className={cx('num font-semibold', b && n > Number(b.precioUnitario) ? 'text-ok' : b && n < Number(b.precioUnitario) ? 'text-bad' : '')}>{fmtCOP(n)}</span>;
    } },
  ], [tipo, sel, valido, nuevo]);

  const seleccionarFiltradas = async () => {
    try {
      const r = await api<{ total: number; ids: string[] }>(`/declaraciones/ids?${qs}`);
      setSel(new Set(r.ids)); setTodasFiltradas(true);
      toast(r.total > r.ids.length ? `Se seleccionaron ${r.ids.length} de ${r.total}: el máximo por cambio es 2.000. Afine los filtros para el resto.` : `${r.ids.length} declaraciones seleccionadas.`, r.total > r.ids.length ? 'warn' : undefined);
    } catch (e) { toast(e instanceof ErrorApi ? e.message : 'No se pudo seleccionar.', 'warn'); }
  };
  const aplicar = async () => {
    setEnviando(true);
    try {
      const r = await api<{ actualizadas: number; corregidas: number }>('/declaraciones/tarifas/masivas', { metodo: 'POST', cuerpo: {
        declaraciones: [...sel], modo, valor: v, vigenteDesde: desde, ...(negNueva && { tipoNegociacion: negNueva }), ...(pagoNuevo && { formaPago: pagoNuevo }),
      } });
      toast(`${r.actualizadas} precios nuevos desde el ${fmtFecha(desde)}${r.corregidas ? ` (${r.corregidas} corregían un precio que empezaba ese mismo día)` : ''}. El historial anterior se conserva.`);
      setSel(new Set()); setTodasFiltradas(false); setConfirmar(false); lista.recargar();
    } catch (e) { toast(e instanceof ErrorApi ? e.message : 'No se pudieron asignar los precios.', 'warn'); setConfirmar(false); }
    setEnviando(false);
  };

  return (
    <>
      <PageHeader eyebrow="Comercial" title="Tarifas"
        subtitle="Escoja las declaraciones que cambian de precio y aplique un ajuste porcentual o un precio fijo desde hoy o una fecha futura. El precio anterior queda en el historial y un precio ya facturado no se cambia." />
      <FilterBar active={Object.entries(f).filter(([k, x]) => (k === 'estado' ? x !== 'autorizadas' : !!x)).length} onClear={() => { setF(vacio); setSel(new Set()); }}>
        <Field label="Cliente" id="tf-cli"><BuscarCliente id="tf-cli" valor={f.clienteId} vacio="Todos" onChange={(c) => { setF((s) => ({ ...s, clienteId: c?.id ?? '' })); setSel(new Set()); }} /></Field>
        <Field label="Línea de servicio" id="tf-lin"><Select id="tf-lin" value={f.lineaServicioId} onChange={set('lineaServicioId')}><option value="">Todas</option>{(catalogos.datos?.lineas ?? []).map((l) => <option key={l.id} value={l.id}>{l.codigo} · {l.nombre}</option>)}</Select></Field>
        <Field label="Negociación" id="tf-neg"><Select id="tf-neg" value={f.negociacion} onChange={set('negociacion')}><option value="">Todas</option>{Object.entries(NEG).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="Forma de pago" id="tf-pago"><Select id="tf-pago" value={f.formaPago} onChange={set('formaPago')}><option value="">Todas</option>{Object.entries(PAGO).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="Declaraciones" id="tf-est"><Select id="tf-est" value={f.estado} onChange={set('estado')}><option value="autorizadas">Autorizadas y activas</option><option value="pendientes">Pendientes de autorizar</option><option value="">Todas</option></Select></Field>
      </FilterBar>
      <div className="mb-3"><Tabs value={tipo} onChange={(t) => { setTipo(t); setSel(new Set()); }} items={[{ value: 'RESIDUO', label: 'Residuos' }, { value: 'SERVICIO', label: 'Servicios' }]} /></div>

      <div className="grid gap-5 xl:grid-cols-[1fr_330px]">
        <div className="min-w-0">
          {puedeAsignar && lista.total > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
              <Button size="sm" variant="ghost" onClick={seleccionarFiltradas}><CheckSquare size={14} /> Seleccionar las {Math.min(lista.total, 2000)} filtradas</Button>
              {sel.size > 0 && <><span className="text-muted">{sel.size} seleccionadas{todasFiltradas && fueraDeVista > 0 ? ` (${fueraDeVista} no se ven en la lista)` : ''}</span><Button size="sm" variant="ghost" onClick={() => { setSel(new Set()); setTodasFiltradas(false); }}>Quitar selección</Button></>}
            </div>
          )}
          {lista.error ? <p className="rounded-xl bg-bad/10 p-4 text-bad">{lista.error}</p>
            : !lista.filas ? <p className="p-6 text-center text-muted">Cargando…</p>
            : <ResponsiveTable rows={lista.filas} columns={cols} rowKey={(d) => d.id} selectable={puedeAsignar} selected={sel} onSelectedChange={(s) => { setSel(s); setTodasFiltradas(false); }}
                onRowClick={setHistorial} cardTitle={(d) => d.nombre} cardBadge={(d) => <Badge>{precio(d.tarifaVigente)}</Badge>}
                cardMeta={(d) => `N.º ${d.numero} · ${d.cliente.razonSocial}${d.tarifaProgramada ? ` · desde ${fmtFecha(d.tarifaProgramada.vigenteDesde)}: ${precio(d.tarifaProgramada)}` : ''}`}
                footer={<PieLista mostradas={lista.filas.length} total={lista.total} hayMas={lista.hayMas} cargando={lista.cargando} cargarMas={lista.cargarMas} />}
                empty="No hay declaraciones con estos filtros." />}
        </div>

        {puedeAsignar ? (
          <div className="xl:sticky xl:top-24 xl:self-start">
            <Card title={<span className="flex items-center gap-2"><Tags size={17} /> Aplicar a {sel.size} {sel.size === 1 ? 'declaración' : 'declaraciones'}</span>}>
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1">
                  {(['porcentaje', 'fijo'] as const).map((m) => (
                    <button key={m} onClick={() => { setModo(m); setValor(m === 'porcentaje' ? '5' : ''); setConfirmar(false); }} className={cx('h-8 rounded-md text-[13px] font-medium', modo === m ? 'bg-surface shadow-sm' : 'text-muted')}>{m === 'porcentaje' ? 'Ajuste %' : 'Precio fijo'}</button>
                  ))}
                </div>
                <Field label={modo === 'porcentaje' ? 'Ajuste (%)' : 'Precio unitario (COP)'} id="tf-valor" hint={modo === 'porcentaje' ? 'Negativo para un descuento. Se redondea a decenas de peso.' : 'Con la misma métrica del precio actual.'}>
                  <Input id="tf-valor" inputMode="decimal" value={valor} onChange={(e) => { setValor(e.target.value); setConfirmar(false); }} />
                </Field>
                <Field label="Rige desde" id="tf-desde" hint={fechaValida ? undefined : 'Desde hoy o una fecha futura.'}>
                  <Input id="tf-desde" type="date" min={hoyCo()} value={desde} onChange={(e) => { setDesde(e.target.value); setConfirmar(false); }} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Negociación" id="tf-nneg"><Select id="tf-nneg" value={negNueva} onChange={(e) => setNegNueva(e.target.value)}><option value="">Igual</option>{Object.entries(NEG).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
                  <Field label="Forma de pago" id="tf-npago"><Select id="tf-npago" value={pagoNuevo} onChange={(e) => setPagoNuevo(e.target.value)}><option value="">Igual</option>{Object.entries(PAGO).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
                </div>
                <div className="rounded-lg bg-surface-2 p-3 text-[13px]">
                  <p className="text-muted">Impacto mensual estimado</p>
                  <p className={cx('num mt-0.5 font-display text-xl font-semibold', impacto >= 0 ? 'text-ok' : 'text-bad')}>{impacto >= 0 ? '+' : ''}{fmtCOP(Math.round(impacto))}</p>
                  <p className="mt-1 text-[12px] text-subtle">Con la cantidad por frecuencia de cada declaración{fueraDeVista > 0 ? `; solo las ${elegidas.length} que se ven en la lista` : ''}.</p>
                </div>
                {sinBase > 0 && <p className="rounded-lg bg-bad/10 px-3 py-2 text-[12px] text-bad">{sinBase} sin precio: el ajuste porcentual necesita un precio de base. Use precio fijo o quítelas.</p>}
                {!confirmar
                  ? <Button variant="primary" disabled={!sel.size || !valido || !fechaValida || sinBase > 0} onClick={() => setConfirmar(true)}>Aplicar precios</Button>
                  : <div className="flex flex-col gap-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-[13px]">
                      <p>¿Asignar {modo === 'porcentaje' ? `un ajuste de ${v > 0 ? '+' : ''}${v} %` : `el precio ${fmtCOP(v)}`} a {sel.size} {sel.size === 1 ? 'declaración' : 'declaraciones'} desde el {fmtFecha(desde)}?</p>
                      <div className="flex justify-end gap-2"><Button size="sm" onClick={() => setConfirmar(false)}>Cancelar</Button><Button size="sm" variant="primary" disabled={enviando} onClick={aplicar}>{enviando && <Loader2 size={14} className="animate-spin" />}Sí, aplicar</Button></div>
                    </div>}
                <p className="flex items-start gap-2 text-[12px] text-muted"><History size={14} className="mt-0.5 shrink-0" />Cada cambio crea una vigencia nueva. Si una declaración ya tiene un precio que empieza esa misma fecha, se corrige; uno de días anteriores nunca se toca.</p>
              </div>
            </Card>
          </div>
        ) : <p className="text-[13px] text-muted">Su rol puede consultar las tarifas; para cambiarlas se necesita el permiso «tarifas.asignar».</p>}
      </div>

      <Sheet open={!!historial} onClose={() => setHistorial(null)} title={historial ? `Historial de precios · declaración ${historial.numero}` : ''}>
        {historial && <Historial d={historial} />}
      </Sheet>
    </>
  );
}

function Historial({ d }: { d: DeclTarifa }) {
  const det = useApi<{ tarifas: Tarifa[] }>(`/declaraciones/${d.id}`);
  const hoy = hoyCo();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[14px]"><span className="font-medium">{d.nombre}</span><br /><span className="text-muted">{d.cliente.razonSocial} · {d.lineaServicio.nombre}</span></p>
      {det.error && <p className="text-bad">{det.error}</p>}
      {!det.datos && !det.error && <p className="flex items-center gap-2 text-muted"><Loader2 size={16} className="animate-spin" />Cargando…</p>}
      {det.datos && !det.datos.tarifas.length && <p className="text-muted">Sin precios asignados.</p>}
      <ul className="flex flex-col gap-2">
        {det.datos?.tarifas.map((t) => {
          const estado = t.vigenteDesde.slice(0, 10) > hoy ? 'Programado' : !t.vigenteHasta || t.vigenteHasta.slice(0, 10) >= hoy ? 'Vigente' : 'Anterior';
          return (
            <li key={t.id} className={cx('rounded-xl border p-3 text-[13px]', estado === 'Vigente' ? 'border-brand/40 bg-brand-soft/30' : 'border-line')}>
              <div className="flex items-center justify-between gap-2">
                <span className="num font-semibold">{precio(t)}</span>
                <Badge tone={estado === 'Vigente' ? 'ok' : estado === 'Programado' ? 'info' : 'neutral'}>{estado}</Badge>
              </div>
              <p className="mt-1 text-muted">Desde {fmtFecha(t.vigenteDesde)}{t.vigenteHasta ? ` hasta ${fmtFecha(t.vigenteHasta)}` : ''} · {NEG[t.tipoNegociacion] ?? t.tipoNegociacion} · {PAGO[t.formaPago] ?? t.formaPago}</p>
              {t.asignadoPor && <p className="text-subtle">Asignó: {t.asignadoPor.nombre}</p>}
            </li>
          );
        })}
      </ul>
      <p className="text-[12px] text-muted">Hoy es {fmtFecha(hoy)}. Los precios anteriores no se borran: son el soporte de lo facturado.</p>
    </div>
  );
}
