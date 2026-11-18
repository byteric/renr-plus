import fc from 'fast-check';
import { compareAssessmentRates } from '../src/modules/assessments/assessment-comparison.service';

describe('Assessment comparison privacy and arithmetic', () => {
  it('never publishes small changes in counts when both periods have individually safe values', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 5, max: 70 }),
        fc.integer({ min: 1, max: 4 }),
        (count, change) => {
          const reference = { positive: count, size: 100 };
          const changedCell = { ...reference, positive: count + change };
          const changedComplement = { positive: count + 5, size: 105 + change };
          expect(compareAssessmentRates(reference, changedCell, 5)).toEqual({
            status: 'PROTECTED',
          });
          expect(compareAssessmentRates(reference, changedComplement, 5)).toEqual({
            status: 'PROTECTED',
          });
        },
      ),
    );
  });

  it('preserves positive, negative and zero arithmetic without treating them as technical opinions', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 5, max: 65 }),
        fc.integer({ min: 5, max: 15 }),
        (count, change) => {
          const reference = { positive: count, size: 100 };
          const current = { ...reference, positive: count + change };
          expect(compareAssessmentRates(reference, current, 5)).toEqual({
            status: 'AVAILABLE',
            reference: count,
            current: count + change,
            difference: change,
            direction: 'INCREASE',
          });
          expect(compareAssessmentRates(current, reference, 5)).toMatchObject({
            difference: -change,
            direction: 'DECREASE',
          });
          expect(compareAssessmentRates(current, current, 5)).toMatchObject({
            difference: 0,
            direction: 'STABLE',
          });
        },
      ),
    );
  });
});
