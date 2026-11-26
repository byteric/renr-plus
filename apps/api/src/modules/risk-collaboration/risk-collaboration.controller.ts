import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  archiveRiskContributionAttachmentSchema,
  archiveRiskContributionSchema,
  createRiskContributionSchema,
  riskContributionListSchema,
  riskContributionQuerySchema,
  riskContributionSchema,
  shareRiskContributionSchema,
  updateRiskContributionSchema,
  uploadRiskContributionAttachmentSchema,
} from '@renr/contracts';
import { parse } from '../../http/parse';
import { IdentityService, SESSION_COOKIE } from '../identity/identity.service';
import { documentation, RiskPrivacyInterceptor } from '../risks/risks.controller';
import {
  RiskCollaborationService,
  type UploadedContributionFile,
} from './risk-collaboration.service';

@Injectable()
export class RiskContributionUploadGuard implements CanActivate {
  constructor(
    private readonly identity: IdentityService,
    private readonly service: RiskCollaborationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    this.identity.assertOrigin(request);
    this.service.assertWritesEnabled();
    const orgId = parse(z.uuid(), request.params.orgId);
    const riskId = parse(z.uuid(), request.params.riskId);
    const contributionId = parse(z.uuid(), request.params.contributionId);
    const scope = await this.identity.scope(request, orgId, false, undefined, false);
    await this.service.assertCanUploadAttachment(scope, riskId, contributionId);
    return true;
  }
}

@Controller('organizations/:orgId/risks/:riskId/technical-contributions')
@ApiTags('Risk technical collaboration')
@ApiCookieAuth(SESSION_COOKIE)
@UseInterceptors(RiskPrivacyInterceptor)
@ApiResponse({ status: 400, description: 'Invalid payload, filters or attachment.' })
@ApiResponse({ status: 401, description: 'Session required.' })
@ApiResponse({
  status: 403,
  description: 'Capability required, invalid Origin, suspended contract or writes disabled.',
})
@ApiResponse({ status: 404, description: 'Resource unavailable in active organization or scope.' })
@ApiResponse({ status: 409, description: 'Stale version, archived record or invalid transition.' })
export class RiskCollaborationController {
  constructor(
    private readonly service: RiskCollaborationService,
    private readonly identity: IdentityService,
  ) {}

  private scope(request: Request, orgId: string, write = false) {
    if (write) this.identity.assertOrigin(request);
    return this.identity.scope(request, parse(z.uuid(), orgId), false, undefined, !write);
  }

  @Get()
  @ApiResponse({ status: 200, schema: documentation(riskContributionListSchema) })
  async list(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('riskId') riskId: string,
    @Query() query: unknown,
  ) {
    return this.service.list(
      await this.scope(request, orgId),
      parse(z.uuid(), riskId),
      parse(riskContributionQuerySchema, query),
    );
  }

  @Get(':contributionId')
  @ApiResponse({ status: 200, schema: documentation(riskContributionSchema) })
  async get(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('riskId') riskId: string,
    @Param('contributionId') contributionId: string,
  ) {
    return this.service.get(
      await this.scope(request, orgId),
      parse(z.uuid(), riskId),
      parse(z.uuid(), contributionId),
    );
  }

  @Post()
  @ApiBody({ schema: documentation(createRiskContributionSchema) })
  @ApiResponse({ status: 201, schema: documentation(riskContributionSchema) })
  async create(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('riskId') riskId: string,
    @Body() body: unknown,
  ) {
    const scope = await this.scope(request, orgId, true);
    return this.service.create(
      scope,
      parse(z.uuid(), riskId),
      parse(createRiskContributionSchema, body),
    );
  }

  @Patch(':contributionId')
  @ApiBody({ schema: documentation(updateRiskContributionSchema) })
  @ApiResponse({ status: 200, schema: documentation(riskContributionSchema) })
  async update(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('riskId') riskId: string,
    @Param('contributionId') contributionId: string,
    @Body() body: unknown,
  ) {
    const scope = await this.scope(request, orgId, true);
    return this.service.update(
      scope,
      parse(z.uuid(), riskId),
      parse(z.uuid(), contributionId),
      parse(updateRiskContributionSchema, body),
    );
  }

  @Post(':contributionId/share')
  @ApiBody({ schema: documentation(shareRiskContributionSchema) })
  @ApiResponse({ status: 201, schema: documentation(riskContributionSchema) })
  async share(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('riskId') riskId: string,
    @Param('contributionId') contributionId: string,
    @Body() body: unknown,
  ) {
    const scope = await this.scope(request, orgId, true);
    return this.service.share(
      scope,
      parse(z.uuid(), riskId),
      parse(z.uuid(), contributionId),
      parse(shareRiskContributionSchema, body),
    );
  }

  @Post(':contributionId/archive')
  @ApiBody({ schema: documentation(archiveRiskContributionSchema) })
  @ApiResponse({ status: 201, schema: documentation(riskContributionSchema) })
  async archive(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('riskId') riskId: string,
    @Param('contributionId') contributionId: string,
    @Body() body: unknown,
  ) {
    const scope = await this.scope(request, orgId, true);
    return this.service.archive(
      scope,
      parse(z.uuid(), riskId),
      parse(z.uuid(), contributionId),
      parse(archiveRiskContributionSchema, body),
    );
  }

  @Post(':contributionId/attachments')
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, schema: documentation(riskContributionSchema) })
  @UseGuards(RiskContributionUploadGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      defParamCharset: 'utf8',
      limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 4, fieldSize: 2048 },
    }),
  )
  async uploadAttachment(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('riskId') riskId: string,
    @Param('contributionId') contributionId: string,
    @Body() body: unknown,
    @UploadedFile() file?: UploadedContributionFile,
  ) {
    const scope = await this.scope(request, orgId, true);
    return this.service.uploadAttachment(
      scope,
      parse(z.uuid(), riskId),
      parse(z.uuid(), contributionId),
      parse(uploadRiskContributionAttachmentSchema, body),
      file,
    );
  }

  @Post(':contributionId/attachments/:attachmentId/archive')
  @ApiBody({ schema: documentation(archiveRiskContributionAttachmentSchema) })
  @ApiResponse({ status: 201, schema: documentation(riskContributionSchema) })
  async archiveAttachment(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('riskId') riskId: string,
    @Param('contributionId') contributionId: string,
    @Param('attachmentId') attachmentId: string,
    @Body() body: unknown,
  ) {
    const scope = await this.scope(request, orgId, true);
    return this.service.archiveAttachment(
      scope,
      parse(z.uuid(), riskId),
      parse(z.uuid(), contributionId),
      parse(z.uuid(), attachmentId),
      parse(archiveRiskContributionAttachmentSchema, body),
    );
  }

  @Get(':contributionId/attachments/:attachmentId/download')
  @ApiResponse({ status: 200, description: 'Private technical contribution attachment bytes.' })
  async downloadAttachment(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('riskId') riskId: string,
    @Param('contributionId') contributionId: string,
    @Param('attachmentId') attachmentId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const scope = await this.scope(request, orgId, false);
    const { stream, fileName, mimeType, size } = await this.service.downloadAttachment(
      scope,
      parse(z.uuid(), riskId),
      parse(z.uuid(), contributionId),
      parse(z.uuid(), attachmentId),
    );
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Type', mimeType);
    response.setHeader('Content-Length', String(size));
    const encoded = encodeURIComponent(fileName);
    const asciiFallback = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`,
    );
    return new StreamableFile(stream);
  }
}
