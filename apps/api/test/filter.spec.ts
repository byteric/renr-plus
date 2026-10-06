import { type ArgumentsHost, BadRequestException, Logger } from '@nestjs/common';
import { apiErrorSchema } from '@renr/contracts';
import { ApiExceptionFilter } from '../src/http/api-exception.filter';

describe('ApiExceptionFilter', () => {
  it.each([
    {
      exception: new Error('private stack and secret'),
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
    },
    {
      exception: new BadRequestException('private validation details'),
      statusCode: 400,
      code: 'BAD_REQUEST',
    },
  ])('sanitizes errors at status $statusCode', ({ exception, statusCode, code }) => {
    const response = {
      locals: { requestId: '7a51c09c-59a3-4507-90ab-fac8c4b57946' },
      setHeader: jest.fn(),
      status: jest.fn(),
      json: jest.fn(),
    };
    response.status.mockReturnValue(response);
    // The fake only models the HTTP response boundary consumed by this filter.
    const host = { switchToHttp: () => ({ getResponse: () => response }) } as ArgumentsHost;
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    new ApiExceptionFilter().catch(exception, host);
    expect(response.status).toHaveBeenCalledWith(statusCode);
    const body: unknown = response.json.mock.calls[0]?.[0];
    expect(apiErrorSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ code, requestId: response.locals.requestId });
    expect(JSON.stringify(body)).not.toContain('private');
    log.mockRestore();
  });
});
