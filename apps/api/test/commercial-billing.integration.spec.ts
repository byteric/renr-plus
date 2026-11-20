import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';
import type { PlatformCapability } from '../src/generated/prisma/client';
import { referenceDate } from '../src/modules/actions/actions.repository';
import { localDatabaseUrl } from './local-database-url';

const describeDatabase = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
const commercialRoot = '/api/v1/platform/commercial';
const billingRoot = `${commercialRoot}/billing`;
const reason = 'Operação financeira manual de demonstração';

function saoPauloDay(offsetDays: number): string {
  const base = new Date(`${referenceDate('America/Sao_Paulo', new Date())}T12:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + offsetDays);
  return base.toISOString().slice(0, 10);
}

function competenceOf(offsetMonths: number): string {
  const ref = referenceDate('America/Sao_Paulo', new Date());
  const year = Number(ref.slice(0, 4));
  const month = Number(ref.slice(5, 7)) - 1;
  const target = new Date(Date.UTC(year, month + offsetMonths, 1));
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}`;
}

describeDatabase('Commercial manual billing, due dates and payments (ID 47) on PostgreSQL', () => {
  let app: INestApplication;
  let db: PrismaService;
  let origin: string;

  beforeAll(async () => {
    const environment = parseEnvironment({ ...process.env, NODE_ENV: 'test' });
    localDatabaseUrl(environment.DATABASE_URL);
    origin = environment.CORS_ORIGIN;
    const module = await Test.createTestingModule({
      imports: [AppModule.configure(environment)],
    }).compile();
    db = module.get(PrismaService);
    app = module.createNestApplication();
    configureApplication(app, environment);
    await app.init();
  });

  afterAll(async () => app?.close());

  async function createAccount(capabilities: PlatformCapability[], organizationId?: string) {
    const user = await db.client.user.create({
      data: {
        name: 'Operador financeiro fictício',
        email: `${randomUUID()}@example.test`,
        passwordHash: 'test',
      },
    });
    if (organizationId) {
      await db.client.membership.create({
        data: { userId: user.id, organizationId, role: 'ADMIN' },
      });
    }
    for (const capability of capabilities) {
      await db.client.platformGrant.create({ data: { userId: user.id, capability } });
    }
    const token = randomBytes(32).toString('base64url');
    await db.client.session.create({
      data: {
        userId: user.id,
        activeOrganizationId: organizationId ?? null,
        expiresAt: new Date(Date.now() + 300_000),
        tokenHash: createHash('sha256').update(token).digest('hex'),
      },
    });
    return { userId: user.id, cookie: `renr_session=${token}` };
  }

  async function setupContractedClient(
    manageCommercialCookie: string,
    label: string,
    startsOn = `${competenceOf(-2)}-01`,
    endsOn = `${competenceOf(3)}-28`,
  ) {
    const http = request(app.getHttpServer());
    const auth = { Cookie: manageCommercialCookie, Origin: origin };
    const org = await db.client.organization.create({
      data: {
        name: `${label} ${randomUUID()}`,
        clientClassification: 'DEMONSTRATION',
      },
    });
    const plan = await http
      .post(`${commercialRoot}/plans`)
      .set(auth)
      .send({
        name: `Plano ${label} ${randomUUID()}`,
        kind: 'PLAN',
        version: {
          effectiveOn: `${competenceOf(-4)}-01`,
          priceCents: 1290,
          pricingUnit: 'EMPLOYEE_MONTH',
          priceMode: 'FIXED',
          conditions: 'Condições fictícias para teste do ID 47.',
          limits: 'Resumo executivo de até dez páginas.',
          includedFeatures: ['Avaliação psicossocial'],
          plannedFeatures: [],
        },
        reason,
      })
      .expect(201);

    const contract = await http
      .post(`${commercialRoot}/clients/${org.id}/contract`)
      .set(auth)
      .send({
        planVersionId: plan.body.versions[0].id,
        startsOn,
        endsOn,
        terms: 'Termo contratual fictício para faturamento manual.',
        reason,
      })
      .expect(201);

    return {
      org,
      plan: plan.body as { id: string; name: string; versions: { id: string; ordinal: number }[] },
      contract: contract.body as {
        id: string;
        version: number;
        revisions: {
          id: string;
          ordinal: number;
          planVersion: { id: string; priceCents: number };
        }[];
      },
    };
  }

  it('restringe consultas e escritas financeiras às concessões dedicadas e bloqueia revogação imediata', async () => {
    const http = request(app.getHttpServer());
    const commercialManager = await createAccount(['MANAGE_COMMERCIAL']);
    const commercialReader = await createAccount(['READ_COMMERCIAL']);
    const globalReader = await createAccount(['READ_OVERVIEW']);
    const billingReader = await createAccount(['READ_BILLING']);
    const billingManager = await createAccount(['MANAGE_BILLING']);
    const setup = await setupContractedClient(commercialManager.cookie, 'Escopo Financeiro');
    const tenantAdmin = await createAccount([], setup.org.id);

    const createPath = `${billingRoot}/clients/${setup.org.id}/contracts/${setup.contract.id}/charges`;
    const payload = {
      contractRevisionId: setup.contract.revisions[0]!.id,
      competence: competenceOf(0),
      amountCents: 129000,
      dueOn: saoPauloDay(5),
      paidOn: null,
      receiptReference: null,
      reason,
    };

    for (const denied of [globalReader, tenantAdmin, commercialReader, commercialManager]) {
      await http.get(`${billingRoot}/contracts`).set('Cookie', denied.cookie).expect(403);
      await http.get(`${billingRoot}/charges`).set('Cookie', denied.cookie).expect(403);
      await http
        .post(createPath)
        .set({ Cookie: denied.cookie, Origin: origin })
        .send(payload)
        .expect(403);
    }

    // Leitor financeiro não pode gravar nem acessar catálogo/contratos comerciais fora do escopo financeiro
    await http.get(`${billingRoot}/contracts`).set('Cookie', billingReader.cookie).expect(200);
    await http.get(`${billingRoot}/charges`).set('Cookie', billingReader.cookie).expect(200);
    await http
      .post(createPath)
      .set({ Cookie: billingReader.cookie, Origin: origin })
      .send(payload)
      .expect(403);
    await http.get(`${commercialRoot}/plans`).set('Cookie', billingReader.cookie).expect(403);
    await http
      .get(`${commercialRoot}/clients/${setup.org.id}/contract`)
      .set('Cookie', billingReader.cookie)
      .expect(403);

    // Gestor financeiro exige Origin válida para mutações e não recebe acesso indevido ao catálogo comercial
    await http.post(createPath).set('Cookie', billingManager.cookie).send(payload).expect(403);
    await http.get(`${commercialRoot}/plans`).set('Cookie', billingManager.cookie).expect(403);

    const created = await http
      .post(createPath)
      .set({ Cookie: billingManager.cookie, Origin: origin })
      .send(payload)
      .expect(201);
    expect(created.headers['cache-control']).toBe('private, no-store');

    const contractsList = await http
      .get(`${billingRoot}/contracts`)
      .query({ organizationId: setup.org.id })
      .set('Cookie', billingReader.cookie)
      .expect(200);
    expect(contractsList.body.items[0]).not.toHaveProperty('contactEmail');
    expect(contractsList.body.items[0].contract.revisions[0]).not.toHaveProperty('terms');
    expect(contractsList.body.items[0].contract.revisions[0]).not.toHaveProperty('document');

    // Revogação imediata da concessão financeira bloqueia a próxima consulta
    await db.client.platformGrant.update({
      where: {
        userId_capability: { userId: billingReader.userId, capability: 'READ_BILLING' },
      },
      data: { isActive: false },
    });
    await http
      .get(`${billingRoot}/clients/${setup.org.id}/charges/${created.body.id}`)
      .set('Cookie', billingReader.cookie)
      .expect(403);
  });

  it('reconcilia cobranças em aberto, vencidas e pagas com contrato, período e fronteira de São Paulo', async () => {
    const http = request(app.getHttpServer());
    const operator = await createAccount(['MANAGE_COMMERCIAL', 'MANAGE_BILLING']);
    const auth = { Cookie: operator.cookie, Origin: origin };
    const setup = await setupContractedClient(operator.cookie, 'Reconciliacao');
    const revId = setup.contract.revisions[0]!.id;
    const createPath = `${billingRoot}/clients/${setup.org.id}/contracts/${setup.contract.id}/charges`;
    const todayRef = saoPauloDay(0);
    const compPrev = competenceOf(-1);
    const compCurr = competenceOf(0);
    const compNext = competenceOf(1);

    // Atualiza o catálogo do plano para v2 futura e garante que as cobranças preservam a versão contratada (v1)
    await http
      .post(`${commercialRoot}/plans/${setup.plan.id}/versions`)
      .set(auth)
      .send({
        expectedVersion: 1,
        reason: 'Reajuste de catálogo posterior ao contrato.',
        version: {
          effectiveOn: `${competenceOf(4)}-01`,
          priceCents: 2890,
          pricingUnit: 'EMPLOYEE_MONTH',
          priceMode: 'FIXED',
          conditions: 'Nova tabela futura.',
          limits: 'Sem alteração.',
          includedFeatures: ['Avaliação psicossocial'],
          plannedFeatures: [],
        },
      })
      .expect(201);

    // 1) Cobrança vencida (dueOn < referenceDate)
    const overdue = await http
      .post(createPath)
      .set(auth)
      .send({
        contractRevisionId: revId,
        competence: compPrev,
        amountCents: 129000,
        dueOn: saoPauloDay(-5),
        paidOn: null,
        receiptReference: null,
        reason: 'Mensalidade do mês anterior em atraso.',
      })
      .expect(201);
    expect(overdue.body.status).toBe('OVERDUE');
    expect(overdue.body.planVersion).toMatchObject({ ordinal: 1, priceCents: 1290 });

    // 2) Cobrança com vencimento exatamente na data de referência (deve permanecer OPEN, nunca OVERDUE)
    const openBoundary = await http
      .post(createPath)
      .set(auth)
      .send({
        contractRevisionId: revId,
        competence: compCurr,
        amountCents: 159000,
        dueOn: todayRef,
        paidOn: null,
        receiptReference: null,
        reason: 'Mensalidade com vencimento na data de referência.',
      })
      .expect(201);
    expect(openBoundary.body.status).toBe('OPEN');

    // 3) Cobrança já lançada como paga com referência opcional do comprovante
    const paidDirect = await http
      .post(createPath)
      .set(auth)
      .send({
        contractRevisionId: revId,
        competence: compNext,
        amountCents: 199000,
        dueOn: saoPauloDay(20),
        paidOn: todayRef,
        receiptReference: 'PIX-E2E-DEMO-003',
        reason: 'Pagamento antecipado confirmado no extrato.',
      })
      .expect(201);
    expect(paidDirect.body.status).toBe('PAID');

    // Recusa data de recebimento futura
    await http
      .post(`${billingRoot}/clients/${setup.org.id}/charges/${openBoundary.body.id}/payment`)
      .set(auth)
      .send({
        expectedVersion: 1,
        paidOn: saoPauloDay(1),
        receiptReference: 'PIX-FUTURO',
        reason: 'Tentativa com data futura.',
      })
      .expect(400);

    const periodList = await http
      .get(`${billingRoot}/charges`)
      .query({
        organizationId: setup.org.id,
        competenceFrom: compPrev,
        competenceTo: compNext,
      })
      .set('Cookie', operator.cookie)
      .expect(200);
    expect(periodList.headers['cache-control']).toBe('private, no-store');
    expect(periodList.body.summary).toMatchObject({
      timeZone: 'America/Sao_Paulo',
      referenceDate: todayRef,
      billedCents: 487000,
      openCents: 159000,
      overdueCents: 129000,
      receivedCents: 199000,
      counts: { total: 3, open: 1, overdue: 1, paid: 1 },
    });
    expect(periodList.body.items).toHaveLength(3);

    // Filtros por situação preservam o resumo do período e filtram a listagem
    for (const [status, expectedId] of [
      ['OVERDUE', overdue.body.id],
      ['OPEN', openBoundary.body.id],
      ['PAID', paidDirect.body.id],
    ] as const) {
      const filtered = await http
        .get(`${billingRoot}/charges`)
        .query({
          organizationId: setup.org.id,
          competenceFrom: compPrev,
          competenceTo: compNext,
          status,
        })
        .set('Cookie', operator.cookie)
        .expect(200);
      expect(filtered.body.items.map((item: { id: string }) => item.id)).toEqual([expectedId]);
      expect(filtered.body.summary.billedCents).toBe(487000);
    }

    // Confirmar pagamento da cobrança vencida atualiza status, histórico e resumo do período
    const paid = await http
      .post(`${billingRoot}/clients/${setup.org.id}/charges/${overdue.body.id}/payment`)
      .set(auth)
      .send({
        expectedVersion: 1,
        paidOn: todayRef,
        receiptReference: 'BOLETO-COMP-9988',
        reason: 'Baixa manual após confirmação bancária.',
      })
      .expect(201);
    expect(paid.body).toMatchObject({
      status: 'PAID',
      version: 2,
      paidOn: todayRef,
      receiptReference: 'BOLETO-COMP-9988',
    });
    expect(paid.body.revisions).toHaveLength(2);
    expect(paid.body.revisions.map((r: { kind: string }) => r.kind)).toEqual([
      'CREATED',
      'PAYMENT_CONFIRMED',
    ]);

    const afterPayment = await http
      .get(`${billingRoot}/charges`)
      .query({
        organizationId: setup.org.id,
        competenceFrom: compPrev,
        competenceTo: compNext,
      })
      .set('Cookie', operator.cookie)
      .expect(200);
    expect(afterPayment.body.summary).toMatchObject({
      billedCents: 487000,
      openCents: 159000,
      overdueCents: 0,
      receivedCents: 328000,
      counts: { total: 3, open: 1, overdue: 0, paid: 2 },
    });
  });

  it('preserva histórico imutável em correções, bloqueia no-op e protege registros no PostgreSQL', async () => {
    const http = request(app.getHttpServer());
    const operator = await createAccount(['MANAGE_COMMERCIAL', 'MANAGE_BILLING']);
    const auth = { Cookie: operator.cookie, Origin: origin };
    const setup = await setupContractedClient(operator.cookie, 'Correcao Historico');
    const revId = setup.contract.revisions[0]!.id;
    const todayRef = saoPauloDay(0);

    const created = await http
      .post(`${billingRoot}/clients/${setup.org.id}/contracts/${setup.contract.id}/charges`)
      .set(auth)
      .send({
        contractRevisionId: revId,
        competence: competenceOf(-1),
        amountCents: 129000,
        dueOn: saoPauloDay(-4),
        paidOn: null,
        receiptReference: null,
        reason: 'Registro inicial da cobrança.',
      })
      .expect(201);

    const paid = await http
      .post(`${billingRoot}/clients/${setup.org.id}/charges/${created.body.id}/payment`)
      .set(auth)
      .send({
        expectedVersion: 1,
        paidOn: todayRef,
        receiptReference: 'PIX-INCORRETO-01',
        reason: 'Recebimento registrado com comprovante errado.',
      })
      .expect(201);

    // Correção sem alteração efetiva deve ser recusada (400)
    await http
      .post(`${billingRoot}/clients/${setup.org.id}/charges/${created.body.id}/corrections`)
      .set(auth)
      .send({
        expectedVersion: 2,
        contractRevisionId: revId,
        competence: competenceOf(-1),
        amountCents: 129000,
        dueOn: saoPauloDay(-4),
        paidOn: todayRef,
        receiptReference: 'PIX-INCORRETO-01',
        reason: 'Tentativa sem mudança real.',
      })
      .expect(400);

    // Correção real ajusta valor e estorna recebimento preservando todas as revisões anteriores
    const corrected = await http
      .post(`${billingRoot}/clients/${setup.org.id}/charges/${created.body.id}/corrections`)
      .set(auth)
      .send({
        expectedVersion: 2,
        contractRevisionId: revId,
        competence: competenceOf(-1),
        amountCents: 135000,
        dueOn: saoPauloDay(-4),
        paidOn: null,
        receiptReference: null,
        reason: 'Valor revisado e baixa estornada após conferência financeira.',
      })
      .expect(201);

    expect(corrected.body).toMatchObject({
      version: 3,
      status: 'OVERDUE',
      amountCents: 135000,
      paidOn: null,
      receiptReference: null,
    });
    expect(corrected.body.revisions).toHaveLength(3);
    expect(corrected.body.revisions[0]).toMatchObject({
      ordinal: 1,
      kind: 'CREATED',
      amountCents: 129000,
      paidOn: null,
    });
    expect(corrected.body.revisions[1]).toMatchObject({
      ordinal: 2,
      kind: 'PAYMENT_CONFIRMED',
      amountCents: 129000,
      paidOn: todayRef,
      receiptReference: 'PIX-INCORRETO-01',
    });
    expect(corrected.body.revisions[2]).toMatchObject({
      ordinal: 3,
      kind: 'CORRECTION',
      amountCents: 135000,
      paidOn: null,
      receiptReference: null,
      actor: { id: operator.userId },
    });

    // Triggers do PostgreSQL impedem mutação/exclusão da trilha e exclusão do cabeçalho
    await expect(
      db.client
        .$executeRaw`UPDATE commercial_billing_charge_revisions SET amount_cents = 1 WHERE id = ${paid.body.revisions[0].id}::uuid`,
    ).rejects.toThrow();
    await expect(
      db.client
        .$executeRaw`DELETE FROM commercial_billing_charge_revisions WHERE id = ${paid.body.revisions[0].id}::uuid`,
    ).rejects.toThrow();
    await expect(
      db.client
        .$executeRaw`DELETE FROM commercial_billing_charges WHERE id = ${created.body.id}::uuid`,
    ).rejects.toThrow();

    // Auditoria global registrou os três eventos
    const actions = await db.client.platformAuditEvent.findMany({
      where: { resourceId: created.body.id },
      orderBy: { createdAt: 'asc' },
      select: { action: true },
    });
    expect(actions.map((item) => item.action)).toEqual([
      'COMMERCIAL_BILLING_CHARGE_CREATED',
      'COMMERCIAL_BILLING_PAYMENT_CONFIRMED',
      'COMMERCIAL_BILLING_CHARGE_CORRECTED',
    ]);
  });

  it('garante isolamento entre empresas, integridade da vigência contratual e bloqueio de retirada vinculada', async () => {
    const http = request(app.getHttpServer());
    const operator = await createAccount(['MANAGE_COMMERCIAL', 'MANAGE_BILLING']);
    const auth = { Cookie: operator.cookie, Origin: origin };
    const companyA = await setupContractedClient(
      operator.cookie,
      'Empresa Isolada A',
      `${competenceOf(0)}-01`,
      `${competenceOf(1)}-28`,
    );
    const companyB = await setupContractedClient(
      operator.cookie,
      'Empresa Isolada B',
      `${competenceOf(0)}-01`,
      `${competenceOf(1)}-28`,
    );

    // Cruzamento de contrato/revisão entre empresas retorna 404
    await http
      .post(`${billingRoot}/clients/${companyA.org.id}/contracts/${companyB.contract.id}/charges`)
      .set(auth)
      .send({
        contractRevisionId: companyB.contract.revisions[0]!.id,
        competence: competenceOf(0),
        amountCents: 100000,
        dueOn: saoPauloDay(10),
        paidOn: null,
        receiptReference: null,
        reason,
      })
      .expect(404);

    await http
      .post(`${billingRoot}/clients/${companyA.org.id}/contracts/${companyA.contract.id}/charges`)
      .set(auth)
      .send({
        contractRevisionId: companyB.contract.revisions[0]!.id,
        competence: competenceOf(0),
        amountCents: 100000,
        dueOn: saoPauloDay(10),
        paidOn: null,
        receiptReference: null,
        reason,
      })
      .expect(404);

    // Competência fora da vigência do termo contratual retorna 409
    await http
      .post(`${billingRoot}/clients/${companyA.org.id}/contracts/${companyA.contract.id}/charges`)
      .set(auth)
      .send({
        contractRevisionId: companyA.contract.revisions[0]!.id,
        competence: competenceOf(-2),
        amountCents: 100000,
        dueOn: saoPauloDay(10),
        paidOn: null,
        receiptReference: null,
        reason,
      })
      .expect(409);

    const chargeA = await http
      .post(`${billingRoot}/clients/${companyA.org.id}/contracts/${companyA.contract.id}/charges`)
      .set(auth)
      .send({
        contractRevisionId: companyA.contract.revisions[0]!.id,
        competence: competenceOf(0),
        amountCents: 111000,
        dueOn: saoPauloDay(10),
        paidOn: null,
        receiptReference: null,
        reason,
      })
      .expect(201);

    // Acesso, baixa e correção de cobrança da empresa A sob rota da empresa B retornam 404
    await http
      .get(`${billingRoot}/clients/${companyB.org.id}/charges/${chargeA.body.id}`)
      .set('Cookie', operator.cookie)
      .expect(404);
    await http
      .post(`${billingRoot}/clients/${companyB.org.id}/charges/${chargeA.body.id}/payment`)
      .set(auth)
      .send({
        expectedVersion: 1,
        paidOn: saoPauloDay(0),
        receiptReference: null,
        reason,
      })
      .expect(404);
    await http
      .post(`${billingRoot}/clients/${companyB.org.id}/charges/${chargeA.body.id}/corrections`)
      .set(auth)
      .send({
        expectedVersion: 1,
        contractRevisionId: companyA.contract.revisions[0]!.id,
        competence: competenceOf(0),
        amountCents: 222000,
        dueOn: saoPauloDay(12),
        paidOn: null,
        receiptReference: null,
        reason,
      })
      .expect(404);

    // Listagem filtrada por empresa B não vaza cobranças nem totais da empresa A
    const listB = await http
      .get(`${billingRoot}/charges`)
      .query({ organizationId: companyB.org.id })
      .set('Cookie', operator.cookie)
      .expect(200);
    expect(listB.body.items).toEqual([]);
    expect(listB.body.summary.billedCents).toBe(0);

    // Renovação futura com cobrança vinculada não pode ser retirada via WITHDRAW_SCHEDULED
    const futureRenewal = await http
      .post(
        `${commercialRoot}/clients/${companyA.org.id}/contract/${companyA.contract.id}/revisions`,
      )
      .set(auth)
      .send({
        expectedVersion: 1,
        kind: 'RENEWAL',
        planVersionId: companyA.plan.versions[0]!.id,
        startsOn: `${competenceOf(2)}-01`,
        endsOn: `${competenceOf(3)}-28`,
        terms: 'Renovação futura para teste de vínculo.',
        reason,
      })
      .expect(201);
    const futureRevisionId = futureRenewal.body.revisions[1].id as string;

    await http
      .post(`${billingRoot}/clients/${companyA.org.id}/contracts/${companyA.contract.id}/charges`)
      .set(auth)
      .send({
        contractRevisionId: futureRevisionId,
        competence: competenceOf(2),
        amountCents: 149000,
        dueOn: saoPauloDay(45),
        paidOn: null,
        receiptReference: null,
        reason,
      })
      .expect(201);

    await http
      .post(
        `${commercialRoot}/clients/${companyA.org.id}/contract/${companyA.contract.id}/revisions`,
      )
      .set(auth)
      .send({
        expectedVersion: 2,
        kind: 'WITHDRAW_SCHEDULED',
        revisionId: futureRevisionId,
        reason: 'Tentativa de retirar termo já faturado.',
      })
      .expect(409);

    // Termo substituído por AMENDMENT ou encerrado por CANCELLATION no dia 1º do mês não aceita cobrança posterior
    const companyC = await setupContractedClient(
      operator.cookie,
      'Empresa Emenda Cancelamento',
      `${competenceOf(-2)}-01`,
      `${competenceOf(2)}-28`,
    );
    const initialRevC = companyC.contract.revisions[0]!.id;
    const amended = await http
      .post(
        `${commercialRoot}/clients/${companyC.org.id}/contract/${companyC.contract.id}/revisions`,
      )
      .set(auth)
      .send({
        expectedVersion: 1,
        kind: 'AMENDMENT',
        planVersionId: companyC.plan.versions[0]!.id,
        startsOn: `${competenceOf(0)}-01`,
        endsOn: `${competenceOf(1)}-28`,
        terms: 'Emenda substituindo termo inicial a partir do mês atual.',
        reason,
      })
      .expect(201);
    const amendmentRevC = amended.body.revisions[1].id as string;

    // Competência do mês atual sob o termo inicial já substituído deve falhar (409)
    await http
      .post(`${billingRoot}/clients/${companyC.org.id}/contracts/${companyC.contract.id}/charges`)
      .set(auth)
      .send({
        contractRevisionId: initialRevC,
        competence: competenceOf(0),
        amountCents: 129000,
        dueOn: saoPauloDay(10),
        paidOn: null,
        receiptReference: null,
        reason,
      })
      .expect(409);

    // Cancelamento no dia 1º do mês seguinte bloqueia faturamento daquele mês na emenda
    await http
      .post(
        `${commercialRoot}/clients/${companyC.org.id}/contract/${companyC.contract.id}/revisions`,
      )
      .set(auth)
      .send({
        expectedVersion: 2,
        kind: 'CANCELLATION',
        startsOn: `${competenceOf(1)}-01`,
        reason: 'Cancelamento no início do mês seguinte.',
      })
      .expect(201);

    await http
      .post(`${billingRoot}/clients/${companyC.org.id}/contracts/${companyC.contract.id}/charges`)
      .set(auth)
      .send({
        contractRevisionId: amendmentRevC,
        competence: competenceOf(1),
        amountCents: 129000,
        dueOn: saoPauloDay(35),
        paidOn: null,
        receiptReference: null,
        reason,
      })
      .expect(409);
  });

  it('impede registros duplicados em criações, confirmações de pagamento e correções concorrentes', async () => {
    const http = request(app.getHttpServer());
    const operator = await createAccount(['MANAGE_COMMERCIAL', 'MANAGE_BILLING']);
    const auth = { Cookie: operator.cookie, Origin: origin };
    const setup = await setupContractedClient(operator.cookie, 'Concorrencia Financeira');
    const revId = setup.contract.revisions[0]!.id;
    const createPath = `${billingRoot}/clients/${setup.org.id}/contracts/${setup.contract.id}/charges`;
    const compCurr = competenceOf(0);
    const compNext = competenceOf(1);
    const sharedKey = randomUUID();

    // 1) Criação concorrente da mesma competência no mesmo contrato -> [201, 409]
    const createRace = await Promise.all([
      http
        .post(createPath)
        .set(auth)
        .send({
          contractRevisionId: revId,
          competence: compCurr,
          amountCents: 129000,
          dueOn: saoPauloDay(10),
          paidOn: null,
          receiptReference: null,
          reason,
          idempotencyKey: sharedKey,
        }),
      http
        .post(createPath)
        .set(auth)
        .send({
          contractRevisionId: revId,
          competence: compCurr,
          amountCents: 129000,
          dueOn: saoPauloDay(10),
          paidOn: null,
          receiptReference: null,
          reason,
          idempotencyKey: randomUUID(),
        }),
    ]);
    expect(createRace.map((res) => res.status).sort()).toEqual([201, 409]);
    const winner = createRace.find((res) => res.status === 201)!;
    const chargeId = winner.body.id as string;

    expect(
      await db.client.commercialBillingCharge.count({
        where: { contractId: setup.contract.id, competence: compCurr },
      }),
    ).toBe(1);

    // Reutilizar a mesma idempotencyKey em outra competência da mesma empresa -> 409
    const usedKey = await db.client.commercialBillingChargeRevision.findFirst({
      where: { chargeId, ordinal: 1 },
      select: { idempotencyKey: true },
    });
    await http
      .post(createPath)
      .set(auth)
      .send({
        contractRevisionId: revId,
        competence: compNext,
        amountCents: 129000,
        dueOn: saoPauloDay(40),
        paidOn: null,
        receiptReference: null,
        reason,
        idempotencyKey: usedKey!.idempotencyKey,
      })
      .expect(409);

    // 2) Confirmação concorrente de recebimento -> [201, 409] e apenas 1 revisão PAYMENT_CONFIRMED
    const paymentPath = `${billingRoot}/clients/${setup.org.id}/charges/${chargeId}/payment`;
    const paymentRace = await Promise.all([
      http
        .post(paymentPath)
        .set(auth)
        .send({
          expectedVersion: 1,
          paidOn: saoPauloDay(0),
          receiptReference: 'PIX-CONC-1',
          reason: 'Confirmação concorrente A.',
        }),
      http
        .post(paymentPath)
        .set(auth)
        .send({
          expectedVersion: 1,
          paidOn: saoPauloDay(0),
          receiptReference: 'PIX-CONC-2',
          reason: 'Confirmação concorrente B.',
        }),
    ]);
    expect(paymentRace.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(
      await db.client.commercialBillingChargeRevision.count({
        where: { chargeId, kind: 'PAYMENT_CONFIRMED' },
      }),
    ).toBe(1);

    // 3) Reconfirmação repetida mesmo com versão atualizada -> 409
    await http
      .post(paymentPath)
      .set(auth)
      .send({
        expectedVersion: 2,
        paidOn: saoPauloDay(0),
        receiptReference: 'PIX-REPETIDO',
        reason: 'Tentativa repetida em cobrança já paga.',
      })
      .expect(409);

    // 4) Correções concorrentes com mesma versão esperada -> [201, 409]
    const correctionPath = `${billingRoot}/clients/${setup.org.id}/charges/${chargeId}/corrections`;
    const correctionRace = await Promise.all([
      http
        .post(correctionPath)
        .set(auth)
        .send({
          expectedVersion: 2,
          contractRevisionId: revId,
          competence: compCurr,
          amountCents: 131000,
          dueOn: saoPauloDay(10),
          paidOn: saoPauloDay(0),
          receiptReference: 'PIX-AJUSTE-A',
          reason: 'Correção concorrente A.',
        }),
      http
        .post(correctionPath)
        .set(auth)
        .send({
          expectedVersion: 2,
          contractRevisionId: revId,
          competence: compCurr,
          amountCents: 132000,
          dueOn: saoPauloDay(10),
          paidOn: saoPauloDay(0),
          receiptReference: 'PIX-AJUSTE-B',
          reason: 'Correção concorrente B.',
        }),
    ]);
    expect(correctionRace.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(
      await db.client.commercialBillingChargeRevision.count({
        where: { chargeId },
      }),
    ).toBe(3);
  });
});
