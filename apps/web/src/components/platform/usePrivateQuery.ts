import { useEffect, useRef, useState } from 'react';
import { request, RequestError } from '../../lib/api';

export function usePrivateQuery<T>(
  path: string | null,
  schema: { parse(value: unknown): T },
  revision: number,
  onExpire: () => void,
  onDenied: () => void,
  scope?: string | null,
  retain = false,
) {
  const key = `${scope}:${path}:${revision}`;
  const callbacks = useRef({ onExpire, onDenied });
  useEffect(() => {
    callbacks.current = { onExpire, onDenied };
  }, [onExpire, onDenied]);
  const [state, setState] = useState<{
    key: string;
    path: string | null;
    data: T | null;
    error: string;
    loading: boolean;
  }>({ key: '', path: null, data: null, error: '', loading: !!path });
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    let current = true;
    void request(path, schema, { signal: controller.signal })
      .then((data) => {
        if (!current) return;
        const check = (value: unknown) => {
          if (
            scope !== undefined &&
            value &&
            typeof value === 'object' &&
            'organizationId' in value &&
            value.organizationId !== scope
          )
            throw new RequestError(502);
        };
        check(data);
        if (data && typeof data === 'object' && 'items' in data && Array.isArray(data.items))
          data.items.forEach(check);
        setState({ key, path, data, loading: false, error: '' });
      })
      .catch((failure: unknown) => {
        if (!current) return;
        setState({
          key,
          path,
          data: null,
          loading: false,
          error:
            failure instanceof Error ? failure.message : 'Não foi possível consultar os dados.',
        });
        if (failure instanceof RequestError && failure.status === 401) callbacks.current.onExpire();
        if (failure instanceof RequestError && failure.status === 403) callbacks.current.onDenied();
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [path, schema, revision, scope, key]);
  if (!path) return { data: null, error: '', loading: false };
  return state.key === key
    ? state
    : { data: retain && state.path === path ? state.data : null, error: '', loading: true };
}

export function useAccessRefresh() {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    const visibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  return { revision, refresh: () => setRevision((value) => value + 1) };
}
