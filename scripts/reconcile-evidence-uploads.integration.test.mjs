import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parse } from 'dotenv';
import { reconcileEvidenceUploads } from './reconcile-evidence-uploads.mjs';
const { Headers, Response } = globalThis;

const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));

test(
  'reconciliation CLI uses real Origin and active-organization guards for a multi-organization user',
  { skip: process.env.RUN_DB_TESTS !== '1', timeout: 60000 },
  async () => {
    const { Test } = requireApi('@nestjs/testing');
    const { ServiceUnavailableException } = requireApi('@nestjs/common');
    const request = requireApi('supertest');
    const { AppModule } = requireApi('./dist/app.module.js');
    const { configureApplication } = requireApi('./dist/app.factory.js');
    const { parseEnvironment } = requireApi('./dist/config/env.js');
    const { PrismaService } = requireApi('./dist/database/prisma.service.js');
    const { EvidenceStorage } = requireApi('./dist/modules/evidence/evidence.storage.js');
    const { hashPassword } = requireApi('./dist/modules/identity/password.js');
    const environment = parseEnvironment({
      ...parse(readFileSync(new URL('../apps/api/.env', import.meta.url), 'utf8')),
      ...process.env,
      NODE_ENV: 'test',
    });
    const databaseUrl = new URL(environment.DATABASE_URL);
    assert.ok(['postgres:', 'postgresql:'].includes(databaseUrl.protocol));
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(databaseUrl.hostname));
    assert.ok(['/renr_test', '/renr_technical_id11_verification'].includes(databaseUrl.pathname));
    assert.ok([...databaseUrl.searchParams.keys()].every((key) => key === 'schema'));
    assert.equal(environment.CORS_ORIGIN, 'http://127.0.0.1:5173');
    let putCalls = 0;
    let deleteCalls = 0;
    let probeCalls = 0;
    const storage = {
      assertEnabled() {},
      async put() {
        putCalls += 1;
        throw new ServiceUnavailableException();
      },
      async probe() {
        probeCalls += 1;
        return 'ABSENT';
      },
      async compensate() {
        deleteCalls += 1;
      },
    };
    const module = await Test.createTestingModule({
      imports: [AppModule.configure(environment)],
    })
      .overrideProvider(EvidenceStorage)
      .useValue(storage)
      .compile();
    const app = module.createNestApplication();
    const db = module.get(PrismaService);
    const userId = randomUUID();
    const password = randomBytes(24).toString('base64url');
    const email = `${userId}@cli-integration.example`;
    let manualCookie;
    try {
      configureApplication(app, environment);
      await app.init();
      await db.client.user.create({
        data: {
          id: userId,
          name: 'Synthetic reconciliation operator',
          email,
          passwordHash: await hashPassword(password),
        },
      });
      const organizations = [];
      for (let index = 0; index < 2; index += 1) {
        const organization = await db.client.organization.create({
          data: {
            name: `Synthetic CLI organization ${index} ${userId}`,
            memberships: { create: { userId, role: 'ADMIN' } },
          },
        });
        organizations.push(organization.id);
      }
      const api = () => request(app.getHttpServer());
      // This rejection proves that the actual identity guard enforces the app origin.
      await api()
        .post('/api/v1/auth/sessions')
        .set('Origin', 'http://127.0.0.1:3000')
        .send({ email, password })
        .expect(403);
      const login = await api()
        .post('/api/v1/auth/sessions')
        .set('Origin', environment.CORS_ORIGIN)
        .send({ email, password })
        .expect(201);
      const firstActiveOrganizationId = login.body.activeOrganizationId;
      assert.ok(organizations.includes(firstActiveOrganizationId));
      const organizationId = organizations.find((id) => id !== firstActiveOrganizationId);
      assert.ok(organizationId);
      manualCookie = login.headers['set-cookie'].map((value) => value.split(';')[0]).join('; ');
      await api()
        .put('/api/v1/auth/session/organization')
        .set('Cookie', manualCookie)
        .set('Origin', environment.CORS_ORIGIN)
        .send({ organizationId })
        .expect(200);
      const unit = await db.client.unit.create({
        data: { organizationId, name: 'Synthetic CLI unit', normalizedName: 'synthetic cli unit' },
      });
      const sector = await db.client.sector.create({
        data: {
          organizationId,
          unitId: unit.id,
          name: 'Synthetic CLI sector',
          normalizedName: 'synthetic cli sector',
        },
      });
      const group = await db.client.assessmentGroup.create({
        data: { organizationId, sectorId: sector.id },
      });
      const risk = await db.client.risk.create({
        data: {
          organizationId,
          assessmentGroupId: group.id,
          status: 'REGISTERED',
          factor: 'Synthetic CLI origin',
          description: 'Synthetic collective risk fixture',
          createdById: userId,
          updatedById: userId,
        },
      });
      const created = await api()
        .post(`/api/v1/organizations/${organizationId}/risks/${risk.id}/actions`)
        .set('Cookie', manualCookie)
        .set('Origin', environment.CORS_ORIGIN)
        .send({
          title: 'Synthetic CLI reconciliation action',
          description: 'Synthetic action for real recovery boundaries',
          responsibleName: 'Synthetic CLI operator',
          dueDate: '2026-12-20',
          expectedResult: 'Preserve a recoverable reservation',
          verificationCriterion: 'Verify persisted attempt and versions',
          expectedRiskVersion: risk.version,
        })
        .expect(201);
      const actionId = created.body.id;
      const key = randomUUID();
      const base = `/api/v1/organizations/${organizationId}/actions/${actionId}/evidence`;
      const attemptPath = `${base}/upload-attempts/${key}`;
      await api()
        .post(base)
        .set('Cookie', manualCookie)
        .set('Origin', environment.CORS_ORIGIN)
        .set('Idempotency-Key', key)
        .field('description', 'Synthetic CLI attachment with an uncertain PUT')
        .field('expectedVersion', String(created.body.version))
        .attach('file', Buffer.from('%PDF-1.7\nSynthetic CLI proof\n%%EOF'), {
          filename: 'synthetic-cli.pdf',
          contentType: 'application/pdf',
        })
        .expect(503);
      await api()
        .delete('/api/v1/auth/session')
        .set('Cookie', manualCookie)
        .set('Origin', environment.CORS_ORIGIN)
        .expect(204);
      manualCookie = undefined;
      const persisted = () =>
        db.client.evidenceUploadAttempt.findFirstOrThrow({
          where: { organizationId, actionId, creatorId: userId, key },
        });
      const beforeDryRun = await persisted();
      assert.equal(beforeDryRun.state, 'UNCERTAIN');
      assert.equal(putCalls, 1);
      const calls = [];
      const fetcher = async (url, options) => {
        const path = new URL(url).pathname;
        calls.push({ path, method: options.method, origin: options.headers.Origin });
        const wire = api()[options.method.toLowerCase()](path).set(options.headers);
        if (options.body !== undefined) wire.send(JSON.parse(options.body));
        const result = await wire;
        if (path === '/api/v1/auth/sessions' && result.status === 201) {
          assert.equal(result.body.activeOrganizationId, firstActiveOrganizationId);
          assert.notEqual(result.body.activeOrganizationId, organizationId);
        }
        if (path === '/api/v1/auth/session/organization') {
          assert.equal(result.status, 200);
          assert.equal(result.body.activeOrganizationId, organizationId);
        }
        const headers = new Headers();
        if (result.headers['content-type'])
          headers.set('Content-Type', result.headers['content-type']);
        for (const cookie of result.headers['set-cookie'] ?? [])
          headers.append('Set-Cookie', cookie);
        return new Response(result.status === 204 ? null : result.text, {
          status: result.status,
          headers,
        });
      };
      const input = {
        origin: 'http://127.0.0.1:3000',
        organizationId,
        actionId,
        keys: [key],
        email,
        password,
        fetcher,
      };
      const dryRun = await reconcileEvidenceUploads(input);
      assert.equal(dryRun.mode, 'DRY_RUN');
      assert.equal(dryRun.results[0].decision, 'RECONCILE_ABSENT');
      assert.equal(dryRun.results[0].applied, false);
      assert.deepEqual(await persisted(), beforeDryRun);
      assert.equal(await db.client.session.count({ where: { userId } }), 0);
      assert.equal(putCalls, 1);
      assert.equal(deleteCalls, 0);
      assert.ok(probeCalls >= 1);
      assert.deepEqual(
        calls.map(({ method, path }) => [method, path]),
        [
          ['POST', '/api/v1/auth/sessions'],
          ['PUT', '/api/v1/auth/session/organization'],
          ['GET', attemptPath],
          ['DELETE', '/api/v1/auth/session'],
        ],
      );
      assert.ok(calls.every(({ origin }) => origin === 'http://127.0.0.1:5173'));
      calls.length = 0;
      const applied = await reconcileEvidenceUploads({ ...input, apply: true });
      assert.equal(applied.mode, 'APPLY');
      assert.equal(applied.results[0].applied, true);
      assert.equal(applied.results[0].resultingState, 'RETRYABLE');
      const afterApply = await persisted();
      assert.equal(afterApply.state, 'RETRYABLE');
      assert.equal(afterApply.objectState, 'ABSENT');
      assert.ok(afterApply.attemptVersion > beforeDryRun.attemptVersion);
      assert.equal(afterApply.evidenceId, null);
      assert.equal(
        (await db.client.action.findUniqueOrThrow({ where: { id: actionId } })).version,
        created.body.version,
      );
      assert.equal(
        await db.client.actionEvidence.count({ where: { organizationId, actionId } }),
        0,
      );
      assert.equal(
        await db.client.actionRevision.count({ where: { actionId, event: 'EVIDENCE_ADDED' } }),
        0,
      );
      assert.equal(await db.client.session.count({ where: { userId } }), 0);
      assert.equal(putCalls, 1);
      assert.equal(deleteCalls, 0);
      assert.deepEqual(
        calls.map(({ method, path }) => [method, path]),
        [
          ['POST', '/api/v1/auth/sessions'],
          ['PUT', '/api/v1/auth/session/organization'],
          ['GET', attemptPath],
          ['POST', `${attemptPath}/reconcile`],
          ['DELETE', '/api/v1/auth/session'],
        ],
      );
      assert.ok(calls.every(({ origin }) => origin === 'http://127.0.0.1:5173'));
      assert.doesNotMatch(JSON.stringify([dryRun, applied]), new RegExp(password));
    } finally {
      await db.client.session.deleteMany({ where: { userId } });
      await app.close();
    }
  },
);
