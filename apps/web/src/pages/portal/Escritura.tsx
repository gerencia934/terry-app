// Portal de clientes: lo que escribe el cliente (solo el perfil Administrador). Cargar sus declaraciones (quedan en
// revisión: Terra Viva fija la tarifa y las autoriza), pedir servicios (quedan «por confirmar») y cancelar los pedidos
// que nadie ha confirmado. El servidor y la base de datos vuelven a exigir todo esto.
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, FileUp, Loader2, MapPin, Paperclip, Send, Truck, Upload, Warehouse, XCircle } from 'lucide-react';
import { construirPlantilla, construirPlantillaCsv, plantillaPortal, type FilaValidada } from '@terraviva/shared';
import { Badge, Button, Field, Input, Select, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { msg, sumarDias, useApi } from '../../lib/servidor';
import { cx, fmtFecha } from '../../lib/format';
import { usePortal } from './PortalApp';
import { errorPortal, subirArchivo } from './comun';

const areaCls = 'min-h-[72px] w-full min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';

// ---------------- Cargar declaraciones ----------------
type TipoCargue = 'decl-residuos' | 'decl-servicios';
interface Revision {
  archivo: string; filas: FilaValidada[]; faltantes: string[]; formato: 'XLSX' | 'CSV'; delimitador: string | null; avisos: string[];
  resumen: { leidas: number; validas: number; conErrores: number; conAdvertencias: number };
}

/** Descargar la plantilla, subirla, revisar fila por fila y confirmar aceptando la responsabilidad del generador. */
export function CargueDeclaraciones({ listo }: { listo: (creadas: number) => void }) {
  const yo = usePortal();
  const toast = useToast();
  const [tipo, setTipo] = useState<TipoCargue>('decl-residuos');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [rev, setRev] = useState<Revision | null>(null);
  const [acepta, setAcepta] = useState(false);
  const [ocupado, setOcupado] = useState<'' | 'revisando' | 'cargando'>('');
  const [arrastre, setArrastre] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const p = plantillaPortal(tipo)!;
  const nombreDe = (f: FilaValidada) => f.datos.residuo || f.datos.servicio || f.datos.codigo || '(sin nombre)';

  const elegirTipo = (t: TipoCargue) => { setTipo(t); setArchivo(null); setRev(null); setAcepta(false); };
  const bajar = async (csv: boolean) => {
    try {
      const { descargar } = await import('../../cargues/descargar');
      if (csv) descargar(construirPlantillaCsv(p), p.archivo.replace(/\.xlsx$/i, '.csv'), 'text/csv;charset=utf-8');
      else descargar(await construirPlantilla(p), p.archivo);
    } catch { toast('No se pudo generar la plantilla en este navegador.', 'warn'); }
  };
  const revisar = async (f?: File | null) => {
    if (!f) return;
    setArchivo(f); setRev(null); setAcepta(false); setOcupado('revisando');
    try {
      const form = new FormData(); form.append('archivo', f, f.name);
      setRev(await api<Revision>(`/portal/declaraciones/cargue/${tipo}/vista-previa`, { form }));
    } catch (e) { toast(msg(e, 'No se pudo revisar el archivo.'), 'warn'); setArchivo(null); }
    setOcupado('');
  };
  const cargar = async () => {
    if (!archivo || !rev) return;
    setOcupado('cargando');
    try {
      const form = new FormData(); form.append('archivo', archivo, archivo.name); form.append('aceptaResponsabilidad', 'true');
      const r = await api<{ creadas: number; rechazadas: number }>(`/portal/declaraciones/cargue/${tipo}/confirmar`, { form });
      toast(`${r.creadas === 1 ? 'Quedó cargada 1 declaración' : `Quedaron cargadas ${r.creadas} declaraciones`}, en revisión de Terra Viva.${r.rechazadas ? ` ${r.rechazadas} ${r.rechazadas === 1 ? 'fila con errores quedó' : 'filas con errores quedaron'} por fuera.` : ''}`);
      listo(r.creadas);
    } catch (e) { toast(msg(e, 'No se pudo cargar.'), 'warn'); }
    setOcupado('');
  };
  const conError = rev?.filas.filter((f) => f.errores.length) ?? [];
  const conAviso = rev?.filas.filter((f) => !f.errores.length && f.advertencias.length) ?? [];
  const puedeCargar = !!rev && !rev.faltantes.length && rev.resumen.validas > 0 && acepta && !ocupado;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Qué va a cargar">
        {(['decl-residuos', 'decl-servicios'] as const).map((t) => (
          <button key={t} role="radio" aria-checked={tipo === t} onClick={() => elegirTipo(t)}
            className={cx('rounded-xl border p-3 text-left text-[13px] transition-colors', tipo === t ? 'border-brand bg-brand-soft/50' : 'border-line hover:border-brand/40')}>
            <span className="block font-semibold">{t === 'decl-residuos' ? 'Residuos' : 'Servicios'}</span>
            <span className="text-muted">{t === 'decl-residuos' ? 'Lo que entrega para tratar o disponer' : 'Unidades sanitarias, lavados, fumigación…'}</span>
          </button>
        ))}
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-[14px] font-semibold">1. Descargue la plantilla y llénela</h3>
        <p className="text-[13px] text-muted">{p.descripcion} Cada columna trae su instrucción; los códigos de los catálogos están en la hoja «Instrucciones». No lleva NIT ni precio: el NIT es el de su empresa y la tarifa la fija Terra Viva.</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => bajar(false)}><Download size={14} /> Plantilla en Excel</Button>
          <Button size="sm" variant="ghost" onClick={() => bajar(true)}>En CSV</Button>
        </div>
        <div className="rounded-lg bg-surface-2 p-3 text-[12px] text-muted">
          <p className="mb-1 flex items-center gap-1 font-medium text-fg"><MapPin size={13} /> En la columna «Sedes» escriba {yo.restringido ? 'los códigos de sus sedes' : 'TODAS, PRINCIPAL o los códigos de sus sedes'}, separados por punto y coma:</p>
          <p>{yo.sedes.map((s) => `${s.codigo ?? '—'} ${s.nombre}`).join(' · ') || 'Su empresa aún no tiene sedes: pídale a Terra Viva que las cree.'}</p>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-[14px] font-semibold">2. Súbala para revisarla</h3>
        <div onDragOver={(e: DragEvent) => { e.preventDefault(); setArrastre(true); }} onDragLeave={() => setArrastre(false)}
          onDrop={(e: DragEvent) => { e.preventDefault(); setArrastre(false); revisar(e.dataTransfer.files[0]); }}
          className={cx('flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center', arrastre ? 'border-brand bg-brand-soft/50' : 'border-line')}>
          {ocupado === 'revisando' ? <Loader2 size={24} className="animate-spin text-brand" /> : <Upload size={24} className="text-brand" />}
          <p className="text-[13px] font-medium">{ocupado === 'revisando' ? 'Revisando cada fila…' : archivo ? archivo.name : 'Arrastre aquí la plantilla diligenciada'}</p>
          <Button size="sm" onClick={() => input.current?.click()} disabled={!!ocupado}><FileSpreadsheet size={14} /> {archivo ? 'Elegir otro archivo' : 'Elegir archivo (.xlsx o .csv)'}</Button>
          <input ref={input} type="file" accept=".xlsx,.csv,.txt" className="sr-only" aria-label="Archivo de declaraciones" onChange={(e) => { revisar(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        <p className="text-[12px] text-subtle">Revisar no guarda nada.</p>
      </section>

      {rev && (
        <section className="flex flex-col gap-3">
          <h3 className="text-[14px] font-semibold">3. Revise el resultado</h3>
          <div className="flex flex-wrap gap-1.5">
            <Badge>{rev.resumen.leidas} {rev.resumen.leidas === 1 ? 'fila' : 'filas'}</Badge>
            <Badge tone="ok"><CheckCircle2 size={12} /> {rev.resumen.validas} {rev.resumen.validas === 1 ? 'lista' : 'listas'}</Badge>
            {rev.resumen.conErrores > 0 && <Badge tone="bad"><XCircle size={12} /> {rev.resumen.conErrores} con errores</Badge>}
            {conAviso.length > 0 && <Badge tone="warn"><AlertTriangle size={12} /> {conAviso.length} con avisos</Badge>}
          </div>
          {rev.faltantes.length > 0 && <p className="rounded-lg bg-bad/10 p-3 text-[13px] text-bad">Faltan columnas obligatorias: {rev.faltantes.join(', ')}. Use la plantilla descargada aquí.</p>}
          {rev.avisos.map((a) => <p key={a} className="rounded-lg bg-warn/10 p-3 text-[13px] text-warn">{a}</p>)}
          {conError.length > 0 && (
            <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
              {conError.map((f) => (
                <li key={f.n} className="rounded-lg border border-bad/30 bg-bad/5 p-2.5 text-[12px]">
                  <p className="font-medium text-fg">Fila {f.n} · {nombreDe(f)}</p>
                  <ul className="mt-1 list-disc pl-4 text-bad">{f.errores.map((e) => <li key={e}>{e}</li>)}</ul>
                </li>
              ))}
            </ul>
          )}
          {conAviso.length > 0 && (
            <details className="rounded-lg border border-line text-[12px]">
              <summary className="cursor-pointer px-3 py-2 font-medium">Avisos ({conAviso.length}): no impiden cargar</summary>
              <ul className="flex flex-col gap-1 px-3 pb-3">{conAviso.map((f) => <li key={f.n}><b>Fila {f.n}:</b> {f.advertencias.join(' · ')}</li>)}</ul>
            </details>
          )}
          {rev.resumen.validas > 0 && !rev.faltantes.length && (
            <>
              <label className="flex items-start gap-2.5 rounded-lg border border-line p-3 text-[13px]">
                <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--brand))]" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} />
                <span>Como generador, declaro que la información de {rev.resumen.validas === 1 ? 'esta declaración' : `estas ${rev.resumen.validas} declaraciones`} es veraz y completa, y acepto la declaración de responsabilidad del generador.</span>
              </label>
              <div className="flex justify-end">
                <Button variant="primary" disabled={!puedeCargar} onClick={cargar}>
                  {ocupado === 'cargando' ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                  Cargar {rev.resumen.validas} {rev.resumen.validas === 1 ? 'declaración' : 'declaraciones'}
                </Button>
              </div>
              <p className="text-[12px] text-subtle">Quedan «en revisión»: Terra Viva fija la tarifa y las autoriza. {rev.resumen.conErrores ? 'Las filas con errores no se cargan: corríjalas y súbalas en otro archivo.' : ''}</p>
            </>
          )}
        </section>
      )}
    </div>
  );
}

