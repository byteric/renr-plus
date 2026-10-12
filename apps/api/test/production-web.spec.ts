import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';

describe('Production web and API on the same origin', () => {
  const checkReadiness = jest.fn<Promise<void>, []>();
  let app: INestApplication;
  let directory: string;
  let fixtureRoot: string;
  const index = '<!doctype html><html><body>RENR production app</body></html>';

  function environment(webDistPath: string, serveWeb = true) {
    return parseEnvironment({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://renr:test@localhost/renr',
      CORS_ORIGIN: 'https://renr.example.com',
      SERVE_WEB: serveWeb,
      WEB_DIST_PATH: webDistPath,
    });
  }

  async function buildApplication(webDistPath: string, serveWeb = true): Promise<INestApplication> {
    const config = environment(webDistPath, serveWeb);
    const module = await Test.createTestingModule({ imports: [AppModule.configure(config)] })
      .overrideProvider(PrismaService)
      .useValue({ checkReadiness })
      .compile();
    const application = module.createNestApplication();
    try {
      configureApplication(application, config);
      await application.init();
      return application;
    } catch (error) {
      await application.close();
      throw error;
    }
  }

  beforeAll(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), 'renr-web-'));
    directory = join(fixtureRoot, 'dist');
    await mkdir(directory);
    await mkdir(join(fixtureRoot, 'private'));
    await writeFile(join(fixtureRoot, 'private', 'secret.json'), '{"secret":true}');
    await mkdir(join(directory, 'assets'));
    await mkdir(join(directory, '.private'));
    await writeFile(join(directory, 'index.html'), index);
    await writeFile(join(directory, 'assets', 'app.js'), 'console.log("renr");');
    await writeFile(join(directory, '.env'), 'PRIVATE_SECRET=value');
    await writeFile(join(directory, '.private', 'secret.json'), '{"secret":true}');
    await writeFile(join(directory, 'credentials.pem'), 'PRIVATE KEY');
    await symlink(join(fixtureRoot, 'private'), join(directory, 'external'), 'junction');
    await symlink(join(directory, '.private'), join(directory, 'hidden'), 'junction');
    app = await buildApplication(directory);
  });
  beforeEach(() => checkReadiness.mockReset().mockResolvedValue(undefined));
  afterAll(async () => {
    await app?.close();
    if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
  });

  it.each(['/', '/login', '/organizations/example'])(
    'serves HTML navigation at %s',
    async (path) => {
      const response = await request(app.getHttpServer())
        .get(path)
        .set('Accept', 'text/html')
        .expect(200);
      expect(response.text).toBe(index);
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    },
  );

  it('serves HEAD navigation without a body', async () => {
    const response = await request(app.getHttpServer())
      .head('/login')
      .set('Accept', 'text/html')
      .expect(200);
    expect(response.text).toBeUndefined();
    expect(response.headers['content-type']).toMatch(/text\/html/);
  });

  it('serves compiled assets', async () => {
    const response = await request(app.getHttpServer()).get('/assets/app.js').expect(200);
    expect(response.text).toBe('console.log("renr");');
    expect(response.headers['content-type']).toMatch(/javascript/);
  });

  it.each([
    '/api',
    '/api/missing',
    '/api/v1/missing',
    '/API/v1/missing',
    '/api/docs',
    '/api/docs-json',
    '/assets/missing.js',
    '/assets/missing',
    '/missing.css',
    '/.env',
    '/.private/secret.json',
    '/%2eenv',
    '/credentials.pem',
    '/assets/..%2f.env',
    '/external/secret.json',
    '/hidden/secret.json',
  ])('keeps missing API/assets and private files as 404: %s', async (path) => {
    const response = await request(app.getHttpServer())
      .get(path)
      .set('Accept', 'text/html')
      .expect(404);
    if (path.toLowerCase().startsWith('/api/v1/')) {
      expect(response.body.code).toBe('NOT_FOUND');
    }
    expect(response.text).not.toContain('RENR production app');
    expect(response.text).not.toContain('PRIVATE');
  });

  it.each(['application/json', '*/*', 'text/html;q=0'])(
    'does not fall back for Accept %s',
    async (accept) => {
      await request(app.getHttpServer()).get('/login').set('Accept', accept).expect(404);
    },
  );

  it('does not fall back for POST navigation', async () => {
    await request(app.getHttpServer()).post('/login').set('Accept', 'text/html').expect(404);
  });

  it('serves health and readiness without S3 configuration', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(checkReadiness).not.toHaveBeenCalled();
    await request(app.getHttpServer()).get('/api/v1/ready').expect(200);
    expect(checkReadiness).toHaveBeenCalledTimes(1);
  });

  it('preserves readiness failures', async () => {
    checkReadiness.mockRejectedValue(new Error('database unavailable'));
    const response = await request(app.getHttpServer())
      .get('/api/v1/ready')
      .set('Accept', 'text/html')
      .expect(503);
    expect(response.body.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('keeps the configured CORS origin', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', 'https://attacker.example.com')
      .expect(200);
    expect(response.headers['access-control-allow-origin']).toBe('https://renr.example.com');
  });

  it('rejects an untrusted Origin before authentication accesses the database', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/sessions')
      .set('Origin', 'https://attacker.example.com')
      .send({})
      .expect(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });

  it('rejects an absent compiled directory', async () => {
    await expect(buildApplication(join(directory, 'missing'))).rejects.toThrow(
      'SERVE_WEB requires a built',
    );
  });

  it('rejects a compiled directory without index.html', async () => {
    await expect(buildApplication(join(directory, 'assets'))).rejects.toThrow(
      'SERVE_WEB requires a built',
    );
  });

  it('leaves web serving disabled by default', async () => {
    const disabled = await buildApplication(join(directory, 'missing'), false);
    try {
      await request(disabled.getHttpServer()).get('/login').set('Accept', 'text/html').expect(404);
    } finally {
      await disabled.close();
    }
  });
});
