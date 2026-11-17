import { Injectable, NotFoundException } from '@nestjs/common';
import {
  organizationOverviewSchema,
  workspaceJourneySchema,
  type OrganizationOverview,
} from '@renr/contracts';
import { OverviewRepository } from './overview.repository';
import type { OrganizationScope } from '../access/delegated-scope';

@Injectable()
export class OverviewService {
  constructor(private readonly repository: OverviewRepository) {}

  async getOverview(
    organizationId: string,
    delegation?: OrganizationScope['delegation'],
  ): Promise<OrganizationOverview> {
    const snapshot = delegation
      ? await this.repository.getSnapshot(organizationId, delegation)
      : await this.repository.getSnapshot(organizationId);
    if (!snapshot) throw new NotFoundException();
    return organizationOverviewSchema.parse({ ...snapshot, generatedAt: new Date().toISOString() });
  }

  async getJourney(scope: OrganizationScope) {
    const journey = await this.repository.getJourney(scope);
    if (!journey) throw new NotFoundException();
    return workspaceJourneySchema.parse(journey);
  }
}
