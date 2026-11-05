import { createRequire } from 'node:module';
import { localSeedUrl } from './local-seed-url.mjs';

const companies = [
  {
    id: '3f7b2b38-5ea9-47c6-91cc-fbbfd9fa3b8b',
    name: 'Empresa fictícia Aurora — teste ID32',
    cnpj: '11222333000181',
    employees: [
      { name: 'Pessoa sintética Aurora 01', complete: true },
      { name: 'Pessoa sintética Aurora 02' },
      { name: 'Pessoa sintética Aurora 03', isActive: false },
      ...Array.from({ length: 8 }, (_, index) => ({
        name: 'Pessoa sintética Aurora ' + String(index + 4).padStart(2, '0'),
        complete: index < 4,
      })),
    ],
  },
  {
    id: 'c344ccab-523e-4d07-9ba0-8ab21484f6be',
    name: 'Empresa fictícia Horizonte — teste ID32',
    cnpj: '12ABC34501DE35',
    employees: [{ name: 'Pessoa sintética Horizonte 01' }],
  },
];

const aurora = companies[0];
const firstAddedIndex = 3;
const hrEmail = 'rh-id32@renr.example';
const operatorEmail = 'operador-id32@renr.example';
const source = 'Demonstração ID32 — dados sintéticos de teste';
const civilDate = (value) => new Date(value + 'T00:00:00Z');

function demoDatabaseUrl() {
  try {
    const url = localSeedUrl(process.env.DATABASE_URL ?? '', process.env.NODE_ENV);
    const schemas = url.searchParams.getAll('schema');
    if (
      ['127.0.0.1', '[::1]'].includes(url.hostname) &&
      url.pathname === '/renr_mvp_demo' &&
      !url.hash &&
      (schemas.length === 0 || (schemas.length === 1 && schemas[0] === 'public'))
    ) {
      url.search = '';
      return url;
    }
  } catch {
    // URL parsing errors may include credentials. Report only a fixed message.
  }
  console.error(
    'Use PostgreSQL local (127.0.0.1 ou [::1]), banco renr_mvp_demo e NODE_ENV=development.',
  );
  process.exitCode = 1;
}

function employeeId(company, index) {
  const suffix = String(100 * (companies.indexOf(company) + 1) + index + 1).padStart(12, '0');
  return 'a831c320-9920-4142-9e71-' + suffix;
}

async function createEmployee(tx, company, unit, sector, person, index, hrId) {
  const internalIdentifier = 'ID32-' + String(index + 1).padStart(2, '0');
  const employee = await tx.employee.create({
    data: {
      id: employeeId(company, index),
      organizationId: company.id,
      unitId: unit.id,
      sectorId: sector.id,
      name: person.name,
      internalIdentifier,
      normalizedIdentifier: internalIdentifier.toLowerCase(),
      isActive: person.isActive ?? true,
    },
  });
  if (company !== aurora) return;

  const record = {
    organizationId: company.id,
    employeeId: employee.id,
    updatedById: hrId,
    source,
  };
  if (!person.complete) {
    await tx.employeeHrProfile.create({ data: { ...record, followUp: true } });
    return;
  }

  await tx.employeeHrProfile.create({
    data: {
      ...record,
      birthDate: civilDate('1990-06-10'),
      gender: 'FEMALE',
      vacationHistoryKnown: true,
      complexLeaveHistoryKnown: true,
    },
  });
  await tx.employmentPeriod.create({ data: { ...record, startsOn: civilDate('2025-01-01') } });
  await tx.employeeVacationPeriod.create({
    data: {
      ...record,
      acquisitionStart: civilDate('2025-01-01'),
      acquisitionEnd: civilDate('2025-12-31'),
      concessionDeadline: civilDate('2026-12-31'),
      entitlementDays: 30,
      balanceDays: 30,
      historyKnown: true,
    },
  });
  await tx.employeeRemuneration.create({
    data: { ...record, competence: '2026-11', salaryCents: 360000n },
  });
  if (index === firstAddedIndex) {
    await tx.employeeRemuneration.create({
      data: { ...record, competence: '2026-10', salaryCents: 360000n },
    });
  }
  const terminationDate = '2026-11-05';
  await tx.employeeSettlementParameters.create({
    data: {
      ...record,
      referenceDate: civilDate(terminationDate),
      input: {
        terminationDate,
        paidSalaryDays: 0,
        thirteenthAdvanceCents: '0',
        thirteenthHistoryKnown: true,
        currentAcquisitionStart: '2026-01-01',
        currentAcquisitionHistoryKnown: true,
        unjustifiedAbsences: 0,
        fgts: { terminationBaseCents: '1000000', confirmedIncludesPending: true },
      },
    },
  });
}

