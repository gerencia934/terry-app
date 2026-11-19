// Datos de la empresa para los documentos: firma y certificaciones del certificado, nota de calibración de la báscula,
// numeración (TV / PSAP, para continuar la serie del sistema anterior) y textos legales del certificado con versiones.
import { useEffect, useState } from 'react';
import { History, Plus, Save, Trash2, X } from 'lucide-react';
import { Badge, Button, Card, Field, Input, PageHeader, Select, useToast } from '../../components/ui';
import { api, tienePermiso } from '../../lib/api';
import { cx, fmtFecha } from '../../lib/format';
import { msg, useApi } from '../../lib/servidor';

interface Certificacion { norma: string; numero: string; entidad?: string; vence?: string }
interface Bascula { identificacion?: string; certificado?: string; fecha?: string; laboratorio?: string; vigenteHasta?: string }
interface Config { ciudadFirma?: string; representanteLegal?: string; cargoFirmante?: string; notaBascula?: string; certificaciones?: Certificacion[]; bascula?: Bascula }
interface Consecutivo { documento: 'MANIFIESTO' | 'ACTA' | 'INSPECCION'; prefijo: string; digitos: number; reinicioAnual: boolean; ultimo: number; siguiente: string }
interface DatosEmpresa { razonSocial: string; nit: string; configuracion: Config; consecutivos: Consecutivo[] }
interface Texto { id: string; codigo: string; version: number; titulo: string; texto: string; disposiciones: string[]; orden: number; revisado: boolean; vigenteDesde: string }
interface GrupoTexto { codigo: string; vigente: Texto | null; historial: { id: string; version: number; vigenteDesde: string; activo: boolean; revisado: boolean; creadoPor: { nombre: string } | null }[] }
const DOCUMENTO = { MANIFIESTO: 'Manifiestos (y recibos)', ACTA: 'Certificados', INSPECCION: 'Inspecciones vehiculares' };
const area = 'min-h-[120px] w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';

