import { Injectable, NotFoundException } from '@nestjs/common';
import { riskOverviewSchema, type RiskOverview } from '@renr/contracts';
import { RiskOverviewRepository } from './risk-overview.repository';
import type { OrganizationScope } from '../access/delegated-scope';
@Injectable()
export class RiskOverviewService {
  constructor(private readonly repository: RiskOverviewRepository) {}
  async get(
    organizationId: string,
    delegation?: OrganizationScope['delegation'],
  ): Promise<RiskOverview> {
    const snapshot = delegation
      ? await this.repository.snapshot(organizationId, delegation)
      : await this.repository.snapshot(organizationId);
    if (!snapshot) throw new NotFoundException();
    return riskOverviewSchema.parse({ ...snapshot, generatedAt: new Date().toISOString() });
  }
}
