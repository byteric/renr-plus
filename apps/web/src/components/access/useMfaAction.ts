import { useEffect, useRef, useState } from 'react';
import { request } from '../../lib/api';

export function postMfa<T>(
  path: string,
  schema: { parse(value: unknown): T },
  body: object,
  signal: AbortSignal,
) {
  return request(path, schema, { method: 'POST', body: JSON.stringify(body), signal });
}

export function useMfaAction() {
  const active = useRef<AbortController>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    function abort() {
      active.current?.abort();
      active.current = null;
    }
    function suspend() {
      abort();
      setPending(false);
    }
    window.addEventListener('pagehide', suspend);
    return () => {
      window.removeEventListener('pagehide', suspend);
      abort();
    };
  }, []);

  async function run<T>(
    action: (signal: AbortSignal) => Promise<T>,
    onSuccess: (result: T) => void,
    onError?: (failure: unknown) => string,
  ) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setError('');
    try {
      const result = await action(controller.signal);
      if (!controller.signal.aborted) onSuccess(result);
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(
          onError?.(failure) ??
            (failure instanceof Error ? failure.message : 'Não foi possível concluir.'),
        );
      }
    } finally {
      if (!controller.signal.aborted) {
        active.current = null;
        setPending(false);
      }
    }
  }

  return { pending, error, setError, run };
}
