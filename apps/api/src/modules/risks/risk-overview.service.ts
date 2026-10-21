import { Injectable, NotFoundException } from '@nestjs/common';
import { riskOverviewSchema, type RiskOverview } from '@renr/contracts';
import { RiskOverviewRepository } from './risk-overview.repository';
@Injectable()
export class RiskOverviewService {
  constructor(private readonly repository: RiskOverviewRepository) {}
  async get(organizationId: string): Promise<RiskOverview> {
    const snapshot = await this.repository.snapshot(organizationId);
    if (!snapshot) throw new NotFoundException();
    return riskOverviewSchema.parse({ ...snapshot, generatedAt: new Date().toISOString() });
  }
}
