import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  organizationListSchema,
  unitListSchema,
  sectorListSchema,
  sessionResponseSchema,
  type Organization,
  type Unit,
  type Sector,
  type SessionResponse,
} from '@renr/contracts';
import { Button } from './ui/button';
import { request, RequestError } from '../lib/api';
import { Diagnostics } from './Diagnostics';
import { WorkspaceNavigation } from './WorkspaceNavigation';
import { RouteMotion } from './RouteMotion';
import { StructureEditor } from './StructureEditor';
import './workforce/workforce.css';

const RiskWorkspace = lazy(() =>
  import('./risks/RiskWorkspace').then((module) => ({ default: module.RiskWorkspace })),
);
const ActionsWorkspace = lazy(() =>
  import('./actions/ActionsWorkspace').then((module) => ({ default: module.ActionsWorkspace })),
);
const ManagementDashboard = lazy(() =>
  import('./ManagementDashboard').then((module) => ({ default: module.ManagementDashboard })),
);
const AccessWorkspace = lazy(() =>
  import('./access/AccessWorkspace').then((module) => ({ default: module.AccessWorkspace })),
);
const WorkforceWorkspace = lazy(() =>
  import('./workforce/WorkforceWorkspace').then((module) => ({
    default: module.WorkforceWorkspace,
  })),
);
const InstrumentsWorkspace = lazy(() =>
  import('./instruments/InstrumentsWorkspace').then((module) => ({
    default: module.InstrumentsWorkspace,
  })),
);
const AssessmentWorkspace = lazy(() =>
  import('./assessments/AssessmentWorkspace').then((module) => ({
    default: module.AssessmentWorkspace,
  })),
);

