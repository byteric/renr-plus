import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Header,
  Injectable,
  Param,
  Patch,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  commercialClientListSchema,
  commercialClientSchema,
  commercialContractResponseSchema,
  commercialContractSchema,
  commercialCreateContractSchema,
  commercialCreatePlanSchema,
  commercialDocumentSchema,
  commercialPlanListSchema,
  commercialPlanSchema,
  commercialReviseContractSchema,
  commercialRevisePlanSchema,
  commercialUpdateClientSchema,
  platformQuerySchema,
} from '@renr/contracts';
import type { Request } from 'express';
import type {} from 'multer';
import { z } from 'zod';
import { parse } from '../../http/parse';
import { IdentityService, SESSION_COOKIE } from '../identity/identity.service';
import { documentation } from '../risks/risks.controller';
import {
  CommercialService,
  commercialDocumentMaxBytes,
  type CommercialDocumentTarget,
} from './commercial.service';

const id = z.uuid().transform((value) => value.toLowerCase());
const documentRoute = 'clients/:orgId/contract/:contractId/revisions/:revisionId/document';
const documentActor = Symbol('commercialDocumentActor');
type UploadRequest = Request & { [documentActor]: string };

function documentTarget(params: Request['params']): CommercialDocumentTarget {
  return {
    organizationId: parse(id, params.orgId),
    contractId: parse(id, params.contractId),
    revisionId: parse(id, params.revisionId),
  };
}

@Injectable()
export class CommercialDocumentUploadGuard implements CanActivate {
  constructor(
    private readonly identity: IdentityService,
    private readonly commercial: CommercialService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<UploadRequest>();
    this.identity.assertOrigin(request);
    const { userId } = await this.identity.authenticate(request);
    await this.commercial.assertDocumentUpload(userId, documentTarget(request.params));
    request[documentActor] = userId;
    return true;
  }
}

@Controller('platform/commercial')
@ApiTags('Commercial')
@ApiCookieAuth(SESSION_COOKIE)
@ApiResponse({ status: 401, description: 'Session required.' })
@ApiResponse({ status: 403, description: 'Commercial grant required.' })
export class CommercialController {
  constructor(
    private readonly commercial: CommercialService,
    private readonly identity: IdentityService,
  ) {}

  private async actor(request: Request, write = false) {
    if (write) this.identity.assertOrigin(request);
    return (await this.identity.authenticate(request)).userId;
  }

  @Get('plans')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, schema: documentation(commercialPlanListSchema) })
  async listPlans(@Req() request: Request) {
    return this.commercial.listPlans(await this.actor(request));
  }

  @Post('plans')
  @Header('Cache-Control', 'private, no-store')
  @ApiBody({ schema: documentation(commercialCreatePlanSchema) })
  @ApiResponse({ status: 201, schema: documentation(commercialPlanSchema) })
  async createPlan(@Req() request: Request, @Body() body: unknown) {
    return this.commercial.createPlan(
      await this.actor(request, true),
      parse(commercialCreatePlanSchema, body),
    );
  }

  @Post('plans/:planId/versions')
  @Header('Cache-Control', 'private, no-store')
  @ApiBody({ schema: documentation(commercialRevisePlanSchema) })
  @ApiResponse({ status: 201, schema: documentation(commercialPlanSchema) })
  async revisePlan(
    @Req() request: Request,
    @Param('planId') planId: string,
    @Body() body: unknown,
  ) {
    return this.commercial.revisePlan(
      await this.actor(request, true),
      parse(id, planId),
      parse(commercialRevisePlanSchema, body),
    );
  }

  @Get('clients')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, schema: documentation(commercialClientListSchema) })
  async listClients(@Req() request: Request, @Query() query: unknown) {
    return this.commercial.listClients(
      await this.actor(request),
      parse(platformQuerySchema, query),
    );
  }

  @Patch('clients/:orgId')
  @Header('Cache-Control', 'private, no-store')
  @ApiBody({ schema: documentation(commercialUpdateClientSchema) })
  @ApiResponse({ status: 200, schema: documentation(commercialClientSchema) })
  async updateClient(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Body() body: unknown,
  ) {
    return this.commercial.updateClient(
      await this.actor(request, true),
      parse(id, orgId),
      parse(commercialUpdateClientSchema, body),
    );
  }

  @Get('clients/:orgId/contract')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, schema: documentation(commercialContractResponseSchema) })
  async findContract(@Req() request: Request, @Param('orgId') orgId: string) {
    return this.commercial.findContract(await this.actor(request), parse(id, orgId));
  }

  @Post('clients/:orgId/contract')
  @Header('Cache-Control', 'private, no-store')
  @ApiBody({ schema: documentation(commercialCreateContractSchema) })
  @ApiResponse({ status: 201, schema: documentation(commercialContractSchema) })
  async createContract(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Body() body: unknown,
  ) {
    return this.commercial.createContract(
      await this.actor(request, true),
      parse(id, orgId),
      parse(commercialCreateContractSchema, body),
    );
  }

  @Post('clients/:orgId/contract/:contractId/revisions')
  @Header('Cache-Control', 'private, no-store')
  @ApiBody({ schema: documentation(commercialReviseContractSchema) })
  @ApiResponse({ status: 201, schema: documentation(commercialContractSchema) })
  async reviseContract(
    @Req() request: Request,
    @Param('orgId') orgId: string,
    @Param('contractId') contractId: string,
    @Body() body: unknown,
  ) {
    return this.commercial.reviseContract(
      await this.actor(request, true),
      parse(id, orgId),
      parse(id, contractId),
      parse(commercialReviseContractSchema, body),
    );
  }

  @Post(documentRoute)
  @Header('Cache-Control', 'private, no-store')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({ status: 201, schema: documentation(commercialDocumentSchema) })
  @UseGuards(CommercialDocumentUploadGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: commercialDocumentMaxBytes + 1, files: 1, fields: 0, parts: 2 },
    }),
  )
  uploadDocument(@Req() request: UploadRequest, @UploadedFile() file?: Express.Multer.File) {
    return this.commercial.uploadDocument(
      request[documentActor],
      documentTarget(request.params),
      file,
    );
  }

  @Get(documentRoute)
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiResponse({
    status: 200,
    description: 'Private PDF attachment. The response has no public URL or object key.',
    content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
  })
  async downloadDocument(@Req() request: Request): Promise<StreamableFile> {
    const { file, buffer } = await this.commercial.downloadDocument(
      await this.actor(request),
      documentTarget(request.params),
    );
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${file.fileName}"`,
      length: file.size,
    });
  }
}
