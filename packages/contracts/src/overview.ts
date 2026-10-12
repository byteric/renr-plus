import { z } from 'zod';

const statusCountsSchema = z
  .object({
    total: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    inactive: z.number().int().nonnegative(),
  })
  .strict()
  .refine((counts) => counts.total === counts.active + counts.inactive, {
    message: 'Total must equal active plus inactive',
    path: ['total'],
  });

export const organizationOverviewSchema = z
  .object({
    organization: z.object({ id: z.uuid(), name: z.string(), isActive: z.boolean() }).strict(),
    units: statusCountsSchema,
    sectors: statusCountsSchema,
    unitsWithoutSectors: z.number().int().nonnegative(),
    generatedAt: z.iso.datetime(),
  })
  .strict()
  .refine((overview) => overview.unitsWithoutSectors <= overview.units.total, {
    message: 'Units without sectors must not exceed total units',
    path: ['unitsWithoutSectors'],
  });

export type OrganizationOverview = z.infer<typeof organizationOverviewSchema>;
