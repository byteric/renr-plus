import { useState } from 'react';
import {
  assessmentComparisonQuerySchema,
  assessmentComparisonSchema,
  type AssessmentComparison as Comparison,
  type AssessmentComparisonReason,
  type AssessmentComparisonTrend,
} from '@renr/contracts';
import { comparisonHash, comparisonQuery } from '../../lib/assessment-comparison-location';
import { actionLabels, civilDate } from '../actions/useActionData';
import { Button } from '../ui/button';
import { StatusMessage } from '../ui/status-message';
import { ReferenceSelect } from '../workforce/ReferenceSelect';
import { useWorkforceData } from '../workforce/useWorkforceData';
import { AssessmentCyclePairFields, type CyclePair } from './AssessmentCyclePairFields';
import './assessment-comparison.css';

export type ComparisonSelection = CyclePair & { unitId: string; sectorId: string };
const emptyPair: CyclePair = { referenceCycleId: '', currentCycleId: '' };
const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const delta = new Intl.NumberFormat('pt-BR', {
  signDisplay: 'exceptZero',
  maximumFractionDigits: 2,
});
const percent = (value: number) => `${number.format(value)}%`;

const reasons: Record<AssessmentComparisonReason, string> = {
  SAME_CYCLE: 'Escolha duas coletas diferentes.',
  OPEN_CYCLE: 'As duas coletas precisam estar encerradas.',
  SCOPE_MISMATCH: 'As coletas pertencem a unidades, setores ou grupos diferentes.',
  INSTRUMENT_VERSION: 'As coletas usaram versões diferentes do instrumento.',
  POLICY_VERSION: 'As coletas usaram versões diferentes da política de consolidação.',
  PERIOD_ORDER: 'Escolha uma referência anterior à coleta atual e períodos sem sobreposição.',
};
const trendLabel = { INCREASE: 'Aumentou', DECREASE: 'Diminuiu', STABLE: 'Estável' };
const withheld = {
  PROTECTED: 'Variação protegida',
  UNKNOWN_BASE: 'Base indisponível',
  NOT_COMPARABLE: 'Comparação indisponível',
};
const direction = {
  IMPROVED: 'Melhora na classificação',
  WORSENED: 'Piora na classificação',
  STABLE: 'Classificação estável',
  NOT_COMPARABLE: 'Classificações sem comparação',
};

function queryFor(selection: ComparisonSelection) {
  const { unitId, sectorId, ...pair } = selection;
  return assessmentComparisonQuerySchema.safeParse({
    ...pair,
    ...(unitId ? { unitId } : {}),
    ...(sectorId ? { sectorId } : {}),
  });
}

function TrendCells({ trend }: { trend: AssessmentComparisonTrend }) {
  return trend.status === 'AVAILABLE' ? (
    <>
      <td>{percent(trend.reference)}</td>
      <td>{percent(trend.current)}</td>
      <td>
        <strong>{delta.format(trend.difference)} p.p.</strong> · {trendLabel[trend.direction]}
      </td>
    </>
  ) : (
    <td colSpan={3}>{withheld[trend.status]}</td>
  );
}

