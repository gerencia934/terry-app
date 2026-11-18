import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, ShieldCheck, ArrowLeft, MailCheck } from 'lucide-react';
import { Button, Field, Input } from '../components/ui';
import { Logo } from '../components/AppShell';
import { useRouter } from '../lib/router';
import { EMPRESA } from '../data/mock';
import terry from '../assets/terry.webp';

function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-full lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-brand-strong lg:flex lg:flex-col lg:justify-between lg:p-12" style={{ background: 'linear-gradient(160deg, #0C481E 0%, #17652E 55%, #3E9A3F 100%)' }}>
        <div className="relative z-10 max-w-md text-white">
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#B9E59B]">Plataforma de gestión integral</p>
          <h1 className="mt-3 font-display text-[38px] font-bold leading-[1.1]">Trazabilidad de cada residuo, de la recolección al certificado.</h1>
          <p className="mt-4 text-[15px] leading-relaxed text-white/80">Declaraciones, rutas, manifiestos, conciliaciones y permisos ambientales en un solo lugar para el equipo de Terra Viva y sus conductores en campo.</p>
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

export function Login() {
  const { go } = useRouter();
  const [show, setShow] = useState(false);
  const [email, setEmail] = useState('TERRAVIVA');
  const [pass, setPass] = useState('demo2026');
  const [err, setErr] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (email.trim().length < 3) return setErr('Escriba su usuario empresarial.');
    if (pass.length < 6) return setErr('La contraseña debe tener al menos 6 caracteres.');
    go('inicio');
  };
  return (
    <AuthLayout>
      <Logo className="h-12" />
      <h2 className="mt-8 text-2xl font-bold text-brand-strong">Ingresar</h2>
      <p className="mt-1 text-muted">Use su usuario empresarial. Los conductores entran desde la app de campo.</p>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4" noValidate>
        <Field label="Usuario empresarial" id="login-email"><Input id="login-email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Contraseña" id="login-pass">
          <div className="relative">
            <Input id="login-pass" type={show ? 'text' : 'password'} autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} className="pr-11" />
            <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-1 top-1 rounded-md p-2 text-muted" aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}>{show ? <EyeOff size={17} /> : <Eye size={17} />}</button>
          </div>
        </Field>
        {err && <p className="rounded-lg bg-bad/10 px-3 py-2 text-[13px] text-bad">{err}</p>}
        <div className="flex items-center justify-between text-[13px]">
          <label className="flex items-center gap-2 text-muted"><input id="login-recordar" type="checkbox" defaultChecked className="accent-[rgb(var(--brand))]" /> Recordarme</label>
          <button type="button" onClick={() => go('recuperar')} className="font-medium text-brand hover:underline">¿Olvidó su contraseña?</button>
        </div>
        <Button variant="primary" size="lg" type="submit">Ingresar</Button>
        <Button type="button" size="lg" onClick={() => go('campo')}>Entrar como conductor</Button>
      </form>
      <p className="mt-8 flex items-center gap-2 text-[12px] text-subtle"><ShieldCheck size={14} /> Prototipo con datos de demostración. Cualquier credencial funciona.</p>
    </AuthLayout>
  );
}

export function Recuperar() {
  const { go } = useRouter();
  const [sent, setSent] = useState(false);
  return (
    <AuthLayout>
      <button onClick={() => go('login')} className="mb-6 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-fg"><ArrowLeft size={16} /> Volver a ingresar</button>
      <h2 className="text-2xl font-bold text-brand-strong">Recuperar contraseña</h2>
      {sent ? (
        <div className="mt-6 rounded-xl border border-line bg-surface p-5">
          <MailCheck className="text-ok" />
          <p className="mt-3 font-medium">Revise su correo</p>
          <p className="mt-1 text-muted">Si el correo está registrado, recibirá un enlace para crear una nueva contraseña. El enlace sirve una sola vez y vence en 30 minutos.</p>
        </div>
      ) : (
        <form className="mt-6 flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); setSent(true); }}>
          <p className="text-muted">Escriba su correo empresarial y le enviaremos un enlace de restablecimiento.</p>
          <Field label="Correo empresarial" id="rec-email"><Input id="rec-email" type="email" required placeholder="nombre@terravivasas.com" /></Field>
          <Button variant="primary" size="lg" type="submit">Enviar enlace</Button>
        </form>
      )}
    </AuthLayout>
  );
}
