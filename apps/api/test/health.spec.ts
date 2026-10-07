import { ServiceUnavailableException } from '@nestjs/common';
import { healthResponseSchema } from '@renr/contracts';
import { Test } from '@nestjs/testing';
import { HealthController } from '../src/health/health.controller';
import { PrismaService } from '../src/database/prisma.service';

describe('HealthController', () => {
  const checkReadiness = jest.fn<Promise<void>, []>();
  let controller: HealthController;

  beforeEach(async () => {
    checkReadiness.mockReset().mockResolvedValue(undefined);
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: PrismaService, useValue: { checkReadiness } }],
    }).compile();
    controller = module.get(HealthController);
  });

  it('returns the shared liveness contract without probing the database', () => {
    expect(healthResponseSchema.safeParse(controller.getHealth()).success).toBe(true);
    expect(checkReadiness).not.toHaveBeenCalled();
  });

  it('checks the database before returning readiness', async () => {
    expect(healthResponseSchema.safeParse(await controller.getReadiness()).success).toBe(true);
    expect(checkReadiness).toHaveBeenCalledTimes(1);
  });

  it('returns service unavailable when the database fails', async () => {
    checkReadiness.mockRejectedValue(new Error('private database error'));
    await expect(controller.getReadiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
