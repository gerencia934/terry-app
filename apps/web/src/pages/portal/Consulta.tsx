// Portal de clientes: consulta y descarga de lo suyo. Los PDF se abren con un enlace firmado de 5 minutos que el API
// entrega solo después de verificar que el documento es de la empresa (y de las sedes) del usuario.
import { useState, type ReactNode } from 'react';
import { Award, BadgeCheck, BarChart3, CalendarDays, Clock, Copy, Download, ExternalLink, FileStack, FileText, Loader2, MapPin, Paperclip, Pencil, Plus, Power, ShieldCheck, Trash2, Truck, Upload, Warehouse, type LucideIcon } from 'lucide-react';
import { ResponsiveTable, FilterBar, type Column } from '../../components/data';
import { Badge, Button, Card, DefList, EstadoBadge, Field, Input, Kpi, PageHeader, Select, Sheet, Tabs, useToast } from '../../components/ui';
import { API_URL, api } from '../../lib/api';
import { PieLista, cant, fechaHoraCo, hoyCo, msg, useApi, usePaginado } from '../../lib/servidor';
import { useRouter } from '../../lib/router';
import { cx, fmtCOP, fmtFecha, fmtNum } from '../../lib/format';
import { descargar } from '../../cargues/descargar';
import { nitConDv, puede, puedeHacer, usePortal } from './PortalApp';
import { CancelarSolicitud, CargueDeclaraciones, PedirServicio, pedirAlEntrar, type FormularioSolicitud } from './Escritura';
import { FormDeclaracionPortal } from './FormDeclaracion';
import { abrirEnlace, areaCls, errorPortal } from './comun';

