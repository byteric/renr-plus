import { Injectable, NotFoundException } from '@nestjs/common';
import {
  auditEventListSchema,
  auditEventSchema,
  auditRecordSchema,
  type AuditEvent,
  type AuditEventList,
  type AuditListQuery,
  type AuditHistoryQuery,
  type AuditRecord,
  type AuditTarget,
  type AuditTargetKind,
} from '@renr/contracts';
import { Prisma, type AuditEvent as StoredAuditEvent } from '../../generated/prisma/client';
import {
  AuditRepository,
  datePredicate,
  domainRecords,
  type AuditScope,
  type HistoryRow,
} from './audit.repository';

const labels: Record<string, string> = {
  RISK_CREATE: 'Risco criado',
  RISK_UPDATE: 'Risco atualizado',
  RISK_ARCHIVE: 'Risco arquivado',
  RISK_PRELIMINARY_EVALUATION_CREATE: 'Avaliação preliminar registrada',
  'risk.technical_evaluation_created': 'Avaliação técnica registrada',
  'risk.reassessment_created': 'Reavaliação registrada',
  ACTION_CREATED: 'Ação criada',
  ACTION_CREATE: 'Ação criada',
  ACTION_UPDATED: 'Ação atualizada',
  ACTION_STATUS_CHANGED: 'Situação da ação alterada',
  ACTION_STARTED: 'Execução da ação iniciada',
  ACTION_IMPLEMENTED: 'Implementação da ação registrada',
  ACTION_CANCELLED: 'Ação cancelada',
  ACTION_NOTE: 'Nota registrada',
  ACTION_EVIDENCE_ARCHIVED: 'Evidência arquivada',
  ACTION_NOTE_ADDED: 'Nota registrada',
  ACTION_EVIDENCE_ADDED: 'Evidência anexada',
  ACTION_EVIDENCE_REMOVED: 'Evidência removida',
  ACTION_EFFICACY_RECORDED: 'Parecer de eficácia registrado',
  'action.technical_closure_created': 'Encerramento técnico registrado',
  'action.corrective_created': 'Ação corretiva criada',
  INSTRUMENT_PUBLISH: 'Instrumento publicado',
  INSTRUMENT_VERSION: 'Versão de instrumento',
  INSTRUMENT_CREATE: 'Instrumento criado',
  INSTRUMENT_DRAFT_UPDATE: 'Rascunho de instrumento atualizado',
  INSTRUMENT_FORK: 'Nova versão de instrumento criada',
  ORGANIZATION_CREATE: 'Organização criada',
  ORGANIZATION_UPDATE: 'Organização atualizada',
  UNIT_CREATE: 'Unidade criada',
  UNIT_UPDATE: 'Unidade atualizada',
  SECTOR_CREATE: 'Setor criado',
  SECTOR_UPDATE: 'Setor atualizado',
  EMPLOYEE_CREATE: 'Colaborador cadastrado',
  EMPLOYEE_UPDATE: 'Cadastro de colaborador atualizado',
  ASSESSMENT_GROUP_CREATE: 'Grupo de avaliação criado',
  ASSESSMENT_GROUP_UPDATE: 'Grupo de avaliação atualizado',
  DIAGNOSTIC_CYCLE_CREATE: 'Ciclo diagnóstico criado',
  DIAGNOSTIC_CYCLE_OPEN: 'Ciclo diagnóstico aberto',
  DIAGNOSTIC_CYCLE_CLOSED: 'Ciclo diagnóstico encerrado',
  DIAGNOSTIC_INVITES_CREATE: 'Convites de diagnóstico emitidos',
  'assessment.policy.created': 'Política de consolidação criada',
  'assessment.policy.published': 'Política de consolidação publicada',
  'assessment.cycle.created': 'Ciclo de avaliação criado',
  'assessment.cycle.open': 'Ciclo de avaliação aberto',
  'assessment.cycle.closed': 'Ciclo de avaliação encerrado',
  'assessment.source.created': 'Fonte de avaliação registrada',
  'evaluation_method.created': 'Método de avaliação criado',
  'evaluation_method.draft_updated': 'Rascunho do método atualizado',
  'evaluation_method.published': 'Método de avaliação publicado',
  'evaluation_method.version_forked': 'Nova versão do método criada',
  ACCESS_INVITE_CREATED: 'Convite de acesso emitido',
  ACCESS_INVITE_REISSUED: 'Convite de acesso reemitido',
  ACCESS_INVITE_REVOKED: 'Convite de acesso revogado',
  ACCESS_INVITE_ACCEPTED: 'Convite de acesso aceito',
  ACCESS_MEMBERSHIP_ACTIVATED: 'Vínculo de acesso ativado',
  ACCESS_MEMBERSHIP_DEACTIVATED: 'Vínculo de acesso desativado',
  ACCESS_MEMBERSHIP_UPDATED: 'Vínculo de acesso atualizado',
};
function label(operation: string): string {
  const capabilities: Record<string, string> = {
    TECHNICAL_DECISIONS: 'decisões técnicas',
    EXECUTE_ASSIGNED_ACTIONS: 'execução de ações atribuídas',
  };
  const [action, capability] = operation.split(':');
  if (action === 'ACCESS_CAPABILITY_GRANTED')
    return `Capacidade concedida: ${capabilities[capability!] ?? 'acesso autorizado'}`;
  if (action === 'ACCESS_CAPABILITY_REVOKED')
    return `Capacidade revogada: ${capabilities[capability!] ?? 'acesso autorizado'}`;
  return labels[operation] ?? 'Evento registrado';
}
const resourceLabels: Record<string, string> = {
  risk: 'Risco',
  action: 'Ação',
  access: 'Acesso',
  organization: 'Organização',
  unit: 'Unidade',
  sector: 'Setor',
  employee: 'Colaborador',
  'assessment-group': 'Grupo de avaliação',
  'assessment-cycle': 'Ciclo de avaliação',
  'assessment-policy': 'Política de consolidação',
  'assessment-source': 'Fonte de avaliação',
  'diagnostic-cycle': 'Ciclo diagnóstico',
  'evaluation-method': 'Método de avaliação',
  'instrument-version': 'Versão de instrumento',
  'preliminary-evaluation': 'Avaliação preliminar',
  'technical-evaluation': 'Avaliação técnica',
  'efficacy-opinion': 'Parecer de eficácia',
  reassessment: 'Reavaliação',
  'technical-closure': 'Encerramento técnico',
  'corrective-action': 'Ação corretiva',
};

