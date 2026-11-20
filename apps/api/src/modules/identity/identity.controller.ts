import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import {
  activeOrganizationSchema,
  loginResultSchema,
  loginSchema,
  sessionCapabilitiesSchema,
} from '@renr/contracts';
import { ApiResponse } from '@nestjs/swagger';
import { documentation } from '../risks/risks.controller';
import type { Request, Response } from 'express';
import { ENVIRONMENT, type Environment } from '../../config/env';
import { parse } from '../../http/parse';
import { IdentityService } from './identity.service';
import {
  clearChallengeCookie,
  clearSessionCookie,
  setChallengeCookie,
  setSessionCookie,
} from './mfa-cookies';

@Controller('auth')
export class IdentityController {
  constructor(
    private readonly identity: IdentityService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}
  @Post('sessions')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 201, schema: documentation(loginResultSchema) })
  async login(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.identity.assertOrigin(request);
    const input = parse(loginSchema, body);
    const result = await this.identity.login(input.email, input.password, request.ip ?? 'unknown');
    if ('challenge' in result) {
      setChallengeCookie(request, response, this.environment, result);
      return result.challenge;
    }
    setSessionCookie(response, this.environment, result);
    clearChallengeCookie(response, this.environment);
    return result.session;
  }
  @Get('session') current(@Req() request: Request) {
    return this.identity.current(request);
  }
  @Get('session-capabilities')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, schema: documentation(sessionCapabilitiesSchema) })
  capabilities(@Req() request: Request) {
    return this.identity.capabilities(request);
  }
  @Delete('session')
  @HttpCode(204)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    this.identity.assertOrigin(request);
    await this.identity.logout(request);
    clearSessionCookie(response, this.environment);
    clearChallengeCookie(response, this.environment);
  }
  @Put('session/organization')
  activate(@Body() body: unknown, @Req() request: Request) {
    this.identity.assertOrigin(request);
    return this.identity.activate(request, parse(activeOrganizationSchema, body).organizationId);
  }
}
