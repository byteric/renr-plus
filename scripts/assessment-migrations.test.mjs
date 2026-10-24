import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { localDatabaseUrl } from './local-database-url.mjs';
const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Pool } = requireApi('pg');
const migrations = new URL('../apps/api/prisma/migrations/', import.meta.url);
test('assessment additive migration preserves populated legacy tables and enforces SQL isolation', async () => {
  const source = localDatabaseUrl(process.env.DATABASE_URL ?? '');
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
      .filter((v) => /^\d{14}_/.test(v) && v < '20261024010000_assessment_collection')
      .sort())
      await db.query(readFileSync(new URL(`${folder}/migration.sql`, migrations), 'utf8'));
    const [
      org,
      user,
      unit,
      sector,
      group,
      instrument,
      version,
      question,
      option,
      policy,
      cycle,
      invite,
      response,
    ] = Array.from({ length: 13 }, () => randomUUID());
    await db.query(
      "INSERT INTO organizations(id,name,updated_at) VALUES($1,'Synthetic assessment migration',now())",
      [org],
    );
    await db.query(
      "INSERT INTO users(id,name,email,password_hash,updated_at) VALUES($1,'Synthetic author',$2,'unused',now())",
      [user, `${user}@example.test`],
    );
    await db.query(
      "INSERT INTO units(id,organization_id,name,normalized_name,updated_at) VALUES($1,$2,'Unit','unit',now())",
      [unit, org],
    );
    await db.query(
      "INSERT INTO sectors(id,organization_id,unit_id,name,normalized_name,updated_at) VALUES($1,$2,$3,'Sector','sector',now())",
      [sector, org, unit],
    );
    await db.query('INSERT INTO assessment_groups(id,organization_id,sector_id) VALUES($1,$2,$3)', [
      group,
      org,
      sector,
    ]);
    await db.query('BEGIN');
    await db.query("INSERT INTO instruments(id,organization_id,name) VALUES($1,$2,'Catalog')", [
      instrument,
      org,
    ]);
    await db.query(
      "INSERT INTO instrument_versions(id,organization_id,instrument_id,title,version,status,usage_mode,is_demo) VALUES($1,$2,$3,'Catalog',1,'DRAFT','DEMONSTRATION',false)",
      [version, org, instrument],
    );
    await db.query(
      "INSERT INTO diagnostic_questions(id,instrument_version_id,label,type,position) VALUES($1,$2,'Question','SINGLE_CHOICE',1)",
      [question, version],
    );
    for (const [id, position] of [
      [option, 1],
      [randomUUID(), 2],
    ])
      await db.query(
        'INSERT INTO question_options(id,instrument_version_id,question_id,label,position) VALUES($1,$2,$3,$4,$5)',
        [id, version, question, 'Option', position],
      );
    await db.query(
      "UPDATE instrument_versions SET status='PUBLISHED',published_by_id=$2,published_at=now() WHERE id=$1",
      [version, user],
    );
    await db.query('COMMIT');
    const snapshot = async () => {
      const result = {};
      for (const table of [
        'organizations',
        'users',
        'assessment_groups',
        'instrument_versions',
        'diagnostic_questions',
        'question_options',
        'diagnostic_cycles',
        'diagnostic_responses',
        'response_answers',
      ])
        result[table] = (
          await db.query(`SELECT to_jsonb(t) AS value FROM ${table} t ORDER BY id`)
        ).rows;
      return result;
    };
    const before = await snapshot();
    await db.query(
      readFileSync(
        new URL('20261024010000_assessment_collection/migration.sql', migrations),
        'utf8',
      ),
    );
    assert.deepEqual(await snapshot(), before);
    await assert.rejects(
      db.query(
        "INSERT INTO consolidation_policy_versions(id,organization_id,version,usage_mode,minimum_responses) VALUES($1,$2,99,'DEMONSTRATION',NULL)",
        [randomUUID(), org],
      ),
    );
    await assert.rejects(
      db.query(
        "INSERT INTO consolidation_policy_versions(id,organization_id,version,usage_mode,minimum_responses,status,published_at,published_by_id) VALUES($1,$2,98,'REAL',5,'PUBLISHED',now(),$3)",
        [randomUUID(), org, user],
      ),
    );
    await db.query(
      "INSERT INTO consolidation_policy_versions(id,organization_id,version,usage_mode,minimum_responses) VALUES($1,$2,1,'DEMONSTRATION',5)",
      [policy, org],
    );
    await db.query(
      "UPDATE consolidation_policy_versions SET status='PUBLISHED',published_at=now(),published_by_id=$2 WHERE id=$1",
      [policy, user],
    );
    await assert.rejects(
      db.query('UPDATE consolidation_policy_versions SET minimum_responses=10 WHERE id=$1', [
        policy,
      ]),
    );
    await assert.rejects(
      db.query(
        "INSERT INTO consolidation_policy_versions(id,organization_id,version,usage_mode,minimum_responses,status,published_at,published_by_id) VALUES($1,$2,2,'REAL',NULL,'PUBLISHED',now(),$3)",
        [randomUUID(), org, user],
      ),
    );
    await db.query(
      "INSERT INTO assessment_cycles(id,organization_id,assessment_group_id,instrument_version_id,policy_version_id,name,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,'Synthetic cycle',now()-interval '1 minute',now()+interval '1 day')",
      [cycle, org, group, version, policy],
    );
    await db.query("UPDATE assessment_cycles SET status='OPEN' WHERE id=$1", [cycle]);
    await assert.rejects(
      db.query("UPDATE assessment_cycles SET ends_at=ends_at+interval '1 day' WHERE id=$1", [
        cycle,
      ]),
    );
    await assert.rejects(
      db.query("UPDATE assessment_cycles SET status='DRAFT' WHERE id=$1", [cycle]),
    );
    await assert.rejects(
      db.query('UPDATE assessment_cycles SET instrument_version_id=$2 WHERE id=$1', [
        cycle,
        randomUUID(),
      ]),
    );
    await assert.rejects(
      db.query('UPDATE assessment_cycles SET policy_version_id=$2 WHERE id=$1', [
        cycle,
        randomUUID(),
      ]),
    );
    await assert.rejects(
      db.query('UPDATE assessment_cycles SET assessment_group_id=$2 WHERE id=$1', [
        cycle,
        randomUUID(),
      ]),
    );
    const tokenHash = createHash('sha256').update(randomUUID()).digest('hex');
    await db.query(
      "INSERT INTO assessment_invites(id,organization_id,cycle_id,token_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 day')",
      [invite, org, cycle, tokenHash],
    );
    const failedResponse = randomUUID();
    await db.query('BEGIN');
    await db.query('UPDATE assessment_invites SET consumed_at=now() WHERE id=$1', [invite]);
    await db.query(
      'INSERT INTO assessment_responses(id,organization_id,cycle_id,instrument_version_id) VALUES($1,$2,$3,$4)',
      [failedResponse, org, cycle, version],
    );
    await assert.rejects(
      db.query(
        'INSERT INTO assessment_answers(id,response_id,instrument_version_id,question_id,option_ids) VALUES($1,$2,$3,$4,$5)',
        [randomUUID(), failedResponse, version, question, JSON.stringify([randomUUID()])],
      ),
    );
    await db.query('ROLLBACK');
    assert.equal(
      (await db.query('SELECT consumed_at FROM assessment_invites WHERE id=$1', [invite])).rows[0]
        .consumed_at,
      null,
    );
    assert.equal(
      (await db.query('SELECT id FROM assessment_responses WHERE id=$1', [failedResponse]))
        .rowCount,
      0,
    );
    await db.query(
      'INSERT INTO assessment_responses(id,organization_id,cycle_id,instrument_version_id) VALUES($1,$2,$3,$4)',
      [response, org, cycle, version],
    );
    await assert.rejects(
      db.query(
        'INSERT INTO assessment_answers(id,response_id,instrument_version_id,question_id,option_ids) VALUES($1,$2,$3,$4,$5)',
        [randomUUID(), response, version, question, JSON.stringify([option, option])],
      ),
    );
    await assert.rejects(
      db.query(
        'INSERT INTO assessment_answers(id,response_id,instrument_version_id,question_id,option_ids) VALUES($1,$2,$3,$4,$5)',
        [randomUUID(), response, version, question, JSON.stringify([randomUUID()])],
      ),
    );
    await assert.rejects(
      db.query(
        'INSERT INTO assessment_responses(id,organization_id,cycle_id,instrument_version_id) VALUES($1,$2,$3,$4)',
        [randomUUID(), randomUUID(), cycle, version],
      ),
    );
    await db.query(
      'INSERT INTO assessment_answers(id,response_id,instrument_version_id,question_id,option_ids) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(), response, version, question, JSON.stringify([option])],
    );
    await db.query(
      "INSERT INTO assessment_sources(id,organization_id,cycle_id,kind,context,occurred_on,summary,created_by_id) VALUES($1,$2,$3,'OBSERVATION','Collective context',CURRENT_DATE,'Collective source',$4)",
      [randomUUID(), org, cycle, user],
    );
    await assert.rejects(
      db.query("UPDATE assessment_sources SET summary='Changed' WHERE cycle_id=$1", [cycle]),
    );
    await assert.rejects(db.query('DELETE FROM assessment_sources WHERE cycle_id=$1', [cycle]));
    await assert.rejects(
      db.query(
        "INSERT INTO assessment_sources(id,organization_id,cycle_id,kind,context,occurred_on,summary,created_by_id) VALUES($1,$2,$3,'OBSERVATION','Collective context',CURRENT_DATE+2,'Future source',$4)",
        [randomUUID(), org, cycle, user],
      ),
    );
    const columns = (
      await db.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name='assessment_submission_receipts' ORDER BY column_name",
      )
    ).rows.map((r) => r.column_name);
    assert.deepEqual(columns, ['invite_hash', 'payload_mac', 'secret_hash']);
    assert.equal(
      (
        await db.query(
          "SELECT count(*) FROM information_schema.table_constraints WHERE table_name='assessment_submission_receipts' AND constraint_type='FOREIGN KEY'",
        )
      ).rows[0].count,
      '0',
    );
    assert.deepEqual(await snapshot(), before);
  } finally {
    await db.end();
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
});
