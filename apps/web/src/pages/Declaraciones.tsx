import { useMemo, useState } from 'react';
import { Plus, Download, ShieldCheck, ShieldAlert, Check, X } from 'lucide-react';
import { ResponsiveTable, FilterBar, type Column } from '../components/data';
import { Badge, Button, DefList, EstadoBadge, Field, Input, PageHeader, Select, Sheet, useToast } from '../components/ui';
import { CLIENTES, PERMISOS, cliente, item, manejo, sucursal, type Declaracion } from '../data/mock';
import { useStore } from '../lib/store';
import { fmtCOP, fmtNum } from '../lib/format';

const NEG: Record<string, string> = { COBRO: 'Cobro', COMPRA: 'Compra', SIN_COSTO: 'Sin costo' };
export const negLabel = (n: string) => NEG[n];
const UNI: Record<string, string> = { KG: 'kg', M3: 'm³', GAL: 'gal', UND: 'und', SERVICIO: 'serv.' };
export const uni = (u: string) => UNI[u];

export function Cretib({ p }: { p: string[] }) {
  if (!p.length) return <span className="text-subtle">No peligroso</span>;
  return <span className="flex gap-1">{p.map((x) => <span key={x} title={{ C: 'Corrosivo', R: 'Reactivo', E: 'Explosivo', T: 'Tóxico', I: 'Inflamable', B: 'Biológico-infeccioso' }[x]} className="flex h-5 w-5 items-center justify-center rounded bg-warn/15 text-[11px] font-bold text-warn">{x}</span>)}</span>;
}

/** Valida que el tipo de manejo esté cubierto por un permiso propio o que vaya a un gestor aliado. */
export function coberturaPermiso(d: Declaracion) {
  const m = manejo(item(d.itemId).manejo);
  if (m.codigo === 'SRV') return { ok: true, texto: 'Servicio en sitio: no requiere permiso de disposición.' };
  if (!m.propio) return { ok: true, aliado: true, texto: `${m.nombre}: exigir licencia vigente y certificado del gestor aliado.` };
  const p = PERMISOS.find((x) => x.manejos.includes(m.codigo));
  return p ? { ok: true, texto: `Cubierto por ${p.acto} (${p.autoridad}): ${p.alcance}.` } : { ok: false, texto: `Ningún permiso vigente cubre "${m.nombre}". No autorizar.` };
}

