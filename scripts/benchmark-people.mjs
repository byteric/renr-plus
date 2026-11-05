import assert from 'node:assert/strict';
import { fork, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { availableParallelism, cpus, release, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { localDatabaseUrl } from './local-database-url.mjs';

const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
requireApi('reflect-metadata');

const databaseName = 'renr_id30_benchmark';
const referenceDate = '2026-11-04';
const now = new Date(referenceDate + 'T12:00:00.000Z');
const competence = '2026-11';
const source = 'Fixture ID30';
const rounds = Number(process.env.ID30_BENCHMARK_ROUNDS ?? 20);
const output = new URL('../tmp/', import.meta.url);
const pdfOnly = process.argv.includes('--pdf-only');
const seedPhase = process.argv.find((arg) => arg.startsWith('--seed='))?.slice('--seed='.length);

function benchmarkUrl() {
  const raw = process.env.ID30_BENCHMARK_DATABASE_URL;
  assert(raw, 'Defina ID30_BENCHMARK_DATABASE_URL para o banco local dedicado.');
  const url = localDatabaseUrl(raw);
  assert.equal(url.pathname, '/' + databaseName, 'Nome do banco dedicado obrigatório.');
  assert(
    !url.search && !url.hash && url.username,
    'Use uma URL PostgreSQL direta, sem parâmetros.',
  );
  return url.toString();
}

function id(group, index) {
  return '1d300000-0000-4000-800' + group.toString(16) + '-' + String(index).padStart(12, '0');
}

function fiscalId(index, validCnpj) {
  const base = 'TEST' + String(index + 1).padStart(8, '0');
  for (let digit = 0; digit < 100; digit++) {
    const candidate = base + String(digit).padStart(2, '0');
    if (validCnpj(candidate)) return candidate;
  }
  throw new Error('Fixture CNPJ sem dígitos verificadores.');
}

function memory() {
  const { rss, heapUsed, external } = process.memoryUsage();
  return { rss, heapUsed, external, maxRssKiB: process.resourceUsage().maxRSS };
}

function percentiles(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (p) => Number(sorted[Math.ceil(p * sorted.length) - 1].toFixed(2));
  return {
    p50: percentile(0.5),
    p75: percentile(0.75),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: percentile(1),
  };
}

async function measure(run, iterations = rounds) {
  const samplesMs = [];
  const before = memory();
  let maxSampledRss = before.rss;
  let result;
  let firstMs;
  for (let i = -1; i < iterations; i++) {
    const start = performance.now();
    result = await run();
    const elapsed = performance.now() - start;
    if (i === -1) firstMs = elapsed;
    else samplesMs.push(elapsed);
    maxSampledRss = Math.max(maxSampledRss, process.memoryUsage.rss());
  }
  return {
    firstMs: Number(firstMs.toFixed(2)),
    warmMs: percentiles(samplesMs),
    samplesMs,
    memory: { before, after: memory(), maxSampledRss },
    result,
  };
}

async function insertBatches(delegate, records) {
  for (let start = 0; start < records.length; start += 500) {
    await delegate.createMany({ data: records.slice(start, start + 500), skipDuplicates: true });
  }
}

async function seedOrganizations(client, validCnpj) {
  const organizations = Array.from({ length: 102 }, (_, index) => {
    const cnpj = index < 101 ? fiscalId(index, validCnpj) : null;
    return {
      id: id(1, index),
      name: 'ID30 cliente ' + String(index).padStart(3, '0'),
      fiscalIdentifier: cnpj,
      fiscalCandidate: cnpj,
      normalizedFiscalIdentifier: cnpj,
      fiscalState: cnpj ? 'VALID' : 'MISSING',
      clientClassification:
        index < 100 ? 'CLIENT' : index === 100 ? 'DEMONSTRATION' : 'UNCLASSIFIED',
      isActive: index !== 99,
    };
  });
  const users = ['Financeiro', 'RH', 'Plataforma'].map((name, index) => ({
    id: id(2, index),
    name: 'ID30 ' + name,
    email: 'id30-' + index + '@benchmark.invalid',
    passwordHash: 'fixture-no-login',
  }));
  // A previously populated database is acceptable only when its tenants and users are this fixture.
  for (const [delegate, fixture, identity] of [
    [client.organization, organizations, 'name'],
    [client.user, users, 'email'],
  ]) {
    const expected = new Map(fixture.map((row) => [row.id, row[identity]]));
    for (const row of await delegate.findMany({ select: { id: true, [identity]: true } })) {
      assert.equal(
        row[identity],
        expected.get(row.id),
        'Banco dedicado contém registros alheios à fixture.',
      );
    }
    await insertBatches(delegate, fixture);
  }

  const units = organizations.flatMap((organization, index) =>
    Array.from({ length: 4 }, (_, unit) => ({
      id: id(3, index * 4 + unit),
      organizationId: organization.id,
      name: 'Unidade ' + unit,
      normalizedName: 'unidade ' + unit,
    })),
  );
  const sectors = units.flatMap((unit, index) =>
    Array.from({ length: 2 }, (_, sector) => ({
      id: id(4, index * 2 + sector),
      organizationId: unit.organizationId,
      unitId: unit.id,
      name: 'Setor ' + sector,
      normalizedName: 'setor ' + sector,
    })),
  );
  await insertBatches(client.unit, units);
  await insertBatches(client.sector, sectors);
  await insertBatches(
    client.membership,
    [0, 1].flatMap((user) =>
      [0, 1].map((org) => ({
        userId: id(2, user),
        organizationId: id(1, org),
        role: 'READER',
        hrCapabilities:
          user === 0 ? ['HR_ANALYTICS_READ', 'HR_COMPENSATION_READ'] : ['HR_ANALYTICS_READ'],
      })),
    ),
  );
  await insertBatches(client.platformGrant, [{ userId: id(2, 2), capability: 'READ_OVERVIEW' }]);
  return organizations;
}

async function seedEmployees(client, organizations, concentrated) {
  const where = { organizationId: { in: organizations.map((row) => row.id) } };
  await client.$transaction(
    [
      client.employeeSettlementParameters.deleteMany({ where }),
      client.employeeVacationPeriod.deleteMany({ where }),
      client.employeeRemuneration.deleteMany({ where }),
      client.employmentPeriod.deleteMany({ where }),
      client.employeeHrProfile.deleteMany({ where }),
      client.employee.deleteMany({ where }),
    ],
    { timeout: 10_000 },
  );

  const employees = organizations.flatMap((org, index) => {
    const count = concentrated
      ? index === 1
        ? 10_000
        : 0
      : index === 0
        ? 0
        : index === 99
          ? 98
          : index >= 100
            ? 100
            : 99;
    return Array.from({ length: count }, (_, n) => {
      const unit = index * 4 + (n % 4);
      return {
        id: id(5, index * 10_000 + n),
        organizationId: org.id,
        unitId: id(3, unit),
        sectorId: id(4, unit * 2 + (Math.floor(n / 4) % 2)),
        name: 'Registro ' + String(n).padStart(5, '0'),
        isActive: n % 10 !== 9,
      };
    });
  });
  assert.equal(employees.length, 10_000);
  await insertBatches(client.employee, employees);
  const children = employees.map(({ id: employeeId, organizationId }, index) => ({
    index,
    data: { employeeId, organizationId, source, updatedById: id(2, 0) },
  }));
  const date = (value) => new Date(value + 'T00:00:00.000Z');
  await insertBatches(
    client.employeeHrProfile,
    children
      .filter(({ index }) => index % 7 !== 0)
      .map(({ index, data }) => ({
        ...data,
        birthDate: date(String(1965 + (index % 40)) + '-05-01'),
        gender: index % 2 === 0 ? 'FEMALE' : 'MALE',
        vacationHistoryKnown: true,
        complexLeaveHistoryKnown: true,
        followUp: index % 6 === 0,
      })),
  );
  await insertBatches(
    client.employmentPeriod,
    children.map(({ index, data }) => ({
      ...data,
      id: id(6, index),
      startsOn: date('2023-01-01'),
    })),
  );
  await insertBatches(
    client.employeeRemuneration,
    children
      .filter(({ index }) => index % 11 !== 0)
      .map(({ index, data }) => ({
        ...data,
        id: id(7, index),
        competence,
        salaryCents: 200_000 + index * 15,
      })),
  );
  await insertBatches(
    client.employeeVacationPeriod,
    children
      .filter(({ index }) => index % 3 !== 0)
      .map(({ index, data }) => ({
        ...data,
        id: id(8, index),
        acquisitionStart: date('2024-01-01'),
        acquisitionEnd: date('2024-12-31'),
        concessionDeadline: date(index % 2 === 0 ? '2025-12-31' : '2026-12-15'),
        entitlementDays: 30,
        balanceDays: 15,
        historyKnown: true,
      })),
  );
  await insertBatches(
    client.employeeSettlementParameters,
    children
      .filter(({ index }) => index % 5 !== 0)
      .map(({ data }) => ({
        ...data,
        referenceDate: date(referenceDate),
        input: {
          terminationDate: referenceDate,
          paidSalaryDays: 4,
          thirteenthAdvanceCents: '0',
          thirteenthHistoryKnown: true,
          currentAcquisitionStart: '2026-01-01',
          currentAcquisitionHistoryKnown: true,
          unjustifiedAbsences: 0,
        },
      })),
  );
  await client.$executeRawUnsafe('ANALYZE');
  assert.equal(await client.employee.count(), 10_000);
}

function connect() {
  const { Pool } = requireApi('pg');
  const { PrismaPg } = requireApi('@prisma/adapter-pg');
  const { PrismaClient } = requireApi('./dist/generated/prisma/client');
  const pool = new Pool({
    connectionString: benchmarkUrl(),
    max: 5,
    connectionTimeoutMillis: 2_000,
    query_timeout: 2_000,
    statement_timeout: 2_000,
  });
  const client = new PrismaClient({
    adapter: new PrismaPg(pool),
    log: [{ emit: 'event', level: 'query' }],
  });
  let captured;
  client.$on('query', (event) => captured?.push(event));
  return {
    pool,
    client,
    async capture(run) {
      captured = [];
      try {
        const result = await run();
        return { result, queries: captured };
      } finally {
        captured = undefined;
      }
    },
  };
}

async function seedPhaseInChild(phase) {
  // The parent keeps the database lock. Keep fixture creation and its memory outside the samples.
  await new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), ['--seed=' + phase], {
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      execArgv: [],
    });
    child.once('error', reject);
    child.once('exit', (status) => {
      if (status === 0) resolve();
      else reject(new Error('Falha ao preparar a fixture: ' + phase));
    });
  });
}

