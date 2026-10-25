import { useState } from 'react';
import { accessMembershipListSchema, sectorListSchema, unitListSchema } from '@renr/contracts';
import { useActionData } from '../actions/useActionData';
import { Pagination } from '../ui/pagination';
import { Button } from '../ui/button';
import { StatusMessage } from '../ui/status-message';

type Reference = { id: string; organizationId: string; name: string; isActive: boolean };
type References = { items: Reference[]; total: number; page: number; pageSize: number };
const schemas: Record<'unit' | 'sector' | 'member', { parse: (value: unknown) => References }> = {
  unit: unitListSchema,
  sector: sectorListSchema,
  member: {
    parse(value) {
      const result = accessMembershipListSchema.parse(value);
      return {
        ...result,
        items: result.items.map((member) => ({
          id: member.userId,
          organizationId: member.organizationId,
          name: `${member.name} · ${member.email}`,
          isActive: member.isActive,
        })),
      };
    },
  },
};
const nouns = { unit: 'unidades', sector: 'setores', member: 'usuários' };

/** A bounded, paged selector: no first-page-only dropdown or unbounded download. */
export function ReferenceSelect({
  kind,
  organizationId,
  unitId,
  value,
  initialLabel,
  label,
  onChange,
  onExpire,
  includeInactive = false,
  required = false,
}: {
  kind: 'unit' | 'sector' | 'member';
  organizationId: string;
  unitId?: string;
  value: string;
  initialLabel?: string;
  label: string;
  onChange: (id: string) => void;
  onExpire: () => void;
  includeInactive?: boolean;
  required?: boolean;
}) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [attempt, setAttempt] = useState(0);
  const base =
    kind === 'unit'
      ? `/organizations/${organizationId}/units`
      : kind === 'member'
        ? `/organizations/${organizationId}/access-memberships`
        : unitId
          ? `/units/${unitId}/sectors`
          : null;
  const query = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (kind !== 'member') {
    if (!includeInactive) query.set('isActive', 'true');
    if (applied) query.set('search', applied);
  }
  const data = useActionData(
    base ? `${base}?${query}` : null,
    schemas[kind],
    organizationId,
    onExpire,
    attempt,
  );
  const inputId = `${kind}-${label.replace(/\s/g, '-').toLowerCase()}`;
  return (
    <div className="reference-select">
      <label htmlFor={inputId}>{label}</label>
      <select
        id={inputId}
        name={kind === 'member' ? 'linkedUserId' : `${kind}Id`}
        value={value}
        required={required}
        disabled={!base || data.loading || !!data.error}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{required ? 'Selecione uma opção' : 'Sem seleção'}</option>
        {value && !data.data?.items.some((item) => item.id === value) && (
          <option value={value}>{initialLabel || 'Vínculo atual (fora desta página)'}</option>
        )}
        {data.data?.items.map((item) => (
          <option
            key={item.id}
            value={item.id}
            disabled={!includeInactive && !item.isActive && item.id !== value}
          >
            {item.name}
            {!item.isActive ? ' · Inativo' : ''}
          </option>
        ))}
      </select>
      {!base && <span className="input-hint">Selecione uma unidade antes do setor.</span>}
      {data.loading && (
        <span role="status" className="input-hint">
          Carregando {nouns[kind]}…
        </span>
      )}
      {data.error && (
        <StatusMessage
          tone="error"
          action={
            <Button variant="outline" onClick={() => setAttempt((current) => current + 1)}>
              Recarregar {nouns[kind]}
            </Button>
          }
        >
          {data.error}
        </StatusMessage>
      )}
      {base && kind !== 'member' && (
        <details className="reference-search">
          <summary>Procurar em {nouns[kind]}</summary>
          <label htmlFor={`${inputId}-search`}>Buscar em {nouns[kind]}</label>
          <div className="reference-search-controls">
            <input
              id={`${inputId}-search`}
              type="search"
              maxLength={120}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Button
              variant="outline"
              onClick={() => {
                setApplied(search.trim());
                setPage(1);
              }}
            >
              Buscar opções
            </Button>
          </div>
        </details>
      )}
      {data.data && data.data.total > data.data.pageSize && (
        <Pagination
          label={`Paginação de ${nouns[kind]}`}
          page={page}
          pageSize={data.data.pageSize}
          total={data.data.total}
          onPageChange={setPage}
          pending={data.loading}
        />
      )}
    </div>
  );
}
