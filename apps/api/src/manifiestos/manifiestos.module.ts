import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { EstadoManifiesto, Prisma, TipoConciliacion, TipoManifiesto } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { Auditoria } from '../common/servicios';
import { Archivos, firmaDesdeDataUrl } from '../common/archivos';
import { ActorActual, Permiso, Zod, fechaColombia, paginar, type Actor } from '../common/http';
import { notaBascula, pdfManifiesto, pdfRecibo, type DatosManifiesto } from './pdf';

type Tx = Prisma.TransactionClient;
const id = z.string().uuid();
const texto = (max: number) => z.string().trim().max(max).optional();
const dosDecimales = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
const peso = z.number().nonnegative().max(1e8).refine(dosDecimales, 'Máximo 2 decimales.');
const placa = z.string().trim().toUpperCase().regex(/^([A-Z]{3}\d{3}|[A-Z]{3}\d{2}[A-Z]|[RS]\d{5})$/, 'Placa inválida (ABC123).');

/** Vehículo y tripulación de un tercero (descargas). Datos personales: Ley 1581 de 2012. */
const Transporte = z.object({
  empresaTransportadora: z.string().trim().min(2).max(200), nit: z.string().trim().regex(/^\d{6,15}$/, 'NIT de la transportadora: solo números, sin dígito de verificación.').optional(),
  tipoVehiculo: texto(40), placa: placa.optional(),
  conductorNombre: texto(150), conductorDocumento: texto(20), conductorArlId: id.optional(), conductorEpsId: id.optional(),
  auxiliarNombre: texto(150), auxiliarDocumento: texto(20), auxiliarArlId: id.optional(), auxiliarEpsId: id.optional(), telefono: texto(20),
});
const Linea = z.object({
  solicitudItemId: id.optional(), declaracionId: id.optional(), sucursalId: id.optional(),
  cantidad: z.number().positive().refine(dosDecimales, 'Máximo 2 decimales.'), metricaId: id.optional(), disposicionId: id.optional(), tipoEmbalajeId: id.optional(),
  embalajes: z.number().int().nonnegative().optional(), especificacionIds: z.array(id).max(10).default([]), observaciones: texto(300),
}).refine((l) => l.solicitudItemId || (l.declaracionId && l.sucursalId), { message: 'Indique la línea de la solicitud, o la declaración y el generador.' });
const Crear = z.object({
  tipo: z.nativeEnum(TipoManifiesto), clienteId: id, destinoId: id.optional(), fechaServicio: z.coerce.date(),
  rutaId: id.optional(), solicitudId: id.optional(), tipoConciliacion: z.nativeEnum(TipoConciliacion).default('INTERNA'),
  ordenCompra: texto(40), manifiestoCliente: texto(40), observaciones: texto(2000),
  vehiculoId: id.optional(), conductorId: id.optional(), auxiliarId: id.optional(), transporte: Transporte.optional(),
  items: z.array(Linea).max(200).default([]),
});
// gestores: el gestor aliado que elige la oficina para cada residuo peligroso con más de un gestor posible (declaración → gestor)
const DesdeRuta = z.object({ rutaId: id, paradaIds: z.array(id).default([]), destinoId: id.optional(), gestores: z.record(id, id).default({}) });

/** Residuo peligroso de la ruta que aún no tiene destino: lo elige la oficina entre los gestores aliados posibles. */
export interface PendienteGestor { declaracionId: string; residuo: string; paradaIds: string[]; opciones: { id: string; razonSocial: string }[] }

/** Qué le falta a la oficina para abrir los manifiestos de los residuos peligrosos. */
export const mensajePendientes = (ps: PendienteGestor[]) => {
  const nombres = (xs: PendienteGestor[]) => xs.map((p) => `«${p.residuo}»`).join(', ');
  const varios = ps.filter((p) => p.opciones.length > 1), ninguno = ps.filter((p) => !p.opciones.length);
  return [
    varios.length ? `Elija el gestor aliado que recibe ${nombres(varios)}: Los Pinos no recibe residuos peligrosos y hay más de un gestor posible.` : '',
    ninguno.length ? `Ningún gestor aliado vigente recibe ${nombres(ninguno)}: revise sus licencias en Permisos › Gestores aliados.` : '',
  ].filter(Boolean).join(' ');
};
export const EditarLinea = z.object({
  cantidad: z.number().positive().refine(dosDecimales, 'Máximo 2 decimales.').optional(), embalajes: z.number().int().nonnegative().nullish(), observaciones: z.string().trim().max(300).nullish(),
});
const Actualizar = z.object({
  destinoId: id.optional(), tipoConciliacion: z.nativeEnum(TipoConciliacion).optional(), ordenCompra: texto(40), manifiestoCliente: texto(40),
  pesoEntrada: peso.nullish(), pesoSalida: peso.nullish(), pesoNeto: peso.nullish(), horaLlegada: z.coerce.date().nullish(), horaSalida: z.coerce.date().nullish(),
  observaciones: texto(2000), vehiculoId: id.nullish(), conductorId: id.nullish(), auxiliarId: id.nullish(), transporte: Transporte.optional(),
});
export const Grabar = z.object({
  firma: z.string().max(700_000, 'La firma es demasiado grande.'), firmaNombre: z.string().trim().min(3).max(150), firmaDocumento: z.string().trim().min(3).max(20),
  horaLlegada: z.coerce.date(), horaSalida: z.coerce.date(), pesoEntrada: peso.optional(), pesoSalida: peso.optional(), pesoNeto: peso.optional(), observaciones: texto(2000),
  // Descarga en planta: también firma el receptor de Terra Viva (documentos reales §2)
  firmaReceptor: z.string().max(700_000, 'La firma es demasiado grande.').optional(), receptorNombre: z.string().trim().min(3).max(150).optional(),
  receptorDocumento: z.string().trim().min(3).max(20).optional(),
});
const Anular = z.object({ causalId: id.optional(), motivo: texto(300) }).refine((b) => b.causalId || b.motivo, { message: 'Indique la causal o el motivo.' });
export const Evidencia = z.object({ tipo: z.enum(['FOTO', 'PDF']), tomadaEn: z.coerce.date().optional(), latitud: z.coerce.number().min(-5).max(14).optional(), longitud: z.coerce.number().min(-82).max(-66).optional() });
const Filtros = z.object({
  desde: z.coerce.date().optional(), hasta: z.coerce.date().optional(), numero: z.string().max(20).optional(), clienteId: id.optional(), rutaId: id.optional(),
  tipo: z.nativeEnum(TipoManifiesto).optional(), estado: z.nativeEnum(EstadoManifiesto).optional(), pagina: z.coerce.number().optional(), porPagina: z.coerce.number().optional(),
});