/** Pide el enlace firmado (5 minutos) y abre el PDF en otra pestaña. La pestaña se abre antes de esperar para que el navegador no la bloquee. */
async function abrirDocumento(ruta: string) {
  const w = window.open('', '_blank');
  try {
    const r = await api<{ url: string; vence: string }>(ruta, { metodo: 'POST' });
    const destino = `${API_URL}${r.url}`;
    if (w) { w.opener = null; w.location.href = destino; } else window.location.assign(destino);
  } catch (e) { w?.close(); throw e; }
}
function BotonPdf({ ruta, etiqueta = 'PDF', variant = 'secondary' }: { ruta: string; etiqueta?: string; variant?: 'primary' | 'secondary' | 'ghost' }) {
  const toast = useToast();
  const [ocupado, setOcupado] = useState(false);
  return (
    <Button size="sm" variant={variant} disabled={ocupado} onClick={async (e) => {
      e.stopPropagation(); setOcupado(true);
      try { await abrirDocumento(ruta); } catch (x) { toast(msg(x, 'No se pudo abrir el documento.'), 'warn'); } finally { setOcupado(false); }
    }}>{ocupado ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}{etiqueta}</Button>
  );
}
const Aviso = ({ texto }: { texto: string }) => <p className="rounded-xl bg-bad/10 p-4 text-bad">{texto}</p>;
const Cargando = () => <p className="flex items-center justify-center gap-2 p-6 text-muted"><Loader2 size={16} className="animate-spin" />Cargando…</p>;
const anioActual = () => Number(hoyCo().slice(0, 4));
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// ---------------- Inicio ----------------
interface Resumen {
  declaraciones: { autorizadas: number; pendientes: number }; solicitudesAbiertas: number; serviciosDelMes: number; certificadosDelAnio: number;
  proximos: { id: string; fecha: string | null; residuo: string; sede: string; cantidad: string | null }[];
}
export function PortalInicio() {
  const yo = usePortal();
  const { go } = useRouter();
  const { datos: r, error } = useApi<Resumen>('/portal/resumen');
  const v = (n: number | undefined) => (n === undefined ? '…' : fmtNum(n));
  return (
    <>
      <PageHeader eyebrow={yo.cliente.razonSocial} title={`Hola, ${yo.usuario.nombre.split(' ')[0]}`}
        subtitle="Aquí consulta y descarga lo de su empresa con Terra Viva: residuos declarados, servicios, manifiestos, certificados e informes." />
      {error && <div className="mb-4"><Aviso texto={error} /></div>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Declaraciones autorizadas" value={v(r?.declaraciones.autorizadas)} icon={<FileText size={16} />} hint={r?.declaraciones.pendientes ? `${r.declaraciones.pendientes} en revisión` : 'Residuos y servicios que se pueden recoger'} />
        <Kpi label="Solicitudes abiertas" value={v(r?.solicitudesAbiertas)} icon={<Truck size={16} />} hint="Pendientes o programadas" />
        <Kpi label="Servicios este mes" value={v(r?.serviciosDelMes)} icon={<FileStack size={16} />} hint="Manifiestos grabados" />
        <Kpi label={`Certificados ${anioActual()}`} value={v(r?.certificadosDelAnio)} icon={<Award size={16} />} hint="Emitidos este año" />
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card title="Próximos servicios programados">
          {!r ? <Cargando /> : !r.proximos.length ? <p className="text-muted">No hay servicios programados por ahora.</p> : (
            <ul className="-my-1 divide-y divide-line">
              {r.proximos.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2.5">
                  <span className="flex w-14 shrink-0 flex-col items-center rounded-lg bg-brand-soft py-1 text-brand-ink">
                    {p.fecha ? <><span className="num text-[18px] font-semibold leading-none">{Number(p.fecha.slice(8, 10))}</span><span className="text-[11px] uppercase">{MESES[Number(p.fecha.slice(5, 7)) - 1]}</span></> : <CalendarDays size={18} />}
                  </span>
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{p.residuo}</span><span className="flex items-center gap-1 text-[12px] text-muted"><MapPin size={12} />{p.sede}</span></span>
                  {p.cantidad && <span className="num text-[13px] text-muted">{cant(p.cantidad)}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Accesos rápidos">
          <div className="flex flex-col gap-2">
            {puedeHacer(yo, 'portal.solicitudes.pedir') && <Acceso icon={Truck} titulo="Pedir una recolección" texto="Terra Viva recoge en sus sedes" onClick={() => { pedirAlEntrar.valor = true; go('portal-solicitudes'); }} />}
            {puedeHacer(yo, 'portal.entregas.pedir') && <Acceso icon={Warehouse} titulo="Entrega en planta" texto="Usted lleva el residuo en su vehículo" onClick={() => { pedirAlEntrar.valor = 'DESCARGA'; go('portal-solicitudes'); }} />}
            {puedeHacer(yo, 'portal.declaraciones.gestionar') && <Acceso icon={FileText} titulo="Declarar un residuo" texto="Un residuo o servicio nuevo, con su ficha" onClick={() => { declararAlEntrar.valor = true; go('portal-declaraciones'); }} />}
            {puede(yo, 'portal.certificados.ver') && <Acceso icon={Award} titulo="Descargar certificados" texto="De tratamiento, disposición final y aprovechamiento" onClick={() => go('portal-certificados')} />}
            {yo.cliente.activo && puede(yo, 'portal.certificados.ver') && <AccesoCertificacionComercial />}
            {puede(yo, 'portal.manifiestos.ver') && <Acceso icon={FileStack} titulo="Ver manifiestos" texto="Cada recolección, con lo pesado en planta" onClick={() => go('portal-manifiestos')} />}
            {puede(yo, 'portal.informes.ver') && <Acceso icon={BarChart3} titulo="Informe del año" texto="Lo gestionado por residuo y por mes, en Excel" onClick={() => go('portal-informes')} />}
          </div>
        </Card>
      </div>
    </>
  );
}
/** Certificación comercial con Terra Viva: se expide al pedirla (si ya se expidió hoy, es la misma). */
function AccesoCertificacionComercial() {
  const toast = useToast();
  return <Acceso icon={BadgeCheck} titulo="Certificación comercial" texto="Constancia de su relación comercial con Terra Viva"
    onClick={() => { abrirDocumento('/portal/certificado-comercial').catch((x) => toast(msg(x, 'No se pudo abrir la certificación comercial.'), 'warn')); }} />;
}
function Acceso({ icon: Icono, titulo, texto, onClick }: { icon: LucideIcon; titulo: string; texto: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-3 rounded-xl border border-line p-3 text-left transition-colors hover:border-brand/40 hover:bg-surface-2">
      <span className="rounded-lg bg-brand-soft p-2 text-brand-ink"><Icono size={18} /></span>
      <span className="min-w-0"><span className="block text-[14px] font-medium">{titulo}</span><span className="block text-[12px] text-muted">{texto}</span></span>
    </button>
  );
}

// ---------------- Declaraciones ----------------
interface Precio { precioUnitario: string; metrica: { abreviacion: string } | null }
interface DeclFila {
  id: string; numero: number; tipo: 'RESIDUO' | 'SERVICIO'; nombre: string; codigoInterno: string | null; estado: string; activa: boolean; esPeligroso: boolean | null;
  frecuenciaDias: number | null; cantidadFrecuencia: string | null; lineaServicio: { nombre: string } | null;
  sucursales: { sucursal: { id: string; codigo: string | null; nombre: string } }[]; disposiciones: { principal: boolean; disposicion: { nombre: string } }[]; precio: Precio | null;
  estadoFisico: string | null; inflamable: boolean | null; tieneFichaSeguridad: boolean; codigoY: { codigo: string } | null; codigoA: { codigo: string } | null;
}
interface DeclDetalle extends Omit<DeclFila, 'sucursales' | 'precio'> {
  composicion: string | null; descripcionProceso: string | null; descripcionServicio: string | null; estadoFisico: string | null; tieneFichaSeguridad: boolean; tieneCaracterizacion: boolean;
  inflamable: boolean | null; contieneHidrocarburos: boolean; codigoUn: string | null; riesgos: { riesgo: { nombre: string } }[]; presentacion: string | null; material: { nombre: string } | null;
  observaciones: string | null; aprobadaEn: string | null; responsabilidadAceptada: boolean; aceptadaEn: string | null;
  categoria: { nombre: string } | null; tipoResiduo: { nombre: string } | null; codigoY: { codigo: string; descripcion: string } | null; codigoA: { codigo: string; descripcion: string } | null;
  tipoEmbalaje: { nombre: string } | null; sucursales: { activa: boolean; sucursal: { codigo: string | null; nombre: string } }[];
  tarifas: { precioUnitario: string; vigenteDesde: string; vigenteHasta: string | null; metrica: { abreviacion: string } | null }[];
}
const FISICO: Record<string, string> = { SOLIDO: 'Sólido', SEMISOLIDO: 'Semisólido', LIQUIDO: 'Líquido', GASEOSO: 'Gaseoso' };
const precioTexto = (p: Precio) => `${fmtCOP(Number(p.precioUnitario))}${p.metrica ? ` / ${p.metrica.abreviacion}` : ''}`;
function EstadoDecl({ estado, activa }: { estado: string; activa: boolean }) {
  if (estado === 'AUTORIZADA') return activa ? <Badge tone="ok" dot>Autorizada</Badge> : <Badge dot>Inactiva</Badge>;
  if (estado === 'PENDIENTE') return <Badge tone="warn" dot>En revisión</Badge>;
  if (estado === 'BORRADOR') return <Badge tone="info" dot>En preparación</Badge>;
  return <EstadoBadge estado={estado} />;
}
const principal = (d: { disposiciones: { principal: boolean; disposicion: { nombre: string } }[] }) => (d.disposiciones.find((x) => x.principal) ?? d.disposiciones[0])?.disposicion.nombre;

/** Abre el formulario de declaración al entrar (desde el acceso rápido del inicio). */
export const declararAlEntrar = { valor: false };

export function PortalDeclaraciones() {
  const yo = usePortal();
  const toast = useToast();
  const [cargar, setCargar] = useState(false);
  const [formulario, setFormulario] = useState<null | { id?: string }>(() => { const v = declararAlEntrar.valor && puedeHacer(yo, 'portal.declaraciones.gestionar'); declararAlEntrar.valor = false; return v ? {} : null; });
  const vacio = { q: '', estado: '', tipo: '', activa: '' };
  const [f, setF] = useState(vacio);
  const [texto, setTexto] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const qs = new URLSearchParams({ ...(f.q && { q: f.q }), ...(f.estado && { estado: f.estado }), ...(f.tipo && { tipo: f.tipo }), ...(f.activa && { activa: f.activa }) }).toString();
  const lista = usePaginado<DeclFila>(`/portal/declaraciones?${qs}`);
  const escribe = puedeHacer(yo, 'portal.declaraciones.gestionar');
  const precios = puede(yo, 'portal.precios.ver');
  if (formulario) return (
    <FormDeclaracionPortal id={formulario.id} volver={() => setFormulario(null)} listo={(r) => {
      toast(formulario.id ? `Declaración N.° ${r.numero} corregida: queda en revisión de Terra Viva${r.estabaAutorizada ? ' (no se puede pedir hasta que la autoricen de nuevo)' : ''}.`
        : `Declaración N.° ${r.numero} enviada: Terra Viva la revisa, fija la tarifa y la autoriza.`);
      setFormulario(null); setSel(null); lista.recargar();
    }} />
  );
  const cols: Column<DeclFila>[] = [
    { key: 'n', header: 'N.º', render: (d) => <span className="num font-medium">{d.numero}</span>, priority: 3 },
    { key: 'nom', header: 'Residuo o servicio', render: (d) => <span className="flex max-w-[320px] flex-col"><span className="truncate font-medium">{d.nombre}</span>{d.codigoInterno && <span className="text-[12px] text-muted">Su código: {d.codigoInterno}</span>}</span>, priority: 3 },
    { key: 't', header: 'Clasificación', render: (d) => <span className="flex flex-wrap gap-1"><Badge>{d.tipo === 'RESIDUO' ? 'Residuo' : 'Servicio'}</Badge>{d.esPeligroso && <Badge tone="warn">Peligroso{d.codigoY || d.codigoA ? ` · ${[d.codigoY?.codigo, d.codigoA?.codigo].filter(Boolean).join(' / ')}` : ''}</Badge>}{d.inflamable && <Badge tone="bad">Inflamable</Badge>}</span>, priority: 2 },
    { key: 'ef', header: 'Estado físico', render: (d) => (d.estadoFisico ? FISICO[d.estadoFisico] ?? d.estadoFisico : '—'), priority: 1 },
    { key: 's', header: 'Sedes', render: (d) => <span className="block max-w-[220px] truncate">{d.sucursales.map((s) => s.sucursal.nombre).join(', ') || '—'}</span>, priority: 1 },
    { key: 'disp', header: 'Tratamiento', render: (d) => <span className="block max-w-[220px] truncate">{principal(d) ?? '—'}</span>, priority: 1 },
    { key: 'fds', header: 'Ficha', render: (d) => (d.tieneFichaSeguridad ? <span title="Ficha de datos de seguridad en el expediente" className="text-ok"><Paperclip size={15} /></span> : <span className="text-subtle">—</span>), priority: 1 },
    ...(precios ? [{ key: 'p', header: 'Tarifa vigente', align: 'right', render: (d) => (d.precio ? <span className="whitespace-nowrap">{precioTexto(d.precio)}</span> : '—'), priority: 2 } satisfies Column<DeclFila>] : []),
    { key: 'e', header: 'Estado', render: (d) => <EstadoDecl estado={d.estado} activa={d.activa} />, priority: 3 },
  ];
  return (
    <>
      <PageHeader title="Declaraciones" subtitle="Los residuos y servicios que su empresa tiene declarados con Terra Viva. Una declaración autorizada y activa es la que se puede pedir y recoger; las que usted declara o corrige quedan en revisión."
        actions={escribe ? <div className="flex flex-wrap gap-2"><Button variant="primary" onClick={() => setFormulario({})}><Plus size={16} /> Nueva declaración</Button>
          <Button onClick={() => setCargar(true)}><Upload size={16} /> Cargar varias desde Excel</Button></div> : undefined} />
      <FilterBar active={Number(!!f.q) + Number(!!f.estado) + Number(!!f.tipo) + Number(!!f.activa)} onClear={() => { setF(vacio); setTexto(''); }}>
        <Field label="Buscar" id="pd-q"><Input id="pd-q" value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setF((s) => ({ ...s, q: texto.trim() }))}
          onBlur={() => setF((s) => ({ ...s, q: texto.trim() }))} placeholder="Nombre o su código · Enter" /></Field>
        <Field label="Estado" id="pd-e"><Select id="pd-e" value={f.estado} onChange={(e) => setF((s) => ({ ...s, estado: e.target.value }))}>
          <option value="">Todos</option><option value="AUTORIZADA">Autorizadas</option><option value="PENDIENTE">En revisión</option><option value="BORRADOR">En preparación</option><option value="RECHAZADA">Rechazadas</option>
        </Select></Field>
        <Field label="Activo / inactivo" id="pd-a"><Select id="pd-a" value={f.activa} onChange={(e) => setF((s) => ({ ...s, activa: e.target.value }))}><option value="">Todos</option><option value="true">Activos</option><option value="false">Inactivos</option></Select></Field>
        <Field label="Tipo" id="pd-t"><Select id="pd-t" value={f.tipo} onChange={(e) => setF((s) => ({ ...s, tipo: e.target.value }))}><option value="">Todos</option><option value="RESIDUO">Residuos</option><option value="SERVICIO">Servicios</option></Select></Field>
      </FilterBar>
      {lista.error ? <Aviso texto={lista.error} /> : !lista.filas ? <Cargando />
        : <ResponsiveTable rows={lista.filas} columns={cols} rowKey={(d) => d.id} onRowClick={(d) => setSel(d.id)} cardTitle={(d) => d.nombre} cardBadge={(d) => <EstadoDecl estado={d.estado} activa={d.activa} />}
            cardMeta={(d) => `N.º ${d.numero}${d.codigoInterno ? ` · su código ${d.codigoInterno}` : ''}`}
            footer={<PieLista mostradas={lista.filas.length} total={lista.total} hayMas={lista.hayMas} cargando={lista.cargando} cargarMas={lista.cargarMas} />}
            empty={escribe ? 'No hay declaraciones con estos filtros. Declare un residuo o servicio con «Nueva declaración».' : 'No hay declaraciones con estos filtros.'} />}
      <Sheet open={!!sel} onClose={() => setSel(null)} title="Declaración">{sel && <DetalleDeclaracion id={sel} escribe={escribe} corregir={() => setFormulario({ id: sel })} cambio={() => { setSel(null); lista.recargar(); }} />}</Sheet>
      <Sheet open={cargar} onClose={() => setCargar(false)} title="Cargar declaraciones">
        {cargar && <CargueDeclaraciones listo={() => { setCargar(false); lista.recargar(); }} />}
      </Sheet>
    </>
  );
}

function DetalleDeclaracion({ id, escribe, corregir, cambio }: { id: string; escribe: boolean; corregir: () => void; cambio: () => void }) {
  const toast = useToast();
  const precios = puede(usePortal(), 'portal.precios.ver');
  const { datos: d, error } = useApi<DeclDetalle>(`/portal/declaraciones/${id}`);
  const [accion, setAccion] = useState<'' | 'retirar' | 'inactivar'>('');
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  if (error) return <Aviso texto={error} />;
  if (!d) return <Cargando />;
  const hoy = hoyCo();
  const vigente = d.tarifas.find((t) => t.vigenteDesde.slice(0, 10) <= hoy && (!t.vigenteHasta || t.vigenteHasta.slice(0, 10) >= hoy));
  const residuo = d.tipo === 'RESIDUO';
  const autorizada = d.estado === 'AUTORIZADA';
  const ver = (cual: 'ficha' | 'caracterizacion') => abrirEnlace(`/portal/declaraciones/${id}/${cual}/enlace`).catch((e) => toast(errorPortal(e, 'No se pudo abrir el documento.'), 'warn'));
  const confirmar = async () => {
    setOcupado(true);
    try {
      await api(`/portal/declaraciones/${id}/${accion}`, { cuerpo: { motivo: motivo.trim() } });
      toast(accion === 'retirar' ? `Declaración N.° ${d.numero} retirada.` : `Declaración N.° ${d.numero} inactivada: ya no se puede pedir. Para volver a activarla, escríbale a Terra Viva.`);
      cambio();
    } catch (e) { toast(errorPortal(e, 'No se pudo completar.'), 'warn'); }
    setOcupado(false);
  };
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="font-display text-[18px] font-semibold leading-tight">{d.nombre}</p>
        <p className="mt-1.5 flex flex-wrap gap-1.5"><EstadoDecl estado={d.estado} activa={d.activa} /><Badge>{residuo ? 'Residuo' : 'Servicio'}</Badge>{d.esPeligroso && <Badge tone="warn">Peligroso</Badge>}</p>
      </div>
      <DefList items={[
        ['Número', <span className="num">{d.numero}</span>], ['Su código', d.codigoInterno ?? '—'], ['Línea de servicio', d.lineaServicio?.nombre ?? '—'],
        ...(residuo ? [
          ['Categoría', d.categoria?.nombre ?? '—'], ['Tipo de residuo', d.tipoResiduo?.nombre ?? '—'], ['Estado físico', d.estadoFisico ? FISICO[d.estadoFisico] ?? d.estadoFisico : '—'],
          ['Inflamable', d.inflamable === null ? '—' : d.inflamable ? 'Sí' : 'No'], ['Contiene hidrocarburos', d.contieneHidrocarburos ? 'Sí' : 'No'],
          ['Embalaje', [d.tipoEmbalaje?.nombre, d.material?.nombre, d.presentacion].filter(Boolean).join(' · ') || '—'],
          ...(d.esPeligroso ? [['Corriente Y / código A', [d.codigoY && `${d.codigoY.codigo} ${d.codigoY.descripcion}`, d.codigoA && `${d.codigoA.codigo} ${d.codigoA.descripcion}`].filter(Boolean).join(' · ') || '—'] as [string, ReactNode],
            ['Características de peligrosidad', d.riesgos.map((r) => r.riesgo.nombre).join(', ') || '—'] as [string, ReactNode], ['Número UN', d.codigoUn ?? '—'] as [string, ReactNode]] : []),
          ['Composición', d.composicion ?? '—'], ['Proceso que lo genera', d.descripcionProceso ?? '—'],
        ] as [string, ReactNode][] : [['Descripción', d.descripcionServicio ?? '—'] as [string, ReactNode]]),
        ['Frecuencia', d.frecuenciaDias ? `Cada ${d.frecuenciaDias} días${d.cantidadFrecuencia ? ` · ${cant(d.cantidadFrecuencia)} por servicio` : ''}` : 'A solicitud'],
        ['Tratamiento', d.disposiciones.map((x) => `${x.disposicion.nombre}${x.principal && d.disposiciones.length > 1 ? ' (principal)' : ''}`).join(' · ') || 'Lo define Terra Viva'],
        ['Sedes', d.sucursales.filter((s) => s.activa).map((s) => `${s.sucursal.codigo ? `${s.sucursal.codigo} · ` : ''}${s.sucursal.nombre}`).join(', ') || '—'],
        ...(precios ? [['Tarifa vigente', vigente ? precioTexto(vigente) : '—'] as [string, ReactNode]] : []),
        ['Autorizada', d.aprobadaEn ? fechaHoraCo(d.aprobadaEn) : '—'],
        ['Responsabilidad del generador', d.responsabilidadAceptada ? `Aceptada${d.aceptadaEn ? ` el ${fechaHoraCo(d.aceptadaEn)}` : ''}` : 'Sin aceptar'],
      ]} />
      {(d.tieneFichaSeguridad || d.tieneCaracterizacion) && (
        <div className="flex flex-wrap gap-2">
          {d.tieneFichaSeguridad && <Button size="sm" onClick={() => ver('ficha')}><Paperclip size={14} /> Ficha de datos de seguridad</Button>}
          {d.tieneCaracterizacion && <Button size="sm" onClick={() => ver('caracterizacion')}><Paperclip size={14} /> Caracterización</Button>}
        </div>
      )}
      {d.observaciones && <p className="whitespace-pre-line rounded-lg bg-surface-2 p-3 text-[13px] text-muted">{d.observaciones}</p>}
      {d.tarifas.length > 1 && (
        <div>
          <h3 className="mb-2 text-[14px] font-semibold">Historial de tarifas</h3>
          <ul className="flex flex-col gap-1 text-[13px]">
            {d.tarifas.map((t, i) => <li key={i} className="flex justify-between gap-3"><span className="text-muted">{fmtFecha(t.vigenteDesde)}{t.vigenteHasta ? ` a ${fmtFecha(t.vigenteHasta)}` : ' en adelante'}</span><span className="num">{precioTexto(t)}</span></li>)}
          </ul>
        </div>
      )}
      {escribe && !accion && (
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <Button size="sm" variant="primary" onClick={corregir}><Pencil size={14} /> Corregir</Button>
          {!autorizada && <Button size="sm" variant="ghost" onClick={() => setAccion('retirar')}><Trash2 size={14} /> Retirar</Button>}
          {autorizada && d.activa && <Button size="sm" variant="ghost" onClick={() => setAccion('inactivar')}><Power size={14} /> Ya no lo genero: inactivar</Button>}
        </div>
      )}
      {escribe && autorizada && !accion && <p className="text-[12px] text-subtle">Corregir una declaración autorizada la devuelve a revisión: no se puede pedir hasta que Terra Viva la autorice de nuevo.</p>}
      {accion && (
        <div className="flex flex-col gap-2 rounded-xl border border-bad/30 bg-bad/5 p-3">
          <p className="text-[13px] font-medium">{accion === 'retirar' ? '¿Retirar esta declaración? Queda anulada como constancia y su código interno queda libre.' : '¿Inactivarla? Ya no se podrá pedir; para activarla de nuevo, escríbale a Terra Viva.'}</p>
          <Field label="Motivo" id="dd-m"><textarea id="dd-m" className={areaCls} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} placeholder={accion === 'retirar' ? 'Ej.: la declaramos por error' : 'Ej.: cambiamos el proceso y ya no lo generamos'} /></Field>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setAccion(''); setMotivo(''); }}>Volver</Button>
            <Button size="sm" variant="danger" disabled={motivo.trim().length < 5 || ocupado} onClick={confirmar}>{ocupado && <Loader2 size={14} className="animate-spin" />}{accion === 'retirar' ? 'Retirar' : 'Inactivar'}</Button>
          </div>
        </div>
      )}
      {!escribe && <p className="text-[12px] text-subtle">¿Necesita corregir algo? Pídaselo al administrador de su empresa en el portal o a su asesor comercial de Terra Viva.</p>}
    </div>
  );
}

