import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { compareTechnicalEvaluations, createRiskReassessmentSchema } from './risk-reassessments';
import {
  createTechnicalClosureSchema,
  createCorrectiveActionSchema,
  correctiveActionLinkSchema,
  technicalClosureSchema,
} from './action-technical-closures';

const id = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const hash = 'a'.repeat(64);
const measure = {
  actionId: id,
  expectedVersion: 4,
  opinionId: other,
  expectedContextFingerprint: hash,
  consideration: 'Explicit technical consideration of this collective measure.',
};
const evaluation = {
  expectedVersion: 3,
  methodVersionId: id,
  probabilityKey: 'p1',
  severityKey: 's1',
  rationale: 'Synthetic rationale for the configured method.',
  context: 'Synthetic collective context.',
  sources: [{ kind: 'RISK_RECORD', id }],
};
const reassessment = { expectedPreviousEvaluationId: id, evaluation, measures: [measure] };
const closure = {
  expectedVersion: 4,
  expectedRiskVersion: 5,
  expectedLatestEvaluationId: id,
  expectedLatestClosureId: null,
  expectedContextFingerprint: hash,
  reassessmentId: id,
  opinionId: other,
  rationale: 'The effective opinion and linked reassessment support the technical decision.',
};

describe('risk continuity boundaries', () => {
  it('distinguishes absence of baseline from a comparable exact method version', () => {
    const a = { method: { versionId: id } };
    expect(compareTechnicalEvaluations(null, a)).toBe('NO_BASELINE');
    expect(compareTechnicalEvaluations(a, null)).toBe('NO_BASELINE');
    expect(compareTechnicalEvaluations(a, a)).toBe('COMPARABLE');
    expect(compareTechnicalEvaluations(a, { method: { versionId: other } })).toBe(
      'METHOD_VERSION_CHANGED',
    );
  });
  it('does not infer equivalence from labels or order for arbitrary version identifiers', () => {
    fc.assert(
      fc.property(fc.uuid(), fc.uuid(), (left, right) => {
        expect(
          compareTechnicalEvaluations(
            { method: { versionId: left } },
            { method: { versionId: right } },
          ),
        ).toBe(left === right ? 'COMPARABLE' : 'METHOD_VERSION_CHANGED');
      }),
      { numRuns: 100 },
    );
  });
  it('requires an explicit predecessor and one to twenty distinct measures with complete concurrency tokens', () => {
    expect(createRiskReassessmentSchema.parse(reassessment)).toEqual(reassessment);
    for (const candidate of [
      { ...reassessment, expectedPreviousEvaluationId: undefined },
      { ...reassessment, measures: [] },
      { ...reassessment, measures: [measure, measure] },
      { ...reassessment, measures: Array.from({ length: 21 }, () => measure) },
      { ...reassessment, measures: [{ ...measure, expectedContextFingerprint: undefined }] },
      { ...reassessment, measures: [{ ...measure, consideration: 'Vague' }] },
      { ...reassessment, authorId: id },
    ])
      expect(createRiskReassessmentSchema.safeParse(candidate).success).toBe(false);
  });
  it('requires every closure precondition and rejects client-owned proof or author injection', () => {
    expect(createTechnicalClosureSchema.parse(closure)).toEqual(closure);
    for (const key of Object.keys(closure))
      expect(createTechnicalClosureSchema.safeParse({ ...closure, [key]: undefined }).success).toBe(
        false,
      );
    for (const patch of [
      { expectedVersion: 0 },
      { expectedContextFingerprint: 'bad' },
      { authorId: id },
      { proofPackage: {} },
      { result: 'EFFECTIVE' },
    ])
      expect(createTechnicalClosureSchema.safeParse({ ...closure, ...patch }).success).toBe(false);
  });
  it('requires a separate corrective action command rather than rewriting the terminal action', () => {
    const payload = {
      expectedVersion: 4,
      opinionId: other,
      expectedContextFingerprint: hash,
      reason: 'The technical review motivates a separate corrective measure.',
      action: {
        expectedRiskVersion: 5,
        title: 'New corrective measure',
        description: 'New collective corrective description.',
        responsibleName: 'External responsible',
        dueDate: '2026-12-20',
        expectedResult: 'Collective expected improvement.',
        verificationCriterion: 'Compare collective records.',
      },
    };
    expect(createCorrectiveActionSchema.parse(payload)).toEqual(payload);
    expect(
      createCorrectiveActionSchema.safeParse({
        ...payload,
        action: { ...payload.action, status: 'IMPLEMENTED' },
      }).success,
    ).toBe(false);
    expect(
      correctiveActionLinkSchema.safeParse({
        id,
        organizationId: id,
        riskId: id,
        previousActionId: id,
        newActionId: id,
        opinionId: other,
        reason: payload.reason,
        author: { id, name: 'Synthetic technician' },
        createdAt: '2026-10-27T12:00:00.000Z',
      }).success,
    ).toBe(false);
  });
  it('requires explicit reasons exactly when the preserved closure needs review', () => {
    const row = {
      id,
      organizationId: id,
      riskId: id,
      actionId: id,
      sequence: 1,
      supersedesId: null,
      reassessmentId: id,
      opinionId: other,
      actionVersion: 4,
      riskVersion: 5,
      actionFingerprint: hash,
      riskContextFingerprint: hash,
      contextFingerprint: hash,
      proofPackage: {
        files: [],
        texts: [
          {
            id,
            reference: 'Collective record',
            description: 'Synthetic identified collective evidence.',
            rationale: 'The identified record supports this conclusion.',
            sha256: hash,
          },
        ],
      },
      rationale: closure.rationale,
      author: { id, name: 'Synthetic technician' },
      createdAt: '2026-10-27T12:00:00.000Z',
      validity: 'CURRENT',
      reviewReasons: [],
    };
    expect(technicalClosureSchema.parse(row)).toEqual(row);
    expect(technicalClosureSchema.safeParse({ ...row, validity: 'REVIEW_REQUIRED' }).success).toBe(
      false,
    );
    expect(
      technicalClosureSchema.safeParse({
        ...row,
        validity: 'REVIEW_REQUIRED',
        reviewReasons: ['SELECTED_EVIDENCE_ARCHIVED'],
      }).success,
    ).toBe(true);
    expect(
      technicalClosureSchema.safeParse({ ...row, reviewReasons: ['SELECTED_EVIDENCE_ARCHIVED'] })
        .success,
    ).toBe(false);
  });
});
