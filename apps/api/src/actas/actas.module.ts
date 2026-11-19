import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { EstadoActa, Prisma, TipoActa } from '@prisma/client';
import type { Response } from 'express';
import JSZip from 'jszip';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { Auditoria } from '../common/servicios';
import { Archivos } from '../common/archivos';
import { ActorActual, Permiso, Publico, Zod, paginar, type Actor } from '../common/http';
import type { Config } from '../config';
import { pdfActa, type ContenidoActa } from './pdf';

type Tx = Prisma.TransactionClient;
const id = z.string().uuid();
const idsCsv = z.string().max(20_000).optional().transform((s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : []))
  .pipe(z.array(id).max(500));
const Filtros = z.object({
  desde: z.coerce.date().optional(), hasta: z.coerce.date().optional(), clienteId: id.optional(), estado: z.nativeEnum(EstadoActa).optional(),
  numero: z.string().max(20).optional(), pagina: z.coerce.number().optional(), porPagina: z.coerce.number().optional(),
});
const Pendientes = z.object({ clienteId: id, desde: z.coerce.date().optional(), hasta: z.coerce.date().optional() });
const Crear = z.object({
  tipo: z.nativeEnum(TipoActa).default('DISPOSICION'), clienteId: id, destinoId: id.optional(),
  periodoDesde: z.coerce.date(), periodoHasta: z.coerce.date(), conciliacionItemIds: z.array(id).max(2000).default([]),
}).refine((b) => b.periodoHasta >= b.periodoDesde, { message: 'El periodo está invertido.' });
const Items = z.object({ agregar: z.array(id).max(2000).default([]), quitar: z.array(id).max(2000).default([]) });
const Anular = z.object({ motivo: z.string().trim().min(5).max(300) });
const Cargar = z.object({
  tipo: z.nativeEnum(TipoActa).default('DISPOSICION'), clienteId: id, destinoId: id, periodoDesde: z.coerce.date(), periodoHasta: z.coerce.date(),
  conciliacionItemIds: idsCsv,
});
const Zip = z.object({ ids: idsCsv.pipe(z.array(id).min(1).max(200)) });

const lineasActa = {
  orderBy: [{ conciliacion: { manifiesto: { fechaServicio: 'asc' as const } } }, { id: 'asc' as const }],
  include: {
    metrica: true,
    disposicion: { include: { proveedor: true, permisos: { include: { permiso: true } } } },
    conciliacion: { include: { manifiesto: { include: { vehiculo: true, transporte: true, destino: true } } } },
    manifiestoItem: { include: {
      metrica: true, disposicion: { include: { proveedor: true, permisos: { include: { permiso: true } } } },
      declaracion: { include: { codigoY: true, codigoA: true } }, sucursal: { include: { municipio: true } },
    } },
  },
} satisfies Prisma.ConciliacionItemFindManyArgs;
type LineaActa = Prisma.ConciliacionItemGetPayload<{ include: typeof lineasActa.include }>;

@Injectable()
class ActasService {
  constructor(private readonly db: PrismaService, private readonly audit: Auditoria, private readonly archivos: Archivos, private readonly cfg: ConfigService<Config, true>) {}

  private async propia(a: Actor, id: string) {
    const x = await this.db.acta.findFirst({ where: { id, empresaId: a.empresaId } });
    if (!x) throw new NotFoundException({ mensaje: 'Acta no encontrada.' });
    return x;
  }
  /** Enlace del QR. Va con «#» para que abra en cualquier hosting estático, sin reglas de reescritura. */
  private urlVerificacion(codigo: string) { return `${this.cfg.get('WEB_URL', { infer: true }).replace(/\/$/, '')}/#verificar/${codigo}`; }

  /** Líneas de conciliaciones aprobadas del cliente que aún no están en un acta. */
  private wherePendientes(empresaId: string, clienteId: string, desde?: Date, hasta?: Date): Prisma.ConciliacionItemWhereInput {
    return { actaId: null, conciliacion: { empresaId, estado: 'APROBADA', manifiesto: { clienteId, fechaServicio: desde || hasta ? { gte: desde, lte: hasta } : undefined } } };
  }

