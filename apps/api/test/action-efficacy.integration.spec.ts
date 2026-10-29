import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  actionDetailSchema,
  riskDetailSchema,
  efficacyContextSchema,
  efficacyOpinionSchema,
  efficacyOpinionListSchema,
  evidenceSchema,
  type ActionDetail,
  type EfficacyContext,
} from '@renr/contracts';
import { hashEfficacyScalars } from '../src/modules/action-efficacy/efficacy-fingerprint';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';
import { localDatabaseUrl } from './local-database-url';

const describeDatabase = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
const itStorage = process.env.STORAGE_ENABLED === 'true' ? it : it.skip;

describeDatabase('ID15 traceable efficacy opinions', () => {
  let app: INestApplication;
  let db: PrismaService;
  let env: ReturnType<typeof parseEnvironment>;
  let org: string;
  let action: ActionDetail;
  let riskId: string;
  const cookies = new Map<string, string>();
  const users = new Map<string, string>();
  const base = () => `/api/v1/organizations/${org}`;
  const get = (tail: string, actor = 'admin') =>
    request(app.getHttpServer())
      .get(base() + tail)
      .set('Cookie', cookies.get(actor)!);
  const post = (tail: string, body: object, actor = 'admin') =>
    request(app.getHttpServer())
      .post(base() + tail)
      .set('Cookie', cookies.get(actor)!)
      .set('Origin', env.CORS_ORIGIN)
      .send(body);
  const patch = (tail: string, body: object, actor = 'admin') =>
    request(app.getHttpServer())
      .patch(base() + tail)
      .set('Cookie', cookies.get(actor)!)
      .set('Origin', env.CORS_ORIGIN)
      .send(body);
  const context = async (id = action.id, actor = 'technician') =>
    efficacyContextSchema.parse((await get(`/actions/${id}/efficacy`, actor).expect(200)).body);
  const payload = (
    value: EfficacyContext,
    result: 'EFFECTIVE' | 'NOT_EFFECTIVE' | 'INCONCLUSIVE' = 'EFFECTIVE',
  ) => ({
    expectedVersion: value.actionVersion,
    expectedLatestOpinionId: value.latest?.id ?? null,
    expectedContextFingerprint: value.contextFingerprint,
    result,
    verifiedOn: value.referenceDate,
    observation: 'Synthetic review of collective work records.',
    rationale: 'Synthetic technical conclusion supported by the identified evidence.',
    evidenceIds: [] as string[],
    textualEvidence: [
      {
        reference: 'Collective record reference',
        description: 'Detailed collective evidence from a synthetic record.',
        rationale: 'The identified record supports this conclusion.',
      },
    ],
    ...(result === 'EFFECTIVE'
      ? {}
      : {
          nextSteps: 'Gather additional collective records and schedule another technical review.',
        }),
  });
  const freshAction = async (implemented = true, sourceRiskId = riskId) => {
    const risk = riskDetailSchema.parse((await get(`/risks/${sourceRiskId}`).expect(200)).body);
    let value = actionDetailSchema.parse(
      (
        await post(`/risks/${sourceRiskId}/actions`, {
          title: 'Synthetic implemented measure',
          description: 'Synthetic collective preventive measure.',
          responsibleName: 'Synthetic external responsible',
          dueDate: '2026-12-20',
          expectedResult: 'Synthetic expected collective improvement.',
          verificationCriterion: 'Compare synthetic collective work records.',
          expectedRiskVersion: risk.version,
        }).expect(201)
      ).body,
    );
    if (!implemented) return value;
    value = actionDetailSchema.parse(
      (
        await patch(`/actions/${value.id}`, {
          expectedVersion: value.version,
          status: 'IN_PROGRESS',
          changeReason: 'Synthetic execution started.',
        }).expect(200)
      ).body,
    );
    return actionDetailSchema.parse(
      (
        await patch(`/actions/${value.id}`, {
          expectedVersion: value.version,
          status: 'IMPLEMENTED',
          changeReason: 'Synthetic execution reported.',
          implementationNote:
            'Synthetic team reported implementation; efficacy remains unevaluated.',
        }).expect(200)
      ).body,
    );
  };

  beforeAll(async () => {
    env = parseEnvironment({ ...process.env, NODE_ENV: 'test' });
    localDatabaseUrl(env.DATABASE_URL);
    const module = await Test.createTestingModule({
      imports: [AppModule.configure(env)],
    }).compile();
    app = module.createNestApplication({ logger: false });
    configureApplication(app, env);
    await app.init();
    db = module.get(PrismaService);
    org = (
      await db.client.organization.create({ data: { name: `Synthetic ID15 ${randomUUID()}` } })
    ).id;
    for (const actor of ['admin', 'technician', 'executor', 'reader']) {
      const user = await db.client.user.create({
        data: {
          name: `Synthetic ${actor}`,
          email: `${randomUUID()}@example.test`,
          passwordHash: 'unused',
        },
      });
      users.set(actor, user.id);
      await db.client.membership.create({
        data: {
          userId: user.id,
          organizationId: org,
          role: actor === 'admin' ? 'ADMIN' : 'READER',
          capabilities:
            actor === 'technician'
              ? ['TECHNICAL_DECISIONS']
              : actor === 'executor'
                ? ['EXECUTE_ASSIGNED_ACTIONS']
                : [],
        },
      });
      const token = randomBytes(32).toString('base64url');
      await db.client.session.create({
        data: {
          userId: user.id,
          activeOrganizationId: org,
          tokenHash: createHash('sha256').update(token).digest('hex'),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      cookies.set(actor, `renr_session=${token}`);
    }
    const unit = await db.client.unit.create({
      data: {
        organizationId: org,
        name: 'Synthetic unit',
        normalizedName: 'synthetic unit',
      },
    });
    const sector = await db.client.sector.create({
      data: {
        organizationId: org,
        unitId: unit.id,
        name: 'Synthetic sector',
        normalizedName: 'synthetic sector',
      },
    });
    const risk = riskDetailSchema.parse(
      (
        await post('/risks', {
          sectorId: sector.id,
          factor: 'Synthetic collective risk',
          status: 'REGISTERED',
          description: 'Synthetic description of collective work.',
          exposureDescription: 'Synthetic collective exposure.',
          exposedGroupDescription: 'Synthetic team.',
          possibleHarms: 'Synthetic possible harms.',
          existingControls: 'Synthetic preventive controls.',
          sourceKind: 'TECHNICAL_RECORD',
          sourceNote: 'Synthetic record without technical certification.',
        }).expect(201)
      ).body,
    );
    riskId = risk.id;
    action = await freshAction();
  }, 60000);

  afterAll(async () => {
    if (db && org)
      await db.client.organization.update({ where: { id: org }, data: { isActive: false } });
    await app?.close();
  });

  it('exposes an empty efficacy context without treating reported implementation as effectiveness', async () => {
    const response = await get(`/actions/${action.id}/efficacy`).expect(200);
    expect(response.body.state).toBe('ABSENT');
    expect(response.body.latest).toBeNull();
    expect(response.body.permissions.canRecord).toBe(false);
    expect((await get(`/actions/${action.id}`).expect(200)).body).toEqual(action);
  });

  it('allows a technician reader to record identified textual proof atomically without changing operational DTOs', async () => {
    const value = await freshAction();
    const before = await context(value.id);
    expect(before.permissions).toEqual({ hasTechnicalCapability: true, canRecord: true });
    const opinion = efficacyOpinionSchema.parse(
      (
        await post(`/actions/${value.id}/efficacy-opinions`, payload(before), 'technician').expect(
          201,
        )
      ).body,
    );
    expect(opinion.result).toBe('EFFECTIVE');
    expect(opinion.validity).toBe('CURRENT');
    expect(opinion.author.id).toBe(users.get('technician'));
    expect(opinion.criterionReference).toBe(value.verificationCriterion);
    expect(opinion.actionVersion).toBe(value.version);
    expect(opinion.actionRevisionId).toBe(before.actionRevisionId);
    expect(opinion.actionSnapshot).toEqual(before.actionSnapshot);
    expect(opinion.proofPackage.files).toEqual([]);
    expect(opinion.proofPackage.texts[0]!.sha256).toBe(
      hashEfficacyScalars(payload(before).textualEvidence[0]!),
    );
    expect((await get(`/actions/${value.id}`).expect(200)).body).toEqual(value);
    expect(
      await db.client.auditEvent.count({
        where: {
          organizationId: org,
          resourceId: opinion.id,
          action: 'ACTION_EFFICACY_RECORDED',
          actorId: users.get('technician'),
        },
      }),
    ).toBe(1);
    expect((await context(value.id, 'reader')).latest?.id).toBe(opinion.id);
    expect(
      efficacyOpinionSchema.parse(
        (await get(`/actions/${value.id}/efficacy-opinions/${opinion.id}`, 'reader').expect(200))
          .body,
      ),
    ).toEqual(opinion);
    expect((await get(`/actions/${value.id}/efficacy`).expect(200)).headers['cache-control']).toBe(
      'private, no-store',
    );
  });

  it('denies administrators and assigned executors without explicit technical authority and rejects forged fields', async () => {
    const value = await freshAction();
    const current = await context(value.id);
    for (const actor of ['admin', 'executor', 'reader']) {
      expect((await context(value.id, actor)).permissions.canRecord).toBe(false);
      await post(`/actions/${value.id}/efficacy-opinions`, payload(current), actor).expect(403);
    }
    for (const extra of [
      { authorId: users.get('admin') },
      { criterionReference: 'Injected reference' },
      { proofPackage: {} },
      { result: 'CLOSED' },
    ])
      await post(
        `/actions/${value.id}/efficacy-opinions`,
        { ...payload(current), ...extra },
        'technician',
      ).expect(400);
    await request(app.getHttpServer())
      .post(base() + `/actions/${value.id}/efficacy-opinions`)
      .set('Cookie', cookies.get('technician')!)
      .set('Origin', 'https://foreign.example')
      .send(payload(current))
      .expect(403);
    expect((await context(value.id)).latest).toBeNull();
  });

  it('requires implementation, a nonfuture verification date and specific follow-up without granting closure', async () => {
    const planned = await freshAction(false);
    const pending = await context(planned.id);
    expect(pending.permissions.hasTechnicalCapability).toBe(true);
    expect(pending.blockingReasons).toContain('ACTION_NOT_IMPLEMENTED');
    await post(`/actions/${planned.id}/efficacy-opinions`, payload(pending), 'technician').expect(
      409,
    );
    const value = await freshAction();
    const current = await context(value.id);
    await post(
      `/actions/${value.id}/efficacy-opinions`,
      { ...payload(current), verifiedOn: '2999-01-01' },
      'technician',
    ).expect(409);
    await post(
      `/actions/${value.id}/efficacy-opinions`,
      { ...payload(current), result: 'INCONCLUSIVE' },
      'technician',
    ).expect(400);
    const opinion = efficacyOpinionSchema.parse(
      (
        await post(
          `/actions/${value.id}/efficacy-opinions`,
          payload(current, 'INCONCLUSIVE'),
          'technician',
        ).expect(201)
      ).body,
    );
    expect(opinion.nextSteps).toContain('another technical review');
    expect((await get(`/actions/${value.id}`).expect(200)).body.status).toBe('IMPLEMENTED');
    await request(app.getHttpServer())
      .patch(base() + `/actions/${value.id}/efficacy-opinions/${opinion.id}`)
      .set('Cookie', cookies.get('technician')!)
      .set('Origin', env.CORS_ORIGIN)
      .send({ result: 'EFFECTIVE' })
      .expect(404);
  });

  it('keeps ordinary notes separate from the validity of a justified textual opinion', async () => {
    // Text-only proof remains valid after an ordinary note as well.
    const value = await freshAction();
    const opinion = efficacyOpinionSchema.parse(
      (
        await post(
          `/actions/${value.id}/efficacy-opinions`,
          payload(await context(value.id)),
          'technician',
        ).expect(201)
      ).body,
    );
    await post(`/actions/${value.id}/notes`, {
      expectedVersion: value.version,
      text: 'Ordinary synthetic follow-up note.',
    }).expect(201);
    const after = await context(value.id);
    expect(after.actionVersion).toBe(value.version + 1);
    expect(after.contextFingerprint).toBe(opinion.contextFingerprint);
    expect(after.state).toBe('CURRENT');
    expect(after.latest?.id).toBe(opinion.id);
  });

  it('supersedes a prior effective opinion without deleting it or reviving it after an inconclusive/non-effective conclusion', async () => {
    const value = await freshAction();
    const first = efficacyOpinionSchema.parse(
      (
        await post(
          `/actions/${value.id}/efficacy-opinions`,
          payload(await context(value.id)),
          'technician',
        ).expect(201)
      ).body,
    );
    const second = efficacyOpinionSchema.parse(
      (
        await post(
          `/actions/${value.id}/efficacy-opinions`,
          payload(await context(value.id), 'INCONCLUSIVE'),
          'technician',
        ).expect(201)
      ).body,
    );
    expect(second.sequence).toBe(2);
    expect(second.supersedesId).toBe(first.id);
    const third = efficacyOpinionSchema.parse(
      (
        await post(
          `/actions/${value.id}/efficacy-opinions`,
          payload(await context(value.id), 'NOT_EFFECTIVE'),
          'technician',
        ).expect(201)
      ).body,
    );
    const latest = await context(value.id);
    expect(latest.latest?.id).toBe(third.id);
    expect(latest.latest?.result).toBe('NOT_EFFECTIVE');
    const history = efficacyOpinionListSchema.parse(
      (await get(`/actions/${value.id}/efficacy-opinions?page=1&pageSize=1`, 'reader').expect(200))
        .body,
    );
    expect(history.total).toBe(3);
    expect(history.items[0]?.id).toBe(third.id);
    const old = efficacyOpinionSchema.parse(
      (await get(`/actions/${value.id}/efficacy-opinions/${first.id}`).expect(200)).body,
    );
    expect(old.validity).toBe('SUPERSEDED');
    expect(old.result).toBe('EFFECTIVE');
    expect(old.proofPackage).toEqual(first.proofPackage);
    await get(`/actions/${value.id}/efficacy-opinions?page=1&page=2`).expect(400);
    await get(`/actions/${action.id}/efficacy-opinions/${first.id}`).expect(404);
    expect((await get(`/actions/${value.id}`).expect(200)).body).toEqual(value);
  });

  it('serializes concurrent technical decisions using the predecessor token even though Action.version is unchanged', async () => {
    const value = await freshAction();
    const body = payload(await context(value.id));
    const results = await Promise.all([
      post(`/actions/${value.id}/efficacy-opinions`, body, 'technician'),
      post(`/actions/${value.id}/efficacy-opinions`, body, 'technician'),
    ]);
    expect(results.map((item) => item.status).sort()).toEqual([201, 409]);
    expect((await get(`/actions/${value.id}`).expect(200)).body.version).toBe(value.version);
    expect((await context(value.id)).latest?.sequence).toBe(1);
    expect(await db.client.actionEfficacyOpinion.count({ where: { actionId: value.id } })).toBe(1);
  });

  it('rolls back the opinion when its mandatory audit cannot be persisted', async () => {
    const value = await freshAction();
    const body = payload(await context(value.id));
    // The transaction uses its own Prisma delegate; reject the exact synthetic audit in PostgreSQL.
    const fault = `id15_audit_fault_${randomUUID().replaceAll('-', '')}`;
    if (!/^id15_audit_fault_[a-f0-9]{32}$/.test(fault))
      throw new Error('Invalid owned test identifier');
    await db.client.$executeRawUnsafe(
      `CREATE FUNCTION ${fault}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.organization_id='${org}'::uuid AND NEW.action='ACTION_EFFICACY_RECORDED' THEN RAISE EXCEPTION 'Synthetic audit persistence failure' USING ERRCODE='23514'; END IF; RETURN NEW; END $$`,
    );
    try {
      await db.client.$executeRawUnsafe(
        `CREATE TRIGGER ${fault} BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ${fault}()`,
      );
      await post(`/actions/${value.id}/efficacy-opinions`, body, 'technician').expect(409);
    } finally {
      await db.client.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${fault} ON audit_events`);
      await db.client.$executeRawUnsafe(`DROP FUNCTION ${fault}()`);
    }
    expect(await db.client.actionEfficacyOpinion.count({ where: { actionId: value.id } })).toBe(0);
    expect((await context(value.id)).latest).toBeNull();
    expect((await get(`/actions/${value.id}`).expect(200)).body).toEqual(value);
  });

  it('revoking technical capability blocks subsequent recording without erasing readable history', async () => {
    const value = await freshAction();
    const technician = users.get('technician')!;
    const created = efficacyOpinionSchema.parse(
      (
        await post(
          `/actions/${value.id}/efficacy-opinions`,
          payload(await context(value.id)),
          'technician',
        ).expect(201)
      ).body,
    );
    const current = await context(value.id);
    const member = await db.client.membership.findUniqueOrThrow({
      where: { userId_organizationId: { userId: technician, organizationId: org } },
    });
    try {
      await db.client.membership.update({
        where: { userId_organizationId: { userId: technician, organizationId: org } },
        data: { capabilities: [] },
      });
      const revoked = await context(value.id);
      expect(revoked.permissions).toEqual({ hasTechnicalCapability: false, canRecord: false });
      expect(revoked.latest?.id).toBe(created.id);
      await post(`/actions/${value.id}/efficacy-opinions`, payload(current), 'technician').expect(
        403,
      );
      expect(await db.client.actionEfficacyOpinion.count({ where: { actionId: value.id } })).toBe(
        1,
      );
    } finally {
      await db.client.membership.update({
        where: { userId_organizationId: { userId: technician, organizationId: org } },
        data: { capabilities: member.capabilities },
      });
    }
  });

  it('isolates context, history and writes from an authenticated technician in another active organization', async () => {
    const value = await freshAction();
    const technician = users.get('technician')!;
    const other = await db.client.organization.create({
      data: { name: `Synthetic ID15 foreign ${randomUUID()}` },
    });
    try {
      await db.client.membership.create({
        data: {
          userId: technician,
          organizationId: other.id,
          role: 'READER',
          capabilities: ['TECHNICAL_DECISIONS'],
        },
      });
      const token = randomBytes(32).toString('base64url');
      await db.client.session.create({
        data: {
          userId: technician,
          activeOrganizationId: other.id,
          tokenHash: createHash('sha256').update(token).digest('hex'),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      const cookie = `renr_session=${token}`;
      for (const tail of ['efficacy', 'efficacy-opinions'])
        await request(app.getHttpServer())
          .get(`/api/v1/organizations/${other.id}/actions/${value.id}/${tail}`)
          .set('Cookie', cookie)
          .expect(404);
      await request(app.getHttpServer())
        .get(base() + `/actions/${value.id}/efficacy`)
        .set('Cookie', cookie)
        .expect(404);
      const foreignPayload = payload(await context(value.id));
      await request(app.getHttpServer())
        .post(`/api/v1/organizations/${other.id}/actions/${value.id}/efficacy-opinions`)
        .set('Cookie', cookie)
        .set('Origin', env.CORS_ORIGIN)
        .send(foreignPayload)
        .expect(404);
    } finally {
      await db.client.organization.update({ where: { id: other.id }, data: { isActive: false } });
    }
  });

  it('rejects a changed risk context independently of action version, and marks the preceding opinion for review', async () => {
    const value = await freshAction();
    const old = await context(value.id);
    const opinion = efficacyOpinionSchema.parse(
      (await post(`/actions/${value.id}/efficacy-opinions`, payload(old), 'technician').expect(201))
        .body,
    );
    const drafted = await context(value.id);
    const risk = riskDetailSchema.parse((await get(`/risks/${riskId}`).expect(200)).body);
    await patch(`/risks/${riskId}`, {
      expectedVersion: risk.version,
      description: 'Synthetic changed collective work context.',
    }).expect(200);
    expect((await get(`/actions/${value.id}`).expect(200)).body.version).toBe(value.version);
    await post(`/actions/${value.id}/efficacy-opinions`, payload(drafted), 'technician').expect(
      409,
    );
    const latest = await context(value.id);
    expect(latest.state).toBe('REVIEW_REQUIRED');
    expect(latest.latest?.id).toBe(opinion.id);
    expect(latest.latest?.reviewReasons).toContain('RISK_CONTEXT_CHANGED');
  });

  it('uses the same scalar fingerprints in TypeScript and PostgreSQL for escaped and Unicode proof descriptions', async () => {
    for (const suffix of [
      'acentos ç ã é 😀',
      'line\ncarriage\r\ttab',
      '"quoted" / \\backslash',
      '\u2028\u2029',
    ]) {
      const text = {
        reference: 'Synthetic record reference',
        description: `Long collective evidence ${suffix}`,
        rationale: 'A justified technical conclusion.',
      };
      const rows = await db.client.$queryRaw<
        { hash: string }[]
      >`SELECT id15_hash_scalars(${JSON.stringify(text)}::jsonb) AS hash`;
      expect(rows[0]?.hash).toBe(hashEfficacyScalars(text));
    }
  });

  it('preserves opinions and returns review-required context when the origin risk is archived', async () => {
    const original = riskDetailSchema.parse((await get(`/risks/${riskId}`).expect(200)).body);
    const isolated = riskDetailSchema.parse(
      (
        await post('/risks', {
          sectorId: original.sectorId,
          factor: 'Synthetic independently archived origin',
          status: 'REGISTERED',
          description: 'Synthetic collective description for archival verification.',
          exposureDescription: original.exposureDescription,
          exposedGroupDescription: original.exposedGroupDescription,
          possibleHarms: original.possibleHarms,
          existingControls: original.existingControls,
          sourceKind: 'TECHNICAL_RECORD',
          sourceNote: 'Synthetic archival verification context.',
        }).expect(201)
      ).body,
    );
    const value = await freshAction(true, isolated.id);
    const opinion = efficacyOpinionSchema.parse(
      (
        await post(
          `/actions/${value.id}/efficacy-opinions`,
          payload(await context(value.id)),
          'technician',
        ).expect(201)
      ).body,
    );
    const drafted = await context(value.id);
    const latestRisk = riskDetailSchema.parse(
      (await get(`/risks/${isolated.id}`).expect(200)).body,
    );
    await patch(`/risks/${isolated.id}`, {
      expectedVersion: latestRisk.version,
      status: 'ARCHIVED',
    }).expect(200);
    const current = await context(value.id);
    expect(current.state).toBe('REVIEW_REQUIRED');
    expect(current.latest?.id).toBe(opinion.id);
    expect(current.latest?.reviewReasons).toContain('ORIGIN_INACTIVE');
    expect(current.permissions.canRecord).toBe(false);
    expect(current.blockingReasons).toContain('ORIGIN_INACTIVE');
    expect(current.riskContextSnapshot.status).toBe('ARCHIVED');
    expect(current.latest?.riskContextSnapshot.status).toBe('REGISTERED');
    expect(current.latest?.proofPackage).toEqual(opinion.proofPackage);
    await post(`/actions/${value.id}/efficacy-opinions`, payload(drafted), 'technician').expect(
      409,
    );
  });

  itStorage(
    'freezes private attachment hashes, rejects crossed/archived proofs and invalidates only selected archived evidence',
    async () => {
      const value = await freshAction();
      const other = await freshAction();
      const upload = (id: string, version: number) =>
        request(app.getHttpServer())
          .post(base() + `/actions/${id}/evidence`)
          .set('Cookie', cookies.get('admin')!)
          .set('Origin', env.CORS_ORIGIN)
          .field('expectedVersion', String(version))
          .field('description', 'Synthetic collective evidence attachment.')
          .attach('file', Buffer.from('%PDF-1.7\nSynthetic efficacy proof\n%%EOF'), {
            filename: 'synthetic.pdf',
            contentType: 'application/pdf',
          });
      const selected = evidenceSchema.parse(
        (await upload(value.id, value.version).expect(201)).body,
      );
      const foreign = evidenceSchema.parse(
        (await upload(other.id, other.version).expect(201)).body,
      );
      let current = await context(value.id);
      await post(
        `/actions/${value.id}/efficacy-opinions`,
        { ...payload(current), evidenceIds: [foreign.id] },
        'technician',
      ).expect(404);
      const opinion = efficacyOpinionSchema.parse(
        (
          await post(
            `/actions/${value.id}/efficacy-opinions`,
            { ...payload(current), evidenceIds: [selected.id], textualEvidence: [] },
            'technician',
          ).expect(201)
        ).body,
      );
      expect(opinion.proofPackage.files[0]?.sha256).toBe(selected.sha256);
      const unrelated = evidenceSchema.parse(
        (await upload(value.id, current.actionVersion).expect(201)).body,
      );
      current = await context(value.id);
      expect(current.state).toBe('CURRENT');
      await patch(`/actions/${value.id}/evidence/${unrelated.id}`, {
        expectedVersion: current.actionVersion,
        changeReason: 'Archive unselected synthetic attachment.',
      }).expect(200);
      current = await context(value.id);
      expect(current.state).toBe('CURRENT');
      await patch(`/actions/${value.id}/evidence/${selected.id}`, {
        expectedVersion: current.actionVersion,
        changeReason: 'Archive selected synthetic attachment for review.',
      }).expect(200);
      current = await context(value.id);
      expect(current.state).toBe('REVIEW_REQUIRED');
      expect(current.latest?.reviewReasons).toEqual(['SELECTED_EVIDENCE_ARCHIVED']);
      expect(current.latest?.proofPackage).toEqual(opinion.proofPackage);
      await post(
        `/actions/${value.id}/efficacy-opinions`,
        { ...payload(current), evidenceIds: [selected.id], textualEvidence: [] },
        'technician',
      ).expect(409);
      expect(
        (await get(`/actions/${value.id}/evidence/${selected.id}/download`).expect(200)).headers[
          'cache-control'
        ],
      ).toBe('private, no-store');
    },
  );
});
