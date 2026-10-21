import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { localDatabaseUrl } from './local-database-url.mjs';

const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Pool } = requireApi('pg');
const { parse } = requireApi('dotenv');
const environment = {
  ...parse(readFileSync(new URL('../apps/api/.env', import.meta.url), 'utf8')),
  ...process.env,
};

test('additive risk migration preserves existing v0.2 organizations, users, sessions, cycle and response', async () => {
  const configured = localDatabaseUrl(environment.DATABASE_URL);
  const name = `renr_v03_${randomUUID().replaceAll('-', '')}`;
  assert.match(name, /^renr_v03_[a-f0-9]{32}$/);
  const adminUrl = new URL(configured);
  adminUrl.pathname = '/postgres';
  const temporaryUrl = new URL(configured);
  temporaryUrl.pathname = `/${name}`;
  const admin = new Pool({ connectionString: adminUrl.toString(), max: 1 });
  const temporary = new Pool({ connectionString: temporaryUrl.toString(), max: 1 });
  let created = false;
  try {
    // Exact generated identifier checked above; only this new database is removed in finally.
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    for (const migration of [
      '20261003000000_bootstrap',
      '20261004162547_identity_organizations_v01',
      '20261012000000_diagnostics_v02',
    ]) {
      await temporary.query(
        readFileSync(
          new URL(`../apps/api/prisma/migrations/${migration}/migration.sql`, import.meta.url),
          'utf8',
        ),
      );
    }
    const org = randomUUID();
    const user = randomUUID();
    const unit = randomUUID();
    const sector = randomUUID();
    const instrument = randomUUID();
    const group = randomUUID();
    const cycle = randomUUID();
    const response = randomUUID();
    await temporary.query('INSERT INTO organizations(id,name,updated_at) VALUES ($1,$2,now())', [
      org,
      'Empresa fictícia anterior',
    ]);
    await temporary.query(
      'INSERT INTO users(id,name,email,password_hash,updated_at) VALUES ($1,$2,$3,$4,now())',
      [user, 'Autor fictício anterior', `${user}@renr.example`, 'unused'],
    );
    await temporary.query(
      "INSERT INTO sessions(id,token_hash,user_id,active_organization_id,expires_at) VALUES ($1,$2,$3,$4,now()+interval '1 hour')",
      [randomUUID(), `synthetic-${user}`, user, org],
    );
    await temporary.query(
      'INSERT INTO units(id,organization_id,name,normalized_name,updated_at) VALUES ($1,$2,$3,$3,now())',
      [unit, org, 'Unidade anterior'],
    );
    await temporary.query(
      'INSERT INTO sectors(id,organization_id,unit_id,name,normalized_name,updated_at) VALUES ($1,$2,$3,$4,$4,now())',
      [sector, org, unit, 'Setor anterior'],
    );
    await temporary.query(
      'INSERT INTO instrument_versions(id,organization_id,title,version) VALUES ($1,$2,$3,1)',
      [instrument, org, 'Instrumento anterior'],
    );
    await temporary.query(
      'INSERT INTO assessment_groups(id,organization_id,sector_id) VALUES ($1,$2,$3)',
      [group, org, sector],
    );
    await temporary.query(
      "INSERT INTO diagnostic_cycles(id,organization_id,instrument_version_id,name,starts_at,ends_at,status) VALUES ($1,$2,$3,$4,now(),now()+interval '1 hour','CLOSED')",
      [cycle, org, instrument, 'Ciclo anterior'],
    );
    await temporary.query(
      'INSERT INTO cycle_groups(id,organization_id,cycle_id,assessment_group_id) VALUES ($1,$2,$3,$4)',
      [randomUUID(), org, cycle, group],
    );
    await temporary.query(
      'INSERT INTO diagnostic_responses(id,organization_id,cycle_id,instrument_version_id,submitted_period) VALUES ($1,$2,$3,$4,current_date)',
      [response, org, cycle, instrument],
    );
    const snapshot = async () =>
      (
        await temporary.query(`SELECT
      (SELECT jsonb_agg(to_jsonb(t)) FROM organizations t) AS organizations,
      (SELECT jsonb_agg(to_jsonb(t)) FROM users t) AS users,
      (SELECT jsonb_agg(to_jsonb(t)) FROM sessions t) AS sessions,
      (SELECT jsonb_agg(to_jsonb(t)) FROM diagnostic_cycles t) AS cycles,
      (SELECT jsonb_agg(to_jsonb(t)) FROM diagnostic_responses t) AS responses`)
      ).rows;
    const before = await snapshot();
    await temporary.query(
      readFileSync(
        new URL(
          '../apps/api/prisma/migrations/20261017000000_risk_inventory/migration.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    assert.deepEqual(await snapshot(), before);
    const tables = await temporary.query(
      "SELECT to_regclass('risks')::text AS risks, to_regclass('risk_evaluations')::text AS evaluations",
    );
    assert.deepEqual(tables.rows[0], { risks: 'risks', evaluations: 'risk_evaluations' });
  } finally {
    await temporary.end();
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  }
});
