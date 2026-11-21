// App de campo (conductores y auxiliares, desde el celular): todo lo que el teléfono le pide al servidor, en un solo lugar.
//
// Decisión de la gerencia (20-11-2026): campo NO consulta clientes ni precios. Recibe solo su ruta del día (lo indispensable
// para atender cada parada e imprimir el manifiesto en sitio) y, en solo lectura, el estado de mantenimiento de su vehículo.
// El guard global le niega a un token de campo cualquier otra ruta del servidor (@PermiteCampo en common/http.ts), y aquí
// cada consulta elige campo por campo lo que sale (select): ni tarifas, ni valor del flete, ni historial del cliente.
import { Body, Controller, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { ActorActual, Permiso, PermiteCampo, Zod, fechaColombia, type Actor } from '../common/http';
import { EstadoRuta, LogisticaModule, LogisticaService, Preop, Rastreo } from '../rutas/logistica.module';
import { EditarLinea, Evidencia, Grabar, ManifiestosModule, ManifiestosService } from '../manifiestos/manifiestos.module';
import { notaBascula } from '../manifiestos/pdf';

const Fecha = z.object({ fecha: z.coerce.date().optional() });

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
  constructor(private readonly db: PrismaService, private readonly logistica: LogisticaService, private readonly manifiestos: ManifiestosService) {}

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
    const ids = rutas.map((r) => r.id);
    const sedes = [...new Set(rutas.flatMap((r) => r.paradas.map((p) => p.sucursalId)))];
    const vehiculos = [...new Set(rutas.map((r) => r.vehiculoId).filter((v): v is string => !!v))];
    const [mfs, empresa, etapas, arl, eps, causales, elementos, inspecciones, firmados] = await Promise.all([
      this.db.manifiesto.findMany({ where: { empresaId: a.empresaId, rutaId: { in: ids }, estado: { not: 'ANULADO' } }, orderBy: { numero: 'asc' }, select: seleccionMf }),
      this.db.empresa.findUniqueOrThrow({ where: { id: a.empresaId }, select: { razonSocial: true, nit: true, configuracion: true } }),
      this.db.estadoRecorrido.findMany({ where: { empresaId: a.empresaId, activo: true }, orderBy: { orden: 'asc' },
        select: { id: true, nombre: true, color: true, orden: true, esFinal: true, cancela: true, rastreo: true, descripcion: true } }),
      this.db.entidadSeguridadSocial.findMany({ where: { tipo: 'ARL', activo: true }, orderBy: { nombre: 'asc' }, select: { id: true, nombre: true } }),
      this.db.entidadSeguridadSocial.findMany({ where: { tipo: 'EPS', activo: true }, orderBy: { nombre: 'asc' }, select: { id: true, nombre: true } }),
      this.db.catalogoItem.findMany({ where: { empresaId: a.empresaId, tipo: 'CAUSAL', activo: true }, orderBy: { nombre: 'asc' }, select: { id: true, nombre: true } }),
      this.db.elementoChequeo.findMany({ where: { empresaId: a.empresaId, activo: true }, orderBy: [{ grupo: 'asc' }, { nombre: 'asc' }], select: { id: true, grupo: true, nombre: true, critico: true } }),
      this.db.preoperacional.findMany({ where: { vehiculoId: { in: vehiculos }, fechaProgramada: fecha }, orderBy: { fechaReal: 'desc' }, select: { id: true, numero: true, vehiculoId: true, aprobado: true } }),
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
      rutas: rutas.map((r) => ({ ...r, paradas: r.paradas.map((p) => ({ ...p, ultimoFirmante: firmante.get(p.sucursalId) ?? null })) })),
      manifiestos: mfs,
      catalogos: { etapas, arl, eps, causales },
      elementos, inspecciones,
    };
  }

  /**
   * «Todos somos supervisores», solo en mantenimiento: el vehículo de su ruta (vencimientos y últimas inspecciones con sus
   * fallas). Nada de clientes.
   */
  async miVehiculo(a: Actor, fecha: Date) {
    const r = await this.db.ruta.findFirst({ where: { empresaId: a.empresaId, vehiculoId: { not: null }, fechaProgramada: { lte: fecha }, OR: [{ conductorId: a.id }, { auxiliarId: a.id }] },
      orderBy: { fechaProgramada: 'desc' }, select: { vehiculoId: true } });
    if (!r?.vehiculoId) return { vehiculo: null, inspecciones: [] };
    const [vehiculo, inspecciones] = await Promise.all([
      this.db.vehiculo.findUnique({ where: { id: r.vehiculoId }, select: { id: true, placa: true, marca: true, tipo: true, soatVence: true, rtmVence: true, polizaRcVence: true } }),
      this.db.preoperacional.findMany({ where: { vehiculoId: r.vehiculoId }, orderBy: [{ fechaProgramada: 'desc' }, { fechaReal: 'desc' }], take: 15,
        select: { id: true, numero: true, fechaProgramada: true, fechaReal: true, aprobado: true, km: true, observaciones: true, conductor: { select: { nombre: true } },
          respuestas: { where: { resultado: 'NO_OK' }, select: { elemento: { select: { nombre: true, critico: true } } } } } }),
    ]);
    return { vehiculo, inspecciones: inspecciones.map(({ respuestas, ...i }) => ({ ...i, fallas: respuestas.map((x) => ({ nombre: x.elemento.nombre, critico: x.elemento.critico })) })) };
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
  async abrirManifiestos(a: Actor, rutaId: string) {
    await this.ruta(a, rutaId);
    const creados = await this.manifiestos.desdeRuta(a, { rutaId, paradaIds: [] });
    return creados.map((m) => ({ id: m.id, numero: m.numero }));
  }

  async preoperacional(a: Actor, b: z.infer<typeof Preop>) {
    // Campo inspecciona solo el vehículo de una ruta suya de esa fecha
    if (!this.supervisa(a) && !(await this.db.ruta.findFirst({ where: { empresaId: a.empresaId, vehiculoId: b.vehiculoId, fechaProgramada: b.fechaProgramada,
      OR: [{ conductorId: a.id }, { auxiliarId: a.id }] }, select: { id: true } })))
      throw new ForbiddenException({ mensaje: 'Ese vehículo no está en una ruta suya de esa fecha.' });
    const p = await this.logistica.preoperacional(a, b);
    return { id: p.id, numero: p.numero, aprobado: p.aprobado, fallasCriticas: p.fallasCriticas };
  }

  fotoPreop(a: Actor, id: string, elementoId: string | undefined, f?: Express.Multer.File) {
    return this.logistica.fotoPreop(a, id, elementoId, f); // solo quien hizo la inspección agrega sus fotos
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
    const m = await this.manifiestos.grabar(a, id, b);
    return { id: m.id, numero: m.numero, estado: m.estado }; // sin precios: el detalle de oficina los trae
  }
}

const archivo = (mb: number) => FileInterceptor('archivo', { limits: { fileSize: mb * 1024 * 1024, files: 1 } });

@PermiteCampo()
@Controller('campo')
class CampoController {
  constructor(private readonly s: CampoService) {}
  @Permiso('rutas.operar') @Get('paquete') paquete(@ActorActual() a: Actor, @Query(new Zod(Fecha)) q: z.infer<typeof Fecha>) { return this.s.paquete(a, q.fecha ?? fechaColombia()); }
  @Permiso('rutas.operar') @Get('mi-vehiculo') miVehiculo(@ActorActual() a: Actor, @Query(new Zod(Fecha)) q: z.infer<typeof Fecha>) { return this.s.miVehiculo(a, q.fecha ?? fechaColombia()); }
  @Permiso('rutas.operar') @Patch('rutas/:id/estado') estado(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(EstadoRuta)) b: z.infer<typeof EstadoRuta>) { return this.s.estado(a, id, b); }
  @Permiso('rutas.operar') @Post('rutas/:id/rastreo') rastreo(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Rastreo)) b: z.infer<typeof Rastreo>) { return this.s.rastreo(a, id, b); }
  @Permiso('manifiestos.operar') @Post('rutas/:id/manifiestos') abrir(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.abrirManifiestos(a, id); }
  @Permiso('rutas.operar') @Post('preoperacionales') preop(@ActorActual() a: Actor, @Body(new Zod(Preop)) b: z.infer<typeof Preop>) { return this.s.preoperacional(a, b); }
  @Permiso('rutas.operar') @Post('preoperacionales/:id/fotos') @UseInterceptors(archivo(12))
  fotoPreop(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body('elementoId') elementoId?: string, @UploadedFile() f?: Express.Multer.File) { return this.s.fotoPreop(a, id, elementoId, f); }
  @Permiso('manifiestos.operar') @Patch('manifiestos/:id/items/:itemId')
  editarLinea(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Body(new Zod(EditarLinea)) b: z.infer<typeof EditarLinea>) { return this.s.editarLinea(a, id, itemId, b); }
  @Permiso('manifiestos.operar') @Post('manifiestos/:id/evidencias') @UseInterceptors(archivo(10))
  evidencia(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Evidencia)) b: z.infer<typeof Evidencia>, @UploadedFile() f?: Express.Multer.File) { return this.s.evidencia(a, id, b, f); }
  @Permiso('manifiestos.operar') @Post('manifiestos/:id/grabar') grabar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Grabar)) b: z.infer<typeof Grabar>) { return this.s.grabar(a, id, b); }
}

@Module({ imports: [LogisticaModule, ManifiestosModule], controllers: [CampoController], providers: [CampoService] })
export class CampoModule {}
