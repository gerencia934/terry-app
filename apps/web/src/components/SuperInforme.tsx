import { useState } from 'react';
import { FileSpreadsheet, ShieldCheck } from 'lucide-react';
import { Button, Card, Field, Input, useToast } from './ui';
import { tienePermiso, ErrorApi } from '../lib/api';
import { pedirArchivo } from '../lib/trabajos';
import { hoyCo } from '../lib/servidor';

// Súper Informe de cumplimiento integral: el único informe de auditoría de Residuos (licencias 0632 y 0235, PDC, ICONTEC,
// MinAmbiente / IDEAM y PESV). Se prepara en la cola de trabajos y aparece en «Descargas» cuando está listo.
const MARCOS = ['Licencias 0632 · 0235', 'PDC', 'ICONTEC', 'MinAmbiente · IDEAM', 'PESV'];
const primerDiaMes = (d: string) => `${d.slice(0, 7)}-01`;
const mesAnterior = (d: string) => {
  const [y, m] = d.split('-').map(Number);
  const desde = new Date(Date.UTC(y, m - 2, 1)); const hasta = new Date(Date.UTC(y, m - 1, 0));
  return { desde: desde.toISOString().slice(0, 10), hasta: hasta.toISOString().slice(0, 10) };
};

export function SuperInforme() {
  const toast = useToast();
  const hoy = hoyCo();
  const [f, setF] = useState({ desde: primerDiaMes(hoy), hasta: hoy });
  const [enviando, setEnviando] = useState(false);
  const puede = tienePermiso('exportar.masivo');
  const atajos: { l: string; v: { desde: string; hasta: string } }[] = [
    { l: 'Este mes', v: { desde: primerDiaMes(hoy), hasta: hoy } },
    { l: 'Mes anterior', v: mesAnterior(hoy) },
    { l: 'Este año', v: { desde: `${hoy.slice(0, 4)}-01-01`, hasta: hoy } },
  ];
  const generar = async () => {
    if (!f.desde || !f.hasta || f.hasta < f.desde) return toast('Revise las fechas del periodo.');
    setEnviando(true);
    try { await pedirArchivo('/informes/super-informe', f); toast('Preparando el Súper Informe: se descarga solo cuando esté listo (también queda en Descargas).'); }
    catch (e) { toast(e instanceof ErrorApi ? e.message : 'No se pudo pedir el informe.'); }
    finally { setEnviando(false); }
  };
  return (
    <Card title={<span className="flex items-center gap-2"><ShieldCheck size={16} className="text-brand" />Súper Informe de cumplimiento</span>}>
      <p className="text-[13px] text-muted">Un solo Excel para auditorías: recolección consolidada (formato Informe General V.2), certificados, trazabilidad, despachos de peligrosos, RESPEL, PESV y licencias.</p>
      <ul className="mt-3 flex flex-wrap gap-1.5">{MARCOS.map((m) => <li key={m} className="rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-semibold text-brand-ink">{m}</li>)}</ul>
      {puede ? (
        <>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {atajos.map((a) => (
              <button key={a.l} type="button" onClick={() => setF(a.v)} aria-pressed={f.desde === a.v.desde && f.hasta === a.v.hasta}
                className="rounded-lg border border-line px-2.5 py-1 text-[12px] font-medium text-muted hover:border-brand hover:text-fg aria-pressed:border-brand aria-pressed:bg-brand-soft aria-pressed:text-brand-ink">{a.l}</button>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Desde" id="si-d"><Input id="si-d" type="date" value={f.desde} max={f.hasta} onChange={(e) => setF((s) => ({ ...s, desde: e.target.value }))} /></Field>
            <Field label="Hasta" id="si-h"><Input id="si-h" type="date" value={f.hasta} min={f.desde} max={hoy} onChange={(e) => setF((s) => ({ ...s, hasta: e.target.value }))} /></Field>
          </div>
          <Button variant="primary" className="mt-4 w-full" onClick={generar} disabled={enviando}><FileSpreadsheet size={16} />{enviando ? 'Pidiendo…' : 'Generar Súper Informe'}</Button>
        </>
      ) : <p className="mt-4 rounded-lg bg-surface-2 p-3 text-[12px] text-muted">Para generarlo se necesita el permiso de exportaciones (Gerencia, HSEQ o Calidad).</p>}
    </Card>
  );
}
