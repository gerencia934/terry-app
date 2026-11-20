import { useEffect, useRef, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { Download, Eye, EyeOff, KeyRound, ShieldCheck, Smartphone } from 'lucide-react';
import { Button, Field, Input } from '../componentes/ui';
import { Aviso, MarcaTerryApp, PantallaIngreso } from '../componentes/Marca';
import { api, descargarTexto, ErrorApi, mensajeDe } from '../lib';

type Paso =
  | { tipo: 'clave' }
  | { tipo: 'codigo'; desafio: string }
  | { tipo: 'configurar'; desafio: string }
  | { tipo: 'respaldo'; codigos: string[] };

/** Ingreso al portal: contraseña y luego el código de la app de autenticación (o configurarla la primera vez). */
export function Ingreso({ alEntrar, avisoInicial }: { alEntrar: () => void; avisoInicial?: string }) {
  const [paso, setPaso] = useState<Paso>({ tipo: 'clave' });
  const [aviso, setAviso] = useState(avisoInicial ?? '');
  const volver = (m: string) => { setPaso({ tipo: 'clave' }); setAviso(m); };
  return (
    <PantallaIngreso>
      <MarcaTerryApp />
      {paso.tipo === 'clave' && <PasoClave aviso={aviso} alSeguir={(p) => { setAviso(''); setPaso(p); }} />}
      {paso.tipo === 'codigo' && <PasoCodigo desafio={paso.desafio} alEntrar={alEntrar} alVencer={volver} />}
      {paso.tipo === 'configurar' && <PasoConfigurar desafio={paso.desafio} alListo={(codigos) => setPaso({ tipo: 'respaldo', codigos })} alVencer={volver} />}
      {paso.tipo === 'respaldo' && <PasoRespaldo codigos={paso.codigos} alSeguir={alEntrar} />}
    </PantallaIngreso>
  );
}

function PasoClave({ aviso, alSeguir }: { aviso: string; alSeguir: (p: Paso) => void }) {
  const [email, setEmail] = useState('');
  const [clave, setClave] = useState('');
  const [ver, setVer] = useState(false);
  const [err, setErr] = useState('');
  const [enviando, setEnviando] = useState(false);
  const enviar = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setEnviando(true);
    try {
      const r = await api<{ paso: 'codigo' | 'configurar'; desafio: string }>('ingresar', { email, clave });
      alSeguir({ tipo: r.paso, desafio: r.desafio });
    } catch (x) { setErr(mensajeDe(x)); } finally { setEnviando(false); }
  };
  return (
    <>
      <h1 className="mt-8 font-display text-[26px] font-bold text-fg">Hola, soy Terry</h1>
      <p className="mt-1 text-muted">Ingrese con su cuenta Terry-App. Desde aquí entra a todos sus módulos.</p>
      <form className="mt-7 flex flex-col gap-4" onSubmit={enviar}>
        {aviso && <Aviso tono="ok">{aviso}</Aviso>}
        <Field label="Correo" id="in-correo"><Input id="in-correo" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Contraseña" id="in-clave">
          <div className="relative">
            <Input id="in-clave" type={ver ? 'text' : 'password'} autoComplete="current-password" required value={clave} onChange={(e) => setClave(e.target.value)} className="pr-10" />
            <button type="button" onClick={() => setVer((v) => !v)} className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-subtle hover:text-fg" aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
              {ver ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </Field>
        <Aviso>{err}</Aviso>
        <Button variant="primary" size="lg" type="submit" disabled={enviando}>{enviando ? 'Verificando…' : 'Ingresar'}</Button>
        <p className="text-[12px] text-subtle">¿Olvidó su contraseña? Pídale al administrador del portal un enlace nuevo.</p>
      </form>
    </>
  );
}

function PasoCodigo({ desafio, alEntrar, alVencer }: { desafio: string; alEntrar: () => void; alVencer: (m: string) => void }) {
  const [codigo, setCodigo] = useState('');
  const [err, setErr] = useState('');
  const [enviando, setEnviando] = useState(false);
  const enviar = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setEnviando(true);
    try { await api('ingresar/codigo', { desafio, codigo }); alEntrar(); }
    catch (x) {
      if (x instanceof ErrorApi && x.codigo === 'DESAFIO') return alVencer(x.message);
      setErr(mensajeDe(x));
    } finally { setEnviando(false); }
  };
  return (
    <>
      <h1 className="mt-8 flex items-center gap-2 font-display text-[24px] font-bold text-fg"><ShieldCheck className="text-brand" size={26} /> Verificación en dos pasos</h1>
      <p className="mt-1 text-muted">Escriba el código de 6 números que muestra su app de autenticación. Si no tiene el celular, use uno de sus códigos de respaldo.</p>
      <form className="mt-7 flex flex-col gap-4" onSubmit={enviar}>
        <Field label="Código" id="in-codigo">
          <Input id="in-codigo" inputMode="text" autoComplete="one-time-code" autoFocus required maxLength={12} value={codigo}
            onChange={(e) => setCodigo(e.target.value)} className="text-center font-mono text-lg tracking-[0.3em]" />
        </Field>
        <Aviso>{err}</Aviso>
        <Button variant="primary" size="lg" type="submit" disabled={enviando}>{enviando ? 'Verificando…' : 'Entrar'}</Button>
        <button type="button" className="text-[13px] font-medium text-brand hover:underline" onClick={() => alVencer('')}>Volver</button>
      </form>
    </>
  );
}