// ---------------- Solicitudes ----------------
interface SolFila {
  id: string; numero: number; clase: 'PRE' | 'FORMAL'; operacion: 'CARGA' | 'DESCARGA'; fechaSolicitada: string; aprobacion: 'PENDIENTE' | 'APROBADA' | 'NO_APROBADA'; estado: string;
  ordenCompra: string | null; observaciones: string | null; totalEstimado: number | null; telefonoContacto: string | null; tieneAdjunto: boolean; createdAt: string;
  destino: { razonSocial: string } | null; transporte: { empresaTransportadora: string; tipoVehiculo: string | null; placa: string | null; conductorNombre: string | null } | null;
  items: { id: string; estado: string; cantidadEstimada: string | null; cantidadReal: string | null; jornada: string | null; declaracion: { nombre: string; codigoInterno: string | null };
    sucursal: { nombre: string }; especificaciones: { especificacion: { nombre: string } }[] }[];
}
const ITEM: Record<string, { t: string; tono: 'neutral' | 'info' | 'ok' }> = { PENDIENTE: { t: 'Por programar', tono: 'neutral' }, PROGRAMADO: { t: 'Programado', tono: 'info' }, REALIZADO: { t: 'Recogido', tono: 'ok' }, DESCARTADO: { t: 'Descartado', tono: 'neutral' } };
const JORNADA: Record<string, string> = { AM: 'mañana', PM: 'tarde', DIA: 'todo el día' };
function EstadoSol({ s }: { s: SolFila }) {
  if (s.aprobacion === 'NO_APROBADA') return <EstadoBadge estado="NO_APROBADA" />;
  if (s.aprobacion === 'PENDIENTE' && s.estado === 'PENDIENTE') return <Badge tone="warn" dot>Por confirmar</Badge>;
  return <EstadoBadge estado={s.estado} />;
}
const origen = (s: SolFila) => (s.clase === 'PRE' ? 'Recurrente' : s.operacion === 'DESCARGA' ? 'Entrega en planta' : 'Recolección');
const porConfirmar = (s: SolFila) => s.clase === 'FORMAL' && s.aprobacion === 'PENDIENTE' && s.estado === 'PENDIENTE';

