import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import {
  preliminaryEvaluationSchema,
  riskDetailSchema,
  type RiskDetail,
  type PreliminaryEvaluation,
} from '@renr/contracts';

export const riskInclude = {
  assessmentGroup: { include: { sector: { include: { unit: true, organization: true } } } },
  createdBy: { select: { id: true, name: true } },
  updatedBy: { select: { id: true, name: true } },
  evaluations: {
    orderBy: { sequence: 'desc' },
    take: 1,
    include: { author: { select: { id: true, name: true } } },
  },
} satisfies Prisma.RiskInclude;
export type RiskRecord = Prisma.RiskGetPayload<{ include: typeof riskInclude }>;
type EvaluationRecord = Prisma.RiskEvaluationGetPayload<{
  include: { author: { select: { id: true; name: true } } };
}>;
export type RiskScope = { userId: string; organizationId: string };

export function toEvaluation(record: EvaluationRecord): PreliminaryEvaluation {
  return preliminaryEvaluationSchema.parse({
    id: record.id,
    organizationId: record.organizationId,
    riskId: record.riskId,
    sequence: record.sequence,
    riskVersion: record.riskVersion,
    contextSnapshot: record.contextSnapshot,
    label: record.label,
    methodReference: record.methodReference,
    methodVersion: record.methodVersion,
    observation: record.observation,
    rationale: record.rationale,
    author: record.author,
    createdAt: record.createdAt.toISOString(),
  });
}
export function toRisk(record: RiskRecord): RiskDetail {
  const sector = record.assessmentGroup.sector;
  return riskDetailSchema.parse({
    id: record.id,
    organizationId: record.organizationId,
    assessmentGroupId: record.assessmentGroupId,
    sectorId: sector.id,
    sector: { id: sector.id, name: sector.name, isActive: sector.isActive },
    unit: { id: sector.unit.id, name: sector.unit.name, isActive: sector.unit.isActive },
    factor: record.factor,
    description: record.description,
    exposureDescription: record.exposureDescription,
    exposedGroupDescription: record.exposedGroupDescription,
    possibleHarms: record.possibleHarms,
    existingControls: record.existingControls,
    sourceKind: record.sourceKind,
    sourceNote: record.sourceNote,
    diagnosticCycleId: record.diagnosticCycleId,
    status: record.status,
    version: record.version,
    createdBy: record.createdBy,
    updatedBy: record.updatedBy,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    latestEvaluation: record.evaluations[0] ? toEvaluation(record.evaluations[0]) : null,
  });
}

@Injectable()
export class RisksRepository {
  constructor(private readonly database: PrismaService) {}
  transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.database.client.$transaction(operation);
  }
  snapshot<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.database.client.$transaction(operation, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }
  async get(tx: Prisma.TransactionClient, organizationId: string, id: string): Promise<RiskRecord> {
    const risk = await tx.risk.findFirst({ where: { id, organizationId }, include: riskInclude });
    if (!risk) throw new NotFoundException();
    return risk;
  }
  async lock(tx: Prisma.TransactionClient, organizationId: string, id: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM risks WHERE organization_id = ${organizationId}::uuid AND id = ${id}::uuid FOR UPDATE`;
  }
  audit(tx: Prisma.TransactionClient, scope: RiskScope, resourceId: string, action: string) {
    return tx.auditEvent.create({
      data: { actorId: scope.userId, organizationId: scope.organizationId, resourceId, action },
    });
  }
}
