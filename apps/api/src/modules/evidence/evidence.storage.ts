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
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
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
    } catch {
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
    } catch {
      throw new ServiceUnavailableException();
    }
  }
  async compensate(key: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.environment.S3_BUCKET, Key: key }),
      );
    } catch {
      this.logger.error({ message: 'New evidence object cleanup failed' });
    }
  }
  onApplicationShutdown(): void {
    this.client?.destroy();
  }
}