/** Type inference here identifies old resource IDs only; it never guesses a revision link. */
export function legacyResourceType(operation: string): string {
  if (operation === 'RISK_PRELIMINARY_EVALUATION_CREATE') return 'preliminary-evaluation';
  if (operation === 'risk.technical_evaluation_created') return 'technical-evaluation';
  if (operation === 'risk.reassessment_created') return 'reassessment';
  if (operation === 'ACTION_EFFICACY_RECORDED') return 'efficacy-opinion';
  if (operation === 'action.technical_closure_created') return 'technical-closure';
  if (operation === 'action.corrective_created') return 'corrective-action';
  if (operation.startsWith('RISK_')) return 'risk';
  if (operation.startsWith('ACTION_')) return 'action';
  if (operation.startsWith('ACCESS_')) return 'access';
  if (operation.startsWith('INSTRUMENT_')) return 'instrument-version';
  if (operation.startsWith('evaluation_method.')) return 'evaluation-method';
  if (operation.startsWith('DIAGNOSTIC_')) return 'diagnostic-cycle';
  if (operation.startsWith('assessment.cycle.')) return 'assessment-cycle';
  if (operation.startsWith('assessment.policy.')) return 'assessment-policy';
  if (operation.startsWith('assessment.source.')) return 'assessment-source';
  if (operation.startsWith('ORGANIZATION_')) return 'organization';
  if (operation.startsWith('UNIT_')) return 'unit';
  if (operation.startsWith('SECTOR_')) return 'sector';
  if (operation.startsWith('ASSESSMENT_GROUP_')) return 'assessment-group';
  if (operation.startsWith('EMPLOYEE_')) return 'employee';
  return 'unknown';
}

function target(row: HistoryRow): AuditTarget {
  const common = { kind: row.kind, id: row.targetId };
  return (
    row.parentId
      ? {
          ...common,
          parentId: row.parentId,
          ...(row.revision !== null ? { revision: row.revision } : {}),
        }
      : common
  ) as AuditTarget;
}
function fromRow(row: HistoryRow, actors: Map<string, { id: string; name: string }>): AuditEvent {
  return auditEventSchema.parse({
    id: row.id,
    operation: row.operation,
    label: label(row.operation),
    actor: row.actorId ? (actors.get(row.actorId) ?? null) : null,
    createdAt: row.createdAt.toISOString(),
    reason: row.reason,
    resource: { type: row.resourceType, id: row.resourceId, label: row.resourceLabel },
    target: target(row),
  });
}

