// Datos de la empresa que usan los documentos: firma y certificaciones del certificado, nota de calibración de la
// báscula, numeración (TV / PSAP) y textos legales del certificado con versión (documentos reales §2 y §3).
import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, Patch, Post, Put } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { Auditoria } from '../common/servicios';
import { ActorActual, Permiso, Zod, fechaColombia, type Actor } from '../common/http';

const Configuracion = z.object({
  ciudadFirma: z.string().trim().max(80).optional(),
  representanteLegal: z.string().trim().max(150).optional(),
  cargoFirmante: z.string().trim().max(80).optional(),
  certificaciones: z.array(z.object({ norma: z.string().trim().min(2).max(60), numero: z.string().trim().max(60) })).max(10).optional(),
  notaBascula: z.string().trim().max(300).optional(),
});
const DOCUMENTOS = ['MANIFIESTO', 'ACTA', 'INSPECCION'] as const;
const Consecutivo = z.object({
  prefijo: z.string().trim().max(10).regex(/^[A-Za-z0-9-]*$/, 'Solo letras, números y guion.').optional(),
  digitos: z.number().int().min(0).max(8).optional(),
  reinicioAnual: z.boolean().optional(),
  ultimo: z.number().int().min(0).max(99_999_999).optional(),
});
const Texto = z.object({
  titulo: z.string().trim().min(3).max(150), texto: z.string().trim().min(20, 'El texto es muy corto.').max(6000),
  disposiciones: z.array(z.string().trim().toUpperCase().max(20)).max(30).default([]), // vacío = va en todos los certificados
  orden: z.number().int().min(0).max(100).default(0), revisado: z.boolean().default(false),
});
const TextoNuevo = Texto.extend({ codigo: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,30}$/, 'Código: letras, números, guion o guion bajo.') });
/** Valores por defecto de cada consecutivo (los mismos de la base, fn_siguiente_consecutivo). */
const DEFECTO: Record<(typeof DOCUMENTOS)[number], { prefijo: string; digitos: number; reinicioAnual: boolean }> = {
  MANIFIESTO: { prefijo: 'TV', digitos: 4, reinicioAnual: false }, ACTA: { prefijo: 'PSAP', digitos: 0, reinicioAnual: true }, INSPECCION: { prefijo: 'INS-', digitos: 5, reinicioAnual: true },
};
/** Cómo se verá el próximo número (igual que fn_siguiente_consecutivo). */
const muestra = (c: { prefijo: string; digitos: number; reinicioAnual: boolean; anio: number; ultimo: number }) => {
  const anio = fechaColombia().getUTCFullYear();
  const n = String(c.reinicioAnual && c.anio !== anio ? 1 : c.ultimo + 1);
  return `${c.prefijo}${c.reinicioAnual ? `${anio}-` : ''}${c.digitos > n.length ? n.padStart(c.digitos, '0') : n}`;
};

@Injectable()
class EmpresaService {
  constructor(private readonly db: PrismaService, private readonly audit: Auditoria) {}

  async obtener(a: Actor) {
    const e = await this.db.empresa.findUniqueOrThrow({ where: { id: a.empresaId }, select: { razonSocial: true, nit: true, configuracion: true } });
    const filas = await this.db.consecutivo.findMany({ where: { empresaId: a.empresaId } });
    const anio = fechaColombia().getUTCFullYear();
    const consecutivos = DOCUMENTOS.map((documento) => {
      const f = filas.find((x) => x.documento === documento);
      const c = f ? { prefijo: f.prefijo, digitos: f.digitos, reinicioAnual: f.reinicioAnual, anio: f.anio, ultimo: f.ultimo } : { ...DEFECTO[documento], anio, ultimo: 0 };
      return { documento, ...c, siguiente: muestra(c) };
    });
    return { ...e, consecutivos };
  }

  async configurar(a: Actor, b: z.infer<typeof Configuracion>) {
    const e = await this.db.empresa.findUniqueOrThrow({ where: { id: a.empresaId } });
    const nueva = { ...((e.configuracion ?? {}) as Record<string, unknown>), ...b };
    await this.db.empresa.update({ where: { id: a.empresaId }, data: { configuracion: nueva as Prisma.InputJsonValue } });
    await this.audit.registrar(a, 'empresa', a.empresaId, 'CONFIGURAR', e.configuracion, nueva);
    return this.obtener(a);
  }

  /** Numeración. «Último» solo sube: bajarlo repetiría números ya emitidos. Para continuar la serie del sistema anterior
   *  (p. ej. TV1830) se pone el último número usado allá. */
  async consecutivo(a: Actor, documento: string, b: z.infer<typeof Consecutivo>) {
    if (!(DOCUMENTOS as readonly string[]).includes(documento)) throw new NotFoundException({ mensaje: 'Documento no válido.' });
    const doc = documento as (typeof DOCUMENTOS)[number];
    const actual = await this.db.consecutivo.findUnique({ where: { empresaId_documento: { empresaId: a.empresaId, documento: doc } } });
    if (b.ultimo !== undefined && actual && b.ultimo < actual.ultimo) throw new BadRequestException({ mensaje: `No se puede bajar el último número (${actual.ultimo}): se repetirían números ya emitidos.` });
    const anio = fechaColombia().getUTCFullYear();
    const datos = { prefijo: b.prefijo, digitos: b.digitos, reinicioAnual: b.reinicioAnual, ultimo: b.ultimo };
    if (actual) await this.db.consecutivo.update({ where: { empresaId_documento: { empresaId: a.empresaId, documento: doc } }, data: datos });
    else await this.db.consecutivo.create({ data: { empresaId: a.empresaId, documento: doc, anio, ...DEFECTO[doc], ...Object.fromEntries(Object.entries(datos).filter(([, v]) => v !== undefined)) } });
    await this.audit.registrar(a, 'consecutivo', doc, 'CONFIGURAR', actual, b);
    return this.obtener(a);
  }

