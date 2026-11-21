// Portal de clientes: autogestión (20-11-2026). Lo que el rol «Todos los clientes» de Grinclic le deja hacer hoy al
// cliente de Terra Viva y faltaba aquí:
//   · Sus sedes: crearlas, corregirlas (dirección, ubicación GPS, contactos, horarios) e inactivarlas.
//   · Sus declaraciones una por una: crearlas, corregirlas (vuelven a revisión), retirar las que Terra Viva aún no ha
//     autorizado, inactivar las que ya no genera, y adjuntar la ficha de datos de seguridad y la caracterización en PDF.
//   · El informe general: cada servicio con lo cargado, lo pesado y conciliado en planta, el precio y el certificado.
// Mismas dos barreras del portal: el API filtra por el cliente del token (y sus sedes) y la base (RLS y la migración
// 20261210000000_portal_autogestion) vuelve a exigir lo que puede escribir una sesión del portal.
import {
  BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { ClasificacionSede, Prisma } from '@prisma/client';
import { z } from 'zod';
import { EsquemaDeclaracion } from '@terraviva/shared';
import { PrismaService } from '../prisma/prisma.service';
import { Auditoria, Municipios } from '../common/servicios';
import { Archivos } from '../common/archivos';
import { ActorActual, SoloPortal, Zod, fechaColombia, type Actor } from '../common/http';
import { Notificaciones } from '../notificaciones/notificaciones.module';
import { DeclaracionesModule, DeclaracionesService } from '../declaraciones/declaraciones.module';
import type { Config } from '../config';
import { PortalModule, PortalService } from './portal.module';
import { RefArchivos, esClaveAlmacen } from './archivos-portal';

type Tx = Prisma.TransactionClient;
type Datos = z.infer<typeof EsquemaDeclaracion>;
const textoOpc = (max: number) => z.string().trim().max(max).transform((x) => x || null).nullish();
const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora HH:MM').transform((h) => new Date(`1970-01-01T${h}:00Z`));
const horaOpc = z.union([hora, z.literal('').transform(() => null)]).nullish();
const aHora = (d: Date | null) => (d ? d.toISOString().slice(11, 16) : null);

// ---------------- Sedes ----------------
const DatosSede = z.object({
  nombre: z.string().trim().min(2, 'Escriba el nombre de la sede.').max(150),
  codigo: z.string().trim().regex(/^[A-Za-z0-9-]{1,20}$/, 'Código de 1 a 20 letras, números o guiones.').transform((s) => s.toUpperCase()).or(z.literal('').transform(() => null)).nullish(),
  clasificacion: z.nativeEnum(ClasificacionSede).nullish(),
  generadorNit: z.string().trim().regex(/^\d{6,10}$/, 'NIT del generador sin puntos ni dígito de verificación.').or(z.literal('').transform(() => null)).nullish(),
  generadorNombre: textoOpc(200),
  direccion: textoOpc(300),
  municipioDane: z.string().regex(/^\d{5}$/, 'Elija el municipio de la lista.').or(z.literal('').transform(() => null)).nullish(),
  latitud: z.number().min(-5, 'La ubicación debe quedar en Colombia.').max(14, 'La ubicación debe quedar en Colombia.').nullish(),
  longitud: z.number().min(-82, 'La ubicación debe quedar en Colombia.').max(-66, 'La ubicación debe quedar en Colombia.').nullish(),
  registroRespel: textoOpc(50), registroRcd: textoOpc(50),
  contacto: textoOpc(150), telefono: textoOpc(20), celular: textoOpc(20),
  emails: z.string().trim().max(200).transform((x) => x || null).refine((x) => !x || x.split(/[,;]/).map((s) => s.trim()).filter(Boolean).every((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)),
    'Escriba correos válidos, separados por coma.').nullish(),
  atencionLvDesde: horaOpc, atencionLvHasta: horaOpc, atencionFdDesde: horaOpc, atencionFdHasta: horaOpc,
  observaciones: textoOpc(1000),
});
const EditarSede = DatosSede.partial().extend({ activa: z.boolean().optional() });
const BuscarMunicipio = z.object({ q: z.string().trim().max(60).default('') });

// ---------------- Declaraciones ----------------
/** Lo que el cliente escribe de su declaración: lo demás (precio, programación automática, etiquetado…) es de Terra Viva. */
const CAMPOS_DECL = [
  'tipo', 'alcanceSedes', 'sucursalIds', 'nombre', 'codigoInterno', 'categoriaId', 'tipoResiduoId', 'lineaServicioId', 'esPeligroso', 'frecuenciaDias',
  'cantidadFrecuencia', 'codigoAId', 'codigoYId', 'codigoUn', 'riesgoIds', 'descripcionProceso', 'composicion', 'descripcionServicio', 'tipoEmbalajeId',
  'otroTipoEmbalaje', 'presentacion', 'materialEmbalajeId', 'otroMaterial', 'tipoSellado', 'estadoFisico', 'tipoRcd', 'inflamable', 'controladaEstupefacientes',
  'color', 'olor', 'contieneHidrocarburos', 'disposiciones', 'datosExtras', 'observaciones', 'responsabilidadAceptada',
] as const;
/** Ficha y caracterización: undefined = sin cambio; null = quitarla; texto = referencia del archivo recién subido. */
const CuerpoDecl = z.object({ fichaSeguridad: z.string().max(1000).nullish(), caracterizacion: z.string().max(1000).nullish() }).passthrough();
const Motivo = z.object({ motivo: z.string().trim().min(5, 'Cuéntenos el motivo (mínimo 5 caracteres).').max(300) });
const CAUSAL_INACTIVA = { codigo: 'CAU-PORTAL-DECL', nombre: 'Inactivada por el cliente desde el portal (ya no la genera)' };

// ---------------- Informe general ----------------
const FiltroGeneral = z.object({
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha AAAA-MM-DD'), hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha AAAA-MM-DD'),
  sucursalId: z.string().uuid().optional(),
});

