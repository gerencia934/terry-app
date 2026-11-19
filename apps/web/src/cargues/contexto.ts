import { CLIENTES, DECLARACIONES, PERSONAS, VEHICULOS, item } from '../data/mock';
import { DISPOSICIONES, PERMISOS_CAS, catalogosBase, norm, type Contexto } from '@terraviva/shared';

/** Contexto de validación del modo demostración (en modo servidor valida el API contra la base de datos). */
export function contextoActual(extra?: { nits?: string[]; sucursales?: [string, string][] }): Contexto {
  const nitsClientes = new Set(CLIENTES.map((c) => c.nit.replace(/\D/g, '').slice(0, -1)));
  const sucursalesPorNit = new Map<string, Set<string>>();
  CLIENTES.forEach((c) => sucursalesPorNit.set(c.nit.replace(/\D/g, '').slice(0, -1), new Set(c.sucursales.map((s) => norm(s.nombre)))));
  extra?.nits?.forEach((n) => nitsClientes.add(n));
  extra?.sucursales?.forEach(([n, s]) => { const set = sucursalesPorNit.get(n) ?? new Set(); set.add(norm(s)); sucursalesPorNit.set(n, set); });
  // Demostración: cubiertas las del objeto social y las propias amparadas por un permiso de la CAS (los aliados no tienen licencia cargada).
  const amparadas = new Set(PERMISOS_CAS.flatMap((p) => p.disposiciones));
  return {
    nitsClientes, sucursalesPorNit,
    placas: new Set(VEHICULOS.map((v) => v.placa)),
    emails: new Set(PERSONAS.map((p) => p.email.toLowerCase())),
    numerosDeclaracion: new Set(DECLARACIONES.map((d) => String(d.numero))),
    codigosInternos: new Set(DECLARACIONES.filter((d) => d.estado === 'AUTORIZADA').map((d) => item(d.itemId).codigo.toUpperCase())),
    catalogos: catalogosBase(),
    disposicionesCubiertas: new Set(DISPOSICIONES.filter((d) => d.activo !== false && (!d.requierePermiso || amparadas.has(d.codigo))).map((d) => d.codigo)),
  };
}
