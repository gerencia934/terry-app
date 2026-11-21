import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Copy, KeyRound, Link2, LogOut, MessageCircle, Pencil, ShieldOff, UserPlus } from 'lucide-react';
import { Badge, Button, Card, Field, Input, PageHeader, Sheet } from '../componentes/ui';
import { Aviso } from '../componentes/Marca';
import { api, fechaHora, mensajeDe, NOMBRES_MODULOS, type CuentaAdmin, type IdModulo } from '../lib';

const MODULOS = Object.keys(NOMBRES_MODULOS) as IdModulo[];

/** Administración de cuentas Terry-App: quién entra y a qué módulos. Los roles de cada módulo se dan dentro del módulo. */
export function Cuentas() {
  const [cuentas, setCuentas] = useState<CuentaAdmin[] | null>(null);
  const [err, setErr] = useState('');
  const [editando, setEditando] = useState<CuentaAdmin | 'nueva' | null>(null);
  const [enlace, setEnlace] = useState<{ nombre: string; url: string } | null>(null);
  const cargar = useCallback(() => { api<CuentaAdmin[]>('cuentas').then(setCuentas).catch((x) => setErr(mensajeDe(x))); }, []);
  useEffect(cargar, [cargar]);

  const accion = async (c: CuentaAdmin, ruta: string, confirmar?: string) => {
    if (confirmar && !window.confirm(confirmar)) return;
    setErr('');
    try {
      const r = await api<{ enlace?: string }>(`cuentas/${c.id}/${ruta}`, {});
      if (r?.enlace) setEnlace({ nombre: c.nombre, url: r.enlace });
      cargar();
    } catch (x) { setErr(mensajeDe(x)); }
  };

  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader title="Cuentas Terry-App" subtitle="Quién entra al portal y a qué módulos. El rol y los permisos de cada persona se dan dentro de cada módulo, con el mismo correo."
        actions={<Button variant="primary" onClick={() => setEditando('nueva')}><UserPlus size={16} /> Nueva cuenta</Button>} />
      {err && <div className="mb-4"><Aviso>{err}</Aviso></div>}
      <Card pad={false}>
        {!cuentas ? <p className="p-5 text-muted">Cargando…</p> : (
          <ul className="divide-y divide-line">
            {cuentas.map((c) => (
              <li key={c.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-fg">
                    {c.nombre}
                    {c.esAdmin && <Badge tone="brand">Administrador</Badge>}
                    {!c.activa && <Badge tone="bad">Inactiva</Badge>}
                    {c.activa && !c.conClave && <Badge tone="warn">Sin contraseña todavía</Badge>}
                    {c.activa && c.conClave && !c.conCodigo && <Badge tone="warn">Falta la verificación en dos pasos</Badge>}
                    {c.activa && c.restablecerPedidoEn && <Badge tone="warn">Pidió contraseña nueva: envíele un enlace</Badge>}
                  </p>
                  <p className="truncate text-[13px] text-muted">{c.email} · último ingreso: {fechaHora(c.ultimoIngreso)}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {c.esAdmin ? <Badge>Todos los módulos</Badge> : c.modulos.length ? c.modulos.map((m) => <Badge key={m}>{NOMBRES_MODULOS[m]}</Badge>) : <Badge tone="warn">Sin módulos</Badge>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setEditando(c)}><Pencil size={14} /> Editar</Button>
                  <Button size="sm" onClick={() => accion(c, 'enlace')} title="Enlace para crear una contraseña nueva"><Link2 size={14} /> Enlace</Button>
                  {c.conCodigo && <Button size="sm" variant="ghost" onClick={() => accion(c, 'codigo/quitar', `¿Quitar la verificación en dos pasos de ${c.nombre}? La configurará de nuevo en su próximo ingreso. Úselo si perdió el celular.`)}><ShieldOff size={14} /> Quitar código</Button>}
                  <Button size="sm" variant="ghost" onClick={() => accion(c, 'sesiones/cerrar', `¿Cerrar todas las sesiones de ${c.nombre} en el portal?`)}><LogOut size={14} /> Cerrar sesiones</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editando && <EditarCuenta cuenta={editando === 'nueva' ? null : editando} alCerrar={() => setEditando(null)}
        alGuardar={(r) => { setEditando(null); if (r) setEnlace(r); cargar(); }} />}
      {enlace && <EntregarEnlace {...enlace} alCerrar={() => setEnlace(null)} />}
    </div>
  );
}

function EditarCuenta({ cuenta, alCerrar, alGuardar }: { cuenta: CuentaAdmin | null; alCerrar: () => void; alGuardar: (enlace: { nombre: string; url: string } | null) => void }) {
  const [nombre, setNombre] = useState(cuenta?.nombre ?? '');
  const [email, setEmail] = useState(cuenta?.email ?? '');
  const [modulos, setModulos] = useState<IdModulo[]>(cuenta?.modulos ?? ['residuos']);
  const [esAdmin, setEsAdmin] = useState(cuenta?.esAdmin ?? false);
  const [activa, setActiva] = useState(cuenta?.activa ?? true);
  const [err, setErr] = useState('');
  const [enviando, setEnviando] = useState(false);
  const alternar = (m: IdModulo) => setModulos((l) => (l.includes(m) ? l.filter((x) => x !== m) : [...l, m]));
  const enviar = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setEnviando(true);
    try {
      if (cuenta) { await api(`cuentas/${cuenta.id}`, { nombre, modulos, esAdmin, activa }, 'PATCH'); alGuardar(null); }
      else alGuardar({ nombre, url: (await api<{ enlace: string }>('cuentas', { nombre, email, modulos, esAdmin })).enlace });
    } catch (x) { setErr(mensajeDe(x)); } finally { setEnviando(false); }
  };
  return (
    <Sheet open onClose={alCerrar} title={cuenta ? `Editar a ${cuenta.nombre}` : 'Nueva cuenta Terry-App'}
      footer={<><Button onClick={alCerrar}>Cancelar</Button><Button variant="primary" type="submit" form="form-cuenta" disabled={enviando}>{enviando ? 'Guardando…' : cuenta ? 'Guardar' : 'Crear y obtener enlace'}</Button></>}>
      <form id="form-cuenta" className="flex flex-col gap-4" onSubmit={enviar}>
        <Field label="Nombre completo" id="ec-n"><Input id="ec-n" required value={nombre} onChange={(e) => setNombre(e.target.value)} /></Field>
        {!cuenta && <Field label="Correo" id="ec-e" hint="El mismo correo con que la persona está creada en cada módulo."><Input id="ec-e" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>}
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-fg">Módulos a los que entra</legend>
          <div className="grid grid-cols-2 gap-2">
            {MODULOS.map((m) => (
              <label key={m} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px]">
                <input type="checkbox" checked={esAdmin || modulos.includes(m)} disabled={esAdmin} onChange={() => alternar(m)} className="h-4 w-4 accent-[rgb(var(--brand))]" />
                {NOMBRES_MODULOS[m]}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={esAdmin} onChange={(e) => setEsAdmin(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--brand))]" />
          Administrador del portal (entra a todos los módulos y maneja las cuentas)
        </label>
        {cuenta && (
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={activa} onChange={(e) => setActiva(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--brand))]" />
            Cuenta activa (al desactivarla se cierran sus sesiones)
          </label>
        )}
        {!cuenta && <p className="text-[12px] text-subtle">Al crearla le damos un enlace para que la persona cree su contraseña (vence en 72 horas).</p>}
        <Aviso>{err}</Aviso>
      </form>
    </Sheet>
  );
}

/** Enlace para crear la contraseña: se copia o se envía por WhatsApp (el correo del portal todavía no está conectado). */
function EntregarEnlace({ nombre, url, alCerrar }: { nombre: string; url: string; alCerrar: () => void }) {
  const [copiado, setCopiado] = useState(false);
  const mensaje = `Hola ${nombre.split(' ')[0]}: para entrar a Terry-App cree su contraseña en este enlace (vence en 72 horas y sirve una sola vez): ${url}`;
  return (
    <Sheet open onClose={alCerrar} title={<span className="flex items-center gap-2"><KeyRound size={18} /> Enlace para {nombre}</span>}
      footer={<Button variant="primary" onClick={alCerrar}>Listo</Button>}>
      <p className="text-[13px] text-muted">Entrégueselo solo a esa persona. Vence en 72 horas y sirve una sola vez.</p>
      <p className="mt-3 break-all rounded-lg border border-line bg-surface-2 p-3 font-mono text-[12px]">{url}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={() => navigator.clipboard?.writeText(url).then(() => setCopiado(true))}><Copy size={16} /> {copiado ? 'Copiado' : 'Copiar enlace'}</Button>
        <a className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-medium hover:bg-surface-2"
          href={`https://wa.me/?text=${encodeURIComponent(mensaje)}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={16} /> Enviar por WhatsApp</a>
      </div>
    </Sheet>
  );
}
