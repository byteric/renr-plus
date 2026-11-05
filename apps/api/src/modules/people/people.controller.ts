import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import {
  employeeQuerySchema,
  hrPaginationSchema,
  peopleOverviewQuerySchema,
  settlementRequestSchema,
  writeSettlementParametersSchema,
  updateHrProfileSchema,
  writeEmploymentPeriodSchema,
  writeRemunerationSchema,
  writeVacationPeriodSchema,
  hrCivilDateSchema,
} from '@renr/contracts';
import type { Request } from 'express';
import { z } from 'zod';
import { parse } from '../../http/parse';
import { IdentityService } from '../identity/identity.service';
import { PeopleService } from './people.service';
import { PeopleAnalyticsService } from './people-analytics.service';
@Controller('organizations/:orgId')
export class PeopleController {
  constructor(
    private readonly identity: IdentityService,
    private readonly people: PeopleService,
    private readonly analytics: PeopleAnalyticsService,
  ) {}
  private scope(req: Request, orgId: string, write = false) {
    if (write) this.identity.assertOrigin(req);
    return this.identity.scope(req, parse(z.uuid(), orgId), false);
  }
  @Get('people-overview')
  async overview(@Req() req: Request, @Param('orgId') org: string, @Query() query: unknown) {
    return this.analytics.overview(
      await this.scope(req, org),
      parse(peopleOverviewQuerySchema, query),
    );
  }
  @Get('people/employees')
  async employees(@Req() req: Request, @Param('orgId') org: string, @Query() query: unknown) {
    return this.people.employees(await this.scope(req, org), parse(employeeQuerySchema, query));
  }
  @Get('employees/:id/hr-profile')
  async profile(@Req() req: Request, @Param('orgId') org: string, @Param('id') id: string) {
    return this.people.profile(await this.scope(req, org), parse(z.uuid(), id));
  }
  @Put('employees/:id/hr-profile')
  async writeProfile(
    @Req() req: Request,
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.people.writeProfile(
      await this.scope(req, org, true),
      parse(z.uuid(), id),
      parse(updateHrProfileSchema, body),
    );
  }
  @Get('employees/:id/hr-history')
  async history(
    @Req() req: Request,
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return this.people.history(
      await this.scope(req, org),
      parse(z.uuid(), id),
      parse(hrPaginationSchema, query),
    );
  }
  @Get('employees/:id/employment-periods')
  async employment(
    @Req() req: Request,
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return this.people.list(
      await this.scope(req, org),
      parse(z.uuid(), id),
      'employment',
      parse(hrPaginationSchema, query),
    );
  }
  @Post('employees/:id/employment-periods')
  async addEmployment(
    @Req() req: Request,
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.people.writeEmployment(
      await this.scope(req, org, true),
      parse(z.uuid(), id),
      undefined,
      parse(writeEmploymentPeriodSchema, body),
    );
  }
  @Patch('employees/:id/employment-periods/:recordId')
  async editEmployment(
    @Req() req: Request,
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Param('recordId') recordId: string,
    @Body() body: unknown,
  ) {
    return this.people.writeEmployment(
      await this.scope(req, org, true),
      parse(z.uuid(), id),
      parse(z.uuid(), recordId),
      parse(writeEmploymentPeriodSchema, body),
    );
  }
  @Get('employees/:id/remunerations')
  async remunerations(
    @Req() req: Request,
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return this.people.list(
      await this.scope(req, org),
      parse(z.uuid(), id),
      'remuneration',
      parse(hrPaginationSchema, query),
    );
  }
  @Post('employees/:id/remunerations')
  async addRemuneration(
    @Req() req: Request,
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.people.writeRemuneration(
      await this.scope(req, org, true),
      parse(z.uuid(), id),
      undefined,
      parse(writeRemunerationSchema, body),
    );
  }
  @Patch('employees/:id/remunerations/:recordId')
  async editRemuneration(
    @Req() req: Request,
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Param('recordId') recordId: string,
    @Body() body: unknown,
  ) {
    return this.people.writeRemuneration(
      await this.scope(req, org, true),
      parse(z.uuid(), id),
      parse(z.uuid(), recordId),
      parse(writeRemunerationSchema, body),
    );
  }
  @Get('employees/:id/vacation-periods')
  async vacations(
    @Req() req: Request,
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return this.people.list(
      await this.scope(req, org),
      parse(z.uuid(), id),
      'vacation',
      parse(hrPaginationSchema, query),
    );
  }
  @Post('employees/:id/vacation-periods')
  async addVacation(
    @Req() req: Request,
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.people.writeVacation(
      await this.scope(req, org, true),
      parse(z.uuid(), id),
      undefined,
      parse(writeVacationPeriodSchema, body),
    );
  }
  @Patch('employees/:id/vacation-periods/:recordId')
  async editVacation(
    @Req() req: Request,
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Param('recordId') recordId: string,
    @Body() body: unknown,
  ) {
    return this.people.writeVacation(
      await this.scope(req, org, true),
      parse(z.uuid(), id),
      parse(z.uuid(), recordId),
      parse(writeVacationPeriodSchema, body),
    );
  }
  @Post('employees/:id/settlement-preview')
  async settlement(
    @Req() req: Request,
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.people.settlement(
      await this.scope(req, org, true),
      parse(z.uuid(), id),
      parse(settlementRequestSchema, body),
    );
  }
  @Get('employees/:id/settlement-parameters')
  async parameters(
    @Req() req: Request,
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return this.people.settlementParameters(
      await this.scope(req, org),
      parse(z.uuid(), id),
      parse(z.object({ referenceDate: hrCivilDateSchema }).strict(), query).referenceDate,
    );
  }
  @Put('employees/:id/settlement-parameters')
  async saveParameters(
    @Req() req: Request,
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.people.saveSettlementParameters(
      await this.scope(req, org, true),
      parse(z.uuid(), id),
      parse(writeSettlementParametersSchema, body),
    );
  }
}
