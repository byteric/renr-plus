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
const current = '20261029090000_audit_history_references';
const newColumns = ['resource_type', 'reason', 'reference_type', 'reference_id', 'version'];
test(
  'audit migration preserves every populated legacy row and enforces optional exact references',
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
      for (const folder of readdirSync(migrations)
        .filter((value) => /^\d{14}_/.test(value) && value < current)
        .sort())
        await db.query(readFileSync(new URL(`${folder}/migration.sql`, migrations), 'utf8'));
      const seedExit = await new Promise((accept, reject) => {
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
      assert.equal(seedExit, 0, 'Legacy seed must succeed');
      const action = (
        await db.query('SELECT id,organization_id,created_by_id FROM actions ORDER BY id LIMIT 1')
      ).rows[0];
      assert.ok(action);
      const legacy = randomUUID();
      await db.query(
        'INSERT INTO audit_events(id,organization_id,actor_id,resource_id,action) VALUES($1,$2,$3,$4,$5)',
        [legacy, action.organization_id, action.created_by_id, action.id, 'ACTION_UPDATED'],
      );
      const tables = (
        await db.query(
          "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
        )
      ).rows.map((row) => row.tablename);
      const columns = new Map();
      for (const table of tables) {
        assert.match(table, /^[a-z_]+$/);
        columns.set(
          table,
          (
            await db.query(
              "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
              [table],
            )
          ).rows.map((row) => row.column_name),
        );
      }
      const snapshot = async () => {
        const result = {};
        for (const table of tables) {
          const names = columns
            .get(table)
            .map((column) => {
              assert.match(column, /^[a-z_][a-z0-9_]*$/);
              return `"${column}"`;
            })
            .join(',');
          const rows = (
            await db.query(
              `SELECT to_jsonb(old) AS value FROM (SELECT ${names} FROM "${table}") old ORDER BY to_jsonb(old)::text`,
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
        before.audit_events.count > 0 &&
          before.actions.count > 0 &&
          before.action_revisions.count > 0,
      );
      await db.query(readFileSync(new URL(`${current}/migration.sql`, migrations), 'utf8'));
      assert.deepEqual(
        await snapshot(),
        before,
        'Every pre-existing column and row must be preserved',
      );
      const row = (
        await db.query(
          'SELECT resource_type,reason,reference_type,reference_id,version FROM audit_events WHERE id=$1',
          [legacy],
        )
      ).rows[0];
      assert.deepEqual(
        row,
        Object.fromEntries(newColumns.map((column) => [column, null])),
        'Legacy events must not acquire inferred revision metadata',
      );
      const indexes = (
        await db.query(
          "SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='audit_events'",
        )
      ).rows.map((row) => row.indexname);
      for (const expected of [
        'audit_events_org_created_id_idx',
        'audit_events_org_action_created_id_idx',
        'audit_events_org_resource_created_id_idx',
        'audit_events_org_actor_created_id_idx',
      ])
        assert.ok(indexes.includes(expected), expected);
      const insert =
        'INSERT INTO audit_events(id,organization_id,action,reference_type,reference_id,version) VALUES($1,$2,$3,$4,$5,$6)';
      await assert.rejects(
        db.query(insert, [
          randomUUID(),
          action.organization_id,
          'INVALID_PAIR',
          'action-revision',
          null,
          1,
        ]),
        (error) => error.code === '23514',
      );
      await assert.rejects(
        db.query(insert, [randomUUID(), action.organization_id, 'INVALID_VERSION', null, null, 0]),
        (error) => error.code === '23514',
      );
      await db.query(insert, [
        randomUUID(),
        action.organization_id,
        'VALID_REFERENCE',
        'action-revision',
        randomUUID(),
        2,
      ]);
      assert.equal(
        (
          await db.query(
            'SELECT id,actor_id,organization_id,action,resource_id,created_at FROM audit_events WHERE id=$1',
            [legacy],
          )
        ).rows.length,
        1,
        'The legacy projection remains readable',
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
