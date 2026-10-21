import { Controller, Get, Param, Query, Req, UseInterceptors } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { riskRegistrationsQuerySchema, riskRegistrationsSchema } from '@renr/contracts';
import type { Request } from 'express';
import { z } from 'zod';
import { parse } from '../../http/parse';
import { IdentityService, SESSION_COOKIE } from '../identity/identity.service';
import { RiskPrivacyInterceptor, documentation } from './risks.controller';
import { RiskRegistrationsService } from './risk-registrations.service';

@Controller('organizations/:orgId/risk-registrations')
@ApiTags('Risks')
@ApiCookieAuth(SESSION_COOKIE)
@UseInterceptors(RiskPrivacyInterceptor)
export class RiskRegistrationsController {
  constructor(
    private readonly registrations: RiskRegistrationsService,
    private readonly identity: IdentityService,
  ) {}
  @Get()
  @ApiOperation({
    summary:
      'Daily registrations in the organization timezone, including DRAFT, REGISTERED and ARCHIVED; not exposure evolution.',
  })
  @ApiQuery({
    name: 'days',
    required: false,
    enum: [7, 30, 90],
    description: 'Inclusive days ending today in the organization timezone; default 30.',
  })
  @ApiResponse({
    status: 200,
    schema: documentation(riskRegistrationsSchema),
    description: 'Consecutive local calendar dates including zero counts, with snapshot total.',
  })
  @ApiResponse({ status: 400, description: 'Unsupported period or unknown query field.' })
  @ApiResponse({ status: 401, description: 'Missing or expired session.' })
  @ApiResponse({ status: 404, description: 'Organization outside the active session scope.' })
  @ApiResponse({ status: 500, description: 'Sanitized dependency failure.' })
  async get(@Req() request: Request, @Param('orgId') orgId: string, @Query() query: unknown) {
    const scope = await this.identity.scope(request, parse(z.uuid(), orgId), false);
    const input = parse(riskRegistrationsQuerySchema, query);
    return this.registrations.get(scope.organizationId, input.days);
  }
}
