// Pantalla obligatoria para el personal de Terra Viva que aún no configura la verificación en dos pasos (como la de
// la política de datos): mientras no la active, el servidor no le deja usar el resto del sistema.
import { useEffect } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Logo } from '../components/AppShell';
import { Inscripcion, type EstadoDobleFactor } from '../components/DobleFactor';
import { Button } from '../components/ui';
import { api, reemplazarSesion, salir, sesionActual, useSesion } from '../lib/api';

export function ConfigurarDobleFactor() {
  const s = useSesion();
  // Si ya quedó activa (por ejemplo, se recargó la página mientras miraba los códigos de respaldo), solo se quita la marca
  useEffect(() => {
    api<EstadoDobleFactor>('/auth/yo').then((y) => {
      const actual = sesionActual();
      if (y.dobleFactor.activo && actual) reemplazarSesion({ ...actual, usuario: { ...actual.usuario, requiereConfigurar2fa: false } });
    }).catch(() => undefined);
  }, []);
  return (
    <div className="min-h-screen bg-bg px-4 py-8 sm:py-14">
      <main className="mx-auto flex max-w-xl flex-col gap-5">
        <div className="flex justify-center"><Logo className="h-12" /></div>
        <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6 shadow-sm">
          <h1 className="flex items-center gap-2 text-xl font-semibold"><ShieldCheck className="text-brand" size={24} /> Verificación en dos pasos</h1>
          <p className="text-[15px]">Hola{s ? `, ${s.usuario.nombre}` : ''}. Para proteger la información de la empresa y de los clientes, el personal de Terra Viva entra con su contraseña <b>y</b> con un código de su celular que cambia cada 30 segundos.</p>
          {/* La sesión nueva se guarda de inmediato, pero la marca sigue hasta que confirme que guardó los códigos */}
          <Inscripcion alActivar={(nueva) => reemplazarSesion({ ...nueva, usuario: { ...nueva.usuario, requiereConfigurar2fa: true } })} alTerminar={reemplazarSesion} />
          <div className="flex justify-start border-t border-line pt-3"><Button variant="ghost" onClick={() => salir()}>Salir</Button></div>
        </section>
      </main>
    </div>
  );
}
