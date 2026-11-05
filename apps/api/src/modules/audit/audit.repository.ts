import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import type { AuditHistoryQuery, AuditTargetKind } from '@renr/contracts';

export type AuditScope = { userId: string; organizationId: string };
export type HistoryRow = {
  id: string;
  operation: string;
  actorId: string | null;
  createdAt: Date;
  reason: string | null;
  resourceType: string;
  resourceId: string;
  resourceLabel: string;
  kind: AuditTargetKind;
  targetId: string;
  parentId: string | null;
  revision: number | null;
  details: { label: string; value: string }[];
};

/** All SQL identifiers are static. Caller values enter only through Prisma parameters. */
export function domainRecords(organizationId: string): Prisma.Sql {
  return Prisma.sql`
    SELECT 'risk:' || r.id::text AS id, 'RISK_CREATE' AS operation, r.created_by_id AS "actorId",
      r.created_at AS "createdAt", NULL::text AS reason, 'risk' AS "resourceType",
      r.id AS "resourceId", r.factor AS "resourceLabel", 'risk' AS kind, r.id AS "targetId",
      NULL::uuid AS "parentId", NULL::integer AS revision,
      jsonb_build_array(jsonb_build_object('label','Fator','value',r.factor)) AS details
    FROM risks r WHERE r.organization_id = ${organizationId}::uuid
    UNION ALL
    SELECT 'action:' || a.id::text, 'ACTION_CREATE', a.created_by_id, a.created_at,
      NULL, 'action', a.id, a.title, 'action', a.id, NULL::uuid, NULL::integer,
      jsonb_build_array(jsonb_build_object('label','Título','value',a.title))
    FROM actions a WHERE a.organization_id = ${organizationId}::uuid
    UNION ALL
    SELECT 'revision:' || e.id::text, 'ACTION_' || e.event, e.author_id, e.created_at,
      coalesce(e.change_reason,e.text), 'action', a.id, a.title, 'action-revision', e.id, a.id, e.version,
      jsonb_build_array(jsonb_build_object('label','Evento','value',e.event),
        jsonb_build_object('label','Texto','value',coalesce(e.text,'')),
        jsonb_build_object('label','Revisão','value',e.version::text),
        jsonb_build_object('label','Título preservado','value',coalesce(e.snapshot->>'title','')),
        jsonb_build_object('label','Descrição preservada','value',coalesce(e.snapshot->>'description','')),
        jsonb_build_object('label','Responsável preservado','value',coalesce(e.snapshot->>'responsibleName','')),
        jsonb_build_object('label','Prazo preservado','value',coalesce(e.snapshot->>'dueDate','')),
        jsonb_build_object('label','Resultado esperado preservado','value',coalesce(e.snapshot->>'expectedResult','')),
        jsonb_build_object('label','Critério preservado','value',coalesce(e.snapshot->>'verificationCriterion','')),
        jsonb_build_object('label','Situação preservada','value',coalesce(e.snapshot->>'status','')),
        jsonb_build_object('label','Relato de implementação','value',coalesce(e.snapshot->>'implementationNote','')),
        jsonb_build_object('label','Executor preservado','value',coalesce(e.snapshot->>'assignedName','')))
    FROM action_revisions e JOIN actions a ON a.id=e.action_id AND a.organization_id=e.organization_id
    WHERE e.organization_id = ${organizationId}::uuid
    UNION ALL
    SELECT 'preliminary:' || e.id::text, 'RISK_PRELIMINARY_EVALUATION_CREATE', e.author_id, e.created_at,
      e.rationale, 'risk', r.id, r.factor, 'preliminary-evaluation', e.id, r.id, e.sequence,
      jsonb_build_array(jsonb_build_object('label','Observação','value',e.observation),
        jsonb_build_object('label','Método','value',e.method_reference),
        jsonb_build_object('label','Versão do método','value',e.method_version))
    FROM risk_evaluations e JOIN risks r ON r.id=e.risk_id AND r.organization_id=e.organization_id
    WHERE e.organization_id = ${organizationId}::uuid
    UNION ALL
    SELECT 'technical:' || e.id::text, 'risk.technical_evaluation_created', e.author_id, e.created_at,
      e.rationale, 'risk', r.id, r.factor, 'technical-evaluation', e.id, r.id, e.sequence,
      jsonb_build_array(jsonb_build_object('label','Contexto','value',e.context),
        jsonb_build_object('label','Probabilidade','value',e.probability_key),
        jsonb_build_object('label','Severidade','value',e.severity_key))
    FROM technical_risk_evaluations e JOIN risks r ON r.id=e.risk_id AND r.organization_id=e.organization_id
    WHERE e.organization_id = ${organizationId}::uuid
    UNION ALL
    SELECT 'efficacy:' || e.id::text, 'ACTION_EFFICACY_RECORDED', e.author_id, e.created_at,
      e.rationale, 'action', a.id, a.title, 'efficacy-opinion', e.id, a.id, e.sequence,
      jsonb_build_array(jsonb_build_object('label','Resultado','value',e.result),
        jsonb_build_object('label','Observação','value',e.observation),
        jsonb_build_object('label','Critério','value',e.criterion_reference),
        jsonb_build_object('label','Próximos passos','value',coalesce(e.next_steps,'')))
    FROM action_efficacy_opinions e JOIN actions a ON a.id=e.action_id AND a.organization_id=e.organization_id
    WHERE e.organization_id = ${organizationId}::uuid
    UNION ALL
    SELECT 'reassessment:' || e.id::text, 'risk.reassessment_created', e.author_id, e.created_at,
      v.rationale, 'risk', r.id, r.factor, 'reassessment', e.id, r.id, v.sequence,
      jsonb_build_array(jsonb_build_object('label','Contexto','value',v.context),
        jsonb_build_object('label','Avaliação','value',e.evaluation_id::text),
        jsonb_build_object('label','Avaliação anterior','value',e.previous_evaluation_id::text))
    FROM risk_reassessments e JOIN risks r ON r.id=e.risk_id AND r.organization_id=e.organization_id
      JOIN technical_risk_evaluations v ON v.id=e.evaluation_id AND v.organization_id=e.organization_id
    WHERE e.organization_id = ${organizationId}::uuid
    UNION ALL
    SELECT 'closure:' || e.id::text, 'action.technical_closure_created', e.author_id, e.created_at,
      e.rationale, 'action', a.id, a.title, 'technical-closure', e.id, a.id, e.sequence,
      jsonb_build_array(jsonb_build_object('label','Revisão operacional','value',e.action_version::text),
        jsonb_build_object('label','Reavaliação','value',e.reassessment_id::text),
        jsonb_build_object('label','Parecer de eficácia','value',e.opinion_id::text))
    FROM action_technical_closures e JOIN actions a ON a.id=e.action_id AND a.organization_id=e.organization_id
    WHERE e.organization_id = ${organizationId}::uuid
    UNION ALL
    SELECT 'corrective:' || e.id::text, 'action.corrective_created', e.author_id, e.created_at,
      e.reason, 'action', a.id, a.title, 'action', a.id, NULL::uuid, NULL::integer,
      jsonb_build_array(jsonb_build_object('label','Ação anterior','value',e.previous_action_id::text),
        jsonb_build_object('label','Ação corretiva','value',e.new_action_id::text))
    FROM action_corrective_links e JOIN actions a ON a.id=e.new_action_id AND a.organization_id=e.organization_id
    WHERE e.organization_id = ${organizationId}::uuid
    UNION ALL
    SELECT 'instrument:' || e.id::text, 'INSTRUMENT_VERSION', e.published_by_id, e.created_at,
      NULL, 'instrument-version', e.id, i.name, 'instrument-version', e.id, i.id, e.version,
      jsonb_build_array(jsonb_build_object('label','Instrumento','value',i.name),
        jsonb_build_object('label','Versão','value',e.version::text))
    FROM instrument_versions e JOIN instruments i ON i.id=e.instrument_id AND i.organization_id=e.organization_id
    WHERE e.organization_id = ${organizationId}::uuid
    UNION ALL
    SELECT 'access:' || e.id::text, e.action, e.actor_id, e.created_at, e.reason,
      'access', coalesce(e.user_id,e.id), coalesce(u.name,'Acesso'), 'access', e.id, NULL::uuid, NULL::integer,
      jsonb_build_array(jsonb_build_object('label','Operação','value',e.action))
    FROM access_history e LEFT JOIN users u ON u.id=e.user_id
    WHERE e.organization_id = ${organizationId}::uuid
  `;
}

