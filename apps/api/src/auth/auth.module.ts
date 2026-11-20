import { Body, CanActivate, Controller, ExecutionContext, ForbiddenException, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Post, Req, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { InjectThrottlerOptions, InjectThrottlerStorage, Throttle, ThrottlerGuard, ThrottlerStorage, type ThrottlerModuleOptions } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { ActorActual, LimiteCredenciales, PERMISO, PERMITE_PORTAL, PUBLICO, Permiso, PermitePortal, Publico, SIN_2FA, SIN_DATOS, SOLO_PORTAL, SinAceptarDatos, SinDobleFactor, Zod, type Actor } from '../common/http';
import type { Config } from '../config';
import { AuthService } from './auth.service';

const Login = z.object({ email: z.string().email('Correo inválido'), clave: z.string().min(1, 'Escriba la contraseña') });
const Token = z.object({ refreshToken: z.string().min(10) });
const Recuperar = z.object({ email: z.string().email('Correo inválido') });
const Restablecer = z.object({
  token: z.string().min(20),
  clave: z.string().min(10, 'Mínimo 10 caracteres').regex(/[A-Za-z]/, 'Debe tener letras').regex(/\d/, 'Debe tener números'),
});
const meta = (req: Request) => ({ ip: req.ip, ua: req.headers['user-agent'] });
const AceptarDatos = z.object({ version: z.string().min(1).max(20) });
const Codigo = z.object({ codigo: z.string().trim().min(6, 'Escriba el código').max(12) });
const Verificar2fa = Codigo.extend({ desafio: z.string().min(20).max(2000) });
const PasePortal = z.object({ pase: z.string().min(40).max(4000) });

@Controller('auth')
class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Publico() @LimiteCredenciales(10) @Post('login') @HttpCode(200)
  login(@Body(new Zod(Login)) b: z.infer<typeof Login>, @Req() req: Request) { return this.auth.login(b.email, b.clave, meta(req)); }

  /** Entrada única: pase firmado del portal Terry-App (docs/ECOSISTEMA.md). */
  @Publico() @LimiteCredenciales(10) @Post('portal') @HttpCode(200)
  portal(@Body(new Zod(PasePortal)) b: z.infer<typeof PasePortal>, @Req() req: Request) { return this.auth.ingresarConPase(b.pase, meta(req)); }

  // Renovar no lleva correo: cuenta por IP. Holgado porque en una oficina todos renuevan desde la misma IP.
  @Publico() @Throttle({ default: { limit: 120, ttl: 60_000 } }) @Post('renovar') @HttpCode(200)
  renovar(@Body(new Zod(Token)) b: z.infer<typeof Token>, @Req() req: Request) { return this.auth.renovar(b.refreshToken, meta(req)); }

  @Publico() @Post('salir') @HttpCode(204)
  salir(@Body(new Zod(Token)) b: z.infer<typeof Token>) { return this.auth.salir(b.refreshToken); }

  @SinAceptarDatos() @SinDobleFactor() @PermitePortal() @Get('yo') yo(@ActorActual() a: Actor) { return this.auth.yo(a); }

  /** Ley 1581: aceptar la política de tratamiento de datos personales (primer ingreso o versión nueva). */
  @SinAceptarDatos() @SinDobleFactor() @PermitePortal() @Post('aceptar-datos') @HttpCode(200)
  aceptarDatos(@ActorActual() a: Actor, @Body(new Zod(AceptarDatos)) b: z.infer<typeof AceptarDatos>, @Req() req: Request) { return this.auth.aceptarDatos(a, b.version, meta(req)); }

  @SinAceptarDatos() @SinDobleFactor() @PermitePortal() @Post('salir-todos') @HttpCode(204)
  salirTodos(@ActorActual() a: Actor) { return this.auth.salirTodos(a); }

  // Verificación en dos pasos (TOTP): segundo paso del ingreso, configurarla, códigos de respaldo y desactivarla
  @Publico() @LimiteCredenciales(10) @Post('2fa/verificar') @HttpCode(200)
  verificar2fa(@Body(new Zod(Verificar2fa)) b: z.infer<typeof Verificar2fa>, @Req() req: Request) { return this.auth.verificar2fa(b.desafio, b.codigo, meta(req)); }
  @SinDobleFactor() @PermitePortal() @Post('2fa/iniciar') @HttpCode(200) iniciar2fa(@ActorActual() a: Actor) { return this.auth.iniciar2fa(a); }
  @SinDobleFactor() @PermitePortal() @Post('2fa/confirmar') @HttpCode(200)
  confirmar2fa(@ActorActual() a: Actor, @Body(new Zod(Codigo)) b: z.infer<typeof Codigo>, @Req() req: Request) { return this.auth.confirmar2fa(a, b.codigo, meta(req)); }
  @PermitePortal() @Post('2fa/codigos') @HttpCode(200) codigos2fa(@ActorActual() a: Actor, @Body(new Zod(Codigo)) b: z.infer<typeof Codigo>) { return this.auth.codigos2fa(a, b.codigo); }
  @PermitePortal() @Post('2fa/desactivar') @HttpCode(204) desactivar2fa(@ActorActual() a: Actor, @Body(new Zod(Codigo)) b: z.infer<typeof Codigo>) { return this.auth.desactivar2fa(a, b.codigo); }

  /** Antes de entrar: si hay correo configurado (si no, el enlace de acceso lo entrega el administrador). */
  @Publico() @Get('opciones') opciones() { return this.auth.opciones(); }

  @Publico() @LimiteCredenciales(5) @Post('recuperar') @HttpCode(202)
  async recuperar(@Body(new Zod(Recuperar)) b: z.infer<typeof Recuperar>) {
    await this.auth.solicitarRecuperacion(b.email);
    return { mensaje: 'Si el correo está registrado, recibirá un enlace para crear una nueva contraseña.' };
  }

  @Publico() @LimiteCredenciales(5) @Post('restablecer') @HttpCode(200)
  async restablecer(@Body(new Zod(Restablecer)) b: z.infer<typeof Restablecer>) { await this.auth.restablecer(b.token, b.clave); return { mensaje: 'Contraseña actualizada. Ya puede ingresar.' }; }
}

