/* global AbortSignal */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { localDatabaseUrl } from './local-database-url.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const baseline = 'c301caae569442a4aa5ccef34111ffaf32f05982';
const requireApi = createRequire(path.join(root, 'apps/api/package.json'));
const { Pool } = requireApi('pg');
const pnpm = path.join(root, 'node_modules/pnpm/bin/pnpm.cjs');
const organization = '10000000-0000-4000-8000-000000000001';
const origin = 'http://127.0.0.1:49152';

// Child output is intentionally captured nowhere: API/build errors can contain credentials.
async function run(command, args, cwd, env, label) {
  const child = spawn(command, args, { cwd, env, stdio: 'ignore', windowsHide: true });
  const timeout = setTimeout(() => child.kill(), 180_000);
  try {
    const [code] = await once(child, 'exit');
    assert.equal(code, 0, `${label} failed (child output suppressed for privacy)`);
  } finally {
    clearTimeout(timeout);
  }
}

async function reservePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  assert.ok(![3000, 5173].includes(port));
  return port;
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill();
  await exited;
}

async function startApplication(directory, env) {
  const port = await reservePort();
  const child = spawn(process.execPath, ['apps/api/dist/main.js'], {
    cwd: directory,
    env: { ...env, PORT: String(port) },
    stdio: 'ignore',
    windowsHide: true,
  });
  // Register an error listener immediately, before readiness polling.
  let failed = false;
  child.on('error', () => {
    failed = true;
  });
  const url = `http://127.0.0.1:${port}/api/v1`;
  try {
    for (let attempt = 0; attempt < 150; attempt++) {
      assert.ok(!failed && child.exitCode === null, 'Application exited before readiness');
      try {
        const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) });
        if (response.ok) return { child, url };
      } catch {
        /* The process may still be binding its port. */
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error('Application readiness timed out');
  } catch (error) {
    await stop(child);
    throw error;
  }
}

