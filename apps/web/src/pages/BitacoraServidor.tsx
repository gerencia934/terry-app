// Bitácora de tiempos del equipo (oficina): en qué se va el tiempo de la operación (gerencia, 20-11-2026). Totales por tipo,
// persona, vehículo y ruta, con el tiempo productivo contra el tiempo muerto de cada ruta; detalle corregible; registrar
// por otra persona; y la lista de tipos. Mismo estándar que la bitácora de actividades de Mantenimiento.
import { useMemo, useState } from 'react';
import { Clock, Download, Pencil, Plus, RefreshCw, Timer, Trash2, Route as IconoRuta, Users } from 'lucide-react';
import { Badge, Button, Card, ColorBadge, Field, Input, Kpi, PageHeader, Select, Sheet, useToast } from '../components/ui';
import { ResponsiveTable } from '../components/data';
import { api, tienePermiso } from '../lib/api';
import { fmtCOP, fmtFecha } from '../lib/format';
import { hoyCo, msg, sumarDias, useApi } from '../lib/servidor';
import { descargar } from '../cargues/descargar';

interface Tipo { id: string; codigo: string; nombre: string; color: string | null; activo: boolean }
interface Registro {
  id: string; usuarioId: string; inicio: string; fin: string; minutos: number; nota: string | null; costo: number | null; fotoUrl: string | null; creadoEn: string;
  tipo: { id: string; nombre: string; color: string | null }; usuario: { id: string; nombre: string }; registradoPor: { id: string; nombre: string };
  ruta: { id: string; codigo: string } | null; vehiculo: { id: string; placa: string } | null;
}
interface Resumen {
  filas: Registro[];
  total: { minutos: number; registros: number; costo: number; rutas: { minutos: number; muerto: number; pctMuerto: number | null } };
  porTipo: { tipo: string; color: string | null; minutos: number; veces: number }[];
  porPersona: { persona: string; minutos: number; veces: number }[];
  porVehiculo: { placa: string; minutos: number; veces: number }[];
  porRuta: { id: string; codigo: string; fecha: string; placa: string | null; conductor: string | null; duracion: number | null; muerto: number; productivo: number | null; pctMuerto: number | null }[];
}
interface Persona { id: string; nombre: string }

