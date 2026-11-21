import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Eye, EyeOff, ShieldCheck, ArrowLeft, MailCheck, KeyRound, Server, FlaskConical, LayoutGrid, Loader2 } from 'lucide-react';
import { Button, Field, Input } from '../components/ui';
import { Logo } from '../components/AppShell';
import { useRouter } from '../lib/router';
import { API_URL, MODO_REAL, PORTAL_URL, api, ingresar, ingresarConPortal, moduloDe, verificarDobleFactor, ErrorApi, type Sesion } from '../lib/api';
import { Carrusel } from '../components/Carrusel';
import { MarcaTerryApp } from '../components/Marca';

/** Ingreso en pantalla dividida (diseño del ecosistema Terry-App): a la izquierda el logo de Terra Viva y el formulario;
 *  a la derecha el carrusel de información corporativa (public/carrusel/carrusel.json). */
function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-full bg-surface lg:grid-cols-[minmax(440px,0.85fr)_1fr]">
      <main className="safe-x flex min-h-full flex-col py-8 lg:px-12">
        <Logo className="h-11 self-start" />
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[400px]">{children}</div>
        </div>
        <p className="text-[12px] text-subtle">© {new Date().getFullYear()} Terra Viva S.A.S. E.S.P. · Soluciones ambientales inteligentes</p>
      </main>
      <Carrusel className="hidden lg:flex" />
    </div>
  );
}

const Modo = () => (
  <p className={`mt-8 flex items-center gap-2 text-[12px] ${MODO_REAL ? 'text-ok' : 'text-subtle'}`}>
    {MODO_REAL ? <><Server size={14} /> Conectado al servidor de Terry-App.</> : <><FlaskConical size={14} /> Modo demostración: cualquier correo y contraseña funcionan.</>}
  </p>
);

export function Login() {
  const { go } = useRouter();
  const [show, setShow] = useState(false);
  const [email, setEmail] = useState(MODO_REAL ? '' : 'gerencia@terravivasas.com');
  const [clave, setClave] = useState(MODO_REAL ? '' : 'demostracion');
  const [err, setErr] = useState('');
  const [enviando, setEnviando] = useState(false);
  // Segundo paso (verificación en dos pasos): el desafío que entregó el servidor y el código de la app
  const [desafio, setDesafio] = useState('');
  const [codigo, setCodigo] = useState('');
  // Cada quien a su módulo: portal de clientes, app del conductor (campo) o administrador
  const entrar = (s: Sesion) => { const m = moduloDe(s); go(m === 'CLIENTE' ? 'portal' : m === 'CAMPO' ? 'campo' : 'inicio'); };
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setErr('Escriba su correo completo, por ejemplo nombre@terravivasas.com.');
    if (!clave) return setErr('Escriba su contraseña.');
    if (!MODO_REAL) return go('inicio');
    setEnviando(true);
    try {
      const r = await ingresar(email, clave);
      if ('requiere2fa' in r) { setDesafio(r.desafio); setCodigo(''); } else entrar(r);
    } catch (e) { setErr(e instanceof ErrorApi ? e.message : 'No se pudo ingresar.'); }
    finally { setEnviando(false); }
  };
  const verificar = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    if (!codigo.trim()) return setErr('Escriba el código.');
    setEnviando(true);
    try { entrar(await verificarDobleFactor(desafio, codigo.trim())); }
    catch (e) {
      setErr(e instanceof ErrorApi ? e.message : 'No se pudo verificar el código.');
      if (e instanceof ErrorApi && /venció/.test(e.message)) setDesafio('');
    } finally { setEnviando(false); }
  };
  if (desafio) return (
    <AuthLayout>
      <MarcaTerryApp />
      <h2 className="mt-8 flex items-center gap-2 font-display text-2xl font-bold text-brand-strong"><ShieldCheck className="text-brand" /> Verificación en dos pasos</h2>
      <p className="mt-1 text-muted">Abra su app de autenticación y escriba el código de 6 dígitos de Terry-App (o TERRY-GO, si la configuró antes). Si no tiene el celular, use uno de sus códigos de respaldo.</p>
      <form onSubmit={verificar} className="mt-6 flex flex-col gap-4" noValidate>
        <Field label="Código" id="login-2fa"><Input id="login-2fa" autoFocus inputMode="text" autoComplete="one-time-code" maxLength={12} value={codigo}
          onChange={(e) => setCodigo(e.target.value)} placeholder="123456 o ABCD-EFGH" className="text-center font-mono text-lg tracking-[0.3em]" /></Field>
        {err && <p className="rounded-lg bg-bad/10 px-3 py-2 text-[13px] text-bad" role="alert">{err}</p>}
        <Button variant="primary" size="lg" type="submit" disabled={enviando}>{enviando ? 'Verificando…' : 'Entrar'}</Button>
        <button type="button" onClick={() => { setDesafio(''); setErr(''); }} className="inline-flex items-center justify-center gap-1.5 text-[13px] font-medium text-muted hover:text-fg"><ArrowLeft size={15} /> Volver</button>
      </form>
      <p className="mt-6 text-[12px] text-subtle">¿Perdió el celular y los códigos de respaldo? Pídale al administrador que restablezca su verificación en dos pasos.</p>
    </AuthLayout>
  );
  return (
    <AuthLayout>
      <MarcaTerryApp />
      <p className="mt-7 text-[15px] text-muted">Hola, soy Terry. Ingrese con su cuenta de Terra Viva.</p>
      <p className="mt-1 text-[12px] text-subtle">Conductores, auxiliares y operarios entran directo a su Portal Logístico, y los clientes, a su portal.</p>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4" noValidate>
        <Field label="Correo" id="login-email"><Input id="login-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@terravivasas.com" /></Field>
        <Field label="Contraseña" id="login-pass">
          <div className="relative">
            <Input id="login-pass" type={show ? 'text' : 'password'} autoComplete="current-password" value={clave} onChange={(e) => setClave(e.target.value)} className="pr-11" />
            <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-1 top-1 rounded-md p-2 text-muted" aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}>{show ? <EyeOff size={17} /> : <Eye size={17} />}</button>
          </div>
        </Field>
        {err && <p className="rounded-lg bg-bad/10 px-3 py-2 text-[13px] text-bad" role="alert">{err}</p>}
        <div className="flex justify-end text-[13px]"><button type="button" onClick={() => go('recuperar')} className="font-medium text-brand hover:underline">Olvidé mi contraseña</button></div>
        <Button variant="primary" size="lg" type="submit" disabled={enviando}>{enviando ? 'Ingresando…' : 'Ingresar'}</Button>
        {!MODO_REAL && <Button type="button" size="lg" onClick={() => go('campo')}>Ver la app del conductor</Button>}
        {MODO_REAL && PORTAL_URL && (
          <a href={PORTAL_URL} className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-5 text-base font-medium text-fg hover:bg-surface-2">
            <LayoutGrid size={18} /> Entrar con mi cuenta Terry-App
          </a>
        )}
      </form>
      <Modo />
    </AuthLayout>
  );
}

