import { useState } from 'react';
import { evaluationMethodVersionListSchema, riskMatrixSchema } from '@renr/contracts';
import { Button } from '../ui/button';
import { useRiskData } from './useRiskData';

export function RiskMatrix({
  organizationId,
  query,
  onExpire,
}: {
  organizationId: string;
  query: string;
  onExpire: () => void;
}) {
  const params = new URLSearchParams(query);
  const selected = params.get('methodVersionId') ?? '';
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const methods = useRiskData(
    `/organizations/${organizationId}/evaluation-method-versions?status=PUBLISHED&page=${page}&pageSize=50`,
    evaluationMethodVersionListSchema,
    onExpire,
    attempt,
  );
  const filters = new URLSearchParams(query);
  filters.delete('view');
  filters.delete('page');
  filters.delete('pageSize');
  const matrix = useRiskData(
    selected ? `/organizations/${organizationId}/risk-workspaces/matrix?${filters}` : null,
    riskMatrixSchema,
    onExpire,
    attempt,
  );
  const data = matrix.data;
  return (
    <section className="surface risk-stack" aria-labelledby="matrix-title">
      <h2 id="matrix-title">Matriz de avaliação técnica</h2>
      <p>
        Contagem de todo o recorte filtrado, independente da página. Cada consulta usa uma versão
        exata; versões diferentes não são combinadas.
      </p>
      <div className="risk-form">
        <label htmlFor="matrix-method">Método publicado e versão da matriz</label>
        <select
          id="matrix-method"
          value={selected}
          onChange={(event) => {
            const next = new URLSearchParams(query);
            next.set('view', 'matrix');
            if (event.target.value) next.set('methodVersionId', event.target.value);
            else next.delete('methodVersionId');
            window.location.hash = `/inventario?${next}`;
          }}
        >
          <option value="">Selecione uma versão publicada</option>
          {selected && !methods.data?.items.some((method) => method.id === selected) && (
            <option value={selected}>Versão selecionada</option>
          )}
          {methods.data?.items.map((method) => (
            <option key={method.id} value={method.id}>
              {method.method.name} · v{method.version} · {method.title}
            </option>
          ))}
        </select>
        {methods.data && methods.data.total > 50 && (
          <div className="record-actions">
            <Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>
              Métodos anteriores
            </Button>
            <Button
              variant="outline"
              disabled={page * 50 >= methods.data.total}
              onClick={() => setPage(page + 1)}
            >
              Mais métodos
            </Button>
          </div>
        )}
      </div>
      {methods.loading && <p role="status">Carregando métodos publicados…</p>}
      {methods.data?.total === 0 && (
        <p className="feedback">
          Nenhum método publicado disponível. Solicite um método validado ao responsável técnico.
        </p>
      )}
      {(methods.error || matrix.error) && (
        <div role="alert">
          <p>{methods.error || matrix.error}</p>
          <Button variant="outline" onClick={() => setAttempt(attempt + 1)}>
            Atualizar matriz e métodos
          </Button>
        </div>
      )}
      {matrix.loading && <p role="status">Carregando matriz…</p>}
      {data && (
        <>
          <h3>
            {data.methodVersion.method.name} · versão {data.methodVersion.version}
          </h3>
          <p>
            {data.classifiedTotal} classificados de {data.totalMatched} registros no recorte.
          </p>
          <div
            className="risk-table-scroll risk-matrix-scroll"
            role="region"
            aria-label="Matriz por probabilidade e severidade"
            tabIndex={0}
          >
            <table className="risk-table risk-matrix">
              <caption>Probabilidade × severidade — quantidade de riscos vigentes</caption>
              <thead>
                <tr>
                  <th scope="col">Probabilidade / severidade</th>
                  {data.methodVersion.definition.severity.map((severity) => (
                    <th scope="col" key={severity.key}>
                      {severity.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.methodVersion.definition.probability.map((probability) => (
                  <tr key={probability.key}>
                    <th scope="row">{probability.label}</th>
                    {data.methodVersion.definition.severity.map((severity) => {
                      const cell = data.cells.find(
                        (entry) =>
                          entry.probabilityKey === probability.key &&
                          entry.severityKey === severity.key,
                      );
                      const level = data.methodVersion.definition.levels.find(
                        (entry) => entry.key === cell?.levelKey,
                      );
                      const priority = data.methodVersion.definition.priorities.find(
                        (entry) => entry.key === cell?.priorityKey,
                      );
                      return (
                        <td key={severity.key}>
                          <strong>{cell?.count ?? 0}</strong>
                          <p>
                            {level?.label} · {priority?.label}
                          </p>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Registros fora das células</h3>
          <dl className="risk-metadata">
            {[
              ['Sem avaliação técnica', data.excluded.unclassified],
              ['Contexto alterado', data.excluded.contextChanged],
              ['Método ou versão incompatível', data.excluded.incompatible],
              ['Escopo inativo', data.excluded.inactiveScope],
              ['Não registrados', data.excluded.notRegistered],
            ].map(([label, count]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{count}</dd>
              </div>
            ))}
          </dl>
          <p className="muted">
            Ausência de avaliação e contexto alterado não representam classificação baixa.
          </p>
        </>
      )}
    </section>
  );
}
