import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { localDatabaseUrl } from './local-database-url.mjs';

const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Pool } = requireApi('pg');
const { parse } = requireApi('dotenv');
const environment = {
  ...parse(readFileSync(new URL('../apps/api/.env', import.meta.url), 'utf8')),
  ...process.env,
};
const migration = (name) =>
  readFileSync(
    new URL(`../apps/api/prisma/migrations/${name}/migration.sql`, import.meta.url),
    'utf8',
  );

test('v0.4/v0.5 additive migrations preserve v0.3 records and action history', async () => {
  const configured = new URL(localDatabaseUrl(environment.DATABASE_URL));
  const name = `renr_actions_${randomUUID().replaceAll('-', '')}`;
  assert.match(name, /^renr_actions_[a-f0-9]{32}$/);
  const adminUrl = new URL(configured);
  adminUrl.pathname = '/postgres';
  const temporaryUrl = new URL(configured);
  temporaryUrl.pathname = `/${name}`;
  const admin = new Pool({ connectionString: adminUrl.toString(), max: 1 });
  const db = new Pool({ connectionString: temporaryUrl.toString(), max: 1 });
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    for (const name of [
      '20261003000000_bootstrap',
      '20261004162547_identity_organizations_v01',
      '20261012000000_diagnostics_v02',
      '20261017000000_risk_inventory',
    ])
      await db.query(migration(name));
    const [
      org,
      user,
      unit,
      sector,
      group,
      instrument,
      question,
      cycle,
      response,
      risk,
      evaluation,
      action,
      revision,
      evidence,
    ] = Array.from({ length: 14 }, randomUUID);
    await db.query('INSERT INTO organizations(id,name,updated_at) VALUES ($1,$2,now())', [
      org,
      'Organização fictícia anterior',
    ]);
    await db.query(
      'INSERT INTO users(id,name,email,password_hash,updated_at) VALUES ($1,$2,$3,$4,now())',
      [user, 'Autor fictício', `${user}@renr.example`, 'unused'],
    );
    await db.query(
      "INSERT INTO sessions(id,token_hash,user_id,active_organization_id,expires_at) VALUES ($1,$2,$3,$4,now()+interval '1 hour')",
      [randomUUID(), `synthetic-${user}`, user, org],
    );
    await db.query(
      'INSERT INTO units(id,organization_id,name,normalized_name,updated_at) VALUES ($1,$2,$3,$3,now())',
      [unit, org, 'Unidade fictícia'],
    );
    await db.query(
      'INSERT INTO sectors(id,organization_id,unit_id,name,normalized_name,updated_at) VALUES ($1,$2,$3,$4,$4,now())',
      [sector, org, unit, 'Setor fictício'],
    );
    await db.query(
      'INSERT INTO assessment_groups(id,organization_id,sector_id) VALUES ($1,$2,$3)',
      [group, org, sector],
    );
    await db.query(
      'INSERT INTO instrument_versions(id,organization_id,title,version) VALUES ($1,$2,$3,1)',
      [instrument, org, 'Instrumento fictício'],
    );
    await db.query(
      "INSERT INTO diagnostic_questions(id,instrument_version_id,label,type,position) VALUES ($1,$2,$3,'SINGLE_CHOICE',1)",
      [question, instrument, 'Pergunta fictícia'],
    );
    await db.query(
      "INSERT INTO diagnostic_cycles(id,organization_id,instrument_version_id,name,starts_at,ends_at,status) VALUES ($1,$2,$3,$4,now(),now()+interval '1 hour','CLOSED')",
      [cycle, org, instrument, 'Ciclo fictício'],
    );
    await db.query(
      'INSERT INTO cycle_groups(id,organization_id,cycle_id,assessment_group_id) VALUES ($1,$2,$3,$4)',
      [randomUUID(), org, cycle, group],
    );
    await db.query(
      'INSERT INTO diagnostic_responses(id,organization_id,cycle_id,instrument_version_id,submitted_period) VALUES ($1,$2,$3,$4,current_date)',
      [response, org, cycle, instrument],
    );
    await db.query(
      "INSERT INTO response_answers(id,response_id,instrument_version_id,question_id,option_ids) VALUES ($1,$2,$3,$4,'[]')",
      [randomUUID(), response, instrument, question],
    );
    await db.query(
      "INSERT INTO risks(id,organization_id,assessment_group_id,factor,status,created_by_id,updated_by_id,updated_at) VALUES ($1,$2,$3,$4,'REGISTERED',$5,$5,now())",
      [risk, org, group, 'Origem fictícia anterior', user],
    );
    await db.query(
      "INSERT INTO risk_evaluations(id,organization_id,risk_id,sequence,risk_version,context_snapshot,method_reference,method_version,observation,rationale,author_id) VALUES ($1,$2,$3,1,1,'{}',$4,$5,$6,$7,$8)",
      [
        evaluation,
        org,
        risk,
        'Método fictício',
        '1',
        'Observação fictícia',
        'Justificativa fictícia',
        user,
      ],
    );
    const snapshot = async (tables) =>
      Object.fromEntries(
        await Promise.all(
          tables.map(async (table) => {
            assert.match(table, /^[a-z_]+$/);
            return [
              table,
              (await db.query(`SELECT to_jsonb(t) AS value FROM ${table} t ORDER BY id`)).rows,
            ];
          }),
        ),
      );
    const oldTables = [
      'organizations',
      'users',
      'sessions',
      'units',
      'sectors',
      'assessment_groups',
      'instrument_versions',
      'diagnostic_questions',
      'diagnostic_cycles',
      'diagnostic_responses',
      'response_answers',
      'risks',
      'risk_evaluations',
    ];
    const v03 = await snapshot(oldTables);
    await db.query(migration('20261021000000_actions_v04'));
    assert.deepEqual(await snapshot(oldTables), v03);
    await db.query(
      "INSERT INTO actions(id,organization_id,risk_id,evaluation_id,source_risk_version,context_snapshot,title,description,responsible_name,due_date,expected_result,verification_criterion,created_by_id,updated_by_id,updated_at) VALUES ($1,$2,$3,$4,1,'{}',$5,$6,$7,'2026-10-21',$8,$9,$10,$10,now())",
      [
        action,
        org,
        risk,
        evaluation,
        'Medida fictícia',
        'Descrição anterior preservada',
        'Pessoa fictícia',
        'Resultado esperado',
        'Critério de aferição',
        user,
      ],
    );
    await db.query(
      "INSERT INTO action_revisions(id,organization_id,action_id,version,event,snapshot,author_id) VALUES ($1,$2,$3,1,'CREATED','{}',$4)",
      [revision, org, action, user],
    );
    const beforeAction = await snapshot(['actions']);
    const beforeRevision = (
      await db.query(
        'SELECT id,organization_id,action_id,version,event,snapshot,change_reason,text,author_id,created_at FROM action_revisions ORDER BY id',
      )
    ).rows;
    await db.query(migration('20261021010000_action_evidence_v05'));
    assert.deepEqual(await snapshot(oldTables), v03);
    assert.deepEqual(await snapshot(['actions']), beforeAction);
    assert.deepEqual(
      (
        await db.query(
          'SELECT id,organization_id,action_id,version,event,snapshot,change_reason,text,author_id,created_at FROM action_revisions ORDER BY id',
        )
      ).rows,
      beforeRevision,
    );
    assert.equal(
      (await db.query('SELECT evidence_id FROM action_revisions')).rows[0].evidence_id,
      null,
    );
    assert.equal(
      (await db.query('SELECT count(*)::int AS count FROM action_evidence')).rows[0].count,
      0,
    );
    await db.query(
      "INSERT INTO action_evidence(id,organization_id,action_id,description,file_name,object_key,mime_type,size,sha256,action_version,created_by_id) VALUES ($1,$2,$3,$4,$5,$6,'application/pdf',1,$7,2,$8)",
      [
        evidence,
        org,
        action,
        'Metadado fictício sem objeto real',
        `${evidence}.pdf`,
        `${org}/${action}/${evidence}.pdf`,
        'a'.repeat(64),
        user,
      ],
    );
    await assert.rejects(
      db.query('UPDATE action_revisions SET text=$1 WHERE id=$2', ['Não permitido', revision]),
      /immutable/,
    );
    await assert.rejects(
      db.query('DELETE FROM action_evidence WHERE id=$1', [evidence]),
      /immutable/,
    );
    await assert.rejects(
      db.query(
        "UPDATE actions SET context_snapshot='{}'::jsonb || '{\"changed\":true}'::jsonb WHERE id=$1",
        [action],
      ),
      /immutable/,
    );
  } finally {
    await db.end();
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  }
});
