import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, test as base, type APIRequestContext, type Browser } from '@playwright/test';
import { parse } from 'dotenv';
import type { PrismaClient } from '../../apps/api/src/generated/prisma/client';

const apiDir = resolve('apps/api');
const requireApi = createRequire(resolve(apiDir, 'package.json'));
const { localDatabaseUrl } = requireApi('../../scripts/local-database-url.mjs') as {
  localDatabaseUrl: (connectionString: string) => URL;
};

export type PersonaId37Scenario = {
  orgId: string;
  otherOrgId: string;
  employeeId: string;
  riskId: string;
  groupId: string;
  admin: APIRequestContext;
  suffix: string;
};

async function makeScenario(
  browser: Browser,
  origin: URL,
): Promise<{
  scenario: PersonaId37Scenario;
  cleanup: () => Promise<void>;
}> {
  const connection = localDatabaseUrl(
    process.env.DATABASE_URL ?? parse(readFileSync(resolve(apiDir, '.env'))).DATABASE_URL ?? '',
  );
  const disposableDatabase =
    /^\/renr_e2e_(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i;
  if (
    (!['/renr_test', '/renr_technical_id11_verification'].includes(connection.pathname) &&
      !disposableDatabase.test(connection.pathname)) ||
    (connection.searchParams.get('schema') ?? 'public') !== 'public'
  )
    throw new Error('A fixture ID37 exige PostgreSQL local de testes no schema public.');

  const { PrismaPg } = requireApi('@prisma/adapter-pg');
  const { PrismaClient: Client } = requireApi('./dist/generated/prisma/client.js');
  const { hashPassword } = requireApi('./dist/modules/identity/password.js');
  const db: PrismaClient = new Client({
    adapter: new PrismaPg({ connectionString: connection.href, max: 1 }),
  });

  const suffix = randomUUID();
  const org = { id: randomUUID(), name: `e2e-id37-${suffix}` };
  const other = { id: randomUUID(), name: `e2e-id37-other-${suffix}` };
  const unit = { id: randomUUID(), name: `Unidade ID37 ${suffix}` };
  const sector = { id: randomUUID(), name: `Setor ID37 ${suffix}` };
  const group = { id: randomUUID(), name: `Grupo ID37 ${suffix}` };
  const employee = { id: randomUUID(), name: `Colaborador ID37 ${suffix}` };
  const risk = { id: randomUUID(), factor: `Risco ID37 ${suffix}` };
  const userId = randomUUID();
  const email = `organizador-${suffix}@example.test`;
  const password = `Id37!${randomUUID()}`;
  const orgIds = [org.id, other.id];
  const identities = [org, other];
  const context = await browser.newContext({ baseURL: origin.origin });
  let seeded = false;

  const cleanup = async () => {
    try {
      if (seeded) {
        await db.$transaction(async (tx) => {
          const organizationCount = await tx.organization.count({ where: { OR: identities } });
          const organizerCount = await tx.user.count({ where: { id: userId, email } });
          if (organizationCount !== 2 || organizerCount !== 1)
            throw new Error('Identidades ID37 divergentes. Limpeza cancelada por segurança.');

          const now = new Date();
          await tx.session.deleteMany({
            where: { user: { email: { endsWith: `-${suffix}@example.test` } } },
          });
          await tx.platformGrant.updateMany({
            where: { user: { email: { endsWith: `-${suffix}@example.test` } }, isActive: true },
            data: { isActive: false, version: { increment: 1 } },
          });
          await tx.accessInvite.updateMany({
            where: { organizationId: { in: orgIds }, revokedAt: null, consumedAt: null },
            data: { revokedAt: now, version: { increment: 1 } },
          });
          await tx.assessmentInvite.updateMany({
            where: { organizationId: { in: orgIds }, expiresAt: { gt: now } },
            data: { expiresAt: now },
          });
          await tx.membership.updateMany({
            where: { organizationId: { in: orgIds }, isActive: true },
            data: { isActive: false, version: { increment: 1 } },
          });
          await tx.organization.updateMany({
            where: { OR: identities, isActive: true },
            data: { isActive: false },
          });
        });
      }
    } finally {
      await context.close();
      await db.$disconnect();
    }
  };

  try {
    const passwordHash: string = await hashPassword(password);
    await db.$transaction(async (tx) => {
      await tx.user.create({
        data: { id: userId, name: `Organizador ID37 ${suffix}`, email, passwordHash },
      });
      await tx.organization.create({
        data: { ...org, clientClassification: 'DEMONSTRATION' },
      });
      await tx.organization.create({ data: other });
      await tx.membership.create({ data: { userId, organizationId: org.id, role: 'ADMIN' } });
      await tx.platformGrant.createMany({
        data: (['READ_OVERVIEW', 'MANAGE_CLIENTS', 'MANAGE_GRANTS'] as const).map((capability) => ({
          userId,
          capability,
        })),
      });

      const createdUnit = await tx.unit.create({
        data: {
          ...unit,
          organizationId: org.id,
          normalizedName: `unidade id37 ${suffix}`,
        },
      });
      const createdSector = await tx.sector.create({
        data: {
          ...sector,
          organizationId: org.id,
          unitId: createdUnit.id,
          normalizedName: `setor id37 ${suffix}`,
        },
      });
      await tx.assessmentGroup.create({
        data: { ...group, organizationId: org.id, sectorId: createdSector.id },
      });
      await tx.employee.create({
        data: {
          ...employee,
          organizationId: org.id,
          unitId: createdUnit.id,
          sectorId: createdSector.id,
        },
      });
      await tx.risk.create({
        data: {
          ...risk,
          organizationId: org.id,
          assessmentGroupId: group.id,
          createdById: userId,
          updatedById: userId,
        },
      });
    });
    seeded = true;

    const admin = context.request;
    const login = await admin.post('/api/v1/auth/sessions', {
      headers: { Origin: origin.origin },
      data: { email, password },
    });
    expect(login.status(), 'Synthetic organizer authenticates through the real API').toBe(201);

    return {
      scenario: {
        orgId: org.id,
        otherOrgId: other.id,
        employeeId: employee.id,
        riskId: risk.id,
        groupId: group.id,
        admin,
        suffix,
      },
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export const test = base.extend<{ scenario: PersonaId37Scenario }>({
  scenario: async ({ browser, baseURL }, use) => {
    const origin = new URL(baseURL ?? '');
    if (
      origin.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)
    )
      throw new Error('A fixture ID37 exige a aplicação no loopback.');

    const fixture = await makeScenario(browser, origin);
    try {
      await use(fixture.scenario);
    } finally {
      await fixture.cleanup();
    }
  },
});
