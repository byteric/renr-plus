import { useEffect, useMemo, useState } from 'react';
import { RequestError } from '../../lib/api';
import { useRiskData } from '../risks/useRiskData';

export function useActionData<T>(
  path: string | null,
  schema: { parse: (value: unknown) => T },
  organizationId: string,
  onExpire: () => void,
  attempt = 0,
) {
  const [visibility, setVisibility] = useState(0);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') setVisibility((value) => value + 1);
    };
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, []);
  const scoped = useMemo(
    () => ({
      parse(value: unknown) {
        const data = schema.parse(value);
        const check = (entry: unknown) => {
          if (
            typeof entry === 'object' &&
            entry !== null &&
            'organizationId' in entry &&
            entry.organizationId !== organizationId
          )
            throw new RequestError(502);
        };
        check(data);
        if (
          typeof data === 'object' &&
          data !== null &&
          'items' in data &&
          Array.isArray(data.items)
        )
          data.items.forEach(check);
        return data;
      },
    }),
    [schema, organizationId],
  );
  return useRiskData(path, scoped, onExpire, attempt + visibility);
}
export const actionLabels = {
  PLANNED: 'Planejada',
  IN_PROGRESS: 'Em execução',
  IMPLEMENTED: 'Execução informada',
  CANCELLED: 'Cancelada',
};
export const civilDate = (value: string) => value.split('-').reverse().join('/');
