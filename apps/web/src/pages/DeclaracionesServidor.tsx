import { useEffect, useState } from 'react';
import { Check, X, RefreshCw, Upload, ShieldAlert } from 'lucide-react';
import { ResponsiveTable, FilterBar, type Column } from '../components/data';
import { Badge, Button, DefList, EstadoBadge, Field, Input, PageHeader, Select, Sheet, Tabs, useToast } from '../components/ui';
import { api, ErrorApi, tienePermiso } from '../lib/api';
import { useRouter } from '../lib/router';
import { fmtCOP, fmtNum } from '../lib/format';

interface DeclApi {
  id: string; numero: number; tipo: 'RESIDUO' | 'SERVICIO'; estado: string; autorizacion: string | null; cantidadEstimada: string | null; frecuencia: string | null;
  cliente: { razonSocial: string; nit: string }; sucursal: { nombre: string };
  residuo: { codigo: string; nombre: string; corriente: string | null; peligrosidad: string[]; unidad: string };
  tipoManejo: { nombre: string } | null; embalaje: { nombre: string } | null; tarifaVigente: { precioUnitario: string } | null;
}
const UNI: Record<string, string> = { KG: 'kg', TON: 't', M3: 'm³', GAL: 'gal', L: 'L', UND: 'und', SERVICIO: 'serv.' };

