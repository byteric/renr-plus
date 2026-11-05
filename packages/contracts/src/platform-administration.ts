import { z } from 'zod';
import {
  clientClassificationSchema,
  fiscalIdentifierInputSchema,
  fiscalStateSchema,
} from './fiscal-identifier';
import { clientRegistrationSchema, hrListSchema, hrPaginationSchema } from './people-analytics';
export const platformCapabilitySchema = z.enum([
  'READ_OVERVIEW',
  'MANAGE_CLIENTS',
  'MANAGE_GRANTS',
]);
export const platformCapabilitiesSchema = z
  .object({ capabilities: z.array(platformCapabilitySchema) })
  .strict();
export const platformQuerySchema = hrPaginationSchema
  .extend({
    search: z.string().trim().max(160).optional(),
    isActive: z.enum(['true', 'false']).optional(),
    classification: clientClassificationSchema.optional(),
    fiscalState: fiscalStateSchema.optional(),
  })
  .strict();
export const platformClientSchema = clientRegistrationSchema
  .extend({
    employees: z
      .object({ active: z.number().int().nonnegative(), inactive: z.number().int().nonnegative() })
      .strict(),
  })
  .strict();
export const platformClientListSchema = hrListSchema(platformClientSchema);
export const platformOverviewSchema = z
  .object({
    generatedAt: z.iso.datetime(),
    timeZone: z.literal('America/Sao_Paulo'),
    referenceDate: z.iso.date(),
    scope: z.literal('PLATFORM_SERVED_CLIENTS'),
    countingUnit: z.literal('EMPLOYEE_RECORDS_NOT_UNIQUE_PEOPLE'),
    organizations: z.number().int().nonnegative(),
    validatedCnpjs: z.number().int().nonnegative(),
    activeClients: z.number().int().nonnegative(),
    inactiveClients: z.number().int().nonnegative(),
    unclassified: z.number().int().nonnegative(),
    demonstrations: z.number().int().nonnegative(),
    pendingFiscal: z.number().int().nonnegative(),
    employees: z
      .object({ active: z.number().int().nonnegative(), inactive: z.number().int().nonnegative() })
      .strict(),
  })
  .strict();
export const writeClientRegistrationSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(3).max(1000),
    fiscalIdentifier: fiscalIdentifierInputSchema.nullable(),
    clientClassification: clientClassificationSchema,
    isActive: z.boolean(),
  })
  .strict();
export const writePlatformGrantSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    userId: z.uuid(),
    capability: platformCapabilitySchema,
    isActive: z.boolean(),
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();
export const platformGrantSchema = z
  .object({
    userId: z.uuid(),
    name: z.string(),
    email: z.email(),
    capability: platformCapabilitySchema,
    isActive: z.boolean(),
    version: z.number().int().positive(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export const platformGrantListSchema = hrListSchema(platformGrantSchema);
export type PlatformCapability = z.infer<typeof platformCapabilitySchema>;
export type PlatformQuery = z.infer<typeof platformQuerySchema>;
export type WriteClientRegistration = z.infer<typeof writeClientRegistrationSchema>;
export type WritePlatformGrant = z.infer<typeof writePlatformGrantSchema>;
export type PlatformOverview = z.infer<typeof platformOverviewSchema>;
