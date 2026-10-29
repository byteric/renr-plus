import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { localDatabaseUrl } from './local-database-url.mjs';

const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Pool } = requireApi('pg');
const migrations = new URL('../apps/api/prisma/migrations/', import.meta.url);
const continuityMigration = '20261027000000_risk_continuity';
const continuityTables = [
  'risk_reassessments',
  'reassessment_measures',
  'action_technical_closures',
  'action_corrective_links',
];

async function seed(target) {
  const code = await new Promise((accept, reject) => {
    const child = spawn(process.execPath, ['scripts/seed-demo.mjs'], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      env: {
        ...process.env,
        NODE_ENV: 'development',
        DATABASE_URL: target.href,
        DATABASE_URL_UNPOOLED: target.href,
        DEMO_PASSWORD: `Synthetic-${randomUUID()}`,
      },
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', accept);
  });
  assert.equal(code, 0, 'Synthetic legacy seed must succeed before the migration');
}

// Real legacy HTTP commands produce the exact snapshots/fingerprints required by ID11/15.
// No trigger is disabled, no table is cloned and no new continuity route is used.
async function populateTechnicalHistory(target) {
  const { Test } = requireApi('@nestjs/testing');
  const request = requireApi('supertest');
  const { AppModule } = requireApi('./dist/app.module.js');
  const { configureApplication } = requireApi('./dist/app.factory.js');
  const { parseEnvironment } = requireApi('./dist/config/env.js');
  const { PrismaService } = requireApi('./dist/database/prisma.service.js');
  const env = parseEnvironment({
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: target.href,
    SERVE_WEB: false,
    STORAGE_ENABLED: false,
  });
  const module = await Test.createTestingModule({ imports: [AppModule.configure(env)] }).compile();
  const app = module.createNestApplication({ logger: false });
  try {
    configureApplication(app, env);
    await app.init();
    const prisma = module.get(PrismaService).client;
    const org = await prisma.organization.create({ data: { name: 'Synthetic migration ID17' } });
    const user = await prisma.user.create({
      data: {
        name: 'Synthetic migration technician',
        email: `${randomUUID()}@example.test`,
        passwordHash: 'unused synthetic session',
      },
    });
    await prisma.membership.create({
      data: {
        userId: user.id,
        organizationId: org.id,
        role: 'ADMIN',
        capabilities: ['TECHNICAL_DECISIONS'],
      },
    });
    const secret = randomBytes(32).toString('base64url');
    await prisma.session.create({
      data: {
        userId: user.id,
        activeOrganizationId: org.id,
        tokenHash: createHash('sha256').update(secret).digest('hex'),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    const unit = await prisma.unit.create({
      data: { organizationId: org.id, name: 'Synthetic unit', normalizedName: 'synthetic unit' },
    });
    const sector = await prisma.sector.create({
      data: {
        organizationId: org.id,
        unitId: unit.id,
        name: 'Synthetic sector',
        normalizedName: 'synthetic sector',
      },
    });
    const base = `/api/v1/organizations/${org.id}`;
    const command = async (verb, path, data, status) => {
      const client = request(app.getHttpServer());
      const response = await client[verb](base + path)
        .set('Cookie', `renr_session=${secret}`)
        .set('Origin', env.CORS_ORIGIN)
        .send(data);
      // Keep cookies, database configuration and private response bodies out of failures.
      assert.equal(response.status, status, `Synthetic ${verb.toUpperCase()} ${path} status`);
      return response.body;
    };
    let risk = await command(
      'post',
      '/risks',
      {
        sectorId: sector.id,
        factor: 'Synthetic collective migration risk',
        status: 'REGISTERED',
        description: 'Synthetic collective work organization.',
        exposureDescription: 'Synthetic collective exposure.',
        exposedGroupDescription: 'Synthetic team.',
        possibleHarms: 'Synthetic possible harms.',
        existingControls: 'Synthetic preventive controls.',
        sourceKind: 'TECHNICAL_RECORD',
        sourceNote: 'Synthetic migration record without professional certification.',
      },
      201,
    );
    const method = await command(
      'post',
      '/evaluation-methods',
      { name: 'Synthetic migration method', description: 'Synthetic method for preservation.' },
      201,
    );
    const updated = await command(
      'put',
      `/evaluation-method-versions/${method.id}`,
      {
        expectedRevision: method.revision,
        title: method.title,
        description: method.description,
        definition: {
          probability: [
            {
              key: 'p1',
              label: 'Synthetic probability',
              description: 'Synthetic criterion',
              position: 1,
            },
          ],
          severity: [
            {
              key: 's1',
              label: 'Synthetic severity',
              description: 'Synthetic criterion',
              position: 1,
            },
          ],
          levels: [{ key: 'l1', label: 'Synthetic class' }],
          priorities: [{ key: 'r1', label: 'Synthetic priority', rank: 1 }],
          matrix: [{ probabilityKey: 'p1', severityKey: 's1', levelKey: 'l1', priorityKey: 'r1' }],
        },
      },
      200,
    );
    await command(
      'post',
      `/evaluation-method-versions/${method.id}/publish`,
      {
        expectedRevision: updated.revision,
        approvalReference: 'SYNTHETIC migration approval, invalid for real use.',
      },
      201,
    );
    const evaluate = async () => {
      risk = await command('get', `/risks/${risk.id}`, undefined, 200);
      return command(
        'post',
        `/risk-workspaces/${risk.id}/technical-evaluations`,
        {
          expectedVersion: risk.version,
          methodVersionId: method.id,
          probabilityKey: 'p1',
          severityKey: 's1',
          rationale: 'Synthetic rationale supporting the configured method cell.',
          context: 'Synthetic collective context without real technical certification.',
          sources: [{ kind: 'RISK_RECORD', id: risk.id }],
        },
        201,
      );
    };
    await evaluate();
    risk = await command('get', `/risks/${risk.id}`, undefined, 200);
    let action = await command(
      'post',
      `/risks/${risk.id}/actions`,
      {
        expectedRiskVersion: risk.version,
        title: 'Synthetic migration measure',
        description: 'Synthetic collective preventive measure.',
        responsibleName: 'Synthetic responsible party',
        dueDate: '2099-12-20',
        expectedResult: 'Synthetic expected collective improvement.',
        verificationCriterion: 'Compare synthetic collective records.',
      },
      201,
    );
    for (const status of ['IN_PROGRESS', 'IMPLEMENTED'])
      action = await command(
        'patch',
        `/actions/${action.id}`,
        {
          expectedVersion: action.version,
          status,
          changeReason: 'Synthetic operational progress recorded.',
          ...(status === 'IMPLEMENTED'
            ? { implementationNote: 'Synthetic collective team reported implementation.' }
            : {}),
        },
        200,
      );
    const context = await command('get', `/actions/${action.id}/efficacy`, undefined, 200);
    await command(
      'post',
      `/actions/${action.id}/efficacy-opinions`,
      {
        expectedVersion: context.actionVersion,
        expectedLatestOpinionId: null,
        expectedContextFingerprint: context.contextFingerprint,
        verifiedOn: context.referenceDate,
        result: 'EFFECTIVE',
        observation: 'Synthetic collective observations support this review.',
        rationale: 'Synthetic technical rationale tied to the preserved criterion.',
        evidenceIds: [],
        textualEvidence: [
          {
            reference: 'Synthetic migration record',
            description: 'Synthetic collective record identified for preservation.',
            rationale: 'The identified record supports this synthetic conclusion.',
          },
        ],
      },
      201,
    );
    return { app, evaluate };
  } catch (error) {
    await app.close();
    throw error;
  }
}

test(
  'continuity migration preserves populated ID15 technical and operational history without inferring decisions',
  { timeout: 180000 },
  async () => {
    const source = localDatabaseUrl(process.env.DATABASE_URL ?? '');
    assert.ok(
      ['/renr_test', '/renr_technical_id11_verification'].includes(source.pathname),
      'A dedicated local verification database is required',
    );
    assert.ok(!source.port || source.port === '5432', 'Local PostgreSQL port 5432 is required');
    const name = `renr_verify_${randomUUID().replaceAll('-', '')}`;
    assert.match(name, /^renr_verify_[a-f0-9]{32}$/);
    const adminUrl = new URL(source);
    adminUrl.pathname = '/postgres';
    const target = new URL(source);
    target.pathname = `/${name}`;
    const admin = new Pool({ connectionString: adminUrl.href, max: 1 });
    const db = new Pool({ connectionString: target.href, max: 1 });
    let created = false,
      fixture;
    try {
      await admin.query(`CREATE DATABASE "${name}"`);
      created = true;
      const folders = readdirSync(migrations)
        .filter((entry) => /^\d{14}_/.test(entry))
        .sort();
      for (const folder of folders.filter((entry) => entry < continuityMigration))
        await db.query(readFileSync(new URL(`${folder}/migration.sql`, migrations), 'utf8'));
      await seed(target);
      fixture = await populateTechnicalHistory(target);
      const tables = (
        await db.query(
          "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
        )
      ).rows.map((row) => row.tablename);
      assert.ok(
        tables.includes('technical_risk_evaluations') &&
          tables.includes('action_efficacy_opinions'),
      );
      const snapshot = async () => {
        const result = {};
        for (const table of tables) {
          assert.match(table, /^[a-z_]+$/);
          const rows = (
            await db.query(
              `SELECT to_jsonb(t) AS value FROM "${table}" t ORDER BY to_jsonb(t)::text`,
            )
          ).rows;
          result[table] = {
            count: rows.length,
            sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
          };
        }
        return result;
      };
      const before = await snapshot();
      for (const table of [
        'evaluation_methods',
        'evaluation_method_versions',
        'technical_risk_evaluations',
        'action_efficacy_opinions',
        'actions',
        'action_revisions',
        'audit_events',
      ])
        assert.ok(before[table].count > 0, `Populated ${table} must exist before migration`);
      await db.query(
        readFileSync(new URL(`${continuityMigration}/migration.sql`, migrations), 'utf8'),
      );
      assert.deepEqual(
        await snapshot(),
        before,
        'Every legacy table must retain its row count and deterministic hash',
      );
      for (const table of continuityTables)
        assert.equal(
          (await db.query(`SELECT count(*)::int AS count FROM "${table}"`)).rows[0].count,
          0,
          'Migration must not infer reassessments, closures or corrective links',
        );
      await fixture.evaluate();
      assert.equal(
        (await db.query('SELECT count(*)::int AS count FROM technical_risk_evaluations')).rows[0]
          .count,
        before.technical_risk_evaluations.count + 1,
        'Legacy evaluation creation must remain functional with the additive lock trigger',
      );
      for (const table of continuityTables)
        assert.equal(
          (await db.query(`SELECT count(*)::int AS count FROM "${table}"`)).rows[0].count,
          0,
          'A legacy evaluation must not implicitly create continuity decisions',
        );
    } finally {
      if (fixture) await fixture.app.close();
      await db.end();
      if (created) {
        assert.match(name, /^renr_verify_[a-f0-9]{32}$/);
        assert.equal(target.pathname, `/${name}`);
        await admin.query(`DROP DATABASE "${name}"`);
      }
      await admin.end();
    }
  },
);
