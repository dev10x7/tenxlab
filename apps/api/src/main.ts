import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './http/app.module';
import { loadEnv } from './config/env';

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // Preserve the raw body so HMAC verification runs over the exact bytes.
  app.use(require('express').json({ verify: (req: any, _res: any, buf: Buffer) => { req.rawBody = buf; } }));
  app.use(require('express').urlencoded({ extended: true }));
  await app.listen(env.PORT);
  // eslint-disable-next-line no-console
  console.log(`TenXLab LMS API listening on :${env.PORT}`);
}

bootstrap();
