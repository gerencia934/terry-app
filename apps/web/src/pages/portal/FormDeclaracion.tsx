// Portal de clientes: declarar un residuo o un servicio con un formulario (autogestión, 20-11-2026), sin pasar por la
// plantilla de Excel. También corrige una declaración. Queda «en revisión»: Terra Viva fija la tarifa y la autoriza. Si
// ya estaba autorizada, corregirla la devuelve a revisión (no se puede pedir hasta que la autoricen de nuevo).
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeft, FileUp, Loader2, Paperclip, Send, ShieldCheck, X } from 'lucide-react';
import { RESPONSABILIDAD_GENERADOR } from '@terraviva/shared';
import { Badge, Button, Card, Field, Input, PageHeader, Select, useToast } from '../../components/ui';
import { api, sesionActual } from '../../lib/api';
import { msg, useApi } from '../../lib/servidor';
import { cx } from '../../lib/format';
import { usePortal } from './PortalApp';
import { abrirEnlace, areaCls, errorPortal, subirArchivo } from './comun';

interface Item { id: string; codigo: string; nombre: string }
interface Codigo { id: string; codigo: string; descripcion: string }
interface Catalogos {
  categorias: Item[]; tiposResiduo: Item[]; lineas: (Item & { unidadNegocio: string | null })[]; tiposEmbalaje: (Item & { esOtro: boolean })[];
  materiales: (Item & { esOtro: boolean })[]; disposiciones: Item[]; riesgos: Item[]; corrientesY: Codigo[]; codigosA: Codigo[];
}
type SiNo = '' | 'si' | 'no';
interface Doc { ref?: string; nombre?: string; existente: boolean; quitar: boolean }
const sinDoc: Doc = { existente: false, quitar: false };
const vacio = {
  tipo: 'RESIDUO' as 'RESIDUO' | 'SERVICIO', nombre: '', codigoInterno: '', alcanceSedes: 'SELECCION' as 'SELECCION' | 'TODAS' | 'PRINCIPAL', sucursalIds: [] as string[],
  categoriaId: '', tipoResiduoId: '', lineaServicioId: '', esPeligroso: false, codigoYId: '', codigoAId: '', codigoUn: '', riesgoIds: [] as string[],
  descripcionProceso: '', composicion: '', descripcionServicio: '', tipoEmbalajeId: '', otroTipoEmbalaje: '', presentacion: '', materialEmbalajeId: '', otroMaterial: '', tipoSellado: '',
  estadoFisico: '', inflamable: '' as SiNo, controladaEstupefacientes: '' as SiNo, color: '', olor: '', contieneHidrocarburos: false,
  disposiciones: [] as { disposicionId: string; principal: boolean }[], frecuenciaDias: '', cantidadFrecuencia: '', datosExtras: '', observaciones: '', responsabilidadAceptada: false,
};
type Form = typeof vacio;
interface Formulario extends Omit<Form, 'inflamable' | 'controladaEstupefacientes' | 'frecuenciaDias' | 'cantidadFrecuencia'> {
  id: string; numero: number; estado: string; activa: boolean; inflamable: boolean | null; controladaEstupefacientes: boolean | null; frecuenciaDias: number | null; cantidadFrecuencia: number | null;
  fichaSeguridad: { archivo: boolean } | null; caracterizacion: { archivo: boolean } | null;
}
const ESTADOS_FISICOS = [['SOLIDO', 'Sólido'], ['SEMISOLIDO', 'Semisólido'], ['LIQUIDO', 'Líquido'], ['GASEOSO', 'Gaseoso']] as const;
const siNo = (v: boolean | null): SiNo => (v === null ? '' : v ? 'si' : 'no');
const deSiNo = (v: SiNo) => (v === '' ? null : v === 'si');
const texto = (v: string) => v.trim() || null;
const numero = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));