  async pendientes(a: Actor, f: z.infer<typeof Pendientes>) {
    const xs = await this.db.conciliacionItem.findMany({ where: this.wherePendientes(a.empresaId, f.clienteId, f.desde, f.hasta), take: 2000,
      orderBy: [{ conciliacion: { manifiesto: { fechaServicio: 'asc' } } }, { id: 'asc' }],
      include: { metrica: { select: { abreviacion: true } }, disposicion: { select: { nombre: true } },
        conciliacion: { select: { manifiesto: { select: { numero: true, fechaServicio: true } } } },
        manifiestoItem: { select: { declaracion: { select: { nombre: true } }, sucursal: { select: { nombre: true } }, metrica: { select: { abreviacion: true } }, disposicion: { select: { nombre: true } } } } } });
    return xs.map((x) => ({
      id: x.id, manifiesto: x.conciliacion.manifiesto.numero, fechaServicio: x.conciliacion.manifiesto.fechaServicio, residuo: x.manifiestoItem.declaracion.nombre,
      sede: x.manifiestoItem.sucursal.nombre, cantidad: x.cantidadConciliada, unidad: x.metrica?.abreviacion ?? x.manifiestoItem.metrica?.abreviacion ?? null,
      tratamiento: x.disposicion?.nombre ?? x.manifiestoItem.disposicion?.nombre ?? null,
    }));
  }

  async listar(a: Actor, f: z.infer<typeof Filtros>) {
    const { take, skip, pagina, porPagina } = paginar(f);
    const where: Prisma.ActaWhereInput = {
      empresaId: a.empresaId, clienteId: f.clienteId, estado: f.estado, numero: f.numero ? { contains: f.numero, mode: 'insensitive' } : undefined,
      periodoHasta: f.desde ? { gte: f.desde } : undefined, periodoDesde: f.hasta ? { lte: f.hasta } : undefined,
    };
    const [total, filas] = await this.db.$transaction([
      this.db.acta.count({ where }),
      this.db.acta.findMany({ where, take, skip, orderBy: { createdAt: 'desc' }, include: {
        cliente: { select: { razonSocial: true } }, destino: { select: { razonSocial: true } }, emitidaPor: { select: { nombre: true } }, cargadaPor: { select: { nombre: true } },
        _count: { select: { items: true } } } }),
    ]);
    return { total, pagina, porPagina, filas: filas.map(({ contenido: _c, ...x }) => x) };
  }

  async obtener(a: Actor, id: string) {
    const x = await this.db.acta.findFirst({ where: { id, empresaId: a.empresaId }, include: {
      cliente: { select: { id: true, razonSocial: true, nit: true } }, destino: { select: { id: true, razonSocial: true } },
      emitidaPor: { select: { nombre: true } }, cargadaPor: { select: { nombre: true } },
      items: { include: { metrica: { select: { abreviacion: true } }, disposicion: { select: { nombre: true } },
        conciliacion: { select: { manifiesto: { select: { numero: true, fechaServicio: true } } } },
        manifiestoItem: { select: { declaracion: { select: { nombre: true } }, sucursal: { select: { nombre: true } }, metrica: { select: { abreviacion: true } } } } } },
    } });
    if (!x) throw new NotFoundException({ mensaje: 'Acta no encontrada.' });
    return { ...x, urlVerificacion: this.urlVerificacion(x.codigoVerificacion) };
  }

