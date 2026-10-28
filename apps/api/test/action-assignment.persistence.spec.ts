import { randomUUID } from 'node:crypto';
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
const describeDatabase = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

describeDatabase('ID13 assignment PostgreSQL invariants', () => {
  let db: SqlClient;
  const org = randomUUID(),
    foreignOrg = randomUUID(),
    admin = randomUUID(),
    reader = randomUUID(),
    foreignUser = randomUUID(),
    inactive = randomUUID(),
    unit = randomUUID(),
    sector = randomUUID(),
    group = randomUUID(),
    risk = randomUUID(),
    action = randomUUID();
  const next = { userId: reader, name: 'Executor frozen' };
  beforeAll(async () => {
    const url = localDatabaseUrl(process.env.DATABASE_URL!);
    if (!['/renr_technical_id11_verification', '/renr_test'].includes(url.pathname))
      throw new Error('Dedicated loopback verification database required');
    if (
      (process.env.ID13_CANDIDATE_MIGRATION === '1' ||
        process.env.ID13_RED_GUARDS === '1' ||
        process.env.ID13_HISTORY_CANDIDATE_MIGRATION === '1') &&
      url.pathname !== '/renr_technical_id11_verification'
    )
      throw new Error('Migration candidates require the isolated local ID13 database');
    db = new Client({ connectionString: url.toString() });
    await db.connect();
    await db.query('BEGIN');
    if (process.env.ID13_CANDIDATE_MIGRATION === '1') {
      await db.query(
        readFileSync(
          resolve(
            __dirname,
            '../prisma/migrations/20261025020000_action_assignments/migration.sql',
          ),
          'utf8',
        ),
      );
    } else if (process.env.ID13_RED_GUARDS === '1') {
      // Test-only additive columns expose missing guards before production DDL exists.
      await db.query(
        'ALTER TABLE actions ADD COLUMN assigned_user_id uuid, ADD COLUMN assigned_name varchar(120)',
      );
      await db.query('ALTER TABLE action_revisions ADD COLUMN assignment_change jsonb');
    }
    if (process.env.ID13_HISTORY_CANDIDATE_MIGRATION === '1') {
      await db.query(
        readFileSync(
          resolve(
            __dirname,
            '../prisma/migrations/20261025030000_action_assignment_history_integrity/migration.sql',
          ),
          'utf8',
        ),
      );
    }
    for (const id of [org, foreignOrg])
      await db.query(
        "INSERT INTO organizations(id,name,updated_at) VALUES($1,'Synthetic ID13',now())",
        [id],
      );
    for (const [id, name] of [
      [admin, 'Admin'],
      [reader, next.name],
      [foreignUser, 'Foreign'],
      [inactive, 'Inactive'],
    ])
      await db.query(
        "INSERT INTO users(id,name,email,password_hash,updated_at) VALUES($1,$2,$3,'unused',now())",
        [id, name, `${id}@example.test`],
      );
    for (const [id, organization, role, active] of [
      [admin, org, 'ADMIN', true],
      [reader, org, 'READER', true],
      [inactive, org, 'READER', false],
      [foreignUser, foreignOrg, 'READER', true],
    ])
      await db.query(
        'INSERT INTO memberships(user_id,organization_id,role,is_active) VALUES($1,$2,$3,$4)',
        [id, organization, role, active],
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
      [risk, org, group, admin],
    );
    await createAction(action);
    await revision(action, 1, null, 'CREATED');
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

  async function createAction(id: string, user: string | null = null, name: string | null = null) {
    await db.query(
      `INSERT INTO actions(id,organization_id,risk_id,source_risk_version,context_snapshot,title,description,responsible_name,due_date,expected_result,verification_criterion,created_by_id,updated_by_id,updated_at,assigned_user_id,assigned_name)
      VALUES($1,$2,$3,1,'{}','Action','Description','External','2026-10-25','Result','Criterion',$4,$4,now(),$5,$6)`,
      [id, org, risk, admin, user, name],
    );
  }
  async function revision(
    id: string,
    version: number,
    change: unknown,
    event = 'UPDATED',
    author = admin,
    reason: string | null = 'Synthetic assignment reason',
  ) {
    await db.query(
      `INSERT INTO action_revisions(id,organization_id,action_id,version,event,snapshot,change_reason,author_id,assignment_change)
      VALUES($1,$2,$3,$4,$5,'{"legacy":true}',$6,$7,$8)`,
      [randomUUID(), org, id, version, event, reason, author, change],
    );
  }
  async function assign(
    user: string | null = reader,
    name: string | null = next.name,
    actor = admin,
  ) {
    await db.query(
      'UPDATE actions SET assigned_user_id=$2,assigned_name=$3,version=version+1,updated_by_id=$4 WHERE id=$1',
      [action, user, name, actor],
    );
  }
  async function reject(write: () => Promise<unknown>, code = '23514') {
    await db.query('SAVEPOINT rejected_write');
    try {
      await expect(write()).rejects.toMatchObject({ code });
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT rejected_write');
    }
  }
  async function flush() {
    await db.query('SET CONSTRAINTS ALL IMMEDIATE');
  }
  async function assigned() {
    await assign();
    await revision(action, 2, { previous: null, next });
    await flush();
    await db.query('SET CONSTRAINTS ALL DEFERRED');
  }

  it('keeps legacy columns SQL null and snapshots unchanged', async () => {
    expect(
      (await db.query('SELECT assigned_user_id,assigned_name FROM actions WHERE id=$1', [action]))
        .rows[0],
    ).toEqual({ assigned_user_id: null, assigned_name: null });
    expect(
      (
        await db.query(
          'SELECT assignment_change,snapshot FROM action_revisions WHERE action_id=$1',
          [action],
        )
      ).rows[0],
    ).toEqual({ assignment_change: null, snapshot: { legacy: true } });
  });
  it('rejects cross-organization and inactive assignments independently', async () => {
    await reject(() => assign(foreignUser, 'Foreign'));
    await reject(() => assign(inactive, 'Inactive'));
    await db.query('UPDATE organizations SET is_active=false WHERE id=$1', [org]);
    await reject(() => assign());
  });
  it('requires an active administrator only when assignment changes', async () => {
    await reject(() => assign(reader, next.name, reader));
    await db.query(
      'UPDATE memberships SET is_active=false WHERE user_id=$1 AND organization_id=$2',
      [admin, org],
    );
    await reject(() => assign());
  });
  it('captures the current user name on creation and reassignment without rewriting it on rename', async () => {
    await reject(() => assign(reader, 'Invented name'));
    await reject(() => createAction(randomUUID(), reader, 'Invented name'));
    await assigned();
    await db.query("UPDATE users SET name='Current renamed executor' WHERE id=$1", [reader]);
    expect(
      (await db.query('SELECT assigned_name FROM actions WHERE id=$1', [action])).rows[0]
        ?.assigned_name,
    ).toBe(next.name);
    await reject(() => assign(reader, 'Another invented name'));
    await assign(reader, 'Current renamed executor');
    await revision(action, 3, {
      previous: next,
      next: { userId: reader, name: 'Current renamed executor' },
    });
    await flush();
    expect(
      (
        await db.query(
          'SELECT assignment_change FROM action_revisions WHERE action_id=$1 AND version=2',
          [action],
        )
      ).rows[0]?.assignment_change,
    ).toEqual({ previous: null, next });
  });
  it.each(['IMPLEMENTED', 'CANCELLED'])(
    'rejects assignment changes from terminal %s while allowing unrelated writes',
    async (status) => {
      await db.query(
        `UPDATE actions SET status=$2::"ActionStatus",implementation_note=CASE WHEN $2='IMPLEMENTED' THEN 'Execution reported' END,implemented_at=CASE WHEN $2='IMPLEMENTED' THEN now() END WHERE id=$1`,
        [action, status],
      );
      await reject(() => assign());
      await db.query('UPDATE actions SET version=version+1,updated_by_id=$2 WHERE id=$1', [
        action,
        reader,
      ]);
      await revision(action, 2, null, 'NOTE', reader);
      await flush();
    },
  );
  it('enforces the composite membership FK independently of the active-member guard', async () => {
    await flush();
    await db.query('ALTER TABLE actions DISABLE TRIGGER actions_assignment_guard');
    await reject(() => assign(foreignUser, 'Foreign'), '23503');
    await db.query('ALTER TABLE actions ENABLE TRIGGER actions_assignment_guard');
  });
  it('requires an atomic revision, version increment, author and exact previous/next values', async () => {
    await reject(async () => {
      await assign();
      await flush();
    });
    await reject(async () => {
      await assign();
      await revision(action, 2, null);
      await flush();
    });
    await reject(async () => {
      await assign();
      await revision(action, 2, { previous: null, next }, 'UPDATED', reader);
      await flush();
    });
    await reject(async () => {
      await assign();
      await revision(action, 2, { previous: null, next: { ...next, name: 'Wrong name' } });
      await flush();
    });
    await reject(async () => {
      await assign();
      await revision(action, 2, { previous: { userId: admin, name: 'Invented previous' }, next });
      await flush();
    });
    await reject(async () => {
      await assign();
      await revision(action, 2, { previous: null, next }, 'STARTED');
      await flush();
    });
    await reject(async () => {
      await assign();
      await revision(action, 2, { previous: null, next }, 'UPDATED', admin, null);
      await flush();
    });
    await reject(() =>
      db.query('UPDATE actions SET assigned_user_id=$2,assigned_name=$3 WHERE id=$1', [
        action,
        reader,
        next.name,
      ]),
    );
    await assigned();
  });
  it('rolls back assignment and revision together when the transaction scope is rolled back', async () => {
    await db.query('SAVEPOINT assignment_transaction');
    await assigned();
    await db.query('ROLLBACK TO SAVEPOINT assignment_transaction');
    expect(
      (await db.query('SELECT assigned_user_id,version FROM actions WHERE id=$1', [action]))
        .rows[0],
    ).toEqual({ assigned_user_id: null, version: 1 });
    expect(
      (await db.query('SELECT version FROM action_revisions WHERE action_id=$1', [action])).rows,
    ).toEqual([{ version: 1 }]);
  });
  it('rejects invented previous assignment when only the action version changed', async () => {
    await assigned();
    await db.query('UPDATE actions SET version=3 WHERE id=$1', [action]);
    await reject(() => revision(action, 3, { previous: { userId: admin, name: 'Admin' }, next }));
    await reject(() => revision(action, 3, { previous: null, next }));
    await reject(() => revision(action, 3, { previous: next, next }));
    await revision(action, 3, null, 'NOTE');
    await flush();
  });
  it('uses the last assignment revision across operational history and user renames', async () => {
    await assigned();
    await db.query("UPDATE users SET name='Renamed executor' WHERE id=$1", [reader]);
    await db.query('UPDATE actions SET version=3 WHERE id=$1', [action]);
    await revision(action, 3, null, 'NOTE');
    await assign(admin, 'Admin');
    await revision(action, 4, { previous: next, next: { userId: admin, name: 'Admin' } });
    await flush();
    expect(
      (
        await db.query(
          'SELECT assignment_change FROM action_revisions WHERE action_id=$1 AND version=2',
          [action],
        )
      ).rows[0]?.assignment_change,
    ).toEqual({ previous: null, next });
    expect(
      (
        await db.query(
          'SELECT assignment_change FROM action_revisions WHERE action_id=$1 AND version=4',
          [action],
        )
      ).rows[0]?.assignment_change,
    ).toEqual({ previous: next, next: { userId: admin, name: 'Admin' } });
  });
  it('allows assigned creation only with its matching CREATED revision', async () => {
    await reject(async () => {
      await createAction(randomUUID(), reader, next.name);
      await flush();
    });
    const id = randomUUID();
    await createAction(id, reader, next.name);
    await revision(id, 1, { previous: null, next }, 'CREATED');
    await flush();
  });
  it('preserves frozen assignment after deactivation and permits unrelated operational updates', async () => {
    await assigned();
    await db.query("UPDATE users SET name='Renamed' WHERE id=$1", [reader]);
    await db.query(
      'UPDATE memberships SET is_active=false WHERE user_id=$1 AND organization_id=$2',
      [reader, org],
    );
    await db.query('UPDATE organizations SET is_active=false WHERE id=$1', [org]);
    await db.query(
      "UPDATE actions SET status='IN_PROGRESS',version=version+1,updated_by_id=$2 WHERE id=$1",
      [action, reader],
    );
    await revision(action, 3, null, 'STARTED', reader);
    await flush();
    expect(
      (await db.query('SELECT assigned_name FROM actions WHERE id=$1', [action])).rows[0]
        ?.assigned_name,
    ).toBe(next.name);
    await reject(
      () =>
        db.query('DELETE FROM memberships WHERE user_id=$1 AND organization_id=$2', [reader, org]),
      '23503',
    );
  });
  it('requires paired columns and rejects fabricated or malformed assignment history', async () => {
    await reject(() => assign(null, 'Orphan name'));
    await reject(() => assign(reader, null));
    await reject(() => assign(reader, ' '));
    for (const change of [
      {},
      { previous: null },
      { previous: null, next: { userId: reader } },
      { previous: null, next, extra: true },
      { previous: null, next },
      'null',
    ])
      await reject(() => revision(action, 2, change));
  });
  it('records reassignment/removal exactly and retains append-only revisions', async () => {
    await assigned();
    await assign(null, null);
    await revision(action, 3, { previous: next, next: null });
    await flush();
    await reject(() =>
      db.query('UPDATE action_revisions SET assignment_change=null WHERE action_id=$1', [action]),
    );
    await reject(() => db.query('DELETE FROM action_revisions WHERE action_id=$1', [action]));
    expect(
      (
        await db.query(
          'SELECT assignment_change FROM action_revisions WHERE action_id=$1 AND version=3',
          [action],
        )
      ).rows[0]?.assignment_change,
    ).toEqual({ previous: next, next: null });
  });
});
