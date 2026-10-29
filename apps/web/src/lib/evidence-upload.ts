import { apiErrorSchema } from '@renr/contracts';
import { apiBaseUrl, RequestError } from './api';

// upload.onload acknowledges only the browser's transfer, never the server's commit.
export function sendEvidenceFile<T>(
  path: string,
  schema: { parse: (value: unknown) => T },
  body: FormData,
  options: { key: string; signal?: AbortSignal; onTransferred?: () => void },
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new globalThis.XMLHttpRequest();
    let settled = false;
    function clean() {
      options.signal?.removeEventListener('abort', abort);
      xhr.upload.onload = null;
      xhr.onload = xhr.onerror = xhr.ontimeout = xhr.onabort = null;
    }
    function fail(error: unknown) {
      if (settled) return;
      settled = true;
      clean();
      reject(error);
    }
    function abort() {
      xhr.abort();
      fail(
        options.signal?.reason ?? new globalThis.DOMException('Context unavailable', 'AbortError'),
      );
    }
    xhr.open('POST', `${apiBaseUrl}${path}`);
    xhr.withCredentials = true;
    xhr.timeout = 15_000;
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('Idempotency-Key', options.key);
    xhr.upload.onload = () => {
      if (!settled && !options.signal?.aborted) options.onTransferred?.();
    };
    xhr.onerror = xhr.ontimeout = () => fail(new RequestError(0));
    xhr.onabort = () => fail(options.signal?.aborted ? options.signal.reason : new RequestError(0));
    xhr.onload = () => {
      let value: unknown;
      try {
        value = JSON.parse(xhr.responseText);
      } catch {
        value = null;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        const parsed = apiErrorSchema.safeParse(value);
        fail(
          new RequestError(
            xhr.status,
            parsed.success ? parsed.data.details : [],
            parsed.success ? parsed.data.code : '',
          ),
        );
        return;
      }
      try {
        const result = schema.parse(value);
        if (!settled) {
          settled = true;
          clean();
          resolve(result);
        }
      } catch {
        fail(new RequestError(502));
      }
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) {
      abort();
      return;
    }
    try {
      xhr.send(body);
    } catch {
      fail(new RequestError(0));
    }
  });
}
