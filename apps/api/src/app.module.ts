import { DynamicModule, Module } from '@nestjs/common';
import { ENVIRONMENT, type Environment } from './config/env';
import { PrismaService } from './database/prisma.service';
import { HealthController } from './health/health.controller';
import { IdentityController } from './modules/identity/identity.controller';
import { IdentityService } from './modules/identity/identity.service';
import { OrganizationsController } from './modules/organizations/organizations.controller';
import { OrganizationsService } from './modules/organizations/organizations.service';
import { OverviewController } from './modules/overview/overview.controller';
import { OverviewRepository } from './modules/overview/overview.repository';
import { OverviewService } from './modules/overview/overview.service';
import { DiagnosticsController } from './modules/diagnostics/diagnostics.controller';
import { DiagnosticsService } from './modules/diagnostics/diagnostics.service';
import { RisksController } from './modules/risks/risks.controller';
import { RisksService } from './modules/risks/risks.service';
import { RisksRepository } from './modules/risks/risks.repository';
import { RiskOverviewController } from './modules/risks/risk-overview.controller';
import { RiskOverviewService } from './modules/risks/risk-overview.service';
import { RiskOverviewRepository } from './modules/risks/risk-overview.repository';
import { RiskRegistrationsController } from './modules/risks/risk-registrations.controller';
import { RiskRegistrationsService } from './modules/risks/risk-registrations.service';
import { RiskRegistrationsRepository } from './modules/risks/risk-registrations.repository';
import { ActionsController } from './modules/actions/actions.controller';
import { ActionsService } from './modules/actions/actions.service';
import { ActionsRepository } from './modules/actions/actions.repository';
import { EvidenceController, EvidenceGuard } from './modules/evidence/evidence.controller';
import { EvidenceService } from './modules/evidence/evidence.service';
import { EvidenceStorage } from './modules/evidence/evidence.storage';

@Module({})
export class AppModule {
  static configure(environment: Environment): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        HealthController,
        IdentityController,
        OrganizationsController,
        OverviewController,
        DiagnosticsController,
        RisksController,
        RiskOverviewController,
        RiskRegistrationsController,
        ActionsController,
        EvidenceController,
      ],
      providers: [
        { provide: ENVIRONMENT, useValue: environment },
        PrismaService,
        IdentityService,
        OrganizationsService,
        OverviewRepository,
        OverviewService,
        DiagnosticsService,
        RisksService,
        RisksRepository,
        RiskOverviewService,
        RiskOverviewRepository,
        RiskRegistrationsService,
        RiskRegistrationsRepository,
        ActionsRepository,
        ActionsService,
        EvidenceGuard,
        EvidenceService,
        EvidenceStorage,
      ],
    };
  }
}
