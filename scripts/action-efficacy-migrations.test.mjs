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
const efficacyMigration = '20261026000000_action_efficacy_opinions';

test('efficacy migration preserves populated operational actions and histories without inferring technical opinions', async () => {
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
    for (const folder of folders.filter((entry) => entry < efficacyMigration))
      await db.query(readFileSync(new URL(`${folder}/migration.sql`, migrations), 'utf8'));
    const seedCode = await new Promise((accept, reject) => {
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
      child.once('exit', accept);
    });
    assert.equal(seedCode, 0, 'Synthetic seed must succeed before efficacy expansion');
    // Normal seed does not upload documents. Populate one old-schema metadata row explicitly.
    const parent = (
      await db.query(
        'SELECT id,organization_id,version,created_by_id FROM actions ORDER BY id LIMIT 1',
      )
    ).rows[0];
    assert.ok(parent, 'An operational action is required for the populated attachment fixture');
    const evidenceId = randomUUID();
    await db.query(
      'INSERT INTO action_evidence(id,organization_id,action_id,description,file_name,object_key,mime_type,size,sha256,action_version,created_by_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [
        evidenceId,
        parent.organization_id,
        parent.id,
        'Synthetic migration preservation metadata',
        'migration-fixture.pdf',
        `synthetic-migration/${evidenceId}.pdf`,
        'application/pdf',
        24,
        createHash('sha256').update('Synthetic migration data').digest('hex'),
        parent.version,
        parent.created_by_id,
      ],
    );
    const tables = [
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
      'evaluation_methods',
      'evaluation_method_versions',
      'technical_risk_evaluations',
    ];
    const snapshot = async () => {
      const digest = createHash('sha256');
      for (const table of tables) {
        const rows = await db.query(
          `SELECT to_jsonb(t) AS value FROM ${table} t ORDER BY to_jsonb(t)::text`,
        );
        digest.update(table).update(JSON.stringify(rows.rows));
      }
      return digest.digest('hex');
    };
    const counts = (
      await db.query(
        'SELECT (SELECT count(*) FROM actions)::int AS actions, (SELECT count(*) FROM action_revisions)::int AS revisions, (SELECT count(*) FROM action_evidence)::int AS evidence',
      )
    ).rows[0];
    assert.ok(counts.actions > 0 && counts.revisions > 0 && counts.evidence > 0);
    const before = await snapshot();
    await db.query(readFileSync(new URL(`${efficacyMigration}/migration.sql`, migrations), 'utf8'));
    assert.equal(
      await snapshot(),
      before,
      'Technical expansion must preserve all captured legacy rows',
    );
    assert.equal(
      (await db.query('SELECT count(*)::int AS count FROM action_efficacy_opinions')).rows[0].count,
      0,
      'Execution reports must never be backfilled as efficacy opinions',
    );
  } finally {
    await db.end();
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  }
});