export function FormDeclaracionPortal({ id, volver, listo }: { id?: string; volver: () => void; listo: (r: { numero: number; estabaAutorizada?: boolean }) => void }) {
  const yo = usePortal();
  const toast = useToast();
  const cat = useApi<Catalogos>('/portal/catalogos-declaracion');
  const previo = useApi<Formulario>(id ? `/portal/declaraciones/${id}/formulario` : null);
  const [f, setF] = useState<Form>(vacio);
  const [cargado, setCargado] = useState(!id);
  const [ficha, setFicha] = useState<Doc>(sinDoc);
  const [carac, setCarac] = useState<Doc>(sinDoc);
  const [subiendo, setSubiendo] = useState<'' | 'ficha' | 'carac'>('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!previo.datos || cargado) return;
    const d = previo.datos;
    setF({ ...vacio, ...Object.fromEntries(Object.entries(d).filter(([k, v]) => k in vacio && (Array.isArray(v) || (v !== null && typeof v !== 'object')))) as Partial<Form>,
      inflamable: siNo(d.inflamable), controladaEstupefacientes: siNo(d.controladaEstupefacientes),
      frecuenciaDias: d.frecuenciaDias === null ? '' : String(d.frecuenciaDias), cantidadFrecuencia: d.cantidadFrecuencia === null ? '' : String(d.cantidadFrecuencia),
      disposiciones: d.disposiciones, sucursalIds: d.sucursalIds, riesgoIds: d.riesgoIds, responsabilidadAceptada: false });
    setFicha({ existente: !!d.fichaSeguridad, quitar: false });
    setCarac({ existente: !!d.caracterizacion, quitar: false });
    setCargado(true);
  }, [previo.datos, cargado]);
  const c = cat.datos;
  const set = (x: Partial<Form>) => setF((s) => ({ ...s, ...x }));
  const residuo = f.tipo === 'RESIDUO';
  const serv = useMemo(() => c?.categorias.find((x) => x.codigo === 'SERV')?.id ?? '', [c]);
  const categorias = (c?.categorias ?? []).filter((x) => (residuo ? x.id !== serv : x.id === serv));
  const autorizada = previo.datos?.estado === 'AUTORIZADA';
  const otroEmbalaje = !!c?.tiposEmbalaje.find((x) => x.id === f.tipoEmbalajeId)?.esOtro;
  const otroMaterial = !!c?.materiales.find((x) => x.id === f.materialEmbalajeId)?.esOtro;
  const conPolitica = !!sesionActual()?.usuario.politicaDatos?.url;
  useEffect(() => { if (!residuo && serv && f.categoriaId !== serv) set({ categoriaId: serv }); }, [residuo, serv]); // eslint-disable-line react-hooks/exhaustive-deps

  if (cat.error || previo.error) return <p className="rounded-xl bg-bad/10 p-4 text-bad">{cat.error ?? previo.error}</p>;
  if (!c || !cargado) return <p className="flex items-center gap-2 p-6 text-muted"><Loader2 size={16} className="animate-spin" />Cargando el formulario…</p>;

  const subir = async (cual: 'ficha' | 'carac', file?: File | null) => {
    if (!file) return;
    setSubiendo(cual);
    try {
      const r = await subirArchivo(file);
      (cual === 'ficha' ? setFicha : setCarac)((d) => ({ ...d, ref: r.ref, nombre: r.nombre, quitar: false }));
    } catch (e) { toast(msg(e, 'No se pudo subir el archivo.'), 'warn'); }
    setSubiendo('');
  };
  const doc = (d: Doc) => (d.ref ? d.ref : d.quitar ? null : undefined);
  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!f.responsabilidadAceptada) { setError('Para enviar, acepte la declaración de responsabilidad del generador.'); return; }
    if (autorizada && !window.confirm('Esta declaración está autorizada. Al guardar los cambios vuelve a revisión y no podrá pedirla hasta que Terra Viva la autorice de nuevo. ¿Continuar?')) return;
    const peligroso = residuo && f.esPeligroso;
    const cuerpo = {
      tipo: f.tipo, nombre: f.nombre.trim(), codigoInterno: texto(f.codigoInterno), alcanceSedes: yo.restringido ? 'SELECCION' : f.alcanceSedes,
      sucursalIds: (yo.restringido || f.alcanceSedes === 'SELECCION') ? f.sucursalIds : [],
      categoriaId: f.categoriaId, tipoResiduoId: residuo ? f.tipoResiduoId || null : null, lineaServicioId: f.lineaServicioId, esPeligroso: peligroso,
      codigoYId: peligroso ? f.codigoYId || null : null, codigoAId: peligroso ? f.codigoAId || null : null, codigoUn: residuo ? texto(f.codigoUn.toUpperCase()) : null,
      riesgoIds: peligroso ? f.riesgoIds : [], descripcionProceso: residuo ? texto(f.descripcionProceso) : null, composicion: residuo ? texto(f.composicion) : null,
      descripcionServicio: residuo ? null : texto(f.descripcionServicio),
      tipoEmbalajeId: residuo ? f.tipoEmbalajeId || null : null, otroTipoEmbalaje: residuo && otroEmbalaje ? texto(f.otroTipoEmbalaje) : null, presentacion: residuo ? texto(f.presentacion) : null,
      materialEmbalajeId: residuo ? f.materialEmbalajeId || null : null, otroMaterial: residuo && otroMaterial ? texto(f.otroMaterial) : null, tipoSellado: residuo ? texto(f.tipoSellado) : null,
      estadoFisico: residuo ? f.estadoFisico || null : null, inflamable: residuo ? deSiNo(f.inflamable) : null, controladaEstupefacientes: residuo ? deSiNo(f.controladaEstupefacientes) : null,
      color: residuo ? texto(f.color) : null, olor: residuo ? texto(f.olor) : null, contieneHidrocarburos: residuo && f.contieneHidrocarburos,
      disposiciones: f.disposiciones, frecuenciaDias: numero(f.frecuenciaDias), cantidadFrecuencia: numero(f.cantidadFrecuencia),
      datosExtras: texto(f.datosExtras), observaciones: texto(f.observaciones), responsabilidadAceptada: true,
      ...(doc(ficha) !== undefined ? { fichaSeguridad: doc(ficha) } : {}), ...(residuo && doc(carac) !== undefined ? { caracterizacion: doc(carac) } : {}),
    };
    setEnviando(true);
    try {
      const r = id ? await api<{ numero: number; estabaAutorizada: boolean }>(`/portal/declaraciones/${id}`, { metodo: 'PUT', cuerpo })
        : await api<{ numero: number }>('/portal/declaraciones', { cuerpo });
      listo(r);
    } catch (x) { setError(errorPortal(x, 'No se pudo guardar la declaración.')); }
    setEnviando(false);
  };
  const alternar = (lista: string[], v: string) => (lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v]);
  const principal = f.disposiciones.find((x) => x.principal)?.disposicionId ?? f.disposiciones[0]?.disposicionId ?? '';

  return (
    <form onSubmit={enviar} className="flex flex-col gap-5">
      <div>
        <button type="button" onClick={volver} className="mb-2 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg"><ArrowLeft size={15} /> Volver a Declaraciones</button>
        <PageHeader title={id ? `Corregir la declaración N.° ${previo.datos?.numero ?? ''}` : 'Nueva declaración'}
          subtitle="Cuéntenos qué residuo entrega o qué servicio necesita. Queda en revisión: Terra Viva la revisa, fija la tarifa y la autoriza. Los campos con * son obligatorios." />
      </div>
      {autorizada && <p className="flex items-start gap-2 rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-[13px]"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn" />Está autorizada: al guardar cambios vuelve a revisión y no se puede pedir hasta que Terra Viva la autorice de nuevo.</p>}

      <Seccion n={1} titulo="Qué declara">
        {!id && (
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo">
            {(['RESIDUO', 'SERVICIO'] as const).map((t) => (
              <button type="button" key={t} role="radio" aria-checked={f.tipo === t} onClick={() => set({ tipo: t, categoriaId: t === 'SERVICIO' ? serv : '' })}
                className={cx('rounded-xl border p-3 text-left text-[13px]', f.tipo === t ? 'border-brand bg-brand-soft/50' : 'border-line hover:border-brand/40')}>
                <span className="block font-semibold">{t === 'RESIDUO' ? 'Un residuo' : 'Un servicio'}</span>
                <span className="text-muted">{t === 'RESIDUO' ? 'Lo que entrega para tratar, aprovechar o disponer' : 'Unidades sanitarias, lavados, fumigación…'}</span>
              </button>
            ))}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
          <Field label={`Nombre del ${residuo ? 'residuo' : 'servicio'} *`} id="fd-n"><Input id="fd-n" required minLength={2} maxLength={200} value={f.nombre} onChange={(e) => set({ nombre: e.target.value })} placeholder={residuo ? 'Ej.: Aceite usado de motor' : 'Ej.: Mantenimiento de unidad sanitaria'} /></Field>
          <Field label="Su código interno" id="fd-c" hint="Opcional"><Input id="fd-c" maxLength={40} value={f.codigoInterno} onChange={(e) => set({ codigoInterno: e.target.value })} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {residuo && <Field label="Categoría *" id="fd-cat"><Select id="fd-cat" value={f.categoriaId} onChange={(e) => set({ categoriaId: e.target.value })} required>
            <option value="">Elija…</option>{categorias.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</Select></Field>}
          {residuo && <Field label="Tipo de residuo *" id="fd-tr"><Select id="fd-tr" value={f.tipoResiduoId} onChange={(e) => set({ tipoResiduoId: e.target.value })} required>
            <option value="">Elija…</option>{c.tiposResiduo.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</Select></Field>}
          <Field label="Línea de servicio *" id="fd-l" hint="Si no está seguro, elija la más parecida: Terra Viva la ajusta."><Select id="fd-l" value={f.lineaServicioId} onChange={(e) => set({ lineaServicioId: e.target.value })} required>
            <option value="">Elija…</option>{c.lineas.map((x) => <option key={x.id} value={x.id}>{x.nombre}{x.unidadNegocio ? ` (${x.unidadNegocio})` : ''}</option>)}</Select></Field>
        </div>
      </Seccion>

      <Seccion n={2} titulo="En qué sedes">
        {!yo.restringido && (
          <Field label="Sedes" id="fd-al"><Select id="fd-al" value={f.alcanceSedes} onChange={(e) => set({ alcanceSedes: e.target.value as Form['alcanceSedes'] })}>
            <option value="SELECCION">Las que elija</option><option value="TODAS">Todas mis sedes (también las que cree después)</option><option value="PRINCIPAL">Solo la sede principal</option>
          </Select></Field>
        )}
        {(yo.restringido || f.alcanceSedes === 'SELECCION') && (
          <div className="flex flex-wrap gap-2">
            {yo.sedes.map((s) => (
              <label key={s.id} className={cx('flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-[13px]', f.sucursalIds.includes(s.id) ? 'border-brand bg-brand-soft/40' : 'border-line')}>
                <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--brand))]" checked={f.sucursalIds.includes(s.id)} onChange={() => set({ sucursalIds: alternar(f.sucursalIds, s.id) })} />
                {s.codigo ? `${s.codigo} · ` : ''}{s.nombre}
              </label>
            ))}
            {!yo.sedes.length && <p className="text-[13px] text-muted">Aún no tiene sedes: créelas en «Sedes».</p>}
          </div>
        )}
      </Seccion>

      {residuo ? (
        <>
          <Seccion n={3} titulo="Peligrosidad">
            <label className="flex items-start gap-2.5 text-[13px]"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--brand))]" checked={f.esPeligroso} onChange={(e) => set({ esPeligroso: e.target.checked })} />
              <span><b>Es un residuo peligroso</b> (RESPEL: tiene alguna característica corrosiva, reactiva, explosiva, tóxica, inflamable o infecciosa)</span></label>
            {f.esPeligroso && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Corriente Y" id="fd-y"><Select id="fd-y" value={f.codigoYId} onChange={(e) => set({ codigoYId: e.target.value })}>
                    <option value="">Sin indicar</option>{c.corrientesY.map((x) => <option key={x.id} value={x.id}>{x.codigo} · {x.descripcion.slice(0, 70)}</option>)}</Select></Field>
                  <Field label="Código A" id="fd-a"><Select id="fd-a" value={f.codigoAId} onChange={(e) => set({ codigoAId: e.target.value })}>
                    <option value="">Sin indicar</option>{c.codigosA.map((x) => <option key={x.id} value={x.id}>{x.codigo} · {x.descripcion.slice(0, 70)}</option>)}</Select></Field>
                </div>
                <p className="text-[12px] text-subtle">Indique la corriente Y o el código A (Decreto 1076 de 2015). Si no los conoce, Terra Viva le ayuda.</p>
                <div className="flex flex-wrap gap-2">{c.riesgos.map((x) => (
                  <button type="button" key={x.id} onClick={() => set({ riesgoIds: alternar(f.riesgoIds, x.id) })} aria-pressed={f.riesgoIds.includes(x.id)}
                    className={cx('rounded-full border px-3 py-1 text-[12px]', f.riesgoIds.includes(x.id) ? 'border-brand bg-brand-soft font-medium text-brand-ink' : 'border-line text-muted')}>{x.nombre}</button>
                ))}</div>
                <Field label="Número UN" id="fd-un" hint="Para el transporte, si lo tiene (ej.: UN1202)"><Input id="fd-un" maxLength={6} value={f.codigoUn} onChange={(e) => set({ codigoUn: e.target.value })} /></Field>
              </>
            )}
          </Seccion>

          <Seccion n={4} titulo="Características y embalaje">
            <Field label="Proceso que lo genera *" id="fd-pr"><textarea id="fd-pr" className={areaCls} maxLength={2000} value={f.descripcionProceso} onChange={(e) => set({ descripcionProceso: e.target.value })} placeholder="Ej.: cambio de aceite de la flota de vehículos" /></Field>
            <Field label={`Composición${f.esPeligroso ? ' *' : ''}`} id="fd-co"><textarea id="fd-co" className={areaCls} maxLength={2000} value={f.composicion} onChange={(e) => set({ composicion: e.target.value })} placeholder="De qué está hecho (aproximado)" /></Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Estado físico *" id="fd-ef"><Select id="fd-ef" value={f.estadoFisico} onChange={(e) => set({ estadoFisico: e.target.value })}><option value="">Elija…</option>{ESTADOS_FISICOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</Select></Field>
              <Field label="¿Es inflamable? *" id="fd-in"><Select id="fd-in" value={f.inflamable} onChange={(e) => set({ inflamable: e.target.value as SiNo })}><option value="">Elija…</option><option value="si">Sí</option><option value="no">No</option></Select></Field>
              <Field label="¿Sustancia controlada? *" id="fd-sc"><Select id="fd-sc" value={f.controladaEstupefacientes} onChange={(e) => set({ controladaEstupefacientes: e.target.value as SiNo })}><option value="">Elija…</option><option value="si">Sí</option><option value="no">No</option></Select></Field>
            </div>
            <label className="flex items-start gap-2.5 text-[13px]"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--brand))]" checked={f.contieneHidrocarburos} onChange={(e) => set({ contieneHidrocarburos: e.target.checked })} />Contiene hidrocarburos (aceites, grasas, combustibles)</label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Color" id="fd-col"><Input id="fd-col" maxLength={60} value={f.color} onChange={(e) => set({ color: e.target.value })} /></Field>
              <Field label="Olor" id="fd-ol"><Input id="fd-ol" maxLength={120} value={f.olor} onChange={(e) => set({ olor: e.target.value })} /></Field>
              <Field label="Tipo de embalaje *" id="fd-te"><Select id="fd-te" value={f.tipoEmbalajeId} onChange={(e) => set({ tipoEmbalajeId: e.target.value })}><option value="">Elija…</option>{c.tiposEmbalaje.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</Select></Field>
              <Field label="Material del embalaje *" id="fd-me"><Select id="fd-me" value={f.materialEmbalajeId} onChange={(e) => set({ materialEmbalajeId: e.target.value })}><option value="">Elija…</option>{c.materiales.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</Select></Field>
              {otroEmbalaje && <Field label="¿Qué embalaje?" id="fd-oe"><Input id="fd-oe" maxLength={80} value={f.otroTipoEmbalaje} onChange={(e) => set({ otroTipoEmbalaje: e.target.value })} /></Field>}
              {otroMaterial && <Field label="¿Qué material?" id="fd-om"><Input id="fd-om" maxLength={80} value={f.otroMaterial} onChange={(e) => set({ otroMaterial: e.target.value })} /></Field>}
              <Field label="Presentación" id="fd-pt" hint="Tamaño: 55 gal, 1 m³, bolsa de 20 kg…"><Input id="fd-pt" maxLength={60} value={f.presentacion} onChange={(e) => set({ presentacion: e.target.value })} /></Field>
              <Field label="Cierre o sellado" id="fd-ts"><Input id="fd-ts" maxLength={80} value={f.tipoSellado} onChange={(e) => set({ tipoSellado: e.target.value })} placeholder="Tapa con aro, nudo, cinta…" /></Field>
            </div>
          </Seccion>
        </>
      ) : (
        <Seccion n={3} titulo="El servicio">
          <Field label="Describa el servicio *" id="fd-ds"><textarea id="fd-ds" className={areaCls} maxLength={1000} value={f.descripcionServicio} onChange={(e) => set({ descripcionServicio: e.target.value })} placeholder="Qué necesita, cuántas unidades, condiciones del sitio…" /></Field>
        </Seccion>
      )}

      <Seccion n={residuo ? 5 : 4} titulo="Tratamiento y frecuencia">
        <Field label="Tratamiento sugerido" id="fd-tr2" hint="Terra Viva confirma el tratamiento autorizado según sus licencias."><Select id="fd-tr2" value={principal}
          onChange={(e) => set({ disposiciones: e.target.value ? [{ disposicionId: e.target.value, principal: true }] : [] })}>
          <option value="">Que lo defina Terra Viva</option>{c.disposiciones.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</Select></Field>
        {f.disposiciones.length > 1 && <p className="text-[12px] text-subtle">Terra Viva le definió {f.disposiciones.length} tratamientos; si elige otro, se reemplazan por ese.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Cada cuántos días lo entrega" id="fd-fr" hint="Opcional: para programarlo"><Input id="fd-fr" inputMode="numeric" value={f.frecuenciaDias} onChange={(e) => set({ frecuenciaDias: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="Cantidad aproximada por entrega" id="fd-ca"><Input id="fd-ca" inputMode="decimal" value={f.cantidadFrecuencia} onChange={(e) => set({ cantidadFrecuencia: e.target.value })} /></Field>
        </div>
      </Seccion>

      <Seccion n={residuo ? 6 : 5} titulo="Documentos">
        <Documento titulo="Ficha de datos de seguridad (FDS)" ayuda={residuo && f.esPeligroso ? 'Obligatoria para autorizar un residuo peligroso.' : 'Si la tiene, adjúntela (PDF o foto).'}
          d={ficha} set={setFicha} subiendo={subiendo === 'ficha'} subir={(x) => subir('ficha', x)} ver={id && ficha.existente ? () => abrirEnlace(`/portal/declaraciones/${id}/ficha/enlace`).catch((e) => toast(msg(e, 'No se pudo abrir.'), 'warn')) : undefined} />
        {residuo && <Documento titulo="Caracterización de peligrosidad (CRETIB) del laboratorio" ayuda={f.contieneHidrocarburos ? 'Con hidrocarburos, algunos tratamientos la exigen.' : 'Opcional.'}
          d={carac} set={setCarac} subiendo={subiendo === 'carac'} subir={(x) => subir('carac', x)} ver={id && carac.existente ? () => abrirEnlace(`/portal/declaraciones/${id}/caracterizacion/enlace`).catch((e) => toast(msg(e, 'No se pudo abrir.'), 'warn')) : undefined} />}
        <Field label="Información adicional" id="fd-ex"><textarea id="fd-ex" className={areaCls} maxLength={4000} value={f.datosExtras} onChange={(e) => set({ datosExtras: e.target.value })} /></Field>
        <Field label="Observaciones para Terra Viva" id="fd-ob"><textarea id="fd-ob" className={areaCls} maxLength={1000} value={f.observaciones} onChange={(e) => set({ observaciones: e.target.value })} /></Field>
      </Seccion>

      <Card>
        <div className="flex flex-col gap-3 text-[13px]">
          <p className="flex items-center gap-2 font-semibold"><ShieldCheck size={16} className="text-brand" /> Declaración de responsabilidad del generador</p>
          <div className="max-h-48 overflow-y-auto rounded-lg bg-surface-2 p-3 text-[12px] leading-relaxed text-muted">
            <p>{RESPONSABILIDAD_GENERADOR.intro}</p>
            <ol className="mt-1.5 list-decimal space-y-1 pl-5">{RESPONSABILIDAD_GENERADOR.puntos.map((p) => <li key={p}>{p}</li>)}</ol>
            {conPolitica && <p className="mt-1.5">{RESPONSABILIDAD_GENERADOR.autorizacionDatos}</p>}
          </div>
          <label className="flex items-start gap-2.5"><input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--brand))]" checked={f.responsabilidadAceptada} onChange={(e) => set({ responsabilidadAceptada: e.target.checked })} />
            <span>Acepto la declaración de responsabilidad del generador en nombre de {yo.cliente.razonSocial.replace(/\.+$/, '')}.</span></label>
          {error && <p role="alert" className="rounded-lg bg-bad/10 p-3 text-bad">{error}</p>}
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
            <Button type="button" variant="ghost" onClick={volver}>Cancelar</Button>
            <Button type="submit" variant="primary" disabled={enviando || !!subiendo}>{enviando ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}{id ? 'Guardar y enviar a revisión' : 'Enviar a revisión'}</Button>
          </div>
        </div>
      </Card>
    </form>
  );
}

