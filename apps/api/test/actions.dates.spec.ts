import { referenceDate } from '../src/modules/actions/actions.repository';

describe('Action company reference dates', () => {
  it.each([
    ['+14:00', '2026-10-22'],
    ['-12:00', '2026-10-21'],
    ['+05:30', '2026-10-22'],
    ['America/Sao_Paulo', '2026-10-21'],
    ['CST', '2026-10-21'],
    ['Asia/Tokyo', '2026-10-22'],
  ])('uses %s civil date at the same instant', (timeZone, expected) => {
    expect(referenceDate(timeZone, new Date('2026-10-21T23:30:00Z'))).toBe(expected);
  });
});
