import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { configureApplication } from '../src/app.factory';
import { AppModule } from '../src/app.module';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';
import { localDatabaseUrl } from './local-database-url';

const describeDatabase = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
describeDatabase('Manual assessment invite delivery', () => {
  let env: ReturnType<typeof parseEnvironment>;
  let app: INestApplication;
  let db: PrismaService;
  let org: string;
  let admin: string;
  let hr: { userId: string; cookie: string };
  let group: string;
  let instrument: string;
  let policy: string;

  const api = (fragment: string, organizationId = org) =>
    `/api/v1/organizations/${organizationId}/${fragment}`;
  const send = (fragment: string, payload: object, cookie = admin, origin = env.CORS_ORIGIN) =>
    request(app.getHttpServer())
      .post(api(fragment))
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send(payload);
  const get = (fragment: string, cookie = admin, organizationId = org) =>
    request(app.getHttpServer()).get(api(fragment, organizationId)).set('Cookie', cookie);
  const deliveries = (cycleId: string) => `assessment-cycles/${cycleId}/invite-deliveries`;
  const input = (count = 2) => ({ channel: 'MANUAL_CODE', count, idempotencyKey: randomUUID() });
  const invitationCount = (cycleId: string) =>
    db.client.assessmentInvite.count({
      where: { organizationId: org, cycleId },
    });

  async function session(role: 'ADMIN' | 'READER') {
    const user = await db.client.user.create({
      data: {
        name: 'Manual delivery fixture',
        email: `${randomUUID()}@example.test`,
        passwordHash: 'unused',
      },
    });
    await db.client.membership.create({ data: { organizationId: org, userId: user.id, role } });
    const token = randomBytes(32).toString('base64url');
    await db.client.session.create({
      data: {
        userId: user.id,
        activeOrganizationId: org,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    return { userId: user.id, cookie: `renr_session=${token}` };
  }

  async function openCycle() {
    const cycle = (
      await send('assessment-cycles', {
        name: 'Synthetic collection for manual delivery',
        assessmentGroupId: group,
        instrumentVersionId: instrument,
        policyVersionId: policy,
        startsAt: new Date(Date.now() - 60000).toISOString(),
        endsAt: new Date(Date.now() + 3600000).toISOString(),
      }).expect(201)
    ).body;
    await send(`assessment-cycles/${cycle.id}/open`, { expectedRevision: 1 }).expect(201);
    return cycle.id as string;
  }

  beforeAll(async () => {
    env = parseEnvironment({ ...process.env, NODE_ENV: 'test' });
    localDatabaseUrl(env.DATABASE_URL);
    const module = await Test.createTestingModule({
      imports: [AppModule.configure(env)],
    }).compile();
    db = module.get(PrismaService);
    app = module.createNestApplication();
    configureApplication(app, env);
    await app.init();

    org = (await db.client.organization.create({ data: { name: 'Manual delivery test' } })).id;
    admin = (await session('ADMIN')).cookie;
    hr = await session('READER');
    const unit = await db.client.unit.create({
      data: { organizationId: org, name: 'Synthetic unit', normalizedName: 'synthetic unit' },
    });
    const sector = await db.client.sector.create({
      data: {
        organizationId: org,
        unitId: unit.id,
        name: 'Synthetic sector',
        normalizedName: 'synthetic sector',
      },
    });
    group = (
      await db.client.assessmentGroup.create({
        data: { organizationId: org, sectorId: sector.id },
      })
    ).id;

    const created = (await send('instruments', { name: 'Manual delivery instrument' }).expect(201))
      .body;
    instrument = created.version.id;
    const versionPath = `instruments/${created.instrument.id}/versions/${instrument}`;
    await request(app.getHttpServer())
      .put(api(versionPath))
      .set('Cookie', admin)
      .set('Origin', env.CORS_ORIGIN)
      .send({
        expectedRevision: 1,
        title: 'Manual delivery instrument',
        description: '',
        instructions: '',
        usageMode: 'DEMONSTRATION',
        questions: [
          {
            id: randomUUID(),
            label: 'Sample collective question',
            type: 'ORDINAL_CHOICE',
            required: true,
            position: 1,
            options: [
              { id: randomUUID(), label: 'Option one', position: 1 },
              { id: randomUUID(), label: 'Option two', position: 2 },
            ],
          },
        ],
      })
      .expect(200);
    await send(`${versionPath}/publish`, { expectedRevision: 2 }).expect(201);
    policy = (
      await send('consolidation-policies', {
        usageMode: 'DEMONSTRATION',
        minimumResponses: 5,
      }).expect(201)
    ).body.id;
    await send(`consolidation-policies/${policy}/publish`, { expectedRevision: 1 }).expect(201);
  });

  afterAll(async () => {
    try {
      if (db && org) {
        await db.client.session.deleteMany({ where: { activeOrganizationId: org } });
        await db.client.membership.updateMany({
          where: { organizationId: org },
          data: { isActive: false },
        });
        await db.client.organization.update({ where: { id: org }, data: { isActive: false } });
      }
    } finally {
      await app?.close();
    }
  });

  it('requires an authenticated session before preparing a manual delivery', async () => {
    await request(app.getHttpServer())
      .post(api(`${deliveries(randomUUID())}/preview`))
      .set('Origin', env.CORS_ORIGIN)
      .send(input())
      .expect(401);
  });

  it('previews once, binds the count, and returns codes to only one concurrent confirmation', async () => {
    const cycle = await openCycle();
    const resource = deliveries(cycle);
    const payload = input();
    await send(`${resource}/preview`, { ...payload, channel: 'EMAIL' }).expect(400);
    await send(`${resource}/preview`, { ...payload, count: 21 }).expect(400);
    await send(`${resource}/preview`, {
      ...payload,
      recipients: ['never-stored@example.test'],
    }).expect(400);
    const first = await send(`${resource}/preview`, payload).expect(200);
    const operation = first.body;
    expect(first.headers['cache-control']).toBe('private, no-store');
    expect(operation).toMatchObject({
      channel: 'MANUAL_CODE',
      count: 2,
      status: 'PENDING_CONFIRMATION',
      issuedAt: null,
    });
    expect((await send(`${resource}/preview`, payload).expect(200)).body).toEqual(operation);
    await send(`${resource}/preview`, { ...payload, count: 3 }).expect(409);
    expect(await invitationCount(cycle)).toBe(0);

    const verify = `${resource}/${operation.id}/confirm`;
    const responses = await Promise.all([
      send(verify, {}).expect(200),
      send(verify, {}).expect(200),
    ]);
    const firstIssued = responses.find(({ body }) => body.requiresReview === false)!.body;
    const replay = responses.find(({ body }) => body.requiresReview === true)!.body;
    expect(firstIssued.invites).toHaveLength(2);
    expect(firstIssued.participationPath).toBe('/#/responder');
    expect(replay).toEqual({ ...firstIssued, invites: [], requiresReview: true });
    expect(await invitationCount(cycle)).toBe(2);

    const code = firstIssued.invites[0].code as string;
    await request(app.getHttpServer())
      .post('/api/v1/assessment-participation/access')
      .send({ inviteCode: code })
      .expect(201);
    const status = await get(`${resource}/${operation.id}`).expect(200);
    const history = await get(resource).expect(200);
    expect(status.body).toEqual(firstIssued.operation);
    expect(history.body).toEqual({ items: [firstIssued.operation] });
    expect(history.text).not.toContain(code);
    const events = await db.client.auditEvent.findMany({
      where: { organizationId: org, resourceId: operation.id },
    });
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain(code);
  });

  it('rolls back codes and operation state when the audit write fails', async () => {
    const cycle = await openCycle();
    const resource = deliveries(cycle);
    const operation = (await send(`${resource}/preview`, input()).expect(200)).body;
    const confirm = `${resource}/${operation.id}/confirm`;
    const client = db.client;
    const faultyClient = client.$extends({
      query: {
        auditEvent: {
          create({ args, query }) {
            if (args.data.resourceId === operation.id) throw new Error('Synthetic audit failure');
            return query(args);
          },
        },
      },
    });
    Object.defineProperty(db, 'client', { value: faultyClient });
    try {
      await send(confirm, {}).expect(500);
    } finally {
      Object.defineProperty(db, 'client', { value: client });
    }
    expect(await invitationCount(cycle)).toBe(0);
    expect((await get(`${resource}/${operation.id}`).expect(200)).body.status).toBe(
      'PENDING_CONFIRMATION',
    );
    expect((await send(confirm, {}).expect(200)).body.requiresReview).toBe(false);
    expect(await invitationCount(cycle)).toBe(2);
  });

  it('does not issue when the collection closes or the preview expires', async () => {
    const closedCycle = await openCycle();
    const expiryCycle = await openCycle();
    const closedResource = deliveries(closedCycle);
    const expiryResource = deliveries(expiryCycle);
    const closed = (await send(`${closedResource}/preview`, input()).expect(200)).body;
    const expired = (await send(`${expiryResource}/preview`, input()).expect(200)).body;
    await send(`assessment-cycles/${closedCycle}/close`, { expectedRevision: 2 }).expect(201);
    await db.client.assessmentInviteDelivery.update({
      where: { id: expired.id },
      data: { createdAt: new Date(Date.now() - 60000), expiresAt: new Date(Date.now() - 1000) },
    });
    await send(`${closedResource}/${closed.id}/confirm`, {}).expect(409);
    await send(`${expiryResource}/${expired.id}/confirm`, {}).expect(409);
    await send(`${closedResource}/preview`, input()).expect(409);
    expect((await get(`${closedResource}/${closed.id}`).expect(200)).body.status).toBe('CLOSED');
    expect((await get(`${expiryResource}/${expired.id}`).expect(200)).body.status).toBe('EXPIRED');
    expect(await invitationCount(closedCycle)).toBe(0);
    expect(await invitationCount(expiryCycle)).toBe(0);
  });

  it('requires an authorized actor and never discloses another actor or organization’s operations', async () => {
    const cycle = await openCycle();
    const resource = deliveries(cycle);
    const payload = input();
    await send(`${resource}/preview`, payload, hr.cookie).expect(403);
    await send(`${resource}/preview`, payload, admin, 'https://other.example.test').expect(403);
    const where = { userId_organizationId: { organizationId: org, userId: hr.userId } };
    await db.client.membership.update({
      where,
      data: { hrCapabilities: ['HR_ASSESSMENT_INVITES_ISSUE'] },
    });
    const operation = (await send(`${resource}/preview`, payload, hr.cookie).expect(200)).body;
    await get(`${resource}/${operation.id}`, admin).expect(404);
    await get(resource, admin, randomUUID()).expect(404);
    expect((await get(resource).expect(200)).body).toEqual({ items: [] });

    await db.client.membership.update({ where, data: { hrCapabilities: [] } });
    await send(`${resource}/${operation.id}/confirm`, {}, hr.cookie).expect(403);
    expect(await invitationCount(cycle)).toBe(0);
  });
});