function OperationComparison({
  result,
  returnTo,
  location,
}: {
  result: Extract<Comparison, { status: 'COMPARABLE' }>;
  returnTo: string;
  location: URLSearchParams;
}) {
  const { operations } = result;
  const implemented = [
    ['implemented', 'Ações implementadas'],
    ['pending', 'Ações pendentes'],
    ['cancelled', 'Ações canceladas'],
    ['withoutSnapshot', 'Ações sem retrato na data'],
    ['effective', 'Parecer eficaz'],
    ['notEffective', 'Parecer não eficaz'],
    ['inconclusive', 'Parecer inconclusivo'],
    ['withoutOpinion', 'Sem parecer registrado'],
    ['unclassifiedRisks', 'Riscos sem classificação registrada'],
  ] as const;
  const context = new URLSearchParams(location);
  context.set('returnTo', returnTo);
  return (
    <section className="assessment-result-node" aria-label="Riscos e medidas">
      <h3>Riscos e medidas</h3>
      <p>
        Registros do grupo em cada encerramento. As reavaliações e os pareceres técnicos mostram a
        evolução documentada dos riscos e das medidas.
      </p>
      <div
        className="assessment-compare-scroll"
        tabIndex={0}
        role="region"
        aria-label="Tabela de medidas"
      >
        <table aria-label="Ações, eficácia e lacunas">
          <thead>
            <tr>
              <th scope="col">Indicador</th>
              <th scope="col">Referência</th>
              <th scope="col">Atual</th>
            </tr>
          </thead>
          <tbody>
            {implemented.map(([key, label]) => (
              <tr key={key}>
                <th scope="row">{label}</th>
                <td>{operations.reference[key]}</td>
                <td>{operations.current[key]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="assessment-cycle-facts">
        {(['reference', 'current'] as const).map((key) => (
          <section key={key}>
            <h4>Níveis registrados · {key === 'reference' ? 'referência' : 'atual'}</h4>
            {operations[key].riskLevels.length ? (
              <ul>
                {operations[key].riskLevels.map(({ methodVersionId, methodName, level, total }) => (
                  <li key={`${methodVersionId}:${level}`}>
                    {methodName} · {level} · {total}
                  </li>
                ))}
              </ul>
            ) : (
              <p>Sem níveis técnicos registrados neste período.</p>
            )}
          </section>
        ))}
      </div>
      {operations.reassessments.length > 0 && (
        <section aria-label="Reavaliações técnicas">
          <h4>Reavaliações técnicas</h4>
          <p>
            Exibindo {operations.reassessments.length} de {operations.reassessmentTotal} no período
            atual.
          </p>
          <ul className="assessment-compare-records">
            {operations.reassessments.map((entry) => (
              <li key={entry.id}>
                <a href={`#/inventario/${entry.riskId}?${context}`}>{entry.riskLabel}</a>
                <p>
                  {direction[entry.direction]} · {date.format(new Date(entry.recordedAt))}
                </p>
                {entry.referenceLevel && entry.currentLevel && (
                  <p>
                    {entry.referenceLevel} → {entry.currentLevel}
                  </p>
                )}
                {entry.actionIds.map((id, index) => (
                  <a key={id} href={`#/acoes/${id}?${context}`}>
                    Abrir ação vinculada {index + 1}
                  </a>
                ))}
              </li>
            ))}
          </ul>
        </section>
      )}
      {operations.relatedActions.length > 0 && (
        <section aria-label="Ações com origem documentada">
          <h4>Ações com origem documentada</h4>
          <p>
            Situação atual das ações de riscos que citam uma das duas coletas em avaliação técnica.
          </p>
          <ul className="assessment-compare-records">
            {operations.relatedActions.map((entry) => (
              <li key={`${entry.cycleId}:${entry.actionId}`}>
                <a href={`#/acoes/${entry.actionId}?${context}`}>{entry.actionTitle}</a>
                <p>
                  {entry.cycleId === result.reference.id ? 'Coleta de referência' : 'Coleta atual'}{' '}
                  · {actionLabels[entry.status]} · prazo {civilDate(entry.dueDate)}
                </p>
                <a href={`#/inventario/${entry.riskId}?${context}`}>{entry.riskLabel}</a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <nav className="assessment-cycle-actions" aria-label="Registros do recorte">
        <a href={`#/inventario?${location}`}>Ver riscos do recorte</a>
        <a href={`#/acoes?${location}`}>Ver ações do recorte</a>
      </nav>
    </section>
  );
}

export function AssessmentComparison({
  organizationId,
  selection,
  onCompare,
  onExpire,
}: {
  organizationId: string;
  selection: ComparisonSelection;
  onCompare: (value: ComparisonSelection) => void;
  onExpire: () => void;
}) {
  const [draft, setDraft] = useState(selection);
  const [attempt, setAttempt] = useState(0);
  const query = queryFor(selection);
  const data = useWorkforceData(
    query.success
      ? `/organizations/${organizationId}/assessment-comparison?${comparisonQuery(query.data)}`
      : null,
    assessmentComparisonSchema,
    organizationId,
    onExpire,
    attempt,
  );
  const valid =
    data.data?.reference.id === selection.referenceCycleId &&
    data.data.current.id === selection.currentCycleId;
  const result = valid ? data.data : null;
  const ready = queryFor(draft).success;
  const returnTo = query.success ? comparisonHash(query.data) : '#/coletas?view=comparison';
  const scoped =
    result?.status === 'COMPARABLE'
      ? new URLSearchParams({ unitId: result.scope.unitId, sectorId: result.scope.sectorId })
      : null;
  return (
    <section className="assessment-compare" aria-label="Comparativo gerencial">
      <h2>Comparativo gerencial</h2>
      <p>
        Selecione duas coletas encerradas do mesmo grupo, com as mesmas versões de instrumento e
        política.
      </p>
      <form
        className="assessment-cycle-form assessment-cycle-confirm"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) {
            onCompare(draft);
            setAttempt((value) => value + 1);
          }
        }}
      >
        <div className="assessment-cycle-facts">
          <ReferenceSelect
            kind="unit"
            label="Unidade da comparação"
            organizationId={organizationId}
            value={draft.unitId}
            includeInactive
            onExpire={onExpire}
            onChange={(unitId) => setDraft({ ...emptyPair, unitId, sectorId: '' })}
          />
          <ReferenceSelect
            key={draft.unitId}
            kind="sector"
            label="Setor da comparação"
            organizationId={organizationId}
            value={draft.sectorId}
            unitId={draft.unitId}
            includeInactive
            onExpire={onExpire}
            onChange={(sectorId) => setDraft({ ...draft, ...emptyPair, sectorId })}
          />
        </div>
        <AssessmentCyclePairFields
          organizationId={organizationId}
          unitId={draft.unitId}
          sectorId={draft.sectorId}
          value={draft}
          onExpire={onExpire}
          onChange={(pair) => setDraft({ ...draft, ...pair })}
        />
        <div className="assessment-cycle-actions">
          <Button type="submit" disabled={!ready || data.loading}>
            Comparar períodos
          </Button>
        </div>
      </form>
      {data.loading && <StatusMessage tone="loading">Consultando os períodos…</StatusMessage>}
      {(data.error || (data.data && !result)) && (
        <StatusMessage tone="error">
          {data.error || 'A resposta não corresponde às coletas selecionadas.'}
        </StatusMessage>
      )}
      {result && (
        <section className="assessment-compare" aria-label="Resultado do comparativo">
          <div className="assessment-cycle-facts">
            {(['reference', 'current'] as const).map((key) => {
              const period = result[key];
              const params = new URLSearchParams(scoped ?? undefined);
              params.set('cycle', period.id);
              params.set('returnTo', returnTo);
              return (
                <section className="assessment-result-node" key={key}>
                  <h3>
                    {key === 'reference' ? 'Referência' : 'Atual'} · {period.name}
                  </h3>
                  <p>
                    {date.format(new Date(period.startsAt))} até{' '}
                    {date.format(
                      new Date(
                        Math.min(
                          Date.parse(period.endsAt),
                          period.closedAt ? Date.parse(period.closedAt) : Infinity,
                        ),
                      ),
                    )}
                  </p>
                  <a href={`#/coletas?${params}`}>
                    Abrir coleta {key === 'reference' ? 'de referência' : 'atual'}
                  </a>
                </section>
              );
            })}
          </div>
          {result.status === 'INCOMPATIBLE' && (
            <section className="assessment-result-node">
              <h3>Períodos incompatíveis</h3>
              <ul>
                {result.reasons.map((reason) => (
                  <li key={reason}>{reasons[reason]}</li>
                ))}
              </ul>
            </section>
          )}
          {result.status === 'COMPARABLE' && scoped && (
            <>
              <p>
                {result.scope.unitName} · {result.scope.sectorName} · {result.scope.groupName}
              </p>
              <section className="assessment-result-node" aria-label="Indicadores comparáveis">
                <h3>Adesão e fatores pesquisados</h3>
                <p>
                  Variações em pontos percentuais. A evolução técnica do risco é verificada nas
                  reavaliações registradas.
                </p>
                <div
                  className="assessment-compare-scroll"
                  role="region"
                  aria-label="Tabela de indicadores"
                  tabIndex={0}
                >
                  <table aria-label="Adesão e fatores pesquisados">
                    <thead>
                      <tr>
                        <th scope="col">Indicador</th>
                        <th scope="col">Referência</th>
                        <th scope="col">Atual</th>
                        <th scope="col">Variação</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <th scope="row">Adesão sobre a base elegível de cada ciclo</th>
                        <TrendCells trend={result.participation} />
                      </tr>
                      {result.factors.map((factor) => (
                        <tr key={`${factor.questionId}:${factor.optionId}`}>
                          <th scope="row">
                            {factor.questionLabel} · {factor.optionLabel}
                          </th>
                          <TrendCells trend={factor.trend} />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <OperationComparison result={result} returnTo={returnTo} location={scoped} />
              <a
                href={`#/relatorios?summary=executive&${comparisonQuery({ referenceCycleId: result.reference.id, currentCycleId: result.current.id, unitId: result.scope.unitId, sectorId: result.scope.sectorId })}`}
              >
                Incluir no resumo executivo
              </a>
            </>
          )}
        </section>
      )}
    </section>
  );
}
