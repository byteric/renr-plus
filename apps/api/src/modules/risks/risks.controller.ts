import {
  Body,
  CallHandler,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  NestInterceptor,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import {
  createRiskSchema,
  updateRiskSchema,
  riskListQuerySchema,
  paginationSchema,
  createPreliminaryEvaluationSchema,
  riskDetailSchema,
  riskListSchema,
  preliminaryEvaluationSchema,
  preliminaryEvaluationListSchema,
} from '@renr/contracts';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { parse } from '../../http/parse';
import { IdentityService, SESSION_COOKIE } from '../identity/identity.service';
import { RisksService } from './risks.service';

// Zod's OpenAPI target emits compatible schemas, while its declaration also covers other JSON Schema dialects.
export const documentation = (schema: z.ZodType): SchemaObject =>
  z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io: 'input',
    unrepresentable: 'any',
  }) as SchemaObject;

@Injectable()
export class RiskPrivacyInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    context.switchToHttp().getResponse<Response>().setHeader('Cache-Control', 'private, no-store');
    return next.handle();
  }
}

@Controller('organizations/:orgId/risks')
@ApiTags('Risks')
@ApiCookieAuth(SESSION_COOKIE)
@ApiResponse({ status: 400, description: 'Invalid fields, transition or filters.' })
@ApiResponse({ status: 401, description: 'Missing or expired session.' })
@ApiResponse({
  status: 403,
  description: 'ADMIN role, exact Origin or available diagnostic source required.',
})
@ApiResponse({ status: 404, description: 'Resource unavailable in active organization.' })
@ApiResponse({ status: 409, description: 'Version conflict, archived risk or inactive scope.' })
@UseInterceptors(RiskPrivacyInterceptor)
export class RisksController {
  constructor(
    private readonly risks: RisksService,
    private readonly identity: IdentityService,
  ) {}
  private scope(request: Request, orgId: string, write = false) {
    if (write) this.identity.assertOrigin(request);
    return this.identity.scope(request, parse(z.uuid(), orgId), write);
  }
  @Get()
  @ApiOperation({
    summary: 'Paginated inventory, default excludes archived; stable creation date/id order.',
  })
  @ApiResponse({
    status: 200,
    description: 'RiskList: items, total, page, pageSize.',
    schema: documentation(riskListSchema),
  })
  async list(@Req() request: Request, @Param('orgId') orgId: string, @Query() query: unknown) {
    return this.risks.list(await this.scope(request, orgId), parse(riskListQuerySchema, query));
  }
  @Post()
  @ApiBody({ schema: documentation(createRiskSchema) })
  @ApiResponse({
    status: 201,
    description: 'RiskDetail; author and version assigned by server.',
    schema: documentation(riskDetailSchema),
  })
  async create(@Req() request: Request, @Param('orgId') orgId: string, @Body() body: unknown) {
    return this.risks.create(await this.scope(request, orgId, true), parse(createRiskSchema, body));
  }
  @Get(':id')
  @ApiResponse({
    status: 200,
    description: 'RiskDetail including latest preliminary evaluation.',
    schema: documentation(riskDetailSchema),
  })
  async get(@Req() request: Request, @Param('orgId') orgId: string, @Param('id') id: string) {
    return this.risks.get(await this.scope(request, orgId), parse(z.uuid(), id));
  }
  @Patch(':id')
  @ApiBody({ schema: documentation(updateRiskSchema) })
  @ApiResponse({
    status: 200,
    description: 'RiskDetail with incremented version; archive is logical.',
    schema: documentation(riskDetailSchema),
  })
  async update(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.risks.update(
      await this.scope(request, orgId, true),
      parse(z.uuid(), id),
      parse(updateRiskSchema, body),
    );
  }
  @Get(':id/evaluations')
  @ApiResponse({
    status: 200,
    description: 'Paginated preliminary history in descending sequence order.',
    schema: documentation(preliminaryEvaluationListSchema),
  })
  async evaluations(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return this.risks.evaluations(
      await this.scope(request, orgId),
      parse(z.uuid(), id),
      parse(paginationSchema, query),
    );
  }
  @Post(':id/evaluations')
  @ApiBody({ schema: documentation(createPreliminaryEvaluationSchema) })
  @ApiResponse({
    status: 201,
    description:
      'PRELIMINARY evaluation, immutable context and sequence assigned by server; no normative score.',
    schema: documentation(preliminaryEvaluationSchema),
  })
  async evaluate(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.risks.evaluate(
      await this.scope(request, orgId, true),
      parse(z.uuid(), id),
      parse(createPreliminaryEvaluationSchema, body),
    );
  }
}
