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
const current = '20261028000000_evidence_upload_attempts';
async function seed(target) {
  const code = await new Promise((accept, reject) => {
    const child = spawn(process.execPath, ['scripts/seed-demo.mjs'], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      windowsHide: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        NODE_ENV: 'development',
        DATABASE_URL: target.href,
        DATABASE_URL_UNPOOLED: target.href,
        DEMO_PASSWORD: `Synthetic-${randomUUID()}`,
      },
    });
    child.once('error', reject);
    child.once('exit', accept);
  });
  assert.equal(code, 0, 'Legacy seed must succeed');
}
test(
  'upload attempt migration preserves populated metadata and history without inferring completed uploads',
  { timeout: 180000 },
  async () => {
    const source = localDatabaseUrl(process.env.DATABASE_URL ?? '');
    assert.ok(['/renr_test', '/renr_technical_id11_verification'].includes(source.pathname));
    assert.ok(!source.port || source.port === '5432');
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
      for (const folder of folders.filter((entry) => entry < current))
        await db.query(readFileSync(new URL(`${folder}/migration.sql`, migrations), 'utf8'));
      await seed(target);
      const action = (
        await db.query(
          'SELECT id,organization_id,created_by_id,version FROM actions ORDER BY id LIMIT 1',
        )
      ).rows[0];
      assert.ok(action);
      const id = randomUUID();
      await db.query(
        `INSERT INTO action_evidence(id,organization_id,action_id,description,file_name,object_key,mime_type,size,sha256,action_version,created_by_id)
      VALUES($1,$2,$3,'Legacy synthetic metadata preserved by the additive migration',$4,$5,'application/pdf',8,$6,$7,$8)`,
        [
          id,
          action.organization_id,
          action.id,
          `${id}.pdf`,
          `${action.organization_id}/${action.id}/${id}.pdf`,
          'a'.repeat(64),
          action.version,
          action.created_by_id,
        ],
      );
      const tables = (
        await db.query(
          "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
        )
      ).rows.map((row) => row.tablename);
      const snapshot = async () => {
        const result = {};
        for (const table of tables) {
          assert.match(table, /^[a-z_]+$/);
          const rows = (
            await db.query(
              `SELECT to_jsonb(t) AS value FROM "${table}" t ORDER BY to_jsonb(t)::text`,
            )
          ).rows;
          result[table] = {
            count: rows.length,
            sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
          };
        }
        return result;
      };
      const before = await snapshot();
      assert.ok(
        before.action_evidence.count > 0 &&
          before.actions.count > 0 &&
          before.action_revisions.count > 0,
      );
      await db.query(readFileSync(new URL(`${current}/migration.sql`, migrations), 'utf8'));
      assert.deepEqual(
        await snapshot(),
        before,
        'Every pre-existing table must retain its exact rows',
      );
      assert.equal(
        (await db.query('SELECT count(*)::int AS count FROM evidence_upload_attempts')).rows[0]
          .count,
        0,
      );
      await seed(target);
      assert.deepEqual(
        await snapshot(),
        before,
        'Repeated seed must preserve legacy files and action history',
      );
      assert.equal(
        (await db.query('SELECT count(*)::int AS count FROM evidence_upload_attempts')).rows[0]
          .count,
        0,
      );
    } finally {
      await db.end();
      if (created) {
        assert.match(name, /^renr_verify_[a-f0-9]{32}$/);
        assert.equal(target.pathname, `/${name}`);
        await admin.query(`DROP DATABASE "${name}"`);
      }
      await admin.end();
    }
  },
);
