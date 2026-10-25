import 'dotenv/config';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';
import { hashPassword, verifyPassword } from '../src/modules/identity/password';
import { localDatabaseUrl } from './local-database-url';
import { IdentityService } from '../src/modules/identity/identity.service';
import type { Request } from 'express';

const describeDatabase = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
describeDatabase('Organization access with PostgreSQL', () => {
  const env = parseEnvironment({ ...process.env, NODE_ENV: 'test' });
  localDatabaseUrl(env.DATABASE_URL);
  const prefix = randomUUID();
  const password = 'synthetic-access-password';
  let app: INestApplication;
  let db: PrismaService;
  let org: string;
  let foreign: string;
  let admin: string;
  let reader: string;
  let adminCookie: string;
  let readerCookie: string;
  let identity: IdentityService;
  const path = (resource: string) => `/api/v1/organizations/${org}/${resource}`;
  const get = (resource: string, cookie = adminCookie) =>
    request(app.getHttpServer()).get(path(resource)).set('Cookie', cookie);
  const post = (resource: string, body: object, cookie = adminCookie) =>
    request(app.getHttpServer())
      .post(path(resource))
      .set('Origin', env.CORS_ORIGIN)
      .set('Cookie', cookie)
      .send(body);
  const patch = (id: string, body: object, cookie = adminCookie) =>
    request(app.getHttpServer())
      .patch(path(`access-memberships/${id}`))
      .set('Origin', env.CORS_ORIGIN)
      .set('Cookie', cookie)
      .send(body);
  const grant = (id: string, version: number, capabilities: string[]) =>
    request(app.getHttpServer())
      .put(path(`access-memberships/${id}/capabilities`))
      .set('Origin', env.CORS_ORIGIN)
      .set('Cookie', adminCookie)
      .send({ expectedVersion: version, capabilities, reason: 'Synthetic authorization' });
  const accept = (token: string, data: object = {}, cookie?: string) => {
    const call = request(app.getHttpServer())
      .post('/api/v1/access-invites/accept')
      .set('Origin', env.CORS_ORIGIN);
    if (cookie) call.set('Cookie', cookie);
    return call.send({ token, ...data });
  };
  const invite = (email: string, extra: object = {}) =>
    post('access-invites', {
      email,
      name: 'Invited user',
      role: 'READER',
      capabilities: [],
      reason: 'Synthetic onboarding',
      ...extra,
    });
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule.configure(env)],
    }).compile();
    db = module.get(PrismaService);
    identity = module.get(IdentityService);
    const encoded = await hashPassword(password);
    const a = await db.client.user.create({
      data: {
        name: 'Synthetic author',
        email: `admin-${prefix}@example.test`,
        passwordHash: encoded,
      },
    });
    const r = await db.client.user.create({
      data: {
        name: 'Synthetic reader',
        email: `reader-${prefix}@example.test`,
        passwordHash: encoded,
      },
    });
    admin = a.id;
    reader = r.id;
    org = (
      await db.client.organization.create({
        data: {
          name: prefix,
          memberships: {
            create: [
              { userId: admin, role: 'ADMIN' },
              { userId: reader, role: 'READER' },
            ],
          },
        },
      })
    ).id;
    foreign = (
      await db.client.organization.create({
        data: {
          name: `Foreign ${prefix}`,
          memberships: { create: { userId: reader, role: 'ADMIN' } },
        },
      })
    ).id;
    app = module.createNestApplication();
    configureApplication(app, env);
    await app.init();
    const login = async (email: string, organizationId: string) => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/sessions')
        .set('Origin', env.CORS_ORIGIN)
        .send({ email, password })
        .expect(201);
      const cookie = response.headers['set-cookie']?.[0]?.split(';')[0];
      if (!cookie) throw new Error('Expected session cookie');
      await request(app.getHttpServer())
        .put('/api/v1/auth/session/organization')
        .set('Origin', env.CORS_ORIGIN)
        .set('Cookie', cookie)
        .send({ organizationId })
        .expect(200);
      return cookie;
    };
    adminCookie = await login(a.email, org);
    readerCookie = await login(r.email, org);
  }, 30000);
  afterAll(async () => {
    if (db) {
      // New histories intentionally retain authors. Delete only this suite's synthetic tenant data.
      await db.client
        .$executeRaw`DELETE FROM access_history WHERE organization_id IN (${org}::uuid, ${foreign}::uuid)`;
      await db.client
        .$executeRaw`DELETE FROM access_invites WHERE organization_id IN (${org}::uuid, ${foreign}::uuid)`;
      await db.client.auditEvent.deleteMany({ where: { organizationId: { in: [org, foreign] } } });
      await db.client.organization.deleteMany({ where: { id: { in: [org, foreign] } } });
      await db.client.auditEvent.deleteMany({ where: { actorId: { in: [admin, reader] } } });
      await db.client.user.deleteMany({ where: { email: { contains: prefix } } });
    }
    if (app) await app.close();
  });
  it('lists only administrative tenant access and separates legacy sessions from capabilities', async () => {
    const result = await get('access-memberships').expect(200);
    expect(result.body.total).toBe(2);
    expect((await get(`access-memberships/${reader}`).expect(200)).body.userId).toBe(reader);
    await get(`access-memberships/${reader}`, readerCookie).expect(403);
    expect(result.body.items.find((i: { userId: string }) => i.userId === admin)).toMatchObject({
      role: 'ADMIN',
      capabilities: [],
      version: 1,
      isActive: true,
    });
    expect(JSON.stringify(result.body)).not.toMatch(/passwordHash|tokenHash/);
    await get('access-memberships', readerCookie).expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/organizations/${foreign}/access-memberships`)
      .set('Cookie', adminCookie)
      .expect(404);
    const legacy = await request(app.getHttpServer())
      .get('/api/v1/auth/session')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(Object.keys(legacy.body).sort()).toEqual([
      'activeOrganizationId',
      'expiresAt',
      'memberships',
      'user',
    ]);
  });
  it('versions capability grants and revocations with legible immutable history', async () => {
    await grant(reader, 1, ['TECHNICAL_DECISIONS', 'EXECUTE_ASSIGNED_ACTIONS']).expect(200);
    const capabilities = () =>
      request(app.getHttpServer())
        .get('/api/v1/auth/session-capabilities')
        .set('Cookie', readerCookie);
    expect((await capabilities().expect(200)).body.capabilities).toContain('TECHNICAL_DECISIONS');
    const recipientRequest = { headers: { cookie: readerCookie } } as Request;
    expect(
      await identity.assignedActionScope(recipientRequest, org, {
        organizationId: org,
        assignedUserId: reader,
      }),
    ).toEqual({ organizationId: org, userId: reader });
    await expect(
      identity.assignedActionScope(recipientRequest, org, {
        organizationId: org,
        assignedUserId: admin,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      identity.assignedActionScope(recipientRequest, org, {
        organizationId: foreign,
        assignedUserId: reader,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await request(app.getHttpServer())
      .post(path('risks'))
      .set('Cookie', readerCookie)
      .set('Origin', env.CORS_ORIGIN)
      .send({})
      .expect(403);
    await grant(reader, 1, []).expect(409);
    await grant(reader, 2, []).expect(200);
    expect((await capabilities().expect(200)).body.capabilities).toEqual([]);
    await expect(
      identity.assignedActionScope(recipientRequest, org, {
        organizationId: org,
        assignedUserId: reader,
      }),
    ).rejects.toMatchObject({ status: 403 });
    const history = await get('access-history').expect(200);
    expect(history.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'ACCESS_CAPABILITY_GRANTED:TECHNICAL_DECISIONS',
          actor: { id: admin, name: 'Synthetic author' },
        }),
        expect.objectContaining({ action: 'ACCESS_CAPABILITY_REVOKED:TECHNICAL_DECISIONS' }),
      ]),
    );
  });
  it('rejects removal of last administrator including concurrent self demotions', async () => {
    await patch(admin, { expectedVersion: 1, role: 'READER', reason: 'Synthetic demotion' }).expect(
      409,
    );
    await patch(reader, {
      expectedVersion: 3,
      role: 'ADMIN',
      reason: 'Synthetic second admin',
    }).expect(200);
    const outcomes = await Promise.all([
      patch(admin, { expectedVersion: 1, role: 'READER', reason: 'Concurrent demotion' }),
      patch(
        reader,
        { expectedVersion: 4, role: 'READER', reason: 'Concurrent demotion' },
        readerCookie,
      ),
    ]);
    expect(outcomes.map((r) => r.status).sort()).toEqual([200, 409]);
    const remaining = await db.client.membership.findMany({
      where: { organizationId: org, role: 'ADMIN' },
    });
    expect(remaining).toHaveLength(1);
    // Restore both actors for subsequent independent invitation scenarios.
    await db.client.membership.updateMany({
      where: { organizationId: org },
      data: { role: 'ADMIN' },
    });
  });
  it('deactivates only the tenant membership and preserves user and recorded authorship', async () => {
    const member = await db.client.membership.findUniqueOrThrow({
      where: { userId_organizationId: { userId: reader, organizationId: org } },
    });
    await patch(reader, {
      expectedVersion: (member as { version: number }).version,
      isActive: false,
      reason: 'Synthetic deactivation',
    }).expect(200);
    expect(
      await db.client.session.count({ where: { userId: reader, activeOrganizationId: org } }),
    ).toBe(0);
    await get('access-memberships', readerCookie).expect(404);
    const legacy = await request(app.getHttpServer())
      .get('/api/v1/auth/session')
      .set('Cookie', readerCookie)
      .expect(200);
    expect(legacy.body.activeOrganizationId).toBe(null);
    expect(
      legacy.body.memberships.map((m: { organizationId: string }) => m.organizationId),
    ).toEqual([foreign]);
    await request(app.getHttpServer())
      .put('/api/v1/auth/session/organization')
      .set('Origin', env.CORS_ORIGIN)
      .set('Cookie', readerCookie)
      .send({ organizationId: foreign })
      .expect(200);
    expect(await db.client.user.count({ where: { id: reader } })).toBe(1);
  });
  it('accepts a new identity once without persisting or listing invitation secrets', async () => {
    const created = await invite(`new-${prefix}@example.test`, {
      capabilities: ['EXECUTE_ASSIGNED_ACTIONS'],
    }).expect(201);
    const token = created.body.token;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify((await get('access-invites').expect(200)).body)).not.toContain(token);
    const outcomes = await Promise.all([
      accept(token, { name: 'New identity', password }),
      accept(token, { name: 'New identity', password }),
    ]);
    expect(outcomes.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(outcomes.find((r) => r.status === 409)?.body.code).toBe('ACCESS_INVITE_UNAVAILABLE');
    const createdUser = await db.client.user.findUniqueOrThrow({
      where: { email: `new-${prefix}@example.test` },
    });
    expect(await verifyPassword(password, createdUser.passwordHash)).toBe(true);
    expect(JSON.stringify((await get('access-history').expect(200)).body)).not.toContain(token);
  });
  it('requires the same authenticated identity and never replaces an existing password', async () => {
    const created = await invite(`reader-${prefix}@example.test`).expect(201);
    const before = await db.client.user.findUniqueOrThrow({ where: { id: reader } });
    await accept(created.body.token).expect(401);
    await accept(created.body.token, {}, adminCookie).expect(403);
    await accept(created.body.token, { password: 'replacement-not-allowed' }, readerCookie).expect(
      400,
    );
    await accept(created.body.token, {}, readerCookie).expect(201);
    const after = await db.client.user.findUniqueOrThrow({ where: { id: reader } });
    expect(after.passwordHash).toBe(before.passwordHash);
    const redundant = await invite(`reader-${prefix}@example.test`).expect(201);
    const collision = await accept(redundant.body.token, {}, readerCookie).expect(409);
    expect(collision.body.code).toBe('CONFLICT');
  });
  it('rejects expired, revoked and replaced invitations and optimistic conflicts', async () => {
    const unavailable = await accept('z'.repeat(43)).expect(409);
    expect(unavailable.body.code).toBe('ACCESS_INVITE_UNAVAILABLE');
    const expired = await invite(`expired-${prefix}@example.test`).expect(201);
    await db.client
      .$executeRaw`UPDATE access_invites SET expires_at = now() - interval '1 minute' WHERE id = ${expired.body.invite.id}::uuid`;
    const expiredResponse = await accept(expired.body.token, { name: 'Expired', password }).expect(
      409,
    );
    expect(expiredResponse.body.code).toBe('ACCESS_INVITE_UNAVAILABLE');
    const revoked = await invite(`revoked-${prefix}@example.test`).expect(201);
    await post(`access-invites/${revoked.body.invite.id}/revoke`, {
      expectedVersion: 9,
      reason: 'Wrong version',
    }).expect(409);
    await post(`access-invites/${revoked.body.invite.id}/revoke`, {
      expectedVersion: 1,
      reason: 'Synthetic cancellation',
    }).expect(201);
    const revokedResponse = await accept(revoked.body.token, { name: 'Revoked', password }).expect(
      409,
    );
    expect(revokedResponse.body.code).toBe('ACCESS_INVITE_UNAVAILABLE');
    const reissued = await post(`access-invites/${expired.body.invite.id}/reissue`, {
      expectedVersion: 1,
      reason: 'Synthetic replacement',
    }).expect(201);
    await accept(expired.body.token, { name: 'Expired', password }).expect(409);
    await accept(reissued.body.token, { name: 'Replacement', password }).expect(201);
  });
});
