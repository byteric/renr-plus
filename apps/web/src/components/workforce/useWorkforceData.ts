import { useEffect, useState } from 'react';
import { request, RequestError } from '../../lib/api';

/** Preserve same-route drafts through recoverable revalidation; clear on access denial. */
export function useWorkforceData<T>(
  path: string | null,
  schema: { parse: (value: unknown) => T },
  organizationId: string,
  onExpire: () => void,
  attempt = 0,
) {
  const key = `${organizationId}-${path}`;
  const [visibility, setVisibility] = useState(0);
  const requestKey = `${key}-${attempt}-${visibility}`;
  const [state, setState] = useState<{
    key: string;
    requestKey: string;
    data: T | null;
    loading: boolean;
    error: string;
  }>({ key, requestKey, data: null, loading: !!path, error: '' });
  // Only continuous same-resource revalidation may retain data. Leaving even for
  // null invalidates a detail snapshot before a later reopen captures its version.
  if (state.requestKey !== requestKey) {
    setState({
      key,
      requestKey,
      data: state.key === key ? state.data : null,
      loading: !!path,
      error: '',
    });
  }
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') setVisibility((value) => value + 1);
    };
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, []);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    let current = true;
    void request(path, schema, { signal: controller.signal })
      .then((data) => {
        const check = (entry: unknown) => {
          if (
            entry &&
            typeof entry === 'object' &&
            'organizationId' in entry &&
            entry.organizationId !== organizationId
          )
            throw new RequestError(502);
        };
        check(data);
        if (data && typeof data === 'object' && 'items' in data && Array.isArray(data.items))
          data.items.forEach(check);
        if (current) setState({ key, requestKey, data, loading: false, error: '' });
      })
      .catch((failure: unknown) => {
        if (!current) return;
        const fatal = failure instanceof RequestError && [401, 403, 404].includes(failure.status);
        if (failure instanceof RequestError && failure.status === 401) onExpire();
        setState((previous) => ({
          key,
          requestKey,
          data: !fatal && previous.key === key ? previous.data : null,
          loading: false,
          error:
            failure instanceof Error ? failure.message : 'Não foi possível consultar o cadastro.',
        }));
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [path, schema, organizationId, key, requestKey, onExpire]);
  if (!path) return { data: null, loading: false, error: '' };
  return state.key === key ? state : { data: null, loading: true, error: '' };
}