@Injectable()
export class AutogestionService {
  readonly refs: RefArchivos;
  constructor(private readonly db: PrismaService, private readonly p: PortalService, private readonly audit: Auditoria, private readonly archivos: Archivos,
    private readonly municipios: Municipios, private readonly declaraciones: DeclaracionesService, private readonly notificaciones: Notificaciones, cfg: ConfigService<Config, true>) {
    this.refs = new RefArchivos(cfg);
  }

  // ======================= Archivos =======================
  /** Guarda un PDF o una foto que sube el administrador del cliente (ficha de seguridad, caracterización, orden de compra). */
  async subirArchivo(a: Actor, f: Express.Multer.File | undefined) {
    await this.p.exigir(a, 'portal.declaraciones.gestionar', 'portal.solicitudes.pedir', 'portal.entregas.pedir');
    if (!f) throw new BadRequestException({ mensaje: 'Adjunte el archivo.' });
    await this.p.conCliente(a, (tx) => this.p.exigirActivo(tx, a));
    const g = await this.archivos.guardar(a.empresaId, 'portal', f.buffer, ['pdf', 'jpg', 'png']);
    const nombre = (f.originalname || `archivo.${g.tipo}`).replace(/[\\/]/g, '_').slice(0, 120);
    return { ref: this.refs.firmar(g.clave, a.clienteId!), nombre, tipo: g.tipo, bytes: g.bytes };
  }

  // ======================= Sedes =======================
  async sedes(a: Actor) {
    await this.p.exigir(a, 'portal.sedes.ver', 'portal.sedes.gestionar');
    return this.p.conCliente(a, async (tx) => {
      const mias = await this.p.sedesDe(tx, a);
      const filas = await tx.sucursal.findMany({
        where: { clienteId: a.clienteId, ...(mias.length ? { id: { in: mias } } : {}) }, orderBy: [{ activa: 'desc' }, { esPrincipal: 'desc' }, { nombre: 'asc' }], take: 1000,
        select: {
          id: true, codigo: true, nombre: true, esPrincipal: true, activa: true, clasificacion: true, generadorNit: true, generadorNombre: true, direccion: true,
          municipioDane: true, municipio: { select: { nombre: true, departamento: true } }, latitud: true, longitud: true, registroRespel: true, registroRcd: true,
          contacto: true, telefono: true, celular: true, emails: true, atencionLvDesde: true, atencionLvHasta: true, atencionFdDesde: true, atencionFdHasta: true, observaciones: true,
          _count: { select: { declaraciones: { where: { activa: true, declaracion: { estado: 'AUTORIZADA', activa: true } } } } },
        },
      });
      return filas.map(({ _count, latitud, longitud, atencionLvDesde, atencionLvHasta, atencionFdDesde, atencionFdHasta, ...s }) => ({
        ...s, latitud: latitud === null ? null : Number(latitud), longitud: longitud === null ? null : Number(longitud),
        atencionLvDesde: aHora(atencionLvDesde), atencionLvHasta: aHora(atencionLvHasta), atencionFdDesde: aHora(atencionFdDesde), atencionFdHasta: aHora(atencionFdHasta),
        declaracionesActivas: _count.declaraciones,
      }));
    });
  }

  async municipiosBuscar(a: Actor, q: string) { await this.p.exigir(a, 'portal.sedes.gestionar'); return q.length < 2 ? [] : this.municipios.buscar(q, undefined, 15); }

