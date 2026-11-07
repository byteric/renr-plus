import { fiscalLabels } from '../../lib/fiscal-labels';
import { useRef } from 'react';
import { peopleOverviewSchema, type PeopleDistribution, type PeopleMetric } from '@renr/contracts';
import { usePresentationMotion } from '../../hooks/usePresentationMotion';
import { Button } from '../ui/button';
import { StatusMessage } from '../ui/status-message';
import { usePeopleData, money, civil } from './usePeopleData';

const metricStates = {
  KNOWN: 'Informado',
  INSUFFICIENT_DATA: 'Dados insuficientes',
  SUPPRESSED: 'Suprimido por privacidade',
  FORBIDDEN: 'Sem permissão',
  UNCONFIGURED: 'Não configurado',
};
const labels = {
  averageAge: 'Idade média',
  averageTenureMonths: 'Tempo médio de vínculo',
  genderCoveragePercent: 'Cobertura de gênero',
  salaryMassCents: 'Massa salarial',
  averageSalaryCents: 'Salário médio',
  terminationGrossCents: 'Estimativa rescisória bruta',
  vacationOverdue: 'Férias vencidas',
  vacationUnknown: 'Histórico de férias desconhecido',
  vacationDueSoon: 'Férias próximas do vencimento',
};
const indicatorGroups: {
  label: string;
  description: string;
  metrics: (keyof typeof labels)[];
  distributions: string[];
}[] = [
  {
    label: 'Perfil',
    description: 'Idade e gênero',
    metrics: ['averageAge', 'genderCoveragePercent'],
    distributions: ['age', 'gender'],
  },
  {
    label: 'Vínculo e remuneração',
    description: 'Tempo de casa, salários e estimativa rescisória',
    metrics: [
      'averageTenureMonths',
      'salaryMassCents',
      'averageSalaryCents',
      'terminationGrossCents',
    ],
    distributions: ['tenure'],
  },
  {
    label: 'Férias',
    description: 'Vencimentos e cobertura do histórico',
    metrics: ['vacationOverdue', 'vacationDueSoon', 'vacationUnknown'],
    distributions: ['vacation'],
  },
  {
    label: 'Unidades e setores',
    description: 'Distribuição dos registros da empresa',
    metrics: [],
    distributions: ['unit', 'sector'],
  },
];
type OpenDistribution = (dimension: 'unit' | 'sector', id: string, label: string) => void;
function metricValue(key: string, metric: PeopleMetric) {
  if (metric.state !== 'KNOWN' || metric.value === null) return metricStates[metric.state];
  if (key.endsWith('Cents')) return money(metric.value);
  if (key === 'averageAge') return `${metric.value} anos`;
  if (key === 'averageTenureMonths') return `${metric.value} meses`;
  if (key.endsWith('Percent')) return `${metric.value}%`;
  return metric.value;
}
export function PeopleOverview({
  organizationId,
  query,
  onOpenDistribution,
  revision,
  onExpire,
  onDenied,
}: {
  organizationId: string;
  query: string;
  onOpenDistribution?: OpenDistribution;
  revision: number;
  onExpire: () => void;
  onDenied: () => void;
}) {
  const overview = usePeopleData(
    `/organizations/${organizationId}/people-overview${query ? `?${query}` : ''}`,
    peopleOverviewSchema,
    organizationId,
    onExpire,
    onDenied,
    revision,
  );
  const scope = useRef<HTMLElement>(null);
  usePresentationMotion(scope, overview.data);
  if (overview.loading)
    return <StatusMessage tone="loading">Carregando indicadores protegidos…</StatusMessage>;
  if (overview.error)
    return (
      <StatusMessage tone="error">
        {overview.error} Use Atualizar dados para tentar novamente.
      </StatusMessage>
    );
  if (!overview.data) return null;
  const data = overview.data;
  const ungrouped = data.distributions.filter(
    ({ key }) => !indicatorGroups.some(({ distributions }) => distributions.includes(key)),
  );
  return (
    <section ref={scope} className="people-overview" aria-labelledby="people-overview-title">
      <h3 id="people-overview-title">Visão de pessoas</h3>
      <p>
        <strong>{data.registration.name}</strong> · CNPJ{' '}
        {data.registration.fiscalIdentifier || 'não informado'} ·{' '}
        {fiscalLabels[data.registration.fiscalState]} · referência {civil(data.referenceDate)} ·
        competência {data.competence} · {data.timeZone}
      </p>
      <section aria-label="Registros no recorte">
        <dl className="people-population">
          <div>
            <dt>Total de registros</dt>
            <dd>{data.population.total}</dd>
          </div>
          <div>
            <dt>Ativos</dt>
            <dd>{data.population.active}</dd>
          </div>
          <div>
            <dt>Inativos</dt>
            <dd>{data.population.inactive}</dd>
          </div>
        </dl>
      </section>
      <p>Valores desconhecidos, suprimidos e proibidos não são tratados como zero.</p>
      {indicatorGroups.map((group) => {
        const distributions = data.distributions.filter(({ key }) =>
          group.distributions.includes(key),
        );
        if (!group.metrics.length && !distributions.length) return null;
        return (
          <details key={group.label} className="people-indicator-group" name="people-indicators">
            <summary>
              <span>{group.label}</span>
              <small>{group.description}</small>
            </summary>
            <div className="people-indicator-content">
              {group.metrics.length > 0 && (
                <div className="people-metrics">
                  {group.metrics.map((key) => {
                    const metric = data.metrics[key];
                    return (
                      <article className="people-metric" key={key}>
                        <h4>{labels[key]}</h4>
                        <strong data-motion-value={metric.state === 'KNOWN' ? '' : undefined}>
                          {metricValue(key, metric)}
                        </strong>
                        <p>{metric.explanation}</p>
                        {metric.known !== null && (
                          <small>
                            {metric.known} conhecidos
                            {metric.missing !== null ? ` · ${metric.missing} sem informação` : ''}
                          </small>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
              <PeopleDistributions items={distributions} onOpenDistribution={onOpenDistribution} />
            </div>
          </details>
        );
      })}
      {ungrouped.length > 0 && (
        <details className="people-indicator-group" name="people-indicators">
          <summary>Outras distribuições</summary>
          <div className="people-indicator-content">
            <PeopleDistributions items={ungrouped} onOpenDistribution={onOpenDistribution} />
          </div>
        </details>
      )}
      <details className="people-indicator-group" name="people-indicators">
        <summary>Política e critérios dos indicadores</summary>
        <aside className="people-policy">
          <strong>Política {data.settlementPolicy.version}</strong>
          <p>
            Cenário: {data.settlementPolicy.scenario}. Estimativas não substituem conferência
            técnica.
          </p>
          <ul>
            {data.settlementPolicy.limitations.map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
          </ul>
          <p>Privacidade: {data.privacyPolicy}.</p>
        </aside>
      </details>
    </section>
  );
}

function PeopleDistributions({
  items,
  onOpenDistribution,
}: {
  items: PeopleDistribution[];
  onOpenDistribution?: OpenDistribution;
}) {
  if (!items.length) return null;
  return (
    <div className="people-distributions">
      {items.map((distribution) => {
        const known = distribution.state === 'KNOWN';
        const dimension =
          distribution.key === 'unit' || distribution.key === 'sector' ? distribution.key : null;
        const maximum = Math.max(
          1,
          ...distribution.items.map((item) => (known ? (item.count ?? 0) : 0)),
        );
        return (
          <section key={distribution.key} className="people-distribution">
            <h4>{distribution.label}</h4>
            {!known && <p>{metricStates[distribution.state]}</p>}
            {known && distribution.items.some((item) => item.count !== null) && (
              <div className="people-chart" aria-hidden="true">
                {distribution.items
                  .filter((item) => item.count !== null)
                  .map((item) => (
                    <div key={item.key}>
                      <span>{item.label}</span>
                      <i
                        data-chart-bar=""
                        style={{ width: `${((item.count ?? 0) / maximum) * 100}%` }}
                      />
                    </div>
                  ))}
              </div>
            )}
            {known && distribution.items.length === 0 && <p>Nenhuma categoria no recorte.</p>}
            {distribution.items.length > 0 && (
              <table aria-label={distribution.label}>
                <thead>
                  <tr>
                    <th scope="col">Categoria</th>
                    <th scope="col">Registros</th>
                  </tr>
                </thead>
                <tbody>
                  {distribution.items.map((item) => (
                    <tr key={item.key}>
                      <th scope="row">
                        {known &&
                        dimension &&
                        onOpenDistribution &&
                        item.count !== null &&
                        item.count > 0 ? (
                          <Button
                            variant="outline"
                            aria-label={`Ver colaboradores de ${item.label}`}
                            onClick={() => onOpenDistribution(dimension, item.key, item.label)}
                          >
                            {item.label}
                          </Button>
                        ) : (
                          item.label
                        )}
                      </th>
                      <td>
                        {known && item.count !== null
                          ? item.count
                          : known
                            ? 'Não divulgado'
                            : metricStates[distribution.state]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </div>
  );
}
