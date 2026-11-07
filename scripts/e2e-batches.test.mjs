import test from 'node:test';
import assert from 'node:assert/strict';
import { e2eBatches } from './e2e-batches.mjs';

test('isolates persona logins from the normal desktop and mobile batches', () => {
  assert.deepEqual(e2eBatches([]), [
    [
      'test',
      '--config=playwright.production.config.ts',
      '--project=desktop',
      '--shard=1/2',
      '--grep-invert=@personas',
      '--output=test-results/e2e-desktop-1',
    ],
    [
      'test',
      '--config=playwright.production.config.ts',
      '--project=desktop',
      '--shard=2/2',
      '--grep-invert=@personas',
      '--output=test-results/e2e-desktop-2',
    ],
    [
      'test',
      '--config=playwright.production.config.ts',
      '--project=desktop',
      '--grep=@personas',
      '--output=test-results/e2e-desktop-personas',
    ],
    [
      'test',
      '--config=playwright.production.config.ts',
      '--project=mobile',
      '--shard=1/2',
      '--grep-invert=@personas',
      '--output=test-results/e2e-mobile-1',
    ],
    [
      'test',
      '--config=playwright.production.config.ts',
      '--project=mobile',
      '--shard=2/2',
      '--grep-invert=@personas',
      '--output=test-results/e2e-mobile-2',
    ],
    [
      'test',
      '--config=playwright.production.config.ts',
      '--project=mobile',
      '--grep=@personas',
      '--output=test-results/e2e-mobile-personas',
    ],
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
