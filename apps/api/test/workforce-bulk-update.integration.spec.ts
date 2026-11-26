import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { employeeBulkUpdatePreviewSchema, reportSnapshotSchema } from '@renr/contracts';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { ENVIRONMENT, parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';
import { IdentityService } from '../src/modules/identity/identity.service';
import { renderReportPdf } from '../src/modules/reports/report-pdf';
import { WorkforceController } from '../src/modules/workforce/workforce.controller';
import { WorkforceService } from '../src/modules/workforce/workforce.service';
import { localDatabaseUrl } from './local-database-url';
import { fixtureWorkbook } from './workforce-workbook.fixture';

const describeDatabase = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
describeDatabase('Employee bulk updates on local PostgreSQL', () => {
  let environment: ReturnType<typeof parseEnvironment>;
  let app: INestApplication;
  let db: PrismaService;

  beforeAll(async () => {
    environment = parseEnvironment({
      ...process.env,
      NODE_ENV: 'test',
      STORAGE_ENABLED: 'false',
    });
    localDatabaseUrl(environment.DATABASE_URL);
    const module = await Test.createTestingModule({
      controllers: [WorkforceController],
      providers: [
        PrismaService,
        IdentityService,
        WorkforceService,
        { provide: ENVIRONMENT, useValue: environment },
      ],
    }).compile();
    db = module.get(PrismaService);
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });
  afterAll(async () => app?.close());

  async function operator(organizationId: string, role: 'ADMIN' | 'READER' = 'ADMIN') {
    const { id: userId } = await db.client.user.create({
      data: {
        name: 'Bulk fixture admin',
        email: `${randomUUID()}@example.test`,
        passwordHash: 'synthetic unused hash',
        memberships: { create: { organizationId, role } },
      },
    });
    const token = randomBytes(32).toString('base64url');
    await db.client.session.create({
      data: {
        userId,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        activeOrganizationId: organizationId,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    return { userId, cookie: `renr_session=${token}` };
  }
  async function company(name: string) {
    const row = await db.client.organization.create({
      data: { name, clientClassification: 'DEMONSTRATION' },
    });
    const unit = (unitName: string) =>
      db.client.unit.create({
        data: { organizationId: row.id, name: unitName, normalizedName: unitName.toLowerCase() },
      });
    const original = await unit('Matriz');
    const target = await unit('Filial');
    const sector = (unitId: string, sectorName: string) =>
      db.client.sector.create({
        data: {
          organizationId: row.id,
          unitId,
          name: sectorName,
          normalizedName: sectorName.toLowerCase(),
        },
      });
    const originalSector = await sector(original.id, 'Operação');
    const targetSector = await sector(target.id, 'Atendimento');
    const employee = (identifier: string, employeeName: string) =>
      db.client.employee.create({
        data: {
          organizationId: row.id,
          name: employeeName,
          internalIdentifier: identifier,
          normalizedIdentifier: identifier,
          unitId: original.id,
          sectorId: originalSector.id,
        },
      });
    return { ...row, employee, original, originalSector, target, targetSector };
  }
  const endpoint = (organizationId: string) =>
    `/api/v1/organizations/${organizationId}/employees/bulk-update`;
  const upload = (org: string, cookie: string, file: Buffer, version?: string) => {
    const call = request(app.getHttpServer())
      .post(`${endpoint(org)}/${version ? 'confirm' : 'preview'}`)
      .set({ Cookie: cookie, Origin: environment.CORS_ORIGIN });
    if (version) call.field('version', version);
    return call.attach('file', file, 'colaboradores.xlsx');
  };
  const status = (org: string, cookie: string, version: string) =>
    request(app.getHttpServer())
      .get(`${endpoint(org)}/${version}`)
      .set('Cookie', cookie);
  const history = (org: string, cookie: string, id: string) =>
    request(app.getHttpServer())
      .get(`/api/v1/organizations/${org}/employees/${id}/bulk-update-history`)
      .set('Cookie', cookie);

  async function frozenCollection(organizationId: string, sectorId: string, actorId: string) {
    const group = await db.client.assessmentGroup.create({ data: { organizationId, sectorId } });
    const instrument = await db.client.$transaction(async (tx) => {
      const version = await tx.instrumentVersion.create({
        data: { organizationId, title: 'Questionário fictício', version: 1 },
      });
      const question = await tx.diagnosticQuestion.create({
        data: {
          instrumentVersionId: version.id,
          label: 'Pergunta fictícia',
          type: 'SINGLE_CHOICE',
          position: 1,
        },
      });
      await tx.questionOption.createMany({
        data: ['Sim', 'Não'].map((label, index) => ({
          instrumentVersionId: version.id,
          questionId: question.id,
          label,
          position: index + 1,
        })),
      });
      return version;
    });
    const policy = await db.client.consolidationPolicyVersion.create({
      data: {
        organizationId,
        usageMode: 'DEMONSTRATION',
        version: 1,
        status: 'PUBLISHED',
        minimumResponses: 5,
        publishedAt: new Date(),
        publishedById: actorId,
      },
    });
    const cycle = await db.client.assessmentCycle.create({
      data: {
        organizationId,
        assessmentGroupId: group.id,
        instrumentVersionId: instrument.id,
        policyVersionId: policy.id,
        name: 'Coleta do setor original',
        startsAt: new Date(Date.now() - 3_600_000),
        endsAt: new Date(Date.now() + 3_600_000),
      },
    });
    return db.client.assessmentCycle.update({
      where: { id: cycle.id },
      data: { status: 'OPEN', eligibleCount: 3 },
    });
  }

  it('previews changes and blanks, keeps frozen records, and applies a repeated confirmation once', async () => {
    const first = await company('Bulk fixture first company');
    const second = await company('Bulk fixture second company');
    const admin = await operator(first.id);
    const outsider = await operator(second.id);
    const otherAdmin = await operator(first.id);
    const reader = await operator(first.id, 'READER');
    const alice = await first.employee('00077', 'Nome inicial');
    const unchanged = await first.employee('keep', 'X');
    const omitted = await first.employee('absent', 'Fora da planilha');
    const other = await second.employee('00077', 'Outra empresa');
    const previousCollection = await frozenCollection(
      first.id,
      first.originalSector.id,
      admin.userId,
    );
    const frozenReport = reportSnapshotSchema.parse({
      id: randomUUID(),
      kind: 'PEOPLE',
      organizationId: first.id,
      financial: false,
      nominal: false,
      createdAt: '2026-11-24T12:00:00.000Z',
      referenceDate: '2026-11-24',
      timeZone: 'America/Sao_Paulo',
      title: 'Relatório fictício de pessoal',
      context: 'Empresa de teste / Operação',
      filters: [{ label: 'Setor', value: 'Operação' }],
      sections: [
        {
          key: 'people',
          title: 'Pessoas',
          columns: ['Setor', 'Colaboradores'],
          rows: [['Operação', '3']],
          notes: [],
        },
      ],
      limitations: [],
    });
    const snapshot = await db.client.reportSnapshot.create({
      data: {
        organizationId: first.id,
        createdById: admin.userId,
        id: frozenReport.id,
        kind: frozenReport.kind,
        snapshot: frozenReport,
      },
    });
    const previousPdf = await renderReportPdf(frozenReport);
    const file = fixtureWorkbook([
      ['00077', 'Nome atualizado', 'Filial', 'Atendimento'],
      ['KEEP', '', '', ''],
    ]);
    const preview = await upload(first.id, admin.cookie, file)
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    expect(employeeBulkUpdatePreviewSchema.parse(preview.body)).toMatchObject({
      total: 2,
      ready: 1,
      unchanged: 1,
      invalid: 0,
      rows: [
        {
          row: 2,
          status: 'READY',
          before: { name: 'Nome inicial', unitName: 'Matriz', sectorName: 'Operação' },
          after: { name: 'Nome atualizado', unitName: 'Filial', sectorName: 'Atendimento' },
          preserved: [],
        },
        {
          row: 3,
          status: 'UNCHANGED',
          before: { name: 'X' },
          after: { name: 'X' },
          preserved: ['name', 'unit', 'sector'],
        },
      ],
    });
    const version = preview.body.version as string;
    await status(first.id, admin.cookie, version).expect(200, { status: 'PENDING', result: null });
    await status(first.id, otherAdmin.cookie, version).expect(404);
    await status(first.id, outsider.cookie, version).expect(404);
    await status(second.id, outsider.cookie, version).expect(404);
    expect(await db.client.employee.findUnique({ where: { id: alice.id } })).toMatchObject({
      name: 'Nome inicial',
      version: 1,
    });
    const repeats = await Promise.all([
      upload(first.id, admin.cookie, file, version),
      upload(first.id, admin.cookie, file, version),
    ]);
    for (const result of repeats) {
      expect(result.status).toBe(201);
      expect(result.body).toEqual({ updated: 1, unchanged: 1 });
    }
    await status(first.id, admin.cookie, version).expect(200, {
      status: 'CONFIRMED',
      result: { updated: 1, unchanged: 1 },
    });
    expect(await db.client.employee.findUnique({ where: { id: alice.id } })).toMatchObject({
      name: 'Nome atualizado',
      version: 2,
      internalIdentifier: '00077',
      unitId: first.target.id,
      sectorId: first.targetSector.id,
    });
    for (const record of [unchanged, omitted, other])
      expect(await db.client.employee.findUnique({ where: { id: record.id } })).toMatchObject({
        name: record.name,
        version: 1,
        unitId: record.unitId,
        sectorId: record.sectorId,
      });
    const retainedReport = await db.client.reportSnapshot.findUniqueOrThrow({
      where: { id: snapshot.id },
    });
    expect(retainedReport).toEqual(snapshot);
    expect(await renderReportPdf(reportSnapshotSchema.parse(retainedReport.snapshot))).toEqual(
      previousPdf,
    );
    expect(
      await db.client.employee.count({
        where: { organizationId: first.id, sectorId: first.originalSector.id },
      }),
    ).toBe(2);
    expect(
      await db.client.assessmentCycle.findUnique({ where: { id: previousCollection.id } }),
    ).toEqual(previousCollection);
    await history(first.id, reader.cookie, alice.id).expect(403);
    await history(second.id, outsider.cookie, alice.id).expect(404);
    const trail = await history(first.id, admin.cookie, alice.id)
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    expect(trail.body).toMatchObject({
      total: 1,
      items: [
        {
          version: 2,
          batchId: version,
          before: { name: 'Nome inicial', unitName: 'Matriz', sectorName: 'Operação' },
          after: { name: 'Nome atualizado', unitName: 'Filial', sectorName: 'Atendimento' },
        },
      ],
    });
    await expect(
      db.client.employeeRegistrationRevision.updateMany({
        where: { organizationId: first.id, employeeId: alice.id },
        data: { version: 3 },
      }),
    ).rejects.toThrow();
    const audit = await db.client.auditEvent.findMany({
      where: { organizationId: first.id, action: 'EMPLOYEE_BULK_UPDATE' },
    });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toMatch(/Nome atualizado|00077|colaboradores.xlsx/i);
  });

  it('rejects duplicate, unknown and out-of-company rows without saving a valid row', async () => {
    const enterprise = await company('Bulk fixture invalid');
    const admin = await operator(enterprise.id);
    const employee = await enterprise.employee('good', 'Original');
    const reader = await operator(enterprise.id, 'READER');
    const foreign = await company('Bulk fixture foreign references');
    await foreign.employee('unknown', 'Matrícula de fora');
    await db.client.unit.update({
      where: { id: foreign.target.id },
      data: { name: 'Unidade de fora', normalizedName: 'unidade de fora' },
    });
    await db.client.sector.update({
      where: { id: foreign.targetSector.id },
      data: { name: 'Setor de fora', normalizedName: 'setor de fora' },
    });
    const file = fixtureWorkbook([
      ['good', 'Proposta legítima', '', ''],
      ['dup', '', '', ''],
      ['ＤＵＰ', '', '', ''],
      ['unknown', '', '', ''],
      ['destination', '', 'Unidade de fora', 'Setor de fora'],
    ]);
    await enterprise.employee('dup', 'Duplicado');
    await enterprise.employee('destination', 'Destino');
    await upload(enterprise.id, reader.cookie, file).expect(403);
    const preview = await upload(enterprise.id, admin.cookie, file).expect(200);
    expect(preview.body).toMatchObject({ ready: 1, unchanged: 0, invalid: 4 });
    expect(preview.body.rows.slice(1)).toEqual(
      Array.from({ length: 4 }, () =>
        expect.objectContaining({ status: 'INVALID', before: null, after: null }),
      ),
    );
    await upload(enterprise.id, admin.cookie, file, preview.body.version).expect(409);
    expect(await db.client.employee.findUnique({ where: { id: employee.id } })).toEqual(employee);
  });

  it('rejects file substitution, a concurrent edit, expired previews and revocation', async () => {
    const enterprise = await company('Bulk fixture competing batch');
    const admin = await operator(enterprise.id);
    const first = await enterprise.employee('first', 'Original um');
    const second = await enterprise.employee('second', 'Original dois');
    const file = fixtureWorkbook([
      ['first', 'Novo um', '', ''],
      ['second', 'Novo dois', '', ''],
    ]);
    const prove = () => upload(enterprise.id, admin.cookie, file);
    let preview = await prove().expect(200);
    const alternative = fixtureWorkbook([
      ['second', 'Novo dois', '', ''],
      ['first', 'Novo um', '', ''],
    ]);
    await upload(enterprise.id, admin.cookie, alternative, preview.body.version).expect(409);
    await request(app.getHttpServer())
      .patch(`/api/v1/organizations/${enterprise.id}/employees/${first.id}`)
      .set({ Cookie: admin.cookie, Origin: environment.CORS_ORIGIN })
      .send({ name: 'Editado manualmente', version: first.version })
      .expect(200);
    await upload(enterprise.id, admin.cookie, file, preview.body.version).expect(409);
    expect(await db.client.employee.findUnique({ where: { id: second.id } })).toEqual(second);

    preview = await prove().expect(200);
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 16 * 60 * 1_000);
    try {
      await status(enterprise.id, admin.cookie, preview.body.version).expect(200, {
        status: 'EXPIRED',
        result: null,
      });
      await upload(enterprise.id, admin.cookie, file, preview.body.version).expect(409);
    } finally {
      clock.mockRestore();
    }
    preview = await prove().expect(200);
    await db.client.membership.update({
      where: { userId_organizationId: { userId: admin.userId, organizationId: enterprise.id } },
      data: { scopeRestricted: true, version: { increment: 1 } },
    });
    await status(enterprise.id, admin.cookie, preview.body.version).expect(403);
    await upload(enterprise.id, admin.cookie, file, preview.body.version).expect(403);
    expect(await db.client.employee.findUnique({ where: { id: second.id } })).toEqual(second);
  });
});
