import { useState, type FormEvent } from 'react';
import { Download, KeyRound, ShieldCheck } from 'lucide-react';
import { Button, Card, Field, Input, PageHeader } from '../componentes/ui';
import { Aviso } from '../componentes/Marca';
import { api, descargarTexto, fechaHora, mensajeDe, type Yo } from '../lib';

export function MiCuenta({ yo, alCambiar }: { yo: Yo; alCambiar: () => void }) {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader title="Mi cuenta" subtitle={`${yo.cuenta.nombre} · ${yo.cuenta.email}`} />
      <div className="grid gap-4">
        <CambiarClave />
        <Respaldo yo={yo} alCambiar={alCambiar} />
      </div>
    </div>
  );
}

function CambiarClave() {
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetir, setRepetir] = useState('');
  const [msj, setMsj] = useState<{ tono: 'ok' | 'bad'; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const enviar = async (e: FormEvent) => {
    e.preventDefault(); setMsj(null);
    if (nueva.length < 10 || !/[A-Za-z]/.test(nueva) || !/\d/.test(nueva)) return setMsj({ tono: 'bad', texto: 'Use al menos 10 caracteres, con letras y números.' });
    if (nueva !== repetir) return setMsj({ tono: 'bad', texto: 'Las dos contraseñas nuevas no coinciden.' });
    setEnviando(true);
    try {
      const r = await api<{ mensaje: string }>('clave/cambiar', { actual, nueva });
      setMsj({ tono: 'ok', texto: r.mensaje }); setActual(''); setNueva(''); setRepetir('');
    } catch (x) { setMsj({ tono: 'bad', texto: mensajeDe(x) }); } finally { setEnviando(false); }
  };
  return (
    <Card title={<span className="flex items-center gap-2"><KeyRound size={18} className="text-brand" /> Contraseña</span>}>
      <form className="grid gap-4 sm:grid-cols-3" onSubmit={enviar}>
        <Field label="Contraseña actual" id="mc-a"><Input id="mc-a" type="password" autoComplete="current-password" required value={actual} onChange={(e) => setActual(e.target.value)} /></Field>
        <Field label="Contraseña nueva" id="mc-n"><Input id="mc-n" type="password" autoComplete="new-password" required value={nueva} onChange={(e) => setNueva(e.target.value)} /></Field>
        <Field label="Repita la nueva" id="mc-r"><Input id="mc-r" type="password" autoComplete="new-password" required value={repetir} onChange={(e) => setRepetir(e.target.value)} /></Field>
        <div className="flex flex-col gap-3 sm:col-span-3">
          {msj && <Aviso tono={msj.tono}>{msj.texto}</Aviso>}
          <Button variant="primary" type="submit" disabled={enviando} className="self-start">{enviando ? 'Guardando…' : 'Cambiar contraseña'}</Button>
          <p className="text-[12px] text-subtle">Al cambiarla se cierran sus sesiones en otros equipos.</p>
        </div>
      </form>
    </Card>
  );
}

function Respaldo({ yo, alCambiar }: { yo: Yo; alCambiar: () => void }) {
  const [codigo, setCodigo] = useState('');
  const [nuevos, setNuevos] = useState<string[] | null>(null);
  const [err, setErr] = useState('');
  const [enviando, setEnviando] = useState(false);
  const enviar = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setEnviando(true);
    try { setNuevos((await api<{ respaldo: string[] }>('codigo/respaldo', { codigo })).respaldo); setCodigo(''); alCambiar(); }
    catch (x) { setErr(mensajeDe(x)); } finally { setEnviando(false); }
  };
  return (
    <Card title={<span className="flex items-center gap-2"><ShieldCheck size={18} className="text-brand" /> Verificación en dos pasos</span>}>
      <p className="text-[13px] text-muted">Activa desde el {fechaHora(yo.cuenta.codigoDesde)}. Le quedan <b className="text-fg">{yo.cuenta.codigosRespaldo}</b> códigos de respaldo sin usar.</p>
      {nuevos ? (
        <div className="mt-4">
          <p className="text-[13px] text-muted">Estos son sus códigos nuevos (los anteriores ya no sirven). Guárdelos: no se vuelven a mostrar.</p>
          <ul className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-line bg-surface-2 p-4 font-mono text-[15px] sm:grid-cols-5">
            {nuevos.map((c) => <li key={c} className="select-all text-center">{c}</li>)}
          </ul>
          <Button className="mt-3" onClick={() => descargarTexto('codigos-respaldo-terry-app.txt', `Códigos de respaldo de Terry-App (cada uno sirve una vez):\n\n${nuevos.join('\n')}\n`)}>
            <Download size={16} /> Descargarlos
          </Button>
        </div>
      ) : (
        <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={enviar}>
          <Field label="Código actual de la app" id="mc-c">
            <Input id="mc-c" inputMode="numeric" autoComplete="one-time-code" required maxLength={6} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} className="w-40 text-center font-mono tracking-[0.2em]" />
          </Field>
          <Button type="submit" disabled={enviando}>{enviando ? 'Generando…' : 'Generar códigos de respaldo nuevos'}</Button>
          {err && <div className="w-full"><Aviso>{err}</Aviso></div>}
        </form>
      )}
    </Card>
  );
}
