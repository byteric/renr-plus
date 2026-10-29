import 'dotenv/config';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  actionDetailSchema,
  actionOverviewSchema,
  actionRevisionListSchema,
  evidenceSchema,
} from '@renr/contracts';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';
import { EvidenceStorage } from '../src/modules/evidence/evidence.storage';
import { ActionsRepository } from '../src/modules/actions/actions.repository';
import { localDatabaseUrl } from './local-database-url';

const describeDatabase = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
describeDatabase('Actions and private attachments against local PostgreSQL and MinIO', () => {
  const environment = parseEnvironment({ ...process.env, NODE_ENV: 'test' });
  localDatabaseUrl(environment.DATABASE_URL);
  const storageUrl = new URL(environment.S3_ENDPOINT);
  if (
    environment.STORAGE_ENABLED &&
    (storageUrl.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(storageUrl.hostname) ||
      storageUrl.username ||
      storageUrl.password ||
      storageUrl.search ||
      storageUrl.hash ||
      storageUrl.pathname !== '/')
  )
    throw new Error(
      'Integration tests require loopback HTTP storage without redirects or credentials in URL',
    );
  const itStorage = environment.STORAGE_ENABLED ? it : it.skip;
  let app: INestApplication, db: PrismaService, riskId: string, sectorId: string, unitId: string;
  const orgId = randomUUID(),
    foreignOrg = randomUUID(),
    userId = randomUUID(),
    readerId = randomUUID();
  const token = randomUUID().replaceAll('-', '') + '12345678901',
    readerToken = randomUUID().replaceAll('-', '') + '12345678901',
    cookie = `renr_session=${token}`,
    readerCookie = `renr_session=${readerToken}`;
  const base = `/api/v1/organizations/${orgId}`;
  const input = {
    title: 'Medida fictícia',
    description: 'Descrição da medida fictícia',
    responsibleName: 'Pessoa sintética',
    dueDate: '2026-10-20',
    expectedResult: 'Resultado sintético esperado',
    verificationCriterion: 'Comparação posterior fictícia',
    expectedRiskVersion: 1,
  };
  const api = () => request(app.getHttpServer());
  const post = () =>
    api()
      .post(`${base}/risks/${riskId}/actions`)
      .set('Cookie', cookie)
      .set('Origin', environment.CORS_ORIGIN);
  const patch = (id: string) =>
    api()
      .patch(`${base}/actions/${id}`)
      .set('Cookie', cookie)
      .set('Origin', environment.CORS_ORIGIN);
  const note = (id: string, version: number) =>
    api()
      .post(`${base}/actions/${id}/notes`)
      .set('Cookie', cookie)
      .set('Origin', environment.CORS_ORIGIN)
      .send({ expectedVersion: version, text: 'Anotação histórica fictícia' });
  const upload = (
    id: string,
    version: number,
    bytes = Buffer.from('%PDF-1.7\nSynthetic fixture\n%%EOF'),
    name = 'fixture.pdf',
    mime = 'application/pdf',
  ) =>
    api()
      .post(`${base}/actions/${id}/evidence`)
      .set('Cookie', cookie)
      .set('Origin', environment.CORS_ORIGIN)
      .field('description', 'Documento inteiramente fictício')
      .field('expectedVersion', String(version))
      .attach('file', bytes, { filename: name, contentType: mime });
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule.configure(environment)],
    }).compile();
    db = module.get(PrismaService);
    app = module.createNestApplication();
    configureApplication(app, environment);
    await app.init();
    await db.client.user.createMany({
      data: [
        {
          id: userId,
          name: 'Administrador sintético',
          email: `${userId}@renr.example`,
          passwordHash: 'unused',
        },
        {
          id: readerId,
          name: 'Leitor sintético',
          email: `${readerId}@renr.example`,
          passwordHash: 'unused',
        },
      ],
    });
    await db.client.organization.create({
      data: {
        id: orgId,
        name: 'Ações fictícias',
        memberships: {
          create: [
            { userId, role: 'ADMIN' },
            { userId: readerId, role: 'READER' },
          ],
        },
      },
    });
    await db.client.organization.create({
      data: { id: foreignOrg, name: 'Empresa externa fictícia' },
    });
    const unit = await db.client.unit.create({
      data: { organizationId: orgId, name: 'Unidade', normalizedName: 'unidade' },
    });
    unitId = unit.id;
    const sector = await db.client.sector.create({
      data: { organizationId: orgId, unitId, name: 'Setor', normalizedName: 'setor' },
    });
    sectorId = sector.id;
    const group = await db.client.assessmentGroup.create({
      data: { organizationId: orgId, sectorId },
    });
    const risk = await db.client.risk.create({
      data: {
        organizationId: orgId,
        assessmentGroupId: group.id,
        status: 'REGISTERED',
        factor: 'Fator de origem fictício',
        description: 'Descrição fictícia',
        createdById: userId,
        updatedById: userId,
      },
    });
    riskId = risk.id;
    await db.client.session.createMany({
      data: [
        {
          userId,
          activeOrganizationId: orgId,
          tokenHash: createHash('sha256').update(token).digest('hex'),
          expiresAt: new Date(Date.now() + 3600000),
        },
        {
          userId: readerId,
          activeOrganizationId: orgId,
          tokenHash: createHash('sha256').update(readerToken).digest('hex'),
          expiresAt: new Date(Date.now() + 3600000),
        },
      ],
    });
  }, 30000);
  afterAll(async () => {
    if (db) await db.client.session.deleteMany({ where: { userId: { in: [userId, readerId] } } });
    if (app) await app.close();
  }, 15000);
  it('validates strict creation and origin permissions without partial persistence', async () => {
    const before = await db.client.action.count({ where: { organizationId: orgId } });
    for (const payload of [
      { ...input, responsibleName: '' },
      { ...input, dueDate: '2027-02-29' },
      { ...input, expectedRiskVersion: undefined },
      { ...input, contextSnapshot: {} },
    ])
      await post().send(payload).expect(400);
    await post()
      .send({ ...input, expectedRiskVersion: 2 })
      .expect(409);
    await api()
      .post(`${base}/risks/${riskId}/actions`)
      .set('Cookie', readerCookie)
      .set('Origin', environment.CORS_ORIGIN)
      .send(input)
      .expect(403);
    await api()
      .post(`${base}/risks/${riskId}/actions`)
      .set('Cookie', cookie)
      .set('Origin', 'https://foreign.example')
      .send(input)
      .expect(403);
    await api()
      .get(`/api/v1/organizations/${foreignOrg}/actions`)
      .set('Cookie', cookie)
      .expect(404);
    expect(await db.client.action.count({ where: { organizationId: orgId } })).toBe(before);
  });
  it('preserves origin, arbitrates concurrent edits and records exact immutable revisions', async () => {
    const created = await post().send(input).expect(201);
    const action = actionDetailSchema.parse(created.body);
    expect(action).toMatchObject({
      version: 1,
      status: 'PLANNED',
      sourceRiskVersion: 1,
      dueDate: '2026-10-20',
      createdBy: { id: userId },
      contextSnapshot: { factor: 'Fator de origem fictício' },
    });
    expect((await db.client.risk.findUniqueOrThrow({ where: { id: riskId } })).version).toBe(1);
    await patch(action.id)
      .send({
        expectedVersion: 1,
        changeReason: 'Tentativa de salto inválido',
        status: 'IMPLEMENTED',
        implementationNote: 'Relato suficientemente longo fictício',
      })
      .expect(409);
    const updates = await Promise.all(
      ['Medida edição A', 'Medida edição B'].map((title) =>
        patch(action.id).send({
          title,
          expectedVersion: 1,
          changeReason: 'Correção fictícia do conteúdo',
        }),
      ),
    );
    expect(updates.map((response) => response.status).sort()).toEqual([200, 409]);
    const started = await patch(action.id)
      .send({
        expectedVersion: 2,
        changeReason: 'Início informado pelo administrador',
        status: 'IN_PROGRESS',
      })
      .expect(200);
    expect(started.body.status).toBe('IN_PROGRESS');
    await patch(action.id)
      .send({
        expectedVersion: 3,
        changeReason: 'Execução informada fictícia',
        status: 'IMPLEMENTED',
      })
      .expect(400);
    const implemented = await patch(action.id)
      .send({
        expectedVersion: 3,
        changeReason: 'Execução informada fictícia',
        status: 'IMPLEMENTED',
        implementationNote: 'Execução da medida registrada como relato fictício',
      })
      .expect(200);
    expect(implemented.body).toMatchObject({ version: 4, status: 'IMPLEMENTED', isOverdue: false });
    expect(implemented.body.implementedAt).not.toBeNull();
    await patch(action.id)
      .send({
        expectedVersion: 4,
        changeReason: 'Tentativa de alteração posterior',
        title: 'Alteração vedada',
      })
      .expect(409);
    await note(action.id, 4).expect(201);
    const history = await api()
      .get(`${base}/actions/${action.id}/revisions`)
      .set('Cookie', cookie)
      .expect(200);
    const revisions = actionRevisionListSchema.parse(history.body);
    expect(revisions.items.map((revision) => revision.event)).toEqual([
      'NOTE',
      'IMPLEMENTED',
      'STARTED',
      'UPDATED',
      'CREATED',
    ]);
    expect(revisions.items.at(-1)?.snapshot.title).toBe('Medida fictícia');
    const revision = revisions.items[0];
    if (!revision) throw Error('History expected');
    await expect(
      db.client.actionRevision.update({
        where: { id: revision.id },
        data: { text: 'Sobrescrever' },
      }),
    ).rejects.toThrow();
    await expect(db.client.actionRevision.delete({ where: { id: revision.id } })).rejects.toThrow();
    await expect(
      db.client.actionRevision.create({
        data: {
          organizationId: orgId,
          actionId: action.id,
          version: revision.version,
          event: 'NOTE',
          snapshot: {},
          authorId: userId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.client.action.update({ where: { id: action.id }, data: { contextSnapshot: {} } }),
    ).rejects.toThrow();
    expect(
      await db.client.auditEvent.count({
        where: { organizationId: orgId, resourceId: action.id, action: { startsWith: 'ACTION_' } },
      }),
    ).toBe(5);
  });
  it('rolls back action changes when revision or audit cannot persist', async () => {
    const created = await post().send(input).expect(201);
    const repository = app.get(ActionsRepository);
    const fail = jest
      .spyOn(repository, 'revision')
      .mockRejectedValueOnce(new Error('Synthetic persistence failure'));
    try {
      await patch(created.body.id)
        .send({
          expectedVersion: 1,
          title: 'Alteração que deve voltar',
          changeReason: 'Teste fictício de atomicidade',
        })
        .expect(500);
    } finally {
      fail.mockRestore();
    }
    const current = await api()
      .get(`${base}/actions/${created.body.id}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(current.body).toMatchObject({ title: input.title, version: 1 });
    expect(await db.client.actionRevision.count({ where: { actionId: created.body.id } })).toBe(1);
  });
  it('validates same-risk evaluations at both service and PostgreSQL boundaries', async () => {
    const origin = await db.client.risk.findUniqueOrThrow({ where: { id: riskId } });
    const other = await db.client.risk.create({
      data: {
        organizationId: orgId,
        assessmentGroupId: origin.assessmentGroupId,
        factor: 'Outro risco fictício',
        createdById: userId,
        updatedById: userId,
      },
    });
    const evaluation = await db.client.riskEvaluation.create({
      data: {
        organizationId: orgId,
        riskId: other.id,
        sequence: 1,
        riskVersion: 1,
        contextSnapshot: {},
        methodReference: 'Teste',
        methodVersion: '1',
        observation: 'Observação fictícia',
        rationale: 'Razão fictícia',
        authorId: userId,
      },
    });
    await post()
      .send({ ...input, evaluationId: evaluation.id })
      .expect(404);
    const action = await post().send(input).expect(201);
    const record = await db.client.action.findUniqueOrThrow({ where: { id: action.body.id } });
    await expect(
      db.client.action.create({
        data: {
          ...record,
          contextSnapshot: actionDetailSchema.parse(action.body).contextSnapshot,
          id: randomUUID(),
          evaluationId: evaluation.id,
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.client.action.create({
        data: {
          ...record,
          contextSnapshot: actionDetailSchema.parse(action.body).contextSnapshot,
          id: randomUUID(),
          organizationId: foreignOrg,
        },
      }),
    ).rejects.toThrow();
  });
  it('uses full totals, strict filters and civil dates in region aliases and offsets', async () => {
    for (const zone of ['+14:00', '-12:00', 'CST', 'America/Sao_Paulo']) {
      await db.client.organization.update({ where: { id: orgId }, data: { timezone: zone } });
      const created = await post()
        .send({ ...input, dueDate: '2000-02-29' })
        .expect(201);
      expect(created.body).toMatchObject({
        dueDate: '2000-02-29',
        isOverdue: true,
        timeZone: zone,
      });
    }
    const overview = await api().get(`${base}/action-overview`).set('Cookie', cookie).expect(200);
    const snapshot = actionOverviewSchema.parse(overview.body);
    const overdue = await api()
      .get(`${base}/actions?overdue=true&pageSize=1`)
      .set('Cookie', cookie)
      .expect(200);
    expect(overdue.body.total).toBe(snapshot.totals.overdue);
    expect(overdue.body.items).toHaveLength(1);
    const terminal = await api()
      .get(`${base}/actions?overdue=true&status=IMPLEMENTED`)
      .set('Cookie', cookie)
      .expect(200);
    expect(terminal.body.total).toBe(0);
    for (const query of [
      'openOnly=1',
      'openOnly=true&openOnly=false',
      'q=a&q=b',
      'unknown=x',
      'page=1&page=2',
      'page=1e2',
    ])
      await api().get(`${base}/actions?${query}`).set('Cookie', cookie).expect(400);
    const dueToday = snapshot.referenceDate;
    const today = await post()
      .send({ ...input, dueDate: dueToday })
      .expect(201);
    expect(today.body.isOverdue).toBe(false);
    const anotherUnit = await db.client.unit.create({
      data: { organizationId: orgId, name: 'Outra unidade', normalizedName: 'outra' },
    });
    await api()
      .get(`${base}/actions?unitId=${anotherUnit.id}&sectorId=${sectorId}`)
      .set('Cookie', cookie)
      .expect(400);
  });
  it('refuses new actions from drafts/inactive scope and permits tracking archived origins', async () => {
    const action = await post().send(input).expect(201);
    await db.client.sector.update({ where: { id: sectorId }, data: { isActive: false } });
    await post().send(input).expect(409);
    await note(action.body.id, 1).expect(201);
    await db.client.sector.update({ where: { id: sectorId }, data: { isActive: true } });
    await db.client.risk.update({ where: { id: riskId }, data: { status: 'DRAFT' } });
    await post().send(input).expect(409);
    await db.client.risk.update({
      where: { id: riskId },
      data: { status: 'ARCHIVED', factor: 'Origem posterior alterada' },
    });
    await post().send(input).expect(409);
    const cancelled = await patch(action.body.id)
      .send({
        expectedVersion: 2,
        status: 'CANCELLED',
        changeReason: 'Cancelamento fictício da medida',
      })
      .expect(200);
    expect(cancelled.body).toMatchObject({
      currentOrigin: { riskStatus: 'ARCHIVED' },
      contextSnapshot: { factor: 'Fator de origem fictício' },
    });
    await note(action.body.id, 3).expect(201);
    await db.client.risk.update({
      where: { id: riskId },
      data: { status: 'REGISTERED', factor: 'Fator de origem fictício' },
    });
  });
  it('validates attachment inputs before touching storage and preserves actions when unavailable', async () => {
    const action = await post().send(input).expect(201);
    await upload(action.body.id, 1, Buffer.from('not pdf')).expect(400);
    await upload(action.body.id, 1, Buffer.from('%PDF-1.7'), 'file.png', 'image/png').expect(400);
    await upload(action.body.id, 1, Buffer.alloc(5 * 1024 * 1024 + 1), 'file.pdf').expect(413);
    const storage = app.get(EvidenceStorage);
    const fail = jest
      .spyOn(storage, 'put')
      .mockRejectedValueOnce(new (await import('@nestjs/common')).ServiceUnavailableException());
    try {
      await upload(action.body.id, 1).expect(503);
    } finally {
      fail.mockRestore();
    }
    expect(
      (await db.client.action.findUniqueOrThrow({ where: { id: action.body.id } })).version,
    ).toBe(1);
    await note(action.body.id, 1).expect(201);
  });
  it('returns a sanitized 503 with storage disabled while actions and notes remain usable', async () => {
    const action = await post().send(input).expect(201);
    const disabledEnvironment = { ...environment, STORAGE_ENABLED: false };
    const module = await Test.createTestingModule({
      imports: [AppModule.configure(disabledEnvironment)],
    }).compile();
    const disabled = module.createNestApplication();
    configureApplication(disabled, disabledEnvironment);
    await disabled.init();
    try {
      const result = await request(disabled.getHttpServer())
        .post(`${base}/actions/${action.body.id}/evidence`)
        .set('Cookie', cookie)
        .set('Origin', environment.CORS_ORIGIN)
        .field('description', 'Anexo fictício sem armazenamento')
        .field('expectedVersion', '1')
        .attach('file', Buffer.from('%PDF-1.7\nSynthetic\n%%EOF'), {
          filename: 'synthetic.pdf',
          contentType: 'application/pdf',
        })
        .expect(503);
      expect(result.headers['cache-control']).toBe('private, no-store');
      expect(result.body).toMatchObject({
        statusCode: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service unavailable',
      });
      expect(JSON.stringify(result.body)).not.toContain(environment.S3_ENDPOINT);
      await request(disabled.getHttpServer())
        .get(`${base}/actions/${action.body.id}`)
        .set('Cookie', cookie)
        .expect(200);
      await request(disabled.getHttpServer())
        .post(`${base}/actions/${action.body.id}/notes`)
        .set('Cookie', cookie)
        .set('Origin', environment.CORS_ORIGIN)
        .send({ expectedVersion: 1, text: 'Nota preservada com armazenamento desligado' })
        .expect(201);
      expect(await db.client.actionEvidence.count({ where: { actionId: action.body.id } })).toBe(0);
    } finally {
      await disabled.close();
    }
  }, 30000);
  itStorage(
    'stores private bytes, authenticates downloads and archives append-only metadata',
    async () => {
      const action = await post().send(input).expect(201);
      const response = await upload(action.body.id, 1).expect(201);
      const evidence = evidenceSchema.parse(response.body);
      expect(evidence.actionVersion).toBe(2);
      expect(response.body.objectKey).toBeUndefined();
      expect(evidence.fileName).not.toBe('fixture.pdf');
      const route = `${base}/actions/${action.body.id}/evidence/${evidence.id}/download`;
      const downloaded = await api().get(route).set('Cookie', readerCookie).expect(200);
      expect(downloaded.headers).toMatchObject({
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      });
      expect(downloaded.headers['content-disposition']).toContain('attachment;');
      expect(createHash('sha256').update(downloaded.body).digest('hex')).toBe(evidence.sha256);
      await api().get(route).expect(401);
      const other = await post().send(input).expect(201);
      await api()
        .get(`${base}/actions/${other.body.id}/evidence/${evidence.id}/download`)
        .set('Cookie', cookie)
        .expect(404);
      const archived = await api()
        .patch(`${base}/actions/${action.body.id}/evidence/${evidence.id}`)
        .set('Cookie', cookie)
        .set('Origin', environment.CORS_ORIGIN)
        .send({ expectedVersion: 2, changeReason: 'Arquivamento fictício justificado' })
        .expect(200);
      expect(archived.body.archivedAt).not.toBeNull();
      await api().get(route).set('Cookie', cookie).expect(200);
      await expect(
        db.client.actionEvidence.delete({ where: { id: evidence.id } }),
      ).rejects.toThrow();
      await expect(
        db.client.actionEvidence.update({
          where: { id: evidence.id },
          data: { description: 'Alteração proibida' },
        }),
      ).rejects.toThrow();
      const history = await api()
        .get(`${base}/actions/${action.body.id}/revisions`)
        .set('Cookie', cookie)
        .expect(200);
      expect(history.body.items.map((entry: { event: string }) => entry.event)).toEqual([
        'EVIDENCE_ARCHIVED',
        'EVIDENCE_ADDED',
        'CREATED',
      ]);
    },
  );
  itStorage(
    'caps active attachments at twenty and arbitrates concurrent uploads after cancellation',
    async () => {
      const action = await post().send(input).expect(201);
      await patch(action.body.id)
        .send({
          expectedVersion: 1,
          status: 'CANCELLED',
          changeReason: 'Cancelamento fictício para anexar histórico',
        })
        .expect(200);
      const results = await Promise.all([upload(action.body.id, 2), upload(action.body.id, 2)]);
      expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
      expect(
        await db.client.action.findUniqueOrThrow({ where: { id: action.body.id } }),
      ).toMatchObject({ version: 3, status: 'CANCELLED' });
      await db.client.actionEvidence.createMany({
        data: Array.from({ length: 19 }, () => ({
          organizationId: orgId,
          actionId: action.body.id,
          description: 'Metadado fictício de limite',
          fileName: `${randomUUID()}.pdf`,
          objectKey: `${orgId}/${action.body.id}/${randomUUID()}.pdf`,
          mimeType: 'application/pdf',
          size: 1,
          sha256: 'a'.repeat(64),
          actionVersion: 3,
          createdById: userId,
        })),
      });
      await upload(action.body.id, 3).expect(409);
      expect(
        await db.client.actionEvidence.count({
          where: { actionId: action.body.id, archivedAt: null },
        }),
      ).toBe(20);
      expect(
        await db.client.action.findUniqueOrThrow({ where: { id: action.body.id } }),
      ).toMatchObject({ version: 3 });
    },
  );
  itStorage('preserves referenced bytes when commit acknowledgement is lost', async () => {
    const action = await post().send(input).expect(201);
    const repository = app.get(ActionsRepository),
      storage = app.get(EvidenceStorage);
    const original = repository.transaction.bind(repository);
    let transactions = 0;
    const fail = jest.spyOn(repository, 'transaction').mockImplementation(async (operation) => {
      const result = await original(operation);
      transactions += 1;
      if (transactions === 2) throw new Error('Synthetic lost commit acknowledgement');
      return result;
    });
    try {
      await upload(action.body.id, 1).expect(500);
    } finally {
      fail.mockRestore();
    }
    const evidence = await db.client.actionEvidence.findFirstOrThrow({
      where: { actionId: action.body.id },
    });
    const bytes = await storage.get(evidence.objectKey);
    const chunks: Buffer[] = [];
    for await (const chunk of bytes) chunks.push(Buffer.from(chunk));
    expect(createHash('sha256').update(Buffer.concat(chunks)).digest('hex')).toBe(evidence.sha256);
  });
  itStorage(
    'retains the object and durable attempt when evidence transaction rolls back',
    async () => {
      const action = await post().send(input).expect(201);
      const repository = app.get(ActionsRepository),
        storage = app.get(EvidenceStorage);
      const cleanup = jest.spyOn(storage, 'compensate');
      const fail = jest
        .spyOn(repository, 'revision')
        .mockRejectedValueOnce(new Error('Synthetic DB failure'));
      try {
        await upload(action.body.id, 1).expect(500);
      } finally {
        fail.mockRestore();
      }
      expect(cleanup).not.toHaveBeenCalled();
      cleanup.mockRestore();
      const attempt = await db.client.evidenceUploadAttempt.findFirstOrThrow({
        where: { actionId: action.body.id },
      });
      expect(attempt.state).toBe('UNCERTAIN');
      const stream = await storage.get(attempt.objectKey);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      expect(createHash('sha256').update(Buffer.concat(chunks)).digest('hex')).toBe(attempt.sha256);
      expect(await db.client.actionEvidence.count({ where: { actionId: action.body.id } })).toBe(0);
      expect(
        (await db.client.action.findUniqueOrThrow({ where: { id: action.body.id } })).version,
      ).toBe(1);
    },
  );
  itStorage('replays an upload idempotency key without another revision', async () => {
    const action = (await post().send(input).expect(201)).body;
    const key = randomUUID();
    const first = await upload(action.id, action.version).set('Idempotency-Key', key).expect(201);
    const unavailable = jest
      .spyOn(app.get(EvidenceStorage), 'assertEnabled')
      .mockImplementation(() => {
        throw new Error('Storage availability is irrelevant to a completed replay');
      });
    try {
      const replay = await upload(action.id, action.version)
        .set('Idempotency-Key', key)
        .expect(201);
      expect(replay.body).toEqual(first.body);
      expect(unavailable).not.toHaveBeenCalled();
    } finally {
      unavailable.mockRestore();
    }
    expect(await db.client.actionEvidence.count({ where: { actionId: action.id } })).toBe(1);
  });
  const attemptRoute = (actionId: string, key: string) =>
    `${base}/actions/${actionId}/evidence/upload-attempts/${key}`;
  const getAttempt = (actionId: string, key: string) =>
    api().get(attemptRoute(actionId, key)).set('Cookie', cookie);
  const recover = (actionId: string, key: string, operation: string, body: object) =>
    api()
      .post(`${attemptRoute(actionId, key)}/${operation}`)
      .set('Cookie', cookie)
      .set('Origin', environment.CORS_ORIGIN)
      .send(body);
  itStorage(
    'rejects changed content before S3 and validates header UUID without extra multipart fields',
    async () => {
      const action = (await post().send(input).expect(201)).body;
      const key = randomUUID();
      const first = await upload(action.id, 1).set('Idempotency-Key', key).expect(201);
      const put = jest.spyOn(app.get(EvidenceStorage), 'put');
      try {
        await upload(action.id, 2, Buffer.from('%PDF-1.7\nDifferent'))
          .set('Idempotency-Key', key)
          .expect(409);
        await upload(action.id, 2).set('Idempotency-Key', 'invalid').expect(400);
        const replay = await upload(action.id, 1, undefined, 'renamed.pdf')
          .set('Idempotency-Key', key)
          .expect(201);
        expect(replay.body.id).toBe(first.body.id);
        expect(put).not.toHaveBeenCalled();
        expect((await getAttempt(action.id, key).expect(200)).body).toMatchObject({
          state: 'COMPLETED',
          evidence: { id: first.body.id },
        });
        await api().get(attemptRoute(action.id, key)).set('Cookie', readerCookie).expect(403);
      } finally {
        put.mockRestore();
      }
    },
  );
  itStorage(
    'reconciles uploaded bytes after lost PUT response and process restart without another PUT',
    async () => {
      const action = (await post().send(input).expect(201)).body;
      const key = randomUUID(),
        storage = app.get(EvidenceStorage),
        putOriginal = storage.put.bind(storage);
      const put = jest.spyOn(storage, 'put').mockImplementationOnce(async (...args) => {
        await putOriginal(...args);
        throw new (await import('@nestjs/common')).ServiceUnavailableException();
      });
      try {
        await upload(action.id, 1).set('Idempotency-Key', key).expect(503);
      } finally {
        put.mockRestore();
      }
      const attempt = (await getAttempt(action.id, key).expect(200)).body;
      expect(attempt).toMatchObject({ state: 'UNCERTAIN', retryAllowed: false, evidence: null });
      expect(JSON.stringify(attempt)).not.toMatch(/objectKey|fingerprint|leaseToken|creatorId/);
      const module = await Test.createTestingModule({
        imports: [AppModule.configure(environment)],
      }).compile();
      const restarted = module.createNestApplication();
      configureApplication(restarted, environment);
      await restarted.init();
      const restartPut = jest.spyOn(restarted.get(EvidenceStorage), 'put');
      try {
        const result = await request(restarted.getHttpServer())
          .post(`${attemptRoute(action.id, key)}/reconcile`)
          .set('Cookie', cookie)
          .set('Origin', environment.CORS_ORIGIN)
          .send({ expectedVersion: 1, attemptVersion: attempt.attemptVersion })
          .expect(201);
        expect(result.body.state).toBe('COMPLETED');
        expect(restartPut).not.toHaveBeenCalled();
        const evidence = (await upload(action.id, 1).set('Idempotency-Key', key).expect(201)).body;
        expect(evidence.id).toBe(result.body.evidence.id);
        expect(
          await db.client.actionRevision.count({
            where: { actionId: action.id, event: 'EVIDENCE_ADDED' },
          }),
        ).toBe(1);
      } finally {
        restartPut.mockRestore();
        await restarted.close();
      }
    },
  );
  itStorage('requires confirmed absence and original content before explicit retry', async () => {
    const action = (await post().send(input).expect(201)).body;
    const key = randomUUID(),
      storage = app.get(EvidenceStorage);
    const put = jest
      .spyOn(storage, 'put')
      .mockRejectedValueOnce(new (await import('@nestjs/common')).ServiceUnavailableException());
    try {
      await upload(action.id, 1).set('Idempotency-Key', key).expect(503);
    } finally {
      put.mockRestore();
    }
    let attempt = (await getAttempt(action.id, key).expect(200)).body;
    const retry = (bytes: Buffer) =>
      api()
        .post(`${attemptRoute(action.id, key)}/retry`)
        .set('Cookie', cookie)
        .set('Origin', environment.CORS_ORIGIN)
        .field('description', 'Documento inteiramente fictício')
        .field('expectedVersion', '1')
        .field('attemptVersion', String(attempt.attemptVersion))
        .attach('file', bytes, { filename: 'new-name.pdf', contentType: 'application/pdf' });
    await retry(Buffer.from('%PDF-1.7\nSynthetic fixture\n%%EOF')).expect(409);
    attempt = (
      await recover(action.id, key, 'reconcile', {
        expectedVersion: 1,
        attemptVersion: attempt.attemptVersion,
      }).expect(201)
    ).body;
    expect(attempt).toMatchObject({
      state: 'RETRYABLE',
      objectState: 'ABSENT',
      retryAllowed: true,
    });
    await retry(Buffer.from('%PDF-1.7\nDifferent bytes')).expect(409);
    const complete = await retry(Buffer.from('%PDF-1.7\nSynthetic fixture\n%%EOF')).expect(201);
    expect(complete.body.state).toBe('COMPLETED');
  });
  itStorage('keeps unknown probes uncertain and never retries or deletes bytes', async () => {
    const action = (await post().send(input).expect(201)).body;
    const key = randomUUID(),
      storage = app.get(EvidenceStorage);
    const failure = jest
      .spyOn(storage, 'put')
      .mockRejectedValueOnce(new (await import('@nestjs/common')).ServiceUnavailableException());
    try {
      await upload(action.id, 1).set('Idempotency-Key', key).expect(503);
    } finally {
      failure.mockRestore();
    }
    const attempt = (await getAttempt(action.id, key).expect(200)).body;
    const probe = jest.spyOn(storage, 'probe').mockResolvedValue('UNKNOWN');
    const put = jest.spyOn(storage, 'put'),
      cleanup = jest.spyOn(storage, 'compensate');
    try {
      await getAttempt(action.id, key).expect(200);
      expect(probe).toHaveBeenCalledTimes(1);
      await recover(action.id, key, 'reconcile', {
        expectedVersion: 1,
        attemptVersion: attempt.attemptVersion,
      }).expect(503);
      expect((await getAttempt(action.id, key).expect(200)).body).toMatchObject({
        state: 'UNCERTAIN',
        objectState: 'UNKNOWN',
        retryAllowed: false,
      });
      expect(put).not.toHaveBeenCalled();
      expect(cleanup).not.toHaveBeenCalled();
    } finally {
      probe.mockRestore();
      put.mockRestore();
      cleanup.mockRestore();
    }
  });
  itStorage(
    'fences finalization after action changes during PUT without holding the action lock',
    async () => {
      const action = (await post().send(input).expect(201)).body;
      const key = randomUUID(),
        storage = app.get(EvidenceStorage),
        original = storage.put.bind(storage);
      const put = jest.spyOn(storage, 'put').mockImplementationOnce(async (...args) => {
        await original(...args);
        await note(action.id, 1).expect(201);
      });
      try {
        await upload(action.id, 1).set('Idempotency-Key', key).expect(409);
      } finally {
        put.mockRestore();
      }
      const attempt = (await getAttempt(action.id, key).expect(200)).body;
      expect(attempt.state).toBe('UNCERTAIN');
      expect(await db.client.actionEvidence.count({ where: { actionId: action.id } })).toBe(0);
      const done = await recover(action.id, key, 'reconcile', {
        expectedVersion: 2,
        attemptVersion: attempt.attemptVersion,
      }).expect(201);
      expect(done.body.evidence.actionVersion).toBe(3);
    },
  );
  itStorage(
    'fences revoked permission during PUT and permits explicit recovery after restoration',
    async () => {
      const action = (await post().send(input).expect(201)).body;
      const key = randomUUID(),
        storage = app.get(EvidenceStorage),
        original = storage.put.bind(storage);
      const put = jest.spyOn(storage, 'put').mockImplementationOnce(async (...args) => {
        await original(...args);
        await db.client.membership.update({
          where: { userId_organizationId: { userId, organizationId: orgId } },
          data: { isActive: false },
        });
      });
      try {
        await upload(action.id, 1).set('Idempotency-Key', key).expect(403);
        expect(await db.client.actionEvidence.count({ where: { actionId: action.id } })).toBe(0);
        await getAttempt(action.id, key).expect(404);
      } finally {
        put.mockRestore();
        await db.client.membership.update({
          where: { userId_organizationId: { userId, organizationId: orgId } },
          data: { isActive: true },
        });
      }
      const attempt = (await getAttempt(action.id, key).expect(200)).body;
      await recover(action.id, key, 'reconcile', {
        expectedVersion: 1,
        attemptVersion: attempt.attemptVersion,
      }).expect(201);
    },
  );
  itStorage(
    'abandons an active worker and rejects late completion and further recovery',
    async () => {
      const action = (await post().send(input).expect(201)).body;
      const key = randomUUID(),
        storage = app.get(EvidenceStorage),
        original = storage.put.bind(storage);
      const put = jest.spyOn(storage, 'put').mockImplementationOnce(async (...args) => {
        await original(...args);
        const attempt = (await getAttempt(action.id, key).expect(200)).body;
        await recover(action.id, key, 'abandon', {
          attemptVersion: attempt.attemptVersion,
          reason: 'Operação explicitamente abandonada',
        }).expect(201);
      });
      const cleanup = jest.spyOn(storage, 'compensate');
      try {
        await upload(action.id, 1).set('Idempotency-Key', key).expect(409);
        const attempt = (await getAttempt(action.id, key).expect(200)).body;
        expect(attempt.state).toBe('ABANDONED');
        await recover(action.id, key, 'reconcile', {
          expectedVersion: 1,
          attemptVersion: attempt.attemptVersion,
        }).expect(409);
        expect(await db.client.actionEvidence.count({ where: { actionId: action.id } })).toBe(0);
        expect(cleanup).not.toHaveBeenCalled();
      } finally {
        put.mockRestore();
        cleanup.mockRestore();
      }
    },
  );
  itStorage(
    'reserves at most twenty concurrent slots and releases abandoned reservations',
    async () => {
      const action = (await post().send(input).expect(201)).body;
      const storage = app.get(EvidenceStorage),
        put = jest
          .spyOn(storage, 'put')
          .mockRejectedValue(new (await import('@nestjs/common')).ServiceUnavailableException());
      const keys = Array.from({ length: 21 }, () => randomUUID());
      try {
        const results = await Promise.all(
          keys.map((key) => upload(action.id, 1).set('Idempotency-Key', key)),
        );
        expect(results.filter((result) => result.status === 503)).toHaveLength(20);
        expect(results.filter((result) => result.status === 409)).toHaveLength(1);
        expect(
          await db.client.evidenceUploadAttempt.count({ where: { actionId: action.id } }),
        ).toBe(20);
        const saved = await db.client.evidenceUploadAttempt.findFirstOrThrow({
          where: { actionId: action.id },
        });
        await recover(action.id, saved.key, 'abandon', {
          attemptVersion: saved.attemptVersion,
          reason: 'Liberação explícita da reserva',
        }).expect(201);
        await upload(action.id, 1).set('Idempotency-Key', randomUUID()).expect(503);
      } finally {
        put.mockRestore();
      }
    },
    30000,
  );
  itStorage(
    'serializes the same key during PUT and enforces durable database constraints',
    async () => {
      const action = (await post().send(input).expect(201)).body;
      const key = randomUUID(),
        storage = app.get(EvidenceStorage),
        original = storage.put.bind(storage);
      const put = jest.spyOn(storage, 'put').mockImplementationOnce(async (...args) => {
        await upload(action.id, 1).set('Idempotency-Key', key).expect(409);
        await original(...args);
      });
      try {
        await upload(action.id, 1).set('Idempotency-Key', key).expect(201);
        expect(put).toHaveBeenCalledTimes(1);
      } finally {
        put.mockRestore();
      }
      const attempt = await db.client.evidenceUploadAttempt.findFirstOrThrow({
        where: { actionId: action.id },
      });
      await expect(
        db.client.evidenceUploadAttempt.update({
          where: { id: attempt.id },
          data: { state: 'UNCERTAIN', attemptVersion: { increment: 1 } },
        }),
      ).rejects.toThrow();
      await expect(
        db.client.evidenceUploadAttempt.create({
          data: {
            ...attempt,
            id: randomUUID(),
            key: randomUUID(),
            objectKey: randomUUID(),
            organizationId: foreignOrg,
          },
        }),
      ).rejects.toThrow();
      await expect(
        db.client.evidenceUploadAttempt.create({
          data: {
            ...attempt,
            id: randomUUID(),
            key: randomUUID(),
            objectKey: randomUUID(),
            evidenceId: null,
            state: 'RETRYABLE',
            objectState: 'UNKNOWN',
          },
        }),
      ).rejects.toThrow();
    },
  );
  itStorage('fences an expired worker after reconciliation takes over its lease', async () => {
    const action = (await post().send(input).expect(201)).body;
    const key = randomUUID(),
      storage = app.get(EvidenceStorage),
      original = storage.put.bind(storage);
    const put = jest.spyOn(storage, 'put').mockImplementationOnce(async (...args) => {
      await original(...args);
      const current = await db.client.evidenceUploadAttempt.findFirstOrThrow({
        where: { actionId: action.id, key },
      });
      await db.client.evidenceUploadAttempt.update({
        where: { id: current.id },
        data: { leaseExpiresAt: new Date(Date.now() - 1), attemptVersion: { increment: 1 } },
      });
      const before = await db.client.evidenceUploadAttempt.findUniqueOrThrow({
        where: { id: current.id },
      });
      const probe = jest.spyOn(storage, 'probe');
      try {
        const queried = (await getAttempt(action.id, key).expect(200)).body;
        expect(queried).toMatchObject({
          state: 'UPLOADING',
          objectState: 'PRESENT',
          retryAllowed: false,
        });
        expect(probe).toHaveBeenCalledTimes(1);
        expect(
          await db.client.evidenceUploadAttempt.findUniqueOrThrow({ where: { id: current.id } }),
        ).toEqual(before);
        await recover(action.id, key, 'reconcile', {
          expectedVersion: 1,
          attemptVersion: queried.attemptVersion,
        }).expect(201);
      } finally {
        probe.mockRestore();
      }
    });
    try {
      await upload(action.id, 1).set('Idempotency-Key', key).expect(409);
      expect((await getAttempt(action.id, key).expect(200)).body.state).toBe('COMPLETED');
      expect(await db.client.actionEvidence.count({ where: { actionId: action.id } })).toBe(1);
      expect(
        await db.client.actionRevision.count({
          where: { actionId: action.id, event: 'EVIDENCE_ADDED' },
        }),
      ).toBe(1);
    } finally {
      put.mockRestore();
    }
  });
  itStorage.each(['PRESENT', 'UNKNOWN'] as const)(
    'probes again before retry and performs no PUT when the object is %s',
    async (objectState) => {
      const action = (await post().send(input).expect(201)).body;
      const key = randomUUID(),
        storage = app.get(EvidenceStorage);
      const failure = jest
        .spyOn(storage, 'put')
        .mockRejectedValueOnce(new (await import('@nestjs/common')).ServiceUnavailableException());
      try {
        await upload(action.id, 1).set('Idempotency-Key', key).expect(503);
      } finally {
        failure.mockRestore();
      }
      let attempt = (await getAttempt(action.id, key).expect(200)).body;
      attempt = (
        await recover(action.id, key, 'reconcile', {
          expectedVersion: 1,
          attemptVersion: attempt.attemptVersion,
        }).expect(201)
      ).body;
      expect(attempt.state).toBe('RETRYABLE');
      const stored = await db.client.evidenceUploadAttempt.findFirstOrThrow({
        where: { actionId: action.id, key },
      });
      if (objectState === 'PRESENT')
        await storage.put(
          stored.objectKey,
          Buffer.from('%PDF-1.7\nSynthetic fixture\n%%EOF'),
          stored.mimeType,
          stored.sha256,
        );
      const probe =
        objectState === 'UNKNOWN'
          ? jest.spyOn(storage, 'probe').mockResolvedValue('UNKNOWN')
          : jest.spyOn(storage, 'probe');
      const put = jest.spyOn(storage, 'put');
      try {
        const response = await api()
          .post(`${attemptRoute(action.id, key)}/retry`)
          .set('Cookie', cookie)
          .set('Origin', environment.CORS_ORIGIN)
          .field('description', 'Documento inteiramente fictício')
          .field('expectedVersion', '1')
          .field('attemptVersion', String(attempt.attemptVersion))
          .attach('file', Buffer.from('%PDF-1.7\nSynthetic fixture\n%%EOF'), {
            filename: 'fixture.pdf',
            contentType: 'application/pdf',
          })
          .expect(objectState === 'PRESENT' ? 201 : 503);
        if (objectState === 'PRESENT') expect(response.body.state).toBe('COMPLETED');
        else expect((await getAttempt(action.id, key).expect(200)).body.state).toBe('UNCERTAIN');
        expect(probe).toHaveBeenCalled();
        expect(put).not.toHaveBeenCalled();
      } finally {
        probe.mockRestore();
        put.mockRestore();
      }
    },
  );
});
