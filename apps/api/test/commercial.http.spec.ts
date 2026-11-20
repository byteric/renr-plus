import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';

describe('Commercial HTTP access', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const environment = parseEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://renr:test@localhost/renr',
      CORS_ORIGIN: 'http://localhost:5173',
    });
    const module = await Test.createTestingModule({
      imports: [AppModule.configure(environment)],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
    app = module.createNestApplication();
    configureApplication(app, environment);
    await app.init();
  });

  afterAll(async () => app?.close());

  it('requires an authenticated session before exposing the commercial catalog', async () => {
    await request(app.getHttpServer()).get('/api/v1/platform/commercial/plans').expect(401);
  });
});
