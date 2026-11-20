import { Body, Controller, Get, Header, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  createSupportTicketSchema,
  platformSupportTicketQuerySchema,
  supportTicketAssigneesSchema,
  supportTicketDetailSchema,
  supportTicketListSchema,
  supportTicketQuerySchema,
  updateSupportTicketSchema,
} from '@renr/contracts';
import { ApiCookieAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { parse } from '../../http/parse';
import { IdentityService, SESSION_COOKIE } from '../identity/identity.service';
import { documentation } from '../risks/risks.controller';
import { SupportService } from './support.service';

@Controller('organizations/:orgId/support-tickets')
@ApiTags('Company support')
@ApiCookieAuth(SESSION_COOKIE)
export class CompanySupportController {
  constructor(
    private readonly identity: IdentityService,
    private readonly support: SupportService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, schema: documentation(supportTicketListSchema) })
  async list(@Req() req: Request, @Param('orgId') orgId: string, @Query() query: unknown) {
    const scope = await this.identity.scope(req, parse(z.uuid(), orgId), true);
    return this.support.companyList(scope, parse(supportTicketQuerySchema, query));
  }

  @Get(':ticketId')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, schema: documentation(supportTicketDetailSchema) })
  async detail(@Req() req: Request, @Param('orgId') orgId: string, @Param('ticketId') id: string) {
    const scope = await this.identity.scope(req, parse(z.uuid(), orgId), true);
    return this.support.companyDetail(scope, parse(z.uuid(), id));
  }

  @Post()
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 201, schema: documentation(supportTicketDetailSchema) })
  async open(@Req() req: Request, @Param('orgId') orgId: string, @Body() body: unknown) {
    this.identity.assertOrigin(req);
    const scope = await this.identity.scope(req, parse(z.uuid(), orgId), true);
    return this.support.open(scope, parse(createSupportTicketSchema, body));
  }
}

@Controller('platform/support-tickets')
@ApiTags('Platform support')
@ApiCookieAuth(SESSION_COOKIE)
export class PlatformSupportController {
  constructor(
    private readonly identity: IdentityService,
    private readonly support: SupportService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, schema: documentation(supportTicketListSchema) })
  async list(@Req() req: Request, @Query() query: unknown) {
    const session = await this.identity.authenticate(req);
    return this.support.platformList(
      session.userId,
      parse(platformSupportTicketQuerySchema, query),
    );
  }

  @Get('assignees')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, schema: documentation(supportTicketAssigneesSchema) })
  async assignees(@Req() req: Request) {
    const session = await this.identity.authenticate(req);
    return this.support.platformAssignees(session.userId);
  }

  @Get(':ticketId')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, schema: documentation(supportTicketDetailSchema) })
  async detail(@Req() req: Request, @Param('ticketId') id: string) {
    const session = await this.identity.authenticate(req);
    return this.support.platformDetail(session.userId, parse(z.uuid(), id));
  }

  @Patch(':ticketId')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, schema: documentation(supportTicketDetailSchema) })
  async update(@Req() req: Request, @Param('ticketId') id: string, @Body() body: unknown) {
    this.identity.assertOrigin(req);
    const session = await this.identity.authenticate(req);
    return this.support.update(
      session.userId,
      parse(z.uuid(), id),
      parse(updateSupportTicketSchema, body),
    );
  }
}
