import { ServiceUnavailableException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';
import { openSecret, sealSecret, totpStep } from '../src/modules/identity/mfa-security';

describe('MFA authentication primitives', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const vectors = [
    { timestamp: 59, sha1: '94287082', sha256: '46119246', sha512: '90693936' },
    { timestamp: 1111111109, sha1: '07081804', sha256: '68084774', sha512: '25091201' },
    { timestamp: 1111111111, sha1: '14050471', sha256: '67062674', sha512: '99943326' },
    { timestamp: 1234567890, sha1: '89005924', sha256: '91819424', sha512: '93441116' },
    { timestamp: 2000000000, sha1: '69279037', sha256: '90698825', sha512: '38618901' },
    { timestamp: 20000000000, sha1: '65353130', sha256: '77737706', sha512: '47863826' },
  ];

  it.each(vectors)('matches RFC 6238 appendix B at $timestamp', (vector) => {
    const timestamp = vector.timestamp * 1000;
    const base = '1234567890';
    for (const [algorithm, key, token] of [
      ['SHA1', base.repeat(2), vector.sha1],
      ['SHA256', base.repeat(3) + '12', vector.sha256],
      ['SHA512', base.repeat(6) + '1234', vector.sha512],
    ] as const) {
      const secret = Secret.fromLatin1(key);
      expect(TOTP.generate({ secret, algorithm, digits: 8, timestamp })).toBe(token);
      expect(TOTP.validate({ secret, algorithm, digits: 8, timestamp, token, window: 0 })).toBe(0);
    }
    expect(totpStep(secret, vector.sha1.slice(-6), timestamp, null)).toBe(
      Math.floor(vector.timestamp / 30),
    );
  });

  it('accepts one adjacent step and rejects both a consumed step and a step outside the window', () => {
    expect(totpStep(secret, '287082', 29_000, null)).toBe(1);
    expect(totpStep(secret, '287082', 89_000, null)).toBe(1);
    expect(totpStep(secret, '287082', 89_000, 1)).toBeNull();
    expect(totpStep(secret, '287082', 90_000, null)).toBeNull();
  });

  it('binds ciphertext to its key and factor context', () => {
    const key = randomBytes(32);
    const context = 'factor/account/1';
    const sealed = sealSecret(key, secret, context);
    expect(sealed).not.toContain(secret);
    expect(sealSecret(key, secret, context)).not.toEqual(sealed);
    expect(openSecret(key, sealed, context)).toBe(secret);
    expect(() => openSecret(key, sealed, 'factor/account/2')).toThrow(ServiceUnavailableException);
    expect(() => openSecret(randomBytes(32), sealed, context)).toThrow(ServiceUnavailableException);
  });
});
