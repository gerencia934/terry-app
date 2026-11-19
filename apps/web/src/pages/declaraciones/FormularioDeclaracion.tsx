// Formulario de 8 secciones de una declaración de residuo o servicio (fase B de Declaraciones).
// Crea (POST /declaraciones) o edita (PUT /declaraciones/:id). La validación es la misma del API y la base de datos
// vuelve a revisar todo al guardar: el formulario solo avisa antes y explica qué falta y dónde.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, CircleAlert, CircleCheck, Save, Send, ShieldAlert, ShieldCheck, Star, Trash2 } from 'lucide-react';
import { FORMAS_PAGO, NEGOCIACIONES, RESPONSABILIDAD_GENERADOR, faltantesParaAutorizar } from '@terraviva/shared';
import { Badge, Button, Card, EstadoBadge, Input, PageHeader, Select, useToast } from '../../components/ui';
import { BuscarCliente } from '../../components/BuscarCliente';
import { api, sesionActual, tienePermiso } from '../../lib/api';
import { cx, fmtCOP, fmtFecha } from '../../lib/format';
import { cant, msg, useApi } from '../../lib/servidor';
import { SECCIONES, aPayload, desdeDetalle, formVacio, revisar, seccionDe, type Alcance, type DetalleDecl, type FormDecl, type SiNo, type Tipo } from './formulario';

interface Item { id: string; codigo: string; nombre: string }
interface Catalogos {
  categorias: Item[]; tiposResiduo: Item[];
  lineas: (Item & { unidadNegocio: { codigo: string; nombre: string; sigla: string | null } })[];
  tiposEmbalaje: (Item & { esOtro: boolean })[]; materiales: (Item & { esOtro: boolean })[];
  disposiciones: (Item & { requierePermiso: boolean; propia: boolean; soporteLegal: string | null })[];
  riesgos: Item[]; etiquetado: Item[];
  metricasPrecio: (Item & { abreviacion: string })[]; metricasDensidad: (Item & { abreviacion: string })[];
  corrientesY: Clasificacion[]; codigosA: Clasificacion[];
}
/** Corriente Y o código A (Decreto 1076 de 2015); las subcorrientes del IDEAM cuelgan de su corriente. */
interface Clasificacion { id: string; codigo: string; descripcion: string; padreId: string | null }
interface ClienteDet {
  id: string; razonSocial: string; nit: string; tipoNegociacion: string; formaPago: string;
  sucursales: { id: string; codigo: string | null; nombre: string; esPrincipal: boolean; activa: boolean; generadorNombre: string | null }[];
}
interface ServicioCat { id: string; codigo: string; nombre: string; lineaServicioId: string | null; valores: { descripcion?: string } | null }
interface Cobertura { cubierto: boolean; mensaje: string; detalle: { codigo: string; nombre: string; cubierta: boolean; soporte: string }[] }

const NEG: Record<string, string> = { COBRO: 'Cobro al cliente', COMPRA: 'Compra (Terra Viva paga)', SIN_COSTO: 'Sin costo', CONTRATO: 'Por contrato' };
const PAGO: Record<string, string> = { CONTADO: 'Contado', CREDITO_30: 'Crédito a 30 días', CREDITO_60: 'Crédito a 60 días', CREDITO_90: 'Crédito a 90 días' };
const ESTADOS_FISICOS = [{ value: 'SOLIDO', label: 'Sólido' }, { value: 'SEMISOLIDO', label: 'Semisólido' }, { value: 'LIQUIDO', label: 'Líquido' }, { value: 'GASEOSO', label: 'Gaseoso' }] as const;
const SI_NO = [{ value: 'si', label: 'Sí' }, { value: 'no', label: 'No' }] as const;
const recortar = (t: string | null | undefined, max = 70) => (!t ? '' : t.length > max ? `${t.slice(0, max - 1)}…` : t);
/** Y1, Y2 … Y9, Y9.1, Y10 (no Y1, Y10, Y11… como en el orden alfabético). */
const natural = <T extends { codigo: string }>(xs: T[]) => [...xs].sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));

