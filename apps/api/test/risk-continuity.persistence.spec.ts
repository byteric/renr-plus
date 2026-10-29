import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { localDatabaseUrl } from './local-database-url';

type SqlClient = {
  connect(): Promise<void>;
  end(): Promise<void>;
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
};
const { Client } = createRequire(__filename)('pg') as {
  Client: new (options: { connectionString: string }) => SqlClient;
};
const hash = (value: Record<string, unknown>) =>
  createHash('sha256')
    .update(
      JSON.stringify(
        Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
      ),
    )
    .digest('hex');
const database = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
database('ID17 continuity PostgreSQL invariants', () => {
  let db: SqlClient;
  const org = randomUUID(),
    author = randomUUID(),
    executor = randomUUID(),
    unit = randomUUID(),
    sector = randomUUID(),
    group = randomUUID(),
    risk = randomUUID(),
    action = randomUUID();
  const actionContent = {
    title: 'Ação com "aspas"\ne acentos',
    description: 'Description',
    expectedResult: 'Result',
    verificationCriterion: 'Criterion',
    status: 'IMPLEMENTED',
    implementationNote: 'Execution reported',
    implementedAt: '2026-01-01T12:00:00.000Z',
  };
  const actionSnapshot = { ...actionContent, responsibleName: 'External', dueDate: '2026-10-25' };
  const riskContent = {
    factor: 'Risk',
    description: null,
    exposureDescription: null,
    exposedGroupDescription: null,
    possibleHarms: null,
    existingControls: null,
    sourceKind: null,
    sourceNote: null,
    diagnosticCycleId: null,
    assessmentGroupId: group,
    sectorId: sector,
    unitId: unit,
  };
  const riskSnapshot = {
    ...riskContent,
    unitId: undefined,
    unit: { id: unit, name: 'Unit', isActive: true },
    sector: { id: sector, name: 'Sector', isActive: true },
    status: 'REGISTERED',
  };
  const text = {
    id: randomUUID(),
    reference: 'Document reference',
    description: 'Detailed evidence description',
    rationale: 'Document supports the conclusion',
  };
  const proof = {
    files: [],
    texts: [
      {
        ...text,
        sha256: hash({
          reference: text.reference,
          description: text.description,
          rationale: text.rationale,
        }),
      },
    ],
  };
  const af = hash(actionContent),
    rf = hash(riskContent);
  const schema = `id17_owned_${randomUUID().replaceAll('-', '')}`;
  beforeAll(async () => {
    const url = localDatabaseUrl(process.env.DATABASE_URL!);
    if (
      !['/renr_test', '/renr_technical_id11_verification'].includes(url.pathname) ||
      (url.port && url.port !== '5432')
    )
      throw new Error('Dedicated verification database required');
    db = new Client({ connectionString: url.toString() });
    await db.connect();
    await db.query('BEGIN');
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.query(`SET LOCAL search_path TO "${schema}",public`);
    const tables = (
      await db.query(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('_prisma_migrations','risk_reassessments','reassessment_measures','action_technical_closures','action_corrective_links')",
      )
    ).rows;
    for (const { tablename } of tables)
      await db.query(`CREATE TABLE "${tablename}" (LIKE public."${tablename}" INCLUDING ALL)`);
    if (process.env.ID17_RED_GUARDS === '1') {
      await db.query('CREATE TABLE risk_reassessments(id uuid primary key)');
      await db.query('INSERT INTO risk_reassessments VALUES($1)', [randomUUID()]);
      return;
    }
    await db.query(
      readFileSync(
        resolve(__dirname, '../prisma/migrations/20261027000000_risk_continuity/migration.sql'),
        'utf8',
      ),
    );
    await db.query(
      'CREATE TRIGGER opinion_guard BEFORE INSERT OR UPDATE OR DELETE ON action_efficacy_opinions FOR EACH ROW EXECUTE FUNCTION protect_action_efficacy_opinion()',
    );
    await db.query(
      "INSERT INTO organizations(id,name,updated_at) VALUES($1,'ID15 synthetic',now())",
      [org],
    );
    for (const id of [author, executor])
      await db.query(
        "INSERT INTO users(id,name,email,password_hash,updated_at) VALUES($1,'Technician',$2,'unused',now())",
        [id, `${id}@example.test`],
      );
    await db.query(
      `INSERT INTO memberships(user_id,organization_id,role,capabilities) VALUES($1,$3,'READER',ARRAY['TECHNICAL_DECISIONS']::"Capability"[]),($2,$3,'ADMIN',ARRAY['EXECUTE_ASSIGNED_ACTIONS']::"Capability"[])`,
      [author, executor, org],
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
    await db.query(
      "INSERT INTO risks(id,organization_id,assessment_group_id,factor,status,created_by_id,updated_by_id,updated_at) VALUES($1,$2,$3,'Risk','REGISTERED',$4,$4,now())",
      [risk, org, group, author],
    );
    await db.query(
      `INSERT INTO actions(id,organization_id,risk_id,source_risk_version,context_snapshot,title,description,responsible_name,due_date,expected_result,verification_criterion,status,implementation_note,implemented_at,created_by_id,updated_by_id,updated_at) VALUES($1,$2,$3,1,'{}',$5,'Description','External','2026-10-25','Result','Criterion','IMPLEMENTED','Execution reported','2026-01-01 12:00:00',$4,$4,now())`,
      [action, org, risk, author, actionContent.title],
    );
    await db.query(
      `INSERT INTO action_revisions(id,organization_id,action_id,version,event,snapshot,author_id) VALUES($1,$2,$3,1,'CREATED',$4,$5)`,
      [randomUUID(), org, action, JSON.stringify(actionSnapshot), author],
    );
  }, 60000);
  beforeEach(async () => {
    await db.query('SAVEPOINT test_case');
  });
  afterEach(async () => {
    await db.query('ROLLBACK TO SAVEPOINT test_case');
  });
  afterAll(async () => {
    if (db) {
      await db.query('ROLLBACK');
      await db.end();
    }
  });
  async function insertOpinion(overrides: Record<string, unknown> = {}, client = db) {
    const value = {
      id: randomUUID(),
      organization_id: org,
      action_id: action,
      risk_id: risk,
      sequence: 1,
      supersedes_id: null,
      action_version: 1,
      action_snapshot: JSON.stringify(actionSnapshot),
      risk_context_snapshot: JSON.stringify(riskSnapshot),
      action_fingerprint: af,
      risk_context_fingerprint: rf,
      context_fingerprint: hash({ actionFingerprint: af, riskContextFingerprint: rf }),
      criterion_reference: 'Criterion',
      result: 'EFFECTIVE',
      verified_on: '2025-01-01',
      observation: 'Observed adequate results',
      rationale: 'Technical conclusion supported by evidence',
      next_steps: null,
      proof_package: JSON.stringify(proof),
      author_id: author,
      ...overrides,
    };
    await client.query(
      `INSERT INTO action_efficacy_opinions(${Object.keys(value).join(',')}) VALUES(${Object.keys(
        value,
      )
        .map((_, i) => `$${i + 1}`)
        .join(',')})`,
      Object.values(value),
    );
    return value.id;
  }
  async function reject(write: () => Promise<unknown>, code = '23514') {
    await db.query('SAVEPOINT rejected_write');
    try {
      await expect(write()).rejects.toMatchObject({ code });
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT rejected_write');
    }
  }

  const baseline = randomUUID(),
    evaluation = randomUUID(),
    method = randomUUID();
  async function evalRow(id: string, sequence: number, authorId = author) {
    await db.query(
      `INSERT INTO technical_risk_evaluations(id,organization_id,risk_id,sequence,risk_version,method_version_id,probability_key,severity_key,result,method_snapshot,context_snapshot,context_fingerprint,rationale,context,sources,author_id) VALUES($1,$2,$3,$4,1,$5,'p','s','{}','{}','{}',$6,$7,$7,'[{"kind":"DOCUMENT","id":null,"title":"Synthetic source","reference":"synthetic-document","isDemonstration":false,"capturedAt":"2026-01-01T12:00:00.000Z"}]',$8)`,
      [
        id,
        org,
        risk,
        sequence,
        method,
        'a'.repeat(64),
        'Technical rationale sufficiently detailed',
        authorId,
      ],
    );
  }
  async function reassess(patch: Record<string, unknown> = {}) {
    const rr = {
      id: randomUUID(),
      organization_id: org,
      risk_id: risk,
      evaluation_id: evaluation,
      previous_evaluation_id: baseline,
      author_id: author,
      ...patch,
    };
    await write('risk_reassessments', rr);
    return rr.id;
  }
  async function write(table: string, value: Record<string, unknown>) {
    await db.query(
      `INSERT INTO ${table}(${Object.keys(value).join(',')}) VALUES(${Object.keys(value)
        .map((_, i) => `$${i + 1}`)
        .join(',')})`,
      Object.values(value),
    );
  }
  async function measure(rr: string, opinion: string, patch: Record<string, unknown> = {}) {
    await write('reassessment_measures', {
      id: randomUUID(),
      organization_id: org,
      risk_id: risk,
      reassessment_id: rr,
      action_id: action,
      opinion_id: opinion,
      action_version: 1,
      action_fingerprint: af,
      risk_context_fingerprint: rf,
      context_fingerprint: hash({ actionFingerprint: af, riskContextFingerprint: rf }),
      consideration: 'Measure evaluated with adequate evidence',
      ...patch,
    });
  }
  async function complete(
    result = 'EFFECTIVE',
    proofPackage: { files: unknown[]; texts: unknown[] } = proof,
  ) {
    await evalRow(baseline, 1);
    await evalRow(evaluation, 2);
    const opinion = await insertOpinion({
      result,
      proof_package: JSON.stringify(proofPackage),
      next_steps: result === 'EFFECTIVE' ? null : 'Collect additional results',
    });
    const rr = await reassess();
    await measure(rr, opinion);
    await db.query('SET CONSTRAINTS ALL IMMEDIATE');
    await db.query('SET CONSTRAINTS ALL DEFERRED');
    return { rr, opinion };
  }
  async function closure(rr: string, opinion: string, patch: Record<string, unknown> = {}) {
    const row = {
      id: randomUUID(),
      organization_id: org,
      risk_id: risk,
      action_id: action,
      sequence: 1,
      supersedes_id: null,
      reassessment_id: rr,
      opinion_id: opinion,
      action_version: 1,
      risk_version: 1,
      action_fingerprint: af,
      risk_context_fingerprint: rf,
      context_fingerprint: hash({ actionFingerprint: af, riskContextFingerprint: rf }),
      proof_package: JSON.stringify(proof),
      rationale: 'Technical closure supported by evidence',
      author_id: author,
      ...patch,
    };
    await write('action_technical_closures', row);
    return row.id;
  }
  it('rejects removal of immutable reassessment history', async () => {
    if (process.env.ID17_RED_GUARDS !== '1') await complete();
    await reject(() => db.query('DELETE FROM risk_reassessments'));
  });
  it.each(['EFFECTIVE', 'NOT_EFFECTIVE', 'INCONCLUSIVE'])(
    'accepts reassessment with %s current opinion',
    async (result) => {
      await complete(result);
    },
  );
  it('requires technical capability, current same-author evaluation and immediate predecessor', async () => {
    await evalRow(baseline, 1);
    await evalRow(evaluation, 2);
    await reject(() => reassess({ author_id: executor }));
    await db.query(
      `UPDATE memberships SET capabilities=ARRAY['TECHNICAL_DECISIONS']::"Capability"[] WHERE user_id=$1 AND organization_id=$2`,
      [executor, org],
    );
    await reject(() => reassess({ author_id: executor }));
    await reject(() => reassess({ evaluation_id: baseline, previous_evaluation_id: evaluation }));
    await reject(() => reassess({ previous_evaluation_id: randomUUID() }));
    await reject(() => reassess({ author_id: randomUUID() }));
  });
  it('requires one to twenty distinct measures, current fingerprints and detailed consideration', async () => {
    await evalRow(baseline, 1);
    await evalRow(evaluation, 2);
    const op = await insertOpinion();
    const rr = await reassess();
    await reject(() => db.query('SET CONSTRAINTS ALL IMMEDIATE'));
    await reject(async () => {
      await measure(rr, op, { context_fingerprint: '0'.repeat(64) });
      await db.query('SET CONSTRAINTS ALL IMMEDIATE');
    });
    await reject(() => measure(rr, op, { consideration: 'short' }));
    await measure(rr, op);
    await reject(() => measure(rr, op), '23505');
    await db.query('SET CONSTRAINTS ALL IMMEDIATE');
  });
  it('accepts operational notes, due date and responsibility changes without technical invalidation', async () => {
    const { rr, opinion } = await complete();
    await db.query(
      "UPDATE actions SET version=2,responsible_name='Other',due_date='2026-12-31' WHERE id=$1",
      [action],
    );
    await db.query(
      "INSERT INTO action_revisions(id,organization_id,action_id,version,event,snapshot,author_id) VALUES($1,$2,$3,2,'NOTE',$4,$5)",
      [randomUUID(), org, action, JSON.stringify(actionSnapshot), author],
    );
    await closure(rr, opinion, { action_version: 2 });
  });
  it('requires EFFECTIVE current opinion and latest reassessment, frozen proofs and current versions', async () => {
    const { rr, opinion } = await complete();
    for (const patch of [
      { proof_package: '{}' },
      { action_fingerprint: '0'.repeat(64) },
      { risk_version: 2 },
      { action_version: 2 },
      { author_id: executor },
    ])
      await reject(() => closure(rr, opinion, patch));
    await evalRow(randomUUID(), 3);
    await reject(() => closure(rr, opinion));
  });
  it.each(['NOT_EFFECTIVE', 'INCONCLUSIVE'])('rejects closure of %s opinion', async (result) => {
    const { rr, opinion } = await complete(result);
    await reject(() => closure(rr, opinion));
  });
  it('chains closures only after prior decision requires review and never mutates history', async () => {
    const { rr, opinion } = await complete();
    const first = await closure(rr, opinion);
    await reject(() => closure(rr, opinion, { sequence: 2, supersedes_id: first }));
    const next = randomUUID();
    await evalRow(next, 3);
    const rr2 = await reassess({ evaluation_id: next, previous_evaluation_id: evaluation });
    await measure(rr2, opinion);
    await db.query('SET CONSTRAINTS ALL IMMEDIATE');
    await reject(() => closure(rr2, opinion, { sequence: 3, supersedes_id: first }));
    await closure(rr2, opinion, { sequence: 2, supersedes_id: first });
    for (const table of [
      'risk_reassessments',
      'reassessment_measures',
      'action_technical_closures',
    ]) {
      await reject(() => db.query(`DELETE FROM ${table}`));
      await reject(() => db.query(`UPDATE ${table} SET id=id`));
    }
  });
  it('rejects changed technical action or inactive origin', async () => {
    const { rr, opinion } = await complete();
    for (const sql of [
      "UPDATE actions SET title='Changed' WHERE id=$1",
      "UPDATE risks SET factor='Changed' WHERE id=$1",
      'UPDATE units SET is_active=false WHERE id=$1',
      'UPDATE memberships SET is_active=false WHERE user_id=$1',
    ]) {
      await db.query('SAVEPOINT changed_context');
      await db.query(sql, [
        sql.includes('risks')
          ? risk
          : sql.includes('units')
            ? unit
            : sql.includes('memberships')
              ? author
              : action,
      ]);
      await reject(() => closure(rr, opinion));
      await db.query('ROLLBACK TO SAVEPOINT changed_context');
    }
  });
  it('creates an explicit corrective link only with ADMIN plus technical authority and a new planned action', async () => {
    const { opinion } = await complete();
    const child = randomUUID();
    await db.query(
      `INSERT INTO actions SELECT * FROM jsonb_populate_record(NULL::actions,(SELECT to_jsonb(a)||jsonb_build_object('id',$2::uuid,'status','PLANNED','implementation_note',null,'implemented_at',null) FROM actions a WHERE id=$1))`,
      [action, child],
    );
    await db.query(
      "INSERT INTO action_revisions(id,organization_id,action_id,version,event,snapshot,author_id) VALUES($1,$2,$3,1,'CREATED',$4,$5)",
      [randomUUID(), org, child, JSON.stringify(actionSnapshot), author],
    );
    const row = {
      id: randomUUID(),
      organization_id: org,
      risk_id: risk,
      previous_action_id: action,
      new_action_id: child,
      opinion_id: opinion,
      reason: 'Corrective measure explicitly justified',
      author_id: author,
    };
    await reject(() => write('action_corrective_links', row));
    await db.query("UPDATE memberships SET role='ADMIN' WHERE user_id=$1 AND organization_id=$2", [
      author,
      org,
    ]);
    await write('action_corrective_links', row);
    await reject(() => db.query('DELETE FROM action_corrective_links'));
    await reject(() => db.query('UPDATE action_corrective_links SET reason=reason'));
    expect((await db.query('SELECT status FROM actions WHERE id=$1', [action])).rows[0]).toEqual({
      status: 'IMPLEMENTED',
    });
  });

  it('rejects twenty-one measures and accepts the maximum twenty distinct actions', async () => {
    await evalRow(baseline, 1);
    await evalRow(evaluation, 2);
    const rr = await reassess();
    for (let i = 0; i < 20; i++) {
      const id = i === 0 ? action : randomUUID();
      if (i > 0) {
        await db.query(
          `INSERT INTO actions SELECT * FROM jsonb_populate_record(NULL::actions,(SELECT to_jsonb(a)||jsonb_build_object('id',$2::uuid) FROM actions a WHERE id=$1))`,
          [action, id],
        );
        await db.query(
          "INSERT INTO action_revisions(id,organization_id,action_id,version,event,snapshot,author_id) VALUES($1,$2,$3,1,'CREATED',$4,$5)",
          [randomUUID(), org, id, JSON.stringify(actionSnapshot), author],
        );
      }
      const op = await insertOpinion({ action_id: id });
      await measure(rr, op, { action_id: id });
    }
    await db.query('SET CONSTRAINTS ALL IMMEDIATE');
    await db.query('SET CONSTRAINTS ALL DEFERRED');
    await reject(async () => {
      const id = randomUUID();
      await db.query(
        `INSERT INTO actions SELECT * FROM jsonb_populate_record(NULL::actions,(SELECT to_jsonb(a)||jsonb_build_object('id',$2::uuid) FROM actions a WHERE id=$1))`,
        [action, id],
      );
      await db.query(
        "INSERT INTO action_revisions(id,organization_id,action_id,version,event,snapshot,author_id) VALUES($1,$2,$3,1,'CREATED',$4,$5)",
        [randomUUID(), org, id, JSON.stringify(actionSnapshot), author],
      );
      const op = await insertOpinion({ action_id: id });
      await measure(rr, op, { action_id: id });
      await db.query('SET CONSTRAINTS ALL IMMEDIATE');
    });
  });
  it('freezes selected proofs and rejects their archival while ignoring unselected attachments', async () => {
    const file = {
      id: randomUUID(),
      fileName: 'proof.pdf',
      description: 'Selected evidence document',
      mimeType: 'application/pdf',
      size: 42,
      sha256: 'a'.repeat(64),
    };
    for (const id of [file.id, randomUUID()])
      await db.query(
        `INSERT INTO action_evidence(id,organization_id,action_id,file_name,description,mime_type,size,sha256,object_key,action_version,created_by_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10)`,
        [
          id,
          org,
          action,
          file.fileName,
          file.description,
          file.mimeType,
          file.size,
          file.sha256,
          `id17/${id}`,
          author,
        ],
      );
    const selected = { files: [file], texts: [] };
    const { rr, opinion } = await complete('EFFECTIVE', selected);
    await db.query(
      'UPDATE action_evidence SET archived_at=now(),archived_by_id=$2,archive_reason=$3 WHERE action_id=$4 AND id<>$1',
      [file.id, author, 'Unselected document withdrawn', action],
    );
    const id = await closure(rr, opinion, { proof_package: JSON.stringify(selected) });
    await db.query(
      'UPDATE action_evidence SET archived_at=now(),archived_by_id=$2,archive_reason=$3 WHERE id=$1',
      [file.id, author, 'Selected document withdrawn'],
    );
    await reject(() =>
      closure(rr, opinion, {
        sequence: 2,
        supersedes_id: id,
        proof_package: JSON.stringify(selected),
      }),
    );
    expect(
      (await db.query('SELECT proof_package FROM action_technical_closures WHERE id=$1', [id]))
        .rows[0]?.proof_package,
    ).toEqual(selected);
  });
  it('serializes competing closures and protects organization, member, risk, action and hierarchy', async () => {
    const owned = `id17_race_${randomUUID().replaceAll('-', '')}`;
    const url = localDatabaseUrl(process.env.DATABASE_URL!);
    const first = new Client({ connectionString: url.toString() }),
      second = new Client({ connectionString: url.toString() });
    await first.connect();
    await second.connect();
    const fixtureDb = db;
    let created = false;
    try {
      await first.query(`CREATE SCHEMA "${owned}"`);
      created = true;
      await first.query(`SET search_path TO "${owned}",public`);
      await second.query(`SET search_path TO "${owned}",public`);
      const tables = (
        await fixtureDb.query(
          "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('_prisma_migrations','risk_reassessments','reassessment_measures','action_technical_closures','action_corrective_links')",
        )
      ).rows;
      for (const { tablename } of tables)
        await first.query(`CREATE TABLE "${tablename}" (LIKE public."${tablename}" INCLUDING ALL)`);
      for (const table of [
        'organizations',
        'users',
        'memberships',
        'units',
        'sectors',
        'assessment_groups',
        'risks',
        'actions',
        'action_revisions',
      ]) {
        const predicate =
          table === 'organizations'
            ? 'id=$1'
            : table === 'users'
              ? 'id=ANY($1::uuid[])'
              : 'organization_id=$1';
        const rows = (
          await fixtureDb.query(`SELECT to_jsonb(t) AS row FROM "${table}" t WHERE ${predicate}`, [
            table === 'users' ? [author, executor] : org,
          ])
        ).rows;
        for (const row of rows)
          await first.query(
            `INSERT INTO "${table}" SELECT * FROM jsonb_populate_record(NULL::"${table}",$1::jsonb)`,
            [JSON.stringify(row.row)],
          );
      }
      await first.query(
        readFileSync(
          resolve(__dirname, '../prisma/migrations/20261027000000_risk_continuity/migration.sql'),
          'utf8',
        ),
      );
      await first.query(
        'CREATE TRIGGER opinion_guard BEFORE INSERT OR UPDATE OR DELETE ON action_efficacy_opinions FOR EACH ROW EXECUTE FUNCTION protect_action_efficacy_opinion()',
      );
      const selectedFile = {
        id: randomUUID(),
        fileName: 'race.pdf',
        description: 'Selected race proof document',
        mimeType: 'application/pdf',
        size: 42,
        sha256: 'a'.repeat(64),
      };
      await first.query(
        `INSERT INTO action_evidence(id,organization_id,action_id,file_name,description,mime_type,size,sha256,object_key,action_version,created_by_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10)`,
        [
          selectedFile.id,
          org,
          action,
          selectedFile.fileName,
          selectedFile.description,
          selectedFile.mimeType,
          selectedFile.size,
          selectedFile.sha256,
          `id17/${selectedFile.id}`,
          author,
        ],
      );
      const selectedProof = { files: [selectedFile], texts: [] };
      const firstPid = (await first.query('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;
      await second.query('BEGIN');
      await second.query('SELECT id FROM actions WHERE id=$1 FOR UPDATE', [action]);
      await first.query('BEGIN');
      db = first;
      const waitingEvaluation = evalRow(randomUUID(), 1).catch((error: unknown) => error);
      let waiting = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        const state = (
          await second.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [
            firstPid,
          ])
        ).rows[0];
        if (state?.wait_event_type === 'Lock') {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      expect(
        (
          await second.query(
            `SELECT count(*)::int AS count FROM pg_locks WHERE pid=$1 AND relation IN ('units'::regclass,'sectors'::regclass,'assessment_groups'::regclass) AND mode='RowShareLock'`,
            [firstPid],
          )
        ).rows[0],
      ).toEqual({ count: 0 });
      await second.query('COMMIT');
      await waitingEvaluation;
      await first.query('ROLLBACK');
      await first.query('BEGIN');
      db = first;
      const { rr, opinion } = await complete('EFFECTIVE', selectedProof);
      await closure(rr, opinion, { proof_package: JSON.stringify(selectedProof) });
      for (const [sql, id] of [
        ['UPDATE organizations SET is_active=false WHERE id=$1', org],
        ["UPDATE memberships SET capabilities='{}' WHERE user_id=$1", author],
        ["UPDATE risks SET factor='Changed' WHERE id=$1", risk],
        ['UPDATE actions SET version=2 WHERE id=$1', action],
        ['UPDATE units SET is_active=false WHERE id=$1', unit],
        [
          `UPDATE action_evidence SET archived_at=now(),archived_by_id='${author}',archive_reason='Selected proof archived' WHERE id=$1`,
          selectedFile.id,
        ],
      ]) {
        await second.query('BEGIN');
        await second.query("SET LOCAL lock_timeout='150ms'");
        await expect(second.query(sql!, [id])).rejects.toMatchObject({ code: '55P03' });
        await second.query('ROLLBACK');
      }
      await second.query('BEGIN');
      db = second;
      const competing = closure(rr, opinion, {
        proof_package: JSON.stringify(selectedProof),
      }).catch((error: unknown) => error);
      await first.query('COMMIT');
      expect(await competing).toMatchObject({ code: '23514' });
      await second.query('ROLLBACK');
    } finally {
      db = fixtureDb;
      await first.query('ROLLBACK');
      await second.query('ROLLBACK');
      await second.end();
      if (created) await first.query(`DROP SCHEMA "${owned}" CASCADE`);
      await first.end();
    }
  }, 30000);
});
