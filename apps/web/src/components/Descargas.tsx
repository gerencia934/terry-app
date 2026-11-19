// «Descargas» de la barra superior: los archivos pesados que pidió el usuario (ZIP de certificados, Excel) mientras se
// preparan aparte, y el botón para descargarlos cuando están listos (enlace firmado de 5 minutos).
import { useCallback, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, Hourglass, Loader2 } from 'lucide-react';
import { Badge, Button, Sheet, useToast } from './ui';
import { descargarTrabajo, enCola, useTrabajos, type Trabajo } from '../lib/trabajos';
import { fechaHoraCo, msg } from '../lib/servidor';

const tamano = (b: number | null) => (b === null ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1).replace('.', ',')} MB`);

function Estado({ t }: { t: Trabajo }) {
  if (enCola(t)) return <Badge tone="info"><Loader2 size={11} className="animate-spin" /> Preparando</Badge>;
  if (t.estado === 'LISTO') return <Badge tone="ok"><CheckCircle2 size={11} /> Listo</Badge>;
  if (t.estado === 'FALLIDO') return <Badge tone="bad"><AlertTriangle size={11} /> No se pudo</Badge>;
  return <Badge>Vencido</Badge>;
}

export function Descargas() {
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const alTerminar = useCallback((t: Trabajo) => {
    if (t.estado === 'LISTO') toast(`Listo: ${t.titulo}. Se está descargando.`, 'ok');
    else if (t.estado === 'FALLIDO') toast(`No se pudo preparar «${t.titulo}»: ${t.error ?? 'intente de nuevo'}`, 'warn');
  }, [toast]);
  const { trabajos } = useTrabajos(alTerminar);
  const xs = trabajos ?? [];
  const pendientes = xs.filter(enCola).length;
  const sinBajar = xs.filter((t) => t.estado === 'LISTO' && !t.descargadoEn).length;
  const bajar = (t: Trabajo) => descargarTrabajo(t.id).catch((e) => toast(msg(e), 'warn'));
  return (
    <>
      <button onClick={() => setAbierto(true)} className="relative rounded-lg p-2 text-muted hover:bg-surface-2" aria-label={`Descargas${pendientes ? ` (${pendientes} en preparación)` : ''}`} title="Descargas">
        {pendientes ? <Hourglass size={19} className="text-info" /> : <Download size={19} />}
        {(pendientes > 0 || sinBajar > 0) && <span className={`num absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white ${pendientes ? 'bg-info' : 'bg-ok'}`}>{pendientes || sinBajar}</span>}
      </button>
      <Sheet open={abierto} onClose={() => setAbierto(false)} title={<span className="flex items-center gap-2"><Download size={18} className="text-brand" />Descargas</span>}>
        <p className="mb-4 text-[13px] text-muted">Los archivos grandes (certificados en ZIP, Excel) se preparan aparte para no detener su trabajo. Cuando están listos se descargan solos; si cerró la página, descárguelos aquí durante 7 días.</p>
        {!xs.length ? <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-[13px] text-muted">Aún no ha pedido archivos.</p> : (
          <ul className="flex flex-col gap-2">
            {xs.map((t) => (
              <li key={t.id} className="flex flex-col gap-1.5 rounded-xl border border-line p-3 text-[13px]">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{t.titulo}</span>
                  <Estado t={t} />
                </div>
                <span className="text-[12px] text-subtle">Pedido el {fechaHoraCo(t.creadoEn)}{t.bytes ? ` · ${tamano(t.bytes)}` : ''}{t.estado === 'LISTO' && t.venceEn ? ` · disponible hasta el ${fechaHoraCo(t.venceEn)}` : ''}</span>
                {t.estado === 'FALLIDO' && t.error && <span className="text-[12px] text-bad">{t.error}</span>}
                {t.estado === 'LISTO' && <Button size="sm" className="self-start" onClick={() => bajar(t)}><Download size={14} /> Descargar{t.nombre ? ` ${t.nombre}` : ''}</Button>}
              </li>
            ))}
          </ul>
        )}
      </Sheet>
    </>
  );
}