  private async validarSede(tx: Tx, a: Actor, b: Partial<z.infer<typeof DatosSede>>, actual?: { id: string; generadorNit: string | null }) {
    if ((b.latitud === undefined) !== (b.longitud === undefined) || ((b.latitud ?? null) === null) !== ((b.longitud ?? null) === null))
      throw new BadRequestException({ mensaje: 'Indique la latitud y la longitud juntas (o ninguna).' });
    if (b.municipioDane && !(await this.municipios.existe(b.municipioDane))) throw new BadRequestException({ mensaje: 'Elija el municipio de la lista (DIVIPOLA del DANE).' });
    const c = await tx.cliente.findUniqueOrThrow({ where: { id: a.clienteId }, select: { tipo: true } });
    const nit = b.generadorNit !== undefined ? b.generadorNit : actual?.generadorNit;
    if (c.tipo === 'GESTOR' && !nit) throw new BadRequestException({ mensaje: 'Su empresa es gestora: cada sede indica el NIT del generador que representa.' });
    if (b.codigo && await tx.sucursal.findFirst({ where: { clienteId: a.clienteId, codigo: b.codigo, ...(actual ? { id: { not: actual.id } } : {}) }, select: { id: true } }))
      throw new BadRequestException({ mensaje: `Ya tiene una sede con el código ${b.codigo}.` });
  }

  /** Sede nueva: la crea el administrador que ve toda la empresa. Si el cliente no tiene principal, esta lo es. */
  async crearSede(a: Actor, b: z.infer<typeof DatosSede>) {
    await this.p.exigir(a, 'portal.sedes.gestionar');
    const s = await this.p.conCliente(a, async (tx) => {
      await this.p.exigirActivo(tx, a);
      if ((await this.p.sedesDe(tx, a)).length)
        throw new ForbiddenException({ mensaje: 'Usted ve solo algunas sedes: las sedes nuevas las crea el administrador que ve toda la empresa, o Terra Viva.' });
      await this.validarSede(tx, a, b);
      const principal = !(await tx.sucursal.count({ where: { clienteId: a.clienteId, esPrincipal: true } }));
      const r = await tx.sucursal.create({ data: { ...b, clienteId: a.clienteId!, esPrincipal: principal }, select: { id: true, nombre: true, codigo: true, esPrincipal: true } });
      await this.audit.registrar(a, 'sucursal', r.id, 'CREAR_PORTAL', undefined, { nombre: r.nombre, codigo: r.codigo, principal }, tx);
      return r;
    });
    // Logística le asigna la zona de ruta y Comercial revisa los datos
    void this.avisar(a, ['clientes.editar', 'rutas.programar'], 'Sede nueva desde el portal', `${s.nombre}: asígnele la zona de ruta.`, 'clientes');
    return s;
  }

  /** Corrige una sede o la inactiva (no se borra). La principal no se inactiva ni se cambia desde el portal. */
  async editarSede(a: Actor, id: string, b: z.infer<typeof EditarSede>) {
    await this.p.exigir(a, 'portal.sedes.gestionar');
    return this.p.conCliente(a, async (tx) => {
      await this.p.exigirActivo(tx, a);
      const mias = await this.p.sedesDe(tx, a);
      const s = (!mias.length || mias.includes(id)) ? await tx.sucursal.findFirst({ where: { id, clienteId: a.clienteId } }) : null;
      if (!s) throw new NotFoundException({ mensaje: 'Sede no encontrada.' });
      await this.validarSede(tx, a, b, s);
      if (b.activa === false && s.esPrincipal) throw new BadRequestException({ mensaje: 'Es su sede principal: no se inactiva. Si cambió de sede principal, pídale a Terra Viva que la actualice.' });
      // Al inactivarla deja de recibir servicios: sus residuos y servicios dejan de pedirse en ella
      let vinculos = 0;
      if (b.activa === false && s.activa)
        vinculos = (await tx.declaracionSucursal.updateMany({ where: { sucursalId: id, activa: true, declaracion: { estado: { not: 'ANULADA' } } }, data: { activa: false } })).count;
      const cambios = Object.entries(b).filter(([k, v]) => {
        const previo = (s as Record<string, unknown>)[k];
        const norm = (x: unknown) => (x instanceof Date ? x.toISOString() : Prisma.Decimal.isDecimal(x) ? Number(x) : x ?? null);
        return v !== undefined && JSON.stringify(norm(previo)) !== JSON.stringify(norm(v));
      });
      if (!cambios.length) return { id, cambios: 0 };
      await tx.sucursal.update({ where: { id }, data: Object.fromEntries(cambios) });
      const norm = (x: unknown) => (x instanceof Date ? aHora(x) : Prisma.Decimal.isDecimal(x) ? Number(x) : x ?? null);
      await this.audit.registrar(a, 'sucursal', id, b.activa === false && s.activa ? 'INACTIVAR_PORTAL' : b.activa && !s.activa ? 'ACTIVAR_PORTAL' : 'EDITAR_PORTAL',
        Object.fromEntries(cambios.map(([k]) => [k, norm((s as Record<string, unknown>)[k])])),
        { ...Object.fromEntries(cambios.map(([k, v]) => [k, norm(v)])), ...(vinculos ? { vinculosInactivados: vinculos } : {}) }, tx);
      return { id, cambios: cambios.length, vinculosInactivados: vinculos };
    });
  }