async function consumer(application, contracts, password) {
  let cookie;
  async function request(route, schema, { method = 'GET', body, status = 200 } = {}) {
    const response = await fetch(`${application.url}${route}`, {
      method,
      headers: {
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(response.status, status, `${method} ${route} status`);
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';', 1)[0];
    const value = await response.json();
    // Avoid assertion diagnostics serializing session data on malformed responses.
    assert.equal(schema.safeParse(value).success, true, `v0.3 consumer rejected ${route}`);
    return value;
  }
  await request('/health', contracts.healthResponseSchema);
  await request('/ready', contracts.healthResponseSchema);
  await request('/auth/session', contracts.apiErrorSchema, { status: 401 });
  await request('/auth/sessions', contracts.sessionResponseSchema, {
    method: 'POST',
    status: 201,
    body: { email: 'admin1@renr.example', password },
  });
  await request('/auth/session/organization', contracts.sessionResponseSchema, {
    method: 'PUT',
    body: { organizationId: organization },
  });
  await request('/auth/session', contracts.sessionResponseSchema);
  const organizations = await request('/organizations', contracts.organizationListSchema);
  assert.ok(organizations.items.some((item) => item.id === organization));
  const base = `/organizations/${organization}`;
  const units = await request(`${base}/units`, contracts.unitListSchema);
  assert.ok(units.items.length > 0, 'Synthetic unit list must be nonempty');
  const sectors = await request(`/units/${units.items[0].id}/sectors`, contracts.sectorListSchema);
  assert.ok(sectors.items.length > 0, 'Synthetic sector list must be nonempty');
  const overview = await request(`${base}/overview`, contracts.organizationOverviewSchema);
  const instrument = await request(
    `${base}/diagnostic-instrument`,
    contracts.diagnosticInstrumentSchema,
  );
  const cycles = await request(`${base}/diagnostic-cycles`, contracts.diagnosticCycleListSchema);
  const risks = await request(`${base}/risks`, contracts.riskListSchema);
  await request(`${base}/risk-overview`, contracts.riskOverviewSchema);
  await request(`${base}/risk-registrations?days=7`, contracts.riskRegistrationsSchema);
  assert.ok(risks.items.length > 0, 'Synthetic risk inventory must be nonempty');
  const evaluatedRisk = risks.items.find((risk) => risk.latestEvaluation !== null);
  assert.ok(evaluatedRisk, 'At least one synthetic risk must have a preliminary evaluation');
  const evaluations = await request(
    `${base}/risks/${evaluatedRisk.id}/evaluations`,
    contracts.preliminaryEvaluationListSchema,
  );
  assert.ok(evaluations.items.some((item) => item.id === evaluatedRisk.latestEvaluation.id));
  assert.ok(instrument.questions.length === 5);
  return { request, base, overview, instrument, cycles, risks };
}

test(
  'frozen v0.3 consumers and application rollback preserve expanded v0.5 data',
  { timeout: 600_000 },
  async (t) => {
    // No .env fallback: the caller must explicitly choose the local database server.
    const configured = localDatabaseUrl(process.env.DATABASE_URL ?? '');
    const databaseName = `renr_compat_${randomUUID().replaceAll('-', '')}`;
    assert.match(databaseName, /^renr_compat_[a-f0-9]{32}$/);
    const adminUrl = new URL(configured);
    adminUrl.pathname = '/postgres';
    const databaseUrl = new URL(configured);
    databaseUrl.pathname = `/${databaseName}`;
    const admin = new Pool({ connectionString: adminUrl.toString(), max: 1 });
    const db = new Pool({ connectionString: databaseUrl.toString(), max: 1 });
    const temporaryParent = await realpath(tmpdir());
    const artifact = await mkdtemp(path.join(temporaryParent, 'renr-compat-'));
    const password = `Synthetic-${randomUUID()}`;
    const env = {
      ...process.env,
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      DATABASE_URL: databaseUrl.toString(),
      DATABASE_URL_UNPOOLED: databaseUrl.toString(),
      CORS_ORIGIN: origin,
      DEMO_PASSWORD: password,
      SERVE_WEB: 'false',
      STORAGE_ENABLED: 'false',
      CI: 'true',
      NO_COLOR: '1',
    };
    let created = false;
    let application;
    try {
      await admin.query(`CREATE DATABASE "${databaseName}"`);
      created = true;
      const archive = path.join(artifact, 'v03.tar');
      await run(
        'git',
        ['archive', '--format=tar', `--output=${archive}`, baseline],
        root,
        env,
        'v0.3 archive',
      );
      await run('tar', ['-xf', archive, '-C', artifact], root, env, 'v0.3 extraction');
      // These committed fixtures must never be refreshed from the current provider.
      for (const name of [
        'index',
        'diagnostics',
        'overview',
        'risks',
        'risk-overview',
        'risk-registrations',
      ]) {
        const frozen = await readFile(
          path.join(root, `tests/compatibility/v03-contracts/${name}.ts`),
          'utf8',
        );
        const archived = await readFile(
          path.join(artifact, `packages/contracts/src/${name}.ts`),
          'utf8',
        );
        assert.equal(
          frozen.replaceAll('\r\n', '\n').trimEnd(),
          archived.replaceAll('\r\n', '\n').trimEnd(),
          `Frozen ${name} differs from v0.3`,
        );
      }
      await run(
        process.execPath,
        [pnpm, 'install', '--offline', '--frozen-lockfile', '--ignore-scripts'],
        artifact,
        env,
        'Frozen offline v0.3 install',
      );
      for (const args of [
        ['--filter', '@renr/contracts', 'build'],
        ['--filter', '@renr/api', 'prisma:generate'],
        ['--filter', '@renr/api', 'build'],
      ])
        await run(process.execPath, [pnpm, ...args], artifact, env, `v0.3 ${args.at(-1)}`);
      const oldRequire = createRequire(path.join(artifact, 'apps/api/package.json'));
      const contracts = oldRequire('@renr/contracts');
      t.diagnostic(`Built isolated v0.3 artifact ${baseline}; frozen consumer fixtures verified`);

      for (const entry of (await readdir(path.join(root, 'apps/api/prisma/migrations'))).sort()) {
        if (!/^\d{14}_[a-z0-9_]+$/.test(entry)) continue;
        await db.query(
          await readFile(
            path.join(root, 'apps/api/prisma/migrations', entry, 'migration.sql'),
            'utf8',
          ),
        );
      }
      await run(
        process.execPath,
        ['scripts/seed-demo.mjs'],
        root,
        { ...env, NODE_ENV: 'development' },
        'v0.5 synthetic seed',
      );
      // Synthetic metadata only: no external object store or evidence file is contacted.
      const action = (
        await db.query(
          'SELECT id,organization_id,risk_id,created_by_id,version FROM actions WHERE organization_id=$1 ORDER BY id LIMIT 1',
          [organization],
        )
      ).rows[0];
      assert.ok(action, 'Expanded schema must contain synthetic actions');
      // Competing version-1 catalogs must not replace the frozen diagnostic projection.
      for (const usageMode of ['DEMONSTRATION', 'REAL']) {
        const instrumentId = randomUUID();
        const versionId = randomUUID();
        const questionId = randomUUID();
        await db.query('BEGIN');
        try {
          await db.query('INSERT INTO instruments(id,organization_id,name) VALUES($1,$2,$3)', [
            instrumentId,
            organization,
            `Synthetic ${usageMode} catalog`,
          ]);
          await db.query(
            "INSERT INTO instrument_versions(id,organization_id,instrument_id,title,version,status,is_demo,usage_mode) VALUES($1,$2,$3,$4,1,'DRAFT',false,$5)",
            [versionId, organization, instrumentId, `Synthetic ${usageMode} version`, usageMode],
          );
          await db.query(
            "INSERT INTO diagnostic_questions(id,instrument_version_id,label,type,position) VALUES($1,$2,'Synthetic ordinal question','ORDINAL_CHOICE',1)",
            [questionId, versionId],
          );
          for (const position of [1, 2])
            await db.query(
              'INSERT INTO question_options(id,instrument_version_id,question_id,label,position) VALUES($1,$2,$3,$4,$5)',
              [randomUUID(), versionId, questionId, `Synthetic option ${position}`, position],
            );
          await db.query(
            "UPDATE instrument_versions SET status='PUBLISHED',published_at=now(),published_by_id=$2,approval_reference=$3 WHERE id=$1",
            [
              versionId,
              action.created_by_id,
              usageMode === 'REAL' ? 'Synthetic approval for rollback test' : null,
            ],
          );
          await db.query('COMMIT');
          const policyId = randomUUID();
          const collectionId = randomUUID();
          const responseId = randomUUID();
          const assessmentGroup = (
            await db.query(
              'SELECT id FROM assessment_groups WHERE organization_id=$1 ORDER BY id LIMIT 1',
              [organization],
            )
          ).rows[0];
          assert.ok(assessmentGroup);
          await db.query(
            'INSERT INTO consolidation_policy_versions(id,organization_id,version,usage_mode,minimum_responses) VALUES($1,$2,$3,$4,5)',
            [policyId, organization, usageMode === 'REAL' ? 2 : 1, usageMode],
          );
          await db.query(
            "UPDATE consolidation_policy_versions SET status='PUBLISHED',published_at=now(),published_by_id=$2,approval_reference=$3 WHERE id=$1",
            [
              policyId,
              action.created_by_id,
              usageMode === 'REAL' ? 'Synthetic collection policy approval' : null,
            ],
          );
          await db.query(
            "INSERT INTO assessment_cycles(id,organization_id,assessment_group_id,instrument_version_id,policy_version_id,name,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,'Synthetic isolated collection',now()-interval '1 minute',now()+interval '1 day')",
            [collectionId, organization, assessmentGroup.id, versionId, policyId],
          );
          await db.query("UPDATE assessment_cycles SET status='OPEN' WHERE id=$1", [collectionId]);
          await db.query(
            "INSERT INTO assessment_invites(id,organization_id,cycle_id,token_hash,expires_at,consumed_at) VALUES($1,$2,$3,$4,now()+interval '1 day',now())",
            [
              randomUUID(),
              organization,
              collectionId,
              randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''),
            ],
          );
          await db.query(
            'INSERT INTO assessment_responses(id,organization_id,cycle_id,instrument_version_id) VALUES($1,$2,$3,$4)',
            [responseId, organization, collectionId, versionId],
          );
          const selectedOption = (
            await db.query(
              'SELECT id FROM question_options WHERE question_id=$1 ORDER BY position LIMIT 1',
              [questionId],
            )
          ).rows[0].id;
          await db.query(
            'INSERT INTO assessment_answers(id,response_id,instrument_version_id,question_id,option_ids) VALUES($1,$2,$3,$4,$5)',
            [randomUUID(), responseId, versionId, questionId, JSON.stringify([selectedOption])],
          );
          await db.query(
            "INSERT INTO assessment_sources(id,organization_id,cycle_id,kind,context,occurred_on,summary,created_by_id) VALUES($1,$2,$3,'OBSERVATION','Synthetic collective context',(now() AT TIME ZONE 'America/Sao_Paulo')::date,'Synthetic collective summary',$4)",
            [randomUUID(), organization, collectionId, action.created_by_id],
          );
          await db.query(
            "UPDATE assessment_cycles SET status='CLOSED',closed_at=now() WHERE id=$1",
            [collectionId],
          );
        } catch (error) {
          await db.query('ROLLBACK');
          throw error;
        }
      }
      assert.deepEqual(
        (
          await db.query(
            'SELECT usage_mode,is_demo,version FROM instrument_versions WHERE organization_id=$1 AND is_demo=false ORDER BY usage_mode',
            [organization],
          )
        ).rows,
        [
          { usage_mode: 'DEMONSTRATION', is_demo: false, version: 1 },
          { usage_mode: 'REAL', is_demo: false, version: 1 },
        ],
      );
      await db.query(
        "INSERT INTO action_evidence(id,organization_id,action_id,description,file_name,object_key,mime_type,size,sha256,action_version,created_by_id) VALUES ($1,$2,$3,'Synthetic rollback metadata','synthetic.pdf',$4,'application/pdf',1,$5,$6,$7)",
        [
          randomUUID(),
          action.organization_id,
          action.id,
          `synthetic/${randomUUID()}.pdf`,
          'a'.repeat(64),
          action.version,
          action.created_by_id,
        ],
      );
      const immutableTables = [
        'actions',
        'action_revisions',
        'action_evidence',
        'risk_evaluations',
        'consolidation_policy_versions',
        'assessment_cycles',
        'assessment_invites',
        'assessment_responses',
        'assessment_answers',
        'assessment_sources',
      ];
      async function history() {
        const snapshot = {};
        for (const table of immutableTables) {
          snapshot[table] = (
            await db.query(`SELECT to_jsonb(t) AS value FROM ${table} t ORDER BY id`)
          ).rows;
          assert.ok(snapshot[table].length > 0, `${table} history must be nonempty`);
        }
        return snapshot;
      }
      const before = await history();
      const riskIds = (await db.query('SELECT id FROM risks ORDER BY id')).rows;
      const diagnosticIds = (await db.query('SELECT id FROM instrument_versions ORDER BY id')).rows;
      application = await startApplication(root, env);
      const current = await consumer(application, contracts, password);
      const originalRisk = current.risks.items.find((risk) => risk.id === action.risk_id);
      assert.ok(originalRisk);
      await current.request(`${current.base}/risks/${originalRisk.id}`, contracts.riskDetailSchema);
      const cycle = await current.request(
        `${current.base}/diagnostic-cycles`,
        contracts.diagnosticCycleSchema,
        {
          method: 'POST',
          status: 201,
          body: {
            name: 'Synthetic rollback diagnostic',
            sectorId: originalRisk.sectorId,
            instrumentVersionId: current.instrument.id,
            startsAt: new Date(Date.now() + 60_000).toISOString(),
            endsAt: new Date(Date.now() + 3_600_000).toISOString(),
          },
        },
      );
      await current.request(
        `${current.base}/diagnostic-cycles/${cycle.id}/results`,
        contracts.diagnosticResultsSchema,
      );
      // Observable negative controls: fail both an extra strict field and a missing required field.
      assert.equal(
        contracts.organizationOverviewSchema.safeParse({
          ...current.overview,
          incompatibleField: true,
        }).success,
        false,
      );
      const missingId = { ...originalRisk };
      delete missingId.id;
      assert.equal(contracts.riskDetailSchema.safeParse(missingId).success, false);
      t.diagnostic(
        'Current API accepted by frozen v0.3 consumers; incompatible extra/missing fields rejected',
      );
      await stop(application.child);

      application = await startApplication(artifact, env);
      const legacy = await consumer(application, contracts, password);
      assert.ok(legacy.cycles.items.some((item) => item.id === cycle.id));
      await legacy.request(
        `${legacy.base}/diagnostic-cycles/${cycle.id}`,
        contracts.diagnosticCycleSchema,
      );
      await legacy.request(
        `${legacy.base}/diagnostic-cycles/${cycle.id}/results`,
        contracts.diagnosticResultsSchema,
      );
      const oldRisk = await legacy.request(
        `${legacy.base}/risks/${originalRisk.id}`,
        contracts.riskDetailSchema,
      );
      assert.equal(oldRisk.id, originalRisk.id);
      assert.equal(oldRisk.version, originalRisk.version);
      const edited = await legacy.request(
        `${legacy.base}/risks/${oldRisk.id}`,
        contracts.riskDetailSchema,
        {
          method: 'PATCH',
          body: {
            expectedVersion: oldRisk.version,
            factor: 'Synthetic edit through v0.3 rollback',
          },
        },
      );
      assert.equal(edited.version, oldRisk.version + 1);
      assert.deepEqual(await history(), before, 'Rollback must preserve full historical rows');
      t.diagnostic(
        'v0.3 application logged in, read overview/diagnostics/risk and edited risk on expanded v0.5 schema',
      );
      await stop(application.child);

      application = await startApplication(root, env);
      const resumed = await consumer(application, contracts, password);
      assert.ok(resumed.cycles.items.some((item) => item.id === cycle.id));
      await resumed.request(
        `${resumed.base}/diagnostic-cycles/${cycle.id}/results`,
        contracts.diagnosticResultsSchema,
      );
      const persisted = await resumed.request(
        `${resumed.base}/risks/${oldRisk.id}`,
        contracts.riskDetailSchema,
      );
      assert.equal(persisted.factor, 'Synthetic edit through v0.3 rollback');
      assert.equal(persisted.version, edited.version);
      assert.deepEqual(
        await history(),
        before,
        'Resuming current application must preserve full historical rows',
      );
      assert.deepEqual((await db.query('SELECT id FROM risks ORDER BY id')).rows, riskIds);
      assert.deepEqual(
        (await db.query('SELECT id FROM instrument_versions ORDER BY id')).rows,
        diagnosticIds,
      );
      t.diagnostic(
        `Current application resumed; unchanged historical rows: ${immutableTables.map((table) => `${table}=${before[table].length}`).join(', ')}`,
      );
    } finally {
      await stop(application?.child);
      await db.end();
      try {
        if (created) {
          assert.match(databaseName, /^renr_compat_[a-f0-9]{32}$/);
          await admin.query(
            'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
            [databaseName],
          );
          await admin.query(`DROP DATABASE "${databaseName}"`);
        }
      } finally {
        await admin.end();
        const resolved = await realpath(artifact);
        assert.equal(path.dirname(resolved), temporaryParent);
        assert.match(path.basename(resolved), /^renr-compat-[a-zA-Z0-9]+$/);
        await rm(resolved, { recursive: true, force: true });
      }
    }
  },
);
