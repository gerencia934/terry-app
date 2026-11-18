import { BadRequestException, Controller, Get, Injectable, Module, NotFoundException, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FormaPago, Prisma, TipoNegociacion, UnidadMedida } from '@prisma/client';
import type { Response } from 'express';
import { randomBytes } from 'node:crypto';
import { PLANTILLAS, construirPlantilla, dvNit, leerArchivo, norm, validarFilas, type Contexto, type FilaValidada, type Plantilla } from '@terraviva/shared';
import { PrismaService } from '../prisma/prisma.service';
import { Auditoria } from '../common/servicios';
import { ActorActual, Permiso, type Actor } from '../common/http';
import { hashClave } from '../auth/auth.service';

const MAX_MB = 10;
const digitos = (s?: string) => (s ?? '').replace(/\D/g, '');
const mapa = <T extends string>(pares: [string, T][]) => (v?: string) => pares.find(([k]) => norm(k) === norm(v ?? ''))?.[1];
const negociacion = mapa<TipoNegociacion>([['Cobro', 'COBRO'], ['Compra', 'COMPRA'], ['Sin costo', 'SIN_COSTO']]);
const formaPago = mapa<FormaPago>([['Contado', 'CONTADO'], ['Crédito 30 días', 'CREDITO_30'], ['Crédito 60 días', 'CREDITO_60'], ['Crédito 90 días', 'CREDITO_90']]);
const unidad = mapa<UnidadMedida>([['kg', 'KG'], ['t', 'TON'], ['m³', 'M3'], ['m3', 'M3'], ['gal', 'GAL'], ['L', 'L'], ['und', 'UND']]);
const si = (v?: string) => norm(v ?? '') === 'si';
const num = (v?: string) => (v ? Number(v.replace(',', '.')) : undefined);
const fecha = (v?: string) => (v ? new Date(`${v}T00:00:00Z`) : undefined);
type Tx = Prisma.TransactionClient;

@Injectable()
class ImportacionService {
  constructor(private readonly db: PrismaService, private readonly audit: Auditoria) {}

  plantilla(id: string): Plantilla {
    const p = PLANTILLAS.find((x) => x.id === id);
    if (!p) throw new NotFoundException({ mensaje: `No existe la plantilla «${id}».` });
    return p;
  }

  /** Datos existentes de la empresa contra los cuales se cruzan las filas. */
  async contexto(empresaId: string): Promise<Contexto> {
    const [clientes, vehiculos, usuarios, permisos, manejos, decls] = await Promise.all([
      this.db.cliente.findMany({ where: { empresaId }, select: { nit: true, sucursales: { select: { nombre: true } } } }),
      this.db.vehiculo.findMany({ where: { empresaId }, select: { placa: true } }),
      this.db.usuario.findMany({ select: { email: true } }), // el correo es único en todo el sistema
      this.db.permisoAmbiental.findMany({ where: { empresaId, estado: { in: ['VIGENTE', 'POR_VENCER'] } }, select: { manejosCubiertos: true } }),
      this.db.catalogoItem.findMany({ where: { empresaId, tipo: 'TIPO_MANEJO' }, select: { codigo: true, meta: true } }),
      this.db.declaracion.findMany({ where: { empresaId }, select: { numero: true, estado: true, residuo: { select: { codigo: true } } } }),
    ]);
    return {
      nitsClientes: new Set(clientes.map((c) => c.nit)),
      sucursalesPorNit: new Map(clientes.map((c) => [c.nit, new Set(c.sucursales.map((s) => norm(s.nombre)))])),
      placas: new Set(vehiculos.map((v) => v.placa)),
      emails: new Set(usuarios.map((u) => u.email.toLowerCase())),
      manejosConPermiso: new Set([...permisos.flatMap((p) => p.manejosCubiertos), ...manejos.filter((m) => (m.meta as { requierePermiso?: boolean })?.requierePermiso === false || (m.meta as { servicio?: boolean })?.servicio).map((m) => m.codigo)]),
      manejosAliados: new Set(manejos.filter((m) => (m.meta as { propio?: boolean })?.propio === false).map((m) => m.codigo)),
      numerosDeclaracion: new Set(decls.map((d) => String(d.numero))),
      codigosInternos: new Set(decls.filter((d) => d.estado === 'AUTORIZADA').map((d) => d.residuo.codigo.toUpperCase())),
    };
  }

