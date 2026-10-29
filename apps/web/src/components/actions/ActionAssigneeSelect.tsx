import { useState } from 'react';
import { actionAssigneeListSchema } from '@renr/contracts';
import { Button } from '../ui/button';
import { useActionData } from './useActionData';

export function ActionAssigneeSelect({
  organizationId,
  value,
  onChange,
  onExpire,
  disabled,
}: {
  organizationId: string;
  value: string;
  onChange: (value: string) => void;
  onExpire: () => void;
  disabled: boolean;
}) {
  const [page, setPage] = useState(1);
  const members = useActionData(
    `/organizations/${organizationId}/action-assignees?page=${page}&pageSize=50`,
    actionAssigneeListSchema,
    organizationId,
    onExpire,
  );
  return (
    <div className="risk-stack">
      <label htmlFor="action-assignee">Membro atribuído (opcional)</label>
      <select
        id="action-assignee"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled || members.loading}
      >
        <option value="">Sem atribuição</option>
        {value && !members.data?.items.some((entry) => entry.userId === value) && (
          <option value={value}>Membro selecionado · {value}</option>
        )}
        {members.data?.items.map((entry) => (
          <option key={entry.userId} value={entry.userId}>
            {entry.name}
            {entry.canExecute ? '' : ' · Sem capacidade de execução'}
          </option>
        ))}
      </select>
      <p className="field-hint">
        Somente membros ativos. Atribuir não concede permissões adicionais.
      </p>
      {members.error && <p role="alert">{members.error}</p>}
      {members.loading && <p role="status">Carregando membros…</p>}
      {members.data && members.data.total > 50 && (
        <div className="record-actions">
          <Button
            variant="outline"
            disabled={disabled || page === 1}
            onClick={() => setPage(page - 1)}
          >
            Membros anteriores
          </Button>
          <Button
            variant="outline"
            disabled={disabled || page * 50 >= members.data.total}
            onClick={() => setPage(page + 1)}
          >
            Mais membros
          </Button>
        </div>
      )}
    </div>
  );
}
