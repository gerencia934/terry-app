import { useMemo, useState } from 'react';
import { Download, ShieldCheck, ShieldAlert, Check, X, Paperclip, Recycle, Wrench } from 'lucide-react';
import { ResponsiveTable, FilterBar, type Column } from '../components/data';
import { Badge, Button, DefList, EstadoBadge, Field, Input, PageHeader, Select, Sheet, useToast } from '../components/ui';
import { Fab } from '../components/AppShell';
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
    { key: 'codigo', header: 'Código interno', render: (d) => <span className="num text-muted">{item(d.itemId).codigo}</span>, priority: 3 },
  ];
  const comun = (titulo: string): Column<Declaracion>[] => [
    { key: 'nombre', header: titulo, render: (d) => <span className="block max-w-[240px] truncate font-medium">{item(d.itemId).nombre}</span>, priority: 3 },
    { key: 'estado', header: 'Estado', render: (d) => <EstadoBadge estado={d.estado} />, priority: 3 },
    { key: 'activo', header: 'Activo / inactivo', render: (d) => extraDecl(d).activo ? <Badge tone="ok">Activo</Badge> : <Badge>Inactivo</Badge>, priority: 3 },
    { key: 'cliente', header: 'Cliente', render: (d) => <span className="block max-w-[200px] truncate">{cliente(d.clienteId).razonSocial}</span>, priority: 2 },
    { key: 'sucursal', header: 'Sucursales', render: (d) => sucursal(d.sucursalId).nombre, priority: 3 },
    { key: 'obs', header: 'Observación', render: (d) => <span className="block max-w-[180px] truncate text-muted">{extraDecl(d).observacion || '—'}</span>, priority: 3 },
  ];
  const colsResiduos: Column<Declaracion>[] = [...base, ...comun('Residuo'),
    { key: 'ef', header: 'Estado físico', render: (d) => extraDecl(d).estadoFisico, priority: 3 },
    { key: 'cat', header: 'Categoría declarado', render: (d) => extraDecl(d).categoria, priority: 3 },
    { key: 'tipo', header: 'Tipo residuo', render: (d) => extraDecl(d).tipoResiduo, priority: 3 },
    { key: 'linea', header: 'Línea de servicio', render: (d) => item(d.itemId).linea, priority: 3 },
    { key: 'un', header: 'Unidad de negocio', render: (d) => extraDecl(d).unidadNegocio, priority: 3 },
    { key: 'manejo', header: 'Tratamiento / disposición / manejo', render: (d) => manejo(item(d.itemId).manejo).nombre, priority: 2 },
    { key: 'emb', header: 'Embalaje', render: (d) => d.embalaje, priority: 3 },
    { key: 'pel', header: '¿Es peligroso?', align: 'center', render: (d) => <SiNo v={extraDecl(d).peligroso} />, priority: 2 },
    { key: 'cy', header: 'Corriente Y', render: (d) => extraDecl(d).corrienteY || '—', priority: 3 },
    { key: 'ca', header: 'Corriente A', render: (d) => extraDecl(d).corrienteA || '—', priority: 3 },
    { key: 'inf', header: '¿Es inflamable?', align: 'center', render: (d) => <SiNo v={extraDecl(d).inflamable} />, priority: 3 },
    { key: 'ficha', header: 'Ficha de caracterización', align: 'center', render: (d) => extraDecl(d).ficha ? <Paperclip size={15} className="inline text-ok" aria-label="Adjunta" /> : <span className="text-bad">Falta</span>, priority: 3 },
    { key: 'cant', header: 'Cantidad promedio', align: 'right', render: (d) => `${fmtNum(d.cantidad)} ${uni(item(d.itemId).unidad)}`, priority: 2 },
    { key: 'precio', header: 'Precio unit.', align: 'right', render: (d) => d.precio ? fmtCOP(d.precio) : '—', priority: 3 },
  ];
  const colsServicios: Column<Declaracion>[] = [...base, ...comun('Servicio'),
    { key: 'linea', header: 'Línea de servicio', render: (d) => item(d.itemId).linea, priority: 2 },
    { key: 'un', header: 'Línea de negocio', render: (d) => extraDecl(d).unidadNegocio, priority: 3 },
    { key: 'frec', header: 'Frecuencia (sede pric.)', render: (d) => d.frecuencia, priority: 2 },
    { key: 'prog', header: 'Prog. automática', align: 'center', render: (d) => extraDecl(d).progAuto ? 'Sí' : 'No', priority: 3 },
    { key: 'cant', header: 'Cant. promedio', align: 'right', render: (d) => fmtNum(d.cantidad), priority: 2 },
    { key: 'desc', header: 'Descripción', render: (d) => <span className="text-muted">{d.embalaje === 'N/A' ? '—' : d.embalaje}</span>, priority: 3 },
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
      <PageHeader eyebrow="Declaraciones" title="Declaraciones" subtitle="Residuos y servicios declarados por cada cliente y sucursal. Cada residuo se valida contra los permisos ambientales antes de autorizarse."
        actions={<><Button onClick={() => go('cargues')}>Cargue masivo</Button><Button onClick={() => toast('Se generó el Excel con todas las columnas de los registros filtrados.', 'info')}><Download size={16} /> Exportable detallado</Button></>} />
      <FilterBar active={active} onClear={() => setF(VACIO)}>
        <Field label="Cliente" id="d-cli"><Select id="d-cli" value={f.cliente} onChange={set('cliente')}><option value="">Seleccione</option>{CLIENTES.map((c) => <option key={c.id} value={c.id}>{c.razonSocial}</option>)}</Select></Field>
        <Field label="Sucursal" id="d-suc"><Select id="d-suc" value={f.sucursal} onChange={set('sucursal')}><option value="">Todas</option>{sucs.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</Select></Field>
        <Field label="Número de la declaración" id="d-num"><Input id="d-num" inputMode="numeric" value={f.numero} onChange={set('numero')} placeholder="Ej. 1008" /></Field>
        <Field label="Residuo / servicio" id="d-nom"><Input id="d-nom" value={f.nombre} onChange={set('nombre')} placeholder="Buscar por nombre" /></Field>
        <Field label="Código interno" id="d-cod"><Input id="d-cod" value={f.codigo} onChange={set('codigo')} placeholder="Ej. RP-018" /></Field>
        <Field label="Estado" id="d-est"><Select id="d-est" value={f.estado} onChange={set('estado')}><option value="">Seleccione…</option>{['AUTORIZADA', 'PENDIENTE', 'RECHAZADA', 'INACTIVA', 'BORRADOR'].map((e) => <option key={e} value={e}>{e.charAt(0) + e.slice(1).toLowerCase()}</option>)}</Select></Field>
        <Field label="Activo / inactivo" id="d-act"><Select id="d-act" value={f.activo} onChange={set('activo')}><option value="">Seleccione…</option><option value="true">Activo</option><option value="false">Inactivo</option></Select></Field>
      </FilterBar>

      <h2 className="mb-2 text-[16px] font-semibold">Listado de residuos declarados</h2>
      <ResponsiveTable rows={residuos} columns={colsResiduos} rowKey={(d) => d.id} onRowClick={setSel}
        cardTitle={(d) => item(d.itemId).nombre} cardBadge={(d) => <EstadoBadge estado={d.estado} />}
        cardMeta={(d) => <span className="num">Nº {d.numero} · {item(d.itemId).codigo} · {extraDecl(d).corrienteY || extraDecl(d).corrienteA || 'No peligroso'}</span>} />

      <h2 className="mb-2 mt-7 text-[16px] font-semibold">Listado de servicios declarados</h2>
      <ResponsiveTable rows={servicios} columns={colsServicios} rowKey={(d) => d.id} onRowClick={setSel}
        cardTitle={(d) => item(d.itemId).nombre} cardBadge={(d) => <EstadoBadge estado={d.estado} />}
        cardMeta={(d) => <span className="num">Nº {d.numero} · {item(d.itemId).codigo}</span>} />

      <Fab label="Nueva declaración" onClick={() => setNueva(true)} />

      {nueva && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="nd-t">
          <div className="anim-sheet w-full max-w-md rounded-2xl bg-surface p-6 text-center shadow-2xl">
            <h2 id="nd-t" className="text-[17px] font-semibold text-brand-ink">¿Desea declarar un residuo o un servicio?</h2>
            <div className="mt-5 grid grid-cols-2 gap-3">
              {([[Recycle, 'Residuo'], [Wrench, 'Servicio']] as const).map(([I, l]) => (
                <button key={l} onClick={() => { setNueva(false); toast(`Formulario de nueva declaración de ${l.toLowerCase()}: cliente → sucursal → ítem del catálogo → condiciones.`, 'info'); }} className="flex flex-col items-center gap-2 rounded-xl border-2 border-line p-4 font-semibold hover:border-brand hover:bg-brand-soft/50"><I size={28} className="text-brand" />{l}</button>
              ))}
            </div>
            <Button variant="ghost" className="mt-4" onClick={() => setNueva(false)}>Cancelar</Button>
          </div>
        </div>
      )}

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
