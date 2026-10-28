import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  methodDefinitionSchema,
  methodDefinitionDraftSchema,
  publishEvaluationMethodSchema,
  resolveEvaluationMethodCell,
  type MethodDefinition,
} from './evaluation-methods';
import { createTechnicalRiskEvaluationSchema } from './risk-workspaces';
const definition = (p: number, s: number): MethodDefinition => ({
  probability: Array.from({ length: p }, (_, i) => ({
    key: `p${i}`,
    label: `Occurrence ${i}`,
    description: '',
    position: i + 1,
  })),
  severity: Array.from({ length: s }, (_, i) => ({
    key: `s${i}`,
    label: `Consequence ${i}`,
    description: '',
    position: i + 1,
  })),
  levels: [
    { key: 'watch', label: 'Technical follow-up' },
    { key: 'intervene', label: 'Technical intervention' },
  ],
  priorities: [
    { key: 'later', label: 'Planned', rank: 2 },
    { key: 'now', label: 'Prioritized', rank: 1 },
  ],
  matrix: Array.from({ length: p }, (_, i) =>
    Array.from({ length: s }, (_, j) => ({
      probabilityKey: `p${i}`,
      severityKey: `s${j}`,
      levelKey: j === 0 ? 'intervene' : 'watch',
      priorityKey: i === 0 ? 'later' : 'now',
    })),
  ).flat(),
});
describe('explicit versioned evaluation definitions', () => {
  it('supports a non-square matrix and uses the configured cell instead of a score formula', () => {
    const value = methodDefinitionSchema.parse(definition(2, 3));
    expect(resolveEvaluationMethodCell(value, 'p0', 's0')).toEqual({
      probability: { key: 'p0', label: 'Occurrence 0' },
      severity: { key: 's0', label: 'Consequence 0' },
      level: { key: 'intervene', label: 'Technical intervention' },
      priority: { key: 'later', label: 'Planned', rank: 2 },
    });
    expect(resolveEvaluationMethodCell(value, 'unknown', 's0')).toBeNull();
  });
  it('keeps incomplete definitions as drafts but does not publish them', () => {
    const value = definition(2, 3);
    value.matrix.pop();
    expect(methodDefinitionDraftSchema.safeParse(value).success).toBe(true);
    expect(methodDefinitionSchema.safeParse(value).success).toBe(false);
    expect(
      publishEvaluationMethodSchema.safeParse({ expectedRevision: 1, approvalReference: ' ' })
        .success,
    ).toBe(false);
  });
  it('rejects duplicate pairs, unknown references, duplicate ranks and executable extras', () => {
    const value = definition(2, 3);
    expect(
      methodDefinitionSchema.safeParse({ ...value, matrix: [...value.matrix, value.matrix[0]] })
        .success,
    ).toBe(false);
    expect(
      methodDefinitionSchema.safeParse({
        ...value,
        matrix: value.matrix.map((cell, i) => (i ? cell : { ...cell, levelKey: 'missing' })),
      }).success,
    ).toBe(false);
    expect(
      methodDefinitionSchema.safeParse({
        ...value,
        priorities: value.priorities.map((item) => ({ ...item, rank: 1 })),
      }).success,
    ).toBe(false);
    expect(
      methodDefinitionSchema.safeParse({ ...value, formula: 'probability * severity' }).success,
    ).toBe(false);
  });
  it('accepts complete variable-size matrices and rejects a removed cell for every generated shape', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 12 }), (p, s) => {
        const value = definition(p, s);
        expect(methodDefinitionSchema.safeParse(value).success).toBe(true);
        expect(
          methodDefinitionSchema.safeParse({ ...value, matrix: value.matrix.slice(1) }).success,
        ).toBe(false);
        const selected = value.matrix.at(-1)!;
        expect(
          resolveEvaluationMethodCell(value, selected.probabilityKey, selected.severityKey),
        ).toEqual(
          resolveEvaluationMethodCell(
            {
              ...value,
              matrix: [...value.matrix].reverse(),
              probability: [...value.probability].reverse(),
            },
            selected.probabilityKey,
            selected.severityKey,
          ),
        );
      }),
      { numRuns: 100 },
    );
  });
  it('does not accept a client-assigned result, author or duplicated source', () => {
    const id = '10000000-0000-4000-8000-000000000001';
    const body = {
      expectedVersion: 1,
      methodVersionId: id,
      probabilityKey: 'p0',
      severityKey: 's0',
      rationale: 'Justified local synthetic example',
      context: 'Context recorded for local verification',
      sources: [{ kind: 'RISK_RECORD', id }],
    };
    expect(createTechnicalRiskEvaluationSchema.safeParse(body).success).toBe(true);
    expect(createTechnicalRiskEvaluationSchema.safeParse({ ...body, result: 'low' }).success).toBe(
      false,
    );
    expect(
      createTechnicalRiskEvaluationSchema.safeParse({
        ...body,
        sources: [...body.sources, ...body.sources],
      }).success,
    ).toBe(false);
  });
});
