import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  actionDetailSchema,
  efficacyContextSchema,
  efficacyOpinionSchema,
  evaluationMethodVersionSchema,
  managementIndicatorsSchema,
  nr01PendenciesSchema,
  reportSnapshotSchema,
  riskDetailSchema,
  riskReassessmentSchema,
  technicalClosureContextSchema,
  technicalClosureSchema,
  technicalRiskEvaluationSchema,
  type RiskDetail,
} from '@renr/contracts';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';
import { localDatabaseUrl } from './local-database-url';

const describeDatabase = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

describeDatabase('ID55 NR-01 operational pendencies projection', () => {
  let app: INestApplication;
  let db: PrismaService;
  let env: ReturnType<typeof parseEnvironment>;
  let orgA: string;
  let orgB: string;
  let unit1: string;
  let unit2: string;
  let sector1: string;
  let sector2: string;
  let sectorB: string;
  let methodId: string;
  const createdOrgs: string[] = [];
  const createdUsers: string[] = [];
  const cookies = new Map<string, string>();
  const userIds = new Map<string, string>();

  const origin = () => env.CORS_ORIGIN;
  const get = (orgId: string, tail: string, actor = 'adminA') =>
    request(app.getHttpServer())
      .get(`/api/v1/organizations/${orgId}${tail}`)
      .set('Cookie', cookies.get(actor)!);
  const post = (orgId: string, tail: string, data: object, actor = 'adminA') =>
    request(app.getHttpServer())
      .post(`/api/v1/organizations/${orgId}${tail}`)
      .set('Cookie', cookies.get(actor)!)
      .set('Origin', origin())
      .send(data);
  const patch = (orgId: string, tail: string, data: object, actor = 'adminA') =>
    request(app.getHttpServer())
      .patch(`/api/v1/organizations/${orgId}${tail}`)
      .set('Cookie', cookies.get(actor)!)
      .set('Origin', origin())
      .send(data);
  const put = (orgId: string, tail: string, data: object, actor = 'techA') =>
    request(app.getHttpServer())
      .put(`/api/v1/organizations/${orgId}${tail}`)
      .set('Cookie', cookies.get(actor)!)
      .set('Origin', origin())
      .send(data);

  async function createSessionUser(
    key: string,
    name: string,
    orgId: string | null,
    role?: 'ADMIN' | 'READER',
    capabilities: ('TECHNICAL_DECISIONS' | 'EXECUTE_ASSIGNED_ACTIONS')[] = [],
    delegation?: { unitId: string; sectorId?: string | null }[],
  ) {
    const id = randomUUID();
    const token = randomBytes(32).toString('base64url');
    await db.client.user.create({
      data: {
        id,
        name,
        email: `${key}-${id}@id55.example`,
        passwordHash: 'synthetic-unused-hash',
      },
    });
    createdUsers.push(id);
    userIds.set(key, id);
    if (orgId && role) {
      await db.client.membership.create({
        data: {
          userId: id,
          organizationId: orgId,
          role,
          capabilities,
          scopeRestricted: Boolean(delegation?.length),
        },
      });
      if (delegation?.length) {
        await db.client.membershipScope.createMany({
          data: delegation.map((entry) => ({
            userId: id,
            organizationId: orgId,
            unitId: entry.unitId,
            sectorId: entry.sectorId ?? null,
          })),
        });
      }
    }
    await db.client.session.create({
      data: {
        userId: id,
        activeOrganizationId: orgId,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    cookies.set(key, `renr_session=${token}`);
    return id;
  }

  async function publishMethod(orgId: string) {
    const draft = evaluationMethodVersionSchema.parse(
      (
        await post(
          orgId,
          '/evaluation-methods',
          {
            name: `Synthetic ID55 method ${randomUUID()}`,
            description: 'Synthetic test method for NR-01 operational pendencies.',
          },
          'techA',
        ).expect(201)
      ).body,
    );
    const updated = evaluationMethodVersionSchema.parse(
      (
        await put(
          orgId,
          `/evaluation-method-versions/${draft.id}`,
          {
            expectedRevision: draft.revision,
            title: draft.title,
            description: draft.description,
            definition: {
              probability: [
                {
                  key: 'p1',
                  label: 'Probabilidade sintética',
                  description: 'Critério sintético',
                  position: 1,
                },
              ],
              severity: [
                {
                  key: 's1',
                  label: 'Severidade sintética',
                  description: 'Critério sintético',
                  position: 1,
                },
              ],
              levels: [{ key: 'l1', label: 'Nível sintético' }],
              priorities: [{ key: 'r1', label: 'Prioridade sintética', rank: 1 }],
              matrix: [
                { probabilityKey: 'p1', severityKey: 's1', levelKey: 'l1', priorityKey: 'r1' },
              ],
            },
          },
          'techA',
        ).expect(200)
      ).body,
    );
    return evaluationMethodVersionSchema.parse(
      (
        await post(
          orgId,
          `/evaluation-method-versions/${draft.id}/publish`,
          {
            expectedRevision: updated.revision,
            approvalReference: 'SYNTHETIC local ID55 test approval, not valid for real use.',
          },
          'techA',
        ).expect(201)
      ).body,
    ).id;
  }

  async function createRisk(orgId: string, sectorId: string, factor: string, actor = 'adminA') {
    return riskDetailSchema.parse(
      (
        await post(
          orgId,
          '/risks',
          {
            sectorId,
            factor,
            status: 'REGISTERED',
            description: 'Descrição sintética para validação do painel de pendências NR-01.',
            exposureDescription: 'Exposição coletiva sintética.',
            exposedGroupDescription: 'Equipe sintética do setor.',
            possibleHarms: 'Possíveis agravos psicossociais sintéticos.',
            existingControls: 'Controles preventivos sintéticos existentes.',
            sourceKind: 'TECHNICAL_RECORD',
            sourceNote: 'Registro sintético de teste sem certificação técnica.',
          },
          actor,
        ).expect(201)
      ).body,
    );
  }

  async function evaluateRisk(orgId: string, risk: RiskDetail) {
    return technicalRiskEvaluationSchema.parse(
      (
        await post(
          orgId,
          `/risk-workspaces/${risk.id}/technical-evaluations`,
          {
            expectedVersion: risk.version,
            methodVersionId: methodId,
            probabilityKey: 'p1',
            severityKey: 's1',
            rationale: 'Justificativa técnica sintética para o teste do ID 55.',
            context: 'Contexto coletivo sintético sem certificação real.',
            sources: [{ kind: 'RISK_RECORD', id: risk.id }],
          },
          'techA',
        ).expect(201)
      ).body,
    );
  }

  async function createAction(
    orgId: string,
    risk: RiskDetail,
    title: string,
    dueDate: string,
    actor = 'adminA',
  ) {
    const latest = riskDetailSchema.parse(
      (await get(orgId, `/risks/${risk.id}`, actor).expect(200)).body,
    );
    return actionDetailSchema.parse(
      (
        await post(
          orgId,
          `/risks/${risk.id}/actions`,
          {
            expectedRiskVersion: latest.version,
            title,
            description: 'Medida preventiva sintética para verificação das pendências NR-01.',
            responsibleName: 'Coordenação SST sintética',
            dueDate,
            expectedResult: 'Redução observável dos apontamentos coletivos.',
            verificationCriterion: 'Conferência documental e verificação coletiva do setor.',
          },
          actor,
        ).expect(201)
      ).body,
    );
  }

  async function attachSyntheticEvidence(
    orgId: string,
    actionId: string,
    actorId: string,
    actionVersion = 1,
  ) {
    const id = randomUUID();
    const content = Buffer.from(`synthetic-evidence-${id}`);
    const sha256 = createHash('sha256').update(content).digest('hex');
    await db.client.actionEvidence.create({
      data: {
        id,
        organizationId: orgId,
        actionId,
        fileName: 'comprovacao-sintetica.pdf',
        description: 'Comprovação documental sintética anexada à medida preventiva.',
        mimeType: 'application/pdf',
        size: content.length,
        sha256,
        objectKey: `synthetic/${orgId}/${actionId}/${id}.pdf`,
        actionVersion,
        createdById: actorId,
      },
    });
    return id;
  }

  beforeAll(async () => {
    env = parseEnvironment({
      ...process.env,
      NODE_ENV: 'test',
      S3_ACCESS_KEY: process.env.S3_ACCESS_KEY || 'synthetic',
      S3_SECRET_KEY: process.env.S3_SECRET_KEY || 'synthetic',
    });
    localDatabaseUrl(env.DATABASE_URL);
    const module = await Test.createTestingModule({
      imports: [AppModule.configure(env)],
    }).compile();
    db = module.get(PrismaService);
    app = module.createNestApplication();
    configureApplication(app, env);
    await app.init();

    const suffix = randomUUID().slice(0, 8);
    orgA = (
      await db.client.organization.create({
        data: { name: `Empresa NR01 A ${suffix}`, timezone: 'America/Sao_Paulo' },
      })
    ).id;
    orgB = (
      await db.client.organization.create({
        data: { name: `Empresa NR01 B ${suffix}`, timezone: 'America/Sao_Paulo' },
      })
    ).id;
    createdOrgs.push(orgA, orgB);

    const u1 = await db.client.unit.create({
      data: { organizationId: orgA, name: 'Unidade Norte', normalizedName: 'unidade norte' },
    });
    const u2 = await db.client.unit.create({
      data: { organizationId: orgA, name: 'Unidade Sul', normalizedName: 'unidade sul' },
    });
    const uB = await db.client.unit.create({
      data: { organizationId: orgB, name: 'Unidade Externa', normalizedName: 'unidade externa' },
    });
    unit1 = u1.id;
    unit2 = u2.id;

    const s1 = await db.client.sector.create({
      data: {
        organizationId: orgA,
        unitId: u1.id,
        name: 'Operações Norte',
        normalizedName: 'operacoes norte',
      },
    });
    const s2 = await db.client.sector.create({
      data: {
        organizationId: orgA,
        unitId: u2.id,
        name: 'Logística Sul',
        normalizedName: 'logistica sul',
      },
    });
    const sB = await db.client.sector.create({
      data: {
        organizationId: orgB,
        unitId: uB.id,
        name: 'Atendimento B',
        normalizedName: 'atendimento b',
      },
    });
    sector1 = s1.id;
    sector2 = s2.id;
    sectorB = sB.id;

    await db.client.assessmentGroup.createMany({
      data: [
        { organizationId: orgA, sectorId: s1.id, name: 'Grupo Norte' },
        { organizationId: orgA, sectorId: s2.id, name: 'Grupo Sul' },
        { organizationId: orgB, sectorId: sB.id, name: 'Grupo B' },
      ],
    });

    await createSessionUser('adminA', 'Admin A Sintético', orgA, 'ADMIN');
    await createSessionUser('techA', 'SST A Sintético', orgA, 'READER', ['TECHNICAL_DECISIONS']);
    await createSessionUser(
      'managerU1',
      'Gestor Unidade 1',
      orgA,
      'READER',
      [],
      [{ unitId: unit1 }],
    );
    await createSessionUser('readerRevocable', 'Leitor Revogável', orgA, 'READER');
    await createSessionUser('adminB', 'Admin B Sintético', orgB, 'ADMIN');
    const globalId = await createSessionUser('globalReader', 'Consulta Global ReTech+', null);
    await db.client.platformGrant.create({
      data: { userId: globalId, capability: 'READ_OVERVIEW', isActive: true },
    });

    methodId = await publishMethod(orgA);
  });

  afterAll(async () => {
    if (db) {
      await db.client.session.deleteMany({ where: { userId: { in: createdUsers } } });
      await db.client.platformGrant.updateMany({
        where: { userId: { in: createdUsers } },
        data: { isActive: false },
      });
      await db.client.organization.updateMany({
        where: { id: { in: createdOrgs } },
        data: { isActive: false },
      });
    }
    if (app) await app.close();
  });

  it('projeta pendências comprováveis (prazo vencido, falta de evidência, risco sem medida, aguardando validação, necessita revisão e concluído) e atualiza antes/depois da resolução', async () => {
    // 1. Risco sem avaliação e sem ação no setor 2 (Unidade Sul)
    const riskNoEvalNoAction = await createRisk(
      orgA,
      sector2,
      'Falta de clareza de metas na Logística Sul',
    );

    // 2. Risco avaliado no setor 1 com 3 ações em estados distintos
    const riskManaged = await createRisk(orgA, sector1, 'Sobrecarga de turnos nas Operações Norte');
    const baselineEval = await evaluateRisk(orgA, riskManaged);

    // 2a. Ação vencida sem evidência (dueDate no passado)
    const overdueAction = await createAction(
      orgA,
      riskManaged,
      'Rebalancear escala de plantões',
      '2025-01-15',
    );

    // 2b. Ação em andamento dentro do prazo
    let inProgressAction = await createAction(
      orgA,
      riskManaged,
      'Estabelecer reuniões semanais de carga',
      '2027-06-15',
    );
    inProgressAction = actionDetailSchema.parse(
      (
        await patch(orgA, `/actions/${inProgressAction.id}`, {
          expectedVersion: inProgressAction.version,
          status: 'IN_PROGRESS',
          changeReason: 'Execução iniciada com liderança local do setor.',
        }).expect(200)
      ).body,
    );

    // 2c. Ação implementada SEM evidência ativa anexada (deve acusar falta de evidência!)
    let implementedAction = await createAction(
      orgA,
      riskManaged,
      'Implantar rodízio de pausas',
      '2027-07-20',
    );
    implementedAction = actionDetailSchema.parse(
      (
        await patch(orgA, `/actions/${implementedAction.id}`, {
          expectedVersion: implementedAction.version,
          status: 'IN_PROGRESS',
          changeReason: 'Início do rodízio no turno.',
        }).expect(200)
      ).body,
    );
    implementedAction = actionDetailSchema.parse(
      (
        await patch(orgA, `/actions/${implementedAction.id}`, {
          expectedVersion: implementedAction.version,
          status: 'IMPLEMENTED',
          changeReason: 'Rodízio aplicado em todos os turnos.',
          implementationNote: 'Rodízio de pausas implementado em todos os postos operacionais.',
        }).expect(200)
      ).body,
    );

    // Risco em outra empresa (orgB) — jamais pode aparecer em orgA!
    await createRisk(orgB, sectorB, 'Risco isolado da empresa B', 'adminB');

    // --- ANTES DA RESOLUÇÃO ---
    const beforeRes = await get(orgA, '/management-indicators/nr01-pendencies?pageSize=20').expect(
      200,
    );
    expect(beforeRes.headers['cache-control']).toBe('private, no-store');
    const before = nr01PendenciesSchema.parse(beforeRes.body);
    const indicators = managementIndicatorsSchema.parse(
      (await get(orgA, '/management-indicators').expect(200)).body,
    );

    // Reconciliação exata com indicadores existentes e zero duplicação
    expect(before.summary.signals.overdueActions).toBe(indicators.actions.overdue);
    expect(before.summary.byOrigin).toEqual({ RISK: 2, ACTION: 3 });
    expect(before.summary.total).toBe(5);
    expect(new Set(before.items.map((item) => item.id)).size).toBe(before.items.length);
    expect(before.items.some((item) => item.title.includes('empresa B'))).toBe(false);

    // Conferir cada estado inicial comprovável
    const overdueItem = before.items.find((item) => item.actionId === overdueAction.id);
    expect(overdueItem).toMatchObject({
      status: 'PENDING',
      primaryRule: 'ACTION_OVERDUE',
      isOverdue: true,
      evidence: { activeCount: 0, archivedCount: 0 },
    });
    expect(overdueItem?.rules).toEqual(
      expect.arrayContaining(['ACTION_OVERDUE', 'ACTION_MISSING_EVIDENCE']),
    );
    expect(overdueItem?.missingInfo.length).toBeGreaterThan(0);

    const inProgressItem = before.items.find((item) => item.actionId === inProgressAction.id);
    expect(inProgressItem).toMatchObject({ status: 'IN_PROGRESS', isOverdue: false });

    const missingEvidenceItem = before.items.find((item) => item.actionId === implementedAction.id);
    expect(missingEvidenceItem).toMatchObject({
      status: 'PENDING',
      primaryRule: 'ACTION_MISSING_EVIDENCE',
      evidence: { activeCount: 0, archivedCount: 0 },
    });
    expect(missingEvidenceItem?.rules).toEqual(
      expect.arrayContaining(['ACTION_MISSING_EVIDENCE', 'ACTION_AWAITING_EFFICACY']),
    );
    expect(missingEvidenceItem?.missingInfo.length).toBeGreaterThan(0);

    const riskPendingItem = before.items.find(
      (item) => item.origin === 'RISK' && item.riskId === riskNoEvalNoAction.id,
    );
    expect(riskPendingItem).toMatchObject({
      status: 'AWAITING_VALIDATION',
      primaryRule: 'RISK_AWAITING_EVALUATION',
    });
    expect(riskPendingItem?.rules).toEqual(
      expect.arrayContaining(['RISK_AWAITING_EVALUATION', 'RISK_WITHOUT_ACTION']),
    );
    expect(riskPendingItem?.missingInfo.length).toBeGreaterThanOrEqual(2);

    // --- RESOLUÇÃO PASSO 1: Anexar evidência ativa na ação implementada ---
    const evidenceId = await attachSyntheticEvidence(
      orgA,
      implementedAction.id,
      userIds.get('adminA')!,
    );
    const afterEvidence = nr01PendenciesSchema.parse(
      (await get(orgA, '/management-indicators/nr01-pendencies?pageSize=20').expect(200)).body,
    );
    expect(
      afterEvidence.items.find((item) => item.actionId === implementedAction.id),
    ).toMatchObject({
      status: 'AWAITING_VALIDATION',
      primaryRule: 'ACTION_AWAITING_EFFICACY',
      evidence: { activeCount: 1, archivedCount: 0 },
      missingInfo: [],
    });

    // --- RESOLUÇÃO PASSO 2: Registrar parecer eficaz + reavaliação + encerramento técnico -> COMPLETED ---
    const effContext = efficacyContextSchema.parse(
      (await get(orgA, `/actions/${implementedAction.id}/efficacy`, 'techA').expect(200)).body,
    );
    const opinion = efficacyOpinionSchema.parse(
      (
        await post(
          orgA,
          `/actions/${implementedAction.id}/efficacy-opinions`,
          {
            expectedVersion: effContext.actionVersion,
            expectedLatestOpinionId: effContext.latest?.id ?? null,
            expectedContextFingerprint: effContext.contextFingerprint,
            verifiedOn: effContext.referenceDate,
            result: 'EFFECTIVE',
            observation: 'Observação técnica sintética comprovando a execução do rodízio.',
            rationale: 'Justificativa técnica sintética ligada à evidência ativa anexada.',
            evidenceIds: [evidenceId],
            textualEvidence: [],
          },
          'techA',
        ).expect(201)
      ).body,
    );

    const afterOpinion = nr01PendenciesSchema.parse(
      (await get(orgA, '/management-indicators/nr01-pendencies?pageSize=20').expect(200)).body,
    );
    expect(afterOpinion.items.find((item) => item.actionId === implementedAction.id)).toMatchObject(
      {
        status: 'AWAITING_VALIDATION',
        primaryRule: 'ACTION_AWAITING_CLOSURE',
      },
    );

    const latestRisk = riskDetailSchema.parse(
      (await get(orgA, `/risks/${riskManaged.id}`).expect(200)).body,
    );
    const updatedEff = efficacyContextSchema.parse(
      (await get(orgA, `/actions/${implementedAction.id}/efficacy`, 'techA').expect(200)).body,
    );
    const reassessment = riskReassessmentSchema.parse(
      (
        await post(
          orgA,
          `/risk-workspaces/${riskManaged.id}/reassessments`,
          {
            expectedPreviousEvaluationId: baselineEval.id,
            evaluation: {
              expectedVersion: latestRisk.version,
              methodVersionId: methodId,
              probabilityKey: 'p1',
              severityKey: 's1',
              rationale: 'Reavaliação técnica sintética considerando medida eficaz.',
              context: 'Contexto coletivo após implementação da medida preventiva.',
              sources: [{ kind: 'RISK_RECORD', id: riskManaged.id }],
            },
            measures: [
              {
                actionId: implementedAction.id,
                expectedVersion: updatedEff.actionVersion,
                opinionId: opinion.id,
                expectedContextFingerprint: updatedEff.contextFingerprint,
                consideration:
                  'Medida preventiva e parecer eficaz considerados na reavaliação sintética.',
              },
            ],
          },
          'techA',
        ).expect(201)
      ).body,
    );
    const closeCtx = technicalClosureContextSchema.parse(
      (await get(orgA, `/actions/${implementedAction.id}/closure-context`, 'techA').expect(200))
        .body,
    );
    technicalClosureSchema.parse(
      (
        await post(
          orgA,
          `/actions/${implementedAction.id}/technical-closures`,
          {
            expectedVersion: closeCtx.efficacy.actionVersion,
            expectedRiskVersion: closeCtx.riskVersion,
            expectedLatestEvaluationId: closeCtx.latestEvaluation!.id,
            expectedLatestClosureId: closeCtx.latest?.id ?? null,
            expectedContextFingerprint: closeCtx.efficacy.contextFingerprint,
            opinionId: opinion.id,
            reassessmentId: reassessment.id,
            rationale: 'Encerramento técnico sintético amparado em parecer eficaz e reavaliação.',
          },
          'techA',
        ).expect(201)
      ).body,
    );

    const afterClosure = nr01PendenciesSchema.parse(
      (await get(orgA, '/management-indicators/nr01-pendencies?pageSize=20').expect(200)).body,
    );
    expect(afterClosure.items.find((item) => item.actionId === implementedAction.id)).toMatchObject(
      {
        status: 'COMPLETED',
        primaryRule: null,
        rules: [],
      },
    );
    expect(afterClosure.summary.byStatus.COMPLETED).toBe(1);

    // --- RESOLUÇÃO PASSO 3: Arquivar a evidência selecionada -> reverte para NEEDS_REVIEW ---
    await db.client.actionEvidence.update({
      where: { id: evidenceId },
      data: {
        archivedAt: new Date(),
        archivedById: userIds.get('adminA')!,
        archiveReason: 'Evidência arquivada no teste sintético para validar revisão técnica.',
      },
    });
    const afterArchive = nr01PendenciesSchema.parse(
      (await get(orgA, '/management-indicators/nr01-pendencies?pageSize=20').expect(200)).body,
    );
    const needsReviewItem = afterArchive.items.find(
      (item) => item.actionId === implementedAction.id,
    );
    expect(needsReviewItem).toMatchObject({
      status: 'NEEDS_REVIEW',
      evidence: { activeCount: 0, archivedCount: 1 },
    });
    expect(needsReviewItem?.rules).toEqual(
      expect.arrayContaining(['ACTION_EFFICACY_REVIEW_REQUIRED']),
    );
    expect(afterArchive.summary.byStatus.NEEDS_REVIEW).toBeGreaterThanOrEqual(1);

    // --- Filtros de status, regra e origem mantêm summary consistente ---
    const filteredRule = nr01PendenciesSchema.parse(
      (
        await get(
          orgA,
          '/management-indicators/nr01-pendencies?rule=RISK_WITHOUT_ACTION&origin=RISK',
        ).expect(200)
      ).body,
    );
    expect(filteredRule.total).toBe(1);
    expect(filteredRule.items[0]?.riskId).toBe(riskNoEvalNoAction.id);
    expect(filteredRule.summary.total).toBe(afterArchive.summary.total);
  });

  it('impõe isolamento entre empresas, escopo delegado, bloqueio global sem vínculo e recusa imediata após revogação na mesma sessão', async () => {
    // Isolamento entre empresas (adminB tentando ler orgA)
    await get(orgA, '/management-indicators/nr01-pendencies', 'adminB').expect(404);

    // Usuário global READ_OVERVIEW sem vínculo na empresa não acessa detalhes privados da empresa
    await get(orgA, '/management-indicators/nr01-pendencies', 'globalReader').expect(404);

    // Setor incompatível com unidade retorna 400
    await get(
      orgA,
      `/management-indicators/nr01-pendencies?unitId=${unit1}&sectorId=${sector2}`,
    ).expect(400);

    // Gestor delegado da Unidade 1 vê somente itens da Unidade 1 e recebe 404 na Unidade 2
    const delegated = nr01PendenciesSchema.parse(
      (await get(orgA, '/management-indicators/nr01-pendencies', 'managerU1').expect(200)).body,
    );
    expect(delegated.items.length).toBeGreaterThan(0);
    expect(delegated.items.every((item) => item.unit.id === unit1)).toBe(true);
    await get(orgA, `/management-indicators/nr01-pendencies?unitId=${unit2}`, 'managerU1').expect(
      404,
    );

    // Leitor revogável consulta pendências e emite relatório SST antes da revogação
    const beforeRevoke = nr01PendenciesSchema.parse(
      (await get(orgA, '/management-indicators/nr01-pendencies', 'readerRevocable').expect(200))
        .body,
    );
    const sampleAction = beforeRevoke.items.find((item) => item.actionId !== null)!;
    expect(sampleAction).toBeDefined();

    const report = reportSnapshotSchema.parse(
      (
        await post(
          orgA,
          '/reports',
          {
            kind: 'SST',
            sectionKeys: ['executive-summary', 'inventory', 'actions'],
          },
          'readerRevocable',
        ).expect(201)
      ).body,
    );

    const evidenceId = await attachSyntheticEvidence(
      orgA,
      sampleAction.actionId!,
      userIds.get('adminA')!,
    );

    // Revogar o vínculo durante a sessão aberta
    await db.client.membership.update({
      where: {
        userId_organizationId: {
          userId: userIds.get('readerRevocable')!,
          organizationId: orgA,
        },
      },
      data: { isActive: false },
    });

    // Na mesma sessão: pendências, detalhe da ação, anexo/evidência e exportação PDF passam a ser recusados
    const deniedPendencies = await get(
      orgA,
      '/management-indicators/nr01-pendencies',
      'readerRevocable',
    );
    expect([401, 403, 404]).toContain(deniedPendencies.status);

    const deniedDetail = await get(
      orgA,
      `/action-workspaces/${sampleAction.actionId}`,
      'readerRevocable',
    );
    expect([401, 403, 404]).toContain(deniedDetail.status);

    const deniedEvidence = await get(
      orgA,
      `/actions/${sampleAction.actionId}/evidence/${evidenceId}/download`,
      'readerRevocable',
    );
    expect([401, 403, 404]).toContain(deniedEvidence.status);

    const deniedReportPdf = await get(orgA, `/reports/${report.id}/pdf`, 'readerRevocable');
    expect([401, 403, 404]).toContain(deniedReportPdf.status);
  });

  it('classifica risco em rascunho, contexto alterado, ação cancelada, parecer inconclusivo e mantém paginação estável sem duplicação', async () => {
    // 1. Risco em rascunho (DRAFT)
    const draftRisk = riskDetailSchema.parse(
      (
        await post(orgA, '/risks', {
          sectorId: sector2,
          factor: 'Risco em rascunho para conferência NR-01',
          status: 'DRAFT',
        }).expect(201)
      ).body,
    );

    // 2. Risco avaliado cujo contexto muda após avaliação (CONTEXT_CHANGED -> NEEDS_REVIEW)
    const changedRisk = await createRisk(orgA, sector2, 'Fator com contexto alterado');
    await evaluateRisk(orgA, changedRisk);
    const reloadedChanged = riskDetailSchema.parse(
      (await get(orgA, `/risks/${changedRisk.id}`).expect(200)).body,
    );
    await patch(orgA, `/risks/${changedRisk.id}`, {
      expectedVersion: reloadedChanged.version,
      description: 'Descrição revisada após mudança relevante no processo de trabalho.',
    }).expect(200);

    // 3. Risco avaliado cuja única ação foi cancelada (continua acusando RISK_WITHOUT_ACTION)
    const cancelledOnlyRisk = await createRisk(orgA, sector2, 'Risco com ação cancelada');
    await evaluateRisk(orgA, cancelledOnlyRisk);
    const actionToCancel = await createAction(
      orgA,
      cancelledOnlyRisk,
      'Ação cancelada posteriormente',
      '2027-08-10',
    );
    await patch(orgA, `/actions/${actionToCancel.id}`, {
      expectedVersion: actionToCancel.version,
      status: 'CANCELLED',
      changeReason: 'Medida substituída antes do início da execução.',
    }).expect(200);

    // 4. Ação implementada com parecer INCONCLUSIVE -> NEEDS_REVIEW + ACTION_EFFICACY_FOLLOW_UP
    const inconclusiveRisk = await createRisk(orgA, sector2, 'Risco com parecer inconclusivo');
    await evaluateRisk(orgA, inconclusiveRisk);
    let inconclusiveAction = await createAction(
      orgA,
      inconclusiveRisk,
      'Medida com avaliação inconclusiva',
      '2027-09-10',
    );
    inconclusiveAction = actionDetailSchema.parse(
      (
        await patch(orgA, `/actions/${inconclusiveAction.id}`, {
          expectedVersion: inconclusiveAction.version,
          status: 'IN_PROGRESS',
          changeReason: 'Execução iniciada no setor.',
        }).expect(200)
      ).body,
    );
    inconclusiveAction = actionDetailSchema.parse(
      (
        await patch(orgA, `/actions/${inconclusiveAction.id}`, {
          expectedVersion: inconclusiveAction.version,
          status: 'IMPLEMENTED',
          changeReason: 'Execução concluída no setor.',
          implementationNote: 'Execução da medida reportada para verificação técnica coletiva.',
        }).expect(200)
      ).body,
    );
    const effCtx = efficacyContextSchema.parse(
      (await get(orgA, `/actions/${inconclusiveAction.id}/efficacy`, 'techA').expect(200)).body,
    );
    await post(
      orgA,
      `/actions/${inconclusiveAction.id}/efficacy-opinions`,
      {
        expectedVersion: effCtx.actionVersion,
        expectedLatestOpinionId: effCtx.latest?.id ?? null,
        expectedContextFingerprint: effCtx.contextFingerprint,
        verifiedOn: effCtx.referenceDate,
        result: 'INCONCLUSIVE',
        observation: 'Observação coletiva ainda insuficiente para concluir sobre eficácia.',
        rationale: 'Justificativa técnica indicando necessidade de monitoramento complementar.',
        evidenceIds: [],
        textualEvidence: [
          {
            reference: 'Registro coletivo parcial ID55',
            description: 'Registro documental parcial coletado na visita técnica.',
            rationale: 'Sustenta a conclusão provisória de acompanhamento inconclusivo.',
          },
        ],
        nextSteps: 'Repetir verificação coletiva no próximo ciclo com registros adicionais.',
      },
      'techA',
    ).expect(201);

    // 5. Ação aberta vencida vinculada a risco posteriormente arquivado -> NEEDS_REVIEW + isOverdue + rank 0
    const archivedRisk = await createRisk(orgA, sector2, 'Risco arquivado com ação vencida');
    const overdueOnArchived = await createAction(
      orgA,
      archivedRisk,
      'Ação vencida em risco arquivado',
      '2024-05-01',
    );
    const archivedRiskLatest = riskDetailSchema.parse(
      (await get(orgA, `/risks/${archivedRisk.id}`).expect(200)).body,
    );
    await patch(orgA, `/risks/${archivedRisk.id}`, {
      expectedVersion: archivedRiskLatest.version,
      status: 'ARCHIVED',
    }).expect(200);

    // 6. Ação aberta com vencimento na data de referência do painel -> isOverdue: false
    const panelBefore = managementIndicatorsSchema.parse(
      (await get(orgA, `/management-indicators?sectorId=${sector2}`).expect(200)).body,
    );
    const dueOnReferenceDateAction = await createAction(
      orgA,
      inconclusiveRisk,
      'Ação com prazo na data de referência do painel',
      panelBefore.referenceDate,
    );

    const [sectorResultRaw, panelAfterRaw] = await Promise.all([
      get(orgA, `/management-indicators/nr01-pendencies?sectorId=${sector2}&pageSize=50`).expect(
        200,
      ),
      get(orgA, `/management-indicators?sectorId=${sector2}`).expect(200),
    ]);
    const sectorResult = nr01PendenciesSchema.parse(sectorResultRaw.body);
    const panelAfter = managementIndicatorsSchema.parse(panelAfterRaw.body);

    expect(sectorResult.referenceDate).toBe(panelBefore.referenceDate);
    const dueTodayItem = sectorResult.items.find(
      (item) => item.actionId === dueOnReferenceDateAction.id,
    );
    expect(dueTodayItem).toMatchObject({
      dueDate: panelBefore.referenceDate,
      isOverdue: false,
      status: 'PENDING',
      primaryRule: 'ACTION_PLANNED',
    });
    expect(dueTodayItem?.rules).not.toContain('ACTION_OVERDUE');
    expect(sectorResult.summary.signals.overdueActions).toBe(panelAfter.actions.overdue);

    expect(sectorResult.items.find((item) => item.originId === draftRisk.id)).toMatchObject({
      status: 'PENDING',
      primaryRule: 'RISK_DRAFT',
    });
    expect(sectorResult.items.find((item) => item.originId === draftRisk.id)?.rules).not.toContain(
      'RISK_AWAITING_EVALUATION',
    );
    expect(sectorResult.summary.signals.awaitingEvaluationOrValidation).toBe(
      sectorResult.summary.byStatus.AWAITING_VALIDATION,
    );
    const archivedActionItem = sectorResult.items.find(
      (item) => item.actionId === overdueOnArchived.id,
    );
    expect(archivedActionItem).toMatchObject({
      status: 'NEEDS_REVIEW',
      isOverdue: true,
      primaryRule: 'ACTION_ORIGIN_CHANGED',
    });
    expect(archivedActionItem?.rules).toEqual(
      expect.arrayContaining(['ACTION_OVERDUE', 'ACTION_ORIGIN_CHANGED', 'ORIGIN_INACTIVE']),
    );
    expect(sectorResult.items[0]?.actionId).toBe(overdueOnArchived.id);
    expect(sectorResult.items.find((item) => item.originId === changedRisk.id)).toMatchObject({
      status: 'NEEDS_REVIEW',
      primaryRule: 'RISK_EVALUATION_REVIEW_REQUIRED',
    });
    expect(sectorResult.items.find((item) => item.originId === cancelledOnlyRisk.id)).toMatchObject(
      {
        status: 'PENDING',
        primaryRule: 'RISK_WITHOUT_ACTION',
      },
    );
    expect(sectorResult.items.some((item) => item.actionId === actionToCancel.id)).toBe(false);
    expect(
      sectorResult.items.find((item) => item.actionId === inconclusiveAction.id),
    ).toMatchObject({
      status: 'NEEDS_REVIEW',
      primaryRule: 'ACTION_EFFICACY_FOLLOW_UP',
    });

    // Paginação estável sem duplicação entre página 1 e página 2
    const page1 = nr01PendenciesSchema.parse(
      (
        await get(
          orgA,
          `/management-indicators/nr01-pendencies?sectorId=${sector2}&page=1&pageSize=2`,
        ).expect(200)
      ).body,
    );
    const page2 = nr01PendenciesSchema.parse(
      (
        await get(
          orgA,
          `/management-indicators/nr01-pendencies?sectorId=${sector2}&page=2&pageSize=2`,
        ).expect(200)
      ).body,
    );
    expect(page1.summary.total).toBe(page2.summary.total);
    expect(page1.items.length).toBe(2);
    expect(page2.items.length).toBe(2);
    const combinedIds = [...page1.items, ...page2.items].map((item) => item.id);
    expect(new Set(combinedIds).size).toBe(4);
  });
});
