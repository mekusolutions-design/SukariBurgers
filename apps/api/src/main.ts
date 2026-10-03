// apps/api/src/main.ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { initSentry, flushSentry } from './common/observability/sentry';

async function bootstrap() {
  initSentry();

  const app = await NestFactory.create(AppModule, { rawBody: true });

  const configService = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  app.enableShutdownHooks();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  const corsOriginRaw =
    configService.get<string>('cors.origin') ||
    configService.get<string>('CORS_ORIGIN') ||
    '';

  const corsOrigin =
    !corsOriginRaw || corsOriginRaw.trim() === '*'
      ? true
      : corsOriginRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);

  app.enableCors({
    origin: corsOrigin,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Origin',
      'X-Requested-With',
      'Idempotency-Key',
      'X-Request-ID',
    ],
    exposedHeaders: ['Authorization', 'X-Request-ID'],
    credentials: true,
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('RestFlow API')
    .setDescription('Event-sourced restaurant inventory & POS system')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port =
    configService.get<number>('port') ||
    parseInt(process.env.PORT || '3000', 10);

  await app.listen(port, '0.0.0.0');

  logger.log(`Application running on: http://0.0.0.0:${port}`);
  logger.log(`Swagger docs: http://localhost:${port}/docs`);
  logger.log(
    `CORS origin mode: ${corsOrigin === true ? 'reflect' : (corsOrigin as string[]).join(', ')}`,
  );
  logger.log(
    `Sentry: ${process.env.SENTRY_DSN ? 'enabled' : 'disabled'}; Metrics: ${process.env.METRICS_ENABLED === 'false' ? 'disabled' : 'enabled'}`,
  );

  const shutdown = async () => {
    logger.log('Shutting down…');
    await flushSentry();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

bootstrap().catch((err) => {
  const logger = new Logger('Bootstrap');
  logger.error('Bootstrap failed', err);
  process.exit(1);
});
