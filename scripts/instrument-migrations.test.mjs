import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { localDatabaseUrl } from './local-database-url.mjs';
const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Pool } = requireApi('pg');
const migrations = new URL('../apps/api/prisma/migrations/', import.meta.url);
test('instrument catalog preserves populated legacy versions, cycles and anonymous answers', async () => {
  const source = new URL(localDatabaseUrl(process.env.DATABASE_URL ?? ''));
  const name = `renr_verify_${randomUUID().replaceAll('-', '')}`;
  assert.match(name, /^renr_verify_[a-f0-9]{32}$/);
  const adminUrl = new URL(source);
  adminUrl.pathname = '/postgres';
  const target = new URL(source);
  target.pathname = '/' + name;
  const admin = new Pool({ connectionString: adminUrl.href, max: 1 });
  const db = new Pool({ connectionString: target.href, max: 1 });
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    for (const folder of readdirSync(migrations)
      .filter((value) => /^\d{14}_/.test(value) && value < '20261024000000_instrument_catalog')
      .sort())
      await db.query(readFileSync(new URL(`${folder}/migration.sql`, migrations), 'utf8'));
    const [org, user, version, cycle, response, question, option, answer] = Array.from(
      { length: 8 },
      () => randomUUID(),
    );
    await db.query('INSERT INTO organizations(id,name,updated_at) VALUES($1,$2,now())', [
      org,
      'Synthetic old catalog',
    ]);
    await db.query(
      'INSERT INTO users(id,name,email,password_hash,updated_at) VALUES($1,$2,$3,$4,now())',
      [user, 'Synthetic old author', `${user}@example.test`, 'unused'],
    );
    await db.query(
      'INSERT INTO instrument_versions(id,organization_id,title,version) VALUES($1,$2,$3,1)',
      [version, org, 'Existing legacy projection'],
    );
    await db.query(
      "INSERT INTO diagnostic_questions(id,instrument_version_id,label,type,position) VALUES($1,$2,'Existing question','SINGLE_CHOICE',1)",
      [question, version],
    );
    await db.query(
      "INSERT INTO question_options(id,instrument_version_id,question_id,label,position) VALUES($1,$2,$3,'Existing answer',1)",
      [option, version, question],
    );
    await db.query(
      "INSERT INTO diagnostic_cycles(id,organization_id,instrument_version_id,name,starts_at,ends_at,status) VALUES($1,$2,$3,'Existing closed cycle',now(),now()+interval '1 day','CLOSED')",
      [cycle, org, version],
    );
    await db.query(
      'INSERT INTO diagnostic_responses(id,organization_id,cycle_id,instrument_version_id,submitted_period) VALUES($1,$2,$3,$4,CURRENT_DATE)',
      [response, org, cycle, version],
    );
    await db.query(
      'INSERT INTO response_answers(id,response_id,instrument_version_id,question_id,option_ids) VALUES($1,$2,$3,$4,$5::jsonb)',
      [answer, response, version, question, JSON.stringify([option])],
    );
    const snapshot = async () => ({
      versions: (
        await db.query(
          'SELECT id,organization_id,title,version,status,is_demo,created_at FROM instrument_versions ORDER BY id',
        )
      ).rows,
      questions: (await db.query('SELECT * FROM diagnostic_questions ORDER BY id')).rows,
      options: (await db.query('SELECT * FROM question_options ORDER BY id')).rows,
      cycles: (await db.query('SELECT * FROM diagnostic_cycles ORDER BY id')).rows,
      responses: (await db.query('SELECT * FROM diagnostic_responses ORDER BY id')).rows,
      answers: (await db.query('SELECT * FROM response_answers ORDER BY id')).rows,
    });
    const before = await snapshot();
    await db.query(
      readFileSync(new URL('20261024000000_instrument_catalog/migration.sql', migrations), 'utf8'),
    );
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(
      (
        await db.query(
          'SELECT i.system_key,v.instrument_id,v.usage_mode,v.revision FROM instrument_versions v JOIN instruments i ON i.id=v.instrument_id WHERE v.id=$1',
          [version],
        )
      ).rows,
      [
        {
          system_key: 'LEGACY_DEMO',
          instrument_id: version,
          usage_mode: 'DEMONSTRATION',
          revision: 1,
        },
      ],
    );
    await assert.rejects(
      db.query("UPDATE diagnostic_questions SET label='Altered' WHERE id=$1", [question]),
    );
    await assert.rejects(db.query('DELETE FROM instrument_versions WHERE id=$1', [version]));
    assert.deepEqual(await snapshot(), before);
  } finally {
    await db.end();
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
});
