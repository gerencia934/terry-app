import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Query, Res,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FormaPago, Prisma, TipoNegociacion, UnidadMedida, type CargueMasivo } from '@prisma/client';
import type { Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  ESTADOS_FISICOS, ErrorPlanilla, EsquemaDeclaracion, PLANTILLAS, construirPlantilla, construirPlantillaCsv, corrienteDe, delimitadorDe, dvNit, leerPlanilla, lista, norm, plantillaPortal,
  nombreFuncion, resolverCodigo, ROLES_PREDETERMINADOS, sectorDe, tipoRcdDe, validarFilas, type ClaveCatalogo, type Contexto, type FilaValidada, type Plantilla, type PlanillaLeida,
} from '@terraviva/shared';
import { PrismaService } from '../prisma/prisma.service';
import { Auditoria, Municipios } from '../common/servicios';
import { ActorActual, Permiso, Zod, type Actor } from '../common/http';
import { hashClave } from '../auth/auth.service';
import { DeclaracionesModule, DeclaracionesService } from '../declaraciones/declaraciones.module';

const MAX_MB = 10;
const digitos = (s?: string) => (s ?? '').replace(/\D/g, '');
const mapa = <T extends string>(pares: [string, T][]) => (v?: string) => pares.find(([k]) => norm(k) === norm(v ?? ''))?.[1];
const negociacion = mapa<TipoNegociacion>([['Cobro', 'COBRO'], ['Compra', 'COMPRA'], ['Sin costo', 'SIN_COSTO'], ['Por contrato', 'CONTRATO']]);
const formaPago = mapa<FormaPago>([['Contado', 'CONTADO'], ['Crédito 30 días', 'CREDITO_30'], ['Crédito 60 días', 'CREDITO_60'], ['Crédito 90 días', 'CREDITO_90']]);
const unidad = mapa<UnidadMedida>([['kg', 'KG'], ['t', 'TON'], ['m³', 'M3'], ['m3', 'M3'], ['gal', 'GAL'], ['L', 'L'], ['und', 'UND']]);
const estadoFisico = mapa(ESTADOS_FISICOS);
const si = (v?: string) => norm(v ?? '') === 'si';
const num = (v?: string) => (v ? Number(v.replace(',', '.')) : undefined);
const fecha = (v?: string) => (v ? new Date(`${v}T00:00:00Z`) : undefined);
const DECL = new Set(['decl-residuos', 'decl-servicios']);
/** Función que exige cada plantilla además de «Cargar desde Excel»: la de lo que crea. */
const FUNCION_PLANTILLA: Record<string, string> = {
  clientes: 'clientes.editar', sucursales: 'clientes.editar', 'decl-residuos': 'declaraciones.crear', 'decl-servicios': 'declaraciones.crear',
  precios: 'tarifas.asignar', vehiculos: 'rutas.programar', usuarios: 'configuracion.editar', solicitudes: 'solicitudes.crear',
};
const Reversion = z.object({ motivo: z.string().trim().min(10, 'Explique el motivo (mínimo 10 caracteres).').max(300) });
type Tx = Prisma.TransactionClient;
/** Código (mayúsculas) → id, por catálogo. */
type Ids = Record<ClaveCatalogo, Map<string, string>>;
/** Nombre normalizado → códigos, por catálogo (la planilla puede traer el nombre exacto). */
type Nombres = NonNullable<Contexto['nombres']>;
const conjuntos = (ids: Ids) => Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, new Set(v.keys())])) as Contexto['catalogos'];
/** Cliente que carga desde su portal: su NIT y las sedes que puede ver (vacío = todas las de su empresa). */
export interface ClientePortal { id: string; nit: string; sedes: string[] }

@Injectable()
export class ImportacionService {
  constructor(private readonly db: PrismaService, private readonly audit: Auditoria, private readonly declaraciones: DeclaracionesService, private readonly municipios: Municipios) {}

  plantilla(id: string): Plantilla {
    const p = PLANTILLAS.find((x) => x.id === id);
    if (!p) throw new NotFoundException({ mensaje: `No existe la plantilla «${id}».` });
    return p;
  }

