import { useState } from 'react';
import { actionOverviewSchema } from '@renr/contracts';
import { Button } from '../ui/button';
import { MetricCard } from '../charts/MetricCard';
import { ActionStatusBars } from './ActionStatusBars';
import { civilDate, useActionData } from './useActionData';
import './actions.css';

export function ActionMetrics({
  organizationId,
  onExpire,
}: {
  organizationId: string;
  onExpire: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const state = useActionData(
    `/organizations/${organizationId}/action-overview`,
    actionOverviewSchema,
    organizationId,
    onExpire,
    attempt,
  );
  return (
    <section className="risk-stack" aria-labelledby="action-metrics-title">
      <div className="dashboard-section-heading">
        <div>
          <p className="panel-label">DA MEDIDA AO ACOMPANHAMENTO</p>
          <h2 id="action-metrics-title">Ações preventivas</h2>
        </div>
        <Button variant="outline" onClick={() => setAttempt(attempt + 1)}>
          Atualizar indicadores de ações
        </Button>
      </div>
      {state.loading && <p role="status">Carregando indicadores de ações…</p>}
      {state.error && (
        <p className="feedback error" role="alert">
          {state.error}
        </p>
      )}
      {state.data && (
        <>
          <p className="dashboard-timestamp">
            Referência de prazo: {civilDate(state.data.referenceDate)} · {state.data.timeZone} ·
            atualizado {new Date(state.data.generatedAt).toLocaleString('pt-BR')}
          </p>
          <ul className="dashboard-metrics" aria-label="Indicadores das ações">
            <MetricCard
              label="Planejadas"
              value={state.data.totals.planned}
              detail="Aguardam início"
              href="#/acoes?page=1&status=PLANNED"
            />
            <MetricCard
              label="Em execução"
              value={state.data.totals.inProgress}
              detail="Acompanhar medidas"
              href="#/acoes?page=1&status=IN_PROGRESS"
            />
            <MetricCard
              label="Execução informada"
              value={state.data.totals.implemented}
              detail="Consultar relatos"
              href="#/acoes?page=1&status=IMPLEMENTED"
            />
            <MetricCard
              label="Canceladas"
              value={state.data.totals.cancelled}
              detail="Consultar justificativas"
              href="#/acoes?page=1&status=CANCELLED"
            />
            <MetricCard
              label="Atrasadas"
              value={state.data.totals.overdue}
              detail="Parte das ações abertas"
              href="#/acoes?page=1&overdue=true"
              accent
            />
          </ul>
          <ActionStatusBars totals={state.data.totals} />
          <p className="chart-note">
            {state.data.totals.open} abertas de {state.data.totals.total} ações. Atraso não é um
            estado adicional. Execução informada não comprova eficácia nem conformidade.
          </p>
          {state.data.totals.total === 0 && (
            <p className="surface empty-state">
              Nenhuma ação cadastrada. Crie uma medida a partir de um risco registrado no
              inventário.
            </p>
          )}
        </>
      )}
    </section>
  );
}
