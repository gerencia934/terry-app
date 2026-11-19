// Portal de clientes: lo que escribe el cliente (solo el perfil Administrador). Cargar sus declaraciones (quedan en
// revisión: Terra Viva fija la tarifa y las autoriza), pedir servicios (quedan «por confirmar») y cancelar los pedidos
// que nadie ha confirmado. El servidor y la base de datos vuelven a exigir todo esto.
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, MapPin, Send, Upload, XCircle } from 'lucide-react';
import { construirPlantilla, construirPlantillaCsv, plantillaPortal, type FilaValidada } from '@terraviva/shared';
import { Badge, Button, Field, Input, Select, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { msg, sumarDias, useApi } from '../../lib/servidor';
import { cx, fmtFecha } from '../../lib/format';
import { usePortal } from './PortalApp';

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
interface Opciones {
  hoy: string;
  sedes: { id: string; codigo: string | null; nombre: string; municipio: string | null;
    declaraciones: { id: string; numero: number; nombre: string; codigoInterno: string | null; tipo: 'RESIDUO' | 'SERVICIO'; unidad: string | null }[] }[];
}
type Jornada = '' | 'AM' | 'PM' | 'DIA';
/** Abre el formulario de pedido al entrar a Solicitudes (desde el acceso rápido del inicio). */
export const pedirAlEntrar = { valor: false };

export function PedirServicio({ listo }: { listo: (numero: number) => void }) {
  const toast = useToast();
  const { datos: op, error } = useApi<Opciones>('/portal/solicitudes/opciones');
  const [sedeId, setSedeId] = useState('');
  const [fecha, setFecha] = useState('');
  const [lineas, setLineas] = useState<Record<string, { cantidad: string; jornada: Jornada }>>({});
  const [oc, setOc] = useState('');
  const [obs, setObs] = useState('');
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    if (!op || sedeId) return;
    const s = op.sedes.find((x) => x.declaraciones.length) ?? op.sedes[0];
    if (s) setSedeId(s.id);
    setFecha(sumarDias(op.hoy, 1));
  }, [op, sedeId]);
  if (error) return <p className="rounded-xl bg-bad/10 p-4 text-bad">{error}</p>;
  if (!op) return <p className="flex items-center gap-2 text-muted"><Loader2 size={16} className="animate-spin" />Cargando…</p>;
  if (!op.sedes.some((s) => s.declaraciones.length)) return (
    <p className="rounded-xl border border-dashed border-line p-4 text-[13px] text-muted">Aún no tiene residuos o servicios autorizados para pedir. Cárguelos en «Declaraciones»: Terra Viva los revisa, fija la tarifa y los autoriza.</p>
  );
  const sede = op.sedes.find((s) => s.id === sedeId);
  const elegidas = Object.entries(lineas).filter(([id]) => sede?.declaraciones.some((d) => d.id === id));
  const numero = (v: string) => Number(v.replace(',', '.'));
  const listoParaEnviar = !!sede && !!fecha && fecha >= op.hoy && elegidas.length > 0 && elegidas.every(([, l]) => numero(l.cantidad) > 0);
  const alternar = (id: string) => setLineas((x) => { const n = { ...x }; if (n[id]) delete n[id]; else n[id] = { cantidad: '', jornada: '' }; return n; });
  const cambiar = (id: string, k: 'cantidad' | 'jornada', v: string) => setLineas((x) => ({ ...x, [id]: { ...x[id], [k]: v } as { cantidad: string; jornada: Jornada } }));
  const enviar = async () => {
    if (!sede) return;
    setEnviando(true);
    try {
      const r = await api<{ numero: number }>('/portal/solicitudes', { cuerpo: {
        sucursalId: sede.id, fechaSolicitada: fecha, ordenCompra: oc.trim() || undefined, observaciones: obs.trim() || undefined,
        items: elegidas.map(([id, l]) => ({ declaracionId: id, cantidadEstimada: numero(l.cantidad), jornada: l.jornada || undefined })),
      } });
      toast(`Solicitud ${r.numero} enviada: Terra Viva la confirma y la programa. Verá el avance en Solicitudes.`);
      listo(r.numero);
    } catch (e) { toast(msg(e, 'No se pudo enviar la solicitud.'), 'warn'); }
    setEnviando(false);
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Sede" id="ps-s"><Select id="ps-s" value={sedeId} onChange={(e) => { setSedeId(e.target.value); setLineas({}); }}>
          {op.sedes.map((s) => <option key={s.id} value={s.id}>{s.codigo ? `${s.codigo} · ` : ''}{s.nombre}{s.municipio ? ` (${s.municipio})` : ''}</option>)}
        </Select></Field>
        <Field label="Fecha deseada" id="ps-f" hint={fecha ? fmtFecha(fecha) : undefined}><Input id="ps-f" type="date" min={op.hoy} max={sumarDias(op.hoy, 366)} value={fecha} onChange={(e) => setFecha(e.target.value)} /></Field>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-[12px] font-medium text-muted">Qué recoger o prestar</legend>
        {!sede?.declaraciones.length && <p className="text-[13px] text-muted">Esta sede no tiene residuos o servicios autorizados.</p>}
        {sede?.declaraciones.map((d) => {
          const l = lineas[d.id];
          return (
            <div key={d.id} className={cx('rounded-xl border p-3 text-[13px]', l ? 'border-brand bg-brand-soft/30' : 'border-line')}>
              <label className="flex items-start gap-2.5">
                <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--brand))]" checked={!!l} onChange={() => alternar(d.id)} />
                <span className="min-w-0"><span className="font-medium">{d.nombre}</span><span className="block text-[12px] text-muted">N.º {d.numero}{d.codigoInterno ? ` · su código ${d.codigoInterno}` : ''} · {d.tipo === 'RESIDUO' ? 'Residuo' : 'Servicio'}</span></span>
              </label>
              {l && (
                <div className="mt-2 grid grid-cols-2 gap-2 pl-6">
                  <Field label={`Cantidad aproximada${d.unidad ? ` (${d.unidad})` : ''}`} id={`ps-c-${d.id}`}>
                    <Input id={`ps-c-${d.id}`} inputMode="decimal" value={l.cantidad} onChange={(e) => cambiar(d.id, 'cantidad', e.target.value)} placeholder="0" />
                  </Field>
                  <Field label="Jornada" id={`ps-j-${d.id}`}>
                    <Select id={`ps-j-${d.id}`} value={l.jornada} onChange={(e) => cambiar(d.id, 'jornada', e.target.value)}>
                      <option value="">Sin preferencia</option><option value="AM">Mañana</option><option value="PM">Tarde</option><option value="DIA">Todo el día</option>
                    </Select>
                  </Field>
                </div>
              )}
            </div>
          );
        })}
      </fieldset>
      <Field label="Orden de compra (opcional)" id="ps-oc"><Input id="ps-oc" value={oc} onChange={(e) => setOc(e.target.value)} maxLength={40} /></Field>
      <Field label="Observaciones (opcional)" id="ps-o" hint="Por ejemplo: por dónde entrar, a quién preguntar, horario de recibo."><textarea id="ps-o" className={areaCls} value={obs} onChange={(e) => setObs(e.target.value)} maxLength={1000} /></Field>
      <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
        <p className="text-[12px] text-subtle">Queda «por confirmar» hasta que Terra Viva la apruebe y la programe.</p>
        <Button variant="primary" disabled={!listoParaEnviar || enviando} onClick={enviar}>{enviando ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Enviar solicitud</Button>
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
