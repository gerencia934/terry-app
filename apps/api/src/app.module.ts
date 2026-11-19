import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validarConfig } from './config';
import { PrismaModule } from './prisma/prisma.service';
import { ComunModule } from './common/servicios';
import { FiltroErrores } from './common/http';
import { AuthModule } from './auth/auth.module';
import { ClientesModule } from './clientes/clientes.module';
import { DeclaracionesModule } from './declaraciones/declaraciones.module';
import { LogisticaModule } from './rutas/logistica.module';
import { CumplimientoModule } from './permisos/cumplimiento.module';
import { ImportacionModule } from './importacion/importacion.module';
import { ArchivosModule } from './common/archivos';
import { ManifiestosModule } from './manifiestos/manifiestos.module';
import { ConciliacionesModule } from './conciliaciones/conciliaciones.module';
import { ActasModule } from './actas/actas.module';
import { InformesModule } from './informes/informes.module';
import { EmpresaModule } from './empresa/empresa.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validarConfig, envFilePath: ['.env', '../../.env'] }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    PrismaModule, ComunModule, ArchivosModule, AuthModule,
    ClientesModule, DeclaracionesModule, LogisticaModule, CumplimientoModule, ImportacionModule,
    ManifiestosModule, ConciliacionesModule, ActasModule, InformesModule, EmpresaModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: FiltroErrores },
  ],
})
export class AppModule {}
