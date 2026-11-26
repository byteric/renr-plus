import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as contracts from './index';

const orgId = '20000000-0000-4000-8000-000000000001';
const contractId = '20000000-0000-4000-8000-000000000002';
const transitionId = '20000000-0000-4000-8000-000000000003';
const actorId = '20000000-0000-4000-8000-000000000004';
const idempotencyKey = '20000000-0000-4000-8000-000000000005';

const validTransitionPayload = {
  expectedVersion: 0,
  kind: 'SUSPENSION',
  effectiveOn: '2026-11-24',
  reason: 'Suspensão manual do contrato de demonstração solicitada pelo cliente.',
  nextStep: 'Regularize a solicitação comercial com o gestor da conta para solicitar reativação.',
  confirmed: true,
  idempotencyKey,
};

describe('contratos de ativação, suspensão e reativação por contrato (ID 48)', () => {
  it('expõe permissões dedicadas de acesso contratual separadas do catálogo e cobranças', () => {
    expect(contracts.platformCapabilitySchema.safeParse('READ_CONTRACT_ACCESS').success).toBe(true);
    expect(contracts.platformCapabilitySchema.safeParse('MANAGE_CONTRACT_ACCESS').success).toBe(
      true,
    );
  });

  it('valida payload de transição manual com confirmação explícita e recusa automação ou campos extras', () => {
    expect(
      contracts.commercialRecordContractAccessTransitionSchema.safeParse(validTransitionPayload)
        .success,
    ).toBe(true);

    // Exige confirmação explícita do operador.
    expect(
      contracts.commercialRecordContractAccessTransitionSchema.safeParse({
        ...validTransitionPayload,
        confirmed: false,
      }).success,
    ).toBe(false);

    // Recusa motivo ou próximo passo vazios/curtos.
    expect(
      contracts.commercialRecordContractAccessTransitionSchema.safeParse({
        ...validTransitionPayload,
        reason: 'ok',
      }).success,
    ).toBe(false);
    expect(
      contracts.commercialRecordContractAccessTransitionSchema.safeParse({
        ...validTransitionPayload,
        nextStep: '  ',
      }).success,
    ).toBe(false);

    // Recusa versão negativa ou campos de bloqueio automático por inadimplência.
    expect(
      contracts.commercialRecordContractAccessTransitionSchema.safeParse({
        ...validTransitionPayload,
        expectedVersion: -1,
      }).success,
    ).toBe(false);
    expect(
      contracts.commercialRecordContractAccessTransitionSchema.safeParse({
        ...validTransitionPayload,
        autoSuspendOnOverdue: true,
      }).success,
    ).toBe(false);
  });

  it('modela empresas suspensas na sessão com motivo e próximo passo opcionais por perfil autorizado', () => {
    const baseSession = {
      user: { id: actorId, name: 'Gestora Teste', email: 'gestora@empresa.test' },
      memberships: [
        { organizationId: orgId, organizationName: 'Empresa Ativa LTDA', role: 'ADMIN' as const },
      ],
      activeOrganizationId: orgId,
      expiresAt: '2026-11-25T00:00:00.000Z',
    };

    expect(contracts.sessionResponseSchema.safeParse(baseSession).success).toBe(true);
    const parsedWithSuspended = contracts.sessionResponseSchema.safeParse({
      ...baseSession,
      suspendedOrganizations: [
        {
          organizationId: '20000000-0000-4000-8000-000000000010',
          organizationName: 'Empresa Suspensa S/A',
          role: 'ADMIN',
          reason: 'Suspensão contratual preventiva.',
          nextStep: 'Contate o responsável comercial da ReTech+.',
        },
        {
          organizationId: '20000000-0000-4000-8000-000000000011',
          organizationName: 'Outra Suspensa LTDA',
          role: 'READER',
          reason: null,
          nextStep: null,
        },
      ],
    });
    expect(parsedWithSuspended.success).toBe(true);
    if (parsedWithSuspended.success) {
      expect(parsedWithSuspended.data.suspendedOrganizations).toHaveLength(2);
      expect(parsedWithSuspended.data.suspendedOrganizations?.[0]?.reason).toBe(
        'Suspensão contratual preventiva.',
      );
      expect(parsedWithSuspended.data.suspendedOrganizations?.[1]?.reason).toBeNull();
    }

    expect(
      contracts.sessionResponseSchema.safeParse({
        ...baseSession,
        suspendedOrganizations: [
          {
            organizationId: '20000000-0000-4000-8000-000000000010',
            organizationName: 'Empresa Suspensa S/A',
            role: 'ADMIN',
            reason: 'x',
            nextStep: null,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('valida invariantes da máquina de estados de acesso contratual por propriedade', () => {
    const statuses = ['UNRECORDED', 'ACTIVE', 'SUSPENDED'] as const;
    const kinds = ['ACTIVATION', 'SUSPENSION', 'REACTIVATION'] as const;
    const situations = ['SCHEDULED', 'ACTIVE', 'EXPIRED', 'CANCELLED'] as const;

    fc.assert(
      fc.property(
        fc.constantFrom(...statuses),
        fc.constantFrom(...kinds),
        fc.constantFrom(...situations),
        (fromStatus, kind, situation) => {
          const allowed = contracts.isContractAccessTransitionAllowed(fromStatus, kind, situation);
          const ruleSpec = contracts.contractAccessTransitionRules[kind];

          if (kind === 'ACTIVATION') {
            expect(allowed).toBe(fromStatus === 'UNRECORDED' && situation !== 'CANCELLED');
            expect(ruleSpec.toStatus).toBe('ACTIVE');
            expect(ruleSpec.rule).toBe('MANUAL_CONTRACT_ACTIVATION');
          } else if (kind === 'SUSPENSION') {
            expect(allowed).toBe(fromStatus === 'UNRECORDED' || fromStatus === 'ACTIVE');
            expect(ruleSpec.toStatus).toBe('SUSPENDED');
            expect(ruleSpec.rule).toBe('MANUAL_CONTRACT_SUSPENSION');
          } else {
            expect(allowed).toBe(fromStatus === 'SUSPENDED' && situation !== 'CANCELLED');
            expect(ruleSpec.toStatus).toBe('ACTIVE');
            expect(ruleSpec.rule).toBe('MANUAL_CONTRACT_REACTIVATION');
          }
        },
      ),
    );
  });

  it('reconcilia contagem de resumo e consistência entre estado atual e histórico de transições', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 0, max: 50 }),
        (unrecorded, active, suspended) => {
          const summary = {
            timeZone: 'America/Sao_Paulo' as const,
            referenceDate: '2026-11-24',
            counts: {
              total: unrecorded + active + suspended,
              unrecorded,
              active,
              suspended,
            },
          };
          expect(contracts.commercialContractAccessSummarySchema.safeParse(summary).success).toBe(
            true,
          );
          expect(
            contracts.commercialContractAccessSummarySchema.safeParse({
              ...summary,
              counts: { ...summary.counts, total: summary.counts.total + 1 },
            }).success,
          ).toBe(false);
        },
      ),
    );

    const validDetail = {
      organizationId: orgId,
      organizationName: 'Empresa Suspensa S/A',
      isActive: true,
      clientClassification: 'CLIENT',
      fiscalState: 'VALID',
      contract: { id: contractId, situation: 'ACTIVE' },
      access: {
        status: 'SUSPENDED',
        version: 1,
        lastTransitionKind: 'SUSPENSION',
        lastRule: 'MANUAL_CONTRACT_SUSPENSION',
        lastOrigin: 'MANUAL_OPERATION',
        lastEffectiveOn: '2026-11-24',
        lastReason: validTransitionPayload.reason,
        lastNextStep: validTransitionPayload.nextStep,
        lastActor: { id: actorId, name: 'Operador Comercial' },
        updatedAt: '2026-11-24T15:00:00.000Z',
      },
      transitions: [
        {
          id: transitionId,
          ordinal: 1,
          kind: 'SUSPENSION',
          fromStatus: 'UNRECORDED',
          toStatus: 'SUSPENDED',
          rule: 'MANUAL_CONTRACT_SUSPENSION',
          origin: 'MANUAL_OPERATION',
          effectiveOn: '2026-11-24',
          reason: validTransitionPayload.reason,
          nextStep: validTransitionPayload.nextStep,
          actor: { id: actorId, name: 'Operador Comercial' },
          createdAt: '2026-11-24T15:00:00.000Z',
        },
      ],
    };

    expect(contracts.commercialContractAccessDetailSchema.safeParse(validDetail).success).toBe(
      true,
    );

    // Divergência entre estado atual e última transição deve ser recusada.
    expect(
      contracts.commercialContractAccessDetailSchema.safeParse({
        ...validDetail,
        access: { ...validDetail.access, status: 'ACTIVE' },
      }).success,
    ).toBe(false);

    // Divergência entre versão e quantidade de transições deve ser recusada.
    expect(
      contracts.commercialContractAccessDetailSchema.safeParse({
        ...validDetail,
        access: { ...validDetail.access, version: 2 },
      }).success,
    ).toBe(false);
  });
});