async function expandExistingAurora(tx) {
  const firstAdded = await tx.employee.findUnique({
    where: { id: employeeId(aurora, firstAddedIndex) },
    select: { id: true },
  });
  if (firstAdded) return false;

  // Extend the original fixture with new records, preserving its users, grants and employee edits.
  const { userId } = await tx.membership.findFirstOrThrow({
    where: { organizationId: aurora.id, user: { email: hrEmail } },
    select: { userId: true },
  });
  const unit = await tx.unit.findUniqueOrThrow({
    where: {
      organizationId_normalizedName: {
        organizationId: aurora.id,
        normalizedName: 'unidade sintetica',
      },
    },
  });
  const sector = await tx.sector.findUniqueOrThrow({
    where: {
      unitId_normalizedName: { unitId: unit.id, normalizedName: 'operacoes sinteticas' },
    },
  });
  for (const [index, person] of aurora.employees.entries()) {
    if (index >= firstAddedIndex) {
      await createEmployee(tx, aurora, unit, sector, person, index, userId);
    }
  }
  return true;
}

async function seed(url, hrPassword, operatorPassword) {
  const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
  const { PrismaPg } = requireApi('@prisma/adapter-pg');
  const { PrismaClient } = requireApi('./dist/generated/prisma/client.js');
  const { hashPassword } = requireApi('./dist/modules/identity/password.js');
  const [hrHash, operatorHash] = await Promise.all([
    hashPassword(hrPassword),
    hashPassword(operatorPassword),
  ]);
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url.href, max: 1, connectionTimeoutMillis: 5000 }),
  });

  try {
    return await client.$transaction(
      async (tx) => {
        // Serialize concurrent runs and keep the marker in the same transaction as all demo data.
        await tx.$queryRaw`SELECT 1 AS acquired FROM pg_advisory_xact_lock(3220261105::bigint)`;
        if (await tx.organization.findUnique({ where: { id: aurora.id } })) {
          return expandExistingAurora(tx);
        }

        for (const { id, name, cnpj } of companies) {
          await tx.organization.create({
            data: {
              id,
              name,
              fiscalIdentifier: cnpj,
              fiscalCandidate: cnpj,
              normalizedFiscalIdentifier: cnpj,
              fiscalState: 'VALID',
              clientClassification: 'DEMONSTRATION',
            },
          });
        }

        // Account creation and grants are atomic. A preexisting email aborts the seed.
        const hr = await tx.user.create({
          data: {
            email: hrEmail,
            name: 'RH sintético ID32',
            passwordHash: hrHash,
            memberships: {
              create: {
                organizationId: aurora.id,
                role: 'READER',
                hrCapabilities: [
                  'HR_PROFILE_READ',
                  'HR_PROFILE_MANAGE',
                  'HR_ANALYTICS_READ',
                  'HR_COMPENSATION_READ',
                  'HR_COMPENSATION_MANAGE',
                  'HR_EXPORT',
                ],
              },
            },
          },
        });
        await tx.user.create({
          data: {
            email: operatorEmail,
            name: 'Operador global sintético ID32',
            passwordHash: operatorHash,
            platformGrants: { create: { capability: 'READ_OVERVIEW' } },
          },
        });

        for (const company of companies) {
          const unit = await tx.unit.create({
            data: {
              organizationId: company.id,
              name: 'Unidade sintética',
              normalizedName: 'unidade sintetica',
            },
          });
          const sector = await tx.sector.create({
            data: {
              organizationId: company.id,
              unitId: unit.id,
              name: 'Operações sintéticas',
              normalizedName: 'operacoes sinteticas',
            },
          });
          for (const [index, person] of company.employees.entries()) {
            await createEmployee(tx, company, unit, sector, person, index, hr.id);
          }
        }
        return true;
      },
      { timeout: 20000 },
    );
  } finally {
    await client.$disconnect();
  }
}

const url = demoDatabaseUrl();
if (url) {
  const { MVP_DEMO_HR_PASSWORD: hrPassword, MVP_DEMO_OPERATOR_PASSWORD: operatorPassword } =
    process.env;
  if (
    hrPassword === operatorPassword ||
    [hrPassword, operatorPassword].some(
      (value) => !value || value.length < 16 || value.length > 256,
    )
  ) {
    console.error(
      'Defina MVP_DEMO_HR_PASSWORD e MVP_DEMO_OPERATOR_PASSWORD com valores distintos de 16 a 256 caracteres.',
    );
    process.exitCode = 1;
  } else {
    try {
      const created = await seed(url, hrPassword, operatorPassword);
      console.log(
        created
          ? 'Cenário ID32 preparado com dados sintéticos de teste.'
          : 'Cenário ID32 já preparado. Registros e senhas existentes foram preservados.',
      );
    } catch {
      console.error(
        'Falha ao preparar o cenário ID32. Verifique o build da API, as migrações, o banco local e possíveis conflitos com os dados de teste.',
      );
      process.exitCode = 1;
    }
  }
}
