import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import { activeOrganizationSchema, loginSchema } from '@renr/contracts';
import type { Request, Response } from 'express';
import { ENVIRONMENT, type Environment } from '../../config/env';
import { parse } from '../../http/parse';
import { IdentityService, SESSION_COOKIE } from './identity.service';

@Controller('auth')
export class IdentityController {
  constructor(
    private readonly identity: IdentityService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}
  @Post('sessions')
  async login(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.identity.assertOrigin(request);
    const input = parse(loginSchema, body);
    const result = await this.identity.login(input.email, input.password, request.ip ?? 'unknown');
    response.cookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.environment.NODE_ENV === 'production',
      path: '/api/v1',
      expires: new Date(result.session.expiresAt),
    });
    return result.session;
  }
  @Get('session') current(@Req() request: Request) {
    return this.identity.current(request);
  }
  @Delete('session')
  @HttpCode(204)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    this.identity.assertOrigin(request);
    await this.identity.logout(request);
    response.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.environment.NODE_ENV === 'production',
      path: '/api/v1',
    });
  }
  @Put('session/organization')
  activate(@Body() body: unknown, @Req() request: Request) {
    this.identity.assertOrigin(request);
    return this.identity.activate(request, parse(activeOrganizationSchema, body).organizationId);
  }
}