  async crear(a: Actor, b: z.infer<typeof Crear>) {
    return this.db.$transaction(async (tx) => {
      const cliente = await tx.cliente.findFirst({ where: { id: b.clienteId, empresaId: a.empresaId } });
      if (!cliente) throw new BadRequestException({ mensaje: 'Cliente no encontrado.' });
      const destino = await tx.proveedor.findFirst({ where: b.destinoId ? { id: b.destinoId, empresaId: a.empresaId } : { empresaId: a.empresaId, esPropio: true } });
      if (!destino) throw new BadRequestException({ mensaje: 'Destino no encontrado.' });
      const ids = b.conciliacionItemIds.length ? b.conciliacionItemIds
        : (await tx.conciliacionItem.findMany({ where: this.wherePendientes(a.empresaId, cliente.id, b.periodoDesde, b.periodoHasta), select: { id: true } })).map((x) => x.id);
      if (!ids.length) throw new BadRequestException({ mensaje: 'No hay líneas de conciliaciones aprobadas sin certificar en ese periodo.' });
      const acta = await tx.acta.create({ data: { empresaId: a.empresaId, tipo: b.tipo, clienteId: cliente.id, destinoId: destino.id, periodoDesde: b.periodoDesde, periodoHasta: b.periodoHasta } });
      await this.vincular(tx, a, acta.id, ids);
      await this.audit.registrar(a, 'acta', acta.id, 'CREAR', undefined, { numero: acta.numero, lineas: ids.length }, tx);
      return acta;
    });
  }

  /** Asigna líneas al acta en borrador. La base exige conciliación aprobada y el mismo cliente. */
  private async vincular(tx: Tx, a: Actor, actaId: string, ids: string[]) {
    const r = await tx.conciliacionItem.updateMany({ where: { id: { in: ids }, actaId: null, conciliacion: { empresaId: a.empresaId } }, data: { actaId } });
    if (r.count !== new Set(ids).size) throw new BadRequestException({ mensaje: 'Alguna línea no existe, no es de su empresa o ya está en otra acta.' });
  }

  async items(a: Actor, id: string, b: z.infer<typeof Items>) {
    const acta = await this.propia(a, id);
    if (acta.estado !== 'BORRADOR') throw new BadRequestException({ mensaje: `El acta ${acta.numero} ya fue emitida o anulada.` });
    await this.db.$transaction(async (tx) => {
      if (b.quitar.length) await tx.conciliacionItem.updateMany({ where: { id: { in: b.quitar }, actaId: id }, data: { actaId: null } });
      if (b.agregar.length) await this.vincular(tx, a, id, b.agregar);
      await this.audit.registrar(a, 'acta', id, 'LINEAS', undefined, b, tx);
    });
    return this.obtener(a, id);
  }

