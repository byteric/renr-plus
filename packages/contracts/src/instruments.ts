import { z } from 'zod';

const usageMode = z.enum(['DEMONSTRATION', 'REAL']);
const question = z
  .object({
    id: z.uuid(),
    label: z.string().max(400),
    type: z.enum(['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'ORDINAL_CHOICE']),
    required: z.boolean(),
    position: z.number().int().min(1).max(100),
    options: z
      .array(
        z
          .object({
            id: z.uuid(),
            label: z.string().max(200),
            position: z.number().int().min(1).max(20),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
const draftFields = {
  title: z.string().max(160),
  description: z.string().max(2000),
  instructions: z.string().max(4000),
  usageMode,
  questions: z.array(question).max(100),
};
export const updateInstrumentDraftSchema = z
  .object({ expectedRevision: z.number().int().min(1).max(2147483647), ...draftFields })
  .strict()
  .superRefine((value, context) => {
    const ids = new Set<string>();
    value.questions.forEach((item, index) => {
      if (item.position !== index + 1)
        context.addIssue({
          code: 'custom',
          path: ['questions', index, 'position'],
          message: 'Positions must be contiguous from 1',
        });
      if (ids.has(item.id))
        context.addIssue({
          code: 'custom',
          path: ['questions', index, 'id'],
          message: 'Duplicate identity',
        });
      ids.add(item.id);
      item.options.forEach((option, optionIndex) => {
        if (option.position !== optionIndex + 1)
          context.addIssue({
            code: 'custom',
            path: ['questions', index, 'options', optionIndex, 'position'],
            message: 'Positions must be contiguous from 1',
          });
        if (ids.has(option.id))
          context.addIssue({
            code: 'custom',
            path: ['questions', index, 'options', optionIndex, 'id'],
            message: 'Duplicate identity',
          });
        ids.add(option.id);
      });
    });
  });
export const createInstrumentSchema = z
  .object({ name: z.string().trim().min(2).max(160) })
  .strict();
export const publishInstrumentSchema = z
  .object({
    expectedRevision: z.number().int().min(1).max(2147483647),
    approvalReference: z.string().trim().max(1000).optional(),
  })
  .strict();
export const forkInstrumentVersionSchema = z
  .object({ expectedRevision: z.number().int().min(1).max(2147483647) })
  .strict();
export const instrumentQuerySchema = z
  .object({
    search: z.string().trim().max(160).optional(),
    page: z.coerce.number().int().min(1).max(1000000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export const instrumentSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    name: z.string(),
    isLegacy: z.boolean(),
    createdAt: z.iso.datetime(),
  })
  .strict();
const summaryFields = {
  id: z.uuid(),
  organizationId: z.uuid(),
  instrumentId: z.uuid(),
  title: z.string(),
  version: z.number().int().min(1),
  revision: z.number().int().min(1),
  status: z.enum(['DRAFT', 'PUBLISHED']),
  usageMode,
  questionCount: z.number().int().min(0).max(100),
  approvalReference: z.string().nullable(),
  publishedAt: z.iso.datetime().nullable(),
  publishedById: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  cycleCount: z.number().int().min(0),
};
export const instrumentVersionSummarySchema = z.object(summaryFields).strict();
export const instrumentVersionSchema = z
  .object({
    ...summaryFields,
    description: z.string(),
    instructions: z.string(),
    questions: z.array(question),
  })
  .strict();
const list = <T extends z.ZodType>(item: T) =>
  z
    .object({
      items: z.array(item),
      total: z.number().int().min(0),
      page: z.number().int().min(1),
      pageSize: z.number().int().min(1).max(100),
    })
    .strict();
export const instrumentListSchema = list(instrumentSchema);
export const instrumentVersionListSchema = list(instrumentVersionSummarySchema);
export const createdInstrumentSchema = z
  .object({ instrument: instrumentSchema, version: instrumentVersionSchema })
  .strict();
export type Instrument = z.infer<typeof instrumentSchema>;
export type InstrumentVersion = z.infer<typeof instrumentVersionSchema>;
export type InstrumentVersionSummary = z.infer<typeof instrumentVersionSummarySchema>;
export type InstrumentQuestion = z.infer<typeof question>;
export type UpdateInstrumentDraft = z.infer<typeof updateInstrumentDraftSchema>;
export type InstrumentQuery = z.infer<typeof instrumentQuerySchema>;

export function instrumentPublicationIssues(
  input: Pick<UpdateInstrumentDraft, keyof typeof draftFields>,
): { field: string; message: string }[] {
  const issues: { field: string; message: string }[] = [];
  const required = (field: string, text: string) => {
    if (!text.trim()) issues.push({ field, message: 'Preencha este campo para publicar' });
  };
  required('title', input.title);
  if (input.questions.length === 0)
    issues.push({ field: 'questions', message: 'Adicione pelo menos uma pergunta' });
  input.questions.forEach((item, index) => {
    required(`questions.${index}.label`, item.label);
    if (item.options.length < 2)
      issues.push({
        field: `questions.${index}.options`,
        message: 'Adicione pelo menos duas opções',
      });
    item.options.forEach((option, optionIndex) =>
      required(`questions.${index}.options.${optionIndex}.label`, option.label),
    );
  });
  return issues;
}
