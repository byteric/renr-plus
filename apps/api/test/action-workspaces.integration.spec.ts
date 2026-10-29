import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  riskDetailSchema,
  actionDetailSchema,
  actionWorkspaceSchema,
  actionWorkspaceListSchema,
  actionWorkspaceHistoryListSchema,
  actionRevisionListSchema,
  evaluationMethodVersionSchema,
  type RiskDetail,
} from '@renr/contracts';
import { createRequire } from 'node:module';
import { EvidenceStorage } from '../src/modules/evidence/evidence.storage';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';
import { localDatabaseUrl } from './local-database-url';

const describeDatabase = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
const itStorage = process.env.STORAGE_ENABLED === 'true' ? it : it.skip;
describeDatabase('ID13 assignments and restricted operational execution', () => {
  let app: INestApplication;
  let db: PrismaService;
  let env: ReturnType<typeof parseEnvironment>;
  let org: string;
  let admin: string;
  let executor: string;
  let cookie: string;
  let executorCookie: string;
  let risk: RiskDetail;
  const base = () => `/api/v1/organizations/${org}`;
  const get = (tail: string, session = cookie) =>
    request(app.getHttpServer())
      .get(base() + tail)
      .set('Cookie', session);
  const post = (tail: string, body: object, session = cookie) =>
    request(app.getHttpServer())
      .post(base() + tail)
      .set('Cookie', session)
      .set('Origin', env.CORS_ORIGIN)
      .send(body);
  const patch = (tail: string, body: object, session = cookie) =>
    request(app.getHttpServer())
      .patch(base() + tail)
      .set('Cookie', session)
      .set('Origin', env.CORS_ORIGIN)
      .send(body);
  const input = () => ({
    title: 'Synthetic preventive measure',
    description: 'Synthetic collective work arrangement.',
    responsibleName: 'External nominal responsible',
    dueDate: '2026-10-20',
    expectedResult: 'Synthetic collective improvement.',
    verificationCriterion: 'Documented collective review.',
    expectedRiskVersion: risk.version,
  });
  const createLegacy = async () => {
    risk = riskDetailSchema.parse((await get(`/risks/${risk.id}`).expect(200)).body);
    return actionDetailSchema.parse(
      (await post(`/risks/${risk.id}/actions`, input()).expect(201)).body,
    );
  };
  const assign = (id: string, version: number, userId: string | null) =>
    patch(`/actions/${id}/assignment`, {
      expectedVersion: version,
      assignedUserId: userId,
      changeReason: 'Synthetic explicit assignment decision.',
    });
  const execution = (
    id: string,
    version: number,
    status: 'IN_PROGRESS' | 'IMPLEMENTED' = 'IN_PROGRESS',
  ) =>
    patch(
      `/action-workspaces/${id}/execution`,
      {
        expectedVersion: version,
        status,
        changeReason: 'Synthetic operational execution report.',
        ...(status === 'IMPLEMENTED'
          ? {
              implementationNote: 'Synthetic execution completed; efficacy has not been evaluated.',
            }
          : {}),
      },
      executorCookie,
    );
  const bytes = Buffer.from('%PDF-1.7\nSynthetic executor evidence\n%%EOF');
  const upload = (id: string, version: number) =>
    request(app.getHttpServer())
      .post(base() + `/actions/${id}/evidence`)
      .set('Cookie', executorCookie)
      .set('Origin', env.CORS_ORIGIN)
      .field('expectedVersion', String(version))
      .field('description', 'Synthetic evidence uploaded by the assigned executor.')
      .attach('file', bytes, { filename: 'synthetic.pdf', contentType: 'application/pdf' });
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
      await db.client.organization.create({ data: { name: `Synthetic ID13 ${randomUUID()}` } })
    ).id;
    const sessions: string[] = [];
    const users: string[] = [];
    for (const role of ['ADMIN', 'READER'] as const) {
      const user = await db.client.user.create({
        data: {
          name: `Synthetic ${role}`,
          email: `${randomUUID()}@example.test`,
          passwordHash: 'unused',
        },
      });
      users.push(user.id);
      await db.client.membership.create({
        data: {
          userId: user.id,
          organizationId: org,
          role,
          capabilities: role === 'READER' ? ['EXECUTE_ASSIGNED_ACTIONS'] : [],
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
      sessions.push(`renr_session=${token}`);
    }
    [admin, executor] = users as [string, string];
    [cookie, executorCookie] = sessions as [string, string];
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
    risk = riskDetailSchema.parse(
      (
        await post('/risks', {
          sectorId: sector.id,
          factor: 'Synthetic collective risk',
          status: 'REGISTERED',
          description: 'Synthetic description of collective tasks.',
          exposureDescription: 'Synthetic collective exposure.',
          exposedGroupDescription: 'Synthetic collective group.',
          possibleHarms: 'Synthetic potential harms.',
          existingControls: 'Synthetic preventive controls.',
          sourceKind: 'TECHNICAL_RECORD',
          sourceNote: 'Synthetic context without technical certification.',
        }).expect(201)
      ).body,
    );
  }, 60000);
  afterAll(async () => {
    if (db && org)
      await db.client.organization.update({ where: { id: org }, data: { isActive: false } });
    await app?.close();
  });
  it('returns the personal workspace from the authenticated session without changing the legacy DTO', async () => {
    const action = await createLegacy();
    const response = await get('/action-workspaces?assignedTo=me', executorCookie).expect(200);
    expect(response.body.items).toEqual([]);
    expect(actionDetailSchema.parse((await get(`/actions/${action.id}`).expect(200)).body)).toEqual(
      action,
    );
    expect(admin).not.toBe(executor);
  });
  it('creates assignment atomically and preserves nominal responsibility, legacy DTOs and frozen history', async () => {
    const before = await createLegacy();
    const created = actionDetailSchema.parse(
      (
        await post(`/risks/${risk.id}/action-workspaces`, {
          ...input(),
          assignedUserId: executor,
        }).expect(201)
      ).body,
    );
    expect(created.responsibleName).toBe(before.responsibleName);
    expect(Object.keys(created).sort()).toEqual(Object.keys(before).sort());
    const current = actionWorkspaceSchema.parse(
      (await get(`/action-workspaces/${created.id}`).expect(200)).body,
    );
    expect(current.assignedUser).toMatchObject({
      userId: executor,
      name: 'Synthetic READER',
      currentName: 'Synthetic READER',
      isActive: true,
    });
    const history = actionWorkspaceHistoryListSchema.parse(
      (await get(`/action-workspaces/${created.id}/history`).expect(200)).body,
    );
    expect(history.items[0]?.assignmentChange).toEqual({
      previous: null,
      next: { userId: executor, name: 'Synthetic READER' },
    });
    const legacy = actionRevisionListSchema.parse(
      (await get(`/actions/${created.id}/revisions`).expect(200)).body,
    );
    expect(legacy.items[0]?.snapshot.responsibleName).toBe(input().responsibleName);
    expect(legacy.items[0]).not.toHaveProperty('assignmentChange');
    await db.client.user.update({
      where: { id: executor },
      data: { name: 'Renamed synthetic executor' },
    });
    try {
      const renamed = actionWorkspaceSchema.parse(
        (await get(`/action-workspaces/${created.id}`).expect(200)).body,
      );
      expect(renamed.assignedUser).toMatchObject({
        name: 'Synthetic READER',
        currentName: 'Renamed synthetic executor',
      });
      expect((await get(`/action-workspaces/${created.id}/history`).expect(200)).body).toEqual(
        history,
      );
    } finally {
      await db.client.user.update({ where: { id: executor }, data: { name: 'Synthetic READER' } });
    }
  });
  it('filters by actual session before pagination and never matches the nominal name', async () => {
    const mine = await createLegacy();
    const other = await createLegacy();
    await assign(mine.id, mine.version, executor).expect(200);
    await assign(other.id, other.version, admin).expect(200);
    const response = actionWorkspaceListSchema.parse(
      (
        await get(
          `/action-workspaces?assignedTo=me&q=${encodeURIComponent(mine.title)}&pageSize=100`,
          executorCookie,
        ).expect(200)
      ).body,
    );
    expect(response.items.some((item) => item.id === mine.id)).toBe(true);
    expect(response.items.some((item) => item.id === other.id)).toBe(false);
    for (const item of response.items) expect(item.assignedUser?.userId).toBe(executor);
    await get(`/action-workspaces?assignedTo=${admin}`, executorCookie).expect(400);
    await get('/action-workspaces?assignedTo=me&assignedTo=me', executorCookie).expect(400);
    await get('/actions?assignedTo=me', executorCookie).expect(400);
  });
  it('rejects a foreign/inactive assignee and leaves creation and assignment unchanged', async () => {
    const action = await createLegacy();
    const foreign = await db.client.organization.create({
      data: { name: `Synthetic foreign ${randomUUID()}` },
    });
    const user = await db.client.user.create({
      data: {
        email: `${randomUUID()}@example.test`,
        name: 'Foreign synthetic member',
        passwordHash: 'unused',
      },
    });
    await db.client.membership.create({
      data: { organizationId: foreign.id, userId: user.id, role: 'READER' },
    });
    try {
      await assign(action.id, action.version, user.id).expect(404);
      await post(`/risks/${risk.id}/action-workspaces`, {
        ...input(),
        assignedUserId: user.id,
      }).expect(404);
      await db.client.membership.update({
        where: { userId_organizationId: { userId: executor, organizationId: org } },
        data: { isActive: false },
      });
      await assign(action.id, action.version, executor).expect(409);
      expect((await get(`/actions/${action.id}`).expect(200)).body).toEqual(action);
      expect((await get(`/actions/${action.id}/revisions`).expect(200)).body.total).toBe(1);
    } finally {
      await db.client.membership.update({
        where: { userId_organizationId: { userId: executor, organizationId: org } },
        data: { isActive: true },
      });
      await db.client.organization.update({ where: { id: foreign.id }, data: { isActive: false } });
    }
  });
  it('permits only explicit assigned execution and never expands management or technical authority', async () => {
    const action = await createLegacy();
    await execution(action.id, action.version).expect(403);
    const assigned = actionDetailSchema.parse(
      (await assign(action.id, action.version, executor).expect(200)).body,
    );
    const view = actionWorkspaceSchema.parse(
      (await get(`/action-workspaces/${action.id}`, executorCookie).expect(200)).body,
    );
    expect(view.permissions).toEqual({
      canManage: false,
      canExecute: true,
      canNote: true,
      canUploadEvidence: true,
      canArchiveEvidence: false,
    });
    await get('/action-assignees', executorCookie).expect(403);
    await patch(
      `/actions/${action.id}/assignment`,
      {
        expectedVersion: assigned.version,
        assignedUserId: admin,
        changeReason: 'Unauthorized management attempt.',
      },
      executorCookie,
    ).expect(403);
    await patch(
      `/action-workspaces/${action.id}/execution`,
      {
        expectedVersion: assigned.version,
        status: 'IN_PROGRESS',
        title: 'Unauthorized field',
        changeReason: 'Unauthorized management field.',
      },
      executorCookie,
    ).expect(400);
    await patch(
      `/action-workspaces/${action.id}/execution`,
      {
        expectedVersion: assigned.version,
        status: 'CANCELLED',
        changeReason: 'Unauthorized cancellation attempt.',
      },
      executorCookie,
    ).expect(400);
    await patch(
      `/actions/${action.id}`,
      {
        expectedVersion: assigned.version,
        title: 'Unauthorized management',
        changeReason: 'Unauthorized management attempt.',
      },
      executorCookie,
    ).expect(403);
    const started = actionDetailSchema.parse(
      (await execution(action.id, assigned.version).expect(200)).body,
    );
    const note = await post(
      `/action-workspaces/${action.id}/notes`,
      { expectedVersion: started.version, text: 'Synthetic ongoing operational note.' },
      executorCookie,
    ).expect(201);
    expect(note.body.event).toBe('NOTE');
    const implemented = actionDetailSchema.parse(
      (await execution(action.id, note.body.version, 'IMPLEMENTED').expect(200)).body,
    );
    expect(implemented.status).toBe('IMPLEMENTED');
    expect(implemented).not.toHaveProperty('efficacy');
    await assign(action.id, implemented.version, admin).expect(409);
    await execution(action.id, implemented.version).expect(409);
  });
  it('requires capability in addition to assignment and preserves history after deactivation', async () => {
    const action = await createLegacy();
    const assigned = actionDetailSchema.parse(
      (await assign(action.id, action.version, executor).expect(200)).body,
    );
    const history = (await get(`/action-workspaces/${action.id}/history`).expect(200)).body;
    await db.client.membership.update({
      where: { userId_organizationId: { userId: executor, organizationId: org } },
      data: { capabilities: [] },
    });
    try {
      await execution(action.id, assigned.version).expect(403);
      await request(app.getHttpServer())
        .post(base() + `/actions/${action.id}/evidence`)
        .set('Cookie', executorCookie)
        .set('Origin', env.CORS_ORIGIN)
        .attach('file', Buffer.from('invalid'), 'bad.exe')
        .expect(403);
      await db.client.membership.update({
        where: { userId_organizationId: { userId: executor, organizationId: org } },
        data: { isActive: false },
      });
      const view = actionWorkspaceSchema.parse(
        (await get(`/action-workspaces/${action.id}`).expect(200)).body,
      );
      expect(view.assignedUser?.isActive).toBe(false);
      expect(view.pendingReasons).toContain('ASSIGNEE_INACTIVE');
      expect((await get(`/action-workspaces/${action.id}/history`).expect(200)).body).toEqual(
        history,
      );
    } finally {
      await db.client.membership.update({
        where: { userId_organizationId: { userId: executor, organizationId: org } },
        data: { isActive: true, capabilities: ['EXECUTE_ASSIGNED_ACTIONS'] },
      });
    }
  });
  it('serializes reassignment with version conflicts and one matching revision', async () => {
    const action = await createLegacy();
    const results = await Promise.all([
      assign(action.id, action.version, executor),
      assign(action.id, action.version, admin),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await get(`/actions/${action.id}/revisions`).expect(200)).body.total).toBe(2);
    expect(
      (await get(`/action-workspaces/${action.id}/history`).expect(200)).body.items[0]
        .assignmentChange.next.userId,
    ).toBe(results[0]!.status === 200 ? executor : admin);
  });
  itStorage(
    'allows assigned upload and private byte-identical download but keeps archival administrative',
    async () => {
      const action = await createLegacy();
      const assigned = actionDetailSchema.parse(
        (await assign(action.id, action.version, executor).expect(200)).body,
      );
      const uploaded = await upload(action.id, assigned.version).expect(201);
      expect(uploaded.body.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(uploaded.body).not.toHaveProperty('objectKey');
      const downloaded = await get(
        `/actions/${action.id}/evidence/${uploaded.body.id}/download`,
        executorCookie,
      ).expect(200);
      expect(downloaded.body).toEqual(bytes);
      await patch(
        `/actions/${action.id}/evidence/${uploaded.body.id}`,
        {
          expectedVersion: uploaded.body.actionVersion,
          changeReason: 'Unauthorized executor archival.',
        },
        executorCookie,
      ).expect(403);
      await patch(`/actions/${action.id}/evidence/${uploaded.body.id}`, {
        expectedVersion: uploaded.body.actionVersion,
        changeReason: 'Synthetic administrative archival.',
      }).expect(200);
      const view = actionWorkspaceSchema.parse(
        (await get(`/action-workspaces/${action.id}`).expect(200)).body,
      );
      expect(view.evidenceSummary).toEqual({ active: 0, archived: 1 });
    },
  );
  itStorage(
    'allows reassignment during PUT and fences finalization by the previous executor',
    async () => {
      const action = await createLegacy();
      const assigned = actionDetailSchema.parse(
        (await assign(action.id, action.version, executor).expect(200)).body,
      );
      const storage = app.get(EvidenceStorage);
      const originalPut = storage.put.bind(storage);
      let entered!: () => void;
      let release!: () => void;
      const atStorage = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const resume = new Promise<void>((resolve) => {
        release = resolve;
      });
      const hold = jest
        .spyOn(storage, 'put')
        .mockImplementationOnce(async (...args: Parameters<EvidenceStorage['put']>) => {
          await originalPut(...args);
          entered();
          await resume;
        });
      const cleanup = jest.spyOn(storage, 'compensate');
      let pendingUpload: Promise<request.Response> | undefined;
      let pendingAssignment: Promise<request.Response> | undefined;
      try {
        pendingUpload = upload(action.id, assigned.version).then((response) => response);
        await Promise.race([
          atStorage,
          pendingUpload.then((response) => {
            throw new Error(`Upload ended before its storage barrier: ${response.status}`);
          }),
        ]);
        pendingAssignment = assign(action.id, assigned.version, admin)
          .timeout({ response: 5000, deadline: 7000 })
          .then((response) => response);
        const reassigned = await pendingAssignment;
        expect(reassigned.status).toBe(200);
        expect(reassigned.body.version).toBe(assigned.version + 1);
        expect(await db.client.actionEvidence.count({ where: { actionId: action.id } })).toBe(0);
        release();
        expect((await pendingUpload).status).toBe(403);
        const current = actionWorkspaceSchema.parse(
          (await get(`/action-workspaces/${action.id}`).expect(200)).body,
        );
        expect(current.assignedUser?.userId).toBe(admin);
        expect(current.evidenceSummary.active).toBe(0);
        expect(await db.client.actionEvidence.count({ where: { actionId: action.id } })).toBe(0);
        expect(
          await db.client.actionRevision.count({
            where: { actionId: action.id, event: 'EVIDENCE_ADDED' },
          }),
        ).toBe(0);
        const attempt = await db.client.evidenceUploadAttempt.findFirstOrThrow({
          where: { organizationId: org, actionId: action.id, creatorId: executor },
        });
        expect(attempt.state).toBe('UNCERTAIN');
        expect(attempt.evidenceId).toBeNull();
        const stream = await storage.get(attempt.objectKey);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        expect(Buffer.concat(chunks)).toEqual(bytes);
        expect(cleanup).not.toHaveBeenCalled();
      } finally {
        release();
        if (pendingUpload) await pendingUpload;
        if (pendingAssignment) await pendingAssignment;
        hold.mockRestore();
        cleanup.mockRestore();
      }
    },
    20000,
  );
  it('revalidates executor permission after a concurrent revocation commits', async () => {
    const action = await createLegacy();
    const assigned = actionDetailSchema.parse(
      (await assign(action.id, action.version, executor).expect(200)).body,
    );
    const { Client } = createRequire(__filename)('pg') as {
      Client: new (input: { connectionString: string }) => {
        connect(): Promise<void>;
        end(): Promise<void>;
        query(
          sql: string,
          values?: unknown[],
        ): Promise<{ rows: { pid?: number; blocked?: boolean }[] }>;
      };
    };
    const blocker = new Client({ connectionString: env.DATABASE_URL });
    await blocker.connect();
    let pending: Promise<request.Response> | undefined;
    try {
      await blocker.query('BEGIN');
      const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      await blocker.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [org]);
      await blocker.query(
        "UPDATE memberships SET capabilities='{}' WHERE organization_id=$1 AND user_id=$2",
        [org, executor],
      );
      pending = execution(action.id, assigned.version).then((response) => response);
      let blocked = false;
      const deadline = Date.now() + 3000;
      while (!blocked && Date.now() < deadline) {
        blocked =
          (
            await blocker.query(
              'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1::integer=ANY(pg_blocking_pids(pid))) AS blocked',
              [pid],
            )
          ).rows[0]!.blocked === true;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await blocker.query('COMMIT');
      expect(blocked).toBe(true);
      expect((await pending).status).toBe(403);
      expect((await get(`/actions/${action.id}`).expect(200)).body.version).toBe(assigned.version);
    } finally {
      await blocker.query('ROLLBACK');
      await blocker.end();
      if (pending) await pending;
      await db.client.membership.update({
        where: { userId_organizationId: { userId: executor, organizationId: org } },
        data: { capabilities: ['EXECUTE_ASSIGNED_ACTIONS'] },
      });
    }
  }, 15000);
  it('exposes only a compatible current technical priority and separates contextual changes', async () => {
    await db.client.membership.update({
      where: { userId_organizationId: { userId: admin, organizationId: org } },
      data: { capabilities: ['TECHNICAL_DECISIONS'] },
    });
    const draft = evaluationMethodVersionSchema.parse(
      (
        await post('/evaluation-methods', {
          name: 'Synthetic action priority method',
          description: 'Synthetic fixture, no real technical approval.',
        }).expect(201)
      ).body,
    );
    const definition = {
      probability: [
        { key: 'p', label: 'Synthetic P', description: 'Synthetic input', position: 1 },
      ],
      severity: [{ key: 's', label: 'Synthetic S', description: 'Synthetic input', position: 1 }],
      levels: [{ key: 'l', label: 'Synthetic class' }],
      priorities: [{ key: 'one', label: 'Synthetic contextual priority', rank: 1 }],
      matrix: [{ probabilityKey: 'p', severityKey: 's', levelKey: 'l', priorityKey: 'one' }],
    };
    const updated = evaluationMethodVersionSchema.parse(
      (
        await request(app.getHttpServer())
          .put(base() + `/evaluation-method-versions/${draft.id}`)
          .set('Cookie', cookie)
          .set('Origin', env.CORS_ORIGIN)
          .send({
            expectedRevision: draft.revision,
            title: draft.title,
            description: draft.description,
            definition,
          })
          .expect(200)
      ).body,
    );
    await post(`/evaluation-method-versions/${draft.id}/publish`, {
      expectedRevision: updated.revision,
      approvalReference: 'Synthetic fixture approval only, no ReTech certification.',
    }).expect(201);
    risk = riskDetailSchema.parse((await get(`/risks/${risk.id}`).expect(200)).body);
    await post(`/risk-workspaces/${risk.id}/technical-evaluations`, {
      expectedVersion: risk.version,
      methodVersionId: draft.id,
      probabilityKey: 'p',
      severityKey: 's',
      rationale: 'Synthetic contextual technical rationale.',
      context: 'Synthetic collective context for this test.',
      sources: [{ kind: 'RISK_RECORD', id: risk.id }],
    }).expect(201);
    const action = await createLegacy();
    const current = actionWorkspaceSchema.parse(
      (await get(`/action-workspaces/${action.id}`).expect(200)).body,
    );
    expect(current.riskContext.priority).toMatchObject({
      label: 'Synthetic contextual priority',
      methodVersionId: draft.id,
      rank: 1,
    });
    await patch(`/risks/${risk.id}`, {
      expectedVersion: risk.version,
      description: 'Modified synthetic collective work context.',
    }).expect(200);
    const changed = actionWorkspaceSchema.parse(
      (await get(`/action-workspaces/${action.id}`).expect(200)).body,
    );
    expect(changed.riskContext.priority).toBeNull();
    expect(changed.riskContext.contextMatches).toBe(false);
    expect(changed.pendingReasons).toContain('ORIGIN_CONTEXT_CHANGED');
    expect(changed.riskContext.technicalEvaluationState).toBe('CONTEXT_CHANGED');
  });
});
