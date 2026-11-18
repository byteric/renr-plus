import { Controller, Get, Param, Query, Req, UseInterceptors } from '@nestjs/common';
import { ApiCookieAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { assessmentComparisonQuerySchema, assessmentComparisonSchema } from '@renr/contracts';
import type { Request } from 'express';
import { z } from 'zod';
import { parse } from '../../http/parse';
import { DiagnosticPrivacyInterceptor } from '../diagnostics/diagnostics.controller';
import { IdentityService, SESSION_COOKIE } from '../identity/identity.service';
import { documentation } from '../risks/risks.controller';
import { AssessmentComparisonService } from './assessment-comparison.service';

@Controller('organizations/:orgId/assessment-comparison')
@ApiTags('Assessment comparison')
@ApiCookieAuth(SESSION_COOKIE)
@UseInterceptors(DiagnosticPrivacyInterceptor)
export class AssessmentComparisonController {
  constructor(
    private readonly service: AssessmentComparisonService,
    private readonly identity: IdentityService,
  ) {}

  @Get()
  @ApiResponse({ status: 200, schema: documentation(assessmentComparisonSchema) })
  @ApiResponse({ status: 404, description: 'Cycle missing or outside the active scope.' })
  async compare(
    @Req() request: Request,
    @Param('orgId') organizationId: string,
    @Query() query: unknown,
  ) {
    const scope = await this.identity.scope(
      request,
      parse(z.uuid(), organizationId),
      false,
      undefined,
      true,
    );
    return this.service.compare(scope, parse(assessmentComparisonQuerySchema, query));
  }
}
