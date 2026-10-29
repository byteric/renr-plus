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
const firstAssignmentMigration = '20261025020000_action_assignments';

test('assignment migrations preserve populated actions, frozen revisions and nominal responsibility without inferring users', async () => {
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
    for (const folder of folders.filter((entry) => entry < firstAssignmentMigration))
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
    assert.equal(seedCode, 0, 'Synthetic seed must succeed before the ID13 migrations');
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
          `SELECT (to_jsonb(t) - 'assigned_user_id' - 'assigned_name' - 'assignment_change') AS value FROM ${table} t ORDER BY (to_jsonb(t) - 'assigned_user_id' - 'assigned_name' - 'assignment_change')::text`,
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
      '20261025020000_action_assignments',
      '20261025030000_action_assignment_history_integrity',
    ])
      await db.query(readFileSync(new URL(`${folder}/migration.sql`, migrations), 'utf8'));
    assert.equal(
      await snapshot(),
      before,
      'Additive migrations must preserve every captured legacy row',
    );
    const inferred = await db.query(
      'SELECT (SELECT count(*) FROM actions WHERE assigned_user_id IS NOT NULL OR assigned_name IS NOT NULL)::int AS actions, (SELECT count(*) FROM action_revisions WHERE assignment_change IS NOT NULL)::int AS revisions',
    );
    assert.deepEqual(inferred.rows[0], { actions: 0, revisions: 0 });
  } finally {
    await db.end();
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  }
});
