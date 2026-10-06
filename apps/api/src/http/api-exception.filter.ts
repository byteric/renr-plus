import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiError } from '@renr/contracts';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { z } from 'zod';

const publicErrors: Record<number, { code: string; message: string }> = {
  400: { code: 'BAD_REQUEST', message: 'Invalid request' },
  401: { code: 'UNAUTHORIZED', message: 'Authentication required' },
  403: { code: 'FORBIDDEN', message: 'Access denied' },
  404: { code: 'NOT_FOUND', message: 'Resource not found' },
  405: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' },
  409: { code: 'CONFLICT', message: 'Request conflicts with current state' },
  413: { code: 'PAYLOAD_TOO_LARGE', message: 'Request payload too large' },
  422: { code: 'UNPROCESSABLE_ENTITY', message: 'Invalid request' },
  429: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests' },
  503: { code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable' },
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const statusCode =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const requestId =
      typeof response.locals.requestId === 'string' ? response.locals.requestId : randomUUID();
    const error = publicErrors[statusCode] ?? {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
    };
    const body: ApiError = { statusCode, ...error, requestId, timestamp: new Date().toISOString() };
    if (exception instanceof HttpException && statusCode === 400) {
      const details = z
        .object({ details: z.array(z.object({ field: z.string(), message: z.string() })) })
        .safeParse(exception.getResponse());
      if (details.success) body.details = details.data.details;
    }
    if (statusCode >= 500) this.logger.error({ message: 'Request failed', statusCode, requestId });
    response.setHeader('X-Request-Id', requestId);
    response.status(statusCode).json(body);
  }
}
