import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  reportSnapshotSchema,
  reportSummarySchema,
  type CreateTenantReport,
  type CreatePlatformReport,
  type ReportSnapshot,
  type ReportSection,
  type PeopleOverview,
  type PeopleMetric,
} from '@renr/contracts';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { PlatformService } from '../platform/platform.service';
import { PeopleAnalyticsService } from '../people/people-analytics.service';
import { canReadExactPeopleIndicators, peopleDataAvailable } from '../people/people-availability';
import { referenceDate } from '../actions/actions.repository';
import { captureSst } from './report-sst';
import { renderReportPdf, ReportPdfLimitError, REPORT_PDF_LIMITS } from './report-pdf';
import {
  ReportGenerationBusyException,
  ReportGenerationDeadlineException,
  ReportScopeTooLargeException,
} from './report-errors';

type Scope = { userId: string; organizationId: string };
type Page = { page: number; pageSize: number };
const money = (value: string) => {
  const cents = BigInt(value);
  return (
    'R$ ' +
    new Intl.NumberFormat('pt-BR').format(cents / 100n) +
    ',' +
    (cents % 100n).toString().padStart(2, '0')
  );
};
const states = {
  KNOWN: 'Informado',
  SUPPRESSED: 'Suprimido por privacidade',
  FORBIDDEN: 'Sem permissão',
  INSUFFICIENT_DATA: 'Dados insuficientes',
  UNCONFIGURED: 'Não configurado',
};
const labels: Record<keyof PeopleOverview['metrics'], string> = {
  averageAge: 'Idade média (anos)',
  averageTenureMonths: 'Tempo médio de vínculo (meses)',
  genderCoveragePercent: 'Cobertura de gênero (%)',
  salaryMassCents: 'Soma dos salários conhecidos',
  averageSalaryCents: 'Média dos salários conhecidos',
  terminationGrossCents: 'Estimativa rescisória bruta',
  vacationOverdue: 'Férias vencidas confirmadas',
  vacationUnknown: 'Histórico de férias desconhecido',
  vacationDueSoon: 'Férias com prazo em até 60 dias',
};
function metricText(key: string, metric: PeopleMetric) {
  return metric.state === 'KNOWN' && metric.value !== null
    ? key.endsWith('Cents')
      ? money(metric.value)
      : metric.value
    : states[metric.state];
}
function hrSections(data: PeopleOverview, financial: boolean): ReportSection[] {
  const metrics = Object.entries(data.metrics).filter(
    ([key]) => financial || !key.endsWith('Cents'),
  );
  return [
    {
      key: 'people-population',
      title: 'Abrangência do cadastro',
      columns: ['Unidade de contagem', 'Total', 'Ativos', 'Inativos'],
      rows: [
        [
          data.population.unit,
          String(data.population.total),
          String(data.population.active),
          String(data.population.inactive),
        ],
      ],
      notes: [
        'Contagem de cadastros de colaboradores; não representa pessoas naturais únicas entre clientes.',
      ],
    },
    {
      key: 'people-metrics',
      title: 'Indicadores de Gestão de Pessoas',
      columns: ['Indicador', 'Resultado', 'Cobertura', 'Conceito'],
      rows: metrics.map(([key, m]) => [
        labels[key as keyof typeof labels],
        metricText(key, m),
        m.known === null ? 'Protegida' : m.known + ' conhecidos / ' + m.missing + ' ausentes',
        m.explanation,
      ]),
      notes: [
        'Referência civil: ' + data.referenceDate + ' · Competência salarial: ' + data.competence,
        'Política de privacidade: ' + data.privacyPolicy,
      ],
    },
    ...data.distributions.map((d) => ({
      key: 'people-' + d.key,
      title: d.label,
      columns: ['Categoria', 'Cadastros'],
      rows: d.items.map((r) => [
        r.label,
        r.count === null ? 'Suprimido por privacidade' : String(r.count),
      ]),
      notes: [states[d.state]],
    })),
  ];
}
@Injectable()
export class ReportsService {
  private generating = false;
  constructor(
    private readonly database: PrismaService,
    private readonly platform: PlatformService,
    private readonly people: PeopleAnalyticsService,
  ) {}
  private async member(tx: Prisma.TransactionClient, scope: Scope) {
    const m = await tx.membership.findUnique({ where: { userId_organizationId: scope } });
    if (!m?.isActive) throw new NotFoundException();
    return m;
  }
  private async authorize(
    tx: Prisma.TransactionClient,
    userId: string,
    snapshot: Pick<ReportSnapshot, 'organizationId' | 'kind' | 'financial' | 'nominal'>,
  ) {
    if (snapshot.kind === 'PLATFORM') {
      await this.platform.authorize(tx, userId, 'READ_OVERVIEW');
      return;
    }
    if (!snapshot.organizationId) throw new NotFoundException();
    const member = await this.member(tx, { userId, organizationId: snapshot.organizationId });
    if (snapshot.kind === 'SST') return;
    const caps = member.hrCapabilities;
    if (
      !peopleDataAvailable(this.database, snapshot.organizationId) ||
      !canReadExactPeopleIndicators(this.database, snapshot.organizationId, caps)
    )
      throw new ForbiddenException();
    if (!caps.includes('HR_EXPORT') || !caps.includes('HR_ANALYTICS_READ'))
      throw new ForbiddenException();
    if (
      snapshot.financial &&
      !caps.some((c) => c === 'HR_COMPENSATION_READ' || c === 'HR_COMPENSATION_MANAGE')
    )
      throw new ForbiddenException();
    if (snapshot.nominal && !caps.some((c) => c === 'HR_PROFILE_READ' || c === 'HR_PROFILE_MANAGE'))
      throw new ForbiddenException();
  }
  private async persist(tx: Prisma.TransactionClient, userId: string, snapshot: ReportSnapshot) {
    if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > REPORT_PDF_LIMITS.inputBytes)
      throw new ReportScopeTooLargeException();
    const valid = reportSnapshotSchema.parse(snapshot);
    await tx.reportSnapshot.create({
      data: {
        id: valid.id,
        kind: valid.kind,
        organizationId: valid.organizationId,
        financial: valid.financial,
        createdById: userId,
        createdAt: new Date(valid.createdAt),
        snapshot: valid,
      },
    });
    if (valid.kind === 'PLATFORM')
      await tx.platformAuditEvent.create({
        data: {
          actorId: userId,
          action: 'PLATFORM_REPORT_CREATED',
          resourceId: valid.id,
          reason: 'Emissão de retrato agregado de atendimento.',
        },
      });
    else
      await tx.auditEvent.create({
        data: {
          organizationId: valid.organizationId,
          actorId: userId,
          action: 'REPORT_SNAPSHOT_CREATED',
          resourceId: valid.id,
          resourceType: 'report',
        },
      });
    return valid;
  }
  async create(scope: Scope, input: CreateTenantReport) {
    return this.database.client.$transaction(
      async (tx) => {
        const descriptor = {
          organizationId: scope.organizationId,
          kind: input.kind,
          financial: input.includeFinancial,
          nominal: input.kind === 'PEOPLE' && input.includeDetails,
        };
        await this.authorize(tx, scope.userId, descriptor);
        const org = await tx.organization.findUniqueOrThrow({
          where: { id: scope.organizationId },
        });
        const now = new Date(),
          today = referenceDate(org.timezone, now);
        const unit = input.unitId
          ? await tx.unit.findFirst({
              where: { organizationId: org.id, id: input.unitId },
              select: { name: true },
            })
          : null;
        if (input.unitId && !unit) throw new NotFoundException();
        const sector = input.sectorId
          ? await tx.sector.findFirst({
              where: { organizationId: org.id, id: input.sectorId },
              select: { name: true, unitId: true, unit: { select: { name: true } } },
            })
          : null;
        if (input.sectorId && !sector) throw new NotFoundException();
        if (input.unitId && sector && sector.unitId !== input.unitId)
          throw new BadRequestException();
        const filters = [
          { label: 'Unidade', value: unit?.name ?? sector?.unit.name ?? 'Todas' },
          { label: 'Setor', value: sector?.name ?? 'Todos' },
        ];
        let sections: ReportSection[], limitations: string[];
        if (input.kind === 'SST') {
          sections = await captureSst(tx, org.id, input);
          if (input.sectionKeys)
            sections = sections.filter((section) => input.sectionKeys!.includes(section.key));
          limitations = [
            'Retrato documental no instante da emissão; não certifica conformidade legal.',
            'Não inclui respostas individuais, dados financeiros de RH ou conteúdo binário das evidências.',
            'Pareceres e encerramentos são históricos; consulte a situação atual na aplicação antes de uma decisão.',
          ];
        } else {
          const data = await this.people.overview(
            scope,
            {
              unitId: input.unitId,
              sectorId: input.sectorId,
              isActive: input.isActive,
              competence: input.competence,
            },
            { transaction: tx, now, includeFinancial: input.includeFinancial },
          );
          sections = hrSections(data, input.includeFinancial);
          if (input.sectionKeys)
            sections = sections.filter((section) => input.sectionKeys!.includes(section.key));
          limitations = input.includeFinancial
            ? [...data.settlementPolicy.limitations]
            : ['Emissão de indicadores organizacionais e demográficos com proteção por setor.'];
          filters.push(
            {
              label: 'Situação dos cadastros',
              value:
                input.isActive === undefined
                  ? 'Todos'
                  : input.isActive === 'true'
                    ? 'Ativos'
                    : 'Inativos',
            },
            { label: 'Competência de remuneração', value: data.competence },
          );
          if (input.includeDetails)
            sections.push(...(await this.nominalPeople(tx, scope.organizationId, input, today)));
          if (!input.includeFinancial)
            limitations.push(
              'Seções financeiras não foram solicitadas e não integram esta emissão.',
            );
        }
        return this.persist(tx, scope.userId, {
          id: randomUUID(),
          ...descriptor,
          createdAt: now.toISOString(),
          referenceDate: today,
          timeZone: org.timezone,
          title: input.kind === 'SST' ? 'Gestão de riscos ocupacionais' : 'Gestão de Pessoas',
          context:
            org.name +
            ' · CNPJ ' +
            (org.normalizedFiscalIdentifier ?? org.fiscalIdentifier ?? 'não informado'),
          filters,
          sections,
          limitations,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10_000 },
    );
  }
  private async nominalPeople(
    tx: Prisma.TransactionClient,
    organizationId: string,
    input: CreateTenantReport,
    today: string,
  ): Promise<ReportSection[]> {
    const where: Prisma.EmployeeWhereInput = {
      organizationId,
      unitId: input.unitId,
      sectorId: input.sectorId,
      ...(input.isActive !== undefined ? { isActive: input.isActive === 'true' } : {}),
    };
    if ((await tx.employee.count({ where })) > 1000) throw new ReportScopeTooLargeException();
    const items = await tx.employee.findMany({
      where,
      take: 1001,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        name: true,
        internalIdentifier: true,
        isActive: true,
        unit: { select: { name: true } },
        sector: { select: { name: true } },
        hrProfile: {
          select: {
            birthDate: true,
            gender: true,
            genderDescription: true,
            vacationHistoryKnown: true,
            source: true,
          },
        },
        employmentPeriods: {
          orderBy: { startsOn: 'desc' },
          take: 101,
          select: { startsOn: true, endsOn: true, source: true },
        },
        ...(input.includeFinancial
          ? {
              remunerations: {
                where: { competence: input.competence ?? today.slice(0, 7) },
                select: { salaryCents: true, remunerationType: true, source: true },
              },
            }
          : {}),
      },
    });
    if (items.some((r) => r.employmentPeriods.length > 100))
      throw new ReportScopeTooLargeException();
    const sections: ReportSection[] = [
      {
        key: 'nominal-employees',
        title: 'Mapeamento nominal autorizado',
        columns: [
          'Colaborador / cadastro',
          'Unidade / setor',
          'Perfil autodeclarado',
          'Vínculos e fonte',
        ],
        rows: items.map((r) => [
          r.name +
            '\nIdentificação interna: ' +
            (r.internalIdentifier ?? 'Não informada') +
            '\n' +
            (r.isActive ? 'Ativo' : 'Inativo'),
          r.unit.name + ' / ' + r.sector.name,
          'Nascimento: ' +
            (r.hrProfile?.birthDate?.toISOString().slice(0, 10) ?? 'Não informado') +
            '\nGênero: ' +
            (r.hrProfile?.genderDescription ?? r.hrProfile?.gender ?? 'Não informado') +
            '\nFonte: ' +
            (r.hrProfile?.source ?? 'Não informada'),
          r.employmentPeriods
            .map(
              (p) =>
                p.startsOn.toISOString().slice(0, 10) +
                ' a ' +
                (p.endsOn?.toISOString().slice(0, 10) ?? 'sem encerramento') +
                ' · ' +
                p.source,
            )
            .join('\n') || 'Histórico não informado',
        ]),
        notes: ['Contém dados nominais. A consulta e o download exigem concessão atual de RH.'],
      },
    ];
    if (input.includeFinancial)
      sections.push({
        key: 'nominal-compensation',
        title: 'Remuneração nominal na competência',
        columns: ['Colaborador', 'Salário-base mensal bruto', 'Conceito / fonte'],
        rows: items.map((r) => {
          const salary =
            'remunerations' in r
              ? (
                  r.remunerations as {
                    salaryCents: bigint;
                    remunerationType: string;
                    source: string;
                  }[]
                )[0]
              : undefined;
          return [
            r.name,
            salary ? money(salary.salaryCents.toString()) : 'Não informado',
            salary
              ? salary.remunerationType + ' · ' + salary.source
              : 'Não há remuneração registrada nesta competência.',
          ];
        }),
        notes: [
          'Valores ausentes não foram substituídos por zero. Sem cálculo líquido ou encargos.',
        ],
      });
    return sections;
  }
  async createPlatform(userId: string, input: CreatePlatformReport) {
    return this.database.client.$transaction(
      async (tx) => {
        await this.platform.authorize(tx, userId, 'READ_OVERVIEW');
        const now = new Date(),
          overview = await this.platform.overview(userId, tx);
        const sections: ReportSection[] = [
          {
            key: 'platform-overview',
            title: 'Atendimento da plataforma',
            columns: ['Indicador', 'Cadastros'],
            rows: [
              [
                'Clientes com CNPJ validado e atendimento confirmado',
                String(overview.organizations),
              ],
              ['CNPJs distintos atendidos', String(overview.validatedCnpjs)],
              ['Clientes ativos', String(overview.activeClients)],
              ['Clientes inativos', String(overview.inactiveClients)],
              ['Cadastros sem classificação', String(overview.unclassified)],
              ['Demonstrações', String(overview.demonstrations)],
              ['Pendências fiscais', String(overview.pendingFiscal)],
              ['Cadastros ativos de colaboradores atendidos', String(overview.employees.active)],
              [
                'Cadastros inativos de colaboradores atendidos',
                String(overview.employees.inactive),
              ],
            ],
            notes: [
              'Resumo sobre todos os clientes elegíveis; a paginação do catálogo não muda estes totais.',
              'Demonstrações e clientes sem confirmação fiscal ficam fora dos totais de atendimento.',
            ],
          },
        ];
        if (input.includeDetails) {
          const first = await this.platform.clients(
            userId,
            { ...input, page: 1, pageSize: 100 },
            tx,
          );
          if (first.total > 500) throw new ReportScopeTooLargeException();
          const items = [...first.items];
          for (let page = 2; page <= Math.ceil(first.total / 100); page++)
            items.push(
              ...(await this.platform.clients(userId, { ...input, page, pageSize: 100 }, tx)).items,
            );
          sections.push({
            key: 'platform-clients',
            title: 'Catálogo no recorte solicitado',
            columns: [
              'Cliente / CNPJ',
              'Classificação / situação',
              'Colaboradores ativos',
              'Colaboradores inativos',
            ],
            rows: items.map((c) => [
              c.name +
                '\n' +
                (c.normalizedFiscalIdentifier ?? c.fiscalIdentifier ?? 'CNPJ não informado'),
              c.clientClassification +
                ' / ' +
                c.fiscalState +
                ' / ' +
                (c.isActive ? 'Ativo' : 'Inativo'),
              String(c.employees.active),
              String(c.employees.inactive),
            ]),
            notes: ['Não contém nomes, remuneração ou diagnóstico de colaboradores.'],
          });
        }
        return this.persist(tx, userId, {
          id: randomUUID(),
          kind: 'PLATFORM',
          organizationId: null,
          financial: false,
          nominal: false,
          title: 'Atendimento da plataforma',
          context: 'ReNR+ · Escopo global',
          createdAt: now.toISOString(),
          referenceDate: referenceDate('America/Sao_Paulo', now),
          timeZone: 'America/Sao_Paulo',
          filters: [
            {
              label: 'Detalhe do catálogo',
              value: input.includeDetails ? 'Incluído' : 'Não solicitado',
            },
            { label: 'Classificação do catálogo', value: input.classification ?? 'CLIENT' },
            { label: 'Busca do catálogo', value: input.search ?? 'Sem busca' },
            {
              label: 'Situação fiscal do catálogo',
              value: input.fiscalState ?? (input.classification ? 'Todas' : 'VALID'),
            },
            {
              label: 'Situação do catálogo',
              value:
                input.isActive === undefined
                  ? 'Todos'
                  : input.isActive === 'true'
                    ? 'Ativos'
                    : 'Inativos',
            },
          ],
          sections,
          limitations: [
            'Colaboradores são cadastros por cliente, sem deduplicação de pessoas entre CNPJs.',
            'O resumo global e o catálogo filtrado têm abrangências identificadas e distintas.',
          ],
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10_000 },
    );
  }
  private async readableReports(
    tx: Prisma.TransactionClient,
    userId: string,
    organizationId: string | null,
  ) {
    if (!organizationId) {
      await this.platform.authorize(tx, userId, 'READ_OVERVIEW');
      return Prisma.sql`organization_id IS NULL AND kind='PLATFORM'`;
    }
    const { hrCapabilities } = await this.member(tx, { userId, organizationId });
    const mayExport =
      hrCapabilities.includes('HR_EXPORT') &&
      hrCapabilities.includes('HR_ANALYTICS_READ') &&
      peopleDataAvailable(this.database, organizationId) &&
      canReadExactPeopleIndicators(this.database, organizationId, hrCapabilities);
    const financial =
      hrCapabilities.includes('HR_COMPENSATION_READ') ||
      hrCapabilities.includes('HR_COMPENSATION_MANAGE');
    const nominal =
      hrCapabilities.includes('HR_PROFILE_READ') || hrCapabilities.includes('HR_PROFILE_MANAGE');
    const people = mayExport
      ? Prisma.sql`OR (kind='PEOPLE'
      ${financial ? Prisma.empty : Prisma.sql`AND NOT financial`}
      ${nominal ? Prisma.empty : Prisma.sql`AND snapshot->>'nominal'='false'`})`
      : Prisma.empty;
    return Prisma.sql`organization_id=${organizationId}::uuid AND (kind='SST' ${people})`;
  }
  async list(userId: string, organizationId: string | null, page: Page) {
    return this.database.client.$transaction(
      async (tx) => {
        const where = await this.readableReports(tx, userId, organizationId);
        // Fetch display metadata only. A full page can reference up to 400 MiB of snapshots.
        const items = await tx.$queryRaw<
          Array<{
            id: string;
            kind: string;
            organizationId: string | null;
            financial: boolean;
            createdAt: Date;
            title: string;
            context: string;
          }>
        >(Prisma.sql`
        SELECT id,kind,organization_id "organizationId",financial,created_at "createdAt",
          snapshot->>'title' title,snapshot->>'context' context
        FROM report_snapshots WHERE ${where}
        ORDER BY created_at DESC,id DESC
        OFFSET ${(page.page - 1) * page.pageSize} LIMIT ${page.pageSize}`);
        const [count] = await tx.$queryRaw<{ total: number }[]>(Prisma.sql`
        SELECT count(*)::int total FROM report_snapshots WHERE ${where}`);
        return {
          items: items.map((item) =>
            reportSummarySchema.parse({ ...item, createdAt: item.createdAt.toISOString() }),
          ),
          total: count!.total,
          ...page,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async read(userId: string, organizationId: string | null, id: string) {
    return this.database.client.$transaction(
      async (tx) => {
        const where = await this.readableReports(tx, userId, organizationId);
        const [row] = await tx.$queryRaw<
          { kind: string; financial: boolean; snapshot: Prisma.JsonValue }[]
        >(Prisma.sql`
        SELECT kind,financial,snapshot FROM report_snapshots WHERE id=${id}::uuid AND ${where}`);
        if (!row) throw new NotFoundException();
        const snapshot = reportSnapshotSchema.parse(row.snapshot);
        if (
          snapshot.id !== id ||
          snapshot.organizationId !== organizationId ||
          snapshot.kind !== row.kind ||
          snapshot.financial !== row.financial
        )
          throw new NotFoundException();
        return snapshot;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async pdf(userId: string, organizationId: string | null, id: string) {
    const snapshot = await this.read(userId, organizationId, id);
    if (this.generating) throw new ReportGenerationBusyException();
    this.generating = true;
    const deadline = Date.now() + 30_000;
    try {
      const result = await renderReportPdf(snapshot, { deadline });
      if (Date.now() >= deadline) throw new ReportGenerationDeadlineException();
      await this.read(userId, organizationId, id);
      return result;
    } catch (error) {
      if (error instanceof ReportPdfLimitError) {
        if (Date.now() >= deadline) throw new ReportGenerationDeadlineException();
        throw new ReportScopeTooLargeException();
      }
      throw error;
    } finally {
      this.generating = false;
    }
  }
}
