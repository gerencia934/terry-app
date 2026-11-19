// Catálogos, etapas del recorrido y recepción en Los Pinos con datos reales (fase 1c).
// - Catálogos: las listas que usa la plataforma, tal como están en el servidor (consulta). Los de la declaración y la
//   operación se cargan con la siembra y los ajustes de la gerencia; un cambio se pide a soporte.
// - Inventario: por ahora, lo que ENTRA a Los Pinos por tratamiento. El saldo por tratar necesita saber cuándo se da
//   por tratado un residuo (pregunta abierta a la gerencia).
import { useMemo, useState } from 'react';
import { Info, Search, Warehouse } from 'lucide-react';
import { ResponsiveTable } from '../components/data';
import { Badge, ColorBadge, Field, Input, Kpi, PageHeader, Select } from '../components/ui';
import { BuscarCliente } from '../components/BuscarCliente';
import { tienePermiso } from '../lib/api';
import { hoyCo, useApi } from '../lib/servidor';
import { cx, fmtFecha, fmtNum } from '../lib/format';
import { catalogoElegido } from './Configuracion';

interface ItemBase { id?: string; codigo?: string; nombre?: string; descripcion?: string | null; activo?: boolean }
interface Catalogos {
  categorias: ItemBase[]; tiposResiduo: ItemBase[]; tiposEmbalaje: (ItemBase & { esOtro?: boolean })[]; materiales: (ItemBase & { esOtro?: boolean })[];
  lineas: (ItemBase & { unidadNegocio: { codigo: string; nombre: string; sigla: string | null } })[];
  disposiciones: (ItemBase & { requierePermiso: boolean; propia: boolean; soporteLegal: string | null })[];
  riesgos: ItemBase[]; etiquetado: ItemBase[]; causales: ItemBase[];
  metricasPrecio: (ItemBase & { abreviacion: string; factorAKg: string | null })[]; metricasDensidad: (ItemBase & { abreviacion: string })[];
  corrientesY: (ItemBase & { descripcion: string })[]; codigosA: (ItemBase & { descripcion: string })[];
}
interface Operacion { especificaciones: ItemBase[]; destinos: { id: string; razonSocial: string; esPropio: boolean; activo?: boolean }[]; etapas: Etapa[] }
interface Etapa { id: string; nombre: string; descripcion: string | null; color: string; orden: number; esFinal: boolean; cancela: boolean; rastreo: boolean; activo: boolean }
interface Elemento { id: string; grupo: string; nombre: string; critico: boolean }
interface Zona { id: string; nombre: string; color: string }
type Fila = { clave: string; codigo: string; nombre: string; detalle: string; color?: string; tono?: 'ok' | 'neutral' | 'warn' | 'info' | 'brand'; etiqueta?: string };

const TITULOS: Record<string, string> = {
  manejos: 'Tratamientos (disposiciones)', lineas: 'Líneas de servicio', unidades: 'Unidades de negocio', categorias: 'Categorías de declarado', residuos: 'Tipos de residuo',
  embalajes: 'Tipos de embalaje', materiales: 'Materiales de embalaje', riesgos: 'Riesgos (CRETIB)', etiquetado: 'Sistemas de etiquetado', metricas: 'Unidades de medida',
  corrientesY: 'Corrientes Y', codigosA: 'Códigos A', causales: 'Motivos (causales)', especificaciones: 'Requisitos especiales', zonas: 'Zonas', chequeo: 'Elementos de inspección',
  etapas: 'Etapas del recorrido', proveedores: 'Destinos (planta y gestores)',
};

