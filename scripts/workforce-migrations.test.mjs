import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { localDatabaseUrl } from './local-database-url.mjs';
const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Pool } = requireApi('pg');
const migrations = new URL('../apps/api/prisma/migrations/', import.meta.url);
test('workforce expansion backfills names without replacing populated group references', async () => {
  const source = new URL(localDatabaseUrl(process.env.DATABASE_URL));
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
      .filter((value) => /^\d{14}_/.test(value) && value < '20261023010000_workforce')
      .sort())
      await db.query(readFileSync(new URL(`${folder}/migration.sql`, migrations), 'utf8'));
    const [org, user, unit, sector, group, instrument, cycle, cycleGroup, risk] = Array.from(
      { length: 9 },
      () => randomUUID(),
    );
    await db.query('INSERT INTO organizations(id,name,updated_at) VALUES($1,$2,now())', [
      org,
      'Synthetic organization',
    ]);
    await db.query(
      'INSERT INTO users(id,name,email,password_hash,updated_at) VALUES($1,$2,$3,$4,now())',
      [user, 'Synthetic author', `${user}@example.test`, 'unused'],
    );
    await db.query(
      'INSERT INTO units(id,organization_id,name,normalized_name,updated_at) VALUES($1,$2,$3,$4,now())',
      [unit, org, 'Synthetic unit', 'synthetic unit'],
    );
    await db.query(
      'INSERT INTO sectors(id,organization_id,unit_id,name,normalized_name,updated_at) VALUES($1,$2,$3,$4,$5,now())',
      [sector, org, unit, 'Existing sector', 'existing sector'],
    );
    await db.query('INSERT INTO assessment_groups(id,organization_id,sector_id) VALUES($1,$2,$3)', [
      group,
      org,
      sector,
    ]);
    await db.query(
      'INSERT INTO instrument_versions(id,organization_id,title,version) VALUES($1,$2,$3,1)',
      [instrument, org, 'Synthetic instrument'],
    );
    await db.query(
      "INSERT INTO diagnostic_cycles(id,organization_id,instrument_version_id,name,starts_at,ends_at) VALUES($1,$2,$3,$4,now(),now()+interval '1 day')",
      [cycle, org, instrument, 'Existing cycle'],
    );
    await db.query(
      'INSERT INTO cycle_groups(id,organization_id,cycle_id,assessment_group_id) VALUES($1,$2,$3,$4)',
      [cycleGroup, org, cycle, group],
    );
    await db.query(
      'INSERT INTO risks(id,organization_id,assessment_group_id,factor,created_by_id,updated_by_id,updated_at) VALUES($1,$2,$3,$4,$5,$5,now())',
      [risk, org, group, 'Existing factor', user],
    );
    const snapshot = async () =>
      (
        await db.query(
          'SELECT (SELECT row_to_json(r) FROM risks r WHERE id=$1) AS risk,(SELECT row_to_json(c) FROM diagnostic_cycles c WHERE id=$2) AS cycle,(SELECT row_to_json(g) FROM cycle_groups g WHERE id=$3) AS composition',
          [risk, cycle, cycleGroup],
        )
      ).rows;
    const before = await snapshot();
    await db.query(
      readFileSync(new URL('20261023010000_workforce/migration.sql', migrations), 'utf8'),
    );
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(
      (
        await db.query('SELECT id,name,is_active,version FROM assessment_groups WHERE id=$1', [
          group,
        ])
      ).rows,
      [{ id: group, name: 'Existing sector', is_active: true, version: 1 }],
    );
    await db.query('UPDATE assessment_groups SET is_active=false WHERE id=$1', [group]);
    assert.deepEqual(await snapshot(), before);
  } finally {
    await db.end();
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
});
