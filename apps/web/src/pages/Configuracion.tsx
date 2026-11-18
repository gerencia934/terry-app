import { useState } from 'react';
import { Plus, ShieldCheck, FileText, CalendarClock, Check, Minus } from 'lucide-react';
import { ResponsiveTable, type Column } from '../components/data';
import { Badge, Button, Card, ColorBadge, Field, Input, PageHeader, Select, Sheet, useToast } from '../components/ui';
import { CATALOGO, CLIENTES, ELEMENTOS_CHEQUEO, EMPRESA, HOY, LINEAS, MANEJOS, PERMISOS, PERSONAS, VEHICULOS, ZONAS, zona, type Cliente, type Persona, type Vehiculo } from '../data/mock';
import { cx, diasEntre, fmtFecha } from '../lib/format';
import { negLabel } from './Declaraciones';

const Vence = ({ f }: { f?: string }) => {
  if (!f) return <span className="text-subtle">—</span>;
  const d = diasEntre(HOY, f);
  return <span className="flex flex-col"><span className="num whitespace-nowrap">{fmtFecha(f)}</span>{d <= 45 && <span className={cx('text-[11px] font-medium', d <= 15 ? 'text-bad' : 'text-warn')}>vence en {d} días</span>}</span>;
};

export function Permisos() {
  const toast = useToast();
  return (
    <>
      <PageHeader eyebrow="Configuración · Cumplimiento" title="Permisos ambientales" subtitle="Actos administrativos vigentes, su alcance y las obligaciones con fecha. Cada declaración se valida contra estos permisos antes de autorizarse."
        actions={<Button variant="primary" onClick={() => toast('Registrar permiso: acto, autoridad, alcance, tipos de manejo cubiertos y obligaciones.', 'info')}><Plus size={16} /> Registrar permiso</Button>} />
      <div className="grid gap-4 lg:grid-cols-2">
        {PERMISOS.map((p) => {
          const d = diasEntre(HOY, p.proximaObligacion.fecha);
          return (
            <Card key={p.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="rounded-xl bg-brand-soft p-2.5 text-brand-ink"><ShieldCheck size={20} /></span>
                  <div><p className="font-display text-[16px] font-semibold">{p.acto}</p><p className="text-[13px] text-muted">Corporación Autónoma de Santander ({p.autoridad})</p></div>
                </div>
                <Badge tone="ok" dot>Vigente</Badge>
              </div>
              <p className="mt-3 text-[14px]">{p.alcance}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">{p.manejos.map((m) => <Badge key={m} tone="brand">{MANEJOS.find((x) => x.codigo === m)?.nombre ?? 'Transporte RESPEL'}</Badge>)}</div>
              <div className={cx('mt-4 flex items-start gap-3 rounded-lg p-3 text-[13px]', d <= 15 ? 'bg-bad/10' : d <= 30 ? 'bg-warn/10' : 'bg-surface-2')}>
                <CalendarClock size={17} className={cx('mt-px shrink-0', d <= 15 ? 'text-bad' : d <= 30 ? 'text-warn' : 'text-muted')} />
                <div className="min-w-0 flex-1"><p className="font-medium">{p.proximaObligacion.descripcion}</p><p className="text-muted">{fmtFecha(p.proximaObligacion.fecha)} · faltan {d} días</p></div>
              </div>
              <div className="mt-3 flex gap-2"><Button size="sm" onClick={() => toast(`Abriendo ${p.acto} (PDF).`, 'info')}><FileText size={14} /> Ver acto</Button><Button size="sm" variant="ghost" onClick={() => toast('Obligación marcada como cumplida; se programó la siguiente fecha.')}><Check size={14} /> Marcar cumplida</Button></div>
            </Card>
          );
        })}
      </div>
      <Card title="Certificaciones del sistema integrado de gestión" className="mt-5">
        <div className="flex flex-wrap gap-2">{EMPRESA.certificaciones.map((c) => <Badge key={c} tone="brand">{c}</Badge>)}</div>
        <p className="mt-3 text-[13px] text-muted">Planta: {EMPRESA.planta}.</p>
      </Card>
    </>
  );
}

export function Clientes() {
  const [sel, setSel] = useState<Cliente | null>(null);
  const cols: Column<Cliente>[] = [
    { key: 'nit', header: 'NIT', render: (c) => <span className="num whitespace-nowrap">{c.nit}</span>, priority: 2 },
    { key: 'rs', header: 'Razón social', render: (c) => <span className="font-medium">{c.razonSocial}</span>, priority: 3 },
    { key: 'sec', header: 'Sector', render: (c) => c.sector, priority: 2 },
    { key: 'neg', header: 'Negociación', render: (c) => negLabel(c.negociacion), priority: 3 },
    { key: 'pago', header: 'Forma de pago', render: (c) => c.formaPago.replace('CREDITO_', 'Crédito ').replace('CONTADO', 'Contado') + (c.formaPago.startsWith('CRED') ? ' d' : ''), priority: 3 },
    { key: 'suc', header: 'Sucursales', align: 'center', render: (c) => c.sucursales.length, priority: 3 },
    { key: 'zona', header: 'Zonas', render: (c) => <span className="flex flex-wrap gap-1">{[...new Set(c.sucursales.map((s) => s.zona))].map((z) => <ColorBadge key={z} color={zona(z).color}>{zona(z).nombre}</ColorBadge>)}</span>, priority: 3 },
  ];
  return (
    <>
      <PageHeader eyebrow="Configuración" title="Clientes y sucursales" subtitle="Generadores atendidos, sus sucursales georreferenciadas y condiciones comerciales." actions={<Button variant="primary"><Plus size={16} /> Nuevo cliente</Button>} />
      <ResponsiveTable rows={CLIENTES} columns={cols} rowKey={(c) => c.id} onRowClick={setSel} cardTitle={(c) => c.razonSocial} cardBadge={(c) => <Badge>{c.sucursales.length} suc.</Badge>} />
      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel?.razonSocial ?? ''}>
        {sel && <div className="flex flex-col gap-3">{sel.sucursales.map((s) => (
          <div key={s.id} className="rounded-xl border border-line p-3 text-[13px]"><p className="font-medium">{s.nombre}</p><p className="text-muted">{s.municipio} · {zona(s.zona).nombre}</p><p className="mt-1">{s.contacto} · <span className="num">{s.telefono}</span></p></div>))}</div>}
      </Sheet>
    </>
  );
}

