import { z } from 'zod';

const httpUrl = z.url({ protocol: /^https?$/ });
const postgresUrl = z.url({ protocol: /^postgres(?:ql)?$/ });

export const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CORS_ORIGIN: httpUrl.default('http://127.0.0.1:5173'),
  DATABASE_URL: postgresUrl,
  S3_ENDPOINT: httpUrl.default('http://127.0.0.1:9000'),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_BUCKET: z.string().min(1).default('renr-evidence'),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
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
