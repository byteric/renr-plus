import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RequestError } from './api';
import { sendEvidenceFile } from './evidence-upload';

class TestXHR {
  static current: TestXHR;
  upload: { onload: (() => void) | null } = { onload: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  responseText = '';
  timeout = 0;
  withCredentials = false;
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn();
  abort = vi.fn(() => this.onabort?.());
  constructor() {
    TestXHR.current = this;
  }
}
const schema = {
  parse(value: unknown) {
    if (!value || typeof value !== 'object' || !('id' in value)) throw new Error('Invalid reply');
    return value as { id: string };
  },
};
beforeEach(() => vi.stubGlobal('XMLHttpRequest', TestXHR));
afterEach(() => vi.unstubAllGlobals());
it('announces transfer completion before server finalization without resolving the upload', async () => {
  const transferred = vi.fn();
  const completed = vi.fn();
  const body = new FormData();
  const result = sendEvidenceFile('/organizations/example/evidence', schema, body, {
    key: 'synthetic-key',
    onTransferred: transferred,
  });
  void result.then(completed);
  const wire = TestXHR.current;
  expect(wire.open).toHaveBeenCalledWith('POST', '/api/v1/organizations/example/evidence');
  expect(wire.withCredentials).toBe(true);
  expect(wire.timeout).toBe(15000);
  expect(wire.setRequestHeader).toHaveBeenCalledWith('Idempotency-Key', 'synthetic-key');
  expect(wire.setRequestHeader).not.toHaveBeenCalledWith('Content-Type', expect.anything());
  wire.upload.onload?.();
  await Promise.resolve();
  expect(transferred).toHaveBeenCalledOnce();
  expect(completed).not.toHaveBeenCalled();
  wire.status = 201;
  wire.responseText = JSON.stringify({ id: 'synthetic-proof' });
  wire.onload?.();
  await expect(result).resolves.toEqual({ id: 'synthetic-proof' });
});
it.each(['onerror', 'ontimeout'] as const)(
  'keeps %s uncertain after bytes were transferred',
  async (event) => {
    const result = sendEvidenceFile('/evidence', schema, new FormData(), { key: 'key' });
    const expectation = expect(result).rejects.toMatchObject({ status: 0 });
    TestXHR.current.upload.onload?.();
    TestXHR.current[event]?.();
    await expectation;
  },
);
it('does not treat transfer completion or provider 503 as final success', async () => {
  const result = sendEvidenceFile('/evidence', schema, new FormData(), { key: 'key' });
  const expectation = expect(result).rejects.toMatchObject({ status: 503 });
  TestXHR.current.upload.onload?.();
  TestXHR.current.status = 503;
  TestXHR.current.responseText = '{}';
  TestXHR.current.onload?.();
  await expectation;
});
it('rejects malformed successful responses at the contract boundary', async () => {
  const result = sendEvidenceFile('/evidence', schema, new FormData(), { key: 'key' });
  const expectation = expect(result).rejects.toBeInstanceOf(RequestError);
  TestXHR.current.status = 201;
  TestXHR.current.responseText = '{}';
  TestXHR.current.onload?.();
  await expectation;
});
it('aborts the real transport on context loss and ignores late callbacks', async () => {
  const signal = new AbortController();
  const transferred = vi.fn();
  const result = sendEvidenceFile('/evidence', schema, new FormData(), {
    key: 'key',
    signal: signal.signal,
    onTransferred: transferred,
  });
  const expectation = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  signal.abort();
  await expectation;
  expect(TestXHR.current.abort).toHaveBeenCalledOnce();
  TestXHR.current.upload.onload?.();
  expect(transferred).not.toHaveBeenCalled();
});
