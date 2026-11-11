import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import express from 'express';
import { AppModule } from './http/app.module';
import { loadEnv } from './config/env';

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // Preserve the raw body so HMAC verification runs over the exact bytes.
  app.use(
    express.json({
      verify: (req: express.Request & { rawBody?: Buffer }, _res, buf: Buffer) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: true }));
  await app.listen(env.PORT);
  // eslint-disable-next-line no-console
  console.log(`TenXLab LMS API listening on :${env.PORT}`);
}

void bootstrap();
