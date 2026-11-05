import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  peopleOverviewQuerySchema,
  peopleOverviewSchema,
  settlementRequestSchema,
  type PeopleOverview,
  type PeopleOverviewQuery,
  type PeopleMetric,
} from '@renr/contracts';
import { Prisma } from '../../generated/prisma/client';
import { registrationDto } from '../platform/platform.service';
import { referenceDate } from '../actions/actions.repository';
import { calculateCltSettlement, CltInputError, CLT_POLICY_VERSION } from './clt-calculator';
import { distribution, metric, suppressedMetric } from './people-projection';
import { canReadExactPeopleIndicators, peopleDataAvailable } from './people-availability';

interface Aggregate {
  total: number;
  active: number;
  inactive: number;
  eligible: number;
  ageKnown: number;
  ageAverage: string | null;
  tenureKnown: number;
  tenureAverage: string | null;
  genderKnown: number;
  overdue: number;
  unknown: number;
  due: number;
  buckets: { dimension: string; key: string; label: string; count: number }[];
  protectedDimensions: string[];
}
interface SettlementRow {
  id: string;
  salary: string | null;
  remunerationType: 'FIXED' | 'VARIABLE' | null;
  admission: string | null;
  sectorId: string;
  profile: {
    vacationHistoryKnown: boolean;
    complexLeaveHistoryKnown: boolean;
    hasComplexLeaves: boolean;
  } | null;
  parameters: unknown;
  vacations: {
    acquisitionStart: string;
    entitlementDays: number;
    balanceDays: number;
    concessionDeadline: string;
    historyKnown: boolean;
  }[];
}
const forbidden: PeopleMetric = {
  state: 'FORBIDDEN',
  value: null,
  known: null,
  missing: null,
  explanation: 'Requer capacidade de leitura de remuneração.',
};
const nominalRequired: PeopleMetric = {
  ...forbidden,
  explanation: 'Indicadores exatos de clientes reais exigem leitura de perfil de RH.',
};
const bucketLabels: Record<string, string> = {
  FEMALE: 'Feminino',
  MALE: 'Masculino',
  NON_BINARY: 'Não binário',
  SELF_DESCRIBED: 'Autodescrito',
  PREFER_NOT_TO_SAY: 'Prefere não informar',
  UNKNOWN: 'Não informado',
  UNDER_30: 'Até 29 anos',
  '30_39': '30 a 39 anos',
  '40_49': '40 a 49 anos',
  '50_59': '50 a 59 anos',
  '60_PLUS': '60 anos ou mais',
  UNDER_12: 'Menos de 12 meses',
  '12_35': '12 a 35 meses',
  '36_59': '36 a 59 meses',
  '60_119': '60 a 119 meses',
  '120_PLUS': '120 meses ou mais',
  OVERDUE: 'Vencidas confirmadas',
  DUE_SOON: 'Prazo em até 60 dias',
  FOLLOW_UP: 'Acompanhamento',
  REGULAR: 'Regular',
};

