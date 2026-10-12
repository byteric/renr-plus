import { describe, expect, it } from 'vitest';
import { organizationOverviewSchema } from './index';

const overview = {
  organization: { id: '00000000-0000-4000-8000-000000000001', name: 'Empresa', isActive: false },
  units: { total: 2, active: 1, inactive: 1 },
  sectors: { total: 0, active: 0, inactive: 0 },
  unitsWithoutSectors: 2,
  generatedAt: '2026-10-12T12:00:00.000Z',
};

describe('organization overview contract', () => {
  it('accepts zero counts and inactive organizations', () => {
    expect(organizationOverviewSchema.parse(overview)).toEqual(overview);
  });
  it.each([
    { units: { total: 3, active: 1, inactive: 1 } },
    { sectors: { total: 0, active: 1, inactive: 0 } },
    { unitsWithoutSectors: 3 },
    { unitsWithoutSectors: -1 },
    { units: { total: 2.5, active: 1.5, inactive: 1 } },
    { generatedAt: 'invalid' },
    { organization: { ...overview.organization, id: 'invalid' } },
    { organization: { ...overview.organization, fiscalIdentifier: 'private' } },
    { password: 'private' },
  ])('rejects invalid counts, metadata or private fields: %j', (override) => {
    expect(organizationOverviewSchema.safeParse({ ...overview, ...override }).success).toBe(false);
  });
});
