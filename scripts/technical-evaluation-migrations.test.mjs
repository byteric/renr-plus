import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { localDatabaseUrl } from './local-database-url.mjs';

const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Pool } = requireApi('pg');
const migrations = new URL('../apps/api/prisma/migrations/', import.meta.url);
const firstTechnicalMigration = '20261025000000_technical_evaluation_methods';

test('technical evaluation migrations preserve populated context, history and empty method catalog', async () => {
  const source = localDatabaseUrl(process.env.DATABASE_URL ?? '');
  const name = `renr_verify_${randomUUID().replaceAll('-', '')}`;
  assert.match(name, /^renr_verify_[a-f0-9]{32}$/);
  const adminUrl = new URL(source);
  adminUrl.pathname = '/postgres';
  const target = new URL(source);
  target.pathname = `/${name}`;
  const admin = new Pool({ connectionString: adminUrl.href, max: 1 });
  const db = new Pool({ connectionString: target.href, max: 1 });
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    const folders = readdirSync(migrations)
      .filter((entry) => /^\d{14}_/.test(entry))
      .sort();
    for (const folder of folders.filter((entry) => entry < firstTechnicalMigration))
      await db.query(readFileSync(new URL(`${folder}/migration.sql`, migrations), 'utf8'));
    const seedCode = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['scripts/seed-demo.mjs'], {
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        env: {
          ...process.env,
          NODE_ENV: 'development',
          DATABASE_URL: target.href,
          DATABASE_URL_UNPOOLED: target.href,
          DEMO_PASSWORD: `Synthetic-${randomUUID()}`,
        },
        stdio: 'ignore',
        windowsHide: true,
      });
      child.once('error', reject);
      child.once('exit', resolve);
    });
    assert.equal(seedCode, 0, 'Synthetic seed must succeed before the ID11 migrations');
    const snapshot = async () => {
      const digest = createHash('sha256');
      for (const table of [
        'organizations',
        'users',
        'memberships',
        'units',
        'sectors',
        'assessment_groups',
        'risks',
        'risk_evaluations',
        'actions',
        'action_revisions',
        'action_evidence',
        'instrument_versions',
        'diagnostic_questions',
        'diagnostic_cycles',
        'response_answers',
      ]) {
        const result = await db.query(
          `SELECT to_jsonb(t) AS value FROM ${table} t ORDER BY to_jsonb(t)::text`,
        );
        digest.update(table).update(JSON.stringify(result.rows));
      }
      return digest.digest('hex');
    };
    const before = await snapshot();
    const counts = (
      await db.query(
        'SELECT (SELECT count(*) FROM risks)::int AS risks, (SELECT count(*) FROM risk_evaluations)::int AS evaluations, (SELECT count(*) FROM actions)::int AS actions',
      )
    ).rows[0];
    assert.ok(counts.risks > 0 && counts.evaluations > 0 && counts.actions > 0);
    for (const folder of [
      '20261025000000_technical_evaluation_methods',
      '20261025010000_technical_evaluation_integrity',
    ])
      await db.query(readFileSync(new URL(`${folder}/migration.sql`, migrations), 'utf8'));
    assert.equal(
      await snapshot(),
      before,
      'Additive migrations must preserve every captured legacy row',
    );
    const catalog = (
      await db.query(
        'SELECT (SELECT count(*) FROM evaluation_methods)::int AS methods, (SELECT count(*) FROM evaluation_method_versions)::int AS versions, (SELECT count(*) FROM technical_risk_evaluations)::int AS evaluations',
      )
    ).rows[0];
    assert.deepEqual(catalog, { methods: 0, versions: 0, evaluations: 0 });
  } finally {
    await db.end();
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  }
});
