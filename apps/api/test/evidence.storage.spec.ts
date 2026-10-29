import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { parseEnvironment } from '../src/config/env';
import { EvidenceStorage } from '../src/modules/evidence/evidence.storage';

const bytes = Buffer.from('%PDF-1.7\nSynthetic verification only');
const expected = {
  size: bytes.length,
  mimeType: 'application/pdf',
  sha256: createHash('sha256').update(bytes).digest('hex'),
};
type ProbeStorage = {
  probe(key: string, expectation: typeof expected): Promise<'PRESENT' | 'ABSENT' | 'UNKNOWN'>;
};
describe('Private storage result verification', () => {
  let storage: EvidenceStorage;
  let send: jest.SpyInstance;
  beforeEach(() => {
    send = jest.spyOn(S3Client.prototype, 'send');
    storage = new EvidenceStorage(
      parseEnvironment({
        DATABASE_URL: 'postgresql://synthetic:unused@127.0.0.1:5432/synthetic',
        STORAGE_ENABLED: true,
        S3_ACCESS_KEY: 'synthetic-key',
        S3_SECRET_KEY: 'synthetic-secret',
      }),
    );
  });
  afterEach(() => {
    storage.onApplicationShutdown();
    jest.restoreAllMocks();
  });
  const probe = () =>
    (storage as unknown as ProbeStorage).probe('synthetic/action/file.pdf', expected);
  const head = () => ({
    ContentLength: bytes.length,
    ContentType: expected.mimeType,
    Metadata: { sha256: expected.sha256 },
  });
  it('confirms existence only after matching metadata and the actual bytes', async () => {
    send.mockResolvedValueOnce(head()).mockResolvedValueOnce({ Body: Readable.from([bytes]) });
    await expect(probe()).resolves.toBe('PRESENT');
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(HeadObjectCommand);
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(GetObjectCommand);
  });
  it('treats only a confirmed HEAD 404 as absence', async () => {
    send.mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } });
    await expect(probe()).resolves.toBe('ABSENT');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it.each([403, 429, 500, 503])('keeps provider HTTP %i uncertain', async (status) => {
    send.mockRejectedValueOnce({
      $metadata: { httpStatusCode: status },
      message: 'secret provider detail',
    });
    await expect(probe()).resolves.toBe('UNKNOWN');
  });
  it('keeps a network timeout uncertain', async () => {
    send.mockRejectedValueOnce(new Error('socket timeout secret provider detail'));
    await expect(probe()).resolves.toBe('UNKNOWN');
  });
  it('does not accept matching metadata with different bytes', async () => {
    send
      .mockResolvedValueOnce(head())
      .mockResolvedValueOnce({ Body: Readable.from([Buffer.alloc(bytes.length)]) });
    await expect(probe()).resolves.toBe('UNKNOWN');
  });
  it('bounds the stream and destroys an oversized object', async () => {
    const body = Readable.from([Buffer.alloc(bytes.length + 1)]);
    send.mockResolvedValueOnce(head()).mockResolvedValueOnce({ Body: body });
    await expect(probe()).resolves.toBe('UNKNOWN');
    expect(body.destroyed).toBe(true);
  });
  it('does not read objects whose metadata differs from the immutable attempt', async () => {
    send.mockResolvedValueOnce({ ...head(), ContentLength: bytes.length + 1 });
    await expect(probe()).resolves.toBe('UNKNOWN');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('keeps a missing object after HEAD uncertain rather than approving another upload', async () => {
    send
      .mockResolvedValueOnce(head())
      .mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } });
    await expect(probe()).resolves.toBe('UNKNOWN');
  });
  it('logs a bounded operation and status without provider error text or credentials', async () => {
    const logger = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    send.mockRejectedValueOnce({
      $metadata: { httpStatusCode: 403 },
      name: 'secret-provider-key',
      message: 'synthetic-secret',
    });
    await expect(
      storage.put('synthetic/object', bytes, expected.mimeType, expected.sha256),
    ).rejects.toMatchObject({ status: 503 });
    expect(logger).toHaveBeenCalledWith(expect.objectContaining({ operation: 'PUT', status: 403 }));
    expect(JSON.stringify(logger.mock.calls)).not.toMatch(/synthetic-secret|secret-provider-key/);
  });
});
