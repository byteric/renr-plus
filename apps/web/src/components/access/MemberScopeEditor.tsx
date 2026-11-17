import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  membershipScopesSchema,
  sectorListSchema,
  unitListSchema,
  updateMembershipScopesSchema,
  type AccessMembership,
  type MembershipScope,
  type MembershipScopes,
} from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { usePrivateQuery } from '../platform/usePrivateQuery';
import { Button } from '../ui/button';
import { Pagination } from '../ui/pagination';
import { StatusMessage } from '../ui/status-message';

type Shared = {
  member: AccessMembership;
  onSaved: (version: number) => void;
  onExpire: () => void;
  onDenied: () => void;
};

export function MemberScopeEditor({ member, onSaved, onExpire, onDenied }: Shared) {
  const [attempt, setAttempt] = useState(0);
  const path = `/organizations/${member.organizationId}/access-memberships/${member.userId}/scopes`;
  const scopes = usePrivateQuery(path, membershipScopesSchema, attempt, onExpire, onDenied);
  const reload = () => setAttempt((value) => value + 1);
  return (
    <section aria-label="Escopo por unidade ou setor" className="member-scope-editor">
      {scopes.error ? (
        <StatusMessage tone="error" action={<Button onClick={reload}>Atualizar recortes</Button>}>
          {scopes.error}
        </StatusMessage>
      ) : !scopes.data ? (
        <StatusMessage tone="loading">Carregando os recortes do vínculo…</StatusMessage>
      ) : (
        <MemberScopeForm
          key={attempt}
          current={scopes.data}
          path={path}
          member={member}
          onSaved={onSaved}
          onReload={reload}
          onExpire={onExpire}
          onDenied={onDenied}
        />
      )}
    </section>
  );
}

type NamedScope = MembershipScope & { unitName?: string; sectorName?: string | null };

