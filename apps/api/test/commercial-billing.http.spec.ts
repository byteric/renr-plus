import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';

const base = '/api/v1/platform/commercial/billing';
const orgId = '10000000-0000-4000-8000-000000000001';
const contractId = '10000000-0000-4000-8000-000000000002';
const chargeId = '10000000-0000-4000-8000-000000000003';
const origin = 'http://localhost:5173';

describe('Commercial billing HTTP access (ID 47)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const environment = parseEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://renr:test@localhost/renr',
      CORS_ORIGIN: origin,
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

  it('exige sessão autenticada em todas as rotas de cobranças, vencimentos e pagamentos', async () => {
    const http = request(app.getHttpServer());
    await http.get(`${base}/contracts`).expect(401);
    await http.get(`${base}/charges`).expect(401);
    await http.get(`${base}/clients/${orgId}/charges/${chargeId}`).expect(401);
    await http
      .post(`${base}/clients/${orgId}/contracts/${contractId}/charges`)
      .set('Origin', origin)
      .send({})
      .expect(401);
    await http
      .post(`${base}/clients/${orgId}/charges/${chargeId}/payment`)
      .set('Origin', origin)
      .send({})
      .expect(401);
    await http
      .post(`${base}/clients/${orgId}/charges/${chargeId}/corrections`)
      .set('Origin', origin)
      .send({})
      .expect(401);
  });
});
