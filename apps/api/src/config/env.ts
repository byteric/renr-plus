import { z } from 'zod';

const httpUrl = z.url({ protocol: /^https?$/ });
const postgresUrl = z.url({ protocol: /^postgres(?:ql)?$/ });
const booleanFlag = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true');

export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    CORS_ORIGIN: httpUrl.default('http://127.0.0.1:5173'),
    DATABASE_URL: postgresUrl,
    SERVE_WEB: booleanFlag.default(false),
    WEB_DIST_PATH: z.string().min(1).optional(),
    STORAGE_ENABLED: booleanFlag.default(false),
    S3_ENDPOINT: httpUrl.default('http://127.0.0.1:9000'),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_BUCKET: z.string().min(1).default('renr-evidence'),
    S3_ACCESS_KEY: z.string().min(1).optional(),
    S3_SECRET_KEY: z.string().min(1).optional(),
  })
  .superRefine((environment, context) => {
    if (environment.NODE_ENV === 'production' && !environment.CORS_ORIGIN.startsWith('https://')) {
      context.addIssue({
        code: 'custom',
        path: ['CORS_ORIGIN'],
        message: 'HTTPS required in production',
      });
    }
    if (environment.SERVE_WEB && !environment.WEB_DIST_PATH) {
      context.addIssue({
        code: 'custom',
        path: ['WEB_DIST_PATH'],
        message: 'Web dist path required',
      });
    }
    if (environment.STORAGE_ENABLED) {
      for (const field of ['S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const) {
        if (!environment[field]) {
          context.addIssue({
            code: 'custom',
            path: [field],
            message: 'Storage credentials required',
          });
        }
      }
    }
  });

export type Environment = z.infer<typeof environmentSchema>;
export const ENVIRONMENT = Symbol('ENVIRONMENT');

export function parseEnvironment(input: Record<string, unknown>): Environment {
  const result = environmentSchema.safeParse(input);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Invalid environment variables: ${fields.join(', ')}`);
  }
  return result.data;
}
