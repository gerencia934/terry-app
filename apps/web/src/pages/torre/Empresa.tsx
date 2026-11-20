// Datos de la empresa para los documentos: firma y certificaciones del certificado, nota de calibración de la báscula,
// numeración (TV / PSAP, para continuar la serie del sistema anterior) y textos legales del certificado con versiones.
import { useEffect, useState } from 'react';
import { History, Mail, Plus, Satellite, Save, Send, ShieldCheck, Trash2, X } from 'lucide-react';
import { Badge, Button, Card, Field, Input, PageHeader, Select, useToast } from '../../components/ui';
import { api, tienePermiso } from '../../lib/api';
import { cx, fmtFecha } from '../../lib/format';
import { msg, useApi } from '../../lib/servidor';
import { enlaceMapa, hace, type EstadoGps } from '../../components/gps';

interface Certificacion { norma: string; numero: string; entidad?: string; vence?: string }
interface Bascula { identificacion?: string; certificado?: string; fecha?: string; laboratorio?: string; vigenteHasta?: string }
interface Config {
  ciudadFirma?: string; representanteLegal?: string; cargoFirmante?: string; notaBascula?: string; certificaciones?: Certificacion[]; bascula?: Bascula;
  /** Dirección, municipio, teléfono y correo que salen al pie del certificado y en la constancia de RCD. */
  contacto?: { direccion?: string; municipio?: string; telefono?: string; correo?: string };
  /** Número único de gestor de RCD que asignó la autoridad ambiental (Anexo II de la Res. 1257 de 2021). */
  rcd?: { numeroGestor?: string };
  /** Exigir la verificación en dos pasos a todo el personal (en producción se exige siempre). */
  dobleFactorObligatorio?: boolean;
  /** Portal: los certificados con facturas vencidas y sin pagar se descargan al registrar el pago (sí, si falta). */
  cartera?: { retenerCertificados?: boolean; diasGracia?: number };
  /** Certificado comercial: cargo con que firma el representante legal (por omisión, Gerente General) y correo bajo la firma. */
  certificadoComercial?: { cargo?: string; correo?: string };
  /** Correo diario de alertas por rol: si va (sí, si falta) y a qué hora (7:00, si falta). */
  resumenDiario?: { activo?: boolean; hora?: number };
  /** GPS (Wialon): ubicación de la planta y reglas de las geocercas y alertas. */
  gps?: { plantaLatitud?: number | null; plantaLongitud?: number | null; radioPlantaM?: number; radioSedeM?: number; minutosParada?: number; kmDesvio?: number };
}
interface Consecutivo { documento: 'MANIFIESTO' | 'ACTA' | 'INSPECCION' | 'CERT_COMERCIAL'; prefijo: string; digitos: number; reinicioAnual: boolean; ultimo: number; siguiente: string }
interface DatosEmpresa { razonSocial: string; nit: string; configuracion: Config; consecutivos: Consecutivo[] }
interface Texto { id: string; codigo: string; version: number; titulo: string; texto: string; disposiciones: string[]; orden: number; revisado: boolean; vigenteDesde: string }
interface GrupoTexto { codigo: string; vigente: Texto | null; historial: { id: string; version: number; vigenteDesde: string; activo: boolean; revisado: boolean; creadoPor: { nombre: string } | null }[] }
const DOCUMENTO = { MANIFIESTO: 'Manifiestos (y recibos)', ACTA: 'Certificados', INSPECCION: 'Inspecciones vehiculares', CERT_COMERCIAL: 'Certificados comerciales' };
const area = 'min-h-[120px] w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';

