import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import type { Config } from './config';

async function arrancar() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  const cfg = app.get(ConfigService<Config, true>);
  app.set('trust proxy', 1);
  app.use(helmet());
  app.enableCors({ origin: cfg.get('CORS_ORIGINS', { infer: true }).split(',').map((s) => s.trim()), credentials: false, maxAge: 600 });
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  const port = cfg.get('PORT', { infer: true });
  await app.listen(port);
  new Logger('API').log(`TERRY-GO API escuchando en http://localhost:${port}/api/v1  (salud: /api/v1/salud)`);
}
arrancar();
