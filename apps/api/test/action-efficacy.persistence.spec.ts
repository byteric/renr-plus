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
database('ID15 raw PostgreSQL efficacy invariants', () => {
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
  beforeAll(async () => {
    const url = localDatabaseUrl(process.env.DATABASE_URL!);
    if (!['/renr_test', '/renr_technical_id11_verification'].includes(url.pathname))
      throw new Error('Dedicated local database required');
    if (
      (process.env.ID15_RED_GUARDS === '1' || process.env.ID15_CANDIDATE_MIGRATION === '1') &&
      url.pathname !== '/renr_technical_id11_verification'
    )
      throw new Error('Candidate requires dedicated verification database');
    db = new Client({ connectionString: url.toString() });
    await db.connect();
    await db.query('BEGIN');
    if (process.env.ID15_RED_GUARDS === '1') {
      // An unguarded candidate table exposes acceptance of invalid writes, never a missing-table Red.
      await db.query(
        `CREATE TABLE action_efficacy_opinions(id uuid,organization_id uuid,action_id uuid,risk_id uuid,sequence int,supersedes_id uuid,action_version int,action_snapshot jsonb,risk_context_snapshot jsonb,action_fingerprint text,risk_context_fingerprint text,context_fingerprint text,criterion_reference text,result text,verified_on date,observation text,rationale text,next_steps text,proof_package jsonb,author_id uuid,created_at timestamp DEFAULT now())`,
      );
    } else if (process.env.ID15_CANDIDATE_MIGRATION === '1')
      await db.query(
        readFileSync(
          resolve(
            __dirname,
            '../prisma/migrations/20261026000000_action_efficacy_opinions/migration.sql',
          ),
          'utf8',
        ),
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
  async function insert(overrides: Record<string, unknown> = {}, client = db) {
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
  it('accepts a technician opinion without changing action or operational history and allows a report preceding implementation', async () => {
    await insert();
    expect(
      (await db.query('SELECT version,status FROM actions WHERE id=$1', [action])).rows[0],
    ).toEqual({ version: 1, status: 'IMPLEMENTED' });
    expect(
      (
        await db.query('SELECT count(*)::int AS count FROM action_revisions WHERE action_id=$1', [
          action,
        ])
      ).rows[0],
    ).toEqual({ count: 1 });
  });
  it('rejects executor and administrator without technical capability', async () => {
    await reject(() => insert({ author_id: executor }));
  });
  it('requires exact current fingerprints, revision snapshot and copied criterion', async () => {
    for (const patch of [
      { action_fingerprint: '0'.repeat(64) },
      { risk_context_fingerprint: '0'.repeat(64) },
      { context_fingerprint: '0'.repeat(64) },
      { action_snapshot: '{}' },
      { risk_context_snapshot: '{}' },
      { criterion_reference: 'Invented' },
      { action_version: 2 },
    ])
      await reject(() => insert(patch));
  });
  it('requires the immediate same-action predecessor and next sequence', async () => {
    await reject(() => insert({ sequence: 2 }));
    const id = await insert();
    await reject(() => insert({ sequence: 2, supersedes_id: null }));
    await reject(() => insert({ sequence: 3, supersedes_id: id }));
    await insert({
      sequence: 2,
      supersedes_id: id,
      result: 'INCONCLUSIVE',
      next_steps: 'Collect additional results',
    });
  });
  it('rejects future dates, short rationale and missing follow-up', async () => {
    for (const patch of [
      { verified_on: '2999-01-01' },
      { rationale: 'short' },
      { observation: 'short' },
      { result: 'NOT_EFFECTIVE' },
      { result: 'INCONCLUSIVE' },
      { result: 'OTHER' },
    ])
      await reject(() => insert(patch));
  });
  it('rejects a forged operational revision even when the opinion copies it exactly', async () => {
    const id = randomUUID(),
      forged = { ...actionSnapshot, responsibleName: 'Invented responsible party' };
    await db.query(
      `INSERT INTO actions SELECT * FROM jsonb_populate_record(NULL::actions,(SELECT to_jsonb(a) || jsonb_build_object('id',$2::uuid) FROM actions a WHERE id=$1))`,
      [action, id],
    );
    await db.query(
      `INSERT INTO action_revisions(id,organization_id,action_id,version,event,snapshot,author_id) VALUES($1,$2,$3,1,'CREATED',$4,$5)`,
      [randomUUID(), org, id, JSON.stringify(forged), author],
    );
    await reject(() => insert({ action_id: id, action_snapshot: JSON.stringify(forged) }));
  });
  it('rejects dates outside the positive civil year contract', async () => {
    await reject(() => insert({ verified_on: '0001-01-01 BC' }));
  });
  it('validates proof content, hashes, duplicates and counts', async () => {
    for (const value of [
      { files: [], texts: [] },
      { ...proof, texts: [...proof.texts, ...proof.texts] },
      { ...proof, texts: [{ ...proof.texts[0], sha256: '0'.repeat(64) }] },
      {
        files: [],
        texts: Array.from({ length: 11 }, () => ({ ...proof.texts[0], id: randomUUID() })),
      },
      { files: [{ id: randomUUID() }], texts: [] },
      { ...proof, extra: true },
    ])
      await reject(() => insert({ proof_package: JSON.stringify(value) }));
  });
  it('rejects malformed JSON proof shapes as constraint violations', async () => {
    for (const value of [
      null,
      [],
      'text',
      { files: [], texts: [null] },
      { files: [], texts: ['text'] },
    ])
      await reject(() => insert({ proof_package: JSON.stringify(value) }));
  });
  it('checks selected file metadata, ownership, archival and frozen preservation', async () => {
    const file = {
      id: randomUUID(),
      fileName: 'proof.pdf',
      description: 'Evidence document',
      mimeType: 'application/pdf',
      size: 42,
      sha256: 'a'.repeat(64),
    };
    await db.query(
      `INSERT INTO action_evidence(id,organization_id,action_id,file_name,description,mime_type,size,sha256,object_key,action_version,created_by_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10)`,
      [
        file.id,
        org,
        action,
        file.fileName,
        file.description,
        file.mimeType,
        file.size,
        file.sha256,
        `id15/${file.id}`,
        author,
      ],
    );
    const selected = { files: [file], texts: [] };
    await reject(() =>
      insert({ proof_package: JSON.stringify({ files: [{ ...file, size: 43 }], texts: [] }) }),
    );
    await reject(() =>
      insert({
        proof_package: JSON.stringify({ files: [{ ...file, sha256: 'b'.repeat(64) }], texts: [] }),
      }),
    );
    await reject(() =>
      insert({
        proof_package: JSON.stringify({ files: [{ ...file, id: randomUUID() }], texts: [] }),
      }),
    );
    const id = await insert({ proof_package: JSON.stringify(selected) });
    await db.query(
      'UPDATE action_evidence SET archived_at=now(),archived_by_id=$2,archive_reason=$3 WHERE id=$1',
      [file.id, author, 'No longer current evidence'],
    );
    expect(
      (await db.query('SELECT proof_package FROM action_efficacy_opinions WHERE id=$1', [id]))
        .rows[0]?.proof_package,
    ).toEqual(selected);
    await reject(() =>
      insert({ sequence: 2, supersedes_id: id, proof_package: JSON.stringify(selected) }),
    );
  });
  it('requires active organization, member, registered origin and hierarchy', async () => {
    for (const sql of [
      `UPDATE organizations SET is_active=false WHERE id='${org}'`,
      `UPDATE memberships SET is_active=false WHERE user_id='${author}'`,
      `UPDATE risks SET status='ARCHIVED' WHERE id='${risk}'`,
      `UPDATE actions SET status='PLANNED',implemented_at=null,implementation_note=null WHERE id='${action}'`,
      `UPDATE units SET is_active=false WHERE id='${unit}'`,
      `UPDATE sectors SET is_active=false WHERE id='${sector}'`,
      `UPDATE assessment_groups SET is_active=false WHERE id='${group}'`,
    ]) {
      await db.query('SAVEPOINT inactive');
      await db.query(sql);
      await reject(() => insert());
      await db.query('ROLLBACK TO SAVEPOINT inactive');
    }
  });
  it('keeps history append-only', async () => {
    const id = await insert();
    await reject(() =>
      db.query('UPDATE action_efficacy_opinions SET result=$2 WHERE id=$1', [id, 'INCONCLUSIVE']),
    );
    await reject(() => db.query('DELETE FROM action_efficacy_opinions WHERE id=$1', [id]));
  });
  it('serializes competing opinions, risk edits and capability/evidence changes in isolated committed fixtures', async () => {
    // Separate schema permits real two-session races while public fixtures and candidate DDL remain rolled back.
    const schema = `id15_race_${randomUUID().replaceAll('-', '')}`;
    const url = localDatabaseUrl(process.env.DATABASE_URL!);
    const first = new Client({ connectionString: url.toString() }),
      second = new Client({ connectionString: url.toString() });
    await first.connect();
    await second.connect();
    let created = false;
    try {
      await first.query(`CREATE SCHEMA "${schema}"`);
      created = true;
      await first.query(`SET search_path TO "${schema}",public`);
      await second.query(`SET search_path TO "${schema}",public`);
      const tables = [
        'organizations',
        'users',
        'memberships',
        'units',
        'sectors',
        'assessment_groups',
        'risks',
        'actions',
        'action_revisions',
        'action_evidence',
      ];
      for (const table of tables) {
        await first.query(`CREATE TABLE "${table}" (LIKE public."${table}" INCLUDING ALL)`);
        const predicate =
          table === 'organizations'
            ? 'id=$1'
            : table === 'users'
              ? 'id=ANY($1::uuid[])'
              : 'organization_id=$1';
        const rows = (
          await db.query(`SELECT to_jsonb(t) AS row FROM public."${table}" t WHERE ${predicate}`, [
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
          resolve(
            __dirname,
            '../prisma/migrations/20261026000000_action_efficacy_opinions/migration.sql',
          ),
          'utf8',
        ),
      );
      await first.query('BEGIN');
      await insert({}, first);
      for (const sql of [
        `UPDATE organizations SET is_active=false WHERE id='${org}'`,
        `UPDATE memberships SET capabilities='{}' WHERE user_id='${author}'`,
        `UPDATE risks SET factor='Changed' WHERE id='${risk}'`,
        `UPDATE actions SET version=2 WHERE id='${action}'`,
        `UPDATE units SET is_active=false WHERE id='${unit}'`,
      ]) {
        await second.query('BEGIN');
        await second.query("SET LOCAL lock_timeout='150ms'");
        await expect(second.query(sql)).rejects.toMatchObject({ code: '55P03' });
        await second.query('ROLLBACK');
      }
      await first.query('ROLLBACK');
      const file = {
        id: randomUUID(),
        fileName: 'proof.pdf',
        description: 'Evidence document',
        mimeType: 'application/pdf',
        size: 42,
        sha256: 'a'.repeat(64),
      };
      await first.query(
        `INSERT INTO action_evidence(id,organization_id,action_id,file_name,description,mime_type,size,sha256,object_key,action_version,created_by_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10)`,
        [
          file.id,
          org,
          action,
          file.fileName,
          file.description,
          file.mimeType,
          file.size,
          file.sha256,
          `id15/${file.id}`,
          author,
        ],
      );
      await first.query('BEGIN');
      await insert({ proof_package: JSON.stringify({ files: [file], texts: [] }) }, first);
      await second.query('BEGIN');
      await second.query("SET LOCAL lock_timeout='150ms'");
      await expect(
        second.query(
          'UPDATE action_evidence SET archived_at=now(),archived_by_id=$2,archive_reason=$3 WHERE id=$1',
          [file.id, author, 'Archived after technical verification'],
        ),
      ).rejects.toMatchObject({ code: '55P03' });
      await second.query('ROLLBACK');
      await first.query('ROLLBACK');
      await first.query('BEGIN');
      await insert({}, first);
      await second.query('BEGIN');
      const competing = insert({}, second).catch((error: unknown) => error);
      await first.query('COMMIT');
      expect(await competing).toMatchObject({ code: '23514' });
      await second.query('ROLLBACK');
      const latest = (await first.query('SELECT id FROM action_efficacy_opinions')).rows[0]?.id;
      await second.query('BEGIN');
      await second.query('UPDATE risks SET factor=$2 WHERE id=$1', [
        risk,
        'Changed technical context',
      ]);
      await first.query('BEGIN');
      const stale = insert({ sequence: 2, supersedes_id: latest }, first).catch(
        (error: unknown) => error,
      );
      await second.query('COMMIT');
      expect(await stale).toMatchObject({ code: '23514' });
      await first.query('ROLLBACK');
    } finally {
      await first.query('ROLLBACK');
      await second.query('ROLLBACK');
      await second.end();
      if (created) await first.query(`DROP SCHEMA "${schema}" CASCADE`);
      await first.end();
    }
  }, 30000);
});
