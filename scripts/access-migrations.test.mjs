import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { localDatabaseUrl } from './local-database-url.mjs';

const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Pool } = requireApi('pg');
const { parse } = requireApi('dotenv');
const env = {
  ...parse(readFileSync(new URL('../apps/api/.env', import.meta.url), 'utf8')),
  ...process.env,
};
const migrations = new URL('../apps/api/prisma/migrations/', import.meta.url);

test('access expansion preserves populated legacy records and defaults to no capabilities', async () => {
  const source = new URL(localDatabaseUrl(env.DATABASE_URL));
  const name = `renr_access_${randomUUID().replaceAll('-', '')}`;
  assert.match(name, /^renr_access_[a-f0-9]{32}$/);
  const adminUrl = new URL(source);
  adminUrl.pathname = '/postgres';
  const target = new URL(source);
  target.pathname = `/${name}`;
  const admin = new Pool({ connectionString: adminUrl.toString(), max: 1 });
  const db = new Pool({ connectionString: target.toString(), max: 1 });
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    const previous = readdirSync(migrations)
      .filter((n) => n < '20261023000000_organization_access' && /^\d{14}_/.test(n))
      .sort();
    for (const folder of previous)
      await db.query(readFileSync(new URL(`${folder}/migration.sql`, migrations), 'utf8'));
    const org = randomUUID();
    const user = randomUUID();
    await db.query('INSERT INTO organizations(id,name,updated_at) VALUES($1,$2,now())', [
      org,
      'Synthetic migration organization',
    ]);
    await db.query(
      'INSERT INTO users(id,name,email,password_hash,updated_at) VALUES($1,$2,$3,$4,now())',
      [user, 'Synthetic author', `${user}@example.test`, 'unused-not-a-password'],
    );
    await db.query("INSERT INTO memberships(user_id,organization_id,role) VALUES($1,$2,'ADMIN')", [
      user,
      org,
    ]);
    const snapshot = async () =>
      await db
        .query(
          `SELECT
      (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM organizations t) AS organizations,
      (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM users t) AS users,
      (SELECT jsonb_agg(to_jsonb(t) ORDER BY user_id) FROM (SELECT user_id,organization_id,role FROM memberships) t) AS memberships,
      (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM sessions t) AS sessions,
      (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM risks t) AS risks,
      (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM risk_evaluations t) AS evaluations,
      (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM actions t) AS actions,
      (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM action_revisions t) AS revisions`,
        )
        .then((r) => r.rows);
    const before = await snapshot();
    await db.query(
      readFileSync(new URL('20261023000000_organization_access/migration.sql', migrations), 'utf8'),
    );
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(
      (
        await db.query(
          'SELECT is_active,version,to_jsonb(capabilities) AS capabilities FROM memberships',
        )
      ).rows,
      [{ is_active: true, version: 1, capabilities: [] }],
    );
    // A legacy writer remains valid after expansion; no client needs to set the added columns.
    await db.query(
      "INSERT INTO memberships(user_id,organization_id,role) VALUES($1,$2,'READER') ON CONFLICT(user_id,organization_id) DO UPDATE SET role=EXCLUDED.role",
      [user, org],
    );
    assert.equal((await db.query('SELECT role FROM memberships')).rows[0].role, 'READER');
    const historyId = randomUUID();
    await db.query(
      'INSERT INTO access_history(id,organization_id,user_id,actor_id,actor_name,action,reason) VALUES($1,$2,$3,$3,$4,$5,$6)',
      [
        historyId,
        org,
        user,
        'Synthetic author',
        'ACCESS_CAPABILITY_GRANTED:TECHNICAL_DECISIONS',
        'Synthetic authorization',
      ],
    );
    await assert.rejects(
      db.query('UPDATE access_history SET reason=$1 WHERE id=$2', ['Changed', historyId]),
      /immutable/,
    );
  } finally {
    await db.end();
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  }
});
