// Roles y permisos configurables (20-11-2026, pedido de la gerencia, como los roles de Grinclic). Solo quien administra
// la configuración (permiso «configuracion.editar»). Cada rol tiene un acceso al sistema (oficina, campo o portal de
// clientes) que no cambia, una descripción, un estado y las funciones que se le otorgan, tomadas del catálogo
// MODULOS_PERMISOS (@terraviva/shared): cada una la exige de verdad el servidor. Los predeterminados traen sus funciones
// marcadas, se ajustan y se restauran; los nuevos se crean desde cero o copiando otro. La base vuelve a exigir que las
// funciones correspondan al acceso, que el Administrador conserve el acceso total y que no se inactive un rol en uso.
import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ACCESOS_ROL, MODULOS_PERMISOS, ROLES_PREDETERMINADOS, codigosDeAcceso, rolPredeterminado, type AccesoRol } from '@terraviva/shared';
import { PrismaService } from '../prisma/prisma.service';
import { Auditoria } from '../common/servicios';
import { ActorActual, Permiso, Zod, type Actor } from '../common/http';

type Tx = Prisma.TransactionClient;
const nombre = z.string().trim().min(3, 'El nombre lleva al menos 3 letras.').max(60, 'Máximo 60 letras.');
const descripcion = z.string().trim().max(400).transform((x) => x || null).nullish();
const permisos = z.array(z.string().trim().min(1).max(60)).max(200);
const Crear = z.object({ nombre, descripcion, acceso: z.enum(['OFICINA', 'CAMPO', 'CLIENTE']), permisos: permisos.default([]) });
const Editar = z.object({ nombre: nombre.optional(), descripcion, activo: z.boolean().optional(), permisos: permisos.optional() });

@Injectable()
export class RolesService {
  constructor(private readonly db: PrismaService, private readonly audit: Auditoria) {}

  /** Todas las funciones que se pueden otorgar, por módulo y acceso, y las de los roles predeterminados. */
  catalogo() {
    return { accesos: ACCESOS_ROL, modulos: MODULOS_PERMISOS, predeterminados: ROLES_PREDETERMINADOS.map((r) => ({ clave: r.clave, nombre: r.nombre, permisos: r.permisos })) };
  }

  /** Roles de la empresa con sus funciones y cuántas personas los usan (las del portal, en los roles del portal). */
  async listar(a: Actor) {
    const [roles, usos] = await Promise.all([
      this.db.rol.findMany({ where: { empresaId: a.empresaId }, orderBy: [{ acceso: 'asc' }, { predeterminado: 'desc' }, { nombre: 'asc' }],
        include: { permisos: { select: { permiso: { select: { codigo: true } } } }, _count: { select: { usuarios: { where: { activo: true } } } } } }),
      this.db.usuario.groupBy({ by: ['rolId'], where: { empresaId: a.empresaId }, _count: { _all: true } }),
    ]);
    return roles.map(({ permisos: p, _count, empresaId: _e, ...r }) => ({
      ...r, permisos: p.map((x) => x.permiso.codigo), usuariosActivos: _count.usuarios, usuarios: usos.find((u) => u.rolId === r.id)?._count._all ?? 0,
    }));
  }

  private async rolDe(db: Tx | PrismaService, a: Actor, id: string) {
    const r = await db.rol.findFirst({ where: { id, empresaId: a.empresaId }, include: { permisos: { select: { permiso: { select: { codigo: true } } } } } });
    if (!r) throw new NotFoundException({ mensaje: 'Rol no encontrado.' });
    return { ...r, codigos: r.permisos.map((p) => p.permiso.codigo) };
  }

  /** Solo funciones del acceso del rol (el portal de clientes y la empresa tienen funciones distintas), sin repetir. */
  private validarPermisos(acceso: AccesoRol, codigos: string[]) {
    const validos = codigosDeAcceso(acceso);
    const ajenos = codigos.filter((c) => !validos.includes(c));
    if (ajenos.length) throw new BadRequestException({ mensaje: `Estas funciones no son de un rol de «${ACCESOS_ROL[acceso].nombre}»: ${ajenos.join(', ')}.` });
    return [...new Set(codigos)];
  }

