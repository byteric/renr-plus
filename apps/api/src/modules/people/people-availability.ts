import type { PrismaService } from '../../database/prisma.service';
import type { Capability } from '@renr/contracts';

export function peopleDataAvailable(database: PrismaService, organizationId: string): boolean {
  return database.allowsRealPeopleData || database.peopleDemoOrganizationIds.has(organizationId);
}

export function canReadExactPeopleIndicators(
  database: PrismaService,
  organizationId: string,
  hrCapabilities: readonly Capability[],
): boolean {
  return (
    !database.productionPeoplePolicy ||
    database.peopleDemoOrganizationIds.has(organizationId) ||
    hrCapabilities.includes('HR_PROFILE_READ') ||
    hrCapabilities.includes('HR_PROFILE_MANAGE')
  );
}