  /** Códigos vigentes de cada catálogo de la empresa, con su id, y sus nombres para aceptar el nombre exacto. */
  async ids(empresaId: string): Promise<{ ids: Ids; nombres: Nombres }> {
    const e = { empresaId, activo: true };
    const sel = { id: true, codigo: true, nombre: true } as const;
    const [categorias, tiposResiduo, lineas, metricas, embalajes, materiales, disposiciones, riesgos, etiquetado, codigos] = await Promise.all([
      this.db.categoriaDeclarado.findMany({ where: e, select: sel }), this.db.tipoResiduo.findMany({ where: e, select: sel }),
      this.db.lineaServicio.findMany({ where: e, select: sel }), this.db.metrica.findMany({ where: { ...e, uso: 'PRECIO' }, select: sel }),
      this.db.tipoEmbalaje.findMany({ where: e, select: sel }), this.db.materialEmbalaje.findMany({ where: e, select: sel }),
      this.db.disposicion.findMany({ where: e, select: sel }), this.db.riesgo.findMany({ select: sel }),
      this.db.sistemaEtiquetado.findMany({ select: sel }), this.db.codigoClasificacion.findMany({ where: { activo: true }, select: { id: true, codigo: true, tipo: true } }),
    ]);
    const m = (xs: { id: string; codigo: string }[]) => new Map(xs.map((x) => [x.codigo.toUpperCase(), x.id]));
    const n = (xs: { codigo: string; nombre: string }[]) => {
      const r = new Map<string, string[]>();
      for (const x of xs) r.set(norm(x.nombre), [...(r.get(norm(x.nombre)) ?? []), x.codigo.toUpperCase()]);
      return r;
    };
    return {
      ids: {
        categorias: m(categorias), tiposResiduo: m(tiposResiduo), lineas: m(lineas), metricasPrecio: m(metricas), embalajes: m(embalajes),
        materiales: m(materiales), disposiciones: m(disposiciones), riesgos: m(riesgos), etiquetado: m(etiquetado),
        corrientesY: m(codigos.filter((c) => c.tipo === 'Y')), codigosA: m(codigos.filter((c) => c.tipo === 'A')),
      },
      nombres: {
        categorias: n(categorias), tiposResiduo: n(tiposResiduo), lineas: n(lineas), metricasPrecio: n(metricas), embalajes: n(embalajes),
        materiales: n(materiales), disposiciones: n(disposiciones), riesgos: n(riesgos), etiquetado: n(etiquetado),
      },
    };
  }

