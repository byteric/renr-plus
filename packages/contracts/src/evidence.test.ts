import { describe, expect, it } from 'vitest';
import { evidenceUploadAttemptSchema, type EvidenceUploadAttempt } from './evidence';
const base: EvidenceUploadAttempt = {
  key: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
  actionId: '33333333-3333-4333-8333-333333333333',
  state: 'UNCERTAIN',
  attemptVersion: 1,
  description: 'Synthetic private attachment',
  fileName: 'fixture.pdf',
  mimeType: 'application/pdf',
  size: 10,
  sha256: 'a'.repeat(64),
  createdAt: '2026-10-28T00:00:00.000Z',
  updatedAt: '2026-10-28T00:00:00.000Z',
  leaseExpiresAt: null,
  currentActionVersion: 1,
  retryAllowed: false,
  objectState: 'UNKNOWN',
  evidence: null,
};
const evidence = {
  id: base.key,
  organizationId: base.organizationId,
  actionId: base.actionId,
  description: base.description,
  fileName: base.fileName,
  mimeType: base.mimeType,
  size: base.size,
  sha256: base.sha256,
  createdBy: { id: base.key, name: 'Synthetic actor' },
  createdAt: base.createdAt,
  archivedAt: null,
  archivedBy: null,
  archiveReason: null,
  actionVersion: 2,
};
describe('Recoverable evidence boundary', () => {
  it.each([
    { ...base, state: 'COMPLETED' },
    { ...base, evidence },
    { ...base, retryAllowed: true },
    { ...base, state: 'RETRYABLE', objectState: 'PRESENT', retryAllowed: true },
    {
      ...base,
      state: 'RETRYABLE',
      objectState: 'ABSENT',
      retryAllowed: true,
      leaseExpiresAt: '9999-01-01T00:00:00.000Z',
    },
    { ...base, state: 'COMPLETED', evidence: { ...evidence, actionId: base.key } },
    { ...base, state: 'COMPLETED', evidence: { ...evidence, organizationId: base.key } },
  ])('rejects contradictory recovery metadata %#', (value) => {
    expect(evidenceUploadAttemptSchema.safeParse(value).success).toBe(false);
  });
  it('accepts completed and confirmed retryable outcomes', () => {
    expect(
      evidenceUploadAttemptSchema.safeParse({ ...base, state: 'COMPLETED', evidence }).success,
    ).toBe(true);
    expect(
      evidenceUploadAttemptSchema.safeParse({
        ...base,
        state: 'RETRYABLE',
        objectState: 'ABSENT',
        retryAllowed: true,
      }).success,
    ).toBe(true);
  });
});
