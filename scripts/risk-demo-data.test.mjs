import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
const require = createRequire(new URL('../packages/contracts/package.json', import.meta.url));
const { riskDetailSchema } = require('./dist/index.cjs');
const target = new URL('./risk-demo-data.mjs', import.meta.url);

test('demo risk data contains incomplete draft, registered with and without evaluation, archived without evaluation', async () => {
  const build = existsSync(target) ? (await import(target.href)).buildDemoRisks : () => [];
  const fixtures = build({
    organizationId: '10000000-0000-4000-8000-000000000001',
    assessmentGroupId: '20000000-0000-4000-8000-000000000001',
    userId: '30000000-0000-4000-8000-000000000001',
    sector: { id: '40000000-0000-4000-8000-000000000001', name: 'Setor fictício', isActive: true },
    unit: { id: '50000000-0000-4000-8000-000000000001', name: 'Unidade fictícia', isActive: true },
  });
  assert.equal(fixtures.length, 4);
  for (const fixture of fixtures) assert.equal(riskDetailSchema.safeParse(fixture).success, true);
  assert.equal(
    fixtures.filter((item) => item.status === 'REGISTERED' && !item.latestEvaluation).length,
    1,
  );
  assert.equal(
    fixtures.filter((item) => item.status === 'REGISTERED' && item.latestEvaluation).length,
    1,
  );
  assert.equal(
    fixtures.filter((item) => item.status === 'ARCHIVED' && !item.latestEvaluation).length,
    1,
  );
  assert.equal(fixtures[0].description, null);
});
