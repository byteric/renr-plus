import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, test as base, type Page } from '@playwright/test';
import { parse } from 'dotenv';
import type { PrismaClient } from '../../apps/api/src/generated/prisma/client';
import { localDatabaseUrl } from '../../scripts/local-database-url.mjs';

const apiDir = resolve('apps/api');
const requireApi = createRequire(resolve(apiDir, 'package.json'));
const hrGrants = [
  'HR_ANALYTICS_READ',
  'HR_PROFILE_MANAGE',
  'HR_COMPENSATION_MANAGE',
  'HR_EXPORT',
] as const;

export async function selectCompany(page: Page, id: string) {
  const company = page.getByLabel('Empresa ativa');
  if ((await company.inputValue()) === id) return;
  await company.selectOption(id);
  await expect(page).toHaveURL(/#\/unidades$/);
  await expect(company).toHaveValue(id);
}

async function makeFixture() {
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
    throw new Error('A jornada de RH exige um banco de testes local descartável no schema public.');
  const { PrismaPg } = requireApi('@prisma/adapter-pg');
  const { PrismaClient: Client } = requireApi('./dist/generated/prisma/client.js');
  const { hashPassword } = requireApi('./dist/modules/identity/password.js');
  const db: PrismaClient = new Client({
    adapter: new PrismaPg({ connectionString: connection.href, max: 1 }),
  });
  const token = randomUUID();
  const org = { id: randomUUID(), name: 'e2e-id31-' + token };
  const other = { id: randomUUID(), name: 'e2e-id31-other-' + token };
  const employee = { id: randomUUID(), name: 'Pessoa sintética ' + token };
  const inactive = { id: randomUUID(), name: 'Inativo sintético ' + token };
  const foreign = { id: randomUUID(), name: 'Pessoa de outra empresa ' + token };
  const userId = randomUUID();
  const email = 'e2e-id31-' + token + '@example.test';
  const password = 'E2e!' + randomUUID();
  const orgIds = [org.id, other.id];
  const membership = { userId_organizationId: { userId, organizationId: org.id } };
  const tenantApi = '/api/v1/organizations/' + org.id;
  const peopleApi = tenantApi + '/employees/' + employee.id;
  const originalSource = 'Ficha sintética original';
  const unit = { id: randomUUID(), name: 'Unidade sintética ID31' };
  const sector = { id: randomUUID(), name: 'Setor sintético ID31' };

  try {
    const passwordHash: string = await hashPassword(password);
    await db.$transaction(async (tx) => {
      await tx.user.create({
        data: { id: userId, name: 'Operador sintético ID31', email, passwordHash },
      });
      await tx.organization.create({ data: { ...org, clientClassification: 'DEMONSTRATION' } });
      await tx.organization.create({ data: other });
      await tx.membership.createMany({
        data: [
          { userId, organizationId: org.id, role: 'ADMIN', hrCapabilities: [...hrGrants] },
          { userId, organizationId: other.id, role: 'ADMIN' },
        ],
      });
      for (const organizationId of orgIds) {
        const location = await tx.unit.create({
          data: {
            ...(organizationId === org.id ? unit : { name: unit.name }),
            organizationId,
            normalizedName: 'unidade sintetica id31',
          },
        });
        const area = await tx.sector.create({
          data: {
            ...(organizationId === org.id ? sector : { name: sector.name }),
            organizationId,
            unitId: location.id,
            normalizedName: 'setor sintetico id31',
          },
        });
        await tx.employee.createMany({
          data: (organizationId === org.id ? [employee, inactive] : [foreign]).map((item) => ({
            ...item,
            isActive: item !== inactive,
            organizationId,
            unitId: location.id,
            sectorId: area.id,
          })),
        });
      }
      await tx.employeeHrProfile.create({
        data: {
          organizationId: org.id,
          employeeId: employee.id,
          source: originalSource,
          updatedById: userId,
        },
      });
    });
  } catch (error) {
    await db.$disconnect();
    throw error;
  }

  return {
    org,
    other,
    employee,
    inactive,
    foreign,
    tenantApi,
    peopleApi,
    originalSource,
    unit,
    sector,
    async login(page: Page) {
      await page.goto('/');
      await page.getByLabel('E-mail', { exact: true }).fill(email);
      await page.getByLabel('Senha', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Entrar', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Empresas', exact: true })).toBeVisible();
      await selectCompany(page, org.id);
    },
    async revokePeople() {
      await db.membership.update({
        where: membership,
        data: { hrCapabilities: [], version: { increment: 1 } },
      });
    },
    async revokeCompensation() {
      await db.membership.update({
        where: membership,
        data: {
          hrCapabilities: hrGrants.filter((grant) => grant !== 'HR_COMPENSATION_MANAGE'),
          version: { increment: 1 },
        },
      });
    },
    async allowPlatform() {
      await db.platformGrant.create({ data: { userId, capability: 'READ_OVERVIEW' } });
    },
    async revokePlatform() {
      await db.platformGrant.update({
        where: { userId_capability: { userId, capability: 'READ_OVERVIEW' } },
        data: { isActive: false, version: { increment: 1 } },
      });
    },
    async recordCompensation() {
      await db.employeeRemuneration.create({
        data: {
          organizationId: org.id,
          employeeId: employee.id,
          competence: '2026-11',
          salaryCents: 987654n,
          source: 'Salário sintético para relatório',
          updatedById: userId,
        },
      });
    },
    async renameEmployee(name: string) {
      await db.employee.update({
        where: { id: employee.id, organizationId: org.id },
        data: { name },
      });
    },
    async cleanup() {
      try {
        await db.$transaction(async (tx) => {
          const fixtureOrganizations = await tx.organization.count({ where: { OR: [org, other] } });
          const fixtureUser = await tx.user.count({ where: { id: userId, email } });
          if (fixtureOrganizations !== 2 || fixtureUser !== 1)
            throw new Error('Identidades da fixture de RH divergentes. Limpeza cancelada.');

          const tenant = { organizationId: { in: orgIds } };
          await tx.session.deleteMany({ where: { userId } });
          await tx.platformGrant.deleteMany({ where: { userId } });
          // The DDL locks the tables until commit. A rollback restores every trigger.
          await tx.$executeRaw`ALTER TABLE employee_hr_revisions DISABLE TRIGGER hr_revision_immutable`;
          await tx.$executeRaw`ALTER TABLE platform_audit_events DISABLE TRIGGER platform_audit_immutable`;
          await tx.$executeRaw`ALTER TABLE report_snapshots DISABLE TRIGGER report_snapshot_immutable`;
          await tx.employeeHrRevision.deleteMany({ where: { ...tenant, actorId: userId } });
          await tx.platformAuditEvent.deleteMany({ where: { actorId: userId } });
          await tx.reportSnapshot.deleteMany({
            where: { createdById: userId, OR: [tenant, { organizationId: null }] },
          });
          await tx.$executeRaw`ALTER TABLE employee_hr_revisions ENABLE TRIGGER hr_revision_immutable`;
          await tx.$executeRaw`ALTER TABLE platform_audit_events ENABLE TRIGGER platform_audit_immutable`;
          await tx.$executeRaw`ALTER TABLE report_snapshots ENABLE TRIGGER report_snapshot_immutable`;
          await tx.employeeHrProfile.deleteMany({ where: tenant });
          await tx.employmentPeriod.deleteMany({ where: tenant });
          await tx.employeeVacationPeriod.deleteMany({ where: tenant });
          await tx.employeeRemuneration.deleteMany({ where: tenant });
          await tx.employee.deleteMany({ where: tenant });
          await tx.sector.deleteMany({ where: tenant });
          await tx.unit.deleteMany({ where: tenant });
          await tx.auditEvent.deleteMany({ where: { OR: [tenant, { actorId: userId }] } });
          await tx.organization.deleteMany({ where: { id: { in: orgIds } } });
          await tx.user.delete({ where: { id: userId, email } });
        });
      } finally {
        await db.$disconnect();
      }
    },
  };
}

export const test = base.extend<{ hr: Awaited<ReturnType<typeof makeFixture>> }>({
  hr: async ({ baseURL }, use) => {
    const origin = new URL(baseURL ?? '');
    if (
      origin.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)
    )
      throw new Error('A jornada de RH exige a aplicação no loopback.');
    const fixture = await makeFixture();
    try {
      await use(fixture);
    } finally {
      await fixture.cleanup();
    }
  },
});
