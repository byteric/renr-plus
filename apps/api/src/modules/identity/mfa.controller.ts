import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import {
  mfaChallengeSchema,
  mfaEnrollmentCancelSchema,
  mfaEnrollmentConfirmedSchema,
  mfaEnrollmentConfirmSchema,
  mfaEnrollmentRequestSchema,
  mfaEnrollmentSchema,
  mfaProofSchema,
  mfaRecoverSchema,
  mfaStatusSchema,
  passwordRecoveryIssueSchema,
  passwordRecoveryIssuedSchema,
  sessionResponseSchema,
} from '@renr/contracts';
import type { Request, Response } from 'express';
import { ENVIRONMENT, type Environment } from '../../config/env';
import { parse } from '../../http/parse';
import { documentation } from '../risks/risks.controller';
import { IdentityService } from './identity.service';
import { clearChallengeCookie, setChallengeCookie, setSessionCookie } from './mfa-cookies';
import { MfaService } from './mfa.service';

@Controller()
export class MfaController {
  constructor(
    private readonly identity: IdentityService,
    private readonly mfa: MfaService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  @Get('auth/mfa')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, schema: documentation(mfaStatusSchema) })
  status(@Req() request: Request) {
    return this.mfa.status(request);
  }

  @Post('auth/mfa/login')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 201, schema: documentation(sessionResponseSchema) })
  async finishLogin(
    @Req() request: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.identity.assertOrigin(request);
    const issued = await this.mfa.finishLogin(request, parse(mfaProofSchema, body));
    setSessionCookie(response, this.environment, issued);
    clearChallengeCookie(response, this.environment);
    return issued.session;
  }

  @Delete('auth/mfa/login')
  @HttpCode(204)
  @Header('Cache-Control', 'private, no-store')
  async cancelLogin(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.identity.assertOrigin(request);
    await this.mfa.cancelLogin(request);
    clearChallengeCookie(response, this.environment);
  }

  @Post('auth/mfa/enrollment')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 201, schema: documentation(mfaEnrollmentSchema) })
  startEnrollment(@Req() request: Request, @Body() body: unknown) {
    this.identity.assertOrigin(request);
    return this.mfa.startEnrollment(request, parse(mfaEnrollmentRequestSchema, body));
  }

  @Post('auth/mfa/enrollment/confirm')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 201, schema: documentation(mfaEnrollmentConfirmedSchema) })
  async confirmEnrollment(
    @Req() request: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.identity.assertOrigin(request);
    const issued = await this.mfa.confirmEnrollment(
      request,
      parse(mfaEnrollmentConfirmSchema, body),
    );
    setSessionCookie(response, this.environment, issued);
    clearChallengeCookie(response, this.environment);
    return { session: issued.session, recoveryCodes: issued.recoveryCodes };
  }

  @Post('auth/mfa/enrollment/cancel')
  @HttpCode(204)
  @Header('Cache-Control', 'private, no-store')
  cancelEnrollment(@Req() request: Request, @Body() body: unknown) {
    this.identity.assertOrigin(request);
    return this.mfa.cancelEnrollment(request, parse(mfaEnrollmentCancelSchema, body).kind);
  }

  @Post('platform/mfa-recoveries')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 201, schema: documentation(passwordRecoveryIssuedSchema) })
  issueRecovery(@Req() request: Request, @Body() body: unknown) {
    this.identity.assertOrigin(request);
    return this.mfa.issueRecovery(request, parse(passwordRecoveryIssueSchema, body));
  }

  @Post('auth/mfa/recover')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 201, schema: documentation(mfaChallengeSchema) })
  async startRecovery(
    @Req() request: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.identity.assertOrigin(request);
    const pending = await this.mfa.startRecovery(parse(mfaRecoverSchema, body));
    setChallengeCookie(request, response, this.environment, pending);
    return pending.challenge;
  }
}