/** La administración restablece la verificación en dos pasos de un usuario (celular perdido y sin códigos de respaldo). */
@Controller('usuarios')
class DobleFactorUsuariosController {
  constructor(private readonly auth: AuthService) {}
  @Permiso('configuracion.editar') @Post(':id/2fa/restablecer') @HttpCode(200)
  restablecer(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.auth.restablecer2fa(a, id); }
}

/** Guard global: toda ruta exige token salvo las marcadas @Publico(). Además verifica @Permiso(). */
@Injectable()
class GuardAutenticacion implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly jwt: JwtService, private readonly auth: AuthService) {}
  async canActivate(ctx: ExecutionContext) {
    const objetivo = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLICO, objetivo)) return true;
    const req = ctx.switchToHttp().getRequest<Request & { actor?: Actor }>();
    const [tipo, token] = (req.headers.authorization ?? '').split(' ');
    if (tipo !== 'Bearer' || !token) throw new UnauthorizedException({ mensaje: 'Debe iniciar sesión.' });
    let p: { sub: string; emp: string; rol: string; prm: string[]; nom: string; sid: string; dat?: boolean; cli?: string; pp?: 'ADMIN' | 'CONSULTA'; c2f?: boolean };
    try { p = await this.jwt.verifyAsync(token); } catch { throw new UnauthorizedException({ mensaje: 'La sesión venció. Renueve el token.' }); }
    if (!(await this.auth.sesionActiva(p.sid))) throw new UnauthorizedException({ mensaje: 'La sesión fue cerrada. Ingrese de nuevo.' });
    req.actor = { id: p.sub, empresaId: p.emp, rol: p.rol, permisos: p.prm, nombre: p.nom, sesionId: p.sid, ...(p.cli ? { clienteId: p.cli, perfilPortal: p.pp ?? 'CONSULTA' } : {}) };
    // Portal de clientes (requisitos de producción §2): el usuario de un cliente solo usa las rutas hechas para él.
    // Todo lo demás (incluidos los listados de oficina sin permiso propio) le responde 403.
    const soloPortal = this.reflector.getAllAndOverride<boolean>(SOLO_PORTAL, objetivo);
    if (p.cli && !soloPortal && !this.reflector.getAllAndOverride<boolean>(PERMITE_PORTAL, objetivo))
      throw new ForbiddenException({ mensaje: 'Esta sección no está disponible en el portal de clientes.', codigo: 'PORTAL' });
    if (soloPortal && !p.cli) throw new ForbiddenException({ mensaje: 'Esta sección es solo para los usuarios del portal de clientes.' });
    if (p.dat !== true && !this.reflector.getAllAndOverride<boolean>(SIN_DATOS, objetivo))
      throw new ForbiddenException({ mensaje: 'Para continuar debe aceptar la política de tratamiento de datos personales.', codigo: 'ACEPTAR_DATOS' });
    // Verificación en dos pasos obligatoria y sin configurar: el token solo sirve para configurarla (requisitos §4)
    if (p.c2f === true && !this.reflector.getAllAndOverride<boolean>(SIN_2FA, objetivo))
      throw new ForbiddenException({ mensaje: 'Para continuar configure la verificación en dos pasos.', codigo: 'CONFIGURAR_2FA' });
    const requerido = this.reflector.getAllAndOverride<string>(PERMISO, objetivo);
    if (requerido && !p.prm.includes('*') && !p.prm.includes(requerido)) throw new ForbiddenException({ mensaje: `Su rol (${p.rol}) no tiene el permiso «${requerido}».` });
    return true;
  }
}

