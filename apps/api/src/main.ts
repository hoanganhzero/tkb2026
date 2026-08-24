import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useWebSocketAdapter(new IoAdapter(app));

  app.setGlobalPrefix('v1');
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.use((req: any, _res: any, next: () => void) => {
    req.requestId = 'req_' + randomUUID();
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  console.log(`TKB API đang chạy tại http://localhost:${port}/v1`);
}

void bootstrap();