  /** Copia fija de lo que se certifica, con el soporte legal vigente a la fecha de cada servicio. */
  private async contenido(a: Actor, acta: Prisma.ActaGetPayload<{ include: { cliente: true; destino: true } }>, exigirSoporte: boolean): Promise<ContenidoActa> {
    const [empresa, lineas] = await Promise.all([
      this.db.empresa.findUniqueOrThrow({ where: { id: a.empresaId } }),
      this.db.conciliacionItem.findMany({ where: { actaId: acta.id }, ...lineasActa }),
    ]);
    const sinSoporte: string[] = [];
    const permisosUsados = new Map<string, { acto: string; autoridad: string; alcance: string; vence: string | null }>();
    const soporte = (l: LineaActa) => {
      const d = l.disposicion ?? l.manifiestoItem.disposicion;
      const fechaServicio = l.conciliacion.manifiesto.fechaServicio;
      if (!d) return null;
      if (!d.requierePermiso) return [d.soporteLegal ?? 'Objeto social de la empresa'];
      if (!d.propia) {
        const p = d.proveedor;
        return p?.licencia && p.licenciaVence && p.licenciaVence >= fechaServicio ? [`${p.razonSocial}: ${p.licencia}`] : null;
      }
      const vigentes = d.permisos.map((x) => x.permiso).filter((p) => p.empresaId === a.empresaId &&
        (p.vence ? p.vence >= fechaServicio : ['VIGENTE', 'POR_VENCER'].includes(p.estado)));
      vigentes.forEach((p) => permisosUsados.set(p.id, { acto: p.acto, autoridad: p.autoridad, alcance: p.alcance, vence: p.vence?.toISOString().slice(0, 10) ?? null }));
      return vigentes.length ? vigentes.map((p) => `${p.acto} (${p.autoridad})`) : null;
    };
    const filas = lineas.map((l) => {
      const m = l.conciliacion.manifiesto, mi = l.manifiestoItem, d = l.disposicion ?? mi.disposicion;
      const s = soporte(l);
      if (exigirSoporte && (!s || !d)) sinSoporte.push(`${m.numero} · ${mi.declaracion.nombre}${d ? ` (${d.nombre})` : ' (sin tratamiento)'}`);
      return {
        manifiesto: m.numero, fechaServicio: m.fechaServicio.toISOString().slice(0, 10), residuo: mi.declaracion.nombre, codigoInterno: mi.declaracion.codigoInterno,
        peligroso: mi.declaracion.esPeligroso, corrientes: [mi.declaracion.codigoY?.codigo, mi.declaracion.codigoA?.codigo].filter(Boolean) as string[],
        sede: mi.sucursal.nombre, cantidad: Number(l.cantidadConciliada ?? l.cantidadCargada), unidad: l.metrica?.abreviacion ?? mi.metrica?.abreviacion ?? 'und',
        tratamiento: d?.nombre ?? '—', soporte: s ?? [],
      };
    });
    if (sinSoporte.length) throw new BadRequestException({ mensaje: `No se puede emitir: sin permiso o licencia vigente a la fecha del servicio para ${sinSoporte.join('; ')}.` });
    const totales = new Map<string, number>();
    filas.forEach((f) => totales.set(f.unidad, (totales.get(f.unidad) ?? 0) + f.cantidad));
    const sedes = new Map(lineas.map((l) => [l.manifiestoItem.sucursal.id, l.manifiestoItem.sucursal]));
    const transporte = new Map(lineas.map((l) => { const m = l.conciliacion.manifiesto; return [m.numero, {
      manifiesto: m.numero, vehiculo: m.vehiculo?.placa ?? m.transporte?.placa ?? null,
      transportador: m.transporte?.empresaTransportadora ?? empresa.razonSocial,
    }]; }));
    return {
      version: 1, origen: acta.origen, tipo: acta.tipo, numero: acta.numero, emitidaEn: new Date().toISOString(),
      periodo: { desde: acta.periodoDesde.toISOString().slice(0, 10), hasta: acta.periodoHasta.toISOString().slice(0, 10) },
      emisor: { razonSocial: empresa.razonSocial, nit: empresa.nit },
      destino: { razonSocial: acta.destino.razonSocial, nit: acta.destino.nit, municipio: acta.destino.municipio },
      cliente: { razonSocial: acta.cliente.razonSocial, nit: acta.cliente.nit, dv: acta.cliente.dv },
      sedes: [...sedes.values()].map((s) => ({ codigo: s.codigo, nombre: s.nombre, direccion: s.direccion, municipio: s.municipio ? `${s.municipio.nombre} (${s.municipio.departamento})` : null,
        latitud: s.latitud === null ? null : Number(s.latitud), longitud: s.longitud === null ? null : Number(s.longitud) })),
      lineas: filas, totales: [...totales.entries()].map(([unidad, cantidad]) => ({ unidad, cantidad: Math.round(cantidad * 100) / 100 })),
      transporte: [...transporte.values()], marcoLegal: [...permisosUsados.values()],
      verificacion: { codigo: acta.codigoVerificacion, url: this.urlVerificacion(acta.codigoVerificacion) },
    };
  }

