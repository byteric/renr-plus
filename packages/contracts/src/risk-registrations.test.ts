import { describe, expect, it } from 'vitest';
import * as contracts from './index';
import type { z } from 'zod';

const schemas = contracts as unknown as Record<string, z.ZodType>;
const parse = (name: string, value: unknown) =>
  schemas[name]?.safeParse(value) ?? { success: false };
const series = {
  organizationId: '00000000-0000-4000-8000-000000000001',
  generatedAt: '2026-10-18T01:30:00.000Z',
  timeZone: 'America/Sao_Paulo',
  fromDate: '2026-10-11',
  toDate: '2026-10-17',
  days: 7,
  total: 3,
  points: [
    { date: '2026-10-11', count: 0 },
    { date: '2026-10-12', count: 0 },
    { date: '2026-10-13', count: 0 },
    { date: '2026-10-14', count: 0 },
    { date: '2026-10-15', count: 0 },
    { date: '2026-10-16', count: 1 },
    { date: '2026-10-17', count: 2 },
  ],
};
describe('daily risk registration contracts', () => {
  it('accepts a consecutive series ending today in the organization timezone', () => {
    expect(parse('riskRegistrationsSchema', series).success).toBe(true);
  });
  it('defaults to thirty days and accepts only the bounded windows', () => {
    const result = parse('riskRegistrationsQuerySchema', {});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ days: 30 });
    for (const days of ['7', '30', '90'])
      expect(parse('riskRegistrationsQuerySchema', { days }).success).toBe(true);
  });
  it.each([
    { days: '14' },
    { days: '7', status: 'REGISTERED' },
    { days: ['7', '30'] },
    { organizationId: series.organizationId },
  ])('rejects unsupported and unknown query fields', (value) => {
    expect(parse('riskRegistrationsQuerySchema', value).success).toBe(false);
  });
  it.each([
    { total: 4 },
    { days: 30 },
    { fromDate: '2026-10-10' },
    { toDate: '2026-10-18' },
    { timeZone: 'Invalid/Zone' },
    { timeZone: 'UTC' },
    { worker: 'private' },
    { points: series.points.slice(1) },
    {
      points: series.points.map((point, i) => (i === 3 ? { date: '2026-02-30', count: 0 } : point)),
    },
    {
      points: series.points.map((point, i) => (i === 3 ? { date: '2026-10-13', count: 0 } : point)),
    },
    { points: series.points.map((point, i) => (i === 3 ? { ...point, count: -1 } : point)) },
    { points: series.points.map((point, i) => (i === 3 ? { ...point, score: 1 } : point)) },
  ])('rejects incoherent dates, counts or private fields', (override) => {
    expect(parse('riskRegistrationsSchema', { ...series, ...override }).success).toBe(false);
  });
  it('returns validation failure rather than throwing for a malformed starting date', () => {
    expect(parse('riskRegistrationsSchema', { ...series, fromDate: 'invalid' }).success).toBe(
      false,
    );
  });
  it.each(['+03:00', '-03:00', '+03:30', '-03:30', '+23:00', '+03', '+0330'])(
    'preserves a configured offset accepted by the organization contract: %s',
    (timeZone) => {
      const generatedAt =
        timeZone === '+23:00' ? '2026-10-16T12:00:00.000Z' : '2026-10-17T12:00:00.000Z';
      expect(parse('riskRegistrationsSchema', { ...series, timeZone, generatedAt }).success).toBe(
        true,
      );
    },
  );
});