export default function Declaraciones({ tipo }: { tipo: 'RESIDUO' | 'SERVICIO' }) {
  const { declaraciones, setDeclaraciones } = useStore();
  const toast = useToast();
  const [f, setF] = useState({ cliente: '', estado: '', nombre: '', codigo: '', causal: '', autorizacion: '' });
  const [sel, setSel] = useState<Declaracion | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const active = Object.values(f).filter(Boolean).length;

  const rows = useMemo(() => declaraciones.filter((d) => d.tipo === tipo).filter((d) => {
    const it = item(d.itemId);
    return (!f.cliente || d.clienteId === f.cliente) && (!f.estado || d.estado === f.estado)
      && (!f.nombre || it.nombre.toLowerCase().includes(f.nombre.toLowerCase()))
      && (!f.codigo || it.codigo.toLowerCase().includes(f.codigo.toLowerCase()))
      && (!f.causal || (d.causal ?? '').toLowerCase().includes(f.causal.toLowerCase()))
      && (!f.autorizacion || (d.autorizacion ?? '').toLowerCase().includes(f.autorizacion.toLowerCase()));
  }), [declaraciones, tipo, f]);

  const cols: Column<Declaracion>[] = [
    { key: 'nro', header: 'Nro', render: (d) => <span className="num font-medium">{d.numero}</span>, priority: 3 },
    { key: 'estado', header: 'Estado', render: (d) => <EstadoBadge estado={d.estado} />, priority: 3 },
    { key: 'cliente', header: 'Cliente', render: (d) => <span className="block max-w-[220px] truncate">{cliente(d.clienteId).razonSocial}</span>, priority: 2 },
    { key: 'sucursal', header: 'Sucursal', render: (d) => <span className="whitespace-nowrap">{sucursal(d.sucursalId).nombre}</span>, priority: 3 },
    { key: 'nombre', header: tipo === 'RESIDUO' ? 'Residuo' : 'Servicio', render: (d) => <span className="block max-w-[260px] truncate font-medium">{item(d.itemId).nombre}</span>, priority: 3 },
    { key: 'codigo', header: 'Código', render: (d) => <span className="num whitespace-nowrap text-muted">{item(d.itemId).codigo}</span>, priority: 3 },
    ...(tipo === 'RESIDUO' ? [
      { key: 'corriente', header: 'Corriente', render: (d: Declaracion) => item(d.itemId).corriente ?? '—', priority: 3 as const },
      { key: 'pelig', header: 'Peligrosidad', render: (d: Declaracion) => <Cretib p={item(d.itemId).peligrosidad} />, priority: 2 as const },
    ] : []),
    { key: 'manejo', header: 'Tratamiento / disposición', render: (d) => <span className="whitespace-nowrap">{manejo(item(d.itemId).manejo).nombre}</span>, priority: 2 },
    { key: 'cant', header: 'Cantidad', align: 'right', render: (d) => `${fmtNum(d.cantidad)} ${uni(item(d.itemId).unidad)}`, priority: 2 },
    { key: 'frec', header: 'Frecuencia', render: (d) => d.frecuencia, priority: 3 },
    { key: 'emb', header: 'Embalaje', render: (d) => <span className="whitespace-nowrap">{d.embalaje}</span>, priority: 3 },
    { key: 'aut', header: 'Autorización', render: (d) => <span className="num whitespace-nowrap">{d.autorizacion ?? '—'}</span>, priority: 3 },
    { key: 'causal', header: 'Causal', render: (d) => d.causal ?? '—', priority: 3 },
    { key: 'precio', header: 'Precio unit.', align: 'right', render: (d) => d.precio ? fmtCOP(d.precio) : '—', priority: 2 },
  ];

  const cambiarEstado = (d: Declaracion, estado: 'AUTORIZADA' | 'RECHAZADA') => {
    setDeclaraciones((all) => all.map((x) => x.id === d.id ? { ...x, estado, autorizacion: estado === 'AUTORIZADA' ? `AUT-2026-${String(d.numero).padStart(4, '0')}` : undefined, causal: estado === 'RECHAZADA' ? 'Documentación incompleta' : undefined } : x));
    setSel(null);
    toast(estado === 'AUTORIZADA' ? `Declaración ${d.numero} autorizada. Ya se puede programar su recolección.` : `Declaración ${d.numero} rechazada. Se notificó al cliente.`, estado === 'AUTORIZADA' ? 'ok' : 'warn');
  };

  const cob = sel ? coberturaPermiso(sel) : null;
  return (
    <>
      <PageHeader eyebrow="Declaraciones" title={tipo === 'RESIDUO' ? 'Residuos declarados' : 'Servicios declarados'}
        subtitle={tipo === 'RESIDUO' ? 'Lo que cada sucursal tiene autorizado entregar, con su corriente, peligrosidad y destino.' : 'Servicios contratados por sucursal: USP, lavado de tanques, MIP, paisajismo y succión.'}
        actions={<><Button onClick={() => toast('Se generó el archivo de Excel con los registros filtrados.', 'info')}><Download size={16} /> Exportar</Button><Button variant="primary" onClick={() => toast('Formulario de nueva declaración (siguiente iteración).', 'info')}><Plus size={16} /> Nueva declaración</Button></>} />
      <FilterBar active={active} onClear={() => setF({ cliente: '', estado: '', nombre: '', codigo: '', causal: '', autorizacion: '' })}>
        <Field label="Cliente" id="f-cliente"><Select id="f-cliente" value={f.cliente} onChange={set('cliente')}><option value="">Todos</option>{CLIENTES.map((c) => <option key={c.id} value={c.id}>{c.razonSocial}</option>)}</Select></Field>
        <Field label="Estado" id="f-estado"><Select id="f-estado" value={f.estado} onChange={set('estado')}><option value="">Todos</option>{['AUTORIZADA', 'PENDIENTE', 'RECHAZADA', 'INACTIVA', 'BORRADOR'].map((e) => <option key={e} value={e}>{e.charAt(0) + e.slice(1).toLowerCase()}</option>)}</Select></Field>
        <Field label="Nombre" id="f-nombre"><Input id="f-nombre" value={f.nombre} onChange={set('nombre')} placeholder="Ej. lodos" /></Field>
        <Field label="Código" id="f-codigo"><Input id="f-codigo" value={f.codigo} onChange={set('codigo')} placeholder="Ej. RP-018" /></Field>
        <Field label="Causal" id="f-causal"><Input id="f-causal" value={f.causal} onChange={set('causal')} placeholder="Ej. ficha" /></Field>
        <Field label="Autorización" id="f-aut"><Input id="f-aut" value={f.autorizacion} onChange={set('autorizacion')} placeholder="AUT-2026-…" /></Field>
      </FilterBar>
      <ResponsiveTable rows={rows} columns={cols} rowKey={(d) => d.id} onRowClick={setSel}
        cardTitle={(d) => item(d.itemId).nombre} cardBadge={(d) => <EstadoBadge estado={d.estado} />}
        cardMeta={(d) => <span className="num">N.º {d.numero} · {item(d.itemId).codigo} · {sucursal(d.sucursalId).nombre}</span>} />

      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel ? `Declaración ${sel.numero}` : ''}
        footer={sel?.estado === 'PENDIENTE' && (
          <><Button onClick={() => cambiarEstado(sel, 'RECHAZADA')}><X size={16} /> Rechazar</Button>
            <Button variant="primary" disabled={!cob?.ok} onClick={() => cambiarEstado(sel, 'AUTORIZADA')}><Check size={16} /> Autorizar</Button></>)}>
        {sel && (
          <div className="flex flex-col gap-5">
            <div>
              <p className="text-[17px] font-semibold leading-snug">{item(sel.itemId).nombre}</p>
              <p className="mt-1 text-muted">{cliente(sel.clienteId).razonSocial} · {sucursal(sel.sucursalId).nombre} ({sucursal(sel.sucursalId).municipio})</p>
              <div className="mt-2"><EstadoBadge estado={sel.estado} /></div>
            </div>
            <div className={`flex gap-3 rounded-xl p-3 text-[13px] ${cob?.ok ? 'bg-brand-soft text-brand-ink' : 'bg-bad/10 text-bad'}`}>
              {cob?.ok ? <ShieldCheck size={18} className="shrink-0" /> : <ShieldAlert size={18} className="shrink-0" />}
              <div><p className="font-semibold">Validación contra permisos</p><p className="mt-0.5">{cob?.texto}</p></div>
            </div>
            <DefList items={[
              ['Código', item(sel.itemId).codigo],
              ['Línea de servicio', item(sel.itemId).linea],
              ...(sel.tipo === 'RESIDUO' ? [['Corriente', item(sel.itemId).corriente ?? 'No aplica'], ['Peligrosidad', <Cretib p={item(sel.itemId).peligrosidad} />], ['Número ONU', item(sel.itemId).onu ?? '—']] as [string, React.ReactNode][] : []),
              ['Tratamiento', manejo(item(sel.itemId).manejo).nombre],
              ['Destino', sel.destino],
              ['Cantidad estimada', `${fmtNum(sel.cantidad)} ${uni(item(sel.itemId).unidad)} · ${sel.frecuencia}`],
              ['Embalaje', sel.embalaje],
              ['Negociación', <Badge tone={sel.negociacion === 'COMPRA' ? 'info' : 'neutral'}>{negLabel(sel.negociacion)}</Badge>],
              ['Precio unitario', sel.precio ? fmtCOP(sel.precio) : 'Sin costo'],
              ['Autorización', sel.autorizacion ?? '—'],
              ['Causal', sel.causal ?? '—'],
            ]} />
          </div>
        )}
      </Sheet>
    </>
  );
}
