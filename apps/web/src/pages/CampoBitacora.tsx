// Bitácora de tiempos en el celular (gerencia, 20-11-2026): un toque para empezar a contar un tiempo muerto o una tarea que
// no es una recolección (trancón, espera en portería, compra de insumos…) y otro para terminarlo. El cronómetro vive en el
// teléfono, así que sirve sin señal: al terminar, el registro completo entra a la cola y se envía solo.
import { useEffect, useState } from 'react';
import { Camera, CheckCircle2, MapPin, Play, Square, Timer, Trash2 } from 'lucide-react';
import { Button, Field, Input, Sheet, useToast } from '../components/ui';
import { api } from '../lib/api';
import { cx } from '../lib/format';
import { encolar, listar, procesar } from '../campo/cola';
import { comprimirFoto } from '../campo/medios';
import { CampoLayout, usePaquete } from './CampoServidor';

interface TipoTiempo { id: string; codigo: string; nombre: string; color: string | null }
interface Cronometro { id: string; tipoId: string; tipo: string; color: string | null; inicio: string; rutaId: string | null; vehiculoId: string | null; latInicio?: number; lngInicio?: number }
interface Registrado { id: string; tipo: string; color: string | null; inicio: string; fin: string; minutos: number; nota: string | null; porEnviar?: boolean }
/** Un registro como lo devuelve el servidor. */
interface RegistroApi { id: string; inicio: string; fin: string; minutos: number; nota: string | null; tipo: { nombre: string; color: string | null } }

