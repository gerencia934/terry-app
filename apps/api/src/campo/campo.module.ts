// App de campo (conductores y auxiliares, desde el celular): todo lo que el teléfono le pide al servidor, en un solo lugar.
//
// Decisión de la gerencia (20-11-2026): campo NO consulta clientes ni precios. Recibe solo su ruta del día (lo indispensable
// para atender cada parada e imprimir el manifiesto en sitio) y, en solo lectura, el estado de mantenimiento de su vehículo.
// El guard global le niega a un token de campo cualquier otra ruta del servidor (@PermiteCampo en common/http.ts), y aquí
// cada consulta elige campo por campo lo que sale (select): ni tarifas, ni valor del flete, ni historial del cliente.
import { BadRequestException, GoneException, Body, Controller, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { Auditoria } from '../common/servicios';
import { Notificaciones } from '../notificaciones/notificaciones.module';
import { ActorActual, Permiso, PermiteCampo, Zod, fechaColombia, type Actor } from '../common/http';
import { EstadoRuta, LogisticaModule, LogisticaService, Rastreo, preopEnMantenimiento } from '../rutas/logistica.module';
import { MantenimientoModule, PreopRutas } from '../mantenimiento/mantenimiento.module';
import { EditarLinea, Evidencia, Grabar, ManifiestosModule, ManifiestosService } from '../manifiestos/manifiestos.module';
import { notaBascula } from '../manifiestos/pdf';

const Fecha = z.object({ fecha: z.coerce.date().optional() });
/** Novedad honesta en sitio: la causal de la lista o, si no está, qué pasó en pocas palabras. */
const Novedad = z.object({ causalId: z.string().uuid().optional(), nota: z.string().trim().max(300).optional() })
  .refine((b) => b.causalId || (b.nota ?? '').length >= 3, { message: 'Elija la causal o escriba qué pasó.' });

/** Lo que el celular necesita de una ruta. Sin valor del flete ni datos de oficina. */
const seleccionRuta = {
  id: true, codigo: true, fechaProgramada: true, horaProgramada: true, kmInicial: true, kmFinal: true, vehiculoId: true, conductorId: true, auxiliarId: true,
  vehiculo: { select: { placa: true, marca: true, tipo: true } }, conductor: { select: { nombre: true } }, auxiliar: { select: { nombre: true } }, estadoRecorrido: true,
  paradas: { orderBy: { orden: 'asc' }, select: {
    id: true, orden: true, estado: true, sucursalId: true,
    // Solo la sede de la parada: dirección, ubicación, horario y a quién llamar al llegar
    sucursal: { select: { id: true, codigo: true, nombre: true, direccion: true, latitud: true, longitud: true, contacto: true, telefono: true, celular: true,
      atencionLvDesde: true, atencionLvHasta: true, atencionFdDesde: true, atencionFdHasta: true, observaciones: true,
      municipio: { select: { nombre: true } }, cliente: { select: { razonSocial: true } } } },
    items: { where: { liberado: false }, select: { id: true, solicitudItem: { select: {
      id: true, estado: true, cantidadEstimada: true, cantidadEmbalajes: true, solicitud: { select: { numero: true } },
      declaracion: { select: { nombre: true, codigoInterno: true, esPeligroso: true } } } } } },
  } },
} satisfies Prisma.RutaSelect;

/** Manifiesto para diligenciarlo e imprimirlo sin señal. Sin precio unitario ni subtotales. */
const seleccionMf = {
  id: true, numero: true, tipo: true, estado: true, fechaServicio: true, rutaId: true, ordenCompra: true, manifiestoCliente: true,
  horaLlegada: true, horaSalida: true, pesoEntrada: true, pesoSalida: true, pesoNeto: true, firmaNombre: true, firmaDocumento: true, realizadoEn: true, observaciones: true,
  cliente: { select: { razonSocial: true, nit: true, dv: true } }, destino: { select: { razonSocial: true } }, ruta: { select: { codigo: true } },
  vehiculo: { select: { placa: true, tipo: true } }, conductor: { select: { nombre: true, documento: true } }, auxiliar: { select: { nombre: true } },
  evidencias: { select: { tipo: true } },
  items: { orderBy: { id: 'asc' }, select: {
    id: true, cantidad: true, embalajes: true,
    sucursal: { select: { id: true, codigo: true, nombre: true, generadorNombre: true, generadorNit: true } },
    declaracion: { select: { nombre: true, esPeligroso: true, codigoY: { select: { codigo: true } }, codigoA: { select: { codigo: true } } } },
    metrica: { select: { abreviacion: true } }, disposicion: { select: { nombre: true } }, tipoEmbalaje: { select: { nombre: true } },
    solicitudItem: { select: { id: true, cantidadEstimada: true } },
  } },
} satisfies Prisma.ManifiestoSelect;

@Injectable()
export class CampoService {
  constructor(private readonly db: PrismaService, private readonly logistica: LogisticaService, private readonly manifiestos: ManifiestosService,
    private readonly audit: Auditoria, private readonly notificaciones: Notificaciones, private readonly preop: PreopRutas) {}

  /** Causal (de la lista de causales) y nota, en un solo texto para el manifiesto y el aviso. */
  private async motivo(a: Actor, b: z.infer<typeof Novedad>) {
    const causal = b.causalId ? await this.db.catalogoItem.findFirst({ where: { id: b.causalId, empresaId: a.empresaId, tipo: 'CAUSAL' }, select: { id: true, nombre: true } }) : null;
    if (b.causalId && !causal) throw new BadRequestException({ mensaje: 'Causal no encontrada.' });
    return { causalId: causal?.id ?? null, texto: [causal?.nombre, b.nota].filter(Boolean).join(' · ') };
  }

  /** Quien coordina desde la oficina (programa rutas o tiene acceso total) puede abrir la app de campo con cualquier ruta. */
  private supervisa(a: Actor) { return a.acceso !== 'CAMPO' && (a.permisos.includes('*') || a.permisos.includes('rutas.programar')); }

  /** Una ruta de la empresa que, para campo, debe estar asignada a quien pregunta (conductor o auxiliar). */
  private async ruta(a: Actor, id: string) {
    const r = await this.db.ruta.findFirst({ where: { id, empresaId: a.empresaId }, select: { id: true, conductorId: true, auxiliarId: true } });
    if (!r) throw new NotFoundException({ mensaje: 'Ruta no encontrada.' });
    if (!this.supervisa(a) && r.conductorId !== a.id && r.auxiliarId !== a.id) throw new ForbiddenException({ mensaje: 'Esa ruta no está asignada a usted.' });
    return r;
  }

  /** Un manifiesto de una ruta de quien pregunta (campo solo diligencia los de sus rutas). */
  private async manifiesto(a: Actor, id: string) {
    const m = await this.db.manifiesto.findFirst({ where: { id, empresaId: a.empresaId }, select: { id: true, rutaId: true } });
    if (!m) throw new NotFoundException({ mensaje: 'Manifiesto no encontrado.' });
    if (!this.supervisa(a)) {
      if (!m.rutaId) throw new ForbiddenException({ mensaje: 'Ese manifiesto no es de una ruta suya.' });
      await this.ruta(a, m.rutaId);
    }
    return m;
  }

  /** El «paquete del día»: rutas, manifiestos, listas e inspecciones. El teléfono lo guarda para trabajar sin señal. */
  async paquete(a: Actor, fecha: Date) {
    const base = { empresaId: a.empresaId, fechaProgramada: fecha };
    let rutas = await this.db.ruta.findMany({ where: { ...base, OR: [{ conductorId: a.id }, { auxiliarId: a.id }] }, select: seleccionRuta, orderBy: { codigo: 'asc' } });
    if (!rutas.length && this.supervisa(a)) rutas = await this.db.ruta.findMany({ where: base, select: seleccionRuta, orderBy: { codigo: 'asc' } });
    const sedes = [...new Set(rutas.flatMap((r) => r.paradas.map((p) => p.sucursalId)))];
    // Portal Logístico: sin preoperacional apto en Mantenimiento (o excepción de la oficina) la ruta no se entrega
    const estados = new Map(await Promise.all(rutas.map(async (r) => [r.id, await this.preop.evaluar(r.id, true)] as const)));
    const abiertas = new Set(rutas.filter((r) => estados.get(r.id)?.abierta).map((r) => r.id));
    const [mfs, empresa, etapas, arl, eps, causales, firmados] = await Promise.all([
      this.db.manifiesto.findMany({ where: { empresaId: a.empresaId, rutaId: { in: [...abiertas] }, estado: { not: 'ANULADO' } }, orderBy: { numero: 'asc' }, select: seleccionMf }),
      this.db.empresa.findUniqueOrThrow({ where: { id: a.empresaId }, select: { razonSocial: true, nit: true, configuracion: true } }),
      this.db.estadoRecorrido.findMany({ where: { empresaId: a.empresaId, activo: true }, orderBy: { orden: 'asc' },
        select: { id: true, nombre: true, color: true, orden: true, esFinal: true, cancela: true, rastreo: true, descripcion: true } }),
      this.db.entidadSeguridadSocial.findMany({ where: { tipo: 'ARL', activo: true }, orderBy: { nombre: 'asc' }, select: { id: true, nombre: true } }),
      this.db.entidadSeguridadSocial.findMany({ where: { tipo: 'EPS', activo: true }, orderBy: { nombre: 'asc' }, select: { id: true, nombre: true } }),
      this.db.catalogoItem.findMany({ where: { empresaId: a.empresaId, tipo: 'CAUSAL', activo: true }, orderBy: { nombre: 'asc' }, select: { id: true, nombre: true } }),
      // Quién firmó la última vez en cada sede de hoy: el celular lo propone (se corrige si es otra persona)
      sedes.length ? this.db.manifiesto.findMany({ where: { empresaId: a.empresaId, estado: 'REALIZADO', items: { some: { sucursalId: { in: sedes } } } }, orderBy: { realizadoEn: 'desc' }, take: 300,
        select: { firmaNombre: true, firmaDocumento: true, items: { select: { sucursalId: true }, take: 1 } } }) : Promise.resolve([]),
    ]);
    const firmante = new Map<string, { nombre: string; documento: string }>();
    for (const m of firmados) {
      const s = m.items[0]?.sucursalId;
      if (s && sedes.includes(s) && m.firmaNombre && !firmante.has(s)) firmante.set(s, { nombre: m.firmaNombre, documento: m.firmaDocumento ?? '' });
    }
    return {
      fecha: fecha.toISOString().slice(0, 10),
      emisor: { razonSocial: empresa.razonSocial, nit: empresa.nit, notaBascula: notaBascula(empresa.configuracion, fecha) },
      rutas: rutas.map((r) => {
        const e = estados.get(r.id)!;
        const preoperacional = e.abierta ? { via: e.via, detalle: e.detalle, confirmado: e.confirmado } : null;
        const bloqueo = e.abierta ? null : { codigo: e.codigo, mensaje: e.mensaje };
        // Bloqueada: solo el encabezado (código, fecha, vehículo); nada de paradas, sedes ni clientes
        return { ...r, paradas: e.abierta ? r.paradas.map((p) => ({ ...p, ultimoFirmante: firmante.get(p.sucursalId) ?? null })) : [],
          paradasBloqueadas: e.abierta ? 0 : r.paradas.length, preoperacional, bloqueo, mantenimiento: e.enlaces };
      }),
      manifiestos: mfs,
      catalogos: { etapas, arl, eps, causales },
      mantenimiento: { conectado: this.preop.conectado, enlaces: this.preop.enlacesGenerales() },
    };
  }

  async estado(a: Actor, id: string, b: z.infer<typeof EstadoRuta>) {
    await this.ruta(a, id);
    const r = await this.logistica.estadoRuta(a, id, b);
    return { id: r.id, estadoRecorridoId: r.estadoRecorridoId };
  }

  async rastreo(a: Actor, id: string, b: z.infer<typeof Rastreo>) {
    await this.ruta(a, id);
    return this.logistica.rastreo(a, id, b);
  }

  /** Un manifiesto de cargue por cada parada con líneas programadas (como al salir de planta). */
  /**
   * Abre lo que se puede: un manifiesto por parada y destino (los peligrosos, directo a su gestor aliado). Si un peligroso
   * tiene más de un gestor posible, el conductor no lo elige: queda para la oficina, que recibe el aviso, y el conductor
   * sigue con lo demás.
   */
  async abrirManifiestos(a: Actor, rutaId: string) {
    await this.ruta(a, rutaId);
    await this.preop.asegurar(rutaId); // regla de Terra Viva: sin preoperacional apto no hay manifiesto
    const { creados, pendientes, codigo } = await this.manifiestos.abrirDesdeRuta(a, { rutaId, paradaIds: [], gestores: {} }, true);
    const residuos = pendientes.map((p) => `«${p.residuo}»`).join(', ');
    if (pendientes.length) void this.notificaciones.aPermisos(a.empresaId, ['rutas.programar'], { titulo: `Ruta ${codigo}: elegir gestor aliado`,
      cuerpo: `${residuos}: abra los manifiestos desde el detalle de la ruta y elija el gestor aliado que los recibe. El conductor ya está en ruta.`,
      ruta: 'seguimiento', etiqueta: `gestor-${rutaId}` }, a.id).catch(() => undefined);
    return {
      manifiestos: creados.map((m) => ({ id: m.id, numero: m.numero })),
      aviso: pendientes.length ? `Faltan los manifiestos de ${residuos} (residuo peligroso): la oficina elige el gestor aliado que lo recibe y ya tiene el aviso. Cuando lo abra, actualice la ruta.` : null,
    };
  }

  async editarLinea(a: Actor, id: string, itemId: string, b: z.infer<typeof EditarLinea>) {
    await this.manifiesto(a, id);
    await this.manifiestos.editarLinea(a, id, itemId, b);
    return { ok: true };
  }

  async evidencia(a: Actor, id: string, b: z.infer<typeof Evidencia>, f?: Express.Multer.File) {
    await this.manifiesto(a, id);
    const ev = await this.manifiestos.evidencia(a, id, b, f);
    return { id: ev.id, tipo: ev.tipo };
  }

  async grabar(a: Actor, id: string, b: z.infer<typeof Grabar>) {
    await this.manifiesto(a, id);
    // Las novedades que ya anotó el servidor (lo que no se recogió) se conservan junto a las observaciones del conductor
    const previo = (await this.db.manifiesto.findUnique({ where: { id }, select: { observaciones: true } }))?.observaciones;
    const observaciones = [previo, b.observaciones].filter(Boolean).join('\n').slice(0, 2000) || undefined;
    const m = await this.manifiestos.grabar(a, id, { ...b, observaciones });
    return { id: m.id, numero: m.numero, estado: m.estado }; // sin precios: el detalle de oficina los trae
  }

  /**
   * «No había este residuo» (honestidad sin castigo): la línea sale del manifiesto, la novedad queda escrita en él, la línea
   * de la solicitud vuelve a «por programar» y el coordinador recibe el aviso.
   */
  async noRecogido(a: Actor, id: string, itemId: string, b: z.infer<typeof Novedad>) {
    await this.manifiesto(a, id);
    const mf = await this.db.manifiesto.findUniqueOrThrow({ where: { id }, select: { numero: true, estado: true, observaciones: true,
      items: { select: { id: true, solicitudItemId: true, declaracion: { select: { nombre: true } } } } } });
    if (mf.estado !== 'PENDIENTE') throw new BadRequestException({ mensaje: `El manifiesto ${mf.numero} ya está grabado o anulado.` });
    const item = mf.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException({ mensaje: 'Esa línea no está en el manifiesto.' });
    const { causalId, texto } = await this.motivo(a, b);
    const nota = `No se recogió ${item.declaracion.nombre}: ${texto}.`;
    const quedan = mf.items.length - 1;
    // Si no queda nada por recoger en el manifiesto, se anula; y si tampoco le queda nada a la parada (otro manifiesto, como
    // el de los peligrosos hacia el gestor aliado, o líneas sin abrir), la parada queda «no atendida» con el mismo motivo
    const parada = quedan === 0 && item.solicitudItemId
      ? await this.db.rutaItem.findFirst({ where: { solicitudItemId: item.solicitudItemId, liberado: false }, select: { paradaId: true } }) : null;
    let paradaNoAtendida = false;
    await this.db.$transaction(async (tx) => {
      await tx.manifiestoItem.delete({ where: { id: itemId } });
      if (item.solicitudItemId) await tx.rutaItem.updateMany({ where: { solicitudItemId: item.solicitudItemId, liberado: false }, data: { liberado: true } });
      const observaciones = [mf.observaciones, nota].filter(Boolean).join('\n').slice(0, 2000);
      await tx.manifiesto.update({ where: { id }, data: quedan === 0
        ? { observaciones, estado: 'ANULADO', causalAnulacionId: causalId, motivoAnulacion: `No se recogió nada: ${texto}`.slice(0, 300), anuladoPorId: a.id }
        : { observaciones } });
      paradaNoAtendida = !!parada && !(await tx.rutaItem.count({ where: { paradaId: parada.paradaId, liberado: false } }));
      if (parada && paradaNoAtendida) await tx.rutaParada.update({ where: { id: parada.paradaId }, data: { estado: 'NO_ATENDIDA', horaLlegada: new Date(), observaciones: `No se recogió nada: ${texto}`.slice(0, 500) } });
      await this.audit.registrar(a, 'manifiesto', id, 'NO_RECOGIDO', undefined, { itemId, residuo: item.declaracion.nombre, motivo: texto, anulado: quedan === 0 }, tx);
    });
    void this.notificaciones.aPermisos(a.empresaId, ['rutas.programar'], { titulo: `Novedad en ruta · ${mf.numero}`, cuerpo: quedan === 0 ? `${nota} No quedó nada por recoger: el manifiesto se anuló.` : nota,
      ruta: 'seguimiento', etiqueta: `novedad-${itemId}` }, a.id).catch(() => undefined);
    return { quedan, anulado: quedan === 0, paradaNoAtendida };
  }

  /** Parada no atendida (cerrado, no autorizaron el ingreso…): se anulan sus manifiestos pendientes con el motivo y se avisa. */
  async noAtendida(a: Actor, paradaId: string, b: z.infer<typeof Novedad>) {
    const p = await this.db.rutaParada.findFirst({ where: { id: paradaId, ruta: { empresaId: a.empresaId } }, select: { id: true, rutaId: true, estado: true, sucursal: { select: { nombre: true, clienteId: true } } } });
    if (!p) throw new NotFoundException({ mensaje: 'Parada no encontrada.' });
    await this.ruta(a, p.rutaId);
    const { causalId, texto } = await this.motivo(a, b);
    // Los manifiestos pendientes de la parada: los que tienen sus líneas, o los que ya quedaron sin líneas de ese cliente
    const pendientes = await this.db.manifiesto.findMany({ where: { rutaId: p.rutaId, estado: 'PENDIENTE', OR: [
      { items: { some: { solicitudItem: { rutaItems: { some: { paradaId } } } } } }, { items: { none: {} }, clienteId: p.sucursal.clienteId }] }, select: { id: true, numero: true } });
    if (await this.db.manifiesto.count({ where: { rutaId: p.rutaId, estado: 'REALIZADO', items: { some: { solicitudItem: { rutaItems: { some: { paradaId } } } } } } }))
      throw new BadRequestException({ mensaje: 'La parada ya tiene un manifiesto grabado: la novedad va en ese manifiesto.' });
    await this.db.$transaction(async (tx) => {
      for (const m of pendientes) await tx.manifiesto.update({ where: { id: m.id }, data: { estado: 'ANULADO', causalAnulacionId: causalId, motivoAnulacion: `Parada no atendida: ${texto}`.slice(0, 300), anuladoPorId: a.id } });
      await tx.rutaParada.update({ where: { id: paradaId }, data: { estado: 'NO_ATENDIDA', horaLlegada: new Date(), observaciones: texto.slice(0, 500) } });
      await this.audit.registrar(a, 'parada', paradaId, 'NO_ATENDIDA', { estado: p.estado }, { motivo: texto, manifiestos: pendientes.map((m) => m.numero) }, tx);
    });
    void this.notificaciones.aPermisos(a.empresaId, ['rutas.programar'], { titulo: `Parada no atendida · ${p.sucursal.nombre}`, cuerpo: texto, ruta: 'seguimiento', etiqueta: `parada-${paradaId}` }, a.id).catch(() => undefined);
    return { anulados: pendientes.map((m) => m.numero) };
  }
}

const archivo = (mb: number) => FileInterceptor('archivo', { limits: { fileSize: mb * 1024 * 1024, files: 1 } });

@PermiteCampo()
@Controller('campo')
class CampoController {
  constructor(private readonly s: CampoService) {}
  @Permiso('rutas.operar') @Get('paquete') paquete(@ActorActual() a: Actor, @Query(new Zod(Fecha)) q: z.infer<typeof Fecha>) { return this.s.paquete(a, q.fecha ?? fechaColombia()); }
  // «Mi vehículo», el preoperacional y las fallas están en Mantenimiento (el Portal Logístico abre sus pantallas)
  @Permiso('rutas.operar') @Get('mi-vehiculo') miVehiculo() { throw new GoneException({ codigo: 'EN_MANTENIMIENTO', mensaje: '«Mi vehículo» ahora está en Mantenimiento: en el Portal Logístico, toque «Más» › «Mi vehículo».' }); }
  @Permiso('rutas.operar') @Post('preoperacionales') preop() { throw preopEnMantenimiento(); }
  @Permiso('rutas.operar') @Post('preoperacionales/:id/fotos') fotoPreop() { throw preopEnMantenimiento(); }
  @Permiso('rutas.operar') @Patch('rutas/:id/estado') estado(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(EstadoRuta)) b: z.infer<typeof EstadoRuta>) { return this.s.estado(a, id, b); }
  @Permiso('rutas.operar') @Post('rutas/:id/rastreo') rastreo(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Rastreo)) b: z.infer<typeof Rastreo>) { return this.s.rastreo(a, id, b); }
  @Permiso('manifiestos.operar') @Post('rutas/:id/manifiestos') abrir(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.abrirManifiestos(a, id); }
  @Permiso('manifiestos.operar') @Patch('manifiestos/:id/items/:itemId')
  editarLinea(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Body(new Zod(EditarLinea)) b: z.infer<typeof EditarLinea>) { return this.s.editarLinea(a, id, itemId, b); }
  @Permiso('manifiestos.operar') @Post('manifiestos/:id/evidencias') @UseInterceptors(archivo(10))
  evidencia(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Evidencia)) b: z.infer<typeof Evidencia>, @UploadedFile() f?: Express.Multer.File) { return this.s.evidencia(a, id, b, f); }
  @Permiso('manifiestos.operar') @Post('manifiestos/:id/grabar') grabar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Grabar)) b: z.infer<typeof Grabar>) { return this.s.grabar(a, id, b); }
  @Permiso('manifiestos.operar') @Post('manifiestos/:id/items/:itemId/no-recogido')
  noRecogido(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Body(new Zod(Novedad)) b: z.infer<typeof Novedad>) { return this.s.noRecogido(a, id, itemId, b); }
  @Permiso('rutas.operar') @Post('paradas/:id/no-atendida') noAtendida(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Novedad)) b: z.infer<typeof Novedad>) { return this.s.noAtendida(a, id, b); }
}

@Module({ imports: [LogisticaModule, ManifiestosModule, MantenimientoModule], controllers: [CampoController], providers: [CampoService] })
export class CampoModule {}
