// Usuarios y roles (fase 1c). Solo administración (permiso «configuracion.editar»; el administrador lo tiene por «*»).
// - Nadie escribe ni envía contraseñas: a un usuario nuevo le llega una invitación para crear la suya (72 horas).
// - Nada se borra: un usuario se inactiva y sus sesiones se cierran de inmediato.
// - Nadie se inactiva ni se cambia el rol a sí mismo, y siempre queda al menos un administrador activo.
import { BadRequestException, Body, Controller, Get, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { Auditoria } from '../common/servicios';
import { ActorActual, Permiso, Zod, paginar, type Actor } from '../common/http';
import { AuthModule } from '../auth/auth.module';
import { AuthService, hashClave } from '../auth/auth.service';
import { randomBytes } from 'node:crypto';

const textoOpc = (max: number) => z.string().trim().max(max).transform((x) => x || null).nullish();
const fechaOpc = z.union([z.literal('').transform(() => null), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha AAAA-MM-DD').transform((x) => new Date(`${x}T00:00:00Z`))]).nullish();
const Filtros = z.object({
  q: z.string().optional(), rolId: z.string().uuid().optional(), activo: z.enum(['true', 'false']).optional(),
  pagina: z.coerce.number().optional(), porPagina: z.coerce.number().optional(),
});
const Datos = z.object({
  nombre: z.string().trim().min(3).max(150), documento: z.string().trim().regex(/^[0-9A-Za-z.-]{4,20}$/, 'Documento de 4 a 20 caracteres'), telefono: textoOpc(20),
  rolId: z.string().uuid(), esConductor: z.boolean().default(false), esAuxiliar: z.boolean().default(false),
  licenciaCat: z.union([z.literal('').transform(() => null), z.enum(['A1', 'A2', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'])]).nullish(), licenciaVence: fechaOpc, cursoMpVence: fechaOpc,
});
const Crear = Datos.extend({ email: z.string().trim().toLowerCase().email('Correo inválido').max(150) });
const Editar = Datos.partial().extend({ activo: z.boolean().optional(), desbloquear: z.literal(true).optional() });
/** Lo que se devuelve de un usuario: nunca la contraseña ni los datos de sesión. */
const seguro = {
  id: true, nombre: true, documento: true, email: true, telefono: true, activo: true, esConductor: true, esAuxiliar: true, licenciaCat: true, licenciaVence: true,
  cursoMpVence: true, ultimoLogin: true, createdAt: true, bloqueadoHasta: true, datosAceptadosEn: true, rol: { select: { id: true, nombre: true } },
} satisfies Prisma.UsuarioSelect;
const esAdministrador = (permisos: string[]) => permisos.includes('*') || permisos.includes('configuracion.editar');

@Injectable()
class UsuariosService {
  constructor(private readonly db: PrismaService, private readonly audit: Auditoria, private readonly auth: AuthService) {}

  async listar(a: Actor, f: z.infer<typeof Filtros>) {
    const { take, skip, pagina, porPagina } = paginar(f);
    const where: Prisma.UsuarioWhereInput = {
      empresaId: a.empresaId, rolId: f.rolId, activo: f.activo ? f.activo === 'true' : undefined,
      ...(f.q ? { OR: [{ nombre: { contains: f.q, mode: 'insensitive' } }, { email: { contains: f.q, mode: 'insensitive' } }, { documento: { contains: f.q } }] } : {}),
    };
    const [total, filas] = await this.db.$transaction([
      this.db.usuario.count({ where }),
      this.db.usuario.findMany({ where, take, skip, orderBy: [{ activo: 'desc' }, { nombre: 'asc' }], select: seguro }),
    ]);
    return { total, pagina, porPagina, filas: filas.map(({ bloqueadoHasta, ...u }) => ({ ...u, bloqueado: !!bloqueadoHasta && bloqueadoHasta > new Date() })) };
  }

  /** Roles de la empresa con sus permisos y cuántos usuarios activos tienen (matriz de permisos). */
  async roles(a: Actor) {
    const [roles, permisos] = await Promise.all([
      this.db.rol.findMany({ where: { empresaId: a.empresaId }, orderBy: { nombre: 'asc' }, include: { permisos: { include: { permiso: { select: { codigo: true } } } }, _count: { select: { usuarios: { where: { activo: true } } } } } }),
      this.db.permiso.findMany({ orderBy: { codigo: 'asc' }, select: { codigo: true, nombre: true } }),
    ]);
    return { permisos, roles: roles.map((r) => ({ id: r.id, nombre: r.nombre, usuariosActivos: r._count.usuarios, permisos: r.permisos.map((p) => p.permiso.codigo) })) };
  }

  private async rolDe(a: Actor, rolId: string) {
    const r = await this.db.rol.findFirst({ where: { id: rolId, empresaId: a.empresaId }, include: { permisos: { include: { permiso: { select: { codigo: true } } } } } });
    if (!r) throw new BadRequestException({ mensaje: 'Rol no válido.' });
    return { ...r, codigos: r.permisos.map((p) => p.permiso.codigo) };
  }

  /** Crea el usuario sin contraseña conocida y le envía la invitación para crear la suya. */
  async crear(a: Actor, b: z.infer<typeof Crear>) {
    await this.rolDe(a, b.rolId);
    if (await this.db.usuario.findUnique({ where: { email: b.email } })) throw new BadRequestException({ mensaje: `Ya existe un usuario con el correo ${b.email}.` });
    const u = await this.db.usuario.create({ data: { ...b, empresaId: a.empresaId, passwordHash: await hashClave(randomBytes(32).toString('base64url')) }, select: seguro });
    await this.audit.registrar(a, 'usuario', u.id, 'CREAR', undefined, { nombre: u.nombre, email: u.email, rol: u.rol.nombre });
    await this.auth.invitar(u.id);
    return u;
  }

  async editar(a: Actor, id: string, b: z.infer<typeof Editar>) {
    const { desbloquear, ...datos } = b;
    const u = await this.db.usuario.findFirst({ where: { id, empresaId: a.empresaId }, include: { rol: { include: { permisos: { include: { permiso: { select: { codigo: true } } } } } } } });
    if (!u) throw new NotFoundException({ mensaje: 'Usuario no encontrado.' });
    const cambiaRol = !!datos.rolId && datos.rolId !== u.rolId;
    if (id === a.id && (datos.activo === false || cambiaRol)) throw new BadRequestException({ mensaje: 'Nadie se inactiva ni se cambia el rol a sí mismo: pídaselo a otro administrador.' });
    const nuevoRol = cambiaRol ? await this.rolDe(a, datos.rolId!) : null;
    const eraAdmin = u.activo && esAdministrador(u.rol.permisos.map((p) => p.permiso.codigo));
    const dejaDeSerAdmin = eraAdmin && (datos.activo === false || (nuevoRol && !esAdministrador(nuevoRol.codigos)));
    if (dejaDeSerAdmin) {
      const otros = await this.db.usuario.count({ where: { empresaId: a.empresaId, activo: true, id: { not: id }, rol: { permisos: { some: { permiso: { codigo: { in: ['*', 'configuracion.editar'] } } } } } } });
      if (!otros) throw new BadRequestException({ mensaje: 'Es el único administrador activo: primero dé ese rol a otra persona.' });
    }
    const r = await this.db.$transaction(async (tx) => {
      const x = await tx.usuario.update({ where: { id }, data: { ...datos, ...(desbloquear ? { intentosFallidos: 0, bloqueadoHasta: null } : {}) }, select: seguro });
      // Inactivo o con otro rol: sus sesiones se cierran (el rol nuevo rige desde el próximo ingreso)
      if ((datos.activo === false && u.activo) || cambiaRol) await tx.sesion.updateMany({ where: { usuarioId: id, revocadaEn: null }, data: { revocadaEn: new Date() } });
      return x;
    });
    const accion = datos.activo === false && u.activo ? 'INACTIVAR' : datos.activo && !u.activo ? 'ACTIVAR' : cambiaRol ? 'CAMBIAR_ROL' : desbloquear ? 'DESBLOQUEAR' : 'EDITAR';
    await this.audit.registrar(a, 'usuario', id, accion, { rol: u.rol.nombre, activo: u.activo }, { ...datos, ...(nuevoRol ? { rol: nuevoRol.nombre } : {}), ...(desbloquear ? { desbloqueado: true } : {}) });
    const { bloqueadoHasta, ...resto } = r;
    return { ...resto, bloqueado: !!bloqueadoHasta && bloqueadoHasta > new Date() };
  }

  async reenviar(a: Actor, id: string) {
    const u = await this.db.usuario.findFirst({ where: { id, empresaId: a.empresaId } });
    if (!u) throw new NotFoundException({ mensaje: 'Usuario no encontrado.' });
    if (!u.activo) throw new BadRequestException({ mensaje: 'El usuario está inactivo: actívelo antes de enviarle la invitación.' });
    await this.auth.invitar(u.id);
    await this.audit.registrar(a, 'usuario', id, 'INVITACION');
  }
}

@Controller()
class UsuariosController {
  constructor(private readonly s: UsuariosService) {}
  @Permiso('configuracion.editar') @Get('usuarios') listar(@ActorActual() a: Actor, @Query(new Zod(Filtros)) f: z.infer<typeof Filtros>) { return this.s.listar(a, f); }
  @Permiso('configuracion.editar') @Get('roles') roles(@ActorActual() a: Actor) { return this.s.roles(a); }
  @Permiso('configuracion.editar') @Post('usuarios') crear(@ActorActual() a: Actor, @Body(new Zod(Crear)) b: z.infer<typeof Crear>) { return this.s.crear(a, b); }
  @Permiso('configuracion.editar') @Patch('usuarios/:id') editar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Editar)) b: z.infer<typeof Editar>) { return this.s.editar(a, id, b); }
  @Permiso('configuracion.editar') @Post('usuarios/:id/invitacion') @HttpCode(204) reenviar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.reenviar(a, id); }
}

@Module({ imports: [AuthModule], controllers: [UsuariosController], providers: [UsuariosService] })
export class UsuariosModule {}
