import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as c from './index';
const id = '11111111-1111-4111-8111-111111111111';
describe('assessment contracts', () => {
  it('exports strict participation, policy and collection schemas', () => {
    expect(c).toHaveProperty('assessmentCycleSchema');
    expect(c).toHaveProperty('submitAssessmentResponseSchema');
    expect(c).toHaveProperty('consolidationPolicySchema');
  });
  it('never supplies a REAL threshold and fixes demonstration to five', () => {
    expect(c.createConsolidationPolicySchema.safeParse({ usageMode: 'REAL' }).success).toBe(false);
    expect(
      c.createConsolidationPolicySchema.parse({ usageMode: 'REAL', minimumResponses: null })
        .minimumResponses,
    ).toBeNull();
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 1000 }), (threshold) => {
        expect(
          c.createConsolidationPolicySchema.safeParse({
            usageMode: 'DEMONSTRATION',
            minimumResponses: threshold,
          }).success,
        ).toBe(threshold === 5);
      }),
    );
  });
  it('rejects duplicated answers before canonicalization and requires ephemeral secret', () => {
    const payload = {
      inviteCode: 'a'.repeat(43),
      instrumentVersionId: id,
      submissionSecret: 'b'.repeat(43),
      answers: [{ questionId: id, optionIds: [id] }],
    };
    expect(c.submitAssessmentResponseSchema.safeParse(payload).success).toBe(true);
    expect(
      c.submitAssessmentResponseSchema.safeParse({
        ...payload,
        answers: [...payload.answers, ...payload.answers],
      }).success,
    ).toBe(false);
    expect(
      c.submitAssessmentResponseSchema.safeParse({
        ...payload,
        answers: [{ questionId: id, optionIds: [id, id] }],
      }).success,
    ).toBe(false);
    expect(
      c.submitAssessmentResponseSchema.safeParse({ ...payload, submissionSecret: '' }).success,
    ).toBe(false);
    expect(
      c.createAssessmentSourceSchema.safeParse({
        kind: 'OBSERVATION',
        context: 'Collective',
        summary: 'Collective',
        occurredOn: '2026-02-30',
      }).success,
    ).toBe(false);
  });
});

describe('assessment projection privacy boundary', () => {
  const node = {
    id,
    name: 'Protected',
    nodeType: 'CYCLE' as const,
    availability: 'SUPPRESSED' as const,
    responseCount: null,
    questions: [],
    children: [],
  };
  it('rejects counts or distributions attached to protected nodes', () => {
    expect(c.assessmentResultNodeSchema.safeParse({ ...node, responseCount: 1 }).success).toBe(
      false,
    );
    const question = {
      id,
      label: 'Protected',
      type: 'SINGLE_CHOICE',
      required: true,
      availability: 'SUPPRESSED',
      answerCount: null,
      options: [],
    };
    expect(
      c.assessmentQuestionResultSchema.safeParse({ ...question, answerCount: 1 }).success,
    ).toBe(false);
    expect(
      c.assessmentQuestionResultSchema.safeParse({
        ...question,
        options: [{ id, label: 'Cell', count: 1, percentage: 100 }],
      }).success,
    ).toBe(false);
    expect(
      c.assessmentResultNodeSchema.safeParse({
        ...node,
        questions: [
          {
            ...question,
            availability: 'AVAILABLE',
            answerCount: 10,
            options: [{ id, label: 'Cell', count: 10, percentage: 100 }],
          },
        ],
      }).success,
    ).toBe(false);
  });
});