export function Vehiculos() {
  const cols: Column<Vehiculo>[] = [
    { key: 'placa', header: 'Placa', render: (v) => <span className="num rounded-md bg-surface-2 px-2 py-0.5 font-semibold">{v.placa}</span>, priority: 3 },
    { key: 'tipo', header: 'Tipo', render: (v) => v.tipo, priority: 3 },
    { key: 'cap', header: 'Capacidad', render: (v) => v.capacidad, priority: 2 },
    { key: 'soat', header: 'SOAT', render: (v) => <Vence f={v.soat} />, priority: 1 },
    { key: 'rtm', header: 'Revisión técnico-mecánica', render: (v) => <Vence f={v.rtm} />, priority: 1 },
    { key: 'rc', header: 'Póliza RC', render: (v) => <Vence f={v.polizaRc} />, priority: 3 },
  ];
  return (
    <>
      <PageHeader eyebrow="Configuración" title="Vehículos" subtitle="Flota especializada con control de vencimientos. El sistema avisa 30 días antes y bloquea la programación si un documento vence." actions={<Button variant="primary"><Plus size={16} /> Nuevo vehículo</Button>} />
      <ResponsiveTable rows={VEHICULOS} columns={cols} rowKey={(v) => v.id} cardTitle={(v) => <span className="num">{v.placa}</span>} cardMeta={(v) => v.tipo} />
    </>
  );
}

