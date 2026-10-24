import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBody, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Request } from 'express';
import {
  assessmentAccessSchema,
  assessmentCycleQuerySchema,
  assessmentConsolidationQuerySchema,
  assessmentTransitionSchema,
  createAssessmentCycleSchema,
  updateAssessmentCycleSchema,
  createAssessmentInvitesSchema,
  createAssessmentSourceSchema,
  createConsolidationPolicySchema,
  updateConsolidationPolicySchema,
  publishConsolidationPolicySchema,
  forkConsolidationPolicySchema,
  paginationSchema,
  submitAssessmentResponseSchema,
  assessmentParticipationSchema,
  assessmentSubmissionSchema,
  assessmentCycleSchema,
  assessmentCycleListSchema,
  assessmentResultsSchema,
  assessmentConsolidationSchema,
  assessmentInvitesSchema,
  assessmentSourceSchema,
  assessmentSourceListSchema,
  consolidationPolicySchema,
  consolidationPolicyListSchema,
} from '@renr/contracts';
import { parse } from '../../http/parse';
import { IdentityService } from '../identity/identity.service';
import { DiagnosticPrivacyInterceptor } from '../diagnostics/diagnostics.controller';
import { documentation } from '../risks/risks.controller';
import { AssessmentsService } from './assessments.service';
@Controller()
@ApiTags('Assessment collection and consolidation')
@UseInterceptors(DiagnosticPrivacyInterceptor)
export class AssessmentsController {
  constructor(
    private readonly service: AssessmentsService,
    private readonly identity: IdentityService,
  ) {}
  private scope(req: Request, orgId: string, admin = false, mutation = false) {
    if (mutation) this.identity.assertOrigin(req);
    return this.identity.scope(req, parse(z.uuid(), orgId), admin);
  }
  @Get('organizations/:orgId/consolidation-policies')
  @ApiResponse({ status: 200, schema: documentation(consolidationPolicyListSchema) })
  async policies(@Req() req: Request, @Param('orgId') org: string, @Query() q: unknown) {
    return this.service.policies(await this.scope(req, org), parse(paginationSchema, q));
  }
  @Post('organizations/:orgId/consolidation-policies')
  @ApiBody({ schema: documentation(createConsolidationPolicySchema) })
  @ApiResponse({ status: 201, schema: documentation(consolidationPolicySchema) })
  async createPolicy(@Req() req: Request, @Param('orgId') org: string, @Body() body: unknown) {
    return this.service.createPolicy(
      await this.scope(req, org, true, true),
      parse(createConsolidationPolicySchema, body),
    );
  }
  @Get('organizations/:orgId/consolidation-policies/:id')
  @ApiResponse({ status: 200, schema: documentation(consolidationPolicySchema) })
  async policy(@Req() req: Request, @Param('orgId') org: string, @Param('id') id: string) {
    return this.service.getPolicy(await this.scope(req, org), parse(z.uuid(), id));
  }
  @Put('organizations/:orgId/consolidation-policies/:id')
  @ApiBody({ schema: documentation(updateConsolidationPolicySchema) })
  @ApiResponse({ status: 200, schema: documentation(consolidationPolicySchema) })
  async updatePolicy(
    @Req() req: Request,
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.updatePolicy(
      await this.scope(req, org, true, true),
      parse(z.uuid(), id),
      parse(updateConsolidationPolicySchema, body),
    );
  }
  @Post('organizations/:orgId/consolidation-policies/:id/publish')
  @ApiBody({ schema: documentation(publishConsolidationPolicySchema) })
  @ApiResponse({ status: 201, schema: documentation(consolidationPolicySchema) })
  async publishPolicy(
    @Req() req: Request,
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const scope = await this.scope(req, org, false, true);
    const caps = await this.identity.capabilities(req);
    if (caps.organizationId !== scope.organizationId) throw new ForbiddenException();
    return this.service.publishPolicy(
      scope,
      parse(z.uuid(), id),
      parse(publishConsolidationPolicySchema, body),
      { admin: caps.canManageAccess, technical: caps.capabilities.includes('TECHNICAL_DECISIONS') },
    );
  }
  @Post('organizations/:orgId/consolidation-policies/:id/fork')
  @ApiBody({ schema: documentation(forkConsolidationPolicySchema) })
  @ApiResponse({ status: 201, schema: documentation(consolidationPolicySchema) })
  async forkPolicy(
    @Req() req: Request,
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.forkPolicy(
      await this.scope(req, org, true, true),
      parse(z.uuid(), id),
      parse(forkConsolidationPolicySchema, body).expectedRevision,
    );
  }
  @Get('organizations/:orgId/assessment-cycles')
  @ApiResponse({ status: 200, schema: documentation(assessmentCycleListSchema) })
  async list(@Req() req: Request, @Param('orgId') org: string, @Query() q: unknown) {
    return this.service.list(await this.scope(req, org), parse(assessmentCycleQuerySchema, q));
  }
  @Post('organizations/:orgId/assessment-cycles')
  @ApiBody({ schema: documentation(createAssessmentCycleSchema) })
  @ApiResponse({ status: 201, schema: documentation(assessmentCycleSchema) })
  async create(@Req() req: Request, @Param('orgId') org: string, @Body() body: unknown) {
    return this.service.create(
      await this.scope(req, org, true, true),
      parse(createAssessmentCycleSchema, body),
    );
  }
  @Get('organizations/:orgId/assessment-cycles/:id')
  @ApiResponse({ status: 200, schema: documentation(assessmentCycleSchema) })
  async get(@Req() req: Request, @Param('orgId') org: string, @Param('id') id: string) {
    return this.service.get(await this.scope(req, org), parse(z.uuid(), id));
  }
  @Put('organizations/:orgId/assessment-cycles/:id')
  @ApiBody({ schema: documentation(updateAssessmentCycleSchema) })
  @ApiResponse({ status: 200, schema: documentation(assessmentCycleSchema) })
  async update(
    @Req() req: Request,
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.update(
      await this.scope(req, org, true, true),
      parse(z.uuid(), id),
      parse(updateAssessmentCycleSchema, body),
    );
  }
  @Post('organizations/:orgId/assessment-cycles/:id/open')
  @ApiBody({ schema: documentation(assessmentTransitionSchema) })
  @ApiResponse({ status: 201, schema: documentation(assessmentCycleSchema) })
  async open(
    @Req() req: Request,
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.transition(
      await this.scope(req, org, true, true),
      parse(z.uuid(), id),
      parse(assessmentTransitionSchema, body).expectedRevision,
      'OPEN',
    );
  }
  @Post('organizations/:orgId/assessment-cycles/:id/close')
  @ApiBody({ schema: documentation(assessmentTransitionSchema) })
  @ApiResponse({ status: 201, schema: documentation(assessmentCycleSchema) })
  async close(
    @Req() req: Request,
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.transition(
      await this.scope(req, org, true, true),
      parse(z.uuid(), id),
      parse(assessmentTransitionSchema, body).expectedRevision,
      'CLOSED',
    );
  }
  @Post('organizations/:orgId/assessment-cycles/:id/invites')
  @ApiBody({ schema: documentation(createAssessmentInvitesSchema) })
  @ApiResponse({ status: 201, schema: documentation(assessmentInvitesSchema) })
  async invites(
    @Req() req: Request,
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.invites(
      await this.scope(req, org, true, true),
      parse(z.uuid(), id),
      parse(createAssessmentInvitesSchema, body).count,
    );
  }
  @Get('organizations/:orgId/assessment-cycles/:id/sources')
  @ApiResponse({ status: 200, schema: documentation(assessmentSourceListSchema) })
  async sources(
    @Req() req: Request,
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Query() q: unknown,
  ) {
    return this.service.sources(
      await this.scope(req, org),
      parse(z.uuid(), id),
      parse(paginationSchema, q),
    );
  }
  @Post('organizations/:orgId/assessment-cycles/:id/sources')
  @ApiBody({ schema: documentation(createAssessmentSourceSchema) })
  @ApiResponse({ status: 201, schema: documentation(assessmentSourceSchema) })
  async source(
    @Req() req: Request,
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.source(
      await this.scope(req, org, true, true),
      parse(z.uuid(), id),
      parse(createAssessmentSourceSchema, body),
    );
  }
  @Get('organizations/:orgId/assessment-cycles/:id/results')
  @ApiResponse({ status: 200, schema: documentation(assessmentResultsSchema) })
  async results(@Req() req: Request, @Param('orgId') org: string, @Param('id') id: string) {
    return this.service.results(await this.scope(req, org), parse(z.uuid(), id));
  }
  @Get('organizations/:orgId/assessment-consolidation')
  @ApiResponse({ status: 200, schema: documentation(assessmentConsolidationSchema) })
  async consolidation(@Req() req: Request, @Param('orgId') org: string, @Query() q: unknown) {
    return this.service.consolidation(
      await this.scope(req, org),
      parse(assessmentConsolidationQuerySchema, q),
    );
  }
  @Post('assessment-participation/access')
  @ApiBody({ schema: documentation(assessmentAccessSchema) })
  @ApiResponse({ status: 201, schema: documentation(assessmentParticipationSchema) })
  access(@Req() req: Request, @Body() body: unknown) {
    this.service.rateLimit(req.ip ?? 'unknown');
    return this.service.access(parse(assessmentAccessSchema, body).inviteCode);
  }
  @Post('assessment-participation/submissions')
  @ApiBody({ schema: documentation(submitAssessmentResponseSchema) })
  @ApiResponse({ status: 201, schema: documentation(assessmentSubmissionSchema) })
  submit(@Req() req: Request, @Body() body: unknown) {
    this.service.rateLimit(req.ip ?? 'unknown');
    return this.service.submit(parse(submitAssessmentResponseSchema, body));
  }
}