export function CatalogosServidor({ inicial }: { inicial?: string }) {
  const cat = useApi<Catalogos>('/declaraciones/catalogos');
  const op = useApi<Operacion>('/catalogos/operacion');
  const zonas = useApi<Zona[]>('/zonas');
  const elementos = useApi<Elemento[]>('/elementos-chequeo');
  const etapas = useApi<Etapa[]>('/estados-recorrido');
  const [sel, setSel] = useState(() => { const x = inicial ?? catalogoElegido(); return TITULOS[x] ? x : 'manejos'; });
  const [q, setQ] = useState('');
  const filas = useMemo<Fila[]>(() => {
    const c = cat.datos;
    const simple = (xs: ItemBase[] | undefined, detalle: (x: ItemBase) => string = (x) => x.descripcion ?? '') =>
      (xs ?? []).map((x, i) => ({ clave: x.id ?? `${x.codigo}-${i}`, codigo: x.codigo ?? '', nombre: x.nombre ?? x.descripcion ?? '', detalle: detalle(x) }));
    switch (sel) {
      case 'manejos': return (c?.disposiciones ?? []).map((d) => ({ clave: d.id!, codigo: d.codigo!, nombre: d.nombre!, detalle: d.soporteLegal ?? '',
        etiqueta: d.propia ? 'Los Pinos' : 'Gestor aliado', tono: d.propia ? 'brand' as const : 'info' as const }));
      case 'lineas': return (c?.lineas ?? []).map((l) => ({ clave: l.id!, codigo: l.codigo!, nombre: l.nombre!, detalle: `${l.unidadNegocio.nombre}${l.unidadNegocio.sigla ? ` (${l.unidadNegocio.sigla})` : ''}` }));
      case 'unidades': return [...new Map((c?.lineas ?? []).map((l) => [l.unidadNegocio.codigo, l.unidadNegocio])).values()]
        .map((u) => ({ clave: u.codigo, codigo: u.codigo, nombre: u.nombre, detalle: `${(c?.lineas ?? []).filter((l) => l.unidadNegocio.codigo === u.codigo).length} líneas de servicio` }));
      case 'categorias': return simple(c?.categorias);
      case 'residuos': return simple(c?.tiposResiduo);
      case 'embalajes': return simple(c?.tiposEmbalaje, (x) => ((x as { esOtro?: boolean }).esOtro ? 'Exige escribir cuál' : ''));
      case 'materiales': return simple(c?.materiales, (x) => ((x as { esOtro?: boolean }).esOtro ? 'Exige escribir cuál' : ''));
      case 'riesgos': return simple(c?.riesgos);
      case 'etiquetado': return simple(c?.etiquetado);
      case 'metricas': return [...(c?.metricasPrecio ?? []).map((m) => ({ clave: m.id!, codigo: m.abreviacion, nombre: m.nombre!, detalle: m.factorAKg ? `Precio · ${fmtNum(Number(m.factorAKg))} kg` : 'Precio' })),
        ...(c?.metricasDensidad ?? []).map((m) => ({ clave: m.id!, codigo: m.abreviacion, nombre: m.nombre!, detalle: 'Densidad' }))];
      case 'corrientesY': return (c?.corrientesY ?? []).map((x) => ({ clave: x.id!, codigo: x.codigo!, nombre: x.descripcion, detalle: '' }));
      case 'codigosA': return (c?.codigosA ?? []).map((x) => ({ clave: x.id!, codigo: x.codigo!, nombre: x.descripcion, detalle: '' }));
      case 'causales': return simple(c?.causales);
      case 'especificaciones': return simple(op.datos?.especificaciones);
      case 'proveedores': return (op.datos?.destinos ?? []).map((d) => ({ clave: d.id, codigo: '', nombre: d.razonSocial,
        detalle: d.esPropio ? 'Planta propia' : d.activo === false ? 'Ya no se trabaja con él (sus certificados se conservan)' : 'Gestor aliado (licencia en Permisos)',
        etiqueta: d.esPropio ? 'Propio' : d.activo === false ? 'Inactivo' : 'Aliado', tono: d.esPropio ? 'brand' as const : d.activo === false ? 'neutral' as const : 'info' as const }));
      case 'zonas': return (zonas.datos ?? []).map((z) => ({ clave: z.id, codigo: '', nombre: z.nombre, detalle: '', color: z.color }));
      case 'chequeo': return (elementos.datos ?? []).map((e) => ({ clave: e.id, codigo: '', nombre: e.nombre, detalle: e.grupo, etiqueta: e.critico ? 'Crítico' : undefined, tono: 'warn' as const }));
      case 'etapas': return (etapas.datos ?? []).map((e) => ({ clave: e.id, codigo: String(e.orden), nombre: e.nombre, color: e.color,
        detalle: [e.descripcion, e.cancela ? 'cancela la ruta' : '', e.esFinal ? 'final' : '', e.rastreo ? 'GPS durante la etapa' : '', e.activo ? '' : 'inactiva'].filter(Boolean).join(' · ') }));
    }
    return [];
  }, [sel, cat.datos, op.datos, zonas.datos, elementos.datos, etapas.datos]);
  const visibles = q.trim() ? filas.filter((f) => `${f.codigo} ${f.nombre} ${f.detalle}`.toLowerCase().includes(q.trim().toLowerCase())) : filas;
  const cargando = !cat.datos && !cat.error;
  return (
    <>
      <PageHeader eyebrow="Ajustes" title="Catálogos" subtitle="Las listas que usa la plataforma, tal como están en el servidor. Un cambio en ellas afecta declaraciones, certificados o la operación: pídalo a soporte." />
      <div className="grid gap-5 lg:grid-cols-[250px_1fr]">
        <div className="lg:hidden"><Field label="Catálogo" id="cs-sel"><Select id="cs-sel" value={sel} onChange={(e) => { setSel(e.target.value); setQ(''); }}>{Object.entries(TITULOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field></div>
        <nav className="hidden flex-col gap-1 lg:flex">{Object.entries(TITULOS).map(([k, v]) => (
          <button key={k} onClick={() => { setSel(k); setQ(''); }} className={cx('flex h-9 items-center rounded-lg px-3 text-left text-[13px]', sel === k ? 'bg-brand-soft font-semibold text-brand-ink' : 'text-muted hover:bg-surface-2')}>
            <span className="truncate">{v}</span></button>))}
        </nav>
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[16px] font-semibold">{TITULOS[sel]} <span className="num text-[13px] font-normal text-muted">({filas.length})</span></h2>
            <div className="relative w-full max-w-xs"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en el catálogo" className="pl-9" aria-label="Buscar en el catálogo" /></div>
          </div>
          {cat.error ? <p className="rounded-xl bg-bad/10 p-4 text-bad">{cat.error}</p> : cargando ? <p className="p-6 text-center text-muted">Cargando…</p> : (
            <ResponsiveTable rows={visibles} rowKey={(r) => r.clave} cardTitle={(r) => r.nombre} cardMeta={(r) => [r.codigo, r.detalle].filter(Boolean).join(' · ')}
              cardBadge={(r) => (r.etiqueta ? <Badge tone={r.tono}>{r.etiqueta}</Badge> : null)} empty="Sin registros."
              columns={[
                { key: 'c', header: 'Código', render: (r) => <span className="num font-medium">{r.codigo || '—'}</span>, priority: 2 },
                { key: 'n', header: 'Nombre', render: (r) => (r.color ? <ColorBadge color={r.color}>{r.nombre}</ColorBadge> : <span className="block max-w-[420px]">{r.nombre}</span>), priority: 3 },
                { key: 'd', header: 'Detalle', render: (r) => <span className="block max-w-[420px] text-muted">{r.detalle || '—'}</span>, priority: 2 },
                { key: 'e', header: '', render: (r) => (r.etiqueta ? <Badge tone={r.tono}>{r.etiqueta}</Badge> : null), priority: 2 },
              ]} />
          )}
          {sel === 'proveedores' && <p className="mt-3 text-[12px] text-muted">La licencia y la vigencia de cada gestor aliado se registran en Cumplimiento › Permisos ambientales › Gestores aliados.</p>}
        </div>
      </div>
    </>
  );
}

// ---------------------------- INVENTARIO (recepción en Los Pinos) ----------------------------
interface Recepcion {
  desde: string; hasta: string; toneladas: number; servicios: number;
  tratamientos: { tratamiento: string; codigo: string | null; toneladas: number; otras: number; unidades: string[]; servicios: number; primera: string; ultima: string; meses: { mes: string; toneladas: number }[] }[];
}
export function InventarioServidor() {
  const hoy = hoyCo();
  const [y, m] = hoy.split('-').map(Number);
  const vacio = { desde: new Date(Date.UTC(y, m - 3, 1)).toISOString().slice(0, 10), hasta: hoy, clienteId: '' };
  const [f, setF] = useState(vacio);
  const puede = tienePermiso('informes.ver');
  const qs = new URLSearchParams({ desde: f.desde, hasta: f.hasta, ...(f.clienteId && { clienteId: f.clienteId }) }).toString();
  const { datos: d, error } = useApi<Recepcion>(puede && f.desde && f.hasta ? `/informes/recepcion-planta?${qs}` : null);
  return (
    <>
      <PageHeader eyebrow="Planta Los Pinos" title="Inventario" subtitle="Lo que entró a Los Pinos por tratamiento, según lo conciliado en planta (o lo cargado, si aún no se concilia)." />
      <p className="mb-4 flex items-start gap-2 rounded-xl border border-info/30 bg-info/10 px-4 py-2.5 text-[13px] text-info"><Info size={16} className="mt-px shrink-0" />
        Por ahora se ven las entradas. El saldo pendiente por tratar se calculará cuando la gerencia defina cuándo se da por tratado un residuo (por celda, por lote o por informe de tratamiento).</p>
      {!puede ? <p className="rounded-xl bg-surface-2 p-4 text-muted">Para ver la recepción en planta se necesita el permiso «informes.ver».</p> : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-line bg-surface p-3 lg:grid-cols-4">
            <Field label="Desde" id="iv-d"><Input id="iv-d" type="date" value={f.desde} max={f.hasta} onChange={(e) => setF((s) => ({ ...s, desde: e.target.value }))} /></Field>
            <Field label="Hasta" id="iv-h"><Input id="iv-h" type="date" value={f.hasta} min={f.desde} onChange={(e) => setF((s) => ({ ...s, hasta: e.target.value }))} /></Field>
            <div className="col-span-2"><Field label="Cliente" id="iv-c"><BuscarCliente id="iv-c" valor={f.clienteId} vacio="Todos" onChange={(x) => setF((s) => ({ ...s, clienteId: x?.id ?? '' }))} /></Field></div>
          </div>
          {error && <p className="rounded-xl bg-bad/10 p-4 text-bad">{error}</p>}
          {!d && !error && <p className="p-6 text-center text-muted">Cargando…</p>}
          {d && (
            <>
              <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-3">
                <Kpi label="Recibido en Los Pinos" value={`${fmtNum(d.toneladas)} t`} icon={<Warehouse size={16} />} hint="en kg o toneladas" />
                <Kpi label="Servicios recibidos" value={fmtNum(d.servicios)} icon={<Warehouse size={16} />} hint={`${fmtFecha(d.desde)} a ${fmtFecha(d.hasta)}`} />
              </div>
              <ResponsiveTable rows={d.tratamientos} rowKey={(t) => t.tratamiento} cardTitle={(t) => t.tratamiento} cardBadge={(t) => <Badge tone="brand">{fmtNum(t.toneladas)} t</Badge>}
                cardMeta={(t) => `${t.servicios} servicios · ${fmtFecha(t.primera)} a ${fmtFecha(t.ultima)}`} empty="Nada recibido en Los Pinos en ese periodo."
                columns={[
                  { key: 't', header: 'Tratamiento', render: (t) => <span className="font-medium">{t.codigo ? <span className="num mr-1.5 text-muted">{t.codigo}</span> : null}{t.tratamiento}</span>, priority: 3 },
                  { key: 'k', header: 'Recibido', align: 'right', render: (t) => <span className="num font-semibold">{fmtNum(t.toneladas)} t</span>, priority: 3 },
                  { key: 'o', header: 'Otras unidades', align: 'right', render: (t) => (t.otras ? `${fmtNum(t.otras)} ${t.unidades.join(', ')}` : '—'), priority: 1 },
                  { key: 's', header: 'Servicios', align: 'right', render: (t) => fmtNum(t.servicios), priority: 2 },
                  { key: 'p', header: 'Primera y última entrada', render: (t) => <span className="text-muted">{fmtFecha(t.primera)} · {fmtFecha(t.ultima)}</span>, priority: 2 },
                  { key: 'm', header: 'Por mes (t)', render: (t) => <span className="text-[12px] text-muted">{t.meses.map((x) => `${x.mes.slice(5)}/${x.mes.slice(2, 4)}: ${fmtNum(x.toneladas)}`).join(' · ')}</span>, priority: 1 },
                ]} />
            </>
          )}
        </>
      )}
    </>
  );
}