type Kind = 'empresas' | 'unidades' | 'setores';
type RecordItem = Organization | Unit | Sector;
type Route = {
  kind:
    | Kind
    | 'painel'
    | 'diagnostico'
    | 'inventario'
    | 'acoes'
    | 'acessos'
    | 'instrumentos'
    | 'coletas'
    | 'colaboradores'
    | 'grupos';
  unitId: string | null;
};
function readRoute(): Route {
  const parts = window.location.hash.replace(/^#\/?/, '').split('?')[0]?.split('/') ?? [];
  if (parts[0] === 'coletas') return { kind: 'coletas', unitId: null };
  if (parts[0] === 'instrumentos') return { kind: 'instrumentos', unitId: null };
  if (parts[0] === 'colaboradores' || parts[0] === 'grupos')
    return { kind: parts[0], unitId: null };
  if (parts[0] === 'acessos') return { kind: 'acessos', unitId: null };
  if (parts[0] === 'inventario') return { kind: 'inventario', unitId: null };
  if (parts[0] === 'acoes') return { kind: 'acoes', unitId: null };
  if (parts[0] === 'diagnostico') return { kind: 'diagnostico', unitId: null };
  if (parts[0] === 'painel') return { kind: 'painel', unitId: null };
  if (parts[0] === 'unidades') return { kind: 'unidades', unitId: null };
  if (parts[0] === 'setores' && /^[0-9a-f-]{36}$/i.test(parts[1] ?? ''))
    return { kind: 'setores', unitId: parts[1] ?? null };
  return { kind: 'empresas', unitId: null };
}
const titles: Record<Route['kind'], string> = {
  coletas: 'Coletas',
  instrumentos: 'Instrumentos',
  colaboradores: 'Colaboradores',
  grupos: 'Grupos de avaliação',
  painel: 'Painel',
  diagnostico: 'Diagnóstico',
  inventario: 'Inventário',
  acoes: 'Ações',
  acessos: 'Acessos',
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
function readFilters() {
  const query = new URLSearchParams(window.location.hash.split('?')[1]);
  const rawPage = Number(query.get('page') ?? 1);
  const isActive = query.get('isActive');
  return {
    search: (query.get('search') ?? '').slice(0, 120),
    isActive: isActive === 'true' || isActive === 'false' ? isActive : '',
    page: Number.isSafeInteger(rawPage) && rawPage > 0 && rawPage <= 100000 ? rawPage : 1,
  };
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
  const [filters, setFilters] = useState(readFilters);
  const [searchDraft, setSearchDraft] = useState(filters.search);
  const [statusDraft, setStatusDraft] = useState(filters.isActive);
  const page = filters.page;
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
  const isRegistration =
    route.kind === 'empresas' || route.kind === 'unidades' || route.kind === 'setores';
  const registrationSingular =
    route.kind === 'unidades' ? 'unidade' : route.kind === 'setores' ? 'setor' : 'empresa';
  const listPath =
    route.kind === 'empresas'
      ? '/organizations'
      : route.kind === 'unidades' && session.activeOrganizationId
        ? `/organizations/${encodeURIComponent(session.activeOrganizationId)}/units`
        : route.kind === 'setores' && session.activeOrganizationId && route.unitId
          ? `/units/${encodeURIComponent(route.unitId)}/sectors`
          : null;
  const loadKey = `${session.activeOrganizationId}-${listPath}-${JSON.stringify(filters)}-${attempt}`;
  const loading = !!listPath && loadedKey !== loadKey;
  const listing = loadedKey === loadKey ? loadedListing : null;
  useEffect(() => {
    const change = () => {
      const next = readRoute();
      const nextFilters = readFilters();
      setFilters(nextFilters);
      setSearchDraft(nextFilters.search);
      setStatusDraft(nextFilters.isActive);
      if (next.kind === route.kind && next.unitId === route.unitId) return;
      setRoute(next);
      setEditor(null);
      setConfirmation('');
      setError('');
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, [route.kind, route.unitId]);
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
    const query = new URLSearchParams({ page: String(page), pageSize: '50' });
    if (filters.search) query.set('search', filters.search);
    if (filters.isActive) query.set('isActive', filters.isActive);
    const path = `${listPath}?${query}`;
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
  }, [listPath, route.kind, page, filters.search, filters.isActive, loadKey, onExpire]);
  function setPage(nextPage: number, nextSearch = filters.search, nextStatus = filters.isActive) {
    const next = { page: nextPage, search: nextSearch.trim(), isActive: nextStatus };
    const query = new URLSearchParams();
    if (next.search) query.set('search', next.search);
    if (next.isActive) query.set('isActive', next.isActive);
    if (next.page > 1) query.set('page', String(next.page));
    setFilters(next);
    window.location.hash = `${window.location.hash.split('?')[0]}${query.size ? `?${query}` : ''}`;
  }
  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1, searchDraft, statusDraft);
  }
  async function select(item: { id: string }) {
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
      <WorkspaceNavigation
        session={session}
        route={route.kind}
        unitId={route.unitId}
        pending={pending}
        onSelect={(id) => void select({ id })}
      />
      <section className="workspace-content">
        <RouteMotion route={`${route.kind}-${route.unitId}`}>
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {route.kind === 'coletas'
                  ? 'COLETAS · CONTEXTO E RESULTADOS PROTEGIDOS'
                  : route.kind === 'instrumentos'
                    ? 'INSTRUMENTOS · CONTEÚDO VERSIONADO'
                    : route.kind === 'inventario'
                      ? 'DA IDENTIFICAÇÃO AO REGISTRO'
                      : route.kind === 'painel'
                        ? 'SEU CONTEXTO, EM PERSPECTIVA'
                        : route.kind === 'diagnostico'
                          ? 'ESCUTA COLETIVA · DADOS DEMONSTRATIVOS'
                          : 'ESTRUTURA ORGANIZACIONAL'}
              </p>
              <h1 ref={heading} tabIndex={-1}>
                {titles[route.kind]}
              </h1>
              <p className="muted">
                {route.kind === 'coletas'
                  ? 'Aplique instrumentos publicados e acompanhe cada coleta no contexto da empresa.'
                  : route.kind === 'instrumentos'
                    ? 'Crie instrumentos, confira a prévia e preserve cada versão publicada.'
                    : route.kind === 'acessos'
                      ? 'Gerencie vínculos e conceda somente as capacidades necessárias.'
                      : route.kind === 'acoes'
                        ? 'Organize medidas preventivas e preserve o histórico de acompanhamento.'
                        : route.kind === 'painel'
                          ? 'Conecte estrutura, registros e próximos passos da empresa selecionada.'
                          : route.kind === 'inventario'
                            ? 'Documente fatores, preserve a origem e acompanhe cada versão.'
                            : route.kind === 'diagnostico'
                              ? 'Aplique ciclos demonstrativos e consulte a consolidação coletiva.'
                              : route.kind === 'empresas'
                                ? 'Escolha a empresa em que você deseja trabalhar.'
                                : route.kind === 'unidades'
                                  ? 'Organize os locais de trabalho da empresa.'
                                  : 'Organize as equipes e áreas da unidade selecionada.'}
              </p>
            </div>
            {canWrite &&
              isRegistration &&
              listPath &&
              route.kind !== 'painel' &&
              route.kind !== 'diagnostico' &&
              route.kind !== 'inventario' &&
              route.kind !== 'acoes' &&
              route.kind !== 'acessos' && (
                <Button
                  disabled={pending}
                  onClick={() => {
                    setConfirmation('');
                    setEditor({ item: null });
                  }}
                >
                  {route.kind === 'setores' ? 'Novo setor' : `Nova ${registrationSingular}`}
                </Button>
              )}
          </div>
          {error && (
            <div role="alert" className="feedback error">
              <p>{error}</p>
              {listPath && (
                <Button variant="outline" onClick={() => setAttempt(attempt + 1)}>
                  Atualizar lista
                </Button>
              )}
            </div>
          )}
          {route.kind === 'coletas' ? (
            <Suspense fallback={<p role="status">Carregando coletas…</p>}>
              <AssessmentWorkspace session={session} onExpire={onExpire} />
            </Suspense>
          ) : route.kind === 'colaboradores' || route.kind === 'grupos' ? (
            <Suspense fallback={<p role="status">Carregando cadastros…</p>}>
              <WorkforceWorkspace
                key={`${session.activeOrganizationId}-${route.kind}`}
                kind={route.kind}
                session={session}
                onExpire={onExpire}
              />
            </Suspense>
          ) : route.kind === 'acessos' ? (
            <Suspense fallback={<p role="status">Verificando permissões de acesso…</p>}>
              <AccessWorkspace session={session} onSession={onSession} onExpire={onExpire} />
            </Suspense>
          ) : route.kind === 'acoes' ? (
            <Suspense
              fallback={
                <p role="status" className="surface">
                  Carregando ações…
                </p>
              }
            >
              <ActionsWorkspace
                key={session.activeOrganizationId ?? 'no-organization'}
                session={session}
                onExpire={onExpire}
              />
            </Suspense>
          ) : route.kind === 'inventario' ? (
            <Suspense
              fallback={
                <p role="status" className="surface">
                  Carregando inventário…
                </p>
              }
            >
              <RiskWorkspace
                key={session.activeOrganizationId ?? 'no-organization'}
                session={session}
                onExpire={onExpire}
              />
            </Suspense>
          ) : route.kind === 'instrumentos' ? (
            <Suspense
              fallback={
                <p role="status" className="surface">
                  Carregando instrumentos…
                </p>
              }
            >
              <InstrumentsWorkspace session={session} onExpire={onExpire} />
            </Suspense>
          ) : route.kind === 'diagnostico' ? (
            <Diagnostics key={session.activeOrganizationId} session={session} onExpire={onExpire} />
          ) : route.kind === 'painel' ? (
            <Suspense
              fallback={
                <p role="status" className="surface">
                  Carregando painel…
                </p>
              }
            >
              <ManagementDashboard
                key={session.activeOrganizationId ?? 'no-organization'}
                organizationId={session.activeOrganizationId}
                onExpire={onExpire}
              />
            </Suspense>
          ) : (
            <>
              {listPath && (
                <form
                  className="surface registration-filters"
                  aria-label="Filtros de cadastros"
                  onSubmit={applyFilters}
                >
                  <div>
                    <label htmlFor="registration-search">Buscar cadastros</label>
                    <input
                      id="registration-search"
                      type="search"
                      maxLength={120}
                      value={searchDraft}
                      onChange={(event) => setSearchDraft(event.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="registration-status">Situação dos cadastros</label>
                    <select
                      id="registration-status"
                      value={statusDraft}
                      onChange={(event) => setStatusDraft(event.target.value)}
                    >
                      <option value="">Todos</option>
                      <option value="true">Ativos</option>
                      <option value="false">Inativos</option>
                    </select>
                  </div>
                  <Button type="submit">Aplicar filtros</Button>
                </form>
              )}
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
                                {writable &&
                                  isRegistration &&
                                  route.kind !== 'painel' &&
                                  route.kind !== 'diagnostico' &&
                                  route.kind !== 'inventario' &&
                                  route.kind !== 'acoes' &&
                                  route.kind !== 'acessos' && (
                                    <Button
                                      variant="outline"
                                      disabled={pending}
                                      aria-label={`Editar ${registrationSingular} ${item.name}`}
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
                  <StructureEditor
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
            </>
          )}
        </RouteMotion>
      </section>
    </div>
  );
}
