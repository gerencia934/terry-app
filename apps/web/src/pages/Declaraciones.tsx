import { useMemo, useState } from 'react';
import { Download, ShieldCheck, ShieldAlert, Check, X, Paperclip, Recycle, Wrench, Plus, Upload } from 'lucide-react';
import { ResponsiveTable, FilterBar, type Column } from '../components/data';
import { Badge, Button, DefList, EstadoBadge, Field, Input, PageHeader, Select, Sheet, Tabs, useToast } from '../components/ui';
import { cx } from '../lib/format';
import { CLIENTES, PERMISOS, cliente, extraDecl, item, manejo, sucursal, type Declaracion } from '../data/mock';
import { useStore } from '../lib/store';
import { useRouter } from '../lib/router';
import { fmtCOP, fmtNum } from '../lib/format';

const NEG: Record<string, string> = { COBRO: 'Cobro', COMPRA: 'Compra', SIN_COSTO: 'Sin costo' };
export const negLabel = (n: string) => NEG[n];
const UNI: Record<string, string> = { KG: 'kg', M3: 'm³', GAL: 'gal', UND: 'und', SERVICIO: 'serv.' };
export const uni = (u: string) => UNI[u];
const SiNo = ({ v }: { v: boolean }) => <span className={v ? 'font-semibold text-bad' : 'text-muted'}>{v ? 'Sí' : 'No'}</span>;

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

const VACIO = { cliente: '', sucursal: '', numero: '', nombre: '', codigo: '', estado: '', activo: '' };

