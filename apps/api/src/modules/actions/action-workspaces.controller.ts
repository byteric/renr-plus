import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  actionAssigneeListSchema,
  actionAssigneeQuerySchema,
  actionAssignmentSchema,
  actionDetailSchema,
  actionExecutionSchema,
  actionPaginationQuerySchema,
  actionRevisionSchema,
  actionWorkspaceHistoryListSchema,
  actionWorkspaceListSchema,
  actionWorkspaceQuerySchema,
  actionWorkspaceSchema,
  addActionNoteSchema,
  createAssignedActionSchema,
} from '@renr/contracts';
import type { Request } from 'express';
import { z } from 'zod';
import { parse } from '../../http/parse';
import { IdentityService, SESSION_COOKIE } from '../identity/identity.service';
import { documentation } from '../risks/risks.controller';
import { ActionPrivacyInterceptor } from './actions.controller';
import { ActionsService } from './actions.service';
import { ActionWorkspacesService } from './action-workspaces.service';

@Controller('organizations/:orgId')
@ApiTags('Action workspaces')
@ApiCookieAuth(SESSION_COOKIE)
@ApiResponse({ status: 400, description: 'Invalid strict fields or filters.' })
@ApiResponse({ status: 401, description: 'Session required.' })
@ApiResponse({
  status: 403,
  description: 'Active administrator or explicitly authorized assigned executor required.',
})
@ApiResponse({ status: 404, description: 'Resource unavailable in the active organization.' })
@ApiResponse({
  status: 409,
  description: 'Stale version, terminal state, inactive assignee or protected reference.',
})
@UseInterceptors(ActionPrivacyInterceptor)
export class ActionWorkspacesController {
  constructor(
    private readonly workspaces: ActionWorkspacesService,
    private readonly actions: ActionsService,
    private readonly identity: IdentityService,
  ) {}
  private async scope(
    request: Request,
    orgId: string,
    operation: 'read' | 'manage' | 'execute' = 'read',
    id?: string,
  ) {
    if (operation !== 'read') this.identity.assertOrigin(request);
    const organizationId = parse(z.uuid(), orgId);
    const scope = await this.identity.scope(request, organizationId, operation === 'manage');
    if (operation === 'execute' && !(await this.identity.capabilities(request)).canManageAccess) {
      await this.identity.requireCapability(request, organizationId, 'EXECUTE_ASSIGNED_ACTIONS');
      await this.identity.assignedActionScope(
        request,
        organizationId,
        await this.actions.assignmentResource(scope, parse(z.uuid(), id)),
      );
    }
    return scope;
  }
  @Get('action-workspaces')
  @ApiResponse({ status: 200, schema: documentation(actionWorkspaceListSchema) })
  list(@Req() request: Request, @Param('orgId') orgId: string, @Query() query: unknown) {
    return this.scope(request, orgId).then((scope) =>
      this.workspaces.list(scope, parse(actionWorkspaceQuerySchema, query)),
    );
  }
  @Get('action-assignees')
  @ApiResponse({ status: 200, schema: documentation(actionAssigneeListSchema) })
  assignees(@Req() request: Request, @Param('orgId') orgId: string, @Query() query: unknown) {
    return this.scope(request, orgId).then((scope) =>
      this.workspaces.assignees(scope, parse(actionAssigneeQuerySchema, query)),
    );
  }
  @Get('action-workspaces/:id')
  @ApiResponse({ status: 200, schema: documentation(actionWorkspaceSchema) })
  get(@Req() request: Request, @Param('orgId') orgId: string, @Param('id') id: string) {
    return this.scope(request, orgId).then((scope) =>
      this.workspaces.get(scope, parse(z.uuid(), id)),
    );
  }
  @Get('action-workspaces/:id/history')
  @ApiResponse({ status: 200, schema: documentation(actionWorkspaceHistoryListSchema) })
  history(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return this.scope(request, orgId).then((scope) =>
      this.workspaces.history(
        scope,
        parse(z.uuid(), id),
        parse(actionPaginationQuerySchema, query),
      ),
    );
  }
  @Post('risks/:riskId/action-workspaces')
  @ApiBody({ schema: documentation(createAssignedActionSchema) })
  @ApiResponse({ status: 201, schema: documentation(actionDetailSchema) })
  async create(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('riskId') riskId: string,
    @Body() body: unknown,
  ) {
    const scope = await this.scope(request, orgId, 'manage');
    const { assignedUserId, ...input } = parse(createAssignedActionSchema, body);
    return this.actions.create(scope, parse(z.uuid(), riskId), input, {
      assignedUserId: assignedUserId ?? null,
    });
  }
  @Patch('actions/:id/assignment')
  @ApiBody({ schema: documentation(actionAssignmentSchema) })
  @ApiResponse({ status: 200, schema: documentation(actionDetailSchema) })
  async assign(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.workspaces.assign(
      await this.scope(request, orgId, 'manage'),
      parse(z.uuid(), id),
      parse(actionAssignmentSchema, body),
    );
  }
  @Patch('action-workspaces/:id/execution')
  @ApiBody({ schema: documentation(actionExecutionSchema) })
  @ApiResponse({ status: 200, schema: documentation(actionDetailSchema) })
  async execute(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.actions.execute(
      await this.scope(request, orgId, 'execute', id),
      parse(z.uuid(), id),
      parse(actionExecutionSchema, body),
    );
  }
  @Post('action-workspaces/:id/notes')
  @ApiBody({ schema: documentation(addActionNoteSchema) })
  @ApiResponse({ status: 201, schema: documentation(actionRevisionSchema) })
  async note(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.actions.note(
      await this.scope(request, orgId, 'execute', id),
      parse(z.uuid(), id),
      parse(addActionNoteSchema, body),
      'execute',
    );
  }
}