  /** Datos existentes de la empresa contra los cuales se cruzan las filas. */
  async contexto(empresaId: string, ids: Ids, nombres: Nombres): Promise<Contexto> {
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
      numerosDeclaracion: new Set(decls.filter((d) => d.estado !== 'ANULADA').map((d) => String(d.numero))),
      codigosInternos: new Set(decls.filter((d) => d.estado === 'AUTORIZADA' && d.activa && d.codigoInterno).map((d) => d.codigoInterno!.toUpperCase())),
      catalogos: conjuntos(ids), nombres,
      disposicionesCubiertas: new Set(disposiciones.map((d) => d.codigo.toUpperCase())),
      municipios: await this.municipios.claves(),
    };
  }

  /** Contexto del cargue desde el portal: solo el NIT del cliente y sus sedes activas (las que el usuario puede ver). */
  private async contextoCliente(empresaId: string, cliente: ClientePortal, ids: Ids, nombres: Nombres): Promise<Contexto> {
    const [sedes, disposiciones] = await Promise.all([
      this.db.sucursal.findMany({ where: { clienteId: cliente.id, activa: true, ...(cliente.sedes.length ? { id: { in: cliente.sedes } } : {}) }, select: { nombre: true, codigo: true } }),
      this.db.$queryRaw<{ codigo: string }[]>`SELECT codigo FROM disposiciones WHERE empresa_id = ${empresaId}::uuid AND activo AND fn_disposicion_cubierta(id, empresa_id)`,
    ]);
    return {
      nitsClientes: new Set([cliente.nit]),
      sucursalesPorNit: new Map([[cliente.nit, new Set(sedes.flatMap((x) => [norm(x.nombre), ...(x.codigo ? [norm(x.codigo)] : [])]))]]),
      placas: new Set(), emails: new Set(), numerosDeclaracion: new Set(), codigosInternos: new Set(),
      catalogos: conjuntos(ids), nombres, disposicionesCubiertas: new Set(disposiciones.map((d) => d.codigo.toUpperCase())),
    };
  }

  /**
   * Cargue de declaraciones desde el portal de clientes (fase C). Mismas plantillas y reglas que en la oficina, salvo:
   * el NIT es siempre el de su empresa (no va en la plantilla), solo sus sedes (las que el usuario ve) y sin precio.
   */
  async validarPortal(a: Actor, id: string, cliente: ClientePortal, file?: Express.Multer.File, delimitador?: string) {
    if (!file) throw new BadRequestException({ mensaje: 'Adjunte el archivo en el campo «archivo».' });
    const p = plantillaPortal(id);
    if (!p) throw new NotFoundException({ mensaje: 'Desde el portal se cargan declaraciones de residuos o de servicios.' });
    const separador = delimitadorDe(delimitador);
    if (delimitador && !separador) throw new BadRequestException({ mensaje: 'Separador no válido: use punto y coma, coma, tabulador o barra vertical.' });
    let leido: PlanillaLeida;
    try { leido = await leerPlanilla(p, file.originalname, file.buffer.buffer.slice(file.buffer.byteOffset, file.buffer.byteOffset + file.buffer.byteLength) as ArrayBuffer, { delimitador: separador }); }
    catch (e) { throw new BadRequestException({ mensaje: e instanceof ErrorPlanilla ? e.message : 'No se pudo leer el archivo. Verifique que sea la plantilla en .xlsx, o un CSV con sus mismos encabezados.' }); }
    if (leido.filas.length > 2000) throw new BadRequestException({ mensaje: 'Máximo 2.000 filas por archivo. Divídalo en varios.' });
    const { ids, nombres } = await this.ids(a.empresaId);
    // El NIT es el de su empresa: lo pone el sistema en cada fila
    const filas = validarFilas(p, leido.filas.map((x) => ({ ...x, nit: cliente.nit })), await this.contextoCliente(a.empresaId, cliente, ids, nombres));
    if (cliente.sedes.length) for (const x of filas)
      if (['todas', 'principal'].includes(norm(x.datos.sedes ?? ''))) x.errores.push('Sedes: usted ve solo algunas sedes. Escriba los códigos (o los nombres) de sus sedes.');
    await this.codigosRepetidos(a.empresaId, filas, true);
    const hash = createHash('sha256').update(file.buffer).digest('hex');
    const previo = await this.db.cargueMasivo.findFirst({ where: { empresaId: a.empresaId, clienteId: cliente.id, archivoHash: hash, estado: 'CONFIRMADO' }, orderBy: { creadoEn: 'desc' }, select: { creadoEn: true } });
    return { plantilla: p, ids, nombres, hash, archivo: file.originalname, faltantes: leido.faltantes, filas,
      formato: leido.formato, delimitador: leido.delimitador ?? null, codificacion: leido.codificacion ?? null,
      avisos: previo ? [`Este mismo archivo ya se cargó el ${previo.creadoEn.toLocaleString('sv-SE', { timeZone: 'America/Bogota' }).slice(0, 16)}.`] : [],
      resumen: { leidas: filas.length, validas: filas.filter((x) => !x.errores.length).length, conErrores: filas.filter((x) => x.errores.length).length, conAdvertencias: filas.filter((x) => x.advertencias.length).length } };
  }

  /**
   * Guarda el cargue del portal en una transacción del cliente (`enTransaccion`, con la barrera de la base). Todo queda
   * PENDIENTE y sin precio: Terra Viva fija la tarifa y lo autoriza. La responsabilidad del generador la aceptó quien carga.
   */
  async confirmarPortal(a: Actor, id: string, cliente: ClientePortal, enTransaccion: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>, file?: Express.Multer.File, delimitador?: string) {
    const v = await this.validarPortal(a, id, cliente, file, delimitador);
    if (v.faltantes.length) throw new BadRequestException({ mensaje: `Faltan columnas obligatorias: ${v.faltantes.join(', ')}.` });
    const validas = v.filas.filter((x) => !x.errores.length);
    if (!validas.length) throw new BadRequestException({ mensaje: 'Ninguna fila es válida. Corrija los errores y vuelva a cargar.' });
    const errores = v.filas.filter((x) => x.errores.length).map((x) => ({ fila: x.n, mensajes: x.errores }));
    const cargue = await enTransaccion(async (tx) => {
      const c = await tx.cargueMasivo.create({ data: {
        empresaId: a.empresaId, clienteId: cliente.id, plantilla: id, archivo: v.archivo.slice(0, 200), archivoHash: v.hash, formato: v.formato, delimitador: v.delimitador,
        estado: 'CONFIRMADO', tipoCargue: 'DECLARACIONES', filasLeidas: v.filas.length, filasOk: validas.length, filasError: errores.length, errores, usuarioId: a.id,
      } });
      for (const x of validas) {
        try {
          const datos = await this.declaracion(tx, a, id, x.datos, v.ids, v.nombres);
          await this.declaraciones.crear(a, { ...datos, precio: null, borrador: false, responsabilidadAceptada: true }, tx, c.id);
        } catch (e) { if (e instanceof BadRequestException) throw new BadRequestException({ mensaje: `Fila ${x.n}: ${(e.getResponse() as { mensaje?: string }).mensaje ?? e.message}` }); throw e; }
      }
      return c;
    });
    await this.audit.registrar(a, 'cargue_masivo', cargue.id, 'CONFIRMAR_PORTAL', undefined, { plantilla: id, clienteId: cliente.id, creadas: validas.length });
    return { cargueId: cargue.id, creadas: validas.length, rechazadas: v.resumen.conErrores, filasRechazadas: v.filas.filter((x) => x.errores.length), avisos: v.avisos };
  }

  /** Lee y valida el archivo (Excel o CSV) contra los datos de la empresa. En CSV, `delimitador` fija el separador. */
  async validar(a: Actor, id: string, file?: Express.Multer.File, delimitador?: string) {
    if (!file) throw new BadRequestException({ mensaje: 'Adjunte el archivo en el campo «archivo».' });
    const p = this.plantilla(id);
    // Además de «Cargar desde Excel», cada plantilla exige la función de lo que crea: los clientes, por ejemplo, solo los
    // cargan quienes los crean (Comercial y el Jefe de Operaciones, gerencia 20-11-2026)
    const funcion = FUNCION_PLANTILLA[id];
    if (funcion && !a.permisos.includes('*') && !a.permisos.includes(funcion))
      throw new ForbiddenException({ mensaje: `Para cargar «${p.nombre}» su rol necesita también la función «${nombreFuncion(funcion)}».` });
    const separador = delimitadorDe(delimitador);
    if (delimitador && !separador) throw new BadRequestException({ mensaje: 'Separador no válido: use punto y coma, coma, tabulador o barra vertical.' });
    let leido: PlanillaLeida;
    try { leido = await leerPlanilla(p, file.originalname, file.buffer.buffer.slice(file.buffer.byteOffset, file.buffer.byteOffset + file.buffer.byteLength) as ArrayBuffer, { delimitador: separador }); }
    catch (e) { throw new BadRequestException({ mensaje: e instanceof ErrorPlanilla ? e.message : 'No se pudo leer el archivo. Verifique que sea la plantilla en .xlsx, o un CSV con sus mismos encabezados.' }); }
    if (leido.filas.length > 5000) throw new BadRequestException({ mensaje: 'Máximo 5.000 filas por archivo. Divídalo en varios.' });
    const { ids, nombres } = await this.ids(a.empresaId);
    const filas = validarFilas(p, leido.filas, await this.contexto(a.empresaId, ids, nombres));
    if (DECL.has(id)) await this.codigosRepetidos(a.empresaId, filas);
    const hash = createHash('sha256').update(file.buffer).digest('hex');
    const previo = await this.db.cargueMasivo.findFirst({ where: { empresaId: a.empresaId, archivoHash: hash, estado: 'CONFIRMADO' }, orderBy: { creadoEn: 'desc' }, select: { creadoEn: true } });
    return { plantilla: p, ids, nombres, hash, archivo: file.originalname, faltantes: leido.faltantes, filas,
      formato: leido.formato, delimitador: leido.delimitador ?? null, codificacion: leido.codificacion ?? null,
      avisos: previo ? [`Este mismo archivo ya se cargó el ${previo.creadoEn.toISOString().slice(0, 16).replace('T', ' ')}.`] : [],
      resumen: { leidas: filas.length, validas: filas.filter((f) => !f.errores.length).length, conErrores: filas.filter((f) => f.errores.length).length, conAdvertencias: filas.filter((f) => f.advertencias.length).length } };
  }

  /** Una declaración nueva no puede repetir el código interno de otra del mismo cliente. */
  private async codigosRepetidos(empresaId: string, filas: FilaValidada[], portal = false) {
    // Las anuladas (cargue deshecho) liberan su código: el archivo corregido se puede volver a cargar
    const existentes = await this.db.declaracion.findMany({ where: { empresaId, codigoInterno: { not: null }, estado: { not: 'ANULADA' } }, select: { codigoInterno: true, cliente: { select: { nit: true } } } });
    const set = new Set(existentes.map((d) => `${d.cliente.nit}|${d.codigoInterno!.toUpperCase()}`));
    for (const f of filas) if (f.datos.codigo && set.has(`${digitos(f.datos.nit)}|${f.datos.codigo.trim().toUpperCase()}`))
      f.errores.push(portal
        ? `Código interno: su empresa ya tiene una declaración con el código ${f.datos.codigo}. Para cambiarla, escríbale a su asesor de Terra Viva.`
        : `Código interno: el cliente ya tiene una declaración con el código ${f.datos.codigo}. Modifíquela desde el formulario.`);
  }

  async vistaPrevia(a: Actor, id: string, file?: Express.Multer.File, delimitador?: string) {
    const { plantilla: _p, ids: _i, nombres: _n, hash: _h, ...r } = await this.validar(a, id, file, delimitador);
    return r;
  }

  async confirmar(a: Actor, id: string, file?: Express.Multer.File, delimitador?: string) {
    const v = await this.validar(a, id, file, delimitador);
    if (v.faltantes.length) throw new BadRequestException({ mensaje: `Faltan columnas obligatorias: ${v.faltantes.join(', ')}.` });
    const validas = v.filas.filter((f) => !f.errores.length);
    if (!validas.length) throw new BadRequestException({ mensaje: 'Ninguna fila es válida. Corrija los errores y vuelva a cargar.', filas: v.filas });
    const resultado = { creadas: 0, actualizadas: 0 };
    const errores = v.filas.filter((f) => f.errores.length).map((f) => ({ fila: f.n, mensajes: f.errores }));
    // Todo el lote en una transacción: si una fila falla en la base, no se guarda ninguna.
    const cargue = await this.db.$transaction(async (tx) => {
      const c = await tx.cargueMasivo.create({ data: {
        empresaId: a.empresaId, plantilla: id, archivo: v.archivo.slice(0, 200), archivoHash: v.hash, formato: v.formato, delimitador: v.delimitador, estado: 'CONFIRMADO',
        tipoCargue: DECL.has(id) ? 'DECLARACIONES' : id === 'sucursales' ? 'SUCURSALES' : null,
        filasLeidas: v.filas.length, filasOk: validas.length, filasError: errores.length, errores, usuarioId: a.id,
      } });
      for (const f of validas) {
        try { resultado[await this.guardar(tx, a, id, f, v.ids, v.nombres, c.id)]++; }
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
  private async declaracion(tx: Tx, a: Actor, id: string, d: Record<string, string>, ids: Ids, nombres: Nombres) {
    const servicio = id === 'decl-servicios';
    const cliente = await tx.cliente.findUniqueOrThrow({ where: { empresaId_nit: { empresaId: a.empresaId, nit: digitos(d.nit) } } });
    // Código o nombre exacto (ya validados en la vista previa)
    const cod = (k: ClaveCatalogo, v?: string) => { const c = v ? resolverCodigo(k, v, { catalogos: conjuntos(ids), nombres }).codigo : undefined; return c ? ids[k].get(c) : undefined; };
    // Corriente Y o código A; una subcorriente del IDEAM que aún no existe se registra colgada de su corriente
    const corriente = async (k: 'corrientesY' | 'codigosA', v?: string) => {
      const c = v ? resolverCodigo(k, v, { catalogos: conjuntos(ids), nombres }).codigo : undefined;
      if (!c) return null;
      if (ids[k].has(c)) return ids[k].get(c)!;
      const padre = await tx.codigoClasificacion.findUniqueOrThrow({ where: { codigo: corrienteDe(c)! } });
      const s = await tx.codigoClasificacion.upsert({ where: { codigo: c }, update: {},
        create: { tipo: padre.tipo, codigo: c, padreId: padre.id, descripcion: `Subcorriente IDEAM de ${padre.codigo}: ${padre.descripcion}` } });
      ids[k].set(c, s.id);
      return s.id;
    };
    const codigoYId = servicio ? null : await corriente('corrientesY', d.corrienteY);
    const codigoAId = servicio ? null : await corriente('codigosA', d.codigoA);
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
        codigoYId, codigoAId, codigoUn: d.codigoUn || null,
        riesgoIds: varios('riesgos', d.riesgos), etiquetadoIds: varios('etiquetado', d.etiquetado),
        descripcionProceso: d.proceso, composicion: d.composicion || null,
        tipoEmbalajeId: cod('embalajes', d.embalaje), otroTipoEmbalaje: d.otroEmbalaje || null, presentacion: d.presentacion || null,
        materialEmbalajeId: cod('materiales', d.material), otroMaterial: d.otroMaterial || null,
        estadoFisico: estadoFisico(d.estadoFisico), inflamable: si(d.inflamable), controladaEstupefacientes: si(d.estupefacientes), tipoRcd: tipoRcdDe(d.tipoRcd),
        disposiciones: varios('disposiciones', d.disposiciones).map((disposicionId, i) => ({ disposicionId, principal: i === 0 })),
        fichaSeguridadUrl: d.fds || null,
      }),
    };
    const r = EsquemaDeclaracion.safeParse(datos);
    if (!r.success) throw new BadRequestException({ mensaje: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' ') });
    return r.data;
  }

  /** Guarda una fila válida. Devuelve si creó o actualizó. */
  private async guardar(tx: Tx, a: Actor, id: string, f: FilaValidada, ids: Ids, nombres: Nombres, cargueId: string): Promise<'creadas' | 'actualizadas'> {
    const d = f.datos; const emp = a.empresaId;
    switch (id) {
      case 'clientes': {
        const nit = digitos(d.nit);
        const datos = { razonSocial: d.razon, representanteLegal: d.representante.trim().slice(0, 150), tipo: norm(d.tipo ?? '') === 'gestor' ? 'GESTOR' as const : 'DIRECTO' as const, sector: sectorDe(d.sector), tipoNegociacion: negociacion(d.negociacion)!, formaPago: formaPago(d.pago)!, emailFacturacion: d.email || null, dv: dvNit(nit),
          camposExtra: { telefono: d.telefono, asesor: d.asesor, clasificacion: d.clasificacion, tipoPersona: d.persona } };
        const ex = await tx.cliente.findUnique({ where: { empresaId_nit: { empresaId: emp, nit } } });
        if (ex) { await tx.cliente.update({ where: { id: ex.id }, data: datos }); return 'actualizadas'; }
        await tx.cliente.create({ data: { ...datos, empresaId: emp, nit } }); return 'creadas';
      }
      case 'sucursales': {
        const cliente = await tx.cliente.findUniqueOrThrow({ where: { empresaId_nit: { empresaId: emp, nit: digitos(d.nit) } } });
        const zona = d.zona ? await tx.zona.findFirst({ where: { empresaId: emp, nombre: { equals: d.zona, mode: 'insensitive' } } }) : null;
        // DIVIPOLA: por código DANE o por nombre y departamento, sin importar tildes ni mayúsculas
        const municipioDane = await this.municipios.resolver(d.municipio, d.depto);
        const principal = si(d.principal);
        if (principal) await tx.sucursal.updateMany({ where: { clienteId: cliente.id, esPrincipal: true }, data: { esPrincipal: false } });
        const datos = { direccion: `${d.direccion}, ${d.municipio} (${d.depto})`, municipioDane, zonaId: zona?.id ?? null, contacto: d.contacto || null, telefono: d.telefono || null,
          registroRespel: d.respel || null, latitud: num(d.lat), longitud: num(d.lng), ...(d.codigo ? { codigo: d.codigo.trim().toUpperCase() } : {}), ...(principal ? { esPrincipal: true } : {}) };
        const ex = await tx.sucursal.findFirst({ where: { clienteId: cliente.id, OR: [{ nombre: { equals: d.nombre, mode: 'insensitive' } }, ...(d.codigo ? [{ codigo: { equals: d.codigo, mode: 'insensitive' as const } }] : [])] } });
        if (ex) { await tx.sucursal.update({ where: { id: ex.id }, data: datos }); return 'actualizadas'; }
        await tx.sucursal.create({ data: { ...datos, clienteId: cliente.id, nombre: d.nombre } }); return 'creadas';
      }
      case 'decl-residuos':
      case 'decl-servicios':
        await this.declaraciones.crear(a, await this.declaracion(tx, a, id, d, ids, nombres), tx, cargueId);
        return 'creadas';
      case 'precios': {
        const decl = await tx.declaracion.findFirstOrThrow({ where: { empresaId: emp, numero: Number(d.numero), estado: { not: 'ANULADA' } }, include: { cliente: true, tarifas: { where: { vigenteHasta: null }, take: 1, orderBy: { vigenteDesde: 'desc' } } } });
        const desde = fecha(d.desde)!;
        const actual = decl.tarifas[0];
        // Misma regla que la asignación masiva: desde hoy o una fecha futura (validado en la revisión); un precio
        // programado para después pide esa fecha o una posterior; el mismo día de inicio, se corrige ese precio.
        if (actual && actual.vigenteDesde > desde)
          throw new BadRequestException({ mensaje: `La declaración ${decl.numero} ya tiene un precio programado desde ${actual.vigenteDesde.toISOString().slice(0, 10)}: use esa fecha o una posterior.` });
        const datos = { precioUnitario: num(d.precio)!, asignadoPorId: a.id,
          tipoNegociacion: negociacion(d.negociacion) ?? actual?.tipoNegociacion ?? decl.cliente.tipoNegociacion, formaPago: formaPago(d.pago) ?? actual?.formaPago ?? decl.cliente.formaPago };
        if (actual && actual.vigenteDesde.getTime() === desde.getTime()) { await tx.tarifa.update({ where: { id: actual.id }, data: datos }); return 'actualizadas'; }
        if (actual) await tx.tarifa.update({ where: { id: actual.id }, data: { vigenteHasta: new Date(desde.getTime() - 86_400_000) } });
        await tx.tarifa.create({ data: { ...datos, declaracionId: decl.id, metricaId: actual?.metricaId ?? null, vigenteDesde: desde } });
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
        // El rol de la plantilla es uno predeterminado (por su clave, aunque le hayan cambiado el nombre) o uno de oficina o
        // campo con ese nombre; los roles del portal son de los usuarios de cada cliente (se invitan desde su ficha).
        const nombre = String(d.rol).toLowerCase();
        const clave = ROLES_PREDETERMINADOS.find((r) => r.acceso !== 'CLIENTE' && (r.nombre.toLowerCase() === nombre || r.alias?.some((x) => x.toLowerCase() === nombre)))?.clave;
        let rol = (clave ? await tx.rol.findFirst({ where: { empresaId: emp, clave } }) : null)
          ?? await tx.rol.findFirst({ where: { empresaId: emp, acceso: { not: 'CLIENTE' }, nombre: { equals: d.rol, mode: 'insensitive' } } });
        if (!rol) rol = await tx.rol.create({ data: { empresaId: emp, nombre: d.rol, acceso: d.rol === 'Conductor' || d.rol === 'Auxiliar' ? 'CAMPO' : 'OFICINA' } });
        if (!rol.activo) throw new BadRequestException({ mensaje: `El rol «${rol.nombre}» está inactivo: actívelo en Ajustes › Roles.` });
        // Clave aleatoria: el usuario la define con el enlace de «Recuperar contraseña» (invitación).
        await tx.usuario.create({ data: { empresaId: emp, rolId: rol.id, documento: d.documento, nombre: d.nombre, email: d.email.trim().toLowerCase(), passwordHash: await hashClave(randomBytes(24).toString('base64url')),
          telefono: d.telefono || null, esConductor: d.rol === 'Conductor', esAuxiliar: d.rol === 'Auxiliar', licenciaCat: d.licencia || null, licenciaVence: fecha(d.licenciaVence), cursoMpVence: fecha(d.cursoMp) } });
        return 'creadas';
      }
      case 'solicitudes': {
        const suc = await this.sucursal(tx, emp, d.nit, d.sucursal);
        const fechaS = fecha(d.fecha)!;
        // Precio: la tarifa vigente en la fecha del servicio (no la más reciente, que puede regir en el futuro)
        const decl = await tx.declaracion.findFirst({ where: { empresaId: emp, clienteId: suc.clienteId, estado: 'AUTORIZADA', activa: true, codigoInterno: { equals: d.codigo.trim(), mode: 'insensitive' }, sucursales: { some: { sucursalId: suc.id, activa: true } } },
          include: { tarifas: { where: { vigenteDesde: { lte: fechaS }, OR: [{ vigenteHasta: null }, { vigenteHasta: { gte: fechaS } }] }, take: 1, orderBy: { vigenteDesde: 'desc' } } } });
        if (!decl) throw new BadRequestException({ mensaje: `La declaración ${d.codigo} no está autorizada y activa para la sede «${d.sucursal}».` });
        // Agrupa en una sola solicitud las filas del mismo cliente, tipo y fecha (la sede y la jornada van por línea).
        // Queda PENDIENTE de aprobación: el cargue no reemplaza la decisión comercial.
        const operacion = d.tipo === 'Entrega en planta' ? 'DESCARGA' as const : 'CARGA' as const;
        let s = await tx.solicitud.findFirst({ where: { empresaId: emp, clienteId: suc.clienteId, operacion, fechaSolicitada: fechaS, aprobacion: 'PENDIENTE', estado: 'PENDIENTE', creadoPorId: a.id, ordenCompra: d.oc || null } });
        const creada = !s;
        if (!s) s = await tx.solicitud.create({ data: { empresaId: emp, clase: 'FORMAL', operacion, clienteId: suc.clienteId, fechaSolicitada: fechaS, ordenCompra: d.oc || null, observaciones: d.observaciones || null, creadoPorId: a.id } });
        const jornada = d.jornada === 'AM' || d.jornada === 'PM' ? d.jornada : null;
        await tx.solicitudItem.create({ data: { solicitudId: s.id, declaracionId: decl.id, sucursalId: suc.id, jornada, cantidadEstimada: num(d.cantidad), precioUnitario: decl.tarifas[0]?.precioUnitario } });
        return creada ? 'creadas' : 'actualizadas';
      }
    }
    throw new BadRequestException({ mensaje: `Plantilla «${id}» sin guardado definido.` });
  }

  async historial(a: Actor) {
    const cargues = await this.db.cargueMasivo.findMany({ where: { empresaId: a.empresaId }, orderBy: { creadoEn: 'desc' }, take: 100,
      select: { id: true, plantilla: true, tipoCargue: true, archivo: true, formato: true, delimitador: true, estado: true, filasLeidas: true, filasOk: true, filasError: true,
        creadoEn: true, usuarioId: true, revertidoEn: true, motivoReversion: true, revertidoPor: { select: { nombre: true } }, _count: { select: { declaraciones: true } } } });
    const usuarios = await this.db.usuario.findMany({ where: { id: { in: [...new Set(cargues.map((c) => c.usuarioId))] } }, select: { id: true, nombre: true } });
    const nombre = new Map(usuarios.map((u) => [u.id, u.nombre]));
    return cargues.map((c) => ({ ...c, usuario: nombre.get(c.usuarioId) ?? null, propio: c.usuarioId === a.id }));
  }

  /**
   * Deshacer un cargue (fase C). Solo los de declaraciones: los demás crean o actualizan registros que se corrigen con
   * otro cargue o en su pantalla. Nada se borra: sus declaraciones quedan ANULADAS (inactivas, como constancia) y su
   * código interno queda libre para volver a cargar el archivo corregido. No se deshace si alguna ya se usó en una
   * solicitud o un manifiesto (regla también en la base: trg_decl_anulada).
   * Lo puede deshacer quien lo cargó, si ninguna declaración está autorizada, o quien tenga «importacion.revertir».
   */
  async reversion(a: Actor, cargueId: string, db: Tx | PrismaService = this.db) {
    const c = await db.cargueMasivo.findFirst({ where: { id: cargueId, empresaId: a.empresaId }, include: { revertidoPor: { select: { nombre: true } } } });
    if (!c) throw new NotFoundException({ mensaje: 'Cargue no encontrado.' });
    const decls = await db.declaracion.findMany({ where: { cargueId }, orderBy: { numero: 'asc' },
      select: { id: true, numero: true, nombre: true, codigoInterno: true, estado: true, activa: true, _count: { select: { items: true, manifiestoItems: true } } } });
    const porEstado: Record<string, number> = {};
    for (const d of decls) porEstado[d.estado] = (porEstado[d.estado] ?? 0) + 1;
    const enUso = decls.filter((d) => d._count.items || d._count.manifiestoItems)
      .map((d) => ({ numero: d.numero, nombre: d.nombre, codigoInterno: d.codigoInterno, solicitudes: d._count.items, manifiestos: d._count.manifiestoItems }));
    const impedimento = this.impedimento(a, c, decls.length, enUso.map((d) => d.numero), decls.some((d) => d.estado === 'AUTORIZADA'));
    return {
      cargue: { id: c.id, archivo: c.archivo, plantilla: c.plantilla, estado: c.estado, creadoEn: c.creadoEn, revertidoEn: c.revertidoEn, revertidoPor: c.revertidoPor?.nombre ?? null, motivoReversion: c.motivoReversion },
      declaraciones: decls.length, porEstado, enUso, puede: !impedimento, impedimento: impedimento?.mensaje ?? null,
      lista: decls.map(({ _count: _c, ...d }) => d), codigo: impedimento?.codigo ?? null,
    };
  }

  private impedimento(a: Actor, c: CargueMasivo, total: number, enUso: number[], hayAutorizadas: boolean): { codigo: 403 | 409; mensaje: string } | null {
    if (c.estado === 'REVERTIDO') return { codigo: 409, mensaje: `Este cargue ya se deshizo el ${c.revertidoEn?.toLocaleString('sv-SE', { timeZone: 'America/Bogota' }).slice(0, 16)}.` };
    if (c.estado !== 'CONFIRMADO') return { codigo: 409, mensaje: 'Solo se deshace un cargue confirmado.' };
    if (c.tipoCargue !== 'DECLARACIONES')
      return { codigo: 409, mensaje: 'Solo se deshacen los cargues de declaraciones. Los clientes, sedes, precios, vehículos, usuarios y solicitudes se corrigen con otro cargue o en su pantalla.' };
    if (!total) return { codigo: 409, mensaje: 'Este cargue no creó declaraciones.' };
    if (enUso.length) {
      const n = enUso.slice(0, 10).map((x) => `N.° ${x}`).join(', ') + (enUso.length > 10 ? ` y ${enUso.length - 10} más` : '');
      return { codigo: 409, mensaje: `No se puede deshacer: ${enUso.length === 1 ? 'la declaración' : `${enUso.length} declaraciones`} (${n}) ya ${enUso.length === 1 ? 'tiene solicitudes o manifiestos. Inactívela' : 'tienen solicitudes o manifiestos. Inactívelas'} desde su ficha.` };
    }
    if (a.permisos.includes('*') || a.permisos.includes('importacion.revertir')) return null;
    if (a.permisos.includes('importacion.cargar') && c.usuarioId === a.id && !hayAutorizadas) return null;
    return { codigo: 403, mensaje: c.usuarioId === a.id && hayAutorizadas
      ? 'El cargue tiene declaraciones autorizadas: lo deshace quien tenga el permiso «importacion.revertir» (HSEQ o Administración).'
      : 'Lo deshace quien lo cargó, si ninguna declaración está autorizada, o quien tenga el permiso «importacion.revertir» (HSEQ o Administración).' };
  }

  async revertir(a: Actor, cargueId: string, motivo: string) {
    const r = await this.db.$transaction(async (tx) => {
      // Bloquea el lote: dos personas no lo deshacen a la vez
      await tx.$queryRaw`SELECT id FROM cargues_masivos WHERE id = ${cargueId}::uuid FOR UPDATE`;
      const v = await this.reversion(a, cargueId, tx);
      if (v.codigo === 403) throw new ForbiddenException({ mensaje: v.impedimento });
      if (v.impedimento) throw new ConflictException({ mensaje: v.impedimento, enUso: v.enUso });
      await tx.declaracion.updateMany({ where: { cargueId, estado: { not: 'ANULADA' } }, data: { estado: 'ANULADA', activa: false } });
      await tx.cargueMasivo.update({ where: { id: cargueId }, data: { estado: 'REVERTIDO', revertidoEn: new Date(), revertidoPorId: a.id, motivoReversion: motivo } });
      await this.audit.registrar(a, 'cargue_masivo', cargueId, 'REVERTIR', { estado: 'CONFIRMADO' }, { estado: 'REVERTIDO', motivo, anuladas: v.lista.map((d) => d.numero) }, tx);
      await this.audit.registrarVarios(a, 'declaracion', 'ANULAR', v.lista.map((d) => ({
        entidadId: d.id, antes: { estado: d.estado, activa: d.activa }, despues: { estado: 'ANULADA', activa: false, cargueId, motivo } })), tx);
      return v;
    }, { timeout: 120_000, maxWait: 10_000 });
    return { cargueId, archivo: r.cargue.archivo, anuladas: r.declaraciones, numeros: r.lista.map((d) => d.numero) };
  }
}