function PasoConfigurar({ desafio, alListo, alVencer }: { desafio: string; alListo: (c: string[]) => void; alVencer: (m: string) => void }) {
  const [datos, setDatos] = useState<{ secreto: string; qr: string } | null>(null);
  const [codigo, setCodigo] = useState('');
  const [err, setErr] = useState('');
  const [enviando, setEnviando] = useState(false);
  const vencer = useRef(alVencer);
  vencer.current = alVencer;
  const iniciado = useRef('');
  useEffect(() => {
    // Una sola vez por desafío: cada llamada crea un secreto nuevo y el QR debe ser el del último
    if (iniciado.current === desafio) return;
    iniciado.current = desafio;
    api<{ secreto: string; uri: string }>('codigo/iniciar', { desafio })
      .then(async (r) => setDatos({ secreto: r.secreto, qr: await QRCode.toDataURL(r.uri, { margin: 1, width: 216 }) }))
      .catch((x) => (x instanceof ErrorApi && x.codigo === 'DESAFIO' ? vencer.current(x.message) : setErr(mensajeDe(x))));
  }, [desafio]);
  const enviar = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setEnviando(true);
    try { alListo((await api<{ respaldo: string[] }>('codigo/confirmar', { desafio, codigo })).respaldo); }
    catch (x) {
      if (x instanceof ErrorApi && x.codigo === 'DESAFIO') return alVencer(x.message);
      setErr(mensajeDe(x));
    } finally { setEnviando(false); }
  };
  return (
    <>
      <h1 className="mt-8 flex items-center gap-2 font-display text-[24px] font-bold text-fg"><Smartphone className="text-brand" size={26} /> Proteja su cuenta</h1>
      <p className="mt-1 text-muted">La primera vez se configura la verificación en dos pasos. Es obligatoria para entrar a los módulos.</p>
      <ol className="mt-5 list-decimal space-y-1 pl-5 text-[13px] text-muted">
        <li>Instale en su celular Google Authenticator o Microsoft Authenticator.</li>
        <li>En la app, agregue una cuenta y escanee este código.</li>
        <li>Escriba abajo el código de 6 números que le muestra.</li>
      </ol>
      <div className="mt-5 flex flex-col items-center gap-2 rounded-xl border border-line bg-surface-2 p-4">
        {datos ? <img src={datos.qr} alt="Código QR para la app de autenticación" className="h-[216px] w-[216px] rounded-lg bg-white p-1" /> : <div className="h-[216px] w-[216px] animate-pulse rounded-lg bg-line" />}
        {datos && <p className="text-center text-[12px] text-subtle">¿No puede escanear? Escriba esta clave en la app:<br /><span className="select-all font-mono text-[13px] text-fg">{datos.secreto}</span></p>}
      </div>
      <form className="mt-5 flex flex-col gap-4" onSubmit={enviar}>
        <Field label="Código de la app" id="in-conf">
          <Input id="in-conf" inputMode="numeric" autoComplete="one-time-code" required maxLength={6} value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} className="text-center font-mono text-lg tracking-[0.3em]" />
        </Field>
        <Aviso>{err}</Aviso>
        <Button variant="primary" size="lg" type="submit" disabled={enviando || !datos}>{enviando ? 'Verificando…' : 'Activar y entrar'}</Button>
      </form>
    </>
  );
}