const detalle = {
  cliente: { select: { id: true, razonSocial: true, nit: true, dv: true } }, destino: { select: { id: true, razonSocial: true } },
  ruta: { select: { id: true, codigo: true } }, vehiculo: { select: { id: true, placa: true, marca: true, tipo: true } },
  conductor: { select: { id: true, nombre: true, documento: true } }, auxiliar: { select: { id: true, nombre: true } },
  transporte: { include: { conductorArl: { select: { nombre: true } }, conductorEps: { select: { nombre: true } }, auxiliarArl: { select: { nombre: true } }, auxiliarEps: { select: { nombre: true } } } },
  causalAnulacion: { select: { nombre: true } }, conciliacion: { select: { id: true, estado: true } },
  evidencias: { orderBy: { createdAt: 'asc' } },
  items: { orderBy: { id: 'asc' }, include: {
    declaracion: { select: { id: true, numero: true, nombre: true, codigoInterno: true, esPeligroso: true } },
    sucursal: { select: { id: true, codigo: true, nombre: true, direccion: true } }, metrica: { select: { id: true, abreviacion: true } },
    disposicion: { select: { id: true, codigo: true, nombre: true } }, tipoEmbalaje: { select: { id: true, nombre: true } },
    especificaciones: { include: { especificacion: { select: { codigo: true, nombre: true, abreviatura: true } } } },
    solicitudItem: { select: { id: true, solicitud: { select: { numero: true } } } },
  } },
} satisfies Prisma.ManifiestoInclude;

@Injectable()
export class ManifiestosService {
  constructor(private readonly db: PrismaService, private readonly audit: Auditoria, private readonly archivos: Archivos) {}

  private async propio(a: Actor, id: string, db: Tx | PrismaService = this.db) {
    const m = await db.manifiesto.findFirst({ where: { id, empresaId: a.empresaId } });
    if (!m) throw new NotFoundException({ mensaje: 'Manifiesto no encontrado.' });
    return m;
  }

  /** Planta o gestor que recibe: el indicado (de la empresa) o la planta propia. Un aliado inactivo solo si ya era el destino. */
  private async destino(tx: Tx, empresaId: string, destinoId?: string, actual?: string | null) {
    const d = await tx.proveedor.findFirst({ where: destinoId ? { id: destinoId, empresaId, esDestino: true } : { empresaId, esPropio: true } });
    if (!d) throw new BadRequestException({ mensaje: destinoId ? 'El destino no es una planta o gestor de su empresa.' : 'No hay planta propia registrada.' });
    if (!d.activo && d.id !== actual) throw new BadRequestException({ mensaje: `Ya no se trabaja con ${d.razonSocial}: elija otro destino (o vuelva a activarlo en Permisos › Gestores aliados).` });
    return d.id;
  }

