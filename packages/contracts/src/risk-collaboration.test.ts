import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  capabilitySchema,
  canAuthorRiskContribution,
  canViewRiskContribution,
  canViewRiskContributionAttachment,
  canViewRiskContributionRevision,
  createRiskContributionSchema,
  riskContributionListSchema,
  riskContributionSpecialtySchema,
  riskContributionVisibilitySchema,
  shareRiskContributionSchema,
  updateRiskContributionSchema,
  type Capability,
  type RiskContributionSpecialty,
  type RiskContributionVisibility,
} from './index';

describe('ID56 risk technical collaboration contracts and visibility matrix', () => {
  it('inclui PSYCHOLOGY_COLLABORATION em capabilitySchema sem alterar capacidades SST existentes', () => {
    expect(capabilitySchema.parse('PSYCHOLOGY_COLLABORATION')).toBe('PSYCHOLOGY_COLLABORATION');
    expect(capabilitySchema.parse('TECHNICAL_DECISIONS')).toBe('TECHNICAL_DECISIONS');
  });

  it('valida estritamente a matriz de visibilidade RESTRICTED vs SHARED em todos os perfis (property-based)', () => {
    const capArb = fc.uniqueArray(fc.constantFrom<Capability>(...capabilitySchema.options));
    const roleArb = fc.constantFrom<'ADMIN' | 'READER'>('ADMIN', 'READER');
    const specialtyArb = fc.constantFrom<RiskContributionSpecialty>(
      ...riskContributionSpecialtySchema.options,
    );
    const visibilityArb = fc.constantFrom<RiskContributionVisibility>(
      ...riskContributionVisibilitySchema.options,
    );

    fc.assert(
      fc.property(
        roleArb,
        capArb,
        fc.boolean(),
        fc.boolean(),
        specialtyArb,
        visibilityArb,
        (role, capabilities, isActive, inScope, specialty, visibility) => {
          const actor = { role, capabilities, isActive, inScope };
          const canView = canViewRiskContribution(actor, { specialty, visibility });
          const requiredCap: Capability =
            specialty === 'SST' ? 'TECHNICAL_DECISIONS' : 'PSYCHOLOGY_COLLABORATION';

          if (!isActive || !inScope) {
            expect(canView).toBe(false);
            return;
          }
          if (visibility === 'RESTRICTED') {
            // Reservado só é visível para vínculo ativo com a capability da PRÓPRIA especialidade
            expect(canView).toBe(capabilities.includes(requiredCap));
          } else {
            // Compartilhado é visível para perfis autorizados da mesma empresa no recorte
            expect(canView).toBe(true);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('nunca permite SST ver registro RESTRICTED de Psicologia nem Psicologia ver RESTRICTED de SST', () => {
    const sstActor = {
      role: 'READER' as const,
      capabilities: ['TECHNICAL_DECISIONS'] as Capability[],
      isActive: true,
      inScope: true,
    };
    const psychActor = {
      role: 'READER' as const,
      capabilities: ['PSYCHOLOGY_COLLABORATION'] as Capability[],
      isActive: true,
      inScope: true,
    };
    const pureAdmin = {
      role: 'ADMIN' as const,
      capabilities: [] as Capability[],
      isActive: true,
      inScope: true,
    };

    expect(
      canViewRiskContribution(sstActor, {
        specialty: 'PSYCHOLOGY_ORGANIZATIONAL',
        visibility: 'RESTRICTED',
      }),
    ).toBe(false);
    expect(
      canViewRiskContribution(psychActor, { specialty: 'SST', visibility: 'RESTRICTED' }),
    ).toBe(false);
    expect(
      canViewRiskContribution(pureAdmin, {
        specialty: 'PSYCHOLOGY_ORGANIZATIONAL',
        visibility: 'RESTRICTED',
      }),
    ).toBe(false);
    expect(canViewRiskContribution(pureAdmin, { specialty: 'SST', visibility: 'RESTRICTED' })).toBe(
      false,
    );

    expect(
      canViewRiskContribution(sstActor, {
        specialty: 'PSYCHOLOGY_ORGANIZATIONAL',
        visibility: 'SHARED',
      }),
    ).toBe(true);
    expect(canViewRiskContribution(psychActor, { specialty: 'SST', visibility: 'SHARED' })).toBe(
      true,
    );
  });

  it('oculta revisões e anexos RESTRICTED anteriores ao compartilhamento para outra especialidade', () => {
    const sstActor = {
      role: 'READER' as const,
      capabilities: ['TECHNICAL_DECISIONS'] as Capability[],
      isActive: true,
      inScope: true,
    };
    const psychActor = {
      role: 'READER' as const,
      capabilities: ['PSYCHOLOGY_COLLABORATION'] as Capability[],
      isActive: true,
      inScope: true,
    };

    const sharedPsychContribution = {
      specialty: 'PSYCHOLOGY_ORGANIZATIONAL' as const,
      visibility: 'SHARED' as const,
    };

    expect(canViewRiskContributionRevision(sstActor, sharedPsychContribution, 'RESTRICTED')).toBe(
      false,
    );
    expect(canViewRiskContributionRevision(sstActor, sharedPsychContribution, 'SHARED')).toBe(true);
    expect(canViewRiskContributionRevision(psychActor, sharedPsychContribution, 'RESTRICTED')).toBe(
      true,
    );

    expect(canViewRiskContributionAttachment(sstActor, sharedPsychContribution, 'RESTRICTED')).toBe(
      false,
    );
    expect(canViewRiskContributionAttachment(sstActor, sharedPsychContribution, 'SHARED')).toBe(
      true,
    );
    expect(
      canViewRiskContributionAttachment(psychActor, sharedPsychContribution, 'RESTRICTED'),
    ).toBe(true);
  });

  it('garante que PSYCHOLOGY_COLLABORATION só escreve na própria especialidade e nunca em SST', () => {
    const psychActor = {
      role: 'READER' as const,
      capabilities: ['PSYCHOLOGY_COLLABORATION'] as Capability[],
      isActive: true,
      inScope: true,
    };
    const sstActor = {
      role: 'READER' as const,
      capabilities: ['TECHNICAL_DECISIONS'] as Capability[],
      isActive: true,
      inScope: true,
    };
    const pureAdmin = {
      role: 'ADMIN' as const,
      capabilities: [] as Capability[],
      isActive: true,
      inScope: true,
    };

    expect(canAuthorRiskContribution(psychActor, 'PSYCHOLOGY_ORGANIZATIONAL')).toBe(true);
    expect(canAuthorRiskContribution(psychActor, 'SST')).toBe(false);
    expect(canAuthorRiskContribution(sstActor, 'SST')).toBe(true);
    expect(canAuthorRiskContribution(sstActor, 'PSYCHOLOGY_ORGANIZATIONAL')).toBe(false);
    expect(canAuthorRiskContribution(pureAdmin, 'SST')).toBe(false);
    expect(canAuthorRiskContribution(pureAdmin, 'PSYCHOLOGY_ORGANIZATIONAL')).toBe(false);
  });

  it('rejeita campos extras (strict) e exige conteúdo mínimo de fatores de trabalho e recomendações', () => {
    expect(
      createRiskContributionSchema.safeParse({
        specialty: 'PSYCHOLOGY_ORGANIZATIONAL',
        kind: 'PSYCHOSOCIAL_ANALYSIS',
        visibility: 'RESTRICTED',
        title: 'Análise de sobrecarga em atendimento',
        workFactors: 'Ritmo acelerado e metas cumulativas sem pausas previsíveis no turno.',
        preventiveRecommendations:
          'Revisar distribuição de demandas coletivas e formalizar pausas de recuperação.',
        nextStep: 'Alinhar recomendações preventivas com SST na próxima revisão do setor.',
        expectedRiskVersion: 1,
      }).success,
    ).toBe(true);

    expect(
      createRiskContributionSchema.safeParse({
        specialty: 'PSYCHOLOGY_ORGANIZATIONAL',
        kind: 'PSYCHOSOCIAL_ANALYSIS',
        visibility: 'RESTRICTED',
        title: 'Análise válida',
        workFactors: 'Descrição coletiva suficiente do fator de trabalho.',
        preventiveRecommendations: 'Recomendação preventiva coletiva suficiente.',
        expectedRiskVersion: 1,
        clinicalDiagnosis: 'proibido',
      }).success,
    ).toBe(false);

    expect(
      updateRiskContributionSchema.safeParse({
        expectedVersion: 1,
        title: 'Título revisado',
        changeReason: 'Ajuste de síntese coletiva antes do compartilhamento.',
      }).success,
    ).toBe(true);

    expect(
      shareRiskContributionSchema.safeParse({
        expectedVersion: 1,
        reason: 'Síntese revisada sem dados individuais pronta para equipe técnica.',
        shareAttachments: true,
      }).success,
    ).toBe(true);

    expect(
      riskContributionListSchema.safeParse({
        writesEnabled: false,
        viewerSpecialties: ['PSYCHOLOGY_ORGANIZATIONAL'],
        items: [],
        total: 0,
        page: 1,
        pageSize: 50,
      }).success,
    ).toBe(true);
  });
});
