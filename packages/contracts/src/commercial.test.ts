import { describe, expect, it } from 'vitest';
import * as contracts from './index';

const plan = {
  name: 'Bronze fictício',
  kind: 'PLAN',
  version: {
    effectiveOn: '2026-11-23',
    priceCents: 1290,
    pricingUnit: 'EMPLOYEE_MONTH',
    priceMode: 'FIXED',
    conditions: 'Cobrança mensal por colaborador',
    limits: 'Resumo executivo de até dez páginas',
    includedFeatures: ['Painel por departamento'],
    plannedFeatures: ['Capacitação adicional'],
  },
  reason: 'Cadastro inicial da oferta.',
};

describe('contratos comerciais manuais', () => {
  it('reconhece concessões comerciais explícitas no catálogo de ações globais', () => {
    expect(contracts.platformCapabilitySchema.safeParse('READ_COMMERCIAL').success).toBe(true);
    expect(contracts.platformCapabilitySchema.safeParse('MANAGE_COMMERCIAL').success).toBe(true);
  });

  it('registra moeda em centavos e recursos entregues separados da previsão', () => {
    expect(contracts.commercialCreatePlanSchema.safeParse(plan).success).toBe(true);
    expect(
      contracts.commercialCreatePlanSchema.safeParse({
        ...plan,
        version: { ...plan.version, priceCents: 12.9 },
      }).success,
    ).toBe(false);
    expect(
      contracts.commercialCreatePlanSchema.safeParse({
        ...plan,
        version: { ...plan.version, pricingUnit: 'SERVICE' },
      }).success,
    ).toBe(false);
  });

  it('valida o período civil e rejeita campos de pagamento ou assinatura externos', () => {
    const contract = {
      planVersionId: '10000000-0000-4000-8000-000000000001',
      startsOn: '2026-11-23',
      endsOn: '2026-12-22',
      reason: 'Registro do documento assinado.',
      terms: 'Termo fictício.',
    };
    expect(contracts.commercialCreateContractSchema.safeParse(contract).success).toBe(true);
    expect(
      contracts.commercialCreateContractSchema.safeParse({ ...contract, endsOn: '2026-11-22' })
        .success,
    ).toBe(false);
    expect(
      contracts.commercialCreateContractSchema.safeParse({
        ...contract,
        externalPayment: 'gateway',
      }).success,
    ).toBe(false);
    expect(
      contracts.commercialReviseContractSchema.safeParse({
        ...contract,
        kind: 'RENEWAL',
        expectedVersion: 1,
        endsOn: '2026-11-22',
      }).success,
    ).toBe(false);
  });

  it('rejeita ano zero em vigências de plano e cadastro de adesão', () => {
    expect(
      contracts.commercialCreatePlanSchema.safeParse({
        ...plan,
        version: { ...plan.version, effectiveOn: '0000-11-23' },
      }).success,
    ).toBe(false);
    expect(
      contracts.commercialUpdateClientSchema.safeParse({
        expectedVersion: 0,
        contactName: 'Pessoa de teste',
        contactEmail: null,
        adoptedOn: '0000-11-23',
        reason: 'Registro da empresa fictícia.',
      }).success,
    ).toBe(false);
  });
});
