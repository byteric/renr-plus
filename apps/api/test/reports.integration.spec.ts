import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
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

function extractPdfPages(bytes: Buffer): string[] {
  const extracted = spawnSync(
    process.env.PDF_TEST_PYTHON ?? 'python',
    [
      '-X',
      'utf8',
      '-c',
      'import io,json,sys; from pypdf import PdfReader; print(json.dumps([page.extract_text() for page in PdfReader(io.BytesIO(sys.stdin.buffer.read())).pages]))',
    ],
    { input: bytes, encoding: 'utf8' },
  );
  expect(extracted.status).toBe(0);
  return JSON.parse(extracted.stdout) as string[];
}

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
  it('reconcilia painel, listas, prévia e PDF SST em dois recortes distintos', async () => {
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
    const otherUnit = await db.client.unit.create({
      data: { organizationId: org, name: 'Other unit', normalizedName: 'other unit' },
    });
    const otherSector = await db.client.sector.create({
      data: {
        organizationId: org,
        unitId: otherUnit.id,
        name: 'Other sector',
        normalizedName: 'other sector',
      },
    });
    const otherGroup = await db.client.assessmentGroup.create({
      data: { organizationId: org, sectorId: otherSector.id, name: 'Other group' },
    });
    const otherRisk = await db.client.risk.create({
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
    const issue = async (filters: { unitId: string; sectorId: string }) =>
      reportSnapshotSchema.parse(
        (
          await request(app.getHttpServer())
            .post(base())
            .set('Cookie', cookie)
            .set('Origin', env.CORS_ORIGIN)
            .send({ kind: 'SST', ...filters, sectionKeys: ['inventory', 'actions'] })
            .expect(201)
        ).body,
      );
    const readPanel = async (filters: { unitId: string; sectorId: string }) =>
      managementIndicatorsSchema.parse(
        (
          await request(app.getHttpServer())
            .get(`/api/v1/organizations/${org}/management-indicators`)
            .query(filters)
            .set('Cookie', cookie)
            .expect(200)
        ).body,
      );
    const readPreview = (id: string) =>
      request(app.getHttpServer())
        .get(base() + '/' + id)
        .set('Cookie', cookie)
        .expect(200);
    const snapshot = await issue({ unitId, sectorId });
    const panel = await readPanel({ unitId, sectorId });
    const preview = await readPreview(snapshot.id);
    expect(reportSnapshotSchema.parse(preview.body)).toEqual(snapshot);

    const readList = (resource: string, filters = { unitId, sectorId }) =>
      request(app.getHttpServer())
        .get(`/api/v1/organizations/${org}/${resource}`)
        .query(filters)
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

    const readPdfText = async (id: string) => {
      const pdf = await request(app.getHttpServer())
        .get(base() + '/' + id + '/pdf')
        .set('Cookie', cookie)
        .expect(200);
      return extractPdfPages(pdf.body).join(' ').replace(/\s+/g, ' ');
    };
    const pdfText = await readPdfText(snapshot.id);
    for (const value of [inventoryNote, archived.factor, action.title])
      expect(pdfText).toContain(value);
    expect(pdfText).not.toContain(otherRisk.factor);

    const otherFilters = { unitId: otherUnit.id, sectorId: otherSector.id };
    const otherPanel = await readPanel(otherFilters);
    const otherSnapshot = await issue(otherFilters);
    const otherRisks = riskWorkspaceListSchema.parse(
      (await readList('risk-workspaces', otherFilters)).body,
    );
    const otherActions = actionWorkspaceListSchema.parse(
      (await readList('action-workspaces', otherFilters)).body,
    );
    expect(otherPanel.filters).toEqual(otherFilters);
    expect(otherRisks.total).toBe(otherPanel.risks.total);
    expect(otherRisks.items.map(({ id }) => id)).toEqual([otherRisk.id]);
    expect(otherActions.total).toBe(otherPanel.actions.total);
    expect(otherActions.total).toBe(0);
    expect(reportSnapshotSchema.parse((await readPreview(otherSnapshot.id)).body)).toEqual(
      otherSnapshot,
    );
    const otherPdf = await readPdfText(otherSnapshot.id);
    expect(otherPdf).toContain(otherRisk.factor);
    expect(otherPdf).not.toContain(archived.factor);
    expect(otherPdf).not.toContain(action.title);
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
  it('emite um resumo executivo SST no mesmo retrato da prévia e do PDF', async () => {
    const item = await db.client.risk.create({
      data: {
        organizationId: org,
        assessmentGroupId: groupId,
        factor: 'Fator sintético prioritário',
        status: 'REGISTERED',
        createdById: user,
        updatedById: user,
      },
    });
    const action = await db.client.action.create({
      data: {
        organizationId: org,
        riskId: item.id,
        sourceRiskVersion: item.version,
        contextSnapshot: {},
        title: 'Medida sintética com prazo vencido',
        description: 'Verificação executiva por setor',
        responsibleName: 'Responsável sintético',
        dueDate: new Date('2000-02-03T00:00:00Z'),
        expectedResult: 'Verificação da execução',
        verificationCriterion: 'Inspeção técnica e conferência da evidência. '
          .repeat(39)
          .concat(' FIM_CRITERIO_SST'),
        createdById: user,
        updatedById: user,
      },
    });
    const issued = await request(app.getHttpServer())
      .post(base())
      .set('Cookie', cookie)
      .set('Origin', env.CORS_ORIGIN)
      .send({ kind: 'SST', unitId, sectorId, sectionKeys: ['executive-summary'] })
      .expect(201);
    const snapshot = reportSnapshotSchema.parse(issued.body);
    expect(snapshot.executiveVersion).toBe(1);
    expect(snapshot.sections[0]?.key).toBe('executive-summary');
    const priorities = snapshot.sections.find(({ key }) => key === 'executive-priorities');
    const source = priorities?.references?.find(({ id }) => id === action.id);
    expect(source).toMatchObject({
      kind: 'ACTION',
      id: action.id,
      riskId: item.id,
      unitId,
      sectorId,
    });
    expect(priorities?.rows[source!.row]?.join(' ')).toEqual(
      expect.stringContaining('Prazo vencido'),
    );
    expect(priorities?.rows[source!.row]?.join(' ')).toEqual(
      expect.stringContaining('Sem evidência ativa'),
    );
    expect(snapshot.filters).toEqual([
      { label: 'Unidade', value: 'Synthetic unit' },
      { label: 'Setor', value: 'Synthetic sector' },
    ]);
    const preview = await request(app.getHttpServer())
      .get(`${base()}/${snapshot.id}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(preview.body).toEqual(snapshot);
    await db.client.action.update({
      where: { id: action.id },
      data: { title: 'Título depois do retrato' },
    });
    const pdf = await request(app.getHttpServer())
      .get(`${base()}/${snapshot.id}/pdf`)
      .set('Cookie', cookie)
      .expect(200);
    const pages = extractPdfPages(pdf.body);
    expect(pages.length).toBeGreaterThan(1);
    const pdfText = pages.join(' ').replace(/\s+/g, ' ');
    for (const expected of [
      'Resumo executivo SST',
      'Responsável sintético',
      '03/02/2000',
      'FIM_CRITERIO_SST',
      action.title,
    ])
      expect(pdfText).toContain(expected);
    expect(pdfText).not.toContain('Título depois do retrato');
    await db.client.membership.create({
      data: { organizationId: foreign, userId: user, role: 'READER' },
    });
    await db.client.session.updateMany({
      where: { userId: user },
      data: { activeOrganizationId: foreign },
    });
    try {
      await request(app.getHttpServer())
        .get(`/api/v1/organizations/${foreign}/reports/${snapshot.id}/pdf`)
        .set('Cookie', cookie)
        .expect(404);
    } finally {
      await db.client.session.updateMany({
        where: { userId: user },
        data: { activeOrganizationId: org },
      });
    }
    await db.client.membership.update({
      where: { userId_organizationId: { userId: user, organizationId: org } },
      data: { isActive: false },
    });
    try {
      await request(app.getHttpServer())
        .get(`${base()}/${snapshot.id}/pdf`)
        .set('Cookie', cookie)
        .expect(404);
    } finally {
      await db.client.membership.update({
        where: { userId_organizationId: { userId: user, organizationId: org } },
        data: { isActive: true },
      });
    }
  }, 35_000);
  it('oculta uma diferença protegida também nas seções técnicas do resumo executivo', async () => {
    const instrument = await db.client.instrument.create({
      data: { organizationId: org, name: 'Instrumento sintético ID 43' },
    });
    const question = randomUUID();
    const choice = randomUUID();
    const version = await db.client.instrumentVersion.create({
      data: {
        organizationId: org,
        instrumentId: instrument.id,
        title: instrument.name,
        version: 1,
        isDemo: false,
        status: 'DRAFT',
        questions: {
          create: {
            id: question,
            label: 'Dimensão sintética',
            type: 'SINGLE_CHOICE',
            position: 1,
            options: {
              create: [
                { id: choice, label: 'Primeira', position: 1 },
                { label: 'Segunda', position: 2 },
              ],
            },
          },
        },
      },
    });
    await db.client.instrumentVersion.update({
      where: { id: version.id },
      data: { status: 'PUBLISHED', publishedById: user, publishedAt: new Date() },
    });
    const policy = await db.client.consolidationPolicyVersion.create({
      data: {
        organizationId: org,
        version: 1,
        status: 'PUBLISHED',
        usageMode: 'DEMONSTRATION',
        minimumResponses: 5,
        publishedById: user,
        publishedAt: new Date(),
      },
    });
    const cycle = async (name: string, startsAt: Date, size: number) => {
      const row = await db.client.assessmentCycle.create({
        data: {
          organizationId: org,
          assessmentGroupId: groupId,
          policyVersionId: policy.id,
          instrumentVersionId: version.id,
          name,
          startsAt,
          endsAt: new Date(Date.now() + 60_000),
        },
      });
      await db.client.assessmentCycle.update({
        where: { id: row.id },
        data: { status: 'OPEN', eligibleCount: 20 },
      });
      await db.client.assessmentInvite.createMany({
        data: Array.from({ length: 20 }, () => ({
          organizationId: org,
          cycleId: row.id,
          tokenHash: randomBytes(32).toString('hex'),
          expiresAt: row.endsAt,
        })),
      });
      const responses = Array.from({ length: size }, () => ({
        id: randomUUID(),
        organizationId: org,
        cycleId: row.id,
        instrumentVersionId: version.id,
      }));
      await db.client.assessmentResponse.createMany({ data: responses });
      await db.client.assessmentAnswer.createMany({
        data: responses.map(({ id }) => ({
          responseId: id,
          instrumentVersionId: version.id,
          questionId: question,
          optionIds: [choice],
        })),
      });
      return db.client.assessmentCycle.update({
        where: { id: row.id },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
    };
    const reference = await cycle(
      'Coleta de referência sintética',
      new Date(Date.now() - 60_000),
      6,
    );
    const start = new Date(reference.closedAt!.getTime() + 1);
    while (Date.now() < start.getTime()) await new Promise((resolve) => setTimeout(resolve, 1));
    const current = await cycle('Coleta sintética comparada', start, 7);
    const issue = (comparison: { referenceCycleId: string; currentCycleId: string }) =>
      request(app.getHttpServer())
        .post(base())
        .set('Cookie', cookie)
        .set('Origin', env.CORS_ORIGIN)
        .send({
          kind: 'SST',
          unitId,
          sectorId,
          sectionKeys: ['executive-summary', 'diagnostics', 'diagnostic-questions'],
          comparison,
        });
    const snapshot = reportSnapshotSchema.parse(
      (await issue({ referenceCycleId: reference.id, currentCycleId: current.id }).expect(201))
        .body,
    );
    expect(
      snapshot.sections.find(({ key }) => key === 'executive-comparison')?.rows,
    ).toContainEqual([
      'Adesão',
      'Indisponível',
      'Indisponível',
      'A política protege os pontos ou a diferença.',
    ]);
    expect(snapshot.sections.find(({ key }) => key === 'executive-collections')?.rows[0]?.[2]).toBe(
      'Adesão protegida na comparação',
    );
    expect(
      snapshot.sections.find(({ key }) => key === 'diagnostics')?.rows.map((row) => row[2]),
    ).toEqual(Array(2).fill('Indisponível / protegido'));
    expect(
      snapshot.sections
        .find(({ key }) => key === 'diagnostic-questions')
        ?.rows.map((row) => row[2]),
    ).toEqual(Array(2).fill('Indisponível / protegido'));
    await issue({ referenceCycleId: reference.id, currentCycleId: randomUUID() }).expect(404);
    const stableStart = new Date(current.closedAt!.getTime() + 1);
    while (Date.now() < stableStart.getTime())
      await new Promise((resolve) => setTimeout(resolve, 1));
    const stable = await cycle('Coleta sintética estável', stableStart, 6);
    const disclosed = reportSnapshotSchema.parse(
      (await issue({ referenceCycleId: reference.id, currentCycleId: stable.id }).expect(201)).body,
    );
    const comparison = disclosed.sections.find(({ key }) => key === 'executive-comparison');
    expect(comparison?.rows).toContainEqual(['Adesão', '30%', '30%', 'Estabilidade de 0 p.p.']);
    expect(comparison?.references).toEqual(
      expect.arrayContaining([
        { row: 0, kind: 'CYCLE', id: reference.id, unitId, sectorId },
        { row: 1, kind: 'CYCLE', id: stable.id, unitId, sectorId },
      ]),
    );
    const pdf = await request(app.getHttpServer())
      .get(`${base()}/${disclosed.id}/pdf`)
      .set('Cookie', cookie)
      .expect(200);
    expect(extractPdfPages(pdf.body).join(' ').replace(/\s+/g, ' ')).toContain(
      'Estabilidade de 0 p.p.',
    );
  }, 35_000);
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
