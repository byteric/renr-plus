import { z } from 'zod';

/** Liveness: não implica que PostgreSQL ou armazenamento estejam disponíveis. */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('renr-api'),
  timestamp: z.iso.datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const apiErrorSchema = z.object({
  details: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
  statusCode: z.number().int().min(400).max(599),
  code: z.string().min(1),
  message: z.string().min(1),
  requestId: z.uuid(),
  timestamp: z.iso.datetime(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

const nameSchema = z.string().trim().min(2).max(120);
const timezoneSchema = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, 'Invalid IANA timezone');
export const paginationSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    password: z.string().min(1).max(256),
  })
  .strict();
export const activeOrganizationSchema = z.object({ organizationId: z.uuid() }).strict();
export const membershipSchema = z.object({
  organizationId: z.uuid(),
  organizationName: z.string(),
  role: z.enum(['ADMIN', 'READER']),
});
export const sessionResponseSchema = z.object({
  user: z.object({ id: z.uuid(), name: z.string(), email: z.email() }),
  memberships: z.array(membershipSchema),
  activeOrganizationId: z.uuid().nullable(),
  expiresAt: z.iso.datetime(),
});
export const createOrganizationSchema = z
  .object({
    name: nameSchema,
    fiscalIdentifier: z.string().trim().max(32).nullable().optional(),
    timezone: timezoneSchema.default('America/Sao_Paulo'),
  })
  .strict();
export const updateOrganizationSchema = createOrganizationSchema
  .partial()
  .extend({ timezone: timezoneSchema.optional(), isActive: z.boolean().optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');
export const createUnitSchema = z
  .object({ name: nameSchema, code: z.string().trim().max(32).nullable().optional() })
  .strict();
export const updateUnitSchema = createUnitSchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');
export const createSectorSchema = z.object({ name: nameSchema }).strict();
export const updateSectorSchema = createSectorSchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');
const recordFields = {
  id: z.uuid(),
  name: z.string(),
  isActive: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};
export const organizationSchema = z.object({
  ...recordFields,
  fiscalIdentifier: z.string().nullable(),
  timezone: z.string(),
});
export const unitSchema = z.object({
  ...recordFields,
  organizationId: z.uuid(),
  code: z.string().nullable(),
});
export const sectorSchema = z.object({
  ...recordFields,
  organizationId: z.uuid(),
  unitId: z.uuid(),
});
const listSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int().min(0),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
  });
export const organizationListSchema = listSchema(organizationSchema);
export const unitListSchema = listSchema(unitSchema);
export const sectorListSchema = listSchema(sectorSchema);
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type Organization = z.infer<typeof organizationSchema>;
export type Unit = z.infer<typeof unitSchema>;
export type Sector = z.infer<typeof sectorSchema>;
export type CreateOrganization = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganization = z.infer<typeof updateOrganizationSchema>;
export type CreateUnit = z.infer<typeof createUnitSchema>;
export type UpdateUnit = z.infer<typeof updateUnitSchema>;
export type CreateSector = z.infer<typeof createSectorSchema>;
export type UpdateSector = z.infer<typeof updateSectorSchema>;
