// Ajustes › Datos de la empresa: el correo de salida (listo para conectar sin tocar código) y los accesos rápidos del
// tablero de inicio (ICONTEC, PESV, MinAmbiente · IDEAM, Seguros).
import { useEffect, useState } from 'react';
import { ExternalLink, Link2, Mail, Plus, RotateCcw, Save, Send, Trash2 } from 'lucide-react';
import { ACCESOS_RAPIDOS_DEFECTO, type AccesoRapido } from '@terraviva/shared';
import { Badge, Button, Card, Field, Input, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { msg, useApi } from '../../lib/servidor';

interface EstadoCorreo { configurado: boolean; servidor: string | null; puerto: number; usuario: string | null; remitente: string }

/** Estado del correo de salida y correo de prueba. Se conecta en el servidor con SMTP_HOST, SMTP_USER y SMTP_PASS. */
export function CorreoCard() {
  const toast = useToast();
  const { datos: e, error } = useApi<EstadoCorreo>('/empresa/correo');
  const [enviando, setEnviando] = useState(false);
  const probar = async () => {
    setEnviando(true);
    try { const r = await api<{ enviado: boolean; mensaje: string }>('/empresa/correo/prueba', { cuerpo: {} }); toast(r.mensaje, r.enviado ? 'ok' : 'warn'); }
    catch (x) { toast(msg(x, 'No se pudo enviar el correo de prueba.'), 'warn'); }
    finally { setEnviando(false); }
  };
  return (
    <Card title={<span className="flex items-center gap-2"><Mail size={16} className="text-brand" />Correo de salida</span>}
      action={e ? <Badge tone={e.configurado ? 'ok' : 'warn'}>{e.configurado ? 'Conectado' : 'Sin conectar'}</Badge> : undefined}>
      {error && <p className="text-[13px] text-bad">{error}</p>}
      {e && (e.configurado ? (
        <>
          <dl className="grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-[auto_1fr]">
            <dt className="text-muted">Servidor</dt><dd>{e.servidor}:{e.puerto}</dd>
            <dt className="text-muted">Usuario</dt><dd>{e.usuario}</dd>
            <dt className="text-muted">Remitente</dt><dd className="break-all">{e.remitente}</dd>
          </dl>
          <Button className="mt-4" onClick={probar} disabled={enviando}><Send size={15} />{enviando ? 'Enviando…' : 'Enviarme un correo de prueba'}</Button>
        </>
      ) : (
        <div className="flex flex-col gap-2 text-[13px] text-muted">
          <p>Las invitaciones, la recuperación de contraseña y el resumen diario por correo esperan la conexión. Mientras tanto, la app entrega a los administradores el enlace de acceso de cada persona (para enviarlo por WhatsApp) y los avisos llegan como notificaciones.</p>
          <p>Para conectarlo no hay que tocar código: en Cloudflare (Worker <b className="text-fg">terra-residuos-api</b> › Variables y secretos) se cargan <b className="text-fg">SMTP_HOST</b>, <b className="text-fg">SMTP_USER</b>, <b className="text-fg">SMTP_PASS</b> y <b className="text-fg">MAIL_FROM</b>. Con Gmail: smtp.gmail.com, puerto 587 y una «contraseña de aplicación» de esa cuenta.</p>
        </div>
      ))}
    </Card>
  );
}

/** Accesos rápidos del tablero: nombre y dirección (https). */
export function AccesosCard({ guardados, edita, alGuardar }: { guardados: AccesoRapido[] | undefined; edita: boolean; alGuardar: (a: AccesoRapido[]) => void }) {
  const toast = useToast();
  const [lista, setLista] = useState<AccesoRapido[]>(guardados ?? ACCESOS_RAPIDOS_DEFECTO);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { setLista(guardados ?? ACCESOS_RAPIDOS_DEFECTO); }, [guardados]);
  const cambiar = (i: number, k: keyof AccesoRapido, v: string) => setLista((l) => l.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const guardar = async (accesosRapidos: AccesoRapido[]) => {
    const malos = accesosRapidos.filter((a) => a.etiqueta.trim().length < 2 || !/^https:\/\/[^\s]+\.[^\s]+$/i.test(a.url.trim()));
    if (malos.length) return toast('Cada acceso necesita un nombre y una dirección completa que empiece por https://', 'warn');
    setGuardando(true);
    try {
      await api('/empresa/configuracion', { metodo: 'PATCH', cuerpo: { accesosRapidos: accesosRapidos.map((a) => ({ etiqueta: a.etiqueta.trim(), url: a.url.trim() })) } });
      alGuardar(accesosRapidos); toast('Accesos rápidos guardados: ya se ven en el inicio.', 'ok');
    } catch (x) { toast(msg(x, 'No se pudieron guardar.'), 'warn'); }
    finally { setGuardando(false); }
  };
  return (
    <Card title={<span className="flex items-center gap-2"><Link2 size={16} className="text-brand" />Accesos rápidos del inicio</span>}>
      <p className="mb-3 text-[13px] text-muted">Botones del tablero que abren, en otra pestaña, las páginas con que Terra Viva cumple (ICONTEC, PESV, MinAmbiente · IDEAM, Seguros…). Hasta 8.</p>
      <ul className="flex flex-col gap-2">
        {lista.map((a, i) => (
          <li key={i} className="grid items-end gap-2 sm:grid-cols-[180px_1fr_auto_auto]">
            <Field label={i === 0 ? 'Nombre' : ''} id={`ac-e-${i}`}><Input id={`ac-e-${i}`} value={a.etiqueta} disabled={!edita} maxLength={40} onChange={(e) => cambiar(i, 'etiqueta', e.target.value)} /></Field>
            <Field label={i === 0 ? 'Dirección (https://…)' : ''} id={`ac-u-${i}`}><Input id={`ac-u-${i}`} value={a.url} disabled={!edita} inputMode="url" onChange={(e) => cambiar(i, 'url', e.target.value)} /></Field>
            <a href={a.url} target="_blank" rel="noopener noreferrer" className="flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-surface-2" aria-label={`Abrir ${a.etiqueta}`}><ExternalLink size={16} /></a>
            {edita && <button type="button" onClick={() => setLista((l) => l.filter((_, j) => j !== i))} className="flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-bad" aria-label={`Quitar ${a.etiqueta}`}><Trash2 size={16} /></button>}
          </li>
        ))}
      </ul>
      {edita && (
        <div className="mt-4 flex flex-wrap gap-2">
          {lista.length < 8 && <Button type="button" onClick={() => setLista((l) => [...l, { etiqueta: '', url: 'https://' }])}><Plus size={15} />Agregar</Button>}
          <Button type="button" variant="ghost" onClick={() => setLista(ACCESOS_RAPIDOS_DEFECTO)}><RotateCcw size={15} />Los de siempre</Button>
          <Button type="button" variant="primary" onClick={() => guardar(lista)} disabled={guardando}><Save size={15} />{guardando ? 'Guardando…' : 'Guardar accesos'}</Button>
        </div>
      )}
    </Card>
  );
}
