// Usuarios del portal de un cliente. Los gestiona el administrador del cliente desde su portal (/portal/usuarios) o la
// oficina de Terra Viva desde la ficha del cliente (/clientes/:id/usuarios-portal), que da el primer acceso.
// Nadie escribe contraseñas por otro: el usuario nuevo recibe una invitación. Nada se borra: un usuario se inactiva.
import { useState, type FormEvent } from 'react';
import { Loader2, Mail, MapPin, Plus, ShieldCheck, ShieldOff, UserRound } from 'lucide-react';
import { Badge, Button, Field, Input, PageHeader, Sheet, useToast } from '../../components/ui';
import { api, ErrorApi } from '../../lib/api';
import { fechaHoraCo, useApi } from '../../lib/servidor';
import { cx } from '../../lib/format';
import { PERFIL, usePortal, type SedePortal } from './PortalApp';
import { entregarInvitacion, type Invitacion } from '../../components/EnlaceAcceso';

/** Rol del portal que se puede asignar (activo, de acceso «Portal de clientes»). */
interface RolPortal { id: string; nombre: string; descripcion: string | null; clave: string | null; permisos: string[] }
export interface UsuarioPortal {
  id: string; nombre: string; email: string; documento: string; telefono: string | null; activo: boolean; perfilPortal: 'ADMIN' | 'CONSULTA';
  ultimoLogin: string | null; datosAceptadosEn: string | null; sedesPortal: { sucursal: { id: string; codigo: string | null; nombre: string } }[];
  /** Su rol en el portal (Ajustes › Roles de Terra Viva). */
  rol?: { id: string; nombre: string };
  /** Desde cuándo tiene activa la verificación en dos pasos (null: sin activar; en el portal es opcional). */
  totpActivoDesde?: string | null;
}
const CAMPOS: Record<string, string> = { email: 'Correo', nombre: 'Nombre', documento: 'Documento', telefono: 'Teléfono', sucursalIds: 'Sedes' };
function mensajeError(e: unknown, def: string) {
  if (!(e instanceof ErrorApi)) return def;
  const d = (e.datos as { detalles?: { campo: string; mensaje: string }[] } | undefined)?.detalles;
  return d?.length ? d.map((x) => `${CAMPOS[x.campo] ?? x.campo}: ${x.mensaje}`).join(' · ') : e.message;
}

/** Página «Usuarios» del portal (solo el administrador del cliente). */
export function PortalUsuarios() {
  const yo = usePortal();
  const [panel, setPanel] = useState<null | { usuario?: UsuarioPortal }>(null);
  const lista = useApi<UsuarioPortal[]>('/portal/usuarios');
  return (
    <>
      <PageHeader title="Usuarios del portal" subtitle="Las personas de su empresa que entran a este portal. Cada una recibe una invitación por correo para crear su contraseña; nadie la escribe por otro."
        actions={<Button variant="primary" onClick={() => setPanel({})}><Plus size={16} /> Invitar usuario</Button>} />
      {yo.restringido && <p className="mb-4 flex items-start gap-2 rounded-xl bg-info/10 px-4 py-2.5 text-[13px] text-info"><MapPin size={15} className="mt-0.5 shrink-0" />Usted ve solo algunas sedes: invita y gestiona usuarios de esas mismas sedes.</p>}
      <ListaUsuariosPortal lista={lista} abrir={(u) => setPanel({ usuario: u })} />
      <Sheet open={!!panel} onClose={() => setPanel(null)} title={panel?.usuario ? 'Usuario del portal' : 'Invitar usuario'}>
        {panel && <FormUsuarioPortal base="/portal/usuarios" sedes={yo.sedes} limitado={yo.restringido} u={panel.usuario} yoEmail={yo.usuario.email}
          listo={() => { setPanel(null); lista.recargar(); }} />}
      </Sheet>
    </>
  );
}