/**
 * Límite de peticiones (requisitos de producción §1 y §5). Con sesión válida cuenta por usuario: en la oficina todo el
 * personal sale a internet por la misma IP pública y un límite por IP los bloquearía a todos. Sin sesión cuenta por IP
 * (y en las rutas de credenciales, por IP y correo; el techo «ip» vuelve a sumar todos los correos de esa IP).
 */
@Injectable()
class GuardLimites extends ThrottlerGuard {
  constructor(@InjectThrottlerOptions() opciones: ThrottlerModuleOptions, @InjectThrottlerStorage() almacen: ThrottlerStorage, reflector: Reflector, private readonly jwt: JwtService) {
    super(opciones, almacen, reflector);
  }
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const [tipo, token] = String(req.headers?.authorization ?? '').split(' ');
    if (tipo === 'Bearer' && token) {
      try { const p = await this.jwt.verifyAsync<{ sub?: string }>(token); if (p.sub) return `u:${p.sub}`; } catch { /* vencido o falso: cuenta por IP */ }
    }
    const ip = await super.getTracker(req);
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 150) : '';
    // Segundo paso del ingreso: cuenta por la cuenta del desafío, no por IP (una oficina entra a la misma hora detrás de
    // una sola IP). Aquí solo se lee; la firma la verifica el servicio, y cinco códigos errados bloquean la cuenta.
    let cuenta = email;
    if (!cuenta && typeof req.body?.desafio === 'string') {
      const sub = (this.jwt.decode(req.body.desafio) as { sub?: unknown } | null)?.sub;
      if (typeof sub === 'string') cuenta = `2fa:${sub.slice(0, 64)}`;
    }
    return cuenta ? `${ip}|${cuenta}` : ip;
  }
  protected override generateKey(context: ExecutionContext, sufijo: string, nombre: string): string {
    return super.generateKey(context, nombre === 'ip' ? sufijo.split('|')[0] : sufijo, nombre);
  }
}

@Module({
  imports: [JwtModule.registerAsync({
    inject: [ConfigService],
    useFactory: (cfg: ConfigService<Config, true>) => ({ secret: cfg.get('JWT_SECRET', { infer: true }), signOptions: { expiresIn: `${cfg.get('JWT_ACCESS_MIN', { infer: true })}m`, issuer: 'terraviva-api' }, verifyOptions: { issuer: 'terraviva-api' } }),
  })],
  controllers: [AuthController, DobleFactorUsuariosController],
  providers: [AuthService, { provide: APP_GUARD, useClass: GuardLimites }, { provide: APP_GUARD, useClass: GuardAutenticacion }],
  exports: [AuthService],
})
export class AuthModule {}
