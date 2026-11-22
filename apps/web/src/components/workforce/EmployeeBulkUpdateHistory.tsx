import { useState } from 'react';
import { employeeBulkUpdateHistorySchema, type EmployeeBulkUpdateHistory } from '@renr/contracts';
import { Button } from '../ui/button';
import { Pagination } from '../ui/pagination';
import { StatusMessage } from '../ui/status-message';
import { useWorkforceData } from './useWorkforceData';

type HistoryProps = {
  organizationId: string;
  employeeId: string;
  onExpire: () => void;
};
type Snapshots = Pick<EmployeeBulkUpdateHistory['items'][number], 'before' | 'after'>;
const fields = [
  { key: 'name', label: 'Nome' },
  { key: 'unitName', label: 'Unidade' },
  { key: 'sectorName', label: 'Setor' },
] as const;
const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});
const pageSize = 10;

export function EmployeeFieldChanges({ before, after }: Snapshots) {
  const changed = fields.filter(({ key }) => before[key] !== after[key]);
  if (changed.length === 0) return null;
  return (
    <dl className="workforce-update-changes">
      {changed.map(({ key, label }) => (
        <div key={key}>
          <dt>{label}</dt>
          <dd>
            <span>Antes</span> {before[key]}
          </dd>
          <dd>
            <span>Depois</span> {after[key]}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function EmployeeBulkUpdateHistory(props: HistoryProps) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="workforce-update-history"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Histórico de atualizações por planilha</summary>
      {open && <HistoryContent {...props} />}
    </details>
  );
}

function HistoryContent({ organizationId, employeeId, onExpire }: HistoryProps) {
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const path = `/organizations/${organizationId}/employees/${employeeId}/bulk-update-history?page=${page}&pageSize=${pageSize}`;
  const { data, loading, error } = useWorkforceData(
    path,
    employeeBulkUpdateHistorySchema,
    organizationId,
    onExpire,
    attempt,
  );

  if (error) {
    return (
      <StatusMessage
        tone="error"
        action={
          <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
            Tentar novamente
          </Button>
        }
      >
        {error}
      </StatusMessage>
    );
  }
  if (loading || !data) return <StatusMessage tone="loading">Carregando histórico…</StatusMessage>;
  if (data.items.length === 0)
    return <StatusMessage>Este cadastro ainda não foi atualizado por planilha.</StatusMessage>;

  return (
    <>
      <ol className="workforce-update-revisions">
        {data.items.map((revision) => (
          <li key={revision.version}>
            <p>
              Versão {revision.version} ·{' '}
              <time dateTime={revision.confirmedAt}>
                {dateTime.format(new Date(revision.confirmedAt))}
              </time>
            </p>
            <EmployeeFieldChanges before={revision.before} after={revision.after} />
          </li>
        ))}
      </ol>
      {data.total > pageSize && (
        <Pagination
          label="Páginas do histórico"
          page={page}
          pageSize={pageSize}
          total={data.total}
          onPageChange={setPage}
        />
      )}
    </>
  );
}
