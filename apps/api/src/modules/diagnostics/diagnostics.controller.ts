import {
  Body,
  CallHandler,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  NestInterceptor,
  Param,
  Post,
  Query,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBody, ApiTags } from '@nestjs/swagger';
import {
  createDiagnosticCycleSchema,
  createParticipationInvitesSchema,
  paginationSchema,
  participationAccessSchema,
  submitDiagnosticResponseSchema,
} from '@renr/contracts';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { parse } from '../../http/parse';
import { IdentityService } from '../identity/identity.service';
import { DiagnosticsService } from './diagnostics.service';

const inviteCodeDocumentation = {
  type: 'string',
  pattern: '^[A-Za-z0-9_-]{43}$',
  description: 'Código de participação enviado somente no corpo; não use URLs.',
};
const uuidDocumentation = { type: 'string', format: 'uuid' };

@Injectable()
export class DiagnosticPrivacyInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    context.switchToHttp().getResponse<Response>().setHeader('Cache-Control', 'private, no-store');
    return next.handle();
  }
}

@Controller()
@ApiTags('Diagnostics')
@UseInterceptors(DiagnosticPrivacyInterceptor)
export class DiagnosticsController {
  constructor(
    private readonly diagnostics: DiagnosticsService,
    private readonly identity: IdentityService,
  ) {}
  private scope(request: Request, orgId: string, write = false) {
    if (write) this.identity.assertOrigin(request);
    return this.identity.scope(request, parse(z.uuid(), orgId), write);
  }
  @Get('organizations/:orgId/diagnostic-instrument')
  async instrument(@Req() request: Request, @Param('orgId') orgId: string) {
    return this.diagnostics.instrument(await this.scope(request, orgId));
  }
  @Get('organizations/:orgId/diagnostic-cycles')
  async list(@Req() request: Request, @Param('orgId') orgId: string, @Query() query: unknown) {
    return this.diagnostics.list(await this.scope(request, orgId), parse(paginationSchema, query));
  }
  @Post('organizations/:orgId/diagnostic-cycles')
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'sectorId', 'instrumentVersionId', 'startsAt', 'endsAt'],
      properties: {
        name: { type: 'string', minLength: 3, maxLength: 120 },
        sectorId: uuidDocumentation,
        instrumentVersionId: uuidDocumentation,
        startsAt: { type: 'string', format: 'date-time' },
        endsAt: { type: 'string', format: 'date-time', description: 'Posterior ao início.' },
      },
    },
  })
  async create(@Req() request: Request, @Param('orgId') orgId: string, @Body() body: unknown) {
    return this.diagnostics.create(
      await this.scope(request, orgId, true),
      parse(createDiagnosticCycleSchema, body),
    );
  }
  @Get('organizations/:orgId/diagnostic-cycles/:id')
  async get(@Req() request: Request, @Param('orgId') orgId: string, @Param('id') id: string) {
    return this.diagnostics.get(await this.scope(request, orgId), parse(z.uuid(), id));
  }
  @Post('organizations/:orgId/diagnostic-cycles/:id/open')
  async open(@Req() request: Request, @Param('orgId') orgId: string, @Param('id') id: string) {
    return this.diagnostics.transition(
      await this.scope(request, orgId, true),
      parse(z.uuid(), id),
      'OPEN',
    );
  }
  @Post('organizations/:orgId/diagnostic-cycles/:id/close')
  async close(@Req() request: Request, @Param('orgId') orgId: string, @Param('id') id: string) {
    return this.diagnostics.transition(
      await this.scope(request, orgId, true),
      parse(z.uuid(), id),
      'CLOSED',
    );
  }
  @Post('organizations/:orgId/diagnostic-cycles/:id/participation-invites')
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        count: { type: 'integer', minimum: 1, maximum: 20, default: 1 },
      },
    },
  })
  async invites(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.diagnostics.invites(
      await this.scope(request, orgId, true),
      parse(z.uuid(), id),
      parse(createParticipationInvitesSchema, body).count,
    );
  }
  @Get('organizations/:orgId/diagnostic-cycles/:id/results')
  async results(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    parse(z.object({}).strict(), query);
    return this.diagnostics.results(await this.scope(request, orgId), parse(z.uuid(), id));
  }
  @Post('participation/instrument')
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['inviteCode'],
      properties: { inviteCode: inviteCodeDocumentation },
    },
  })
  participationInstrument(@Req() request: Request, @Body() body: unknown, @Query() query: unknown) {
    this.diagnostics.rateLimit(request.ip ?? 'unknown');
    parse(z.object({}).strict(), query);
    return this.diagnostics.participationInstrument(
      parse(participationAccessSchema, body).inviteCode,
    );
  }
  @Post('participation/responses')
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['inviteCode', 'instrumentVersionId', 'answers'],
      properties: {
        inviteCode: inviteCodeDocumentation,
        instrumentVersionId: uuidDocumentation,
        answers: {
          type: 'array',
          minItems: 1,
          maxItems: 5,
          description:
            'Inclua cada pergunta obrigatória exatamente uma vez; seleções devem pertencer à pergunta e à versão do ciclo.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['questionId', 'optionIds'],
            properties: {
              questionId: uuidDocumentation,
              optionIds: {
                type: 'array',
                minItems: 1,
                maxItems: 20,
                uniqueItems: true,
                items: uuidDocumentation,
              },
            },
          },
        },
      },
    },
  })
  submit(@Req() request: Request, @Body() body: unknown, @Query() query: unknown) {
    this.diagnostics.rateLimit(request.ip ?? 'unknown');
    parse(z.object({}).strict(), query);
    return this.diagnostics.submit(parse(submitDiagnosticResponseSchema, body));
  }
}
