import { hashPassword, verifyPassword } from '../src/modules/identity/password';

describe('password hashing', () => {
  it('uses random salts and verifies only the correct password', async () => {
    const first = await hashPassword('synthetic-password-for-tests');
    const second = await hashPassword('synthetic-password-for-tests');
    expect(first).not.toBe(second);
    expect(await verifyPassword('synthetic-password-for-tests', first)).toBe(true);
    expect(await verifyPassword('incorrect', first)).toBe(false);
  });
  it('rejects unsupported or malformed hashes', async () => {
    expect(await verifyPassword('x', 'invalid')).toBe(false);
    expect(await verifyPassword('x', 'scrypt:salt:short')).toBe(false);
  });
});