  async validar(a: Actor, id: string, file?: Express.Multer.File) {
    if (!file) throw new BadRequestException({ mensaje: 'Adjunte el archivo en el campo «archivo».' });
    if (!/\.xlsx$/i.test(file.originalname)) throw new BadRequestException({ mensaje: 'El archivo debe ser .xlsx (Excel). Use la plantilla descargada.' });
    const p = this.plantilla(id);
    let leido: Awaited<ReturnType<typeof leerArchivo>>;
    try { leido = await leerArchivo(p, file.buffer.buffer.slice(file.buffer.byteOffset, file.buffer.byteOffset + file.buffer.byteLength) as ArrayBuffer); }
    catch { throw new BadRequestException({ mensaje: 'No se pudo leer el archivo. Verifique que sea la plantilla en formato .xlsx.' }); }
    if (leido.filas.length > 5000) throw new BadRequestException({ mensaje: 'Máximo 5.000 filas por archivo. Divídalo en varios.' });
    const filas = validarFilas(p, leido.filas, await this.contexto(a.empresaId));
    return { plantilla: p, archivo: file.originalname, faltantes: leido.faltantes, filas,
      resumen: { leidas: filas.length, validas: filas.filter((f) => !f.errores.length).length, conErrores: filas.filter((f) => f.errores.length).length, conAdvertencias: filas.filter((f) => f.advertencias.length).length } };
  }

  async vistaPrevia(a: Actor, id: string, file?: Express.Multer.File) {
    const { plantilla: _p, ...r } = await this.validar(a, id, file);
    return r;
  }

  async confirmar(a: Actor, id: string, file?: Express.Multer.File) {
    const v = await this.validar(a, id, file);
    if (v.faltantes.length) throw new BadRequestException({ mensaje: `Faltan columnas obligatorias: ${v.faltantes.join(', ')}.` });
    const validas = v.filas.filter((f) => !f.errores.length);
    if (!validas.length) throw new BadRequestException({ mensaje: 'Ninguna fila es válida. Corrija los errores y vuelva a cargar.', filas: v.filas });
    const resultado = { creadas: 0, actualizadas: 0 };
    const cargue = await this.db.$transaction(async (tx) => {
      for (const f of validas) {
        const r = await this.guardar(tx, a, id, f);
        resultado[r]++;
      }
      const errores = v.filas.filter((f) => f.errores.length).map((f) => ({ fila: f.n, mensajes: f.errores }));
      return tx.cargueMasivo.create({ data: { empresaId: a.empresaId, plantilla: id, archivo: v.archivo, filasLeidas: v.filas.length, filasOk: validas.length, filasError: errores.length, errores, usuarioId: a.id } });
    }, { timeout: 120_000, maxWait: 10_000 });
    await this.audit.registrar(a, 'cargue_masivo', cargue.id, 'CONFIRMAR', undefined, { plantilla: id, ...resultado });
    return { cargueId: cargue.id, ...resultado, rechazadas: v.resumen.conErrores, filasRechazadas: v.filas.filter((f) => f.errores.length) };
  }

  private async catalogoItem(tx: Tx, empresaId: string, tipo: string, nombre?: string) {
    if (!nombre) return null;
    const existente = await tx.catalogoItem.findFirst({ where: { empresaId, tipo, nombre: { equals: nombre, mode: 'insensitive' } } });
    if (existente) return existente;
    const n = await tx.catalogoItem.count({ where: { empresaId, tipo } });
    return tx.catalogoItem.create({ data: { empresaId, tipo, codigo: `${tipo.slice(0, 3)}-${n + 1}`, nombre } });
  }
  private async sucursal(tx: Tx, empresaId: string, nit: string, nombre: string) {
    return tx.sucursal.findFirstOrThrow({ where: { nombre: { equals: nombre, mode: 'insensitive' }, cliente: { empresaId, nit: digitos(nit) } }, include: { cliente: true } });
  }

