import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import {
  createEvaluationMethodSchema,
  evaluationMethodListSchema,
  evaluationMethodQuerySchema,
  evaluationMethodSchema,
  evaluationMethodVersionListSchema,
  evaluationMethodVersionQuerySchema,
  evaluationMethodVersionSchema,
  forkEvaluationMethodSchema,
  publishEvaluationMethodSchema,
  updateEvaluationMethodDraftSchema,
} from '@renr/contracts';
import { parse } from '../../http/parse';
import { IdentityService, SESSION_COOKIE } from '../identity/identity.service';
import { documentation, RiskPrivacyInterceptor } from '../risks/risks.controller';
import { EvaluationMethodsService } from './evaluation-methods.service';

@Controller('organizations/:orgId/evaluation-methods')
@ApiTags('Evaluation methods')
@ApiCookieAuth(SESSION_COOKIE)
@UseInterceptors(RiskPrivacyInterceptor)
@ApiResponse({
  status: 403,
  description: 'Writes require explicit TECHNICAL_DECISIONS and trusted Origin.',
})
@ApiResponse({ status: 409, description: 'Revision conflict or immutable published content.' })
export class EvaluationMethodsController {
  constructor(
    private readonly methods: EvaluationMethodsService,
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
  @ApiResponse({ status: 200, schema: documentation(evaluationMethodListSchema) })
  async list(@Req() request: Request, @Param('orgId') org: string, @Query() query: unknown) {
    return this.methods.list(
      await this.scope(request, org),
      parse(evaluationMethodQuerySchema, query),
    );
  }
  @Post()
  @ApiBody({ schema: documentation(createEvaluationMethodSchema) })
  @ApiResponse({ status: 201, schema: documentation(evaluationMethodVersionSchema) })
  async create(@Req() request: Request, @Param('orgId') org: string, @Body() body: unknown) {
    return this.methods.create(
      await this.scope(request, org, true),
      parse(createEvaluationMethodSchema, body),
    );
  }
  @Get(':id')
  @ApiResponse({ status: 200, schema: documentation(evaluationMethodSchema) })
  async get(@Req() request: Request, @Param('orgId') org: string, @Param('id') id: string) {
    return this.methods.get(await this.scope(request, org), parse(z.uuid(), id));
  }
}

@Controller('organizations/:orgId/evaluation-method-versions')
@ApiTags('Evaluation method versions')
@ApiCookieAuth(SESSION_COOKIE)
@UseInterceptors(RiskPrivacyInterceptor)
@ApiResponse({
  status: 400,
  description:
    'Strict fields, complete explicit matrix and documented publication reference required.',
})
@ApiResponse({
  status: 403,
  description: 'Writes require explicit TECHNICAL_DECISIONS and trusted Origin.',
})
@ApiResponse({ status: 404, description: 'Resource outside active organization.' })
@ApiResponse({ status: 409, description: 'Revision conflict or immutable version.' })
export class EvaluationMethodVersionsController {
  constructor(
    private readonly methods: EvaluationMethodsService,
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
  @ApiResponse({ status: 200, schema: documentation(evaluationMethodVersionListSchema) })
  async list(@Req() request: Request, @Param('orgId') org: string, @Query() query: unknown) {
    return this.methods.versions(
      await this.scope(request, org),
      parse(evaluationMethodVersionQuerySchema, query),
    );
  }
  @Get(':id')
  @ApiResponse({ status: 200, schema: documentation(evaluationMethodVersionSchema) })
  async get(@Req() request: Request, @Param('orgId') org: string, @Param('id') id: string) {
    return this.methods.getVersion(await this.scope(request, org), parse(z.uuid(), id));
  }
  @Put(':id')
  @ApiBody({ schema: documentation(updateEvaluationMethodDraftSchema) })
  @ApiResponse({ status: 200, schema: documentation(evaluationMethodVersionSchema) })
  async update(
    @Req() request: Request,
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.methods.update(
      await this.scope(request, org, true),
      parse(z.uuid(), id),
      parse(updateEvaluationMethodDraftSchema, body),
    );
  }
  @Post(':id/publish')
  @ApiBody({ schema: documentation(publishEvaluationMethodSchema) })
  @ApiResponse({ status: 201, schema: documentation(evaluationMethodVersionSchema) })
  async publish(
    @Req() request: Request,
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.methods.publish(
      await this.scope(request, org, true),
      parse(z.uuid(), id),
      parse(publishEvaluationMethodSchema, body),
    );
  }
  @Post(':id/fork')
  @ApiBody({ schema: documentation(forkEvaluationMethodSchema) })
  @ApiResponse({ status: 201, schema: documentation(evaluationMethodVersionSchema) })
  async fork(
    @Req() request: Request,
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.methods.fork(
      await this.scope(request, org, true),
      parse(z.uuid(), id),
      parse(forkEvaluationMethodSchema, body),
    );
  }
}
