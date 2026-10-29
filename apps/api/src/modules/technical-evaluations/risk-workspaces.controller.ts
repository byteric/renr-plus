import { Body, Controller, Get, Param, Post, Query, Req, UseInterceptors } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import {
  createTechnicalRiskEvaluationSchema,
  paginationSchema,
  riskMatrixQuerySchema,
  riskMatrixSchema,
  riskSourceOptionListSchema,
  riskWorkspaceListSchema,
  riskWorkspaceQuerySchema,
  riskWorkspaceSchema,
  technicalRiskEvaluationListSchema,
  technicalRiskEvaluationSchema,
} from '@renr/contracts';
import { parse } from '../../http/parse';
import { IdentityService, SESSION_COOKIE } from '../identity/identity.service';
import { documentation, RiskPrivacyInterceptor } from '../risks/risks.controller';
import { RiskWorkspacesService } from './risk-workspaces.service';

@Controller('organizations/:orgId/risk-workspaces')
@ApiTags('Technical risk workspace')
@ApiCookieAuth(SESSION_COOKIE)
@UseInterceptors(RiskPrivacyInterceptor)
@ApiResponse({ status: 400, description: 'Strict input, method scale or filter error.' })
@ApiResponse({ status: 401, description: 'Session required.' })
@ApiResponse({
  status: 403,
  description: 'Technical writes require explicit capability and trusted Origin.',
})
@ApiResponse({
  status: 404,
  description: 'Resource unavailable in active organization or assessment group.',
})
@ApiResponse({
  status: 409,
  description: 'Stale risk version, unpublished method, inactive context or demonstration source.',
})
export class RiskWorkspacesController {
  constructor(
    private readonly workspaces: RiskWorkspacesService,
    private readonly identity: IdentityService,
  ) {}
  private scope(request: Request, org: string, write = false) {
    const id = parse(z.uuid(), org);
    if (write) {
      this.identity.assertOrigin(request);
      return this.identity.requireCapability(request, id, 'TECHNICAL_DECISIONS');
    }
    return this.identity.scope(request, id, false);
  }
  @Get()
  @ApiResponse({ status: 200, schema: documentation(riskWorkspaceListSchema) })
  async list(@Req() request: Request, @Param('orgId') org: string, @Query() query: unknown) {
    return this.workspaces.list(
      await this.scope(request, org),
      parse(riskWorkspaceQuerySchema, query),
    );
  }
  @Get('matrix')
  @ApiResponse({ status: 200, schema: documentation(riskMatrixSchema) })
  async matrix(@Req() request: Request, @Param('orgId') org: string, @Query() query: unknown) {
    return this.workspaces.matrix(
      await this.scope(request, org),
      parse(riskMatrixQuerySchema, query),
    );
  }
  @Get(':id/source-options')
  @ApiResponse({ status: 200, schema: documentation(riskSourceOptionListSchema) })
  async sources(
    @Req() request: Request,
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return this.workspaces.sourceOptions(
      await this.scope(request, org),
      parse(z.uuid(), id),
      parse(paginationSchema, query),
    );
  }
  @Get(':id/technical-evaluations')
  @ApiResponse({ status: 200, schema: documentation(technicalRiskEvaluationListSchema) })
  async history(
    @Req() request: Request,
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return this.workspaces.evaluations(
      await this.scope(request, org),
      parse(z.uuid(), id),
      parse(paginationSchema, query),
    );
  }
  @Post(':id/technical-evaluations')
  @ApiBody({ schema: documentation(createTechnicalRiskEvaluationSchema) })
  @ApiResponse({ status: 201, schema: documentation(technicalRiskEvaluationSchema) })
  async evaluate(
    @Req() request: Request,
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.workspaces.evaluate(
      await this.scope(request, org, true),
      parse(z.uuid(), id),
      parse(createTechnicalRiskEvaluationSchema, body),
    );
  }
  @Get(':id')
  @ApiResponse({ status: 200, schema: documentation(riskWorkspaceSchema) })
  async get(@Req() request: Request, @Param('orgId') org: string, @Param('id') id: string) {
    return this.workspaces.get(await this.scope(request, org), parse(z.uuid(), id));
  }
}
