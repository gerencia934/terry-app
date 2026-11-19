import { BadRequestException, Controller, Get, Injectable, Module, NotFoundException, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FormaPago, Prisma, TipoNegociacion, UnidadMedida } from '@prisma/client';
import type { Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import {
  ESTADOS_FISICOS, EsquemaDeclaracion, PLANTILLAS, construirPlantilla, dvNit, leerArchivo, lista, norm, validarFilas,
  type ClaveCatalogo, type Contexto, type FilaValidada, type Plantilla,
} from '@terraviva/shared';
import { PrismaService } from '../prisma/prisma.service';
import { Auditoria } from '../common/servicios';
import { ActorActual, Permiso, type Actor } from '../common/http';
import { hashClave } from '../auth/auth.service';
import { DeclaracionesModule, DeclaracionesService } from '../declaraciones/declaraciones.module';

const MAX_MB = 10;
const digitos = (s?: string) => (s ?? '').replace(/\D/g, '');
const mapa = <T extends string>(pares: [string, T][]) => (v?: string) => pares.find(([k]) => norm(k) === norm(v ?? ''))?.[1];
const negociacion = mapa<TipoNegociacion>([['Cobro', 'COBRO'], ['Compra', 'COMPRA'], ['Sin costo', 'SIN_COSTO']]);
const formaPago = mapa<FormaPago>([['Contado', 'CONTADO'], ['Crédito 30 días', 'CREDITO_30'], ['Crédito 60 días', 'CREDITO_60'], ['Crédito 90 días', 'CREDITO_90']]);
const unidad = mapa<UnidadMedida>([['kg', 'KG'], ['t', 'TON'], ['m³', 'M3'], ['m3', 'M3'], ['gal', 'GAL'], ['L', 'L'], ['und', 'UND']]);
const estadoFisico = mapa(ESTADOS_FISICOS);
const si = (v?: string) => norm(v ?? '') === 'si';
const num = (v?: string) => (v ? Number(v.replace(',', '.')) : undefined);
const fecha = (v?: string) => (v ? new Date(`${v}T00:00:00Z`) : undefined);
const DECL = new Set(['decl-residuos', 'decl-servicios']);
type Tx = Prisma.TransactionClient;
/** Código (mayúsculas) → id, por catálogo. */
type Ids = Record<ClaveCatalogo, Map<string, string>>;

@Injectable()
class ImportacionService {
  constructor(private readonly db: PrismaService, private readonly audit: Auditoria, private readonly declaraciones: DeclaracionesService) {}

  plantilla(id: string): Plantilla {
    const p = PLANTILLAS.find((x) => x.id === id);
    if (!p) throw new NotFoundException({ mensaje: `No existe la plantilla «${id}».` });
    return p;
  }

  /** Códigos vigentes de cada catálogo de la empresa, con su id. */
  async ids(empresaId: string): Promise<Ids> {
    const e = { empresaId, activo: true };
    const sel = { id: true, codigo: true } as const;
    const [categorias, tiposResiduo, lineas, metricas, embalajes, materiales, disposiciones, riesgos, etiquetado, codigos] = await Promise.all([
      this.db.categoriaDeclarado.findMany({ where: e, select: sel }), this.db.tipoResiduo.findMany({ where: e, select: sel }),
      this.db.lineaServicio.findMany({ where: e, select: sel }), this.db.metrica.findMany({ where: { ...e, uso: 'PRECIO' }, select: sel }),
      this.db.tipoEmbalaje.findMany({ where: e, select: sel }), this.db.materialEmbalaje.findMany({ where: e, select: sel }),
      this.db.disposicion.findMany({ where: e, select: sel }), this.db.riesgo.findMany({ select: sel }),
      this.db.sistemaEtiquetado.findMany({ select: sel }), this.db.codigoClasificacion.findMany({ where: { activo: true }, select: { ...sel, tipo: true } }),
    ]);
    const m = (xs: { id: string; codigo: string }[]) => new Map(xs.map((x) => [x.codigo.toUpperCase(), x.id]));
    return {
      categorias: m(categorias), tiposResiduo: m(tiposResiduo), lineas: m(lineas), metricasPrecio: m(metricas), embalajes: m(embalajes),
      materiales: m(materiales), disposiciones: m(disposiciones), riesgos: m(riesgos), etiquetado: m(etiquetado),
      corrientesY: m(codigos.filter((c) => c.tipo === 'Y')), codigosA: m(codigos.filter((c) => c.tipo === 'A')),
    };
  }

  /** Datos existentes de la empresa contra los cuales se cruzan las filas. */
  async contexto(empresaId: string, ids: Ids): Promise<Contexto> {
    const [clientes, vehiculos, usuarios, decls, disposiciones] = await Promise.all([
      this.db.cliente.findMany({ where: { empresaId }, select: { nit: true, sucursales: { select: { nombre: true, codigo: true } } } }),
      this.db.vehiculo.findMany({ where: { empresaId }, select: { placa: true } }),
      this.db.usuario.findMany({ select: { email: true } }), // el correo es único en todo el sistema
      this.db.declaracion.findMany({ where: { empresaId }, select: { numero: true, estado: true, activa: true, codigoInterno: true } }),
      this.db.$queryRaw<{ codigo: string }[]>`SELECT codigo FROM disposiciones WHERE empresa_id = ${empresaId}::uuid AND activo AND fn_disposicion_cubierta(id, empresa_id)`,
    ]);
    return {
      nitsClientes: new Set(clientes.map((c) => c.nit)),
      sucursalesPorNit: new Map(clientes.map((c) => [c.nit, new Set(c.sucursales.flatMap((s) => [norm(s.nombre), ...(s.codigo ? [norm(s.codigo)] : [])]))])),
      placas: new Set(vehiculos.map((v) => v.placa)),
      emails: new Set(usuarios.map((u) => u.email.toLowerCase())),
      numerosDeclaracion: new Set(decls.map((d) => String(d.numero))),
      codigosInternos: new Set(decls.filter((d) => d.estado === 'AUTORIZADA' && d.activa && d.codigoInterno).map((d) => d.codigoInterno!.toUpperCase())),
      catalogos: Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, new Set(v.keys())])) as Contexto['catalogos'],
      disposicionesCubiertas: new Set(disposiciones.map((d) => d.codigo.toUpperCase())),
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
    const ids = await this.ids(a.empresaId);
    const filas = validarFilas(p, leido.filas, await this.contexto(a.empresaId, ids));
    if (DECL.has(id)) await this.codigosRepetidos(a.empresaId, filas);
    const hash = createHash('sha256').update(file.buffer).digest('hex');
    const previo = await this.db.cargueMasivo.findFirst({ where: { empresaId: a.empresaId, archivoHash: hash, estado: 'CONFIRMADO' }, orderBy: { creadoEn: 'desc' }, select: { creadoEn: true } });
    return { plantilla: p, ids, hash, archivo: file.originalname, faltantes: leido.faltantes, filas,
      avisos: previo ? [`Este mismo archivo ya se cargó el ${previo.creadoEn.toISOString().slice(0, 16).replace('T', ' ')}.`] : [],
      resumen: { leidas: filas.length, validas: filas.filter((f) => !f.errores.length).length, conErrores: filas.filter((f) => f.errores.length).length, conAdvertencias: filas.filter((f) => f.advertencias.length).length } };
  }

  /** Una declaración nueva no puede repetir el código interno de otra del mismo cliente. */
  private async codigosRepetidos(empresaId: string, filas: FilaValidada[]) {
    const existentes = await this.db.declaracion.findMany({ where: { empresaId, codigoInterno: { not: null } }, select: { codigoInterno: true, cliente: { select: { nit: true } } } });
    const set = new Set(existentes.map((d) => `${d.cliente.nit}|${d.codigoInterno!.toUpperCase()}`));
    for (const f of filas) if (f.datos.codigo && set.has(`${digitos(f.datos.nit)}|${f.datos.codigo.trim().toUpperCase()}`))
      f.errores.push(`Código interno: el cliente ya tiene una declaración con el código ${f.datos.codigo}. Modifíquela desde el formulario.`);
  }

  async vistaPrevia(a: Actor, id: string, file?: Express.Multer.File) {
    const { plantilla: _p, ids: _i, hash: _h, ...r } = await this.validar(a, id, file);
    return r;
  }

  async confirmar(a: Actor, id: string, file?: Express.Multer.File) {
    const v = await this.validar(a, id, file);
    if (v.faltantes.length) throw new BadRequestException({ mensaje: `Faltan columnas obligatorias: ${v.faltantes.join(', ')}.` });
    const validas = v.filas.filter((f) => !f.errores.length);
    if (!validas.length) throw new BadRequestException({ mensaje: 'Ninguna fila es válida. Corrija los errores y vuelva a cargar.', filas: v.filas });
    const resultado = { creadas: 0, actualizadas: 0 };
    const errores = v.filas.filter((f) => f.errores.length).map((f) => ({ fila: f.n, mensajes: f.errores }));
    // Todo el lote en una transacción: si una fila falla en la base, no se guarda ninguna.
    const cargue = await this.db.$transaction(async (tx) => {
      const c = await tx.cargueMasivo.create({ data: {
        empresaId: a.empresaId, plantilla: id, archivo: v.archivo.slice(0, 200), archivoHash: v.hash, formato: 'XLSX', estado: 'CONFIRMADO',
        tipoCargue: DECL.has(id) ? 'DECLARACIONES' : id === 'sucursales' ? 'SUCURSALES' : null,
        filasLeidas: v.filas.length, filasOk: validas.length, filasError: errores.length, errores, usuarioId: a.id,
      } });
      for (const f of validas) {
        try { resultado[await this.guardar(tx, a, id, f, v.ids, c.id)]++; }
        catch (e) { if (e instanceof BadRequestException) throw new BadRequestException({ mensaje: `Fila ${f.n}: ${(e.getResponse() as { mensaje?: string }).mensaje ?? e.message}` }); throw e; }
      }
      return c;
    }, { timeout: 120_000, maxWait: 10_000 });
    await this.audit.registrar(a, 'cargue_masivo', cargue.id, 'CONFIRMAR', undefined, { plantilla: id, ...resultado });
    return { cargueId: cargue.id, ...resultado, rechazadas: v.resumen.conErrores, filasRechazadas: v.filas.filter((f) => f.errores.length), avisos: v.avisos };
  }

  private async sucursal(tx: Tx, empresaId: string, nit: string, nombreOCodigo: string) {
    const s = await tx.sucursal.findFirst({ where: { cliente: { empresaId, nit: digitos(nit) }, OR: [{ nombre: { equals: nombreOCodigo, mode: 'insensitive' } }, { codigo: { equals: nombreOCodigo, mode: 'insensitive' } }] }, include: { cliente: true } });
    if (!s) throw new BadRequestException({ mensaje: `La sede «${nombreOCodigo}» no existe para el NIT ${nit}.` });
    return s;
  }

  /** Celda «Sedes» → alcance y sedes concretas. */
  private async alcance(tx: Tx, empresaId: string, nit: string, celda: string) {
    if (norm(celda) === 'todas') return { alcanceSedes: 'TODAS' as const, sucursalIds: [] as string[] };
    if (norm(celda) === 'principal') return { alcanceSedes: 'PRINCIPAL' as const, sucursalIds: [] as string[] };
    const sucursalIds: string[] = [];
    for (const x of lista(celda)) sucursalIds.push((await this.sucursal(tx, empresaId, nit, x)).id);
    return { alcanceSedes: 'SELECCION' as const, sucursalIds };
  }

  /** Fila de la plantilla → datos del formulario, validados con el mismo esquema que el formulario web. */
  private async declaracion(tx: Tx, a: Actor, id: string, d: Record<string, string>, ids: Ids) {
    const servicio = id === 'decl-servicios';
    const cliente = await tx.cliente.findUniqueOrThrow({ where: { empresaId_nit: { empresaId: a.empresaId, nit: digitos(d.nit) } } });
    const cod = (k: ClaveCatalogo, v?: string) => (v ? ids[k].get(v.trim().toUpperCase()) : undefined);
    const varios = (k: ClaveCatalogo, v?: string) => lista(v).map((x) => cod(k, x)!).filter(Boolean);
    const datos = {
      tipo: servicio ? 'SERVICIO' : 'RESIDUO',
      clienteId: cliente.id, ...(await this.alcance(tx, a.empresaId, d.nit, d.sedes)),
      nombre: servicio ? d.servicio : d.residuo, codigoInterno: d.codigo || null,
      categoriaId: cod('categorias', d.categoria), lineaServicioId: cod('lineas', d.linea),
      frecuenciaDias: num(d.frecuenciaDias) ?? null, cantidadFrecuencia: num(d.cantidad) ?? null, solicitudAutomatica: si(d.progAuto),
      precio: d.precio ? { precioUnitario: num(d.precio)!, metricaId: cod('metricasPrecio', d.metrica) ?? null } : null,
      responsabilidadAceptada: si(d.responsabilidad), observaciones: d.observacion || null,
      ...(servicio ? { descripcionServicio: d.descripcion } : {
        tipoResiduoId: cod('tiposResiduo', d.tipoResiduo), esPeligroso: si(d.peligroso),
        codigoYId: cod('corrientesY', d.corrienteY) ?? null, codigoAId: cod('codigosA', d.codigoA) ?? null, codigoUn: d.codigoUn || null,
        riesgoIds: varios('riesgos', d.riesgos), etiquetadoIds: varios('etiquetado', d.etiquetado),
        descripcionProceso: d.proceso, composicion: d.composicion || null,
        tipoEmbalajeId: cod('embalajes', d.embalaje), otroTipoEmbalaje: d.otroEmbalaje || null, presentacion: d.presentacion || null,
        materialEmbalajeId: cod('materiales', d.material), otroMaterial: d.otroMaterial || null,
        estadoFisico: estadoFisico(d.estadoFisico), inflamable: si(d.inflamable), controladaEstupefacientes: si(d.estupefacientes),
        disposiciones: varios('disposiciones', d.disposiciones).map((disposicionId, i) => ({ disposicionId, principal: i === 0 })),
        fichaSeguridadUrl: d.fds || null,
      }),
    };
    const r = EsquemaDeclaracion.safeParse(datos);
    if (!r.success) throw new BadRequestException({ mensaje: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' ') });
    return r.data;
  }

  /** Guarda una fila válida. Devuelve si creó o actualizó. */
  private async guardar(tx: Tx, a: Actor, id: string, f: FilaValidada, ids: Ids, cargueId: string): Promise<'creadas' | 'actualizadas'> {
    const d = f.datos; const emp = a.empresaId;
    switch (id) {
      case 'clientes': {
        const nit = digitos(d.nit);
        const datos = { razonSocial: d.razon, tipo: norm(d.tipo ?? '') === 'gestor' ? 'GESTOR' as const : 'DIRECTO' as const, sector: d.sector || null, tipoNegociacion: negociacion(d.negociacion)!, formaPago: formaPago(d.pago)!, emailFacturacion: d.email || null, dv: dvNit(nit),
          camposExtra: { telefono: d.telefono, asesor: d.asesor, clasificacion: d.clasificacion, tipoPersona: d.persona } };
        const ex = await tx.cliente.findUnique({ where: { empresaId_nit: { empresaId: emp, nit } } });
        if (ex) { await tx.cliente.update({ where: { id: ex.id }, data: datos }); return 'actualizadas'; }
        await tx.cliente.create({ data: { ...datos, empresaId: emp, nit } }); return 'creadas';
      }
      case 'sucursales': {
        const cliente = await tx.cliente.findUniqueOrThrow({ where: { empresaId_nit: { empresaId: emp, nit: digitos(d.nit) } } });
        const zona = d.zona ? await tx.zona.findFirst({ where: { empresaId: emp, nombre: { equals: d.zona, mode: 'insensitive' } } }) : null;
        const municipio = await tx.municipio.findFirst({ where: { nombre: { equals: d.municipio, mode: 'insensitive' }, departamento: { equals: d.depto, mode: 'insensitive' } } });
        const principal = si(d.principal);
        if (principal) await tx.sucursal.updateMany({ where: { clienteId: cliente.id, esPrincipal: true }, data: { esPrincipal: false } });
        const datos = { direccion: `${d.direccion}, ${d.municipio} (${d.depto})`, municipioDane: municipio?.codigoDane ?? null, zonaId: zona?.id ?? null, contacto: d.contacto || null, telefono: d.telefono || null,
          registroRespel: d.respel || null, latitud: num(d.lat), longitud: num(d.lng), ...(d.codigo ? { codigo: d.codigo.trim().toUpperCase() } : {}), ...(principal ? { esPrincipal: true } : {}) };
        const ex = await tx.sucursal.findFirst({ where: { clienteId: cliente.id, OR: [{ nombre: { equals: d.nombre, mode: 'insensitive' } }, ...(d.codigo ? [{ codigo: { equals: d.codigo, mode: 'insensitive' as const } }] : [])] } });
        if (ex) { await tx.sucursal.update({ where: { id: ex.id }, data: datos }); return 'actualizadas'; }
        await tx.sucursal.create({ data: { ...datos, clienteId: cliente.id, nombre: d.nombre } }); return 'creadas';
      }
      case 'decl-residuos':
      case 'decl-servicios':
        await this.declaraciones.crear(a, await this.declaracion(tx, a, id, d, ids), tx, cargueId);
        return 'creadas';
      case 'precios': {
        const decl = await tx.declaracion.findFirstOrThrow({ where: { empresaId: emp, numero: Number(d.numero) }, include: { cliente: true, tarifas: { where: { vigenteHasta: null }, take: 1, orderBy: { vigenteDesde: 'desc' } } } });
        const desde = fecha(d.desde)!;
        const actual = decl.tarifas[0];
        if (actual) await tx.tarifa.update({ where: { id: actual.id }, data: { vigenteHasta: new Date(desde.getTime() - 86_400_000) } });
        await tx.tarifa.create({ data: { declaracionId: decl.id, precioUnitario: num(d.precio)!, metricaId: actual?.metricaId ?? null, vigenteDesde: desde, asignadoPorId: a.id,
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
        const decl = await tx.declaracion.findFirst({ where: { empresaId: emp, clienteId: suc.clienteId, estado: 'AUTORIZADA', activa: true, codigoInterno: { equals: d.codigo.trim(), mode: 'insensitive' }, sucursales: { some: { sucursalId: suc.id, activa: true } } },
          include: { tarifas: { where: { vigenteHasta: null }, take: 1, orderBy: { vigenteDesde: 'desc' } } } });
        if (!decl) throw new BadRequestException({ mensaje: `La declaración ${d.codigo} no está autorizada y activa para la sede «${d.sucursal}».` });
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
    return this.db.cargueMasivo.findMany({ where: { empresaId: a.empresaId }, orderBy: { creadoEn: 'desc' }, take: 100,
      select: { id: true, plantilla: true, archivo: true, estado: true, filasLeidas: true, filasOk: true, filasError: true, creadoEn: true, usuarioId: true, _count: { select: { declaraciones: true } } } });
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

@Module({ imports: [DeclaracionesModule], controllers: [ImportacionController], providers: [ImportacionService] })
export class ImportacionModule {}
