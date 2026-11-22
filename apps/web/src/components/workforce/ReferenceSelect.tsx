import { useEffect, useId, useState } from 'react';
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
  clearIncompatible = false,
  error,
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
  clearIncompatible?: boolean;
  error?: string;
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
  const pageSize = kind === 'member' ? '20' : '100';
  const query = new URLSearchParams({ page: String(page), pageSize });
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
  const loadedItems = data.data?.items;
  const sameContext =
    !loadedItems || loadedItems.every((item) => item.organizationId === organizationId);
  const fullyLoaded =
    !!data.data &&
    sameContext &&
    !data.loading &&
    !data.error &&
    !applied &&
    page === 1 &&
    data.data.page === 1 &&
    data.data.total <= data.data.pageSize;
  const incompatibleActive =
    clearIncompatible &&
    !includeInactive &&
    !!value &&
    fullyLoaded &&
    !loadedItems?.some((item) => item.id === value && item.isActive);

  useEffect(() => {
    if (incompatibleActive) {
      onChange('');
    }
  }, [incompatibleActive, onChange]);

  const inputId = useId();
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const emptyList = !!base && !data.loading && !data.error && data.data?.items.length === 0;
  const describedBy = [error ? errorId : null, !base || emptyList ? hintId : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="reference-select">
      <label htmlFor={inputId}>{label}</label>
      <select
        id={inputId}
        name={kind === 'member' ? 'linkedUserId' : `${kind}Id`}
        value={incompatibleActive ? '' : value}
        required={required}
        disabled={!base || data.loading || !!data.error}
        aria-invalid={!!error}
        aria-describedby={describedBy || undefined}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{required ? 'Selecione uma opção' : 'Sem seleção'}</option>
        {value && !data.data?.items.some((item) => item.id === value) && !incompatibleActive && (
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
      {error && (
        <span id={errorId} className="field-error">
          {error}
        </span>
      )}
      {!base && (
        <span id={hintId} className="input-hint">
          Selecione uma unidade antes do setor.
        </span>
      )}
      {data.loading && (
        <span role="status" className="input-hint">
          Carregando {nouns[kind]}…
        </span>
      )}
      {emptyList && (
        <span id={hintId} role="status" className="input-hint">
          {applied
            ? `Nenhum resultado ativo em ${nouns[kind]} para a busca informada.`
            : kind === 'sector'
              ? 'Nenhum setor ativo cadastrado nesta unidade. Cadastre ou reative um setor na estrutura antes de salvar.'
              : kind === 'unit'
                ? 'Nenhuma unidade ativa cadastrada nesta empresa. Cadastre ou reative uma unidade antes de salvar.'
                : 'Nenhum usuário disponível nesta empresa.'}
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
