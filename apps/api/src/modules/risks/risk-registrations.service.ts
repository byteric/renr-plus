import { Injectable, NotFoundException } from '@nestjs/common';
import {
  riskRegistrationsSchema,
  type RiskRegistrations,
  type RiskRegistrationsQuery,
} from '@renr/contracts';
import { RiskRegistrationsRepository } from './risk-registrations.repository';

@Injectable()
export class RiskRegistrationsService {
  constructor(private readonly repository: RiskRegistrationsRepository) {}
  async get(
    organizationId: string,
    days: RiskRegistrationsQuery['days'],
  ): Promise<RiskRegistrations> {
    const snapshot = await this.repository.snapshot(organizationId, days, new Date().toISOString());
    if (!snapshot) throw new NotFoundException();
    return riskRegistrationsSchema.parse(snapshot);
  }
}
