import { describe, expect, it } from 'vitest';
import * as contracts from './index';
import { z } from 'zod';
const schemas = contracts as unknown as Record<string, z.ZodType>;
describe('Audit contracts', () => {
  it('defaults to bounded paginated queries', () => {
    expect(schemas.auditListQuerySchema?.parse({})).toEqual({ page: 1, pageSize: 50 });
  });
  it.each([
    { pageSize: 101 },
    { page: 0 },
    { from: '2026-02-30' },
    { from: '2026-03-01', to: '2026-02-28' },
    { actorId: 'foreign' },
    { payload: '{}' },
  ])('rejects invalid query %j', (query) => {
    expect(schemas.auditListQuerySchema?.safeParse(query).success).toBe(false);
  });
  it('rejects arbitrary navigation URLs', () => {
    expect(
      schemas.auditTargetSchema?.safeParse({
        kind: 'action-revision',
        id: '11111111-1111-4111-8111-111111111111',
        url: 'https://example.org',
      }).success,
    ).toBe(false);
  });
});
describe('Audit calendar validation', () => {
  it.each(['invalid', '', '0000-01-01'])(
    'returns validation errors for %j without throwing',
    (from) => {
      expect(() => schemas.auditListQuerySchema!.safeParse({ from })).not.toThrow();
      expect(schemas.auditListQuerySchema!.safeParse({ from }).success).toBe(false);
    },
  );
});

describe('Audit timezone validation', () => {
  it('rejects invalid organization timezone at the response boundary', () => {
    expect(
      schemas.auditEventListSchema!.safeParse({
        items: [],
        total: 0,
        page: 1,
        pageSize: 50,
        timeZone: 'Invalid/Zone',
      }).success,
    ).toBe(false);
  });
});
