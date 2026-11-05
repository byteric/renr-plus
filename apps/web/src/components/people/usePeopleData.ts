import { useEffect, useRef, useState } from 'react';
import { request, RequestError } from '../../lib/api';

/** Private snapshots belong to one request scope and are never cached or persisted. */
export function usePeopleData<T>(
  path: string | null,
  schema: { parse(value: unknown): T },
  organizationId: string,
  onExpire: () => void,
  onDenied: () => void,
  revision = 0,
  retainDuringRefresh = false,
) {
  const key = `${organizationId}:${path}:${revision}`;
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
            value &&
            typeof value === 'object' &&
            'organizationId' in value &&
            value.organizationId !== organizationId
          )
            throw new RequestError(502);
          const employeeId = path.match(/\/employees\/([^/?]+)/)?.[1];
          if (
            employeeId &&
            value &&
            typeof value === 'object' &&
            'employeeId' in value &&
            value.employeeId !== employeeId
          )
            throw new RequestError(502);
        };
        check(data);
        if (data && typeof data === 'object') {
          if ('items' in data && Array.isArray(data.items)) data.items.forEach(check);
          if ('registration' in data) check(data.registration);
        }
        setState({ key, path, data, loading: false, error: '' });
      })
      .catch((error: unknown) => {
        if (!current) return;
        setState({
          key,
          path,
          data: null,
          loading: false,
          error: error instanceof Error ? error.message : 'Não foi possível consultar os dados.',
        });
        if (error instanceof RequestError && error.status === 401) callbacks.current.onExpire();
        if (error instanceof RequestError && error.status === 403) callbacks.current.onDenied();
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [path, schema, organizationId, key]);
  if (!path) return { data: null, error: '', loading: false };
  return state.key === key
    ? state
    : {
        data: retainDuringRefresh && state.path === path ? state.data : null,
        error: '',
        loading: true,
      };
}

export function money(cents: string | null) {
  return cents === null
    ? 'Não informado'
    : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
        Number(cents) / 100,
      );
}
export function civil(value: string | null) {
  if (!value) return 'Não informado';
  return value.split('-').reverse().join('/');
}
