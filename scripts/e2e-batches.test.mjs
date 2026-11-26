import test from 'node:test';
import assert from 'node:assert/strict';
import { e2eBatches } from './e2e-batches.mjs';

test('keeps login traffic in four isolated batches per project and a separate persona batch', () => {
  const batches = e2eBatches([]);
  assert.equal(batches.length, 10);
  for (const project of ['desktop', 'mobile']) {
    const projectBatches = batches.filter((batch) => batch.includes(`--project=${project}`));
    assert.deepEqual(
      projectBatches,
      [
        ...[1, 2, 3, 4].map((shard) => [
          '--fully-parallel',
          `--shard=${shard}/4`,
          '--grep-invert=@personas',
          `--output=test-results/e2e-${project}-${shard}`,
        ]),
        ['--grep=@personas', `--output=test-results/e2e-${project}-personas`],
      ].map((filters) => [
        'test',
        '--config=playwright.production.config.ts',
        `--project=${project}`,
        ...filters,
      ]),
    );
  }
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
