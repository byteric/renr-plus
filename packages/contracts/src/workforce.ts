import { z } from 'zod';
const name = z.string().trim().min(2).max(120);
const pageFields = {
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(120).optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
};
export const organizationQuerySchema = z.object(pageFields).strict();
export const unitQuerySchema = z.object(pageFields).strict();
export const sectorQuerySchema = z.object(pageFields).strict();
export const employeeQuerySchema = z
  .object({ ...pageFields, unitId: z.uuid().optional(), sectorId: z.uuid().optional() })
  .strict();
export const assessmentGroupQuerySchema = employeeQuerySchema;
export const createEmployeeSchema = z
  .object({
    name,
    internalIdentifier: z.string().trim().min(1).max(64).nullable().optional(),
    unitId: z.uuid(),
    sectorId: z.uuid(),
    linkedUserId: z.uuid().nullable().optional(),
  })
  .strict();
export const updateEmployeeSchema = createEmployeeSchema
  .partial()
  .extend({ version: z.number().int().min(1), isActive: z.boolean().optional() })
  .strict()
  .refine((value) => Object.keys(value).length > 1, 'Provide at least one change');
export const createAssessmentGroupSchema = z.object({ name, sectorId: z.uuid() }).strict();
export const updateAssessmentGroupSchema = z
  .object({
    name: name.optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().min(1),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 1, 'Provide at least one change');
const record = {
  id: z.uuid(),
  organizationId: z.uuid(),
  name: z.string(),
  unitId: z.uuid(),
  sectorId: z.uuid(),
  unitName: z.string(),
  sectorName: z.string(),
  isActive: z.boolean(),
  version: z.number().int().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};
export const employeeSchema = z
  .object({
    ...record,
    internalIdentifier: z.string().nullable(),
    linkedUserId: z.uuid().nullable(),
  })
  .strict();
export const assessmentGroupSchema = z.object(record).strict();
const list = <T extends z.ZodType>(item: T) =>
  z
    .object({
      items: z.array(item),
      total: z.number().int().min(0),
      page: z.number().int().min(1),
      pageSize: z.number().int().min(1).max(100),
    })
    .strict();
export const employeeListSchema = list(employeeSchema);
export const assessmentGroupListSchema = list(assessmentGroupSchema);
export type Employee = z.infer<typeof employeeSchema>;
export type CreateEmployee = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployee = z.infer<typeof updateEmployeeSchema>;
export type AssessmentGroup = z.infer<typeof assessmentGroupSchema>;
export type CreateAssessmentGroup = z.infer<typeof createAssessmentGroupSchema>;
export type UpdateAssessmentGroup = z.infer<typeof updateAssessmentGroupSchema>;
export type WorkforceQuery = z.infer<typeof employeeQuerySchema>;
export type OrganizationQuery = z.infer<typeof organizationQuerySchema>;
