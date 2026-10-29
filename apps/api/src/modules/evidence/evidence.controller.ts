import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  Logger,
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
import {
  actionPaginationQuerySchema,
  uploadEvidenceSchema,
  archiveEvidenceSchema,
  evidenceSchema,
  evidenceListSchema,
  evidenceUploadAttemptSchema,
  evidenceUsageSchema,
  reconcileEvidenceUploadSchema,
  retryEvidenceUploadSchema,
  abandonEvidenceUploadSchema,
} from '@renr/contracts';
import type { Request, Response } from 'express';
import type {} from 'multer';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { parse } from '../../http/parse';
import { IdentityService, SESSION_COOKIE } from '../identity/identity.service';
import { documentation } from '../risks/risks.controller';
import { ActionsService } from '../actions/actions.service';
import type { ActionScope } from '../actions/actions.repository';
import { EvidenceService } from './evidence.service';

const evidenceScope = Symbol('evidenceScope');
type EvidenceRequest = Request & { [evidenceScope]: ActionScope };
@Injectable()
export class EvidenceGuard implements CanActivate {
  constructor(
    private readonly identity: IdentityService,
    private readonly actions: ActionsService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<EvidenceRequest>();
    context.switchToHttp().getResponse<Response>().setHeader('Cache-Control', 'private, no-store');
    const write = request.method !== 'GET';
    if (write) this.identity.assertOrigin(request);
    const organizationId = parse(z.uuid(), request.params.orgId);
    const scope = await this.identity.scope(
      request,
      organizationId,
      write && request.method !== 'POST',
    );
    if (request.method === 'POST' && !(await this.identity.capabilities(request)).canManageAccess) {
      await this.identity.requireCapability(request, organizationId, 'EXECUTE_ASSIGNED_ACTIONS');
      await this.identity.assignedActionScope(
        request,
        organizationId,
        await this.actions.assignmentResource(scope, parse(z.uuid(), request.params.actionId)),
      );
    }
    await this.actions.get(scope, parse(z.uuid(), request.params.actionId));
    request[evidenceScope] = scope;
    return true;
  }
}
@Controller('organizations/:orgId/actions/:actionId/evidence')
@ApiTags('Evidence')
@ApiCookieAuth(SESSION_COOKIE)
@ApiResponse({
  status: 400,
  description: 'Invalid attachment fields, extension, MIME or signature.',
})
@ApiResponse({ status: 401, description: 'Session required.' })
@ApiResponse({
  status: 403,
  description:
    'Exact Origin and ADMIN required for archive; ADMIN or explicit assigned executor for upload.',
})
@ApiResponse({ status: 404, description: 'Action/evidence unavailable in active organization.' })
@ApiResponse({
  status: 409,
  description: 'Version conflict, archived evidence or 20 active attachment limit.',
})
@ApiResponse({ status: 413, description: 'Attachment exceeds 5 MiB or multipart limits.' })
@ApiResponse({ status: 503, description: 'Private storage unavailable or disabled.' })
@UseGuards(EvidenceGuard)
export class EvidenceController {
  private readonly logger = new Logger(EvidenceController.name);
  constructor(private readonly evidence: EvidenceService) {}
  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['file', 'description', 'expectedVersion'],
      properties: {
        file: { type: 'string', format: 'binary' },
        description: { type: 'string', minLength: 10, maxLength: 1000 },
        expectedVersion: { type: 'string', pattern: '^[1-9][0-9]*$' },
      },
    },
  })
  @ApiResponse({ status: 201, schema: documentation(evidenceSchema) })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 2, fieldSize: 4096, parts: 3 },
    }),
  )
  upload(
    @Req() request: EvidenceRequest,
    @Param('actionId') actionId: string,
    @Body() body: unknown,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.evidence.upload(
      request[evidenceScope],
      actionId,
      parse(uploadEvidenceSchema, body),
      file,
      request.headers['idempotency-key'] === undefined
        ? undefined
        : parse(z.uuid(), request.headers['idempotency-key']),
    );
  }
  @Get('upload-attempts/:key')
  @ApiResponse({ status: 200, schema: documentation(evidenceUploadAttemptSchema) })
  attempt(
    @Req() request: EvidenceRequest,
    @Param('actionId') actionId: string,
    @Param('key') key: string,
  ) {
    return this.evidence.getAttempt(request[evidenceScope], actionId, parse(z.uuid(), key));
  }
  @Post('upload-attempts/:key/reconcile')
  @ApiBody({ schema: documentation(reconcileEvidenceUploadSchema) })
  @ApiResponse({ status: 201, schema: documentation(evidenceUploadAttemptSchema) })
  reconcile(
    @Req() request: EvidenceRequest,
    @Param('actionId') actionId: string,
    @Param('key') key: string,
    @Body() body: unknown,
  ) {
    return this.evidence.reconcile(
      request[evidenceScope],
      actionId,
      parse(z.uuid(), key),
      parse(reconcileEvidenceUploadSchema, body),
    );
  }
  @Post('upload-attempts/:key/retry')
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, schema: documentation(evidenceUploadAttemptSchema) })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 3, fieldSize: 4096, parts: 4 },
    }),
  )
  retry(
    @Req() request: EvidenceRequest,
    @Param('actionId') actionId: string,
    @Param('key') key: string,
    @Body() body: unknown,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.evidence.retry(
      request[evidenceScope],
      actionId,
      parse(z.uuid(), key),
      parse(retryEvidenceUploadSchema, body),
      file,
    );
  }
  @Post('upload-attempts/:key/abandon')
  @ApiBody({ schema: documentation(abandonEvidenceUploadSchema) })
  @ApiResponse({ status: 201, schema: documentation(evidenceUploadAttemptSchema) })
  abandon(
    @Req() request: EvidenceRequest,
    @Param('actionId') actionId: string,
    @Param('key') key: string,
    @Body() body: unknown,
  ) {
    return this.evidence.abandon(
      request[evidenceScope],
      actionId,
      parse(z.uuid(), key),
      parse(abandonEvidenceUploadSchema, body),
    );
  }
  @Get(':id/usage')
  @ApiResponse({ status: 200, schema: documentation(evidenceUsageSchema) })
  usage(
    @Req() request: EvidenceRequest,
    @Param('actionId') actionId: string,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return this.evidence.usage(
      request[evidenceScope],
      actionId,
      parse(z.uuid(), id),
      parse(actionPaginationQuerySchema, query),
    );
  }
  @Get()
  @ApiResponse({ status: 200, schema: documentation(evidenceListSchema) })
  list(
    @Req() request: EvidenceRequest,
    @Param('actionId') actionId: string,
    @Query() query: unknown,
  ) {
    return this.evidence.list(
      request[evidenceScope],
      actionId,
      parse(actionPaginationQuerySchema, query),
    );
  }
  @Patch(':id')
  @ApiBody({ schema: documentation(archiveEvidenceSchema) })
  @ApiResponse({ status: 200, schema: documentation(evidenceSchema) })
  archive(
    @Req() request: EvidenceRequest,
    @Param('actionId') actionId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.evidence.archive(
      request[evidenceScope],
      actionId,
      parse(z.uuid(), id),
      parse(archiveEvidenceSchema, body),
    );
  }
  @Get(':id/download')
  @ApiResponse({
    status: 200,
    description: 'Private authenticated attachment stream; no object key or signed URL.',
    headers: {
      'Content-Disposition': { schema: { type: 'string' } },
      'X-Content-Type-Options': { schema: { type: 'string' } },
    },
  })
  async download(
    @Req() request: EvidenceRequest,
    @Param('actionId') actionId: string,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { stream, file } = await this.evidence.download(
      request[evidenceScope],
      actionId,
      parse(z.uuid(), id),
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(stream, {
      type: file.mimeType,
      disposition: `attachment; filename="${file.fileName}"`,
      length: file.size,
    })
      .setErrorHandler((_error, wire) => {
        if (wire.destroyed) return;
        if (wire.headersSent) {
          wire.end();
          return;
        }
        response.removeHeader('Content-Length');
        response.removeHeader('Content-Disposition');
        response.setHeader('Content-Type', 'application/json');
        wire.statusCode = 503;
        wire.send(
          JSON.stringify({
            statusCode: 503,
            code: 'SERVICE_UNAVAILABLE',
            message: 'Service unavailable',
            requestId:
              typeof response.locals.requestId === 'string'
                ? response.locals.requestId
                : randomUUID(),
            timestamp: new Date().toISOString(),
          }),
        );
      })
      .setErrorLogger(() => this.logger.error({ message: 'Private attachment stream failed' }));
  }
}
