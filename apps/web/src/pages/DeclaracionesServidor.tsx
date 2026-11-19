import { useEffect, useState } from 'react';
import { Check, X, RefreshCw, Upload, ShieldAlert, Layers } from 'lucide-react';
import { ResponsiveTable, FilterBar, type Column } from '../components/data';
import { Badge, Button, DefList, EstadoBadge, Field, Input, PageHeader, Select, Sheet, Tabs, useToast } from '../components/ui';
import { api, ErrorApi, tienePermiso } from '../lib/api';
import { useRouter } from '../lib/router';
import { fmtCOP, fmtNum } from '../lib/format';
import { AsignacionMasiva } from './declaraciones/AsignacionMasiva';

interface DeclApi {
  id: string; numero: number; tipo: 'RESIDUO' | 'SERVICIO'; estado: string; activa: boolean; nombre: string; codigoInterno: string | null;
  esPeligroso: boolean; frecuenciaDias: number | null; cantidadFrecuencia: string | null; aprobadaEn: string | null; origenFase1: boolean;
  cliente: { razonSocial: string; nit: string };
  sucursales: { activa: boolean; sucursal: { codigo: string | null; nombre: string } }[];
  categoria: { nombre: string }; lineaServicio: { nombre: string; unidadNegocio: { nombre: string; sigla: string | null } };
  codigoY: { codigo: string } | null; codigoA: { codigo: string } | null;
  disposiciones: { principal: boolean; disposicion: { codigo: string; nombre: string } }[];
  riesgos: { riesgo: { codigo: string } }[]; causal: { nombre: string } | null;
  tarifaVigente: { precioUnitario: string; metrica: { abreviacion: string } | null } | null;
}
const sedes = (d: DeclApi) => d.sucursales.map((s) => s.sucursal.codigo ?? s.sucursal.nombre).join(', ') || '—';
const disposicion = (d: DeclApi) => (d.disposiciones.find((x) => x.principal) ?? d.disposiciones[0])?.disposicion.nombre ?? '—';
const corriente = (d: DeclApi) => [d.codigoY?.codigo, d.codigoA?.codigo].filter(Boolean).join(' / ') || '—';
const tarifa = (d: DeclApi) => d.tarifaVigente ? `${fmtCOP(Number(d.tarifaVigente.precioUnitario))}${d.tarifaVigente.metrica ? ` / ${d.tarifaVigente.metrica.abreviacion}` : ' (global)'}` : '—';

