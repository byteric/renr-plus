import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import request from 'supertest';
import {
  reportSnapshotSchema,
  riskContributionListSchema,
  riskContributionSchema,
  riskDetailSchema,
  type Capability,
} from '@renr/contracts';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';
import { splitCapabilities } from '../src/modules/access/capabilities';
import { EvidenceStorage } from '../src/modules/evidence/evidence.storage';
import { localDatabaseUrl } from './local-database-url';

const describeDatabase = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

class InMemoryStorage {
  readonly objects = new Map<string, { body: Buffer; mimeType: string; sha256: string }>();
  assertEnabled() {}
  async put(key: string, body: Buffer, mimeType: string, sha256: string) {
    this.objects.set(key, { body: Buffer.from(body), mimeType, sha256 });
  }
  async get(key: string): Promise<Readable> {
    const found = this.objects.get(key);
    if (!found) throw new Error('Object not found');
    return Readable.from(found.body);
  }
  async compensate(key: string) {
    this.objects.delete(key);
  }
  onApplicationShutdown() {}
}

describeDatabase('ID56 SST x Psicologia Organizacional collaboration (PostgreSQL)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let env: ReturnType<typeof parseEnvironment>;
  const storage = new InMemoryStorage();

  let orgA: string;
  let orgB: string;
  let unit1: string;
  let unit2: string;
  let sector1: string;
  let sector2: string;
  let riskId: string;
  let risk2Id: string;

  const createdOrgs: string[] = [];
  const createdUsers: string[] = [];
  const cookies = new Map<string, string>();
  const userIds = new Map<string, string>();

  const origin = () => env.CORS_ORIGIN;
  const get = (orgId: string, tail: string, actor: string) =>
    request(app.getHttpServer())
      .get(`/api/v1/organizations/${orgId}${tail}`)
      .set('Cookie', cookies.get(actor)!);
  const post = (orgId: string, tail: string, body: object, actor: string) =>
    request(app.getHttpServer())
      .post(`/api/v1/organizations/${orgId}${tail}`)
      .set('Cookie', cookies.get(actor)!)
      .set('Origin', origin())
      .send(body);
  const patch = (orgId: string, tail: string, body: object, actor: string) =>
    request(app.getHttpServer())
      .patch(`/api/v1/organizations/${orgId}${tail}`)
      .set('Cookie', cookies.get(actor)!)
      .set('Origin', origin())
      .send(body);

  async function createActor(
    key: string,
    name: string,
    orgId: string | null,
    role: 'ADMIN' | 'READER' = 'READER',
    capabilities: Capability[] = [],
    delegation?: { unitId: string; sectorId?: string | null }[],
    platformCapabilities: 'READ_OVERVIEW'[] = [],
  ) {
    const id = randomUUID();
    const token = randomBytes(32).toString('base64url');
    await db.client.user.create({
      data: { id, name, email: `${key}-${id}@example.test`, passwordHash: 'x' },
    });
    createdUsers.push(id);
    userIds.set(key, id);

    if (orgId) {
      const split = splitCapabilities(capabilities);
      await db.client.membership.create({
        data: {
          userId: id,
          organizationId: orgId,
          role,
          isActive: true,
          capabilities: split.capabilities,
          hrCapabilities: split.hrCapabilities,
          scopeRestricted: Boolean(delegation),
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
    for (const cap of platformCapabilities) {
      await db.client.platformGrant.create({
        data: { userId: id, capability: cap, isActive: true, version: 1 },
      });
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

  beforeAll(async () => {
    env = parseEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: localDatabaseUrl(
        process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/renr_test',
      ).toString(),
      RISK_COLLABORATION_WRITES_ENABLED: 'true',
      STORAGE_ENABLED: 'false',
    });
    const module = await Test.createTestingModule({ imports: [AppModule.configure(env)] })
      .overrideProvider(EvidenceStorage)
      .useValue(storage)
      .compile();
    app = module.createNestApplication();
    configureApplication(app, env);
    await app.init();
    db = app.get(PrismaService);

    orgA = (await db.client.organization.create({ data: { name: 'Empresa Fictícia ID56 A' } })).id;
    orgB = (await db.client.organization.create({ data: { name: 'Empresa Fictícia ID56 B' } })).id;
    createdOrgs.push(orgA, orgB);

    unit1 = (
      await db.client.unit.create({
        data: { organizationId: orgA, name: 'Unidade Norte', normalizedName: 'unidade norte' },
      })
    ).id;
    unit2 = (
      await db.client.unit.create({
        data: { organizationId: orgA, name: 'Unidade Sul', normalizedName: 'unidade sul' },
      })
    ).id;
    sector1 = (
      await db.client.sector.create({
        data: {
          organizationId: orgA,
          unitId: unit1,
          name: 'Atendimento',
          normalizedName: 'atendimento',
        },
      })
    ).id;
    sector2 = (
      await db.client.sector.create({
        data: {
          organizationId: orgA,
          unitId: unit2,
          name: 'Logística',
          normalizedName: 'logistica',
        },
      })
    ).id;

    await createActor('adminA', 'Admin A', orgA, 'ADMIN', []);
    await createActor('camilaSst', 'Camila SST', orgA, 'READER', ['TECHNICAL_DECISIONS']);
    await createActor('beatrizPsych', 'Beatriz Psicologia', orgA, 'READER', [
      'PSYCHOLOGY_COLLABORATION',
    ]);
    await createActor('rafaelRh', 'Rafael RH', orgA, 'READER', [
      'HR_PROFILE_READ',
      'HR_ANALYTICS_READ',
    ]);
    await createActor(
      'joaoGestor',
      'João Gestor',
      orgA,
      'READER',
      ['EXECUTE_ASSIGNED_ACTIONS'],
      [{ unitId: unit1, sectorId: sector1 }],
    );
    await createActor(
      'helenaAuditor',
      'Helena Auditora',
      orgA,
      'READER',
      [],
      [{ unitId: unit2, sectorId: sector2 }],
    );
    await createActor('platformOp', 'Operador ReTech+', null, 'READER', [], undefined, [
      'READ_OVERVIEW',
    ]);
    await createActor('foreignPsych', 'Psicóloga Empresa B', orgB, 'READER', [
      'PSYCHOLOGY_COLLABORATION',
    ]);

    const createRisk = async (sectorId: string, factor: string) => {
      const r = riskDetailSchema.parse(
        (
          await post(
            orgA,
            '/risks',
            {
              sectorId,
              factor,
              description: 'Descrição coletiva do fator psicossocial no setor.',
              exposureDescription: 'Exposição contínua ao ritmo de demandas no turno.',
              exposedGroupDescription: 'Equipe coletiva do setor.',
              possibleHarms: 'Esgotamento e fadiga cognitiva.',
              existingControls: 'Reuniões mensais de alinhamento.',
              sourceKind: 'TECHNICAL_RECORD',
              sourceNote: 'Registro técnico fictício para ensaio ID56.',
              status: 'REGISTERED',
            },
            'adminA',
          ).expect(201)
        ).body,
      );
      return r.id;
    };

    riskId = await createRisk(sector1, 'Sobrecarga cognitiva em atendimento');
    risk2Id = await createRisk(sector2, 'Pressão de prazo na logística');
  });

  afterAll(async () => {
    if (db) {
      await db.client.session.deleteMany({ where: { userId: { in: createdUsers } } });
    }
    if (app) await app.close();
  });

  it('executa jornada completa SST x Psicologia: reservado isolado, compartilhamento auditado, anexos, PDF, recorte, revogação, triggers e preservação de SST', async () => {
    // 1. Beatriz (Psicologia) cria contribuição RESERVADA (v1) e anexa documento RESERVADO (v2)
    const psychCreated = riskContributionSchema.parse(
      (
        await post(
          orgA,
          `/risks/${riskId}/technical-contributions`,
          {
            specialty: 'PSYCHOLOGY_ORGANIZATIONAL',
            kind: 'PSYCHOSOCIAL_ANALYSIS',
            visibility: 'RESTRICTED',
            title: 'Análise preliminar psicossocial — Atendimento',
            workFactors:
              'RESERVADO-V1-PSICO: sobrecarga de filas simultâneas e ausência de previsibilidade de pausas.',
            preventiveRecommendations:
              'Reorganizar escalas coletivas de pausas e nivelamento de demanda.',
            nextStep: 'Consolidar síntese coletiva para compartilhar com SST.',
            expectedRiskVersion: 1,
          },
          'beatrizPsych',
        ).expect(201)
      ).body,
    );
    expect(psychCreated.specialty).toBe('PSYCHOLOGY_ORGANIZATIONAL');
    expect(psychCreated.visibility).toBe('RESTRICTED');
    expect(psychCreated.version).toBe(1);

    const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');
    const psychWithRestrictedAtt = riskContributionSchema.parse(
      (
        await request(app.getHttpServer())
          .post(
            `/api/v1/organizations/${orgA}/risks/${riskId}/technical-contributions/${psychCreated.id}/attachments`,
          )
          .set('Cookie', cookies.get('beatrizPsych')!)
          .set('Origin', origin())
          .field('expectedVersion', '1')
          .field('description', 'Nota técnica reservada de apoio psicossocial')
          .attach('file', pdfBytes, {
            filename: 'apoio-reservado-psico.pdf',
            contentType: 'application/pdf',
          })
          .expect(201)
      ).body,
    );
    expect(psychWithRestrictedAtt.version).toBe(2);
    expect(psychWithRestrictedAtt.attachments).toHaveLength(1);
    const restrictedAttId = psychWithRestrictedAtt.attachments[0]!.id;

    // 2. Camila (SST) cria contribuição RESERVADA própria (v1) no MESMO risco
    const sstCreated = riskContributionSchema.parse(
      (
        await post(
          orgA,
          `/risks/${riskId}/technical-contributions`,
          {
            specialty: 'SST',
            kind: 'PREVENTIVE_RECOMMENDATION',
            visibility: 'RESTRICTED',
            title: 'Nota reservada SST — controle de pausas',
            workFactors: 'RESERVADO-SST-SECRETO: observação preliminar de engenharia de SST.',
            preventiveRecommendations: 'Implementar rodízio operacional no posto.',
            expectedRiskVersion: 1,
          },
          'camilaSst',
        ).expect(201)
      ).body,
    );
    expect(sstCreated.specialty).toBe('SST');
    expect(sstCreated.visibility).toBe('RESTRICTED');

    // 3. RED/SEGURANÇA: isolamento entre especialidades, perfis sem capacidade, outra empresa e plataforma
    const camilaListBefore = riskContributionListSchema.parse(
      (await get(orgA, `/risks/${riskId}/technical-contributions`, 'camilaSst').expect(200)).body,
    );
    expect(camilaListBefore.items.map((i) => i.id)).toEqual([sstCreated.id]);
    await get(
      orgA,
      `/risks/${riskId}/technical-contributions/${psychCreated.id}`,
      'camilaSst',
    ).expect(404);
    await get(
      orgA,
      `/risks/${riskId}/technical-contributions/${psychCreated.id}/attachments/${restrictedAttId}/download`,
      'camilaSst',
    ).expect(404);

    // Beatriz não vê a contribuição reservada de Camila (SST)
    const beatrizListBefore = riskContributionListSchema.parse(
      (await get(orgA, `/risks/${riskId}/technical-contributions`, 'beatrizPsych').expect(200))
        .body,
    );
    expect(beatrizListBefore.items.map((i) => i.id)).toEqual([psychCreated.id]);
    await get(
      orgA,
      `/risks/${riskId}/technical-contributions/${sstCreated.id}`,
      'beatrizPsych',
    ).expect(404);

    // Admin puro, RH, Gestor e Auditor não veem NENHUM registro reservado e não podem criar/editar
    for (const actor of ['adminA', 'rafaelRh', 'joaoGestor']) {
      const list = riskContributionListSchema.parse(
        (await get(orgA, `/risks/${riskId}/technical-contributions`, actor).expect(200)).body,
      );
      expect(list.items).toHaveLength(0);
      await post(
        orgA,
        `/risks/${riskId}/technical-contributions`,
        {
          specialty: 'PSYCHOLOGY_ORGANIZATIONAL',
          kind: 'PSYCHOSOCIAL_ANALYSIS',
          visibility: 'RESTRICTED',
          title: 'Tentativa não autorizada',
          workFactors: 'Texto de tentativa sem capacidade técnica.',
          preventiveRecommendations: 'Recomendação não autorizada.',
          expectedRiskVersion: 1,
        },
        actor,
      ).expect(403);
    }

    // Helena (auditora delegada apenas ao setor 2 / risco 2) não acessa risco 1 (404)
    await get(orgA, `/risks/${riskId}/technical-contributions`, 'helenaAuditor').expect(404);
    await get(orgA, `/risks/${risk2Id}/technical-contributions`, 'helenaAuditor').expect(200);

    // Operador de plataforma sem vínculo e conta de outra empresa são bloqueados (404)
    await get(orgA, `/risks/${riskId}/technical-contributions`, 'platformOp').expect(404);
    await get(orgA, `/risks/${riskId}/technical-contributions`, 'foreignPsych').expect(404);

    // Beatriz (Psicologia) não pode criar contribuição com specialty SST (403) nem criar ação preventiva (403)
    await post(
      orgA,
      `/risks/${riskId}/technical-contributions`,
      {
        specialty: 'SST',
        kind: 'TECHNICAL_FOLLOW_UP',
        visibility: 'RESTRICTED',
        title: 'Tentativa indevida de SST',
        workFactors: 'Psicologia não deve poder gravar como SST.',
        preventiveRecommendations: 'Deve falhar com 403.',
        expectedRiskVersion: 1,
      },
      'beatrizPsych',
    ).expect(403);
    await post(
      orgA,
      `/risks/${riskId}/action-workspaces`,
      {
        title: 'Ação indevida por Psicologia',
        description: 'Psicologia não recebe criação de ações nem decisões de SST.',
        responsibleName: 'Responsável',
        dueDate: '2026-12-01',
        expectedResult: 'Resultado esperado de teste',
        verificationCriterion: 'Critério de teste',
        expectedRiskVersion: 1,
      },
      'beatrizPsych',
    ).expect(403);

    // 4. Edição versionada + conflito de versão (409) + compartilhamento explícito (v3 -> v4)
    // Conflito com versão antiga
    await patch(
      orgA,
      `/risks/${riskId}/technical-contributions/${psychCreated.id}`,
      {
        expectedVersion: 1,
        title: 'Versão obsoleta',
        changeReason: 'Tentativa com versão desatualizada.',
      },
      'beatrizPsych',
    ).expect(409);

    const psychEdited = riskContributionSchema.parse(
      (
        await patch(
          orgA,
          `/risks/${riskId}/technical-contributions/${psychCreated.id}`,
          {
            expectedVersion: 2,
            workFactors:
              'Síntese coletiva compartilhável: demandas cumulativas no atendimento sem janela de pausa.',
            changeReason: 'Consolidar síntese coletiva antes de compartilhar com SST.',
          },
          'beatrizPsych',
        ).expect(200)
      ).body,
    );
    expect(psychEdited.version).toBe(3);

    // Compartilha contribuição SEM promover o anexo reservado anterior (shareAttachments: false)
    const psychShared = riskContributionSchema.parse(
      (
        await post(
          orgA,
          `/risks/${riskId}/technical-contributions/${psychCreated.id}/share`,
          {
            expectedVersion: 3,
            reason: 'Liberar síntese coletiva para alinhamento preventivo com SST.',
            shareAttachments: false,
          },
          'beatrizPsych',
        ).expect(201)
      ).body,
    );
    expect(psychShared.version).toBe(4);
    expect(psychShared.visibility).toBe('SHARED');

    // Anexa segundo documento após compartilhamento (nasce SHARED)
    const psychWithSharedAtt = riskContributionSchema.parse(
      (
        await request(app.getHttpServer())
          .post(
            `/api/v1/organizations/${orgA}/risks/${riskId}/technical-contributions/${psychCreated.id}/attachments`,
          )
          .set('Cookie', cookies.get('beatrizPsych')!)
          .set('Origin', origin())
          .field('expectedVersion', '4')
          .field('description', 'Guia coletivo compartilhado de pausas')
          .attach('file', pdfBytes, {
            filename: 'guia — compartilhado.pdf',
            contentType: 'application/pdf',
          })
          .expect(201)
      ).body,
    );
    expect(psychWithSharedAtt.version).toBe(5);
    const sharedAttId = psychWithSharedAtt.attachments.find(
      (a) => a.fileName === 'guia — compartilhado.pdf',
    )!.id;

    // 5. Camila (SST) agora vê a contribuição SHARED da Psicologia, MAS NÃO vê revisões nem anexos RESTRICTED anteriores!
    const camilaReadShared = riskContributionSchema.parse(
      (
        await get(
          orgA,
          `/risks/${riskId}/technical-contributions/${psychCreated.id}`,
          'camilaSst',
        ).expect(200)
      ).body,
    );
    expect(camilaReadShared.author.name).toBe('Beatriz Psicologia');
    expect(camilaReadShared.specialty).toBe('PSYCHOLOGY_ORGANIZATIONAL');
    expect(camilaReadShared.revisions.every((r) => r.visibility === 'SHARED')).toBe(true);
    expect(JSON.stringify(camilaReadShared)).not.toContain('RESERVADO-V1-PSICO');
    expect(camilaReadShared.attachments.map((a) => a.id)).toEqual([sharedAttId]);

    // Download do anexo compartilhado funciona para Camila (SST) com headers privados; anexo reservado continua 404!
    const dlShared = await get(
      orgA,
      `/risks/${riskId}/technical-contributions/${psychCreated.id}/attachments/${sharedAttId}/download`,
      'camilaSst',
    ).expect(200);
    expect(dlShared.headers['cache-control']).toBe('private, no-store');
    expect(dlShared.headers['x-content-type-options']).toBe('nosniff');
    expect(dlShared.headers['content-disposition']).toBe(
      `attachment; filename="guia _ compartilhado.pdf"; filename*=UTF-8''${encodeURIComponent('guia — compartilhado.pdf')}`,
    );

    await get(
      orgA,
      `/risks/${riskId}/technical-contributions/${psychCreated.id}/attachments/${restrictedAttId}/download`,
      'camilaSst',
    ).expect(404);

    // 6. Relatório PDF SST inclui contribuição SHARED + referência ao anexo compartilhado e NUNCA vaza conteúdo RESTRICTED
    const report = reportSnapshotSchema.parse(
      (await post(orgA, '/reports', { kind: 'SST' }, 'camilaSst').expect(201)).body,
    );
    const reportJson = JSON.stringify(report);
    expect(reportJson).toContain('Análise preliminar psicossocial — Atendimento');
    expect(reportJson).toContain('guia — compartilhado.pdf');
    expect(reportJson).not.toContain('RESERVADO-V1-PSICO');
    expect(reportJson).not.toContain('RESERVADO-SST-SECRETO');
    expect(reportJson).not.toContain('apoio-reservado-psico.pdf');

    const pdfRes = await get(orgA, `/reports/${report.id}/pdf`, 'camilaSst').expect(200);
    expect(pdfRes.headers['content-type']).toContain('application/pdf');
    expect(pdfRes.headers['cache-control']).toBe('private, no-store');

    // 7. Triggers SQL de imutabilidade: proibir DELETE e reversão SHARED -> RESTRICTED no banco
    await expect(
      db.client
        .$executeRaw`UPDATE risk_technical_contributions SET visibility = 'RESTRICTED', shared_at = NULL, shared_by_id = NULL, version = version + 1 WHERE id = ${psychCreated.id}::uuid`,
    ).rejects.toThrow(/shared contribution cannot revert to restricted/i);
    await expect(
      db.client
        .$executeRaw`DELETE FROM risk_technical_contribution_revisions WHERE contribution_id = ${psychCreated.id}::uuid`,
    ).rejects.toThrow(/risk_technical_contribution_revisions are immutable/i);

    // 8. Revogação imediata da capability PSYCHOLOGY_COLLABORATION durante a sessão aberta de Beatriz
    await db.client.membership.update({
      where: {
        userId_organizationId: { userId: userIds.get('beatrizPsych')!, organizationId: orgA },
      },
      data: { capabilities: [] },
    });
    // Beatriz perde imediatamente escrita, anexo reservado e revisões reservadas (mesmo sendo a autora original!)
    await patch(
      orgA,
      `/risks/${riskId}/technical-contributions/${psychCreated.id}`,
      {
        expectedVersion: 5,
        title: 'Tentativa após revogação',
        changeReason: 'Deve ser recusado após revogação imediata.',
      },
      'beatrizPsych',
    ).expect(403);
    await get(
      orgA,
      `/risks/${riskId}/technical-contributions/${psychCreated.id}/attachments/${restrictedAttId}/download`,
      'beatrizPsych',
    ).expect(404);

    // Revogação total do vínculo bloqueia leitura, anexo compartilhado e PDF na sessão aberta!
    await db.client.membership.update({
      where: {
        userId_organizationId: { userId: userIds.get('beatrizPsych')!, organizationId: orgA },
      },
      data: { isActive: false },
    });
    await get(orgA, `/risks/${riskId}/technical-contributions`, 'beatrizPsych').expect(404);
    await get(
      orgA,
      `/risks/${riskId}/technical-contributions/${psychCreated.id}/attachments/${sharedAttId}/download`,
      'beatrizPsych',
    ).expect(404);
    await get(orgA, `/reports/${report.id}/pdf`, 'beatrizPsych').expect(404);
  });
});
