import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  companyGroupEligibleClientPageSchema,
  companyGroupGrantPageSchema,
  companyGroupGrantSchema,
  createCompanyGroupSchema,
  managedCompanyGroupPageSchema,
  managedCompanyGroupSchema,
  platformCapabilitiesSchema,
  updateCompanyGroupSchema,
  writeCompanyGroupGrantSchema,
} from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { Button } from '../ui/button';
import { Pagination } from '../ui/pagination';
import { StatusMessage } from '../ui/status-message';
import { useAccessRefresh, usePrivateQuery } from './usePrivateQuery';
import './platform.css';
import './company-groups.css';

const base = '/platform/company-groups';
type ManagedGroup = ReturnType<typeof managedCompanyGroupSchema.parse>;
type EligibleClient = ReturnType<
  typeof companyGroupEligibleClientPageSchema.parse
>['items'][number];
type Grant = ReturnType<typeof companyGroupGrantSchema.parse>;
type AccessEvents = { onExpire: () => void; onDenied: () => void };

function useGroupWrite({ onExpire, onDenied }: AccessEvents) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const controller = useRef(new AbortController());
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    return () => current.abort();
  }, []);
  return {
    pending,
    error,
    conflict,
    setError,
    async write<T>(
      path: string,
      method: string,
      body: unknown,
      schema: { parse(value: unknown): T },
    ) {
      if (pending || conflict) return null;
      setError('');
      setPending(true);
      const { signal } = controller.current;
      try {
        const result = await request(path, schema, { method, body: JSON.stringify(body), signal });
        return signal.aborted ? null : result;
      } catch (failure) {
        if (signal.aborted) return null;
        if (failure instanceof RequestError && failure.status === 401) onExpire();
        else if (failure instanceof RequestError && failure.status === 403) onDenied();
        else if (failure instanceof RequestError && failure.status === 409) {
          setConflict(true);
          setError(
            'Os dados ou as empresas disponíveis mudaram. Reabra o registro antes de tentar novamente.',
          );
        } else setError(failure instanceof Error ? failure.message : 'Não foi possível salvar.');
        return null;
      } finally {
        if (!signal.aborted) setPending(false);
      }
    },
  };
}

export function CompanyGroupsAdmin({ onExpire }: { onExpire: () => void }) {
  const { revision, refresh } = useAccessRefresh();
  const [denied, setDenied] = useState(false);
  const onDenied = () => setDenied(true);
  const capabilities = usePrivateQuery(
    '/platform/capabilities',
    platformCapabilitiesSchema,
    revision,
    onExpire,
    onDenied,
    undefined,
    true,
  );
  const canEdit = capabilities.data?.capabilities.includes('MANAGE_CLIENTS') ?? false;
  const canGrant = capabilities.data?.capabilities.includes('MANAGE_GRANTS') ?? false;
  if (denied || capabilities.error)
    return (
      <StatusMessage
        tone="error"
        action={
          <Button
            onClick={() => {
              setDenied(false);
              refresh();
            }}
          >
            Revalidar acesso
          </Button>
        }
      >
        {capabilities.error || 'O acesso à administração de grupos foi revogado.'}
      </StatusMessage>
    );
  if (capabilities.loading && !capabilities.data)
    return <StatusMessage tone="loading">Verificando acesso à administração…</StatusMessage>;
  if (!canEdit && !canGrant)
    return (
      <StatusMessage>A administração de grupos exige uma permissão da plataforma.</StatusMessage>
    );
  return (
    <CompanyGroupsManagement
      key={`${canEdit}/${canGrant}`}
      canEdit={canEdit}
      canGrant={canGrant}
      revision={revision}
      onExpire={onExpire}
      onDenied={onDenied}
    />
  );
}