// ---------------- Pedir un servicio ----------------
interface DeclPedido { id: string; numero: number; nombre: string; codigoInterno: string | null; tipo: 'RESIDUO' | 'SERVICIO'; unidad: string | null }
interface Opciones {
  hoy: string;
  sedes: { id: string; codigo: string | null; nombre: string; municipio: string | null; declaraciones: DeclPedido[] }[];
  especificaciones: { id: string; nombre: string; descripcion: string | null }[];
  destinos: { id: string; razonSocial: string }[]; arl: { id: string; nombre: string }[]; eps: { id: string; nombre: string }[];
}
type Jornada = '' | 'AM' | 'PM' | 'DIA';
interface Transporte {
  empresaTransportadora: string; tipoVehiculo: string; placa: string; conductorNombre: string; conductorDocumento: string; conductorArlId: string; conductorEpsId: string;
  auxiliarNombre: string; auxiliarDocumento: string; auxiliarArlId: string; auxiliarEpsId: string;
}
/** Lo que trae el servidor de un pedido para corregirlo o pedirlo de nuevo. */
export interface FormularioSolicitud {
  id: string; numero: number; operacion: 'CARGA' | 'DESCARGA'; fechaSolicitada: string; ordenCompra: string | null; observaciones: string | null; editable: boolean;
  destinoId: string | null; telefonoContacto: string | null; tieneAdjunto: boolean; transporte: Record<keyof Transporte, string | null> | null;
  items: { declaracionId: string; sucursalId: string; cantidadEstimada: number; jornada: Jornada | null; especificacionIds: string[] }[];
}
type Linea = { cantidad: string; jornada: Jornada; especificacionIds: string[] };
const transporteVacio: Transporte = { empresaTransportadora: '', tipoVehiculo: '', placa: '', conductorNombre: '', conductorDocumento: '', conductorArlId: '', conductorEpsId: '',
  auxiliarNombre: '', auxiliarDocumento: '', auxiliarArlId: '', auxiliarEpsId: '' };
