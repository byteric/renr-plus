import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Header,
  HttpCode,
  Injectable,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  employeeSchema,
  employeeListSchema,
  createEmployeeSchema,
  updateEmployeeSchema,
  employeeQuerySchema,
  employeeImportPreviewSchema,
  employeeImportResultSchema,
  employeeImportVersionSchema,
  employeeBulkUpdateHistoryQuerySchema,
  employeeBulkUpdateHistorySchema,
  employeeBulkUpdatePreviewSchema,
  employeeBulkUpdateResultSchema,
  employeeBulkUpdateStatusSchema,
  employeeBulkUpdateVersionSchema,
  assessmentGroupSchema,
  assessmentGroupListSchema,
  createAssessmentGroupSchema,
  updateAssessmentGroupSchema,
  assessmentGroupQuerySchema,
} from '@renr/contracts';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { parse } from '../../http/parse';
import { IdentityService, SESSION_COOKIE } from '../identity/identity.service';
import { documentation } from '../risks/risks.controller';
import { employeeWorkbookFileLimit } from './employee-workbook';
import { WorkforceService } from './workforce.service';

const importScope = Symbol('employeeImportScope');
type ImportRequest = Request & {
  [importScope]: Awaited<ReturnType<IdentityService['scope']>>;
};
const emptyImportBody = z.object({}).strict();
const confirmImportBody = z.object({ version: employeeImportVersionSchema }).strict();
const confirmBulkUpdateBody = z.object({ version: employeeBulkUpdateVersionSchema }).strict();
const importInterceptor = FileInterceptor('file', {
  limits: { fileSize: employeeWorkbookFileLimit, files: 1, fields: 1, fieldSize: 128, parts: 3 },
});
const workbookUpload = { type: 'string', format: 'binary' } as const;

@Injectable()
class EmployeeImportGuard implements CanActivate {
  constructor(private readonly identity: IdentityService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<ImportRequest>();
    context.switchToHttp().getResponse<Response>().setHeader('Cache-Control', 'private, no-store');
    this.identity.assertOrigin(request);
    request[importScope] = await this.identity.scope(
      request,
      parse(z.uuid(), request.params.orgId),
      true,
    );
    return true;
  }
}

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
  @Post('employees/import/preview')
  @HttpCode(200)
  @UseGuards(EmployeeImportGuard)
  @UseInterceptors(importInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['file'],
      properties: { file: workbookUpload },
    },
  })
  @ApiResponse({ status: 200, schema: documentation(employeeImportPreviewSchema) })
  @ApiResponse({ status: 413, description: 'Workbook exceeds 1 MiB.' })
  previewEmployeeImport(
    @Req() request: ImportRequest,
    @Body() body: unknown,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    parse(emptyImportBody, body);
    return this.workforce.previewEmployeeImport(request[importScope], file);
  }
  @Post('employees/import/confirm')
  @UseGuards(EmployeeImportGuard)
  @UseInterceptors(importInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['file', 'version'],
      properties: { file: workbookUpload, version: documentation(employeeImportVersionSchema) },
    },
  })
  @ApiResponse({ status: 201, schema: documentation(employeeImportResultSchema) })
  @ApiResponse({ status: 413, description: 'Workbook exceeds 1 MiB.' })
  confirmEmployeeImport(
    @Req() request: ImportRequest,
    @Body() body: unknown,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.workforce.confirmEmployeeImport(
      request[importScope],
      file,
      parse(confirmImportBody, body).version,
    );
  }
  @Post('employees/bulk-update/preview')
  @HttpCode(200)
  @UseGuards(EmployeeImportGuard)
  @UseInterceptors(importInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['file'],
      properties: { file: workbookUpload },
    },
  })
  @ApiResponse({ status: 200, schema: documentation(employeeBulkUpdatePreviewSchema) })
  @ApiResponse({ status: 413, description: 'Workbook exceeds 1 MiB.' })
  previewEmployeeBulkUpdate(
    @Req() request: ImportRequest,
    @Body() body: unknown,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    parse(emptyImportBody, body);
    return this.workforce.employeeBulkUpdates.preview(request[importScope], file);
  }
  @Post('employees/bulk-update/confirm')
  @UseGuards(EmployeeImportGuard)
  @UseInterceptors(importInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['file', 'version'],
      properties: { file: workbookUpload, version: documentation(employeeBulkUpdateVersionSchema) },
    },
  })
  @ApiResponse({ status: 201, schema: documentation(employeeBulkUpdateResultSchema) })
  @ApiResponse({ status: 413, description: 'Workbook exceeds 1 MiB.' })
  async confirmEmployeeBulkUpdate(
    @Req() request: ImportRequest,
    @Body() body: unknown,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    const { version } = parse(confirmBulkUpdateBody, body);
    const session = await this.identity.authenticate(request);
    return this.workforce.employeeBulkUpdates.confirm(
      request[importScope],
      session.id,
      file,
      version,
    );
  }
  @Get('employees/bulk-update/:version')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, schema: documentation(employeeBulkUpdateStatusSchema) })
  async employeeBulkUpdateStatus(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('version') version: string,
  ) {
    return this.workforce.employeeBulkUpdates.status(
      await this.scope(request, orgId),
      parse(employeeBulkUpdateVersionSchema, version),
    );
  }
  @Get('employees/:id/bulk-update-history')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, schema: documentation(employeeBulkUpdateHistorySchema) })
  async employeeBulkUpdateHistory(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return this.workforce.employeeBulkUpdates.history(
      await this.scope(request, orgId),
      parse(z.uuid(), id),
      parse(employeeBulkUpdateHistoryQuerySchema, query),
    );
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
