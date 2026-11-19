// Asignación masiva (documentos reales, planilla DMR): los mismos servicios estándar del catálogo propio para muchos
// clientes de una vez, con valores por defecto. Reemplaza la planilla de cientos de filas.
import { useEffect, useState } from 'react';
import { Layers, Plus } from 'lucide-react';
import { Badge, Button, Field, Input, Select, Sheet, useToast } from '../../components/ui';
import { api, tienePermiso } from '../../lib/api';
import { cx } from '../../lib/format';
import { msg, useApi } from '../../lib/servidor';
import type { ClienteBuscado } from '../../components/BuscarCliente';

interface Servicio { id: string; codigo: string; nombre: string; lineaServicio: { codigo: string; nombre: string } | null }
interface Catalogos { lineas: { id: string; codigo: string; nombre: string }[]; metricasPrecio: { id: string; codigo: string; nombre: string }[] }
interface Resultado { creadas: number; autorizadas: number; omitidas: { cliente: string; servicio: string; motivo: string }[] }

export function AsignacionMasiva({ abierta, onClose, onListo }: { abierta: boolean; onClose: () => void; onListo: () => void }) {
  const toast = useToast();
  // Búsqueda de clientes en el servidor (con 2.000 clientes no se carga la lista entera)
  const servicios = useApi<Servicio[]>(abierta ? '/declaraciones/catalogo-servicios' : null);
  const cat = useApi<Catalogos>(abierta ? '/declaraciones/catalogos' : null);
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [clientesSel, setClientesSel] = useState<Map<string, ClienteBuscado>>(new Map());
  const [q, setQ] = useState('');
  const [qBuscar, setQBuscar] = useState('');
  useEffect(() => { const t = setTimeout(() => setQBuscar(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const busqueda = useApi<{ total: number; filas: ClienteBuscado[] }>(abierta ? `/clientes?porPagina=50${qBuscar ? `&q=${encodeURIComponent(qBuscar)}` : ''}` : null);
  const [f, setF] = useState({ alcance: 'TODAS', frecuencia: '', automatica: false, precio: '', metricaId: '', autorizar: false });
  const [nuevo, setNuevo] = useState<{ codigo: string; nombre: string; lineaServicioId: string } | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { if (abierta) { setElegidos(new Set()); setClientesSel(new Map()); setQ(''); setResultado(null); setNuevo(null);
    setF({ alcance: 'TODAS', frecuencia: '', automatica: false, precio: '', metricaId: '', autorizar: false }); } }, [abierta]);
  const visibles = busqueda.datos?.filas ?? [];
  const total = elegidos.size * clientesSel.size;
  const puedeAutorizar = tienePermiso('declaraciones.autorizar');
  const toggle = (set: Set<string>, id: string) => { const n = new Set(set); n.has(id) ? n.delete(id) : n.add(id); return n; };

  const crearServicio = async () => {
    if (!nuevo) return;
    try {
      const s = await api<Servicio>('/declaraciones/catalogo-servicios', { cuerpo: nuevo });
      toast(`Servicio ${s.nombre} agregado al catálogo.`); setNuevo(null); await servicios.recargar(); setElegidos((x) => new Set(x).add(s.id));
    } catch (e) { toast(msg(e), 'warn'); }
  };
  const asignar = async () => {
    setOcupado(true);
    try {
      const r = await api<Resultado>('/declaraciones/asignacion-masiva', { cuerpo: {
        catalogoIds: [...elegidos], clienteIds: [...clientesSel.keys()], alcanceSedes: f.alcance,
        frecuenciaDias: f.frecuencia ? Number(f.frecuencia) : undefined, solicitudAutomatica: f.automatica && !!f.frecuencia,
        precio: f.precio !== '' ? { precioUnitario: Number(f.precio), metricaId: f.metricaId || null } : undefined,
        autorizar: f.autorizar,
      } });
      setResultado(r); onListo();
      toast(`${r.creadas} ${r.creadas === 1 ? 'declaración creada' : 'declaraciones creadas'}${r.autorizadas ? ` y ${r.autorizadas} autorizadas` : ''}.`);
    } catch (e) { toast(msg(e), 'warn'); } finally { setOcupado(false); }
  };

  return (
    <Sheet open={abierta} onClose={onClose} title="Asignar servicios a varios clientes"
      footer={resultado
        ? <Button variant="primary" onClick={onClose}>Listo</Button>
        : <><Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" disabled={ocupado || !total || (f.autorizar && f.precio === '')} onClick={asignar}><Layers size={16} /> Asignar{total ? ` (${total})` : ''}</Button></>}>
      {resultado ? (
        <div className="flex flex-col gap-3 text-sm">
          <p className="rounded-lg bg-ok/10 px-3 py-2 text-ok"><b className="num">{resultado.creadas}</b> {resultado.creadas === 1 ? 'declaración creada' : 'declaraciones creadas'}{resultado.autorizadas ? <>, <b className="num">{resultado.autorizadas}</b> autorizadas y activas</> : ' (quedan pendientes de autorizar)'}.</p>
          {resultado.omitidas.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="font-medium">No se crearon {resultado.omitidas.length}:</p>
              <ul className="max-h-72 overflow-y-auto rounded-lg border border-line text-[13px]">
                {resultado.omitidas.map((o, i) => <li key={i} className="border-b border-line px-3 py-1.5 last:border-0"><b>{o.cliente}</b> · {o.servicio}: <span className="text-muted">{o.motivo}</span></li>)}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[13px] font-semibold uppercase tracking-[0.05em] text-muted">1. Servicios del catálogo</h3>
              {!nuevo && <Button size="sm" variant="ghost" onClick={() => setNuevo({ codigo: '', nombre: '', lineaServicioId: '' })}><Plus size={14} /> Servicio nuevo</Button>}
            </div>
            {nuevo && (
              <div className="grid grid-cols-2 gap-2 rounded-xl border border-brand/40 bg-brand-soft/30 p-3">
                <Input aria-label="Código del servicio" placeholder="Código (SV-…)" value={nuevo.codigo} maxLength={20} onChange={(e) => setNuevo({ ...nuevo, codigo: e.target.value.toUpperCase() })} />
                <Select aria-label="Línea de servicio" value={nuevo.lineaServicioId} onChange={(e) => setNuevo({ ...nuevo, lineaServicioId: e.target.value })}>
                  <option value="">Línea…</option>{cat.datos?.lineas.map((l) => <option key={l.id} value={l.id}>{l.codigo} · {l.nombre}</option>)}
                </Select>
                <Input aria-label="Nombre del servicio" className="col-span-2" placeholder="Nombre del servicio" value={nuevo.nombre} maxLength={200} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
                <div className="col-span-2 flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setNuevo(null)}>Cancelar</Button>
                  <Button size="sm" variant="primary" disabled={nuevo.codigo.length < 2 || nuevo.nombre.trim().length < 3 || !nuevo.lineaServicioId} onClick={crearServicio}>Agregar al catálogo</Button></div>
              </div>
            )}
            {servicios.cargando && !servicios.datos && <p className="text-muted">Cargando…</p>}
            <div className="flex flex-col gap-1.5">
              {servicios.datos?.map((s) => (
                <label key={s.id} className={cx('flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-[13px]', elegidos.has(s.id) ? 'border-brand bg-brand-soft/40' : 'border-line')}>
                  <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--brand))]" checked={elegidos.has(s.id)} onChange={() => setElegidos((x) => toggle(x, s.id))} />
                  <span className="min-w-0 flex-1"><span className="font-medium">{s.nombre}</span> <span className="num text-muted">{s.codigo}</span></span>
                  {s.lineaServicio && <Badge>{s.lineaServicio.codigo} · {s.lineaServicio.nombre}</Badge>}
                </label>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[13px] font-semibold uppercase tracking-[0.05em] text-muted">2. Clientes ({clientesSel.size})</h3>
              <span className="flex gap-1">
                <Button size="sm" variant="ghost" disabled={!visibles.length} onClick={() => setClientesSel((x) => new Map([...x, ...visibles.map((c) => [c.id, c] as const)]))}>Elegir los {visibles.length} de la búsqueda</Button>
                {clientesSel.size > 0 && <Button size="sm" variant="ghost" onClick={() => setClientesSel(new Map())}>Ninguno</Button>}
              </span>
            </div>
            {clientesSel.size > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {[...clientesSel.values()].slice(0, 8).map((c) => (
                  <button key={c.id} type="button" onClick={() => setClientesSel((x) => { const n = new Map(x); n.delete(c.id); return n; })} title="Quitar"
                    className="rounded-full bg-brand-soft px-2.5 py-1 text-[12px] text-brand-ink hover:bg-brand-soft/70">{c.razonSocial} ×</button>
                ))}
                {clientesSel.size > 8 && <span className="px-1 py-1 text-[12px] text-muted">y {clientesSel.size - 8} más</span>}
              </div>
            )}
            <Input aria-label="Buscar cliente" placeholder="Buscar por nombre o NIT" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="max-h-56 overflow-y-auto rounded-lg border border-line">
              {visibles.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-2.5 border-b border-line px-3 py-1.5 text-[13px] last:border-0 hover:bg-surface-2">
                  <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--brand))]" checked={clientesSel.has(c.id)} onChange={() => setClientesSel((x) => { const n = new Map(x); n.has(c.id) ? n.delete(c.id) : n.set(c.id, c); return n; })} />
                  <span className="min-w-0 flex-1 truncate">{c.razonSocial}</span><span className="num text-[12px] text-muted">{c.nit}</span>
                </label>
              ))}
              {!visibles.length && <p className="px-3 py-3 text-[13px] text-muted">{busqueda.cargando ? 'Buscando…' : 'Sin coincidencias.'}</p>}
            </div>
            {(busqueda.datos?.total ?? 0) > visibles.length && (
              <p className="text-[12px] text-muted">Se muestran <span className="num">{visibles.length}</span> de <span className="num">{busqueda.datos!.total}</span> que coinciden. Afine la búsqueda (nombre o NIT) para ver los demás; los ya elegidos se conservan.</p>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-[13px] font-semibold uppercase tracking-[0.05em] text-muted">3. Valores por defecto</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Sedes" id="am-s"><Select id="am-s" value={f.alcance} onChange={(e) => setF((s) => ({ ...s, alcance: e.target.value }))}><option value="TODAS">Todas las sedes</option><option value="PRINCIPAL">Solo la principal</option></Select></Field>
              <Field label="Frecuencia (días)" id="am-f" hint="Opcional"><Input id="am-f" type="number" min={1} max={366} value={f.frecuencia} onChange={(e) => setF((s) => ({ ...s, frecuencia: e.target.value }))} /></Field>
              <Field label="Precio (COP)" id="am-p" hint="0 si se factura por contrato"><Input id="am-p" type="number" min={0} step={100} value={f.precio} onChange={(e) => setF((s) => ({ ...s, precio: e.target.value }))} /></Field>
              <Field label="Métrica del precio" id="am-m"><Select id="am-m" value={f.metricaId} onChange={(e) => setF((s) => ({ ...s, metricaId: e.target.value }))}><option value="">Global por servicio</option>{cat.datos?.metricasPrecio.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}</Select></Field>
            </div>
            <label className={cx('flex items-center gap-2 text-sm', !f.frecuencia && 'text-subtle')}><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--brand))]" disabled={!f.frecuencia} checked={f.automatica && !!f.frecuencia} onChange={(e) => setF((s) => ({ ...s, automatica: e.target.checked }))} />Crear la solicitud automáticamente cada {f.frecuencia || 'N'} días</label>
            {puedeAutorizar && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--brand))]" checked={f.autorizar} onChange={(e) => setF((s) => ({ ...s, autorizar: e.target.checked }))} />Autorizarlas de una vez (exige el precio)</label>}
            <p className="text-[12px] text-subtle">No se duplican: si un cliente ya tiene el servicio, se omite y se explica. La responsabilidad del generador queda registrada a nombre de quien asigna.</p>
          </section>
        </div>
      )}
    </Sheet>
  );
}
