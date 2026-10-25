import { describe, expect, it } from 'vitest';
import {
  capabilitySchema,
  createAccessInviteSchema,
  updateAccessMembershipSchema,
  updateAccessCapabilitiesSchema,
  sessionCapabilitiesSchema,
  accessInviteSchema,
  acceptAccessInviteSchema,
} from './index';

describe('Access contracts', () => {
  it('exposes explicit capabilities without changing the legacy role vocabulary', () => {
    expect(capabilitySchema.safeParse('ADMIN').success).toBe(false);
    expect(capabilitySchema.parse('TECHNICAL_DECISIONS')).toBe('TECHNICAL_DECISIONS');
  });
  it('requires meaningful reason and optimistic version for membership mutations', () => {
    expect(updateAccessMembershipSchema.safeParse({ role: 'READER' }).success).toBe(false);
    expect(
      updateAccessMembershipSchema.safeParse({
        expectedVersion: 0,
        reason: 'Change',
        role: 'READER',
      }).success,
    ).toBe(false);
    expect(
      updateAccessMembershipSchema.safeParse({ expectedVersion: 1, reason: '  ', role: 'READER' })
        .success,
    ).toBe(false);
    expect(
      updateAccessMembershipSchema.safeParse({
        expectedVersion: 1,
        reason: 'Change',
        globalIsActive: false,
      }).success,
    ).toBe(false);
    expect(
      updateAccessMembershipSchema.parse({ expectedVersion: 1, reason: 'Change', isActive: false })
        .isActive,
    ).toBe(false);
  });
  it('rejects duplicate, unknown and implicitly elevated capabilities', () => {
    for (const capabilities of [['ADMIN'], ['TECHNICAL_DECISIONS', 'TECHNICAL_DECISIONS']])
      expect(
        updateAccessCapabilitiesSchema.safeParse({
          expectedVersion: 1,
          reason: 'Explicit grant',
          capabilities,
        }).success,
      ).toBe(false);
    expect(
      sessionCapabilitiesSchema.safeParse({
        organizationId: null,
        canManageAccess: false,
        capabilities: [],
        passwordHash: 'secret',
      }).success,
    ).toBe(false);
  });
  it('normalizes invite addresses and bounds expiration without accepting token hashes', () => {
    const input = {
      name: 'Synthetic recipient',
      email: ' A@EXAMPLE.TEST ',
      role: 'READER',
      capabilities: [],
      reason: 'Synthetic onboarding',
    };
    expect(createAccessInviteSchema.parse(input)).toMatchObject({
      email: 'a@example.test',
      expiresInHours: 72,
    });
    expect(createAccessInviteSchema.safeParse({ ...input, expiresInHours: 169 }).success).toBe(
      false,
    );
    expect(createAccessInviteSchema.safeParse({ ...input, tokenHash: 'secret' }).success).toBe(
      false,
    );
    expect(accessInviteSchema.safeParse({ token: 'secret' }).success).toBe(false);
    expect(
      acceptAccessInviteSchema.safeParse({ token: 'a'.repeat(43), password: 'short' }).success,
    ).toBe(false);
  });
});
