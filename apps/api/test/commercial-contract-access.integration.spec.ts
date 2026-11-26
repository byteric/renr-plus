import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';
import type { PlatformCapability } from '../src/generated/prisma/client';
import { referenceDate } from '../src/modules/actions/actions.repository';
import { EvidenceStorage } from '../src/modules/evidence/evidence.storage';
import { hashPassword } from '../src/modules/identity/password';
import { localDatabaseUrl } from './local-database-url';

const describeDatabase = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
const commercialRoot = '/api/v1/platform/commercial';
const accessRoot = `${commercialRoot}/access`;

function todaySaoPaulo(): string {
  return referenceDate('America/Sao_Paulo', new Date());
}

function competenceOf(offsetMonths: number): string {
  const ref = todaySaoPaulo();
  const year = Number(ref.slice(0, 4));
  const month = Number(ref.slice(5, 7)) - 1;
  const target = new Date(Date.UTC(year, month + offsetMonths, 1));
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}`;
}

function cookieFromSetCookie(headers: string[] | string | undefined): string {
  const list = Array.isArray(headers) ? headers : headers ? [headers] : [];
  const raw = list.find((item) => item.startsWith('renr_session='));
  if (!raw) throw new Error('Expected renr_session cookie in Set-Cookie header');
  return raw.split(';')[0]!;
}

describeDatabase(
  'Commercial contract activation, suspension and reactivation (ID 48) on PostgreSQL',
  () => {
    let app: INestApplication;
    let db: PrismaService;
    let origin: string;
    const objects = new Map<string, Buffer>();

    beforeAll(async () => {
      const environment = parseEnvironment({ ...process.env, NODE_ENV: 'test' });
      localDatabaseUrl(environment.DATABASE_URL);
      origin = environment.CORS_ORIGIN;
      const fakeStorage = {
        assertEnabled: () => undefined,
        get: async (key: string) => {
          const content = objects.get(key) ?? Buffer.from('evidencia-ficticia-id48');
          return Readable.from([content]);
        },
        put: async (key: string, body: Buffer) => {
          objects.set(key, body);
        },
        delete: async (key: string) => {
          objects.delete(key);
        },
      };
      const module = await Test.createTestingModule({
        imports: [AppModule.configure(environment)],
      })
        .overrideProvider(EvidenceStorage)
        .useValue(fakeStorage)
        .compile();
      db = module.get(PrismaService);
      app = module.createNestApplication();
      configureApplication(app, environment);
      await app.init();
    });

    afterAll(async () => app?.close());

    async function createUserWithPassword(name: string, password: string) {
      const email = `${randomUUID()}@example.test`;
      const passwordHash = await hashPassword(password);
      const user = await db.client.user.create({
        data: { name, email, passwordHash },
      });
      return { user, email, password };
    }

    async function createPlatformAccount(
      capabilities: PlatformCapability[],
      name = 'Operador ID48',
    ) {
      const user = await db.client.user.create({
        data: {
          name,
          email: `${randomUUID()}@example.test`,
          passwordHash: 'test',
        },
      });
      for (const capability of capabilities) {
        await db.client.platformGrant.create({ data: { userId: user.id, capability } });
      }
      const token = randomBytes(32).toString('base64url');
      await db.client.session.create({
        data: {
          userId: user.id,
          activeOrganizationId: null,
          expiresAt: new Date(Date.now() + 600_000),
          tokenHash: createHash('sha256').update(token).digest('hex'),
        },
      });
      return { userId: user.id, cookie: `renr_session=${token}` };
    }

    async function setupContractedCompany(
      manageCommercialCookie: string,
      label: string,
      actorId: string,
    ) {
      const http = request(app.getHttpServer());
      const auth = { Cookie: manageCommercialCookie, Origin: origin };
      const org = await db.client.organization.create({
        data: {
          name: `${label} ${randomUUID().slice(0, 8)}`,
          clientClassification: 'DEMONSTRATION',
          isActive: true,
        },
      });
      const plan = await http
        .post(`${commercialRoot}/plans`)
        .set(auth)
        .send({
          name: `Plano ${label} ${randomUUID().slice(0, 8)}`,
          kind: 'PLAN',
          version: {
            effectiveOn: `${competenceOf(-3)}-01`,
            priceCents: 1990,
            pricingUnit: 'EMPLOYEE_MONTH',
            priceMode: 'FIXED',
            conditions: 'Condições fictícias para validação do ID 48.',
            limits: 'Escopo demonstrativo.',
            includedFeatures: ['Gestão de riscos NR-01'],
            plannedFeatures: [],
          },
          reason: 'Cadastro de plano fictício para ID 48.',
        })
        .expect(201);

      const contract = await http
        .post(`${commercialRoot}/clients/${org.id}/contract`)
        .set(auth)
        .send({
          planVersionId: plan.body.versions[0].id,
          startsOn: `${competenceOf(-1)}-01`,
          endsOn: `${competenceOf(6)}-28`,
          terms: 'Contrato fictício para teste de ativação, suspensão e reativação.',
          reason: 'Contrato fictício inicial para ID 48.',
        })
        .expect(201);

      const unitName = `Unidade ${label}`;
      const sectorName = `Setor ${label}`;
      const unit = await db.client.unit.create({
        data: { organizationId: org.id, name: unitName, normalizedName: unitName.toLowerCase() },
      });
      const sector = await db.client.sector.create({
        data: {
          organizationId: org.id,
          unitId: unit.id,
          name: sectorName,
          normalizedName: sectorName.toLowerCase(),
        },
      });
      const group = await db.client.assessmentGroup.create({
        data: { organizationId: org.id, sectorId: sector.id, name: `Grupo ${label}` },
      });
      const risk = await db.client.risk.create({
        data: {
          organizationId: org.id,
          assessmentGroupId: group.id,
          factor: `Risco preservado ${label}`,
          description: 'Descrição preservada durante suspensão contratual.',
          exposureDescription: 'Exposição organizacional registrada no inventário.',
          exposedGroupDescription: 'Equipe operacional fictícia',
          possibleHarms: 'Sobrecarga operacional',
          existingControls: 'Rotina de acompanhamento semanal',
          sourceKind: 'TECHNICAL_RECORD',
          sourceNote: 'Registro técnico fictício para validação do ID 48.',
          status: 'REGISTERED',
          createdById: actorId,
          updatedById: actorId,
        },
      });
      const action = await db.client.action.create({
        data: {
          organizationId: org.id,
          riskId: risk.id,
          sourceRiskVersion: risk.version,
          contextSnapshot: {
            factor: risk.factor,
            description: 'Descrição preservada durante suspensão contratual.',
            exposureDescription: 'Exposição organizacional registrada no inventário.',
            exposedGroupDescription: 'Equipe operacional fictícia',
            possibleHarms: 'Sobrecarga operacional',
            existingControls: 'Rotina de acompanhamento semanal',
            sourceKind: 'TECHNICAL_RECORD',
            sourceNote: 'Registro técnico fictício para validação do ID 48.',
            diagnosticCycleId: null,
            sectorId: sector.id,
            assessmentGroupId: group.id,
            unit: { id: unit.id, name: unit.name, isActive: true },
            sector: { id: sector.id, name: sector.name, isActive: true },
            status: 'REGISTERED',
          },
          title: `Ação preservada ${label}`,
          description: 'Ação corretiva com evidência protegida.',
          responsibleName: 'Responsável Fictício',
          dueDate: new Date(`${competenceOf(1)}-15T00:00:00.000Z`),
          expectedResult: 'Mitigação comprovada do fator.',
          verificationCriterion: 'Evidência documental anexada.',
          status: 'PLANNED',
          createdById: actorId,
          updatedById: actorId,
        },
      });
      const objectKey = `id48/${org.id}/${randomUUID()}.pdf`;
      const evidencePayload = Buffer.from(`%PDF-1.4\nEvidencia-${label}`);
      objects.set(objectKey, evidencePayload);
      const evidence = await db.client.actionEvidence.create({
        data: {
          organizationId: org.id,
          actionId: action.id,
          description: `Comprovante protegido de ${label}.`,
          fileName: `evidencia-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`,
          mimeType: 'application/pdf',
          size: evidencePayload.byteLength,
          sha256: createHash('sha256').update(evidencePayload).digest('hex'),
          objectKey,
          actionVersion: action.version,
          createdById: actorId,
        },
      });

      return {
        org,
        contract: contract.body as { id: string },
        unit,
        sector,
        risk,
        action,
        evidence,
        evidencePayload,
      };
    }

    it('restringe consultas e transições de acesso contratual às permissões dedicadas e origem válida', async () => {
      const http = request(app.getHttpServer());
      const commercialManager = await createPlatformAccount(['MANAGE_COMMERCIAL']);
      const commercialReader = await createPlatformAccount(['READ_COMMERCIAL']);
      const billingManager = await createPlatformAccount(['MANAGE_BILLING']);
      const overviewReader = await createPlatformAccount(['READ_OVERVIEW']);
      const accessReader = await createPlatformAccount(['READ_CONTRACT_ACCESS']);
      const accessManager = await createPlatformAccount(
        ['MANAGE_CONTRACT_ACCESS'],
        'Gestora Acesso Contratual',
      );

      const company = await setupContractedCompany(
        commercialManager.cookie,
        'Escopo RBAC',
        commercialManager.userId,
      );

      // Perfis sem permissão específica de acesso contratual recebem 403.
      for (const account of [commercialManager, commercialReader, billingManager, overviewReader]) {
        await http.get(`${accessRoot}/clients`).set('Cookie', account.cookie).expect(403);
        await http
          .get(`${accessRoot}/clients/${company.org.id}`)
          .set('Cookie', account.cookie)
          .expect(403);
        await http
          .post(`${accessRoot}/clients/${company.org.id}/transitions`)
          .set('Cookie', account.cookie)
          .set('Origin', origin)
          .send({
            expectedVersion: 0,
            kind: 'ACTIVATION',
            effectiveOn: todaySaoPaulo(),
            reason: 'Tentativa sem permissão.',
            nextStep: 'Não deve ser aplicada.',
            confirmed: true,
          })
          .expect(403);
      }

      // Leitor de acesso contratual consulta, mas não pode operar transições.
      await http.get(`${accessRoot}/clients`).set('Cookie', accessReader.cookie).expect(200);
      await http
        .get(`${accessRoot}/clients/${company.org.id}`)
        .set('Cookie', accessReader.cookie)
        .expect(200);
      await http
        .post(`${accessRoot}/clients/${company.org.id}/transitions`)
        .set('Cookie', accessReader.cookie)
        .set('Origin', origin)
        .send({
          expectedVersion: 0,
          kind: 'ACTIVATION',
          effectiveOn: todaySaoPaulo(),
          reason: 'Leitor não pode alterar acesso.',
          nextStep: 'Solicite ao gestor autorizado.',
          confirmed: true,
        })
        .expect(403);

      // Gestor sem Origin válido é barrado.
      await http
        .post(`${accessRoot}/clients/${company.org.id}/transitions`)
        .set('Cookie', accessManager.cookie)
        .send({
          expectedVersion: 0,
          kind: 'ACTIVATION',
          effectiveOn: todaySaoPaulo(),
          reason: 'Sem cabeçalho Origin.',
          nextStep: 'Reenviar pela aplicação.',
          confirmed: true,
        })
        .expect(403);

      // Gestor autorizado registra ativação manual com auditoria.
      const activated = await http
        .post(`${accessRoot}/clients/${company.org.id}/transitions`)
        .set('Cookie', accessManager.cookie)
        .set('Origin', origin)
        .send({
          expectedVersion: 0,
          kind: 'ACTIVATION',
          effectiveOn: todaySaoPaulo(),
          reason: 'Ativação contratual confirmada pela operação.',
          nextStep: 'Empresa liberada para uso conforme contrato vigente.',
          confirmed: true,
        })
        .expect(201);

      expect(activated.body.access.status).toBe('ACTIVE');
      expect(activated.body.access.version).toBe(1);
      expect(activated.body.transitions).toHaveLength(1);
      expect(activated.body.transitions[0]).toMatchObject({
        ordinal: 1,
        kind: 'ACTIVATION',
        fromStatus: 'UNRECORDED',
        toStatus: 'ACTIVE',
        rule: 'MANUAL_CONTRACT_ACTIVATION',
        origin: 'MANUAL_OPERATION',
        actor: { id: accessManager.userId, name: 'Gestora Acesso Contratual' },
      });

      // Revogação imediata da concessão bloqueia novas operações.
      await db.client.platformGrant.update({
        where: {
          userId_capability: { userId: accessManager.userId, capability: 'MANAGE_CONTRACT_ACCESS' },
        },
        data: { isActive: false, version: { increment: 1 } },
      });
      await http
        .post(`${accessRoot}/clients/${company.org.id}/transitions`)
        .set('Cookie', accessManager.cookie)
        .set('Origin', origin)
        .send({
          expectedVersion: 1,
          kind: 'SUSPENSION',
          effectiveOn: todaySaoPaulo(),
          reason: 'Tentativa após revogação.',
          nextStep: 'Não deve executar.',
          confirmed: true,
        })
        .expect(403);
    });

    it('bloqueia empresa suspensa em sessão aberta, novo login e downloads preservando a segunda empresa, dados e revogações', async () => {
      const http = request(app.getHttpServer());
      const commercialManager = await createPlatformAccount(['MANAGE_COMMERCIAL']);
      const accessManager = await createPlatformAccount(
        ['MANAGE_CONTRACT_ACCESS'],
        'Operadora Contratos ID48',
      );

      const beta = await setupContractedCompany(
        commercialManager.cookie,
        'Empresa Beta Suspensa',
        commercialManager.userId,
      );
      const alpha = await setupContractedCompany(
        commercialManager.cookie,
        'Empresa Alpha Ativa',
        commercialManager.userId,
      );

      // Conta vinculada às duas empresas (Beta primeiro para provar que novo login pula a suspensa e escolhe Alpha).
      const multiUser = await createUserWithPassword('Gestor Multi-Empresa', 'SenhaForte!2026');
      await db.client.membership.create({
        data: { userId: multiUser.user.id, organizationId: beta.org.id, role: 'ADMIN' },
      });
      await db.client.membership.create({
        data: { userId: multiUser.user.id, organizationId: alpha.org.id, role: 'ADMIN' },
      });

      // Perfis adicionais em Beta: leitor irrestrito, delegado restrito e usuário previamente revogado.
      const readerUser = await createUserWithPassword('Leitor Beta', 'SenhaLeitor!2026');
      await db.client.membership.create({
        data: { userId: readerUser.user.id, organizationId: beta.org.id, role: 'READER' },
      });

      const delegatedUser = await createUserWithPassword('Delegado Beta', 'SenhaDeleg!2026');
      await db.client.membership.create({
        data: {
          userId: delegatedUser.user.id,
          organizationId: beta.org.id,
          role: 'READER',
          scopeRestricted: true,
          scopes: { create: [{ unitId: beta.unit.id, sectorId: beta.sector.id }] },
        },
      });

      const revokedUser = await createUserWithPassword('Revogado Beta', 'SenhaRevog!2026');
      await db.client.membership.create({
        data: {
          userId: revokedUser.user.id,
          organizationId: beta.org.id,
          role: 'ADMIN',
          isActive: false,
        },
      });

      // Abre sessão prévia do multiUser já operando em Beta antes da suspensão.
      const initialLogin = await http
        .post('/api/v1/auth/sessions')
        .set('Origin', origin)
        .send({ email: multiUser.email, password: multiUser.password })
        .expect(201);
      const openSessionCookie = cookieFromSetCookie(initialLogin.headers['set-cookie']);

      await http
        .put('/api/v1/auth/session/organization')
        .set('Cookie', openSessionCookie)
        .set('Origin', origin)
        .send({ organizationId: beta.org.id })
        .expect(200);

      // Confirma acesso operacional, criação de relatório e downloads em Beta antes da suspensão.
      await http
        .get(`/api/v1/organizations/${beta.org.id}/overview`)
        .set('Cookie', openSessionCookie)
        .expect(200);
      const createdBetaReport = await http
        .post(`/api/v1/organizations/${beta.org.id}/reports`)
        .set('Cookie', openSessionCookie)
        .set('Origin', origin)
        .send({ kind: 'SST' })
        .expect(201);
      const betaReportId = createdBetaReport.body.id as string;
      const preDownload = await http
        .get(
          `/api/v1/organizations/${beta.org.id}/actions/${beta.action.id}/evidence/${beta.evidence.id}/download`,
        )
        .set('Cookie', openSessionCookie)
        .expect(200);
      expect(Buffer.from(preDownload.body).toString('utf8')).toContain('Evidencia-Empresa Beta');

      // Ativa Alpha explicitamente e suspende Beta manualmente.
      await http
        .post(`${accessRoot}/clients/${alpha.org.id}/transitions`)
        .set('Cookie', accessManager.cookie)
        .set('Origin', origin)
        .send({
          expectedVersion: 0,
          kind: 'ACTIVATION',
          effectiveOn: todaySaoPaulo(),
          reason: 'Ativação do contrato da Empresa Alpha.',
          nextStep: 'Operação regular liberada para Alpha.',
          confirmed: true,
        })
        .expect(201);

      const suspensionReason = 'Suspensão contratual manual acordada com a diretoria fictícia.';
      const suspensionNextStep = 'Regularize o aditivo contratual junto ao time comercial ReTech+.';

      const suspended = await http
        .post(`${accessRoot}/clients/${beta.org.id}/transitions`)
        .set('Cookie', accessManager.cookie)
        .set('Origin', origin)
        .send({
          expectedVersion: 0,
          kind: 'SUSPENSION',
          effectiveOn: todaySaoPaulo(),
          reason: suspensionReason,
          nextStep: suspensionNextStep,
          confirmed: true,
        })
        .expect(201);

      expect(suspended.body.access.status).toBe('SUSPENDED');
      expect(suspended.body.access.version).toBe(1);

      // Separação de modelos: situação cadastral da empresa e vínculos individuais continuam intactos.
      const betaOrgRow = await db.client.organization.findUniqueOrThrow({
        where: { id: beta.org.id },
      });
      expect(betaOrgRow.isActive).toBe(true);
      expect(betaOrgRow.clientClassification).toBe('DEMONSTRATION');
      const membershipsInBeta = await db.client.membership.findMany({
        where: { organizationId: beta.org.id },
      });
      expect(membershipsInBeta.find((m) => m.userId === multiUser.user.id)?.isActive).toBe(true);
      expect(membershipsInBeta.find((m) => m.userId === revokedUser.user.id)?.isActive).toBe(false);

      // 1. SESSÃO JÁ ABERTA: bloqueio imediato no servidor em rotas protegidas e downloads de Beta.
      const blockedOverview = await http
        .get(`/api/v1/organizations/${beta.org.id}/overview`)
        .set('Cookie', openSessionCookie)
        .expect(403);
      expect(blockedOverview.body.code).toBe('CONTRACT_ACCESS_SUSPENDED');
      expect(JSON.stringify(blockedOverview.body)).not.toContain(suspensionReason);

      const blockedRisks = await http
        .get(`/api/v1/organizations/${beta.org.id}/risks`)
        .set('Cookie', openSessionCookie)
        .expect(403);
      expect(blockedRisks.body.code).toBe('CONTRACT_ACCESS_SUSPENDED');

      const blockedEvidence = await http
        .get(
          `/api/v1/organizations/${beta.org.id}/actions/${beta.action.id}/evidence/${beta.evidence.id}/download`,
        )
        .set('Cookie', openSessionCookie)
        .expect(403);
      expect(blockedEvidence.body.code).toBe('CONTRACT_ACCESS_SUSPENDED');

      const blockedReportPdf = await http
        .get(`/api/v1/organizations/${beta.org.id}/reports/${betaReportId}/pdf`)
        .set('Cookie', openSessionCookie)
        .expect(403);
      expect(blockedReportPdf.body.code).toBe('CONTRACT_ACCESS_SUSPENDED');

      const blockedSwitch = await http
        .put('/api/v1/auth/session/organization')
        .set('Cookie', openSessionCookie)
        .set('Origin', origin)
        .send({ organizationId: beta.org.id })
        .expect(403);
      expect(blockedSwitch.body.code).toBe('CONTRACT_ACCESS_SUSPENDED');

      // Na mesma sessão aberta, o GET /auth/session já removeu Beta da operação e expôs motivo/próximo passo ao ADMIN irrestrito.
      const openSessionState = await http
        .get('/api/v1/auth/session')
        .set('Cookie', openSessionCookie)
        .expect(200);
      expect(openSessionState.body.activeOrganizationId).toBeNull();
      expect(
        openSessionState.body.memberships.map((m: { organizationId: string }) => m.organizationId),
      ).toEqual([alpha.org.id]);
      expect(openSessionState.body.suspendedOrganizations).toEqual([
        {
          organizationId: beta.org.id,
          organizationName: beta.org.name,
          role: 'ADMIN',
          reason: suspensionReason,
          nextStep: suspensionNextStep,
        },
      ]);

      // E a segunda empresa (Alpha) continua 100% acessível na mesma sessão aberta!
      await http
        .put('/api/v1/auth/session/organization')
        .set('Cookie', openSessionCookie)
        .set('Origin', origin)
        .send({ organizationId: alpha.org.id })
        .expect(200);
      await http
        .get(`/api/v1/organizations/${alpha.org.id}/overview`)
        .set('Cookie', openSessionCookie)
        .expect(200);
      const alphaEvidence = await http
        .get(
          `/api/v1/organizations/${alpha.org.id}/actions/${alpha.action.id}/evidence/${alpha.evidence.id}/download`,
        )
        .set('Cookie', openSessionCookie)
        .expect(200);
      expect(Buffer.from(alphaEvidence.body).toString('utf8')).toContain('Evidencia-Empresa Alpha');

      // 2. NOVO LOGIN: conta multi-empresa entra direto em Alpha, não consegue selecionar Beta nem baixar de Beta.
      const freshLogin = await http
        .post('/api/v1/auth/sessions')
        .set('Origin', origin)
        .send({ email: multiUser.email, password: multiUser.password })
        .expect(201);
      const freshCookie = cookieFromSetCookie(freshLogin.headers['set-cookie']);
      expect(freshLogin.body.activeOrganizationId).toBe(alpha.org.id);
      expect(
        freshLogin.body.memberships.map((m: { organizationId: string }) => m.organizationId),
      ).toEqual([alpha.org.id]);
      expect(freshLogin.body.suspendedOrganizations).toHaveLength(1);
      expect(freshLogin.body.suspendedOrganizations[0].reason).toBe(suspensionReason);

      await http
        .put('/api/v1/auth/session/organization')
        .set('Cookie', freshCookie)
        .set('Origin', origin)
        .send({ organizationId: beta.org.id })
        .expect(403);
      await http
        .get(`/api/v1/organizations/${alpha.org.id}/overview`)
        .set('Cookie', freshCookie)
        .expect(200);

      // 3. MENOR PRIVILÉGIO: READER e delegado restrito NÃO recebem motivo nem próximo passo; usuário revogado não vê nem a empresa.
      const readerLogin = await http
        .post('/api/v1/auth/sessions')
        .set('Origin', origin)
        .send({ email: readerUser.email, password: readerUser.password })
        .expect(201);
      expect(readerLogin.body.activeOrganizationId).toBeNull();
      expect(readerLogin.body.memberships).toEqual([]);
      expect(readerLogin.body.suspendedOrganizations).toEqual([
        {
          organizationId: beta.org.id,
          organizationName: beta.org.name,
          role: 'READER',
          reason: null,
          nextStep: null,
        },
      ]);

      const delegatedLogin = await http
        .post('/api/v1/auth/sessions')
        .set('Origin', origin)
        .send({ email: delegatedUser.email, password: delegatedUser.password })
        .expect(201);
      expect(delegatedLogin.body.suspendedOrganizations[0].reason).toBeNull();
      expect(delegatedLogin.body.suspendedOrganizations[0].nextStep).toBeNull();

      const revokedLogin = await http
        .post('/api/v1/auth/sessions')
        .set('Origin', origin)
        .send({ email: revokedUser.email, password: revokedUser.password })
        .expect(201);
      const revokedCookie = cookieFromSetCookie(revokedLogin.headers['set-cookie']);
      expect(revokedLogin.body.memberships).toEqual([]);
      expect(revokedLogin.body.suspendedOrganizations).toBeUndefined();
      // Usuário revogado recebe 404 (sem oráculo de suspensão).
      await http
        .get(`/api/v1/organizations/${beta.org.id}/overview`)
        .set('Cookie', revokedCookie)
        .expect(404);

      // 4. REATIVAÇÃO: dados, histórico e anexos continuam disponíveis; vínculo revogado permanece revogado.
      const reactivated = await http
        .post(`${accessRoot}/clients/${beta.org.id}/transitions`)
        .set('Cookie', accessManager.cookie)
        .set('Origin', origin)
        .send({
          expectedVersion: 1,
          kind: 'REACTIVATION',
          effectiveOn: todaySaoPaulo(),
          reason: 'Reativação contratual manual após regularização.',
          nextStep: 'Acesso operacional restabelecido para vínculos ativos.',
          confirmed: true,
        })
        .expect(201);

      expect(reactivated.body.access.status).toBe('ACTIVE');
      expect(reactivated.body.access.version).toBe(2);
      expect(reactivated.body.transitions).toHaveLength(2);
      expect(reactivated.body.transitions[1]).toMatchObject({
        ordinal: 2,
        kind: 'REACTIVATION',
        fromStatus: 'SUSPENDED',
        toStatus: 'ACTIVE',
        rule: 'MANUAL_CONTRACT_REACTIVATION',
      });

      // Multi-empresa retoma acesso a Beta com todos os dados, riscos e anexos intactos.
      const backToBeta = await http
        .put('/api/v1/auth/session/organization')
        .set('Cookie', freshCookie)
        .set('Origin', origin)
        .send({ organizationId: beta.org.id })
        .expect(200);
      expect(backToBeta.body.activeOrganizationId).toBe(beta.org.id);
      expect(backToBeta.body.suspendedOrganizations).toBeUndefined();

      const restoredRisks = await http
        .get(`/api/v1/organizations/${beta.org.id}/risks`)
        .set('Cookie', freshCookie)
        .expect(200);
      expect(
        restoredRisks.body.items.some((item: { id: string }) => item.id === beta.risk.id),
      ).toBe(true);

      const restoredDownload = await http
        .get(
          `/api/v1/organizations/${beta.org.id}/actions/${beta.action.id}/evidence/${beta.evidence.id}/download`,
        )
        .set('Cookie', freshCookie)
        .expect(200);
      expect(Buffer.from(restoredDownload.body).toString('utf8')).toContain(
        'Evidencia-Empresa Beta',
      );
      const restoredReportPdf = await http
        .get(`/api/v1/organizations/${beta.org.id}/reports/${betaReportId}/pdf`)
        .set('Cookie', freshCookie)
        .expect(200);
      expect(Buffer.from(restoredReportPdf.body).subarray(0, 5).toString('utf8')).toBe('%PDF-');

      // Leitor com vínculo ativo recupera acesso normalmente.
      const readerAfter = await http
        .post('/api/v1/auth/sessions')
        .set('Origin', origin)
        .send({ email: readerUser.email, password: readerUser.password })
        .expect(201);
      expect(readerAfter.body.activeOrganizationId).toBe(beta.org.id);

      // Vínculo revogado PERMANECE revogado após reativação!
      const revokedAfter = await http
        .post('/api/v1/auth/sessions')
        .set('Origin', origin)
        .send({ email: revokedUser.email, password: revokedUser.password })
        .expect(201);
      const revokedAfterCookie = cookieFromSetCookie(revokedAfter.headers['set-cookie']);
      expect(revokedAfter.body.activeOrganizationId).toBeNull();
      expect(revokedAfter.body.memberships).toEqual([]);
      await http
        .put('/api/v1/auth/session/organization')
        .set('Cookie', revokedAfterCookie)
        .set('Origin', origin)
        .send({ organizationId: beta.org.id })
        .expect(403);
      await http
        .get(`/api/v1/organizations/${beta.org.id}/overview`)
        .set('Cookie', revokedAfterCookie)
        .expect(404);

      // Alpha continua 100% preservada sem alterações em sua versão ou histórico.
      const alphaDetail = await http
        .get(`${accessRoot}/clients/${alpha.org.id}`)
        .set('Cookie', accessManager.cookie)
        .expect(200);
      expect(alphaDetail.body.access.status).toBe('ACTIVE');
      expect(alphaDetail.body.access.version).toBe(1);
    }, 30_000);

    it('rejeita versão desatualizada, corrida concorrente, transições inválidas e protege imutabilidade no banco', async () => {
      const http = request(app.getHttpServer());
      const commercialManager = await createPlatformAccount(['MANAGE_COMMERCIAL']);
      const accessManager = await createPlatformAccount(['MANAGE_CONTRACT_ACCESS']);
      const company = await setupContractedCompany(
        commercialManager.cookie,
        'Concorrencia ID48',
        commercialManager.userId,
      );

      const path = `${accessRoot}/clients/${company.org.id}/transitions`;
      const headers = { Cookie: accessManager.cookie, Origin: origin };

      // Reativar antes de suspender -> 409.
      await http
        .post(path)
        .set(headers)
        .send({
          expectedVersion: 0,
          kind: 'REACTIVATION',
          effectiveOn: todaySaoPaulo(),
          reason: 'Reativação inválida sem suspensão prévia.',
          nextStep: 'Não deve ser aceita.',
          confirmed: true,
        })
        .expect(409);

      // Corrida paralela com a mesma expectedVersion = 0: exatamente uma vence (201) e outra falha (409).
      const [r1, r2] = await Promise.all([
        http.post(path).set(headers).send({
          expectedVersion: 0,
          kind: 'SUSPENSION',
          effectiveOn: todaySaoPaulo(),
          reason: 'Suspensão concorrente A.',
          nextStep: 'Orientação A.',
          confirmed: true,
          idempotencyKey: randomUUID(),
        }),
        http.post(path).set(headers).send({
          expectedVersion: 0,
          kind: 'SUSPENSION',
          effectiveOn: todaySaoPaulo(),
          reason: 'Suspensão concorrente B.',
          nextStep: 'Orientação B.',
          confirmed: true,
          idempotencyKey: randomUUID(),
        }),
      ]);
      expect([r1.status, r2.status].sort()).toEqual([201, 409]);

      // Versão desatualizada (expectedVersion: 0 quando já está na 1) -> 409.
      await http
        .post(path)
        .set(headers)
        .send({
          expectedVersion: 0,
          kind: 'REACTIVATION',
          effectiveOn: todaySaoPaulo(),
          reason: 'Tentativa com versão defasada.',
          nextStep: 'Atualizar antes de tentar novamente.',
          confirmed: true,
        })
        .expect(409);

      // IdempotencyKey repetida -> 409.
      const sharedKey = randomUUID();
      await http
        .post(path)
        .set(headers)
        .send({
          expectedVersion: 1,
          kind: 'REACTIVATION',
          effectiveOn: todaySaoPaulo(),
          reason: 'Reativação com chave de idempotência.',
          nextStep: 'Empresa liberada.',
          confirmed: true,
          idempotencyKey: sharedKey,
        })
        .expect(201);
      await http
        .post(path)
        .set(headers)
        .send({
          expectedVersion: 2,
          kind: 'SUSPENSION',
          effectiveOn: todaySaoPaulo(),
          reason: 'Reuso indevido da chave de idempotência.',
          nextStep: 'Deve recusar.',
          confirmed: true,
          idempotencyKey: sharedKey,
        })
        .expect(409);

      // Gatilhos do PostgreSQL bloqueiam DELETE e UPDATE indevido.
      await expect(
        db.client
          .$executeRaw`DELETE FROM commercial_contract_accesses WHERE organization_id = ${company.org.id}::uuid`,
      ).rejects.toThrow();
      await expect(
        db.client
          .$executeRaw`UPDATE commercial_contract_access_transitions SET reason = 'adulterado' WHERE organization_id = ${company.org.id}::uuid`,
      ).rejects.toThrow();
    });
  },
);