async function seedAsChild(phase) {
  assert(
    process.send && ['distribuido', 'concentrado'].includes(phase),
    'Modo interno da fixture.',
  );
  const { validCnpj } = requireApi('@renr/contracts');
  const { client, pool } = connect();
  try {
    const {
      rows: [target],
    } = await pool.query('SELECT current_database() db');
    assert.equal(target.db, databaseName);
    const organizations = await seedOrganizations(client, validCnpj);
    await seedEmployees(client, organizations, phase === 'concentrado');
  } finally {
    await client.$disconnect();
    await pool.end();
  }
}

async function databaseBenchmark() {
  const { validCnpj } = requireApi('@renr/contracts');
  const { PeopleAnalyticsService } = requireApi('./dist/modules/people/people-analytics.service');
  const { PlatformService } = requireApi('./dist/modules/platform/platform.service');
  const { client, pool, capture } = connect();
  const people = new PeopleAnalyticsService({ client });
  const platform = new PlatformService({ client });
  let lock;
  try {
    const start = performance.now();
    lock = await pool.connect();
    const {
      rows: [settings],
    } = await lock.query(
      "SELECT current_database() db, current_setting('server_version') postgres, current_setting('statement_timeout') timeout",
    );
    const initialConnectMs = performance.now() - start;
    assert.equal(settings.db, databaseName);
    assert.equal(settings.timeout, '2s');
    const {
      rows: [guard],
    } = await lock.query('SELECT pg_try_advisory_lock(30010000) locked');
    assert(guard.locked, 'Já existe um benchmark usando o banco dedicado.');

    const targetCnpj = fiscalId(1, validCnpj);
    const user = id(2, 2);
    const readPeople = (org, financial, filters = {}) =>
      people.overview(
        { organizationId: id(1, org), userId: id(2, financial ? 0 : 1) },
        { competence, ...filters },
        { now },
      );
    const cases = [];
    const plans = [];
    for (const phase of ['distribuido', 'concentrado']) {
      const concentrated = phase === 'concentrado';
      await seedPhaseInChild(phase);
      const probes = [
        {
          name: 'sonda-cnpj-exato',
          sql: 'SELECT id FROM organizations WHERE normalized_fiscal_identifier = $1 AND fiscal_state = $2',
          parameters: [targetCnpj, 'VALID'],
        },
        {
          name: 'sonda-remuneracao-competencia',
          sql: 'SELECT employee_id FROM employee_remunerations WHERE organization_id = $1 AND competence = $2 ORDER BY employee_id LIMIT 20',
          parameters: [id(1, 1), competence],
        },
        {
          name: 'sonda-ferias-prazo',
          sql: 'SELECT employee_id FROM employee_vacation_periods WHERE organization_id = $1 AND concession_deadline BETWEEN $2 AND $3 ORDER BY concession_deadline, employee_id LIMIT 20',
          parameters: [id(1, 1), referenceDate, '2027-01-03'],
        },
      ];
      for (const { name, sql, parameters } of probes) {
        const { rows } = await pool.query(
          'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + sql,
          parameters,
        );
        plans.push({ phase, name, calls: 1, sql, plan: rows[0]['QUERY PLAN'][0] });
      }
      const runCase = async (name, run, verify) => {
        const result = await measure(run);
        const { queries } = await capture(run);
        const reads = queries.filter(({ query }) => /^\s*(SELECT|WITH)\b/i.test(query));
        assert(reads.length > 0, 'O Prisma deve registrar as consultas reais.');
        const shapes = new Map();
        for (const event of reads) {
          // Prisma may use a different number of placeholders per catalogue page.
          const previous = shapes.get(event.query);
          if (previous) previous.calls++;
          else shapes.set(event.query, { event, calls: 1 });
        }
        for (const { event, calls } of shapes.values()) {
          const explanation = await pool.query(
            'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + event.query,
            JSON.parse(event.params),
          );
          plans.push({
            phase,
            name,
            calls,
            sql: event.query,
            plan: explanation.rows[0]['QUERY PLAN'][0],
          });
        }
        const verified = verify(result.result);
        cases.push({
          phase,
          name,
          ...result,
          result: verified,
          sqlReads: reads.length,
          allSql: queries.length,
        });
      };

      if (!concentrated) {
        await runCase(
          'plataforma-resumo',
          () => platform.overview(user),
          (result) => {
            assert.equal(result.organizations, 100);
            assert.equal(result.validatedCnpjs, 100);
            assert.equal(result.inactiveClients, 1);
            assert.equal(result.demonstrations, 1);
            assert.equal(result.pendingFiscal, 1);
            assert.equal(result.employees.active + result.employees.inactive, 9800);
            return result;
          },
        );
        for (const page of [1, 5]) {
          await runCase(
            'plataforma-catalogo-p' + page,
            () => platform.clients(user, { page, pageSize: 20 }),
            (result) => {
              assert.equal(result.total, 100);
              assert.equal(result.items.length, 20);
              const itemCounts = result.items.map(({ name, employees }) => ({
                name,
                total: employees.active + employees.inactive,
              }));
              if (page === 1)
                assert.deepEqual(
                  itemCounts.slice(0, 3).map(({ total }) => total),
                  [0, 99, 99],
                );
              return { total: result.total, page, itemCounts };
            },
          );
        }
        await runCase(
          'plataforma-cnpj',
          () => platform.clients(user, { page: 1, pageSize: 20, search: targetCnpj }),
          (result) => {
            assert.equal(result.total, 1);
            assert.equal(result.items[0].normalizedFiscalIdentifier, targetCnpj);
            return { total: result.total };
          },
        );
        await runCase(
          'rh-vazio',
          () => readPeople(0, false),
          (result) => {
            assert.equal(result.population.total, 0);
            return result.population;
          },
        );
      }

      for (const financial of [false, true]) {
        for (const filtered of [false, true]) {
          const filters = filtered
            ? { unitId: id(3, 4), sectorId: id(4, 8), isActive: 'true' }
            : {};
          await runCase(
            'rh-' + (financial ? 'financeiro' : 'sem-financeiro') + (filtered ? '-filtrado' : ''),
            () => readPeople(1, financial, filters),
            (result) => {
              const expected = concentrated ? (filtered ? 1250 : 10_000) : filtered ? 13 : 99;
              assert.equal(result.population.total, expected);
              assert.equal(result.population.active + result.population.inactive, expected);
              assert.equal(result.metrics.salaryMassCents.state === 'FORBIDDEN', !financial);
              return {
                population: result.population,
                salaryState: result.metrics.salaryMassCents.state,
                settlementState: result.metrics.terminationGrossCents.state,
              };
            },
          );
        }
      }
    }
    writeFileSync(new URL('id30-sql-plans.json', output), JSON.stringify(plans, null, 2) + '\n');
    return { settings, initialConnectMs, cases };
  } finally {
    if (lock) {
      // Destroy the session to release only its advisory lock, including after an interrupted case.
      lock.release(true);
    }
    await client.$disconnect();
    await pool.end();
  }
}

