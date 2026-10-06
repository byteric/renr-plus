import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { ENVIRONMENT, type Environment } from '../config/env';
import { PrismaClient } from '../generated/prisma/client';

export const READINESS_TIMEOUT_MS = 2_000;

@Injectable()
export class PrismaService implements OnApplicationShutdown {
  private readonly logger = new Logger(PrismaService.name);
  readonly client: PrismaClient;

  constructor(@Inject(ENVIRONMENT) environment: Environment) {
    // Construction is lazy: only readiness or future repository calls open a connection.
    const adapter = new PrismaPg({
      connectionString: environment.DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: READINESS_TIMEOUT_MS,
      query_timeout: READINESS_TIMEOUT_MS,
      statement_timeout: READINESS_TIMEOUT_MS,
    });
    this.client = new PrismaClient({ adapter });
  }

  async checkReadiness(): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.client.$queryRaw`SELECT 1`,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error('Readiness timeout')), READINESS_TIMEOUT_MS);
        }),
      ]);
    } catch {
      // Do not include database diagnostics or credentials in logs.
      this.logger.warn('Database readiness probe failed');
      throw new Error('Database unavailable');
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.$disconnect();
  }
}