export function EmpresaServidor() {
  const toast = useToast();
  const d = useApi<DatosEmpresa>('/empresa');
  const textos = useApi<GrupoTexto[]>('/empresa/textos-legales');
  const disp = useApi<{ disposiciones: { codigo: string; nombre: string }[] }>('/declaraciones/catalogos');
  const edita = tienePermiso('configuracion.editar');
  const [c, setC] = useState<Config>({});
  const [num, setNum] = useState<Record<string, Consecutivo>>({});
  const [editando, setEditando] = useState<(Partial<Texto> & { nuevo?: boolean }) | null>(null);
  const [historial, setHistorial] = useState<string | null>(null);
  useEffect(() => { if (d.datos) { setC(d.datos.configuracion ?? {}); setNum(Object.fromEntries(d.datos.consecutivos.map((x) => [x.documento, x]))); } }, [d.datos]);

  const guardarConfig = async () => {
    try { d.setDatos(await api<DatosEmpresa>('/empresa/configuracion', { metodo: 'PATCH', cuerpo: { ...c, certificaciones: (c.certificaciones ?? []).filter((x) => x.norma.trim()) } })); toast('Datos del certificado guardados.'); }
    catch (e) { toast(msg(e), 'warn'); }
  };
  const guardarConsecutivo = async (doc: string) => {
    const x = num[doc]; const orig = d.datos?.consecutivos.find((y) => y.documento === doc);
    try {
      d.setDatos(await api<DatosEmpresa>(`/empresa/consecutivos/${doc}`, { metodo: 'PATCH', cuerpo: { prefijo: x.prefijo, digitos: Number(x.digitos), reinicioAnual: x.reinicioAnual, ...(orig && Number(x.ultimo) !== orig.ultimo ? { ultimo: Number(x.ultimo) } : {}) } }));
      toast('Numeración guardada.');
    } catch (e) { toast(msg(e), 'warn'); }
  };
  const guardarTexto = async () => {
    if (!editando) return;
    const cuerpo = { titulo: editando.titulo, texto: editando.texto, disposiciones: editando.disposiciones ?? [], orden: Number(editando.orden ?? 0), revisado: !!editando.revisado };
    try {
      if (editando.nuevo) await api('/empresa/textos-legales', { cuerpo: { ...cuerpo, codigo: editando.codigo } });
      else await api(`/empresa/textos-legales/${editando.codigo}`, { metodo: 'PUT', cuerpo });
      toast(editando.nuevo ? 'Texto agregado.' : 'Nueva versión guardada; la anterior queda en el historial.'); setEditando(null); textos.recargar();
    } catch (e) { toast(msg(e), 'warn'); }
  };
  const retirar = async (codigo: string) => {
    try { await api(`/empresa/textos-legales/${codigo}/retirar`, { metodo: 'PATCH', cuerpo: {} }); toast('Texto retirado de los certificados nuevos.'); textos.recargar(); }
    catch (e) { toast(msg(e), 'warn'); }
  };
  const sinRevisar = (textos.datos ?? []).filter((t) => t.vigente && !t.vigente.revisado).length;

  return (
    <>
      <PageHeader eyebrow="Ajustes" title="Datos de la empresa" subtitle={d.datos ? `${d.datos.razonSocial} · NIT ${d.datos.nit}. Lo que sale en certificados, manifiestos y recibos.` : 'Lo que sale en certificados, manifiestos y recibos.'} />
      {d.error && <p className="mb-3 rounded-xl bg-bad/10 p-3 text-bad">{d.error}</p>}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Firma del certificado y certificaciones" action={edita && <Button size="sm" variant="primary" onClick={guardarConfig}><Save size={14} /> Guardar</Button>}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Ciudad de firma" id="em-ci" hint="Sale en «Lugar y fecha»"><Input id="em-ci" disabled={!edita} value={c.ciudadFirma ?? ''} onChange={(e) => setC((s) => ({ ...s, ciudadFirma: e.target.value }))} /></Field>
            <Field label="Representante legal" id="em-rl"><Input id="em-rl" disabled={!edita} value={c.representanteLegal ?? ''} onChange={(e) => setC((s) => ({ ...s, representanteLegal: e.target.value }))} /></Field>
            <Field label="Cargo de quien firma" id="em-ca"><Input id="em-ca" disabled={!edita} value={c.cargoFirmante ?? ''} onChange={(e) => setC((s) => ({ ...s, cargoFirmante: e.target.value }))} /></Field>
          </div>
          <p className="mb-2 mt-4 text-[13px] font-semibold">Certificaciones del sistema de gestión <span className="font-normal text-muted">(solo salen las que tienen número y no han vencido)</span></p>
          <div className="flex flex-col gap-2">
            {(c.certificaciones ?? []).map((x, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1.2fr_1fr_0.9fr_0.9fr_auto]">
                <Input aria-label="Norma" disabled={!edita} value={x.norma} onChange={(e) => setC((s) => ({ ...s, certificaciones: (s.certificaciones ?? []).map((y, j) => (j === i ? { ...y, norma: e.target.value } : y)) }))} />
                <Input aria-label="Número del certificado" disabled={!edita} placeholder="Número del certificado" value={x.numero} onChange={(e) => setC((s) => ({ ...s, certificaciones: (s.certificaciones ?? []).map((y, j) => (j === i ? { ...y, numero: e.target.value } : y)) }))} />
                <Input aria-label="Entidad certificadora" disabled={!edita} placeholder="Entidad (ICONTEC…)" value={x.entidad ?? ''} onChange={(e) => setC((s) => ({ ...s, certificaciones: (s.certificaciones ?? []).map((y, j) => (j === i ? { ...y, entidad: e.target.value } : y)) }))} />
                <Input aria-label="Vence" type="date" disabled={!edita} value={x.vence ?? ''} onChange={(e) => setC((s) => ({ ...s, certificaciones: (s.certificaciones ?? []).map((y, j) => (j === i ? { ...y, vence: e.target.value } : y)) }))} />
                {edita && <Button size="sm" variant="ghost" aria-label="Quitar la certificación" onClick={() => setC((s) => ({ ...s, certificaciones: (s.certificaciones ?? []).filter((_, j) => j !== i) }))}><Trash2 size={14} /></Button>}
              </div>
            ))}
            {edita && <Button size="sm" className="self-start" onClick={() => setC((s) => ({ ...s, certificaciones: [...(s.certificaciones ?? []), { norma: '', numero: '', entidad: '', vence: '' }] }))}><Plus size={14} /> Certificación</Button>}
          </div>
          <p className="mb-2 mt-4 text-[13px] font-semibold">Calibración de la báscula <span className="font-normal text-muted">(sale en el recibo; si está vencida, el recibo sale con alerta para que HSEQ revise el pesaje)</span></p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {([['identificacion', 'Báscula (identificación)', 'text'], ['certificado', 'N.° del certificado de calibración', 'text'], ['fecha', 'Fecha del certificado', 'date'], ['laboratorio', 'Laboratorio que lo expidió', 'text'], ['vigenteHasta', 'Vigente hasta', 'date']] as const).map(([k, etiqueta, tipo]) => (
              <Field key={k} label={etiqueta} id={`em-b-${k}`}><Input id={`em-b-${k}`} type={tipo} disabled={!edita} value={c.bascula?.[k] ?? ''} onChange={(e) => setC((s) => ({ ...s, bascula: { ...s.bascula, [k]: e.target.value } }))} /></Field>
            ))}
          </div>
          {!c.bascula?.certificado?.trim() && <Field label="Nota libre del recibo (mientras no registre la calibración)" id="em-nb"><Input id="em-nb" disabled={!edita} value={c.notaBascula ?? ''} onChange={(e) => setC((s) => ({ ...s, notaBascula: e.target.value }))} /></Field>}
          {!c.ciudadFirma && <p className="mt-3 rounded-lg bg-warn/10 px-3 py-2 text-[13px] text-warn">Complete la ciudad de firma: el certificado la necesita en «Lugar y fecha».</p>}
        </Card>

        <Card title="Numeración de documentos">
          <p className="mb-3 text-[13px] text-muted">Para continuar la numeración del sistema anterior, escriba en «Último número» el último que se usó allá (por ejemplo, 1830 para seguir en TV1831). El último número solo puede subir.</p>
          <div className="flex flex-col gap-3">
            {d.datos?.consecutivos.map((o) => {
              const x = num[o.documento] ?? o; const cambio = (k: keyof Consecutivo, v: unknown) => setNum((s) => ({ ...s, [o.documento]: { ...x, [k]: v } }));
              return (
                <div key={o.documento} className="rounded-xl border border-line p-3">
                  <div className="mb-2 flex items-center justify-between gap-2"><span className="font-medium">{DOCUMENTO[o.documento]}</span><span className="text-[13px] text-muted">Siguiente: <b className="num text-fg">{o.siguiente}</b></span></div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Field label="Prefijo" id={`co-p-${o.documento}`}><Input id={`co-p-${o.documento}`} disabled={!edita} value={x.prefijo} onChange={(e) => cambio('prefijo', e.target.value.toUpperCase())} /></Field>
                    <Field label="Dígitos" id={`co-d-${o.documento}`}><Input id={`co-d-${o.documento}`} type="number" min={0} max={8} disabled={!edita} value={x.digitos} onChange={(e) => cambio('digitos', e.target.value)} /></Field>
                    <Field label="Reinicia cada año" id={`co-r-${o.documento}`}><Select id={`co-r-${o.documento}`} disabled={!edita} value={x.reinicioAnual ? 'si' : 'no'} onChange={(e) => cambio('reinicioAnual', e.target.value === 'si')}><option value="si">Sí (lleva el año)</option><option value="no">No</option></Select></Field>
                    <Field label="Último número" id={`co-u-${o.documento}`}><Input id={`co-u-${o.documento}`} type="number" min={o.ultimo} disabled={!edita} value={x.ultimo} onChange={(e) => cambio('ultimo', e.target.value)} /></Field>
                  </div>
                  {edita && <Button size="sm" className="mt-2" onClick={() => guardarConsecutivo(o.documento)}><Save size={14} /> Guardar</Button>}
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="mt-4">
        <Card title="Textos legales del certificado" action={edita && !editando && <Button size="sm" onClick={() => setEditando({ nuevo: true, codigo: '', titulo: '', texto: '', disposiciones: [], orden: 20, revisado: false })}><Plus size={14} /> Texto nuevo</Button>}>
          <p className="mb-3 text-[13px] text-muted">Cada párrafo sale solo si el certificado tiene residuos con alguna de sus disposiciones (sin disposiciones: sale siempre). Editar crea una versión nueva; cada certificado guarda la versión que usó.</p>
          {sinRevisar > 0 && <p className="mb-3 rounded-lg bg-warn/10 px-3 py-2 text-[13px] text-warn">{sinRevisar} {sinRevisar === 1 ? 'texto es inicial' : 'textos son iniciales'}: revíselos con el área jurídica, o reemplácelos por el texto propio de Terra Viva, antes de emitir certificados reales.</p>}
          {editando && (
            <div className="mb-4 flex flex-col gap-3 rounded-xl border border-brand/40 bg-brand-soft/20 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[160px_1fr_90px]">
                <Field label="Código" id="tl-c"><Input id="tl-c" disabled={!editando.nuevo} value={editando.codigo ?? ''} onChange={(e) => setEditando((s) => ({ ...s, codigo: e.target.value.toUpperCase() }))} /></Field>
                <Field label="Título" id="tl-t"><Input id="tl-t" value={editando.titulo ?? ''} onChange={(e) => setEditando((s) => ({ ...s, titulo: e.target.value }))} /></Field>
                <Field label="Orden" id="tl-o"><Input id="tl-o" type="number" min={0} max={100} value={editando.orden ?? 0} onChange={(e) => setEditando((s) => ({ ...s, orden: Number(e.target.value) }))} /></Field>
              </div>
              <label className="flex flex-col gap-1.5"><span className="text-[12px] font-medium text-muted">Texto</span><textarea className={area} value={editando.texto ?? ''} onChange={(e) => setEditando((s) => ({ ...s, texto: e.target.value }))} /></label>
              <div>
                <p className="mb-1.5 text-[12px] font-medium text-muted">Sale cuando el certificado tiene estas disposiciones (ninguna = siempre)</p>
                <div className="flex flex-wrap gap-1.5">
                  {disp.datos?.disposiciones.map((x) => {
                    const on = editando.disposiciones?.includes(x.codigo);
                    return <button key={x.codigo} type="button" title={x.nombre} onClick={() => setEditando((s) => ({ ...s, disposiciones: on ? (s?.disposiciones ?? []).filter((y) => y !== x.codigo) : [...(s?.disposiciones ?? []), x.codigo] }))}
                      className={cx('rounded-full px-2.5 py-1 text-[12px] ring-1 ring-inset', on ? 'bg-brand text-on-brand ring-brand' : 'bg-surface text-muted ring-line hover:text-fg')}>{x.codigo}</button>;
                  })}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--brand))]" checked={!!editando.revisado} onChange={(e) => setEditando((s) => ({ ...s, revisado: e.target.checked }))} />Revisado por el área jurídica</label>
              <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setEditando(null)}><X size={14} /> Cancelar</Button><Button size="sm" variant="primary" onClick={guardarTexto}><Save size={14} /> {editando.nuevo ? 'Agregar' : 'Guardar versión'}</Button></div>
            </div>
          )}
          <div className="flex flex-col gap-2">
            {textos.datos?.map((g) => (
              <div key={g.codigo} className={cx('rounded-xl border p-3', g.vigente ? 'border-line' : 'border-dashed border-line opacity-70')}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{g.vigente?.titulo ?? g.codigo} <span className="num text-[12px] text-muted">{g.codigo} · v{g.vigente?.version ?? g.historial[0]?.version}</span></p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {!g.vigente ? <Badge>Retirado</Badge> : g.vigente.disposiciones.length ? g.vigente.disposiciones.map((x) => <Badge key={x}>{x}</Badge>) : <Badge tone="info">Siempre</Badge>}
                      {g.vigente && !g.vigente.revisado && <Badge tone="warn">Por revisar</Badge>}
                    </div>
                  </div>
                  <span className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setHistorial(historial === g.codigo ? null : g.codigo)}><History size={14} /> {g.historial.length}</Button>
                    {edita && g.vigente && <Button size="sm" variant="ghost" onClick={() => setEditando({ ...g.vigente! })}>Editar</Button>}
                    {edita && g.vigente && <Button size="sm" variant="ghost" onClick={() => retirar(g.codigo)}>Retirar</Button>}
                  </span>
                </div>
                {g.vigente && <p className="mt-2 text-[13px] text-muted">{g.vigente.texto}</p>}
                {historial === g.codigo && (
                  <ul className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-[12px]">
                    {g.historial.map((h) => <li key={h.id}>v{h.version} · desde {fmtFecha(h.vigenteDesde)}{h.creadoPor ? ` · ${h.creadoPor.nombre}` : ' · texto inicial'}{h.activo ? ' · vigente' : ''}{h.revisado ? ' · revisado' : ''}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
