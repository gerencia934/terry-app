import { CLIENTES, DECLARACIONES, MANEJOS, PERMISOS, PERSONAS, VEHICULOS, item } from '../data/mock';
import { norm, type Contexto } from './definiciones';

/** Construye el contexto de validación con los datos actuales (en producción: consulta al API). */
export function contextoActual(extra?: { nits?: string[]; sucursales?: [string, string][] }): Contexto {
  const nitsClientes = new Set(CLIENTES.map((c) => c.nit.replace(/\D/g, '').slice(0, -1)));
  const sucursalesPorNit = new Map<string, Set<string>>();
  CLIENTES.forEach((c) => sucursalesPorNit.set(c.nit.replace(/\D/g, '').slice(0, -1), new Set(c.sucursales.map((s) => norm(s.nombre)))));
  extra?.nits?.forEach((n) => nitsClientes.add(n));
  extra?.sucursales?.forEach(([n, s]) => { const set = sucursalesPorNit.get(n) ?? new Set(); set.add(norm(s)); sucursalesPorNit.set(n, set); });
  return {
    nitsClientes, sucursalesPorNit,
    placas: new Set(VEHICULOS.map((v) => v.placa)),
    emails: new Set(PERSONAS.map((p) => p.email.toLowerCase())),
    manejosConPermiso: new Set(PERMISOS.flatMap((p) => p.manejos)),
    manejosAliados: new Set(MANEJOS.filter((m) => !m.propio).map((m) => m.codigo)),
    numerosDeclaracion: new Set(DECLARACIONES.map((d) => String(d.numero))),
    codigosInternos: new Set(DECLARACIONES.filter((d) => d.estado === 'AUTORIZADA').map((d) => item(d.itemId).codigo.toUpperCase())),
  };
}
