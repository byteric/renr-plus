import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

function migrationUrl() {
  if (process.env.NODE_ENV !== 'production') return env('DATABASE_URL');
  const url = new URL(env('DATABASE_URL_UNPOOLED'));
  const allowedParameters = new Set(['sslmode', 'channel_binding', 'schema', 'connect_timeout']);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname ||
    !url.username ||
    !url.password ||
    url.pathname.length < 2 ||
    url.hash ||
    url.hostname.includes('-pooler') ||
    url.searchParams.get('sslmode') !== 'verify-full' ||
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' ||
    [...url.searchParams.keys()].some(
      (key) => !allowedParameters.has(key) || url.searchParams.getAll(key).length !== 1,
    )
  )
    throw new Error('Production migrations require a direct PostgreSQL URL with verified TLS');
  // The Prisma Rust engine uses require + strict; pg uses verify-full.
  // Only translate the CLI URL, keeping certificate and hostname verification.
  url.searchParams.set('sslmode', 'require');
  url.searchParams.set('sslaccept', 'strict');
  return url.toString();
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Local migration tests must never inherit a residual cloud connection.
  // Production migrations require the direct URL; runtime keeps the pooled URL.
  datasource: {
    url: migrationUrl(),
  },
});
