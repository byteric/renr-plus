import { z } from 'zod';

const daysSchema = z.union([z.literal(7), z.literal(30), z.literal(90)]);
const timeZoneSchema = z.string().refine((timeZone) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
}, 'Invalid timezone');
export const riskRegistrationsQuerySchema = z
  .object({ days: z.coerce.number().pipe(daysSchema).default(30) })
  .strict();

export const riskRegistrationsSchema = z
  .object({
    organizationId: z.uuid(),
    generatedAt: z.iso.datetime(),
    timeZone: timeZoneSchema,
    fromDate: z.iso.date(),
    toDate: z.iso.date(),
    days: daysSchema,
    total: z.number().int().nonnegative(),
    points: z
      .array(z.object({ date: z.iso.date(), count: z.number().int().nonnegative() }).strict())
      .min(7)
      .max(90),
  })
  .strict()
  .superRefine((value, ctx) => {
    let today: string;
    try {
      today = new Intl.DateTimeFormat('en-CA', {
        timeZone: value.timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(value.generatedAt));
    } catch {
      return;
    }
    const start = Date.parse(`${value.fromDate}T00:00:00.000Z`);
    if (!Number.isFinite(start)) return;
    const end = new Date(start + (value.days - 1) * 86400000).toISOString().slice(0, 10);
    if (
      value.toDate !== today ||
      value.toDate !== end ||
      value.points.length !== value.days ||
      value.points.some(
        (point, index) =>
          point.date !== new Date(start + index * 86400000).toISOString().slice(0, 10),
      ) ||
      value.total !== value.points.reduce((sum, point) => sum + point.count, 0)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['points'],
        message:
          'Daily registrations must be consecutive, inclusive, end today in the organization timezone and reconcile with total',
      });
    }
  });
export type RiskRegistrationsQuery = z.infer<typeof riskRegistrationsQuerySchema>;
export type RiskRegistrations = z.infer<typeof riskRegistrationsSchema>;
