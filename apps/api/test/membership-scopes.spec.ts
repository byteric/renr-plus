import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { parseEnvironment } from '../src/config/env';
import type { PrismaService } from '../src/database/prisma.service';
import { IdentityService } from '../src/modules/identity/identity.service';

describe('Restricted organization membership', () => {
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const userId = '22222222-2222-4222-8222-222222222222';
  const unitId = '33333333-3333-4333-8333-333333333333';
  const member = {
    organizationId,
    organization: { name: 'Synthetic organization' },
    isActive: true,
    role: 'READER',
    capabilities: ['TECHNICAL_DECISIONS', 'EXECUTE_ASSIGNED_ACTIONS'],
    hrCapabilities: ['HR_PROFILE_READ'],
    scopeRestricted: true,
    scopes: [{ unitId, sectorId: null }],
  };
  const session = {
    userId,
    activeOrganizationId: organizationId,
    expiresAt: new Date(Date.now() + 60_000),
    user: { id: userId, name: 'Reader', email: 'reader@synthetic.example', memberships: [member] },
  };
  const req = { method: 'GET', headers: { cookie: `renr_session=${'a'.repeat(43)}` } } as Request;
  const environment = parseEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@127.0.0.1:55432/test',
  });
  const identity = new IdentityService(
    { client: { session: { findUnique: async () => session } } } as unknown as PrismaService,
    environment,
  );

  it('denies organization endpoints by default until they implement scoped authorization', async () => {
    await expect(identity.scope(req, organizationId, false)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('does not let a delegated read-only user reuse unscoped operational capabilities', async () => {
    await expect(identity.capabilities(req)).resolves.toEqual({
      organizationId,
      capabilities: [],
      canManageAccess: false,
    });
  });

  it('reports restricted organization context in the session response', async () => {
    await expect(identity.current(req)).resolves.toMatchObject({
      organizationScopes: { [organizationId]: [{ unitId, sectorId: null }] },
    });
  });
});
