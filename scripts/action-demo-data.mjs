/* global structuredClone */
import { createHash } from 'node:crypto';

function fixtureId(value) {
  const hex = createHash('sha256').update(value).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
const contentKeys = [
  'factor',
  'description',
  'exposureDescription',
  'exposedGroupDescription',
  'possibleHarms',
  'existingControls',
  'sourceKind',
  'sourceNote',
  'diagnosticCycleId',
];

/** Entirely synthetic examples. This is not an assertion of executed preventive measures. */
export function buildDemoActions({
  risk,
  userId,
  referenceDate = '2026-10-21',
  timeZone = 'America/Sao_Paulo',
}) {
  if (risk.status !== 'REGISTERED') return [];
  const contextSnapshot = structuredClone({
    ...Object.fromEntries(contentKeys.map((key) => [key, risk[key]])),
    sectorId: risk.sectorId,
    assessmentGroupId: risk.assessmentGroupId,
    sector: risk.sector,
    unit: risk.unit,
    status: 'REGISTERED',
  });
  const author = { id: userId, name: 'Administrador demonstração' };
  return ['PLANNED', 'IN_PROGRESS', 'IMPLEMENTED', 'CANCELLED'].map((status, index) => {
    const id = fixtureId(`${risk.organizationId}:action-v04:${index}`);
    const content = {
      title: [
        'Organizar demandas — fictício',
        'Revisar rotina — fictício',
        'Execução informada — fictício',
        'Medida cancelada — fictício',
      ][index],
      description: 'Medida inteiramente fictícia para demonstrar planejamento e acompanhamento.',
      responsibleName: 'Responsável fictício da demonstração',
      dueDate: index === 1 ? '2026-12-01' : '2026-10-18',
      expectedResult: 'Resultado esperado fictício; não representa eficácia comprovada.',
      verificationCriterion: 'Aferição futura descrita somente como exemplo de preenchimento.',
    };
    const statuses =
      status === 'IMPLEMENTED'
        ? ['PLANNED', 'IN_PROGRESS', status]
        : status === 'PLANNED'
          ? [status]
          : ['PLANNED', status];
    const revisions = statuses.map((step, revisionIndex) => {
      const version = revisionIndex + 1;
      const createdAt = `2026-10-21T12:${String(index * 5 + revisionIndex).padStart(2, '0')}:00.000Z`;
      const snapshot = {
        ...content,
        status: step,
        implementationNote:
          step === 'IMPLEMENTED'
            ? 'Relato de execução inteiramente fictício, sem comprovação técnica de eficácia.'
            : null,
        implementedAt: step === 'IMPLEMENTED' ? createdAt : null,
      };
      return {
        id: fixtureId(`${id}:revision:${version}`),
        organizationId: risk.organizationId,
        actionId: id,
        version,
        event: version === 1 ? 'CREATED' : step === 'IN_PROGRESS' ? 'STARTED' : step,
        snapshot,
        changeReason: version === 1 ? null : 'Transição demonstrativa inteiramente fictícia.',
        text: null,
        evidenceId: null,
        author,
        createdAt,
      };
    });
    const current = revisions.at(-1);
    return {
      action: {
        ...current.snapshot,
        id,
        organizationId: risk.organizationId,
        riskId: risk.id,
        version: current.version,
        sourceRiskVersion: risk.version,
        evaluationId: risk.latestEvaluation?.id ?? null,
        contextSnapshot: structuredClone(contextSnapshot),
        currentOrigin: {
          riskStatus: risk.status,
          organizationActive: true,
          unitActive: risk.unit.isActive,
          sectorActive: risk.sector.isActive,
        },
        createdBy: author,
        updatedBy: author,
        createdAt: revisions[0].createdAt,
        updatedAt: current.createdAt,
        isOverdue: ['PLANNED', 'IN_PROGRESS'].includes(status) && referenceDate > content.dueDate,
        referenceDate,
        timeZone,
      },
      revisions,
    };
  });
}

/** Caller has already passed the local-development-only seed gate. Existing records are never overwritten. */
export async function provisionDemoActions(tx, { organizationId, sectorId, userId }) {
  const sector = await tx.sector.findFirstOrThrow({
    where: { id: sectorId, organizationId },
    include: { unit: true },
  });
  const risk = await tx.risk.findFirst({
    where: {
      organizationId,
      status: 'REGISTERED',
      factor: 'Sobrecarga de tarefas — fictício',
      createdById: userId,
      assessmentGroup: { sectorId },
    },
    include: { evaluations: { orderBy: { sequence: 'desc' }, take: 1 } },
  });
  if (!risk || !sector.isActive || !sector.unit.isActive) return;
  const fixtures = buildDemoActions({
    risk: {
      ...risk,
      sectorId,
      latestEvaluation: risk.evaluations[0] ?? null,
      sector: { id: sector.id, name: sector.name, isActive: sector.isActive },
      unit: { id: sector.unit.id, name: sector.unit.name, isActive: sector.unit.isActive },
    },
    userId,
  });
  for (const { action, revisions } of fixtures) {
    const existing = await tx.action.findUnique({
      where: { id: action.id },
      select: { organizationId: true, riskId: true },
    });
    if (existing) {
      if (existing.organizationId !== organizationId || existing.riskId !== risk.id)
        throw new Error('Synthetic action identity conflict');
      continue;
    }
    const data = { ...action };
    for (const key of [
      'currentOrigin',
      'isOverdue',
      'referenceDate',
      'timeZone',
      'createdBy',
      'updatedBy',
    ])
      delete data[key];
    await tx.action.create({
      // Keep the synthetic seed usable before additive assignment migrations.
      select: { id: true },
      data: {
        ...data,
        dueDate: new Date(`${data.dueDate}T00:00:00.000Z`),
        createdById: action.createdBy.id,
        updatedById: action.updatedBy.id,
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt),
        implementedAt: data.implementedAt ? new Date(data.implementedAt) : null,
      },
    });
    for (const revision of revisions) {
      const { author, createdAt, ...revisionData } = revision;
      await tx.actionRevision.create({
        select: { id: true },
        data: { ...revisionData, authorId: author.id, createdAt: new Date(createdAt) },
      });
    }
  }
}