  /** Emitir: copia fija + PDF con QR. La base exige líneas aprobadas y el contenido. */
  async emitir(a: Actor, id: string) {
    const acta = await this.db.acta.findFirst({ where: { id, empresaId: a.empresaId }, include: { cliente: true, destino: true } });
    if (!acta) throw new NotFoundException({ mensaje: 'Acta no encontrada.' });
    if (acta.estado !== 'BORRADOR') throw new BadRequestException({ mensaje: `El acta ${acta.numero} ya fue emitida o anulada.` });
    if (acta.origen === 'CARGADA') throw new BadRequestException({ mensaje: 'Las actas cargadas de un aliado se emiten al cargarlas.' });
    const contenido = await this.contenido(a, acta, true);
    const pdf = await this.archivos.guardar(a.empresaId, 'actas', await pdfActa(contenido), ['pdf']);
    await this.db.acta.update({ where: { id }, data: { contenido: contenido as unknown as Prisma.InputJsonValue, estado: 'EMITIDA', emitidaPorId: a.id, pdfUrl: pdf.clave, emitidaEn: new Date(contenido.emitidaEn) } });
    await this.audit.registrar(a, 'acta', id, 'EMITIR', { estado: 'BORRADOR' }, { estado: 'EMITIDA', lineas: contenido.lineas.length });
    return this.obtener(a, id);
  }

  /** Acta de un gestor aliado: se sube el PDF y queda emitida, opcionalmente con las líneas que certifica. */
  async cargar(a: Actor, b: z.infer<typeof Cargar>, file?: Express.Multer.File) {
    if (!file) throw new BadRequestException({ mensaje: 'Adjunte el PDF del acta en el campo «archivo».' });
    if (b.periodoHasta < b.periodoDesde) throw new BadRequestException({ mensaje: 'El periodo está invertido.' });
    const [cliente, destino] = await Promise.all([
      this.db.cliente.findFirst({ where: { id: b.clienteId, empresaId: a.empresaId } }),
      this.db.proveedor.findFirst({ where: { id: b.destinoId, empresaId: a.empresaId } }),
    ]);
    if (!cliente || !destino) throw new BadRequestException({ mensaje: 'Cliente o gestor no encontrado.' });
    const g = await this.archivos.guardar(a.empresaId, 'actas', file.buffer, ['pdf']);
    const acta = await this.db.$transaction(async (tx) => {
      const x = await tx.acta.create({ data: { empresaId: a.empresaId, tipo: b.tipo, origen: 'CARGADA', clienteId: cliente.id, destinoId: destino.id, periodoDesde: b.periodoDesde, periodoHasta: b.periodoHasta, archivoUrl: g.clave, cargadaPorId: a.id } });
      if (b.conciliacionItemIds.length) await this.vincular(tx, a, x.id, b.conciliacionItemIds);
      return tx.acta.findUniqueOrThrow({ where: { id: x.id }, include: { cliente: true, destino: true } });
    });
    const contenido = await this.contenido(a, acta, false);
    await this.db.acta.update({ where: { id: acta.id }, data: { contenido: contenido as unknown as Prisma.InputJsonValue, estado: 'EMITIDA', emitidaPorId: a.id, emitidaEn: new Date(contenido.emitidaEn) } });
    await this.audit.registrar(a, 'acta', acta.id, 'CARGAR', undefined, { numero: acta.numero, archivo: file.originalname });
    return this.obtener(a, acta.id);
  }

  async anular(a: Actor, id: string, b: z.infer<typeof Anular>) {
    const acta = await this.propia(a, id);
    const r = await this.db.acta.update({ where: { id }, data: { estado: 'ANULADA', motivoAnulacion: b.motivo } });
    await this.audit.registrar(a, 'acta', id, 'ANULAR', { estado: acta.estado }, { estado: 'ANULADA', motivo: b.motivo });
    return r;
  }

  private async archivoPdf(a: Actor, acta: { pdfUrl: string | null; archivoUrl: string | null; numero: string }) {
    const clave = acta.pdfUrl ?? acta.archivoUrl;
    if (!clave) throw new NotFoundException({ mensaje: `El acta ${acta.numero} aún no tiene PDF (está en borrador).` });
    return (await this.archivos.leer(clave, a.empresaId)).buf;
  }

  async pdf(a: Actor, id: string, res: Response) {
    const acta = await this.propia(a, id);
    const buf = await this.archivoPdf(a, acta);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${acta.numero}.pdf"`);
    res.send(buf);
  }

