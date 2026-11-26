import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { INestApplication } from '@nestjs/common';
import { passwordRecoveryIssuedSchema, type PlatformCapability } from '@renr/contracts';
import request from 'supertest';
import { createApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';
import { hashPassword, verifyPassword } from '../src/modules/identity/password';
import { PasswordRecoveryService } from '../src/modules/identity/password-recovery.service';
import { localDatabaseUrl } from './local-database-url';

const describeDb =
  process.env.RUN_DB_TESTS === '1' && Boolean(process.env.DATABASE_URL) ? describe : describe.skip;
const origin = 'http://127.0.0.1:5173';
const auth = '/api/v1/auth';
const recovery = auth + '/recovery';
const global = '/api/v1/platform/password-recoveries';
const company = (id: string) => '/api/v1/organizations/' + id + '/password-recoveries';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const priorPassword = 'id52-password-before';
const newPassword = 'id52-password-after';

describeDb('ID 52 password recovery on PostgreSQL', () => {
  let app: INestApplication;
  let db: PrismaService;
  let firstCompany: string;
  let otherCompany: string;
  let passwordHash: string;
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);

  beforeAll(async () => {
    const env = parseEnvironment({
      ...process.env,
      NODE_ENV: 'test',
      CORS_ORIGIN: origin,
      PASSWORD_RECOVERY_ASSISTED_ENABLED: 'true',
      STORAGE_ENABLED: 'false',
    });
    localDatabaseUrl(env.DATABASE_URL);
    app = await createApplication(env);
    await app.init();
    db = app.get(PrismaService);
    passwordHash = await hashPassword(priorPassword);
    const first = await db.client.organization.create({ data: { name: 'ID52 A ' + suffix } });
    const second = await db.client.organization.create({ data: { name: 'ID52 B ' + suffix } });
    firstCompany = first.id;
    otherCompany = second.id;
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  async function account(
    key: string,
    options: {
      organizationId?: string;
      extraOrganizationId?: string;
      role?: 'ADMIN' | 'READER';
      scopeRestricted?: boolean;
      grants?: PlatformCapability[];
    } = {},
  ) {
    const user = await db.client.user.create({
      data: {
        email: 'id52-' + key + '-' + suffix + '@renr.example',
        name: 'Account ' + key,
        passwordHash,
        platformGrants: { create: options.grants?.map((capability) => ({ capability })) ?? [] },
        memberships: {
          create: [
            ...(options.organizationId
              ? [
                  {
                    organizationId: options.organizationId,
                    role: options.role ?? ('READER' as const),
                    scopeRestricted: options.scopeRestricted ?? false,
                  },
                ]
              : []),
            ...(options.extraOrganizationId
              ? [
                  {
                    organizationId: options.extraOrganizationId,
                    role: 'READER' as const,
                    isActive: false,
                  },
                ]
              : []),
          ],
        },
      },
    });
    const token = randomBytes(32).toString('base64url');
    const session = await db.client.session.create({
      data: {
        tokenHash: digest(token),
        userId: user.id,
        activeOrganizationId: options.organizationId ?? null,
        expiresAt: new Date(Date.now() + 300_000),
      },
    });
    return { ...user, sessionId: session.id, cookie: 'renr_session=' + token };
  }
  const issue = (path: string, cookie: string, email: string, reference = 'RH-52-421') =>
    request(app.getHttpServer())
      .post(path)
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({ email, verificationConfirmed: true, verificationReference: reference });
  const status = (token: string) =>
    request(app.getHttpServer())
      .post(recovery + '/status')
      .set('Origin', origin)
      .send({ token });
  const confirm = (token: string, cookie?: string) =>
    request(app.getHttpServer())
      .post(recovery + '/confirm')
      .set('Origin', origin)
      .set('Cookie', cookie ?? '')
      .send({ token, password: newPassword });
  const current = (cookie: string) =>
    request(app.getHttpServer())
      .get(auth + '/session')
      .set('Cookie', cookie);
  const login = (email: string, password: string) =>
    request(app.getHttpServer())
      .post(auth + '/sessions')
      .set('Origin', origin)
      .send({ email, password });

  it('requires named authority and confines enterprise recovery to accounts belonging only to that company', async () => {
    const localOperator = await account('local-operator', {
      organizationId: firstCompany,
      role: 'ADMIN',
      grants: ['ASSIST_COMPANY_PASSWORD_RECOVERY'],
    });
    const unrestrictedWithNoGrant = await account('admin-no-grant', {
      organizationId: firstCompany,
      role: 'ADMIN',
    });
    const delegated = await account('delegated-operator', {
      organizationId: firstCompany,
      role: 'ADMIN',
      scopeRestricted: true,
      grants: ['ASSIST_COMPANY_PASSWORD_RECOVERY'],
    });
    const globalOperator = await account('global-operator', {
      grants: ['MANAGE_PASSWORD_RECOVERY'],
    });
    const single = await account('local-target', { organizationId: firstCompany });
    const other = await account('other-target', { organizationId: otherCompany });
    const shared = await account('multi-company-target', {
      organizationId: firstCompany,
      extraOrganizationId: otherCompany,
    });
    const globalUser = await account('platform-target', {
      organizationId: firstCompany,
      grants: ['READ_OVERVIEW'],
    });
    const groupUser = await account('group-target', { organizationId: firstCompany });
    await db.client.companyGroup.create({
      data: { name: 'ID52 group ' + suffix, grants: { create: { userId: groupUser.id } } },
    });
    const http = request(app.getHttpServer());
    for (const email of [single.email, 'unknown-' + suffix + '@renr.example']) {
      await http
        .post(recovery + '/requests')
        .set('Origin', origin)
        .send({ email })
        .expect(202, { accepted: true });
    }
    expect(await db.client.passwordRecovery.count({ where: { userId: single.id } })).toBe(0);
    await current(single.cookie).expect(200);

    await issue(company(firstCompany), unrestrictedWithNoGrant.cookie, single.email).expect(403);
    await issue(company(firstCompany), delegated.cookie, single.email).expect(403);
    await issue(company(otherCompany), localOperator.cookie, other.email).expect(404);
    await issue(global, localOperator.cookie, single.email).expect(403);
    await issue(company(firstCompany), localOperator.cookie, localOperator.email).expect(403);
    for (const protectedUser of [other, shared, globalUser, groupUser]) {
      await issue(company(firstCompany), localOperator.cookie, protectedUser.email).expect(403);
    }
    await issue(company(firstCompany), localOperator.cookie, single.email).expect(201);
    const globalIssue = await issue(global, globalOperator.cookie, globalUser.email).expect(201);
    const { token } = passwordRecoveryIssuedSchema.parse(globalIssue.body);
    await confirm(token).expect(200, { changed: true });
    const grant = await db.client.platformGrant.findUniqueOrThrow({
      where: { userId_capability: { userId: globalUser.id, capability: 'READ_OVERVIEW' } },
    });
    expect(grant.isActive).toBe(true);
  }, 30_000);

  it('revokes the previous link, consumes exactly once, clears the browser cookie and invalidates prior sessions', async () => {
    const operator = await account('rotation-operator', {
      organizationId: firstCompany,
      role: 'ADMIN',
      grants: ['ASSIST_COMPANY_PASSWORD_RECOVERY'],
    });
    const member = await account('rotation-target', { organizationId: firstCompany });
    const first = passwordRecoveryIssuedSchema.parse(
      (await issue(company(firstCompany), operator.cookie, member.email).expect(201)).body,
    );
    const secondIssue = await issue(company(firstCompany), operator.cookie, member.email)
      .expect('Cache-Control', 'private, no-store')
      .expect(201);
    const second = passwordRecoveryIssuedSchema.parse(secondIssue.body);
    const issued = await db.client.passwordRecovery.findUniqueOrThrow({
      where: { tokenHash: digest(second.token) },
    });
    expect(issued).toMatchObject({
      tokenHash: digest(second.token),
      purpose: 'PASSWORD_RESET',
      issuerId: operator.id,
      verificationReference: 'RH-52-421',
      policyVersion: 'id52-assist-v1',
    });
    expect(issued.expiresAt.getTime() - issued.issuedAt.getTime()).toBe(30 * 60 * 1000);
    await status(first.token).expect(200, { available: false });
    await status(second.token).expect(200, { available: true });
    const disabled = new PasswordRecoveryService(
      db,
      parseEnvironment({
        ...process.env,
        NODE_ENV: 'test',
        CORS_ORIGIN: origin,
        PASSWORD_RECOVERY_ASSISTED_ENABLED: 'false',
        STORAGE_ENABLED: 'false',
      }),
    );
    await expect(disabled.status('127.0.0.1', second.token)).resolves.toEqual({ available: false });
    await expect(disabled.confirm('127.0.0.1', second.token, newPassword)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      disabled.issue({ id: operator.sessionId, userId: operator.id }, firstCompany, {
        email: member.email,
        verificationReference: 'RH-52-422',
      }),
    ).rejects.toMatchObject({ status: 503 });
    await current(member.cookie).expect(200);
    await login(member.email, priorPassword).expect(201);
    expect(await db.client.session.count({ where: { userId: member.id } })).toBe(2);
    const raced = await Promise.all([confirm(second.token, member.cookie), confirm(second.token)]);
    expect(raced.map((item) => item.status).sort()).toEqual([200, 404]);
    const success = raced.find((item) => item.status === 200);
    expect(success?.body).toEqual({ changed: true });
    expect(success?.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringMatching(/^renr_session=; Path=\/api\/v1;/)]),
    );
    await status(second.token).expect(200, { available: false });
    await confirm(second.token).expect(404);
    await current(member.cookie).expect(401);
    await current(operator.cookie).expect(200);
    expect(await db.client.session.count({ where: { userId: member.id } })).toBe(0);
    await login(member.email, priorPassword).expect(401);
    await login(member.email, newPassword).expect(201);
    const events = await db.client.auditEvent.findMany({ where: { resourceId: issued.id } });
    expect(events.map((event) => event.action).sort()).toEqual([
      'AUTH_PASSWORD_RECOVERY_CONFIRMED',
      'AUTH_PASSWORD_RECOVERY_ISSUED',
    ]);
    expect(JSON.stringify(events)).not.toContain(second.token);
    expect(await db.client.membership.count({ where: { userId: member.id, isActive: true } })).toBe(
      1,
    );
    expect(
      (await db.client.passwordRecovery.findUniqueOrThrow({ where: { id: issued.id } })).consumedAt,
    ).toBeInstanceOf(Date);
  }, 30_000);

  it('refuses expired links and rechecks both target scope and issuer authority before password changes', async () => {
    const operator = await account('change-operator', {
      organizationId: firstCompany,
      role: 'ADMIN',
      grants: ['ASSIST_COMPANY_PASSWORD_RECOVERY'],
    });
    const expired = await account('expired-target', { organizationId: firstCompany });
    const moved = await account('moved-target', { organizationId: firstCompany });
    const revoked = await account('revoked-operator-target', { organizationId: firstCompany });
    async function open(email: string) {
      return passwordRecoveryIssuedSchema.parse(
        (await issue(company(firstCompany), operator.cookie, email).expect(201)).body,
      ).token;
    }
    const first = await open(expired.email);
    await db.client.passwordRecovery.update({
      where: { tokenHash: digest(first) },
      data: { issuedAt: new Date(Date.now() - 120_000), expiresAt: new Date(Date.now() - 60_000) },
    });
    const second = await open(moved.email);
    await db.client.companyGroup.create({
      data: { name: 'ID52 moved ' + suffix, grants: { create: { userId: moved.id } } },
    });
    const third = await open(revoked.email);
    for (const token of [first, second]) {
      await status(token).expect(200, { available: false });
      await confirm(token).expect(404);
    }
    await status(third).expect(200, { available: true });
    await db.client.platformGrant.update({
      where: {
        userId_capability: { userId: operator.id, capability: 'ASSIST_COMPANY_PASSWORD_RECOVERY' },
      },
      data: { isActive: false, version: { increment: 1 } },
    });
    await status(third).expect(200, { available: false });
    await confirm(third).expect(404);
    await current(expired.cookie).expect(200);
    await current(moved.cookie).expect(200);
    await current(revoked.cookie).expect(200);
  }, 30_000);

  it('rolls back consumption and password if revoking the previous session fails', async () => {
    const operator = await account('rollback-operator', { grants: ['MANAGE_PASSWORD_RECOVERY'] });
    const member = await account('rollback-target', { organizationId: firstCompany });
    const { token } = passwordRecoveryIssuedSchema.parse(
      (await issue(global, operator.cookie, member.email).expect(201)).body,
    );
    // These SQL identifiers and the scoped account ID are created by this test only.
    const fail = 'id52_fail_session_' + suffix;
    await db.client.$executeRawUnsafe(
      'CREATE FUNCTION ' +
        fail +
        "() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'id52 transaction fixture'; END; $$",
    );
    try {
      await db.client.$executeRawUnsafe(
        'CREATE TRIGGER ' +
          fail +
          " BEFORE DELETE ON sessions FOR EACH ROW WHEN (OLD.user_id = '" +
          member.id +
          "'::uuid) EXECUTE FUNCTION " +
          fail +
          '()',
      );
      await confirm(token).expect(500);
      await status(token).expect(200, { available: true });
      await current(member.cookie).expect(200);
      const preserved = await db.client.user.findUniqueOrThrow({ where: { id: member.id } });
      expect(await verifyPassword(priorPassword, preserved.passwordHash)).toBe(true);
    } finally {
      await db.client.$executeRawUnsafe('DROP TRIGGER IF EXISTS ' + fail + ' ON sessions');
      await db.client.$executeRawUnsafe('DROP FUNCTION ' + fail + '()');
    }
    await confirm(token).expect(200, { changed: true });
    await current(member.cookie).expect(401);
  }, 30_000);

  it('denies a queued recovery issue after revoking its issuer session', async () => {
    const operator = await account('issue-race-operator', { grants: ['MANAGE_PASSWORD_RECOVERY'] });
    const member = await account('issue-race-target');
    const response = await db.client.$transaction(async (tx) => {
      const [holder] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      if (!holder) throw new Error('Test lock owner not found');
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('renr-platform-access'))::text`;
      const queuedIssue = issue(global, operator.cookie, member.email).then((result) => result);
      const timeoutAt = Date.now() + 2_000;
      let reachedLock = false;
      while (!reachedLock && Date.now() < timeoutAt) {
        const [waiting] = await db.client.$queryRaw<{ blocked: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE ${holder.pid}::integer = ANY(pg_blocking_pids(pid))
          ) AS blocked
        `;
        reachedLock = Boolean(waiting?.blocked);
        if (!reachedLock) await delay(10);
      }
      expect(reachedLock).toBe(true);
      await tx.session.deleteMany({ where: { userId: operator.id } });
      return { queuedIssue };
    });

    expect((await response.queuedIssue).status).toBe(401);
    expect(await db.client.passwordRecovery.count({ where: { userId: member.id } })).toBe(0);
  }, 30_000);

  it('rejects an old password verified immediately before an atomic credential update', async () => {
    const member = await account('login-race-target');
    const replacement = await hashPassword(newPassword);
    const response = await db.client.$transaction(async (tx) => {
      const [holder] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      if (!holder) throw new Error('Test lock owner not found');
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${member.id}::uuid FOR UPDATE`;
      const oldLogin = login(member.email, priorPassword).then((result) => result);
      // A blocked login has already checked the old hash and is trying to create its session.
      const timeoutAt = Date.now() + 1_400;
      let reachedLock = false;
      while (!reachedLock && Date.now() < timeoutAt) {
        const [waiting] = await db.client.$queryRaw<{ blocked: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE ${holder.pid}::integer = ANY(pg_blocking_pids(pid))
          ) AS blocked
        `;
        reachedLock = Boolean(waiting?.blocked);
        if (!reachedLock) await delay(10);
      }
      expect(reachedLock).toBe(true);
      await tx.user.update({ where: { id: member.id }, data: { passwordHash: replacement } });
      await tx.session.deleteMany({ where: { userId: member.id } });
      // Return a container so the transaction commits before awaiting the blocked request.
      return { oldLogin };
    });
    expect((await response.oldLogin).status).toBe(401);
    expect(await db.client.session.count({ where: { userId: member.id } })).toBe(0);
    await login(member.email, newPassword).expect(201);
  }, 30_000);
});
