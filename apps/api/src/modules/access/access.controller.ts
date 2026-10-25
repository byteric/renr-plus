import { Body, Controller, Get, Header, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  acceptAccessInviteSchema,
  accessHistoryListSchema,
  accessInviteAcceptanceSchema,
  accessInviteListSchema,
  accessInviteSchema,
  accessInviteSecretSchema,
  accessMembershipListSchema,
  accessMembershipSchema,
  createAccessInviteSchema,
  mutateAccessInviteSchema,
  paginationSchema,
  updateAccessCapabilitiesSchema,
  updateAccessMembershipSchema,
} from '@renr/contracts';
import type { Request } from 'express';
import { z } from 'zod';
import { parse } from '../../http/parse';
import { IdentityService, SESSION_COOKIE } from '../identity/identity.service';
import { documentation } from '../risks/risks.controller';
import { AccessService } from './access.service';

@Controller('organizations/:orgId')
@ApiTags('Organization access')
@ApiCookieAuth(SESSION_COOKIE)
@ApiResponse({ status: 400, description: 'Invalid strict input.' })
@ApiResponse({ status: 401, description: 'Session required.' })
@ApiResponse({ status: 403, description: 'ADMIN and exact Origin required for mutation.' })
@ApiResponse({ status: 404, description: 'Resource unavailable in active organization.' })
@ApiResponse({ status: 409, description: 'Stale version or last active administrator.' })
export class AccessController {
  constructor(
    private readonly access: AccessService,
    private readonly identity: IdentityService,
  ) {}
  private scope(request: Request, orgId: string, write = false) {
    if (write) this.identity.assertOrigin(request);
    return this.identity.scope(request, parse(z.uuid(), orgId), true);
  }
  @Get('access-memberships')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, schema: documentation(accessMembershipListSchema) })
  async list(@Req() request: Request, @Param('orgId') orgId: string, @Query() query: unknown) {
    return this.access.members(await this.scope(request, orgId), parse(paginationSchema, query));
  }
  @Patch('access-memberships/:userId')
  @Header('Cache-Control', 'private, no-store')
  @ApiBody({ schema: documentation(updateAccessMembershipSchema) })
  @ApiResponse({ status: 200, schema: documentation(accessMembershipSchema) })
  async update(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ) {
    return this.access.update(
      await this.scope(request, orgId, true),
      parse(z.uuid(), userId),
      parse(updateAccessMembershipSchema, body),
    );
  }
  @Get('access-memberships/:userId')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, schema: documentation(accessMembershipSchema) })
  async member(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
  ) {
    return this.access.member(await this.scope(request, orgId), parse(z.uuid(), userId));
  }
  @Put('access-memberships/:userId/capabilities')
  @Header('Cache-Control', 'private, no-store')
  @ApiBody({ schema: documentation(updateAccessCapabilitiesSchema) })
  @ApiResponse({ status: 200, schema: documentation(accessMembershipSchema) })
  async capabilities(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ) {
    return this.access.update(
      await this.scope(request, orgId, true),
      parse(z.uuid(), userId),
      parse(updateAccessCapabilitiesSchema, body),
    );
  }
  @Get('access-history')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, schema: documentation(accessHistoryListSchema) })
  async history(@Req() request: Request, @Param('orgId') orgId: string, @Query() query: unknown) {
    return this.access.histories(await this.scope(request, orgId), parse(paginationSchema, query));
  }
  @Get('access-invites')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, schema: documentation(accessInviteListSchema) })
  async invites(@Req() request: Request, @Param('orgId') orgId: string, @Query() query: unknown) {
    return this.access.invites(await this.scope(request, orgId), parse(paginationSchema, query));
  }
  @Post('access-invites')
  @Header('Cache-Control', 'private, no-store')
  @ApiBody({ schema: documentation(createAccessInviteSchema) })
  @ApiResponse({ status: 201, schema: documentation(accessInviteSecretSchema) })
  async create(@Req() request: Request, @Param('orgId') orgId: string, @Body() body: unknown) {
    return this.access.create(
      await this.scope(request, orgId, true),
      parse(createAccessInviteSchema, body),
    );
  }
  @Post('access-invites/:id/revoke')
  @Header('Cache-Control', 'private, no-store')
  @ApiBody({ schema: documentation(mutateAccessInviteSchema) })
  @ApiResponse({ status: 201, schema: documentation(accessInviteSchema) })
  async revoke(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.access.mutateInvite(
      await this.scope(request, orgId, true),
      parse(z.uuid(), id),
      parse(mutateAccessInviteSchema, body),
      false,
    );
  }
  @Post('access-invites/:id/reissue')
  @Header('Cache-Control', 'private, no-store')
  @ApiBody({ schema: documentation(mutateAccessInviteSchema) })
  @ApiResponse({ status: 201, schema: documentation(accessInviteSecretSchema) })
  async reissue(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.access.mutateInvite(
      await this.scope(request, orgId, true),
      parse(z.uuid(), id),
      parse(mutateAccessInviteSchema, body),
      true,
    );
  }
}

@Controller('access-invites')
@ApiTags('Activation invitations')
export class AccessInvitationController {
  constructor(
    private readonly access: AccessService,
    private readonly identity: IdentityService,
  ) {}
  @Post('accept')
  @Header('Cache-Control', 'private, no-store')
  @ApiBody({ schema: documentation(acceptAccessInviteSchema) })
  @ApiResponse({ status: 201, schema: documentation(accessInviteAcceptanceSchema) })
  @ApiResponse({
    status: 400,
    description: 'New account requires name and password; existing password cannot change.',
  })
  @ApiResponse({ status: 401, description: 'Existing identity must authenticate.' })
  @ApiResponse({ status: 403, description: 'Origin or authenticated identity does not match.' })
  @ApiResponse({
    status: 409,
    description:
      'ACCESS_INVITE_UNAVAILABLE: absent/expired/revoked/consumed token; CONFLICT: membership already active or identity collision.',
  })
  @ApiResponse({ status: 429, description: 'Acceptance attempt limit reached.' })
  accept(@Req() request: Request, @Body() body: unknown) {
    this.identity.assertOrigin(request);
    return this.access.accept(request, parse(acceptAccessInviteSchema, body));
  }
}
