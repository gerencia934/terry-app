// Ley 1581 de 2012: autorización del titular en el primer ingreso (o cuando cambia la versión de la política).
// El texto es un resumen; la política completa la publica la gerencia (POLITICA_DATOS_URL en el servidor).
import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Logo } from '../components/AppShell';
import { Button } from '../components/ui';
import { aceptarPoliticaDatos, ErrorApi, salir, useSesion } from '../lib/api';

export default function AceptarDatos() {
  const s = useSesion();
  const [marcado, setMarcado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const politica = s?.usuario.politicaDatos;
  const aceptar = async () => {
    setOcupado(true); setError('');
    try { await aceptarPoliticaDatos(); } catch (e) { setError(e instanceof ErrorApi ? e.message : 'No se pudo registrar. Intente de nuevo.'); } finally { setOcupado(false); }
  };
  return (
    <div className="min-h-screen bg-bg px-4 py-8 sm:py-14">
      <main className="mx-auto flex max-w-xl flex-col gap-5">
        <div className="flex justify-center"><Logo className="h-12" /></div>
        <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6 shadow-sm">
          <h1 className="flex items-center gap-2 text-xl font-semibold"><ShieldCheck className="text-brand" size={24} /> Tratamiento de sus datos personales</h1>
          <p className="text-[15px]">Hola{s ? `, ${s.usuario.nombre}` : ''}. Para usar TERRY-GO, {s?.usuario.empresa.razonSocial ?? 'la empresa'} necesita su autorización para tratar sus datos personales, conforme a la Ley 1581 de 2012.</p>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[14px] text-muted">
            <li><b className="text-fg">Qué datos:</b> nombre, documento, correo, teléfono, firmas y, en la app del conductor, la ubicación solo durante la jornada.</li>
            <li><b className="text-fg">Para qué:</b> operar la gestión de residuos, cumplir obligaciones legales y ambientales y dejar constancia de lo que se hace en el sistema.</li>
            <li><b className="text-fg">Sus derechos:</b> conocer, actualizar y rectificar sus datos, y revocar la autorización cuando no exista un deber legal de conservarlos.</li>
          </ul>
          {politica?.url && <a className="text-[14px] font-medium text-brand underline" href={politica.url} target="_blank" rel="noreferrer">Leer la política completa</a>}
          <label className="flex items-start gap-2.5 rounded-lg bg-surface-2 p-3 text-[14px]">
            <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--brand))]" checked={marcado} onChange={(e) => setMarcado(e.target.checked)} />
            <span>He leído y acepto la política de tratamiento de datos personales{politica?.version ? ` (versión ${politica.version})` : ''}.</span>
          </label>
          {error && <p className="rounded-lg bg-bad/10 px-3 py-2 text-[14px] text-bad">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => salir()}>Salir</Button>
            <Button variant="primary" disabled={!marcado || ocupado} onClick={aceptar}>Aceptar y continuar</Button>
          </div>
        </section>
        <p className="text-center text-[12px] text-subtle">La aceptación queda registrada con la fecha y la IP.</p>
      </main>
    </div>
  );
}