function MemberScopeForm({
  current,
  member,
  path,
  onSaved,
  onReload,
  onExpire,
  onDenied,
}: Shared & {
  current: MembershipScopes;
  path: string;
  onReload: () => void;
}) {
  const [version, setVersion] = useState(current.version);
  const [restricted, setRestricted] = useState(current.restricted);
  const [scopes, setScopes] = useState<NamedScope[]>(current.scopes);
  const [unitId, setUnit] = useState('');
  const [sectorId, setSector] = useState('');
  const [unitPage, setUnitPage] = useState(1);
  const [sectorPage, setSectorPage] = useState(1);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const controller = useRef(new AbortController());
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    return () => current.abort();
  }, []);
  const units = usePrivateQuery(
    `/organizations/${member.organizationId}/units?isActive=true&page=${unitPage}&pageSize=50`,
    unitListSchema,
    attempt,
    onExpire,
    onDenied,
    member.organizationId,
  );
  const sectors = usePrivateQuery(
    unitId ? `/units/${unitId}/sectors?isActive=true&page=${sectorPage}&pageSize=50` : null,
    sectorListSchema,
    attempt,
    onExpire,
    onDenied,
    member.organizationId,
  );
  const unit = units.data?.items.find(({ id }) => id === unitId);
  const sector = sectors.data?.items.find(
    ({ id, unitId: parent }) => id === sectorId && parent === unitId,
  );
  const covered = scopes.some(
    (scope) => scope.unitId === unitId && (!scope.sectorId || scope.sectorId === sectorId),
  );

  function add() {
    if (!unit || (sectorId && !sector) || covered || scopes.length >= 100) return;
    setConfirmed(false);
    setNotice('');
    setScopes([
      ...scopes.filter((scope) => sector || scope.unitId !== unit.id),
      {
        unitId: unit.id,
        sectorId: sector?.id ?? null,
        unitName: unit.name,
        sectorName: sector?.name,
      },
    ]);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || conflict || (!scopes.length && !confirmed)) return;
    const input = updateMembershipScopesSchema.safeParse({
      expectedVersion: version,
      reason,
      scopes: scopes.map(({ unitId, sectorId }) => ({ unitId, sectorId })),
    });
    if (!input.success) {
      setError('Informe uma justificativa entre 3 e 1.000 caracteres.');
      return;
    }
    setError('');
    setNotice('');
    setPending(true);
    const { signal } = controller.current;
    try {
      const saved = await request(path, membershipScopesSchema, {
        method: 'PUT',
        body: JSON.stringify(input.data),
        signal,
      });
      if (signal.aborted) return;
      setVersion(saved.version);
      setRestricted(saved.restricted);
      setScopes(
        saved.scopes.map((scope) => ({
          ...scopes.find(
            ({ unitId, sectorId }) => unitId === scope.unitId && sectorId === scope.sectorId,
          ),
          ...scope,
        })),
      );
      setReason('');
      setConfirmed(false);
      setNotice(
        saved.scopes.length
          ? 'Recortes do vínculo atualizados.'
          : 'Todos os recortes do vínculo foram revogados.',
      );
      onSaved(saved.version);
    } catch (failure) {
      if (signal.aborted) return;
      if (failure instanceof RequestError && failure.status === 401) onExpire();
      else if (failure instanceof RequestError && failure.status === 403) onDenied();
      else if (failure instanceof RequestError && failure.status === 409) {
        setConflict(true);
        setError('O vínculo mudou. Recarregue os recortes antes de salvar.');
      } else
        setError(
          failure instanceof Error ? failure.message : 'Não foi possível salvar os recortes.',
        );
    } finally {
      if (!signal.aborted) setPending(false);
    }
  }
  return (
    <form
      className="access-editor"
      aria-label="Alterar recortes do vínculo"
      onSubmit={(event) => void save(event)}
    >
      <p className="muted">
        {restricted
          ? 'O vínculo permite consultar somente os recortes definidos abaixo.'
          : 'O vínculo atualmente tem acesso de leitura à empresa. Salvar recortes passa a limitar esse acesso.'}
      </p>
      <fieldset disabled={pending}>
        <legend>Adicionar recorte</legend>
        <label htmlFor="member-scope-unit">Unidade autorizada</label>
        <select
          id="member-scope-unit"
          value={unitId}
          onChange={(event) => {
            setUnit(event.target.value);
            setSector('');
            setSectorPage(1);
          }}
        >
          <option value="">Selecione uma unidade</option>
          {units.data?.items.map(({ id, name }) => (
            <option value={id} key={id}>
              {name}
            </option>
          ))}
        </select>
        {units.data && units.data.total > 50 && (
          <Pagination
            page={unitPage}
            pageSize={50}
            total={units.data.total}
            label="Páginas de unidades"
            onPageChange={(page) => {
              setUnitPage(page);
              setUnit('');
              setSector('');
              setSectorPage(1);
            }}
          />
        )}
        {unit && (
          <>
            <label htmlFor="member-scope-sector">Setor autorizado</label>
            <select
              id="member-scope-sector"
              value={sectorId}
              onChange={(event) => setSector(event.target.value)}
            >
              <option value="">Toda a unidade</option>
              {sectors.data?.items.map(({ id, name }) => (
                <option value={id} key={id}>
                  {name}
                </option>
              ))}
            </select>
            {sectors.data && sectors.data.total > 50 && (
              <Pagination
                page={sectorPage}
                pageSize={50}
                total={sectors.data.total}
                label="Páginas de setores"
                onPageChange={(page) => {
                  setSectorPage(page);
                  setSector('');
                }}
              />
            )}
          </>
        )}
        {(units.loading || sectors.loading) && (
          <StatusMessage tone="loading">Carregando estrutura…</StatusMessage>
        )}
        {(units.error || sectors.error) && (
          <StatusMessage
            tone="error"
            action={
              <Button onClick={() => setAttempt((value) => value + 1)}>Atualizar estrutura</Button>
            }
          >
            {units.error || sectors.error}
          </StatusMessage>
        )}
        <Button
          variant="outline"
          disabled={!unit || (!!sectorId && !sector) || covered || scopes.length >= 100}
          onClick={add}
        >
          Adicionar recorte
        </Button>
      </fieldset>
      {scopes.length > 0 ? (
        <ul className="member-scope-list" aria-label="Recortes selecionados">
          {scopes.map((scope) => {
            const label = `${scope.unitName ?? units.data?.items.find(({ id }) => id === scope.unitId)?.name ?? scope.unitId} · ${scope.sectorId ? (scope.sectorName ?? sectors.data?.items.find(({ id }) => id === scope.sectorId)?.name ?? scope.sectorId) : 'Toda a unidade'}`;
            return (
              <li key={`${scope.unitId}/${scope.sectorId}`}>
                <span>{label}</span>
                <Button
                  variant="outline"
                  aria-label={`Retirar ${label}`}
                  disabled={pending}
                  onClick={() => {
                    setScopes(scopes.filter((value) => value !== scope));
                    setConfirmed(false);
                    setNotice('');
                  }}
                >
                  Retirar
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <label className="access-check">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={pending}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          Confirmo deixar o vínculo sem acesso a unidades ou setores
        </label>
      )}
      <label htmlFor="member-scope-reason">Justificativa dos recortes</label>
      <textarea
        id="member-scope-reason"
        value={reason}
        required
        minLength={3}
        maxLength={1000}
        disabled={pending}
        onChange={(event) => setReason(event.target.value)}
      />
      {notice && <StatusMessage tone="success">{notice}</StatusMessage>}
      {error && (
        <StatusMessage
          tone="error"
          action={conflict ? <Button onClick={onReload}>Recarregar recortes</Button> : undefined}
        >
          {error}
        </StatusMessage>
      )}
      <div>
        <Button type="submit" disabled={pending || conflict || (!scopes.length && !confirmed)}>
          Salvar recortes
        </Button>
      </div>
    </form>
  );
}
