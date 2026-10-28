import { Body, Controller, Get, Param, Post, Query, Req, UseInterceptors } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  createEfficacyOpinionSchema,
  efficacyContextSchema,
  efficacyOpinionListSchema,
  efficacyOpinionQuerySchema,
  efficacyOpinionSchema,
} from '@renr/contracts';
import { z } from 'zod';
import type { Request } from 'express';
import { parse } from '../../http/parse';
import { IdentityService, SESSION_COOKIE } from '../identity/identity.service';
import { ActionPrivacyInterceptor } from '../actions/actions.controller';
import { documentation } from '../risks/risks.controller';
import { ActionEfficacyService } from './action-efficacy.service';

@Controller('organizations/:orgId/actions/:actionId')
@ApiTags('Action efficacy')
@ApiCookieAuth(SESSION_COOKIE)
@ApiResponse({ status: 400, description: 'Invalid fields, proof references or pagination.' })
@ApiResponse({ status: 401, description: 'Authenticated session required.' })
@ApiResponse({
  status: 403,
  description: 'Explicit active TECHNICAL_DECISIONS capability required for recording.',
})
@ApiResponse({ status: 404, description: 'Resource unavailable in the active organization.' })
@ApiResponse({
  status: 409,
  description: 'Action, context, predecessor or selected proof changed.',
})
@UseInterceptors(ActionPrivacyInterceptor)
export class ActionEfficacyController {
  constructor(
    private readonly efficacy: ActionEfficacyService,
    private readonly identity: IdentityService,
  ) {}
  private async scope(request: Request, orgId: string, write = false) {
    const organizationId = parse(z.uuid(), orgId);
    if (write) {
      this.identity.assertOrigin(request);
      return this.identity.requireCapability(request, organizationId, 'TECHNICAL_DECISIONS');
    }
    return this.identity.scope(request, organizationId, false);
  }
  @Get('efficacy')
  @ApiResponse({ status: 200, schema: documentation(efficacyContextSchema) })
  async context(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('actionId') id: string,
  ) {
    return this.efficacy.get(await this.scope(request, orgId), parse(z.uuid(), id));
  }
  @Get('efficacy-opinions')
  @ApiResponse({ status: 200, schema: documentation(efficacyOpinionListSchema) })
  async list(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('actionId') id: string,
    @Query() query: unknown,
  ) {
    return this.efficacy.list(
      await this.scope(request, orgId),
      parse(z.uuid(), id),
      parse(efficacyOpinionQuerySchema, query),
    );
  }
  @Get('efficacy-opinions/:opinionId')
  @ApiResponse({ status: 200, schema: documentation(efficacyOpinionSchema) })
  async get(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('actionId') id: string,
    @Param('opinionId') opinionId: string,
  ) {
    return this.efficacy.opinion(
      await this.scope(request, orgId),
      parse(z.uuid(), id),
      parse(z.uuid(), opinionId),
    );
  }
  @Post('efficacy-opinions')
  @ApiBody({ schema: documentation(createEfficacyOpinionSchema) })
  @ApiResponse({ status: 201, schema: documentation(efficacyOpinionSchema) })
  async create(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('actionId') id: string,
    @Body() body: unknown,
  ) {
    return this.efficacy.create(
      await this.scope(request, orgId, true),
      parse(z.uuid(), id),
      parse(createEfficacyOpinionSchema, body),
    );
  }
}
