// Verificación en dos pasos (TOTP): las piezas que comparten la pantalla obligatoria del personal y el panel del
// menú de la cuenta (oficina y portal de clientes). Sirve cualquier app de autenticación: Google Authenticator,
// Microsoft Authenticator, Authy…
import { useState, type FormEvent } from 'react';
import { CheckCircle2, Copy, Download, Loader2, ShieldCheck, Smartphone } from 'lucide-react';
import { Button, Field, Input, Sheet, useToast } from './ui';
import { api, reemplazarSesion, sesionActual, type Sesion } from '../lib/api';
import { fechaHoraCo, msg, useApi } from '../lib/servidor';

interface Inicio { secreto: string; uri: string; qr: string }
export interface EstadoDobleFactor { dobleFactor: { activo: boolean; desde: string | null; obligatorio: boolean; codigosRestantes: number } }

/** Códigos de respaldo: se muestran una sola vez; se copian o se descargan para guardarlos fuera del celular. */
function CodigosRespaldo({ codigos }: { codigos: string[] }) {
  const toast = useToast();
  const texto = `Códigos de respaldo de Terry-App (${sesionActual()?.usuario.email ?? ''}). Cada uno sirve una sola vez.\n\n${codigos.join('\n')}\n`;
  const descargar = () => {
    const url = URL.createObjectURL(new Blob([texto], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'codigos-respaldo-terry-go.txt'; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  };
  const copiar = () => {
    if (!navigator.clipboard) return toast('No se pudo copiar: descárguelos.', 'warn');
    navigator.clipboard.writeText(texto).then(() => toast('Códigos copiados.', 'ok'), () => toast('No se pudo copiar: descárguelos.', 'warn'));
  };
  return (
    <div className="flex flex-col gap-3">
      <ul className="grid grid-cols-2 gap-2 rounded-xl bg-surface-2 p-4 font-mono text-[15px] tracking-wider" aria-label="Códigos de respaldo">
        {codigos.map((c) => <li key={c} className="text-center">{c}</li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={copiar}><Copy size={14} /> Copiar</Button>
        <Button size="sm" onClick={descargar}><Download size={14} /> Descargar</Button>
      </div>
      <p className="text-[12px] text-muted">Guárdelos en un lugar seguro, fuera del celular. Si pierde el celular, cada código le sirve una sola vez para entrar.</p>
    </div>
  );
}

/**
 * Paso a paso: leer el código QR con la app, escribir el primer código y guardar los códigos de respaldo.
 * Al activarla el servidor cierra las demás sesiones y entrega una nueva: `alActivar` la recibe de inmediato
 * (la anterior ya no sirve) y `alTerminar`, cuando el usuario confirma que guardó los códigos.
 */
export function Inscripcion({ alActivar, alTerminar }: { alActivar: (sesion: Sesion) => void; alTerminar: (sesion: Sesion) => void }) {
  const [inicio, setInicio] = useState<Inicio | null>(null);
  const [codigo, setCodigo] = useState('');
  const [listo, setListo] = useState<{ codigosRespaldo: string[]; sesion: Sesion } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const empezar = async () => {
    setOcupado(true); setError('');
    try { setInicio(await api<Inicio>('/auth/2fa/iniciar', { cuerpo: {} })); } catch (e) { setError(msg(e, 'No se pudo empezar.')); }
    setOcupado(false);
  };
  const confirmar = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(codigo.trim())) return setError('Escriba los 6 dígitos que muestra la app.');
    setOcupado(true); setError('');
    try {
      const r = await api<{ codigosRespaldo: string[]; sesion: Sesion }>('/auth/2fa/confirmar', { cuerpo: { codigo: codigo.trim() } });
      alActivar(r.sesion);
      setListo(r);
    } catch (x) { setError(msg(x, 'No se pudo activar.')); }
    setOcupado(false);
  };
  if (listo) return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-2 font-medium text-ok"><CheckCircle2 size={18} /> Verificación en dos pasos activa</p>
      <p className="text-[14px]">Estos son sus <b>códigos de respaldo</b>. No se volverán a mostrar:</p>
      <CodigosRespaldo codigos={listo.codigosRespaldo} />
      <div className="flex justify-end"><Button variant="primary" onClick={() => alTerminar(listo.sesion)}>Ya los guardé, continuar</Button></div>
    </div>
  );
  if (!inicio) return (
    <div className="flex flex-col gap-4">
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[14px] text-muted">
        <li>Instale en su celular una app de autenticación: <b className="text-fg">Google Authenticator</b>, <b className="text-fg">Microsoft Authenticator</b> o Authy.</li>
        <li>Lea con la app el código QR que le mostraremos.</li>
        <li>Escriba el código de 6 dígitos que aparece en la app.</li>
      </ol>
      {error && <p className="rounded-lg bg-bad/10 px-3 py-2 text-[13px] text-bad" role="alert">{error}</p>}
      <div className="flex justify-end"><Button variant="primary" onClick={empezar} disabled={ocupado}>{ocupado ? <Loader2 size={16} className="animate-spin" /> : <Smartphone size={16} />} Empezar</Button></div>
    </div>
  );
  return (
    <form onSubmit={confirmar} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
        <img src={inicio.qr} alt="Código QR para la app de autenticación" className="h-48 w-48 shrink-0 rounded-lg border border-line bg-white p-1" />
        <div className="text-[13px] text-muted">
          <p>Abra la app, toque <b className="text-fg">«Agregar»</b> o <b className="text-fg">«+»</b> y lea este código.</p>
          <p className="mt-2">¿No puede leerlo? Escriba esta clave en la app:</p>
          <p className="mt-1 select-all break-all rounded bg-surface-2 px-2 py-1 font-mono text-[13px] text-fg">{inicio.secreto}</p>
        </div>
      </div>
      <Field label="Código de 6 dígitos que muestra la app" id="df-cod">
        <Input id="df-cod" autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
          className="text-center font-mono text-lg tracking-[0.4em]" placeholder="000000" />
      </Field>
      {error && <p className="rounded-lg bg-bad/10 px-3 py-2 text-[13px] text-bad" role="alert">{error}</p>}
      <div className="flex justify-end"><Button variant="primary" type="submit" disabled={ocupado}>{ocupado && <Loader2 size={16} className="animate-spin" />}Activar</Button></div>
    </form>
  );
}

/** Estado, activarla, códigos de respaldo nuevos y desactivarla (solo si no es obligatoria). */
function PanelDobleFactor() {
  const toast = useToast();
  const estado = useApi<EstadoDobleFactor>('/auth/yo');
  const [codigo, setCodigo] = useState('');
  const [nuevos, setNuevos] = useState<string[] | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const d = estado.datos?.dobleFactor;
  if (estado.error) return <p className="rounded-xl bg-bad/10 p-4 text-bad">{estado.error}</p>;
  if (!d) return <p className="flex items-center gap-2 text-muted"><Loader2 size={16} className="animate-spin" />Cargando…</p>;
  if (!d.activo) return (
    <div className="flex flex-col gap-4">
      <p className="text-[14px] text-muted">Con la verificación en dos pasos, además de su contraseña se pide un código de su celular que cambia cada 30 segundos. Así, aunque alguien conozca su contraseña, no puede entrar.</p>
      <Inscripcion alActivar={reemplazarSesion} alTerminar={() => { estado.recargar(); toast('Verificación en dos pasos activa.', 'ok'); }} />
    </div>
  );
  const accion = async (que: 'codigos' | 'desactivar') => {
    if (!codigo.trim()) return toast('Escriba el código de la app.', 'warn');
    setOcupado(true);
    try {
      if (que === 'codigos') setNuevos((await api<{ codigosRespaldo: string[] }>('/auth/2fa/codigos', { cuerpo: { codigo: codigo.trim() } })).codigosRespaldo);
      else { await api('/auth/2fa/desactivar', { cuerpo: { codigo: codigo.trim() } }); toast('Verificación en dos pasos desactivada.', 'ok'); }
      setCodigo(''); estado.recargar();
    } catch (e) { toast(msg(e, 'No se pudo.'), 'warn'); }
    setOcupado(false);
  };
  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-2 font-medium text-ok"><ShieldCheck size={18} /> Activa{d.desde ? ` desde el ${fechaHoraCo(d.desde)}` : ''}</p>
      <p className="text-[13px] text-muted">Le quedan <b className="text-fg">{d.codigosRestantes}</b> códigos de respaldo sin usar.{d.obligatorio ? ' Para el personal de Terra Viva es obligatoria: no se puede desactivar.' : ''}</p>
      {nuevos ? (
        <>
          <p className="text-[14px]">Sus <b>códigos de respaldo nuevos</b> (los anteriores ya no sirven):</p>
          <CodigosRespaldo codigos={nuevos} />
          <div className="flex justify-end"><Button onClick={() => setNuevos(null)}>Listo</Button></div>
        </>
      ) : (
        <>
          <Field label="Código que muestra ahora la app" id="df-acc" hint={d.obligatorio ? undefined : 'Para desactivarla también sirve un código de respaldo.'}>
            <Input id="df-acc" inputMode="text" autoComplete="one-time-code" maxLength={12} value={codigo} onChange={(e) => setCodigo(e.target.value)} className="font-mono tracking-[0.3em]" placeholder="000000" />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button disabled={ocupado} onClick={() => accion('codigos')}>Generar códigos de respaldo nuevos</Button>
            {!d.obligatorio && <Button variant="ghost" disabled={ocupado} onClick={() => accion('desactivar')}>Desactivar</Button>}
          </div>
        </>
      )}
    </div>
  );
}

/** Ventana del menú de la cuenta (oficina y portal de clientes). */
export function VentanaDobleFactor({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={<span className="flex items-center gap-2"><ShieldCheck size={18} className="text-brand" />Verificación en dos pasos</span>}>
      {open && <PanelDobleFactor />}
    </Sheet>
  );
}
