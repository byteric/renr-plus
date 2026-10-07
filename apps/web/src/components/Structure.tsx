import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  createOrganizationSchema,
  createUnitSchema,
  createSectorSchema,
  organizationListSchema,
  unitListSchema,
  sectorListSchema,
  organizationSchema,
  unitSchema,
  sectorSchema,
  sessionResponseSchema,
  type Organization,
  type Unit,
  type Sector,
  type SessionResponse,
} from '@renr/contracts';
import { Button } from './ui/button';
import { request, RequestError } from '../lib/api';

type Kind = 'empresas' | 'unidades' | 'setores';
type RecordItem = Organization | Unit | Sector;
type Route = { kind: Kind; unitId: string | null };
function readRoute(): Route {
  const parts = window.location.hash.replace(/^#\/?/, '').split('/');
  if (parts[0] === 'unidades') return { kind: 'unidades', unitId: null };
  if (parts[0] === 'setores' && /^[0-9a-f-]{36}$/i.test(parts[1] ?? ''))
    return { kind: 'setores', unitId: parts[1] ?? null };
  return { kind: 'empresas', unitId: null };
}
const titles: Record<Kind, string> = {
  empresas: 'Empresas',
  unidades: 'Unidades',
  setores: 'Setores',
};
const singular: Record<Kind, string> = {
  empresas: 'empresa',
  unidades: 'unidade',
  setores: 'setor',
};
type Listing = { items: RecordItem[]; total: number; page: number; pageSize: number };

function Editor({
  kind,
  item,
  path,
  onSaved,
  onCancel,
  onExpire,
}: {
  kind: Kind;
  item: RecordItem | null;
  path: string;
  onSaved: () => void;
  onCancel: () => void;
  onExpire: () => void;
}) {
  const [name, setName] = useState(item?.name ?? '');
  const [extra, setExtra] = useState(
    item && 'fiscalIdentifier' in item
      ? (item.fiscalIdentifier ?? '')
      : item && 'code' in item
        ? (item.code ?? '')
        : '',
  );
  const [timezone, setTimezone] = useState(
    item && 'timezone' in item ? item.timezone : 'America/Sao_Paulo',
  );
  const [isActive, setIsActive] = useState(item?.isActive ?? true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<{ field: string; message: string }[]>([]);
  const nameInput = useRef<HTMLInputElement>(null);
  const controller = useRef(new AbortController());
  useEffect(() => {
    nameInput.current?.focus();
    controller.current = new AbortController();
    const current = controller.current;
    return () => current.abort();
  }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const body =
      kind === 'empresas'
        ? { name, timezone, fiscalIdentifier: extra.trim() || null }
        : kind === 'unidades'
          ? { name, code: extra.trim() || null }
          : { name };
    const parsed =
      kind === 'empresas'
        ? createOrganizationSchema.safeParse(body)
        : kind === 'unidades'
          ? createUnitSchema.safeParse(body)
          : createSectorSchema.safeParse(body);
    if (!parsed.success) {
      setError('Confira os campos destacados.');
      setFields(
        parsed.error.issues.map((issue) => ({
          field: String(issue.path[0]),
          message:
            issue.path[0] === 'timezone'
              ? 'Informe um fuso horário IANA, como America/Sao_Paulo.'
              : issue.path[0] === 'name'
                ? 'Use entre 2 e 120 caracteres.'
                : 'Confira o tamanho e o formato do campo.',
        })),
      );
      nameInput.current?.focus();
      return;
    }
    setPending(true);
    setError('');
    setFields([]);
    const options = {
      method: item ? 'PATCH' : 'POST',
      body: JSON.stringify(item ? { ...parsed.data, isActive } : parsed.data),
      signal: controller.current.signal,
    };
    try {
      if (kind === 'empresas') await request(path, organizationSchema, options);
      else if (kind === 'unidades') await request(path, unitSchema, options);
      else await request(path, sectorSchema, options);
      if (!controller.current.signal.aborted) onSaved();
    } catch (failure) {
      if (controller.current.signal.aborted) return;
      if (failure instanceof RequestError && failure.status === 401) {
        onExpire();
        return;
      }
      setError(failure instanceof Error ? failure.message : 'Não foi possível salvar.');
      if (failure instanceof RequestError) setFields(failure.fields);
    } finally {
      if (!controller.current.signal.aborted) setPending(false);
    }
  }
  function fieldError(field: string) {
    const message = fields.find((value) => value.field === field)?.message;
    return message ? (
      <span id={`error-${field}`} className="field-error">
        {message}
      </span>
    ) : null;
  }
  function invalid(field: string) {
    return fields.some((value) => value.field === field);
  }
  return (
    <section className="surface editor" aria-labelledby="editor-title">
      <p className="panel-label">{item ? 'EDITAR CADASTRO' : 'NOVO CADASTRO'}</p>
      <h2 id="editor-title">
        {item ? 'Editar' : 'Cadastrar'} {singular[kind]}
      </h2>
      <form
        aria-label={`${item ? 'Editar' : 'Cadastrar'} ${singular[kind]}`}
        onSubmit={(event) => void save(event)}
        noValidate
      >
        <label htmlFor="record-name">
          Nome {kind === 'setores' ? 'do setor' : `da ${singular[kind]}`}
        </label>
        <input
          ref={nameInput}
          id="record-name"
          value={name}
          maxLength={120}
          required
          aria-invalid={invalid('name')}
          aria-describedby={invalid('name') ? 'error-name' : undefined}
          onChange={(event) => setName(event.target.value)}
        />
        {fieldError('name')}
        {kind !== 'setores' && (
          <>
            <label htmlFor="record-extra">
              {kind === 'empresas' ? 'Identificador fiscal' : 'Código'}
            </label>
            <input
              id="record-extra"
              value={extra}
              maxLength={32}
              aria-invalid={invalid(kind === 'empresas' ? 'fiscalIdentifier' : 'code')}
              aria-describedby={
                invalid(kind === 'empresas' ? 'fiscalIdentifier' : 'code')
                  ? `error-${kind === 'empresas' ? 'fiscalIdentifier' : 'code'}`
                  : 'optional-hint'
              }
              onChange={(event) => setExtra(event.target.value)}
            />
            <span id="optional-hint" className="input-hint">
              Campo opcional
            </span>
            {fieldError(kind === 'empresas' ? 'fiscalIdentifier' : 'code')}
          </>
        )}
        {kind === 'empresas' && (
          <>
            <label htmlFor="timezone">Fuso horário</label>
            <input
              id="timezone"
              value={timezone}
              required
              aria-invalid={invalid('timezone')}
              aria-describedby={invalid('timezone') ? 'error-timezone' : 'timezone-hint'}
              onChange={(event) => setTimezone(event.target.value)}
            />
            <span id="timezone-hint" className="input-hint">
              Exemplo: America/Sao_Paulo
            </span>
            {fieldError('timezone')}
          </>
        )}
        {item && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
            />
            Cadastro ativo
          </label>
        )}
        {error && (
          <p role="alert" className="feedback error">
            {error}
          </p>
        )}
        <div className="form-actions">
          <Button type="submit" disabled={pending}>
            {pending ? 'Salvando…' : `Salvar ${singular[kind]}`}
          </Button>
          <Button variant="outline" disabled={pending} onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </form>
    </section>
  );
}

export function Structure({
  session,
  onSession,
  onExpire,
}: {
  session: SessionResponse;
  onSession: (value: SessionResponse) => void;
  onExpire: () => void;
}) {
  const [route, setRoute] = useState<Route>(readRoute);
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [loadedListing, setListing] = useState<Listing | null>(null);
  const [loadedKey, setLoadedKey] = useState('');
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<{ item: RecordItem | null } | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const mutationController = useRef(new AbortController());
  const membership = session.memberships.find(
    (value) => value.organizationId === session.activeOrganizationId,
  );
  const canWrite = membership?.role === 'ADMIN';
  const listPath =
    route.kind === 'empresas'
      ? '/organizations'
      : route.kind === 'unidades' && session.activeOrganizationId
        ? `/organizations/${encodeURIComponent(session.activeOrganizationId)}/units`
        : route.kind === 'setores' && session.activeOrganizationId && route.unitId
          ? `/units/${encodeURIComponent(route.unitId)}/sectors`
          : null;
  const loadKey = `${session.activeOrganizationId}-${listPath}-${page}-${attempt}`;
  const loading = !!listPath && loadedKey !== loadKey;
  const listing = loadedKey === loadKey ? loadedListing : null;
  useEffect(() => {
    const change = () => {
      setRoute(readRoute());
      setPage(1);
      setEditor(null);
      setConfirmation('');
      setError('');
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => {
    mutationController.current = new AbortController();
    const current = mutationController.current;
    return () => current.abort();
  }, []);
  useEffect(() => {
    heading.current?.focus();
  }, [route.kind, route.unitId]);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    if (!listPath) return;
    const path = `${listPath}?page=${page}&pageSize=50`;
    const load =
      route.kind === 'empresas'
        ? request(path, organizationListSchema, { signal: controller.signal })
        : route.kind === 'unidades'
          ? request(path, unitListSchema, { signal: controller.signal })
          : request(path, sectorListSchema, { signal: controller.signal });
    void load
      .then((value) => {
        if (active) {
          setListing(value);
          setError('');
        }
      })
      .catch((failure: unknown) => {
        if (!active) return;
        setListing(null);
        if (failure instanceof RequestError && failure.status === 401) onExpire();
        else
          setError(
            failure instanceof Error ? failure.message : 'Não foi possível carregar a lista.',
          );
      })
      .finally(() => {
        if (active) setLoadedKey(loadKey);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [listPath, route.kind, page, loadKey, onExpire]);
  async function select(item: RecordItem) {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      const value = await request('/auth/session/organization', sessionResponseSchema, {
        method: 'PUT',
        body: JSON.stringify({ organizationId: item.id }),
        signal: mutationController.current.signal,
      });
      if (!mutationController.current.signal.aborted) {
        onSession(value);
        setEditor(null);
        window.location.assign('#/unidades');
      }
    } catch (failure) {
      if (mutationController.current.signal.aborted) return;
      if (failure instanceof RequestError && failure.status === 401) onExpire();
      else
        setError(
          failure instanceof Error ? failure.message : 'Não foi possível selecionar a empresa.',
        );
    } finally {
      if (!mutationController.current.signal.aborted) setPending(false);
    }
  }
  function editPath(item: RecordItem | null) {
    if (!item) return listPath ?? '';
    return `/${route.kind === 'empresas' ? 'organizations' : route.kind === 'unidades' ? 'units' : 'sectors'}/${encodeURIComponent(item.id)}`;
  }
  return (
    <div className="workspace">
      <aside className="workspace-nav">
        <p className="panel-label">ESPAÇO DE TRABALHO</p>
        <p className="user-name">{session.user.name}</p>
        <nav aria-label="Estrutura organizacional">
          <a href="#/empresas" aria-current={route.kind === 'empresas' ? 'page' : undefined}>
            Empresas
          </a>
          <a href="#/unidades" aria-current={route.kind === 'unidades' ? 'page' : undefined}>
            Unidades
          </a>
          {route.unitId && (
            <a
              href={`#/setores/${route.unitId}`}
              aria-current={route.kind === 'setores' ? 'page' : undefined}
            >
              Setores
            </a>
          )}
        </nav>
        <div className="context">
          <p className="panel-label">EMPRESA SELECIONADA</p>
          <p>{membership?.organizationName ?? 'Selecione uma empresa para continuar'}</p>
          {membership && (
            <span>{membership.role === 'ADMIN' ? 'Administrador' : 'Somente leitura'}</span>
          )}
        </div>
      </aside>
      <section className="workspace-content">
        <div className="page-heading">
          <div>
            <p className="eyebrow">ESTRUTURA ORGANIZACIONAL</p>
            <h1 ref={heading} tabIndex={-1}>
              {titles[route.kind]}
            </h1>
            <p className="muted">
              {route.kind === 'empresas'
                ? 'Escolha a empresa em que você deseja trabalhar.'
                : route.kind === 'unidades'
                  ? 'Organize os locais de trabalho da empresa.'
                  : 'Organize as equipes e áreas da unidade selecionada.'}
            </p>
          </div>
          {canWrite && listPath && (
            <Button
              disabled={pending}
              onClick={() => {
                setConfirmation('');
                setEditor({ item: null });
              }}
            >
              {route.kind === 'setores' ? 'Novo setor' : `Nova ${singular[route.kind]}`}
            </Button>
          )}
        </div>
        {confirmation && (
          <p role="status" className="feedback success">
            {confirmation}
          </p>
        )}
        {!listPath && (
          <div className="surface empty-state">
            <h2>Primeiro, selecione uma empresa</h2>
            <p>A estrutura será exibida no contexto do seu acesso.</p>
            <a href="#/empresas">Ir para Empresas →</a>
          </div>
        )}
        {error && (
          <div role="alert" className="feedback error">
            <p>{error}</p>
            <Button variant="outline" onClick={() => setAttempt(attempt + 1)}>
              Atualizar lista
            </Button>
          </div>
        )}
        <div className={editor ? 'list-editor-layout' : ''}>
          <div>
            {loading && (
              <p role="status" className="surface">
                Carregando {titles[route.kind].toLowerCase()}…
              </p>
            )}
            {listing && listing.items.length === 0 && (
              <div className="surface empty-state">
                <h2>Nenhum cadastro por aqui</h2>
                <p>
                  {canWrite
                    ? `Cadastre ${route.kind === 'setores' ? 'o primeiro setor' : `a primeira ${singular[route.kind]}`} para começar.`
                    : 'Os cadastros disponíveis aparecerão aqui.'}
                </p>
              </div>
            )}
            {listing && listing.items.length > 0 && (
              <>
                <p className="list-summary">
                  {listing.total} {listing.total === 1 ? 'cadastro' : 'cadastros'} · Página{' '}
                  {listing.page}
                </p>
                <ul className="record-list">
                  {listing.items.map((item) => {
                    const writable =
                      route.kind === 'empresas'
                        ? item.id === session.activeOrganizationId && canWrite
                        : canWrite;
                    return (
                      <li key={item.id} className="surface record">
                        <div className="record-details">
                          <h2>{item.name}</h2>
                          <p className="muted">
                            {'timezone' in item
                              ? item.timezone
                              : 'code' in item
                                ? item.code
                                  ? `Código: ${item.code}`
                                  : 'Sem código informado'
                                : 'Setor da unidade'}
                          </p>
                          <span className={`badge ${item.isActive ? 'active' : ''}`}>
                            {item.isActive ? 'Ativo' : 'Inativo'}
                          </span>
                        </div>
                        <div className="record-actions">
                          {route.kind === 'empresas' && (
                            <Button
                              disabled={pending}
                              aria-label={`Selecionar empresa ${item.name}`}
                              onClick={() => void select(item)}
                            >
                              Selecionar empresa
                            </Button>
                          )}
                          {route.kind === 'unidades' && (
                            <a
                              className="action-link"
                              href={`#/setores/${item.id}`}
                              aria-label={`Ver setores de ${item.name}`}
                            >
                              Ver setores →
                            </a>
                          )}
                          {writable && (
                            <Button
                              variant="outline"
                              disabled={pending}
                              aria-label={`Editar ${singular[route.kind]} ${item.name}`}
                              onClick={() => {
                                setConfirmation('');
                                setEditor({ item });
                              }}
                            >
                              Editar
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {listing.total > listing.pageSize && (
                  <nav className="pagination" aria-label="Paginação">
                    <Button
                      variant="outline"
                      disabled={page === 1 || loading}
                      onClick={() => setPage(page - 1)}
                    >
                      Página anterior
                    </Button>
                    <Button
                      variant="outline"
                      disabled={page * listing.pageSize >= listing.total || loading}
                      onClick={() => setPage(page + 1)}
                    >
                      Próxima página
                    </Button>
                  </nav>
                )}
              </>
            )}
          </div>
          {editor && listPath && (
            <Editor
              key={`${route.kind}-${editor.item?.id ?? 'new'}`}
              kind={route.kind}
              item={editor.item}
              path={editPath(editor.item)}
              onExpire={onExpire}
              onCancel={() => {
                setEditor(null);
                heading.current?.focus();
              }}
              onSaved={() => {
                setEditor(null);
                setConfirmation('Cadastro salvo com sucesso.');
                setAttempt(attempt + 1);
                heading.current?.focus();
              }}
            />
          )}
        </div>
      </section>
    </div>
  );
}