export function PortalSolicitudes() {
  const yo = usePortal();
  const toast = useToast();
  const pideCarga = puedeHacer(yo, 'portal.solicitudes.pedir'), pideEntrega = puedeHacer(yo, 'portal.entregas.pedir');
  const escribe = pideCarga || pideEntrega;
  const puedeOperar = (s: SolFila) => (s.operacion === 'DESCARGA' ? pideEntrega : pideCarga);
  const vacio = { estado: '', operacion: '', desde: '', hasta: '' };
  const [f, setF] = useState(vacio);
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const lista = usePaginado<SolFila>(`/portal/solicitudes?${qs}`);
  const [sel, setSel] = useState<SolFila | null>(null);
  const [pedir, setPedir] = useState<null | { modo: 'nuevo' | 'editar' | 'repetir'; base?: FormularioSolicitud; operacion?: 'CARGA' | 'DESCARGA' }>(() => {
    const v = pedirAlEntrar.valor; pedirAlEntrar.valor = false;
    const operacion = v === 'DESCARGA' ? 'DESCARGA' as const : 'CARGA' as const;
    return v && (operacion === 'DESCARGA' ? pideEntrega : pideCarga) ? { modo: 'nuevo', operacion } : null;
  });
  const [abriendo, setAbriendo] = useState(false);
  const residuos = (s: SolFila) => { const n = s.items.map((i) => i.declaracion.nombre); return n.length > 2 ? `${n.slice(0, 2).join(', ')} y ${n.length - 2} más` : n.join(', ') || '—'; };
  const desde = async (modo: 'editar' | 'repetir', s: SolFila) => {
    setAbriendo(true);
    try { const base = await api<FormularioSolicitud>(`/portal/solicitudes/${s.id}/formulario`); setSel(null); setPedir({ modo, base }); }
    catch (e) { toast(errorPortal(e, 'No se pudo abrir la solicitud.'), 'warn'); }
    setAbriendo(false);
  };
  const cols: Column<SolFila>[] = [
    { key: 'n', header: 'N.º', render: (s) => <span className="num font-medium">{s.numero}</span>, priority: 3 },
    { key: 'f', header: 'Fecha', render: (s) => <span className="whitespace-nowrap">{fmtFecha(s.fechaSolicitada)}</span>, priority: 2 },
    { key: 'o', header: 'Tipo', render: (s) => origen(s), priority: 2 },
    { key: 'r', header: 'Residuos', render: (s) => <span className="block max-w-[340px] truncate">{residuos(s)}</span>, priority: 3 },
    { key: 's', header: 'Sedes', render: (s) => <span className="block max-w-[200px] truncate">{[...new Set(s.items.map((i) => i.sucursal.nombre))].join(', ') || '—'}</span>, priority: 1 },
    { key: 'oc', header: 'Orden de compra', render: (s) => s.ordenCompra ?? '—', priority: 1 },
    { key: 'e', header: 'Estado', render: (s) => <EstadoSol s={s} />, priority: 3 },
  ];
  return (
    <>
      <PageHeader title="Solicitudes de servicio" subtitle="Las recolecciones y entregas en planta pedidas para su empresa y en qué van. Lo que usted pide queda «por confirmar» hasta que Terra Viva lo apruebe y lo programe; mientras tanto lo puede corregir o cancelar."
        actions={escribe ? <div className="flex flex-wrap gap-2">{pideCarga && <Button variant="primary" onClick={() => setPedir({ modo: 'nuevo', operacion: 'CARGA' })}><Plus size={16} /> Pedir una recolección</Button>}
          {pideEntrega && <Button variant={pideCarga ? 'secondary' : 'primary'} onClick={() => setPedir({ modo: 'nuevo', operacion: 'DESCARGA' })}><Truck size={16} /> Entrega en planta</Button>}</div> : undefined} />
      <FilterBar active={Object.values(f).filter(Boolean).length} onClear={() => setF(vacio)}>
        <Field label="Estado" id="sl-e"><Select id="sl-e" value={f.estado} onChange={(e) => setF((s) => ({ ...s, estado: e.target.value }))}>
          <option value="">Todos</option><option value="POR_CONFIRMAR">Por confirmar</option><option value="PENDIENTE">Confirmadas, por programar</option><option value="PROGRAMADA">Programadas</option>
          <option value="EN_CURSO">En curso</option><option value="RECOLECTADA">Recogidas</option><option value="CANCELADA">Canceladas</option><option value="NO_APROBADA">No aprobadas</option>
        </Select></Field>
        <Field label="Tipo" id="sl-t"><Select id="sl-t" value={f.operacion} onChange={(e) => setF((s) => ({ ...s, operacion: e.target.value }))}><option value="">Todos</option><option value="CARGA">Recolecciones</option><option value="DESCARGA">Entregas en planta</option></Select></Field>
        <Field label="Desde" id="sl-d"><Input id="sl-d" type="date" value={f.desde} onChange={(e) => setF((s) => ({ ...s, desde: e.target.value }))} /></Field>
        <Field label="Hasta" id="sl-h"><Input id="sl-h" type="date" value={f.hasta} onChange={(e) => setF((s) => ({ ...s, hasta: e.target.value }))} /></Field>
      </FilterBar>
      {lista.error ? <Aviso texto={lista.error} /> : !lista.filas ? <Cargando />
        : <ResponsiveTable rows={lista.filas} columns={cols} rowKey={(s) => s.id} onRowClick={setSel} cardTitle={(s) => <span>{origen(s)} <span className="num">{s.numero}</span></span>}
            cardBadge={(s) => <EstadoSol s={s} />} cardMeta={(s) => `${fmtFecha(s.fechaSolicitada)} · ${residuos(s)}`}
            footer={<PieLista mostradas={lista.filas.length} total={lista.total} hayMas={lista.hayMas} cargando={lista.cargando} cargarMas={lista.cargarMas} />}
            empty={Object.values(f).some(Boolean) ? 'No hay solicitudes con estos filtros.' : 'Su empresa aún no tiene solicitudes de servicio.'} />}
      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel ? <span>{origen(sel)} <span className="num">{sel.numero}</span></span> : ''}>
        {sel && (
          <div className="flex flex-col gap-5">
            <DefList items={[['Fecha', fmtFecha(sel.fechaSolicitada)], ['Tipo', origen(sel)], ['Estado', <EstadoSol s={sel} />], ['Orden de compra', sel.ordenCompra ?? '—'],
              ...(sel.totalEstimado ? [['Valor estimado', fmtCOP(sel.totalEstimado)] as [string, ReactNode]] : []),
              ...(sel.operacion === 'DESCARGA' ? [['Planta', sel.destino?.razonSocial ?? '—'] as [string, ReactNode],
                ['Vehículo', sel.transporte ? [sel.transporte.placa, sel.transporte.tipoVehiculo, sel.transporte.empresaTransportadora].filter(Boolean).join(' · ') : '—'] as [string, ReactNode],
                ['Conductor', sel.transporte?.conductorNombre ?? '—'] as [string, ReactNode], ['Teléfono de contacto', sel.telefonoContacto ?? '—'] as [string, ReactNode]] : []),
              ...(sel.observaciones ? [['Observaciones', <span className="whitespace-pre-line">{sel.observaciones}</span>] as [string, ReactNode]] : [])]} />
            {sel.tieneAdjunto && <div><Button size="sm" onClick={() => abrirEnlace(`/portal/solicitudes/${sel.id}/adjunto/enlace`).catch((e) => toast(errorPortal(e, 'No se pudo abrir el PDF.'), 'warn'))}><Paperclip size={14} /> Ver el PDF adjunto</Button></div>}
            <div>
              <h3 className="mb-2 text-[14px] font-semibold">Residuos ({sel.items.length})</h3>
              <ul className="flex flex-col gap-2">
                {sel.items.map((i) => (
                  <li key={i.id} className="rounded-xl border border-line p-3 text-[13px]">
                    <div className="flex items-start justify-between gap-2"><span className="font-medium">{i.declaracion.nombre}</span><Badge tone={ITEM[i.estado]?.tono ?? 'neutral'}>{ITEM[i.estado]?.t ?? i.estado}</Badge></div>
                    <p className="mt-1 flex items-center gap-1 text-muted"><MapPin size={12} />{i.sucursal.nombre}{i.jornada ? ` · ${JORNADA[i.jornada] ?? i.jornada}` : ''}</p>
                    <p className="mt-0.5 text-muted">Estimado: <span className="num">{cant(i.cantidadEstimada)}</span>{i.cantidadReal !== null && <> · Recogido: <span className="num">{cant(i.cantidadReal)}</span></>}</p>
                    {i.especificaciones.length > 0 && <p className="mt-1 flex flex-wrap gap-1">{i.especificaciones.map((e) => <Badge key={e.especificacion.nombre}>{e.especificacion.nombre}</Badge>)}</p>}
                  </li>
                ))}
              </ul>
            </div>
            {puedeOperar(sel) && (
              <div className="flex flex-wrap gap-2 border-t border-line pt-4">
                {porConfirmar(sel) && <Button size="sm" variant="primary" disabled={abriendo} onClick={() => desde('editar', sel)}><Pencil size={14} /> Corregir</Button>}
                {sel.clase === 'FORMAL' && <Button size="sm" disabled={abriendo} onClick={() => desde('repetir', sel)}><Copy size={14} /> Pedir de nuevo</Button>}
              </div>
            )}
            {puede(yo, sel.operacion === 'DESCARGA' ? 'portal.entregas.pedir' : 'portal.solicitudes.pedir') && porConfirmar(sel) && <CancelarSolicitud id={sel.id} numero={sel.numero} listo={() => { setSel(null); lista.recargar(); }} />}
          </div>
        )}
      </Sheet>
      <Sheet open={!!pedir} onClose={() => setPedir(null)} title={pedir?.modo === 'editar' ? `Corregir la solicitud ${pedir.base?.numero ?? ''}` : pedir?.modo === 'repetir' ? `Pedir de nuevo la ${pedir.base?.numero ?? ''}` : 'Pedir un servicio'}>
        {pedir && <PedirServicio modo={pedir.modo} base={pedir.base} operacionInicial={pedir.operacion} listo={() => { setPedir(null); lista.recargar(); }} />}
      </Sheet>
    </>
  );
}