function pdfSnapshot(long) {
  const riskDetails =
    'Descrição: trabalho sob demanda.\nExposição: diária.\nGrupo: equipe.\nDanos: fadiga.\nControles: pausas.';
  const actionDetails =
    'Resultado esperado: reduzir exposição.\nCritério: inspeção periódica.\nImplementação: pendente.';
  return {
    id: id(9, 1),
    organizationId: id(1, 1),
    kind: 'SST',
    nominal: false,
    financial: false,
    title: 'Inventário e plano de ação',
    context: 'Cliente sintético ID30',
    timeZone: 'America/Sao_Paulo',
    createdAt: now.toISOString(),
    referenceDate,
    filters: [],
    limitations: ['Amostra sintética.'],
    sections: [
      {
        key: 'inventory',
        title: 'Inventário de riscos',
        notes: [],
        columns: ['Risco e situação', 'Unidade / setor', 'Caracterização', 'Origem'],
        rows: Array.from({ length: 300 }, (_, n) => [
          'Risco ' + n + '\nACTIVE · versão 1\n' + id(9, n),
          'Unidade / setor',
          long ? (riskDetails + '\n').repeat(10) : riskDetails,
          'MANUAL\nNota sintética\nNão informado',
        ]),
      },
      {
        key: 'actions',
        title: 'Plano de ação',
        notes: [],
        columns: ['Ação / risco', 'Situação e prazo', 'Responsável', 'Objetivo e verificação'],
        rows: Array.from({ length: 1000 }, (_, n) => [
          'Ação ' + n + '\nRisco ' + (n % 300) + '\nDescrição sintética.',
          'PLANNED · 2026-11-30\nVersão 1',
          'Responsável de teste',
          long ? (actionDetails + '\n').repeat(10) : actionDetails,
        ]),
      },
    ],
  };
}

