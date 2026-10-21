import { Controller, Get, Param, Query, Req, UseInterceptors } from '@nestjs/common';
import { ApiCookieAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { riskOverviewSchema } from '@renr/contracts';
import type { Request } from 'express';
import { z } from 'zod';
import { parse } from '../../http/parse';
import { IdentityService, SESSION_COOKIE } from '../identity/identity.service';
import { RiskPrivacyInterceptor, documentation } from './risks.controller';
import { RiskOverviewService } from './risk-overview.service';

@Controller('organizations/:orgId/risk-overview')
@ApiTags('Risks')
@ApiCookieAuth(SESSION_COOKIE)
@UseInterceptors(RiskPrivacyInterceptor)
export class RiskOverviewController {
  constructor(
    private readonly overview: RiskOverviewService,
    private readonly identity: IdentityService,
  ) {}
  @Get()
  @ApiResponse({
    status: 200,
    description:
      'Consistent operational risk snapshot; top eight units plus OTHERS; excludes archived risks.',
    schema: documentation(riskOverviewSchema),
  })
  @ApiResponse({ status: 401, description: 'Missing or expired session.' })
  @ApiResponse({ status: 404, description: 'Organization outside active scope.' })
  async get(@Req() request: Request, @Param('orgId') orgId: string, @Query() query: unknown) {
    const scope = await this.identity.scope(request, parse(z.uuid(), orgId), false);
    parse(z.object({}).strict(), query);
    return this.overview.get(scope.organizationId);
  }
}
