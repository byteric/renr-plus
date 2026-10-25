import { Body, Controller, Get, Header, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  employeeSchema,
  employeeListSchema,
  createEmployeeSchema,
  updateEmployeeSchema,
  employeeQuerySchema,
  assessmentGroupSchema,
  assessmentGroupListSchema,
  createAssessmentGroupSchema,
  updateAssessmentGroupSchema,
  assessmentGroupQuerySchema,
} from '@renr/contracts';
import type { Request } from 'express';
import { z } from 'zod';
import { parse } from '../../http/parse';
import { IdentityService, SESSION_COOKIE } from '../identity/identity.service';
import { documentation } from '../risks/risks.controller';
import { WorkforceService } from './workforce.service';
@Controller('organizations/:orgId')
@ApiTags('Workforce and assessment groups')
@ApiCookieAuth(SESSION_COOKIE)
@ApiResponse({ status: 400, description: 'Invalid strict input' })
@ApiResponse({ status: 401, description: 'Session required' })
@ApiResponse({ status: 403, description: 'ADMIN required; mutations require trusted Origin' })
@ApiResponse({ status: 404, description: 'Resource unavailable in this organization' })
@ApiResponse({
  status: 409,
  description: 'Duplicate identifier/sector, inactive structure or stale version',
})
export class WorkforceController {
  constructor(
    private readonly workforce: WorkforceService,
    private readonly identity: IdentityService,
  ) {}
  private scope(request: Request, orgId: string, write = false) {
    if (write) this.identity.assertOrigin(request);
    return this.identity.scope(request, parse(z.uuid(), orgId), true);
  }
  @Get('employees')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, schema: documentation(employeeListSchema) })
  async employees(@Req() request: Request, @Param('orgId') orgId: string, @Query() query: unknown) {
    return this.workforce.employees(
      await this.scope(request, orgId),
      parse(employeeQuerySchema, query),
    );
  }
  @Get('employees/:id')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, schema: documentation(employeeSchema) })
  async employee(@Req() request: Request, @Param('orgId') orgId: string, @Param('id') id: string) {
    return this.workforce.employee(await this.scope(request, orgId), parse(z.uuid(), id));
  }
  @Post('employees')
  @Header('Cache-Control', 'private, no-store')
  @ApiBody({ schema: documentation(createEmployeeSchema) })
  @ApiResponse({ status: 201, schema: documentation(employeeSchema) })
  async createEmployee(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Body() body: unknown,
  ) {
    return this.workforce.createEmployee(
      await this.scope(request, orgId, true),
      parse(createEmployeeSchema, body),
    );
  }
  @Patch('employees/:id')
  @Header('Cache-Control', 'private, no-store')
  @ApiBody({ schema: documentation(updateEmployeeSchema) })
  @ApiResponse({ status: 200, schema: documentation(employeeSchema) })
  async updateEmployee(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.workforce.updateEmployee(
      await this.scope(request, orgId, true),
      parse(z.uuid(), id),
      parse(updateEmployeeSchema, body),
    );
  }
  @Get('assessment-groups')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, schema: documentation(assessmentGroupListSchema) })
  async groups(@Req() request: Request, @Param('orgId') orgId: string, @Query() query: unknown) {
    return this.workforce.groups(
      await this.scope(request, orgId),
      parse(assessmentGroupQuerySchema, query),
    );
  }
  @Get('assessment-groups/:id')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, schema: documentation(assessmentGroupSchema) })
  async group(@Req() request: Request, @Param('orgId') orgId: string, @Param('id') id: string) {
    return this.workforce.group(await this.scope(request, orgId), parse(z.uuid(), id));
  }
  @Post('assessment-groups')
  @Header('Cache-Control', 'private, no-store')
  @ApiBody({ schema: documentation(createAssessmentGroupSchema) })
  @ApiResponse({ status: 201, schema: documentation(assessmentGroupSchema) })
  async createGroup(@Req() request: Request, @Param('orgId') orgId: string, @Body() body: unknown) {
    return this.workforce.createGroup(
      await this.scope(request, orgId, true),
      parse(createAssessmentGroupSchema, body),
    );
  }
  @Patch('assessment-groups/:id')
  @Header('Cache-Control', 'private, no-store')
  @ApiBody({ schema: documentation(updateAssessmentGroupSchema) })
  @ApiResponse({ status: 200, schema: documentation(assessmentGroupSchema) })
  async updateGroup(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.workforce.updateGroup(
      await this.scope(request, orgId, true),
      parse(z.uuid(), id),
      parse(updateAssessmentGroupSchema, body),
    );
  }
}
