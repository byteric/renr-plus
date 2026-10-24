import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { instrumentPublicationIssues, updateInstrumentDraftSchema } from './instruments';
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const document = (labels: string[]) => ({
  expectedRevision: 1,
  title: '',
  description: '',
  instructions: '',
  usageMode: 'DEMONSTRATION' as const,
  questions: labels.map((label, i) => ({
    id: uuid(i * 3 + 1),
    label,
    type: 'ORDINAL_CHOICE' as const,
    required: false,
    position: i + 1,
    options: [
      { id: uuid(i * 3 + 2), label: '', position: 1 },
      { id: uuid(i * 3 + 3), label: '', position: 2 },
    ],
  })),
});
describe('Instrument draft and publication rules', () => {
  it('saves incomplete drafts but identifies publication fields precisely', () => {
    const draft = updateInstrumentDraftSchema.parse(document(['']));
    expect(instrumentPublicationIssues(draft).map((issue) => issue.field)).toEqual([
      'title',
      'questions.0.label',
      'questions.0.options.0.label',
      'questions.0.options.1.label',
    ]);
    expect(updateInstrumentDraftSchema.safeParse({ ...draft, score: 1 }).success).toBe(false);
  });
  it('preserves all content under reorder/renumber and JSON roundtrip', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ maxLength: 80 }), { maxLength: 30 }), (labels) => {
        const original = document(labels);
        const reordered = {
          ...original,
          questions: [...original.questions].reverse().map((q, i) => ({
            ...q,
            position: i + 1,
            options: [...q.options].reverse().map((o, j) => ({ ...o, position: j + 1 })),
          })),
        };
        const parsed = updateInstrumentDraftSchema.parse(JSON.parse(JSON.stringify(reordered)));
        expect(parsed.questions.map((q) => q.label)).toEqual([...labels].reverse());
        expect(
          new Set(parsed.questions.flatMap((q) => [q.id, ...q.options.map((o) => o.id)])).size,
        ).toBe(labels.length * 3);
      }),
      { numRuns: 100, seed: 7108 },
    );
  });
  it('rejects duplicated identities and missing positions for every generated document', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ maxLength: 80 }), { minLength: 2, maxLength: 30 }),
        (labels) => {
          const draft = document(labels);
          draft.questions[1]!.id = draft.questions[0]!.id;
          expect(updateInstrumentDraftSchema.safeParse(draft).success).toBe(false);
          const missing = document(labels);
          missing.questions[0]!.position = 2;
          expect(updateInstrumentDraftSchema.safeParse(missing).success).toBe(false);
        },
      ),
      { numRuns: 100, seed: 7109 },
    );
  });
});
