// Certificado comercial del cliente (gerencia, 19-11-2026): «habilita que el cliente, desde su sesión, pueda descargar
// directamente la Certificación Comercial con Terra Viva», a partir del modelo PD-GG-F-01, mejorado y dinámico.
// - Uno por cliente y día: si se pide otra vez el mismo día (en la oficina o en el portal), se entrega el mismo.
// - Consecutivo propio CC-AAAA-0001 (Ajustes › Numeración), PDF en el almacenamiento (Cloudflare R2) con su huella y QR.
// - Un cliente inactivo no lo recibe: la relación comercial no está vigente.
// - La frase de cumplimiento satisfactorio solo sale si el cliente no tiene facturas vencidas (condición sutil del pago).
import { BadRequestException, Controller, ForbiddenException, Get, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type Cliente } from '@prisma/client';
import { AVISO_CLIENTE_INACTIVO } from '@terraviva/shared';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { Auditoria } from '../common/servicios';
import { Archivos } from '../common/archivos';
import { ActorActual, Permiso, fechaColombia, type Actor } from '../common/http';
import { facturasVencidasCliente } from '../actas/cartera';
import type { Config } from '../config';
import { fechaLarga, pdfCertificadoComercial, type ContenidoCertificadoComercial } from './certificado-comercial.pdf';

