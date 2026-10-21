import { useEffect, useState } from 'react';
import { organizationOverviewSchema, type OrganizationOverview as Overview } from '@renr/contracts';
import { request, RequestError } from '../lib/api';
import { Button } from './ui/button';
import '../overview.css';

type State =
  | { status: 'loading'; key: string }
  | { status: 'success'; key: string; data: Overview }
  | { status: 'error'; key: string; message: string };

export function OrganizationOverview({
  organizationId,
  onExpire,
}: {
  organizationId: string | null;
  onExpire: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const key = `${organizationId}-${attempt}`;
  const [state, setState] = useState<State>({ status: 'loading', key });
  useEffect(() => {
    if (!organizationId) return;
    const controller = new AbortController();
    let active = true;
    void request(
      `/organizations/${encodeURIComponent(organizationId)}/overview`,
      organizationOverviewSchema,
      { signal: controller.signal },
    )
      .then((data) => {
        if (!active) return;
        if (data.organization.id !== organizationId) throw new RequestError(502);
        setState({ status: 'success', key, data });
      })
      .catch((failure: unknown) => {
        if (!active) return;
        if (failure instanceof RequestError && failure.status === 401) {
          onExpire();
          return;
        }
        setState({
          status: 'error',
          key,
          message:
            failure instanceof RequestError
              ? failure.message
              : 'Não foi possível carregar o painel. Tente novamente.',
        });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [organizationId, key, onExpire]);

  if (!organizationId)
    return (
      <div className="surface empty-state">
        <h2>Primeiro, selecione uma empresa</h2>
        <p>Selecione uma empresa para consultar seus indicadores de cadastro.</p>
        <a href="#/empresas">Ir para Empresas →</a>
      </div>
    );
  if (state.key !== key || state.status === 'loading')
    return (
      <p className="surface" role="status">
        Carregando painel…
      </p>
    );
  if (state.status === 'error')
    return (
      <div className="feedback error" role="alert">
        <p>{state.message}</p>
        <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
          Tentar novamente
        </Button>
      </div>
    );

  const { data } = state;
  const updatedAt = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZoneName: undefined,
  }).format(new Date(data.generatedAt));
  return (
    <div className="organization-overview">
      <section className="surface overview-context" aria-labelledby="overview-company">
        <div>
          <p className="panel-label">EMPRESA EM FOCO</p>
          <h2 id="overview-company">{data.organization.name}</h2>
          <span className={`badge ${data.organization.isActive ? 'active' : ''}`}>
            {data.organization.isActive ? 'Empresa ativa' : 'Empresa inativa'}
          </span>
        </div>
        <p className="muted overview-updated">
          Atualizado em <time dateTime={data.generatedAt}>{updatedAt}</time>
          <span>Horário local do seu dispositivo</span>
        </p>
      </section>
      <section aria-labelledby="overview-counts">
        <h2 id="overview-counts">Estrutura cadastrada</h2>
        <dl className="overview-metrics">
          <div className="surface overview-metric">
            <dt>Unidades cadastradas</dt>
            <dd>{data.units.total}</dd>
          </div>
          <div className="surface overview-metric">
            <dt>Setores cadastrados</dt>
            <dd>{data.sectors.total}</dd>
          </div>
          <div className="surface overview-metric">
            <dt>Unidades sem setores</dt>
            <dd>{data.unitsWithoutSectors}</dd>
          </div>
        </dl>
        <p className="muted overview-hint">
          Unidades sem setores considera todas as unidades, ativas e inativas, sem nenhum setor
          cadastrado.
        </p>
      </section>
      {data.units.total === 0 && (
        <div className="surface empty-state">
          <h2>A estrutura ainda está vazia</h2>
          <p>
            Nenhuma unidade foi cadastrada nesta empresa. Os indicadores serão atualizados conforme
            os cadastros forem incluídos.
          </p>
          <a href="#/unidades">Consultar unidades →</a>
        </div>
      )}
      <section className="surface overview-status" aria-labelledby="overview-status">
        <h2 id="overview-status">Situação dos cadastros</h2>
        <div className="overview-status-grid">
          <div>
            <h3>Unidades</h3>
            <dl className="overview-breakdown">
              <div>
                <dt>Ativas</dt>
                <dd>{data.units.active}</dd>
              </div>
              <div>
                <dt>Inativas</dt>
                <dd>{data.units.inactive}</dd>
              </div>
            </dl>
          </div>
          <div>
            <h3>Setores</h3>
            <dl className="overview-breakdown">
              <div>
                <dt>Ativos</dt>
                <dd>{data.sectors.active}</dd>
              </div>
              <div>
                <dt>Inativos</dt>
                <dd>{data.sectors.inactive}</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>
      <aside className="overview-scope" aria-labelledby="overview-scope">
        <h2 id="overview-scope">Indicadores de cadastro</h2>
        <p>
          Estes números descrevem a estrutura organizacional e não representam avaliação de riscos
          nem conformidade com a NR-01.
        </p>
      </aside>
      <nav className="overview-links" aria-label="Cadastros da empresa">
        <a className="action-link" href="#/unidades">
          Consultar unidades e setores →
        </a>
        <a className="action-link" href="#/empresas">
          Consultar empresas →
        </a>
      </nav>
    </div>
  );
}
