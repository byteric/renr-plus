import { useEffect, useState } from 'react';
import { evidenceUsageSchema } from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { Button } from '../ui/button';
import { riskDate } from '../risks/useRiskData';

type Usage = ReturnType<typeof evidenceUsageSchema.parse>;

export function EvidenceUsage({
  path,
  evidenceId,
  onReady,
  onPending,
  onUnavailable,
}: {
  path: string;
  evidenceId: string;
  onReady: (evidenceId: string) => void;
  onPending: () => void;
  onUnavailable: (status: number) => void;
}) {
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ data: Usage | null; error: string; loading: boolean }>({
    data: null,
    error: '',
    loading: true,
  });
  // Callbacks are events owned by the parent, not query dependencies.
  const [callbacks] = useState(() => ({ onReady, onPending, onUnavailable }));
  useEffect(() => {
    const controller = new AbortController();
    callbacks.onPending();
    void request(`${path}?page=${page}&pageSize=20`, evidenceUsageSchema, {
      signal: controller.signal,
    })
      .then((data) => {
        if (controller.signal.aborted) return;
        if (data.evidenceId !== evidenceId) throw new RequestError(502);
        setResult({ data, error: '', loading: false });
        callbacks.onReady(data.evidenceId);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        callbacks.onPending();
        if (error instanceof RequestError && [401, 403, 404].includes(error.status))
          callbacks.onUnavailable(error.status);
        setResult({
          data: null,
          loading: false,
          error: 'Não foi possível consultar os usos. Consulte novamente antes de arquivar.',
        });
      });
    return () => controller.abort();
  }, [path, evidenceId, page, retry, callbacks]);
  return (
    <div className="risk-stack" aria-label="Usos da evidência">
      {result.loading && <p role="status">Consultando usos…</p>}
      {result.error && (
        <>
          <p role="alert">{result.error}</p>
          <Button
            variant="outline"
            onClick={() => {
              callbacks.onPending();
              setResult({ data: null, error: '', loading: true });
              setRetry((value) => value + 1);
            }}
          >
            Consultar usos novamente
          </Button>
        </>
      )}
      {result.data && (
        <>
          <p>
            {result.data.opinionTotal} parecer(es) · {result.data.closureTotal} encerramento(s)
            técnico(s). Os snapshots permanecem preservados após arquivar.
          </p>
          <ul>
            {result.data.items.map((item) => (
              <li key={`${item.kind}/${item.id}`}>
                {item.kind === 'OPINION' ? 'Parecer' : 'Encerramento técnico'} #{item.sequence} ·{' '}
                {riskDate(item.createdAt)}
              </li>
            ))}
          </ul>
          {result.data.total > 20 && (
            <nav className="record-actions" aria-label="Paginação dos usos da evidência">
              <Button
                variant="outline"
                disabled={page === 1}
                onClick={() => {
                  callbacks.onPending();
                  setResult({ data: null, error: '', loading: true });
                  setPage(page - 1);
                }}
              >
                Usos anteriores
              </Button>
              <Button
                variant="outline"
                disabled={page * 20 >= result.data.total}
                onClick={() => {
                  callbacks.onPending();
                  setResult({ data: null, error: '', loading: true });
                  setPage(page + 1);
                }}
              >
                Mais usos
              </Button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
