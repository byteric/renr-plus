import { z } from 'zod';

export const evaluationMethodKeySchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/);
const revision = z.number().int().min(1).max(2147483647);
const author = z.object({ id: z.uuid(), name: z.string() }).strict();
const scaleItem = z
  .object({
    key: evaluationMethodKeySchema,
    label: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).default(''),
    position: z.number().int().min(1).max(20),
  })
  .strict();
const level = z
  .object({ key: evaluationMethodKeySchema, label: z.string().trim().min(1).max(120) })
  .strict();
const priority = level.extend({ rank: z.number().int().min(1).max(20) }).strict();
export const evaluationMethodCellSchema = z
  .object({
    probabilityKey: evaluationMethodKeySchema,
    severityKey: evaluationMethodKeySchema,
    levelKey: evaluationMethodKeySchema,
    priorityKey: evaluationMethodKeySchema,
  })
  .strict();
const definitionShape = z
  .object({
    probability: z.array(scaleItem).max(20),
    severity: z.array(scaleItem).max(20),
    levels: z.array(level).max(20),
    priorities: z.array(priority).max(20),
    matrix: z.array(evaluationMethodCellSchema).max(400),
  })
  .strict();
export const methodDefinitionDraftSchema = definitionShape.superRefine((value, ctx) => {
  for (const field of ['probability', 'severity', 'levels', 'priorities'] as const) {
    if (new Set(value[field].map((item) => item.key)).size !== value[field].length)
      ctx.addIssue({ code: 'custom', path: [field], message: 'Keys must be unique' });
  }
  for (const field of ['probability', 'severity'] as const) {
    if (new Set(value[field].map((item) => item.position)).size !== value[field].length)
      ctx.addIssue({ code: 'custom', path: [field], message: 'Positions must be unique' });
  }
  if (new Set(value.priorities.map((item) => item.rank)).size !== value.priorities.length)
    ctx.addIssue({
      code: 'custom',
      path: ['priorities'],
      message: 'Priority ranks must be unique',
    });
  const pairs = new Set<string>();
  for (const [index, cell] of value.matrix.entries()) {
    const pair = `${cell.probabilityKey}:${cell.severityKey}`;
    if (pairs.has(pair))
      ctx.addIssue({
        code: 'custom',
        path: ['matrix', index],
        message: 'Duplicate probability/severity pair',
      });
    pairs.add(pair);
    for (const [key, field] of [
      ['probabilityKey', 'probability'],
      ['severityKey', 'severity'],
      ['levelKey', 'levels'],
      ['priorityKey', 'priorities'],
    ] as const) {
      if (!value[field].some((item) => item.key === cell[key]))
        ctx.addIssue({
          code: 'custom',
          path: ['matrix', index, key],
          message: 'Unknown definition reference',
        });
    }
  }
});
export const methodDefinitionSchema = methodDefinitionDraftSchema.superRefine((value, ctx) => {
  for (const field of ['probability', 'severity', 'levels', 'priorities'] as const) {
    if (!value[field].length)
      ctx.addIssue({
        code: 'custom',
        path: [field],
        message: 'Published definitions cannot have empty scales or classifications',
      });
  }
  const pairs = new Set(value.matrix.map((cell) => `${cell.probabilityKey}:${cell.severityKey}`));
  for (const p of value.probability)
    for (const s of value.severity) {
      if (!pairs.has(`${p.key}:${s.key}`))
        ctx.addIssue({
          code: 'custom',
          path: ['matrix'],
          message: 'Every probability/severity pair requires an explicit cell',
        });
    }
  if (value.matrix.length !== value.probability.length * value.severity.length)
    ctx.addIssue({
      code: 'custom',
      path: ['matrix'],
      message: 'Matrix must contain exactly the configured pairs',
    });
});
export type MethodDefinition = z.infer<typeof methodDefinitionSchema>;
export function resolveEvaluationMethodCell(
  definition: MethodDefinition,
  probabilityKey: string,
  severityKey: string,
) {
  const cell = definition.matrix.find(
    (item) => item.probabilityKey === probabilityKey && item.severityKey === severityKey,
  );
  const p = definition.probability.find((item) => item.key === probabilityKey);
  const s = definition.severity.find((item) => item.key === severityKey);
  const l = definition.levels.find((item) => item.key === cell?.levelKey);
  const rank = definition.priorities.find((item) => item.key === cell?.priorityKey);
  if (!cell || !p || !s || !l || !rank) return null;
  return {
    probability: { key: p.key, label: p.label },
    severity: { key: s.key, label: s.label },
    level: { key: l.key, label: l.label },
    priority: { key: rank.key, label: rank.label, rank: rank.rank },
  };
}
const pageShape = {
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
};
const list = <T extends z.ZodType>(item: T) =>
  z
    .object({
      items: z.array(item),
      total: z.number().int().nonnegative(),
      page: z.number().int().min(1),
      pageSize: z.number().int().min(1).max(100),
    })
    .strict();
