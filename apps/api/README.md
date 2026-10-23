# API ReNR+

NestJS API for cookie sessions, organizational structure, demonstrative diagnostics,
risk inventory and preliminary assessments. Local v0.4/v0.5 preparation adds
versioned preventive actions and private action attachments. This is not the complete MVP.
See [action/evidence reference](../../docs/API_ACOES_EVIDENCIAS.md) and
[local usage](../../docs/USO_V04_V05.md).

After installing workspace dependencies, run these commands from the repository
root to start the API on its own:

```sh
pnpm setup:local
pnpm --filter @renr/contracts build
pnpm --filter @renr/api prisma:generate
pnpm --filter @renr/api dev
```

The shared contracts must be built before standalone API build/typecheck/tests
because the package exports generated files from `dist`. Rebuild them after
changing contracts; root `pnpm dev` builds them and keeps them in watch mode.
The API `dev` command starts watch mode; `build` produces `dist/main.js` and
`start` runs the compiled application.

The API starts without Docker or PostgreSQL. GET /api/v1/health checks only process
liveness. GET /api/v1/ready executes SELECT 1 and responds with 503 when PostgreSQL
is unavailable or takes longer than two seconds. The probe does not assert that
migrations are current or that S3 is available.

In development/test, Swagger is at /api/docs and JSON at /api/docs-json.
Production does not expose Swagger. HTTP errors use the shared ApiError contract;
each request receives a server-generated X-Request-Id and errors are sanitized.

Environment validation always requires DATABASE_URL. S3_ACCESS_KEY and S3_SECRET_KEY
are required only when STORAGE_ENABLED=true.
Copy .env.example only if root setup has not prepared .env. Never commit .env.
The evidence module uses the S3 client only when STORAGE_ENABLED=true. Local tests
use a private MinIO bucket. Disabled/unavailable storage returns a sanitized 503;
action follow-up and notes remain available. Never enable online storage without
a separately reviewed private storage/retention configuration.
Homologation uses a private Supabase bucket through the existing S3 adapter;
PostgreSQL remains on Neon. Store storage credentials only in private Render
environment variables, never in the frontend or repository. S3 credentials bypass
Storage RLS, so the API must authorize every upload, download and archive operation.

Prisma 7 uses prisma.config.ts for the datasource and a generated CommonJS client.
All Prisma scripts pass --config explicitly. Schema additions preserve the initial
Organization table and add users, memberships, sessions, units, sectors and audit events.
Migration SQL must be generated through Prisma and reviewed before execution.

Browser writes require the exact configured CORS origin. Session cookies are
HttpOnly, SameSite=Lax, scoped to /api/v1 and Secure in production. Passwords use
Node scrypt (N=32768, r=8, p=3); opaque session tokens are hashed in PostgreSQL and
expire after eight hours. Memberships are read on every authenticated request.
Login attempts are limited per account/IP and per IP with bounded local memory;
multi-instance production deployments require a shared rate-limit store.

GET /api/v1/organizations lists only the user's memberships. Organization writes
and all unit/sector operations require the active organization; ADMIN may write,
READER may read. Creating another organization requires ADMIN in the active one.
There is no public registration or endpoint for assigning permissions in v0.1.
Names are trimmed and duplicates are rejected case-insensitively within the
corresponding organization catalog or unit. All critical structure writes and
their audit events commit together; audits store identifiers/actions, not raw PII.

Run pnpm test:integration from the workspace root for real local PostgreSQL
tests, after pnpm db:deploy. Ordinary API tests skip this suite. Demo seeding uses
pnpm db:seed after build; it requires a local development database and a generated
DEMO_PASSWORD, preserves existing records and never replaces existing passwords.
