import { useMemo, useState } from 'react';
import { Tags, History } from 'lucide-react';
import { ResponsiveTable, FilterBar, type Column } from '../components/data';
import { Badge, Button, Card, Field, Input, PageHeader, Select, useToast } from '../components/ui';
import { CLIENTES, LINEAS, cliente, item, sucursal, type Declaracion } from '../data/mock';
import { useStore } from '../lib/store';
import { cx, fmtCOP } from '../lib/format';
import { negLabel, uni } from './Declaraciones';

const PAGO: Record<string, string> = { CONTADO: 'Contado', CREDITO_30: 'Crédito 30 d', CREDITO_60: 'Crédito 60 d' };

export default function Precios() {
  const { declaraciones, setDeclaraciones } = useStore();
  const toast = useToast();
  const [f, setF] = useState({ cliente: '', negociacion: '', pago: '', linea: '' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modo, setModo] = useState<'pct' | 'fijo'>('pct');
  const [valor, setValor] = useState('5');
  const [desde, setDesde] = useState('2027-01-01');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF((s) => ({ ...s, [k]: e.target.value })); setSelected(new Set()); };

  const rows = useMemo(() => declaraciones.filter((d) => d.estado === 'AUTORIZADA').filter((d) =>
    (!f.cliente || d.clienteId === f.cliente) && (!f.negociacion || d.negociacion === f.negociacion)
    && (!f.pago || d.formaPago === f.pago) && (!f.linea || item(d.itemId).linea === f.linea)), [declaraciones, f]);

  const v = Number(valor.replace(',', '.')) || 0;
  const nuevo = (d: Declaracion) => modo === 'pct' ? Math.round((d.precio * (1 + v / 100)) / 10) * 10 : v;
  const afectadas = rows.filter((r) => selected.has(r.id));
  const impacto = afectadas.reduce((a, d) => a + (nuevo(d) - d.precio) * d.cantidad, 0);

  const cols: Column<Declaracion>[] = [
    { key: 'cliente', header: 'Cliente', render: (d) => <span className="block max-w-[200px] truncate">{cliente(d.clienteId).razonSocial}</span>, priority: 2 },
    { key: 'suc', header: 'Sucursal', render: (d) => sucursal(d.sucursalId).nombre, priority: 3 },
    { key: 'item', header: 'Residuo / servicio', render: (d) => <span className="block max-w-[240px] truncate font-medium">{item(d.itemId).nombre}</span>, priority: 3 },
    { key: 'neg', header: 'Negociación', render: (d) => <Badge tone={d.negociacion === 'COMPRA' ? 'info' : 'neutral'}>{negLabel(d.negociacion)}</Badge>, priority: 3 },
    { key: 'pago', header: 'Forma de pago', render: (d) => PAGO[d.formaPago], priority: 3 },
    { key: 'actual', header: 'Precio actual', align: 'right', render: (d) => `${fmtCOP(d.precio)} / ${uni(item(d.itemId).unidad)}`, priority: 1 },
    { key: 'nuevo', header: 'Precio nuevo', align: 'right', priority: 1, render: (d) => selected.has(d.id)
      ? <span className={cx('font-semibold', nuevo(d) > d.precio ? 'text-ok' : nuevo(d) < d.precio ? 'text-bad' : '')}>{fmtCOP(nuevo(d))}</span>
      : <span className="text-subtle">—</span> },
  ];

  const aplicar = () => {
    setDeclaraciones((all) => all.map((d) => selected.has(d.id) ? { ...d, precio: nuevo(d) } : d));
    toast(`Se crearon ${afectadas.length} tarifas nuevas con vigencia desde ${desde}. El historial de precios anterior se conserva.`);
    setSelected(new Set());
  };

  return (
    <>
      <PageHeader eyebrow="Declaraciones" title="Asignación masiva de precios"
        subtitle="Filtre por cliente, tipo de negociación y forma de pago; seleccione las declaraciones y aplique un precio fijo o un ajuste porcentual con fecha de vigencia." />
      <FilterBar active={Object.values(f).filter(Boolean).length} onClear={() => { setF({ cliente: '', negociacion: '', pago: '', linea: '' }); setSelected(new Set()); }}>
        <Field label="Cliente" id="p-cliente"><Select id="p-cliente" value={f.cliente} onChange={set('cliente')}><option value="">Todos</option>{CLIENTES.map((c) => <option key={c.id} value={c.id}>{c.razonSocial}</option>)}</Select></Field>
        <Field label="Tipo de negociación" id="p-neg"><Select id="p-neg" value={f.negociacion} onChange={set('negociacion')}><option value="">Todas</option><option value="COBRO">Cobro</option><option value="COMPRA">Compra</option><option value="SIN_COSTO">Sin costo</option></Select></Field>
        <Field label="Forma de pago" id="p-pago"><Select id="p-pago" value={f.pago} onChange={set('pago')}><option value="">Todas</option>{Object.entries(PAGO).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="Línea de servicio" id="p-linea"><Select id="p-linea" value={f.linea} onChange={set('linea')}><option value="">Todas</option>{LINEAS.map((l) => <option key={l}>{l}</option>)}</Select></Field>
      </FilterBar>

      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <ResponsiveTable rows={rows} columns={cols} rowKey={(d) => d.id} selectable selected={selected} onSelectedChange={setSelected}
          cardTitle={(d) => item(d.itemId).nombre} cardMeta={(d) => `${sucursal(d.sucursalId).nombre} · ${negLabel(d.negociacion)} · ${PAGO[d.formaPago]}`} />

        <div className="xl:sticky xl:top-24 xl:self-start">
          <Card title={<span className="flex items-center gap-2"><Tags size={17} /> Aplicar a {afectadas.length} seleccionadas</span>}>
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1">
                {(['pct', 'fijo'] as const).map((m) => (
                  <button key={m} onClick={() => { setModo(m); setValor(m === 'pct' ? '5' : ''); }} className={cx('h-8 rounded-md text-[13px] font-medium', modo === m ? 'bg-surface shadow-sm' : 'text-muted')}>{m === 'pct' ? 'Ajuste %' : 'Precio fijo'}</button>
                ))}
              </div>
              <Field label={modo === 'pct' ? 'Ajuste (%)' : 'Precio unitario (COP)'} id="p-valor" hint={modo === 'pct' ? 'Use valores negativos para descuentos.' : undefined}>
                <Input id="p-valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
              </Field>
              <Field label="Vigente desde" id="p-desde"><Input id="p-desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></Field>
              <div className="rounded-lg bg-surface-2 p-3 text-[13px]">
                <p className="text-muted">Impacto mensual estimado</p>
                <p className={cx('num mt-0.5 font-display text-xl font-semibold', impacto >= 0 ? 'text-ok' : 'text-bad')}>{impacto >= 0 ? '+' : ''}{fmtCOP(impacto)}</p>
                <p className="mt-1 text-[12px] text-subtle">Calculado con la cantidad estimada de cada declaración.</p>
              </div>
              <Button variant="primary" disabled={!afectadas.length || (modo === 'fijo' && !v)} onClick={aplicar}>Aplicar precios</Button>
              <p className="flex items-start gap-2 text-[12px] text-muted"><History size={14} className="mt-0.5 shrink-0" /> Cada cambio crea una nueva vigencia en la tabla de tarifas; nunca se sobrescribe un precio facturado.</p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