/** Declaraciones leídas del API (modo servidor). La autorización la valida el servidor contra los permisos ambientales. */
export default function DeclaracionesServidor() {
  const toast = useToast();
  const { go } = useRouter();
  const [tipo, setTipo] = useState<'RESIDUO' | 'SERVICIO'>('RESIDUO');
  const [f, setF] = useState({ estado: '', q: '', codigo: '' });
  const [datos, setDatos] = useState<{ total: number; filas: DeclApi[] } | null>(null);
  const [error, setError] = useState('');
  const [sel, setSel] = useState<DeclApi | null>(null);
  const [asignar, setAsignar] = useState(false);
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
    { key: 'nombre', header: tipo === 'RESIDUO' ? 'Residuo' : 'Servicio', render: (d) => <span className="block max-w-[240px] truncate font-medium">{d.nombre}</span>, priority: 3 },
    { key: 'cod', header: 'Código', render: (d) => <span className="num text-muted">{d.codigoInterno ?? '—'}</span>, priority: 3 },
    { key: 'cli', header: 'Cliente', render: (d) => <span className="block max-w-[200px] truncate">{d.cliente.razonSocial}</span>, priority: 2 },
    { key: 'sede', header: 'Sedes', render: (d) => <span className="block max-w-[140px] truncate">{sedes(d)}</span>, priority: 3 },
    ...(tipo === 'RESIDUO' ? [
      { key: 'corr', header: 'Corriente', render: (d) => corriente(d), priority: 3 },
      { key: 'trat', header: 'Disposición', render: (d) => <span className="block max-w-[200px] truncate">{disposicion(d)}</span>, priority: 2 },
    ] satisfies Column<DeclApi>[] : []),
    { key: 'cant', header: 'Cantidad por frecuencia', align: 'right', render: (d) => d.cantidadFrecuencia ? `${fmtNum(Number(d.cantidadFrecuencia))}${d.frecuenciaDias ? ` c/${d.frecuenciaDias} d` : ''}` : '—', priority: 3 },
    { key: 'precio', header: 'Tarifa vigente', align: 'right', render: tarifa, priority: 2 },
    { key: 'est', header: 'Estado', render: (d) => <EstadoBadge estado={d.estado === 'AUTORIZADA' && !d.activa ? 'INACTIVA' : d.estado} />, priority: 3 },
  ];
  return (
    <>
      <PageHeader eyebrow="Comercial" title="Declaraciones" subtitle="Datos del servidor. Al autorizar, el API verifica que el tratamiento esté cubierto por un permiso ambiental vigente."
        actions={<>{tienePermiso('declaraciones.crear') && <Button onClick={() => setAsignar(true)}><Layers size={16} /> Asignar servicios</Button>}<Button onClick={() => go('importar')}><Upload size={16} /> Importar</Button><Button onClick={cargar}><RefreshCw size={16} /> Actualizar</Button></>} />
      <FilterBar active={Object.values(f).filter(Boolean).length} onClear={() => setF({ estado: '', q: '', codigo: '' })}>
        <Field label="Estado" id="ds-e"><Select id="ds-e" value={f.estado} onChange={(e) => setF((s) => ({ ...s, estado: e.target.value }))}><option value="">Todos</option>{['BORRADOR', 'PENDIENTE', 'AUTORIZADA', 'RECHAZADA'].map((x) => <option key={x} value={x}>{x.charAt(0) + x.slice(1).toLowerCase()}</option>)}</Select></Field>
        <Field label="Nombre" id="ds-q"><Input id="ds-q" value={f.q} onChange={(e) => setF((s) => ({ ...s, q: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && cargar()} placeholder="Enter para buscar" /></Field>
        <Field label="Código" id="ds-c"><Input id="ds-c" value={f.codigo} onChange={(e) => setF((s) => ({ ...s, codigo: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && cargar()} /></Field>
      </FilterBar>
      <div className="mb-3"><Tabs value={tipo} onChange={setTipo} items={[{ value: 'RESIDUO', label: 'Residuos' }, { value: 'SERVICIO', label: 'Servicios' }]} /></div>
      {error ? <p className="flex items-center gap-2 rounded-xl bg-bad/10 p-4 text-bad"><ShieldAlert size={18} />{error}</p>
        : !datos ? <p className="p-6 text-center text-muted">Cargando…</p>
        : <ResponsiveTable rows={datos.filas} columns={cols} rowKey={(d) => d.id} onRowClick={setSel} cardTitle={(d) => d.nombre} cardBadge={(d) => <EstadoBadge estado={d.estado} />}
            cardMeta={(d) => `N.º ${d.numero} · ${d.cliente.razonSocial} · ${sedes(d)}`} empty="No hay declaraciones. Impórtelas desde Excel en Ajustes › Importar datos." />}
      <AsignacionMasiva abierta={asignar} onClose={() => setAsignar(false)} onListo={cargar} />
      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel ? `Declaración ${sel.numero}` : ''}
        footer={sel?.estado === 'PENDIENTE' && tienePermiso('declaraciones.autorizar') && <><Button onClick={() => cambiar(sel, 'RECHAZADA')}><X size={16} /> Rechazar</Button><Button variant="primary" onClick={() => cambiar(sel, 'AUTORIZADA')}><Check size={16} /> Autorizar</Button></>}>
        {sel && <DefList items={[['Residuo / servicio', sel.nombre], ['Código interno', sel.codigoInterno ?? '—'], ['Cliente', `${sel.cliente.razonSocial} (NIT ${sel.cliente.nit})`],
          ['Sedes', sel.sucursales.map((s) => `${s.sucursal.codigo ? `${s.sucursal.codigo} · ` : ''}${s.sucursal.nombre}`).join('; ') || '—'],
          ['Categoría', sel.categoria.nombre], ['Línea de servicio', `${sel.lineaServicio.nombre} (${sel.lineaServicio.unidadNegocio.sigla ?? sel.lineaServicio.unidadNegocio.nombre})`],
          ['Peligrosidad', sel.esPeligroso ? `Peligroso · ${corriente(sel)}${sel.riesgos.length ? ` · ${sel.riesgos.map((r) => r.riesgo.codigo).join(', ')}` : ''}` : 'No peligroso'],
          ['Disposición', sel.disposiciones.map((x) => x.disposicion.nombre + (x.principal ? ' (principal)' : '')).join('; ') || '—'],
          ['Frecuencia', sel.frecuenciaDias ? `Cada ${sel.frecuenciaDias} días` : '—'], ['Tarifa vigente', tarifa(sel)],
          ['Estado', <EstadoBadge estado={sel.estado} />], ['Activa', sel.activa ? 'Sí' : 'No'], ...(sel.causal ? [['Causal', sel.causal.nombre]] as [string, React.ReactNode][] : []),
          ...(sel.origenFase1 ? [['Origen', <Badge>Convertida de la fase 1: complétela antes de activarla o autorizarla</Badge>]] as [string, React.ReactNode][] : []),
          ...(!tienePermiso('declaraciones.autorizar') ? [['Permiso', <Badge>Su rol no autoriza declaraciones</Badge>]] as [string, React.ReactNode][] : [])]} />}
      </Sheet>
    </>
  );
}
