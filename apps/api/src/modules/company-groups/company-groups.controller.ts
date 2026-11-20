import { Body, Controller, Get, Header, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import {
  companyGroupEligibleClientQuerySchema,
  companyGroupOverviewQuerySchema,
  createCompanyGroupSchema,
  hrPaginationSchema,
  updateCompanyGroupSchema,
  writeCompanyGroupGrantSchema,
} from '@renr/contracts';
import type { Request } from 'express';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import { parse } from '../../http/parse';
import { IdentityService } from '../identity/identity.service';
import { lockMfaAccount } from '../identity/mfa-security';
import { CompanyGroupsService } from './company-groups.service';

const idSchema = z.uuid().transform((value) => value.toLowerCase());

@Controller()
export class CompanyGroupsController {
  constructor(
    private readonly groups: CompanyGroupsService,
    private readonly identity: IdentityService,
  ) {}

  @Get('company-groups')
  @Header('Cache-Control', 'private, no-store')
  async list(@Req() request: Request) {
    return this.groups.list((await this.identity.authenticate(request)).userId);
  }

  @Get('company-groups/:id')
  @Header('Cache-Control', 'private, no-store')
  async overview(@Req() request: Request, @Param('id') id: string, @Query() query: unknown) {
    const { userId } = await this.identity.authenticate(request);
    return this.groups.overview(
      userId,
      parse(idSchema, id),
      parse(companyGroupOverviewQuerySchema, query),
    );
  }

  @Get('platform/company-groups')
  @Header('Cache-Control', 'private, no-store')
  async management(@Req() request: Request, @Query() query: unknown) {
    const { userId } = await this.identity.authenticate(request);
    return this.groups.management(
      userId,
      parse(hrPaginationSchema, query),
      this.verifySession(request),
    );
  }

  @Get('platform/company-groups/eligible-clients')
  @Header('Cache-Control', 'private, no-store')
  async eligibleClients(@Req() request: Request, @Query() query: unknown) {
    const { userId } = await this.identity.authenticate(request);
    return this.groups.eligibleClients(userId, parse(companyGroupEligibleClientQuerySchema, query));
  }

  @Post('platform/company-groups')
  async create(@Req() request: Request, @Body() body: unknown) {
    this.identity.assertOrigin(request);
    const { userId } = await this.identity.authenticate(request);
    return this.groups.create(userId, parse(createCompanyGroupSchema, body));
  }

  @Patch('platform/company-groups/:id')
  async update(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    this.identity.assertOrigin(request);
    const { userId } = await this.identity.authenticate(request);
    return this.groups.update(userId, parse(idSchema, id), parse(updateCompanyGroupSchema, body));
  }

  @Get('platform/company-groups/:id/grants')
  @Header('Cache-Control', 'private, no-store')
  async grants(@Req() request: Request, @Param('id') id: string, @Query() query: unknown) {
    const { userId } = await this.identity.authenticate(request);
    return this.groups.grants(
      userId,
      parse(idSchema, id),
      parse(hrPaginationSchema, query),
      this.verifySession(request),
    );
  }

  @Put('platform/company-groups/:id/grants')
  async writeGrant(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    this.identity.assertOrigin(request);
    const { userId } = await this.identity.authenticate(request);
    return this.groups.writeGrant(
      userId,
      parse(idSchema, id),
      parse(writeCompanyGroupGrantSchema, body),
      this.verifySession(request, userId),
    );
  }

  private verifySession(request: Request, lockUserId?: string) {
    return async (tx: Prisma.TransactionClient): Promise<void> => {
      if (lockUserId) await lockMfaAccount(tx, lockUserId);
      await this.identity.authenticate(request, tx);
    };
  }
}
