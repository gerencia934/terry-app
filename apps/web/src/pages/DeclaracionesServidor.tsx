import { useState } from 'react';
import { Check, X, RefreshCw, Upload, ShieldAlert, Layers, Plus, FilePen } from 'lucide-react';
import { ResponsiveTable, FilterBar, type Column } from '../components/data';
import { Badge, Button, DefList, EstadoBadge, Field, Input, PageHeader, Select, Sheet, Tabs, useToast } from '../components/ui';
import { BuscarCliente } from '../components/BuscarCliente';
import { api, ErrorApi, tienePermiso } from '../lib/api';
import { useRouter } from '../lib/router';
import { fmtCOP, fmtNum } from '../lib/format';
import { usePaginado, PieLista } from '../lib/servidor';
import { AsignacionMasiva } from './declaraciones/AsignacionMasiva';
import { FormularioDeclaracion } from './declaraciones/FormularioDeclaracion';

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
  const vacio = { estado: '', q: '', codigo: '', clienteId: '' };
  const [f, setF] = useState(vacio);
  // Nombre y código se aplican con Enter (no una consulta por tecla); estado y cliente, al elegirlos.
  const [texto, setTexto] = useState({ q: '', codigo: '' });
  const [sel, setSel] = useState<DeclApi | null>(null);
  const [asignar, setAsignar] = useState(false);
  // Formulario de 8 secciones: null = lista; {} = nueva; { id } = editar
  const [formulario, setFormulario] = useState<null | { id?: string }>(null);
  const qs = new URLSearchParams({ tipo, ...(f.estado && { estado: f.estado }), ...(f.clienteId && { clienteId: f.clienteId }), ...(f.q && { q: f.q }), ...(f.codigo && { codigo: f.codigo }) });
  const lista = usePaginado<DeclApi>(`/declaraciones?${qs}`);
  const cargar = lista.recargar;
  const aplicarTexto = () => setF((s) => ({ ...s, q: texto.q.trim(), codigo: texto.codigo.trim() }));

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
  if (formulario) return (
    <FormularioDeclaracion id={formulario.id} volver={() => setFormulario(null)}
      onGuardada={(g) => {
        toast(g.estado === 'BORRADOR' ? `Declaración ${g.numero} guardada como borrador.` : g.estado === 'AUTORIZADA' ? `Declaración ${g.numero}: cambios guardados; sigue autorizada.` : `Declaración ${g.numero} enviada a revisión.`);
        setFormulario(null); setSel(null); cargar();
      }} />
  );

  return (
    <>
      <PageHeader eyebrow="Comercial" title="Declaraciones" subtitle="Datos del servidor. Al autorizar, el API verifica que el tratamiento esté cubierto por un permiso ambiental vigente."
        actions={<>{tienePermiso('declaraciones.crear') && <><Button variant="primary" onClick={() => setFormulario({})}><Plus size={16} /> Nueva declaración</Button><Button onClick={() => setAsignar(true)}><Layers size={16} /> Asignar servicios</Button></>}<Button onClick={() => go('importar')}><Upload size={16} /> Importar</Button><Button onClick={cargar}><RefreshCw size={16} /> Actualizar</Button></>} />
      <FilterBar active={Object.values(f).filter(Boolean).length} onClear={() => { setF(vacio); setTexto({ q: '', codigo: '' }); }}>
        <Field label="Cliente" id="ds-cli"><BuscarCliente id="ds-cli" valor={f.clienteId} vacio="Todos" onChange={(c) => setF((s) => ({ ...s, clienteId: c?.id ?? '' }))} /></Field>
        <Field label="Estado" id="ds-e"><Select id="ds-e" value={f.estado} onChange={(e) => setF((s) => ({ ...s, estado: e.target.value }))}><option value="">Todos</option>{['BORRADOR', 'PENDIENTE', 'AUTORIZADA', 'RECHAZADA'].map((x) => <option key={x} value={x}>{x.charAt(0) + x.slice(1).toLowerCase()}</option>)}</Select></Field>
        <Field label="Nombre" id="ds-q"><Input id="ds-q" value={texto.q} onChange={(e) => setTexto((s) => ({ ...s, q: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && aplicarTexto()} onBlur={aplicarTexto} placeholder="Enter para buscar" /></Field>
        <Field label="Código" id="ds-c"><Input id="ds-c" value={texto.codigo} onChange={(e) => setTexto((s) => ({ ...s, codigo: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && aplicarTexto()} onBlur={aplicarTexto} /></Field>
      </FilterBar>
      <div className="mb-3"><Tabs value={tipo} onChange={setTipo} items={[{ value: 'RESIDUO', label: 'Residuos' }, { value: 'SERVICIO', label: 'Servicios' }]} /></div>
      {lista.error ? <p className="flex items-center gap-2 rounded-xl bg-bad/10 p-4 text-bad"><ShieldAlert size={18} />{lista.error}</p>
        : !lista.filas ? <p className="p-6 text-center text-muted">Cargando…</p>
        : <ResponsiveTable rows={lista.filas} columns={cols} rowKey={(d) => d.id} onRowClick={setSel} cardTitle={(d) => d.nombre} cardBadge={(d) => <EstadoBadge estado={d.estado} />}
            footer={<PieLista mostradas={lista.filas.length} total={lista.total} hayMas={lista.hayMas} cargando={lista.cargando} cargarMas={lista.cargarMas} />}
            cardMeta={(d) => `N.º ${d.numero} · ${d.cliente.razonSocial} · ${sedes(d)}`} empty="No hay declaraciones con estos filtros. Impórtelas desde Excel en Ajustes › Importar datos." />}
      <AsignacionMasiva abierta={asignar} onClose={() => setAsignar(false)} onListo={cargar} />
      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel ? `Declaración ${sel.numero}` : ''}
        footer={sel && (<>
          {tienePermiso('declaraciones.crear') && <Button onClick={() => setFormulario({ id: sel.id })}><FilePen size={16} /> {sel.estado === 'BORRADOR' ? 'Completar' : 'Editar'}</Button>}
          {sel.estado === 'PENDIENTE' && tienePermiso('declaraciones.autorizar') && <><Button onClick={() => cambiar(sel, 'RECHAZADA')}><X size={16} /> Rechazar</Button><Button variant="primary" onClick={() => cambiar(sel, 'AUTORIZADA')}><Check size={16} /> Autorizar</Button></>}
        </>)}>
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
