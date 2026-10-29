import { Body, Controller, Get, Param, Post, Query, Req, UseInterceptors } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import {
  createCorrectiveActionSchema,
  createRiskReassessmentSchema,
  createTechnicalClosureSchema,
  correctiveActionCreatedSchema,
  correctiveActionListSchema,
  paginationSchema,
  reassessmentContextSchema,
  riskReassessmentListSchema,
  riskReassessmentSchema,
  technicalClosureContextSchema,
  technicalClosureListSchema,
  technicalClosureSchema,
  technicalRiskEvaluationSchema,
} from '@renr/contracts';
import { parse } from '../../http/parse';
import { IdentityService, SESSION_COOKIE } from '../identity/identity.service';
import { documentation, RiskPrivacyInterceptor } from '../risks/risks.controller';
import { RiskContinuityService } from './risk-continuity.service';

@Controller('organizations/:orgId/risk-workspaces/:riskId')
@ApiTags('Risk reassessment')
@ApiCookieAuth(SESSION_COOKIE)
@UseInterceptors(RiskPrivacyInterceptor)
@ApiResponse({ status: 400, description: 'Invalid fields, duplicate references or pagination.' })
@ApiResponse({ status: 401, description: 'Authenticated session required.' })
@ApiResponse({
  status: 403,
  description: 'Active explicit technical capability and trusted Origin required for writes.',
})
@ApiResponse({
  status: 404,
  description: 'Resource unavailable in the active organization and risk.',
})
@ApiResponse({ status: 409, description: 'Risk, predecessor, measure or proof changed.' })
export class RiskReassessmentsController {
  constructor(
    private readonly continuity: RiskContinuityService,
    private readonly identity: IdentityService,
  ) {}
  private scope(request: Request, orgId: string, write = false) {
    const organizationId = parse(z.uuid(), orgId);
    if (write) {
      this.identity.assertOrigin(request);
      return this.identity.requireCapability(request, organizationId, 'TECHNICAL_DECISIONS');
    }
    return this.identity.scope(request, organizationId, false);
  }
  @Get('reassessment-context')
  @ApiResponse({ status: 200, schema: documentation(reassessmentContextSchema) })
  async context(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('riskId') riskId: string,
  ) {
    return this.continuity.reassessmentContext(
      await this.scope(request, orgId),
      parse(z.uuid(), riskId),
    );
  }
  @Get('technical-evaluations/:id')
  @ApiResponse({ status: 200, schema: documentation(technicalRiskEvaluationSchema) })
  async evaluation(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('riskId') riskId: string,
    @Param('id') id: string,
  ) {
    return this.continuity.evaluation(
      await this.scope(request, orgId),
      parse(z.uuid(), riskId),
      parse(z.uuid(), id),
    );
  }
  @Get('reassessments')
  @ApiResponse({ status: 200, schema: documentation(riskReassessmentListSchema) })
  async list(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('riskId') riskId: string,
    @Query() query: unknown,
  ) {
    return this.continuity.reassessments(
      await this.scope(request, orgId),
      parse(z.uuid(), riskId),
      parse(paginationSchema, query),
    );
  }
  @Get('reassessments/:id')
  @ApiResponse({ status: 200, schema: documentation(riskReassessmentSchema) })
  async get(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('riskId') riskId: string,
    @Param('id') id: string,
  ) {
    return this.continuity.reassessment(
      await this.scope(request, orgId),
      parse(z.uuid(), riskId),
      parse(z.uuid(), id),
    );
  }
  @Post('reassessments')
  @ApiBody({ schema: documentation(createRiskReassessmentSchema) })
  @ApiResponse({ status: 201, schema: documentation(riskReassessmentSchema) })
  async create(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('riskId') riskId: string,
    @Body() body: unknown,
  ) {
    return this.continuity.reassess(
      await this.scope(request, orgId, true),
      parse(z.uuid(), riskId),
      parse(createRiskReassessmentSchema, body),
    );
  }
}

@Controller('organizations/:orgId/actions/:actionId')
@ApiTags('Action technical closure and correction')
@ApiCookieAuth(SESSION_COOKIE)
@UseInterceptors(RiskPrivacyInterceptor)
@ApiResponse({ status: 400, description: 'Invalid fields or pagination.' })
@ApiResponse({ status: 401, description: 'Authenticated session required.' })
@ApiResponse({
  status: 403,
  description:
    'Explicit technical capability required; correction also requires operational ADMIN.',
})
@ApiResponse({
  status: 404,
  description: 'Resource unavailable in the active organization and action.',
})
@ApiResponse({
  status: 409,
  description: 'Closure prerequisites, versions, predecessor or selected proof changed.',
})
export class ActionTechnicalClosuresController {
  constructor(
    private readonly continuity: RiskContinuityService,
    private readonly identity: IdentityService,
  ) {}
  private scope(request: Request, orgId: string, write = false) {
    const organizationId = parse(z.uuid(), orgId);
    if (write) {
      this.identity.assertOrigin(request);
      return this.identity.requireCapability(request, organizationId, 'TECHNICAL_DECISIONS');
    }
    return this.identity.scope(request, organizationId, false);
  }
  @Get('closure-context')
  @ApiResponse({ status: 200, schema: documentation(technicalClosureContextSchema) })
  async context(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('actionId') actionId: string,
  ) {
    return this.continuity.closureContext(
      await this.scope(request, orgId),
      parse(z.uuid(), actionId),
    );
  }
  @Get('technical-closures')
  @ApiResponse({ status: 200, schema: documentation(technicalClosureListSchema) })
  async list(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('actionId') actionId: string,
    @Query() query: unknown,
  ) {
    return this.continuity.closures(
      await this.scope(request, orgId),
      parse(z.uuid(), actionId),
      parse(paginationSchema, query),
    );
  }
  @Get('technical-closures/:id')
  @ApiResponse({ status: 200, schema: documentation(technicalClosureSchema) })
  async get(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('actionId') actionId: string,
    @Param('id') id: string,
  ) {
    return this.continuity.closure(
      await this.scope(request, orgId),
      parse(z.uuid(), actionId),
      parse(z.uuid(), id),
    );
  }
  @Post('technical-closures')
  @ApiBody({ schema: documentation(createTechnicalClosureSchema) })
  @ApiResponse({ status: 201, schema: documentation(technicalClosureSchema) })
  async create(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('actionId') actionId: string,
    @Body() body: unknown,
  ) {
    return this.continuity.close(
      await this.scope(request, orgId, true),
      parse(z.uuid(), actionId),
      parse(createTechnicalClosureSchema, body),
    );
  }
  @Get('corrective-actions')
  @ApiResponse({ status: 200, schema: documentation(correctiveActionListSchema) })
  async corrections(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('actionId') actionId: string,
    @Query() query: unknown,
  ) {
    return this.continuity.correctiveActions(
      await this.scope(request, orgId),
      parse(z.uuid(), actionId),
      parse(paginationSchema, query),
    );
  }
  @Post('corrective-actions')
  @ApiBody({ schema: documentation(createCorrectiveActionSchema) })
  @ApiResponse({ status: 201, schema: documentation(correctiveActionCreatedSchema) })
  async correct(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('actionId') actionId: string,
    @Body() body: unknown,
  ) {
    return this.continuity.createCorrective(
      await this.scope(request, orgId, true),
      parse(z.uuid(), actionId),
      parse(createCorrectiveActionSchema, body),
    );
  }
}
