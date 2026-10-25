import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  createInstrumentSchema,
  createdInstrumentSchema,
  instrumentSchema,
  instrumentListSchema,
  instrumentQuerySchema,
  instrumentVersionSchema,
  instrumentVersionListSchema,
  updateInstrumentDraftSchema,
  publishInstrumentSchema,
  forkInstrumentVersionSchema,
} from '@renr/contracts';
import type { Request } from 'express';
import { z } from 'zod';
import { parse } from '../../http/parse';
import { IdentityService, SESSION_COOKIE } from '../identity/identity.service';
import { documentation } from '../risks/risks.controller';
import { InstrumentsService } from './instruments.service';

@Controller('organizations/:orgId/instruments')
@ApiTags('Instrument catalog')
@ApiCookieAuth(SESSION_COOKIE)
@ApiResponse({
  status: 400,
  description: 'Invalid strict input or incomplete publication; field details provided',
})
@ApiResponse({ status: 401, description: 'Session required' })
@ApiResponse({
  status: 403,
  description:
    'ADMIN for editing/demo publication; TECHNICAL_DECISIONS for real publication; trusted Origin on mutations',
})
@ApiResponse({ status: 404, description: 'Resource unavailable in active organization' })
@ApiResponse({
  status: 409,
  description: 'Stale revision, immutable published content or invalid source status',
})
export class InstrumentsController {
  constructor(
    private readonly instruments: InstrumentsService,
    private readonly identity: IdentityService,
  ) {}
  private scope(request: Request, orgId: string, admin = false, mutation = false) {
    if (mutation) this.identity.assertOrigin(request);
    return this.identity.scope(request, parse(z.uuid(), orgId), admin);
  }
  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, schema: documentation(instrumentListSchema) })
  async list(@Req() request: Request, @Param('orgId') orgId: string, @Query() query: unknown) {
    return this.instruments.list(
      await this.scope(request, orgId),
      parse(instrumentQuerySchema, query),
    );
  }
  @Post()
  @Header('Cache-Control', 'private, no-store')
  @ApiBody({ schema: documentation(createInstrumentSchema) })
  @ApiResponse({ status: 201, schema: documentation(createdInstrumentSchema) })
  async create(@Req() request: Request, @Param('orgId') orgId: string, @Body() body: unknown) {
    return this.instruments.create(
      await this.scope(request, orgId, true, true),
      parse(createInstrumentSchema, body).name,
    );
  }
  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, schema: documentation(instrumentSchema) })
  async get(@Req() request: Request, @Param('orgId') orgId: string, @Param('id') id: string) {
    return this.instruments.get(await this.scope(request, orgId), parse(z.uuid(), id));
  }
  @Get(':id/versions')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, schema: documentation(instrumentVersionListSchema) })
  async versions(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return this.instruments.versions(
      await this.scope(request, orgId),
      parse(z.uuid(), id),
      parse(instrumentQuerySchema, query),
    );
  }
  @Get(':id/versions/:versionId')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, schema: documentation(instrumentVersionSchema) })
  async version(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ) {
    return this.instruments.getVersion(
      await this.scope(request, orgId),
      parse(z.uuid(), id),
      parse(z.uuid(), versionId),
    );
  }
  @Put(':id/versions/:versionId')
  @Header('Cache-Control', 'private, no-store')
  @ApiBody({ schema: documentation(updateInstrumentDraftSchema) })
  @ApiResponse({ status: 200, schema: documentation(instrumentVersionSchema) })
  async update(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Body() body: unknown,
  ) {
    return this.instruments.update(
      await this.scope(request, orgId, true, true),
      parse(z.uuid(), id),
      parse(z.uuid(), versionId),
      parse(updateInstrumentDraftSchema, body),
    );
  }
  @Post(':id/versions/:versionId/publish')
  @Header('Cache-Control', 'private, no-store')
  @ApiBody({ schema: documentation(publishInstrumentSchema) })
  @ApiResponse({ status: 201, schema: documentation(instrumentVersionSchema) })
  async publish(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Body() body: unknown,
  ) {
    const scope = await this.scope(request, orgId, false, true);
    const capabilities = await this.identity.capabilities(request);
    if (capabilities.organizationId !== scope.organizationId) throw new ForbiddenException();
    return this.instruments.publish(
      scope,
      parse(z.uuid(), id),
      parse(z.uuid(), versionId),
      parse(publishInstrumentSchema, body),
      {
        admin: capabilities.canManageAccess,
        technical: capabilities.capabilities.includes('TECHNICAL_DECISIONS'),
      },
    );
  }
  @Post(':id/versions/:versionId/fork')
  @Header('Cache-Control', 'private, no-store')
  @ApiBody({ schema: documentation(forkInstrumentVersionSchema) })
  @ApiResponse({ status: 201, schema: documentation(instrumentVersionSchema) })
  async fork(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Body() body: unknown,
  ) {
    return this.instruments.fork(
      await this.scope(request, orgId, true, true),
      parse(z.uuid(), id),
      parse(z.uuid(), versionId),
      parse(forkInstrumentVersionSchema, body).expectedRevision,
    );
  }
}
