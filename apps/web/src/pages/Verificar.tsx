import { useEffect, useState, type FormEvent } from 'react';
import { BadgeCheck, Ban, SearchX, WifiOff, QrCode } from 'lucide-react';
import { Logo } from '../components/AppShell';
import { Button, DefList, Field, Input } from '../components/ui';
import { API_URL, MODO_REAL } from '../lib/api';
import { codigoVerificacion } from '../lib/router';
import { cx, fmtFecha } from '../lib/format';

interface Respuesta {
  valido: boolean; estado?: 'EMITIDA' | 'ANULADA'; numero?: string; tipo?: 'DISPOSICION' | 'APROVECHAMIENTO' | 'CONCILIACION';
  emitidaEn?: string | null; periodo?: { desde: string; hasta: string }; emisor?: { razonSocial: string; nit: string }; mensaje: string;
}
const TIPOS = { DISPOSICION: 'Certificado de tratamiento y disposición final', APROVECHAMIENTO: 'Certificado de aprovechamiento', CONCILIACION: 'Acta de conciliación de residuos' };
const CODIGO = /^[0-9a-f]{24}$/;
const fechaHora = (iso: string) => new Date(iso).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * Página pública del código QR de los certificados. No pide sesión y solo muestra lo mínimo para
 * comprobar que el documento es auténtico: número, tipo, estado, fecha y emisor. Nunca datos del generador.
 */
export default function Verificar() {
  const [codigo, setCodigo] = useState(codigoVerificacion);
  const [escrito, setEscrito] = useState(codigo);
  const [r, setR] = useState<Respuesta | 'cargando' | 'sin-conexion' | null>(null);

  useEffect(() => {
    const on = () => { const c = codigoVerificacion(); setCodigo(c); setEscrito(c); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  useEffect(() => {
    if (!CODIGO.test(codigo)) { setR(codigo ? { valido: false, mensaje: 'El código debe tener 24 caracteres (números y letras de la a a la f).' } : null); return; }
    if (!MODO_REAL) { setR({ valido: false, mensaje: 'La verificación necesita el servidor: esta es la versión de demostración.' }); return; }
    let vivo = true;
    setR('cargando');
    fetch(`${API_URL}/verificar/${codigo}`)
      .then(async (x) => { const d = await x.json().catch(() => ({})); if (vivo) setR(x.status === 429 ? { valido: false, mensaje: 'Demasiadas consultas seguidas. Intente de nuevo en un minuto.' } : { valido: false, mensaje: 'No existe un documento emitido con ese código.', ...d }); })
      .catch(() => vivo && setR('sin-conexion'));
    return () => { vivo = false; };
  }, [codigo]);

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const c = escrito.trim().toLowerCase();
    history.replaceState(null, '', `#verificar/${c}`);
    setCodigo(c);
  };
  const res = typeof r === 'object' ? r : null;
  const anulada = res?.estado === 'ANULADA';
  const icono = !res ? null : res.valido ? <BadgeCheck size={30} /> : anulada ? <Ban size={30} /> : <SearchX size={30} />;

  return (
    <div className="min-h-screen bg-bg px-4 py-8 sm:py-14">
      <main className="mx-auto flex max-w-lg flex-col gap-5">
        <header className="flex flex-col items-center gap-2 text-center">
          <Logo className="h-12" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-subtle">TERRY-GO · Verificación de documentos</p>
        </header>

        <section className="rounded-2xl border border-line bg-surface p-5 shadow-sm" aria-live="polite">
          {r === null && (
            <p className="flex items-start gap-3 text-muted"><QrCode size={22} className="mt-0.5 shrink-0 text-brand" />
              Escanee el código QR del certificado o escriba abajo el código que aparece debajo del QR.</p>
          )}
          {r === 'cargando' && <p className="py-6 text-center text-muted">Consultando…</p>}
          {r === 'sin-conexion' && (
            <p className="flex items-start gap-3 text-warn"><WifiOff size={22} className="mt-0.5 shrink-0" />No hay conexión con el servidor de verificación. Revise su internet e intente de nuevo.</p>
          )}
          {res && (
            <div className="flex flex-col gap-4">
              <div className={cx('flex items-center gap-3 rounded-xl p-4', res.valido ? 'bg-ok/10 text-ok' : anulada ? 'bg-bad/10 text-bad' : 'bg-warn/10 text-warn')}>
                {icono}
                <div className="min-w-0">
                  <p className="text-[17px] font-semibold leading-tight">{res.valido ? 'Documento auténtico y vigente' : anulada ? 'Documento anulado' : 'No verificado'}</p>
                  <p className="text-[13px]">{res.valido ? `Emitido por ${res.emisor?.razonSocial ?? 'el emisor'} y no ha sido anulado.` : res.mensaje}</p>
                </div>
              </div>
              {res.numero && (
                <DefList items={[
                  ['Número', <span className="num font-semibold">{res.numero}</span>],
                  ['Documento', res.tipo ? TIPOS[res.tipo] : '—'],
                  ['Periodo', res.periodo ? `${fmtFecha(res.periodo.desde)} a ${fmtFecha(res.periodo.hasta)}` : '—'],
                  ['Emitido', res.emitidaEn ? fechaHora(res.emitidaEn) : '—'],
                  ['Emisor', res.emisor ? `${res.emisor.razonSocial} · NIT ${res.emisor.nit}` : '—'],
                ]} />
              )}
              {res.numero && <p className="text-[12px] text-subtle">Por protección de datos, esta página no muestra la información del generador. Compare el número y el periodo con el documento que tiene en la mano.</p>}
            </div>
          )}
        </section>

        <form onSubmit={enviar} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
          <Field label="Código de verificación" id="vf-codigo" hint="24 caracteres, debajo del código QR del documento">
            <Input id="vf-codigo" value={escrito} onChange={(e) => setEscrito(e.target.value)} placeholder="Ej.: 3f9a…" autoComplete="off" spellCheck={false} className="num" />
          </Field>
          <Button variant="primary" type="submit" disabled={!escrito.trim()}>Verificar</Button>
        </form>
        <p className="text-center text-[12px] text-subtle">Terra Viva S.A.S. E.S.P.</p>
      </main>
    </div>
  );
}
