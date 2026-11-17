import fc from 'fast-check';
import { companyGroupParticipation } from '../src/modules/company-groups/company-group-metrics';

type Period = Parameters<typeof companyGroupParticipation>[0][number];

function period(
  assessmentGroupId: string,
  minimum: number,
  eligible: number,
  responses: number,
  issued = eligible,
  position: 1 | 2 = 1,
): Period {
  const slot = position === 1 ? 3 : 1;
  return {
    organizationId: 'synthetic',
    assessmentGroupId,
    instrumentVersionId: 'instrument',
    policyVersionId: 'policy',
    startsAt: new Date(slot),
    effectiveEnd: new Date(slot + 1),
    eligible,
    responses,
    issued,
    minimum,
    position,
  };
}

describe('Group assessment privacy', () => {
  it('hides a numeric parent when any contributing sector has a protected count or complement', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 30 }),
        fc.integer({ min: 2, max: 100 }),
        (minimum, scale) => {
          const known = period('known', minimum, 3 * minimum * scale, minimum * scale);
          const samples = [
            period('protected sample', minimum, 3 * minimum, minimum - 1),
            period('eligible complement', minimum, 3 * minimum, 3 * minimum - 1),
            period('issued complement', minimum, 3 * minimum, minimum, 2 * minimum - 1),
          ];
          for (const small of samples) {
            expect(companyGroupParticipation([known, small]).participation).toEqual({
              status: 'PROTECTED',
            });
          }
        },
      ),
    );
  });

  it('does not expose an aggregate evolution for a protected delta between two visible rates', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 50 }), (minimum) => {
        const result = companyGroupParticipation([
          period('large', minimum, 5 * minimum, 3 * minimum),
          period('large', minimum, 5 * minimum, 2 * minimum, undefined, 2),
          period('small delta', minimum, 4 * minimum, 2 * minimum + 1),
          period('small delta', minimum, 4 * minimum, 2 * minimum, undefined, 2),
        ]);
        expect(result.participation.status).toBe('AVAILABLE');
        expect(result.evolution).toEqual({ status: 'PROTECTED' });
      }),
    );
  });

  it('hides evolution when individually safe changes nearly cancel in the group', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 50 }), (minimum) => {
        const result = companyGroupParticipation([
          period('increase', minimum, 6 * minimum, 4 * minimum),
          period('increase', minimum, 6 * minimum, 2 * minimum, undefined, 2),
          period('decrease', minimum, 6 * minimum, 2 * minimum + 1),
          period('decrease', minimum, 6 * minimum, 4 * minimum, undefined, 2),
        ]);
        expect(result.participation.status).toBe('AVAILABLE');
        expect(result.evolution).toEqual({ status: 'PROTECTED' });
      }),
    );
  });
});