export const evaluationMethodQuerySchema = z
  .object({ ...pageShape, q: z.string().trim().max(120).optional() })
  .strict();
export const evaluationMethodVersionQuerySchema = z
  .object({
    ...pageShape,
    methodId: z.uuid().optional(),
    status: z.enum(['DRAFT', 'PUBLISHED']).optional(),
  })
  .strict();
export const evaluationMethodSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    name: z.string().min(3).max(160),
    createdBy: author,
    createdAt: z.iso.datetime(),
  })
  .strict();
export const evaluationMethodListSchema = list(evaluationMethodSchema);
export const evaluationMethodVersionSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    method: z.object({ id: z.uuid(), name: z.string() }).strict(),
    version: revision,
    revision,
    status: z.enum(['DRAFT', 'PUBLISHED']),
    title: z.string().min(3).max(160),
    description: z.string().max(2000),
    definition: methodDefinitionDraftSchema,
    approvalReference: z.string().trim().min(5).max(1000).nullable(),
    publishedBy: author.nullable(),
    publishedAt: z.iso.datetime().nullable(),
    createdBy: author,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.status === 'PUBLISHED' &&
      (!value.approvalReference ||
        !value.publishedBy ||
        !value.publishedAt ||
        !methodDefinitionSchema.safeParse(value.definition).success)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Published method requires complete definition and documented approval',
      });
  });
export const evaluationMethodVersionListSchema = list(evaluationMethodVersionSchema);
export const createEvaluationMethodSchema = z
  .object({
    name: z.string().trim().min(3).max(160),
    description: z.string().trim().max(2000).default(''),
  })
  .strict();
export const updateEvaluationMethodDraftSchema = z
  .object({
    expectedRevision: revision,
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().max(2000),
    definition: methodDefinitionDraftSchema,
  })
  .strict();
export const publishEvaluationMethodSchema = z
  .object({ expectedRevision: revision, approvalReference: z.string().trim().min(5).max(1000) })
  .strict();
export const forkEvaluationMethodSchema = z.object({ expectedRevision: revision }).strict();
export type EvaluationMethod = z.infer<typeof evaluationMethodSchema>;
export type EvaluationMethodVersion = z.infer<typeof evaluationMethodVersionSchema>;
export type CreateEvaluationMethodInput = z.infer<typeof createEvaluationMethodSchema>;
export type UpdateEvaluationMethodDraftInput = z.infer<typeof updateEvaluationMethodDraftSchema>;
export type PublishEvaluationMethodInput = z.infer<typeof publishEvaluationMethodSchema>;
export type ForkEvaluationMethodInput = z.infer<typeof forkEvaluationMethodSchema>;
export type EvaluationMethodQuery = z.infer<typeof evaluationMethodQuerySchema>;
export type EvaluationMethodVersionQuery = z.infer<typeof evaluationMethodVersionQuerySchema>;
