# API ReNR+ v0.1

NestJS API for cookie sessions and organizational structure. This is the v0.1
scope: identity, organizations, units, sectors and basic transactional audit.
Diagnostics, risk assessments and the complete MVP remain outside this release.

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

Environment validation requires DATABASE_URL, S3_ACCESS_KEY and S3_SECRET_KEY.
Copy .env.example only if root setup has not prepared .env. Never commit .env.
S3 variables are configuration groundwork; no S3 client or evidence flow exists.

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
