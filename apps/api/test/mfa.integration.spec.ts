import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Logger, type INestApplication } from '@nestjs/common';
import { Secret, TOTP } from 'otpauth';
import request from 'supertest';
import { createApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';
import { CompanyGroupsService } from '../src/modules/company-groups/company-groups.service';
import { hashPassword } from '../src/modules/identity/password';
import { localDatabaseUrl } from './local-database-url';

const describeDb =
  process.env.RUN_DB_TESTS === '1' && Boolean(process.env.DATABASE_URL) ? describe : describe.skip;
const origin = 'http://127.0.0.1:5173';
const auth = '/api/v1/auth';
const platformRecovery = '/api/v1/platform/mfa-recoveries';
const password = 'id53-integration-password';
jest.setTimeout(20_000);

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const cookies = (response: request.Response): string[] =>
  [response.headers['set-cookie'] ?? []].flat();
const cookie = (response: request.Response, name: string): string =>
  cookies(response)
    .find((value) => value.startsWith(name + '='))
    ?.split(';')[0] ?? '';

function gate<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describeDb('ID 53 MFA with HTTP and PostgreSQL', () => {
  let app: INestApplication;
  let db: PrismaService;
  let passwordHash: string;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    const env = parseEnvironment({
      ...process.env,
      NODE_ENV: 'test',
      CORS_ORIGIN: origin,
      MFA_REQUIRE_GLOBAL_ADMINS: 'true',
      MFA_ENCRYPTION_KEY: randomBytes(32).toString('base64url'),
      STORAGE_ENABLED: 'false',
      PASSWORD_RECOVERY_ASSISTED_ENABLED: 'true',
    });
    localDatabaseUrl(env.DATABASE_URL);
    app = await createApplication(env);
    await app.init();
    db = app.get(PrismaService);
    passwordHash = await hashPassword(password);
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  async function account(manageGrants = false) {
    return db.client.user.create({
      data: {
        email: 'id53-' + randomUUID() + '@renr.example',
        name: 'ID 53 fixture',
        passwordHash,
        ...(manageGrants ? { platformGrants: { create: { capability: 'MANAGE_GRANTS' } } } : {}),
      },
    });
  }

  const post = (path: string, body: object, credential?: string) =>
    request(app.getHttpServer())
      .post(path)
      .set('Origin', origin)
      .set('Cookie', credential ?? '')
      .send(body);
  const current = (credential: string) =>
    request(app.getHttpServer())
      .get(auth + '/session')
      .set('Cookie', credential);
  const logIn = (email: string) => post(auth + '/sessions', { email, password });
  const code = (manualKey: string, timestamp = Date.now()) =>
    TOTP.generate({ secret: Secret.fromBase32(manualKey), timestamp });

  async function enroll(email: string) {
    const login = await logIn(email).expect(201);
    const challenge = cookie(login, 'renr_mfa_challenge');
    const pending = await post(auth + '/mfa/enrollment', { kind: 'login' }, challenge).expect(201);
    const manualKey: string = pending.body.manualKey;
    expect(manualKey).toMatch(/^[A-Z2-7]{32}$/);
    expect(pending.body.qrCodeDataUrl).toMatch(/^data:image\/png;base64,iVBOR/);
    const confirmed = await post(
      auth + '/mfa/enrollment/confirm',
      { kind: 'login', code: code(manualKey, Date.now() - 30_000) },
      challenge,
    ).expect(201);
    return { manualKey, confirmed };
  }

  const publishRecovery = (email: string, credential: string, path = platformRecovery) =>
    post(
      path,
      { email, verificationConfirmed: true, verificationReference: 'ID53-OPS-1' },
      credential,
    );
  const asSession = (response: request.Response) => cookie(response, 'renr_session');
  const asChallenge = (response: request.Response) => cookie(response, 'renr_mfa_challenge');
  const beginAssisted = (email: string, token: string) =>
    post(auth + '/mfa/recover', { email, password, token });
  const submitProof = (challenge: string, method: string, value: string) =>
    post(auth + '/mfa/login', { method, code: value }, challenge);

  it('issues only an isolated challenge after a privileged user submits the password', async () => {
    const user = await account(true);
    const response = await logIn(user.email).expect(201);
    expect(response.body).toEqual({ kind: 'mfa-required', mode: 'enroll' });
    expect(cookie(response, 'renr_session')).toBe('');
    expect(cookies(response)).toEqual([
      expect.stringMatching(
        /^renr_mfa_challenge=.+; Path=\/api\/v1\/auth\/mfa;.+; HttpOnly; SameSite=Lax$/,
      ),
    ]);
    await current(cookie(response, 'renr_mfa_challenge')).expect(401);
    expect(await db.client.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it('denies an authenticated account with no MFA-recovery authority', async () => {
    const user = await account();
    const subject = await account(true);
    const oldSession = await logIn(user.email).expect(201);
    await post(
      platformRecovery,
      { email: subject.email, verificationConfirmed: true, verificationReference: 'ID53-OPS-1' },
      cookie(oldSession, 'renr_session'),
    ).expect(403);
  });

  it('keeps the same enrollment secret across retried requests until the enrollment is canceled', async () => {
    const user = await account(true);
    const challenge = asChallenge(await logIn(user.email).expect(201));
    const start = () => post(auth + '/mfa/enrollment', { kind: 'login' }, challenge).expect(201);
    const [first, retried] = await Promise.all([start(), start()]);
    expect(digest(first.body.manualKey)).toBe(digest(retried.body.manualKey));
    expect(digest(first.body.qrCodeDataUrl)).toBe(digest(retried.body.qrCodeDataUrl));
    expect(first.body.expiresAt).toBe(retried.body.expiresAt);
    await post(auth + '/mfa/enrollment/cancel', { kind: 'login' }, challenge).expect(204);
    expect(digest((await start()).body.manualKey)).not.toBe(digest(first.body.manualKey));
  });

  it('denies a preexisting password-only session as soon as the user receives MANAGE_GRANTS', async () => {
    const user = await account();
    const oldSession = await logIn(user.email).expect(201);
    await db.client.platformGrant.create({
      data: { userId: user.id, capability: 'MANAGE_GRANTS' },
    });
    const revoked = await current(asSession(oldSession)).expect(401);
    expect(revoked.body.code).toBe('AUTH_MFA_REAUTH_REQUIRED');
    await request(app.getHttpServer())
      .get('/api/v1/platform/grants')
      .set('Cookie', asSession(oldSession))
      .expect(401);
  });

  it('revalidates group-management reads and writes when MANAGE_GRANTS is added in flight', async () => {
    const user = await account();
    const recipient = await account();
    const group = await db.client.companyGroup.create({ data: { name: 'ID 53 Grant Race' } });
    const oldSession = asSession(await logIn(user.email).expect(201));
    const groupPath = '/api/v1/platform/company-groups';
    const grantsPath = groupPath + '/' + group.id + '/grants';
    const service = app.get(CompanyGroupsService);
    const priorGrants = service.grants.bind(service);
    const priorManagement = service.management.bind(service);
    const priorWrite = service.writeGrant.bind(service);
    const atGrants = gate();
    const atManagement = gate();
    const atWrite = gate();
    const releaseReads = gate();
    const grants = jest.spyOn(service, 'grants').mockImplementationOnce(async (...args) => {
      atGrants.resolve();
      await releaseReads.promise;
      return priorGrants(...args);
    });
    const management = jest.spyOn(service, 'management').mockImplementationOnce(async (...args) => {
      atManagement.resolve();
      await releaseReads.promise;
      return priorManagement(...args);
    });
    const write = jest.spyOn(service, 'writeGrant').mockImplementationOnce((...args) => {
      atWrite.resolve();
      return priorWrite(...args);
    });
    const lockAcquired = gate<number>();
    const releaseWrite = gate();
    const blocker = db.client.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('renr-platform-access'))::text`;
        const [connection] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        if (!connection) throw new Error('Missing PostgreSQL connection');
        lockAcquired.resolve(connection.pid);
        await releaseWrite.promise;
        await tx.platformGrant.create({ data: { userId: user.id, capability: 'MANAGE_GRANTS' } });
      },
      { timeout: 8_000 },
    );
    const pid = await lockAcquired.promise;
    const http = request(app.getHttpServer());
    const responses = [
      http
        .get(groupPath)
        .set('Cookie', oldSession)
        .then((value) => value),
      http
        .get(grantsPath)
        .set('Cookie', oldSession)
        .then((value) => value),
      http
        .put(grantsPath)
        .set('Origin', origin)
        .set('Cookie', oldSession)
        .send({ email: recipient.email, active: true, version: 0, reason: 'ID 53 grant race' })
        .then((value) => value),
    ];

    try {
      await Promise.race([
        Promise.all([atGrants.promise, atManagement.promise, atWrite.promise]),
        delay(2_000).then(() => {
          throw new Error('Group requests did not finish initial authentication');
        }),
      ]);
      const until = Date.now() + 1_500;
      let queued = false;
      while (!queued && Date.now() < until) {
        const [lock] = await db.client.$queryRaw<{ queued: boolean }[]>`
          SELECT EXISTS (
            SELECT FROM pg_locks WHERE locktype = 'advisory' AND NOT granted
            AND ${pid}::integer = ANY(pg_blocking_pids(pg_locks.pid))
          ) AS queued
        `;
        queued = lock?.queued === true;
        if (!queued) await delay(10);
      }
      expect(queued).toBe(true);
      releaseWrite.resolve();
      await blocker;
      releaseReads.resolve();
      const results = await Promise.all(responses);
      expect(results.map(({ status, body }) => [status, body.code])).toEqual(
        Array.from({ length: 3 }, () => [401, 'AUTH_MFA_REAUTH_REQUIRED']),
      );
      expect(await db.client.companyGroupGrant.count({ where: { groupId: group.id } })).toBe(0);
    } finally {
      releaseWrite.resolve();
      releaseReads.resolve();
      await Promise.allSettled([blocker, ...responses]);
      grants.mockRestore();
      management.mockRestore();
      write.mockRestore();
    }
  }, 12_000);

  it('returns a prepared replacement to the same session without consuming the submitted code twice', async () => {
    const user = await account(true);
    const { confirmed } = await enroll(user.email);
    const original = asSession(confirmed);
    const otherChallenge = asChallenge(await logIn(user.email).expect(201));
    const otherSession = asSession(
      await submitProof(otherChallenge, 'recovery', confirmed.body.recoveryCodes[0]).expect(201),
    );
    const factor = { method: 'recovery', code: confirmed.body.recoveryCodes[1] };
    const start = (session: string, suppliedPassword = password) =>
      post(
        auth + '/mfa/enrollment',
        { kind: 'account', password: suppliedPassword, factor },
        session,
      );
    const prepared = await start(original).expect(201);
    await start(otherSession).expect(401);
    await start(original, 'wrong-secret').expect(401);
    const retried = await start(original).expect(201);
    expect(digest(retried.body.manualKey)).toBe(digest(prepared.body.manualKey));
    expect(digest(retried.body.qrCodeDataUrl)).toBe(digest(prepared.body.qrCodeDataUrl));
    expect(retried.body.expiresAt).toBe(prepared.body.expiresAt);
    await db.client.mfaEnrollment.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await start(original).expect(401);
  });

  it('consumes a TOTP time step and a recovery code atomically across parallel challenges', async () => {
    const user = await account(true);
    const { manualKey, confirmed } = await enroll(user.email);
    const challengePair = async () =>
      Promise.all([logIn(user.email).expect(201), logIn(user.email).expect(201)]);
    const submit = (login: request.Response, method: string, value: string) =>
      post(auth + '/mfa/login', { method, code: value }, cookie(login, 'renr_mfa_challenge'));
    const totpPair = await challengePair();
    const totp = code(manualKey);
    const totpResults = await Promise.all(totpPair.map((login) => submit(login, 'totp', totp)));
    expect(totpResults.map((response) => response.status).sort()).toEqual([201, 401]);
    const recoveryPair = await challengePair();
    const recoveryResults = await Promise.all(
      recoveryPair.map((login) => submit(login, 'recovery', confirmed.body.recoveryCodes[0])),
    );
    expect(recoveryResults.map((response) => response.status).sort()).toEqual([201, 401]);
  });

  it('rejects a preexisting session and an attempted challenge reuse without minting a session', async () => {
    const user = await account(true);
    const rawToken = randomBytes(32).toString('base64url');
    await db.client.session.create({
      data: {
        userId: user.id,
        expiresAt: new Date(Date.now() + 60_000),
        tokenHash: digest(rawToken),
      },
    });
    await current('renr_session=' + rawToken).expect(401);
    await post(
      auth + '/mfa/login',
      { method: 'totp', code: '123456' },
      'renr_mfa_challenge=' + rawToken,
    ).expect(401);
    expect(await db.client.session.count({ where: { userId: user.id } })).toBe(1);
  });

  it('rejects invalid and out-of-window codes, persists failures across challenges, and expires challenges', async () => {
    const user = await account(true);
    const { manualKey } = await enroll(user.email);
    const challenge = asChallenge(await logIn(user.email).expect(201));
    const now = Date.now();
    const nearby = [-60_000, -30_000, 0, 30_000, 60_000].map((offset) =>
      code(manualKey, now + offset),
    );
    const far = [120_000, 150_000, 180_000]
      .map((offset) => code(manualKey, now + offset))
      .find((value) => !nearby.includes(value));
    if (!far) throw new Error('Fixture needs a distinct out-of-window token');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const denied = await submitProof(challenge, 'totp', far).expect(401);
      expect(denied.body.code).toBe('AUTH_MFA_CODE_INVALID');
    }
    const second = asChallenge(await logIn(user.email).expect(201));
    await submitProof(second, 'totp', code(manualKey)).expect(429);
    await db.client.mfaChallenge.update({
      where: { tokenHash: digest(second.slice(second.indexOf('=') + 1)) },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    const expired = await submitProof(second, 'totp', code(manualKey)).expect(401);
    expect(expired.body.code).toBe('AUTH_MFA_CHALLENGE_UNAVAILABLE');
  });

  it('allows optional enrollment and authenticated replacement and revokes old sessions, challenges and codes', async () => {
    const user = await account();
    const initial = asSession(await logIn(user.email).expect(201));
    await request(app.getHttpServer())
      .get(auth + '/mfa')
      .set('Cookie', initial)
      .expect(200, {
        available: true,
        enabled: false,
        required: false,
      });
    const start = (credential: string, payload: object) =>
      post(auth + '/mfa/enrollment', { kind: 'account', ...payload }, credential);
    const confirm = (credential: string, secret: string) =>
      post(auth + '/mfa/enrollment/confirm', { kind: 'account', code: code(secret) }, credential);
    await start(initial, { password: 'wrong-secret' }).expect(401);
    const first = await start(initial, { password }).expect(201);
    await post(auth + '/mfa/enrollment/cancel', { kind: 'account' }, initial).expect(204);
    await confirm(initial, first.body.manualKey).expect(401);
    const restarted = await start(initial, { password }).expect(201);
    const enabled = await confirm(initial, restarted.body.manualKey).expect(201);
    const enabledSession = asSession(enabled);
    expect(enabled.body.recoveryCodes).toHaveLength(10);
    await current(initial).expect(401);
    await request(app.getHttpServer())
      .get(auth + '/mfa')
      .set('Cookie', enabledSession)
      .expect(200, {
        available: true,
        enabled: true,
        required: true,
      });
    const oldChallenge = asChallenge(await logIn(user.email).expect(201));
    await start(enabledSession, { password }).expect(401);
    const next = await start(enabledSession, {
      password,
      factor: { method: 'recovery', code: enabled.body.recoveryCodes[0] },
    }).expect(201);
    const replaced = await confirm(enabledSession, next.body.manualKey).expect(201);
    await current(enabledSession).expect(401);
    await current(asSession(replaced)).expect(200);
    const stale = await submitProof(oldChallenge, 'recovery', enabled.body.recoveryCodes[1]).expect(
      401,
    );
    expect(stale.body.code).toBe('AUTH_MFA_CHALLENGE_UNAVAILABLE');
    const currentChallenge = asChallenge(await logIn(user.email).expect(201));
    const invalid = await submitProof(
      currentChallenge,
      'recovery',
      enabled.body.recoveryCodes[1],
    ).expect(401);
    expect(invalid.body.code).toBe('AUTH_MFA_CODE_INVALID');
    await submitProof(currentChallenge, 'recovery', replaced.body.recoveryCodes[0]).expect(201);
    expect(
      await db.client.auditEvent.count({
        where: { actorId: user.id, action: 'AUTH_MFA_PREVIOUS_FACTOR_REVOKED' },
      }),
    ).toBe(1);
  });

  it('rechecks authorization, requires a recent distinct operator, and consumes assistance only on confirmation', async () => {
    const issuer = await account(true);
    const subject = await account(true);
    const enrolledIssuer = await enroll(issuer.email);
    const enrolledSubject = await enroll(subject.email);
    let issuerSession = asSession(enrolledIssuer.confirmed);
    await publishRecovery(subject.email, issuerSession).expect(403);
    const grant = await db.client.platformGrant.create({
      data: { userId: issuer.id, capability: 'RECOVER_ACCOUNT_MFA' },
    });
    await publishRecovery(issuer.email, issuerSession).expect(403);
    const unverified = await account();
    await db.client.platformGrant.create({
      data: { userId: unverified.id, capability: 'RECOVER_ACCOUNT_MFA' },
    });
    const unverifiedSession = asSession(await logIn(unverified.email).expect(201));
    await publishRecovery(subject.email, unverifiedSession).expect(401);
    await db.client.session.update({
      where: { tokenHash: digest(issuerSession.slice(issuerSession.indexOf('=') + 1)) },
      data: { mfaVerifiedAt: new Date(Date.now() - 11 * 60_000) },
    });
    const stale = await publishRecovery(subject.email, issuerSession).expect(401);
    expect(stale.body.code).toBe('AUTH_MFA_REAUTH_REQUIRED');
    const operatorChallenge = asChallenge(await logIn(issuer.email).expect(201));
    const operatorLogin = await submitProof(
      operatorChallenge,
      'recovery',
      enrolledIssuer.confirmed.body.recoveryCodes[0],
    ).expect(201);
    issuerSession = asSession(operatorLogin);

    const issued = await publishRecovery(subject.email, issuerSession).expect(201);
    expect(issued.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const active = await beginAssisted(subject.email, issued.body.token).expect(201);
    const challenge = asChallenge(active);
    expect(active.body).toEqual({ kind: 'mfa-required', mode: 'enroll' });
    await current(asSession(enrolledSubject.confirmed)).expect(200);
    const suspendedGrant = await db.client.platformGrant.update({
      where: { userId_capability: { userId: issuer.id, capability: grant.capability } },
      data: { isActive: false, version: { increment: 1 } },
    });
    await post(auth + '/mfa/enrollment', { kind: 'login' }, challenge).expect(401);
    await db.client.platformGrant.update({
      where: { userId_capability: { userId: issuer.id, capability: suspendedGrant.capability } },
      data: { isActive: true, version: { increment: 1 } },
    });
    await beginAssisted(subject.email, issued.body.token).expect(401);
    const reissued = await publishRecovery(subject.email, issuerSession).expect(201);
    const retry = await beginAssisted(subject.email, reissued.body.token).expect(201);
    await request(app.getHttpServer())
      .delete(auth + '/mfa/login')
      .set('Origin', origin)
      .set('Cookie', asChallenge(retry))
      .expect(204);
    const availableAgain = await beginAssisted(subject.email, reissued.body.token).expect(201);
    const validChallenge = asChallenge(availableAgain);
    const pending = await post(auth + '/mfa/enrollment', { kind: 'login' }, validChallenge).expect(
      201,
    );
    const confirmed = await post(
      auth + '/mfa/enrollment/confirm',
      {
        kind: 'login',
        code: code(pending.body.manualKey),
      },
      validChallenge,
    ).expect(201);
    await beginAssisted(subject.email, reissued.body.token).expect(401);
    await current(asSession(enrolledSubject.confirmed)).expect(401);
    await current(asSession(confirmed)).expect(200);
    const stored = await db.client.mfaRecovery.findUniqueOrThrow({
      where: { tokenHash: digest(reissued.body.token) },
    });
    expect(stored.consumedAt).toBeInstanceOf(Date);
    expect(stored.tokenHash).not.toBe(reissued.body.token);

    const organization = await db.client.organization.create({ data: { name: 'ID 53 Scope' } });
    await db.client.membership.create({
      data: { userId: issuer.id, organizationId: organization.id, role: 'ADMIN' },
    });
    await request(app.getHttpServer())
      .put(auth + '/session/organization')
      .set('Origin', origin)
      .set('Cookie', issuerSession)
      .send({ organizationId: organization.id })
      .expect(200);
    await publishRecovery(subject.email, issuerSession).expect(403);
  });

  it('preserves the installed factor and codes but revokes pre-reset password proofs through ID 52', async () => {
    const issuer = await account();
    await db.client.platformGrant.create({
      data: { userId: issuer.id, capability: 'MANAGE_PASSWORD_RECOVERY' },
    });
    const subject = await account(true);
    const { confirmed } = await enroll(subject.email);
    const before = asChallenge(await logIn(subject.email).expect(201));
    const issuerSession = asSession(await logIn(issuer.email).expect(201));
    const reset = await publishRecovery(
      subject.email,
      issuerSession,
      '/api/v1/platform/password-recoveries',
    ).expect(201);
    const changedPassword = 'id53-integration-reset-password';
    await post(auth + '/recovery/confirm', {
      token: reset.body.token,
      password: changedPassword,
    }).expect(200);
    const revoked = await submitProof(before, 'recovery', confirmed.body.recoveryCodes[0]).expect(
      401,
    );
    expect(revoked.body.code).toBe('AUTH_MFA_CHALLENGE_UNAVAILABLE');
    await logIn(subject.email).expect(401);
    const next = await post(auth + '/sessions', {
      email: subject.email,
      password: changedPassword,
    }).expect(201);
    expect(next.body).toEqual({ kind: 'mfa-required', mode: 'verify' });
    await submitProof(asChallenge(next), 'recovery', confirmed.body.recoveryCodes[0]).expect(201);
  });
});