  /** Completa una línea: precio y métrica de la tarifa vigente a la fecha, disposición principal y embalaje de la declaración. */
  private async linea(tx: Tx, a: Actor, manifiestoId: string, fecha: Date, l: z.infer<typeof Linea>) {
    let declaracionId = l.declaracionId, sucursalId = l.sucursalId, precio: Prisma.Decimal | null = null;
    if (l.solicitudItemId) {
      const si = await tx.solicitudItem.findFirst({ where: { id: l.solicitudItemId, solicitud: { empresaId: a.empresaId } } });
      if (!si) throw new BadRequestException({ mensaje: 'La línea de solicitud no existe o no es de su empresa.' });
      declaracionId = si.declaracionId; sucursalId = si.sucursalId; precio = si.precioUnitario;
    }
    const d = await tx.declaracion.findFirst({ where: { id: declaracionId!, empresaId: a.empresaId },
      include: { disposiciones: { where: { principal: true }, take: 1 }, tarifas: { where: { vigenteDesde: { lte: fecha }, OR: [{ vigenteHasta: null }, { vigenteHasta: { gte: fecha } }] }, orderBy: { vigenteDesde: 'desc' }, take: 1 } } });
    if (!d) throw new BadRequestException({ mensaje: 'La declaración no existe o no es de su empresa.' });
    const tarifa = d.tarifas[0];
    // La base valida que la declaración esté autorizada, activa, sea del cliente y esté asignada al generador.
    const item = await tx.manifiestoItem.create({ data: {
      manifiestoId, solicitudItemId: l.solicitudItemId, declaracionId: d.id, sucursalId: sucursalId!, cantidad: l.cantidad,
      metricaId: l.metricaId ?? tarifa?.metricaId ?? null, disposicionId: l.disposicionId ?? d.disposiciones[0]?.disposicionId ?? null,
      tipoEmbalajeId: l.tipoEmbalajeId ?? d.tipoEmbalajeId, embalajes: l.embalajes, precioUnitario: precio ?? tarifa?.precioUnitario ?? null, observaciones: l.observaciones,
    } });
    if (l.especificacionIds.length) {
      const n = await tx.especificacionAdicional.count({ where: { id: { in: l.especificacionIds }, empresaId: a.empresaId, activo: true } });
      if (n !== new Set(l.especificacionIds).size) throw new BadRequestException({ mensaje: 'Alguna especificación adicional no existe.' });
      await tx.manifiestoItemEspecificacion.createMany({ data: [...new Set(l.especificacionIds)].map((especificacionId) => ({ manifiestoItemId: item.id, especificacionId })) });
    }
    return item;
  }

  private async validarEntidades(tx: Tx, t?: z.infer<typeof Transporte>) {
    const ids = [t?.conductorArlId, t?.conductorEpsId, t?.auxiliarArlId, t?.auxiliarEpsId].filter(Boolean) as string[];
    if (ids.length && (await tx.entidadSeguridadSocial.count({ where: { id: { in: ids }, activo: true } })) !== new Set(ids).size)
      throw new BadRequestException({ mensaje: 'Alguna ARL o EPS no existe.' });
    for (const [arl, eps, quien] of [[t?.conductorArlId, t?.conductorEpsId, 'conductor'], [t?.auxiliarArlId, t?.auxiliarEpsId, 'auxiliar']] as const) {
      if (arl && (await tx.entidadSeguridadSocial.findUnique({ where: { id: arl } }))?.tipo !== 'ARL') throw new BadRequestException({ mensaje: `La ARL del ${quien} no es una ARL.` });
      if (eps && (await tx.entidadSeguridadSocial.findUnique({ where: { id: eps } }))?.tipo !== 'EPS') throw new BadRequestException({ mensaje: `La EPS del ${quien} no es una EPS.` });
    }
  }

  async crear(a: Actor, b: z.infer<typeof Crear>) {
    return this.db.$transaction(async (tx) => {
      const cliente = await tx.cliente.findFirst({ where: { id: b.clienteId, empresaId: a.empresaId } });
      if (!cliente) throw new BadRequestException({ mensaje: 'Cliente no encontrado.' });
      const ruta = b.rutaId ? await tx.ruta.findFirst({ where: { id: b.rutaId, empresaId: a.empresaId } }) : null;
      if (b.rutaId && !ruta) throw new BadRequestException({ mensaje: 'Ruta no encontrada.' });
      const sol = b.solicitudId ? await tx.solicitud.findFirst({ where: { id: b.solicitudId, empresaId: a.empresaId, clienteId: cliente.id }, include: { items: { where: { estado: { in: ['PENDIENTE', 'PROGRAMADO'] }, manifiestoItems: { none: { manifiesto: { estado: { not: 'ANULADO' } } } } } } } }) : null;
      if (b.solicitudId && !sol) throw new BadRequestException({ mensaje: 'La solicitud no existe o es de otro cliente.' });
      if (sol && sol.aprobacion !== 'APROBADA') throw new BadRequestException({ mensaje: `La solicitud ${sol.numero} no está aprobada.` });
      await this.validarEntidades(tx, b.transporte);
      const transporteId = b.transporte ? (await tx.transporteTercero.create({ data: { ...b.transporte, empresaId: a.empresaId } })).id : sol?.transporteId ?? null;
      const m = await tx.manifiesto.create({ data: {
        empresaId: a.empresaId, tipo: b.tipo, clienteId: cliente.id, destinoId: await this.destino(tx, a.empresaId, b.destinoId ?? sol?.destinoId ?? undefined),
        fechaServicio: b.fechaServicio, rutaId: ruta?.id, tipoConciliacion: b.tipoConciliacion, ordenCompra: b.ordenCompra ?? sol?.ordenCompra, manifiestoCliente: b.manifiestoCliente,
        observaciones: b.observaciones, vehiculoId: b.vehiculoId ?? ruta?.vehiculoId, conductorId: b.conductorId ?? ruta?.conductorId, auxiliarId: b.auxiliarId ?? ruta?.auxiliarId,
        transporteId, creadoPorId: a.id,
      } });
      const lineas = b.items.length ? b.items : (sol?.items ?? []).map((i) => ({ solicitudItemId: i.id, cantidad: Number(i.cantidadReal ?? i.cantidadEstimada ?? 0), especificacionIds: [] as string[] }));
      if (!lineas.length) throw new BadRequestException({ mensaje: 'El manifiesto necesita al menos una línea (o una solicitud con líneas pendientes).' });
      for (const l of lineas) {
        if (!(l.cantidad > 0)) throw new BadRequestException({ mensaje: 'Indique la cantidad de cada línea.' });
        await this.linea(tx, a, m.id, b.fechaServicio, l as z.infer<typeof Linea>);
      }
      await this.audit.registrar(a, 'manifiesto', m.id, 'CREAR', undefined, { numero: m.numero, tipo: m.tipo, lineas: lineas.length }, tx);
      return m;
    });
  }

