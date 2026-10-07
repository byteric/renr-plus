import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  createOrganizationSchema,
  createSectorSchema,
  createUnitSchema,
  paginationSchema,
  updateOrganizationSchema,
  updateSectorSchema,
  updateUnitSchema,
} from '@renr/contracts';
import type { Request } from 'express';
import { z } from 'zod';
import { parse } from '../../http/parse';
import { IdentityService } from '../identity/identity.service';
import { OrganizationsService } from './organizations.service';

@Controller()
export class OrganizationsController {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly identity: IdentityService,
  ) {}
  private async childScope(request: Request, id: string, kind: 'unit' | 'sector') {
    const scope = await this.identity.scope(request, undefined, false);
    if (kind === 'unit') await this.organizations.requireUnit(scope, id);
    else await this.organizations.requireSector(scope, id);
    return this.identity.scope(request, undefined, true);
  }
  @Get('organizations')
  async list(@Req() request: Request, @Query() query: unknown) {
    return this.organizations.organizations(
      (await this.identity.authenticate(request)).userId,
      parse(paginationSchema, query),
    );
  }
  @Post('organizations')
  async create(@Req() request: Request, @Body() body: unknown) {
    this.identity.assertOrigin(request);
    const session = await this.identity.authenticate(request);
    await this.identity.scope(request, undefined, true);
    return this.organizations.createOrganization(
      session.userId,
      parse(createOrganizationSchema, body),
    );
  }
  @Patch('organizations/:id')
  async update(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    this.identity.assertOrigin(request);
    return this.organizations.updateOrganization(
      await this.identity.scope(request, parse(z.uuid(), id), true),
      parse(updateOrganizationSchema, body),
    );
  }
  @Get('organizations/:id/units')
  async units(@Req() request: Request, @Param('id') id: string, @Query() query: unknown) {
    return this.organizations.units(
      await this.identity.scope(request, parse(z.uuid(), id), false),
      parse(paginationSchema, query),
    );
  }
  @Post('organizations/:id/units')
  async createUnit(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    this.identity.assertOrigin(request);
    return this.organizations.createUnit(
      await this.identity.scope(request, parse(z.uuid(), id), true),
      parse(createUnitSchema, body),
    );
  }
  @Patch('units/:id')
  async updateUnit(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    this.identity.assertOrigin(request);
    return this.organizations.updateUnit(
      await this.childScope(request, parse(z.uuid(), id), 'unit'),
      parse(z.uuid(), id),
      parse(updateUnitSchema, body),
    );
  }
  @Get('units/:id/sectors')
  async sectors(@Req() request: Request, @Param('id') id: string, @Query() query: unknown) {
    return this.organizations.sectors(
      await this.identity.scope(request, undefined, false),
      parse(z.uuid(), id),
      parse(paginationSchema, query),
    );
  }
  @Post('units/:id/sectors')
  async createSector(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    this.identity.assertOrigin(request);
    return this.organizations.createSector(
      await this.childScope(request, parse(z.uuid(), id), 'unit'),
      parse(z.uuid(), id),
      parse(createSectorSchema, body),
    );
  }
  @Patch('sectors/:id')
  async updateSector(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    this.identity.assertOrigin(request);
    return this.organizations.updateSector(
      await this.childScope(request, parse(z.uuid(), id), 'sector'),
      parse(z.uuid(), id),
      parse(updateSectorSchema, body),
    );
  }
}
