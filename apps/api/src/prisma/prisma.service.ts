import { Global, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
    // La seguridad por filas (RLS) es la segunda barrera del portal de clientes, y PostgreSQL no la aplica a un
    // superusuario ni a un usuario con BYPASSRLS. En producción el API no arranca así; en desarrollo, lo advierte.
    const [rol] = await this.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    if (rol?.rolsuper || rol?.rolbypassrls) {
      const aviso = 'El API se conecta a la base con un usuario que se salta la seguridad por filas (superusuario o BYPASSRLS): '
        + 'la segunda barrera del portal de clientes no actuaría. Conéctelo con un usuario sin esos privilegios.';
      if (process.env.NODE_ENV === 'production') throw new Error(aviso);
      new Logger('BaseDeDatos').warn(aviso);
    }
  }
  async onModuleDestroy() { await this.$disconnect(); }
}

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