/** Datos de la empresa que usa el certificado comercial (Ajustes › Datos de la empresa). */
interface ConfigEmpresa {
  ciudadFirma?: string; representanteLegal?: string;
  certificadoComercial?: { cargo?: string; correo?: string };
  certificaciones?: { norma: string; numero: string; entidad?: string; vence?: string }[];
  contacto?: { direccion?: string; municipio?: string; telefono?: string; correo?: string };
}
/** Residuos que se nombran por tratamiento (el resto se cuenta: «y 4 más»). */
const MAX_RESIDUOS = 8;
const iso = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class CertificadoComercialService {
  constructor(private readonly db: PrismaService, private readonly audit: Auditoria, private readonly archivos: Archivos, private readonly cfg: ConfigService<Config, true>) {}

  private urlVerificacion(codigo: string) { return `${this.cfg.get('WEB_URL', { infer: true }).replace(/\/$/, '')}/#verificar/${codigo}`; }

  /**
   * Expide el certificado comercial del cliente, o entrega el que ya se expidió hoy. `origen` cambia solo el mensaje
   * para un cliente inactivo (en el portal, el aviso amable de siempre).
   */
  async expedir(empresaId: string, clienteId: string, solicitante: { id: string }, origen: 'OFICINA' | 'PORTAL') {
    const hoy = fechaColombia();
    const ya = await this.db.certificadoComercial.findUnique({ where: { clienteId_fecha: { clienteId, fecha: hoy } } });
    if (ya && ya.empresaId === empresaId) return ya;
    const cliente = await this.db.cliente.findFirst({ where: { id: clienteId, empresaId } });
    if (!cliente) throw new NotFoundException({ mensaje: 'Cliente no encontrado.' });
    if (!cliente.activo) throw new ForbiddenException({ codigo: 'CLIENTE_INACTIVO', mensaje: origen === 'PORTAL' ? AVISO_CLIENTE_INACTIVO[cliente.motivoInactivacion ?? 'OTRO']
      : `${cliente.razonSocial} está inactivo: la relación comercial no está vigente y no se expide el certificado comercial.` });
    const base = await this.contenido(empresaId, cliente, hoy);
    try {
      return await this.db.$transaction(async (tx) => {
        // El número se toma dentro de la transacción: si algo falla, no queda un salto en la numeración
        const [{ numero }] = await tx.$queryRaw<{ numero: string }[]>`SELECT fn_siguiente_consecutivo(${empresaId}::uuid, 'CERT_COMERCIAL') AS numero`;
        const codigo = randomBytes(12).toString('hex');
        const c: ContenidoCertificadoComercial = { ...base, numero, verificacion: { codigo, url: this.urlVerificacion(codigo) } };
        const pdf = await pdfCertificadoComercial(c);
        const g = await this.archivos.guardarGenerado(empresaId, 'certificados-comerciales', pdf, 'pdf');
        const r = await tx.certificadoComercial.create({ data: {
          empresaId, clienteId, numero, fecha: hoy, contenido: c as unknown as Prisma.InputJsonValue, pdfUrl: g.clave,
          pdfSha256: createHash('sha256').update(pdf).digest('hex'), codigoVerificacion: codigo, solicitadoPorId: solicitante.id,
        } });
        await this.audit.registrar(solicitante, 'certificado_comercial', r.id, 'EXPEDIR', undefined, { numero, cliente: cliente.razonSocial, origen, alDia: c.alDia }, tx);
        return r;
      }, { timeout: 30_000 });
    } catch (e) {
      // Dos pedidos al mismo tiempo: uno lo expide y el otro entrega ese mismo
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const otro = await this.db.certificadoComercial.findUnique({ where: { clienteId_fecha: { clienteId, fecha: hoy } } });
        if (otro) return otro;
      }
      throw e;
    }
  }

  /** Lo que dice el certificado: cliente, desde cuándo, si está al día, sus servicios y los actos que los amparan. */
  private async contenido(empresaId: string, cliente: Cliente, hoy: Date): Promise<Omit<ContenidoCertificadoComercial, 'numero' | 'verificacion'>> {
    const [empresa, decls, primero, permisos] = await Promise.all([
      this.db.empresa.findUniqueOrThrow({ where: { id: empresaId }, select: { razonSocial: true, nit: true, configuracion: true } }),
      this.db.declaracion.findMany({ where: { clienteId: cliente.id, estado: 'AUTORIZADA', activa: true }, orderBy: { nombre: 'asc' },
        select: { nombre: true, esPeligroso: true, disposiciones: { select: { principal: true, disposicion: { select: { codigo: true, nombre: true, propia: true } } } } } }),
      this.db.manifiesto.findFirst({ where: { clienteId: cliente.id, estado: 'REALIZADO' }, orderBy: { fechaServicio: 'asc' }, select: { fechaServicio: true } }),
      this.db.permisoAmbiental.findMany({ where: { empresaId, estado: { in: ['VIGENTE', 'POR_VENCER'] }, OR: [{ vence: null }, { vence: { gte: hoy } }] }, orderBy: { acto: 'asc' },
        include: { disposiciones: { include: { disposicion: { select: { codigo: true, nombre: true, propia: true, activo: true } } } } } }),
    ]);
    const conf = (empresa.configuracion ?? {}) as ConfigEmpresa;
    const vencidas = await facturasVencidasCliente(this.db, empresa.configuracion, cliente.id);
    // «Resolución DGL No. 000632 de 2023» + 15-08-2023 → «Resolución DGL No. 000632 del 15 de agosto de 2023 (CAS)»
    const citar = (p: (typeof permisos)[number]) => `${p.expedicion ? `${p.acto.replace(/ de \d{4}$/, '')} del ${fechaLarga(iso(p.expedicion))}` : p.acto} (${p.autoridad})`;
    const ampara = (codigos: Set<string>) => permisos.filter((p) => p.disposiciones.some((d) => codigos.has(d.disposicion.codigo))).map(citar);

    // Servicios: por el tratamiento principal de cada declaración autorizada y activa
    const grupos = new Map<string, { tratamiento: string; propio: boolean; residuos: string[]; codigo: string }>();
    for (const d of decls) {
      const x = (d.disposiciones.find((y) => y.principal) ?? d.disposiciones[0])?.disposicion;
      const k = x?.codigo ?? 'SERVICIOS';
      const g = grupos.get(k) ?? { tratamiento: x?.nombre ?? 'Otros servicios', propio: x ? x.propia : true, residuos: [], codigo: k };
      g.residuos.push(d.nombre);
      grupos.set(k, g);
    }
    const general = !decls.length;
    const propiosVigentes = [...new Map(permisos.flatMap((p) => p.disposiciones.map((d) => d.disposicion)).filter((d) => d.propia && d.activo && d.codigo !== 'TRA').map((d) => [d.codigo, d])).values()];
    const servicios = general
      // Sin servicios autorizados todavía: lo que Terra Viva le ofrece (lo que amparan sus permisos vigentes y lo de los aliados)
      ? [...propiosVigentes.map((d) => ({ tratamiento: d.nombre, propio: true, residuos: [], mas: 0 })),
        { tratamiento: 'Tratamiento y disposición final de residuos peligrosos y especiales', propio: false, residuos: [], mas: 0 }]
      : [...grupos.values()].sort((a, b) => Number(b.propio) - Number(a.propio) || a.tratamiento.localeCompare(b.tratamiento, 'es'))
        .map((g) => ({ tratamiento: g.tratamiento, propio: g.propio, residuos: g.residuos.slice(0, MAX_RESIDUOS), mas: Math.max(0, g.residuos.length - MAX_RESIDUOS) }));
    const codigosPropios = new Set(general ? propiosVigentes.map((d) => d.codigo) : [...grupos.values()].filter((g) => g.propio).map((g) => g.codigo));
    const hayPeligrosos = decls.some((d) => d.esPeligroso);
    const hoyIso = iso(hoy);
    return {
      version: 1, fecha: hoyIso,
      emisor: { razonSocial: empresa.razonSocial, nit: empresa.nit, contacto: conf.contacto },
      cliente: { razonSocial: cliente.razonSocial, nit: cliente.dv ? `${cliente.nit}-${cliente.dv}` : cliente.nit },
      desde: primero ? iso(primero.fechaServicio) : null,
      alDia: !vencidas.length,
      servicios, general, hayPeligrosos,
      permisos: ampara(codigosPropios),
      transporte: hayPeligrosos || general ? ampara(new Set(['TRA'])) : [],
      firma: {
        nombre: conf.representanteLegal?.trim() || null, cargo: conf.certificadoComercial?.cargo?.trim() || 'Gerente General',
        correo: conf.certificadoComercial?.correo?.trim() || null, ciudad: conf.ciudadFirma?.trim() || null,
      },
      // Solo los sellos con número y vigentes (como en el certificado de disposición)
      certificaciones: (conf.certificaciones ?? []).filter((x) => x.numero?.trim() && (!x.vence || x.vence >= hoyIso)).map(({ norma, numero, entidad }) => ({ norma, numero, entidad })),
    };
  }

  /** Enlace firmado de 5 minutos al PDF guardado (en R2 lo firma el almacenamiento). */
  enlace(r: { numero: string; pdfUrl: string; empresaId: string }) {
    return this.archivos.enlace(r.pdfUrl, r.empresaId, { nombre: `certificado-comercial-${r.numero}.pdf` });
  }

  /** Los certificados comerciales que se le han expedido al cliente (el más reciente primero). */
  async historial(a: Actor, clienteId: string) {
    if (!(await this.db.cliente.findFirst({ where: { id: clienteId, empresaId: a.empresaId }, select: { id: true } }))) throw new NotFoundException({ mensaje: 'Cliente no encontrado.' });
    const xs = await this.db.certificadoComercial.findMany({ where: { clienteId, empresaId: a.empresaId }, orderBy: { creadoEn: 'desc' }, take: 50,
      select: { id: true, numero: true, fecha: true, creadoEn: true, contenido: true, solicitadoPor: { select: { nombre: true, clienteId: true } } } });
    return xs.map(({ contenido, solicitadoPor, ...x }) => ({ ...x, alDia: (contenido as { alDia?: boolean }).alDia ?? true,
      solicitadoPor: solicitadoPor?.nombre ?? null, desdePortal: !!solicitadoPor?.clienteId }));
  }

  /** Enlace a un certificado ya expedido (oficina). */
  async enlaceDe(a: Actor, id: string) {
    const r = await this.db.certificadoComercial.findFirst({ where: { id, empresaId: a.empresaId } });
    if (!r) throw new NotFoundException({ mensaje: 'Certificado no encontrado.' });
    return this.enlace(r);
  }
}

@Controller('clientes')
class CertificadoComercialController {
  constructor(private readonly s: CertificadoComercialService) {}
  /** Expide (o entrega el de hoy) y devuelve su enlace. */
  @Permiso('clientes.editar') @Post(':id/certificado-comercial') @HttpCode(200)
  async expedir(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    if (a.clienteId) throw new BadRequestException({ mensaje: 'Pídalo desde el portal.' });
    const r = await this.s.expedir(a.empresaId, id, a, 'OFICINA');
    const contenido = r.contenido as unknown as ContenidoCertificadoComercial;
    return { id: r.id, numero: r.numero, fecha: r.fecha, alDia: contenido.alDia, ...(await this.s.enlace(r)) };
  }
  @Get(':id/certificados-comerciales') historial(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.historial(a, id); }
  @Post('certificados-comerciales/:id/enlace') @HttpCode(200) enlace(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.enlaceDe(a, id); }
}

@Module({ controllers: [CertificadoComercialController], providers: [CertificadoComercialService], exports: [CertificadoComercialService] })
export class CertificadoComercialModule {}