function PasoRespaldo({ codigos, alSeguir }: { codigos: string[]; alSeguir: () => void }) {
  const [guardados, setGuardados] = useState(false);
  return (
    <>
      <h1 className="mt-8 flex items-center gap-2 font-display text-[24px] font-bold text-fg"><KeyRound className="text-brand" size={26} /> Sus códigos de respaldo</h1>
      <p className="mt-1 text-muted">Si pierde el celular, cada uno de estos códigos sirve una sola vez para entrar. Guárdelos en un lugar seguro: no se vuelven a mostrar.</p>
      <ul className="mt-5 grid grid-cols-2 gap-2 rounded-xl border border-line bg-surface-2 p-4 font-mono text-[15px]">
        {codigos.map((c) => <li key={c} className="select-all text-center">{c}</li>)}
      </ul>
      <div className="mt-4 flex flex-col gap-3">
        <Button onClick={() => { descargarTexto('codigos-respaldo-terry-app.txt', `Códigos de respaldo de Terry-App (cada uno sirve una vez):\n\n${codigos.join('\n')}\n`); setGuardados(true); }}>
          <Download size={16} /> Descargarlos
        </Button>
        <label className="flex items-center gap-2 text-[13px] text-muted">
          <input type="checkbox" checked={guardados} onChange={(e) => setGuardados(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--brand))]" /> Ya los guardé
        </label>
        <Button variant="primary" size="lg" disabled={!guardados} onClick={alSeguir}>Continuar</Button>
      </div>
    </>
  );
}

/** Enlace de invitación o de recuperación (…/#clave=…): la persona crea su contraseña. */
export function CrearClave({ token, alTerminar }: { token: string; alTerminar: (m: string) => void }) {
  const [c1, setC1] = useState('');
  const [c2, setC2] = useState('');
  const [err, setErr] = useState('');
  const [enviando, setEnviando] = useState(false);
  const enviar = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    if (c1.length < 10 || !/[A-Za-z]/.test(c1) || !/\d/.test(c1)) return setErr('Use al menos 10 caracteres, con letras y números.');
    if (c1 !== c2) return setErr('Las dos contraseñas no coinciden.');
    setEnviando(true);
    try { alTerminar((await api<{ mensaje: string }>('clave/crear', { token, clave: c1 })).mensaje); }
    catch (x) { setErr(mensajeDe(x)); } finally { setEnviando(false); }
  };
  return (
    <PantallaIngreso>
      <MarcaTerryApp />
      <h1 className="mt-8 font-display text-[26px] font-bold text-fg">Cree su contraseña</h1>
      <p className="mt-1 text-muted">Con ella y la verificación en dos pasos entrará a todos sus módulos de Terry-App.</p>
      <form className="mt-7 flex flex-col gap-4" onSubmit={enviar}>
        <Field label="Contraseña nueva" id="cc-1" hint="Mínimo 10 caracteres, con letras y números."><Input id="cc-1" type="password" autoComplete="new-password" required value={c1} onChange={(e) => setC1(e.target.value)} /></Field>
        <Field label="Repítala" id="cc-2"><Input id="cc-2" type="password" autoComplete="new-password" required value={c2} onChange={(e) => setC2(e.target.value)} /></Field>
        <Aviso>{err}</Aviso>
        <Button variant="primary" size="lg" type="submit" disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar contraseña'}</Button>
      </form>
    </PantallaIngreso>
  );
}
