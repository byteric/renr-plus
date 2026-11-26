import { Body, Controller, Header, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import {
  passwordRecoveryConfirmSchema,
  passwordRecoveryIssueSchema,
  passwordRecoveryRequestSchema,
  passwordRecoveryTokenSchema,
} from '@renr/contracts';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ENVIRONMENT, type Environment } from '../../config/env';
import { parse } from '../../http/parse';
import { IdentityService, SESSION_COOKIE } from './identity.service';
import { PasswordRecoveryService } from './password-recovery.service';

@Controller()
export class PasswordRecoveryController {
  constructor(
    private readonly identity: IdentityService,
    private readonly recovery: PasswordRecoveryService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  @Post('auth/recovery/requests')
  @HttpCode(202)
  @Header('Cache-Control', 'private, no-store')
  guidance(@Req() request: Request, @Body() body: unknown) {
    this.identity.assertOrigin(request);
    parse(passwordRecoveryRequestSchema, body);
    return this.recovery.guidance(request.ip ?? 'unknown');
  }

  @Post('auth/recovery/status')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  status(@Req() request: Request, @Body() body: unknown) {
    this.identity.assertOrigin(request);
    const { token } = parse(passwordRecoveryTokenSchema, body);
    return this.recovery.status(request.ip ?? 'unknown', token);
  }

  @Post('auth/recovery/confirm')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async confirm(
    @Req() request: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.identity.assertOrigin(request);
    const { token, password } = parse(passwordRecoveryConfirmSchema, body);
    const result = await this.recovery.confirm(request.ip ?? 'unknown', token, password);
    response.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.environment.NODE_ENV === 'production',
      path: '/api/v1',
    });
    return result;
  }

  @Post('organizations/:orgId/password-recoveries')
  @Header('Cache-Control', 'private, no-store')
  async issueCompany(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Body() body: unknown,
  ) {
    this.identity.assertOrigin(request);
    const scope = await this.identity.scope(request, parse(z.uuid(), orgId), true);
    const session = await this.identity.authenticate(request);
    return this.recovery.issue(
      session,
      scope.organizationId,
      parse(passwordRecoveryIssueSchema, body),
    );
  }

  @Post('platform/password-recoveries')
  @Header('Cache-Control', 'private, no-store')
  async issueGlobal(@Req() request: Request, @Body() body: unknown) {
    this.identity.assertOrigin(request);
    const session = await this.identity.authenticate(request);
    return this.recovery.issue(session, null, parse(passwordRecoveryIssueSchema, body));
  }
}
