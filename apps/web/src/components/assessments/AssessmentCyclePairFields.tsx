import { useId, useState } from 'react';
import { assessmentCycleListSchema } from '@renr/contracts';
import { Pagination } from '../ui/pagination';
import { StatusMessage } from '../ui/status-message';
import { useWorkforceData } from '../workforce/useWorkforceData';
import './assessment-comparison.css';

export type CyclePair = { referenceCycleId: string; currentCycleId: string };

const cycleLabels = {
  referenceCycleId: 'Coleta de referência',
  currentCycleId: 'Coleta atual',
} as const;
const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

export function AssessmentCyclePairFields(props: {
  organizationId: string;
  unitId: string;
  sectorId: string;
  value: CyclePair;
  onChange: (value: CyclePair) => void;
  onExpire: () => void;
}) {
  return (
    <PairFields key={`${props.organizationId}:${props.unitId}:${props.sectorId}`} {...props} />
  );
}

function PairFields({
  organizationId,
  unitId,
  sectorId,
  value,
  onChange,
  onExpire,
}: Parameters<typeof AssessmentCyclePairFields>[0]) {
  const [page, setPage] = useState(1);
  const id = useId();
  const query = new URLSearchParams({ status: 'CLOSED', pageSize: '20', page: String(page) });
  if (unitId) query.set('unitId', unitId);
  if (sectorId) query.set('sectorId', sectorId);
  const list = useWorkforceData(
    `/organizations/${organizationId}/assessment-cycles?${query}`,
    assessmentCycleListSchema,
    organizationId,
    onExpire,
  );
  const cycles = list.data?.items.filter((entry) => entry.status === 'CLOSED') ?? [];
  return (
    <fieldset className="assessment-cycle-pair">
      <legend>Períodos da comparação</legend>
      <div className="assessment-cycle-pair-fields">
        {(['referenceCycleId', 'currentCycleId'] as const).map((key) => (
          <label key={key} htmlFor={`${id}-${key}`}>
            {cycleLabels[key]}
            <select
              id={`${id}-${key}`}
              value={value[key]}
              disabled={list.loading || !!list.error}
              onChange={(event) => onChange({ ...value, [key]: event.target.value })}
            >
              <option value="">Selecione uma coleta</option>
              {value[key] && !cycles.some((cycle) => cycle.id === value[key]) && (
                <option value={value[key]}>Coleta selecionada (fora da página)</option>
              )}
              {cycles.map((cycle) => (
                <option key={cycle.id} value={cycle.id}>
                  {cycle.name} · {cycle.sectorName} ·{' '}
                  {date.format(new Date(cycle.closedAt ?? cycle.endsAt))}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {list.loading && <StatusMessage tone="loading">Carregando coletas encerradas…</StatusMessage>}
      {list.error && <StatusMessage tone="error">{list.error}</StatusMessage>}
      {list.data?.total === 0 && <p className="input-hint">Nenhuma coleta encerrada no recorte.</p>}
      {!!list.data && list.data.total > 20 && (
        <Pagination
          label="Páginas de coletas encerradas"
          page={page}
          pageSize={20}
          total={list.data.total}
          pending={list.loading}
          onPageChange={setPage}
        />
      )}
    </fieldset>
  );
}
