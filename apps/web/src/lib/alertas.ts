import type { RouteName } from './router';
import { HOY, VEHICULOS, PERSONAS, PERMISOS, RUTAS, PREOPS, DECLARACIONES, CONCILIACION, vehiculo } from '../data/mock';
import { diasEntre, fmtFecha } from './format';

export interface Alerta { id: string; tone: 'bad' | 'warn' | 'info'; titulo: string; detalle: string; route: RouteName; categoria: 'Cumplimiento' | 'Flota' | 'Operación' | 'Comercial' }

/** Reglas de alerta. En producción las ejecuta un job diario (BullMQ) y envía correo/push. */
export function alertas(): Alerta[] {
  const out: Alerta[] = [];
  PERMISOS.forEach((p) => {
    const d = diasEntre(HOY, p.proximaObligacion.fecha);
    if (d <= 30) out.push({ id: `perm-${p.id}`, tone: d <= 15 ? 'bad' : 'warn', categoria: 'Cumplimiento', route: 'config-permisos',
      titulo: `${p.acto}: obligación en ${d} días`, detalle: `${p.proximaObligacion.descripcion} · ${fmtFecha(p.proximaObligacion.fecha)}` });
  });
  VEHICULOS.forEach((v) => {
    ([['SOAT', v.soat], ['Revisión técnico-mecánica', v.rtm], ['Póliza RC', v.polizaRc]] as const).forEach(([doc, f]) => {
      const d = diasEntre(HOY, f);
      if (d <= 30) out.push({ id: `veh-${v.id}-${doc}`, tone: d <= 15 ? 'bad' : 'warn', categoria: 'Flota', route: 'config-vehiculos',
        titulo: `${v.placa}: ${doc} vence en ${d} días`, detalle: `${v.tipo} · ${fmtFecha(f)}` });
    });
  });
  PERSONAS.forEach((p) => {
    ([['Licencia de conducción', p.licenciaVence], ['Curso mercancías peligrosas', p.cursoMp]] as const).forEach(([doc, f]) => {
      if (!f) return; const d = diasEntre(HOY, f);
      if (d <= 45) out.push({ id: `per-${p.id}-${doc}`, tone: d <= 15 ? 'bad' : 'warn', categoria: 'Flota', route: 'config-usuarios',
        titulo: `${p.nombre}: ${doc.toLowerCase()} vence en ${d} días`, detalle: `Res. 1223/2014 · ${fmtFecha(f)}` });
    });
  });
  const hoy = RUTAS.filter((r) => r.fecha === HOY);
  out.push({ id: 'rutas-hoy', tone: 'info', categoria: 'Operación', route: 'rutas', titulo: `${hoy.length} recorridos programados hoy`,
    detalle: hoy.map((r) => `${r.codigo} (${vehiculo(r.vehiculoId).placa})`).join(' · ') });
  PREOPS.filter((p) => p.programada.startsWith(HOY) && p.aprobado === undefined).forEach((p) =>
    out.push({ id: `preop-${p.id}`, tone: 'warn', categoria: 'Operación', route: 'preoperacionales', titulo: `Preoperacional pendiente · ${vehiculo(p.vehiculoId).placa}`,
      detalle: 'La ruta no puede salir hasta que el chequeo quede aprobado' }));
  const pend = DECLARACIONES.filter((d) => d.estado === 'PENDIENTE').length;
  if (pend) out.push({ id: 'decl-pend', tone: 'info', categoria: 'Comercial', route: 'decl-residuos', titulo: `${pend} declaraciones por autorizar`, detalle: 'Revisar ficha de seguridad y caracterización' });
  const dif = CONCILIACION.filter((c) => Math.abs((c.destino - c.origen) / c.origen) > 0.02 && !c.justificacion).length;
  if (dif) out.push({ id: 'conc', tone: 'bad', categoria: 'Cumplimiento', route: 'actas', titulo: `${dif} diferencia de conciliación sin justificar`, detalle: 'Origen vs. báscula de planta supera ±2 %' });
  const rank = { bad: 0, warn: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
}
