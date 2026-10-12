import { Injectable, NotFoundException } from '@nestjs/common';
import { organizationOverviewSchema, type OrganizationOverview } from '@renr/contracts';
import { OverviewRepository } from './overview.repository';

@Injectable()
export class OverviewService {
  constructor(private readonly repository: OverviewRepository) {}

  async getOverview(organizationId: string): Promise<OrganizationOverview> {
    const snapshot = await this.repository.getSnapshot(organizationId);
    if (!snapshot) throw new NotFoundException();
    return organizationOverviewSchema.parse({ ...snapshot, generatedAt: new Date().toISOString() });
  }
}
