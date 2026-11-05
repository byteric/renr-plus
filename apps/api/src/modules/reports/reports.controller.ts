import { Body, Controller, Get, Param, Post, Query, Req, StreamableFile } from '@nestjs/common';
import {
  createPlatformReportSchema,
  createTenantReportSchema,
  reportQuerySchema,
} from '@renr/contracts';
import type { Request } from 'express';
import { z } from 'zod';
import { parse } from '../../http/parse';
import { IdentityService } from '../identity/identity.service';
import { ReportsService } from './reports.service';

@Controller()
export class ReportsController {
  constructor(
    private readonly identity: IdentityService,
    private readonly reports: ReportsService,
  ) {}

  private tenant(request: Request, orgId: string) {
    return this.identity.scope(request, parse(z.uuid(), orgId), false);
  }

  @Get('organizations/:orgId/reports')
  async list(@Req() request: Request, @Param('orgId') orgId: string, @Query() query: unknown) {
    const scope = await this.tenant(request, orgId);
    return this.reports.list(scope.userId, scope.organizationId, parse(reportQuerySchema, query));
  }

  @Post('organizations/:orgId/reports')
  async create(@Req() request: Request, @Param('orgId') orgId: string, @Body() body: unknown) {
    this.identity.assertOrigin(request);
    const scope = await this.tenant(request, orgId);
    return this.reports.create(scope, parse(createTenantReportSchema, body));
  }

  @Get('organizations/:orgId/reports/:id')
  async read(@Req() request: Request, @Param('orgId') orgId: string, @Param('id') id: string) {
    const scope = await this.tenant(request, orgId);
    return this.reports.read(scope.userId, scope.organizationId, parse(z.uuid(), id));
  }

  @Get('organizations/:orgId/reports/:id/pdf')
  async download(@Req() request: Request, @Param('orgId') orgId: string, @Param('id') id: string) {
    const scope = await this.tenant(request, orgId);
    const reportId = parse(z.uuid(), id);
    const bytes = await this.reports.pdf(scope.userId, scope.organizationId, reportId);
    await this.tenant(request, orgId);
    return this.file(reportId, bytes);
  }

  @Get('platform/reports')
  async platformList(@Req() request: Request, @Query() query: unknown) {
    const session = await this.identity.authenticate(request);
    return this.reports.list(session.userId, null, parse(reportQuerySchema, query));
  }

  @Post('platform/reports')
  async platformCreate(@Req() request: Request, @Body() body: unknown) {
    this.identity.assertOrigin(request);
    const session = await this.identity.authenticate(request);
    return this.reports.createPlatform(session.userId, parse(createPlatformReportSchema, body));
  }

  @Get('platform/reports/:id')
  async platformRead(@Req() request: Request, @Param('id') id: string) {
    const session = await this.identity.authenticate(request);
    return this.reports.read(session.userId, null, parse(z.uuid(), id));
  }

  @Get('platform/reports/:id/pdf')
  async platformDownload(@Req() request: Request, @Param('id') id: string) {
    const session = await this.identity.authenticate(request);
    const reportId = parse(z.uuid(), id);
    const bytes = await this.reports.pdf(session.userId, null, reportId);
    await this.identity.authenticate(request);
    return this.file(reportId, bytes);
  }

  private file(reportId: string, bytes: Buffer) {
    return new StreamableFile(bytes, {
      type: 'application/pdf',
      disposition: `attachment; filename="ReNR_relatorio_${reportId}.pdf"`,
      length: bytes.length,
    });
  }
}