export function datePredicate(
  query: AuditHistoryQuery,
  timeZone: string,
  column: Prisma.Sql,
): Prisma.Sql {
  return Prisma.sql`
    ${query.from ? Prisma.sql`AND (${column} AT TIME ZONE 'UTC') >= (${query.from}::date::timestamp AT TIME ZONE ${timeZone})` : Prisma.empty}
    ${query.to ? Prisma.sql`AND (${column} AT TIME ZONE 'UTC') < ((${query.to}::date + 1)::timestamp AT TIME ZONE ${timeZone})` : Prisma.empty}
  `;
}

@Injectable()
export class AuditRepository {
  constructor(private readonly database: PrismaService) {}
  snapshot<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.database.client.$transaction(operation, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }
  async authorize(
    tx: Prisma.TransactionClient,
    scope: AuditScope,
    admin: boolean,
  ): Promise<string> {
    const member = await tx.membership.findUnique({
      where: { userId_organizationId: scope },
      select: { isActive: true, role: true, organization: { select: { timezone: true } } },
    });
    if (!member?.isActive) throw new NotFoundException();
    if (admin && member.role !== 'ADMIN') throw new ForbiddenException();
    return member.organization.timezone;
  }
  async actors(tx: Prisma.TransactionClient, ids: (string | null)[]) {
    return new Map(
      (
        await tx.user.findMany({
          where: { id: { in: [...new Set(ids.filter((id): id is string => !!id))] } },
          select: { id: true, name: true },
        })
      ).map((user) => [user.id, user]),
    );
  }
  async resourceLabels(
    tx: Prisma.TransactionClient,
    organizationId: string,
    groups: Map<string, string[]>,
  ) {
    const result = new Map<string, string>();
    const names = (type: string, rows: { id: string; name: string }[]) => {
      for (const row of rows) result.set(`${type}:${row.id}`, row.name);
    };
    const ids = (type: string) => groups.get(type) ?? [];
    if (ids('organization').includes(organizationId))
      names(
        'organization',
        await tx.organization.findMany({
          where: { id: organizationId },
          select: { id: true, name: true },
        }),
      );
    if (ids('unit').length)
      names(
        'unit',
        await tx.unit.findMany({
          where: { organizationId, id: { in: ids('unit') } },
          select: { id: true, name: true },
        }),
      );
    if (ids('sector').length)
      names(
        'sector',
        await tx.sector.findMany({
          where: { organizationId, id: { in: ids('sector') } },
          select: { id: true, name: true },
        }),
      );
    if (ids('assessment-group').length)
      names(
        'assessment-group',
        await tx.assessmentGroup.findMany({
          where: { organizationId, id: { in: ids('assessment-group') } },
          select: { id: true, name: true },
        }),
      );
    if (ids('assessment-cycle').length)
      names(
        'assessment-cycle',
        await tx.assessmentCycle.findMany({
          where: { organizationId, id: { in: ids('assessment-cycle') } },
          select: { id: true, name: true },
        }),
      );
    if (ids('diagnostic-cycle').length)
      names(
        'diagnostic-cycle',
        await tx.diagnosticCycle.findMany({
          where: { organizationId, id: { in: ids('diagnostic-cycle') } },
          select: { id: true, name: true },
        }),
      );
    if (ids('evaluation-method').length) {
      const methods = await tx.evaluationMethodVersion.findMany({
        where: { organizationId, id: { in: ids('evaluation-method') } },
        select: { id: true, title: true },
      });
      names(
        'evaluation-method',
        methods.map((row) => ({ id: row.id, name: row.title })),
      );
    }
    if (ids('instrument-version').length) {
      // INSTRUMENT_CREATE historically points to its parent, while other operations point to the version.
      names(
        'instrument-version',
        await tx.instrument.findMany({
          where: { organizationId, id: { in: ids('instrument-version') } },
          select: { id: true, name: true },
        }),
      );
    }
    return result;
  }
  async records(
    tx: Prisma.TransactionClient,
    organizationId: string,
    ids: string[],
  ): Promise<HistoryRow[]> {
    if (!ids.length) return [];
    return tx.$queryRaw<HistoryRow[]>(Prisma.sql`
      SELECT * FROM (${domainRecords(organizationId)}) d WHERE d."targetId" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
    `);
  }
}