  /** Descarga masiva: varias actas en un ZIP. */
  async zip(a: Actor, ids: string[], res: Response) {
    const actas = await this.db.acta.findMany({ where: { id: { in: ids }, empresaId: a.empresaId, estado: { not: 'BORRADOR' } } });
    if (!actas.length) throw new NotFoundException({ mensaje: 'No hay actas emitidas en la selección.' });
    const zip = new JSZip();
    for (const x of actas) zip.file(`${x.numero}${x.estado === 'ANULADA' ? '-ANULADA' : ''}.pdf`, await this.archivoPdf(a, x));
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="actas-${new Date().toISOString().slice(0, 10)}.zip"`);
    res.send(buf);
  }

  /** Verificación pública del QR: solo lo mínimo, nunca datos del cliente. */
  async verificar(codigo: string) {
    const x = await this.db.acta.findUnique({ where: { codigoVerificacion: codigo }, include: { empresa: { select: { razonSocial: true, nit: true } } } });
    if (!x || x.estado === 'BORRADOR') throw new NotFoundException({ valido: false, mensaje: 'No existe un documento emitido con ese código.' });
    return {
      valido: x.estado === 'EMITIDA', estado: x.estado, numero: x.numero, tipo: x.tipo, emitidaEn: x.emitidaEn,
      periodo: { desde: x.periodoDesde, hasta: x.periodoHasta }, emisor: x.empresa,
      mensaje: x.estado === 'EMITIDA' ? 'Documento auténtico y vigente.' : `Documento ANULADO el ${x.anuladaEn?.toISOString().slice(0, 10) ?? ''}.`,
    };
  }
}

const archivo = FileInterceptor('archivo', { limits: { fileSize: 15 * 1024 * 1024, files: 1 } });

@Controller('actas')
class ActasController {
  constructor(private readonly s: ActasService) {}
  @Get() listar(@ActorActual() a: Actor, @Query(new Zod(Filtros)) f: z.infer<typeof Filtros>) { return this.s.listar(a, f); }
  @Get('pendientes') pendientes(@ActorActual() a: Actor, @Query(new Zod(Pendientes)) f: z.infer<typeof Pendientes>) { return this.s.pendientes(a, f); }
  @Get('zip') zip(@ActorActual() a: Actor, @Query(new Zod(Zip)) q: z.infer<typeof Zip>, @Res() res: Response) { return this.s.zip(a, q.ids, res); }
  @Get(':id') obtener(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.obtener(a, id); }
  @Get(':id/pdf') pdf(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) { return this.s.pdf(a, id, res); }
  @Permiso('actas.emitir') @Post() crear(@ActorActual() a: Actor, @Body(new Zod(Crear)) b: z.infer<typeof Crear>) { return this.s.crear(a, b); }
  @Permiso('actas.emitir') @Post('cargar') @UseInterceptors(archivo)
  cargar(@ActorActual() a: Actor, @Body(new Zod(Cargar)) b: z.infer<typeof Cargar>, @UploadedFile() f?: Express.Multer.File) { return this.s.cargar(a, b, f); }
  @Permiso('actas.emitir') @Post(':id/items') items(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Items)) b: z.infer<typeof Items>) { return this.s.items(a, id, b); }
  @Permiso('actas.emitir') @Post(':id/emitir') emitir(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.emitir(a, id); }
  @Permiso('actas.emitir') @Post(':id/anular') anular(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Anular)) b: z.infer<typeof Anular>) { return this.s.anular(a, id, b); }
}

/** Verificación pública del código QR del certificado (sin sesión). */
@Controller('verificar')
class VerificarController {
  constructor(private readonly s: ActasService) {}
  @Publico() @Throttle({ default: { limit: 30, ttl: 60_000 } }) @Get(':codigo')
  verificar(@Param('codigo') codigo: string) {
    if (!/^[0-9a-f]{24}$/.test(codigo)) throw new NotFoundException({ valido: false, mensaje: 'Código de verificación inválido.' });
    return this.s.verificar(codigo);
  }
}

@Module({ controllers: [ActasController, VerificarController], providers: [ActasService] })
export class ActasModule {}
