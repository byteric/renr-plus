import { Logger } from '@nestjs/common';
import { parseEnvironment } from '../src/config/env';
import { PrismaService, READINESS_TIMEOUT_MS } from '../src/database/prisma.service';

const mockQueryRaw = jest.fn<Promise<unknown>, []>();
const mockDisconnect = jest.fn<Promise<void>, []>();
jest.mock('../src/generated/prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    $queryRaw: mockQueryRaw,
    $disconnect: mockDisconnect,
  })),
}));
jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation(() => ({})),
}));

describe('PrismaService lifecycle and readiness', () => {
  const environment = parseEnvironment({
    DATABASE_URL: 'postgresql://renr:test@127.0.0.1:5432/renr',
    S3_ACCESS_KEY: 'test-access',
    S3_SECRET_KEY: 'test-secret',
  });
  let service: PrismaService;

  beforeEach(() => {
    mockQueryRaw.mockReset();
    mockDisconnect.mockReset().mockResolvedValue(undefined);
    service = new PrismaService(environment);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('does not issue a query during construction', () => {
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it('accepts a successful query', async () => {
    mockQueryRaw.mockResolvedValue([{ '?column?': 1 }]);
    await expect(service.checkReadiness()).resolves.toBeUndefined();
  });

  it('bounds a stalled query at two seconds', async () => {
    jest.useFakeTimers();
    mockQueryRaw.mockImplementation(() => new Promise(() => undefined));
    const assertion = expect(service.checkReadiness()).rejects.toThrow('Database unavailable');
    await jest.advanceTimersByTimeAsync(READINESS_TIMEOUT_MS);
    await assertion;
    expect(jest.getTimerCount()).toBe(0);
  });

  it('sanitizes query errors', async () => {
    mockQueryRaw.mockRejectedValue(new Error('private database diagnostics'));
    await expect(service.checkReadiness()).rejects.toThrow('Database unavailable');
  });

  it('disconnects on application shutdown', async () => {
    await service.onApplicationShutdown();
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });
});