  // ======================= Declaraciones =======================
  /** Catálogos para el formulario del cliente (solo lo que necesita: sin causales, precios ni soportes internos). */
  async catalogos(a: Actor) {
    await this.p.exigir(a, 'portal.declaraciones.gestionar');
    const c = await this.declaraciones.catalogos(a);
    const item = (x: { id: string; codigo: string; nombre: string }) => ({ id: x.id, codigo: x.codigo, nombre: x.nombre });
    return {
      categorias: c.categorias.map(item), tiposResiduo: c.tiposResiduo.map(item),
      lineas: c.lineas.map((x) => ({ ...item(x), unidadNegocio: x.unidadNegocio?.nombre ?? null })),
      tiposEmbalaje: c.tiposEmbalaje.map((x) => ({ ...item(x), esOtro: x.esOtro })), materiales: c.materiales.map((x) => ({ ...item(x), esOtro: x.esOtro })),
      disposiciones: c.disposiciones.map(item), riesgos: c.riesgos.map(item),
      corrientesY: c.corrientesY.map((x) => ({ id: x.id, codigo: x.codigo, descripcion: x.descripcion })), codigosA: c.codigosA.map((x) => ({ id: x.id, codigo: x.codigo, descripcion: x.descripcion })),
    };
  }

  /** Una declaración del cliente con lo que necesita el formulario para corregirla. */
  async formularioDeclaracion(a: Actor, id: string) {
    await this.p.exigir(a, 'portal.declaraciones.gestionar');
    return this.p.conCliente(a, async (tx) => {
      const d = await this.declaracionVisible(tx, a, id);
      const x = await tx.declaracion.findUniqueOrThrow({ where: { id }, include: { sucursales: true, disposiciones: true, riesgos: true } });
      return {
        id: x.id, numero: x.numero, estado: x.estado, activa: x.activa, tipo: x.tipo, alcanceSedes: x.alcanceSedes, sucursalIds: x.sucursales.map((s) => s.sucursalId),
        nombre: x.nombre, codigoInterno: x.codigoInterno, categoriaId: x.categoriaId, tipoResiduoId: x.tipoResiduoId, lineaServicioId: x.lineaServicioId,
        esPeligroso: x.esPeligroso, frecuenciaDias: x.frecuenciaDias, cantidadFrecuencia: x.cantidadFrecuencia === null ? null : Number(x.cantidadFrecuencia),
        codigoAId: x.codigoAId, codigoYId: x.codigoYId, codigoUn: x.codigoUn, riesgoIds: x.riesgos.map((r) => r.riesgoId),
        descripcionProceso: x.descripcionProceso, composicion: x.composicion, descripcionServicio: x.descripcionServicio,
        tipoEmbalajeId: x.tipoEmbalajeId, otroTipoEmbalaje: x.otroTipoEmbalaje, presentacion: x.presentacion, materialEmbalajeId: x.materialEmbalajeId, otroMaterial: x.otroMaterial,
        tipoSellado: x.tipoSellado, estadoFisico: x.estadoFisico, tipoRcd: x.tipoRcd, inflamable: x.inflamable, controladaEstupefacientes: x.controladaEstupefacientes,
        color: x.color, olor: x.olor, contieneHidrocarburos: x.contieneHidrocarburos, disposiciones: x.disposiciones.map((y) => ({ disposicionId: y.disposicionId, principal: y.principal })),
        datosExtras: x.datosExtras, observaciones: x.observaciones, responsabilidadAceptada: x.responsabilidadAceptada,
        fichaSeguridad: d.fichaSeguridadUrl ? { archivo: esClaveAlmacen(d.fichaSeguridadUrl) } : null,
        caracterizacion: d.caracterizacionUrl ? { archivo: esClaveAlmacen(d.caracterizacionUrl) } : null,
      };
    });
  }

