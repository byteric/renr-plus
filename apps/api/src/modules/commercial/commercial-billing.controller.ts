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
  commercialBillingChargeDetailSchema,
  commercialBillingChargeListSchema,
  commercialBillingChargesQuerySchema,
  commercialBillingContractListSchema,
  commercialBillingContractsQuerySchema,
  commercialConfirmBillingPaymentSchema,
  commercialCorrectBillingChargeSchema,
  commercialCreateBillingChargeSchema,
} from '@renr/contracts';
import type { Request } from 'express';
import { z } from 'zod';
import { parse } from '../../http/parse';
import { IdentityService, SESSION_COOKIE } from '../identity/identity.service';
import { documentation } from '../risks/risks.controller';
import { CommercialBillingService } from './commercial-billing.service';

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

@Controller('platform/commercial/billing')
@ApiTags('Commercial Billing')
@ApiCookieAuth(SESSION_COOKIE)
@ApiResponse({ status: 401, description: 'Session required.' })
@ApiResponse({ status: 403, description: 'Billing grant required.' })
export class CommercialBillingController {
  constructor(
    private readonly billing: CommercialBillingService,
    private readonly identity: IdentityService,
  ) {}

  private async actor(request: Request, write = false) {
    if (write) this.identity.assertOrigin(request);
    return (await this.identity.authenticate(request)).userId;
  }

  @Get('contracts')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, schema: documentation(commercialBillingContractListSchema) })
  async listContracts(@Req() request: Request, @Query() query: unknown) {
    return this.billing.listContracts(
      await this.actor(request),
      parse(commercialBillingContractsQuerySchema, query),
    );
  }

  @Get('charges')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, schema: documentation(commercialBillingChargeListSchema) })
  async listCharges(@Req() request: Request, @Query() query: unknown) {
    return this.billing.listCharges(
      await this.actor(request),
      parse(commercialBillingChargesQuerySchema, query),
    );
  }

  @Get('clients/:orgId/charges/:chargeId')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, schema: documentation(commercialBillingChargeDetailSchema) })
  async findCharge(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('chargeId') chargeId: string,
  ) {
    return this.billing.findCharge(
      await this.actor(request),
      parse(id, orgId),
      parse(id, chargeId),
    );
  }

  @Post('clients/:orgId/contracts/:contractId/charges')
  @Header('Cache-Control', 'private, no-store')
  @ApiBody({ schema: documentation(commercialCreateBillingChargeSchema) })
  @ApiResponse({ status: 201, schema: documentation(commercialBillingChargeDetailSchema) })
  async createCharge(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('contractId') contractId: string,
    @Body() body: unknown,
  ) {
    const actorId = await this.actor(request, true);
    const parsed = parse(commercialCreateBillingChargeSchema, body);
    return this.billing.createCharge(
      actorId,
      parse(id, orgId),
      parse(id, contractId),
      parsed,
      resolveIdempotencyKey(request, parsed.idempotencyKey),
    );
  }

  @Post('clients/:orgId/charges/:chargeId/payment')
  @Header('Cache-Control', 'private, no-store')
  @ApiBody({ schema: documentation(commercialConfirmBillingPaymentSchema) })
  @ApiResponse({ status: 201, schema: documentation(commercialBillingChargeDetailSchema) })
  async confirmPayment(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('chargeId') chargeId: string,
    @Body() body: unknown,
  ) {
    const actorId = await this.actor(request, true);
    const parsed = parse(commercialConfirmBillingPaymentSchema, body);
    return this.billing.confirmPayment(
      actorId,
      parse(id, orgId),
      parse(id, chargeId),
      parsed,
      resolveIdempotencyKey(request, parsed.idempotencyKey),
    );
  }

  @Post('clients/:orgId/charges/:chargeId/corrections')
  @Header('Cache-Control', 'private, no-store')
  @ApiBody({ schema: documentation(commercialCorrectBillingChargeSchema) })
  @ApiResponse({ status: 201, schema: documentation(commercialBillingChargeDetailSchema) })
  async correctCharge(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('chargeId') chargeId: string,
    @Body() body: unknown,
  ) {
    const actorId = await this.actor(request, true);
    const parsed = parse(commercialCorrectBillingChargeSchema, body);
    return this.billing.correctCharge(
      actorId,
      parse(id, orgId),
      parse(id, chargeId),
      parsed,
      resolveIdempotencyKey(request, parsed.idempotencyKey),
    );
  }
}