/** Tarjetas de los usuarios del portal (portal y ficha del cliente en la oficina). */
export function ListaUsuariosPortal({ lista, abrir, vacio }: { lista: ReturnType<typeof useApi<UsuarioPortal[]>>; abrir?: (u: UsuarioPortal) => void; vacio?: string }) {
  if (lista.error) return <p className="rounded-xl bg-bad/10 p-4 text-bad">{lista.error}</p>;
  if (!lista.datos) return <p className="flex items-center gap-2 text-muted"><Loader2 size={16} className="animate-spin" />Cargando…</p>;
  if (!lista.datos.length) return <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">{vacio ?? 'Aún no hay usuarios.'}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {lista.datos.map((u) => (
        <li key={u.id}>
          <button onClick={() => abrir?.(u)} disabled={!abrir} className={cx('flex w-full items-start gap-3 rounded-xl border p-3 text-left text-[13px]', u.activo ? 'border-line' : 'border-dashed border-line opacity-70', abrir && 'hover:bg-surface-2')}>
            <span className={cx('rounded-full p-2', u.perfilPortal === 'ADMIN' ? 'bg-brand-soft text-brand-ink' : 'bg-surface-2 text-muted')}>{u.perfilPortal === 'ADMIN' ? <ShieldCheck size={16} /> : <UserRound size={16} />}</span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1.5"><span className="font-medium">{u.nombre}</span><Badge tone={u.perfilPortal === 'ADMIN' ? 'brand' : 'neutral'}>{u.rol?.nombre ?? PERFIL[u.perfilPortal]}</Badge>{!u.activo && <Badge>Inactivo</Badge>}{u.totpActivoDesde && <Badge tone="info">Verificación en dos pasos</Badge>}</span>
              <span className="block truncate text-muted">{u.email}</span>
              <span className="block text-[12px] text-subtle">
                {u.sedesPortal.length ? `Sedes: ${u.sedesPortal.map((s) => s.sucursal.nombre).join(', ')}` : 'Todas las sedes'} · {u.ultimoLogin ? `último ingreso ${fechaHoraCo(u.ultimoLogin)}` : 'aún no ha ingresado'}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Invitar o editar un usuario del portal. `base`: /portal/usuarios o /clientes/:id/usuarios-portal.
 * `limitado`: quien invita ve solo algunas sedes, así que el usuario debe quedar en sedes suyas (el API lo exige igual).
 */
export function FormUsuarioPortal({ base, sedes, limitado = false, u, yoEmail, perfilInicial = 'CONSULTA', listo }: {
  base: string; sedes: SedePortal[]; limitado?: boolean; u?: UsuarioPortal; yoEmail?: string; perfilInicial?: 'ADMIN' | 'CONSULTA'; listo: () => void;
}) {
  const toast = useToast();
  const yo = !!u && u.email === yoEmail;
  const roles = useApi<RolPortal[]>(`${base}/roles`);
  const [v, setV] = useState({ email: '', nombre: u?.nombre ?? '', documento: u?.documento ?? '', telefono: u?.telefono ?? '', rolId: u?.rol?.id ?? '', activo: u?.activo ?? true });
  // Sin rol elegido: el predeterminado equivalente al perfil inicial (administrador para el primer usuario del cliente)
  const rolId = v.rolId || roles.datos?.find((r) => r.clave === (perfilInicial === 'ADMIN' ? 'CLIENTE_ADMIN' : 'CLIENTE_CONSULTA'))?.id || roles.datos?.[0]?.id || '';
  const [todas, setTodas] = useState(!limitado && !(u?.sedesPortal.length));
  const [elegidas, setElegidas] = useState<Set<string>>(new Set(u?.sedesPortal.map((s) => s.sucursal.id) ?? (limitado && sedes.length === 1 ? [sedes[0].id] : [])));
  const [enviando, setEnviando] = useState(false);
  const set = (k: 'email' | 'nombre' | 'documento' | 'telefono') => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const alternar = (id: string) => setElegidas((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const sinSedes = !todas && elegidas.size === 0;
  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    if (sinSedes) return toast('Elija al menos una sede, o «Todas las sedes».', 'warn');
    const cuerpo = { nombre: v.nombre, documento: v.documento, telefono: v.telefono, sucursalIds: todas ? [] : [...elegidas], ...(yo || !rolId ? {} : { rolId }) };
    setEnviando(true);
    try {
      if (u) {
        await api(`${base}/${u.id}`, { metodo: 'PATCH', cuerpo: { ...cuerpo, ...(yo ? {} : { activo: v.activo }) } });
        toast(u.activo && !v.activo ? `${u.nombre} quedó inactivo: ya no puede ingresar.` : 'Usuario actualizado.');
      } else {
        const r = await api<{ invitacion?: Invitacion }>(base, { metodo: 'POST', cuerpo: { ...cuerpo, email: v.email } });
        if (!entregarInvitacion(r.invitacion, v.nombre, v.email.trim().toLowerCase())) toast(`Invitación enviada a ${v.email.trim().toLowerCase()}: con el enlace crea su contraseña (vence en 72 horas).`);
      }
      listo();
    } catch (x) { toast(mensajeError(x, 'No se pudo guardar.'), 'warn'); }
    setEnviando(false);
  };
  const reenviar = async () => {
    try {
      const r = await api<Invitacion>(`${base}/${u!.id}/invitacion`, { metodo: 'POST' });
      if (!entregarInvitacion(r, u!.nombre, u!.email)) toast(`Invitación enviada de nuevo a ${u!.email}.`);
    }
    catch (x) { toast(mensajeError(x, 'No se pudo enviar.'), 'warn'); }
  };
  // Celular perdido y sin códigos de respaldo: la restablece otro administrador (nadie la suya) y se cierran sus sesiones
  const [restablecer2fa, setRestablecer2fa] = useState(false);
  const puede2fa = !!u?.totpActivoDesde && !yo;
  const restablecer = async () => {
    try { await api(`${base}/${u!.id}/2fa/restablecer`, { cuerpo: {} }); toast(`Se restableció la verificación en dos pasos de ${u!.nombre} y se cerraron sus sesiones.`, 'ok'); listo(); }
    catch (x) { toast(mensajeError(x, 'No se pudo restablecer.'), 'warn'); }
  };
  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      {u ? <p className="text-[13px] text-muted">Correo <span className="font-medium text-fg">{u.email}</span>: es su usuario para ingresar y no cambia.{u.datosAceptadosEn ? ` Aceptó la política de datos el ${fechaHoraCo(u.datosAceptadosEn)}.` : ''}{u.totpActivoDesde ? ` Verificación en dos pasos activa desde el ${fechaHoraCo(u.totpActivoDesde)}.` : ''}</p>
        : <Field label="Correo" id="up-e" hint="Le llega la invitación para crear su contraseña."><Input id="up-e" type="email" value={v.email} onChange={set('email')} maxLength={150} required autoComplete="off" /></Field>}
      <Field label="Nombre completo" id="up-n"><Input id="up-n" value={v.nombre} onChange={set('nombre')} minLength={3} maxLength={150} required /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Documento" id="up-d"><Input id="up-d" value={v.documento} onChange={set('documento')} maxLength={20} required /></Field>
        <Field label="Teléfono" id="up-t"><Input id="up-t" inputMode="tel" value={v.telefono} onChange={set('telefono')} maxLength={20} /></Field>
      </div>
      <fieldset className="flex flex-col gap-2" disabled={yo}>
        <legend className="mb-1.5 text-[12px] font-medium text-muted">Rol en el portal{yo ? ' (nadie se cambia el rol a sí mismo)' : ''}</legend>
        {roles.error && <p className="text-[13px] text-bad">{roles.error}</p>}
        {!roles.datos && !roles.error && <p className="flex items-center gap-2 text-[13px] text-muted"><Loader2 size={14} className="animate-spin" />Cargando roles…</p>}
        {roles.datos?.map((r) => (
          <label key={r.id} className={cx('flex items-start gap-2.5 rounded-lg border p-3 text-[13px]', rolId === r.id ? 'border-brand bg-brand-soft/40' : 'border-line', yo && 'opacity-60')}>
            <input type="radio" name="rol" className="mt-0.5 h-4 w-4 accent-[rgb(var(--brand))]" checked={rolId === r.id} onChange={() => setV((s) => ({ ...s, rolId: r.id }))} />
            <span><span className="font-medium">{r.nombre}</span><br /><span className="text-muted">{r.descripcion ?? `${r.permisos.length} funciones`}</span></span>
          </label>
        ))}
        {u?.rol && roles.datos && !roles.datos.some((r) => r.id === u.rol!.id) && <p className="text-[12px] text-warn">Su rol actual («{u.rol.nombre}») está inactivo: elija otro.</p>}
      </fieldset>
      <fieldset className={cx('flex flex-col gap-2', yo && 'opacity-60')} disabled={yo}>
        <legend className="mb-1.5 text-[12px] font-medium text-muted">Sedes que ve{yo ? ' (sus sedes las cambia otro administrador)' : ''}</legend>
        {!limitado && (
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--brand))]" checked={todas} onChange={(e) => setTodas(e.target.checked)} />Todas las sedes de la empresa (también las que se creen después)</label>
        )}
        {!todas && (
          <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-lg border border-line p-2">
            {sedes.map((s) => (
              <label key={s.id} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[13px] hover:bg-surface-2">
                <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--brand))]" checked={elegidas.has(s.id)} onChange={() => alternar(s.id)} />
                <span className="min-w-0 truncate">{s.codigo && <span className="num mr-1 text-muted">{s.codigo}</span>}{s.nombre}{s.municipio ? <span className="text-subtle"> · {s.municipio.nombre}</span> : ''}</span>
              </label>
            ))}
            {!sedes.length && <p className="px-1.5 py-1 text-[13px] text-muted">No hay sedes activas.</p>}
          </div>
        )}
        {sinSedes && <p className="text-[12px] text-warn">Elija al menos una sede.</p>}
      </fieldset>
      {u && (
        <label className={cx('flex items-start gap-2 rounded-lg border border-line p-3 text-[13px]', yo && 'opacity-60')}>
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--brand))]" checked={v.activo} disabled={yo} onChange={(e) => setV((s) => ({ ...s, activo: e.target.checked }))} />
          <span><span className="font-medium">Usuario activo</span><br /><span className="text-muted">{yo ? 'Nadie se inactiva a sí mismo.' : 'Inactivo no se borra: no puede ingresar y sus sesiones se cierran de inmediato.'}</span></span>
        </label>
      )}
      {(u?.activo || puede2fa) && (
        <div className="flex flex-wrap gap-2">
          {u?.activo && <Button type="button" size="sm" variant="ghost" onClick={reenviar}><Mail size={14} /> Reenviar invitación</Button>}
          {puede2fa && !restablecer2fa && <Button type="button" size="sm" variant="ghost" onClick={() => setRestablecer2fa(true)}><ShieldOff size={14} /> Restablecer verificación en dos pasos</Button>}
        </div>
      )}
      {puede2fa && restablecer2fa && (
        <div className="flex flex-col gap-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-[13px]" role="alert">
          <p>Úselo solo si {u!.nombre} perdió el celular y sus códigos de respaldo. Se cierran sus sesiones y podrá entrar solo con su contraseña; si quiere, la activa de nuevo. Le llegará un correo avisándole.</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setRestablecer2fa(false)}>Cancelar</Button>
            <Button type="button" size="sm" variant="danger" onClick={restablecer}>Sí, restablecer</Button>
          </div>
        </div>
      )}
      <div className="flex justify-end border-t border-line pt-3">
        <Button type="submit" variant={u?.activo && !v.activo ? 'danger' : 'primary'} disabled={enviando || sinSedes}>
          {enviando && <Loader2 size={16} className="animate-spin" />}{u ? (u.activo && !v.activo ? 'Inactivar usuario' : 'Guardar cambios') : 'Enviar invitación'}
        </Button>
      </div>
    </form>
  );
}