  /** Declaración del cliente que el usuario puede ver (todas sus sedes, o alguna de las suyas si está limitado). */
  private async declaracionVisible(tx: Tx, a: Actor, id: string) {
    const mias = await this.p.sedesDe(tx, a);
    const d = await tx.declaracion.findFirst({ where: { id, clienteId: a.clienteId, estado: { not: 'ANULADA' }, ...(mias.length ? { sucursales: { some: { sucursalId: { in: mias } } } } : {}) },
      select: { id: true, numero: true, tipo: true, estado: true, activa: true, observaciones: true, mostrarPrecioApp: true, solicitudAutomatica: true, fichaSeguridadUrl: true, caracterizacionUrl: true,
        catalogoId: true, serial: true, densidad: true, metricaDensidadId: true, vigenteHasta: true, etiquetados: { select: { sistemaId: true } }, sucursales: { select: { sucursalId: true } } } });
    if (!d) throw new NotFoundException({ mensaje: 'Declaración no encontrada.' });
    return { ...d, mias };
  }

  /** Arma los datos completos de la declaración (mismo esquema de la oficina) con lo que manda el cliente. */
  private datosDeclaracion(a: Actor, cuerpo: z.infer<typeof CuerpoDecl>, previo?: Awaited<ReturnType<AutogestionService['declaracionVisible']>>): Datos {
    const elegidos = Object.fromEntries(CAMPOS_DECL.filter((k) => k in cuerpo).map((k) => [k, (cuerpo as Record<string, unknown>)[k]]));
    const archivo = (v: string | null | undefined, actual: string | null | undefined) => (v === undefined ? actual ?? null : v === null ? null : this.refs.leer(v, a.clienteId!));
    return new Zod(EsquemaDeclaracion).transform({
      ...elegidos, clienteId: a.clienteId, borrador: false, precio: null,
      // De Terra Viva: se conservan al corregir (y van vacíos en una declaración nueva)
      mostrarPrecioApp: previo?.mostrarPrecioApp ?? false, solicitudAutomatica: previo?.solicitudAutomatica ?? false, catalogoId: previo?.catalogoId ?? null,
      serial: previo?.serial ?? null, densidad: previo?.densidad === null || previo?.densidad === undefined ? null : Number(previo.densidad), metricaDensidadId: previo?.metricaDensidadId ?? null,
      vigenteHasta: previo?.vigenteHasta ?? null, etiquetadoIds: previo?.etiquetados.map((e) => e.sistemaId) ?? [],
      fichaSeguridadUrl: archivo(cuerpo.fichaSeguridad, previo?.fichaSeguridadUrl), caracterizacionUrl: archivo(cuerpo.caracterizacion, previo?.caracterizacionUrl),
    }) as Datos;
  }

  /** Un usuario limitado a unas sedes solo declara para ellas (y solo corrige declaraciones que sean solo de ellas). */
  private exigirSedes(mias: string[], datos: Datos, actuales?: string[]) {
    if (!mias.length) return;
    if (datos.alcanceSedes !== 'SELECCION') throw new ForbiddenException({ mensaje: 'Usted ve solo algunas sedes: elija sus sedes una por una.' });
    if (!datos.sucursalIds.every((s) => mias.includes(s)) || (actuales && !actuales.every((s) => mias.includes(s))))
      throw new ForbiddenException({ mensaje: 'La declaración incluye sedes que usted no ve: pídale el cambio al administrador de su empresa.' });
  }

  /** Declaración nueva: queda «en revisión» (Terra Viva fija la tarifa y la autoriza). */
  async crearDeclaracion(a: Actor, cuerpo: z.infer<typeof CuerpoDecl>) {
    await this.p.exigir(a, 'portal.declaraciones.gestionar');
    const datos = this.datosDeclaracion(a, cuerpo);
    if (!datos.responsabilidadAceptada) throw new BadRequestException({ mensaje: 'Acepte la declaración de responsabilidad del generador.' });
    const d = await this.p.conCliente(a, async (tx) => {
      await this.p.exigirActivo(tx, a);
      this.exigirSedes(await this.p.sedesDe(tx, a), datos);
      const r = await this.declaraciones.crear(a, datos, tx);
      await this.audit.registrar(a, 'declaracion', r.id, 'CREAR_PORTAL', undefined, { numero: r.numero }, tx);
      return { id: r.id, numero: r.numero, estado: r.estado };
    }, 60_000);
    void this.avisar(a, ['declaraciones.autorizar'], 'Declaración nueva desde el portal', `N.° ${d.numero}: revísela, fije la tarifa y autorícela.`, 'declaraciones');
    return d;
  }

