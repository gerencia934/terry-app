import { useEffect, useState } from 'react';
import { Copy, MessageCircle } from 'lucide-react';
import { Button, Sheet } from './ui';

// Mientras el correo de la plataforma no esté conectado, la invitación no puede llegar por correo: el servidor le
// devuelve el enlace al administrador, que lo copia o lo envía por WhatsApp. Sirve una sola vez y vence en 72 horas.
export interface Invitacion { enviada: boolean; enlace: string | null }
interface Datos { nombre: string; email: string; enlace: string }

let abrir: ((d: Datos) => void) | null = null;

/** Si la invitación no salió por correo, muestra el enlace para entregarlo por otro medio. Devuelve true si lo mostró. */
export function entregarInvitacion(inv: Invitacion | undefined, nombre: string, email: string) {
  if (!inv || inv.enviada || !inv.enlace) return false;
  if (abrir) abrir({ nombre, email, enlace: inv.enlace });
  else { void navigator.clipboard?.writeText(inv.enlace).catch(() => undefined); }
  return true;
}

/** Ventana que muestra el enlace (va una vez en el armazón de la app). */
export function EnlaceAccesoHost() {
  const [d, setD] = useState<Datos | null>(null);
  const [copiado, setCopiado] = useState(false);
  useEffect(() => { abrir = (x) => { setCopiado(false); setD(x); }; return () => { abrir = null; }; }, []);
  if (!d) return null;
  const mensaje = `Hola ${d.nombre.split(' ')[0]}: este es su acceso a Terry-App Residuos de Terra Viva. Abra el enlace y cree su contraseña (vence en 72 horas y sirve una sola vez): ${d.enlace}`;
  const copiar = async () => { try { await navigator.clipboard.writeText(d.enlace); setCopiado(true); } catch { setCopiado(false); } };
  return (
    <Sheet open onClose={() => setD(null)} title="Entregue el acceso" footer={<Button variant="primary" onClick={() => setD(null)}>Listo</Button>}>
      <p className="text-[14px] text-muted">El correo de la plataforma todavía no está conectado, así que la invitación de <b className="text-fg">{d.nombre}</b> ({d.email}) no salió por correo. Envíele este enlace: con él crea su contraseña. Vence en 72 horas y sirve una sola vez.</p>
      <p className="mt-4 break-all rounded-lg border border-line bg-surface-2 p-3 font-mono text-[12px]">{d.enlace}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={copiar}><Copy size={15} />{copiado ? 'Copiado' : 'Copiar enlace'}</Button>
        <a href={`https://wa.me/?text=${encodeURIComponent(mensaje)}`} target="_blank" rel="noopener noreferrer"
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#1F8F4E] px-4 text-[14px] font-semibold text-white hover:opacity-90"><MessageCircle size={15} />Enviar por WhatsApp</a>
      </div>
      <p className="mt-4 text-[12px] text-subtle">Cuando el correo quede conectado, las invitaciones vuelven a llegar solas.</p>
    </Sheet>
  );
}