@Injectable()
export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  list(scope: AuditScope, query: AuditListQuery): Promise<AuditEventList> {
    return this.repository.snapshot(async (tx) => {
      const timeZone = await this.repository.authorize(tx, scope, true);
      // Legacy resource types use this same deterministic CASE for filtering and output.
      const resourceType = Prisma.sql`coalesce(resource_type,
        CASE
          WHEN action='RISK_PRELIMINARY_EVALUATION_CREATE' THEN 'preliminary-evaluation'
          WHEN action='risk.technical_evaluation_created' THEN 'technical-evaluation'
          WHEN action='risk.reassessment_created' THEN 'reassessment'
          WHEN action='ACTION_EFFICACY_RECORDED' THEN 'efficacy-opinion'
          WHEN action='action.technical_closure_created' THEN 'technical-closure'
          WHEN action='action.corrective_created' THEN 'corrective-action'
          WHEN action LIKE 'RISK\\_%' ESCAPE '\\' THEN 'risk'
          WHEN action LIKE 'ACTION\\_%' ESCAPE '\\' THEN 'action'
          WHEN action LIKE 'ACCESS\\_%' ESCAPE '\\' THEN 'access'
          WHEN action LIKE 'INSTRUMENT\\_%' ESCAPE '\\' THEN 'instrument-version'
          WHEN action LIKE 'evaluation_method.%' THEN 'evaluation-method'
          WHEN action LIKE 'DIAGNOSTIC\\_%' ESCAPE '\\' THEN 'diagnostic-cycle'
          WHEN action LIKE 'assessment.cycle.%' THEN 'assessment-cycle'
          WHEN action LIKE 'assessment.policy.%' THEN 'assessment-policy'
          WHEN action LIKE 'assessment.source.%' THEN 'assessment-source'
          WHEN action LIKE 'ORGANIZATION\\_%' ESCAPE '\\' THEN 'organization'
          WHEN action LIKE 'UNIT\\_%' ESCAPE '\\' THEN 'unit'
          WHEN action LIKE 'SECTOR\\_%' ESCAPE '\\' THEN 'sector'
          WHEN action LIKE 'ASSESSMENT_GROUP\\_%' ESCAPE '\\' THEN 'assessment-group'
          WHEN action LIKE 'EMPLOYEE\\_%' ESCAPE '\\' THEN 'employee'
          ELSE 'unknown' END)`;
      const where = Prisma.sql`WHERE organization_id=${scope.organizationId}::uuid
        ${query.resourceType ? Prisma.sql`AND ${resourceType}=${query.resourceType}` : Prisma.empty}
        ${query.resourceId ? Prisma.sql`AND resource_id=${query.resourceId}::uuid` : Prisma.empty}
        ${query.actorId ? Prisma.sql`AND actor_id=${query.actorId}::uuid` : Prisma.empty}
        ${query.operation ? Prisma.sql`AND action=${query.operation}` : Prisma.empty}
        ${datePredicate(query, timeZone, Prisma.sql`created_at`)}`;
      const rows = await tx.$queryRaw<StoredAuditEvent[]>(Prisma.sql`
        SELECT id, actor_id AS "actorId", organization_id AS "organizationId", action, resource_id AS "resourceId",
          resource_type AS "resourceType", reason, reference_type AS "referenceType", reference_id AS "referenceId",
          version, created_at AS "createdAt"
        FROM audit_events ${where} ORDER BY created_at DESC, id DESC
        LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`);
      const totals = await tx.$queryRaw<{ total: bigint }[]>(
        Prisma.sql`SELECT count(*) AS total FROM audit_events ${where}`,
      );
      const records = await this.repository.records(tx, scope.organizationId, [
        ...new Set(
          rows.flatMap((row) =>
            [row.referenceId, row.resourceId].filter((id): id is string => !!id),
          ),
        ),
      ]);
      const actors = await this.repository.actors(
        tx,
        rows.map((row) => row.actorId),
      );
      const groups = new Map<string, string[]>();
      for (const row of rows) {
        const type = row.resourceType ?? legacyResourceType(row.action);
        if (row.resourceId) groups.set(type, [...(groups.get(type) ?? []), row.resourceId]);
      }
      const names = await this.repository.resourceLabels(tx, scope.organizationId, groups);
      const items = rows.map((row) =>
        this.auditItem(row, records, actors, names, scope.organizationId),
      );
      return auditEventListSchema.parse({
        items,
        total: Number(totals[0]!.total),
        page: query.page,
        pageSize: query.pageSize,
        timeZone,
      });
    });
  }

  private auditItem(
    row: StoredAuditEvent,
    records: HistoryRow[],
    actors: Map<string, { id: string; name: string }>,
    names: Map<string, string>,
    organizationId: string,
  ): AuditEvent {
    const type = row.resourceType ?? legacyResourceType(row.action);
    const exact =
      row.referenceId && row.referenceType
        ? records.find(
            (record) => record.targetId === row.referenceId && record.kind === row.referenceType,
          )
        : undefined;
    const legacy =
      !row.referenceId && !row.action.startsWith('ACTION_') && type !== 'access'
        ? records.find((record) => record.targetId === row.resourceId && record.kind === type)
        : undefined;
    const record = exact ?? legacy;
    const resource = records.find((record) => record.resourceId === row.resourceId);
    return auditEventSchema.parse({
      id: `audit:${row.id}`,
      operation: row.action,
      label: label(row.action),
      actor: row.actorId ? (actors.get(row.actorId) ?? null) : null,
      createdAt: row.createdAt.toISOString(),
      reason: row.reason ?? record?.reason ?? null,
      resource: {
        type,
        id: row.resourceId ?? organizationId,
        label:
          record?.resourceLabel ??
          resource?.resourceLabel ??
          names.get(`${type}:${row.resourceId}`) ??
          resourceLabels[type] ??
          'Recurso',
      },
      target: record ? target(record) : null,
    });
  }

  history(
    scope: AuditScope,
    type: 'risk' | 'action',
    id: string,
    query: AuditHistoryQuery,
  ): Promise<AuditEventList> {
    return this.repository.snapshot(async (tx) => {
      const timeZone = await this.repository.authorize(tx, scope, false);
      const resource =
        type === 'risk'
          ? await tx.risk.findFirst({
              where: { id, organizationId: scope.organizationId },
              select: { id: true },
            })
          : await tx.action.findFirst({
              where: { id, organizationId: scope.organizationId },
              select: { id: true },
            });
      if (!resource) throw new NotFoundException();
      const riskAction =
        type === 'risk'
          ? Prisma.sql`OR (d."resourceType"='action' AND d."resourceId" IN
            (SELECT id FROM actions WHERE organization_id=${scope.organizationId}::uuid AND risk_id=${id}::uuid))`
          : Prisma.empty;
      const correctiveFromAction =
        type === 'action'
          ? Prisma.sql`OR d.id IN (
              SELECT 'corrective:' || id::text FROM action_corrective_links
              WHERE organization_id=${scope.organizationId}::uuid AND previous_action_id=${id}::uuid
            )`
          : Prisma.empty;
      // Only domain sources enter operational history. Access/admin events never enter this union.
      const domain = Prisma.sql`SELECT * FROM (${domainRecords(scope.organizationId)}) d
        WHERE ((d."resourceType"=${type} AND d."resourceId"=${id}::uuid) ${riskAction} ${correctiveFromAction})
          AND d.kind NOT IN ('access','instrument-version','risk')
          AND d.id NOT LIKE 'action:%'
          AND NOT (d.kind='technical-evaluation' AND d."targetId" IN
            (SELECT evaluation_id FROM risk_reassessments WHERE organization_id=${scope.organizationId}::uuid))
          ${datePredicate(query, timeZone, Prisma.sql`d."createdAt"`)}`;
      const riskChanges =
        type === 'risk'
          ? Prisma.sql`
        UNION ALL SELECT 'audit:' || e.id::text, e.action, e.actor_id, e.created_at, e.reason,
          'risk', r.id, r.factor, 'risk', r.id, NULL::uuid, e.version,
          '[]'::jsonb
        FROM audit_events e JOIN risks r ON r.id=e.resource_id AND r.organization_id=e.organization_id
        WHERE e.organization_id=${scope.organizationId}::uuid AND e.resource_id=${id}::uuid
          AND e.action IN ('RISK_CREATE','RISK_UPDATE','RISK_ARCHIVE')
          ${datePredicate(query, timeZone, Prisma.sql`e.created_at`)}`
          : Prisma.empty;
      // Risk mutations come from their audit events; action creation comes from its immutable revision.
      const combined = Prisma.sql`${domain} ${riskChanges}`;
      const rows = await tx.$queryRaw<HistoryRow[]>(Prisma.sql`
        SELECT * FROM (${combined}) history ORDER BY "createdAt" DESC, id DESC
        LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`);
      const totals = await tx.$queryRaw<{ total: bigint }[]>(
        Prisma.sql`SELECT count(*) AS total FROM (${combined}) history`,
      );
      const actors = await this.repository.actors(
        tx,
        rows.map((row) => row.actorId),
      );
      return auditEventListSchema.parse({
        items: rows.map((row) => fromRow(row, actors)),
        total: Number(totals[0]!.total),
        page: query.page,
        pageSize: query.pageSize,
        timeZone,
      });
    });
  }

  record(scope: AuditScope, kind: AuditTargetKind, id: string): Promise<AuditRecord> {
    return this.repository.snapshot(async (tx) => {
      const timeZone = await this.repository.authorize(tx, scope, kind === 'access');
      const rows = await this.repository.records(tx, scope.organizationId, [id]);
      const row = rows.find(
        (record) =>
          record.kind === kind &&
          record.targetId === id &&
          (kind !== 'action' || record.id.startsWith('action:')),
      );
      if (!row) throw new NotFoundException();
      const actors = await this.repository.actors(tx, [row.actorId]);
      return auditRecordSchema.parse({
        event: fromRow(row, actors),
        timeZone,
        details: row.details,
      });
    });
  }
}
