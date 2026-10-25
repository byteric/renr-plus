import { useEffect, useRef, useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  assessmentGroupListSchema,
  assessmentGroupSchema,
  employeeListSchema,
  employeeSchema,
  sessionCapabilitiesSchema,
  type SessionResponse,
} from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { useWorkforceData } from './useWorkforceData';
import { Button } from '../ui/button';
import { StatusMessage } from '../ui/status-message';
import { StatusBadge } from '../ui/status-badge';
import { Pagination } from '../ui/pagination';
import { ReferenceSelect } from './ReferenceSelect';
import { WorkforceEditor, type WorkforceItem, type WorkforceKind } from './WorkforceEditor';
import { resource } from './workforce-paths';
import './workforce.css';

type Filters = {
  search: string;
  isActive: string;
  unitId: string;
  sectorId: string;
  page: number;
  edit: string;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function readRoute(): Filters {
  const query = new URLSearchParams(window.location.hash.split('?')[1]);
  const id = (key: string) => (uuid.test(query.get(key) ?? '') ? query.get(key)! : '');
  const page = Number(query.get('page') ?? 1);
  const isActive = query.get('isActive');
  return {
    search: (query.get('search') ?? '').slice(0, 120),
    isActive: isActive === 'true' || isActive === 'false' ? isActive : '',
    unitId: id('unitId'),
    sectorId: id('sectorId'),
    page: Number.isSafeInteger(page) && page > 0 && page <= 100000 ? page : 1,
    edit: query.get('edit') === 'new' ? 'new' : id('edit'),
  };
}
function queryString(filters: Filters, includeEditor = true) {
  const query = new URLSearchParams();
  for (const key of ['search', 'isActive', 'unitId', 'sectorId'] as const)
    if (filters[key]) query.set(key, filters[key]);
  if (filters.page > 1) query.set('page', String(filters.page));
  if (includeEditor && filters.edit) query.set('edit', filters.edit);
  return query;
}

export function WorkforceWorkspace({
  kind,
  session,
  onExpire,
}: {
  kind: WorkforceKind;
  session: SessionResponse;
  onExpire: () => void;
}) {
  const organizationId = session.activeOrganizationId;
  const admin =
    session.memberships.find((value) => value.organizationId === organizationId)?.role === 'ADMIN';
  if (!organizationId)
    return (
      <StatusMessage>
        Selecione uma empresa. <a href="#/empresas">Ir para Empresas</a>
      </StatusMessage>
    );
  if (!admin)
    return (
      <StatusMessage tone="error">
        Somente administradores podem gerenciar colaboradores e grupos de avaliação.
      </StatusMessage>
    );
  return (
    <WorkforceManager
      key={`${organizationId}-${kind}`}
      kind={kind}
      organizationId={organizationId}
      onExpire={onExpire}
    />
  );
}

function WorkforceManager({
  kind,
  organizationId,
  onExpire,
}: {
  kind: WorkforceKind;
  organizationId: string;
  onExpire: () => void;
}) {
  const employee = kind === 'colaboradores';
  const [filters, setFilters] = useState(readRoute);
  const [draft, setDraft] = useState(filters);
  const [attempt, setAttempt] = useState(0);
  const [denied, setDenied] = useState(false);
  const [notice, setNotice] = useState('');
  const [transition, setTransition] = useState<WorkforceItem | null>(null);
  const [pending, setPending] = useState(false);
  const [mutationError, setMutationError] = useState('');
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const controller = useRef(new AbortController());
  useEffect(() => {
    const change = () => {
      const value = readRoute();
      setFilters(value);
      setDraft(value);
      setNotice('');
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => {
    controller.current = new AbortController();
    const current = controller.current;
    return () => current.abort();
  }, []);
  const capabilities = useWorkforceData(
    '/auth/session-capabilities',
    sessionCapabilitiesSchema,
    organizationId,
    onExpire,
    attempt,
  );
  const allowed = capabilities.data?.canManageAccess && !denied;
  const base = `/organizations/${organizationId}/${resource(kind)}`;
  const listQuery = queryString(filters, false);
  listQuery.set('page', String(filters.page));
  listQuery.set('pageSize', '20');
  const listPath = allowed && !filters.edit ? `${base}?${listQuery}` : null;
  const employees = useWorkforceData(
    employee ? listPath : null,
    employeeListSchema,
    organizationId,
    onExpire,
    attempt,
  );
  const groups = useWorkforceData(
    !employee ? listPath : null,
    assessmentGroupListSchema,
    organizationId,
    onExpire,
    attempt,
  );
  const details =
    allowed && filters.edit && filters.edit !== 'new' ? `${base}/${filters.edit}` : null;
  const employeeDetail = useWorkforceData(
    employee ? details : null,
    employeeSchema,
    organizationId,
    onExpire,
    attempt,
  );
  const groupDetail = useWorkforceData(
    !employee ? details : null,
    assessmentGroupSchema,
    organizationId,
    onExpire,
    attempt,
  );
  const listing = employee ? employees : groups;
  const detail = employee ? employeeDetail : groupDetail;
  function navigate(next: Filters) {
    setFilters(next);
    setDraft(next);
    const query = queryString(next);
    const hash = `#/${kind}${query.size ? `?${query}` : ''}`;
    if (window.location.hash !== hash) window.location.hash = hash;
  }
  function closeEditor(message = '') {
    const next = { ...filters, edit: '' };
    const query = queryString(next);
    // Replace an editor URL; retain the list context without adding another edit to Back.
    window.history.replaceState(null, '', `#/${kind}${query.size ? `?${query}` : ''}`);
    setFilters(next);
    setDraft(next);
    setNotice(message);
    setAttempt((value) => value + 1);
    heading.current?.focus();
  }
  async function changeStatus() {
    if (!transition || pending) return;
    setPending(true);
    setMutationError('');
    try {
      const options = {
        method: 'PATCH',
        body: JSON.stringify({ version: transition.version, isActive: !transition.isActive }),
        signal: controller.current.signal,
      };
      if (employee) await request(`${base}/${transition.id}`, employeeSchema, options);
      else await request(`${base}/${transition.id}`, assessmentGroupSchema, options);
      if (!controller.current.signal.aborted) {
        setNotice(
          `${employee ? 'Colaborador' : 'Grupo'} ${transition.isActive ? 'desativado' : 'reativado'} com histórico preservado.`,
        );
        setTransition(null);
        setAttempt((value) => value + 1);
      }
    } catch (failure) {
      if (controller.current.signal.aborted) return;
      if (failure instanceof RequestError && failure.status === 401) return onExpire();
      if (failure instanceof RequestError && failure.status === 403) {
        setDenied(true);
        setTransition(null);
        return;
      }
      setMutationError(
        failure instanceof RequestError && failure.status === 409
          ? 'O cadastro mudou ou o vínculo não está mais ativo. Feche esta confirmação e atualize a lista antes de tentar novamente.'
          : failure instanceof Error
            ? failure.message
            : 'Não foi possível atualizar.',
      );
    } finally {
      if (!controller.current.signal.aborted) setPending(false);
    }
  }
  if (capabilities.loading && !capabilities.data)
    return <StatusMessage tone="loading">Verificando permissões…</StatusMessage>;
  if (capabilities.error && !capabilities.data)
    return (
      <StatusMessage
        tone="error"
        action={<Button onClick={() => setAttempt((value) => value + 1)}>Tentar novamente</Button>}
      >
        {capabilities.error}
      </StatusMessage>
    );
  if (!allowed)
    return (
      <StatusMessage tone="error">
        Seu acesso administrativo não está mais disponível. Atualize a sessão com o administrador.
      </StatusMessage>
    );
  return (
    <div className="workforce-workspace">
      <nav className="workforce-context" aria-label="Cadastros relacionados">
        <a href="#/empresas">Empresas</a>
        <span aria-hidden="true">/</span>
        <a href="#/unidades">Unidades e setores</a>
        <span aria-hidden="true">/</span>
        <a href={`#/${employee ? 'grupos' : 'colaboradores'}`}>
          {employee ? 'Grupos de avaliação' : 'Colaboradores'}
        </a>
      </nav>
      <StatusMessage>
        Cadastro organizacional mínimo. Os grupos representam setores, não listas de respondentes.
        Nenhum vínculo com respostas individuais é criado.
      </StatusMessage>
      {capabilities.error && capabilities.data && (
        <StatusMessage tone="warning">
          {capabilities.error} O rascunho foi preservado; as permissões serão verificadas novamente
          ao salvar.
        </StatusMessage>
      )}
      {detail.error && detail.data && (
        <StatusMessage tone="warning">
          {detail.error} Seu rascunho continua disponível.
        </StatusMessage>
      )}
      {notice && <StatusMessage tone="success">{notice}</StatusMessage>}
      {filters.edit ? (
        detail.loading && !detail.data ? (
          <StatusMessage tone="loading">Carregando cadastro…</StatusMessage>
        ) : detail.error && !detail.data ? (
          <StatusMessage
            tone="error"
            action={
              <Button onClick={() => setAttempt((value) => value + 1)}>Tentar novamente</Button>
            }
          >
            {detail.error}
            <Button variant="outline" onClick={() => closeEditor()}>
              Voltar para lista
            </Button>
          </StatusMessage>
        ) : filters.edit === 'new' || detail.data ? (
          <WorkforceEditor
            key={filters.edit}
            kind={kind}
            item={filters.edit === 'new' ? null : detail.data}
            organizationId={organizationId}
            initialUnitId={filters.unitId}
            initialSectorId={filters.sectorId}
            onExpire={onExpire}
            onDenied={() => setDenied(true)}
            onCancel={() => closeEditor()}
            onSaved={() => closeEditor(`${employee ? 'Colaborador' : 'Grupo'} salvo com sucesso.`)}
          />
        ) : null
      ) : (
        <>
          <div className="workforce-toolbar">
            <h2 ref={heading} tabIndex={-1}>
              {employee ? 'Pessoas da organização' : 'Grupos por setor'}
            </h2>
            <Button onClick={() => navigate({ ...filters, edit: 'new' })}>
              {employee ? 'Novo colaborador' : 'Novo grupo'}
            </Button>
          </div>
          <form
            className="surface workforce-filters"
            aria-label={`Filtros de ${employee ? 'colaboradores' : 'grupos'}`}
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              navigate({ ...draft, page: 1, edit: '' });
            }}
          >
            <div>
              <label htmlFor="workforce-search">
                Buscar {employee ? 'colaboradores' : 'grupos'}
              </label>
              <input
                id="workforce-search"
                type="search"
                maxLength={120}
                value={draft.search}
                onChange={(event) => setDraft({ ...draft, search: event.target.value })}
              />
            </div>
            <div>
              <label htmlFor="workforce-status">
                Situação {employee ? 'dos colaboradores' : 'dos grupos'}
              </label>
              <select
                id="workforce-status"
                value={draft.isActive}
                onChange={(event) => setDraft({ ...draft, isActive: event.target.value })}
              >
                <option value="">Todos</option>
                <option value="true">Ativos</option>
                <option value="false">Inativos</option>
              </select>
            </div>
            <ReferenceSelect
              kind="unit"
              includeInactive
              organizationId={organizationId}
              value={draft.unitId}
              label="Filtrar por unidade"
              onExpire={onExpire}
              onChange={(value) => setDraft({ ...draft, unitId: value, sectorId: '' })}
            />
            <ReferenceSelect
              key={draft.unitId}
              kind="sector"
              includeInactive
              organizationId={organizationId}
              unitId={draft.unitId}
              value={draft.sectorId}
              label="Filtrar por setor"
              onExpire={onExpire}
              onChange={(value) => setDraft({ ...draft, sectorId: value })}
            />
            <div className="form-actions">
              <Button type="submit">Aplicar filtros</Button>
              <Button
                variant="outline"
                onClick={() =>
                  navigate({
                    search: '',
                    isActive: '',
                    unitId: '',
                    sectorId: '',
                    page: 1,
                    edit: '',
                  })
                }
              >
                Limpar filtros
              </Button>
            </div>
          </form>
          {listing.loading && (
            <StatusMessage tone="loading">
              Carregando {employee ? 'colaboradores' : 'grupos'}…
            </StatusMessage>
          )}
          {listing.error && (
            <StatusMessage
              tone="error"
              action={
                <Button onClick={() => setAttempt((value) => value + 1)}>Tentar novamente</Button>
              }
            >
              {listing.error}
            </StatusMessage>
          )}
          {listing.data && (
            <>
              <p className="list-summary">
                {listing.data.total} {employee ? 'colaboradores' : 'grupos'} encontrados · Página{' '}
                {filters.page}
              </p>
              {!listing.data.items.length && (
                <div className="surface empty-state">
                  <h3>Nenhum resultado para estes filtros</h3>
                  <p>Confira a empresa selecionada ou ajuste a busca e a situação.</p>
                </div>
              )}
              <ul className="record-list">
                {listing.data.items.map((item) => (
                  <li key={item.id} className="surface record workforce-record">
                    <div className="record-details">
                      <h3>{item.name}</h3>
                      <p>
                        {item.unitName} · {item.sectorName}
                      </p>
                      {'internalIdentifier' in item && (
                        <p>
                          {item.internalIdentifier
                            ? `Identificação interna: ${item.internalIdentifier}`
                            : 'Sem identificação interna'}
                        </p>
                      )}
                      <StatusBadge
                        tone={item.isActive ? 'info' : 'neutral'}
                        label={item.isActive ? 'Ativo' : 'Inativo'}
                      />
                      {'linkedUserId' in item && typeof item.linkedUserId === 'string' && (
                        <p>Vínculo explícito com usuário de acesso.</p>
                      )}
                    </div>
                    <div className="record-actions">
                      <Button
                        variant="outline"
                        aria-label={`Editar ${employee ? 'colaborador' : 'grupo'} ${item.name}`}
                        onClick={() => navigate({ ...filters, edit: item.id })}
                      >
                        Editar
                      </Button>
                      <Button
                        variant="outline"
                        aria-label={`${item.isActive ? 'Desativar' : 'Reativar'} ${employee ? 'colaborador' : 'grupo'} ${item.name}`}
                        onClick={(event) => {
                          returnFocus.current = event.currentTarget;
                          setMutationError('');
                          setTransition(item);
                        }}
                      >
                        {item.isActive ? 'Desativar' : 'Reativar'}
                      </Button>
                      {!employee && (
                        <a
                          className="action-link"
                          href={`#/colaboradores?unitId=${item.unitId}&sectorId=${item.sectorId}`}
                        >
                          Ver colaboradores do setor
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <Pagination
                label={`Paginação de ${employee ? 'colaboradores' : 'grupos'}`}
                page={filters.page}
                pageSize={listing.data.pageSize}
                total={listing.data.total}
                onPageChange={(page) => navigate({ ...filters, page })}
                pending={listing.loading}
              />
            </>
          )}
        </>
      )}
      <Dialog.Root
        open={!!transition}
        onOpenChange={(open) => {
          if (!open && !pending) setTransition(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="sheet-overlay" />
          <Dialog.Content
            className="surface workforce-dialog"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              returnFocus.current?.focus();
            }}
          >
            <Dialog.Title>
              {transition?.isActive ? 'Desativar' : 'Reativar'} {employee ? 'colaborador' : 'grupo'}
            </Dialog.Title>
            <Dialog.Description>
              {transition?.name}.{' '}
              {employee
                ? 'A alteração preserva os registros e históricos e não revoga o acesso do usuário. Para suspender um acesso, utilize a área Acessos.'
                : 'A desativação impede novos vínculos a ciclos e riscos deste grupo, sem apagar diagnósticos, respostas e riscos já registrados.'}
            </Dialog.Description>
            {mutationError && <StatusMessage tone="error">{mutationError}</StatusMessage>}
            <div className="form-actions">
              <Button disabled={pending} onClick={() => void changeStatus()}>
                {pending
                  ? 'Atualizando…'
                  : transition?.isActive
                    ? 'Confirmar desativação'
                    : 'Confirmar reativação'}
              </Button>
              <Button variant="outline" disabled={pending} onClick={() => setTransition(null)}>
                Cancelar
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
