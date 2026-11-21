// Usuarios y roles con datos reales (fase 1c). Solo administración. Nadie escribe ni envía contraseñas: el usuario nuevo
// recibe una invitación para crear la suya. Nada se borra: un usuario se inactiva y sus sesiones se cierran.
import { useState, type FormEvent } from 'react';
import { KeyRound, Loader2, Lock, Mail, Plus, ShieldCheck, ShieldOff, Unlock } from 'lucide-react';
import { ResponsiveTable, FilterBar, type Column } from '../components/data';
import { Badge, Button, Card, Field, Input, PageHeader, Select, Sheet, useToast } from '../components/ui';
import { api, ErrorApi, sesionActual, tienePermiso } from '../lib/api';
import { PieLista, fechaHoraCo, hoyCo, useApi, usePaginado } from '../lib/servidor';
import { useRouter } from '../lib/router';
import { cx, diasEntre, fmtFecha } from '../lib/format';
import { entregarInvitacion, type Invitacion } from '../components/EnlaceAcceso';

interface Usuario {
  id: string; nombre: string; documento: string; email: string; telefono: string | null; activo: boolean; bloqueado: boolean; esConductor: boolean; esAuxiliar: boolean;
  licenciaCat: string | null; licenciaVence: string | null; cursoMpVence: string | null; ultimoLogin: string | null; createdAt: string; datosAceptadosEn: string | null;
  /** Desde cuándo tiene activa la verificación en dos pasos (null: sin configurar). */
  totpActivoDesde: string | null;
  /** «Olvidé mi contraseña» sin correo de salida: pidió un enlace y espera que se lo envíen (estándar 2 del ERP). */
  restablecerPedidoEn?: string | null;
  rol: { id: string; nombre: string };
}
/** Roles de Ajustes › Roles (los del portal de clientes no se dan aquí: son de los usuarios de cada cliente). */
interface RolLista { id: string; nombre: string; descripcion: string | null; acceso: 'OFICINA' | 'CAMPO' | 'CLIENTE'; activo: boolean; usuariosActivos: number; permisos: string[] }
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
  const roles = useApi<RolLista[]>(admin ? '/roles' : null);
  const [panel, setPanel] = useState<null | { usuario?: Usuario }>(null);
  if (!admin) return (
    <>
      <PageHeader eyebrow="Ajustes" title="Usuarios" />
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
    { key: 'e', header: 'Estado', render: (u) => (
      <span className="flex flex-wrap gap-1">
        {u.bloqueado ? <Badge tone="bad"><Lock size={11} /> Bloqueado</Badge> : <Badge tone={u.activo ? 'ok' : 'neutral'}>{u.activo ? 'Activo' : 'Inactivo'}</Badge>}
        {u.totpActivoDesde && <span title="Tiene activa la verificación en dos pasos"><Badge tone="info"><ShieldCheck size={11} /> 2 pasos</Badge></span>}
        {u.restablecerPedidoEn && <span title="Usó «Olvidé mi contraseña»: envíele el enlace desde su ficha"><Badge tone="warn"><KeyRound size={11} /> Pidió contraseña nueva</Badge></span>}
      </span>
    ), priority: 3 },
  ];
  const r = roles.datos?.filter((x) => x.acceso !== 'CLIENTE');
  return (
    <>
      <PageHeader eyebrow="Ajustes" title="Usuarios" subtitle="Quién entra y con qué rol. El usuario nuevo recibe un correo para crear su contraseña; nadie la escribe por él. Nada se borra: un usuario se inactiva. Lo que puede hacer cada rol se decide en Roles y permisos."
        actions={<><Button onClick={() => go('roles')}><KeyRound size={16} /> Roles y permisos</Button><Button onClick={() => go('importar')}>Importar</Button><Button variant="primary" onClick={() => setPanel({})}><Plus size={16} /> Invitar usuario</Button></>} />
      <FilterBar active={Number(!!f.q) + Number(!!f.rolId) + Number(f.activo !== 'true')} onClear={() => { setF(vacio); setTexto(''); }}>
        <Field label="Buscar" id="us-q"><Input id="us-q" value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setF((s) => ({ ...s, q: texto.trim() }))} onBlur={() => setF((s) => ({ ...s, q: texto.trim() }))} placeholder="Nombre, correo o documento" /></Field>
        <Field label="Rol" id="us-r"><Select id="us-r" value={f.rolId} onChange={(e) => setF((s) => ({ ...s, rolId: e.target.value }))}><option value="">Todos</option>{(r ?? []).map((x) => <option key={x.id} value={x.id}>{x.nombre}{x.activo ? '' : ' (inactivo)'}</option>)}</Select></Field>
        <Field label="Estado" id="us-a"><Select id="us-a" value={f.activo} onChange={(e) => setF((s) => ({ ...s, activo: e.target.value }))}><option value="true">Activos</option><option value="false">Inactivos</option><option value="">Todos</option></Select></Field>
      </FilterBar>
      {lista.error ? <p className="rounded-xl bg-bad/10 p-4 text-bad">{lista.error}</p>
        : !lista.filas ? <p className="p-6 text-center text-muted">Cargando…</p>
        : <ResponsiveTable rows={lista.filas} columns={cols} rowKey={(u) => u.id} onRowClick={(u) => setPanel({ usuario: u })} cardTitle={(u) => u.nombre}
            cardBadge={(u) => <Badge>{u.rol.nombre}</Badge>} cardMeta={(u) => `${u.email}${u.bloqueado ? ' · bloqueado' : !u.activo ? ' · inactivo' : ''}${u.totpActivoDesde ? ' · verificación en dos pasos' : ''}${u.restablecerPedidoEn ? ' · pidió contraseña nueva' : ''}`}
            footer={<PieLista mostradas={lista.filas.length} total={lista.total} hayMas={lista.hayMas} cargando={lista.cargando} cargarMas={lista.cargarMas} />} empty="No hay usuarios con estos filtros." />}

      {r && (
        <Card title="Roles" className="mt-5" action={<Button size="sm" onClick={() => go('roles')}><KeyRound size={14} /> Configurar roles y permisos</Button>}>
          <ul className="flex flex-wrap gap-2 text-[13px]">
            {r.map((x) => <li key={x.id}><Badge tone={x.activo ? 'neutral' : 'warn'}>{x.nombre} · {x.usuariosActivos}</Badge></li>)}
          </ul>
          <p className="mt-3 text-[12px] text-muted">Cada rol tiene sus funciones marcadas una por una, con su explicación. Los roles del portal de clientes se asignan desde la ficha de cada cliente.</p>
        </Card>
      )}

      <Sheet open={!!panel} onClose={() => setPanel(null)} title={panel?.usuario ? 'Usuario' : 'Invitar usuario'}>
        {panel && r && <FormUsuario u={panel.usuario} roles={r.filter((x) => x.activo || x.id === panel.usuario?.rol.id)} listo={() => { setPanel(null); lista.recargar(); roles.recargar(); }} />}
      </Sheet>
    </>
  );
}