/** Llegada desde el portal Terry-App con un pase (entrada única): entra sin pedir contraseña ni código otra vez. */
export function EntradaPortal({ pase, alTerminar }: { pase: string; alTerminar: () => void }) {
  const [err, setErr] = useState('');
  const hecho = useRef(false);
  const terminar = useRef(alTerminar);
  terminar.current = alTerminar;
  useEffect(() => {
    if (hecho.current) return; // el pase sirve una sola vez
    hecho.current = true;
    ingresarConPortal(pase)
      .then(() => { location.replace('#inicio'); terminar.current(); })
      .catch((x) => setErr(x instanceof ErrorApi ? x.message : 'No se pudo entrar desde el portal. Intente de nuevo.'));
  }, [pase]);
  return (
    <AuthLayout>
      <MarcaTerryApp />
      {err ? (
        <div className="mt-8 flex flex-col gap-4">
          <p className="rounded-lg bg-bad/10 px-3 py-2 text-[13px] text-bad" role="alert">{err}</p>
          {PORTAL_URL && <a href={PORTAL_URL} className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-brand px-5 text-base font-medium text-on-brand hover:bg-brand/90"><LayoutGrid size={18} /> Volver al portal Terry-App</a>}
          <Button size="lg" onClick={() => { location.replace('#login'); terminar.current(); }}>Ingresar con la cuenta de Residuos</Button>
        </div>
      ) : (
        <p className="mt-8 flex items-center gap-2 text-muted"><Loader2 size={18} className="animate-spin text-brand" /> Entrando desde el portal Terry-App…</p>
      )}
    </AuthLayout>
  );
}

export function Recuperar() {
  const { go } = useRouter();
  const [sent, setSent] = useState(false);
  // Sin correo configurado (SMTP), el enlace no puede llegar: el administrador lo entrega desde Usuarios y roles
  const [correo, setCorreo] = useState(true);
  useEffect(() => {
    if (!MODO_REAL) return;
    fetch(`${API_URL}/auth/opciones`).then((r) => r.json()).then((d: { correo?: boolean }) => setCorreo(d.correo !== false)).catch(() => undefined);
  }, []);
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    if (MODO_REAL) { try { await api('/auth/recuperar', { cuerpo: { email } }); } catch (x) { return setErr(x instanceof ErrorApi ? x.message : 'No se pudo enviar.'); } }
    setSent(true);
  };
  return (
    <AuthLayout>
      <button onClick={() => go('login')} className="mb-6 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-fg"><ArrowLeft size={16} /> Volver a ingresar</button>
      <h2 className="font-display text-2xl font-bold text-brand-strong">Recuperar contraseña</h2>
      {!correo ? (
        <div className="mt-6 rounded-xl border border-line bg-surface-2 p-5">
          <KeyRound className="text-brand" />
          <p className="mt-3 font-medium">Pídale el enlace a su administrador</p>
          <p className="mt-1 text-muted">El envío de correos de la plataforma todavía no está activo. El administrador de Terry-App puede generarle un enlace para crear su contraseña desde <b>Usuarios y roles</b> y enviárselo por WhatsApp.</p>
        </div>
      ) : sent ? (
        <div className="mt-6 rounded-xl border border-line bg-surface p-5">
          <MailCheck className="text-ok" />
          <p className="mt-3 font-medium">Revise su correo</p>
          <p className="mt-1 text-muted">Si el correo está registrado, le llegará un enlace para crear una contraseña nueva. Sirve una sola vez y vence en 30 minutos.</p>
        </div>
      ) : (
        <form className="mt-6 flex flex-col gap-4" onSubmit={submit}>
          <p className="text-muted">Escriba su correo y le enviaremos un enlace para crear una contraseña nueva.</p>
          <Field label="Correo" id="rec-email"><Input id="rec-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@terravivasas.com" /></Field>
          {err && <p className="rounded-lg bg-bad/10 px-3 py-2 text-[13px] text-bad" role="alert">{err}</p>}
          <Button variant="primary" size="lg" type="submit">Enviar enlace</Button>
        </form>
      )}
    </AuthLayout>
  );
}

