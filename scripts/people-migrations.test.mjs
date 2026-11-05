import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { localDatabaseUrl } from './local-database-url.mjs';

const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Pool } = requireApi('pg');
const migrations = new URL('../apps/api/prisma/migrations/', import.meta.url);
const current = '20261104090000_people_platform_reports';
const splitGrants = '20261105090001_split_hr_capabilities';

test('People migrations preserve legacy CNPJs and the first platform grant requires explicit activation', async () => {
  const source = localDatabaseUrl(process.env.DATABASE_URL ?? '');
  const name = `renr_verify_${randomUUID().replaceAll('-', '')}`;
  assert.match(name, /^renr_verify_[a-f0-9]{32}$/);
  const adminUrl = new URL(source);
  adminUrl.pathname = '/postgres';
  const target = new URL(source);
  target.pathname = `/${name}`;
  const admin = new Pool({ connectionString: adminUrl.href, max: 1 });
  const db = new Pool({ connectionString: target.href, max: 1 });
  const folders = readdirSync(migrations)
    .filter((folder) => /^\d{14}_/.test(folder))
    .sort();
  const apply = async (entries) => {
    for (const folder of entries)
      await db.query(readFileSync(new URL(`${folder}/migration.sql`, migrations), 'utf8'));
  };
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    await apply(folders.filter((folder) => folder < current));
    const fixtures = [
      [null, 'MISSING', null],
      ['legacy identifier', 'INVALID', null],
      ['11.222.333/0001-81', 'CONFLICT', null],
      ['11222333000181', 'CONFLICT', null],
      ['12.ABC.345/01DE-35', 'VALID', '12ABC34501DE35'],
    ].map(([original, state, normalized]) => ({ id: randomUUID(), original, state, normalized }));
    for (const [index, fixture] of fixtures.entries())
      await db.query(
        'INSERT INTO organizations(id,name,fiscal_identifier,updated_at) VALUES($1,$2,$3,CURRENT_TIMESTAMP)',
        [fixture.id, `Synthetic organization ${index}`, fixture.original],
      );
    const userId = randomUUID();
    await db.query(
      'INSERT INTO users(id,name,email,password_hash,updated_at) VALUES($1,$2,$3,$4,CURRENT_TIMESTAMP)',
      [userId, 'Synthetic operator', `${userId}@example.test`, 'unused synthetic account'],
    );
    await apply(folders.filter((folder) => folder >= current && folder < splitGrants));
    const organizationId = fixtures[0].id;
    const inviteId = randomUUID();
    const mixed = [
      'HR_EXPORT',
      'TECHNICAL_DECISIONS',
      'HR_PROFILE_READ',
      'EXECUTE_ASSIGNED_ACTIONS',
    ];
    await db.query(
      `INSERT INTO memberships(user_id,organization_id,role,capabilities,version)
       VALUES($1,$2,'ADMIN',$3::"Capability"[],7)`,
      [userId, organizationId, mixed],
    );
    await db.query(
      `INSERT INTO access_invites(id,organization_id,email,name,role,capabilities,token_hash,version,created_by,expires_at)
       VALUES($1,$2,'synthetic-invite@example.test','Synthetic invite','READER',$3::"Capability"[],repeat('a',64),3,$4,now()+interval '1 day')`,
      [inviteId, organizationId, mixed, userId],
    );
    await apply(folders.filter((folder) => folder >= splitGrants));
    const split = {
      legacy: ['TECHNICAL_DECISIONS', 'EXECUTE_ASSIGNED_ACTIONS'],
      hr: ['HR_EXPORT', 'HR_PROFILE_READ'],
    };
    const member = await db.query(
      'SELECT capabilities::text[] AS legacy, hr_capabilities::text[] AS hr, version FROM memberships WHERE user_id=$1 AND organization_id=$2',
      [userId, organizationId],
    );
    assert.deepEqual(member.rows[0], { ...split, version: 7 });
    const invite = await db.query(
      'SELECT capabilities::text[] AS legacy, hr_capabilities::text[] AS hr, version FROM access_invites WHERE id=$1',
      [inviteId],
    );
    assert.deepEqual(invite.rows[0], { ...split, version: 3 });
    await assert.rejects(
      db.query(
        `UPDATE memberships SET capabilities=ARRAY['HR_EXPORT']::"Capability"[] WHERE user_id=$1`,
        [userId],
      ),
      { code: '23514' },
    );
    await assert.rejects(
      db.query(
        `UPDATE access_invites SET hr_capabilities=ARRAY['TECHNICAL_DECISIONS']::"Capability"[] WHERE id=$1`,
        [inviteId],
      ),
      { code: '23514' },
    );
    const rows = (
      await db.query(
        'SELECT id,fiscal_identifier,normalized_fiscal_identifier,fiscal_state FROM organizations',
      )
    ).rows;
    assert.equal(rows.length, fixtures.length);
    for (const fixture of fixtures) {
      const actual = rows.find((row) => row.id === fixture.id);
      assert.equal(actual.fiscal_identifier, fixture.original);
      assert.equal(actual.normalized_fiscal_identifier, fixture.normalized);
      assert.equal(actual.fiscal_state, fixture.state);
    }
    const { bootstrapPlatform } = requireApi('./dist/modules/platform/bootstrap-platform.js');
    const { PrismaService } = requireApi('./dist/database/prisma.service.js');
    const { parseEnvironment } = requireApi('./dist/config/env.js');
    const database = new PrismaService(
      parseEnvironment({
        NODE_ENV: 'test',
        DATABASE_URL: target.href,
      }),
    );
    try {
      const reason = 'Synthetic first grant';
      const countGrants = async () =>
        (await db.query('SELECT count(*)::int AS count FROM platform_grants')).rows[0].count;
      assert.equal(await countGrants(), 0);
      assert.equal(
        (await bootstrapPlatform(database, { userId, reason, apply: false })).applied,
        false,
      );
      assert.equal(await countGrants(), 0);
      assert.equal(
        (await bootstrapPlatform(database, { userId, reason, apply: true })).applied,
        true,
      );
      assert.equal(await countGrants(), 3);
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS count FROM platform_audit_events WHERE action='PLATFORM_BOOTSTRAP' AND subject_id=$1",
            [userId],
          )
        ).rows[0].count,
        1,
      );
      await assert.rejects(
        bootstrapPlatform(database, { userId, reason, apply: true }),
        /histórico de concessões/,
      );
    } finally {
      await database.onApplicationShutdown();
    }
  } finally {
    await db.end();
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  }
});
