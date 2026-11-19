// Buscador de clientes con autocompletar (requisitos de producción §1: con 2.000 clientes no se carga la lista entera).
import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { api } from '../lib/api';
import { cx } from '../lib/format';

export interface ClienteBuscado { id: string; razonSocial: string; nit: string; tipo?: 'DIRECTO' | 'GESTOR' }

/**
 * Escriba parte del nombre o del NIT y elija. `valor` es el id elegido ('' = ninguno); al limpiarlo desde afuera, se
 * borra el texto. `vacio` es el texto de «ninguno» (por ejemplo, «Todos» en un filtro).
 */
export function BuscarCliente({ id, valor, onChange, vacio = 'Escriba para buscar', disabled }: {
  id?: string; valor: string; onChange: (c: ClienteBuscado | null) => void; vacio?: string; disabled?: boolean;
}) {
  const [texto, setTexto] = useState('');
  const [elegido, setElegido] = useState<ClienteBuscado | null>(null);
  const [opciones, setOpciones] = useState<ClienteBuscado[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const turno = useRef(0);
  useEffect(() => { if (!valor && elegido) { setElegido(null); setTexto(''); } }, [valor]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!abierto) return;
    const t = ++turno.current;
    const espera = setTimeout(async () => {
      setCargando(true);
      try {
        const r = await api<{ filas: ClienteBuscado[] }>(`/clientes?porPagina=20${texto.trim() ? `&q=${encodeURIComponent(texto.trim())}` : ''}`);
        if (t === turno.current) setOpciones(r.filas);
      } catch { if (t === turno.current) setOpciones([]); } finally { if (t === turno.current) setCargando(false); }
    }, 250);
    return () => clearTimeout(espera);
  }, [texto, abierto]);
  const elegir = (c: ClienteBuscado | null) => { setElegido(c); setTexto(c ? c.razonSocial : ''); setAbierto(false); onChange(c); };

  return (
    <div className="relative">
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
        <input id={id} role="combobox" aria-expanded={abierto} aria-autocomplete="list" disabled={disabled} autoComplete="off"
          className="h-10 w-full min-w-0 rounded-lg border border-line bg-surface pl-9 pr-9 text-sm text-fg placeholder:text-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:opacity-60"
          placeholder={vacio} value={texto} onFocus={() => setAbierto(true)} onBlur={() => setTimeout(() => setAbierto(false), 150)}
          onChange={(e) => { setTexto(e.target.value); setAbierto(true); if (elegido) { setElegido(null); onChange(null); } }} />
        {(texto || elegido) && !disabled && (
          <button type="button" aria-label="Quitar el cliente" onMouseDown={(e) => e.preventDefault()} onClick={() => elegir(null)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-subtle hover:text-fg"><X size={15} /></button>
        )}
      </div>
      {abierto && (
        <ul role="listbox" className="absolute left-0 right-0 top-11 z-30 max-h-64 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-xl">
          {cargando && !opciones.length && <li className="px-3 py-2 text-[13px] text-muted">Buscando…</li>}
          {!cargando && !opciones.length && <li className="px-3 py-2 text-[13px] text-muted">Sin coincidencias.</li>}
          {opciones.map((c) => (
            <li key={c.id} role="option" aria-selected={c.id === valor}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => elegir(c)}
                className={cx('flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-surface-2', c.id === valor && 'bg-brand-soft/50')}>
                <span className="min-w-0 truncate">{c.razonSocial}{c.tipo === 'GESTOR' && <span className="ml-1.5 text-[11px] text-info">gestor</span>}</span>
                <span className="num shrink-0 text-[12px] text-muted">{c.nit}</span>
              </button>
            </li>
          ))}
          {opciones.length === 20 && <li className="px-3 py-1.5 text-[12px] text-subtle">Hay más: siga escribiendo para afinar.</li>}
        </ul>
      )}
    </div>
  );
}
