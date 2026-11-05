import { Body, Controller, Get, Param, Patch, Put, Query, Req } from '@nestjs/common';
import {
  hrPaginationSchema,
  platformQuerySchema,
  writeClientRegistrationSchema,
  writePlatformGrantSchema,
} from '@renr/contracts';
import type { Request } from 'express';
import { z } from 'zod';
import { parse } from '../../http/parse';
import { IdentityService } from '../identity/identity.service';
import { PlatformService } from './platform.service';
@Controller()
export class PlatformController {
  constructor(
    private readonly platform: PlatformService,
    private readonly identity: IdentityService,
  ) {}
  @Get('platform/capabilities')
  async capabilities(@Req() req: Request) {
    return this.platform.capabilities((await this.identity.authenticate(req)).userId);
  }
  @Get('platform/overview')
  async overview(@Req() req: Request) {
    return this.platform.overview((await this.identity.authenticate(req)).userId);
  }
  @Get('platform/clients')
  async clients(@Req() req: Request, @Query() query: unknown) {
    const session = await this.identity.authenticate(req);
    return this.platform.clients(session.userId, parse(platformQuerySchema, query));
  }
  @Patch('platform/clients/:id')
  async updateClient(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    this.identity.assertOrigin(req);
    const session = await this.identity.authenticate(req);
    return this.platform.updateClient(
      session.userId,
      parse(z.uuid(), id),
      parse(writeClientRegistrationSchema, body),
    );
  }
  @Get('platform/grants')
  async grants(@Req() req: Request, @Query() query: unknown) {
    const session = await this.identity.authenticate(req);
    return this.platform.grants(session.userId, parse(hrPaginationSchema, query));
  }
  @Put('platform/grants')
  async grant(@Req() req: Request, @Body() body: unknown) {
    this.identity.assertOrigin(req);
    const session = await this.identity.authenticate(req);
    return this.platform.writeGrant(session.userId, parse(writePlatformGrantSchema, body));
  }
  @Get('organizations/:id/client-registration')
  async registration(@Req() req: Request, @Param('id') id: string) {
    return this.platform.registration(await this.identity.scope(req, parse(z.uuid(), id), false));
  }
}
