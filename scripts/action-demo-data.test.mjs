import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { buildDemoRisks } from './risk-demo-data.mjs';

const require = createRequire(new URL('../packages/contracts/package.json', import.meta.url));
const { actionDetailSchema, actionRevisionSchema } = require('./dist/index.cjs');
const target = new URL('./action-demo-data.mjs', import.meta.url);
const risk = buildDemoRisks({
  organizationId: '10000000-0000-4000-8000-000000000001',
  assessmentGroupId: '20000000-0000-4000-8000-000000000001',
  userId: '30000000-0000-4000-8000-000000000001',
  sector: { id: '40000000-0000-4000-8000-000000000001', name: 'Setor fictício', isActive: true },
  unit: { id: '50000000-0000-4000-8000-000000000001', name: 'Unidade fictícia', isActive: true },
})[1];

test('local demonstration supplies four operational states with coherent revisions and no efficacy claim', async () => {
  const build = existsSync(target) ? (await import(target.href)).buildDemoActions : () => [];
  const fixtures = build({
    risk,
    userId: risk.createdBy.id,
    referenceDate: '2026-10-21',
    timeZone: 'America/Sao_Paulo',
  });
  assert.equal(fixtures.length, 4);
  assert.deepEqual(
    fixtures.map((v) => v.action.status),
    ['PLANNED', 'IN_PROGRESS', 'IMPLEMENTED', 'CANCELLED'],
  );
  assert.deepEqual(
    fixtures.map((v) => v.action.isOverdue),
    [true, false, false, false],
  );
  assert.deepEqual(
    fixtures.map((v) => v.revisions.length),
    [1, 2, 3, 2],
  );
  for (const { action, revisions } of fixtures) {
    assert.equal(actionDetailSchema.safeParse(action).success, true);
    for (const revision of revisions)
      assert.equal(actionRevisionSchema.safeParse(revision).success, true);
    assert.equal(action.sourceRiskVersion, risk.version);
    assert.equal(action.evaluationId, risk.latestEvaluation.id);
    assert.equal(revisions[0].event, 'CREATED');
    assert.equal(revisions[0].snapshot.status, 'PLANNED');
    assert.equal(revisions.at(-1).version, action.version);
    assert.equal(revisions.at(-1).snapshot.status, action.status);
  }
  const next = build({
    risk,
    userId: risk.createdBy.id,
    referenceDate: '2026-12-02',
    timeZone: 'UTC',
  });
  assert.deepEqual(
    next.map((v) => v.action.id),
    fixtures.map((v) => v.action.id),
  );
  assert.equal(next[1].action.isOverdue, true);
});