function Seccion({ n, titulo, children }: { n: number; titulo: string; children: ReactNode }) {
  return (
    <Card title={<span className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-soft text-[12px] font-semibold text-brand-ink">{n}</span>{titulo}</span>}>
      <div className="flex flex-col gap-3">{children}</div>
    </Card>
  );
}

function Documento({ titulo, ayuda, d, set, subiendo, subir, ver }: { titulo: string; ayuda: string; d: Doc; set: (f: (d: Doc) => Doc) => void; subiendo: boolean; subir: (f?: File | null) => void; ver?: () => void }) {
  return (
    <div className="rounded-xl border border-line p-3 text-[13px]">
      <p className="font-medium">{titulo}</p>
      <p className="text-[12px] text-subtle">{ayuda}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {d.ref ? <Badge tone="ok"><Paperclip size={11} /> {d.nombre}</Badge> : d.existente && !d.quitar ? <Badge tone="info"><Paperclip size={11} /> En el expediente</Badge> : <Badge>Sin adjuntar</Badge>}
        {ver && !d.ref && !d.quitar && <Button type="button" size="sm" variant="ghost" onClick={ver}>Ver</Button>}
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[13px] hover:bg-surface-2">
          {subiendo ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={14} />}{d.ref || d.existente ? 'Reemplazar' : 'Adjuntar PDF o foto'}
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className="sr-only" onChange={(e) => { subir(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {(d.ref || (d.existente && !d.quitar)) && <Button type="button" size="sm" variant="ghost" onClick={() => set((x) => ({ ...x, ref: undefined, nombre: undefined, quitar: x.existente }))}><X size={14} /> Quitar</Button>}
      </div>
    </div>
  );
}
