import { Controller, Get, Header, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { commercialDashboardQuerySchema, commercialDashboardSchema } from '@renr/contracts';
import type { Request } from 'express';
import { parse } from '../../http/parse';
import { IdentityService, SESSION_COOKIE } from '../identity/identity.service';
import { documentation } from '../risks/risks.controller';
import { CommercialDashboardService } from './commercial-dashboard.service';

@Controller('platform/commercial/dashboard')
@ApiTags('Platform commercial dashboard')
@ApiCookieAuth(SESSION_COOKIE)
@ApiResponse({ status: 400, description: 'Invalid period or query filter.' })
@ApiResponse({ status: 401, description: 'Session required.' })
@ApiResponse({
  status: 403,
  description:
    'Requires at least one commercial capability (READ/MANAGE_COMMERCIAL, READ/MANAGE_BILLING, or READ/MANAGE_CONTRACT_ACCESS).',
})
export class CommercialDashboardController {
  constructor(
    private readonly dashboard: CommercialDashboardService,
    private readonly identity: IdentityService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, schema: documentation(commercialDashboardSchema) })
  async overview(@Req() request: Request, @Query() query: unknown) {
    const session = await this.identity.authenticate(request);
    return this.dashboard.overview(session.userId, parse(commercialDashboardQuerySchema, query));
  }
}