  /** Corrige una declaración: vuelve a revisión (inactiva) hasta que Terra Viva la autorice de nuevo. */
  async editarDeclaracion(a: Actor, id: string, cuerpo: z.infer<typeof CuerpoDecl>) {
    await this.p.exigir(a, 'portal.declaraciones.gestionar');
    const r = await this.p.conCliente(a, async (tx) => {
      await this.p.exigirActivo(tx, a);
      const previo = await this.declaracionVisible(tx, a, id);
      const datos = this.datosDeclaracion(a, cuerpo, previo);
      if (datos.tipo !== previo.tipo) throw new BadRequestException({ mensaje: 'No se cambia el tipo (residuo o servicio): cree una declaración nueva.' });
      if (!datos.responsabilidadAceptada) throw new BadRequestException({ mensaje: 'Acepte la declaración de responsabilidad del generador.' });
      this.exigirSedes(previo.mias, datos, previo.sucursales.map((s) => s.sucursalId));
      const d = await this.declaraciones.editar(a, id, datos, tx);
      return { id, numero: d.numero, estado: d.estado, estabaAutorizada: previo.estado === 'AUTORIZADA' };
    }, 60_000);
    void this.avisar(a, ['declaraciones.autorizar'], 'Declaración corregida desde el portal',
      `N.° ${r.numero}${r.estabaAutorizada ? ' (estaba autorizada)' : ''}: revísela y autorícela de nuevo.`, 'declaraciones');
    return r;
  }

  /** Retira una declaración que Terra Viva aún no ha autorizado y que no se ha usado (queda anulada, como constancia). */
  async retirarDeclaracion(a: Actor, id: string, motivo: string) {
    await this.p.exigir(a, 'portal.declaraciones.gestionar');
    return this.p.conCliente(a, async (tx) => {
      const d = await this.declaracionVisible(tx, a, id);
      this.exigirSedes(d.mias, { alcanceSedes: 'SELECCION', sucursalIds: d.sucursales.map((s) => s.sucursalId) } as Datos);
      if (d.estado === 'AUTORIZADA') throw new BadRequestException({ mensaje: 'Ya está autorizada: si ya no la genera, inactívela.' });
      if (await tx.solicitudItem.count({ where: { declaracionId: id } })) throw new BadRequestException({ mensaje: 'Ya tiene pedidos: no se retira. Pídale a Terra Viva que la inactive.' });
      await tx.declaracion.update({ where: { id }, data: { estado: 'ANULADA', activa: false, observaciones: [d.observaciones, `Retirada por el cliente desde el portal: ${motivo}`].filter(Boolean).join('\n') } });
      await this.audit.registrar(a, 'declaracion', id, 'RETIRAR_PORTAL', { estado: d.estado }, { estado: 'ANULADA', motivo }, tx);
      return { id, numero: d.numero, estado: 'ANULADA' as const };
    });
  }

  /** Inactiva una declaración autorizada que el cliente ya no genera. Volver a activarla lo hace Terra Viva. */
  async inactivarDeclaracion(a: Actor, id: string, motivo: string) {
    await this.p.exigir(a, 'portal.declaraciones.gestionar');
    const r = await this.p.conCliente(a, async (tx) => {
      const d = await this.declaracionVisible(tx, a, id);
      this.exigirSedes(d.mias, { alcanceSedes: 'SELECCION', sucursalIds: d.sucursales.map((s) => s.sucursalId) } as Datos);
      if (d.estado !== 'AUTORIZADA' || !d.activa) throw new BadRequestException({ mensaje: 'Solo se inactiva una declaración autorizada y activa.' });
      const pedidos = await tx.solicitudItem.count({ where: { declaracionId: id, estado: { in: ['PENDIENTE', 'PROGRAMADO'] }, solicitud: { estado: { not: 'CANCELADA' } } } });
      if (pedidos) throw new BadRequestException({ mensaje: `Tiene ${pedidos === 1 ? 'un pedido abierto' : `${pedidos} pedidos abiertos`} con este residuo: cancélelos o espere a que se recojan antes de inactivarla.` });
      const causal = await tx.catalogoItem.upsert({
        where: { empresaId_tipo_codigo: { empresaId: a.empresaId, tipo: 'CAUSAL', codigo: CAUSAL_INACTIVA.codigo } }, update: {},
        create: { empresaId: a.empresaId, tipo: 'CAUSAL', ...CAUSAL_INACTIVA }, select: { id: true },
      });
      await tx.declaracion.update({ where: { id }, data: { activa: false, causalId: causal.id, observaciones: [d.observaciones, `Inactivada por el cliente desde el portal: ${motivo}`].filter(Boolean).join('\n') } });
      await this.audit.registrar(a, 'declaracion', id, 'INACTIVAR_PORTAL', { activa: true }, { activa: false, motivo }, tx);
      return { id, numero: d.numero, activa: false };
    });
    void this.avisar(a, ['declaraciones.autorizar'], 'Declaración inactivada por el cliente', `N.° ${r.numero}: ${motivo}`, 'declaraciones');
    return r;
  }

