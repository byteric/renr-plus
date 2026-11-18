import { z } from 'zod';

export const workspaceJourneySchema = z.strictObject({
  organizationId: z.uuid(),
  demo: z.boolean(),
  structure: z.enum(['INACTIVE', 'MISSING_UNIT', 'MISSING_SECTOR', 'READY']),
  preparation: z.strictObject({ employees: z.boolean(), groups: z.boolean() }).nullable(),
  instruments: z.enum(['MISSING_INSTRUMENT', 'MISSING_POLICY', 'READY']),
  collection: z.enum(['MISSING', 'DRAFT', 'OPEN', 'CLOSED']),
  result: z.enum(['PENDING', 'NO_RESPONSES', 'PROTECTED', 'READY']),
  actions: z.enum(['MISSING', 'READY']),
});

export type WorkspaceJourney = z.infer<typeof workspaceJourneySchema>;