  /**
   * Gestores aliados que pueden recibir cada declaración peligrosa: los de su disposición principal (o de todas, si no
   * marcó una), con los que se trabaja hoy, con la licencia registrada y vigente, y que reciben su tipo de residuo. Es la
   * misma regla de la cobertura legal de la declaración (fn_aliado_vigente).
   */
  private async gestoresPosibles(empresaId: string, ids: string[]) {
    const h = fechaColombia();
    const decls = await this.db.declaracion.findMany({ where: { id: { in: ids }, empresaId }, select: { id: true, tipoResiduo: { select: { codigo: true } },
      disposiciones: { select: { principal: true, disposicion: { select: { activo: true, propia: true, gestores: { select: { proveedor: { select: {
        id: true, razonSocial: true, activo: true, esDestino: true, esPropio: true, licencia: true, licenciaIndefinida: true, licenciaVence: true, excluyeTiposResiduo: true } } } } } } } } } });
    return new Map(decls.map((d) => {
      const principales = d.disposiciones.filter((x) => x.principal);
      const opciones = new Map<string, { id: string; razonSocial: string }>();
      for (const { disposicion } of principales.length ? principales : d.disposiciones) {
        if (!disposicion.activo || disposicion.propia) continue;
        for (const { proveedor: p } of disposicion.gestores) {
          const vigente = p.activo && p.esDestino && !p.esPropio && !!p.licencia?.trim() && (p.licenciaIndefinida || (!!p.licenciaVence && p.licenciaVence >= h));
          if (vigente && !(d.tipoResiduo && p.excluyeTiposResiduo.includes(d.tipoResiduo.codigo))) opciones.set(p.id, { id: p.id, razonSocial: p.razonSocial });
        }
      }
      return [d.id, [...opciones.values()].sort((x, y) => x.razonSocial.localeCompare(y.razonSocial, 'es'))] as const;
    }));
  }

