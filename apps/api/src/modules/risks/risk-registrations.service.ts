import { Injectable, NotFoundException } from '@nestjs/common';
import {
  riskRegistrationsSchema,
  type RiskRegistrations,
  type RiskRegistrationsQuery,
} from '@renr/contracts';
import { RiskRegistrationsRepository } from './risk-registrations.repository';
import type { OrganizationScope } from '../access/delegated-scope';

@Injectable()
export class RiskRegistrationsService {
  constructor(private readonly repository: RiskRegistrationsRepository) {}
  async get(
    organizationId: string,
    days: RiskRegistrationsQuery['days'],
    delegation?: OrganizationScope['delegation'],
  ): Promise<RiskRegistrations> {
    const generatedAt = new Date().toISOString();
    const snapshot = delegation
      ? await this.repository.snapshot(organizationId, days, generatedAt, delegation)
      : await this.repository.snapshot(organizationId, days, generatedAt);
    if (!snapshot) throw new NotFoundException();
    return riskRegistrationsSchema.parse(snapshot);
  }
}
