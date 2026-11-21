import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { validarConfig, type Config } from './config';
import { PrismaModule } from './prisma/prisma.service';
import { ComunModule } from './common/servicios';
import { FiltroErrores, TECHO_IP } from './common/http';
import { AuthModule } from './auth/auth.module';
import { ClientesModule } from './clientes/clientes.module';
import { CertificadoComercialModule } from './clientes/certificado-comercial.module';
import { FinanzasModule } from './finanzas/finanzas.module';
import { MonitoreoModule } from './monitoreo/monitoreo.module';
import { GpsModule } from './gps/gps.module';
import { ComercialModule } from './comercial/comercial.module';
import { NotificacionesModule } from './notificaciones/notificaciones.module';
import { DeclaracionesModule } from './declaraciones/declaraciones.module';
import { LogisticaModule } from './rutas/logistica.module';
import { CumplimientoModule } from './permisos/cumplimiento.module';
import { ImportacionModule } from './importacion/importacion.module';
import { ArchivosModule } from './common/archivos';
import { TrabajosModule } from './trabajos/trabajos.module';
import { ManifiestosModule } from './manifiestos/manifiestos.module';
import { CampoModule } from './campo/campo.module';
import { MantenimientoModule } from './mantenimiento/mantenimiento.module';
import { BitacoraModule } from './bitacora/bitacora.module';
import { ConciliacionesModule } from './conciliaciones/conciliaciones.module';
import { ActasModule } from './actas/actas.module';
import { InformesModule } from './informes/informes.module';
import { EmpresaModule } from './empresa/empresa.module';
import { UsuariosModule } from './usuarios/usuarios.module';
import { PortalModule } from './portal/portal.module';
import { AutogestionModule } from './portal/autogestion';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validarConfig, envFilePath: ['.env', '../../.env'] }),
    // Límites de peticiones. El guard (auth.module.ts) cuenta por usuario si hay sesión válida y por IP si no.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService<Config, true>) => ({
        throttlers: [
          { name: 'default', ttl: 60_000, limit: cfg.get('LIMITE_PETICIONES_MIN', { infer: true }) },
          // Techo por IP: solo en las rutas marcadas con @LimiteCredenciales
          { name: 'ip', ttl: 60_000, limit: cfg.get('LIMITE_INGRESOS_IP_MIN', { infer: true }), skipIf: (ctx) => !Reflect.getMetadata(TECHO_IP, ctx.getHandler()) },
        ],
      }),
    }),
    PrismaModule, ComunModule, ArchivosModule, TrabajosModule, AuthModule,
    MonitoreoModule, NotificacionesModule, GpsModule, ComercialModule, ClientesModule, CertificadoComercialModule, FinanzasModule, DeclaracionesModule, LogisticaModule, CumplimientoModule, ImportacionModule,
    ManifiestosModule, CampoModule, MantenimientoModule, BitacoraModule, ConciliacionesModule, ActasModule, InformesModule, EmpresaModule, UsuariosModule, PortalModule, AutogestionModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: FiltroErrores },
  ],
})
export class AppModule {}