  /**
   * Abre los manifiestos de cargue de la ruta: uno por parada y destino, con las líneas programadas que aún no estén en
   * un manifiesto (una parada no atendida no se abre). Lo que no es peligroso va a la planta propia. Lo peligroso va en
   * su propio manifiesto directo al gestor aliado (Res. DGL 000632 de 2023, art. 6: Los Pinos no lo recibe ni lo almacena):
   * si un solo gestor vigente lo recibe se elige solo; si hay varios (o ninguno) queda pendiente y lo elige la oficina en
   * `gestores`. Con `destinoId` todo va a ese destino (la base sigue validando).
   * `parcial` (la app de campo): abre lo que se puede y devuelve lo pendiente. Si no, con algo pendiente no crea nada.
   */
  async abrirDesdeRuta(a: Actor, b: z.infer<typeof DesdeRuta>, parcial = false) {
    const ruta = await this.db.ruta.findFirst({ where: { id: b.rutaId, empresaId: a.empresaId }, include: { paradas: { orderBy: { orden: 'asc' }, include: { sucursal: true,
      items: { where: { liberado: false, solicitudItem: { estado: 'PROGRAMADO', manifiestoItems: { none: { manifiesto: { estado: { not: 'ANULADO' } } } } } },
        include: { solicitudItem: { include: { declaracion: { select: { id: true, nombre: true, esPeligroso: true } } } } } } } } } });
    if (!ruta) throw new NotFoundException({ mensaje: 'Ruta no encontrada.' });
    const paradas = ruta.paradas.filter((p) => p.estado !== 'NO_ATENDIDA' && (!b.paradaIds.length || b.paradaIds.includes(p.id)) && p.items.length);
    if (!paradas.length) throw new BadRequestException({ mensaje: 'La ruta no tiene líneas programadas pendientes de manifiesto.' });

    const peligrosas = b.destinoId ? [] : [...new Set(paradas.flatMap((p) => p.items.filter((ri) => ri.solicitudItem.declaracion.esPeligroso).map((ri) => ri.solicitudItem.declaracion.id)))];
    const posibles = peligrosas.length ? await this.gestoresPosibles(a.empresaId, peligrosas) : new Map<string, { id: string; razonSocial: string }[]>();
    const grupos: { paradaId: string; orden: number; clienteId: string; destinoId?: string; items: z.infer<typeof Crear>['items'] }[] = [];
    const pendientes = new Map<string, PendienteGestor>();
    for (const p of paradas) for (const ri of p.items) {
      const d = ri.solicitudItem.declaracion;
      let destinoId = b.destinoId;
      if (!destinoId && d.esPeligroso) {
        const opciones = posibles.get(d.id) ?? [];
        const elegido = b.gestores[d.id];
        if (elegido && !opciones.some((o) => o.id === elegido))
          throw new BadRequestException({ mensaje: `Ese gestor aliado no puede recibir «${d.nombre}» (licencia vigente y tipo de residuo): ${opciones.length ? `elija ${opciones.map((o) => o.razonSocial).join(' o ')}` : 'ninguno vigente lo recibe hoy'}.` });
        destinoId = elegido ?? (opciones.length === 1 ? opciones[0].id : undefined);
        if (!destinoId) {
          const x = pendientes.get(d.id) ?? { declaracionId: d.id, residuo: d.nombre, paradaIds: [], opciones };
          if (!x.paradaIds.includes(p.id)) x.paradaIds.push(p.id);
          pendientes.set(d.id, x);
          continue;
        }
      }
      let g = grupos.find((x) => x.paradaId === p.id && x.destinoId === destinoId);
      if (!g) grupos.push(g = { paradaId: p.id, orden: p.orden, clienteId: p.sucursal.clienteId, destinoId, items: [] });
      g.items.push({ solicitudItemId: ri.solicitudItemId, cantidad: Number(ri.solicitudItem.cantidadReal ?? ri.solicitudItem.cantidadEstimada ?? 0), especificacionIds: [] });
    }
    const lista = [...pendientes.values()];
    if (lista.length && !parcial) throw new ConflictException({ codigo: 'ELEGIR_GESTOR', mensaje: mensajePendientes(lista), pendientes: lista });
    // En cada parada, primero el de la planta propia y luego el de cada gestor aliado
    grupos.sort((x, y) => x.orden - y.orden || Number(!!x.destinoId) - Number(!!y.destinoId));
    const creados = [];
    for (const g of grupos) creados.push(await this.crear(a, {
      tipo: 'CARGUE', clienteId: g.clienteId, destinoId: g.destinoId, fechaServicio: ruta.fechaProgramada, rutaId: ruta.id, tipoConciliacion: 'INTERNA', items: g.items,
    }));
    return { creados, pendientes: lista, codigo: ruta.codigo };
  }

  /** Desde la oficina: todo o nada. Si falta elegir el gestor aliado de un peligroso, 409 ELEGIR_GESTOR con las opciones. */
  async desdeRuta(a: Actor, b: z.infer<typeof DesdeRuta>) {
    return (await this.abrirDesdeRuta(a, b)).creados;
  }

  async listar(a: Actor, f: z.infer<typeof Filtros>) {
    const { take, skip, pagina, porPagina } = paginar(f);
    const where: Prisma.ManifiestoWhereInput = {
      empresaId: a.empresaId, clienteId: f.clienteId, rutaId: f.rutaId, tipo: f.tipo, estado: f.estado,
      numero: f.numero ? { contains: f.numero, mode: 'insensitive' } : undefined,
      fechaServicio: f.desde || f.hasta ? { gte: f.desde, lte: f.hasta } : undefined,
    };
    const [total, filas] = await this.db.$transaction([
      this.db.manifiesto.count({ where }),
      this.db.manifiesto.findMany({ where, take, skip, orderBy: [{ fechaServicio: 'desc' }, { numero: 'desc' }], include: {
        cliente: { select: { razonSocial: true } }, destino: { select: { razonSocial: true, esPropio: true } }, ruta: { select: { codigo: true } }, vehiculo: { select: { placa: true } }, transporte: { select: { placa: true, empresaTransportadora: true } },
        conciliacion: { select: { estado: true } }, causalAnulacion: { select: { nombre: true } },
        // Marca de facturación (Siigo): solo si está facturado; sin montos
        finanzas: { select: { facturado: true } },
        items: { select: { sucursal: { select: { nombre: true } }, solicitudItem: { select: { solicitud: { select: { numero: true } } } } } },
      } }),
    ]);
    return { total, pagina, porPagina, filas: filas.map(({ items, finanzas, ...m }) => ({
      ...m, facturado: finanzas?.facturado ?? false, lineas: items.length, sedes: [...new Set(items.map((i) => i.sucursal.nombre))], solicitudes: [...new Set(items.map((i) => i.solicitudItem?.solicitud.numero).filter(Boolean))],
    })) };
  }

  async obtener(a: Actor, id: string) {
    const m = await this.db.manifiesto.findFirst({ where: { id, empresaId: a.empresaId }, include: { ...detalle, finanzas: { select: { facturado: true } } } });
    if (!m) throw new NotFoundException({ mensaje: 'Manifiesto no encontrado.' });
    const total = m.items.reduce((s, i) => s + Number(i.cantidad) * Number(i.precioUnitario ?? 0), 0);
    const { finanzas, ...resto } = m;
    return { ...resto, facturado: finanzas?.facturado ?? false, items: m.items.map((i) => ({ ...i, subtotal: Math.round(Number(i.cantidad) * Number(i.precioUnitario ?? 0) * 100) / 100 })), total: Math.round(total * 100) / 100 };
  }

