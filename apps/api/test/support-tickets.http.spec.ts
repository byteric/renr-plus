import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';

describe('ID 50 support HTTP boundary', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApplication(
      parseEnvironment({
        NODE_ENV: 'test',
        CORS_ORIGIN: 'http://127.0.0.1:5173',
        DATABASE_URL: 'postgresql://ignored:ignored@127.0.0.1:5432/renr_test',
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('requires an authenticated session to access the platform and company queues', async () => {
    const http = request(app.getHttpServer());
    await http.get('/api/v1/platform/support-tickets').expect(401);
    await http
      .get('/api/v1/organizations/10000000-0000-4000-8000-000000000001/support-tickets')
      .expect(401);
  });
});
