# syntax=docker/dockerfile:1
FROM node:24.9.0-bookworm-slim@sha256:3e69116c924bfcba6c6979aff60d966c37aef56d488ce091c69d442ebec9f103 AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@11.25.0

FROM base AS builder
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages/contracts ./packages/contracts
COPY apps/api ./apps/api
COPY apps/web ./apps/web
# Generation only needs a syntactically valid URL, never a live database or secret.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm prisma:generate \
    && pnpm --filter @renr/contracts build \
    && pnpm --filter @renr/api build \
    && pnpm --filter @renr/web build

FROM base AS runner
ENV NODE_ENV=production HOST=0.0.0.0 PORT=10000 \
    SERVE_WEB=true WEB_DIST_PATH=/app/apps/web/dist STORAGE_ENABLED=false
# Keep the locked Prisma CLI and its pnpm dependency closure for controlled migrate deploy.
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=node:node /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder --chown=node:node /app/apps/api/prisma.config.ts ./apps/api/prisma.config.ts
COPY --from=builder --chown=node:node /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=builder --chown=node:node /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=builder --chown=node:node /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=builder --chown=node:node /app/apps/web/dist ./apps/web/dist
COPY --chown=node:node scripts/start-production.mjs scripts/provision-homologation.mjs scripts/homologation-config.mjs scripts/homologation-data.mjs scripts/diagnostic-demo-data.mjs ./scripts/
USER node
EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "scripts/start-production.mjs"]