  async agregarLinea(a: Actor, id: string, l: z.infer<typeof Linea>) {
    const m = await this.propio(a, id);
    const item = await this.db.$transaction((tx) => this.linea(tx, a, m.id, m.fechaServicio, l));
    await this.audit.registrar(a, 'manifiesto', id, 'AGREGAR_LINEA', undefined, { itemId: item.id });
    return item;
  }

  /** Cantidad real recogida en campo (la base lo impide si el manifiesto ya está grabado). */
  async editarLinea(a: Actor, id: string, itemId: string, b: z.infer<typeof EditarLinea>) {
    await this.propio(a, id);
    const r = await this.db.manifiestoItem.updateMany({ where: { id: itemId, manifiestoId: id }, data: b });
    if (!r.count) throw new NotFoundException({ mensaje: 'Línea no encontrada.' });
    await this.audit.registrar(a, 'manifiesto', id, 'EDITAR_LINEA', undefined, { itemId, ...b });
    return this.db.manifiestoItem.findUnique({ where: { id: itemId } });
  }

  async quitarLinea(a: Actor, id: string, itemId: string) {
    await this.propio(a, id);
    const r = await this.db.manifiestoItem.deleteMany({ where: { id: itemId, manifiestoId: id } }); // la base impide hacerlo si ya está grabado
    if (!r.count) throw new NotFoundException({ mensaje: 'Línea no encontrada.' });
    await this.audit.registrar(a, 'manifiesto', id, 'QUITAR_LINEA', { itemId });
    return { ok: true };
  }

  async actualizar(a: Actor, id: string, b: z.infer<typeof Actualizar>) {
    const m = await this.propio(a, id);
    return this.db.$transaction(async (tx) => {
      const { transporte, destinoId, ...datos } = b;
      await this.validarEntidades(tx, transporte);
      let transporteId = m.transporteId;
      if (transporte) transporteId = transporteId
        ? (await tx.transporteTercero.update({ where: { id: transporteId }, data: transporte })).id
        : (await tx.transporteTercero.create({ data: { ...transporte, empresaId: a.empresaId } })).id;
      const r = await tx.manifiesto.update({ where: { id }, data: { ...datos, transporteId, destinoId: destinoId ? await this.destino(tx, a.empresaId, destinoId, m.destinoId) : undefined } });
      await this.audit.registrar(a, 'manifiesto', id, 'EDITAR', undefined, b, tx);
      return r;
    });
  }

  async evidencia(a: Actor, id: string, b: z.infer<typeof Evidencia>, file?: Express.Multer.File) {
    if (!file) throw new BadRequestException({ mensaje: 'Adjunte el archivo en el campo «archivo».' });
    const m = await this.propio(a, id);
    // Chequeo previo para no guardar archivos que la base va a rechazar (la base sigue siendo la última palabra)
    const ya = await this.db.manifiestoEvidencia.count({ where: { manifiestoId: id, tipo: b.tipo } });
    if (m.estado === 'ANULADO' || (m.estado === 'REALIZADO' && b.tipo === 'FOTO')) throw new BadRequestException({ mensaje: 'El manifiesto ya está grabado o anulado: no admite más fotos.' });
    if (ya >= (b.tipo === 'FOTO' ? 2 : 1)) throw new BadRequestException({ mensaje: 'El manifiesto ya tiene el máximo de evidencias de ese tipo (2 fotos y 1 PDF).' });
    const g = await this.archivos.guardar(a.empresaId, 'evidencias', file.buffer, b.tipo === 'FOTO' ? ['jpg', 'png', 'webp'] : ['pdf']);
    const ev = await this.db.manifiestoEvidencia.create({ data: { manifiestoId: id, tipo: b.tipo, url: g.clave, nombreArchivo: file.originalname.slice(0, 200), bytes: g.bytes, tomadaEn: b.tomadaEn, latitud: b.latitud, longitud: b.longitud, subidaPorId: a.id } });
    await this.audit.registrar(a, 'manifiesto', id, 'EVIDENCIA', undefined, { tipo: b.tipo, evidenciaId: ev.id });
    return ev;
  }