const TIPOS = 'terry-go-tipos-tiempo', CRONO = 'terry-go-cronometro', HOY = 'terry-go-tiempos-hoy';
const leer = <T,>(k: string): T | null => { try { return JSON.parse(localStorage.getItem(k) ?? 'null') as T | null; } catch { return null; } };
const guardar = (k: string, v: unknown) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin espacio */ } };
const hoy = () => new Date().toLocaleDateString('en-CA');
const duracion = (ms: number) => { const m = Math.max(0, Math.floor(ms / 60_000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`; };
const reloj = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

/** Ubicación del momento (si el teléfono la da en pocos segundos; si no, se sigue sin ella). */
const ubicacion = () => new Promise<{ lat: number; lng: number } | null>((ok) => {
  if (!navigator.geolocation) { ok(null); return; }
  navigator.geolocation.getCurrentPosition((p) => ok({ lat: Math.round(p.coords.latitude * 1e6) / 1e6, lng: Math.round(p.coords.longitude * 1e6) / 1e6 }), () => ok(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 });
});
const enColombia = (u: { lat: number; lng: number } | null) => (u && u.lat >= -5 && u.lat <= 14 && u.lng >= -82 && u.lng <= -66 ? u : null);

export function CampoBitacoraServidor() {
  const toast = useToast();
  const { ruta } = usePaquete();
  const [tipos, setTipos] = useState<TipoTiempo[]>(() => leer<TipoTiempo[]>(TIPOS) ?? []);
  const [crono, setCrono] = useState<Cronometro | null>(() => leer<Cronometro>(CRONO));
  const [lista, setLista] = useState<Registrado[]>(() => { const x = leer<{ fecha: string; filas: Registrado[] }>(HOY); return x?.fecha === hoy() ? x.filas : []; });
  const [ahora, setAhora] = useState(Date.now());
  const [terminando, setTerminando] = useState(false);
  const [nota, setNota] = useState('');
  const [costo, setCosto] = useState('');
  const [foto, setFoto] = useState<Blob | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!navigator.onLine) return;
    api<TipoTiempo[]>('/bitacora/tipos').then((t) => { setTipos(t); guardar(TIPOS, t); }).catch(() => undefined);
    api<RegistroApi[]>(`/bitacora/mios?desde=${hoy()}&hasta=${hoy()}`).then((r) => {
      // Lo del servidor más lo que sigue en el teléfono por enviar
      setLista((locales) => { const filas: Registrado[] = [...locales.filter((x) => x.porEnviar && !r.some((y) => y.id === x.id)),
        ...r.map((x) => ({ id: x.id, inicio: x.inicio, fin: x.fin, minutos: x.minutos, nota: x.nota, tipo: x.tipo.nombre, color: x.tipo.color }))]; guardar(HOY, { fecha: hoy(), filas }); return filas; });
    }).catch(() => undefined);
  }, []);
  useEffect(() => { if (!crono) return; const t = window.setInterval(() => setAhora(Date.now()), 1000); return () => window.clearInterval(t); }, [crono]);

  const iniciar = async (t: TipoTiempo) => {
    const u = enColombia(await ubicacion());
    const c: Cronometro = { id: crypto.randomUUID(), tipoId: t.id, tipo: t.nombre, color: t.color, inicio: new Date().toISOString(), rutaId: ruta?.id ?? null, vehiculoId: ruta?.vehiculoId ?? null,
      ...(u ? { latInicio: u.lat, lngInicio: u.lng } : {}) };
    setCrono(c); guardar(CRONO, c); setAhora(Date.now());
    toast(`Contando: ${t.nombre}. Toque «Terminar» cuando acabe.`);
  };

  const terminar = async () => {
    if (!crono) return;
    setOcupado(true);
    try {
      const u = enColombia(await ubicacion());
      const fin = new Date().toISOString();
      await encolar({ grupo: `bitacora:${crono.id}`, descripcion: `Tiempo: ${crono.tipo}`, metodo: 'POST', ruta: '/bitacora', cuerpo: {
        id: crono.id, tipoId: crono.tipoId, inicio: crono.inicio, fin, ...(nota.trim() ? { nota: nota.trim() } : {}), ...(costo ? { costo: Number(costo) } : {}),
        ...(crono.rutaId ? { rutaId: crono.rutaId } : {}), ...(crono.vehiculoId ? { vehiculoId: crono.vehiculoId } : {}),
        ...(crono.latInicio !== undefined ? { latInicio: crono.latInicio, lngInicio: crono.lngInicio } : {}), ...(u ? { latFin: u.lat, lngFin: u.lng } : {}),
      } });
      if (foto) await encolar({ grupo: `bitacora:${crono.id}`, descripcion: `Foto del tiempo: ${crono.tipo}`, metodo: 'POST', ruta: `/bitacora/${crono.id}/foto`,
        form: { campos: {}, archivo: foto, nombre: `tiempo-${crono.id.slice(0, 8)}.jpg` } });
      const r: Registrado = { id: crono.id, tipo: crono.tipo, color: crono.color, inicio: crono.inicio, fin, minutos: Math.round((Date.parse(fin) - Date.parse(crono.inicio)) / 60_000), nota: nota.trim() || null, porEnviar: true };
      setLista((x) => { const filas = [r, ...x]; guardar(HOY, { fecha: hoy(), filas }); return filas; });
      setCrono(null); guardar(CRONO, null); setTerminando(false); setNota(''); setCosto(''); setFoto(null);
      toast(`${crono.tipo}: ${duracion(Date.parse(fin) - Date.parse(crono.inicio))} registrados.`);
      // Si ya se envió (con señal), deja de figurar «por enviar»
      await procesar();
      if (!(await listar()).some((o) => o.grupo === `bitacora:${r.id}`))
        setLista((x) => { const filas = x.map((y) => (y.id === r.id ? { ...y, porEnviar: false } : y)); guardar(HOY, { fecha: hoy(), filas }); return filas; });
    } catch { toast('No se pudo guardar el tiempo en el teléfono.', 'warn'); }
    finally { setOcupado(false); }
  };

  const descartar = () => { if (crono && confirm('¿Descartar este cronómetro? No se registrará nada.')) { setCrono(null); guardar(CRONO, null); } };
  const tomarFoto = async (f?: File) => { if (!f) return; try { setFoto(await comprimirFoto(f)); } catch { toast('No se pudo leer la foto.', 'warn'); } };
  const totalHoy = lista.reduce((s, x) => s + x.minutos, 0);

  return (
    <CampoLayout title="Tiempos y tareas">
      <p className="text-[13px] text-muted">Registre los tiempos muertos y las tareas que no son una recolección. Es el soporte real de la operación: anótelo tal como pasó.</p>
      {crono ? (
        <div className="mt-4 rounded-2xl p-4 text-white" style={{ background: crono.color ?? '#1F5E3B' }}>
          <p className="text-[13px] opacity-90">Contando desde las {hora(crono.inicio)}{ruta && crono.rutaId === ruta.id ? ` · ruta ${ruta.codigo}` : ''}</p>
          <p className="mt-0.5 text-[18px] font-semibold">{crono.tipo}</p>
          <p className="num mt-2 text-[40px] font-bold leading-none">{reloj(ahora - Date.parse(crono.inicio))}</p>
          <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
            <button type="button" onClick={() => setTerminando(true)} className="flex h-14 items-center justify-center gap-2 rounded-xl bg-white text-[16px] font-semibold" style={{ color: crono.color ?? '#1F5E3B' }}><Square size={18} /> Terminar</button>
            <button type="button" onClick={descartar} className="flex h-14 w-14 items-center justify-center rounded-xl bg-white/20" aria-label="Descartar cronómetro"><Trash2 size={18} /></button>
          </div>
        </div>
      ) : (
        <>
          <h2 className="mb-2 mt-4 text-[16px] font-semibold">¿Qué está pasando?</h2>
          {!tipos.length && <p className="text-[13px] text-muted">{navigator.onLine ? 'Cargando los tipos…' : 'Con señal se descargan los tipos de tiempo.'}</p>}
          <div className="grid grid-cols-2 gap-2">
            {tipos.map((t) => (
              <button key={t.id} type="button" onClick={() => iniciar(t)} className="flex min-h-[64px] items-center gap-2 rounded-xl bg-surface p-3 text-left text-[14px] font-semibold ring-1 ring-line">
                <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: t.color ?? '#667085' }} /><Play size={16} className="shrink-0 text-muted" />{t.nombre}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="mb-2 mt-6 flex items-center justify-between"><h2 className="text-[16px] font-semibold">Hoy</h2><span className="num text-[13px] text-muted">{duracion(totalHoy * 60_000)}</span></div>
      {!lista.length && <p className="text-[13px] text-muted">Aún no hay tiempos registrados hoy.</p>}
      <ul className="flex flex-col gap-2">
        {lista.map((x) => (
          <li key={x.id} className="flex items-start gap-3 rounded-xl bg-surface p-3 ring-1 ring-line">
            <span className="mt-1 h-8 w-1.5 shrink-0 rounded-full" style={{ background: x.color ?? '#667085' }} />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium">{x.tipo}</p>
              <p className="num text-[12px] text-muted">{hora(x.inicio)} – {hora(x.fin)} · {duracion(x.minutos * 60_000)}{x.porEnviar ? ' · por enviar' : ''}</p>
              {x.nota && <p className="mt-0.5 text-[13px]">{x.nota}</p>}
            </div>
            {!x.porEnviar && <CheckCircle2 size={18} className="mt-1 shrink-0 text-ok" />}
          </li>
        ))}
      </ul>
      <p className="mt-4 flex items-center gap-1.5 text-[12px] text-subtle"><MapPin size={13} /> Al empezar y al terminar se guarda la ubicación, si el teléfono la da. Puede corregir lo suyo durante 7 días con su coordinador.</p>

      {terminando && crono && (
        <Sheet open onClose={() => setTerminando(false)} title={`Terminar: ${crono.tipo}`}
          footer={<Button variant="primary" className="h-12 w-full rounded-xl" disabled={ocupado} onClick={terminar}><Timer size={18} /> {ocupado ? 'Guardando…' : `Registrar ${duracion(Date.now() - Date.parse(crono.inicio))}`}</Button>}>
          <div className="flex flex-col gap-3">
            <Field label="Nota (opcional)" id="bt-nota"><Input id="bt-nota" value={nota} maxLength={500} onChange={(e) => setNota(e.target.value)} placeholder="Ej.: accidente en la vía a Puerto Wilches" /></Field>
            <Field label="Gasto en pesos (opcional)" id="bt-costo"><Input id="bt-costo" inputMode="numeric" value={costo} onChange={(e) => setCosto(e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="Solo si compró algo" /></Field>
            <label className={cx('flex h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed text-[14px] font-medium', foto ? 'border-ok text-ok' : 'border-line')}>
              <Camera size={18} /> {foto ? 'Foto lista' : 'Foto de respaldo (opcional)'}
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { void tomarFoto(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
          </div>
        </Sheet>
      )}
    </CampoLayout>
  );
}