  /** Enlace (5 minutos) a la ficha de seguridad o a la caracterización que subió el cliente. */
  async enlaceDocumento(a: Actor, id: string, cual: 'ficha' | 'caracterizacion') {
    await this.p.exigir(a, 'portal.declaraciones.ver');
    const d = await this.p.conCliente(a, (tx) => this.declaracionVisible(tx, a, id));
    const v = cual === 'ficha' ? d.fichaSeguridadUrl : d.caracterizacionUrl;
    if (!v) throw new NotFoundException({ mensaje: 'La declaración no tiene ese documento.' });
    if (/^https:\/\//i.test(v)) return { url: v, externo: true };
    if (!esClaveAlmacen(v)) throw new NotFoundException({ mensaje: 'El documento está en el expediente de Terra Viva.' });
    const ext = v.slice(v.lastIndexOf('.') + 1);
    return this.archivos.enlace(v, a.empresaId, { nombre: `${cual === 'ficha' ? 'ficha-de-seguridad' : 'caracterizacion'}-${d.numero}.${ext}` });
  }

  // ======================= Informe general =======================
  /**
   * Informe general (rango de fechas y sede): cada línea de manifiesto con lo cargado en la sede y, si la conciliación
   * está aprobada, lo pesado en planta, el precio conciliado, su valor, la factura y el certificado.
   */
  async informeGeneral(a: Actor, f: z.infer<typeof FiltroGeneral>) {
    await this.p.exigir(a, 'portal.informes.ver');
    const precios = await this.p.puede(a, 'portal.precios.ver');
    const desde = new Date(`${f.desde}T00:00:00Z`), hasta = new Date(`${f.hasta}T00:00:00Z`);
    if (Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime()) || hasta < desde) throw new BadRequestException({ mensaje: 'Revise el rango de fechas.' });
    if (hasta.getTime() - desde.getTime() > 400 * 86_400_000) throw new BadRequestException({ mensaje: 'Pida el informe de máximo un año a la vez.' });
    return this.p.conCliente(a, async (tx) => {
      const mias = await this.p.sedesDe(tx, a);
      if (f.sucursalId && mias.length && !mias.includes(f.sucursalId)) throw new NotFoundException({ mensaje: 'Sede no encontrada.' });
      const sedes = f.sucursalId ? [f.sucursalId] : mias;
      const filas = await tx.manifiestoItem.findMany({
        where: { manifiesto: { clienteId: a.clienteId, estado: 'REALIZADO', fechaServicio: { gte: desde, lte: hasta } }, ...(sedes.length ? { sucursalId: { in: sedes } } : {}) },
        orderBy: [{ manifiesto: { fechaServicio: 'asc' } }, { manifiesto: { numero: 'asc' } }], take: 5001,
        select: {
          id: true, cantidad: true, metrica: { select: { abreviacion: true } }, disposicion: { select: { nombre: true } },
          manifiesto: { select: { numero: true, tipo: true, fechaServicio: true, ordenCompra: true, destino: { select: { razonSocial: true } }, conciliacion: { select: { estado: true } } } },
          declaracion: { select: { numero: true, nombre: true, codigoInterno: true, esPeligroso: true } }, sucursal: { select: { codigo: true, nombre: true } },
          conciliacion: { select: { cantidadConciliada: true, precioUnitario: true, tipoNegociacion: true, facturaNumero: true, metrica: { select: { abreviacion: true } },
            disposicion: { select: { nombre: true } }, acta: { select: { numero: true, estado: true } } } },
        },
      });
      const lineas = filas.slice(0, 5000).map((x) => {
        const aprobada = x.manifiesto.conciliacion?.estado === 'APROBADA' && !!x.conciliacion;
        const conc = aprobada ? x.conciliacion : null;
        const pesado = conc?.cantidadConciliada == null ? null : Number(conc.cantidadConciliada);
        const precio = conc?.precioUnitario == null ? null : Number(conc.precioUnitario);
        return {
          id: x.id, fecha: x.manifiesto.fechaServicio.toISOString().slice(0, 10), manifiesto: x.manifiesto.numero, tipo: x.manifiesto.tipo, ordenCompra: x.manifiesto.ordenCompra,
          sede: x.sucursal.nombre, sedeCodigo: x.sucursal.codigo, declaracion: x.declaracion.numero, residuo: x.declaracion.nombre, codigoInterno: x.declaracion.codigoInterno, peligroso: x.declaracion.esPeligroso,
          cargado: Number(x.cantidad), unidad: x.metrica?.abreviacion ?? null, conciliada: aprobada, pesado, unidadPlanta: conc?.metrica?.abreviacion ?? x.metrica?.abreviacion ?? null,
          tratamiento: conc?.disposicion?.nombre ?? x.disposicion?.nombre ?? null, destino: x.manifiesto.destino.razonSocial,
          // Sin «ver tarifas y valores» en su rol, el precio y el valor no salen del servidor
          precio: precios ? precio : null, valor: precios && precio !== null && pesado !== null ? Math.round(precio * pesado * 100) / 100 : null, negociacion: precios ? conc?.tipoNegociacion ?? null : null,
          factura: conc?.facturaNumero ?? null, certificado: conc?.acta?.estado === 'EMITIDA' ? conc.acta.numero : null,
        };
      });
      return { desde: f.desde, hasta: f.hasta, lineas, recortado: filas.length > 5000, generado: new Date().toISOString(), hoy: fechaColombia().toISOString().slice(0, 10) };
    }, 60_000);
  }

