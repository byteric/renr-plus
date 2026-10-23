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
import { ApiBody, ApiCookieAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  createActionSchema,
  updateActionSchema,
  addActionNoteSchema,
  actionListQuerySchema,
  actionPaginationQuerySchema,
  actionDetailSchema,
  actionListSchema,
  actionRevisionSchema,
  actionRevisionListSchema,
  actionOverviewSchema,
} from '@renr/contracts';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { parse } from '../../http/parse';
import { IdentityService, SESSION_COOKIE } from '../identity/identity.service';
import { documentation } from '../risks/risks.controller';
import { ActionsService } from './actions.service';

@Injectable()
export class ActionPrivacyInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    context.switchToHttp().getResponse<Response>().setHeader('Cache-Control', 'private, no-store');
    return next.handle();
  }
}
@Controller('organizations/:orgId')
@ApiTags('Actions')
@ApiCookieAuth(SESSION_COOKIE)
@ApiResponse({ status: 400, description: 'Invalid fields or strict filters.' })
@ApiResponse({ status: 401, description: 'Session required.' })
@ApiResponse({ status: 403, description: 'Exact Origin and ADMIN required for writes.' })
@ApiResponse({ status: 404, description: 'Resource unavailable in active organization.' })
@ApiResponse({
  status: 409,
  description: 'Version conflict, invalid transition or unavailable origin.',
})
@UseInterceptors(ActionPrivacyInterceptor)
export class ActionsController {
  constructor(
    private readonly actions: ActionsService,
    private readonly identity: IdentityService,
  ) {}
  private scope(request: Request, orgId: string, write = false) {
    if (write) this.identity.assertOrigin(request);
    return this.identity.scope(request, parse(z.uuid(), orgId), write);
  }
  @Post('risks/:riskId/actions')
  @ApiBody({ schema: documentation(createActionSchema) })
  @ApiResponse({
    status: 201,
    description: 'Planned action and preserved server context.',
    schema: documentation(actionDetailSchema),
  })
  async create(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('riskId') riskId: string,
    @Body() body: unknown,
  ) {
    return this.actions.create(
      await this.scope(request, orgId, true),
      parse(z.uuid(), riskId),
      parse(createActionSchema, body),
    );
  }
  @Get('actions')
  @ApiResponse({ status: 200, schema: documentation(actionListSchema) })
  async list(@Req() request: Request, @Param('orgId') orgId: string, @Query() query: unknown) {
    return this.actions.list(await this.scope(request, orgId), parse(actionListQuerySchema, query));
  }
  @Get('action-overview')
  @ApiResponse({
    status: 200,
    description: 'Consistent operational counts, not efficacy.',
    schema: documentation(actionOverviewSchema),
  })
  async overview(@Req() request: Request, @Param('orgId') orgId: string, @Query() query: unknown) {
    const scope = await this.scope(request, orgId);
    parse(z.object({}).strict(), query);
    return this.actions.overview(scope);
  }
  @Get('actions/:id')
  @ApiResponse({ status: 200, schema: documentation(actionDetailSchema) })
  async get(@Req() request: Request, @Param('orgId') orgId: string, @Param('id') id: string) {
    return this.actions.get(await this.scope(request, orgId), parse(z.uuid(), id));
  }
  @Patch('actions/:id')
  @ApiBody({ schema: documentation(updateActionSchema) })
  @ApiResponse({ status: 200, schema: documentation(actionDetailSchema) })
  async update(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.actions.update(
      await this.scope(request, orgId, true),
      parse(z.uuid(), id),
      parse(updateActionSchema, body),
    );
  }
  @Get('actions/:id/revisions')
  @ApiResponse({ status: 200, schema: documentation(actionRevisionListSchema) })
  async revisions(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return this.actions.revisions(
      await this.scope(request, orgId),
      parse(z.uuid(), id),
      parse(actionPaginationQuerySchema, query),
    );
  }
  @Post('actions/:id/notes')
  @ApiBody({ schema: documentation(addActionNoteSchema) })
  @ApiResponse({ status: 201, schema: documentation(actionRevisionSchema) })
  async note(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.actions.note(
      await this.scope(request, orgId, true),
      parse(z.uuid(), id),
      parse(addActionNoteSchema, body),
    );
  }
}