  /** Guarda una fila válida. Devuelve si creó o actualizó. */
  private async guardar(tx: Tx, a: Actor, id: string, f: FilaValidada): Promise<'creadas' | 'actualizadas'> {
    const d = f.datos; const emp = a.empresaId;
    switch (id) {
      case 'clientes': {
        const nit = digitos(d.nit);
        const datos = { razonSocial: d.razon, sector: d.sector || null, tipoNegociacion: negociacion(d.negociacion)!, formaPago: formaPago(d.pago)!, emailFacturacion: d.email || null, dv: dvNit(nit),
          camposExtra: { telefono: d.telefono, asesor: d.asesor, clasificacion: d.clasificacion, tipoPersona: d.persona } };
        const ex = await tx.cliente.findUnique({ where: { empresaId_nit: { empresaId: emp, nit } } });
        if (ex) { await tx.cliente.update({ where: { id: ex.id }, data: datos }); return 'actualizadas'; }
        await tx.cliente.create({ data: { ...datos, empresaId: emp, nit } }); return 'creadas';
      }
      case 'sucursales': {
        const cliente = await tx.cliente.findUniqueOrThrow({ where: { empresaId_nit: { empresaId: emp, nit: digitos(d.nit) } } });
        const zona = d.zona ? await tx.zona.findFirst({ where: { empresaId: emp, nombre: { equals: d.zona, mode: 'insensitive' } } }) : null;
        const datos = { direccion: `${d.direccion}, ${d.municipio} (${d.depto})`, zonaId: zona?.id ?? null, contacto: d.contacto || null, telefono: d.telefono || null, registroRespel: d.respel || null, latitud: num(d.lat), longitud: num(d.lng) };
        const ex = await tx.sucursal.findFirst({ where: { clienteId: cliente.id, nombre: { equals: d.nombre, mode: 'insensitive' } } });
        if (ex) { await tx.sucursal.update({ where: { id: ex.id }, data: datos }); return 'actualizadas'; }
        await tx.sucursal.create({ data: { ...datos, clienteId: cliente.id, nombre: d.nombre } }); return 'creadas';
      }
      case 'decl-residuos':
      case 'decl-servicios': {
        const servicio = id === 'decl-servicios';
        const suc = await this.sucursal(tx, emp, d.nit, d.sucursal);
        const linea = await this.catalogoItem(tx, emp, 'LINEA_SERVICIO', d.linea);
        const manejo = servicio ? await this.catalogoItem(tx, emp, 'TIPO_MANEJO', 'Servicio en sitio') : await this.catalogoItem(tx, emp, 'TIPO_MANEJO', d.manejo);
        const embalaje = await this.catalogoItem(tx, emp, 'EMBALAJE', d.embalaje);
        const peligrosidad = servicio ? [] : [...(si(d.peligroso) ? ['T'] : []), ...(si(d.inflamable) ? ['I'] : [])];
        const corriente = (d.corrienteY || d.corrienteA || '').toUpperCase() || null;
        const residuo = await tx.catalogoResiduo.upsert({
          where: { empresaId_codigo: { empresaId: emp, codigo: d.codigo.toUpperCase() } },
          update: {},
          create: { empresaId: emp, tipo: servicio ? 'SERVICIO' : 'RESIDUO', codigo: d.codigo.toUpperCase(), nombre: servicio ? d.servicio : d.residuo, corriente, peligrosidad, estadoFisico: d.estadoFisico?.slice(0, 10) || null,
            unidad: servicio ? 'SERVICIO' : unidad(d.unidad) ?? 'KG', lineaServicioId: linea?.id, tipoManejoId: manejo?.id },
        });
        const existente = await tx.declaracion.findFirst({ where: { empresaId: emp, sucursalId: suc.id, residuoId: residuo.id, estado: { notIn: ['INACTIVA', 'RECHAZADA'] } } });
        const datos = { cantidadEstimada: num(d.cantidad), frecuencia: d.frecuencia?.slice(0, 15) || null, tipoManejoId: manejo?.id, embalajeId: embalaje?.id };
        const decl = existente
          ? await tx.declaracion.update({ where: { id: existente.id }, data: datos })
          : await tx.declaracion.create({ data: { ...datos, empresaId: emp, tipo: servicio ? 'SERVICIO' : 'RESIDUO', clienteId: suc.clienteId, sucursalId: suc.id, residuoId: residuo.id, estado: 'PENDIENTE' } });
        if (d.precio) await tx.tarifa.create({ data: { declaracionId: decl.id, precioUnitario: num(d.precio)!, tipoNegociacion: suc.cliente.tipoNegociacion, formaPago: suc.cliente.formaPago, vigenteDesde: new Date(), asignadoPorId: a.id } });
        return existente ? 'actualizadas' : 'creadas';
      }
      case 'precios': {
        const decl = await tx.declaracion.findFirstOrThrow({ where: { empresaId: emp, numero: Number(d.numero) }, include: { cliente: true, tarifas: { where: { vigenteHasta: null }, take: 1, orderBy: { vigenteDesde: 'desc' } } } });
        const desde = fecha(d.desde)!;
        const actual = decl.tarifas[0];
        if (actual) await tx.tarifa.update({ where: { id: actual.id }, data: { vigenteHasta: new Date(desde.getTime() - 86_400_000) } });
        await tx.tarifa.create({ data: { declaracionId: decl.id, precioUnitario: num(d.precio)!, vigenteDesde: desde, asignadoPorId: a.id,
          tipoNegociacion: negociacion(d.negociacion) ?? actual?.tipoNegociacion ?? decl.cliente.tipoNegociacion, formaPago: formaPago(d.pago) ?? actual?.formaPago ?? decl.cliente.formaPago } });
        return 'creadas';
      }
      case 'vehiculos': {
        const placa = d.placa.replace(/[\s-]/g, '').toUpperCase();
        const datos = { marca: d.marca, tipo: d.tipo, capacidad: num(d.capacidad)!, unidadCap: unidad(d.unidadCap) ?? 'KG', soatVence: fecha(d.soat), rtmVence: fecha(d.rtm), polizaRcVence: fecha(d.poliza) };
        const ex = await tx.vehiculo.findUnique({ where: { placa } });
        if (ex) { if (ex.empresaId !== emp) throw new BadRequestException({ mensaje: `La placa ${placa} pertenece a otra empresa.` }); await tx.vehiculo.update({ where: { placa }, data: datos }); return 'actualizadas'; }
        await tx.vehiculo.create({ data: { ...datos, empresaId: emp, placa } }); return 'creadas';
      }
      case 'usuarios': {
        let rol = await tx.rol.findFirst({ where: { empresaId: emp, nombre: { equals: d.rol, mode: 'insensitive' } } });
        if (!rol) rol = await tx.rol.create({ data: { empresaId: emp, nombre: d.rol } });
        // Clave aleatoria: el usuario la define con el enlace de «Recuperar contraseña» (invitación).
        await tx.usuario.create({ data: { empresaId: emp, rolId: rol.id, documento: d.documento, nombre: d.nombre, email: d.email.trim().toLowerCase(), passwordHash: await hashClave(randomBytes(24).toString('base64url')),
          telefono: d.telefono || null, esConductor: d.rol === 'Conductor', esAuxiliar: d.rol === 'Auxiliar', licenciaCat: d.licencia || null, licenciaVence: fecha(d.licenciaVence), cursoMpVence: fecha(d.cursoMp) } });
        return 'creadas';
      }
      case 'solicitudes': {
        const suc = await this.sucursal(tx, emp, d.nit, d.sucursal);
        const decl = await tx.declaracion.findFirstOrThrow({ where: { empresaId: emp, sucursalId: suc.id, estado: 'AUTORIZADA', residuo: { codigo: d.codigo.toUpperCase() } }, include: { tarifas: { where: { vigenteHasta: null }, take: 1 } } });
        const fechaS = fecha(d.fecha)!;
        // Agrupa en una sola solicitud las filas del mismo cliente, sucursal, fecha y jornada.
        let s = await tx.solicitud.findFirst({ where: { empresaId: emp, sucursalId: suc.id, fechaSolicitada: fechaS, franjaHoraria: d.jornada || null, estado: 'PENDIENTE', creadoPorId: a.id } });
        const creada = !s;
        if (!s) s = await tx.solicitud.create({ data: { empresaId: emp, clase: 'FORMAL', operacion: d.tipo === 'Entrega en planta' ? 'DESCARGA' : 'CARGA', clienteId: suc.clienteId, sucursalId: suc.id, fechaSolicitada: fechaS, franjaHoraria: d.jornada || null, creadoPorId: a.id } });
        await tx.solicitudItem.create({ data: { solicitudId: s.id, declaracionId: decl.id, cantidadEstimada: num(d.cantidad), precioUnitario: decl.tarifas[0]?.precioUnitario } });
        return creada ? 'creadas' : 'actualizadas';
      }
    }
    throw new BadRequestException({ mensaje: `Plantilla «${id}» sin guardado definido.` });
  }

