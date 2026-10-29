import { useEffect, useState } from 'react';
import { request, RequestError } from '../../lib/api';

type State<T> = {
  key: string;
  data: T | null;
  loading: boolean;
  error: string;
  errorStatus: number | null;
};
export function useRiskData<T>(
  path: string | null,
  schema: { parse: (value: unknown) => T },
  onExpire: () => void,
  attempt = 0,
) {
  const key = `${path}-${attempt}`;
  const [state, setState] = useState<State<T>>({
    key,
    data: null,
    loading: !!path,
    error: '',
    errorStatus: null,
  });
  // Reset during rendering: A → B → A must not reuse A while a fresh request is pending.
  if (state.key !== key)
    setState({ key, data: null, loading: !!path, error: '', errorStatus: null });
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    let current = true;
    void request(path, schema, { signal: controller.signal })
      .then((data) => {
        if (current) setState({ key, data, loading: false, error: '', errorStatus: null });
      })
      .catch((failure: unknown) => {
        if (!current) return;
        if (failure instanceof RequestError && failure.status === 401) onExpire();
        setState({
          key,
          data: null,
          loading: false,
          errorStatus: failure instanceof RequestError ? failure.status : null,
          error:
            failure instanceof Error ? failure.message : 'Não foi possível consultar os registros.',
        });
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [path, schema, key, onExpire]);
  if (!path) return { data: null, loading: false, error: '', errorStatus: null };
  return state.key === key ? state : { data: null, loading: true, error: '', errorStatus: null };
}

export const statusLabels = { DRAFT: 'Rascunho', REGISTERED: 'Registrado', ARCHIVED: 'Arquivado' };
export function riskDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value),
  );
}
export function scrollToField(form: HTMLFormElement | null, name: string) {
  const field = form?.elements.namedItem(name);
  if (field instanceof HTMLElement) {
    field.focus();
    field.scrollIntoView?.({ block: 'center', behavior: 'auto' });
  }
}
