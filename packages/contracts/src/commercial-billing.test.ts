import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as contracts from './index';

const orgId = '10000000-0000-4000-8000-000000000001';
const contractId = '10000000-0000-4000-8000-000000000002';
const revisionId = '10000000-0000-4000-8000-000000000003';
const planId = '10000000-0000-4000-8000-000000000004';
const planVersionId = '10000000-0000-4000-8000-000000000005';
const chargeId = '10000000-0000-4000-8000-000000000006';
const chargeRevisionId = '10000000-0000-4000-8000-000000000007';
const actorId = '10000000-0000-4000-8000-000000000008';
const idempotencyKey = '10000000-0000-4000-8000-000000000009';

const validCreateCharge = {
  contractRevisionId: revisionId,
  competence: '2026-11',
  amountCents: 129000,
  dueOn: '2026-11-28',
  paidOn: null,
  receiptReference: null,
  reason: 'Lançamento manual da mensalidade de novembro.',
  idempotencyKey,
};

describe('contratos de cobranças, vencimentos e pagamentos (ID 47)', () => {
  it('expõe permissões financeiras dedicadas no catálogo de capacidades globais', () => {
    expect(contracts.platformCapabilitySchema.safeParse('READ_BILLING').success).toBe(true);
    expect(contracts.platformCapabilitySchema.safeParse('MANAGE_BILLING').success).toBe(true);
  });

  it('valida criação manual de cobrança em aberto e já recebida, bloqueando comprovante sem pagamento', () => {
    expect(contracts.commercialCreateBillingChargeSchema.safeParse(validCreateCharge).success).toBe(
      true,
    );
    expect(
      contracts.commercialCreateBillingChargeSchema.safeParse({
        ...validCreateCharge,
        paidOn: '2026-11-24',
        receiptReference: 'PIX-E2E-20261124-001',
      }).success,
    ).toBe(true);
    expect(
      contracts.commercialCreateBillingChargeSchema.safeParse({
        ...validCreateCharge,
        paidOn: '2026-11-24',
        receiptReference: null,
      }).success,
    ).toBe(true);

    // Comprovante sem data de recebimento deve ser recusado.
    expect(
      contracts.commercialCreateBillingChargeSchema.safeParse({
        ...validCreateCharge,
        paidOn: null,
        receiptReference: 'PIX-ORFAO-001',
      }).success,
    ).toBe(false);

    // Valor precisa ser inteiro positivo em centavos.
    expect(
      contracts.commercialCreateBillingChargeSchema.safeParse({
        ...validCreateCharge,
        amountCents: 0,
      }).success,
    ).toBe(false);
    expect(
      contracts.commercialCreateBillingChargeSchema.safeParse({
        ...validCreateCharge,
        amountCents: 129.5,
      }).success,
    ).toBe(false);

    // Rejeita campos externos de gateway e competência fora de YYYY-MM.
    expect(
      contracts.commercialCreateBillingChargeSchema.safeParse({
        ...validCreateCharge,
        gatewayChargeId: 'ext_123',
      }).success,
    ).toBe(false);
    expect(
      contracts.commercialCreateBillingChargeSchema.safeParse({
        ...validCreateCharge,
        competence: '2026-13',
      }).success,
    ).toBe(false);
    expect(
      contracts.commercialCreateBillingChargeSchema.safeParse({
        ...validCreateCharge,
        dueOn: '0000-11-28',
      }).success,
    ).toBe(false);
  });

  it('valida confirmação de pagamento, correção versionada e filtros de período', () => {
    expect(
      contracts.commercialConfirmBillingPaymentSchema.safeParse({
        expectedVersion: 1,
        paidOn: '2026-11-24',
        receiptReference: 'TED-4455',
        reason: 'Recebimento conferido no extrato manual.',
        idempotencyKey,
      }).success,
    ).toBe(true);

    expect(
      contracts.commercialConfirmBillingPaymentSchema.safeParse({
        expectedVersion: 0,
        paidOn: '2026-11-24',
        receiptReference: null,
        reason: 'Versão inválida.',
      }).success,
    ).toBe(false);

    expect(
      contracts.commercialCorrectBillingChargeSchema.safeParse({
        expectedVersion: 2,
        contractRevisionId: revisionId,
        competence: '2026-11',
        amountCents: 135000,
        dueOn: '2026-11-30',
        paidOn: null,
        receiptReference: null,
        reason: 'Estorno de lançamento incorreto com preservação de histórico.',
      }).success,
    ).toBe(true);

    expect(
      contracts.commercialCorrectBillingChargeSchema.safeParse({
        expectedVersion: 2,
        contractRevisionId: revisionId,
        competence: '2026-11',
        amountCents: 135000,
        dueOn: '2026-11-30',
        paidOn: null,
        receiptReference: 'PIX-SEM-DATA',
        reason: 'Comprovante não permitido sem recebimento.',
      }).success,
    ).toBe(false);

    expect(
      contracts.commercialBillingChargesQuerySchema.safeParse({
        competenceFrom: '2026-10',
        competenceTo: '2026-12',
        status: 'OVERDUE',
        page: '1',
        pageSize: '25',
      }).success,
    ).toBe(true);

    expect(
      contracts.commercialBillingChargesQuerySchema.safeParse({
        competenceFrom: '2026-12',
        competenceTo: '2026-10',
      }).success,
    ).toBe(false);
  });

  it('reconcilia totais financeiros cobrados, em aberto, vencidos e recebidos por propriedade', () => {
    const bucket = fc.integer({ min: 0, max: 20 }).chain((count) =>
      count === 0
        ? fc.constant({ count: 0, cents: 0 })
        : fc
            .array(fc.integer({ min: 1, max: 500_000 }), { minLength: count, maxLength: count })
            .map((values) => ({
              count,
              cents: values.reduce((sum, item) => sum + item, 0),
            })),
    );

    fc.assert(
      fc.property(bucket, bucket, bucket, (open, overdue, paid) => {
        const validSummary = {
          timeZone: 'America/Sao_Paulo' as const,
          referenceDate: '2026-11-24',
          billedCents: open.cents + overdue.cents + paid.cents,
          openCents: open.cents,
          overdueCents: overdue.cents,
          receivedCents: paid.cents,
          counts: {
            total: open.count + overdue.count + paid.count,
            open: open.count,
            overdue: overdue.count,
            paid: paid.count,
          },
        };
        expect(contracts.commercialBillingSummarySchema.safeParse(validSummary).success).toBe(true);
        expect(
          contracts.commercialBillingSummarySchema.safeParse({
            ...validSummary,
            billedCents: validSummary.billedCents + 1,
          }).success,
        ).toBe(false);
        expect(
          contracts.commercialBillingSummarySchema.safeParse({
            ...validSummary,
            counts: { ...validSummary.counts, total: validSummary.counts.total + 1 },
          }).success,
        ).toBe(false);
      }),
    );

    // Contagem zero com valor positivo ou contagem positiva com valor zero deve falhar.
    expect(
      contracts.commercialBillingSummarySchema.safeParse({
        timeZone: 'America/Sao_Paulo',
        referenceDate: '2026-11-24',
        billedCents: 100,
        openCents: 100,
        overdueCents: 0,
        receivedCents: 0,
        counts: { total: 0, open: 0, overdue: 0, paid: 0 },
      }).success,
    ).toBe(false);
  });

  it('valida o detalhe de cobrança com histórico imutável e vínculo ao plano versionado', () => {
    const detail = {
      id: chargeId,
      organizationId: orgId,
      organizationName: 'ReNR Demo Alpha',
      contractId,
      contractRevisionId: revisionId,
      contractRevisionOrdinal: 1,
      plan: { id: planId, name: 'Bronze' },
      planVersion: {
        id: planVersionId,
        ordinal: 1,
        effectiveOn: '2026-11-01',
        priceCents: 1290,
        pricingUnit: 'EMPLOYEE_MONTH',
        priceMode: 'FIXED',
      },
      competence: '2026-11',
      amountCents: 129000,
      dueOn: '2026-11-28',
      paidOn: '2026-11-24',
      receiptReference: 'PIX-E2E-001',
      status: 'PAID',
      version: 2,
      revisionCount: 2,
      createdAt: '2026-11-20T12:00:00.000Z',
      updatedAt: '2026-11-24T15:00:00.000Z',
      revisions: [
        {
          id: chargeRevisionId,
          ordinal: 1,
          kind: 'CREATED',
          contractRevisionId: revisionId,
          contractRevisionOrdinal: 1,
          plan: { id: planId, name: 'Bronze' },
          planVersion: {
            id: planVersionId,
            ordinal: 1,
            effectiveOn: '2026-11-01',
            priceCents: 1290,
            pricingUnit: 'EMPLOYEE_MONTH',
            priceMode: 'FIXED',
          },
          competence: '2026-11',
          amountCents: 129000,
          dueOn: '2026-11-28',
          paidOn: null,
          receiptReference: null,
          reason: 'Registro inicial da cobrança.',
          actor: { id: actorId, name: 'Operador Financeiro' },
          createdAt: '2026-11-20T12:00:00.000Z',
        },
      ],
    };
    expect(contracts.commercialBillingChargeDetailSchema.safeParse(detail).success).toBe(true);
  });
});