  /** Deja las funciones del rol en exactamente esas (agrega las nuevas y quita las demás). */
  private async fijarPermisos(tx: Tx, rolId: string, actuales: string[], nuevos: string[]) {
    const quitar = actuales.filter((c) => !nuevos.includes(c)), agregar = nuevos.filter((c) => !actuales.includes(c));
    if (quitar.length) await tx.rolPermiso.deleteMany({ where: { rolId, permiso: { codigo: { in: quitar } } } });
    if (agregar.length) {
      const ps = await tx.permiso.findMany({ where: { codigo: { in: agregar } }, select: { id: true } });
      await tx.rolPermiso.createMany({ data: ps.map((p) => ({ rolId, permisoId: p.id })) });
    }
    return { agregados: agregar, quitados: quitar };
  }

  /** Siempre queda alguien activo de la empresa que puede administrar usuarios y roles (si no, nadie podría arreglarlo). */
  private async exigirAdministrador(tx: Tx, a: Actor) {
    const n = await tx.usuario.count({ where: { empresaId: a.empresaId, clienteId: null, activo: true,
      rol: { activo: true, permisos: { some: { permiso: { codigo: { in: ['*', 'configuracion.editar'] } } } } } } });
    if (!n) throw new BadRequestException({ mensaje: 'Así nadie activo podría administrar usuarios y roles: deje esa función en algún rol con personas activas.' });
  }

  async crear(a: Actor, b: z.infer<typeof Crear>) {
    const codigos = this.validarPermisos(b.acceso, b.permisos);
    if (await this.db.rol.findFirst({ where: { empresaId: a.empresaId, nombre: { equals: b.nombre, mode: 'insensitive' } }, select: { id: true } }))
      throw new BadRequestException({ mensaje: `Ya existe un rol llamado «${b.nombre}».` });
    return this.db.$transaction(async (tx) => {
      const r = await tx.rol.create({ data: { empresaId: a.empresaId, nombre: b.nombre, descripcion: b.descripcion ?? null, acceso: b.acceso } });
      await this.fijarPermisos(tx, r.id, [], codigos);
      await this.audit.registrar(a, 'rol', r.id, 'CREAR', undefined, { nombre: r.nombre, acceso: r.acceso, permisos: codigos }, tx);
      return { id: r.id, nombre: r.nombre };
    });
  }

  /** Corrige el nombre, la descripción, el estado o las funciones. El acceso no cambia; el Administrador conserva todo. */
  async editar(a: Actor, id: string, b: z.infer<typeof Editar>) {
    return this.db.$transaction(async (tx) => {
      const r = await this.rolDe(tx, a, id);
      if (r.clave === 'ADMINISTRADOR' && b.permisos && !(b.permisos.length === 1 && b.permisos[0] === '*'))
        throw new BadRequestException({ mensaje: 'El rol Administrador conserva el acceso total: cree otro rol si necesita uno con menos funciones.' });
      if (b.nombre && b.nombre.toLowerCase() !== r.nombre.toLowerCase()
        && await tx.rol.findFirst({ where: { empresaId: a.empresaId, id: { not: id }, nombre: { equals: b.nombre, mode: 'insensitive' } }, select: { id: true } }))
        throw new BadRequestException({ mensaje: `Ya existe un rol llamado «${b.nombre}».` });
      const codigos = b.permisos ? this.validarPermisos(r.acceso, b.permisos) : null;
      // La base no deja inactivar un rol con personas activas ni el del Administrador (aviso claro antes)
      if (b.activo === false && r.activo) {
        if (r.clave === 'ADMINISTRADOR') throw new BadRequestException({ mensaje: 'El rol Administrador no se inactiva.' });
        const enUso = await tx.usuario.count({ where: { rolId: id, activo: true } });
        if (enUso) throw new BadRequestException({ mensaje: `Lo usan ${enUso === 1 ? 'una persona activa' : `${enUso} personas activas`}: páselas a otro rol antes de inactivarlo.` });
      }
      await tx.rol.update({ where: { id }, data: { nombre: b.nombre, descripcion: b.descripcion === undefined ? undefined : b.descripcion, activo: b.activo } });
      const cambio = codigos ? await this.fijarPermisos(tx, id, r.codigos, codigos) : { agregados: [], quitados: [] };
      if (r.acceso !== 'CLIENTE') await this.exigirAdministrador(tx, a);
      await this.audit.registrar(a, 'rol', id, b.activo === false && r.activo ? 'INACTIVAR' : b.activo && !r.activo ? 'ACTIVAR' : 'EDITAR',
        { nombre: r.nombre, activo: r.activo, ...(cambio.quitados.length ? { quitados: cambio.quitados } : {}) },
        { ...(b.nombre ? { nombre: b.nombre } : {}), ...(b.activo !== undefined ? { activo: b.activo } : {}), ...(cambio.agregados.length ? { agregados: cambio.agregados } : {}),
          ...(cambio.quitados.length ? { quitadas: cambio.quitados.length } : {}) }, tx);
      return { id, ...cambio };
    });
  }

