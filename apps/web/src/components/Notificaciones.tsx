import { useEffect, useState } from 'react';
import { Bell, BellOff, BellRing } from 'lucide-react';
import { Button, useToast } from './ui';
import { MODO_REAL, api } from '../lib/api';
import { activarPush, desactivarPush, estadoPush, probarPush, type ConfigPush, type EstadoPush } from '../lib/notificaciones';

// Permiso de avisos al entrar: una franja pide activarlos en este equipo (el navegador exige que sea con un clic).
// «Ahora no» la esconde una semana. En el menú de la cuenta se pueden activar, probar o apagar en cualquier momento.
const POSPUESTO = 'tv-avisos-pospuesto';
const SEMANA = 7 * 86_400_000;
const pospuesto = () => { try { return Date.now() - Number(localStorage.getItem(POSPUESTO) ?? 0) < SEMANA; } catch { return false; } };

function useEstado() {
  const [estado, setEstado] = useState<EstadoPush | null>(null);
  const [servidor, setServidor] = useState(false);
  useEffect(() => {
    if (!MODO_REAL) return;
    let vivo = true;
    estadoPush().then((e) => vivo && setEstado(e)).catch(() => undefined);
    api<ConfigPush>('/notificaciones/push/configuracion').then((c) => vivo && setServidor(c.activo)).catch(() => undefined);
    return () => { vivo = false; };
  }, []);
  return { estado, setEstado, servidor };
}

export function AvisoNotificaciones() {
  const toast = useToast();
  const { estado, setEstado, servidor } = useEstado();
  const [oculto, setOculto] = useState(pospuesto);
  const [trabajando, setTrabajando] = useState(false);
  if (!MODO_REAL || !servidor || oculto || (estado !== 'pendiente' && estado !== 'requiere-instalar')) return null;
  const activar = async () => {
    setTrabajando(true);
    try {
      const e = await activarPush(); setEstado(e);
      toast(e === 'activo' ? 'Listo: los avisos quedaron activos en este equipo.' : e === 'bloqueado' ? 'El navegador bloqueó los avisos: se pueden permitir en la configuración del sitio.' : 'Los avisos siguen apagados.');
    } catch (x) { toast(x instanceof Error ? x.message : 'No se pudieron activar los avisos.'); }
    finally { setTrabajando(false); }
  };
  const despues = () => { try { localStorage.setItem(POSPUESTO, String(Date.now())); } catch { /* sin almacenamiento */ } setOculto(true); };
  return (
    <section className="mb-5 flex flex-col gap-3 rounded-2xl border border-brand/25 bg-brand-soft/60 p-4 sm:flex-row sm:items-center" aria-label="Activar avisos">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand text-on-brand"><BellRing size={19} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold text-fg">¿Activar los avisos en este equipo?</p>
        <p className="text-[13px] text-muted">
          {estado === 'requiere-instalar'
            ? 'En iPhone primero agregue Terry-App a la pantalla de inicio (Compartir › Agregar a inicio) y ábrala desde allí; luego actívelos.'
            : 'Terry le avisa de solicitudes de recolección nuevas, manifiestos por firmar, inspecciones de la flota y las alertas del día, aunque la app esté cerrada.'}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        {estado === 'pendiente' && <Button variant="primary" size="sm" onClick={activar} disabled={trabajando}><Bell size={15} />{trabajando ? 'Activando…' : 'Activar avisos'}</Button>}
        <Button size="sm" variant="ghost" onClick={despues}>Ahora no</Button>
      </div>
    </section>
  );
}

/** Opción del menú de la cuenta: estado de los avisos en este equipo, con activar, probar y apagar. */
export function OpcionNotificaciones() {
  const toast = useToast();
  const { estado, setEstado, servidor } = useEstado();
  const [trabajando, setTrabajando] = useState(false);
  if (!MODO_REAL || estado === null) return null;
  const correr = async (f: () => Promise<EstadoPush | void>, ok?: string) => {
    setTrabajando(true);
    try { const e = await f(); if (e) setEstado(e); if (ok) toast(ok); }
    catch (x) { toast(x instanceof Error ? x.message : 'No se pudo.'); }
    finally { setTrabajando(false); }
  };
  const texto = !servidor ? 'Avisos: aún no están activos en el servidor' : estado === 'activo' ? 'Avisos activos en este equipo'
    : estado === 'bloqueado' ? 'Avisos bloqueados por el navegador' : estado === 'no-soportado' ? 'Este navegador no recibe avisos'
    : estado === 'requiere-instalar' ? 'Avisos: instale la app en el iPhone' : 'Avisos apagados en este equipo';
  return (
    <div className="rounded-lg px-3 py-2 text-[13px]">
      <p className="flex items-center gap-2 text-muted">{estado === 'activo' ? <BellRing size={15} className="text-brand" /> : <BellOff size={15} />}{texto}</p>
      {servidor && (estado === 'pendiente' || estado === 'inactivo') && (
        <button disabled={trabajando} onClick={() => correr(activarPush, 'Avisos activos en este equipo.')} className="mt-1 font-semibold text-brand hover:underline">Activar avisos</button>
      )}
      {servidor && estado === 'activo' && (
        <span className="mt-1 flex gap-3">
          <button disabled={trabajando} onClick={() => correr(async () => { const r = await probarPush(); if (!r.enviados) throw new Error('No salió ningún aviso de prueba.'); }, 'Aviso de prueba enviado: debe llegar en segundos.')} className="font-semibold text-brand hover:underline">Probar</button>
          <button disabled={trabajando} onClick={() => correr(desactivarPush, 'Avisos apagados en este equipo.')} className="font-semibold text-muted hover:underline">Apagar</button>
        </span>
      )}
    </div>
  );
}