  /** Grabar: guarda la firma y pasa a REALIZADO. La base exige firma, horas, báscula y seguridad social y abre la conciliación. */
  async grabar(a: Actor, id: string, b: z.infer<typeof Grabar>) {
    const m = await this.propio(a, id);
    if (m.estado !== 'PENDIENTE') throw new BadRequestException({ mensaje: `El manifiesto ${m.numero} ya está ${m.estado === 'REALIZADO' ? 'grabado' : 'anulado'}.` });
    const pesoEntrada = b.pesoEntrada ?? (m.pesoEntrada === null ? undefined : Number(m.pesoEntrada));
    const pesoSalida = b.pesoSalida ?? (m.pesoSalida === null ? undefined : Number(m.pesoSalida));
    const pesoNeto = b.pesoNeto ?? (pesoEntrada !== undefined && pesoSalida !== undefined ? Math.round((pesoEntrada - pesoSalida) * 100) / 100 : (m.pesoNeto === null ? undefined : Number(m.pesoNeto)));
    if (pesoNeto !== undefined && pesoNeto < 0) throw new BadRequestException({ mensaje: 'El peso de salida no puede ser mayor que el de entrada.' });
    if (m.tipo === 'DESCARGUE' && (!b.firmaReceptor || !b.receptorNombre))
      throw new BadRequestException({ mensaje: 'En una descarga en planta firman el receptor de Terra Viva y el conductor o el cliente: falta la firma del receptor.' });
    const firma = await this.archivos.guardar(a.empresaId, 'firmas', firmaDesdeDataUrl(b.firma), ['png']);
    const receptor = b.firmaReceptor ? await this.archivos.guardar(a.empresaId, 'firmas', firmaDesdeDataUrl(b.firmaReceptor), ['png']) : null;
    await this.db.manifiesto.update({ where: { id }, data: {
      firmaUrl: firma.clave, firmaNombre: b.firmaNombre, firmaDocumento: b.firmaDocumento, horaLlegada: b.horaLlegada, horaSalida: b.horaSalida,
      pesoEntrada, pesoSalida, pesoNeto, observaciones: b.observaciones ?? m.observaciones, estado: 'REALIZADO', realizadoPorId: a.id,
      ...(receptor ? { firmaReceptorUrl: receptor.clave, receptorNombre: b.receptorNombre, receptorDocumento: b.receptorDocumento ?? null, receptorId: a.id } : {}),
    } });
    await this.audit.registrar(a, 'manifiesto', id, 'GRABAR', { estado: m.estado }, { estado: 'REALIZADO', pesoNeto });
    return this.obtener(a, id);
  }

  /** Datos del PDF: se arman al pedirlo, desde lo grabado (el manifiesto grabado ya no cambia). */
  private async datosPdf(a: Actor, id: string): Promise<DatosManifiesto> {
    const m = await this.db.manifiesto.findFirst({ where: { id, empresaId: a.empresaId }, include: {
      empresa: true, cliente: true, destino: true, ruta: true, vehiculo: true, conductor: true, auxiliar: true, causalAnulacion: true,
      transporte: { include: { conductorArl: true, conductorEps: true } },
      items: { orderBy: { id: 'asc' }, include: { declaracion: { include: { codigoY: true, codigoA: true } }, sucursal: true, metrica: true, disposicion: true, tipoEmbalaje: true } },
    } });
    if (!m) throw new NotFoundException({ mensaje: 'Manifiesto no encontrado.' });
    const leer = async (clave: string | null) => (clave ? (await this.archivos.leer(clave, a.empresaId).catch(() => null))?.buf ?? null : null);
    const t = m.transporte;
    const n = (v: Prisma.Decimal | null) => (v === null ? null : Number(v));
    return {
      numero: m.numero, tipo: m.tipo, estado: m.estado, fechaServicio: m.fechaServicio.toISOString(),
      emisor: { razonSocial: m.empresa.razonSocial, nit: m.empresa.nit, notaBascula: notaBascula(m.empresa.configuracion, m.fechaServicio) },
      cliente: { razonSocial: m.cliente.razonSocial, nit: `${m.cliente.nit}${m.cliente.dv ? `-${m.cliente.dv}` : ''}` },
      destino: m.destino.razonSocial, ordenCompra: m.ordenCompra, manifiestoCliente: m.manifiestoCliente, ruta: m.ruta?.codigo ?? null,
      transporte: t
        ? { empresa: t.empresaTransportadora, nit: t.nit, placa: t.placa, tipoVehiculo: t.tipoVehiculo, conductor: t.conductorNombre, conductorDocumento: t.conductorDocumento,
            arl: t.conductorArl?.nombre ?? null, eps: t.conductorEps?.nombre ?? null, auxiliar: t.auxiliarNombre }
        : { empresa: m.empresa.razonSocial, nit: m.empresa.nit, placa: m.vehiculo?.placa ?? null, tipoVehiculo: m.vehiculo?.tipo ?? null, conductor: m.conductor?.nombre ?? null,
            conductorDocumento: m.conductor?.documento ?? null, arl: null, eps: null, auxiliar: m.auxiliar?.nombre ?? null },
      horaLlegada: m.horaLlegada?.toISOString() ?? null, horaSalida: m.horaSalida?.toISOString() ?? null,
      bascula: { entrada: n(m.pesoEntrada), salida: n(m.pesoSalida), neto: n(m.pesoNeto) },
      lineas: m.items.map((i) => ({
        generador: i.sucursal.generadorNombre ?? `${i.sucursal.codigo ? `${i.sucursal.codigo} · ` : ''}${i.sucursal.nombre}`, generadorNit: i.sucursal.generadorNit,
        residuo: i.declaracion.nombre, corrientes: [i.declaracion.codigoY?.codigo, i.declaracion.codigoA?.codigo].filter(Boolean) as string[],
        cantidad: Number(i.cantidad), unidad: i.metrica?.abreviacion ?? 'und', embalajes: i.embalajes !== null ? `${i.embalajes} ${i.tipoEmbalaje?.nombre ?? ''}`.trim() : null,
        tratamiento: i.disposicion?.nombre ?? '—',
      })),
      observaciones: m.observaciones,
      firmas: [
        ...(m.tipo === 'DESCARGUE' ? [{ titulo: 'Recibe por Terra Viva', nombre: m.receptorNombre, documento: m.receptorDocumento, imagen: await leer(m.firmaReceptorUrl) }] : []),
        { titulo: m.tipo === 'DESCARGUE' ? 'Entrega (conductor o cliente)' : 'Conductor', nombre: m.firmaNombre, documento: m.firmaDocumento, imagen: await leer(m.firmaUrl) },
      ],
      realizadoEn: m.realizadoEn?.toISOString() ?? null,
      anulacion: m.estado === 'ANULADO' ? [m.causalAnulacion?.nombre, m.motivoAnulacion].filter(Boolean).join(' · ') || null : null,
    };
  }

