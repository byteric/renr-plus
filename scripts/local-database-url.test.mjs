import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localDatabaseUrl } from './local-database-url.mjs';

test('accepts explicit loopback PostgreSQL targets', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    for (const protocol of ['postgres:', 'postgresql:']) {
      const value = `${protocol}//${host}:5432/local_test`;
      assert.equal(localDatabaseUrl(value).toString(), value);
    }
  }
});

test('preserves the Prisma schema parameter on a local target', () => {
  const value = 'postgresql://127.0.0.1:5432/local_test?schema=public';
  assert.equal(localDatabaseUrl(value).toString(), value);
});

test('rejects remote hosts and non-PostgreSQL protocols', () => {
  for (const value of [
    'postgresql://remote.example/local_test',
    'postgresql://127.0.0.2/local_test',
    'https://localhost/local_test',
    'file:///local_test',
  ]) {
    assert.throws(() => localDatabaseUrl(value));
  }
});

test('rejects a host override despite a loopback URL hostname', () => {
  assert.throws(
    () => localDatabaseUrl('postgresql://127.0.0.1/local_test?host=remote.example&port=6543'),
    /parâmetros de conexão/,
  );
});

test('rejects a port override even when the hostname remains local', () => {
  assert.throws(
    () => localDatabaseUrl('postgresql://localhost:5432/local_test?port=6543'),
    /parâmetros de conexão/,
  );
});

test('rejects encoded, repeated and other non-schema connection parameters', () => {
  for (const query of [
    'h%6fst=remote.example',
    'host=localhost&host=remote.example',
    'schema=public&host=remote.example',
    'Host=remote.example',
    'hostaddr=203.0.113.1',
    'database=other',
    'user=other',
    'password=synthetic',
    'sslmode=disable',
  ]) {
    assert.throws(
      () => localDatabaseUrl(`postgresql://localhost/local_test?${query}`),
      /parâmetros de conexão/,
    );
  }
});

test('rejects invalid or missing connection strings', () => {
  for (const value of ['', undefined, 'not a connection string']) {
    assert.throws(() => localDatabaseUrl(value));
  }
});

test('does not include credentials in validation errors', () => {
  assert.throws(
    () => localDatabaseUrl('postgresql://demo:synthetic@remote.example/local_test'),
    (error) => !error.message.includes('synthetic'),
  );
});