// ---------- Piezas del formulario ----------
function Campo({ label, error, hint, id, children, className }: { label: string; error?: string; hint?: ReactNode; id?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[12px] font-medium text-muted">{label}</label>
      {children}
      {error ? <span role="alert" className="text-[12px] text-bad">{error}</span> : hint ? <span className="text-[12px] text-subtle">{hint}</span> : null}
    </div>
  );
}
const areaCls = 'min-h-[84px] w-full min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';
const Area = (p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={areaCls} />;

function Opciones<T extends string>({ id, value, onChange, items, disabled }: { id?: string; value: T | ''; onChange: (v: T) => void; items: readonly { value: T; label: string }[]; disabled?: boolean }) {
  return (
    <div id={id} role="radiogroup" className="inline-flex flex-wrap gap-1 self-start rounded-lg bg-surface-2 p-1">
      {items.map((it) => (
        <button key={it.value} type="button" role="radio" aria-checked={value === it.value} disabled={disabled} onClick={() => onChange(it.value)}
          className={cx('h-8 rounded-md px-3 text-[13px] font-medium transition-colors disabled:opacity-60', value === it.value ? 'bg-brand-soft font-semibold text-brand-ink shadow-sm ring-1 ring-brand/40' : 'text-muted hover:text-fg')}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

function Chips({ items, valor, onChange }: { items: Item[]; valor: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((it) => {
        const on = valor.includes(it.id);
        return (
          <button key={it.id} type="button" aria-pressed={on} onClick={() => onChange(on ? valor.filter((x) => x !== it.id) : [...valor, it.id])}
            className={cx('rounded-full border px-2.5 py-1 text-[12px] transition-colors', on ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line text-muted hover:text-fg')}>
            {it.nombre}
          </button>
        );
      })}
    </div>
  );
}

function Casilla({ checked, onChange, children, id }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; id?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm">
      <input id={id} type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--brand))]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

function Seccion({ n, titulo, errores, children, noAplica }: { n: number; titulo: string; errores: number; children: ReactNode; noAplica?: string }) {
  return (
    <section id={`decl-sec-${n}`} className="scroll-mt-24">
      <Card title={
        <span className="flex items-center gap-2">
          <span className="num flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 text-[12px]">{n}</span>{titulo}
          {errores > 0 && <Badge tone="bad">{errores === 1 ? '1 por revisar' : `${errores} por revisar`}</Badge>}
        </span>}>
        {noAplica ? <p className="text-sm text-muted">{noAplica}</p> : <div className="flex flex-col gap-4">{children}</div>}
      </Card>
    </section>
  );
}

const ir = (n: number) => document.getElementById(`decl-sec-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

// ---------- Formulario ----------
export function FormularioDeclaracion({ id, volver, onGuardada }: {
  id?: string; volver: () => void; onGuardada: (d: { id: string; numero: number; estado: string; cambiosCriticos?: string[] }) => void;
}) {
  const toast = useToast();
  const cat = useApi<Catalogos>('/declaraciones/catalogos');
  const detalle = useApi<DetalleDecl>(id ? `/declaraciones/${id}` : null);
  const [f, setF] = useState<FormDecl>(() => formVacio());
  const [inicial, setInicial] = useState<FormDecl>(() => formVacio());
  const [listo, setListo] = useState(!id);
  const [intento, setIntento] = useState<null | 'borrador' | 'enviar'>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    if (!detalle.datos || listo) return;
    const x = desdeDetalle(detalle.datos);
    setF(x); setInicial(x); setListo(true);
  }, [detalle.datos, listo]);

  const set = (c: Partial<FormDecl>) => setF((s) => ({ ...s, ...c }));
  const d = detalle.datos;
  const residuo = f.tipo === 'RESIDUO';
  const autorizada = d?.estado === 'AUTORIZADA';
  const puedeAutorizar = tienePermiso('declaraciones.autorizar');
  const vuelveARevision = autorizada && !puedeAutorizar;

  const cliente = useApi<ClienteDet>(f.clienteId ? `/clientes/${f.clienteId}` : null);
  const servicios = useApi<ServicioCat[]>(!residuo ? '/declaraciones/catalogo-servicios' : null);
  // Cobertura en vivo con el contexto de la declaración: un peligroso no va a Los Pinos; hidrocarburos; exclusiones del aliado
  const idsDisp = f.disposiciones.map((x) => x.disposicionId).join(',');
  const ctxCobertura = new URLSearchParams({
    disposiciones: idsDisp, peligroso: String(residuo && f.esPeligroso), hidrocarburos: String(residuo && f.contieneHidrocarburos === 'si'),
    caracterizacion: String(!!f.caracterizacionUrl.trim()), ...(residuo && f.tipoResiduoId ? { tipoResiduoId: f.tipoResiduoId } : {}),
  });
  const cobertura = useApi<Cobertura>(idsDisp ? `/declaraciones/cobertura?${ctxCobertura}` : null);
  const conPoliticaDatos = !!sesionActual()?.usuario.politicaDatos?.url;

  const c = cat.datos;
  const otro = {
    embalaje: !!c?.tiposEmbalaje.find((x) => x.id === f.tipoEmbalajeId)?.esOtro,
    material: !!c?.materiales.find((x) => x.id === f.materialEmbalajeId)?.esOtro,
  };
  const sedes = cliente.datos?.sucursales ?? [];
  const principal = sedes.find((x) => x.esPrincipal);
  const sedesQueVan = f.alcanceSedes === 'TODAS' ? sedes.filter((x) => x.activa).length : f.alcanceSedes === 'PRINCIPAL' ? (principal ? 1 : 0) : f.sucursalIds.length;

  // Revisión con el esquema del API, más lo que sabe la pantalla sobre las sedes del cliente
  const conSedes = (rev: ReturnType<typeof revisar>, borrador: boolean) => {
    if (borrador || !cliente.datos || rev.errores.sucursalIds) return rev;
    const e = f.alcanceSedes === 'PRINCIPAL' && !principal ? 'El cliente no tiene sede principal: elija las sedes.' : f.alcanceSedes === 'TODAS' && !sedesQueVan ? 'El cliente no tiene sedes activas: créelas primero.' : '';
    if (!e) return rev;
    return { errores: { ...rev.errores, sucursalIds: e }, porSeccion: { ...rev.porSeccion, 1: (rev.porSeccion[1] ?? 0) + 1 }, total: rev.total + 1 };
  };
  const revBorrador = useMemo(() => conSedes(revisar(f, true, otro), true), [f, otro.embalaje, otro.material]); // eslint-disable-line react-hooks/exhaustive-deps
  const revEnviar = useMemo(() => conSedes(revisar(f, false, otro), false), [f, otro.embalaje, otro.material, cliente.datos]); // eslint-disable-line react-hooks/exhaustive-deps
  const rev = intento === 'borrador' ? revBorrador : intento === 'enviar' ? revEnviar : null;
  const e = rev?.errores ?? {};
  const err = (n: number) => rev?.porSeccion[n] ?? 0;

  const sinCobertura = (cobertura.datos?.detalle ?? []).filter((x) => !x.cubierta);
  const faltaAutorizar = [
    ...faltantesParaAutorizar({ tipo: f.tipo, esPeligroso: residuo && f.esPeligroso, fichaSeguridadUrl: f.fichaSeguridadUrl.trim() || null, sedes: sedesQueVan, disposiciones: f.disposiciones.length, tarifaVigente: f.precio.trim() !== '' }),
    ...(residuo && sinCobertura.length ? [`ningún permiso o licencia vigente cubre: ${sinCobertura.map((x) => x.nombre).join(', ')}`] : []),
  ];
  const sucio = JSON.stringify(f) !== JSON.stringify(inicial);
  // Índice: sección lista = sin errores para enviar y con lo que pide la autorización (disposición, FDS, precio, aceptación)
  const completa = (n: number) => {
    if (revEnviar.porSeccion[n]) return false;
    switch (n) {
      case 1: return !!f.clienteId && sedesQueVan > 0;
      case 5: return !residuo || f.disposiciones.length > 0;
      case 6: return !(residuo && f.esPeligroso) || !!f.fichaSeguridadUrl.trim();
      case 7: return f.precio.trim() !== '';
      case 8: return f.responsabilidadAceptada;
      default: return true;
    }
  };

  const cambiarTipo = (t: Tipo) => {
    const serv = c?.categorias.find((x) => x.codigo === 'SERV')?.id ?? '';
    setF((s) => ({ ...s, tipo: t, categoriaId: t === 'SERVICIO' ? serv : s.categoriaId === serv ? '' : s.categoriaId, catalogoId: '' }));
  };
  const precargar = (catalogoId: string) => {
    const sv = servicios.datos?.find((x) => x.id === catalogoId);
    if (!sv) { set({ catalogoId: '' }); return; }
    set({ catalogoId, nombre: f.nombre || sv.nombre, lineaServicioId: sv.lineaServicioId ?? f.lineaServicioId, descripcionServicio: f.descripcionServicio || sv.valores?.descripcion || sv.nombre });
  };
  const principalEfectiva = f.disposiciones.some((x) => x.principal) ? f.disposiciones.findIndex((x) => x.principal) : 0;

  const salir = () => { if (!sucio || window.confirm('Hay cambios sin guardar. ¿Salir sin guardarlos?')) volver(); };
  const guardar = async (borrador: boolean) => {
    setIntento(borrador ? 'borrador' : 'enviar');
    const r = borrador ? revBorrador : revEnviar;
    if (r.total) {
      toast(r.total === 1 ? 'Hay 1 dato por revisar (marcado en rojo).' : `Hay ${r.total} datos por revisar (marcados en rojo).`, 'warn');
      ir(Math.min(...Object.keys(r.errores).map(seccionDe)));
      return;
    }
    setOcupado(true);
    try {
      const cuerpo = aPayload(f, borrador);
      const g = id ? await api<{ id: string; numero: number; estado: string; cambiosCriticos?: string[] }>(`/declaraciones/${id}`, { metodo: 'PUT', cuerpo })
        : await api<{ id: string; numero: number; estado: string }>('/declaraciones', { cuerpo });
      setInicial(f);
      onGuardada(g);
    } catch (x) { toast(msg(x, 'No se pudo guardar.'), 'warn'); } finally { setOcupado(false); }
  };

  if (cat.error || detalle.error) return <p className="rounded-xl bg-bad/10 p-4 text-bad">{cat.error || detalle.error}</p>;
  if (!c || !listo) return <p className="p-6 text-center text-muted">Cargando…</p>;

  const linea = c.lineas.find((x) => x.id === f.lineaServicioId);
  const disponibles = c.disposiciones.filter((x) => !f.disposiciones.some((y) => y.disposicionId === x.id));
  // Lo que falta, en el orden de las secciones
  const pendientes = Object.entries(revEnviar.errores).sort(([a], [b]) => seccionDe(a) - seccionDe(b)).map(([, m]) => m);
  const resumen = vuelveARevision ? 'Está autorizada: al guardar los cambios vuelve a revisión de HSEQ y queda inactiva hasta que la autoricen.'
    : revEnviar.total ? `Para enviar falta: ${pendientes.slice(0, 3).join(' ')}${revEnviar.total > 3 ? ` (y ${revEnviar.total - 3} más)` : ''}`
    : autorizada ? 'Los cambios menores la dejan autorizada. Si cambia la peligrosidad, la corriente, los hidrocarburos, la disposición, las sedes o la unidad de medida, vuelve a revisión y la autoriza otra persona.'
    : 'Todo listo para enviar a revisión.';
  const resumenCorto = vuelveARevision ? 'Al guardar vuelve a revisión de HSEQ.'
    : revEnviar.total ? `Faltan ${revEnviar.total} ${revEnviar.total === 1 ? 'dato' : 'datos'} para enviar.` : autorizada ? 'Un cambio crítico la devuelve a revisión.' : 'Lista para enviar.';
  const etiquetaEnviar = autorizada ? (vuelveARevision ? 'Guardar y enviar a revisión' : 'Guardar cambios') : d?.estado === 'RECHAZADA' ? 'Corregir y reenviar' : 'Enviar a revisión';

  return (
    <>
      <div className="mb-3"><Button variant="ghost" size="sm" onClick={salir}><ArrowLeft size={16} /> Declaraciones</Button></div>
      <PageHeader eyebrow="Comercial" title={d ? `Declaración ${d.numero}` : 'Nueva declaración'}
        subtitle={d ? `${d.cliente.razonSocial} · ${residuo ? 'Residuo' : 'Servicio'}` : 'Diligencie las 8 secciones. Puede guardar un borrador y terminar después.'}
        actions={d ? <span className="flex items-center gap-2"><EstadoBadge estado={d.estado === 'AUTORIZADA' && !d.activa ? 'INACTIVA' : d.estado} /></span> : undefined} />
      {d?.origenFase1 && <p className="mb-3 rounded-lg bg-warn/10 px-3 py-2 text-[13px] text-warn">Convertida de la fase 1: complete las secciones nuevas y envíela para que la autoricen.</p>}
      {d?.estado === 'RECHAZADA' && <p className="mb-3 rounded-lg bg-bad/10 px-3 py-2 text-[13px] text-bad">Rechazada{d.causal ? ` (${d.causal.nombre})` : ''}{d.observaciones ? `: ${d.observaciones}` : ''}. Corríjala y vuelva a enviarla.</p>}

      {/* Índice: en celular, fila de botones; en pantalla grande, columna fija */}
      <div className="scroll-x sticky top-14 z-10 -mx-4 mb-3 flex gap-1.5 bg-bg/95 px-4 py-2 backdrop-blur lg:hidden">
        {SECCIONES.map((s) => (
          <button key={s.n} type="button" aria-label={`Ir a la sección ${s.n}: ${s.titulo}`} onClick={() => ir(s.n)}
            className={cx('num h-8 shrink-0 rounded-full border px-3 text-[12px]', err(s.n) ? 'border-bad text-bad' : completa(s.n) ? 'border-ok/50 text-ok' : 'border-line text-muted')}>{s.n}</button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Secciones" className="hidden lg:block">
          <ol className="sticky top-20 flex flex-col gap-0.5">
            {SECCIONES.map((s) => {
              const na = !residuo && (s.n === 3 || s.n === 4);
              const malas = err(s.n), lista = completa(s.n);
              return (
                <li key={s.n}>
                  <button type="button" disabled={na} onClick={() => ir(s.n)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-surface-2 disabled:opacity-50">
                    {malas ? <CircleAlert size={15} className="shrink-0 text-bad" /> : lista || na ? <CircleCheck size={15} className={cx('shrink-0', na ? 'text-subtle' : 'text-ok')} /> : <span className="mx-[3px] h-2 w-2 shrink-0 rounded-full bg-line" />}
                    <span className="min-w-0 flex-1">{s.n}. {s.titulo}{na && <span className="block text-[11px] text-subtle">No aplica a servicios</span>}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="flex min-w-0 flex-col gap-4">
          <Seccion n={1} titulo="Información del generador" errores={err(1)}>
            {!d ? (
              <Campo label="Tipo de declaración"><Opciones value={f.tipo} onChange={cambiarTipo} items={[{ value: 'RESIDUO', label: 'Residuo' }, { value: 'SERVICIO', label: 'Servicio' }]} /></Campo>
            ) : <p className="text-sm">Tipo: <b>{residuo ? 'Residuo' : 'Servicio'}</b>. El tipo y el cliente no se cambian: para otro, cree una declaración nueva.</p>}
            <Campo label="Cliente (generador)" id="dc-cli" error={e.clienteId}>
              {d ? <p className="text-sm font-medium">{d.cliente.razonSocial} <span className="num font-normal text-muted">· NIT {d.cliente.nit}</span></p>
                : <BuscarCliente id="dc-cli" valor={f.clienteId} vacio="Escriba el nombre o el NIT" onChange={(x) => set({ clienteId: x?.id ?? '', sucursalIds: [] })} />}
            </Campo>
            <Campo label="Sedes que generan el residuo o reciben el servicio" error={e.sucursalIds}
              hint={f.alcanceSedes === 'TODAS' ? 'Incluye también las sedes que el cliente cree después.' : f.alcanceSedes === 'PRINCIPAL' ? (principal ? `Sede principal: ${principal.codigo ? `${principal.codigo} · ` : ''}${principal.nombre}` : 'Elija el cliente para ver su sede principal.') : undefined}>
              <Opciones<Alcance> value={f.alcanceSedes} onChange={(v) => set({ alcanceSedes: v })} items={[{ value: 'TODAS', label: 'Todas' }, { value: 'PRINCIPAL', label: 'Solo la principal' }, { value: 'SELECCION', label: 'Elegir' }]} />
            </Campo>
            {f.alcanceSedes === 'SELECCION' && (
              !f.clienteId ? <p className="text-[13px] text-muted">Elija primero el cliente.</p>
                : !sedes.length ? <p className="text-[13px] text-muted">{cliente.cargando ? 'Cargando sedes…' : 'El cliente no tiene sedes registradas.'}</p>
                : <div className="max-h-64 overflow-y-auto rounded-lg border border-line">
                    {sedes.map((x) => (
                      <label key={x.id} className={cx('flex items-center gap-2.5 border-b border-line px-3 py-2 text-[13px] last:border-0', x.activa ? 'cursor-pointer hover:bg-surface-2' : 'opacity-60')}>
                        <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--brand))]" disabled={!x.activa && !f.sucursalIds.includes(x.id)} checked={f.sucursalIds.includes(x.id)}
                          onChange={() => set({ sucursalIds: f.sucursalIds.includes(x.id) ? f.sucursalIds.filter((y) => y !== x.id) : [...f.sucursalIds, x.id] })} />
                        <span className="min-w-0 flex-1 truncate">{x.codigo ? <span className="num text-muted">{x.codigo} · </span> : null}{x.nombre}{x.generadorNombre ? <span className="text-muted"> · generador {x.generadorNombre}</span> : null}</span>
                        {x.esPrincipal && <Badge tone="info">principal</Badge>}{!x.activa && <Badge>inactiva</Badge>}
                      </label>
                    ))}
                  </div>
            )}
          </Seccion>

          <Seccion n={2} titulo="Datos específicos" errores={err(2)}>
            {!residuo && !!servicios.datos?.length && (
              <Campo label="Precargar desde el catálogo de servicios" id="dc-cat" hint="Llena el nombre, la línea de servicio y la descripción; después puede cambiarlos.">
                <Select id="dc-cat" value={f.catalogoId} onChange={(x) => precargar(x.target.value)}><option value="">Sin precargar</option>{servicios.datos.map((x) => <option key={x.id} value={x.id}>{x.nombre} ({x.codigo})</option>)}</Select>
              </Campo>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Campo label={residuo ? 'Nombre del residuo' : 'Nombre del servicio'} id="dc-nom" error={e.nombre}><Input id="dc-nom" value={f.nombre} maxLength={200} onChange={(x) => set({ nombre: x.target.value })} /></Campo>
              <Campo label="Código interno del cliente" id="dc-cod" error={e.codigoInterno} hint="Opcional. Único por cliente."><Input id="dc-cod" value={f.codigoInterno} maxLength={40} onChange={(x) => set({ codigoInterno: x.target.value })} /></Campo>
              <Campo label="Categoría" id="dc-catg" error={e.categoriaId}>
                <Select id="dc-catg" value={f.categoriaId} onChange={(x) => set({ categoriaId: x.target.value })}><option value="">Elija la categoría</option>{c.categorias.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</Select>
              </Campo>
              <Campo label="Línea de servicio" id="dc-lin" error={e.lineaServicioId} hint={linea ? `Unidad de negocio: ${linea.unidadNegocio.nombre}` : undefined}>
                <Select id="dc-lin" value={f.lineaServicioId} onChange={(x) => set({ lineaServicioId: x.target.value })}><option value="">Elija la línea</option>{c.lineas.map((x) => <option key={x.id} value={x.id}>{x.codigo} · {x.nombre}</option>)}</Select>
              </Campo>
              {residuo && (
                <Campo label="Tipo de residuo" id="dc-tr" error={e.tipoResiduoId}>
                  <Select id="dc-tr" value={f.tipoResiduoId} onChange={(x) => set({ tipoResiduoId: x.target.value })}><option value="">Elija el tipo</option>{c.tiposResiduo.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</Select>
                </Campo>
              )}
              <Campo label="Frecuencia (cada cuántos días)" id="dc-fre" error={e.frecuenciaDias} hint="Opcional, de 1 a 366."><Input id="dc-fre" type="number" min={1} max={366} inputMode="numeric" value={f.frecuenciaDias} onChange={(x) => set({ frecuenciaDias: x.target.value })} /></Campo>
              <Campo label="Cantidad por frecuencia" id="dc-can" error={e.cantidadFrecuencia} hint="Opcional. En la unidad del precio."><Input id="dc-can" type="number" min={0} step="0.01" value={f.cantidadFrecuencia} onChange={(x) => set({ cantidadFrecuencia: x.target.value })} /></Campo>
            </div>
            <Casilla checked={f.solicitudAutomatica} onChange={(v) => set({ solicitudAutomatica: v })}>
              Crear la solicitud de recolección automáticamente cada {f.frecuenciaDias || 'N'} días <span className="text-muted">(solo cuando esté autorizada y activa; se agrupan por sede y fecha)</span>
            </Casilla>
            {residuo ? (
              <>
                <Campo label="¿Es un residuo peligroso (RESPEL)?" error={e.esPeligroso}>
                  <Opciones value={f.esPeligroso ? 'si' : 'no'} onChange={(v) => set({ esPeligroso: v === 'si' })} items={SI_NO} />
                </Campo>
                {f.esPeligroso && (
                  <div className="flex flex-col gap-3 rounded-xl border border-warn/40 bg-warn/5 p-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <Campo label="Corriente Y" id="dc-y" error={e.codigoYId} hint="Decreto 1076 de 2015, anexo I.">
                        <Select id="dc-y" value={f.codigoYId} onChange={(x) => set({ codigoYId: x.target.value })}><option value="">Sin corriente Y</option>{natural(c.corrientesY).map((x) => <option key={x.id} value={x.id}>{x.padreId ? '  ' : ''}{x.codigo} · {recortar(x.descripcion)}</option>)}</Select>
                      </Campo>
                      <Campo label="Código A" id="dc-a" error={e.codigoAId} hint="Anexo II. Basta con Y o A.">
                        <Select id="dc-a" value={f.codigoAId} onChange={(x) => set({ codigoAId: x.target.value })}><option value="">Sin código A</option>{natural(c.codigosA).map((x) => <option key={x.id} value={x.id}>{x.padreId ? '  ' : ''}{x.codigo} · {recortar(x.descripcion)}</option>)}</Select>
                      </Campo>
                      <Campo label="Número UN" id="dc-un" error={e.codigoUn} hint="Opcional. Ej.: UN3082."><Input id="dc-un" value={f.codigoUn} maxLength={6} placeholder="UN3082" onChange={(x) => set({ codigoUn: x.target.value.toUpperCase() })} /></Campo>
                    </div>
                    <Campo label="Características de peligrosidad (CRETIB)"><Chips items={c.riesgos} valor={f.riesgoIds} onChange={(v) => set({ riesgoIds: v })} /></Campo>
                    <Campo label="Composición fisicoquímica" id="dc-comp" error={e.composicion}><Area id="dc-comp" maxLength={2000} value={f.composicion} onChange={(x) => set({ composicion: x.target.value })} /></Campo>
                  </div>
                )}
                <Campo label="Sistema de etiquetado" hint="Puede elegir varios."><Chips items={c.etiquetado} valor={f.etiquetadoIds} onChange={(v) => set({ etiquetadoIds: v })} /></Campo>
                <Campo label="Proceso que generó el residuo" id="dc-proc" error={e.descripcionProceso}><Area id="dc-proc" maxLength={2000} value={f.descripcionProceso} placeholder="Ej.: mantenimiento de la trampa de grasa del casino" onChange={(x) => set({ descripcionProceso: x.target.value })} /></Campo>
              </>
            ) : (
              <Campo label="Descripción del servicio" id="dc-desc" error={e.descripcionServicio} hint={`${f.descripcionServicio.length} de 1.000 caracteres.`}>
                <Area id="dc-desc" maxLength={1000} value={f.descripcionServicio} onChange={(x) => set({ descripcionServicio: x.target.value })} />
              </Campo>
            )}
          </Seccion>

          <Seccion n={3} titulo="Embalaje" errores={err(3)} noAplica={residuo ? undefined : 'No aplica a servicios.'}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Campo label="Tipo de embalaje" id="dc-emb" error={e.tipoEmbalajeId}>
                <Select id="dc-emb" value={f.tipoEmbalajeId} onChange={(x) => set({ tipoEmbalajeId: x.target.value })}><option value="">Elija el tipo</option>{c.tiposEmbalaje.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</Select>
              </Campo>
              {otro.embalaje && <Campo label="¿Cuál tipo de embalaje?" id="dc-emb2" error={e.otroTipoEmbalaje}><Input id="dc-emb2" maxLength={80} value={f.otroTipoEmbalaje} onChange={(x) => set({ otroTipoEmbalaje: x.target.value })} /></Campo>}
              <Campo label="Presentación" id="dc-pre" hint="Opcional. Ej.: caneca de 55 gal, 1 m³."><Input id="dc-pre" maxLength={60} value={f.presentacion} onChange={(x) => set({ presentacion: x.target.value })} /></Campo>
              <Campo label="Material del embalaje" id="dc-mat" error={e.materialEmbalajeId}>
                <Select id="dc-mat" value={f.materialEmbalajeId} onChange={(x) => set({ materialEmbalajeId: x.target.value })}><option value="">Elija el material</option>{c.materiales.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</Select>
              </Campo>
              {otro.material && <Campo label="¿Cuál material?" id="dc-mat2" error={e.otroMaterial}><Input id="dc-mat2" maxLength={80} value={f.otroMaterial} onChange={(x) => set({ otroMaterial: x.target.value })} /></Campo>}
              <Campo label="Tipo de sellado" id="dc-sel" hint="Opcional. Ej.: tapa con aro, nudo, cinta."><Input id="dc-sel" maxLength={80} value={f.tipoSellado} onChange={(x) => set({ tipoSellado: x.target.value })} /></Campo>
            </div>
          </Seccion>

          <Seccion n={4} titulo="Características fisicoquímicas" errores={err(4)} noAplica={residuo ? undefined : 'No aplica a servicios.'}>
            <Campo label="Estado físico" error={e.estadoFisico}><Opciones value={f.estadoFisico} onChange={(v) => set({ estadoFisico: v })} items={ESTADOS_FISICOS} /></Campo>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Campo label="¿Es inflamable?" error={e.inflamable}><Opciones<Exclude<SiNo, ''>> value={f.inflamable} onChange={(v) => set({ inflamable: v })} items={SI_NO} /></Campo>
              <Campo label="¿Es sustancia controlada (estupefacientes)?" error={e.controladaEstupefacientes} hint="Ley 30 de 1986 · Fondo Nacional de Estupefacientes.">
                <Opciones<Exclude<SiNo, ''>> value={f.controladaEstupefacientes} onChange={(v) => set({ controladaEstupefacientes: v })} items={SI_NO} />
              </Campo>
              <Campo label="Color" id="dc-col" hint="Opcional."><Input id="dc-col" maxLength={60} value={f.color} onChange={(x) => set({ color: x.target.value })} /></Campo>
              <Campo label="Olor" id="dc-olo" hint="Opcional."><Input id="dc-olo" maxLength={120} value={f.olor} onChange={(x) => set({ olor: x.target.value })} /></Campo>
              <Campo label="Densidad" id="dc-den" error={e.densidad} hint="Opcional; si la indica, elija su métrica."><Input id="dc-den" type="number" min={0} step="0.0001" value={f.densidad} onChange={(x) => set({ densidad: x.target.value })} /></Campo>
              <Campo label="Métrica de la densidad" id="dc-dm" error={e.metricaDensidadId}>
                <Select id="dc-dm" value={f.metricaDensidadId} onChange={(x) => set({ metricaDensidadId: x.target.value })}><option value="">Sin densidad</option>{c.metricasDensidad.map((x) => <option key={x.id} value={x.id}>{x.abreviacion} · {x.nombre}</option>)}</Select>
              </Campo>
            </div>
            <Campo label="¿Contiene hidrocarburos o aceites? (borras, lodos aceitosos…)" error={e.contieneHidrocarburos}
              hint="Si contiene: la biorremediación exige la caracterización de peligrosidad (CRETIB) negativa, y los RCD no se reciben.">
              <Opciones<Exclude<SiNo, ''>> value={f.contieneHidrocarburos} onChange={(v) => set({ contieneHidrocarburos: v })} items={SI_NO} />
            </Campo>
          </Seccion>

          <Seccion n={5} titulo="Disposición y manejo" errores={err(5)}>
            {e.disposiciones && <p role="alert" className="text-[12px] text-bad">{e.disposiciones}</p>}
            {f.disposiciones.map((x, i) => {
              const dd = c.disposiciones.find((y) => y.id === x.disposicionId);
              const cob = cobertura.datos?.detalle.find((y) => y.codigo === dd?.codigo);
              const esPrincipal = i === principalEfectiva;
              return (
                <div key={x.disposicionId} className="flex items-start gap-2 rounded-xl border border-line p-3">
                  <button type="button" aria-pressed={esPrincipal} title={esPrincipal ? 'Disposición principal (la que sale en el certificado)' : 'Marcar como principal'}
                    onClick={() => set({ disposiciones: f.disposiciones.map((y, j) => ({ ...y, principal: j === i })) })} className="rounded p-1 hover:bg-surface-2">
                    <Star size={16} className={esPrincipal ? 'fill-current text-warn' : 'text-subtle'} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{dd ? `${dd.codigo} · ${dd.nombre}` : 'Disposición'}{esPrincipal && f.disposiciones.length > 1 && <span className="ml-1.5 text-[12px] font-normal text-muted">principal</span>}</p>
                    <p className={cx('mt-0.5 flex items-start gap-1 text-[12px]', !cob ? 'text-subtle' : cob.cubierta ? 'text-ok' : 'text-bad')}>
                      {!cob ? 'Revisando el permiso…' : cob.cubierta
                        ? <><ShieldCheck size={14} className="mt-px shrink-0" /> Cubierta: {cob.soporte}</>
                        : <><ShieldAlert size={14} className="mt-px shrink-0" /> {cob.soporte}. No se podrá autorizar mientras siga así.</>}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" aria-label="Quitar la disposición" onClick={() => set({ disposiciones: f.disposiciones.filter((_, j) => j !== i) })}><Trash2 size={15} /></Button>
                </div>
              );
            })}
            <Campo label={f.disposiciones.length ? 'Agregar otra disposición' : 'Disposición o manejo'} id="dc-disp"
              hint={residuo ? 'Obligatoria para autorizar un residuo. La de la estrella es la principal: es la que sale en el certificado.' : 'Opcional en servicios.'}>
              <Select id="dc-disp" value="" onChange={(x) => x.target.value && set({ disposiciones: [...f.disposiciones, { disposicionId: x.target.value, principal: false }] })}>
                <option value="">Elija una disposición…</option>
                {disponibles.map((x) => <option key={x.id} value={x.id}>{x.codigo} · {x.nombre}{x.propia ? '' : ' (gestor aliado)'}</option>)}
              </Select>
            </Campo>
          </Seccion>

          <Seccion n={6} titulo="Información adicional" errores={err(6)}>
            <Campo label="Ficha de datos de seguridad (FDS)" id="dc-fds" error={e.fichaSeguridadUrl} hint={residuo && f.esPeligroso ? 'Obligatoria para autorizar un residuo peligroso. Pegue el enlace al PDF (Drive, página del fabricante…).' : 'Opcional. Enlace al PDF.'}>
              <Input id="dc-fds" type="url" maxLength={500} placeholder="https://…" value={f.fichaSeguridadUrl} onChange={(x) => set({ fichaSeguridadUrl: x.target.value })} />
            </Campo>
            {residuo && (
              <Campo label="Caracterización de peligrosidad (CRETIB) del laboratorio" id="dc-car" error={e.caracterizacionUrl}
                hint={f.contieneHidrocarburos === 'si' ? 'Obligatoria para biorremediación de residuos con hidrocarburos: debe demostrar que no son peligrosos. Enlace al PDF.' : 'Opcional. Enlace al PDF del laboratorio.'}>
                <Input id="dc-car" type="url" maxLength={500} placeholder="https://…" value={f.caracterizacionUrl} onChange={(x) => set({ caracterizacionUrl: x.target.value })} />
              </Campo>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Campo label="Serial" id="dc-ser" hint="Opcional. Serial genérico o del proveedor."><Input id="dc-ser" maxLength={60} value={f.serial} onChange={(x) => set({ serial: x.target.value })} /></Campo>
            </div>
            <Campo label="Datos extras" id="dc-ext" hint="Opcional. Lo que no tenga campo propio."><Area id="dc-ext" maxLength={4000} value={f.datosExtras} onChange={(x) => set({ datosExtras: x.target.value })} /></Campo>
          </Seccion>

          <Seccion n={7} titulo="Precio" errores={err(7)}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Campo label="Valor unitario (COP)" id="dc-pr" error={e.precio} hint={f.precio && Number(f.precio) >= 0 ? fmtCOP(Number(f.precio)) : 'Obligatorio para autorizar. Use 0 si se factura por contrato.'}>
                <Input id="dc-pr" type="number" min={0} step="1" inputMode="decimal" value={f.precio} onChange={(x) => set({ precio: x.target.value })} />
              </Campo>
              <Campo label="Por cada" id="dc-met" hint="«Global» es un valor por servicio, sin medir cantidad.">
                <Select id="dc-met" value={f.metricaId} onChange={(x) => set({ metricaId: x.target.value })}><option value="">Global (por servicio)</option>{c.metricasPrecio.map((x) => <option key={x.id} value={x.id}>{x.nombre} ({x.abreviacion})</option>)}</Select>
              </Campo>
              <Campo label="Negociación" id="dc-neg" hint={cliente.datos && !f.tipoNegociacion ? `Si la deja vacía: la del cliente (${NEG[cliente.datos.tipoNegociacion] ?? cliente.datos.tipoNegociacion}).` : undefined}>
                <Select id="dc-neg" value={f.tipoNegociacion} onChange={(x) => set({ tipoNegociacion: x.target.value })}><option value="">Como el cliente</option>{NEGOCIACIONES.map((x) => <option key={x} value={x}>{NEG[x]}</option>)}</Select>
              </Campo>
              <Campo label="Forma de pago" id="dc-fp" hint={cliente.datos && !f.formaPago ? `Si la deja vacía: la del cliente (${PAGO[cliente.datos.formaPago] ?? cliente.datos.formaPago}).` : undefined}>
                <Select id="dc-fp" value={f.formaPago} onChange={(x) => set({ formaPago: x.target.value })}><option value="">Como el cliente</option>{FORMAS_PAGO.map((x) => <option key={x} value={x}>{PAGO[x]}</option>)}</Select>
              </Campo>
            </div>
            <Casilla checked={f.mostrarPrecioApp} onChange={(v) => set({ mostrarPrecioApp: v })}>Mostrar el precio en la app del conductor</Casilla>
            {d && (
              <div className="rounded-lg bg-surface-2 px-3 py-2 text-[12px] text-muted">
                <p>Si cambia el precio, se crea una vigencia nueva desde hoy y la anterior queda en el historial. Nunca se sobrescribe.</p>
                {d.tarifas.length > 0 && (
                  <ul className="mt-1.5 flex flex-col gap-0.5">
                    {d.tarifas.slice(0, 5).map((t) => (
                      <li key={t.id} className="num">{fmtFecha(t.vigenteDesde)} → {t.vigenteHasta ? fmtFecha(t.vigenteHasta) : 'hoy'}: {fmtCOP(Number(t.precioUnitario))}{t.metrica ? ` / ${t.metrica.abreviacion}` : ' (global)'} · {NEG[t.tipoNegociacion] ?? t.tipoNegociacion}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Seccion>

          <Seccion n={8} titulo="Estado y responsabilidad" errores={err(8)}>
            {d && (
              <p className="flex flex-wrap items-center gap-2 text-sm">Estado actual: <EstadoBadge estado={d.estado === 'AUTORIZADA' && !d.activa ? 'INACTIVA' : d.estado} />
                {d.aprobadaPor && d.aprobadaEn && <span className="text-[12px] text-muted">Autorizada por {d.aprobadaPor.nombre} el {fmtFecha(d.aprobadaEn)}.</span>}</p>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Campo label="Vigente hasta" id="dc-vig" error={e.vigenteHasta} hint="Opcional. Fecha de recaracterización, si aplica."><Input id="dc-vig" type="date" value={f.vigenteHasta} onChange={(x) => set({ vigenteHasta: x.target.value })} /></Campo>
            </div>
            <Campo label="Observaciones" id="dc-obs" error={e.observaciones}><Area id="dc-obs" maxLength={1000} value={f.observaciones} onChange={(x) => set({ observaciones: x.target.value })} /></Campo>
            <div className={cx('rounded-xl border p-3', e.responsabilidadAceptada ? 'border-bad' : 'border-line')}>
              <div className="text-[13px] text-muted">
                <p className="font-medium text-fg">Declaración de responsabilidad del generador</p>
                <p className="mt-1">{RESPONSABILIDAD_GENERADOR.intro}</p>
                <ol className="mt-1.5 list-decimal space-y-1 pl-5">{RESPONSABILIDAD_GENERADOR.puntos.map((p) => <li key={p}>{p}</li>)}</ol>
                {conPoliticaDatos && <p className="mt-1.5">{RESPONSABILIDAD_GENERADOR.autorizacionDatos}</p>}
              </div>
              <div className="mt-3">
                <Casilla id="dc-resp" checked={f.responsabilidadAceptada} onChange={(v) => set({ responsabilidadAceptada: v })}>
                  <span className="font-medium">Acepto la declaración de responsabilidad en nombre del generador.</span>
                </Casilla>
              </div>
              {d?.responsabilidadAceptada && d.aceptadaEn && <p className="mt-1.5 pl-6 text-[12px] text-muted">Aceptada{d.aceptadaPor ? ` por ${d.aceptadaPor.nombre}` : ''} el {fmtFecha(d.aceptadaEn)}.</p>}
              {e.responsabilidadAceptada && <p role="alert" className="mt-1.5 pl-6 text-[12px] text-bad">{e.responsabilidadAceptada}</p>}
            </div>
            <div className={cx('rounded-lg px-3 py-2 text-[13px]', faltaAutorizar.length ? 'bg-warn/10 text-warn' : 'bg-ok/10 text-ok')}>
              {faltaAutorizar.length ? <>Para que HSEQ la pueda autorizar faltará: {faltaAutorizar.join('; ')}.</> : <>Cumple lo necesario para que HSEQ la autorice{sedesQueVan ? ` (${cant(sedesQueVan)} ${sedesQueVan === 1 ? 'sede' : 'sedes'})` : ''}.</>}
            </div>
          </Seccion>
        </div>
      </div>

      <div className="sticky bottom-3 z-20 mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border border-line bg-surface px-4 py-3 shadow-lg">
        <p className="min-w-0 basis-full text-[13px] text-muted sm:flex-1 sm:basis-auto">
          <span className="sm:hidden">{resumenCorto}</span><span className="hidden sm:inline">{resumen}</span>
        </p>
        <div className="flex flex-1 justify-end gap-2 sm:flex-none">
          {!autorizada && <Button disabled={ocupado} onClick={() => guardar(true)}><Save size={16} /> <span className="sm:hidden">Borrador</span><span className="hidden sm:inline">Guardar borrador</span></Button>}
          <Button variant="primary" disabled={ocupado} onClick={() => guardar(false)}><Send size={16} /> {etiquetaEnviar}</Button>
        </div>
      </div>
    </>
  );
}