/** Correo diario de alertas: a cada persona de la oficina, las de su rol (Cumplimiento a HSEQ, Flota a Logística, Facturación a Comercial y Facturación…). */
function ResumenDiarioCard({ c, setC, edita, guardar }: { c: Config; setC: (f: (s: Config) => Config) => void; edita: boolean; guardar: () => Promise<void> }) {
  const toast = useToast();
  const [enviando, setEnviando] = useState(false);
  const r = c.resumenDiario ?? {};
  const enviarAhora = async () => {
    setEnviando(true);
    try {
      const x = await api<{ enviados: number }>('/alertas/resumen-diario', { cuerpo: {} });
      toast(x.enviados ? `Resumen enviado a ${x.enviados} ${x.enviados === 1 ? 'persona' : 'personas'}.` : 'Hoy nadie tiene alertas: no se envió ningún correo.', 'ok');
    } catch (e) { toast(msg(e), 'warn'); }
    setEnviando(false);
  };
  return (
    <Card title="Correo diario de alertas" action={edita && <Button size="sm" variant="primary" onClick={() => void guardar()}><Save size={14} /> Guardar</Button>}>
      <p className="mb-3 flex items-start gap-2 text-[13px] text-muted"><Mail size={16} className="mt-0.5 shrink-0 text-brand" />
        Cada mañana, a cada persona de la oficina le llegan las alertas de su rol: vencimientos de permisos a HSEQ, flota y conductores a Logística, manifiestos sin facturar a Comercial y Facturación, y seguridad al administrador. Si un día no tiene alertas, no le llega nada.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex items-start gap-2 rounded-lg border border-line p-3 text-[13px]">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--brand))]" disabled={!edita} checked={r.activo !== false} onChange={(e) => setC((s) => ({ ...s, resumenDiario: { ...s.resumenDiario, activo: e.target.checked } }))} />
          <span><span className="font-medium">Enviar el correo diario</span><span className="block text-muted">Recomendado.</span></span>
        </label>
        <Field label="Hora de envío (Colombia)" id="em-rd-h">
          <Select id="em-rd-h" disabled={!edita || r.activo === false} value={String(r.hora ?? 7)} onChange={(e) => setC((s) => ({ ...s, resumenDiario: { ...s.resumenDiario, hora: Number(e.target.value) } }))}>
            {Array.from({ length: 13 }, (_, i) => i + 5).map((h) => <option key={h} value={h}>{h <= 12 ? `${h}:00 a. m.` : `${h - 12}:00 p. m.`}</option>)}
          </Select>
        </Field>
      </div>
      {edita && <Button size="sm" className="mt-3" disabled={enviando} onClick={enviarAhora}><Send size={14} /> Enviar el resumen de hoy ahora</Button>}
    </Card>
  );
}

