// Ajustes › Roles y permisos (20-11-2026, pedido de la gerencia, como los roles de Grinclic). Cada rol tiene un acceso
// al sistema que no cambia (empresa, campo o portal de clientes: el portal es aparte, con sus propias funciones), un
// estado, una descripción y las funciones que se le otorgan, agrupadas por módulo y explicadas una por una. Los
// predeterminados vienen marcados y se pueden ajustar o restaurar; se crean roles nuevos desde cero o copiando otro.
import { useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, Check, Copy, KeyRound, Loader2, Lock, Plus, RotateCcw, ShieldCheck, Trash2, Users } from 'lucide-react';
import { Badge, Button, Card, Field, Input, PageHeader, Tabs, useToast } from '../components/ui';
import { ErrorApi, api } from '../lib/api';
import { fechaHoraCo, useApi } from '../lib/servidor';
import { cx } from '../lib/format';

type Acceso = 'OFICINA' | 'CAMPO' | 'CLIENTE';
interface Funcion { codigo: string; nombre: string; descripcion: string; accesos: Acceso[] }
interface Modulo { clave: string; nombre: string; permisos: Funcion[] }
interface Catalogo {
  accesos: Record<Acceso, { nombre: string; tipo: 'Interno' | 'Externo'; descripcion: string }>;
  modulos: Modulo[]; predeterminados: { clave: string; nombre: string; permisos: string[] }[];
}
interface Rol {
  id: string; nombre: string; clave: string | null; descripcion: string | null; acceso: Acceso; activo: boolean; predeterminado: boolean;
  createdAt: string; updatedAt: string; permisos: string[]; usuariosActivos: number; usuarios: number;
}
const ORDEN: Acceso[] = ['OFICINA', 'CAMPO', 'CLIENTE'];
const modulosDe = (c: Catalogo, acceso: Acceso) => c.modulos.map((m) => ({ ...m, permisos: m.permisos.filter((p) => p.accesos.includes(acceso)) })).filter((m) => m.permisos.length);
const totalDe = (c: Catalogo, acceso: Acceso) => modulosDe(c, acceso).reduce((s, m) => s + m.permisos.length, 0);
function mensaje(e: unknown, def: string) {
  if (!(e instanceof ErrorApi)) return def;
  const d = (e.datos as { detalles?: { campo: string; mensaje: string }[] } | undefined)?.detalles;
  return d?.length ? d.map((x) => x.mensaje).join(' · ') : e.message;
}

export function RolesServidor() {
  const cat = useApi<Catalogo>('/roles/catalogo');
  const roles = useApi<Rol[]>('/roles');
  const [acceso, setAcceso] = useState<Acceso>('OFICINA');
  const [abierto, setAbierto] = useState<null | { rol?: Rol; nuevo?: { acceso: Acceso; base?: Rol } }>(null);
  const c = cat.datos;
  if (cat.error || roles.error) return <p className="rounded-xl bg-bad/10 p-4 text-bad">{cat.error || roles.error}</p>;
  if (!c || !roles.datos) return <p className="flex items-center gap-2 p-6 text-muted"><Loader2 size={16} className="animate-spin" />Cargando roles…</p>;
  const listo = () => { setAbierto(null); roles.recargar(); };
  // La clave hace que «Copiar como rol nuevo» abra un formulario limpio (y no el estado del rol que se estaba viendo)
  if (abierto) return <EditorRol key={abierto.rol?.id ?? `nuevo-${abierto.nuevo?.base?.id ?? abierto.nuevo?.acceso}`} c={c} rol={abierto.rol} nuevo={abierto.nuevo} roles={roles.datos} volver={() => setAbierto(null)} listo={listo}
    copiar={(r) => setAbierto({ nuevo: { acceso: r.acceso, base: r } })} />;
  const deAcceso = roles.datos.filter((r) => r.acceso === acceso);
  return (
    <>
      <PageHeader eyebrow="Ajustes" title="Roles y permisos"
        subtitle="Qué puede hacer cada persona en Terry-App. Cada rol tiene un acceso: la empresa (oficina), el campo (conductores, auxiliares y planta) o el portal de clientes, que es aparte y tiene sus propias funciones. Los roles predeterminados vienen con sus funciones marcadas: ajústelos o cree roles nuevos."
        actions={<Button variant="primary" onClick={() => setAbierto({ nuevo: { acceso } })}><Plus size={16} /> Nuevo rol</Button>} />
      <div className="mb-4"><Tabs value={acceso} onChange={setAcceso} items={ORDEN.map((a) => ({ value: a, label: c.accesos[a].nombre, count: roles.datos!.filter((r) => r.acceso === a).length }))} /></div>
      <p className="mb-4 flex items-start gap-2 rounded-xl bg-surface-2 px-4 py-3 text-[13px] text-muted"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-brand" />
        <span><b className="text-fg">{c.accesos[acceso].nombre}</b> · tipo {c.accesos[acceso].tipo.toLowerCase()}. {c.accesos[acceso].descripcion} {totalDe(c, acceso)} funciones disponibles.</span></p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {deAcceso.map((r) => {
          const total = totalDe(c, r.acceso);
          const marcadas = r.permisos.includes('*') ? total : r.permisos.filter((p) => modulosDe(c, r.acceso).some((m) => m.permisos.some((x) => x.codigo === p))).length;
          return (
            <button key={r.id} onClick={() => setAbierto({ rol: r })} className={cx('flex flex-col gap-2 rounded-xl border p-4 text-left text-[13px] transition-colors hover:border-brand/40 hover:bg-surface-2',
              r.activo ? 'border-line bg-surface' : 'border-dashed border-line opacity-75')}>
              <span className="flex items-start gap-2">
                <span className="rounded-lg bg-brand-soft p-2 text-brand-ink"><KeyRound size={16} /></span>
                <span className="min-w-0 flex-1"><span className="block font-semibold leading-snug">{r.nombre}</span>
                  <span className="text-[12px] text-muted">{r.permisos.includes('*') ? 'Acceso total' : `${marcadas} de ${total} funciones`}</span></span>
                {r.predeterminado && <Badge tone="brand">Predeterminado</Badge>}
                {!r.activo && <Badge>Inactivo</Badge>}
              </span>
              {r.descripcion && <span className="text-muted">{r.descripcion}</span>}
              <span className="mt-auto flex items-center gap-1.5 pt-1 text-[12px] text-subtle"><Users size={13} />{r.usuariosActivos === 1 ? '1 persona activa' : `${r.usuariosActivos} personas activas`}</span>
            </button>
          );
        })}
        {!deAcceso.length && <p className="rounded-xl border border-dashed border-line p-6 text-center text-muted md:col-span-2 xl:col-span-3">Aún no hay roles con este acceso.</p>}
      </div>
    </>
  );
}