const archivo = FileInterceptor('archivo', { limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 } });

@Controller('importacion')
class ImportacionController {
  constructor(private readonly s: ImportacionService) {}
  @Get('plantillas') plantillas() { return PLANTILLAS.map((p) => ({ id: p.id, nombre: p.nombre, descripcion: p.descripcion, archivo: p.archivo, columnas: p.columnas.map(({ validar: _v, advertir: _a, ...c }) => c) })); }
  /** La plantilla en Excel (por defecto) o en CSV separado por punto y coma (`?formato=csv`). */
  @Get('plantillas/:id/archivo') async descargar(@Param('id') id: string, @Query('formato') formato: string | undefined, @Res() res: Response) {
    const p = this.s.plantilla(id);
    if (formato === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${p.archivo.replace(/\.xlsx$/i, '.csv')}"`);
      res.send(construirPlantillaCsv(p));
      return;
    }
    const buf = Buffer.from(await construirPlantilla(p));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${p.archivo}"`);
    res.send(buf);
  }
  @Get('historial') historial(@ActorActual() a: Actor) { return this.s.historial(a); }
  // Sin @Permiso: el servicio decide (quien lo cargó, o «importacion.revertir»)
  @Get('cargues/:cargueId/reversion') reversion(@ActorActual() a: Actor, @Param('cargueId', ParseUUIDPipe) id: string) {
    return this.s.reversion(a, id);
  }
  @Post('cargues/:cargueId/revertir') revertir(@ActorActual() a: Actor, @Param('cargueId', ParseUUIDPipe) id: string, @Body(new Zod(Reversion)) b: z.infer<typeof Reversion>) {
    return this.s.revertir(a, id, b.motivo);
  }
  @Permiso('importacion.cargar') @Post(':id/vista-previa') @UseInterceptors(archivo)
  previa(@ActorActual() a: Actor, @Param('id') id: string, @Body('delimitador') d?: string, @UploadedFile() f?: Express.Multer.File) { return this.s.vistaPrevia(a, id, f, d); }
  @Permiso('importacion.cargar') @Post(':id/confirmar') @UseInterceptors(archivo)
  confirmar(@ActorActual() a: Actor, @Param('id') id: string, @Body('delimitador') d?: string, @UploadedFile() f?: Express.Multer.File) { return this.s.confirmar(a, id, f, d); }
}

@Module({ imports: [DeclaracionesModule], controllers: [ImportacionController], providers: [ImportacionService], exports: [ImportacionService] })
export class ImportacionModule {}