/** GPS de la flota (Wialon): ubicación de la planta (marca salidas y llegadas) y reglas de las geocercas y alertas. Guarda solo esta parte. */
function GpsCard({ c, setC, edita }: { c: Config; setC: (f: (s: Config) => Config) => void; edita: boolean }) {
  const toast = useToast();
  const estado = useApi<EstadoGps>(tienePermiso('rutas.programar') ? '/gps/estado' : null);
  const desde = (g: Config['gps']) => ({
    lat: g?.plantaLatitud != null ? String(g.plantaLatitud) : '', lng: g?.plantaLongitud != null ? String(g.plantaLongitud) : '',
    radioPlantaM: String(g?.radioPlantaM ?? 400), radioSedeM: String(g?.radioSedeM ?? 200), minutosParada: String(g?.minutosParada ?? 15), kmDesvio: String(g?.kmDesvio ?? 5),
  });
  const [f, setF] = useState(() => desde(c.gps));
  useEffect(() => { setF(desde(c.gps)); }, [c.gps]);
  const n = (x: string) => Number(x.trim().replace(',', '.'));
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const guardar = async () => {
    const lat = f.lat.trim() ? n(f.lat) : null, lng = f.lng.trim() ? n(f.lng) : null;
    if ((lat === null) !== (lng === null)) { toast('Escriba la latitud y la longitud de la planta, o deje las dos vacías.', 'warn'); return; }
    if (lat !== null && lng !== null && !(lat >= -5 && lat <= 15 && lng >= -82 && lng <= -66)) { toast('Esa ubicación no queda en Colombia: revise la latitud y la longitud (la longitud es negativa).', 'warn'); return; }
    const gps = { plantaLatitud: lat, plantaLongitud: lng, radioPlantaM: Math.round(n(f.radioPlantaM)), radioSedeM: Math.round(n(f.radioSedeM)), minutosParada: Math.round(n(f.minutosParada)), kmDesvio: n(f.kmDesvio) };
    const fuera = [[gps.radioPlantaM, 50, 5000, 'El radio de la planta va de 50 a 5.000 m'], [gps.radioSedeM, 50, 2000, 'El radio de las sedes va de 50 a 2.000 m'],
      [gps.minutosParada, 5, 240, 'La parada no programada va de 5 a 240 minutos'], [gps.kmDesvio, 1, 100, 'El desvío va de 1 a 100 km']].find(([v, a, b]) => !((v as number) >= (a as number) && (v as number) <= (b as number)));
    if (fuera) { toast(`${fuera[3]}.`, 'warn'); return; }
    try { await api('/empresa/configuracion', { metodo: 'PATCH', cuerpo: { gps } }); setC((s) => ({ ...s, gps })); toast('Ajustes del GPS guardados.', 'ok'); }
    catch (e) { toast(msg(e), 'warn'); }
  };
  const conPosicion = (estado.datos?.vehiculos ?? []).filter((v) => v.posicion);
  return (
    <Card title="GPS de la flota (Wialon)" action={edita && <Button size="sm" variant="primary" onClick={() => void guardar()}><Save size={14} /> Guardar</Button>}>
      <p className="mb-3 flex items-start gap-2 text-[13px] text-muted"><Satellite size={16} className="mt-0.5 shrink-0 text-brand" />
        Con la ubicación de la planta, el GPS marca la salida y la llegada de cada ruta; la llegada y la salida de cada parada salen de la ubicación de la sede (en Clientes). Las paradas no programadas con RESPEL y los desvíos llegan como alertas a Logística.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Latitud de la planta" id="gps-lat" hint="Por ejemplo 7,3466"><Input id="gps-lat" inputMode="decimal" disabled={!edita} value={f.lat} onChange={set('lat')} /></Field>
        <Field label="Longitud de la planta" id="gps-lng" hint="Por ejemplo -73,8986 (en Colombia es negativa)"><Input id="gps-lng" inputMode="decimal" disabled={!edita} value={f.lng} onChange={set('lng')} /></Field>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]">
        {edita && conPosicion.length > 0 && (
          <label className="flex flex-wrap items-center gap-2"><span className="text-muted">O tome la posición de un vehículo que esté en la planta:</span>
            <Select className="w-auto" value="" onChange={(e) => { const v = conPosicion.find((x) => x.id === e.target.value); if (v?.posicion) setF((s) => ({ ...s, lat: v.posicion!.lat.toFixed(6), lng: v.posicion!.lng.toFixed(6) })); }}>
              <option value="">Elegir vehículo…</option>
              {conPosicion.map((v) => <option key={v.id} value={v.id}>{v.placa} ({hace(v.posicion!.posicionEn)})</option>)}
            </Select></label>
        )}
        {f.lat.trim() && f.lng.trim() && Number.isFinite(n(f.lat)) && Number.isFinite(n(f.lng)) && <a className="text-brand underline" target="_blank" rel="noreferrer" href={enlaceMapa(n(f.lat), n(f.lng))}>Ver la ubicación en el mapa</a>}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Field label="Radio de la planta (m)" id="gps-rp"><Input id="gps-rp" inputMode="numeric" disabled={!edita} value={f.radioPlantaM} onChange={set('radioPlantaM')} /></Field>
        <Field label="Radio de cada sede (m)" id="gps-rs"><Input id="gps-rs" inputMode="numeric" disabled={!edita} value={f.radioSedeM} onChange={set('radioSedeM')} /></Field>
        <Field label="Parada no programada (min)" id="gps-mp" hint="Quieto fuera de ruta con RESPEL"><Input id="gps-mp" inputMode="numeric" disabled={!edita} value={f.minutosParada} onChange={set('minutosParada')} /></Field>
        <Field label="Desvío (km)" id="gps-kd" hint="Lejos del trayecto planta → paradas"><Input id="gps-kd" inputMode="decimal" disabled={!edita} value={f.kmDesvio} onChange={set('kmDesvio')} /></Field>
      </div>
    </Card>
  );
}

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
  // Solo esta clave (el servidor la mezcla con el resto) y sin recargar el formulario: no se pierde lo que esté editando arriba
  const [guardando2fa, setGuardando2fa] = useState(false);
  const exigir2fa = async (valor: boolean) => {
    setGuardando2fa(true);
    try {
      await api('/empresa/configuracion', { metodo: 'PATCH', cuerpo: { dobleFactorObligatorio: valor } });
      setC((s) => ({ ...s, dobleFactorObligatorio: valor }));
      toast(valor ? 'Desde su próximo ingreso, todo el personal debe usar la verificación en dos pasos.' : 'La verificación en dos pasos vuelve a ser opcional en este servidor.', 'ok');
    } catch (e) { toast(msg(e), 'warn'); }
    setGuardando2fa(false);
  };
  // Cartera: solo esta clave, sin recargar el formulario de arriba
  const [diasGracia, setDiasGracia] = useState('');
  useEffect(() => { setDiasGracia(String(d.datos?.configuracion?.cartera?.diasGracia ?? 0)); }, [d.datos]);
  const guardarCartera = async (cartera: { retenerCertificados: boolean; diasGracia: number }) => {
    try {
      await api('/empresa/configuracion', { metodo: 'PATCH', cuerpo: { cartera } });
      setC((s) => ({ ...s, cartera }));
      toast(cartera.retenerCertificados ? `En el portal, los certificados con facturas vencidas hace más de ${cartera.diasGracia} días se descargan al registrar el pago.` : 'Los clientes descargan sus certificados aunque tengan facturas vencidas.', 'ok');
    } catch (e) { toast(msg(e), 'warn'); }
  };
  const retener = c.cartera?.retenerCertificados !== false;
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
          <p className="mb-2 mt-4 text-[13px] font-semibold">Certificado comercial <span className="font-normal text-muted">(lo firma el representante legal; el cliente lo descarga en el portal)</span></p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Cargo de quien firma" id="em-cc-ca" hint="Si lo deja vacío: Gerente General"><Input id="em-cc-ca" disabled={!edita} placeholder="Gerente General" value={c.certificadoComercial?.cargo ?? ''} onChange={(e) => setC((s) => ({ ...s, certificadoComercial: { ...s.certificadoComercial, cargo: e.target.value } }))} /></Field>
            <Field label="Correo bajo la firma" id="em-cc-co" hint="Opcional"><Input id="em-cc-co" type="email" disabled={!edita} value={c.certificadoComercial?.correo ?? ''} onChange={(e) => setC((s) => ({ ...s, certificadoComercial: { ...s.certificadoComercial, correo: e.target.value } }))} /></Field>
          </div>
          <p className="mb-2 mt-4 text-[13px] font-semibold">Contacto de la planta <span className="font-normal text-muted">(sale al pie del certificado y en la constancia de RCD)</span></p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {([['direccion', 'Dirección'], ['municipio', 'Municipio'], ['telefono', 'Teléfono'], ['correo', 'Correo electrónico']] as const).map(([k, etiqueta]) => (
              <Field key={k} label={etiqueta} id={`em-c-${k}`}><Input id={`em-c-${k}`} disabled={!edita} value={c.contacto?.[k] ?? ''} onChange={(e) => setC((s) => ({ ...s, contacto: { ...s.contacto, [k]: e.target.value } }))} /></Field>
            ))}
            <Field label="N.º único de gestor de RCD" id="em-rcd" hint="El que asignó la autoridad ambiental (Anexo II de la Res. 1257 de 2021). Sale en la constancia de RCD.">
              <Input id="em-rcd" disabled={!edita} value={c.rcd?.numeroGestor ?? ''} onChange={(e) => setC((s) => ({ ...s, rcd: { ...s.rcd, numeroGestor: e.target.value } }))} />
            </Field>
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

        <ResumenDiarioCard c={c} setC={setC} edita={edita} guardar={guardarConfig} />

        <GpsCard c={c} setC={setC} edita={edita} />

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

        <Card title="Cartera y certificados">
          <label className={cx('flex items-start gap-3 rounded-xl border border-line p-3 text-[13px]', !edita && 'opacity-60')}>
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--brand))]" disabled={!edita || !d.datos} checked={retener}
              onChange={(e) => guardarCartera({ retenerCertificados: e.target.checked, diasGracia: Number(diasGracia) || 0 })} />
            <span>
              <span className="font-medium">En el portal, entregar el certificado al registrar el pago</span>
              <span className="mt-1 block text-muted">Si una factura del certificado está vencida y sin pagar, el cliente lo ve en su portal con un aviso amable y lo descarga cuando se registre el pago (en Conciliación, «Pagada»). La oficina siempre lo descarga y puede liberarlo desde el certificado. La verificación por QR no cambia.</span>
            </span>
          </label>
          {retener && (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <Field label="Días de gracia después del vencimiento" id="em-dg"><Input id="em-dg" type="number" min={0} max={365} className="w-28" disabled={!edita} value={diasGracia} onChange={(e) => setDiasGracia(e.target.value)} /></Field>
              {edita && Number(diasGracia) !== (c.cartera?.diasGracia ?? 0) && <Button size="sm" onClick={() => guardarCartera({ retenerCertificados: true, diasGracia: Math.max(0, Math.min(365, Math.trunc(Number(diasGracia) || 0))) })}><Save size={14} /> Guardar</Button>}
            </div>
          )}
        </Card>

        <Card title="Seguridad del ingreso">
          <label className={cx('flex items-start gap-3 rounded-xl border border-line p-3 text-[13px]', (!edita || guardando2fa) && 'opacity-60')}>
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--brand))]" disabled={!edita || guardando2fa || !d.datos}
              checked={!!c.dobleFactorObligatorio} onChange={(e) => exigir2fa(e.target.checked)} />
            <span>
              <span className="flex items-center gap-1.5 font-medium"><ShieldCheck size={15} className="text-brand" />Exigir la verificación en dos pasos a todo el personal</span>
              <span className="mt-1 block text-muted">Además de la contraseña, cada persona de Terra Viva escribe un código de su celular que cambia cada 30 segundos. Quien no la tenga, la configura en su próximo ingreso. En el sistema definitivo se exige siempre; aquí puede empezar a exigirla desde ya. A los usuarios del portal de clientes no se les exige: la activan si quieren.</span>
            </span>
          </label>
        </Card>
      </div>

      <div className="mt-4">
        <Card title="Textos legales del certificado" action={edita && !editando && <Button size="sm" onClick={() => setEditando({ nuevo: true, codigo: '', titulo: '', texto: '', disposiciones: [], orden: 20, revisado: false })}><Plus size={14} /> Texto nuevo</Button>}>
          <p className="mb-3 text-[13px] text-muted">Cada párrafo sale solo si el certificado tiene residuos con alguna de sus disposiciones (sin disposiciones: sale siempre). Editar crea una versión nueva; cada certificado guarda la versión que usó. Para que el texto se apoye en los permisos registrados (y salga sola una renovación o una licencia nueva) use <code className="num">{"{permiso:CÓDIGO}"}</code> (el permiso propio vigente de ese tratamiento, p. ej. <code className="num">{"{permiso:ASP}"}</code>) o <code className="num">{"{permisos}"}</code> (todo lo que ampara el certificado).</p>
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
