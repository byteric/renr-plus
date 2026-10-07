import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localSeedUrl } from './local-seed-url.mjs';

test('accepts explicit loopback PostgreSQL targets in development', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    for (const protocol of ['postgres:', 'postgresql:']) {
      const value = `${protocol}//${host}:5432/demo`;
      assert.equal(localSeedUrl(value, 'development').toString(), value);
    }
  }
});

test('preserves the Prisma schema parameter used by the local environment', () => {
  const value = 'postgresql://127.0.0.1:5432/demo?schema=public';
  assert.equal(localSeedUrl(value, 'development').toString(), value);
});

test('rejects non-development environments', () => {
  for (const environment of ['production', 'test', undefined, '']) {
    assert.throws(() => localSeedUrl('postgresql://localhost/demo', environment));
  }
});

test('rejects remote hosts and non-PostgreSQL protocols', () => {
  for (const value of [
    'postgresql://remote.example/demo',
    'postgresql://127.0.0.2/demo',
    'https://localhost/demo',
    'file:///demo',
  ]) {
    assert.throws(() => localSeedUrl(value, 'development'));
  }
});

test('rejects the driver host override before returning a seed target', () => {
  assert.throws(
    () => localSeedUrl('postgresql://127.0.0.1/demo?host=remote.example', 'development'),
    /connection override parameters/,
  );
});

test('rejects encoded, duplicated and unknown connection parameters', () => {
  for (const query of [
    'h%6fst=remote.example',
    'host=localhost&host=remote.example',
    'schema=public&host=remote.example',
    'Host=remote.example',
    'hostaddr=203.0.113.1',
    'port=5433',
    'database=other',
    'user=other',
    'password=synthetic',
    'sslmode=disable',
  ]) {
    assert.throws(
      () => localSeedUrl(`postgresql://localhost/demo?${query}`, 'development'),
      /connection override parameters/,
    );
  }
});

test('rejects invalid or missing connection strings', () => {
  for (const value of ['', undefined, 'not a connection string']) {
    assert.throws(() => localSeedUrl(value, 'development'));
  }
});
