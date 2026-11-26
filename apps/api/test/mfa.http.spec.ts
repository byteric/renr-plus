import { randomBytes } from 'node:crypto';
import { Logger, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';

const origin = 'http://127.0.0.1:5173';
const auth = '/api/v1/auth/mfa';

describe('ID 53 MFA HTTP boundary', () => {
  let app: INestApplication;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    app = await createApplication(
      parseEnvironment({
        NODE_ENV: 'test',
        CORS_ORIGIN: origin,
        DATABASE_URL: 'postgresql://ignored:ignored@127.0.0.1:5432/renr_test',
        MFA_ENCRYPTION_KEY: randomBytes(32).toString('base64url'),
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('requires an ordinary session for status and a partial cookie for the login proof', async () => {
    const http = request(app.getHttpServer());
    await http.get(auth).expect('Cache-Control', 'private, no-store').expect(401);
    await http
      .post(auth + '/login')
      .set('Origin', origin)
      .send({ method: 'totp', code: '123456' })
      .expect('Cache-Control', 'private, no-store')
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('AUTH_MFA_CHALLENGE_UNAVAILABLE'));
  });

  it('rejects malformed proofs and foreign-origin mutations before touching a challenge', async () => {
    const http = request(app.getHttpServer());
    await http
      .post(auth + '/login')
      .set('Origin', origin)
      .send({ method: 'totp', code: '12345678' })
      .expect(400);
    await http
      .post(auth + '/enrollment')
      .set('Origin', 'https://foreign.example')
      .send({ kind: 'login' })
      .expect(403);
    await http
      .post('/api/v1/platform/mfa-recoveries')
      .set('Origin', origin)
      .send({
        email: 'synthetic@renr.example',
        verificationConfirmed: true,
        verificationReference: 'OPS-ABC',
      })
      .expect(401);
    await http
      .delete(auth + '/login')
      .set('Origin', origin)
      .expect(204);
  });
});
