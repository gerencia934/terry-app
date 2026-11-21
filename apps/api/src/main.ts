import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { middlewareContexto } from './common/contexto';
import type { Config } from './config';

async function arrancar() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  const cfg = app.get(ConfigService<Config, true>);
  // Un salto: en Cloudflare, la función de Pages pone en X-Forwarded-For solo la IP real de quien entra (CF-Connecting-IP)
  app.set('trust proxy', 1);
  app.useBodyParser('json', { limit: '1mb' }); // la firma táctil viaja como imagen PNG en el cuerpo
  app.use(helmet());
  app.use(middlewareContexto); // IP y navegador de cada petición, para la auditoría
  app.enableCors({ origin: cfg.get('CORS_ORIGINS', { infer: true }).split(',').map((s) => s.trim()), credentials: false, maxAge: 600 });
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  const port = cfg.get('PORT', { infer: true });
  await app.listen(port);
  new Logger('API').log(`Terry-App Residuos (API) escuchando en http://localhost:${port}/api/v1  (salud: /api/v1/salud)`);
}
arrancar();