function EditorRol({ c, rol, nuevo, roles, volver, listo, copiar }: {
  c: Catalogo; rol?: Rol; nuevo?: { acceso: Acceso; base?: Rol }; roles: Rol[]; volver: () => void; listo: () => void; copiar: (r: Rol) => void;
}) {
  const toast = useToast();
  const [acceso, setAcceso] = useState<Acceso>(rol?.acceso ?? nuevo?.acceso ?? 'OFICINA');
  const [nombre, setNombre] = useState(rol?.nombre ?? (nuevo?.base ? `${nuevo.base.nombre} (copia)` : ''));
  const [descripcion, setDescripcion] = useState(rol?.descripcion ?? nuevo?.base?.descripcion ?? '');
  const [activo, setActivo] = useState(rol?.activo ?? true);
  const [marcadas, setMarcadas] = useState<string[]>(rol?.permisos ?? nuevo?.base?.permisos ?? []);
  const [ocupado, setOcupado] = useState<'' | 'guardar' | 'restaurar' | 'eliminar'>('');
  const administrador = rol?.clave === 'ADMINISTRADOR';
  const modulos = useMemo(() => modulosDe(c, acceso), [c, acceso]);
  const validos = new Set(modulos.flatMap((m) => m.permisos.map((p) => p.codigo)));
  const efectivas = marcadas.filter((p) => validos.has(p));
  const total = validos.size;
  const total_ = efectivas.includes('*') ? total : efectivas.length;
  const def = c.predeterminados.find((p) => p.clave === rol?.clave);
  const cambiar = (codigo: string) => setMarcadas((m) => (m.includes(codigo) ? m.filter((x) => x !== codigo) : [...m, codigo]));
  const todoModulo = (m: Modulo, si: boolean) => setMarcadas((x) => si ? [...new Set([...x, ...m.permisos.map((p) => p.codigo)])] : x.filter((p) => !m.permisos.some((q) => q.codigo === p)));
  const guardar = async () => {
    setOcupado('guardar');
    try {
      if (rol) await api(`/roles/${rol.id}`, { metodo: 'PATCH', cuerpo: { nombre: nombre.trim(), descripcion: descripcion.trim(), activo, ...(administrador ? {} : { permisos: efectivas }) } });
      else await api('/roles', { cuerpo: { nombre: nombre.trim(), descripcion: descripcion.trim(), acceso, permisos: efectivas } });
      toast(rol ? `Rol «${nombre.trim()}» guardado. Rige para cada persona en máximo 15 minutos (o al volver a entrar).` : `Rol «${nombre.trim()}» creado: ya se puede asignar.`);
      listo();
    } catch (e) { toast(mensaje(e, 'No se pudo guardar el rol.'), 'warn'); }
    setOcupado('');
  };
  const restaurar = async () => {
    if (!rol || !window.confirm(`¿Volver «${rol.nombre}» a sus funciones predeterminadas? Se pierden los ajustes que le hicieron.`)) return;
    setOcupado('restaurar');
    try { await api(`/roles/${rol.id}/restaurar`, { metodo: 'POST' }); toast('Funciones predeterminadas restauradas.'); listo(); }
    catch (e) { toast(mensaje(e, 'No se pudo restaurar.'), 'warn'); }
    setOcupado('');
  };
  const eliminar = async () => {
    if (!rol || !window.confirm(`¿Borrar el rol «${rol.nombre}»? Nadie lo ha usado; no se puede deshacer.`)) return;
    setOcupado('eliminar');
    try { await api(`/roles/${rol.id}`, { metodo: 'DELETE' }); toast('Rol borrado.'); listo(); }
    catch (e) { toast(mensaje(e, 'No se pudo borrar.'), 'warn'); }
    setOcupado('');
  };
  const cambios = !rol || nombre.trim() !== rol.nombre || (descripcion.trim() || null) !== (rol.descripcion ?? null) || activo !== rol.activo
    || JSON.stringify([...efectivas].sort()) !== JSON.stringify(rol.permisos.filter((p) => validos.has(p)).sort());
  return (
    <div className="flex flex-col gap-5">
      <div>
        <button onClick={volver} className="mb-2 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg"><ArrowLeft size={15} /> Volver a Roles</button>
        <PageHeader eyebrow="Ajustes · Roles y permisos" title={rol ? rol.nombre : 'Nuevo rol'} subtitle="Configuración básica del rol, su acceso al sistema y las funciones que puede usar." />
      </div>
      <Card>
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Nombre *" id="rl-n"><Input id="rl-n" value={nombre} maxLength={60} onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: Jefe de planta" /></Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-muted">Estado</span>
            <div className="flex gap-2">{([true, false] as const).map((v) => (
              <button key={String(v)} type="button" onClick={() => setActivo(v)} disabled={administrador && !v} aria-pressed={activo === v}
                className={cx('h-10 flex-1 rounded-lg border text-[13px] font-medium', activo === v ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line text-muted', administrador && !v && 'opacity-50')}>
                {v ? 'Activo' : 'Inactivo'}</button>
            ))}</div>
          </div>
          <div className="flex flex-col gap-1.5 lg:col-span-2">
            <span className="text-[12px] font-medium text-muted">Acceso al sistema{rol ? ' (no se cambia: cree otro rol si necesita otro acceso)' : ' · elija uno solo'}</span>
            <div className="grid gap-2 sm:grid-cols-3">{ORDEN.map((a) => (
              <button key={a} type="button" disabled={!!rol} onClick={() => { setAcceso(a); setMarcadas([]); }} aria-pressed={acceso === a}
                className={cx('rounded-xl border p-3 text-left text-[13px]', acceso === a ? 'border-brand bg-brand-soft/50' : 'border-line', rol && acceso !== a && 'opacity-40')}>
                <span className="flex items-center justify-between gap-2 font-semibold">{c.accesos[a].nombre}<Badge tone={c.accesos[a].tipo === 'Externo' ? 'info' : 'neutral'}>{c.accesos[a].tipo}</Badge></span>
                <span className="text-muted">{c.accesos[a].descripcion}</span>
              </button>
            ))}</div>
          </div>
          <Field label="Descripción" id="rl-d"><textarea id="rl-d" value={descripcion} maxLength={400} onChange={(e) => setDescripcion(e.target.value)}
            className="min-h-[64px] w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20" placeholder="Para qué es este rol y quién lo usa" /></Field>
          {rol && (
            <div className="grid grid-cols-2 gap-2 text-[12px] text-muted">
              <p><span className="block font-medium text-fg">Fecha de creación</span>{fechaHoraCo(rol.createdAt)}</p>
              <p><span className="block font-medium text-fg">Último cambio</span>{fechaHoraCo(rol.updatedAt)}</p>
              <p><span className="block font-medium text-fg">Personas activas</span>{rol.usuariosActivos}</p>
              <p><span className="block font-medium text-fg">Tipo</span>{rol.predeterminado ? 'Predeterminado' : 'Creado por su empresa'}</p>
            </div>
          )}
        </div>
      </Card>

      {!rol && roles.some((r) => r.acceso === acceso) && (
        <Field label="Partir de las funciones de otro rol (opcional)" id="rl-c">
          <select id="rl-c" className="h-10 rounded-lg border border-line bg-surface px-3 text-sm" defaultValue="" onChange={(e) => { const b = roles.find((r) => r.id === e.target.value); if (b) setMarcadas(b.permisos); }}>
            <option value="">Empezar sin funciones</option>{roles.filter((r) => r.acceso === acceso).map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
          </select>
        </Field>
      )}

      <Card title={<span className="flex items-center gap-2">Funciones <span className="num rounded-full bg-brand-soft px-2 py-0.5 text-[12px] text-brand-ink">{total_} / {total}</span></span>}
        action={!administrador ? <div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => setMarcadas(modulos.flatMap((m) => m.permisos.map((p) => p.codigo)).filter((p) => p !== '*'))}>Marcar todo</Button>
          <Button size="sm" variant="ghost" onClick={() => setMarcadas([])}>Desmarcar todo</Button></div> : undefined}>
        {administrador && <p className="mb-3 flex items-start gap-2 rounded-lg bg-surface-2 p-3 text-[13px] text-muted"><Lock size={15} className="mt-0.5 shrink-0" />El Administrador conserva el acceso total: así siempre hay quien administre usuarios y roles. Si necesita un rol parecido con menos funciones, cópielo.</p>}
        {acceso === 'OFICINA' && efectivas.includes('*') && !administrador && <p className="mb-3 rounded-lg bg-warn/10 p-3 text-[13px] text-warn">Con «Acceso total» este rol ya puede todo lo demás.</p>}
        <div className="flex flex-col gap-4">
          {modulos.map((m) => {
            const marcadasModulo = m.permisos.filter((p) => efectivas.includes(p.codigo)).length;
            const todas = marcadasModulo === m.permisos.length;
            return (
              <section key={m.clave} className="rounded-xl border border-line">
                <header className="flex items-center gap-3 rounded-t-xl bg-brand-soft/40 px-3 py-2.5">
                  <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--brand))]" checked={todas} disabled={administrador} aria-label={`Seleccionar todo el módulo ${m.nombre}`}
                    ref={(el) => { if (el) el.indeterminate = marcadasModulo > 0 && !todas; }} onChange={(e) => todoModulo(m, e.target.checked)} />
                  <h3 className="flex-1 text-[14px] font-semibold">{m.nombre}</h3>
                  <span className="num text-[12px] text-muted">{marcadasModulo} / {m.permisos.length}</span>
                </header>
                <ul className="divide-y divide-line">
                  {m.permisos.map((p) => (
                    <li key={p.codigo}>
                      <label className={cx('flex items-start gap-3 px-3 py-2.5 text-[13px]', !administrador && 'cursor-pointer hover:bg-surface-2')}>
                        <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--brand))]" checked={efectivas.includes(p.codigo)} disabled={administrador} onChange={() => cambiar(p.codigo)} />
                        <span className="min-w-0 flex-1"><span className="font-medium">{p.nombre}</span>
                          {def?.permisos.includes(p.codigo) && <span className="ml-2 inline-flex items-center gap-0.5 text-[11px] text-subtle"><Check size={11} /> predeterminada</span>}
                          <span className="block text-muted">{p.descripcion}</span></span>
                        <code className="hidden shrink-0 text-[11px] text-subtle sm:block">{p.codigo}</code>
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
        <div className="flex flex-wrap gap-2">
          {rol?.predeterminado && !administrador && <Button variant="ghost" disabled={!!ocupado} onClick={restaurar}>{ocupado === 'restaurar' ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />} Restaurar predeterminadas</Button>}
          {rol && <Button variant="ghost" disabled={!!ocupado} onClick={() => copiar(rol)}><Copy size={16} /> Copiar como rol nuevo</Button>}
          {rol && !rol.predeterminado && rol.usuarios === 0 && <Button variant="ghost" disabled={!!ocupado} onClick={eliminar}>{ocupado === 'eliminar' ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />} Borrar</Button>}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={volver}>Cancelar</Button>
          <Button variant="primary" disabled={!!ocupado || nombre.trim().length < 3 || !cambios} onClick={guardar}>{ocupado === 'guardar' && <Loader2 size={16} className="animate-spin" />}{rol ? 'Guardar cambios' : 'Crear rol'}</Button>
        </div>
      </div>
      {rol && rol.usuariosActivos > 0 && !activo && rol.activo && <Aviso>Lo usan {rol.usuariosActivos} personas activas: páselas a otro rol antes de inactivarlo.</Aviso>}
    </div>
  );
}

const Aviso = ({ children }: { children: ReactNode }) => <p className="rounded-lg bg-warn/10 p-3 text-[13px] text-warn">{children}</p>;