@Injectable()
export class PeopleAnalyticsService {
  constructor(private readonly database: PrismaService) {}
  async overview(
    scope: { userId: string; organizationId: string },
    query: PeopleOverviewQuery,
    options: {
      transaction?: Prisma.TransactionClient;
      now?: Date;
      includeFinancial?: boolean;
    } = {},
  ): Promise<PeopleOverview> {
    const read = async (tx: Prisma.TransactionClient) => {
      const membership = await tx.membership.findUnique({
        where: { userId_organizationId: scope },
      });
      if (!membership?.isActive || !membership.hrCapabilities.includes('HR_ANALYTICS_READ'))
        throw new ForbiddenException();
      const parsed = peopleOverviewQuerySchema.safeParse(query);
      if (!parsed.success) throw new BadRequestException('Filtros de RH inválidos.');
      query = parsed.data;
      const organization = await tx.organization.findUnique({
        where: { id: scope.organizationId },
      });
      if (!organization) throw new NotFoundException();
      if (
        this.database.allowsRealPeopleData === false &&
        !peopleDataAvailable(this.database, organization.id)
      )
        throw new ForbiddenException();
      const canReadExact = canReadExactPeopleIndicators(
        this.database,
        organization.id,
        membership.hrCapabilities,
      );
      if (
        query.unitId &&
        !(await tx.unit.findFirst({
          where: { id: query.unitId, organizationId: scope.organizationId },
          select: { id: true },
        }))
      )
        throw new NotFoundException('Unidade não encontrada.');
      if (
        query.sectorId &&
        !(await tx.sector.findFirst({
          where: {
            id: query.sectorId,
            organizationId: scope.organizationId,
            ...(query.unitId ? { unitId: query.unitId } : {}),
          },
          select: { id: true },
        }))
      )
        throw new NotFoundException('Setor não encontrado no recorte.');
      const generatedAt = options.now ?? new Date();
      const today = referenceDate(organization.timezone, generatedAt);
      const competence = query.competence ?? today.slice(0, 7);
      const filter = Prisma.sql`e.organization_id=${scope.organizationId}::uuid
        ${query.unitId ? Prisma.sql`AND e.unit_id=${query.unitId}::uuid` : Prisma.empty}
        ${query.sectorId ? Prisma.sql`AND e.sector_id=${query.sectorId}::uuid` : Prisma.empty}
        ${query.isActive ? Prisma.sql`AND e.is_active=${query.isActive === 'true'}` : Prisma.empty}`;
      const rows = await tx.$queryRaw<Aggregate[]>(Prisma.sql`
        WITH population AS (SELECT e.* FROM employees e WHERE ${filter}),
        eligible AS (
          SELECT e.id,e.unit_id,e.sector_id,p.gender,
            CASE WHEN p.birth_date<=${today}::date THEN
              EXTRACT(YEAR FROM ${today}::date)::int-EXTRACT(YEAR FROM p.birth_date)::int-
              CASE WHEN to_char(${today}::date,'MMDD')<to_char(p.birth_date,'MMDD') THEN 1 ELSE 0 END END AS age,
            CASE WHEN h.n=1 THEN EXTRACT(YEAR FROM age(${today}::date,h.starts_on))*12+EXTRACT(MONTH FROM age(${today}::date,h.starts_on)) END AS tenure,
            CASE WHEN EXISTS(SELECT 1 FROM employee_vacation_periods v WHERE v.organization_id=e.organization_id AND v.employee_id=e.id AND v.history_known AND v.balance_days>0 AND v.concession_deadline<${today}::date) THEN 'OVERDUE'
              WHEN p.employee_id IS NULL OR NOT p.vacation_history_known OR EXISTS(SELECT 1 FROM employee_vacation_periods v WHERE v.organization_id=e.organization_id AND v.employee_id=e.id AND NOT v.history_known) THEN 'UNKNOWN'
              WHEN EXISTS(SELECT 1 FROM employee_vacation_periods v WHERE v.organization_id=e.organization_id AND v.employee_id=e.id AND v.balance_days>0 AND v.concession_deadline BETWEEN ${today}::date AND ${today}::date+60) THEN 'DUE_SOON'
              WHEN p.follow_up THEN 'FOLLOW_UP' ELSE 'REGULAR' END AS vacation
          FROM population e LEFT JOIN employee_hr_profiles p ON p.organization_id=e.organization_id AND p.employee_id=e.id
          LEFT JOIN LATERAL (SELECT count(*) n,min(starts_on) starts_on FROM employment_periods h WHERE h.organization_id=e.organization_id AND h.employee_id=e.id AND h.starts_on<=${today}::date AND (h.ends_on IS NULL OR h.ends_on>=${today}::date)) h ON true
          WHERE e.is_active
        ), sector_cells AS (
          SELECT e.sector_id, cell.dimension, cell.key, count(*)::int count
          FROM eligible e
          CROSS JOIN LATERAL (VALUES
            ('gender', coalesce(e.gender, 'UNKNOWN')),
            ('age', CASE WHEN e.age IS NULL THEN 'UNKNOWN' WHEN e.age<30 THEN 'UNDER_30' WHEN e.age<40 THEN '30_39' WHEN e.age<50 THEN '40_49' WHEN e.age<60 THEN '50_59' ELSE '60_PLUS' END),
            ('tenure', CASE WHEN e.tenure IS NULL THEN 'UNKNOWN' WHEN e.tenure<12 THEN 'UNDER_12' WHEN e.tenure<36 THEN '12_35' WHEN e.tenure<60 THEN '36_59' WHEN e.tenure<120 THEN '60_119' ELSE '120_PLUS' END),
            ('vacation', e.vacation)
          ) cell(dimension,key)
          GROUP BY e.sector_id,cell.dimension,cell.key
        ), buckets AS (
          SELECT dimension, key, '' label, sum(count)::int count FROM sector_cells GROUP BY dimension,key
          UNION ALL SELECT 'unit',u.id::text,u.name,count(*)::int FROM eligible e JOIN units u ON u.id=e.unit_id GROUP BY u.id,u.name
          UNION ALL SELECT 'sector',s.id::text,s.name,count(*)::int FROM eligible e JOIN sectors s ON s.id=e.sector_id GROUP BY s.id,s.name
        ) SELECT (SELECT count(*)::int FROM population) total,(SELECT count(*)::int FROM population WHERE is_active) active,
          (SELECT count(*)::int FROM population WHERE NOT is_active) inactive,count(*)::int eligible,
          count(age)::int "ageKnown",round(avg(age),2)::text "ageAverage",count(tenure)::int "tenureKnown",round(avg(tenure),2)::text "tenureAverage",
          count(*) FILTER(WHERE gender IS NOT NULL AND gender<>'PREFER_NOT_TO_SAY')::int "genderKnown",count(*) FILTER(WHERE vacation='OVERDUE')::int overdue,
          count(*) FILTER(WHERE vacation='UNKNOWN')::int unknown,count(*) FILTER(WHERE vacation='DUE_SOON')::int due,
          (SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY dimension,key),'[]'::jsonb) FROM buckets b) buckets,
          ARRAY(SELECT DISTINCT dimension FROM sector_cells WHERE count<5) "protectedDimensions"
          FROM eligible`);
      const a = rows[0]!;
      const protectedDimensions = new Set(a.protectedDimensions);
      let salaryMassCents = forbidden,
        averageSalaryCents = forbidden,
        terminationGrossCents = forbidden;
      if (
        canReadExact &&
        options.includeFinancial !== false &&
        membership.hrCapabilities.some(
          (c) => c === 'HR_COMPENSATION_READ' || c === 'HR_COMPENSATION_MANAGE',
        )
      ) {
        const [salary] = await tx.$queryRaw<
          { known: number; total: string; protected: boolean }[]
        >(Prisma.sql`
          WITH sectors AS (
            SELECT e.sector_id,count(r.salary_cents)::int known,
              (count(*)-count(r.salary_cents))::int missing,sum(r.salary_cents) total
            FROM employees e LEFT JOIN employee_remunerations r
              ON r.organization_id=e.organization_id AND r.employee_id=e.id AND r.competence=${competence}
            WHERE ${filter} AND e.is_active GROUP BY e.sector_id
          )
          SELECT coalesce(sum(known),0)::int known,coalesce(sum(total),0)::text total,
            coalesce(bool_or(known BETWEEN 1 AND 4 OR missing BETWEEN 1 AND 4),false) protected
          FROM sectors`);
        const known = salary!.known,
          missing = a.eligible - known;
        if (salary!.protected) {
          salaryMassCents = suppressedMetric();
          averageSalaryCents = suppressedMetric();
        } else {
          salaryMassCents = metric(
            known || !missing ? salary!.total : null,
            known,
            missing,
            'Soma dos salários conhecidos dos ativos na competência informada; cobertura faltante não integra a soma.',
          );
          averageSalaryCents = metric(
            known
              ? ((BigInt(salary!.total) + BigInt(known) / 2n) / BigInt(known)).toString()
              : null,
            known,
            missing,
            'Média dos salários conhecidos, em centavos, arredondada meio para cima; cobertura faltante não integra a média.',
          );
        }
        const sectors = new Map(
          a.buckets
            .filter((bucket) => bucket.dimension === 'sector')
            .map((bucket) => [bucket.key, bucket.count]),
        );
        terminationGrossCents = await this.termination(tx, filter, today, a.eligible, sectors);
      }
      const vacationKnown = a.eligible - a.unknown;
      const vacationMetric = (value: number) =>
        metric(
          String(value),
          vacationKnown,
          a.unknown,
          'Classificação exclusiva de ativos; prioridade: vencidas, histórico desconhecido, prazo até 60 dias, acompanhamento, regular.',
        );
      const vacationSuppressed = protectedDimensions.has('vacation');
      // The minority/complement is protected even when a metric discloses just one category.
      const protectedVacation = (value: number) => {
        const result = vacationMetric(value);
        if (
          vacationSuppressed ||
          (result.state !== 'SUPPRESSED' && [value, a.eligible - value].some((n) => n > 0 && n < 5))
        )
          return suppressedMetric();
        return result;
      };
      const metrics: PeopleOverview['metrics'] = {
        averageAge: protectedDimensions.has('age')
          ? suppressedMetric()
          : metric(
              a.ageAverage,
              a.ageKnown,
              a.eligible - a.ageKnown,
              'Idade em anos completos; aniversário de 29/02 em 01/03 nos anos não bissextos.',
            ),
        averageTenureMonths: protectedDimensions.has('tenure')
          ? suppressedMetric()
          : metric(
              a.tenureAverage,
              a.tenureKnown,
              a.eligible - a.tenureKnown,
              'Meses completos do vínculo vigente único; vínculos ausentes ou ambíguos são desconhecidos.',
            ),
        genderCoveragePercent: protectedDimensions.has('gender')
          ? suppressedMetric()
          : metric(
              a.eligible ? ((100 * a.genderKnown) / a.eligible).toFixed(2) : null,
              a.genderKnown,
              a.eligible - a.genderKnown,
              'Gênero autodeclarado; não inferido.',
            ),
        salaryMassCents,
        averageSalaryCents,
        terminationGrossCents,
        vacationOverdue: protectedVacation(a.overdue),
        vacationUnknown: protectedVacation(a.unknown),
        vacationDueSoon: protectedVacation(a.due),
      };
      if (!canReadExact) {
        for (const key of Object.keys(metrics) as (keyof typeof metrics)[])
          metrics[key] = nominalRequired;
      }
      const dimensionLabels = {
        gender: 'Gênero autodeclarado',
        age: 'Idade (anos)',
        tenure: 'Tempo de casa (meses)',
        vacation: 'Férias',
        unit: 'Unidade',
        sector: 'Setor',
      };
      const distributions = Object.entries(dimensionLabels).map(([key, label]) => {
        const structural = key === 'unit' || key === 'sector';
        if (!structural && !canReadExact) return { key, label, state: 'FORBIDDEN', items: [] };
        const buckets = a.buckets
          .filter((bucket) => bucket.dimension === key)
          .map((bucket) => ({
            key: bucket.key,
            label: structural ? bucket.label : (bucketLabels[bucket.key] ?? 'Não informado'),
            count: bucket.count,
          }));
        return distribution(key, label, buckets, protectedDimensions.has(key));
      });
      return peopleOverviewSchema.parse({
        registration: registrationDto(organization),
        generatedAt: generatedAt.toISOString(),
        referenceDate: today,
        timeZone: organization.timezone,
        competence,
        privacyPolicy: 'HR_MIN5_COMPLEMENT_V1',
        filters: {
          unitId: query.unitId ?? null,
          sectorId: query.sectorId ?? null,
          isActive: query.isActive === undefined ? null : query.isActive === 'true',
        },
        population: {
          total: a.total,
          active: a.active,
          inactive: a.inactive,
          unit: 'EMPLOYEE_RECORDS',
        },
        metrics,
        distributions,
        settlementPolicy: {
          version: CLT_POLICY_VERSION,
          scenario: 'CLT_SEM_JUSTA_CAUSA_AVISO_INDENIZADO',
          limitations: [
            'Estimativa bruta para conferência, anterior à emissão do TRCT.',
            'A estimativa usa o vínculo vigente e a remuneração da competência da data simulada.',
            'Total indisponível quando qualquer registro elegível não possui cálculo completo.',
          ],
        },
      });
    };
    return options.transaction
      ? read(options.transaction)
      : this.database.client.$transaction(read, {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          timeout: 10_000,
        });
  }

