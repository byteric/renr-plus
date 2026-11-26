import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';
import type { PlatformCapability } from '../src/generated/prisma/client';
import { EvidenceStorage } from '../src/modules/evidence/evidence.storage';
import { localDatabaseUrl } from './local-database-url';

const describeDatabase = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
const root = '/api/v1/platform/commercial';
const reason = 'Operação comercial de demonstração';
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000 - 3 * 3_600_000).toISOString().slice(0, 10);
const offer = {
  effectiveOn: day(-100),
  priceCents: 1290,
  pricingUnit: 'EMPLOYEE_MONTH',
  priceMode: 'FIXED',
  conditions: 'Condições iniciais do teste',
  limits: 'Resumo executivo de até dez páginas',
  includedFeatures: ['Avaliação psicossocial'],
  plannedFeatures: ['Educação a distância'],
};

describeDatabase('Commercial catalog and contract revisions on PostgreSQL', () => {
  let app: INestApplication;
  let db: PrismaService;
  let origin: string;
  let bytes: Buffer;
  let storageAdapter: EvidenceStorage | undefined;
  const objects = new Map<string, Buffer>();
  const storage = {
    assertEnabled: jest.fn(() => storageAdapter?.assertEnabled()),
    put: jest.fn(async (key: string, body: Buffer, mimeType: string, sha256: string) => {
      await storageAdapter?.put(key, body, mimeType, sha256);
      objects.set(key, body);
    }),
    get: jest.fn(async (key: string): Promise<Readable> =>
      storageAdapter ? storageAdapter.get(key) : Readable.from([objects.get(key)!]),
    ),
    compensate: jest.fn(async (key: string) => {
      await storageAdapter?.compensate(key);
      objects.delete(key);
    }),
  };

  beforeAll(async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText('Contrato ficticio');
    bytes = Buffer.from(await pdf.save());
    const environment = parseEnvironment({ ...process.env, NODE_ENV: 'test' });
    localDatabaseUrl(environment.DATABASE_URL);
    origin = environment.CORS_ORIGIN;
    if (environment.STORAGE_ENABLED) {
      const host = new URL(environment.S3_ENDPOINT).hostname;
      if (!['localhost', '127.0.0.1', '[::1]'].includes(host))
        throw new Error('Use only local object storage for commercial tests.');
      storageAdapter = new EvidenceStorage(environment);
    }
    const module = await Test.createTestingModule({
      imports: [AppModule.configure(environment)],
    })
      .overrideProvider(EvidenceStorage)
      .useValue(storage)
      .compile();
    db = module.get(PrismaService);
    app = module.createNestApplication();
    configureApplication(app, environment);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    storageAdapter?.onApplicationShutdown();
  });

  beforeEach(() => objects.clear());

  async function account(capabilities: PlatformCapability[], organizationId?: string) {
    const user = await db.client.user.create({
      data: {
        name: 'Operador fictício',
        email: `${randomUUID()}@example.test`,
        passwordHash: 'test',
      },
    });
    if (organizationId) {
      await db.client.membership.create({
        data: { userId: user.id, organizationId, role: 'ADMIN' },
      });
    }
    for (const capability of capabilities) {
      await db.client.platformGrant.create({ data: { userId: user.id, capability } });
    }
    const token = randomBytes(32).toString('base64url');
    await db.client.session.create({
      data: {
        userId: user.id,
        activeOrganizationId: organizationId ?? null,
        expiresAt: new Date(Date.now() + 300_000),
        tokenHash: createHash('sha256').update(token).digest('hex'),
      },
    });
    return { userId: user.id, cookie: `renr_session=${token}` };
  }

  async function company(name: string, demonstration = true) {
    return db.client.organization.create({
      data: {
        name,
        clientClassification: demonstration ? 'DEMONSTRATION' : 'UNCLASSIFIED',
      },
    });
  }

  const createPlan = (cookie: string, overrides: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post(root + '/plans')
      .set({ Cookie: cookie, Origin: origin })
      .send({
        name: `Plano fictício ${randomUUID()}`,
        kind: 'PLAN',
        version: offer,
        reason,
        ...overrides,
      });

  it('uses explicit commercial grants and keeps commercial fields out of the global fiscal catalog', async () => {
    const family = `Carteira ${randomUUID()}`;
    const own = await company(family + ' A');
    const other = await company(family + ' B', false);
    const overview = await account(['READ_OVERVIEW']);
    const tenant = await account([], own.id);
    const read = await account(['READ_COMMERCIAL']);
    const manage = await account(['MANAGE_COMMERCIAL']);
    const http = request(app.getHttpServer());

    for (const cookie of [overview.cookie, tenant.cookie]) {
      await http
        .get(root + '/plans')
        .set('Cookie', cookie)
        .expect(403);
      await http
        .get(root + '/clients/' + own.id + '/contract')
        .set('Cookie', cookie)
        .expect(403);
    }
    await createPlan(read.cookie).expect(403);
    await http
      .post(root + '/plans')
      .set('Cookie', manage.cookie)
      .send({ name: 'Plano sem origem permitida', kind: 'PLAN', version: offer, reason })
      .expect(403);
    const listing = await http
      .get(root + '/clients')
      .query({ search: family })
      .set('Cookie', read.cookie)
      .expect(200);
    expect(
      listing.body.items.map((item: { organizationId: string }) => item.organizationId),
    ).toEqual([own.id, other.id]);
    for (const [clientClassification, organizationId] of [
      ['DEMONSTRATION', own.id],
      ['UNCLASSIFIED', other.id],
    ]) {
      const filtered = await http
        .get(root + '/clients')
        .query({ search: family, classification: clientClassification })
        .set('Cookie', read.cookie)
        .expect(200);
      expect(filtered.body.items).toMatchObject([
        { organizationId, clientClassification, version: 0 },
      ]);
    }

    const profile = {
      expectedVersion: 0,
      contactName: 'Responsável comercial fictício',
      contactEmail: 'contato@example.test',
      adoptedOn: day(-60),
      reason,
    };
    const path = root + '/clients/' + own.id;
    await http.patch(path).set({ Cookie: read.cookie, Origin: origin }).send(profile).expect(403);
    const written = await http
      .patch(path)
      .set({ Cookie: manage.cookie, Origin: origin })
      .send(profile)
      .expect(200);
    expect(written.body).toMatchObject({
      organizationId: own.id,
      contactEmail: profile.contactEmail,
      adoptedOn: profile.adoptedOn,
      version: 1,
      activePlan: null,
    });
    await http
      .patch(path)
      .set({ Cookie: manage.cookie, Origin: origin })
      .send({ ...profile, contactEmail: 'stale@example.test' })
      .expect(409);
    const fiscal = await http
      .get('/api/v1/platform/clients')
      .query({ search: own.name, classification: 'DEMONSTRATION' })
      .set('Cookie', overview.cookie)
      .expect(200);
    expect(fiscal.body.items[0]).not.toHaveProperty('contactEmail');
  });

  it('preserves previously contracted conditions and authorizes documents on the next download', async () => {
    const own = await company('Cliente de contratos ' + randomUUID());
    const other = await company('Cliente diferente ' + randomUUID());
    const manage = await account(['MANAGE_COMMERCIAL']);
    const read = await account(['READ_COMMERCIAL']);
    const http = request(app.getHttpServer());
    const auth = { Cookie: manage.cookie, Origin: origin };
    const contractPath = root + '/clients/' + own.id + '/contract';
    await http.get(contractPath).set(auth).expect(200, { contract: null });

    const service = await createPlan(manage.cookie, {
      kind: 'SERVICE',
      version: { ...offer, pricingUnit: 'TRAINING_CLASS', priceCents: 99000 },
    }).expect(201);
    const plan = await createPlan(manage.cookie).expect(201);
    const originalVersion = plan.body.versions[0].id;
    const original = {
      planVersionId: originalVersion,
      startsOn: day(-40),
      endsOn: day(30),
      terms: 'Condição contratada originalmente',
      reason,
    };
    await http
      .post(contractPath)
      .set(auth)
      .send({ ...original, planVersionId: service.body.versions[0].id })
      .expect(409);
    const created = await http.post(contractPath).set(auth).send(original).expect(201);
    expect(created.body).toMatchObject({
      organizationId: own.id,
      version: 1,
      situation: 'ACTIVE',
      revisions: [{ kind: 'INITIAL', terms: original.terms, planVersion: { priceCents: 1290 } }],
    });
    const revisedPlan = await http
      .post(root + '/plans/' + plan.body.id + '/versions')
      .set(auth)
      .send({
        expectedVersion: 1,
        reason,
        version: { ...offer, effectiveOn: day(31), priceCents: 1990 },
      })
      .expect(201);
    expect(
      revisedPlan.body.versions.map((item: { priceCents: number }) => item.priceCents),
    ).toEqual([1290, 1990]);
    const versionTwo = revisedPlan.body.versions[1].id;
    const revisionPath = contractPath + '/' + created.body.id + '/revisions';
    const renewal = {
      expectedVersion: 1,
      kind: 'RENEWAL',
      planVersionId: versionTwo,
      startsOn: day(31),
      endsOn: day(100),
      terms: 'Condição da próxima vigência',
      reason,
    };
    await http
      .post(revisionPath)
      .set(auth)
      .send({ ...renewal, planVersionId: originalVersion })
      .expect(409);
    const renewed = await http.post(revisionPath).set(auth).send(renewal).expect(201);
    expect(renewed.body).toMatchObject({
      version: 2,
      situation: 'ACTIVE',
      currentRevisionId: created.body.revisions[0].id,
      revisions: [
        { kind: 'INITIAL', terms: original.terms, planVersion: { priceCents: 1290 } },
        { kind: 'RENEWAL', terms: renewal.terms, planVersion: { priceCents: 1990 } },
      ],
    });
    await http.post(revisionPath).set(auth).send(renewal).expect(409);
    const portfolio = await http
      .get(root + '/clients')
      .query({ search: own.name })
      .set(auth)
      .expect(200);
    expect(portfolio.body.items[0].activePlan).toMatchObject({ versionId: originalVersion });

    const documentPath = revisionPath + '/' + created.body.revisions[0].id + '/document';
    const wrongPath = documentPath.replace(own.id, other.id);
    await http.get(wrongPath).set(auth).expect(404);
    await http
      .post(documentPath)
      .set(auth)
      .attach('file', Buffer.from('%PDF-1.7\nContrato fictício\n%%EOF\n'), {
        filename: 'contrato.pdf',
        contentType: 'application/pdf',
      })
      .expect(400);
    const attempts = await Promise.all([
      http
        .post(documentPath)
        .set(auth)
        .attach('file', bytes, { filename: 'contrato.pdf', contentType: 'application/pdf' }),
      http
        .post(documentPath)
        .set(auth)
        .attach('file', bytes, { filename: 'contrato.pdf', contentType: 'application/pdf' }),
    ]);
    expect(attempts.map((attempt) => attempt.status).sort()).toEqual([201, 409]);
    expect(objects.size).toBe(1);
    expect(attempts.find((attempt) => attempt.status === 201)?.body).not.toHaveProperty(
      'storageKey',
    );

    const response = await http.get(documentPath).set('Cookie', read.cookie).expect(200);
    expect(response.body).toEqual(bytes);
    expect(response.headers['content-disposition']).toBe('attachment; filename="contrato.pdf"');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');

    storage.get.mockResolvedValueOnce(Readable.from([Buffer.alloc(bytes.length)]));
    await http.get(documentPath).set('Cookie', read.cookie).expect(503);

    const fresh = await account(['READ_COMMERCIAL']);
    const key = [...objects.keys()][0]!;
    storage.get.mockImplementationOnce(async () => {
      await db.client.platformGrant.update({
        where: { userId_capability: { userId: fresh.userId, capability: 'READ_COMMERCIAL' } },
        data: { isActive: false },
      });
      return Readable.from([objects.get(key)!]);
    });
    await http.get(documentPath).set('Cookie', fresh.cookie).expect(403);
    await http.get(documentPath).set('Cookie', fresh.cookie).expect(403);
    expect(
      await db.client.platformAuditEvent.count({
        where: { actorId: read.userId, action: 'COMMERCIAL_DOCUMENT_DOWNLOADED' },
      }),
    ).toBe(1);
    expect(
      await db.client.platformAuditEvent.count({
        where: { actorId: fresh.userId, action: 'COMMERCIAL_DOCUMENT_DOWNLOADED' },
      }),
    ).toBe(0);
  });

  it('keeps a failed document attachment recoverable and inaccessible until confirmation', async () => {
    const own = await company('Cliente de reenvio ' + randomUUID());
    const manage = await account(['MANAGE_COMMERCIAL']);
    const http = request(app.getHttpServer());
    const auth = { Cookie: manage.cookie, Origin: origin };
    const plan = await createPlan(manage.cookie).expect(201);
    const contractPath = root + '/clients/' + own.id + '/contract';
    const created = await http
      .post(contractPath)
      .set(auth)
      .send({
        planVersionId: plan.body.versions[0].id,
        startsOn: day(-5),
        endsOn: day(25),
        terms: 'Condições para testar reenvio',
        reason,
      })
      .expect(201);
    const target = created.body.revisions[0].id as string;
    const documentPath =
      contractPath + '/' + created.body.id + '/revisions/' + target + '/document';
    const attempt = () =>
      http
        .post(documentPath)
        .set(auth)
        .attach('file', bytes, { filename: 'contrato.pdf', contentType: 'application/pdf' });
    const put = storage.put.getMockImplementation()!;
    storage.put.mockImplementationOnce(async (...input) => {
      await put(...input);
      jest
        .spyOn(db.client, '$transaction')
        .mockRejectedValueOnce(new Error('Database unavailable'));
    });
    await attempt().expect(500);
    const reserved = await db.client.commercialContractDocument.findUnique({
      where: { revisionId: target },
    });
    expect(reserved).toMatchObject({ storedAt: null });
    expect(
      (await http.get(contractPath).set(auth).expect(200)).body.contract.revisions[0],
    ).toMatchObject({ document: null, documentPending: true });
    await http.get(documentPath).set(auth).expect(404);
    await attempt().expect(201);
    expect(objects.size).toBe(1);
    expect(objects.has(reserved!.storageKey)).toBe(true);
    await http.get(documentPath).set(auth).expect(200);
  });

  it('uses the effective manual amendment and cancellation without changing previous dates', async () => {
    const own = await company('Cliente de vigência ' + randomUUID());
    const manage = await account(['MANAGE_COMMERCIAL']);
    const http = request(app.getHttpServer());
    const auth = { Cookie: manage.cookie, Origin: origin };
    const plan = await createPlan(manage.cookie).expect(201);
    const planVersionId = plan.body.versions[0].id;
    const term = {
      planVersionId,
      startsOn: day(-40),
      endsOn: day(20),
      terms: 'Condição contratada inicialmente',
      reason,
    };
    const contractPath = root + '/clients/' + own.id + '/contract';
    const created = await http.post(contractPath).set(auth).send(term).expect(201);
    const revisionPath = contractPath + '/' + created.body.id + '/revisions';
    const amendment = {
      ...term,
      expectedVersion: 1,
      kind: 'AMENDMENT',
      startsOn: day(-12),
      endsOn: day(30),
      terms: 'Ajuste autorizado com nova duração',
    };
    await http.post(revisionPath).set(auth).send(amendment).expect(201);
    await http
      .post(revisionPath)
      .set(auth)
      .send({ expectedVersion: 2, kind: 'CANCELLATION', startsOn: day(31), reason })
      .expect(409);
    const response = await http
      .post(revisionPath)
      .set(auth)
      .send({ expectedVersion: 2, kind: 'CANCELLATION', startsOn: day(-4), reason })
      .expect(201);
    const revisions = response.body.revisions;
    expect(response.body).toMatchObject({
      version: 3,
      currentRevisionId: revisions[2].id,
      situation: 'CANCELLED',
      revisions: [
        { kind: 'INITIAL', endsOn: term.endsOn, terms: term.terms },
        { kind: 'AMENDMENT', startsOn: day(-12), endsOn: day(30), terms: amendment.terms },
        { kind: 'CANCELLATION', startsOn: day(-4), endsOn: day(-4), terms: amendment.terms },
      ],
    });
    const current = await http.get(contractPath).set(auth).expect(200);
    expect(current.body.contract.situation).toBe('CANCELLED');
    const portfolio = await http
      .get(root + '/clients')
      .query({ search: own.name })
      .set(auth)
      .expect(200);
    expect(portfolio.body.items[0].activePlan).toBeNull();
    const renewed = await http
      .post(revisionPath)
      .set(auth)
      .send({
        ...term,
        expectedVersion: 3,
        kind: 'RENEWAL',
        startsOn: day(1),
        endsOn: day(32),
      })
      .expect(201);
    expect(renewed.body).toMatchObject({ situation: 'CANCELLED', version: 4 });
    const pendingId = renewed.body.revisions[3].id as string;
    const withdrawal = {
      expectedVersion: 4,
      kind: 'WITHDRAW_SCHEDULED',
      revisionId: pendingId,
      reason,
    };
    const withdrawn = await http.post(revisionPath).set(auth).send(withdrawal).expect(201);
    expect(withdrawn.body).toMatchObject({ situation: 'CANCELLED', version: 5 });
    expect(withdrawn.body.revisions[3]).toMatchObject({ id: pendingId, withdrawal: { reason } });
    await http.post(revisionPath).set(auth).send(withdrawal).expect(409);
    await http
      .post(revisionPath)
      .set(auth)
      .send({
        ...term,
        expectedVersion: 5,
        kind: 'RENEWAL',
        startsOn: day(1),
        endsOn: day(32),
      })
      .expect(201);
  });
});
