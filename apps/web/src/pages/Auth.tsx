import { useState, type FormEvent, type ReactNode } from 'react';
import { Eye, EyeOff, ShieldCheck, ArrowLeft, MailCheck, KeyRound, Server, FlaskConical } from 'lucide-react';
import { Button, Field, Input } from '../components/ui';
import { Logo } from '../components/AppShell';
import { useRouter } from '../lib/router';
import { EMPRESA } from '../data/mock';
import { MODO_REAL, api, ingresar, ErrorApi } from '../lib/api';
import terry from '../assets/terry.webp';

function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-full lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12" style={{ background: 'linear-gradient(160deg, #0C481E 0%, #17652E 55%, #3E9A3F 100%)' }}>
        <div className="relative z-10 max-w-md text-white">
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#B9E59B]">TERRY-GO · Trazabilidad de residuos de Terra Viva</p>
          <h1 className="mt-3 font-display text-[38px] font-bold leading-[1.1]">Cada residuo, de la sede del cliente al certificado.</h1>
          <p className="mt-4 text-[15px] leading-relaxed text-white/80">Declaraciones, recorridos, inspecciones, manifiestos, pesaje en planta y permisos ambientales, conectados en una sola cadena.</p>
        </div>
        <div className="relative z-10 flex max-w-[52%] flex-wrap gap-2">
          {EMPRESA.certificaciones.map((c) => <span key={c} className="rounded-full border border-white/25 px-3 py-1 text-[12px] text-white/90">{c}</span>)}
        </div>
        <div className="absolute -bottom-6 right-6 z-0 w-[38%] max-w-[280px] overflow-hidden rounded-t-[40px] bg-[#F3F4F3] shadow-2xl">
          <img src={terry} alt="Terry, mascota de Terra Viva" className="w-full" />
        </div>
      </aside>
      <main className="safe-x flex items-center justify-center py-10">
        <div className="w-full max-w-[400px]">{children}</div>
      </main>
    </div>
  );
}

const Modo = () => (
  <p className={`mt-8 flex items-center gap-2 text-[12px] ${MODO_REAL ? 'text-ok' : 'text-subtle'}`}>
    {MODO_REAL ? <><Server size={14} /> Conectado al servidor de TERRY-GO.</> : <><FlaskConical size={14} /> Modo demostración: cualquier correo y contraseña funcionan.</>}
  </p>
);

export function Login() {
  const { go } = useRouter();
  const [show, setShow] = useState(false);
  const [email, setEmail] = useState(MODO_REAL ? '' : 'gerencia@terravivasas.com');
  const [clave, setClave] = useState(MODO_REAL ? '' : 'demostracion');
  const [err, setErr] = useState('');
  const [enviando, setEnviando] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setErr('Escriba su correo completo, por ejemplo nombre@terravivasas.com.');
    if (!clave) return setErr('Escriba su contraseña.');
    if (!MODO_REAL) return go('inicio');
    setEnviando(true);
    try { const s = await ingresar(email, clave); go(s.usuario.rol === 'Conductor' || s.usuario.rol === 'Auxiliar' ? 'campo' : 'inicio'); }
    catch (e) { setErr(e instanceof ErrorApi ? e.message : 'No se pudo ingresar.'); }
    finally { setEnviando(false); }
  };
  return (
    <AuthLayout>
      <Logo className="h-12" />
      <h2 className="mt-8 text-2xl font-bold text-brand-strong">Ingresar</h2>
      <p className="mt-1 text-muted">Con su correo de Terra Viva. Conductores y auxiliares entran directo a su app de campo.</p>
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
      </form>
      <Modo />
    </AuthLayout>
  );
}

export function Recuperar() {
  const { go } = useRouter();
  const [sent, setSent] = useState(false);
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
      <h2 className="text-2xl font-bold text-brand-strong">Recuperar contraseña</h2>
      {sent ? (
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
      <h2 className="mt-4 text-2xl font-bold text-brand-strong">Crear contraseña nueva</h2>
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