  private async termination(
    tx: Prisma.TransactionClient,
    filter: Prisma.Sql,
    today: string,
    total: number,
    sectors: Map<string, number>,
  ): Promise<PeopleMetric> {
    const competence = today.slice(0, 7);
    const knownBySector = new Map<string, number>();
    let cursor: string | null = null,
      known = 0,
      sum = 0n;
    for (;;) {
      const batch: SettlementRow[] = await tx.$queryRaw<SettlementRow[]>(Prisma.sql`
        SELECT e.id,e.sector_id::text "sectorId",r.salary_cents::text salary,r.remuneration_type "remunerationType",
          CASE WHEN h.n=1 THEN to_char(h.starts_on,'YYYY-MM-DD') END admission,
          CASE WHEN p.employee_id IS NULL THEN NULL ELSE jsonb_build_object('vacationHistoryKnown',p.vacation_history_known,'complexLeaveHistoryKnown',p.complex_leave_history_known,'hasComplexLeaves',p.has_complex_leaves) END profile,
          sp.input parameters,coalesce(v.periods,'[]'::jsonb) vacations
        FROM employees e JOIN employee_remunerations r ON r.organization_id=e.organization_id AND r.employee_id=e.id AND r.competence=${competence}
        JOIN employee_hr_profiles p ON p.organization_id=e.organization_id AND p.employee_id=e.id
        JOIN employee_settlement_parameters sp ON sp.organization_id=e.organization_id AND sp.employee_id=e.id AND sp.reference_date=${today}::date
        LEFT JOIN LATERAL(SELECT count(*) n,min(starts_on) starts_on FROM employment_periods h WHERE h.organization_id=e.organization_id AND h.employee_id=e.id AND h.starts_on<=${today}::date AND (h.ends_on IS NULL OR h.ends_on>=${today}::date)) h ON true
        LEFT JOIN LATERAL(SELECT jsonb_agg(jsonb_build_object('acquisitionStart',to_char(v.acquisition_start,'YYYY-MM-DD'),'entitlementDays',v.entitlement_days,'balanceDays',v.balance_days,'concessionDeadline',to_char(v.concession_deadline,'YYYY-MM-DD'),'historyKnown',v.history_known)) periods FROM employee_vacation_periods v WHERE v.organization_id=e.organization_id AND v.employee_id=e.id AND v.acquisition_start>=h.starts_on AND v.acquisition_end<=${today}::date) v ON true
        WHERE ${filter} AND e.is_active ${cursor ? Prisma.sql`AND e.id>${cursor}::uuid` : Prisma.empty} ORDER BY e.id LIMIT 200`);
      for (const employee of batch) {
        const parameters = settlementRequestSchema.safeParse(employee.parameters);
        if (
          !parameters.success ||
          parameters.data.terminationDate !== today ||
          !employee.admission ||
          employee.salary === null ||
          !employee.profile
        )
          continue;
        try {
          const result = calculateCltSettlement({
            ...parameters.data,
            admissionDate: employee.admission,
            monthlySalaryCents: employee.salary,
            remunerationType: employee.remunerationType ?? undefined,
            ...employee.profile,
            acquiredVacationPeriods: employee.vacations,
          });
          if (result.grossTotalCents !== null) {
            known++;
            sum += BigInt(result.grossTotalCents);
            knownBySector.set(employee.sectorId, (knownBySector.get(employee.sectorId) ?? 0) + 1);
          }
        } catch (error) {
          // A persisted input can become inconsistent with a later profile correction.
          if (!(error instanceof CltInputError)) throw error;
        }
      }
      if (batch.length < 200) break;
      cursor = batch[batch.length - 1]!.id;
    }
    for (const [sectorId, population] of sectors) {
      const knownInSector = knownBySector.get(sectorId) ?? 0;
      if ([knownInSector, population - knownInSector].some((count) => count > 0 && count < 5))
        return suppressedMetric();
    }
    return metric(
      known === total ? sum.toString() : null,
      known,
      total - known,
      'Estimativa rescisória bruta completa por registro; sem subtotal de cobertura parcial.',
    );
  }
}
