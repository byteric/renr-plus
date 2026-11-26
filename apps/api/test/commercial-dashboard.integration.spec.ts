import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  clientRegistrationSchema,
  commercialBillingChargeListSchema,
  commercialContractAccessClientListSchema,
  commercialDashboardSchema,
  peopleOverviewSchema,
} from '@renr/contracts';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';
import { referenceDate } from '../src/modules/actions/actions.repository';
import { localDatabaseUrl } from './local-database-url';

const runDb = process.env.RUN_DB_TESTS === '1' && Boolean(process.env.DATABASE_URL);
const describeDb = runDb ? describe : describe.skip;

const civilOffset = (baseIso: string, days: number) => {
  const date = new Date(`${baseIso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

describeDb(
  'ID 51 integration: CNPJ catalog, ReNR Dev Studio vacations, and commercial dashboard',
  () => {
    let app: INestApplication;
    let db: PrismaService;
    const origin = 'http://127.0.0.1:5173';
    const cookies = new Map<string, string>();
    let todayIso = '';

    const createSession = async (
      key: string,
      userId: string,
      activeOrganizationId: string | null = null,
    ) => {
      const token = randomBytes(32).toString('base64url');
      await db.client.session.create({
        data: {
          userId,
          activeOrganizationId,
          expiresAt: new Date(Date.now() + 300_000),
          tokenHash: createHash('sha256').update(token).digest('hex'),
        },
      });
      cookies.set(key, `renr_session=${token}`);
    };

    beforeAll(async () => {
      const environment = parseEnvironment({
        ...process.env,
        NODE_ENV: 'test',
        CORS_ORIGIN: origin,
        STORAGE_ENABLED: 'false',
        RISK_COLLABORATION_WRITES_ENABLED: 'false',
      });
      localDatabaseUrl(environment.DATABASE_URL);
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule.configure(environment)],
      }).compile();

      app = moduleRef.createNestApplication();
      configureApplication(app, environment);
      await app.init();

      db = app.get(PrismaService);
      todayIso = referenceDate('America/Sao_Paulo', new Date());

      const createPlatformUser = async (
        key: string,
        email: string,
        name: string,
        capabilities: (
          | 'READ_OVERVIEW'
          | 'MANAGE_CLIENTS'
          | 'READ_COMMERCIAL'
          | 'MANAGE_COMMERCIAL'
          | 'READ_BILLING'
          | 'MANAGE_BILLING'
          | 'READ_CONTRACT_ACCESS'
          | 'MANAGE_CONTRACT_ACCESS'
        )[],
      ) => {
        const user = await db.client.user.create({
          data: {
            email,
            name,
            passwordHash: 'test',
            platformGrants: { create: capabilities.map((capability) => ({ capability })) },
          },
        });
        await createSession(key, user.id, null);
        return user;
      };

      await createPlatformUser('globalRead', 'id51-read@renr.example', 'Leitor Global ID51', [
        'READ_OVERVIEW',
      ]);
      await createPlatformUser('catalogAdmin', 'id51-clients@renr.example', 'Admin Catálogo ID51', [
        'READ_OVERVIEW',
        'MANAGE_CLIENTS',
      ]);
      await createPlatformUser(
        'supportOnly',
        'id51-support@renr.example',
        'Suporte Comercial ID51',
        ['READ_COMMERCIAL'],
      );
      await createPlatformUser('financeOnly', 'id51-finance@renr.example', 'Financeiro ID51', [
        'READ_BILLING',
      ]);
      await createPlatformUser('fullOperator', 'id51-full@renr.example', 'Operador Full ID51', [
        'READ_OVERVIEW',
        'MANAGE_CLIENTS',
        'READ_COMMERCIAL',
        'MANAGE_COMMERCIAL',
        'READ_BILLING',
        'MANAGE_BILLING',
        'READ_CONTRACT_ACCESS',
        'MANAGE_CONTRACT_ACCESS',
      ]);
    });

    afterAll(async () => {
      if (db) await db.client.session.deleteMany();
      if (app) await app.close();
    });

    it('cadastra empresa por CNPJ no catálogo, bloqueia duplicidade, inclui em grupo e preserva consulta global somente leitura', async () => {
      // Leitor global somente leitura não pode criar nem editar
      await request(app.getHttpServer())
        .post('/api/v1/platform/clients')
        .set('Cookie', cookies.get('globalRead')!)
        .set('Origin', origin)
        .send({
          name: 'Bloqueada Leitor',
          fiscalIdentifier: '27.865.757/0001-02',
          reason: 'Tentativa sem MANAGE_CLIENTS.',
        })
        .expect(403);

      // Cliente sem CNPJ deve ser recusado com 409
      await request(app.getHttpServer())
        .post('/api/v1/platform/clients')
        .set('Cookie', cookies.get('catalogAdmin')!)
        .set('Origin', origin)
        .send({
          name: 'Sem CNPJ Cliente',
          fiscalIdentifier: null,
          clientClassification: 'CLIENT',
          reason: 'Teste sem CNPJ.',
        })
        .expect(409);

      // Cadastro autorizado com CNPJ fictício válido
      const created = clientRegistrationSchema.parse(
        (
          await request(app.getHttpServer())
            .post('/api/v1/platform/clients')
            .set('Cookie', cookies.get('catalogAdmin')!)
            .set('Origin', origin)
            .send({
              name: 'Alfa Indústria Fictícia ID51',
              fiscalIdentifier: '27.865.757/0001-02',
              clientClassification: 'CLIENT',
              reason: 'Cadastro inicial no catálogo ID 51.',
            })
            .expect(201)
        ).body,
      );
      expect(created.normalizedFiscalIdentifier).toBe('27865757000102');
      expect(created.fiscalState).toBe('VALID');
      expect(created.version).toBe(1);

      // Operador global não ganha vínculo nominal na empresa criada
      const memberships = await db.client.membership.count({
        where: { organizationId: created.organizationId },
      });
      expect(memberships).toBe(0);

      // Duplicidade de CNPJ (mesmo sem pontuação) é recusada com 409
      await request(app.getHttpServer())
        .post('/api/v1/platform/clients')
        .set('Cookie', cookies.get('catalogAdmin')!)
        .set('Origin', origin)
        .send({
          name: 'Outra Empresa Mesmo CNPJ',
          fiscalIdentifier: '27865757000102',
          clientClassification: 'CLIENT',
          reason: 'Tentativa de duplicidade.',
        })
        .expect(409);

      // Leitor global localiza no catálogo somente leitura
      const readList = await request(app.getHttpServer())
        .get(
          '/api/v1/platform/clients?search=27865757000102&classification=CLIENT&fiscalState=VALID',
        )
        .set('Cookie', cookies.get('globalRead')!)
        .expect(200);
      expect(
        readList.body.items.map((item: { organizationId: string }) => item.organizationId),
      ).toContain(created.organizationId);

      // Empresa aparece elegível para grupos e pode ser incluída
      const eligible = await request(app.getHttpServer())
        .get('/api/v1/platform/company-groups/eligible-clients?search=27865757000102')
        .set('Cookie', cookies.get('catalogAdmin')!)
        .expect(200);
      expect(eligible.body.items.map((item: { id: string }) => item.id)).toContain(
        created.organizationId,
      );

      const groupRes = await request(app.getHttpServer())
        .post('/api/v1/platform/company-groups')
        .set('Cookie', cookies.get('catalogAdmin')!)
        .set('Origin', origin)
        .send({
          name: 'Grupo Fictício ID51',
          organizationIds: [created.organizationId],
          reason: 'Validação de inclusão após cadastro no catálogo.',
        })
        .expect(201);
      expect(groupRes.body.organizationIds).toEqual([created.organizationId]);
    });

    it('confere indicadores de férias e histórico insuficiente na ReNR Dev Studio com perfil RH', async () => {
      const devStudioOrg = await db.client.organization.create({
        data: {
          name: 'ReNR Dev Studio',
          fiscalIdentifier: '45997418000153',
          fiscalCandidate: '45997418000153',
          normalizedFiscalIdentifier: '45997418000153',
          fiscalState: 'VALID',
          clientClassification: 'DEMONSTRATION',
        },
      });
      const rafael = await db.client.user.create({
        data: {
          email: 'rafael-rh-id51@renr.example',
          name: 'Rafael RH',
          passwordHash: 'test',
          memberships: {
            create: {
              organizationId: devStudioOrg.id,
              role: 'READER',
              hrCapabilities: ['HR_ANALYTICS_READ', 'HR_PROFILE_READ'],
            },
          },
        },
      });
      const unitRecife = await db.client.unit.create({
        data: {
          organizationId: devStudioOrg.id,
          name: 'Unidade Recife',
          normalizedName: 'unidade recife',
        },
      });
      const sectorKnown = await db.client.sector.create({
        data: {
          organizationId: devStudioOrg.id,
          unitId: unitRecife.id,
          name: 'Engenharia',
          normalizedName: 'engenharia',
        },
      });
      const sectorUnknown = await db.client.sector.create({
        data: {
          organizationId: devStudioOrg.id,
          unitId: unitRecife.id,
          name: 'Operações Sem Histórico',
          normalizedName: 'operacoes sem historico',
        },
      });

      const seedCohort = async (
        sectorId: string,
        kind: 'OVERDUE' | 'DUE_SOON' | 'REGULAR' | 'UNKNOWN',
        count: number,
      ) => {
        for (let i = 0; i < count; i += 1) {
          const emp = await db.client.employee.create({
            data: {
              organizationId: devStudioOrg.id,
              unitId: unitRecife.id,
              sectorId,
              name: `Colab ${kind} ${i + 1}`,
              isActive: true,
            },
          });
          if (kind === 'UNKNOWN') {
            await db.client.employeeHrProfile.create({
              data: {
                organizationId: devStudioOrg.id,
                employeeId: emp.id,
                vacationHistoryKnown: false,
                followUp: true,
                source: 'ID51',
                updatedById: rafael.id,
              },
            });
            continue;
          }
          await db.client.employeeHrProfile.create({
            data: {
              organizationId: devStudioOrg.id,
              employeeId: emp.id,
              birthDate: new Date('1991-04-10T00:00:00.000Z'),
              gender: 'FEMALE',
              vacationHistoryKnown: true,
              source: 'ID51',
              updatedById: rafael.id,
            },
          });
          const offset = kind === 'OVERDUE' ? -30 : kind === 'DUE_SOON' ? 20 : 160;
          await db.client.employeeVacationPeriod.create({
            data: {
              organizationId: devStudioOrg.id,
              employeeId: emp.id,
              acquisitionStart: new Date('2024-01-01T00:00:00.000Z'),
              acquisitionEnd: new Date('2024-12-31T00:00:00.000Z'),
              concessionDeadline: new Date(`${civilOffset(todayIso, offset)}T00:00:00.000Z`),
              entitlementDays: 30,
              balanceDays: 30,
              historyKnown: true,
              source: 'ID51',
              updatedById: rafael.id,
            },
          });
        }
      };

      await seedCohort(sectorKnown.id, 'OVERDUE', 5);
      await seedCohort(sectorKnown.id, 'DUE_SOON', 5);
      await seedCohort(sectorKnown.id, 'REGULAR', 5);
      await seedCohort(sectorUnknown.id, 'UNKNOWN', 5);

      await createSession('rafaelRh', rafael.id, devStudioOrg.id);

      // Empresa inteira: 5 vencidas, 5 próximas do vencimento, 5 desconhecidas; salário FORBIDDEN
      const companyOverview = peopleOverviewSchema.parse(
        (
          await request(app.getHttpServer())
            .get(`/api/v1/organizations/${devStudioOrg.id}/people-overview`)
            .set('Cookie', cookies.get('rafaelRh')!)
            .expect(200)
        ).body,
      );
      expect(companyOverview.metrics.vacationOverdue).toMatchObject({
        state: 'KNOWN',
        value: '5',
        known: 15,
        missing: 5,
      });
      expect(companyOverview.metrics.vacationDueSoon).toMatchObject({
        state: 'KNOWN',
        value: '5',
        known: 15,
        missing: 5,
      });
      expect(companyOverview.metrics.vacationUnknown).toMatchObject({
        state: 'KNOWN',
        value: '5',
        known: 15,
        missing: 5,
      });
      expect(companyOverview.metrics.salaryMassCents.state).toBe('FORBIDDEN');

      // Setor sem histórico conhecido: férias vencidas e próximas -> INSUFFICIENT_DATA; desconhecido -> 5
      const unknownOverview = peopleOverviewSchema.parse(
        (
          await request(app.getHttpServer())
            .get(
              `/api/v1/organizations/${devStudioOrg.id}/people-overview?sectorId=${sectorUnknown.id}`,
            )
            .set('Cookie', cookies.get('rafaelRh')!)
            .expect(200)
        ).body,
      );
      expect(unknownOverview.metrics.vacationOverdue).toMatchObject({
        state: 'INSUFFICIENT_DATA',
        value: null,
        known: 0,
        missing: 5,
      });
      expect(unknownOverview.metrics.vacationDueSoon).toMatchObject({
        state: 'INSUFFICIENT_DATA',
        value: null,
        known: 0,
        missing: 5,
      });
      expect(unknownOverview.metrics.vacationUnknown).toMatchObject({
        state: 'KNOWN',
        value: '5',
        known: 0,
        missing: 5,
      });
    });

    it('reconcilia painel comercial com origem, deduplica alertas e isola finanças/suporte/leitor global', async () => {
      const fullCookie = cookies.get('fullOperator')!;

      // Criar plano versionado
      const planRes = await request(app.getHttpServer())
        .post('/api/v1/platform/commercial/plans')
        .set('Cookie', fullCookie)
        .set('Origin', origin)
        .send({
          name: 'Plano Consolidado ID51',
          kind: 'PLAN',
          reason: 'Oferta fictícia ID51.',
          version: {
            effectiveOn: civilOffset(todayIso, -180),
            priceCents: 100000,
            pricingUnit: 'EMPLOYEE_MONTH',
            priceMode: 'FIXED',
            conditions: 'Condições fictícias do plano ID51.',
            limits: 'Sem custos externos.',
            includedFeatures: ['Painel operacional'],
            plannedFeatures: [],
          },
        })
        .expect(201);
      const planVersionId = planRes.body.versions[0].id as string;

      // Empresa 1: contrato expirando em 15 dias + 2 cobranças vencidas + 1 a vencer em 3 dias + 1 paga + acesso suspenso
      const org1 = clientRegistrationSchema.parse(
        (
          await request(app.getHttpServer())
            .post('/api/v1/platform/clients')
            .set('Cookie', fullCookie)
            .set('Origin', origin)
            .send({
              name: 'Cliente Painel Um ID51',
              fiscalIdentifier: '33.000.167/0001-01',
              clientClassification: 'CLIENT',
              reason: 'Empresa 1 para painel comercial.',
            })
            .expect(201)
        ).body,
      );

      const contract1Res = await request(app.getHttpServer())
        .post(`/api/v1/platform/commercial/clients/${org1.organizationId}/contract`)
        .set('Cookie', fullCookie)
        .set('Origin', origin)
        .send({
          planVersionId,
          startsOn: civilOffset(todayIso, -60),
          endsOn: civilOffset(todayIso, 15),
          terms: 'Contrato ativo prestes a renovar.',
          reason: 'Cadastro inicial contrato 1.',
        })
        .expect(201);
      const contract1Id = contract1Res.body.id as string;
      const rev1Id = contract1Res.body.revisions[0].id as string;

      const comp1 = todayIso.slice(0, 7);
      const prevDate = civilOffset(todayIso, -35);
      const compPrev = prevDate.slice(0, 7);
      const prev2Date = civilOffset(todayIso, -65);
      const compPrev2 = prev2Date.slice(0, 7);
      const nextDate = civilOffset(todayIso, 35);
      const compNext = nextDate.slice(0, 7);

      // 2 cobranças vencidas na mesma empresa (devem virar 1 único alerta deduplicado!)
      await request(app.getHttpServer())
        .post(
          `/api/v1/platform/commercial/billing/clients/${org1.organizationId}/contracts/${contract1Id}/charges`,
        )
        .set('Cookie', fullCookie)
        .set('Origin', origin)
        .send({
          contractRevisionId: rev1Id,
          competence: compPrev2,
          amountCents: 100000,
          dueOn: civilOffset(todayIso, -20),
          paidOn: null,
          receiptReference: null,
          reason: 'Cobrança vencida 1.',
          idempotencyKey: randomUUID(),
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(
          `/api/v1/platform/commercial/billing/clients/${org1.organizationId}/contracts/${contract1Id}/charges`,
        )
        .set('Cookie', fullCookie)
        .set('Origin', origin)
        .send({
          contractRevisionId: rev1Id,
          competence: compPrev,
          amountCents: 50000,
          dueOn: civilOffset(todayIso, -5),
          paidOn: null,
          receiptReference: null,
          reason: 'Cobrança vencida 2.',
          idempotencyKey: randomUUID(),
        })
        .expect(201);

      // 1 cobrança em aberto vencendo em 3 dias
      await request(app.getHttpServer())
        .post(
          `/api/v1/platform/commercial/billing/clients/${org1.organizationId}/contracts/${contract1Id}/charges`,
        )
        .set('Cookie', fullCookie)
        .set('Origin', origin)
        .send({
          contractRevisionId: rev1Id,
          competence: comp1,
          amountCents: 75000,
          dueOn: civilOffset(todayIso, 3),
          paidOn: null,
          receiptReference: null,
          reason: 'Cobrança a vencer em breve.',
          idempotencyKey: randomUUID(),
        })
        .expect(201);

      // 1 cobrança paga
      const paidCreate = await request(app.getHttpServer())
        .post(
          `/api/v1/platform/commercial/billing/clients/${org1.organizationId}/contracts/${contract1Id}/charges`,
        )
        .set('Cookie', fullCookie)
        .set('Origin', origin)
        .send({
          contractRevisionId: rev1Id,
          competence: compNext,
          amountCents: 120000,
          dueOn: civilOffset(todayIso, 10),
          paidOn: null,
          receiptReference: null,
          reason: 'Cobrança liquidada.',
          idempotencyKey: randomUUID(),
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(
          `/api/v1/platform/commercial/billing/clients/${org1.organizationId}/charges/${paidCreate.body.id}/payment`,
        )
        .set('Cookie', fullCookie)
        .set('Origin', origin)
        .send({
          expectedVersion: 1,
          paidOn: todayIso,
          receiptReference: 'COMP-ID51-001',
          reason: 'Recebimento manual confirmado.',
          idempotencyKey: randomUUID(),
        })
        .expect(201);

      // Suspender acesso contratual da Empresa 1
      await request(app.getHttpServer())
        .post(`/api/v1/platform/commercial/access/clients/${org1.organizationId}/transitions`)
        .set('Cookie', fullCookie)
        .set('Origin', origin)
        .send({
          expectedVersion: 0,
          kind: 'SUSPENSION',
          effectiveOn: todayIso,
          reason: 'Suspensão manual fictícia ID 51.',
          nextStep: 'Regularizar junto ao comercial.',
          confirmed: true,
        })
        .expect(201);

      // 1. Leitor global (apenas READ_OVERVIEW) -> 403 no painel comercial
      await request(app.getHttpServer())
        .get('/api/v1/platform/commercial/dashboard')
        .set('Cookie', cookies.get('globalRead')!)
        .expect(403);

      // 2. Suporte comercial (READ_COMMERCIAL) -> ZERO dados financeiros nem acesso contratual
      const supportDash = commercialDashboardSchema.parse(
        (
          await request(app.getHttpServer())
            .get(`/api/v1/platform/commercial/dashboard?organizationId=${org1.organizationId}`)
            .set('Cookie', cookies.get('supportOnly')!)
            .expect(200)
        ).body,
      );
      expect(supportDash.billing).toBeNull();
      expect(supportDash.contractAccess).toBeNull();
      expect(supportDash.contracts).toMatchObject({ total: 1, active: 1, expiringSoon: 1 });
      expect(supportDash.alerts.some((a) => a.domain === 'billing' || a.domain === 'access')).toBe(
        false,
      );
      expect(supportDash.alerts.some((a) => a.kind === 'CONTRACT_EXPIRING_SOON')).toBe(true);

      // 3. Financeiro (READ_BILLING) -> ZERO contratos/acesso; cobranças reconciliadas + alerta vencido deduplicado!
      const financeDash = commercialDashboardSchema.parse(
        (
          await request(app.getHttpServer())
            .get(`/api/v1/platform/commercial/dashboard?organizationId=${org1.organizationId}`)
            .set('Cookie', cookies.get('financeOnly')!)
            .expect(200)
        ).body,
      );
      expect(financeDash.contracts).toBeNull();
      expect(financeDash.contractAccess).toBeNull();
      expect(financeDash.catalog).toBeNull();
      expect(financeDash.billing).toMatchObject({
        billedCents: 345000,
        openCents: 75000,
        overdueCents: 150000,
        receivedCents: 120000,
        counts: { total: 4, open: 1, overdue: 2, paid: 1 },
      });
      const overdueAlerts = financeDash.alerts.filter((a) => a.kind === 'BILLING_OVERDUE');
      expect(overdueAlerts).toHaveLength(1);
      expect(overdueAlerts[0]).toMatchObject({
        itemCount: 2,
        amountCents: 150000,
        billingStatusFilter: 'OVERDUE',
      });
      expect(financeDash.alerts.filter((a) => a.kind === 'BILLING_DUE_SOON')).toHaveLength(1);

      // 4. Operador completo -> reconciliação 1:1 com tela de cobranças e acesso contratual + zero duplicatas
      const [fullDashRes, billingListRes, accessListRes] = await Promise.all([
        request(app.getHttpServer())
          .get(`/api/v1/platform/commercial/dashboard?organizationId=${org1.organizationId}`)
          .set('Cookie', fullCookie)
          .expect(200),
        request(app.getHttpServer())
          .get(`/api/v1/platform/commercial/billing/charges?organizationId=${org1.organizationId}`)
          .set('Cookie', fullCookie)
          .expect(200),
        request(app.getHttpServer())
          .get(`/api/v1/platform/commercial/access/clients?search=${encodeURIComponent(org1.name)}`)
          .set('Cookie', fullCookie)
          .expect(200),
      ]);
      const fullDash = commercialDashboardSchema.parse(fullDashRes.body);
      const billingList = commercialBillingChargeListSchema.parse(billingListRes.body);
      const accessList = commercialContractAccessClientListSchema.parse(accessListRes.body);

      expect(fullDash.billing).toEqual(billingList.summary);
      expect(fullDash.contractAccess).toMatchObject({
        totalClients: 1,
        suspended: 1,
        active: 0,
        unrecorded: 0,
      });
      expect(accessList.items[0]?.access.status).toBe('SUSPENDED');
      expect(new Set(fullDash.alerts.map((a) => a.id)).size).toBe(fullDash.alerts.length);
      expect(fullDash.supportTickets).toBeNull();
      expect(financeDash.supportTickets).toBeNull();

      // 5. Consulta vazia por período futuro sem cobranças
      const emptyPeriodDash = commercialDashboardSchema.parse(
        (
          await request(app.getHttpServer())
            .get(
              `/api/v1/platform/commercial/dashboard?organizationId=${org1.organizationId}&competenceFrom=2035-01&competenceTo=2035-02`,
            )
            .set('Cookie', cookies.get('financeOnly')!)
            .expect(200)
        ).body,
      );
      expect(emptyPeriodDash.billing?.counts.total).toBe(0);
      expect(emptyPeriodDash.alerts).toHaveLength(0);
    });
  },
);
