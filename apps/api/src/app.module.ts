import { DynamicModule, Module } from '@nestjs/common';
import { ENVIRONMENT, type Environment } from './config/env';
import { PrismaService } from './database/prisma.service';
import { HealthController } from './health/health.controller';
import { IdentityController } from './modules/identity/identity.controller';
import { IdentityService } from './modules/identity/identity.service';
import { OrganizationsController } from './modules/organizations/organizations.controller';
import { OrganizationsService } from './modules/organizations/organizations.service';

@Module({})
export class AppModule {
  static configure(environment: Environment): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, IdentityController, OrganizationsController],
      providers: [
        { provide: ENVIRONMENT, useValue: environment },
        PrismaService,
        IdentityService,
        OrganizationsService,
      ],
    };
  }
}