  historial(a: Actor) {
    return this.db.cargueMasivo.findMany({ where: { empresaId: a.empresaId }, orderBy: { creadoEn: 'desc' }, take: 100, select: { id: true, plantilla: true, archivo: true, filasLeidas: true, filasOk: true, filasError: true, creadoEn: true, usuarioId: true } });
  }
}

const archivo = FileInterceptor('archivo', { limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 } });

@Controller('importacion')
class ImportacionController {
  constructor(private readonly s: ImportacionService) {}
  @Get('plantillas') plantillas() { return PLANTILLAS.map((p) => ({ id: p.id, nombre: p.nombre, descripcion: p.descripcion, archivo: p.archivo, columnas: p.columnas.map(({ validar: _v, advertir: _a, ...c }) => c) })); }
  @Get('plantillas/:id/archivo') async descargar(@Param('id') id: string, @Res() res: Response) {
    const p = this.s.plantilla(id);
    const buf = Buffer.from(await construirPlantilla(p));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${p.archivo}"`);
    res.send(buf);
  }
  @Get('historial') historial(@ActorActual() a: Actor) { return this.s.historial(a); }
  @Permiso('importacion.cargar') @Post(':id/vista-previa') @UseInterceptors(archivo) previa(@ActorActual() a: Actor, @Param('id') id: string, @UploadedFile() f?: Express.Multer.File) { return this.s.vistaPrevia(a, id, f); }
  @Permiso('importacion.cargar') @Post(':id/confirmar') @UseInterceptors(archivo) confirmar(@ActorActual() a: Actor, @Param('id') id: string, @UploadedFile() f?: Express.Multer.File) { return this.s.confirmar(a, id, f); }
}

@Module({ controllers: [ImportacionController], providers: [ImportacionService] })
export class ImportacionModule {}
