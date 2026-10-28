import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { ENVIRONMENT, type Environment } from '../../config/env';

@Injectable()
export class EvidenceStorage implements OnApplicationShutdown {
  private readonly logger = new Logger(EvidenceStorage.name);
  private readonly client: S3Client | null;
  constructor(@Inject(ENVIRONMENT) private readonly environment: Environment) {
    this.client =
      environment.STORAGE_ENABLED && environment.S3_ACCESS_KEY && environment.S3_SECRET_KEY
        ? new S3Client({
            endpoint: environment.S3_ENDPOINT,
            region: environment.S3_REGION,
            forcePathStyle: true,
            maxAttempts: 1,
            credentials: {
              accessKeyId: environment.S3_ACCESS_KEY,
              secretAccessKey: environment.S3_SECRET_KEY,
            },
            requestHandler: { connectionTimeout: 2000, socketTimeout: 5000, requestTimeout: 7000 },
          })
        : null;
  }
  assertEnabled(): void {
    if (!this.client) throw new ServiceUnavailableException();
  }
  private report(operation: 'PUT' | 'GET' | 'PROBE' | 'DELETE', error: unknown): void {
    const metadata =
      error && typeof error === 'object' && '$metadata' in error
        ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        : undefined;
    const status = metadata?.httpStatusCode;
    this.logger.warn({
      message: 'Private storage operation failed',
      operation,
      status:
        typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
          ? status
          : null,
    });
  }
  async probe(
    key: string,
    expected: { mimeType: string; size: number; sha256: string },
  ): Promise<'PRESENT' | 'ABSENT' | 'UNKNOWN'> {
    if (!this.client || expected.size < 1 || expected.size > 5 * 1024 * 1024) return 'UNKNOWN';
    let body: Readable | undefined;
    let stage: 'HEAD' | 'GET' = 'HEAD';
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.environment.S3_BUCKET, Key: key }),
      );
      if (
        head.ContentLength !== expected.size ||
        head.ContentType !== expected.mimeType ||
        head.Metadata?.sha256 !== expected.sha256
      )
        return 'UNKNOWN';
      stage = 'GET';
      const object = await this.client.send(
        new GetObjectCommand({ Bucket: this.environment.S3_BUCKET, Key: key }),
      );
      if (!(object.Body instanceof Readable)) return 'UNKNOWN';
      body = object.Body;
      const digest = createHash('sha256');
      let size = 0;
      for await (const chunk of body) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > expected.size) return 'UNKNOWN';
        digest.update(bytes);
      }
      return size === expected.size && digest.digest('hex') === expected.sha256
        ? 'PRESENT'
        : 'UNKNOWN';
    } catch (error) {
      const status =
        error && typeof error === 'object' && '$metadata' in error
          ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
          : undefined;
      if (stage === 'HEAD' && status === 404) return 'ABSENT';
      this.report('PROBE', error);
      return 'UNKNOWN';
    } finally {
      body?.destroy();
    }
  }
  async put(key: string, body: Buffer, mimeType: string, sha256: string): Promise<void> {
    this.assertEnabled();
    if (!this.client) throw new ServiceUnavailableException();
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.environment.S3_BUCKET,
          Key: key,
          Body: body,
          ContentType: mimeType,
          Metadata: { sha256 },
        }),
      );
    } catch (error) {
      this.report('PUT', error);
      throw new ServiceUnavailableException();
    }
  }
  async get(key: string): Promise<Readable> {
    this.assertEnabled();
    if (!this.client) throw new ServiceUnavailableException();
    try {
      const object = await this.client.send(
        new GetObjectCommand({ Bucket: this.environment.S3_BUCKET, Key: key }),
      );
      if (!(object.Body instanceof Readable)) throw new ServiceUnavailableException();
      return object.Body;
    } catch (error) {
      this.report('GET', error);
      throw new ServiceUnavailableException();
    }
  }
  async compensate(key: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.environment.S3_BUCKET, Key: key }),
      );
    } catch (error) {
      this.report('DELETE', error);
    }
  }
  onApplicationShutdown(): void {
    this.client?.destroy();
  }
}