/** Se abre desde el enlace del correo: …/?token=XXXX#restablecer */
export function Restablecer() {
  const { go } = useRouter();
  const token = new URLSearchParams(location.search).get('token') ?? '';
  const [c1, setC1] = useState(''); const [c2, setC2] = useState('');
  const [err, setErr] = useState(''); const [ok, setOk] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    if (c1.length < 10 || !/[A-Za-z]/.test(c1) || !/\d/.test(c1)) return setErr('Use al menos 10 caracteres, con letras y números.');
    if (c1 !== c2) return setErr('Las dos contraseñas no coinciden.');
    if (!token) return setErr('El enlace no trae el código. Ábralo de nuevo desde el correo.');
    try { if (MODO_REAL) await api('/auth/restablecer', { cuerpo: { token, clave: c1 } }); setOk(true); }
    catch (x) { setErr(x instanceof ErrorApi ? x.message : 'No se pudo cambiar la contraseña.'); }
  };
  return (
    <AuthLayout>
      <KeyRound className="text-brand" size={28} />
      <h2 className="mt-4 font-display text-2xl font-bold text-brand-strong">Crear contraseña nueva</h2>
      {ok ? (
        <div className="mt-6 flex flex-col gap-4"><p className="text-muted">Listo. Su contraseña cambió y se cerraron las sesiones abiertas en otros equipos.</p><Button variant="primary" size="lg" onClick={() => { history.replaceState(null, '', location.pathname); go('login'); }}>Ingresar</Button></div>
      ) : (
        <form className="mt-6 flex flex-col gap-4" onSubmit={submit}>
          <Field label="Contraseña nueva" id="rs-1" hint="Mínimo 10 caracteres, con letras y números."><Input id="rs-1" type="password" autoComplete="new-password" value={c1} onChange={(e) => setC1(e.target.value)} /></Field>
          <Field label="Repítala" id="rs-2"><Input id="rs-2" type="password" autoComplete="new-password" value={c2} onChange={(e) => setC2(e.target.value)} /></Field>
          {err && <p className="rounded-lg bg-bad/10 px-3 py-2 text-[13px] text-bad" role="alert">{err}</p>}
          <Button variant="primary" size="lg" type="submit">Guardar contraseña</Button>
        </form>
      )}
      <p className="mt-8 flex items-center gap-2 text-[12px] text-subtle"><ShieldCheck size={14} /> Por seguridad, el enlace sirve una sola vez.</p>
    </AuthLayout>
  );
}
