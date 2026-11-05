import { Controller, Get, Header, Param, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  managementIndicatorHistoryQuerySchema,
  managementIndicatorHistorySchema,
  managementIndicatorsQuerySchema,
  managementIndicatorsSchema,
} from '@renr/contracts';
import type { Request } from 'express';
import { z } from 'zod';
import { parse } from '../../http/parse';
import { IdentityService, SESSION_COOKIE } from '../identity/identity.service';
import { documentation } from '../risks/risks.controller';
import { ManagementIndicatorsService } from './management-indicators.service';

@Controller('organizations/:id/management-indicators')
@ApiTags('Management indicators')
@ApiCookieAuth(SESSION_COOKIE)
@ApiResponse({ status: 400, description: 'Invalid filter, page or date range.' })
@ApiResponse({ status: 401, description: 'Session required.' })
@ApiResponse({ status: 404, description: 'Organization or selected scope is unavailable.' })
export class ManagementIndicatorsController {
  constructor(
    private readonly indicators: ManagementIndicatorsService,
    private readonly identity: IdentityService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Current operational and technical snapshot for the active organization.',
  })
  @ApiResponse({ status: 200, schema: documentation(managementIndicatorsSchema) })
  async snapshot(@Req() request: Request, @Param('id') id: string, @Query() query: unknown) {
    const scope = await this.identity.scope(request, parse(z.uuid(), id), false);
    return this.indicators.snapshot(scope, parse(managementIndicatorsQuerySchema, query));
  }

  @Get('history')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Daily counts of recorded events in the organization civil calendar.' })
  @ApiResponse({ status: 200, schema: documentation(managementIndicatorHistorySchema) })
  async history(@Req() request: Request, @Param('id') id: string, @Query() query: unknown) {
    const scope = await this.identity.scope(request, parse(z.uuid(), id), false);
    return this.indicators.history(scope, parse(managementIndicatorHistoryQuerySchema, query));
  }
}