function FormUsuario({ u, roles, listo }: { u?: Usuario; roles: RolLista[]; listo: () => void }) {
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
      if (u) { await api(`/usuarios/${u.id}`, { metodo: 'PATCH', cuerpo }); toast(ok); }
      else {
        const r = await api<{ invitacion?: Invitacion }>('/usuarios', { metodo: 'POST', cuerpo });
        if (!entregarInvitacion(r.invitacion, String(cuerpo.nombre ?? ''), String(cuerpo.email ?? ''))) toast(ok);
      }
      listo();
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
    try {
      const r = await api<Invitacion>(`/usuarios/${u!.id}/invitacion`, { metodo: 'POST' });
      if (!entregarInvitacion(r, u!.nombre, u!.email)) toast(`Invitación enviada de nuevo a ${u!.email}.`);
    }
    catch (err) { toast(mensajeError(err, 'No se pudo enviar.'), 'warn'); }
  };
  // Celular perdido y sin códigos de respaldo: el administrador la restablece (nadie la suya) y el usuario la configura de nuevo
  const [restablecer2fa, setRestablecer2fa] = useState(false);
  const puede2fa = !!u?.totpActivoDesde && !yo && tienePermiso('configuracion.editar');
  const restablecer = async () => {
    try { await api(`/usuarios/${u!.id}/2fa/restablecer`, { cuerpo: {} }); toast(`Se restableció la verificación en dos pasos de ${u!.nombre} y se cerraron sus sesiones.`, 'ok'); listo(); }
    catch (err) { toast(mensajeError(err, 'No se pudo restablecer.'), 'warn'); }
  };
  const campo = v.esConductor || v.esAuxiliar;
  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      {u ? <p className="text-[13px] text-muted">Correo <span className="font-medium text-fg">{u.email}</span>: es el usuario para ingresar y no cambia.{u.datosAceptadosEn ? ` Aceptó la política de datos el ${fechaHoraCo(u.datosAceptadosEn)}.` : ' Aún no ha aceptado la política de datos.'}
        {u.totpActivoDesde ? ` Verificación en dos pasos activa desde el ${fechaHoraCo(u.totpActivoDesde)}.` : ' Sin verificación en dos pasos.'}</p>
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
      {u?.restablecerPedidoEn && u.activo && (
        <p className="rounded-lg bg-warn/10 px-3 py-2 text-[13px] text-warn" role="status">
          Pidió restablecer su contraseña el {fechaHoraCo(u.restablecerPedidoEn)}. Envíele el enlace: con él crea una contraseña nueva.
        </p>
      )}
      {u && (u.bloqueado || u.activo || puede2fa) && (
        <div className="flex flex-wrap gap-2">
          {u.bloqueado && <Button type="button" size="sm" onClick={() => enviar({ desbloquear: true }, `${u.nombre} desbloqueado: ya puede intentar ingresar.`)}><Unlock size={14} /> Desbloquear</Button>}
          {u.activo && <Button type="button" size="sm" variant={u.restablecerPedidoEn ? 'primary' : 'ghost'} onClick={reenviar}><Mail size={14} /> {u.restablecerPedidoEn ? 'Enviar enlace de contraseña nueva' : 'Reenviar invitación'}</Button>}
          {puede2fa && !restablecer2fa && <Button type="button" size="sm" variant="ghost" onClick={() => setRestablecer2fa(true)}><ShieldOff size={14} /> Restablecer verificación en dos pasos</Button>}
        </div>
      )}
      {puede2fa && restablecer2fa && (
        <div className="flex flex-col gap-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-[13px]" role="alert">
          <p>Úselo solo si {u!.nombre} perdió el celular y sus códigos de respaldo. Se cierran sus sesiones y, al entrar de nuevo, configura la verificación con su celular. Le llegará un correo avisándole.</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setRestablecer2fa(false)}>Cancelar</Button>
            <Button type="button" size="sm" variant="danger" onClick={restablecer}>Sí, restablecer</Button>
          </div>
        </div>
      )}
      <div className="flex justify-end border-t border-line pt-3">
        <Button type="submit" variant={u?.activo && !v.activo ? 'danger' : 'primary'} disabled={enviando || !v.rolId}>{enviando && <Loader2 size={16} className="animate-spin" />}{u ? (u.activo && !v.activo ? 'Inactivar usuario' : 'Guardar cambios') : 'Enviar invitación'}</Button>
      </div>
    </form>
  );
}
