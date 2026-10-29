import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  createEfficacyOpinionSchema,
  deriveEfficacyValidity,
  efficacyProofPackageSchema,
} from './action-efficacy';

const id = '10000000-0000-4000-8000-000000000001';
const hash = 'a'.repeat(64);
const proof = {
  reference: 'Collective record',
  description: 'Detailed collective evidence from a synthetic record.',
  rationale: 'The identified record supports this technical conclusion.',
};
const input = {
  expectedVersion: 3,
  expectedLatestOpinionId: null,
  expectedContextFingerprint: hash,
  result: 'EFFECTIVE',
  verifiedOn: '2026-10-26',
  observation: 'Synthetic review of collective work records.',
  rationale: 'Synthetic technical rationale supported by the identified record.',
  evidenceIds: [],
  textualEvidence: [proof],
};
const current = {
  isLatest: true,
  actionFingerprint: hash,
  opinionActionFingerprint: hash,
  riskContextFingerprint: hash,
  opinionRiskContextFingerprint: hash,
  originActive: true,
  selectedEvidence: [] as { available: boolean; archived: boolean; hashMatches: boolean }[],
};

describe('efficacy boundaries and validity', () => {
  it('accepts justified textual evidence without requiring an attachment or inventing a score', () => {
    expect(createEfficacyOpinionSchema.parse(input)).toEqual(input);
    expect(createEfficacyOpinionSchema.safeParse({ ...input, textualEvidence: [] }).success).toBe(
      false,
    );
    expect(
      createEfficacyOpinionSchema.safeParse({ ...input, textualEvidence: [], evidenceIds: [id] })
        .success,
    ).toBe(true);
  });
  it.each(['NOT_EFFECTIVE', 'INCONCLUSIVE'])('requires a concrete follow-up for %s', (result) => {
    expect(createEfficacyOpinionSchema.safeParse({ ...input, result }).success).toBe(false);
    expect(
      createEfficacyOpinionSchema.safeParse({
        ...input,
        result,
        nextSteps: 'Collect additional collective records before another review.',
      }).success,
    ).toBe(true);
  });
  it('rejects stale-token omissions, duplicate references, calendar errors and server-owned fields', () => {
    for (const patch of [
      { expectedLatestOpinionId: undefined },
      { expectedContextFingerprint: undefined },
      { expectedContextFingerprint: 'not-a-hash' },
      { expectedVersion: 0 },
      { textualEvidence: [proof, proof] },
      { evidenceIds: [id, id] },
      { verifiedOn: '2026-02-29' },
      { verifiedOn: '0000-01-01' },
      { authorId: id },
      { criterionReference: 'Injected criterion' },
      { proofPackage: {} },
      { textualEvidence: [{ ...proof, sha256: hash }] },
      { result: 'CLOSED' },
    ])
      expect(createEfficacyOpinionSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  });
  it('does not allow a textual proof to reuse the identity of an attachment', () => {
    expect(
      efficacyProofPackageSchema.safeParse({
        files: [
          {
            id,
            fileName: 'synthetic.pdf',
            description: 'Synthetic attachment',
            mimeType: 'application/pdf',
            size: 100,
            sha256: hash,
          },
        ],
        texts: [{ ...proof, id, sha256: hash }],
      }).success,
    ).toBe(false);
  });
  it('keeps absence of attachments independent from effectiveness and flags selected archived proof', () => {
    expect(deriveEfficacyValidity(current)).toEqual({ validity: 'CURRENT', reviewReasons: [] });
    expect(
      deriveEfficacyValidity({
        ...current,
        selectedEvidence: [{ available: true, archived: true, hashMatches: true }],
      }),
    ).toEqual({ validity: 'REVIEW_REQUIRED', reviewReasons: ['SELECTED_EVIDENCE_ARCHIVED'] });
    expect(deriveEfficacyValidity({ ...current, originActive: false })).toEqual({
      validity: 'REVIEW_REQUIRED',
      reviewReasons: ['ORIGIN_INACTIVE'],
    });
  });
  it('never revives a superseded opinion even when its proofs remain valid', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.array(
          fc.record({ available: fc.boolean(), archived: fc.boolean(), hashMatches: fc.boolean() }),
          { maxLength: 20 },
        ),
        (originActive, selectedEvidence) => {
          expect(
            deriveEfficacyValidity({ ...current, isLatest: false, originActive, selectedEvidence })
              .validity,
          ).toBe('SUPERSEDED');
        },
      ),
      { numRuns: 100 },
    );
  });
  it('a selected archived proof or changed context always prevents current validity', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20 }), fc.boolean(), (extraProofs, riskChanged) => {
        const selectedEvidence = Array.from({ length: extraProofs }, () => ({
          available: true,
          archived: false,
          hashMatches: true,
        }));
        const value = deriveEfficacyValidity({
          ...current,
          riskContextFingerprint: riskChanged ? 'b'.repeat(64) : hash,
          selectedEvidence: [
            ...selectedEvidence,
            { available: true, archived: true, hashMatches: true },
          ],
        });
        expect(value.validity).toBe('REVIEW_REQUIRED');
        expect(value.reviewReasons).toContain('SELECTED_EVIDENCE_ARCHIVED');
        expect(value.reviewReasons.includes('RISK_CONTEXT_CHANGED')).toBe(riskChanged);
      }),
      { numRuns: 100 },
    );
  });
});
