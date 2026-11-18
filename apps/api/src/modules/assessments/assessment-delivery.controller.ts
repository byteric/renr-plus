import { Body, Controller, Get, HttpCode, Param, Post, Req, UseInterceptors } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  assessmentInviteDeliveryConfirmationSchema,
  assessmentInviteDeliveryListSchema,
  assessmentInviteDeliverySchema,
  previewAssessmentInviteDeliverySchema,
} from '@renr/contracts';
import type { Request } from 'express';
import { z } from 'zod';
import { parse } from '../../http/parse';
import { DiagnosticPrivacyInterceptor } from '../diagnostics/diagnostics.controller';
import { IdentityService, SESSION_COOKIE } from '../identity/identity.service';
import { documentation } from '../risks/risks.controller';
import { AssessmentDeliveryService } from './assessment-delivery.service';

const uuid = z.uuid();
const emptyConfirmation = z.strictObject({});

@Controller('organizations/:orgId/assessment-cycles/:cycleId/invite-deliveries')
@ApiTags('Assessment invite delivery')
@ApiCookieAuth(SESSION_COOKIE)
@ApiResponse({ status: 400, description: 'Invalid route parameter or request body.' })
@ApiResponse({ status: 401, description: 'Session required.' })
@ApiResponse({ status: 403, description: 'Trusted origin and invitation permission required.' })
@ApiResponse({ status: 404, description: 'Collection or operation outside the authorized scope.' })
@UseInterceptors(DiagnosticPrivacyInterceptor)
export class AssessmentDeliveryController {
  constructor(
    private readonly identity: IdentityService,
    private readonly delivery: AssessmentDeliveryService,
  ) {}

  private scope(request: Request, organizationId: string, mutation = false) {
    if (mutation) this.identity.assertOrigin(request);
    return this.identity.scope(
      request,
      parse(uuid, organizationId),
      true,
      'HR_ASSESSMENT_INVITES_ISSUE',
    );
  }

  @Post('preview')
  @HttpCode(200)
  @ApiBody({ schema: documentation(previewAssessmentInviteDeliverySchema) })
  @ApiOkResponse({ schema: documentation(assessmentInviteDeliverySchema) })
  @ApiResponse({ status: 409, description: 'Collection unavailable or operation key conflicts.' })
  async preview(
    @Req() request: Request,
    @Param('orgId') organizationId: string,
    @Param('cycleId') cycleId: string,
    @Body() body: unknown,
  ) {
    return this.delivery.preview(
      await this.scope(request, organizationId, true),
      parse(uuid, cycleId),
      parse(previewAssessmentInviteDeliverySchema, body),
    );
  }

  @Get()
  @ApiOkResponse({ schema: documentation(assessmentInviteDeliveryListSchema) })
  async list(
    @Req() request: Request,
    @Param('orgId') organizationId: string,
    @Param('cycleId') cycleId: string,
  ) {
    return this.delivery.list(await this.scope(request, organizationId), parse(uuid, cycleId));
  }

  @Get(':operationId')
  @ApiOkResponse({ schema: documentation(assessmentInviteDeliverySchema) })
  async get(
    @Req() request: Request,
    @Param('orgId') organizationId: string,
    @Param('cycleId') cycleId: string,
    @Param('operationId') operationId: string,
  ) {
    return this.delivery.get(
      await this.scope(request, organizationId),
      parse(uuid, cycleId),
      parse(uuid, operationId),
    );
  }

  @Post(':operationId/confirm')
  @HttpCode(200)
  @ApiBody({ schema: documentation(emptyConfirmation) })
  @ApiOkResponse({ schema: documentation(assessmentInviteDeliveryConfirmationSchema) })
  @ApiResponse({
    status: 409,
    description: 'Collection closed or the preview has expired. Consult the operation.',
  })
  async confirm(
    @Req() request: Request,
    @Param('orgId') organizationId: string,
    @Param('cycleId') cycleId: string,
    @Param('operationId') operationId: string,
    @Body() body: unknown,
  ) {
    const scope = await this.scope(request, organizationId, true);
    parse(emptyConfirmation, body);
    return this.delivery.confirm(scope, parse(uuid, cycleId), parse(uuid, operationId));
  }
}
