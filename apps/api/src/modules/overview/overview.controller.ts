import { Controller, Get, Header, Param, Req } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { OrganizationOverview } from '@renr/contracts';
import type { Request } from 'express';
import { z } from 'zod';
import { parse } from '../../http/parse';
import { IdentityService, SESSION_COOKIE } from '../identity/identity.service';
import { OverviewService } from './overview.service';

class OverviewOrganizationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() isActive!: boolean;
}
class StatusCountsDto {
  @ApiProperty({ type: 'integer', minimum: 0, description: 'Active plus inactive.' })
  total!: number;
  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: 'Own status; independent of parent status.',
  })
  active!: number;
  @ApiProperty({ type: 'integer', minimum: 0 }) inactive!: number;
}
class OrganizationOverviewDto implements OrganizationOverview {
  @ApiProperty({ type: OverviewOrganizationDto }) organization!: OverviewOrganizationDto;
  @ApiProperty({ type: StatusCountsDto }) units!: StatusCountsDto;
  @ApiProperty({ type: StatusCountsDto }) sectors!: StatusCountsDto;
  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: 'Units with no sectors, including inactive sectors; at most units.total.',
  })
  unitsWithoutSectors!: number;
  @ApiProperty({ format: 'date-time' }) generatedAt!: string;
}

@ApiTags('overview')
@ApiCookieAuth(SESSION_COOKIE)
@Controller('organizations')
export class OverviewController {
  constructor(
    private readonly overview: OverviewService,
    private readonly identity: IdentityService,
  ) {}

  @Get(':id/overview')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Organizational counts for the session active organization (ADMIN or READER).',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: OrganizationOverviewDto })
  @ApiResponse({ status: 400, description: 'Invalid organization UUID.' })
  @ApiResponse({ status: 401, description: 'Missing or expired session.' })
  @ApiResponse({
    status: 404,
    description: 'Organization missing or outside the active session scope.',
  })
  @ApiResponse({
    status: 500,
    description: 'Unexpected dependency failure; sanitized error response.',
  })
  async getOverview(
    @Req() request: Request,
    @Param('id') id: string,
  ): Promise<OrganizationOverview> {
    const scope = await this.identity.scope(request, parse(z.uuid(), id), false);
    return this.overview.getOverview(scope.organizationId);
  }
}
