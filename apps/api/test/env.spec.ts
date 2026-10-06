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
    });
  });

  it.each([
    { DATABASE_URL: undefined },
    { DATABASE_URL: 'https://example.com' },
    { PORT: '0' },
    { S3_SECRET_KEY: '' },
    { NODE_ENV: 'invalid' },
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
});
