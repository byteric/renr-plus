import { localDatabaseUrl } from './local-database-url';

describe('integration database target', () => {
  it('accepts loopback PostgreSQL targets', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]'])
      for (const protocol of ['postgres:', 'postgresql:']) {
        const value = `${protocol}//${host}:5432/demo`;
        expect(localDatabaseUrl(value).toString()).toBe(value);
      }
  });
  it('preserves the Prisma schema parameter', () => {
    const value = 'postgresql://127.0.0.1/demo?schema=public';
    expect(localDatabaseUrl(value).toString()).toBe(value);
  });
  it('rejects remote hosts and non-PostgreSQL protocols', () => {
    for (const value of [
      'postgresql://remote.example/demo',
      'postgresql://127.0.0.2/demo',
      'https://localhost/demo',
      'file:///demo',
    ])
      expect(() => localDatabaseUrl(value)).toThrow();
  });
  it('rejects a query that overrides the driver host before returning the target', () => {
    expect(() => localDatabaseUrl('postgresql://127.0.0.1/demo?host=remote.example')).toThrow(
      /connection override parameters/,
    );
  });
  it('rejects encoded, duplicate and unknown connection parameters', () => {
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
    ])
      expect(() => localDatabaseUrl(`postgresql://localhost/demo?${query}`)).toThrow(
        /connection override parameters/,
      );
  });
  it('rejects missing or malformed connection strings', () => {
    for (const value of ['', 'not a connection string'])
      expect(() => localDatabaseUrl(value)).toThrow();
  });
});