  async textos(a: Actor) {
    const todos = await this.db.textoLegal.findMany({ where: { empresaId: a.empresaId }, orderBy: [{ codigo: 'asc' }, { version: 'desc' }], include: { creadoPor: { select: { nombre: true } } } });
    const porCodigo = new Map<string, typeof todos>();
    for (const t of todos) porCodigo.set(t.codigo, [...(porCodigo.get(t.codigo) ?? []), t]);
    return [...porCodigo.values()].map((versiones) => {
      const vigente = versiones.find((v) => v.activo) ?? null;
      return { codigo: versiones[0].codigo, vigente, historial: versiones.map(({ id, version, vigenteDesde, activo, revisado, creadoPor, createdAt }) => ({ id, version, vigenteDesde, activo, revisado, creadoPor, createdAt })) };
    }).sort((x, y) => (x.vigente?.orden ?? 999) - (y.vigente?.orden ?? 999) || x.codigo.localeCompare(y.codigo));
  }

  private async validarDisposiciones(empresaId: string, codigos: string[]) {
    if (!codigos.length) return;
    const n = await this.db.disposicion.count({ where: { empresaId, codigo: { in: codigos } } });
    if (n !== new Set(codigos).size) throw new BadRequestException({ mensaje: 'Alguna disposición no existe en el catálogo.' });
  }

  async crearTexto(a: Actor, b: z.infer<typeof TextoNuevo>) {
    await this.validarDisposiciones(a.empresaId, b.disposiciones);
    if (await this.db.textoLegal.findFirst({ where: { empresaId: a.empresaId, codigo: b.codigo } })) throw new BadRequestException({ mensaje: `Ya existe el texto ${b.codigo}: edítelo para crear una versión nueva.` });
    const t = await this.db.textoLegal.create({ data: { ...b, empresaId: a.empresaId, version: 1, vigenteDesde: fechaColombia(), creadoPorId: a.id } });
    await this.audit.registrar(a, 'texto_legal', t.id, 'CREAR', undefined, { codigo: t.codigo, version: 1 });
    return t;
  }

  /** Editar = nueva versión. La anterior se conserva (los certificados emitidos guardan la versión que usaron). */
  async versionTexto(a: Actor, codigo: string, b: z.infer<typeof Texto>) {
    await this.validarDisposiciones(a.empresaId, b.disposiciones);
    return this.db.$transaction(async (tx) => {
      const versiones = await tx.textoLegal.findMany({ where: { empresaId: a.empresaId, codigo }, orderBy: { version: 'desc' } });
      if (!versiones.length) throw new NotFoundException({ mensaje: 'Texto no encontrado.' });
      await tx.textoLegal.updateMany({ where: { empresaId: a.empresaId, codigo, activo: true }, data: { activo: false } });
      const t = await tx.textoLegal.create({ data: { ...b, codigo, empresaId: a.empresaId, version: versiones[0].version + 1, vigenteDesde: fechaColombia(), creadoPorId: a.id } });
      await this.audit.registrar(a, 'texto_legal', t.id, 'NUEVA_VERSION', { version: versiones[0].version }, { version: t.version }, tx);
      return t;
    });
  }

  /** Retirar: deja de salir en los certificados nuevos; el historial se conserva. */
  async retirarTexto(a: Actor, codigo: string) {
    const r = await this.db.textoLegal.updateMany({ where: { empresaId: a.empresaId, codigo, activo: true }, data: { activo: false } });
    if (!r.count) throw new NotFoundException({ mensaje: 'No hay una versión vigente de ese texto.' });
    await this.audit.registrar(a, 'texto_legal', codigo, 'RETIRAR');
    return { ok: true };
  }
}

@Controller('empresa')
class EmpresaController {
  constructor(private readonly s: EmpresaService) {}
  @Get() obtener(@ActorActual() a: Actor) { return this.s.obtener(a); }
  @Permiso('configuracion.editar') @Patch('configuracion') configurar(@ActorActual() a: Actor, @Body(new Zod(Configuracion)) b: z.infer<typeof Configuracion>) { return this.s.configurar(a, b); }
  @Permiso('configuracion.editar') @Patch('consecutivos/:documento') consecutivo(@ActorActual() a: Actor, @Param('documento') d: string, @Body(new Zod(Consecutivo)) b: z.infer<typeof Consecutivo>) { return this.s.consecutivo(a, d, b); }
  @Get('textos-legales') textos(@ActorActual() a: Actor) { return this.s.textos(a); }
  @Permiso('configuracion.editar') @Post('textos-legales') crearTexto(@ActorActual() a: Actor, @Body(new Zod(TextoNuevo)) b: z.infer<typeof TextoNuevo>) { return this.s.crearTexto(a, b); }
  @Permiso('configuracion.editar') @Put('textos-legales/:codigo') version(@ActorActual() a: Actor, @Param('codigo') c: string, @Body(new Zod(Texto)) b: z.infer<typeof Texto>) { return this.s.versionTexto(a, c.toUpperCase(), b); }
  @Permiso('configuracion.editar') @Patch('textos-legales/:codigo/retirar') retirar(@ActorActual() a: Actor, @Param('codigo') c: string) { return this.s.retirarTexto(a, c.toUpperCase()); }
}

@Module({ controllers: [EmpresaController], providers: [EmpresaService] })
export class EmpresaModule {}