/** Abre el formulario de pedido al entrar a Solicitudes (desde el acceso rápido del inicio). */
export const pedirAlEntrar = { valor: false as boolean | 'DESCARGA' };

/**
 * Pedir un servicio: recolección en sus sedes o entrega en planta con su propio vehículo, con residuos de una o varias
 * sedes. También corrige un pedido que nadie ha confirmado (modo «editar») o lo repite (modo «repetir»).
 */
export function PedirServicio({ listo, modo = 'nuevo', base, operacionInicial = 'CARGA' }: {
  listo: (numero: number) => void; modo?: 'nuevo' | 'editar' | 'repetir'; base?: FormularioSolicitud; operacionInicial?: 'CARGA' | 'DESCARGA';
}) {
  const toast = useToast();
  const { datos: op, error } = useApi<Opciones>('/portal/solicitudes/opciones');
  const [operacion, setOperacion] = useState<'CARGA' | 'DESCARGA'>(base?.operacion ?? operacionInicial);
  const [sedeId, setSedeId] = useState('');
  const [fecha, setFecha] = useState('');
  const [lineas, setLineas] = useState<Record<string, Linea>>({});
  const [oc, setOc] = useState(base?.ordenCompra ?? '');
  const [obs, setObs] = useState(base?.observaciones ?? '');
  const [destinoId, setDestinoId] = useState(base?.destinoId ?? '');
  const [telefono, setTelefono] = useState(base?.telefonoContacto ?? '');
  const [t, setT] = useState<Transporte>(() => base?.transporte ? Object.fromEntries(Object.entries(base.transporte).map(([k, v]) => [k, v ?? ''])) as unknown as Transporte : transporteVacio);
  const [adjunto, setAdjunto] = useState<{ ref?: string; nombre?: string; existente: boolean; quitar: boolean }>({ existente: modo === 'editar' && !!base?.tieneAdjunto, quitar: false });
  const [subiendo, setSubiendo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    if (!op || fecha) return;
    // Pedido de base (corregir o repetir): sus líneas, que sigan disponibles en sedes que el usuario ve
    if (base) {
      const disponibles = base.items.filter((i) => op.sedes.some((s) => s.id === i.sucursalId && s.declaraciones.some((d) => d.id === i.declaracionId)));
      setLineas(Object.fromEntries(disponibles.map((i) => [`${i.sucursalId}|${i.declaracionId}`, { cantidad: String(i.cantidadEstimada), jornada: i.jornada ?? '', especificacionIds: i.especificacionIds }])));
      if (disponibles.length < base.items.length) toast('Algún residuo del pedido ya no está autorizado o su sede está inactiva: no se incluyó.', 'warn');
      setSedeId(disponibles[0]?.sucursalId ?? op.sedes.find((x) => x.declaraciones.length)?.id ?? op.sedes[0]?.id ?? '');
      setFecha(modo === 'editar' && base.fechaSolicitada >= op.hoy ? base.fechaSolicitada : sumarDias(op.hoy, 1));
    } else {
      const s = op.sedes.find((x) => x.declaraciones.length) ?? op.sedes[0];
      if (s) setSedeId(s.id);
      setFecha(sumarDias(op.hoy, 1));
    }
    if (!destinoId && op.destinos.length === 1) setDestinoId(op.destinos[0].id);
  }, [op, fecha, base, modo, destinoId, toast]);
  if (error) return <p className="rounded-xl bg-bad/10 p-4 text-bad">{error}</p>;
  if (!op || !fecha) return <p className="flex items-center gap-2 text-muted"><Loader2 size={16} className="animate-spin" />Cargando…</p>;
  if (!op.sedes.some((s) => s.declaraciones.length)) return (
    <p className="rounded-xl border border-dashed border-line p-4 text-[13px] text-muted">Aún no tiene residuos o servicios autorizados para pedir. Declárelos en «Declaraciones»: Terra Viva los revisa, fija la tarifa y los autoriza.</p>
  );
  const sede = op.sedes.find((s) => s.id === sedeId);
  const elegidas = Object.entries(lineas);
  const porSede = (id: string) => elegidas.filter(([k]) => k.startsWith(`${id}|`)).length;
  const numero = (v: string) => Number(v.replace(',', '.'));
  const descarga = operacion === 'DESCARGA';
  const transporteListo = !descarga || (!!destinoId && telefono.trim().length >= 7 && t.empresaTransportadora.trim().length >= 2 && /^([A-Z]{3}\d{3}|[A-Z]{3}\d{2}[A-Z]|[RS]\d{5})$/.test(t.placa.trim().toUpperCase())
    && t.conductorNombre.trim().length >= 3 && t.conductorDocumento.trim().length >= 4 && !!t.conductorArlId && !!t.conductorEpsId);
  const listoParaEnviar = !!fecha && fecha >= op.hoy && elegidas.length > 0 && elegidas.every(([, l]) => numero(l.cantidad) > 0) && transporteListo && !subiendo;
  const clave = (sid: string, did: string) => `${sid}|${did}`;
  const alternar = (k: string) => setLineas((x) => { const n = { ...x }; if (n[k]) delete n[k]; else n[k] = { cantidad: '', jornada: '', especificacionIds: [] }; return n; });
  const cambiar = (k: string, c: Partial<Linea>) => setLineas((x) => ({ ...x, [k]: { ...x[k], ...c } }));
  const setTr = (c: Partial<Transporte>) => setT((x) => ({ ...x, ...c }));
  const subir = async (f?: File | null) => {
    if (!f) return;
    setSubiendo(true);
    try { const r = await subirArchivo(f); setAdjunto((a) => ({ ...a, ref: r.ref, nombre: r.nombre, quitar: false })); } catch (e) { toast(msg(e, 'No se pudo subir el archivo.'), 'warn'); }
    setSubiendo(false);
  };
  const enviar = async () => {
    setEnviando(true);
    const cuerpo = {
      operacion, fechaSolicitada: fecha, ordenCompra: oc.trim() || null, observaciones: obs.trim() || null,
      items: elegidas.map(([k, l]) => { const [sucursalId, declaracionId] = k.split('|'); return { declaracionId, sucursalId, cantidadEstimada: numero(l.cantidad), jornada: l.jornada || undefined, especificacionIds: l.especificacionIds }; }),
      ...(adjunto.ref ? { adjunto: adjunto.ref } : adjunto.quitar ? { adjunto: null } : {}),
      ...(descarga ? { destinoId, telefonoContacto: telefono.trim(), transporte: {
        empresaTransportadora: t.empresaTransportadora.trim(), tipoVehiculo: t.tipoVehiculo.trim() || null, placa: t.placa.trim().toUpperCase(), conductorNombre: t.conductorNombre.trim(),
        conductorDocumento: t.conductorDocumento.trim(), conductorArlId: t.conductorArlId, conductorEpsId: t.conductorEpsId, auxiliarNombre: t.auxiliarNombre.trim() || null,
        auxiliarDocumento: t.auxiliarDocumento.trim() || null, auxiliarArlId: t.auxiliarArlId || null, auxiliarEpsId: t.auxiliarEpsId || null,
      } } : {}),
    };
    try {
      const r = modo === 'editar' && base ? await api<{ numero: number }>(`/portal/solicitudes/${base.id}`, { metodo: 'PUT', cuerpo })
        : await api<{ numero: number }>('/portal/solicitudes', { cuerpo });
      toast(modo === 'editar' ? `Solicitud ${r.numero} corregida: sigue por confirmar.` : descarga ? `Entrega en planta ${r.numero} pedida: Terra Viva la confirma y le avisa.`
        : `Solicitud ${r.numero} enviada: Terra Viva la confirma y la programa. Verá el avance en Solicitudes.`);
      listo(r.numero);
    } catch (e) { toast(errorPortal(e, 'No se pudo enviar la solicitud.'), 'warn'); }
    setEnviando(false);
  };
  return (
    <div className="flex flex-col gap-4">
      {modo !== 'editar' && (
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo de servicio">
          {([['CARGA', 'Recolección', 'Terra Viva recoge en sus sedes'], ['DESCARGA', 'Entrega en planta', 'Usted lleva el residuo en su vehículo']] as const).map(([v, titulo, texto]) => (
            <button key={v} type="button" role="radio" aria-checked={operacion === v} onClick={() => setOperacion(v)}
              className={cx('rounded-xl border p-3 text-left text-[13px] transition-colors', operacion === v ? 'border-brand bg-brand-soft/50' : 'border-line hover:border-brand/40')}>
              <span className="flex items-center gap-1.5 font-semibold">{v === 'CARGA' ? <Truck size={15} /> : <Warehouse size={15} />}{titulo}</span>
              <span className="text-muted">{texto}</span>
            </button>
          ))}
        </div>
      )}
      <Field label={descarga ? 'Fecha de la entrega' : 'Fecha deseada'} id="ps-f" hint={fmtFecha(fecha)}><Input id="ps-f" type="date" min={op.hoy} max={sumarDias(op.hoy, 366)} value={fecha} onChange={(e) => setFecha(e.target.value)} /></Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-[12px] font-medium text-muted">{descarga ? 'Qué va a entregar' : 'Qué recoger o prestar'} {elegidas.length > 0 && <span className="text-fg">· {elegidas.length} {elegidas.length === 1 ? 'elegido' : 'elegidos'}</span>}</legend>
        {op.sedes.length > 1 && (
          <Field label={descarga ? 'De qué sede o generador' : 'Sede'} id="ps-s"><Select id="ps-s" value={sedeId} onChange={(e) => setSedeId(e.target.value)}>
            {op.sedes.map((s) => <option key={s.id} value={s.id}>{s.codigo ? `${s.codigo} · ` : ''}{s.nombre}{s.municipio ? ` (${s.municipio})` : ''}{porSede(s.id) ? ` — ${porSede(s.id)} elegido${porSede(s.id) === 1 ? '' : 's'}` : ''}</option>)}
          </Select></Field>
        )}
        {op.sedes.length > 1 && <p className="text-[12px] text-subtle">Puede elegir residuos de varias sedes en el mismo pedido: cambie de sede y siga marcando.</p>}
        {!sede?.declaraciones.length && <p className="text-[13px] text-muted">Esta sede no tiene residuos o servicios autorizados.</p>}
        {sede?.declaraciones.map((d) => {
          const k = clave(sede.id, d.id);
          const l = lineas[k];
          return (
            <div key={k} className={cx('rounded-xl border p-3 text-[13px]', l ? 'border-brand bg-brand-soft/30' : 'border-line')}>
              <label className="flex items-start gap-2.5">
                <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--brand))]" checked={!!l} onChange={() => alternar(k)} />
                <span className="min-w-0"><span className="font-medium">{d.nombre}</span><span className="block text-[12px] text-muted">N.º {d.numero}{d.codigoInterno ? ` · su código ${d.codigoInterno}` : ''} · {d.tipo === 'RESIDUO' ? 'Residuo' : 'Servicio'}</span></span>
              </label>
              {l && (
                <div className="mt-2 flex flex-col gap-2 pl-6">
                  <div className="grid grid-cols-2 gap-2">
                    <Field label={`Cantidad aproximada${d.unidad ? ` (${d.unidad})` : ''}`} id={`ps-c-${k}`}>
                      <Input id={`ps-c-${k}`} inputMode="decimal" value={l.cantidad} onChange={(e) => cambiar(k, { cantidad: e.target.value })} placeholder="0" />
                    </Field>
                    <Field label="Jornada" id={`ps-j-${k}`}>
                      <Select id={`ps-j-${k}`} value={l.jornada} onChange={(e) => cambiar(k, { jornada: e.target.value as Jornada })}>
                        <option value="">Sin preferencia</option><option value="AM">Mañana</option><option value="PM">Tarde</option><option value="DIA">Todo el día</option>
                      </Select>
                    </Field>
                  </div>
                  {op.especificaciones.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {op.especificaciones.map((e) => {
                        const on = l.especificacionIds.includes(e.id);
                        return <button key={e.id} type="button" title={e.descripcion ?? undefined} aria-pressed={on} onClick={() => cambiar(k, { especificacionIds: on ? l.especificacionIds.filter((x) => x !== e.id) : [...l.especificacionIds, e.id] })}
                          className={cx('rounded-full border px-2.5 py-0.5 text-[12px]', on ? 'border-brand bg-brand-soft font-medium text-brand-ink' : 'border-line text-muted')}>{e.nombre}</button>;
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {elegidas.some(([k]) => !k.startsWith(`${sedeId}|`)) && (
          <p className="rounded-lg bg-surface-2 p-2.5 text-[12px] text-muted">También va: {elegidas.filter(([k]) => !k.startsWith(`${sedeId}|`)).map(([k]) => {
            const [sid, did] = k.split('|'); const s = op.sedes.find((x) => x.id === sid); return `${s?.declaraciones.find((x) => x.id === did)?.nombre ?? 'residuo'} (${s?.nombre ?? 'sede'})`;
          }).join(' · ')}</p>
        )}
      </fieldset>

      {descarga && (
        <fieldset className="flex flex-col gap-3 rounded-xl border border-line p-3">
          <legend className="px-1 text-[12px] font-medium text-muted">Entrega en planta: a dónde y en qué vehículo</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Planta de Terra Viva *" id="pd-d"><Select id="pd-d" value={destinoId} onChange={(e) => setDestinoId(e.target.value)}><option value="">Elija…</option>{op.destinos.map((d) => <option key={d.id} value={d.id}>{d.razonSocial}</option>)}</Select></Field>
            <Field label="Teléfono de contacto *" id="pd-tel"><Input id="pd-tel" inputMode="tel" maxLength={20} value={telefono} onChange={(e) => setTelefono(e.target.value)} /></Field>
            <Field label="Empresa transportadora *" id="pd-et"><Input id="pd-et" maxLength={200} value={t.empresaTransportadora} onChange={(e) => setTr({ empresaTransportadora: e.target.value })} placeholder="La suya, si lleva el residuo en su vehículo" /></Field>
            <Field label="Tipo de vehículo" id="pd-tv"><Input id="pd-tv" maxLength={40} value={t.tipoVehiculo} onChange={(e) => setTr({ tipoVehiculo: e.target.value })} placeholder="Camión, volqueta, camioneta…" /></Field>
            <Field label="Placa *" id="pd-pl"><Input id="pd-pl" maxLength={7} value={t.placa} onChange={(e) => setTr({ placa: e.target.value.toUpperCase().replace(/\s/g, '') })} placeholder="ABC123" /></Field>
          </div>
          <p className="text-[12px] font-medium text-muted">Conductor (la planta exige su seguridad social para dejarlo entrar)</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nombre *" id="pd-cn"><Input id="pd-cn" maxLength={150} value={t.conductorNombre} onChange={(e) => setTr({ conductorNombre: e.target.value })} /></Field>
            <Field label="Cédula *" id="pd-cd"><Input id="pd-cd" maxLength={20} value={t.conductorDocumento} onChange={(e) => setTr({ conductorDocumento: e.target.value })} /></Field>
            <Field label="ARL *" id="pd-ca"><Select id="pd-ca" value={t.conductorArlId} onChange={(e) => setTr({ conductorArlId: e.target.value })}><option value="">Elija…</option>{op.arl.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</Select></Field>
            <Field label="EPS *" id="pd-ce"><Select id="pd-ce" value={t.conductorEpsId} onChange={(e) => setTr({ conductorEpsId: e.target.value })}><option value="">Elija…</option>{op.eps.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</Select></Field>
          </div>
          <details className="rounded-lg border border-line px-3 py-2" open={!!t.auxiliarNombre}>
            <summary className="cursor-pointer text-[13px] font-medium">Auxiliar (opcional)</summary>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <Field label="Nombre" id="pd-an"><Input id="pd-an" maxLength={150} value={t.auxiliarNombre} onChange={(e) => setTr({ auxiliarNombre: e.target.value })} /></Field>
              <Field label="Cédula" id="pd-ad"><Input id="pd-ad" maxLength={20} value={t.auxiliarDocumento} onChange={(e) => setTr({ auxiliarDocumento: e.target.value })} /></Field>
              <Field label="ARL" id="pd-aa"><Select id="pd-aa" value={t.auxiliarArlId} onChange={(e) => setTr({ auxiliarArlId: e.target.value })}><option value="">Sin indicar</option>{op.arl.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</Select></Field>
              <Field label="EPS" id="pd-ae"><Select id="pd-ae" value={t.auxiliarEpsId} onChange={(e) => setTr({ auxiliarEpsId: e.target.value })}><option value="">Sin indicar</option>{op.eps.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</Select></Field>
            </div>
          </details>
        </fieldset>
      )}

      <Field label="Orden de compra (opcional)" id="ps-oc"><Input id="ps-oc" value={oc} onChange={(e) => setOc(e.target.value)} maxLength={40} /></Field>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        {adjunto.ref ? <Badge tone="ok"><Paperclip size={11} /> {adjunto.nombre}</Badge> : adjunto.existente && !adjunto.quitar ? <Badge tone="info"><Paperclip size={11} /> PDF adjunto</Badge> : null}
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 hover:bg-surface-2">
          {subiendo ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={14} />}{adjunto.ref || (adjunto.existente && !adjunto.quitar) ? 'Cambiar el PDF' : 'Adjuntar PDF (orden de compra, remisión)'}
          <input type="file" accept=".pdf,application/pdf,.jpg,.jpeg,.png" className="sr-only" onChange={(e) => { subir(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {(adjunto.ref || (adjunto.existente && !adjunto.quitar)) && <Button size="sm" variant="ghost" onClick={() => setAdjunto((a) => ({ ...a, ref: undefined, nombre: undefined, quitar: a.existente }))}><XCircle size={14} /> Quitar</Button>}
      </div>
      <Field label="Observaciones (opcional)" id="ps-o" hint={descarga ? 'Por ejemplo: hora aproximada de llegada.' : 'Por ejemplo: por dónde entrar, a quién preguntar, horario de recibo.'}><textarea id="ps-o" className={areaCls} value={obs} onChange={(e) => setObs(e.target.value)} maxLength={1000} /></Field>
      <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
        <p className="text-[12px] text-subtle">Queda «por confirmar» hasta que Terra Viva la apruebe{descarga ? '' : ' y la programe'}. Mientras tanto la puede corregir o cancelar.</p>
        <Button variant="primary" disabled={!listoParaEnviar || enviando} onClick={enviar}>{enviando ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} {modo === 'editar' ? 'Guardar cambios' : 'Enviar solicitud'}</Button>
      </div>
    </div>
  );
}

// ---------------- Cancelar una solicitud ----------------
/** Cancelar un pedido que Terra Viva aún no ha confirmado ni programado (con el motivo). */
export function CancelarSolicitud({ id, numero, listo }: { id: string; numero: number; listo: () => void }) {
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const cancelar = async () => {
    setOcupado(true);
    try {
      await api(`/portal/solicitudes/${id}/cancelar`, { cuerpo: { motivo: motivo.trim() } });
      toast(`Solicitud ${numero} cancelada.`);
      listo();
    } catch (e) { toast(msg(e, 'No se pudo cancelar.'), 'warn'); }
    setOcupado(false);
  };
  if (!abierto) return <div><Button size="sm" variant="ghost" onClick={() => setAbierto(true)}><XCircle size={14} /> Cancelar esta solicitud</Button></div>;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-bad/30 bg-bad/5 p-3">
      <Field label="¿Por qué la cancela?" id="cs-m"><textarea id="cs-m" className={areaCls} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} placeholder="Por ejemplo: ya no hay residuos para recoger" /></Field>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setAbierto(false)}>Volver</Button>
        <Button size="sm" variant="danger" disabled={motivo.trim().length < 5 || ocupado} onClick={cancelar}>{ocupado && <Loader2 size={14} className="animate-spin" />}Cancelar la solicitud</Button>
      </div>
    </div>
  );
}