const PERMISOS_MATRIZ = [
  ['Declaraciones: autorizar', [0, 1, 0, 0, 1]], ['Precios: asignar', [0, 0, 0, 1, 1]], ['Rutas: programar', [1, 0, 0, 0, 1]],
  ['Preoperacional: diligenciar', [0, 0, 1, 0, 0]], ['Manifiestos: emitir', [1, 1, 1, 0, 1]], ['Conciliación: justificar', [0, 1, 0, 0, 1]],
  ['Informes: ver facturación', [0, 0, 0, 1, 1]], ['Configuración: editar', [0, 1, 0, 0, 1]],
] as const;
export function Usuarios() {
  const cols: Column<Persona>[] = [
    { key: 'n', header: 'Nombre', render: (p) => <span className="font-medium">{p.nombre}</span>, priority: 3 },
    { key: 'r', header: 'Rol', render: (p) => <Badge tone={p.rol === 'Conductor' ? 'info' : p.rol === 'Gerencia' ? 'brand' : 'neutral'}>{p.rol}</Badge>, priority: 3 },
    { key: 'e', header: 'Usuario', render: (p) => <span className="text-muted">{p.email}</span>, priority: 2 },
    { key: 'l', header: 'Licencia', render: (p) => <Vence f={p.licenciaVence} />, priority: 1 },
    { key: 'c', header: 'Curso mercancías peligrosas', render: (p) => <Vence f={p.cursoMp} />, priority: 1 },
  ];
  return (
    <>
      <PageHeader eyebrow="Configuración" title="Usuarios y roles" subtitle="Personal con acceso a la plataforma, documentos del conductor y permisos por rol." actions={<Button variant="primary"><Plus size={16} /> Invitar usuario</Button>} />
      <ResponsiveTable rows={PERSONAS} columns={cols} rowKey={(p) => p.id} cardTitle={(p) => p.nombre} cardBadge={(p) => <Badge>{p.rol}</Badge>} />
      <Card title="Matriz de permisos por rol" className="mt-5" pad={false}>
        <div className="scroll-x">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead className="bg-surface-2 text-left text-[12px] uppercase tracking-[0.04em] text-muted"><tr><th className="px-4 py-2.5">Permiso</th>{['Logística', 'HSEQ', 'Conductor', 'Facturación', 'Gerencia'].map((r) => <th key={r} className="px-3 py-2.5 text-center">{r}</th>)}</tr></thead>
            <tbody>{PERMISOS_MATRIZ.map(([p, v]) => (
              <tr key={p} className="border-t border-line"><td className="px-4 py-2.5">{p}</td>{v.map((x, i) => <td key={i} className="px-3 py-2.5 text-center">{x ? <Check size={16} className="inline text-ok" aria-label="Sí" /> : <Minus size={16} className="inline text-subtle" aria-label="No" />}</td>)}</tr>))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

// ------------- Catálogos operativos: un solo componente para todos -------------
type Row = { codigo: string; nombre: string; detalle: string; color?: string };
const CATALOGOS: Record<string, { titulo: string; filas: Row[] }> = {
  residuos: { titulo: 'Catálogo de residuos y servicios', filas: CATALOGO.map((c) => ({ codigo: c.codigo, nombre: c.nombre, detalle: `${c.tipo === 'RESIDUO' ? 'Residuo' : 'Servicio'} · ${c.linea}${c.corriente ? ' · ' + c.corriente : ''}` })) },
  manejos: { titulo: 'Tipos de disposición / manejo', filas: MANEJOS.map((m) => ({ codigo: m.codigo, nombre: m.nombre, detalle: m.propio ? 'PSA Los Pinos (propio)' : 'Gestor aliado' })) },
  lineas: { titulo: 'Líneas de servicio', filas: LINEAS.map((l, i) => ({ codigo: `LS-${String(i + 1).padStart(2, '0')}`, nombre: l, detalle: 'Portafolio 2026' })) },
  zonas: { titulo: 'Zonas', filas: ZONAS.map((z) => ({ codigo: z.id.toUpperCase(), nombre: z.nombre, detalle: 'Polígono PostGIS', color: z.color })) },
  embalajes: { titulo: 'Tipos de embalaje', filas: ['Caneca 55 gal', 'Big bag 1 m³', 'Bolsa roja calibre 2', 'Guardián rígido', 'Bidón 20 L', 'Estiba plastificada', 'Carrotanque', 'Volqueta carpada'].map((n, i) => ({ codigo: `EM-${i + 1}`, nombre: n, detalle: '' })) },
  chequeo: { titulo: 'Elementos de chequeo preoperacional', filas: ELEMENTOS_CHEQUEO.flatMap((g) => g.items.map(([n, c], i) => ({ codigo: `${g.grupo.slice(0, 3).toUpperCase()}-${i + 1}`, nombre: n, detalle: `${g.grupo}${c ? ' · crítico' : ''}` }))) },
  causales: { titulo: 'Causales de cancelación y rechazo', filas: ['Cliente no disponible en sitio', 'Vehículo no apto (preoperacional)', 'Residuo sin embalar o sin rotular', 'Clima o vía cerrada', 'Ficha de seguridad incompleta', 'Cliente cambió de operador'].map((n, i) => ({ codigo: `CA-${i + 1}`, nombre: n, detalle: '' })) },
  riesgos: { titulo: 'Riesgos (CRETIB)', filas: [['C', 'Corrosivo'], ['R', 'Reactivo'], ['E', 'Explosivo'], ['T', 'Tóxico'], ['I', 'Inflamable'], ['B', 'Biológico-infeccioso']].map(([c, n]) => ({ codigo: c, nombre: n, detalle: 'Decreto 1076 de 2015' })) },
  campos: { titulo: 'Campos personalizados', filas: [{ codigo: 'CP-1', nombre: 'Orden de compra del cliente', detalle: 'Solicitud · texto' }, { codigo: 'CP-2', nombre: 'Centro de costos', detalle: 'Cliente · lista' }] },
};
export function Catalogos() {
  const toast = useToast();
  const [cat, setCat] = useState('residuos');
  const [nuevo, setNuevo] = useState(false);
  const c = CATALOGOS[cat];
  return (
    <>
      <PageHeader eyebrow="Configuración" title="Catálogos operativos" subtitle="Un único componente administra todos los catálogos: se agregan sin programar pantallas nuevas." actions={<Button variant="primary" onClick={() => setNuevo(true)}><Plus size={16} /> Agregar</Button>} />
      <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
        <div className="lg:hidden"><Field label="Catálogo" id="cat-sel"><Select id="cat-sel" value={cat} onChange={(e) => setCat(e.target.value)}>{Object.entries(CATALOGOS).map(([k, v]) => <option key={k} value={k}>{v.titulo}</option>)}</Select></Field></div>
        <nav className="hidden flex-col gap-1 lg:flex">{Object.entries(CATALOGOS).map(([k, v]) => (
          <button key={k} onClick={() => setCat(k)} className={cx('flex h-10 items-center justify-between rounded-lg px-3 text-left text-[13px]', cat === k ? 'bg-brand-soft font-semibold text-brand-ink' : 'text-muted hover:bg-surface-2')}>
            <span className="truncate">{v.titulo}</span><span className="num text-[12px]">{v.filas.length}</span></button>))}
        </nav>
        <div className="min-w-0">
          <h2 className="mb-3 text-[16px] font-semibold">{c.titulo}</h2>
          <ResponsiveTable rows={c.filas} rowKey={(r) => r.codigo + r.nombre} cardTitle={(r) => r.nombre} cardMeta={(r) => r.detalle}
            columns={[
              { key: 'c', header: 'Código', render: (r) => <span className="num font-medium">{r.codigo}</span>, priority: 2 },
              { key: 'n', header: 'Nombre', render: (r) => r.color ? <ColorBadge color={r.color}>{r.nombre}</ColorBadge> : r.nombre, priority: 3 },
              { key: 'd', header: 'Detalle', render: (r) => <span className="text-muted">{r.detalle || '—'}</span>, priority: 3 },
              { key: 'a', header: 'Activo', render: () => <Badge tone="ok">Activo</Badge>, priority: 3 },
            ]} />
        </div>
      </div>
      <Sheet open={nuevo} onClose={() => setNuevo(false)} title={`Agregar a «${c.titulo}»`} footer={<Button variant="primary" onClick={() => { setNuevo(false); toast('Registro agregado al catálogo.'); }}>Guardar</Button>}>
        <div className="flex flex-col gap-4"><Field label="Código" id="cat-cod"><Input id="cat-cod" /></Field><Field label="Nombre" id="cat-nom"><Input id="cat-nom" /></Field><Field label="Detalle" id="cat-det"><Input id="cat-det" /></Field></div>
      </Sheet>
    </>
  );
}
