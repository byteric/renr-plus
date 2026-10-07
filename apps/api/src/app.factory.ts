import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import type { Environment } from './config/env';
import { ApiExceptionFilter } from './http/api-exception.filter';
import { requestIdMiddleware } from './http/request-id';

export function configureApplication(app: INestApplication, environment: Environment): void {
  app.setGlobalPrefix('api/v1');
  app.use(requestIdMiddleware);
  app.use(helmet());
  app.enableCors({ origin: environment.CORS_ORIGIN, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();

  if (environment.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('RENR+ API')
      .setDescription('ReNR+ v0.1: sessões e estrutura organizacional.')
      .setVersion('0.1.0')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/docs-json' });
  }
}

export async function createApplication(environment: Environment): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.configure(environment));
  configureApplication(app, environment);
  return app;
}
