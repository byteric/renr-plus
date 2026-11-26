import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';

const origin = 'http://127.0.0.1:5173';
const root = '/api/v1/auth/recovery';
const token = 'a'.repeat(43);

describe('ID 52 password recovery HTTP boundary', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApplication(
      parseEnvironment({
        NODE_ENV: 'test',
        CORS_ORIGIN: origin,
        DATABASE_URL: 'postgresql://ignored:ignored@127.0.0.1:5432/renr_test',
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns identical public guidance without requiring a database lookup and limits submissions by IP', async () => {
    const http = request(app.getHttpServer());
    for (const email of ['titular@renr.example', 'desconhecido@renr.example']) {
      await http
        .post(root + '/requests')
        .set('Origin', origin)
        .send({ email })
        .expect('Cache-Control', 'private, no-store')
        .expect(202, { accepted: true });
    }
    for (let index = 0; index < 13; index += 1) {
      await http
        .post(root + '/requests')
        .set('Origin', origin)
        .send({ email: 'teste@renr.example' })
        .expect(202);
    }
    await http
      .post(root + '/requests')
      .set('Origin', origin)
      .send({ email: 'outro@renr.example' })
      .expect(429);
  });

  it('rejects a foreign origin and refuses recovery links while the feature is disabled', async () => {
    const http = request(app.getHttpServer());
    await http
      .post(root + '/requests')
      .set('Origin', 'https://unrelated.example')
      .send({ email: 'titular@renr.example' })
      .expect(403);
    await http
      .post(root + '/status')
      .set('Origin', origin)
      .send({ token })
      .expect(200, { available: false });
    await http
      .post(root + '/confirm')
      .set('Origin', origin)
      .send({ token, password: 'new-test-password' })
      .expect(404);
  });

  it('requires a session for assisted issuance in both scopes', async () => {
    const http = request(app.getHttpServer());
    const verify = {
      email: 'titular@renr.example',
      verificationConfirmed: true,
      verificationReference: 'RH-52-101',
    };
    for (const path of [
      '/api/v1/platform/password-recoveries',
      '/api/v1/organizations/10000000-0000-4000-8000-000000000001/password-recoveries',
    ]) {
      await http.post(path).set('Origin', origin).send(verify).expect(401);
    }
  });
});
