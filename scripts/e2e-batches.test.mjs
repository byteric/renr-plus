import test from 'node:test';
import assert from 'node:assert/strict';
import { e2eBatches } from './e2e-batches.mjs';

test('runs all desktop and mobile journeys in separate API lifetimes against the built frontend', () => {
  assert.deepEqual(e2eBatches([]), [
    ['test', '--config=playwright.production.config.ts', '--project=desktop'],
    ['test', '--config=playwright.production.config.ts', '--project=mobile'],
  ]);
});
test('keeps a caller-selected project, filter and config without duplicating the run', () => {
  assert.deepEqual(
    e2eBatches(['--project', 'mobile', '--grep', 'acessos', '--config=playwright.config.ts']),
    [['test', '--project', 'mobile', '--grep', 'acessos', '--config=playwright.config.ts']],
  );
});
test('preserves test files and explicit worker configuration on both projects', () => {
  assert.deepEqual(e2eBatches(['tests/e2e/access.spec.ts', '--workers=2']), [
    [
      'test',
      '--config=playwright.production.config.ts',
      'tests/e2e/access.spec.ts',
      '--workers=2',
      '--project=desktop',
    ],
    [
      'test',
      '--config=playwright.production.config.ts',
      'tests/e2e/access.spec.ts',
      '--workers=2',
      '--project=mobile',
    ],
  ]);
});
