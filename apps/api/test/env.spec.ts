import { parseEnvironment } from '../src/config/env';

export const testEnvironment = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://renr:test@127.0.0.1:5432/renr',
  S3_ACCESS_KEY: 'test-access',
  S3_SECRET_KEY: 'test-secret',
};

describe('Environment validation', () => {
  it('applies local defaults', () => {
    expect(parseEnvironment(testEnvironment)).toMatchObject({
      HOST: '127.0.0.1',
      PORT: 3000,
      CORS_ORIGIN: 'http://127.0.0.1:5173',
      SERVE_WEB: false,
      STORAGE_ENABLED: false,
    });
  });

  it.each([
    { DATABASE_URL: undefined },
    { DATABASE_URL: 'https://example.com' },
    { PORT: '0' },
    { S3_SECRET_KEY: '' },
    { NODE_ENV: 'invalid' },
    { SERVE_WEB: 'yes' },
    { STORAGE_ENABLED: '0' },
    { SERVE_WEB: 'true' },
    { NODE_ENV: 'production' },
  ])('rejects invalid environment values: %p', (override) => {
    expect(() => parseEnvironment({ ...testEnvironment, ...override })).toThrow(
      'Invalid environment variables',
    );
  });

  it('does not disclose values in validation errors', () => {
    expect(() => parseEnvironment({ ...testEnvironment, DATABASE_URL: 'sensitive-value' })).toThrow(
      'Invalid environment variables: DATABASE_URL',
    );
  });

  it('starts production without S3 when storage is disabled', () => {
    expect(
      parseEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL: testEnvironment.DATABASE_URL,
        CORS_ORIGIN: 'https://renr.example.com',
        STORAGE_ENABLED: 'false',
      }),
    ).toMatchObject({ STORAGE_ENABLED: false, SERVE_WEB: false });
  });

  it.each(['S3_ACCESS_KEY', 'S3_SECRET_KEY'])('requires %s when storage is enabled', (field) => {
    expect(() =>
      parseEnvironment({ ...testEnvironment, STORAGE_ENABLED: 'true', [field]: undefined }),
    ).toThrow(`Invalid environment variables: ${field}`);
  });

  it('parses explicit flags and web dist path', () => {
    expect(
      parseEnvironment({
        ...testEnvironment,
        SERVE_WEB: 'true',
        WEB_DIST_PATH: '/app/apps/web/dist',
        STORAGE_ENABLED: 'true',
      }),
    ).toMatchObject({
      SERVE_WEB: true,
      WEB_DIST_PATH: '/app/apps/web/dist',
      STORAGE_ENABLED: true,
    });
  });

  it('rejects a production HTTP origin', () => {
    expect(() =>
      parseEnvironment({
        ...testEnvironment,
        NODE_ENV: 'production',
        CORS_ORIGIN: 'http://renr.example.com',
      }),
    ).toThrow('Invalid environment variables: CORS_ORIGIN');
  });
});
