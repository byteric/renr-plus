import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  commercialContractAccessClientListSchema,
  commercialContractAccessClientsQuerySchema,
  commercialContractAccessDetailSchema,
  commercialRecordContractAccessTransitionSchema,
} from '@renr/contracts';
import type { Request } from 'express';
import { z } from 'zod';
import { parse } from '../../http/parse';
import { IdentityService, SESSION_COOKIE } from '../identity/identity.service';
import { documentation } from '../risks/risks.controller';
import { CommercialContractAccessService } from './commercial-contract-access.service';

const id = z.uuid().transform((value) => value.toLowerCase());

function resolveIdempotencyKey(request: Request, bodyKey?: string): string | null {
  const rawHeader = request.header('idempotency-key');
  const headerKey = rawHeader ? parse(id, rawHeader.trim()) : null;
  const normalizedBody = bodyKey ? bodyKey.toLowerCase() : null;
  if (headerKey && normalizedBody && headerKey !== normalizedBody) {
    throw new BadRequestException('Chave de idempotência divergente entre cabeçalho e corpo.');
  }
  return headerKey ?? normalizedBody;
}

@Controller('platform/commercial/access')
@ApiTags('Commercial Contract Access')
@ApiCookieAuth(SESSION_COOKIE)
@ApiResponse({ status: 401, description: 'Session required.' })
@ApiResponse({ status: 403, description: 'Contractual access grant required.' })
export class CommercialContractAccessController {
  constructor(
    private readonly access: CommercialContractAccessService,
    private readonly identity: IdentityService,
  ) {}

  private async actor(request: Request, write = false) {
    if (write) this.identity.assertOrigin(request);
    return (await this.identity.authenticate(request)).userId;
  }

  @Get('clients')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, schema: documentation(commercialContractAccessClientListSchema) })
  async listClients(@Req() request: Request, @Query() query: unknown) {
    return this.access.listClients(
      await this.actor(request),
      parse(commercialContractAccessClientsQuerySchema, query),
    );
  }

  @Get('clients/:orgId')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, schema: documentation(commercialContractAccessDetailSchema) })
  async findClient(@Req() request: Request, @Param('orgId') orgId: string) {
    return this.access.findClient(await this.actor(request), parse(id, orgId));
  }

  @Post('clients/:orgId/transitions')
  @Header('Cache-Control', 'private, no-store')
  @ApiBody({ schema: documentation(commercialRecordContractAccessTransitionSchema) })
  @ApiResponse({ status: 201, schema: documentation(commercialContractAccessDetailSchema) })
  async recordTransition(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Body() body: unknown,
  ) {
    const actorId = await this.actor(request, true);
    const parsed = parse(commercialRecordContractAccessTransitionSchema, body);
    return this.access.recordTransition(
      actorId,
      parse(id, orgId),
      parsed,
      resolveIdempotencyKey(request, parsed.idempotencyKey),
    );
  }
}