// ---------------- Manifiestos ----------------
interface MfFila {
  id: string; numero: string; tipo: 'CARGUE' | 'DESCARGUE'; estado: 'REALIZADO' | 'ANULADO'; fechaServicio: string; destino: { razonSocial: string; esPropio: boolean };
  items: { id: string; cantidad: string; metrica: { abreviacion: string } | null; declaracion: { nombre: string }; sucursal: { nombre: string }; conciliacion: { cantidadConciliada: string | null } | null }[];
  conciliacion: { estado: 'BORRADOR' | 'APROBADA' | 'ANULADA' } | null;
}
const TIPO_MF = { CARGUE: 'Recolección en su sede', DESCARGUE: 'Entrega en planta' };
function EstadoConc({ m }: { m: MfFila }) {
  if (m.estado === 'ANULADO') return <EstadoBadge estado="ANULADO" />;
  if (m.conciliacion?.estado === 'APROBADA') return <Badge tone="ok" dot>Pesado y conciliado</Badge>;
  return <Badge tone="info" dot>Pesaje en revisión</Badge>;
}

export function PortalManifiestos() {
  const vacio = { desde: '', hasta: '' };
  const [f, setF] = useState(vacio);
  const [sel, setSel] = useState<MfFila | null>(null);
  const qs = new URLSearchParams({ ...(f.desde && { desde: f.desde }), ...(f.hasta && { hasta: f.hasta }) }).toString();
  const lista = usePaginado<MfFila>(`/portal/manifiestos?${qs}`);
  const cols: Column<MfFila>[] = [
    { key: 'n', header: 'Número', render: (m) => <span className="num font-medium">{m.numero}</span>, priority: 3 },
    { key: 'f', header: 'Fecha', render: (m) => <span className="whitespace-nowrap">{fmtFecha(m.fechaServicio)}</span>, priority: 2 },
    { key: 't', header: 'Servicio', render: (m) => TIPO_MF[m.tipo], priority: 2 },
    { key: 'r', header: 'Residuos', render: (m) => <span className="block max-w-[300px] truncate">{m.items.map((i) => i.declaracion.nombre).join(', ') || '—'}</span>, priority: 3 },
    { key: 'd', header: 'Destino', render: (m) => <span className="block max-w-[220px] truncate">{m.destino.razonSocial}</span>, priority: 1 },
    { key: 'e', header: 'Estado', render: (m) => <EstadoConc m={m} />, priority: 3 },
    { key: 'pdf', header: 'Documento', render: (m) => (m.estado === 'REALIZADO' ? <BotonPdf ruta={`/portal/manifiestos/${m.id}/enlace`} /> : '—'), priority: 3 }, // 3: no va en las tarjetas del celular (el PDF se abre desde el detalle)
  ];
  return (
    <>
      <PageHeader title="Manifiestos de transporte" subtitle="Cada recolección o entrega de sus residuos, con lo cargado en la sede y lo pesado en la planta. Descargue el PDF firmado de cada uno." />
      <FilterBar active={Number(!!f.desde) + Number(!!f.hasta)} onClear={() => setF(vacio)}>
        <Field label="Desde" id="pm-d"><Input id="pm-d" type="date" value={f.desde} onChange={(e) => setF((s) => ({ ...s, desde: e.target.value }))} /></Field>
        <Field label="Hasta" id="pm-h"><Input id="pm-h" type="date" value={f.hasta} onChange={(e) => setF((s) => ({ ...s, hasta: e.target.value }))} /></Field>
      </FilterBar>
      {lista.error ? <Aviso texto={lista.error} /> : !lista.filas ? <Cargando />
        : <ResponsiveTable rows={lista.filas} columns={cols} rowKey={(m) => m.id} onRowClick={setSel} cardTitle={(m) => <span className="num">{m.numero}</span>} cardBadge={(m) => <EstadoConc m={m} />}
            cardMeta={(m) => m.items.map((i) => i.declaracion.nombre).join(', ')}
            footer={<PieLista mostradas={lista.filas.length} total={lista.total} hayMas={lista.hayMas} cargando={lista.cargando} cargarMas={lista.cargarMas} />}
            empty="No hay manifiestos en estas fechas." />}
      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel ? <span>Manifiesto <span className="num">{sel.numero}</span></span> : ''}
        footer={sel?.estado === 'REALIZADO' ? <BotonPdf ruta={`/portal/manifiestos/${sel.id}/enlace`} etiqueta="Ver el PDF" variant="primary" /> : undefined}>
        {sel && (
          <div className="flex flex-col gap-5">
            <DefList items={[['Fecha del servicio', fmtFecha(sel.fechaServicio)], ['Servicio', TIPO_MF[sel.tipo]], ['Destino', sel.destino.razonSocial], ['Estado', <EstadoConc m={sel} />]]} />
            <div>
              <h3 className="mb-2 text-[14px] font-semibold">Residuos ({sel.items.length})</h3>
              <ul className="flex flex-col gap-2">
                {sel.items.map((i) => {
                  const pesado = sel.conciliacion?.estado === 'APROBADA' ? i.conciliacion?.cantidadConciliada ?? null : null;
                  const u = i.metrica?.abreviacion ?? '';
                  return (
                    <li key={i.id} className="rounded-xl border border-line p-3 text-[13px]">
                      <p className="font-medium">{i.declaracion.nombre}</p>
                      <p className="mt-0.5 flex items-center gap-1 text-muted"><MapPin size={12} />{i.sucursal.nombre}</p>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <span className="rounded-lg bg-surface-2 px-2.5 py-1.5"><span className="block text-[11px] uppercase tracking-[0.04em] text-subtle">Cargado en la sede</span><span className="num">{cant(i.cantidad)} {u}</span></span>
                        <span className={cx('rounded-lg px-2.5 py-1.5', pesado !== null ? 'bg-ok/10' : 'bg-surface-2')}><span className="block text-[11px] uppercase tracking-[0.04em] text-subtle">En planta</span><span className="num">{pesado !== null ? `${cant(pesado)} ${u}` : 'en revisión'}</span></span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
            {sel.estado === 'ANULADO' && <p className="rounded-lg bg-bad/10 p-3 text-[13px] text-bad">Este manifiesto se anuló: queda en el historial, pero no tiene validez ni PDF.</p>}
          </div>
        )}
      </Sheet>
    </>
  );
}

// ---------------- Certificados ----------------
interface ActaFila {
  id: string; numero: string; tipo: 'DISPOSICION' | 'APROVECHAMIENTO' | 'CONCILIACION'; periodoDesde: string; periodoHasta: string; emitidaEn: string | null;
  codigoVerificacion: string | null; destino: { razonSocial: string; esPropio: boolean }; _count: { items: number };
  /** Con una factura vencida y sin pagar, el certificado se ve pero se descarga cuando se registre el pago. */
  pendientePago: { facturas: string[]; mensaje: string } | null;
}
/** En vez del botón del PDF: aviso discreto de que se descarga al registrar el pago. */
const PendientePago = ({ a }: { a: ActaFila }) => (
  <span className="inline-flex items-center gap-1 whitespace-nowrap text-[12px] text-muted" title={a.pendientePago?.mensaje}><Clock size={13} /> Al registrar el pago</span>
);
const TIPO_ACTA = { DISPOSICION: 'Tratamiento y disposición final', APROVECHAMIENTO: 'Aprovechamiento', CONCILIACION: 'Conciliación de residuos' };
const enlaceVerificacion = (codigo: string) => `${location.origin}${location.pathname}#verificar/${codigo}`;

export function PortalCertificados() {
  const yo = usePortal();
  const actual = anioActual();
  const [anio, setAnio] = useState('');
  const [sel, setSel] = useState<ActaFila | null>(null);
  const lista = usePaginado<ActaFila>(`/portal/certificados${anio ? `?anio=${anio}` : ''}`);
  const periodo = (a: ActaFila) => `${fmtFecha(a.periodoDesde)} a ${fmtFecha(a.periodoHasta)}`;
  const cols: Column<ActaFila>[] = [
    { key: 'n', header: 'Número', render: (a) => <span className="num font-medium">{a.numero}</span>, priority: 3 },
    { key: 't', header: 'Certificado de', render: (a) => TIPO_ACTA[a.tipo], priority: 2 },
    { key: 'p', header: 'Periodo', render: (a) => <span className="whitespace-nowrap">{periodo(a)}</span>, priority: 2 },
    { key: 'd', header: 'Gestor', render: (a) => <span className="block max-w-[220px] truncate">{a.destino.razonSocial}</span>, priority: 3 },
    { key: 'e', header: 'Emitido', render: (a) => (a.emitidaEn ? <span className="whitespace-nowrap">{fmtFecha(a.emitidaEn)}</span> : '—'), priority: 2 },
    { key: 'pdf', header: 'Documento', render: (a) => (a.pendientePago ? <PendientePago a={a} /> : <BotonPdf ruta={`/portal/certificados/${a.id}/enlace`} />), priority: 3 }, // 3: no va en las tarjetas del celular
  ];
  return (
    <>
      <PageHeader title="Certificados" subtitle="Los certificados emitidos por Terra Viva para su empresa. Cada uno trae un código QR para que un tercero verifique que es auténtico."
        actions={yo.cliente.activo ? <BotonPdf ruta="/portal/certificado-comercial" etiqueta="Certificación comercial" /> : undefined} />
      <FilterBar active={Number(!!anio)} onClear={() => setAnio('')}>
        <Field label="Año" id="pc-a"><Select id="pc-a" value={anio} onChange={(e) => setAnio(e.target.value)}><option value="">Todos</option>{Array.from({ length: 6 }, (_, i) => actual - i).map((y) => <option key={y} value={y}>{y}</option>)}</Select></Field>
      </FilterBar>
      {lista.error ? <Aviso texto={lista.error} /> : !lista.filas ? <Cargando />
        : <ResponsiveTable rows={lista.filas} columns={cols} rowKey={(a) => a.id} onRowClick={setSel} cardTitle={(a) => <span className="num">{a.numero}</span>} cardBadge={() => <Badge tone="ok" dot>Emitido</Badge>}
            cardMeta={(a) => `Gestor: ${a.destino.razonSocial}`}
            footer={<PieLista mostradas={lista.filas.length} total={lista.total} hayMas={lista.hayMas} cargando={lista.cargando} cargarMas={lista.cargarMas} />}
            empty={anio ? `No hay certificados de ${anio}.` : 'Su empresa aún no tiene certificados emitidos.'} />}
      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel ? <span>Certificado <span className="num">{sel.numero}</span></span> : ''}
        footer={sel && !sel.pendientePago ? <BotonPdf ruta={`/portal/certificados/${sel.id}/enlace`} etiqueta="Ver el PDF" variant="primary" /> : undefined}>
        {sel && (
          <div className="flex flex-col gap-5">
            <DefList items={[['Certificado de', TIPO_ACTA[sel.tipo]], ['Periodo', periodo(sel)], ['Gestor', sel.destino.razonSocial], ['Emitido', sel.emitidaEn ? fechaHoraCo(sel.emitidaEn) : '—'], ['Líneas certificadas', String(sel._count.items)]]} />
            {sel.pendientePago && <p className="flex items-start gap-2 rounded-xl bg-surface-2 p-3 text-[13px] text-muted"><Clock size={16} className="mt-px shrink-0" />{sel.pendientePago.mensaje}</p>}
            {sel.codigoVerificacion && (
              <a href={enlaceVerificacion(sel.codigoVerificacion)} target="_blank" rel="noreferrer" className="flex items-start gap-2 rounded-xl border border-line p-3 text-[13px] hover:bg-surface-2">
                <ShieldCheck size={18} className="mt-px shrink-0 text-ok" />
                <span><span className="font-medium">Verificación pública</span><br /><span className="text-muted">Es la página a la que lleva el QR del PDF: cualquiera puede comprobar que el certificado es auténtico.</span></span>
                <ExternalLink size={14} className="ml-auto mt-0.5 shrink-0 text-subtle" />
              </a>
            )}
          </div>
        )}
      </Sheet>
    </>
  );
}

// ---------------- Informes ----------------
interface Informe {
  anio: number; totalKg: number; kgPorMes: number[]; sinConvertir: number; porConciliar: number;
  lineas: { declaracionId: string; numero: number; nombre: string; metrica: string | null; kgPorUnidad: number | null; meses: number[]; total: number; servicios: number; porConciliar: number }[];
}
async function excelInforme(inf: Informe, cliente: { razonSocial: string; nit: string; dv: string | null }) {
  const ExcelJS = ((await import('exceljs')) as unknown as { default: typeof import('exceljs') }).default;
  const wb = new ExcelJS.Workbook(); wb.creator = 'Terry-App · Terra Viva';
  const ws = wb.addWorksheet(`Informe ${inf.anio}`);
  ws.addRow([`Residuos gestionados en ${inf.anio}`]).font = { bold: true, size: 14 };
  ws.addRow([`${cliente.razonSocial} · NIT ${nitConDv(cliente)}`]);
  ws.addRow([`Generado el ${fechaHoraCo(new Date().toISOString())} en el portal de clientes. Vale lo pesado y conciliado en planta; lo que aún está en revisión va con lo cargado en la sede.`]);
  ws.addRow([]);
  const enc = ws.addRow(['N.º declaración', 'Residuo o servicio', 'Unidad', ...MESES, 'Total', 'Servicios']);
  enc.font = { bold: true };
  enc.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F1E0' } }; });
  for (const l of inf.lineas) ws.addRow([l.numero, l.nombre, l.metrica ?? '', ...l.meses, l.total, l.servicios]);
  const tot = ws.addRow(['', 'Total en kilogramos', 'kg', ...inf.kgPorMes, inf.totalKg, '']);
  tot.font = { bold: true };
  ws.getColumn(1).width = 15; ws.getColumn(2).width = 44; ws.getColumn(3).width = 9;
  for (let c = 4; c <= 17; c++) { ws.getColumn(c).width = 11; ws.getColumn(c).numFmt = '#,##0.##'; }
  ws.views = [{ state: 'frozen', ySplit: 5, xSplit: 2 }];
  descargar(await wb.xlsx.writeBuffer() as ArrayBuffer, `informe-residuos-${inf.anio}-${cliente.nit}.xlsx`);
}

function InformeAnual({ tabs }: { tabs: ReactNode }) {
  const yo = usePortal();
  const toast = useToast();
  const actual = anioActual();
  const [anio, setAnio] = useState(actual);
  const { datos: inf, error, cargando } = useApi<Informe>(`/portal/informe?anio=${anio}`);
  const [bajando, setBajando] = useState(false);
  const celda = (x: number) => (x ? cant(x) : <span className="text-subtle">·</span>);
  return (
    <>
      <PageHeader title="Informes" subtitle="Lo que Terra Viva gestionó de su empresa en el año, por residuo y por mes. Vale lo pesado y conciliado en planta; lo que aún está en revisión va con lo cargado en la sede."
        actions={<Button variant="primary" disabled={!inf?.lineas.length || bajando} onClick={async () => {
          setBajando(true);
          try { await excelInforme(inf!, yo.cliente); } catch { toast('No se pudo generar el Excel.', 'warn'); } finally { setBajando(false); }
        }}>{bajando ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Descargar Excel</Button>} />
      <div className="mb-4">{tabs}</div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Año" id="pi-a"><Select id="pi-a" value={anio} onChange={(e) => setAnio(Number(e.target.value))} className="w-32">{Array.from({ length: 6 }, (_, i) => actual - i).map((y) => <option key={y} value={y}>{y}</option>)}</Select></Field>
        {cargando && <Loader2 size={18} className="mb-2.5 animate-spin text-muted" />}
      </div>
      {error ? <Aviso texto={error} /> : !inf ? <Cargando /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Kpi label={`Total ${inf.anio}`} value={`${fmtNum(Math.round(inf.totalKg))} kg`} icon={<BarChart3 size={16} />} hint={inf.sinConvertir ? `Más ${inf.sinConvertir} ${inf.sinConvertir === 1 ? 'residuo' : 'residuos'} en otras unidades` : 'Todo convertido a kilogramos'} />
            <Kpi label="Residuos y servicios" value={fmtNum(inf.lineas.length)} icon={<FileText size={16} />} hint="Con al menos un servicio en el año" />
            <Kpi label="En revisión" value={fmtNum(inf.porConciliar)} icon={<Truck size={16} />} hint="Líneas aún sin pesaje aprobado en planta" />
          </div>
          {!inf.lineas.length ? <p className="mt-5 rounded-xl border border-dashed border-line px-4 py-10 text-center text-muted">No hay servicios grabados en {inf.anio}.</p> : (
            <Card className="mt-5" pad={false}>
              <div className="scroll-x"><table className="w-full min-w-[980px] text-[13px]">
                <thead className="bg-surface-2 text-left text-[12px] uppercase tracking-[0.04em] text-muted">
                  <tr><th className="sticky left-0 bg-surface-2 px-3 py-2.5">Residuo o servicio</th><th className="px-2 py-2.5">Unidad</th>{MESES.map((m) => <th key={m} className="px-2 py-2.5 text-right">{m}</th>)}<th className="px-3 py-2.5 text-right">Total</th></tr>
                </thead>
                <tbody>
                  {inf.lineas.map((l) => (
                    <tr key={`${l.declaracionId}${l.metrica}`} className="border-t border-line">
                      <td className="sticky left-0 max-w-[280px] bg-surface px-3 py-2"><span className="block truncate font-medium">{l.nombre}</span><span className="text-[11px] text-subtle">N.º {l.numero} · {l.servicios} {l.servicios === 1 ? 'servicio' : 'servicios'}</span></td>
                      <td className="px-2 py-2 text-muted">{l.metrica ?? '—'}</td>
                      {l.meses.map((x, i) => <td key={i} className="num px-2 py-2 text-right">{celda(x)}</td>)}
                      <td className="num px-3 py-2 text-right font-semibold">{cant(l.total)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-line bg-surface-2 font-semibold">
                    <td className="sticky left-0 bg-surface-2 px-3 py-2">Total en kilogramos</td><td className="px-2 py-2">kg</td>
                    {inf.kgPorMes.map((x, i) => <td key={i} className="num px-2 py-2 text-right">{celda(x)}</td>)}
                    <td className="num px-3 py-2 text-right">{cant(inf.totalKg)}</td>
                  </tr>
                </tbody>
              </table></div>
            </Card>
          )}
        </>
      )}
    </>
  );
}

/** Informes: el resumen del año (por residuo y mes) y el informe general (cada servicio, con lo conciliado y su valor). */
export function PortalInformes() {
  const [vista, setVista] = useState<'anio' | 'general'>('anio');
  const tabs = <Tabs value={vista} onChange={setVista} items={[{ value: 'anio', label: 'Resumen del año' }, { value: 'general', label: 'Informe general por servicio' }]} />;
  return vista === 'anio' ? <InformeAnual tabs={tabs} /> : <InformeGeneral tabs={tabs} />;
}

// ---------------- Informe general (detalle por servicio) ----------------
interface LineaGeneral {
  id: string; fecha: string; manifiesto: string; tipo: 'CARGUE' | 'DESCARGUE'; ordenCompra: string | null; sede: string; sedeCodigo: string | null; declaracion: number; residuo: string;
  codigoInterno: string | null; peligroso: boolean | null; cargado: number; unidad: string | null; conciliada: boolean; pesado: number | null; unidadPlanta: string | null;
  tratamiento: string | null; destino: string; precio: number | null; valor: number | null; negociacion: string | null; factura: string | null; certificado: string | null;
}
const NEGOCIACION: Record<string, string> = { COBRO: 'Cobro', COMPRA: 'Compra (Terra Viva le paga)', SIN_COSTO: 'Sin costo', CONTRATO: 'Por contrato' };
async function excelGeneral(lineas: LineaGeneral[], desde: string, hasta: string, cliente: { razonSocial: string; nit: string; dv: string | null }) {
  const ExcelJS = ((await import('exceljs')) as unknown as { default: typeof import('exceljs') }).default;
  const wb = new ExcelJS.Workbook(); wb.creator = 'Terry-App · Terra Viva';
  const ws = wb.addWorksheet('Informe general');
  ws.addRow([`Informe general de servicios del ${desde} al ${hasta}`]).font = { bold: true, size: 14 };
  ws.addRow([`${cliente.razonSocial} · NIT ${nitConDv(cliente)}`]);
  ws.addRow([`Generado el ${fechaHoraCo(new Date().toISOString())} en el portal de clientes. «En planta», precio y valor aparecen cuando la conciliación está aprobada.`]);
  ws.addRow([]);
  const enc = ws.addRow(['Fecha', 'Manifiesto', 'Servicio', 'Sede', 'Código sede', 'N.º declaración', 'Residuo o servicio', 'Su código', 'Peligroso', 'Cargado en la sede', 'Unidad',
    'Conciliado', 'En planta', 'Unidad en planta', 'Tratamiento', 'Destino', 'Precio unitario', 'Valor', 'Negociación', 'Factura', 'Certificado', 'Orden de compra']);
  enc.font = { bold: true };
  enc.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F1E0' } }; });
  for (const l of lineas) ws.addRow([l.fecha, l.manifiesto, l.tipo === 'CARGUE' ? 'Recolección' : 'Entrega en planta', l.sede, l.sedeCodigo ?? '', l.declaracion, l.residuo, l.codigoInterno ?? '',
    l.peligroso ? 'Sí' : 'No', l.cargado, l.unidad ?? '', l.conciliada ? 'Sí' : 'En revisión', l.pesado ?? '', l.unidadPlanta ?? '', l.tratamiento ?? '', l.destino, l.precio ?? '', l.valor ?? '',
    l.negociacion ? NEGOCIACION[l.negociacion] ?? l.negociacion : '', l.factura ?? '', l.certificado ?? '', l.ordenCompra ?? '']);
  const anchos = [11, 12, 16, 26, 12, 14, 40, 12, 10, 14, 9, 12, 12, 12, 32, 30, 14, 15, 18, 14, 14, 16];
  anchos.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  for (const c of [10, 13]) ws.getColumn(c).numFmt = '#,##0.##';
  for (const c of [17, 18]) ws.getColumn(c).numFmt = '"$"#,##0';
  ws.views = [{ state: 'frozen', ySplit: 5 }];
  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + lineas.length, column: anchos.length } };
  descargar(await wb.xlsx.writeBuffer() as ArrayBuffer, `informe-general-${desde}-a-${hasta}-${cliente.nit}.xlsx`);
}

function InformeGeneral({ tabs }: { tabs: ReactNode }) {
  const yo = usePortal();
  const toast = useToast();
  const hoy = hoyCo();
  const [desde, setDesde] = useState(`${hoy.slice(0, 4)}-01-01`);
  const [hasta, setHasta] = useState(hoy);
  const [sede, setSede] = useState('');
  const [bajando, setBajando] = useState(false);
  const valido = !!desde && !!hasta && desde <= hasta;
  const { datos, error, cargando } = useApi<{ lineas: LineaGeneral[]; recortado: boolean }>(valido ? `/portal/informe-general?${new URLSearchParams({ desde, hasta, ...(sede ? { sucursalId: sede } : {}) })}` : null);
  const lineas = datos?.lineas ?? [];
  const porUnidad = (pares: [string | null, number | null][]) => {
    const m = new Map<string, number>();
    for (const [u, x] of pares) if (x !== null) m.set(u ?? '', (m.get(u ?? '') ?? 0) + x);
    return [...m.entries()].map(([u, x]) => `${cant(x)}${u ? ` ${u}` : ''}`).join(' · ') || '—';
  };
  const conciliadas = lineas.filter((l) => l.conciliada);
  const valor = conciliadas.reduce((s, l) => s + (l.valor ?? 0), 0);
  return (
    <>
      <PageHeader title="Informes" subtitle="Cada servicio del periodo: lo cargado en su sede y, cuando la conciliación está aprobada, lo pesado en planta, el tratamiento, el precio, el valor, la factura y el certificado."
        actions={<Button variant="primary" disabled={!lineas.length || bajando} onClick={async () => {
          setBajando(true);
          try { await excelGeneral(lineas, desde, hasta, yo.cliente); } catch { toast('No se pudo generar el Excel.', 'warn'); } finally { setBajando(false); }
        }}>{bajando ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Descargar Excel</Button>} />
      <div className="mb-4">{tabs}</div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Desde" id="ig-d"><Input id="ig-d" type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} /></Field>
        <Field label="Hasta" id="ig-h"><Input id="ig-h" type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} /></Field>
        {yo.sedes.length > 1 && <Field label="Sede" id="ig-s"><Select id="ig-s" value={sede} onChange={(e) => setSede(e.target.value)} className="min-w-[200px]"><option value="">{yo.restringido ? 'Mis sedes' : 'Todas'}</option>{yo.sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</Select></Field>}
        {cargando && <Loader2 size={18} className="mb-2.5 animate-spin text-muted" />}
      </div>
      {!valido ? <Aviso texto="Revise el rango de fechas." /> : error ? <Aviso texto={error} /> : !datos ? <Cargando /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Servicios" value={fmtNum(new Set(lineas.map((l) => l.manifiesto)).size)} icon={<FileStack size={16} />} hint={`${fmtNum(lineas.length)} líneas de residuo`} />
            <Kpi label="Cargado en sus sedes" value={porUnidad(lineas.map((l) => [l.unidad, l.cargado]))} icon={<Truck size={16} />} hint="Según los manifiestos" />
            <Kpi label="Pesado en planta" value={porUnidad(conciliadas.map((l) => [l.unidadPlanta, l.pesado]))} icon={<BarChart3 size={16} />} hint={`${fmtNum(lineas.length - conciliadas.length)} líneas aún en revisión`} />
            <Kpi label="Valor conciliado" value={fmtCOP(valor)} icon={<BadgeCheck size={16} />} hint="Precio por lo pesado en planta" />
          </div>
          {datos.recortado && <p className="mt-3 rounded-lg bg-warn/10 p-3 text-[13px] text-warn">El periodo tiene más de 5.000 líneas: se muestran las primeras. Pida un rango más corto.</p>}
          {!lineas.length ? <p className="mt-5 rounded-xl border border-dashed border-line px-4 py-10 text-center text-muted">No hay servicios en estas fechas.</p> : (
            <Card className="mt-5" pad={false}>
              <div className="scroll-x"><table className="w-full min-w-[1100px] text-[13px]">
                <thead className="bg-surface-2 text-left text-[12px] uppercase tracking-[0.04em] text-muted">
                  <tr><th className="px-3 py-2.5">Fecha</th><th className="px-2 py-2.5">Manifiesto</th><th className="px-2 py-2.5">Sede</th><th className="px-2 py-2.5">Residuo o servicio</th>
                    <th className="px-2 py-2.5 text-right">Cargado</th><th className="px-2 py-2.5 text-right">En planta</th><th className="px-2 py-2.5">Tratamiento</th>
                    <th className="px-2 py-2.5 text-right">Precio</th><th className="px-2 py-2.5 text-right">Valor</th><th className="px-2 py-2.5">Factura</th><th className="px-3 py-2.5">Certificado</th></tr>
                </thead>
                <tbody>
                  {lineas.map((l) => (
                    <tr key={l.id} className="border-t border-line align-top">
                      <td className="whitespace-nowrap px-3 py-2">{fmtFecha(l.fecha)}</td>
                      <td className="num whitespace-nowrap px-2 py-2">{l.manifiesto}<span className="block text-[11px] text-subtle">{l.tipo === 'CARGUE' ? 'Recolección' : 'Entrega'}</span></td>
                      <td className="max-w-[180px] px-2 py-2"><span className="block truncate">{l.sede}</span></td>
                      <td className="max-w-[260px] px-2 py-2"><span className="block truncate font-medium">{l.residuo}</span><span className="text-[11px] text-subtle">N.º {l.declaracion}{l.peligroso ? ' · peligroso' : ''}</span></td>
                      <td className="num whitespace-nowrap px-2 py-2 text-right">{cant(l.cargado)} {l.unidad ?? ''}</td>
                      <td className="num whitespace-nowrap px-2 py-2 text-right">{l.conciliada && l.pesado !== null ? `${cant(l.pesado)} ${l.unidadPlanta ?? ''}` : <span className="text-subtle">en revisión</span>}</td>
                      <td className="max-w-[200px] px-2 py-2"><span className="block truncate">{l.tratamiento ?? '—'}</span></td>
                      <td className="num whitespace-nowrap px-2 py-2 text-right">{l.precio !== null ? fmtCOP(l.precio) : '—'}</td>
                      <td className="num whitespace-nowrap px-2 py-2 text-right">{l.valor !== null ? fmtCOP(l.valor) : '—'}{l.negociacion === 'COMPRA' && <span className="block text-[11px] text-subtle">compra</span>}</td>
                      <td className="whitespace-nowrap px-2 py-2">{l.factura ?? '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2">{l.certificado ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </Card>
          )}
        </>
      )}
    </>
  );
}