function CompanyGroupsManagement({
  canEdit,
  canGrant,
  revision,
  onExpire,
  onDenied,
}: AccessEvents & {
  canEdit: boolean;
  canGrant: boolean;
  revision: number;
}) {
  const [page, setPage] = useState(1);
  const [change, setChange] = useState(0);
  const [edit, setEdit] = useState<ManagedGroup | 'new' | null>(null);
  const [grants, setGrants] = useState<ManagedGroup | null>(null);
  const [notice, setNotice] = useState('');
  const listing = usePrivateQuery(
    `${base}?page=${page}&pageSize=15`,
    managedCompanyGroupPageSchema,
    revision + change,
    onExpire,
    onDenied,
    undefined,
    true,
  );
  const refresh = () => setChange((value) => value + 1);
  function select(group: ManagedGroup | 'new', mode: 'edit' | 'grants') {
    setNotice('');
    setEdit(mode === 'edit' ? group : null);
    setGrants(mode === 'grants' && group !== 'new' ? group : null);
  }
  return (
    <div className="company-group-admin platform-workspace">
      {canEdit && (
        <div>
          <Button onClick={() => select('new', 'edit')}>Novo grupo de empresas</Button>
        </div>
      )}
      {notice && <StatusMessage tone="success">{notice}</StatusMessage>}
      {edit && (
        <CompanyGroupEditor
          key={edit === 'new' ? 'new' : `${edit.id}/${edit.version}`}
          group={edit === 'new' ? null : edit}
          onCancel={() => {
            setEdit(null);
            refresh();
          }}
          onSaved={() => {
            setEdit(null);
            setNotice('Composição do grupo salva.');
            refresh();
          }}
          onExpire={onExpire}
          onDenied={onDenied}
        />
      )}
      {grants && (
        <CompanyGroupGrants
          key={grants.id}
          group={grants}
          revision={revision}
          onClose={() => setGrants(null)}
          onExpire={onExpire}
          onDenied={onDenied}
        />
      )}
      {listing.error ? (
        <StatusMessage tone="error" action={<Button onClick={refresh}>Atualizar grupos</Button>}>
          {listing.error}
        </StatusMessage>
      ) : !listing.data ? (
        <StatusMessage tone="loading">Carregando grupos…</StatusMessage>
      ) : listing.data.items.length ? (
        <>
          <ul className="platform-records" aria-label="Grupos cadastrados">
            {listing.data.items.map((group) => (
              <li key={group.id}>
                <div>
                  <h2>{group.name}</h2>
                  <p className="muted">{group.organizationIds.length} empresas vinculadas</p>
                </div>
                <div className="company-group-actions">
                  {canEdit && (
                    <Button
                      variant="outline"
                      aria-label={`Editar composição de ${group.name}`}
                      onClick={() => select(group, 'edit')}
                    >
                      Editar composição
                    </Button>
                  )}
                  {canGrant && (
                    <Button
                      variant="outline"
                      aria-label={`Gerenciar consultas de ${group.name}`}
                      onClick={() => select(group, 'grants')}
                    >
                      Gerenciar consultas
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <Pagination
            page={page}
            pageSize={listing.data.pageSize}
            total={listing.data.total}
            onPageChange={setPage}
            label="Páginas de grupos"
            pending={listing.loading}
          />
        </>
      ) : (
        <StatusMessage>Nenhum grupo de empresas cadastrado.</StatusMessage>
      )}
    </div>
  );
}

function CompanyGroupEditor({
  group,
  onCancel,
  onSaved,
  onExpire,
  onDenied,
}: AccessEvents & {
  group: ManagedGroup | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(group?.name ?? '');
  const [reason, setReason] = useState('');
  const [selected, setSelected] = useState<EligibleClient[]>(() => group?.organizations ?? []);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const params = new URLSearchParams({ search, page: String(page), pageSize: '10' });
  const candidates = usePrivateQuery(
    `${base}/eligible-clients?${params}`,
    companyGroupEligibleClientPageSchema,
    attempt,
    onExpire,
    onDenied,
  );
  const mutation = useGroupWrite({ onExpire, onDenied });
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = { name, reason, organizationIds: selected.map(({ id }) => id) };
    const parsed = group
      ? updateCompanyGroupSchema.safeParse({ ...fields, version: group.version })
      : createCompanyGroupSchema.safeParse(fields);
    if (!parsed.success) {
      mutation.setError('Informe o nome, a justificativa e as empresas que compõem o grupo.');
      return;
    }
    const saved = await mutation.write(
      group ? `${base}/${group.id}` : base,
      group ? 'PATCH' : 'POST',
      parsed.data,
      managedCompanyGroupSchema,
    );
    if (saved) onSaved();
  }
  return (
    <section className="surface platform-editor" aria-labelledby="group-editor">
      <h2 id="group-editor" ref={heading} tabIndex={-1}>
        {group ? `Composição de ${group.name}` : 'Criar grupo de empresas'}
      </h2>
      <form
        aria-label="Buscar empresas elegíveis"
        className="company-group-actions"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(draft);
          setPage(1);
        }}
      >
        <label>
          Nome ou CNPJ
          <input value={draft} maxLength={160} onChange={(event) => setDraft(event.target.value)} />
        </label>
        <Button type="submit" variant="outline">
          Buscar empresas
        </Button>
      </form>
      {candidates.error ? (
        <StatusMessage
          tone="error"
          action={<Button onClick={() => setAttempt(attempt + 1)}>Repetir busca</Button>}
        >
          {candidates.error}
        </StatusMessage>
      ) : !candidates.data ? (
        <StatusMessage tone="loading">Carregando empresas elegíveis…</StatusMessage>
      ) : !candidates.data.items.length ? (
        <StatusMessage>Nenhuma empresa elegível nesta busca.</StatusMessage>
      ) : (
        <>
          <ul aria-label="Empresas elegíveis">
            {candidates.data.items.map((item) => (
              <li key={item.id}>
                <span>
                  {item.name}
                  {item.fiscalIdentifier ? ` · ${item.fiscalIdentifier}` : ''}
                </span>
                <Button
                  variant="outline"
                  aria-label={`Incluir ${item.name}`}
                  disabled={mutation.pending || selected.some(({ id }) => id === item.id)}
                  onClick={() => setSelected([...selected, item])}
                >
                  Incluir
                </Button>
              </li>
            ))}
          </ul>
          <Pagination
            page={page}
            pageSize={candidates.data.pageSize}
            total={candidates.data.total}
            onPageChange={setPage}
            label="Páginas de empresas elegíveis"
          />
        </>
      )}
      <form
        aria-label="Salvar composição"
        className="platform-editor"
        onSubmit={(event) => void save(event)}
      >
        <label>
          Nome do grupo
          <input
            value={name}
            maxLength={160}
            required
            disabled={mutation.pending}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div>
          <h3>Empresas selecionadas</h3>
          {selected.length === 0 ? (
            <p className="muted">Inclua empresas na busca acima.</p>
          ) : (
            <ul>
              {selected.map((item) => {
                const title =
                  candidates.data?.items.find(({ id }) => id === item.id)?.name ?? item.name;
                return (
                  <li key={item.id}>
                    <span>{title}</span>
                    <Button
                      variant="outline"
                      disabled={mutation.pending}
                      aria-label={`Retirar ${title}`}
                      onClick={() => setSelected(selected.filter(({ id }) => id !== item.id))}
                    >
                      Retirar
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <label>
          Justificativa
          <textarea
            required
            maxLength={1000}
            disabled={mutation.pending}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        {mutation.error && <StatusMessage tone="error">{mutation.error}</StatusMessage>}
        <div className="company-group-actions">
          <Button type="submit" disabled={mutation.pending || mutation.conflict}>
            Salvar composição
          </Button>
          <Button variant="outline" onClick={onCancel}>
            Fechar composição
          </Button>
        </div>
      </form>
    </section>
  );
}

function CompanyGroupGrants({
  group,
  revision,
  onClose,
  onExpire,
  onDenied,
}: AccessEvents & {
  group: ManagedGroup;
  revision: number;
  onClose: () => void;
}) {
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [selected, setSelected] = useState<Grant | null>(null);
  const [page, setPage] = useState(1);
  const [change, setChange] = useState(0);
  const [notice, setNotice] = useState('');
  const path = `${base}/${group.id}/grants`;
  const list = usePrivateQuery(
    `${path}?page=${page}&pageSize=15`,
    companyGroupGrantPageSchema,
    revision + change,
    onExpire,
    onDenied,
  );
  const mutation = useGroupWrite({ onExpire, onDenied });
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = writeCompanyGroupGrantSchema.safeParse({
      email: selected?.email ?? email,
      active: !selected?.active,
      reason,
      version: selected?.version ?? 0,
    });
    if (!input.success) {
      mutation.setError('Informe o e-mail de uma conta existente e a justificativa.');
      return;
    }
    const saved = await mutation.write(path, 'PUT', input.data, companyGroupGrantSchema);
    if (!saved) return;
    setNotice(saved.active ? 'Consulta ao grupo concedida.' : 'Consulta ao grupo revogada.');
    setSelected(null);
    setReason('');
    setEmail('');
    setChange((value) => value + 1);
  }
  return (
    <section className="surface platform-editor" aria-labelledby="group-grants">
      <h2 id="group-grants" ref={heading} tabIndex={-1}>
        Consultas de {group.name}
      </h2>
      <p className="muted">
        A concessão permite consultar o consolidado do grupo. Os acessos de empresa são gerenciados
        separadamente.
      </p>
      {list.error ? (
        <StatusMessage
          tone="error"
          action={<Button onClick={() => setChange(change + 1)}>Atualizar consultas</Button>}
        >
          {list.error}
        </StatusMessage>
      ) : !list.data ? (
        <StatusMessage tone="loading">Carregando concessões…</StatusMessage>
      ) : list.data.items.length ? (
        <>
          <ul aria-label="Concessões do grupo">
            {list.data.items.map((item) => (
              <li key={item.email}>
                <span>
                  {item.email} · {item.active ? 'Ativa' : 'Revogada'}
                </span>
                <Button
                  variant="outline"
                  disabled={mutation.pending}
                  aria-label={`${item.active ? 'Revogar' : 'Reativar'} consulta de ${item.email}`}
                  onClick={() => {
                    setSelected(item);
                    setReason('');
                    setNotice('');
                  }}
                >
                  {item.active ? 'Revogar' : 'Reativar'}
                </Button>
              </li>
            ))}
          </ul>
          <Pagination
            page={page}
            pageSize={list.data.pageSize}
            total={list.data.total}
            onPageChange={setPage}
            label="Páginas de concessões"
          />
        </>
      ) : (
        <StatusMessage>Nenhuma concessão registrada para este grupo.</StatusMessage>
      )}
      <form
        aria-label="Alterar consulta ao grupo"
        className="platform-editor"
        onSubmit={(event) => void save(event)}
      >
        {selected ? (
          <p>
            {selected.active ? 'Revogar' : 'Reativar'} consulta de <strong>{selected.email}</strong>
            .
          </p>
        ) : (
          <label>
            E-mail da conta
            <input
              type="email"
              required
              maxLength={254}
              value={email}
              disabled={mutation.pending}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
        )}
        <label>
          Justificativa
          <textarea
            required
            maxLength={1000}
            value={reason}
            disabled={mutation.pending}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        {mutation.error && <StatusMessage tone="error">{mutation.error}</StatusMessage>}
        {notice && <StatusMessage tone="success">{notice}</StatusMessage>}
        <div className="company-group-actions">
          <Button type="submit" disabled={mutation.pending || mutation.conflict}>
            {selected?.active
              ? 'Confirmar revogação'
              : selected
                ? 'Confirmar reativação'
                : 'Conceder consulta'}
          </Button>
          {selected && (
            <Button
              variant="outline"
              disabled={mutation.pending}
              onClick={() => {
                setSelected(null);
                setReason('');
              }}
            >
              Cancelar alteração
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Fechar consultas
          </Button>
        </div>
      </form>
    </section>
  );
}