const horas = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`);
const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hour12: false });
const lunes = (iso: string) => { const d = new Date(`${iso}T00:00:00Z`); return sumarDias(iso, -((d.getUTCDay() + 6) % 7)); };
const isoCo = (fecha: string, h: string) => `${fecha}T${h}:00-05:00`;

export function BitacoraServidor() {
  const toast = useToast();
  const [f, setF] = useState(() => ({ desde: lunes(hoyCo()), hasta: hoyCo(), usuarioId: '' }));
  const d = useApi<Resumen>(`/bitacora/equipo?desde=${f.desde}&hasta=${f.hasta}${f.usuarioId ? `&usuarioId=${f.usuarioId}` : ''}`);
  const personal = useApi<Persona[]>('/personal');
  const tiposApi = useApi<Tipo[]>(tienePermiso('configuracion.editar') ? '/bitacora/tipos/todos' : '/bitacora/tipos');
  const [editando, setEditando] = useState<Registro | 'nuevo' | null>(null);
  const [verTipos, setVerTipos] = useState(false);
  const r = d.datos;
  const personas = useMemo(() => {
    const m = new Map<string, string>((personal.datos ?? []).map((p) => [p.id, p.nombre]));
    for (const x of r?.filas ?? []) m.set(x.usuario.id, x.usuario.nombre);
    return [...m.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [personal.datos, r]);

  const borrar = async (x: Registro) => {
    if (!confirm(`¿Borrar el registro «${x.tipo.nombre}» de ${x.usuario.nombre}? Queda en la auditoría.`)) return;
    try { await api(`/bitacora/${x.id}`, { metodo: 'DELETE' }); toast('Registro borrado.'); d.recargar(); } catch (e) { toast(msg(e), 'warn'); }
  };
  const excel = async () => {
    if (!r) return;
    const ExcelJS = ((await import('exceljs')) as unknown as { default: typeof import('exceljs') }).default;
    const wb = new ExcelJS.Workbook(); wb.creator = 'Terry-App · Terra Viva';
    const hoja = (nombre: string, enc: string[], filas: (string | number | null)[][]) => {
      const ws = wb.addWorksheet(nombre); const e = ws.addRow(enc); e.font = { bold: true };
      e.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F1E0' } }; });
      for (const x of filas) ws.addRow(x);
      enc.forEach((_, i) => { ws.getColumn(i + 1).width = i === 0 ? 24 : 18; });
    };
    hoja('Detalle', ['Fecha', 'Persona', 'Tipo', 'Inicio', 'Fin', 'Minutos', 'Ruta', 'Vehículo', 'Gasto', 'Nota', 'Registró'],
      r.filas.map((x) => [x.inicio.slice(0, 10), x.usuario.nombre, x.tipo.nombre, hora(x.inicio), hora(x.fin), x.minutos, x.ruta?.codigo ?? '', x.vehiculo?.placa ?? '', x.costo, x.nota ?? '', x.registradoPor.nombre]));
    hoja('Por tipo', ['Tipo', 'Minutos', 'Veces'], r.porTipo.map((x) => [x.tipo, x.minutos, x.veces]));
    hoja('Por persona', ['Persona', 'Minutos', 'Veces'], r.porPersona.map((x) => [x.persona, x.minutos, x.veces]));
    hoja('Por ruta', ['Ruta', 'Fecha', 'Vehículo', 'Conductor', 'Duración (min)', 'Tiempo muerto (min)', 'Productivo (min)', '% muerto'],
      r.porRuta.map((x) => [x.codigo, x.fecha.slice(0, 10), x.placa ?? '', x.conductor ?? '', x.duracion, x.muerto, x.productivo, x.pctMuerto]));
    descargar(await wb.xlsx.writeBuffer() as ArrayBuffer, `bitacora-tiempos-${f.desde}-a-${f.hasta}.xlsx`);
  };

  return (
    <>
      <PageHeader eyebrow="Logística" title="Bitácora de tiempos" subtitle="Tiempos muertos y tareas que no son una recolección: trancones, esperas en portería, compras de insumos… Es el soporte real de en qué se va el tiempo de la operación."
        actions={<>
          <Button onClick={() => d.recargar()}><RefreshCw size={16} /> Actualizar</Button>
          <Button onClick={excel} disabled={!r}><Download size={16} /> Excel</Button>
          {tienePermiso('configuracion.editar') && <Button onClick={() => setVerTipos(true)}>Tipos</Button>}
          <Button variant="primary" onClick={() => setEditando('nuevo')}><Plus size={16} /> Registrar tiempo</Button>
        </>} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Desde" id="bt-d"><Input id="bt-d" type="date" value={f.desde} onChange={(e) => setF((x) => ({ ...x, desde: e.target.value }))} /></Field>
        <Field label="Hasta" id="bt-h"><Input id="bt-h" type="date" value={f.hasta} onChange={(e) => setF((x) => ({ ...x, hasta: e.target.value }))} /></Field>
        <Field label="Persona" id="bt-p"><Select id="bt-p" value={f.usuarioId} onChange={(e) => setF((x) => ({ ...x, usuarioId: e.target.value }))}><option value="">Todo el equipo</option>{personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</Select></Field>
      </div>
      {d.error && <p className="mb-4 rounded-xl bg-bad/10 p-4 text-bad">{d.error}</p>}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Tiempo registrado" value={r ? horas(r.total.minutos) : '…'} icon={<Clock size={16} />} hint={r ? `${r.total.registros} registros` : undefined} />
        <Kpi label="Tiempo muerto en rutas" value={r?.total.rutas.pctMuerto != null ? `${r.total.rutas.pctMuerto} %` : '—'} icon={<IconoRuta size={16} />} hint={r ? `${horas(r.total.rutas.muerto)} de ${horas(r.total.rutas.minutos)} en ruta` : undefined} />
        <Kpi label="Lo que más tiempo toma" value={r?.porTipo[0]?.tipo ?? '—'} icon={<Timer size={16} />} hint={r?.porTipo[0] ? horas(r.porTipo[0].minutos) : undefined} />
        <Kpi label="Gastos registrados" value={r ? fmtCOP(r.total.costo) : '…'} icon={<Users size={16} />} hint="Compras de insumos y otros" />
      </div>
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card title="Por tipo"><ul className="flex flex-col gap-2 text-[13px]">{(r?.porTipo ?? []).map((x) => (
          <li key={x.tipo} className="flex items-center justify-between gap-2"><ColorBadge color={x.color ?? '#667085'}>{x.tipo}</ColorBadge><span className="num whitespace-nowrap">{horas(x.minutos)} · {x.veces}</span></li>))}
          {!r?.porTipo.length && <li className="text-muted">Sin registros en el periodo.</li>}</ul></Card>
        <Card title="Por persona"><ul className="flex flex-col gap-2 text-[13px]">{(r?.porPersona ?? []).map((x) => (
          <li key={x.persona} className="flex items-center justify-between gap-2"><span className="truncate">{x.persona}</span><span className="num whitespace-nowrap">{horas(x.minutos)} · {x.veces}</span></li>))}
          {!r?.porPersona.length && <li className="text-muted">—</li>}</ul></Card>
        <Card title="Por vehículo"><ul className="flex flex-col gap-2 text-[13px]">{(r?.porVehiculo ?? []).map((x) => (
          <li key={x.placa} className="flex items-center justify-between gap-2"><span className="num font-medium">{x.placa}</span><span className="num whitespace-nowrap">{horas(x.minutos)} · {x.veces}</span></li>))}
          {!r?.porVehiculo.length && <li className="text-muted">—</li>}</ul></Card>
      </div>
      <Card title="Rutas: tiempo productivo contra tiempo muerto" className="mb-4" pad={false}>
        <ResponsiveTable rows={r?.porRuta ?? []} rowKey={(x) => x.id} empty="Sin rutas en el periodo." cardTitle={(x) => `${x.codigo} · ${fmtFecha(x.fecha)}`}
          cardMeta={(x) => `${x.placa ?? ''} · muerto ${horas(x.muerto)}${x.pctMuerto != null ? ` (${x.pctMuerto} %)` : ''}`}
          columns={[
            { key: 'r', header: 'Ruta', render: (x) => <span className="num font-medium">{x.codigo}</span>, priority: 3 },
            { key: 'f', header: 'Fecha', render: (x) => fmtFecha(x.fecha), priority: 2 },
            { key: 'v', header: 'Vehículo', render: (x) => x.placa ?? '—', priority: 2 },
            { key: 'c', header: 'Conductor', render: (x) => x.conductor ?? '—', priority: 1 },
            { key: 'd', header: 'En ruta', align: 'right', render: (x) => (x.duracion === null ? '—' : horas(x.duracion)), priority: 2 },
            { key: 'p', header: 'Productivo', align: 'right', render: (x) => (x.productivo === null ? '—' : horas(x.productivo)), priority: 2 },
            { key: 'm', header: 'Muerto', align: 'right', render: (x) => horas(x.muerto), priority: 3 },
            { key: 'pc', header: '% muerto', align: 'right', render: (x) => (x.pctMuerto === null ? '—' : <Badge tone={x.pctMuerto > 30 ? 'bad' : x.pctMuerto > 15 ? 'warn' : 'ok'}>{x.pctMuerto} %</Badge>), priority: 3 },
          ]} />
      </Card>
      <Card title="Detalle" pad={false}>
        <ResponsiveTable rows={r?.filas ?? []} rowKey={(x) => x.id} empty={d.cargando ? 'Cargando…' : 'Sin registros en el periodo.'}
          cardTitle={(x) => `${x.tipo.nombre} · ${horas(x.minutos)}`} cardMeta={(x) => `${x.usuario.nombre} · ${fmtFecha(x.inicio)} ${hora(x.inicio)}–${hora(x.fin)}`}
          columns={[
            { key: 'f', header: 'Fecha', render: (x) => <span className="num whitespace-nowrap">{fmtFecha(x.inicio)} · {hora(x.inicio)}–{hora(x.fin)}</span>, priority: 3 },
            { key: 'p', header: 'Persona', render: (x) => x.usuario.nombre, priority: 3 },
            { key: 't', header: 'Tipo', render: (x) => <ColorBadge color={x.tipo.color ?? '#667085'}>{x.tipo.nombre}</ColorBadge>, priority: 3 },
            { key: 'm', header: 'Duración', align: 'right', render: (x) => <span className="num">{horas(x.minutos)}</span>, priority: 3 },
            { key: 'r', header: 'Ruta / vehículo', render: (x) => [x.ruta?.codigo, x.vehiculo?.placa].filter(Boolean).join(' · ') || '—', priority: 2 },
            { key: 'n', header: 'Nota', render: (x) => <span className="block max-w-[260px] truncate text-muted">{[x.nota, x.costo ? fmtCOP(x.costo) : null, x.registradoPor.id !== x.usuario.id ? `registró ${x.registradoPor.nombre}` : null].filter(Boolean).join(' · ') || '—'}</span>, priority: 1 },
            { key: 'a', header: '', render: (x) => <div className="flex gap-1"><Button size="sm" variant="ghost" aria-label="Corregir" onClick={() => setEditando(x)}><Pencil size={14} /></Button>
              <Button size="sm" variant="ghost" aria-label="Borrar" onClick={() => borrar(x)}><Trash2 size={14} /></Button></div>, priority: 3 },
          ]} />
      </Card>
      {editando && <FormTiempo actual={editando === 'nuevo' ? null : editando} personas={personas} tipos={(tiposApi.datos ?? []).filter((t) => t.activo)} alCerrar={() => setEditando(null)} alGuardar={() => { setEditando(null); d.recargar(); }} />}
      {verTipos && <TiposTiempo tipos={tiposApi.datos ?? []} alCerrar={() => setVerTipos(false)} alCambiar={() => tiposApi.recargar()} />}
    </>
  );
}

/** Registrar el tiempo de alguien del equipo, o corregir uno (queda quién lo registró y la auditoría). */
function FormTiempo({ actual, personas, tipos, alCerrar, alGuardar }: { actual: Registro | null; personas: Persona[]; tipos: Tipo[]; alCerrar: () => void; alGuardar: () => void }) {
  const toast = useToast();
  const [v, setV] = useState(() => ({
    usuarioId: actual?.usuarioId ?? '', tipoId: actual?.tipo.id ?? '', fecha: actual ? actual.inicio.slice(0, 10) : hoyCo(),
    desde: actual ? hora(actual.inicio) : '', hasta: actual ? hora(actual.fin) : '', nota: actual?.nota ?? '', costo: actual?.costo ? String(actual.costo) : '',
  }));
  const [ocupado, setOcupado] = useState(false);
  const listo = (actual || v.usuarioId) && v.tipoId && v.desde && v.hasta && v.hasta >= v.desde;
  const guardar = async () => {
    setOcupado(true);
    const cuerpo = { tipoId: v.tipoId, inicio: isoCo(v.fecha, v.desde), fin: isoCo(v.fecha, v.hasta), nota: v.nota.trim() || (actual ? null : undefined), ...(v.costo ? { costo: Number(v.costo) } : actual ? { costo: null } : {}) };
    try {
      if (actual) await api(`/bitacora/${actual.id}`, { metodo: 'PATCH', cuerpo });
      else await api('/bitacora', { cuerpo: { ...cuerpo, usuarioId: v.usuarioId } });
      toast(actual ? 'Registro corregido.' : 'Tiempo registrado.'); alGuardar();
    } catch (e) { toast(msg(e), 'warn'); } finally { setOcupado(false); }
  };
  return (
    <Sheet open onClose={alCerrar} title={actual ? `Corregir: ${actual.usuario.nombre}` : 'Registrar tiempo'}
      footer={<><Button onClick={alCerrar}>Cancelar</Button><Button variant="primary" disabled={!listo || ocupado} onClick={guardar}>{ocupado ? 'Guardando…' : 'Guardar'}</Button></>}>
      <div className="flex flex-col gap-3">
        {!actual && <Field label="Persona" id="ft-p"><Select id="ft-p" value={v.usuarioId} onChange={(e) => setV((x) => ({ ...x, usuarioId: e.target.value }))}><option value="">Elija…</option>{personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</Select></Field>}
        <Field label="Tipo" id="ft-t"><Select id="ft-t" value={v.tipoId} onChange={(e) => setV((x) => ({ ...x, tipoId: e.target.value }))}><option value="">Elija…</option>{tipos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</Select></Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Fecha" id="ft-f"><Input id="ft-f" type="date" value={v.fecha} onChange={(e) => setV((x) => ({ ...x, fecha: e.target.value }))} /></Field>
          <Field label="Desde" id="ft-d"><Input id="ft-d" type="time" value={v.desde} onChange={(e) => setV((x) => ({ ...x, desde: e.target.value }))} /></Field>
          <Field label="Hasta" id="ft-h"><Input id="ft-h" type="time" value={v.hasta} onChange={(e) => setV((x) => ({ ...x, hasta: e.target.value }))} /></Field>
        </div>
        {v.desde && v.hasta && v.hasta < v.desde && <p className="text-[13px] text-bad">La hora final no puede ser antes de la inicial.</p>}
        <Field label="Nota" id="ft-n"><Input id="ft-n" value={v.nota} maxLength={500} onChange={(e) => setV((x) => ({ ...x, nota: e.target.value }))} /></Field>
        <Field label="Gasto en pesos (opcional)" id="ft-c"><Input id="ft-c" inputMode="numeric" value={v.costo} onChange={(e) => setV((x) => ({ ...x, costo: e.target.value.replace(/\D/g, '').slice(0, 10) }))} /></Field>
      </div>
    </Sheet>
  );
}

/** Lista de tipos de tiempo (configurable): agregar, renombrar o inactivar (los registros que ya los usan se conservan). */
function TiposTiempo({ tipos, alCerrar, alCambiar }: { tipos: Tipo[]; alCerrar: () => void; alCambiar: () => void }) {
  const toast = useToast();
  const [nuevo, setNuevo] = useState('');
  const [color, setColor] = useState('#1F5E3B');
  const accion = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok); alCambiar(); } catch (e) { toast(msg(e), 'warn'); } };
  return (
    <Sheet open onClose={alCerrar} title="Tipos de tiempo">
      <div className="flex flex-col gap-2">
        {tipos.map((t) => (
          <div key={t.id} className="flex items-center justify-between gap-2 rounded-lg p-2 ring-1 ring-line">
            <ColorBadge color={t.color ?? '#667085'}>{t.nombre}</ColorBadge>
            <Button size="sm" onClick={() => accion(() => api(`/bitacora/tipos/${t.id}`, { metodo: 'PATCH', cuerpo: { activo: !t.activo } }), t.activo ? 'Tipo inactivado.' : 'Tipo activado.')}>{t.activo ? 'Inactivar' : 'Activar'}</Button>
          </div>
        ))}
        <div className="mt-2 grid grid-cols-[1fr_auto_auto] items-end gap-2">
          <Field label="Tipo nuevo" id="tt-n"><Input id="tt-n" value={nuevo} maxLength={150} onChange={(e) => setNuevo(e.target.value)} placeholder="Ej.: Lavado del vehículo" /></Field>
          <input type="color" aria-label="Color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 w-12 rounded-lg ring-1 ring-line" />
          <Button variant="primary" disabled={nuevo.trim().length < 3} onClick={() => accion(() => api('/bitacora/tipos', { cuerpo: { nombre: nuevo.trim(), color: color.toUpperCase() } }), 'Tipo agregado.').then(() => setNuevo(''))}><Plus size={16} /></Button>
        </div>
      </div>
    </Sheet>
  );
}