/** Declaraciones leídas del API (modo servidor). La autorización la valida el servidor contra los permisos ambientales. */
export default function DeclaracionesServidor() {
  const toast = useToast();
  const { go } = useRouter();
  const [tipo, setTipo] = useState<'RESIDUO' | 'SERVICIO'>('RESIDUO');
  const [f, setF] = useState({ estado: '', q: '', codigo: '' });
  const [datos, setDatos] = useState<{ total: number; filas: DeclApi[] } | null>(null);
  const [error, setError] = useState('');
  const [sel, setSel] = useState<DeclApi | null>(null);
  const cargar = async () => {
    setError('');
    const qs = new URLSearchParams({ tipo, porPagina: '200', ...(f.estado && { estado: f.estado }), ...(f.q && { q: f.q }), ...(f.codigo && { codigo: f.codigo }) });
    try { setDatos(await api(`/declaraciones?${qs}`)); } catch (e) { setError(e instanceof ErrorApi ? e.message : 'No se pudo cargar.'); }
  };
  useEffect(() => { cargar(); }, [tipo, f.estado]); // eslint-disable-line react-hooks/exhaustive-deps

  const cambiar = async (d: DeclApi, estado: 'AUTORIZADA' | 'RECHAZADA') => {
    try { await api(`/declaraciones/${d.id}/estado`, { metodo: 'PATCH', cuerpo: { estado } }); toast(estado === 'AUTORIZADA' ? `Declaración ${d.numero} autorizada.` : `Declaración ${d.numero} rechazada.`); setSel(null); cargar(); }
    catch (e) { toast(e instanceof ErrorApi ? e.message : 'No se pudo cambiar el estado.', 'warn'); }
  };
  const cols: Column<DeclApi>[] = [
    { key: 'n', header: 'N.º', render: (d) => <span className="num font-medium">{d.numero}</span>, priority: 3 },
    { key: 'nombre', header: tipo === 'RESIDUO' ? 'Residuo' : 'Servicio', render: (d) => <span className="block max-w-[240px] truncate font-medium">{d.residuo.nombre}</span>, priority: 3 },
    { key: 'cod', header: 'Código', render: (d) => <span className="num text-muted">{d.residuo.codigo}</span>, priority: 3 },
    { key: 'cli', header: 'Cliente', render: (d) => <span className="block max-w-[200px] truncate">{d.cliente.razonSocial}</span>, priority: 2 },
    { key: 'sede', header: 'Sede', render: (d) => d.sucursal.nombre, priority: 3 },
    { key: 'corr', header: 'Corriente', render: (d) => d.residuo.corriente ?? '—', priority: 3 },
    { key: 'trat', header: 'Tratamiento', render: (d) => d.tipoManejo?.nombre ?? '—', priority: 2 },
    { key: 'cant', header: 'Cantidad habitual', align: 'right', render: (d) => d.cantidadEstimada ? `${fmtNum(Number(d.cantidadEstimada))} ${UNI[d.residuo.unidad] ?? ''}` : '—', priority: 3 },
    { key: 'precio', header: 'Tarifa vigente', align: 'right', render: (d) => d.tarifaVigente ? fmtCOP(Number(d.tarifaVigente.precioUnitario)) : '—', priority: 2 },
    { key: 'est', header: 'Estado', render: (d) => <EstadoBadge estado={d.estado} />, priority: 3 },
  ];
  return (
    <>
      <PageHeader eyebrow="Comercial" title="Declaraciones" subtitle="Datos del servidor. Al autorizar, el API verifica que el tratamiento esté cubierto por un permiso ambiental vigente."
        actions={<><Button onClick={() => go('importar')}><Upload size={16} /> Importar</Button><Button onClick={cargar}><RefreshCw size={16} /> Actualizar</Button></>} />
      <FilterBar active={Object.values(f).filter(Boolean).length} onClear={() => setF({ estado: '', q: '', codigo: '' })}>
        <Field label="Estado" id="ds-e"><Select id="ds-e" value={f.estado} onChange={(e) => setF((s) => ({ ...s, estado: e.target.value }))}><option value="">Todos</option>{['PENDIENTE', 'AUTORIZADA', 'RECHAZADA', 'INACTIVA'].map((x) => <option key={x} value={x}>{x.charAt(0) + x.slice(1).toLowerCase()}</option>)}</Select></Field>
        <Field label="Nombre" id="ds-q"><Input id="ds-q" value={f.q} onChange={(e) => setF((s) => ({ ...s, q: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && cargar()} placeholder="Enter para buscar" /></Field>
        <Field label="Código" id="ds-c"><Input id="ds-c" value={f.codigo} onChange={(e) => setF((s) => ({ ...s, codigo: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && cargar()} /></Field>
      </FilterBar>
      <div className="mb-3"><Tabs value={tipo} onChange={setTipo} items={[{ value: 'RESIDUO', label: 'Residuos' }, { value: 'SERVICIO', label: 'Servicios' }]} /></div>
      {error ? <p className="flex items-center gap-2 rounded-xl bg-bad/10 p-4 text-bad"><ShieldAlert size={18} />{error}</p>
        : !datos ? <p className="p-6 text-center text-muted">Cargando…</p>
        : <ResponsiveTable rows={datos.filas} columns={cols} rowKey={(d) => d.id} onRowClick={setSel} cardTitle={(d) => d.residuo.nombre} cardBadge={(d) => <EstadoBadge estado={d.estado} />}
            cardMeta={(d) => `N.º ${d.numero} · ${d.cliente.razonSocial} · ${d.sucursal.nombre}`} empty="No hay declaraciones. Impórtelas desde Excel en Ajustes › Importar datos." />}
      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel ? `Declaración ${sel.numero}` : ''}
        footer={sel?.estado === 'PENDIENTE' && tienePermiso('declaraciones.autorizar') && <><Button onClick={() => cambiar(sel, 'RECHAZADA')}><X size={16} /> Rechazar</Button><Button variant="primary" onClick={() => cambiar(sel, 'AUTORIZADA')}><Check size={16} /> Autorizar</Button></>}>
        {sel && <DefList items={[['Residuo / servicio', sel.residuo.nombre], ['Código', sel.residuo.codigo], ['Cliente', `${sel.cliente.razonSocial} (NIT ${sel.cliente.nit})`], ['Sede', sel.sucursal.nombre], ['Corriente', sel.residuo.corriente ?? '—'],
          ['Peligrosidad', sel.residuo.peligrosidad.length ? sel.residuo.peligrosidad.join(', ') : 'No peligroso'], ['Tratamiento', sel.tipoManejo?.nombre ?? '—'], ['Embalaje', sel.embalaje?.nombre ?? '—'],
          ['Frecuencia', sel.frecuencia ?? '—'], ['Tarifa vigente', sel.tarifaVigente ? fmtCOP(Number(sel.tarifaVigente.precioUnitario)) : '—'], ['Estado', <EstadoBadge estado={sel.estado} />], ['Autorización', sel.autorizacion ?? '—'],
          ...(!tienePermiso('declaraciones.autorizar') ? [['Permiso', <Badge>Su rol no autoriza declaraciones</Badge>]] as [string, React.ReactNode][] : [])]} />}
      </Sheet>
    </>
  );
}
