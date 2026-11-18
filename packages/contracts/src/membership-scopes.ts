import { z } from 'zod';

export const membershipScopeSchema = z
  .object({ unitId: z.uuid(), sectorId: z.uuid().nullable() })
  .strict();
const scopesSchema = z.array(membershipScopeSchema).max(100);
export const membershipScopesSchema = z
  .object({
    restricted: z.boolean(),
    scopes: z
      .array(
        membershipScopeSchema.extend({
          unitName: z.string().optional(),
          sectorName: z.string().nullable().optional(),
        }),
      )
      .max(100),
    version: z.number().int().positive(),
  })
  .strict();
export const updateMembershipScopesSchema = z
  .object({
    scopes: scopesSchema,
    reason: z.string().trim().min(3).max(1000),
    expectedVersion: z.number().int().positive(),
  })
  .strict()
  .refine(
    ({ scopes }) =>
      new Set(scopes.map(({ unitId, sectorId }) => unitId + '/' + sectorId)).size === scopes.length,
    { message: 'Recorte duplicado', path: ['scopes'] },
  );

export type MembershipScope = z.infer<typeof membershipScopeSchema>;
export type MembershipScopes = z.infer<typeof membershipScopesSchema>;
export type UpdateMembershipScopes = z.infer<typeof updateMembershipScopesSchema>;
