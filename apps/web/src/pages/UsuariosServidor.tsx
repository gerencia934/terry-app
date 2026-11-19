// Usuarios y roles con datos reales (fase 1c). Solo administración. Nadie escribe ni envía contraseñas: el usuario nuevo
// recibe una invitación para crear la suya. Nada se borra: un usuario se inactiva y sus sesiones se cierran.
import { useState, type FormEvent } from 'react';
import { Check, Loader2, Lock, Mail, Minus, Plus, Unlock } from 'lucide-react';
import { ResponsiveTable, FilterBar, type Column } from '../components/data';
import { Badge, Button, Card, Field, Input, PageHeader, Select, Sheet, useToast } from '../components/ui';
import { api, ErrorApi, sesionActual, tienePermiso } from '../lib/api';
import { PieLista, fechaHoraCo, hoyCo, useApi, usePaginado } from '../lib/servidor';
import { useRouter } from '../lib/router';
import { cx, diasEntre, fmtFecha } from '../lib/format';

interface Usuario {
  id: string; nombre: string; documento: string; email: string; telefono: string | null; activo: boolean; bloqueado: boolean; esConductor: boolean; esAuxiliar: boolean;
  licenciaCat: string | null; licenciaVence: string | null; cursoMpVence: string | null; ultimoLogin: string | null; createdAt: string; datosAceptadosEn: string | null;
  rol: { id: string; nombre: string };
}
interface Roles { permisos: { codigo: string; nombre: string }[]; roles: { id: string; nombre: string; usuariosActivos: number; permisos: string[] }[] }
const LICENCIAS = ['A1', 'A2', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
function mensajeError(e: unknown, def: string) {
  if (!(e instanceof ErrorApi)) return def;
  const d = (e.datos as { detalles?: { campo: string; mensaje: string }[] } | undefined)?.detalles;
  return d?.length ? d.map((x) => x.mensaje).join(' · ') : e.message;
}
function Vence({ f }: { f: string | null }) {
  if (!f) return <span className="text-subtle">—</span>;
  const d = diasEntre(hoyCo(), f.slice(0, 10));
  return <span className="flex flex-col"><span className="num whitespace-nowrap">{fmtFecha(f.slice(0, 10))}</span>{d <= 45 && <span className={cx('text-[11px] font-medium', d <= 15 ? 'text-bad' : 'text-warn')}>{d < 0 ? `vencido hace ${-d} días` : `vence en ${d} días`}</span>}</span>;
}

export function UsuariosServidor() {
  const { go } = useRouter();
  const admin = tienePermiso('configuracion.editar');
  const vacio = { q: '', rolId: '', activo: 'true' };
  const [f, setF] = useState(vacio);
  const [texto, setTexto] = useState('');
  const qs = new URLSearchParams({ ...(f.q && { q: f.q }), ...(f.rolId && { rolId: f.rolId }), ...(f.activo && { activo: f.activo }) }).toString();
  const lista = usePaginado<Usuario>(admin ? `/usuarios?${qs}` : null);
  const roles = useApi<Roles>(admin ? '/roles' : null);
  const [panel, setPanel] = useState<null | { usuario?: Usuario }>(null);
  if (!admin) return (
    <>
      <PageHeader eyebrow="Ajustes" title="Usuarios y roles" />
      <p className="flex items-start gap-2 rounded-xl bg-surface-2 p-4 text-[14px] text-muted"><Lock size={16} className="mt-0.5 shrink-0" />Solo la administración ve y gestiona los usuarios (datos personales, Ley 1581).</p>
    </>
  );
  const cols: Column<Usuario>[] = [
    { key: 'n', header: 'Nombre', render: (u) => <span className="flex flex-col"><span className="font-medium">{u.nombre}</span><span className="text-[12px] text-muted">{u.email}</span></span>, priority: 3 },
    { key: 'r', header: 'Rol', render: (u) => <Badge tone={u.rol.nombre === 'Administrador' ? 'brand' : u.esConductor ? 'info' : 'neutral'}>{u.rol.nombre}</Badge>, priority: 3 },
    { key: 'd', header: 'Documento', render: (u) => <span className="num">{u.documento}</span>, priority: 1 },
    { key: 'l', header: 'Licencia', render: (u) => (u.esConductor ? <span className="flex flex-col"><span className="text-[12px] text-muted">{u.licenciaCat ?? 'sin categoría'}</span><Vence f={u.licenciaVence} /></span> : '—'), priority: 1 },
    { key: 'c', header: 'Curso mercancías peligrosas', render: (u) => (u.esConductor || u.esAuxiliar ? <Vence f={u.cursoMpVence} /> : '—'), priority: 1 },
    { key: 'u', header: 'Último ingreso', render: (u) => <span className="text-muted">{u.ultimoLogin ? fechaHoraCo(u.ultimoLogin) : 'nunca'}</span>, priority: 2 },
    { key: 'e', header: 'Estado', render: (u) => (u.bloqueado ? <Badge tone="bad"><Lock size={11} /> Bloqueado</Badge> : <Badge tone={u.activo ? 'ok' : 'neutral'}>{u.activo ? 'Activo' : 'Inactivo'}</Badge>), priority: 3 },
  ];
  const r = roles.datos;
  return (
    <>
      <PageHeader eyebrow="Ajustes" title="Usuarios y roles" subtitle="Quién entra y qué puede hacer. El usuario nuevo recibe un correo para crear su contraseña; nadie la escribe por él. Nada se borra: un usuario se inactiva."
        actions={<><Button onClick={() => go('importar')}>Importar</Button><Button variant="primary" onClick={() => setPanel({})}><Plus size={16} /> Invitar usuario</Button></>} />
      <FilterBar active={Number(!!f.q) + Number(!!f.rolId) + Number(f.activo !== 'true')} onClear={() => { setF(vacio); setTexto(''); }}>
        <Field label="Buscar" id="us-q"><Input id="us-q" value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setF((s) => ({ ...s, q: texto.trim() }))} onBlur={() => setF((s) => ({ ...s, q: texto.trim() }))} placeholder="Nombre, correo o documento" /></Field>
        <Field label="Rol" id="us-r"><Select id="us-r" value={f.rolId} onChange={(e) => setF((s) => ({ ...s, rolId: e.target.value }))}><option value="">Todos</option>{(r?.roles ?? []).map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</Select></Field>
        <Field label="Estado" id="us-a"><Select id="us-a" value={f.activo} onChange={(e) => setF((s) => ({ ...s, activo: e.target.value }))}><option value="true">Activos</option><option value="false">Inactivos</option><option value="">Todos</option></Select></Field>
      </FilterBar>
      {lista.error ? <p className="rounded-xl bg-bad/10 p-4 text-bad">{lista.error}</p>
        : !lista.filas ? <p className="p-6 text-center text-muted">Cargando…</p>
        : <ResponsiveTable rows={lista.filas} columns={cols} rowKey={(u) => u.id} onRowClick={(u) => setPanel({ usuario: u })} cardTitle={(u) => u.nombre}
            cardBadge={(u) => <Badge>{u.rol.nombre}</Badge>} cardMeta={(u) => `${u.email}${u.bloqueado ? ' · bloqueado' : !u.activo ? ' · inactivo' : ''}`}
            footer={<PieLista mostradas={lista.filas.length} total={lista.total} hayMas={lista.hayMas} cargando={lista.cargando} cargarMas={lista.cargarMas} />} empty="No hay usuarios con estos filtros." />}

      {r && (
        <Card title="Permisos por rol" className="mt-5" pad={false}>
          <div className="scroll-x"><table className="w-full min-w-[720px] text-[13px]">
            <thead className="bg-surface-2 text-left text-[12px] uppercase tracking-[0.04em] text-muted"><tr><th className="px-4 py-2.5">Permiso</th>{r.roles.map((x) => <th key={x.id} className="px-2 py-2.5 text-center">{x.nombre}<br /><span className="font-normal normal-case text-subtle">{x.usuariosActivos} activos</span></th>)}</tr></thead>
            <tbody>{r.permisos.filter((p) => p.codigo !== '*').map((p) => (
              <tr key={p.codigo} className="border-t border-line"><td className="px-4 py-2"><span className="block">{p.nombre}</span><span className="text-[11px] text-subtle">{p.codigo}</span></td>
                {r.roles.map((x) => { const si = x.permisos.includes('*') || x.permisos.includes(p.codigo); return <td key={x.id} className="px-2 py-2 text-center">{si ? <Check size={16} className="inline text-ok" aria-label="Sí" /> : <Minus size={16} className="inline text-subtle" aria-label="No" />}</td>; })}
              </tr>))}
            </tbody>
          </table></div>
          <p className="border-t border-line px-4 py-2 text-[12px] text-muted">El administrador tiene todos los permisos. Para cambiar lo que puede hacer un rol, pídalo al equipo de soporte: un cambio mal hecho puede dejar a alguien sin acceso.</p>
        </Card>
      )}

      <Sheet open={!!panel} onClose={() => setPanel(null)} title={panel?.usuario ? 'Usuario' : 'Invitar usuario'}>
        {panel && r && <FormUsuario u={panel.usuario} roles={r.roles} listo={() => { setPanel(null); lista.recargar(); roles.recargar(); }} />}
      </Sheet>
    </>
  );
}

function FormUsuario({ u, roles, listo }: { u?: Usuario; roles: Roles['roles']; listo: () => void }) {
  const toast = useToast();
  const yo = sesionActual()?.usuario.id === u?.id;
  const [v, setV] = useState({
    email: u?.email ?? '', nombre: u?.nombre ?? '', documento: u?.documento ?? '', telefono: u?.telefono ?? '', rolId: u?.rol.id ?? '',
    esConductor: u?.esConductor ?? false, esAuxiliar: u?.esAuxiliar ?? false, licenciaCat: u?.licenciaCat ?? '', licenciaVence: u?.licenciaVence?.slice(0, 10) ?? '',
    cursoMpVence: u?.cursoMpVence?.slice(0, 10) ?? '', activo: u?.activo ?? true,
  });
  const [enviando, setEnviando] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const enviar = async (cuerpo: Record<string, unknown>, ok: string) => {
    setEnviando(true);
    try {
      if (u) await api(`/usuarios/${u.id}`, { metodo: 'PATCH', cuerpo }); else await api('/usuarios', { metodo: 'POST', cuerpo });
      toast(ok); listo();
    } catch (err) { toast(mensajeError(err, 'No se pudo guardar.'), 'warn'); }
    setEnviando(false);
  };
  const guardar = (e: FormEvent) => {
    e.preventDefault();
    const { email, activo, ...datos } = v;
    if (u) enviar({ ...datos, ...(yo ? {} : { activo }) }, u.activo && !activo ? `${u.nombre} quedó inactivo: sus sesiones se cerraron.` : 'Usuario actualizado.');
    else enviar({ ...datos, email }, `Invitación enviada a ${email}: con el enlace crea su contraseña (vence en 72 horas).`);
  };
  const reenviar = async () => {
    try { await api(`/usuarios/${u!.id}/invitacion`, { metodo: 'POST' }); toast(`Invitación enviada de nuevo a ${u!.email}.`); }
    catch (err) { toast(mensajeError(err, 'No se pudo enviar.'), 'warn'); }
  };
  const campo = v.esConductor || v.esAuxiliar;
  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      {u ? <p className="text-[13px] text-muted">Correo <span className="font-medium text-fg">{u.email}</span>: es el usuario para ingresar y no cambia.{u.datosAceptadosEn ? ` Aceptó la política de datos el ${fechaHoraCo(u.datosAceptadosEn)}.` : ' Aún no ha aceptado la política de datos.'}</p>
        : <Field label="Correo" id="fu-e" hint="Le llega la invitación para crear su contraseña."><Input id="fu-e" type="email" value={v.email} onChange={set('email')} maxLength={150} required /></Field>}
      <Field label="Nombre completo" id="fu-n"><Input id="fu-n" value={v.nombre} onChange={set('nombre')} maxLength={150} required /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Documento" id="fu-d"><Input id="fu-d" value={v.documento} onChange={set('documento')} maxLength={20} required /></Field>
        <Field label="Teléfono" id="fu-t"><Input id="fu-t" inputMode="tel" value={v.telefono} onChange={set('telefono')} maxLength={20} /></Field>
      </div>
      <Field label="Rol" id="fu-r" hint={yo ? 'Nadie se cambia el rol a sí mismo.' : u ? 'Al cambiar el rol se cierran sus sesiones: el nuevo rige desde su próximo ingreso.' : undefined}>
        <Select id="fu-r" value={v.rolId} onChange={set('rolId')} disabled={yo} required><option value="">Elija el rol</option>{roles.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</Select>
      </Field>
      <div className="flex flex-wrap gap-4 text-[13px]">
        <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--brand))]" checked={v.esConductor} onChange={(e) => setV((s) => ({ ...s, esConductor: e.target.checked }))} />Conductor</label>
        <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--brand))]" checked={v.esAuxiliar} onChange={(e) => setV((s) => ({ ...s, esAuxiliar: e.target.checked }))} />Auxiliar</label>
      </div>
      {campo && (
        <div className="grid gap-4 rounded-lg bg-surface-2 p-3 sm:grid-cols-3">
          {v.esConductor && <Field label="Categoría de licencia" id="fu-lc"><Select id="fu-lc" value={v.licenciaCat} onChange={set('licenciaCat')}><option value="">—</option>{LICENCIAS.map((x) => <option key={x}>{x}</option>)}</Select></Field>}
          {v.esConductor && <Field label="Licencia vence" id="fu-lv"><Input id="fu-lv" type="date" value={v.licenciaVence} onChange={set('licenciaVence')} /></Field>}
          <Field label="Curso de mercancías peligrosas vence" id="fu-mp" hint="Res. 1223 de 2014"><Input id="fu-mp" type="date" value={v.cursoMpVence} onChange={set('cursoMpVence')} /></Field>
        </div>
      )}
      {u && (
        <label className={cx('flex items-start gap-2 rounded-lg border border-line p-3 text-[13px]', yo && 'opacity-60')}>
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--brand))]" checked={v.activo} disabled={yo} onChange={(e) => setV((s) => ({ ...s, activo: e.target.checked }))} />
          <span><span className="font-medium">Usuario activo</span><br /><span className="text-muted">{yo ? 'Nadie se inactiva a sí mismo.' : 'Inactivo no se borra: no puede ingresar y sus sesiones se cierran de inmediato.'}</span></span>
        </label>
      )}
      {u && (u.bloqueado || u.activo) && (
        <div className="flex flex-wrap gap-2">
          {u.bloqueado && <Button type="button" size="sm" onClick={() => enviar({ desbloquear: true }, `${u.nombre} desbloqueado: ya puede intentar ingresar.`)}><Unlock size={14} /> Desbloquear</Button>}
          {u.activo && <Button type="button" size="sm" variant="ghost" onClick={reenviar}><Mail size={14} /> Reenviar invitación</Button>}
        </div>
      )}
      <div className="flex justify-end border-t border-line pt-3">
        <Button type="submit" variant={u?.activo && !v.activo ? 'danger' : 'primary'} disabled={enviando || !v.rolId}>{enviando && <Loader2 size={16} className="animate-spin" />}{u ? (u.activo && !v.activo ? 'Inactivar usuario' : 'Guardar cambios') : 'Enviar invitación'}</Button>
      </div>
    </form>
  );
}
