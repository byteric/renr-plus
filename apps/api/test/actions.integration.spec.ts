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
    const fail = jest.spyOn(repository, 'transaction').mockImplementationOnce(async (operation) => {
      await original(operation);
      throw new Error('Synthetic lost commit acknowledgement');
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
  itStorage('compensates only the newly stored object on DB rollback', async () => {
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
    expect(cleanup).toHaveBeenCalledTimes(1);
    const key = cleanup.mock.calls[0]?.[0];
    cleanup.mockRestore();
    if (!key) throw Error('Expected generated key');
    await expect(storage.get(key)).rejects.toThrow();
    expect(await db.client.actionEvidence.count({ where: { actionId: action.body.id } })).toBe(0);
    expect(
      (await db.client.action.findUniqueOrThrow({ where: { id: action.body.id } })).version,
    ).toBe(1);
  });
});