export default function Declaraciones() {
  const { declaraciones, setDeclaraciones } = useStore();
  const { go } = useRouter();
  const toast = useToast();
  const [f, setF] = useState(VACIO);
  const [sel, setSel] = useState<Declaracion | null>(null);
  const [nueva, setNueva] = useState(false);
  const [tab, setTab] = useState<'RESIDUO' | 'SERVICIO'>('RESIDUO');
  const [tipoNueva, setTipoNueva] = useState<'Residuo' | 'Servicio'>('Residuo');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value, ...(k === 'cliente' ? { sucursal: '' } : {}) }));
  const active = Object.values(f).filter(Boolean).length;

  const filtradas = useMemo(() => declaraciones.filter((d) => {
    const it = item(d.itemId); const x = extraDecl(d);
    return (!f.cliente || d.clienteId === f.cliente) && (!f.sucursal || d.sucursalId === f.sucursal) && (!f.estado || d.estado === f.estado)
      && (!f.numero || String(d.numero).includes(f.numero)) && (!f.nombre || it.nombre.toLowerCase().includes(f.nombre.toLowerCase()))
      && (!f.codigo || it.codigo.toLowerCase().includes(f.codigo.toLowerCase())) && (!f.activo || String(x.activo) === f.activo);
  }), [declaraciones, f]);
  const residuos = filtradas.filter((d) => d.tipo === 'RESIDUO');
  const servicios = filtradas.filter((d) => d.tipo === 'SERVICIO');

  const base: Column<Declaracion>[] = [
    { key: 'nro', header: 'Nº', render: (d) => <span className="num font-medium">{d.numero}</span>, priority: 3 },
    { key: 'codigo', header: 'Código', render: (d) => <span className="num text-muted">{item(d.itemId).codigo}</span>, priority: 3 },
  ];
  const comun = (titulo: string): Column<Declaracion>[] => [
    { key: 'nombre', header: titulo, render: (d) => <span className="block max-w-[240px] truncate font-medium">{item(d.itemId).nombre}</span>, priority: 3 },
    { key: 'estado', header: 'Estado', render: (d) => <EstadoBadge estado={d.estado} />, priority: 3 },
    { key: 'activo', header: 'Vigencia', render: (d) => extraDecl(d).activo ? <Badge tone="ok">Vigente</Badge> : <Badge>Inactiva</Badge>, priority: 3 },
    { key: 'cliente', header: 'Cliente', render: (d) => <span className="block max-w-[200px] truncate">{cliente(d.clienteId).razonSocial}</span>, priority: 2 },
    { key: 'sucursal', header: 'Sede', render: (d) => sucursal(d.sucursalId).nombre, priority: 3 },
    { key: 'obs', header: 'Nota', render: (d) => <span className="block max-w-[180px] truncate text-muted">{extraDecl(d).observacion || '—'}</span>, priority: 3 },
  ];
  const colsResiduos: Column<Declaracion>[] = [...base, ...comun('Residuo'),
    { key: 'ef', header: 'Estado físico', render: (d) => extraDecl(d).estadoFisico, priority: 3 },
    { key: 'cat', header: 'Clase', render: (d) => extraDecl(d).categoria, priority: 3 },
    { key: 'tipo', header: 'Origen', render: (d) => extraDecl(d).tipoResiduo, priority: 3 },
    { key: 'linea', header: 'Línea de servicio', render: (d) => item(d.itemId).linea, priority: 3 },
    { key: 'un', header: 'Unidad de negocio', render: (d) => extraDecl(d).unidadNegocio, priority: 3 },
    { key: 'manejo', header: 'Tratamiento', render: (d) => manejo(item(d.itemId).manejo).nombre, priority: 2 },
    { key: 'emb', header: 'Embalaje', render: (d) => d.embalaje, priority: 3 },
    { key: 'pel', header: 'Peligroso', align: 'center', render: (d) => <SiNo v={extraDecl(d).peligroso} />, priority: 2 },
    { key: 'corr', header: 'Corriente', render: (d) => extraDecl(d).corrienteY || extraDecl(d).corrienteA || '—', priority: 3 },
    { key: 'inf', header: 'Inflamable', align: 'center', render: (d) => <SiNo v={extraDecl(d).inflamable} />, priority: 3 },
    { key: 'ficha', header: 'Ficha técnica', align: 'center', render: (d) => extraDecl(d).ficha ? <Paperclip size={15} className="inline text-ok" aria-label="Adjunta" /> : <span className="text-bad">Falta</span>, priority: 3 },
    { key: 'cant', header: 'Cantidad habitual', align: 'right', render: (d) => `${fmtNum(d.cantidad)} ${uni(item(d.itemId).unidad)}`, priority: 2 },
    { key: 'precio', header: 'Precio unit.', align: 'right', render: (d) => d.precio ? fmtCOP(d.precio) : '—', priority: 3 },
  ];
  const colsServicios: Column<Declaracion>[] = [...base, ...comun('Servicio'),
    { key: 'linea', header: 'Línea de servicio', render: (d) => item(d.itemId).linea, priority: 2 },
    { key: 'un', header: 'Unidad de negocio', render: (d) => extraDecl(d).unidadNegocio, priority: 3 },
    { key: 'frec', header: 'Frecuencia', render: (d) => d.frecuencia, priority: 2 },
    { key: 'prog', header: 'Se programa sola', align: 'center', render: (d) => extraDecl(d).progAuto ? 'Sí' : 'No', priority: 3 },
    { key: 'cant', header: 'Cantidad habitual', align: 'right', render: (d) => fmtNum(d.cantidad), priority: 2 },
    { key: 'desc', header: 'Alcance', render: (d) => <span className="text-muted">{d.embalaje === 'N/A' ? '—' : d.embalaje}</span>, priority: 3 },
    { key: 'precio', header: 'Precio unit.', align: 'right', render: (d) => d.precio ? fmtCOP(d.precio) : '—', priority: 3 },
  ];

  const cambiarEstado = (d: Declaracion, estado: 'AUTORIZADA' | 'RECHAZADA') => {
    setDeclaraciones((all) => all.map((x) => x.id === d.id ? { ...x, estado, autorizacion: estado === 'AUTORIZADA' ? `AUT-2026-${String(d.numero).padStart(4, '0')}` : undefined, causal: estado === 'RECHAZADA' ? 'Documentación incompleta' : undefined } : x));
    setSel(null);
    toast(estado === 'AUTORIZADA' ? `Declaración ${d.numero} autorizada. Ya se puede programar su recolección.` : `Declaración ${d.numero} rechazada. Se notificó al cliente.`, estado === 'AUTORIZADA' ? 'ok' : 'warn');
  };
  const cob = sel ? coberturaPermiso(sel) : null;
  const sucs = f.cliente ? cliente(f.cliente).sucursales : CLIENTES.flatMap((c) => c.sucursales);

  return (
    <>
      <PageHeader eyebrow="Comercial" title="Declaraciones" subtitle="Lo que cada sede del cliente tiene autorizado entregar o contratar. Antes de autorizar, el sistema verifica que el tratamiento esté cubierto por un permiso ambiental."
        actions={<><Button onClick={() => go('importar')}><Upload size={16} /> Importar</Button><Button onClick={() => go('exportar')}><Download size={16} /> Exportar</Button><Button variant="primary" onClick={() => setNueva(true)}><Plus size={16} /> Nueva declaración</Button></>} />
      <FilterBar active={active} onClear={() => setF(VACIO)}>
        <Field label="Cliente" id="d-cli"><Select id="d-cli" value={f.cliente} onChange={set('cliente')}><option value="">Todos</option>{CLIENTES.map((c) => <option key={c.id} value={c.id}>{c.razonSocial}</option>)}</Select></Field>
        <Field label="Sede" id="d-suc"><Select id="d-suc" value={f.sucursal} onChange={set('sucursal')}><option value="">Todas</option>{sucs.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</Select></Field>
        <Field label="N.º" id="d-num"><Input id="d-num" inputMode="numeric" value={f.numero} onChange={set('numero')} placeholder="Ej. 1008" /></Field>
        <Field label="Nombre" id="d-nom"><Input id="d-nom" value={f.nombre} onChange={set('nombre')} placeholder="Buscar por nombre" /></Field>
        <Field label="Código" id="d-cod"><Input id="d-cod" value={f.codigo} onChange={set('codigo')} placeholder="Ej. RP-018" /></Field>
        <Field label="Estado" id="d-est"><Select id="d-est" value={f.estado} onChange={set('estado')}><option value="">Todos</option>{['AUTORIZADA', 'PENDIENTE', 'RECHAZADA', 'INACTIVA', 'BORRADOR'].map((e) => <option key={e} value={e}>{e.charAt(0) + e.slice(1).toLowerCase()}</option>)}</Select></Field>
        <Field label="Vigencia" id="d-act"><Select id="d-act" value={f.activo} onChange={set('activo')}><option value="">Todas</option><option value="true">Vigentes</option><option value="false">Inactivas</option></Select></Field>
      </FilterBar>

      <div className="mb-3"><Tabs value={tab} onChange={setTab} items={[{ value: 'RESIDUO', label: 'Residuos', count: residuos.length }, { value: 'SERVICIO', label: 'Servicios', count: servicios.length }]} /></div>
      {tab === 'RESIDUO' ? (
        <ResponsiveTable rows={residuos} columns={colsResiduos} rowKey={(d) => d.id} onRowClick={setSel}
          cardTitle={(d) => item(d.itemId).nombre} cardBadge={(d) => <EstadoBadge estado={d.estado} />}
          cardMeta={(d) => <span className="num">N.º {d.numero} · {item(d.itemId).codigo} · {extraDecl(d).corrienteY || extraDecl(d).corrienteA || 'No peligroso'}</span>} />
      ) : (
        <ResponsiveTable rows={servicios} columns={colsServicios} rowKey={(d) => d.id} onRowClick={setSel}
          cardTitle={(d) => item(d.itemId).nombre} cardBadge={(d) => <EstadoBadge estado={d.estado} />}
          cardMeta={(d) => <span className="num">N.º {d.numero} · {item(d.itemId).codigo}</span>} />
      )}

      <Sheet open={nueva} onClose={() => setNueva(false)} title="Nueva declaración"
        footer={<Button variant="primary" onClick={() => { setNueva(false); toast(`Siguiente paso: cliente → sede → ${tipoNueva === 'Residuo' ? 'residuo del catálogo, tratamiento y embalaje' : 'servicio, frecuencia y alcance'} → tarifa.`, 'info'); }}>Continuar</Button>}>
        <div className="grid gap-2">
          {([['Residuo', Recycle, 'Material que la sede entrega para tratamiento, disposición o aprovechamiento.'], ['Servicio', Wrench, 'Trabajo en la sede: unidades sanitarias, lavado de tanques, control de plagas, poda.']] as const).map(([l, I, d]) => (
            <label key={l} className={cx('flex cursor-pointer items-start gap-3 rounded-xl border p-3', tipoNueva === l ? 'border-brand bg-brand-soft/50' : 'border-line')}>
              <input type="radio" name="tipo-decl" className="mt-1 accent-[rgb(var(--brand))]" checked={tipoNueva === l} onChange={() => setTipoNueva(l)} />
              <I size={20} className="mt-0.5 shrink-0 text-brand" /><span><span className="block font-medium">{l}</span><span className="block text-[13px] text-muted">{d}</span></span>
            </label>
          ))}
        </div>
      </Sheet>

      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel ? `Declaración ${sel.numero}` : ''}
        footer={sel?.estado === 'PENDIENTE' && (
          <><Button onClick={() => cambiarEstado(sel, 'RECHAZADA')}><X size={16} /> Rechazar</Button>
            <Button variant="primary" disabled={!cob?.ok} onClick={() => cambiarEstado(sel, 'AUTORIZADA')}><Check size={16} /> Autorizar</Button></>)}>
        {sel && (() => { const it = item(sel.itemId); const x = extraDecl(sel); return (
          <div className="flex flex-col gap-5">
            <div>
              <p className="text-[17px] font-semibold leading-snug">{it.nombre}</p>
              <p className="mt-1 text-muted">{cliente(sel.clienteId).razonSocial} · {sucursal(sel.sucursalId).nombre} ({sucursal(sel.sucursalId).municipio})</p>
              <div className="mt-2 flex gap-2"><EstadoBadge estado={sel.estado} />{x.activo ? <Badge tone="ok">Activo</Badge> : <Badge>Inactivo</Badge>}</div>
            </div>
            <div className={`flex gap-3 rounded-xl p-3 text-[13px] ${cob?.ok ? 'bg-brand-soft text-brand-ink' : 'bg-bad/10 text-bad'}`}>
              {cob?.ok ? <ShieldCheck size={18} className="shrink-0" /> : <ShieldAlert size={18} className="shrink-0" />}
              <div><p className="font-semibold">Validación contra permisos</p><p className="mt-0.5">{cob?.texto}</p></div>
            </div>
            <DefList items={[
              ['Código interno', it.codigo], ['Línea de servicio', it.linea], ['Unidad de negocio', x.unidadNegocio],
              ...(sel.tipo === 'RESIDUO' ? [['Estado físico', x.estadoFisico], ['Categoría', x.categoria], ['Peligrosidad', <Cretib p={it.peligrosidad} />], ['Corriente Y / A', `${x.corrienteY || '—'} / ${x.corrienteA || '—'}`], ['Número ONU', it.onu ?? '—'], ['Ficha de caracterización', x.ficha ? 'Adjunta' : 'Falta adjuntar']] as [string, React.ReactNode][] : [['Programación automática', x.progAuto ? 'Sí' : 'No']] as [string, React.ReactNode][]),
              ['Tratamiento', manejo(it.manejo).nombre], ['Destino', sel.destino],
              ['Cantidad promedio', `${fmtNum(sel.cantidad)} ${uni(it.unidad)} · ${sel.frecuencia}`], ['Embalaje', sel.embalaje],
              ['Negociación', negLabel(sel.negociacion)], ['Precio unitario', sel.precio ? fmtCOP(sel.precio) : 'Sin costo'],
              ['Autorización', sel.autorizacion ?? '—'], ['Observación', x.observacion || '—'],
            ]} />
          </div>); })()}
      </Sheet>
    </>
  );
}