  /** PDF del manifiesto como archivo (lo usa también la descarga del portal de clientes). */
  async pdfBuffer(a: Actor, id: string) {
    const d = await this.datosPdf(a, id);
    return { numero: d.numero, buf: await pdfManifiesto(d) };
  }

  async pdf(a: Actor, id: string, res: Response, recibo: boolean) {
    const d = await this.datosPdf(a, id);
    const buf = recibo ? await pdfRecibo(d) : await pdfManifiesto(d);
    await this.audit.registrar(a, 'manifiesto', id, recibo ? 'RECIBO_PDF' : 'PDF');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${recibo ? 'recibo' : 'manifiesto'}-${d.numero}.pdf"`);
    res.send(buf);
  }

  async anular(a: Actor, id: string, b: z.infer<typeof Anular>) {
    const m = await this.propio(a, id);
    if (b.causalId && !(await this.db.catalogoItem.findFirst({ where: { id: b.causalId, empresaId: a.empresaId, tipo: 'CAUSAL' } }))) throw new BadRequestException({ mensaje: 'Causal no encontrada.' });
    const r = await this.db.manifiesto.update({ where: { id }, data: { estado: 'ANULADO', causalAnulacionId: b.causalId, motivoAnulacion: b.motivo, anuladoPorId: a.id } });
    await this.audit.registrar(a, 'manifiesto', id, 'ANULAR', { estado: m.estado }, { estado: 'ANULADO', causal: b.causalId, motivo: b.motivo });
    return r;
  }
}

const archivo = FileInterceptor('archivo', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

@Controller('manifiestos')
class ManifiestosController {
  constructor(private readonly s: ManifiestosService) {}
  @Get() listar(@ActorActual() a: Actor, @Query(new Zod(Filtros)) f: z.infer<typeof Filtros>) { return this.s.listar(a, f); }
  @Get(':id') obtener(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.obtener(a, id); }
  @Get(':id/pdf') pdf(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) { return this.s.pdf(a, id, res, false); }
  @Get(':id/recibo') recibo(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) { return this.s.pdf(a, id, res, true); }
  @Permiso('manifiestos.operar') @Post() crear(@ActorActual() a: Actor, @Body(new Zod(Crear)) b: z.infer<typeof Crear>) { return this.s.crear(a, b); }
  @Permiso('manifiestos.operar') @Post('desde-ruta') desdeRuta(@ActorActual() a: Actor, @Body(new Zod(DesdeRuta)) b: z.infer<typeof DesdeRuta>) { return this.s.desdeRuta(a, b); }
  @Permiso('manifiestos.operar') @Patch(':id') actualizar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Actualizar)) b: z.infer<typeof Actualizar>) { return this.s.actualizar(a, id, b); }
  @Permiso('manifiestos.operar') @Post(':id/items') agregar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Linea)) b: z.infer<typeof Linea>) { return this.s.agregarLinea(a, id, b); }
  @Permiso('manifiestos.operar') @Patch(':id/items/:itemId') editarLinea(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Body(new Zod(EditarLinea)) b: z.infer<typeof EditarLinea>) { return this.s.editarLinea(a, id, itemId, b); }
  @Permiso('manifiestos.operar') @Delete(':id/items/:itemId') quitar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string) { return this.s.quitarLinea(a, id, itemId); }
  @Permiso('manifiestos.operar') @Post(':id/evidencias') @UseInterceptors(archivo)
  evidencia(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Evidencia)) b: z.infer<typeof Evidencia>, @UploadedFile() f?: Express.Multer.File) { return this.s.evidencia(a, id, b, f); }
  @Permiso('manifiestos.operar') @Post(':id/grabar') grabar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Grabar)) b: z.infer<typeof Grabar>) { return this.s.grabar(a, id, b); }
  @Permiso('manifiestos.anular') @Post(':id/anular') anular(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Anular)) b: z.infer<typeof Anular>) { return this.s.anular(a, id, b); }
}

@Module({ controllers: [ManifiestosController], providers: [ManifiestosService], exports: [ManifiestosService] })
export class ManifiestosModule {}
