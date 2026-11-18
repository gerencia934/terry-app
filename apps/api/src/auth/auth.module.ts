import { Body, CanActivate, Controller, ExecutionContext, ForbiddenException, Get, HttpCode, Injectable, Module, Post, Req, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { ActorActual, PERMISO, PUBLICO, Publico, Zod, type Actor } from '../common/http';
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

@Controller('auth')
class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Publico() @Throttle({ default: { limit: 10, ttl: 60_000 } }) @Post('login') @HttpCode(200)
  login(@Body(new Zod(Login)) b: z.infer<typeof Login>, @Req() req: Request) { return this.auth.login(b.email, b.clave, meta(req)); }

  @Publico() @Throttle({ default: { limit: 30, ttl: 60_000 } }) @Post('renovar') @HttpCode(200)
  renovar(@Body(new Zod(Token)) b: z.infer<typeof Token>, @Req() req: Request) { return this.auth.renovar(b.refreshToken, meta(req)); }

  @Publico() @Post('salir') @HttpCode(204)
  salir(@Body(new Zod(Token)) b: z.infer<typeof Token>) { return this.auth.salir(b.refreshToken); }

  @Get('yo') yo(@ActorActual() a: Actor) { return this.auth.yo(a); }

  @Publico() @Throttle({ default: { limit: 5, ttl: 60_000 } }) @Post('recuperar') @HttpCode(202)
  async recuperar(@Body(new Zod(Recuperar)) b: z.infer<typeof Recuperar>) {
    await this.auth.solicitarRecuperacion(b.email);
    return { mensaje: 'Si el correo está registrado, recibirá un enlace para crear una nueva contraseña.' };
  }

  @Publico() @Throttle({ default: { limit: 5, ttl: 60_000 } }) @Post('restablecer') @HttpCode(200)
  async restablecer(@Body(new Zod(Restablecer)) b: z.infer<typeof Restablecer>) { await this.auth.restablecer(b.token, b.clave); return { mensaje: 'Contraseña actualizada. Ya puede ingresar.' }; }
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
    let p: { sub: string; emp: string; rol: string; prm: string[]; nom: string; sid: string };
    try { p = await this.jwt.verifyAsync(token); } catch { throw new UnauthorizedException({ mensaje: 'La sesión venció. Renueve el token.' }); }
    if (!(await this.auth.sesionActiva(p.sid))) throw new UnauthorizedException({ mensaje: 'La sesión fue cerrada. Ingrese de nuevo.' });
    req.actor = { id: p.sub, empresaId: p.emp, rol: p.rol, permisos: p.prm, nombre: p.nom };
    const requerido = this.reflector.getAllAndOverride<string>(PERMISO, objetivo);
    if (requerido && !p.prm.includes('*') && !p.prm.includes(requerido)) throw new ForbiddenException({ mensaje: `Su rol (${p.rol}) no tiene el permiso «${requerido}».` });
    return true;
  }
}

@Module({
  imports: [JwtModule.registerAsync({
    inject: [ConfigService],
    useFactory: (cfg: ConfigService<Config, true>) => ({ secret: cfg.get('JWT_SECRET', { infer: true }), signOptions: { expiresIn: `${cfg.get('JWT_ACCESS_MIN', { infer: true })}m`, issuer: 'terraviva-api' }, verifyOptions: { issuer: 'terraviva-api' } }),
  })],
  controllers: [AuthController],
  providers: [AuthService, { provide: APP_GUARD, useClass: GuardAutenticacion }],
  exports: [AuthService],
})
export class AuthModule {}