  /** Aviso push a la oficina (sin esperar ni fallar si no sale). */
  private async avisar(a: Actor, permisos: string[], titulo: string, texto: string, ruta: string) {
    try {
      const c = await this.db.cliente.findUnique({ where: { id: a.clienteId! }, select: { razonSocial: true } });
      await this.notificaciones.aPermisos(a.empresaId, permisos, { titulo, cuerpo: `${c?.razonSocial ?? 'Cliente'} · ${texto}`, ruta, etiqueta: `portal-${titulo}` });
    } catch { /* el aviso no es parte de la operación */ }
  }
}

const archivo = FileInterceptor('archivo', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

/** Rutas de autogestión del portal: solo usuarios de un cliente (el guard global responde 403 a cualquier otro). */
@Controller('portal')
@SoloPortal()
export class AutogestionController {
  constructor(private readonly s: AutogestionService) {}
  @Post('archivos') @UseInterceptors(archivo) subir(@ActorActual() a: Actor, @UploadedFile() f?: Express.Multer.File) { return this.s.subirArchivo(a, f); }
  // Sedes
  @Get('sedes') sedes(@ActorActual() a: Actor) { return this.s.sedes(a); }
  @Get('municipios') municipios(@ActorActual() a: Actor, @Query(new Zod(BuscarMunicipio)) q: z.infer<typeof BuscarMunicipio>) { return this.s.municipiosBuscar(a, q.q); }
  @Post('sedes') crearSede(@ActorActual() a: Actor, @Body(new Zod(DatosSede)) b: z.infer<typeof DatosSede>) { return this.s.crearSede(a, b); }
  @Patch('sedes/:id') editarSede(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(EditarSede)) b: z.infer<typeof EditarSede>) { return this.s.editarSede(a, id, b); }
  // Declaraciones (los catálogos van en otra ruta: «declaraciones/:id» ya es el detalle)
  @Get('catalogos-declaracion') catalogos(@ActorActual() a: Actor) { return this.s.catalogos(a); }
  @Get('declaraciones/:id/formulario') formulario(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.formularioDeclaracion(a, id); }
  @Post('declaraciones') crearDeclaracion(@ActorActual() a: Actor, @Body(new Zod(CuerpoDecl)) b: z.infer<typeof CuerpoDecl>) { return this.s.crearDeclaracion(a, b); }
  @Put('declaraciones/:id') editarDeclaracion(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(CuerpoDecl)) b: z.infer<typeof CuerpoDecl>) { return this.s.editarDeclaracion(a, id, b); }
  @Post('declaraciones/:id/retirar') @HttpCode(200) retirar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Motivo)) b: z.infer<typeof Motivo>) { return this.s.retirarDeclaracion(a, id, b.motivo); }
  @Post('declaraciones/:id/inactivar') @HttpCode(200) inactivar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Motivo)) b: z.infer<typeof Motivo>) { return this.s.inactivarDeclaracion(a, id, b.motivo); }
  @Post('declaraciones/:id/ficha/enlace') @HttpCode(200) ficha(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.enlaceDocumento(a, id, 'ficha'); }
  @Post('declaraciones/:id/caracterizacion/enlace') @HttpCode(200) caracterizacion(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.enlaceDocumento(a, id, 'caracterizacion'); }
  // Informe general
  @Get('informe-general') informeGeneral(@ActorActual() a: Actor, @Query(new Zod(FiltroGeneral)) f: z.infer<typeof FiltroGeneral>) { return this.s.informeGeneral(a, f); }
}

@Module({ imports: [PortalModule, DeclaracionesModule], controllers: [AutogestionController], providers: [AutogestionService] })
export class AutogestionModule {}
