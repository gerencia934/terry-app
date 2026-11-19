// Buscador de municipios de la DIVIPOLA del DANE (1.122): escriba parte del nombre o el código y elija.
import { useEffect, useRef, useState } from 'react';
import { MapPin, X } from 'lucide-react';
import { api } from '../lib/api';
import { cx } from '../lib/format';

export interface MunicipioBuscado { codigoDane: string; nombre: string; departamento: string }

export function BuscarMunicipio({ id, valor, onChange, disabled }: {
  id?: string; valor: MunicipioBuscado | null; onChange: (m: MunicipioBuscado | null) => void; disabled?: boolean;
}) {
  const [texto, setTexto] = useState(valor ? `${valor.nombre} (${valor.departamento})` : '');
  const [opciones, setOpciones] = useState<MunicipioBuscado[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const turno = useRef(0);
  useEffect(() => { setTexto(valor ? `${valor.nombre} (${valor.departamento})` : ''); }, [valor?.codigoDane]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!abierto) return;
    const t = ++turno.current;
    const espera = setTimeout(async () => {
      setCargando(true);
      try {
        // Con un municipio elegido, el texto es «Nombre (Departamento)»: se busca solo por el nombre
        const q = valor && texto.startsWith(valor.nombre) ? valor.nombre : texto.trim();
        const r = await api<MunicipioBuscado[]>(`/municipios?q=${encodeURIComponent(q)}`);
        if (t === turno.current) setOpciones(r);
      } catch { if (t === turno.current) setOpciones([]); } finally { if (t === turno.current) setCargando(false); }
    }, 200);
    return () => clearTimeout(espera);
  }, [texto, abierto]); // eslint-disable-line react-hooks/exhaustive-deps
  const elegir = (m: MunicipioBuscado | null) => { setTexto(m ? `${m.nombre} (${m.departamento})` : ''); setAbierto(false); onChange(m); };

  return (
    <div className="relative">
      <div className="relative">
        <MapPin size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
        <input id={id} role="combobox" aria-expanded={abierto} aria-autocomplete="list" disabled={disabled} autoComplete="off"
          className="h-10 w-full min-w-0 rounded-lg border border-line bg-surface pl-9 pr-9 text-sm text-fg placeholder:text-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:opacity-60"
          placeholder="Escriba el municipio o su código DANE" value={texto} onFocus={() => setAbierto(true)} onBlur={() => setTimeout(() => setAbierto(false), 150)}
          onChange={(e) => { setTexto(e.target.value); setAbierto(true); if (valor) onChange(null); }} />
        {(texto || valor) && !disabled && (
          <button type="button" aria-label="Quitar el municipio" onMouseDown={(e) => e.preventDefault()} onClick={() => elegir(null)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-subtle hover:text-fg"><X size={15} /></button>
        )}
      </div>
      {abierto && (
        <ul role="listbox" className="absolute left-0 right-0 top-11 z-30 max-h-64 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-xl">
          {cargando && !opciones.length && <li className="px-3 py-2 text-[13px] text-muted">Buscando…</li>}
          {!cargando && !opciones.length && <li className="px-3 py-2 text-[13px] text-muted">Sin coincidencias en la DIVIPOLA.</li>}
          {opciones.map((m) => (
            <li key={m.codigoDane} role="option" aria-selected={m.codigoDane === valor?.codigoDane}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => elegir(m)}
                className={cx('flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-surface-2', m.codigoDane === valor?.codigoDane && 'bg-brand-soft/50')}>
                <span className="min-w-0 truncate">{m.nombre} <span className="text-muted">· {m.departamento}</span></span>
                <span className="num shrink-0 text-[12px] text-muted">{m.codigoDane}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
