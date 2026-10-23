import { useEffect, useRef, useState } from 'react';
import { riskOverviewSchema, type RiskOverview } from '@renr/contracts';
import { request, RequestError } from '../lib/api';
import { Button } from './ui/button';
import { OrganizationOverview } from './OrganizationOverview';
import { RiskRegistrations } from './RiskRegistrations';
import { MetricCard } from './charts/MetricCard';
import { OperationalBars } from './charts/OperationalBars';
import { CompletionRing } from './charts/CompletionRing';
import { ActionMetrics } from './actions/ActionMetrics';
import { usePresentationMotion } from '../hooks/usePresentationMotion';
import '../dashboard.css';

type State =
  | { key: string; status: 'loading' }
  | { key: string; status: 'error'; message: string }
  | { key: string; status: 'success'; data: RiskOverview };

export function ManagementDashboard({
  organizationId,
  onExpire,
}: {
  organizationId: string | null;
  onExpire: () => void;
}) {
  return (
    <DashboardContent key={organizationId} organizationId={organizationId} onExpire={onExpire} />
  );
}

function DashboardContent({
  organizationId,
  onExpire,
}: {
  organizationId: string | null;
  onExpire: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const key = `${organizationId}-${attempt}`;
  const [state, setState] = useState<State>({ key, status: 'loading' });
  useEffect(() => {
    if (!organizationId) return;
    const controller = new AbortController();
    let active = true;
    void request(
      `/organizations/${encodeURIComponent(organizationId)}/risk-overview`,
      riskOverviewSchema,
      { signal: controller.signal },
    )
      .then((data) => {
        if (!active) return;
        if (data.organizationId !== organizationId) throw new RequestError(502);
        setState({ key, status: 'success', data });
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof RequestError && error.status === 401) {
          onExpire();
          return;
        }
        setState({
          key,
          status: 'error',
          message:
            error instanceof RequestError
              ? error.message
              : 'Não foi possível carregar o inventário. Tente novamente.',
        });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [key, organizationId, onExpire]);

  if (!organizationId)
    return (
      <section className="surface empty-state">
        <p className="panel-label">SEU ESPAÇO DE GESTÃO</p>
        <h2>Uma visão clara começa pelo contexto</h2>
        <p>Selecione uma empresa para acompanhar sua estrutura e seu inventário de riscos.</p>
        <a className="action-link" href="#/empresas">
          Selecionar empresa →
        </a>
      </section>
    );
  const content =
    state.key !== key || state.status === 'loading' ? (
      <div className="surface dashboard-loading">
        <p role="status">Carregando indicadores do inventário…</p>
        <div className="dashboard-loading-lines" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
    ) : state.status === 'error' ? (
      <div className="feedback error" role="alert">
        <p>{state.message}</p>
        <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
          Tentar novamente
        </Button>
      </div>
    ) : (
      <InventorySnapshot data={state.data} />
    );
  return (
    <div className="management-dashboard">
      {content}
      <ActionMetrics
        key={`actions-${organizationId}`}
        organizationId={organizationId}
        onExpire={onExpire}
      />
      <RiskRegistrations key={organizationId} organizationId={organizationId} onExpire={onExpire} />
      <section className="dashboard-structure" aria-labelledby="dashboard-structure-heading">
        <div className="dashboard-section-heading">
          <div>
            <p className="panel-label">CONTEXTO ORGANIZACIONAL</p>
            <h2 id="dashboard-structure-heading">A base de cada registro</h2>
          </div>
          <span className="dashboard-section-index" aria-hidden="true">
            03
          </span>
        </div>
        <p className="chart-note">
          Estrutura consultada separadamente; seu horário de atualização pode diferir do inventário.
        </p>
        <OrganizationOverview
          key={organizationId}
          organizationId={organizationId}
          onExpire={onExpire}
        />
      </section>
    </div>
  );
}

function InventorySnapshot({ data }: { data: RiskOverview }) {
  const scope = useRef<HTMLDivElement>(null);
  usePresentationMotion(scope, data);
  const { totals } = data;
  const updatedAt = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(data.generatedAt));
  return (
    <div className="inventory-snapshot" ref={scope}>
      <div className="dashboard-context">
        <div>
          <p className="panel-label">DO CONTEXTO À AÇÃO</p>
          <h2>Seu inventário, em perspectiva.</h2>
          <p>Registros conectados às unidades e às fichas que preservam sua origem.</p>
        </div>
        <a className="dashboard-inventory-link" href="#/inventario?page=1">
          Ver inventário <span aria-hidden="true">↗</span>
        </a>
      </div>
      <p className="dashboard-timestamp">
        Snapshot do inventário · <time dateTime={data.generatedAt}>{updatedAt}</time> · horário
        local
      </p>
      <ul className="dashboard-metrics" aria-label="Indicadores do inventário">
        <MetricCard
          label="Registros ativos"
          value={totals.total}
          detail="Rascunhos + registrados"
          href="#/inventario?page=1"
          accent
        />
        <MetricCard
          label="Rascunhos"
          value={totals.draft}
          detail="Continuar o cadastro"
          href="#/inventario?page=1&status=DRAFT"
        />
        <MetricCard
          label="Registrados"
          value={totals.registered}
          detail="Consultar os registros"
          href="#/inventario?page=1&status=REGISTERED"
        />
        <MetricCard
          label="Sem ficha"
          value={totals.withoutEvaluation}
          detail="Acompanhar preenchimento"
          href="#/inventario?page=1&evaluationPresence=WITHOUT"
        />
      </ul>
      <p className="chart-note dashboard-scope">
        Indicadores operacionais de registros não arquivados; não medem nível de risco, saúde ou
        conformidade.
      </p>
      {totals.total === 0 && (
        <aside className="dashboard-empty">
          <h2>Seu inventário começa pelo primeiro registro</h2>
          <p>
            Consulte a estrutura e organize os riscos no inventário. Os gráficos acompanham os dados
            cadastrados.
          </p>
          <a className="action-link" href="#/inventario?page=1">
            Abrir inventário →
          </a>
        </aside>
      )}
      <div className="dashboard-charts">
        <OperationalBars units={data.units} />
        <CompletionRing total={totals.total} completed={totals.withEvaluation} />
      </div>
      <aside className="dashboard-next">
        <div>
          <p className="panel-label">PRÓXIMA AÇÃO</p>
          <h2>
            {totals.withoutEvaluation > 0
              ? `${totals.withoutEvaluation} registros aguardam ficha preliminar`
              : 'Acompanhe o contexto dos registros'}
          </h2>
          <p>
            Rascunhos e registros sem ficha permanecem visíveis. Arquivados são consultados pelo
            filtro explícito do inventário.
          </p>
        </div>
        <a className="action-link" href="#/inventario?page=1&evaluationPresence=WITHOUT">
          Ver registros sem ficha →
        </a>
      </aside>
    </div>
  );
}
