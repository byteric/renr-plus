import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { localDatabaseUrl } from './local-database-url';

// Raw SQL intentionally bypasses API validation to exercise database invariants.
type SqlClient = {
  connect(): Promise<void>;
  end(): Promise<void>;
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
};
const { Client } = createRequire(__filename)('pg') as {
  Client: new (options: { connectionString: string }) => SqlClient;
};
const describeDatabase = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
describeDatabase('ID11 PostgreSQL integrity', () => {
  const org = randomUUID();
  const user = randomUUID();
  const method = randomUUID();
  const version = randomUUID();
  const risk = randomUUID();
  const unit = randomUUID();
  const sector = randomUUID();
  const group = randomUUID();
  let contextSnapshot: Record<string, unknown>;
  const definition = {
    probability: [{ key: 'p', label: 'Probability', description: '', position: 1 }],
    severity: [{ key: 's', label: 'Severity', description: '', position: 1 }],
    levels: [{ key: 'l', label: 'Level' }],
    priorities: [{ key: 'r', label: 'Priority', rank: 1 }],
    matrix: [{ probabilityKey: 'p', severityKey: 's', levelKey: 'l', priorityKey: 'r' }],
  };
  let db: SqlClient;
  beforeAll(async () => {
    const url = localDatabaseUrl(process.env.DATABASE_URL!);
    if (!['/renr_technical_id11_verification', '/renr_test'].includes(url.pathname))
      throw new Error('Dedicated ID11 database required');
    db = new Client({ connectionString: url.toString() });
    await db.connect();
    await db.query('BEGIN');
    if (process.env.ID11_CANDIDATE_MIGRATION === '1') {
      if (url.pathname !== '/renr_technical_id11_verification')
        throw new Error('Candidate migration requires the dedicated local ID11 database');
      await db.query(
        readFileSync(
          resolve(
            __dirname,
            '../prisma/migrations/20261025010000_technical_evaluation_integrity/migration.sql',
          ),
          'utf8',
        ),
      );
    }
    const table = await db.query("SELECT to_regclass('evaluation_methods') AS name");
    // Allows Red against real tables before guards exist; always rolled back.
    if (!table.rows[0]?.name)
      await db.query(
        readFileSync(
          resolve(
            __dirname,
            '../prisma/migrations/20261025000000_technical_evaluation_methods/migration.sql',
          ),
          'utf8',
        ),
      );
    await db.query('INSERT INTO organizations(id,name,updated_at) VALUES($1,$2,now())', [
      org,
      'Synthetic SQL invariants',
    ]);
    await db.query(
      'INSERT INTO users(id,name,email,password_hash,updated_at) VALUES($1,$2,$3,$4,now())',
      [user, 'Synthetic technician', `${user}@example.test`, 'unused'],
    );
    await db.query(
      "INSERT INTO memberships(user_id,organization_id,role,capabilities) VALUES($1,$2,'READER',ARRAY['TECHNICAL_DECISIONS']::\"Capability\"[])",
      [user, org],
    );
    await db.query(
      'INSERT INTO evaluation_methods(id,organization_id,name,created_by_id) VALUES($1,$2,$3,$4)',
      [method, org, 'Synthetic method', user],
    );
    await db.query(
      'INSERT INTO evaluation_method_versions(id,organization_id,method_id,version,title,definition,created_by_id) VALUES($1,$2,$3,1,$4,$5,$6)',
      [version, org, method, 'Synthetic version', definition, user],
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
      "INSERT INTO risks(id,organization_id,assessment_group_id,factor,status,created_by_id,updated_by_id,updated_at) VALUES($1,$2,$3,'Synthetic risk','REGISTERED',$4,$4,now())",
      [risk, org, group, user],
    );
    contextSnapshot = {
      factor: 'Synthetic risk',
      description: null,
      exposureDescription: null,
      exposedGroupDescription: null,
      possibleHarms: null,
      existingControls: null,
      sourceKind: null,
      sourceNote: null,
      diagnosticCycleId: null,
      sectorId: sector,
      assessmentGroupId: group,
      unit: { id: unit, name: 'Unit', isActive: true },
      sector: { id: sector, name: 'Sector', isActive: true },
      status: 'REGISTERED',
    };
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
  async function reject(sql: string, values: unknown[] = []) {
    await db.query('SAVEPOINT invalid_write');
    try {
      await expect(db.query(sql, values).then(() => undefined)).rejects.toMatchObject({
        code: '23514',
      });
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT invalid_write');
    }
  }
  it('rejects incomplete publication and missing approval independently', async () => {
    await reject(
      "UPDATE evaluation_method_versions SET status='PUBLISHED',published_at=now(),published_by_id=$2,approval_reference='Synthetic approval',definition=$3 WHERE id=$1",
      [version, user, { ...definition, matrix: [] }],
    );
    await reject(
      "UPDATE evaluation_method_versions SET status='PUBLISHED',published_at=now(),published_by_id=$2 WHERE id=$1",
      [version, user],
    );
  });
  it('rejects duplicate keys, positions, ranks, unknown references and executable fields in drafts', async () => {
    for (const invalid of [
      { ...definition, probability: [...definition.probability, definition.probability[0]] },
      {
        ...definition,
        probability: [...definition.probability, { ...definition.probability[0], key: 'other' }],
      },
      {
        ...definition,
        priorities: [...definition.priorities, { key: 'other', label: 'Other', rank: 1 }],
      },
      { ...definition, matrix: [{ ...definition.matrix[0], levelKey: 'missing' }] },
      { ...definition, matrix: [definition.matrix[0], definition.matrix[0]] },
      { ...definition, levels: [{ key: 'invalid key', label: 'Invalid' }] },
      { ...definition, levels: [{ key: 'l', label: '' }] },
      { ...definition, priorities: [{ key: 'r', label: 'Priority', rank: 1.5 }] },
      { ...definition, probability: [{ ...definition.probability[0], extra: true }] },
      {
        ...definition,
        probability: Array.from({ length: 21 }, (_, i) => ({
          key: `p${i}`,
          label: 'P',
          description: '',
          position: i + 1,
        })),
        matrix: [],
      },
      { ...definition, formula: 'arbitrary code' },
    ])
      await reject('UPDATE evaluation_method_versions SET definition=$2 WHERE id=$1', [
        version,
        invalid,
      ]);
  });
  it('compares scale positions numerically rather than by JSON number spelling', async () => {
    const raw = JSON.stringify({
      ...definition,
      probability: [
        ...definition.probability,
        { ...definition.probability[0], key: 'other', position: 2 },
      ],
    }).replace('"position":2', '"position":1.0');
    await reject('UPDATE evaluation_method_versions SET definition=$2 WHERE id=$1', [version, raw]);
  });
  it('freezes catalog identity and version identity', async () => {
    await reject("UPDATE evaluation_methods SET name='Changed' WHERE id=$1", [method]);
    await reject('UPDATE evaluation_method_versions SET version=2 WHERE id=$1', [version]);
    await reject(
      "UPDATE evaluation_method_versions SET approval_reference='Synthetic approval' WHERE id=$1",
      [version],
    );
  });
  it('requires active technical capability for new catalogs', async () => {
    await db.query(
      "UPDATE memberships SET capabilities='{}' WHERE user_id=$1 AND organization_id=$2",
      [user, org],
    );
    await reject(
      "INSERT INTO evaluation_methods(id,organization_id,name,created_by_id) VALUES($1,$2,'Unauthorized method',$3)",
      [randomUUID(), org, user],
    );
    await db.query(
      'UPDATE memberships SET capabilities=ARRAY[\'TECHNICAL_DECISIONS\']::"Capability"[] WHERE user_id=$1 AND organization_id=$2',
      [user, org],
    );
  });
  it('preserves approved history after publisher loses membership, and blocks update/delete', async () => {
    await db.query(
      "UPDATE evaluation_method_versions SET status='PUBLISHED',approval_reference='Synthetic documented approval',published_by_id=$2,published_at=now() WHERE id=$1",
      [version, user],
    );
    await db.query(
      'UPDATE memberships SET is_active=false WHERE user_id=$1 AND organization_id=$2',
      [user, org],
    );
    await reject("UPDATE evaluation_method_versions SET title='Changed title' WHERE id=$1", [
      version,
    ]);
    await reject('DELETE FROM evaluation_method_versions WHERE id=$1', [version]);
    expect(
      (await db.query('SELECT status FROM evaluation_method_versions WHERE id=$1', [version]))
        .rows[0]?.status,
    ).toBe('PUBLISHED');
    await db.query(
      'UPDATE memberships SET is_active=true WHERE user_id=$1 AND organization_id=$2',
      [user, org],
    );
  });
  const insertEvaluation =
    "INSERT INTO technical_risk_evaluations(id,organization_id,risk_id,sequence,risk_version,method_version_id,probability_key,severity_key,result,method_snapshot,context_snapshot,context_fingerprint,rationale,context,sources,author_id) VALUES($1,$2,$3,$4,$5,$6,'p','s',$7,$8,$9,$10,'Synthetic rationale','Synthetic context',$11,$12)";
  function snapshotFingerprint(snapshot: Record<string, unknown>) {
    const snapshotUnit = snapshot.unit;
    const content = Object.fromEntries(
      Object.entries(snapshot).filter(([key]) => !['unit', 'sector', 'status'].includes(key)),
    );
    const fingerprintContent = { ...content, unitId: (snapshotUnit as { id: string }).id };
    const canonical = Object.fromEntries(
      Object.entries(fingerprintContent).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }
  function evaluationValues() {
    return [
      randomUUID(),
      org,
      risk,
      1,
      1,
      version,
      {
        probability: { key: 'p', label: 'Probability' },
        severity: { key: 's', label: 'Severity' },
        level: { key: 'l', label: 'Level' },
        priority: { key: 'r', label: 'Priority', rank: 1 },
      },
      {
        id: method,
        name: 'Synthetic method',
        versionId: version,
        version: 1,
        approvalReference: 'Synthetic documented approval',
      },
      contextSnapshot,
      snapshotFingerprint(contextSnapshot),
      JSON.stringify([
        {
          kind: 'RISK_RECORD',
          id: risk,
          title: 'Synthetic risk',
          reference: `risk:${risk}`,
          isDemonstration: false,
          capturedAt: new Date().toISOString(),
        },
      ]),
      user,
    ];
  }
  async function publishedFixture() {
    await db.query(
      "UPDATE evaluation_method_versions SET status='PUBLISHED',approval_reference='Synthetic documented approval',published_by_id=$2,published_at=now() WHERE id=$1",
      [version, user],
    );
    await db.query('SAVEPOINT valid_fixture');
    try {
      await db.query(insertEvaluation, evaluationValues());
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT valid_fixture');
    }
  }
  it('rejects forged results, method/context snapshots, stale versions, sequence gaps and foreign sources', async () => {
    await publishedFixture();
    for (const [index, value] of [
      [6, {}],
      [7, {}],
      [8, {}],
      [4, 2],
      [3, 2],
      [
        10,
        JSON.stringify([
          {
            kind: 'RISK_RECORD',
            id: randomUUID(),
            title: 'Foreign',
            reference: 'foreign',
            isDemonstration: false,
            capturedAt: new Date().toISOString(),
          },
        ]),
      ],
    ] as const) {
      const values = evaluationValues();
      values[index] = value;
      await reject(insertEvaluation, values);
    }
  });
  it('rejects inactive groups, sectors and units even when the snapshot matches', async () => {
    await publishedFixture();
    for (const [table, id, nested] of [
      ['assessment_groups', group, null],
      ['sectors', sector, 'sector'],
      ['units', unit, 'unit'],
    ] as const) {
      await db.query('SAVEPOINT inactive_scope');
      try {
        await db.query(`UPDATE ${table} SET is_active=false WHERE id=$1`, [id]);
        const values = evaluationValues();
        const snapshot = structuredClone(contextSnapshot);
        if (nested) (snapshot[nested] as { isActive: boolean }).isActive = false;
        values[8] = snapshot;
        await reject(insertEvaluation, values);
      } finally {
        await db.query('ROLLBACK TO SAVEPOINT inactive_scope');
      }
    }
  });
  it('rejects a forged contextual fingerprint rather than trusting any hexadecimal string', async () => {
    await publishedFixture();
    const values = evaluationValues();
    values[9] = 'a'.repeat(64);
    await reject(insertEvaluation, values);
  });
  it('rejects demonstrative collection sources even when the flag accurately declares demonstration', async () => {
    await publishedFixture();
    await db.query('SAVEPOINT demo_collection');
    try {
      const instrument = randomUUID();
      const policy = randomUUID();
      const cycle = randomUUID();
      await db.query(
        "INSERT INTO instrument_versions(id,organization_id,title,version,is_demo) VALUES($1,$2,'Synthetic legacy demonstration',1,true)",
        [instrument, org],
      );
      await db.query(
        "INSERT INTO consolidation_policy_versions(id,organization_id,version,usage_mode,minimum_responses) VALUES($1,$2,1,'DEMONSTRATION',5)",
        [policy, org],
      );
      await db.query(
        "UPDATE consolidation_policy_versions SET status='PUBLISHED',published_by_id=$2,published_at=now() WHERE id=$1",
        [policy, user],
      );
      await db.query(
        "INSERT INTO assessment_cycles(id,organization_id,assessment_group_id,instrument_version_id,policy_version_id,name,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,'Synthetic demo collection',now(),now()+interval '1 day')",
        [cycle, org, group, instrument, policy],
      );
      const values = evaluationValues();
      values[10] = JSON.stringify([
        {
          kind: 'ASSESSMENT_CYCLE',
          id: cycle,
          title: 'Synthetic demonstration',
          reference: `assessment-cycle:${cycle}`,
          isDemonstration: true,
          capturedAt: new Date().toISOString(),
        },
      ]);
      await reject(insertEvaluation, values);
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT demo_collection');
    }
  });
  it('rejects a risk whose diagnostic origin is demonstrative', async () => {
    await publishedFixture();
    await db.query('SAVEPOINT demo_risk');
    try {
      const instrument = randomUUID();
      const cycle = randomUUID();
      await db.query(
        "INSERT INTO instrument_versions(id,organization_id,title,version,is_demo) VALUES($1,$2,'Synthetic legacy demonstration',1,true)",
        [instrument, org],
      );
      await db.query(
        "INSERT INTO diagnostic_cycles(id,organization_id,instrument_version_id,name,starts_at,ends_at,status,closed_at) VALUES($1,$2,$3,'Synthetic legacy cycle',now()-interval '2 days',now()-interval '1 day','CLOSED',now())",
        [cycle, org, instrument],
      );
      await db.query(
        'INSERT INTO cycle_groups(id,organization_id,cycle_id,assessment_group_id) VALUES($1,$2,$3,$4)',
        [randomUUID(), org, cycle, group],
      );
      await db.query(
        "UPDATE risks SET source_kind='DIAGNOSTIC_CYCLE',diagnostic_cycle_id=$2 WHERE id=$1",
        [risk, cycle],
      );
      const values = evaluationValues();
      values[8] = { ...contextSnapshot, sourceKind: 'DIAGNOSTIC_CYCLE', diagnosticCycleId: cycle };
      values[9] = snapshotFingerprint(values[8] as Record<string, unknown>);
      await reject(insertEvaluation, values);
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT demo_risk');
    }
  });
  it('accepts the configured result exactly and makes technical history append-only', async () => {
    await publishedFixture();
    const values = evaluationValues();
    await db.query(insertEvaluation, values);
    await reject(
      "UPDATE technical_risk_evaluations SET rationale='Altered rationale' WHERE id=$1",
      [values[0]],
    );
    await reject('DELETE FROM technical_risk_evaluations WHERE id=$1', [values[0]]);
  });
  it('rejects unregistered risks, draft methods and inactive authors', async () => {
    await publishedFixture();
    await db.query('SAVEPOINT eligibility');
    try {
      await db.query("UPDATE risks SET status='DRAFT' WHERE id=$1", [risk]);
      const values = evaluationValues();
      values[8] = { ...contextSnapshot, status: 'DRAFT' };
      await reject(insertEvaluation, values);
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT eligibility');
    }
    const draft = randomUUID();
    await db.query(
      "INSERT INTO evaluation_method_versions(id,organization_id,method_id,version,title,definition,created_by_id) VALUES($1,$2,$3,2,'Draft version',$4,$5)",
      [draft, org, method, definition, user],
    );
    const values = evaluationValues();
    values[5] = draft;
    await reject(insertEvaluation, values);
    await db.query(
      'UPDATE memberships SET is_active=false WHERE user_id=$1 AND organization_id=$2',
      [user, org],
    );
    const inactiveValues = evaluationValues();
    await reject(insertEvaluation, inactiveValues);
    await db.query(
      'UPDATE memberships SET is_active=true WHERE user_id=$1 AND organization_id=$2',
      [user, org],
    );
  });
});
