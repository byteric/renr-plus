import { createHash } from 'node:crypto';

function fixtureId(value) {
  const hex = createHash('sha256').update(value).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Pure deterministic fictitious records; contains no interviews or individual diagnostic answers. */
export function buildDemoRisks({ organizationId, assessmentGroupId, userId, sector, unit }) {
  const author = { id: userId, name: 'Administrador demonstração' };
  const timestamp = '2026-10-17T12:00:00.000Z';
  return ['DRAFT', 'REGISTERED', 'REGISTERED', 'ARCHIVED'].map((status, index) => {
    const id = fixtureId(`${organizationId}:risk-v03:${index}`);
    const content = {
      factor: [
        'Organização das demandas — fictício',
        'Sobrecarga de tarefas — fictício',
        'Comunicação da equipe — fictício',
        'Registro arquivado — fictício',
      ][index],
      description:
        index === 0 ? null : 'Contexto inteiramente fictício para demonstração do inventário.',
      exposureDescription:
        index === 0 ? null : 'Exposição descrita apenas como exemplo de preenchimento.',
      exposedGroupDescription: index === 0 ? null : 'Equipe fictícia da demonstração',
      possibleHarms:
        index === 0 ? null : 'Possíveis agravos não validados nesta etapa demonstrativa.',
      existingControls:
        index === 0 ? null : 'Pausas e organização de demandas descritas como exemplo.',
      sourceKind: index === 0 ? null : 'TECHNICAL_RECORD',
      sourceNote:
        index === 0 ? null : 'Registro técnico sintético; não representa avaliação normativa.',
      diagnosticCycleId: null,
    };
    const evaluation =
      index === 1
        ? {
            id: fixtureId(`${id}:evaluation:1`),
            organizationId,
            riskId: id,
            sequence: 1,
            riskVersion: 1,
            contextSnapshot: {
              ...content,
              sectorId: sector.id,
              assessmentGroupId,
              unit,
              sector,
              status: 'REGISTERED',
            },
            label: 'PRELIMINARY',
            methodReference: 'Registro demonstrativo de contexto',
            methodVersion: 'demo-1',
            observation: 'Observação preliminar fictícia, sem score ou classificação normativa.',
            rationale: 'Demonstrar a preservação do contexto e do histórico do registro.',
            author,
            createdAt: timestamp,
          }
        : null;
    return {
      ...content,
      id,
      organizationId,
      assessmentGroupId,
      sectorId: sector.id,
      sector,
      unit,
      status,
      version: evaluation ? 2 : 1,
      createdBy: author,
      updatedBy: author,
      createdAt: timestamp,
      updatedAt: timestamp,
      latestEvaluation: evaluation,
    };
  });
}

/** Caller must already have passed the existing local-only seed URL gate. Existing rows are preserved. */
export async function provisionDemoRisks(tx, { organizationId, sectorId, userId }) {
  const sector = await tx.sector.findFirstOrThrow({
    where: { id: sectorId, organizationId },
    include: { unit: true },
  });
  const group = await tx.assessmentGroup.upsert({
    where: { organizationId_sectorId: { organizationId, sectorId } },
    create: { organizationId, sectorId },
    update: {},
  });
  const fixtures = buildDemoRisks({
    organizationId,
    assessmentGroupId: group.id,
    userId,
    sector: { id: sector.id, name: sector.name, isActive: sector.isActive },
    unit: { id: sector.unit.id, name: sector.unit.name, isActive: sector.unit.isActive },
  });
  for (const fixture of fixtures) {
    const { createdBy, updatedBy, latestEvaluation, ...risk } = fixture;
    delete risk.sectorId;
    delete risk.sector;
    delete risk.unit;
    const existing = await tx.risk.findUnique({ where: { id: risk.id }, select: { id: true } });
    if (existing) continue;
    await tx.risk.create({
      data: {
        ...risk,
        createdById: createdBy.id,
        updatedById: updatedBy.id,
        createdAt: new Date(risk.createdAt),
        updatedAt: new Date(risk.updatedAt),
      },
    });
    if (latestEvaluation) {
      const { author, createdAt, ...evaluation } = latestEvaluation;
      await tx.riskEvaluation.create({
        data: { ...evaluation, authorId: author.id, createdAt: new Date(createdAt) },
      });
    }
  }
}