async function pdfBenchmark() {
  const { renderReportPdf, REPORT_PDF_LIMITS, ReportPdfLimitError } = requireApi(
    './dist/modules/reports/report-pdf',
  );
  const fixtures = [];
  for (const long of [false, true]) {
    const snapshot = pdfSnapshot(long);
    const measured = await measure(async () => {
      const deadline = Date.now() + REPORT_PDF_LIMITS.milliseconds;
      try {
        const pdf = await renderReportPdf(snapshot, { deadline });
        assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
        // PDFKit emits page dictionaries outside compressed page content streams.
        const pages = [...pdf.toString('latin1').matchAll(/\/Type \/Page\b/g)].length;
        assert(pages > 0 && pages <= REPORT_PDF_LIMITS.pages);
        assert(pdf.length <= REPORT_PDF_LIMITS.bytes);
        assert(!long, 'O recorte extremo deve ser recusado integralmente.');
        return { pages, bytes: pdf.length };
      } catch (error) {
        if (!(error instanceof ReportPdfLimitError) || !long) throw error;
        return { code: error.code, reason: error.message };
      }
    }, 3);
    fixtures.push({
      profile: long ? 'texto-extremo' : 'texto-curto',
      inputBytes: Buffer.byteLength(JSON.stringify(snapshot)),
      ...measured,
    });
  }
  return { limits: REPORT_PDF_LIMITS, risks: 300, actions: 1000, fixtures };
}

