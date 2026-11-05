import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import { ApiCookieAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Request } from 'express';
import {
  auditEventListSchema,
  auditListQuerySchema,
  auditHistoryQuerySchema,
  auditRecordSchema,
  auditTargetKindSchema,
} from '@renr/contracts';
import { parse } from '../../http/parse';
import { IdentityService, SESSION_COOKIE } from '../identity/identity.service';
import { documentation, RiskPrivacyInterceptor } from '../risks/risks.controller';
import { AuditService } from './audit.service';

@Controller('organizations/:orgId')
@ApiTags('Audit and history')
@ApiCookieAuth(SESSION_COOKIE)
@UseInterceptors(RiskPrivacyInterceptor)
@ApiResponse({ status: 400, description: 'Invalid strict filters or identifier.' })
@ApiResponse({ status: 401, description: 'Session required.' })
@ApiResponse({ status: 403, description: 'Administrator required for audit and access records.' })
@ApiResponse({ status: 404, description: 'Resource unavailable in active organization.' })
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly identity: IdentityService,
  ) {}
  @Get('audit-events')
  @ApiResponse({ status: 200, schema: documentation(auditEventListSchema) })
  async list(@Req() request: Request, @Param('orgId') orgId: string, @Query() query: unknown) {
    return this.audit.list(
      await this.identity.scope(request, parse(z.uuid(), orgId), true),
      parse(auditListQuerySchema, query),
    );
  }
  @Get('risks/:id/history')
  @ApiResponse({ status: 200, schema: documentation(auditEventListSchema) })
  async risk(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return this.audit.history(
      await this.identity.scope(request, parse(z.uuid(), orgId), false),
      'risk',
      parse(z.uuid(), id),
      parse(auditHistoryQuerySchema, query),
    );
  }
  @Get('actions/:id/history')
  @ApiResponse({ status: 200, schema: documentation(auditEventListSchema) })
  async action(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return this.audit.history(
      await this.identity.scope(request, parse(z.uuid(), orgId), false),
      'action',
      parse(z.uuid(), id),
      parse(auditHistoryQuerySchema, query),
    );
  }
  @Get('history-records/:kind/:id')
  @ApiResponse({ status: 200, schema: documentation(auditRecordSchema) })
  async record(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    const scope = await this.identity.scope(request, parse(z.uuid(), orgId), false);
    parse(z.object({}).strict(), query);
    const parsedKind = auditTargetKindSchema.safeParse(kind);
    if (!parsedKind.success) {
      throw new NotFoundException();
    }
    return this.audit.record(scope, parsedKind.data, parse(z.uuid(), id));
  }
}