  /** Un rol predeterminado vuelve a sus funciones de fábrica (las que trae Terry-App). */
  async restaurar(a: Actor, id: string) {
    return this.db.$transaction(async (tx) => {
      const r = await this.rolDe(tx, a, id);
      const def = rolPredeterminado(r.clave);
      if (!r.predeterminado || !def) throw new BadRequestException({ mensaje: 'Solo los roles predeterminados se restauran: este lo creó su empresa.' });
      const cambio = await this.fijarPermisos(tx, id, r.codigos, def.permisos);
      if (r.acceso !== 'CLIENTE') await this.exigirAdministrador(tx, a);
      await this.audit.registrar(a, 'rol', id, 'RESTAURAR', { quitados: cambio.quitados }, { agregados: cambio.agregados }, tx);
      return { id, ...cambio };
    });
  }

  /** Borra un rol que creó la empresa y que nadie ha usado nunca (si alguien lo usó, se inactiva). */
  async eliminar(a: Actor, id: string) {
    const r = await this.rolDe(this.db, a, id);
    if (r.predeterminado) throw new BadRequestException({ mensaje: 'Los roles predeterminados no se borran: se pueden inactivar si nadie los usa.' });
    if (await this.db.usuario.count({ where: { rolId: id } })) throw new BadRequestException({ mensaje: 'Alguien tiene o tuvo este rol: inactívelo en lugar de borrarlo.' });
    await this.db.$transaction(async (tx) => {
      await tx.rol.delete({ where: { id } });
      await this.audit.registrar(a, 'rol', id, 'ELIMINAR', { nombre: r.nombre, acceso: r.acceso, permisos: r.codigos }, undefined, tx);
    });
    return { id };
  }
}

/** Ajustes › Roles: solo quien administra la configuración. */
@Controller('roles')
export class RolesController {
  constructor(private readonly s: RolesService) {}
  @Permiso('configuracion.editar') @Get() listar(@ActorActual() a: Actor) { return this.s.listar(a); }
  @Permiso('configuracion.editar') @Get('catalogo') catalogo() { return this.s.catalogo(); }
  @Permiso('configuracion.editar') @Post() crear(@ActorActual() a: Actor, @Body(new Zod(Crear)) b: z.infer<typeof Crear>) { return this.s.crear(a, b); }
  @Permiso('configuracion.editar') @Patch(':id') editar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Editar)) b: z.infer<typeof Editar>) { return this.s.editar(a, id, b); }
  @Permiso('configuracion.editar') @Post(':id/restaurar') @HttpCode(200) restaurar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.restaurar(a, id); }
  @Permiso('configuracion.editar') @Delete(':id') eliminar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.eliminar(a, id); }
}
