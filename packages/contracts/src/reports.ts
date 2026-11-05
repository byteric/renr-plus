import { z } from 'zod';
import { competenceSchema, hrListSchema, hrPaginationSchema } from './people-analytics';
import { platformQuerySchema } from './platform-administration';
export const reportKindSchema = z.enum(['SST', 'PEOPLE', 'PLATFORM']);
export const sstReportSectionLabels = {
  inventory: 'Inventário de riscos',
  'technical-evaluations': 'Avaliações técnicas',
  preliminary: 'Avaliações preliminares',
  actions: 'Plano de ação',
  evidence: 'Evidências referenciadas',
  efficacy: 'Pareceres de eficácia',
  reassessments: 'Reavaliações',
  closures: 'Encerramentos técnicos',
  history: 'Histórico',
  diagnostics: 'Diagnóstico agregado',
  'diagnostic-questions': 'Distribuições coletivas',
  'assessment-sources': 'Fontes documentadas',
  'demonstration-cycles': 'Ciclos demonstrativos',
} as const;
export const peopleReportSectionLabels = {
  'people-population': 'Abrangência do cadastro',
  'people-metrics': 'Indicadores de Gestão de Pessoas',
  'people-gender': 'Gênero autodeclarado',
  'people-age': 'Faixas etárias',
  'people-tenure': 'Tempo de vínculo',
  'people-vacation': 'Situação de férias',
  'people-unit': 'Distribuição por unidade',
  'people-sector': 'Distribuição por setor',
} as const;
export const createTenantReportSchema = z
  .object({
    kind: z.enum(['SST', 'PEOPLE']),
    unitId: z.uuid().optional(),
    sectorId: z.uuid().optional(),
    isActive: z.enum(['true', 'false']).optional(),
    competence: competenceSchema.optional(),
    includeDetails: z.boolean().default(false),
    includeFinancial: z.boolean().default(false),
    sectionKeys: z
      .array(z.string().min(1).max(60))
      .min(1)
      .max(13)
      .refine((keys) => new Set(keys).size === keys.length, 'Selecione cada seção uma vez.')
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.kind === 'PEOPLE' ||
      (!value.includeFinancial &&
        !value.includeDetails &&
        value.competence === undefined &&
        value.isActive === undefined),
    'Competência, situação cadastral e opções de RH pertencem a Gestão de Pessoas.',
  )
  .refine(
    (value) =>
      value.sectionKeys?.every((key) =>
        Object.hasOwn(
          value.kind === 'SST' ? sstReportSectionLabels : peopleReportSectionLabels,
          key,
        ),
      ) ?? true,
    'Selecione seções do tipo de relatório escolhido.',
  );
export const createPlatformReportSchema = platformQuerySchema
  .omit({ page: true, pageSize: true })
  .extend({
    includeDetails: z.boolean().default(false),
  })
  .strict();
export const reportSectionSchema = z
  .object({
    key: z.string(),
    title: z.string(),
    columns: z.array(z.string()).min(1).max(8),
    rows: z.array(z.array(z.string())),
    notes: z.array(z.string()),
  })
  .strict();
export const reportSnapshotSchema = z
  .object({
    id: z.uuid(),
    kind: reportKindSchema,
    organizationId: z.uuid().nullable(),
    financial: z.boolean(),
    nominal: z.boolean(),
    createdAt: z.iso.datetime(),
    referenceDate: z.iso.date(),
    timeZone: z.string(),
    title: z.string(),
    context: z.string(),
    filters: z.array(z.object({ label: z.string(), value: z.string() }).strict()),
    sections: z.array(reportSectionSchema),
    limitations: z.array(z.string()),
  })
  .strict();
export const reportSummarySchema = reportSnapshotSchema.pick({
  id: true,
  kind: true,
  organizationId: true,
  financial: true,
  createdAt: true,
  title: true,
  context: true,
});
export const reportListSchema = hrListSchema(reportSummarySchema);
export const reportQuerySchema = hrPaginationSchema;
export type ReportSnapshot = z.infer<typeof reportSnapshotSchema>;
export type ReportSection = z.infer<typeof reportSectionSchema>;
export type CreateTenantReport = z.infer<typeof createTenantReportSchema>;
export type CreatePlatformReport = z.infer<typeof createPlatformReportSchema>;
