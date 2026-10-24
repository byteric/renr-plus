import { z } from 'zod';

export const DEMO_MINIMUM_RESPONSES = 5;
export const DIAGNOSTIC_DEMO_NOTICE =
  'Demonstração — use somente dados fictícios; instrumento não validado';

const questionType = z.enum(['SINGLE_CHOICE', 'MULTIPLE_CHOICE']);
const optionSchema = z
  .object({ id: z.uuid(), label: z.string().min(1), position: z.number().int().min(1) })
  .strict();
export const diagnosticQuestionSchema = z
  .object({
    id: z.uuid(),
    label: z.string().min(1),
    type: questionType,
    required: z.literal(true),
    position: z.number().int().min(1),
    options: z.array(optionSchema).min(2).max(20),
  })
  .strict();
export const diagnosticInstrumentSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    title: z.string().min(1),
    version: z.number().int().min(1),
    status: z.literal('PUBLISHED'),
    isDemo: z.literal(true),
    questions: z.array(diagnosticQuestionSchema).length(5),
  })
  .strict();
export const createDiagnosticCycleSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    sectorId: z.uuid(),
    instrumentVersionId: z.uuid(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
  })
  .strict()
  .refine((cycle) => Date.parse(cycle.startsAt) < Date.parse(cycle.endsAt), {
    path: ['endsAt'],
    message: 'O término deve ser posterior ao início.',
  });
export const diagnosticCycleSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    name: z.string(),
    sectorId: z.uuid(),
    sectorName: z.string(),
    unitId: z.uuid(),
    unitName: z.string(),
    instrumentVersionId: z.uuid(),
    instrumentTitle: z.string(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    status: z.enum(['DRAFT', 'OPEN', 'CLOSED']),
    createdAt: z.iso.datetime(),
    closedAt: z.iso.datetime().nullable(),
  })
  .strict();
export const diagnosticCycleListSchema = z
  .object({
    items: z.array(diagnosticCycleSchema),
    total: z.number().int().min(0),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
  })
  .strict();
export const createParticipationInvitesSchema = z
  .object({
    count: z.number().int().min(1).max(20).default(1),
  })
  .strict();
export const participationInvitesSchema = z
  .object({
    cycleId: z.uuid(),
    participationPath: z.literal('/#/participar'),
    invites: z
      .array(
        z
          .object({ code: z.string().regex(/^[A-Za-z0-9_-]{43}$/), expiresAt: z.iso.datetime() })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();
export const participationAccessSchema = z
  .object({
    inviteCode: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();
export const participationInstrumentSchema = z
  .object({
    cycleName: z.string(),
    endsAt: z.iso.datetime(),
    instrument: diagnosticInstrumentSchema,
  })
  .strict();
const answerSchema = z
  .object({
    questionId: z.uuid(),
    optionIds: z
      .array(z.uuid())
      .min(1)
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length, 'Não repita opções.'),
  })
  .strict();
export const submitDiagnosticResponseSchema = participationAccessSchema
  .extend({
    instrumentVersionId: z.uuid(),
    answers: z
      .array(answerSchema)
      .min(1)
      .max(5)
      .refine(
        (answers) => new Set(answers.map((answer) => answer.questionId)).size === answers.length,
        'Não repita perguntas.',
      ),
  })
  .strict();
export const diagnosticSubmissionSchema = z.object({ status: z.literal('accepted') }).strict();

const resultQuestionSchema = z
  .object({
    id: z.uuid(),
    label: z.string(),
    type: questionType,
    suppressed: z.boolean(),
    options: z.array(
      z
        .object({
          id: z.uuid(),
          label: z.string(),
          count: z.number().int().min(0),
          percentage: z.number().min(0).max(100),
        })
        .strict(),
    ),
  })
  .strict()
  .refine(
    (question) =>
      question.suppressed
        ? question.options.length === 0
        : question.options.every(
            (option) => option.count === 0 || option.count >= DEMO_MINIMUM_RESPONSES,
          ),
    'Distribuições pequenas devem ser suprimidas.',
  );
export const diagnosticResultsSchema = z
  .object({
    cycleId: z.uuid(),
    availability: z.enum(['AVAILABLE', 'CYCLE_OPEN', 'INSUFFICIENT_RESPONSES']),
    responseCount: z.number().int().min(DEMO_MINIMUM_RESPONSES).nullable(),
    minimumResponses: z.literal(DEMO_MINIMUM_RESPONSES),
    questions: z.array(resultQuestionSchema),
  })
  .strict()
  .refine(
    (result) =>
      result.availability === 'AVAILABLE'
        ? result.responseCount !== null
        : result.responseCount === null && result.questions.length === 0,
    'Resultado indisponível não revela contagens.',
  );

export type DiagnosticInstrument = z.infer<typeof diagnosticInstrumentSchema>;
export type DiagnosticQuestion = z.infer<typeof diagnosticQuestionSchema>;
export type CreateDiagnosticCycle = z.infer<typeof createDiagnosticCycleSchema>;
export type DiagnosticCycle = z.infer<typeof diagnosticCycleSchema>;
export type DiagnosticCycleList = z.infer<typeof diagnosticCycleListSchema>;
export type CreateParticipationInvites = z.infer<typeof createParticipationInvitesSchema>;
export type ParticipationInvites = z.infer<typeof participationInvitesSchema>;
export type ParticipationAccess = z.infer<typeof participationAccessSchema>;
export type ParticipationInstrument = z.infer<typeof participationInstrumentSchema>;
export type SubmitDiagnosticResponse = z.infer<typeof submitDiagnosticResponseSchema>;
export type DiagnosticSubmission = z.infer<typeof diagnosticSubmissionSchema>;
export type DiagnosticResults = z.infer<typeof diagnosticResultsSchema>;