try {
  if (!pdfOnly) {
    benchmarkUrl();
    assert(
      Number.isInteger(rounds) && rounds >= 3,
      'ID30_BENCHMARK_ROUNDS deve ser um inteiro ≥ 3.',
    );
  }
  if (seedPhase) await seedAsChild(seedPhase);
  else await writeEvidence();
} catch (error) {
  // Do not print a Prisma diagnostic that can include configured connection information.
  console.error(
    error.code ?? error.name,
    error instanceof assert.AssertionError ? error.message : 'Falha no benchmark.',
  );
  if (error instanceof Error)
    console.error(
      error.stack
        ?.split('\n')
        .filter((line) => line.startsWith('    at '))
        .slice(0, 8)
        .join('\n'),
    );
  process.exitCode = 1;
}

async function writeEvidence() {
  mkdirSync(output, { recursive: true });
  const git = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: new URL('../', import.meta.url),
    encoding: 'utf8',
  });
  const evidence = {
    timestamp: new Date().toISOString(),
    head: git.stdout?.trim(),
    environment: {
      node: process.version,
      platform: process.platform,
      release: release(),
      cpu: cpus()[0]?.model,
      parallelism: availableParallelism(),
      totalMemoryBytes: totalmem(),
    },
  };
  if (pdfOnly) evidence.pdf = await pdfBenchmark();
  else evidence.database = await databaseBenchmark();
  const filename = pdfOnly ? 'id30-pdf.json' : 'id30-benchmark.json';
  writeFileSync(new URL(filename, output), JSON.stringify(evidence, null, 2) + '\n');
  console.log('Resultado em tmp/' + filename);
}
