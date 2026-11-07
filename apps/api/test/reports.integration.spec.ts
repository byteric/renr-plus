import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';
import { localDatabaseUrl } from './local-database-url';
import {
  actionWorkspaceListSchema,
  managementIndicatorsSchema,
  reportSnapshotSchema,
  riskWorkspaceListSchema,
} from '@renr/contracts';
const describeDatabase = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
describeDatabase('Immutable reports and download authorization', () => {
  let app: INestApplication,
    db: PrismaService,
    org: string,
    user: string,
    cookie: string,
    risk: string,
    unitId: string,
    sectorId: string,
    groupId: string,
    foreign: string,
    reportId: string;
  let env: ReturnType<typeof parseEnvironment>;
  const base = () => `/api/v1/organizations/${org}/reports`;
  beforeAll(async () => {
    env = parseEnvironment({ ...process.env, NODE_ENV: 'test' });
    localDatabaseUrl(env.DATABASE_URL);
    const m = await Test.createTestingModule({ imports: [AppModule.configure(env)] }).compile();
    db = m.get(PrismaService);
    org = (
      await db.client.organization.create({
        data: { name: 'Synthetic immutable report ' + randomUUID() },
      })
    ).id;
    foreign = (
      await db.client.organization.create({ data: { name: 'Foreign report ' + randomUUID() } })
    ).id;
    user = (
      await db.client.user.create({
        data: {
          name: 'Synthetic reader',
          email: randomUUID() + '@example.test',
          passwordHash: 'unused',
        },
      })
    ).id;
    await db.client.membership.create({
      data: { userId: user, organizationId: org, role: 'READER' },
    });
    const token = Buffer.from(randomUUID() + randomUUID())
      .toString('base64url')
      .slice(0, 43);
    cookie = 'renr_session=' + token;
    await db.client.session.create({
      data: {
        userId: user,
        activeOrganizationId: org,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
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
    const group = await db.client.assessmentGroup.create({
      data: { organizationId: org, sectorId: sector.id, name: 'Synthetic group' },
    });
    unitId = unit.id;
    sectorId = sector.id;
    groupId = group.id;
    risk = (
      await db.client.risk.create({
        data: {
          organizationId: org,
          assessmentGroupId: group.id,
          factor: 'Synthetic original report risk',
          createdById: user,
          updatedById: user,
        },
      })
    ).id;
    app = m.createNestApplication();
    configureApplication(app, env);
    await app.init();
  });
  afterAll(async () => app?.close());
  it('reconcilia riscos e ações do relatório SST com o painel no mesmo recorte', async () => {
    const archived = await db.client.risk.create({
      data: {
        organizationId: org,
        assessmentGroupId: groupId,
        factor: 'Synthetic archived report risk',
        status: 'ARCHIVED',
        createdById: user,
        updatedById: user,
      },
    });
    const otherSector = await db.client.sector.create({
      data: { organizationId: org, unitId, name: 'Other sector', normalizedName: 'other sector' },
    });
    const otherGroup = await db.client.assessmentGroup.create({
      data: { organizationId: org, sectorId: otherSector.id, name: 'Other group' },
    });
    await db.client.risk.create({
      data: {
        organizationId: org,
        assessmentGroupId: otherGroup.id,
        factor: 'Risk outside the chosen sector',
        createdById: user,
        updatedById: user,
      },
    });
    const action = await db.client.action.create({
      data: {
        organizationId: org,
        riskId: archived.id,
        sourceRiskVersion: archived.version,
        contextSnapshot: {
          factor: archived.factor,
          description: 'Synthetic context',
          exposureDescription: 'Synthetic exposure',
          exposedGroupDescription: 'Synthetic group',
          possibleHarms: 'Synthetic impacts',
          existingControls: 'Synthetic controls',
          sourceKind: 'TECHNICAL_RECORD',
          sourceNote: 'Synthetic source',
          diagnosticCycleId: null,
          sectorId,
          assessmentGroupId: groupId,
          unit: { id: unitId, name: 'Synthetic unit', isActive: true },
          sector: { id: sectorId, name: 'Synthetic sector', isActive: true },
          status: 'REGISTERED',
        },
        title: 'Synthetic overdue action on archived risk',
        description: 'Synthetic plan for count verification.',
        responsibleName: 'Synthetic supervisor',
        dueDate: new Date('2000-01-01T00:00:00Z'),
        expectedResult: 'Synthetic result for count verification.',
        verificationCriterion: 'Synthetic evidence checks the criterion.',
        createdById: user,
        updatedById: user,
      },
    });
    const snapshot = reportSnapshotSchema.parse(
      (
        await request(app.getHttpServer())
          .post(base())
          .set('Cookie', cookie)
          .set('Origin', env.CORS_ORIGIN)
          .send({ kind: 'SST', unitId, sectorId, sectionKeys: ['inventory', 'actions'] })
          .expect(201)
      ).body,
    );
    const panel = managementIndicatorsSchema.parse(
      (
        await request(app.getHttpServer())
          .get(`/api/v1/organizations/${org}/management-indicators`)
          .query({ unitId, sectorId })
          .set('Cookie', cookie)
          .expect(200)
      ).body,
    );
    const preview = await request(app.getHttpServer())
      .get(base() + '/' + snapshot.id)
      .set('Cookie', cookie)
      .expect(200);
    expect(reportSnapshotSchema.parse(preview.body)).toEqual(snapshot);

    const readList = (resource: string) =>
      request(app.getHttpServer())
        .get(`/api/v1/organizations/${org}/${resource}`)
        .query({ unitId, sectorId })
        .set('Cookie', cookie)
        .expect(200);
    const listedRisks = riskWorkspaceListSchema.parse((await readList('risk-workspaces')).body);
    const listedActions = actionWorkspaceListSchema.parse(
      (await readList('action-workspaces')).body,
    );
    const inventory = snapshot.sections.find((item) => item.key === 'inventory');
    const inventoryNote =
      'Contagem do painel (riscos não arquivados) · 1. Arquivados incluídos no relatório · 1.';
    expect(panel.filters).toEqual({ unitId, sectorId });
    expect(panel.risks.total).toBe(1);
    expect(listedRisks.total).toBe(panel.risks.total);
    expect(listedRisks.items.map((item) => item.id)).toEqual([risk]);
    expect(inventory?.rows).toHaveLength(panel.risks.total + 1);
    expect(inventory?.notes).toContain(inventoryNote);
    const actions = snapshot.sections.find((item) => item.key === 'actions');
    expect(panel.actions).toMatchObject({ total: 1, planned: 1, overdue: 1 });
    expect(listedActions.total).toBe(panel.actions.total);
    expect(listedActions.items.map((item) => item.id)).toEqual([action.id]);
    expect(actions?.rows).toHaveLength(panel.actions.total);
    expect(actions?.rows[0]?.[0]).toContain(action.title);
    expect(panel.priorities.items[0]?.actionId).toBe(action.id);

    const pdf = await request(app.getHttpServer())
      .get(base() + '/' + snapshot.id + '/pdf')
      .set('Cookie', cookie)
      .expect(200);
    const extracted = spawnSync(
      process.env.PDF_TEST_PYTHON ?? 'python',
      [
        '-X',
        'utf8',
        '-c',
        "import io,sys; from pypdf import PdfReader; print(' '.join(page.extract_text() for page in PdfReader(io.BytesIO(sys.stdin.buffer.read())).pages))",
      ],
      { input: pdf.body, encoding: 'utf8' },
    );
    expect(extracted.status).toBe(0);
    const pdfText = extracted.stdout.replace(/\s+/g, ' ');
    for (const value of [inventoryNote, archived.factor, action.title])
      expect(pdfText).toContain(value);
    expect(pdfText).not.toContain('Risk outside the chosen sector');
  });
  it('captures one immutable snapshot and does not mix HR into SST', async () => {
    const result = await request(app.getHttpServer())
      .post(base())
      .set('Cookie', cookie)
      .set('Origin', env.CORS_ORIGIN)
      .send({ kind: 'SST' })
      .expect(201);
    const snapshot = reportSnapshotSchema.parse(result.body);
    reportId = snapshot.id;
    expect(snapshot.financial).toBe(false);
    expect(snapshot.nominal).toBe(false);
    expect(JSON.stringify(snapshot)).toContain('Synthetic original report risk');
    await db.client.risk.update({ where: { id: risk }, data: { factor: 'Changed AFTER report' } });
    const persisted = reportSnapshotSchema.parse(
      (
        await request(app.getHttpServer())
          .get(base() + '/' + reportId)
          .set('Cookie', cookie)
          .expect(200)
      ).body,
    );
    expect(persisted).toEqual(snapshot);
    expect(JSON.stringify(persisted)).not.toContain('Changed AFTER report');
    await request(app.getHttpServer())
      .post(base())
      .set('Cookie', cookie)
      .set('Origin', env.CORS_ORIGIN)
      .send({ kind: 'PEOPLE', includeFinancial: true })
      .expect(403);
  });
  it('emits exactly the selected report sections', async () => {
    const response = await request(app.getHttpServer())
      .post(base())
      .set('Cookie', cookie)
      .set('Origin', env.CORS_ORIGIN)
      .send({ kind: 'SST', sectionKeys: ['inventory', 'assessment-sources'] })
      .expect(201);
    const snapshot = reportSnapshotSchema.parse(response.body);
    expect(snapshot.sections.map((section) => section.key)).toEqual([
      'inventory',
      'assessment-sources',
    ]);
  });
  it('serves PDF privately from the snapshot and refuses foreign/revoked access', async () => {
    const pdf = await request(app.getHttpServer())
      .get(base() + '/' + reportId + '/pdf')
      .set('Cookie', cookie)
      .expect(200);
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
    expect(pdf.headers['cache-control']).toBe('private, no-store');
    expect(Buffer.from(pdf.body).subarray(0, 5).toString()).toBe('%PDF-');
    await request(app.getHttpServer())
      .get(`/api/v1/organizations/${foreign}/reports/${reportId}`)
      .set('Cookie', cookie)
      .expect(404);
    await db.client.membership.update({
      where: { userId_organizationId: { userId: user, organizationId: org } },
      data: { isActive: false },
    });
    await request(app.getHttpServer())
      .get(base() + '/' + reportId + '/pdf')
      .set('Cookie', cookie)
      .expect(404);
  });
});
