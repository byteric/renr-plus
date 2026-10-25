import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  instrumentListSchema,
  instrumentSchema,
  instrumentVersionListSchema,
  instrumentVersionSchema,
  createdInstrumentSchema,
  createInstrumentSchema,
  sessionCapabilitiesSchema,
  type SessionResponse,
} from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { useWorkforceData } from '../workforce/useWorkforceData';
import { Button } from '../ui/button';
import { StatusMessage } from '../ui/status-message';
import { StatusBadge } from '../ui/status-badge';
import { Pagination } from '../ui/pagination';
import './instruments.css';
import { InstrumentEditor } from './InstrumentEditor';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Route = {
  search: string;
  page: number;
  versionPage: number;
  instrument: string;
  version: string;
  create: boolean;
};
function routeFromUrl(): Route {
  const query = new URLSearchParams(location.hash.split('?')[1]);
  const number = (key: string) => {
    const value = Number(query.get(key) || 1);
    return Number.isSafeInteger(value) && value > 0 && value <= 100000 ? value : 1;
  };
  const id = (key: string) => (uuid.test(query.get(key) || '') ? query.get(key)! : '');
  return {
    search: (query.get('search') || '').slice(0, 160),
    page: number('page'),
    versionPage: number('versionPage'),
    instrument: id('instrument'),
    version: id('version'),
    create: query.get('create') === 'true',
  };
}
function routeUrl(route: Route) {
  const query = new URLSearchParams();
  if (route.search) query.set('search', route.search);
  if (route.page > 1) query.set('page', String(route.page));
  if (route.instrument) query.set('instrument', route.instrument);
  if (route.version) query.set('version', route.version);
  if (route.versionPage > 1) query.set('versionPage', String(route.versionPage));
  if (route.create) query.set('create', 'true');
  return `#/instrumentos${query.size ? '?' + query : ''}`;
}
export function InstrumentsWorkspace({
  session,
  onExpire,
}: {
  session: SessionResponse;
  onExpire: () => void;
}) {
  const org = session.activeOrganizationId;
  if (!org)
    return (
      <StatusMessage>
        Selecione uma empresa. <a href="#/empresas">Ir para Empresas</a>
      </StatusMessage>
    );
  const membership = session.memberships.find((value) => value.organizationId === org);
  if (!membership)
    return (
      <StatusMessage tone="error">Este catálogo não está disponível para seu acesso.</StatusMessage>
    );
  return (
    <InstrumentManager
      key={org}
      organizationId={org}
      canEdit={membership.role === 'ADMIN'}
      onExpire={onExpire}
    />
  );
}
function InstrumentManager({
  organizationId,
  canEdit,
  onExpire,
}: {
  organizationId: string;
  canEdit: boolean;
  onExpire: () => void;
}) {
  const [route, setRoute] = useState(routeFromUrl);
  const [search, setSearch] = useState(route.search);
  const [attempt, setAttempt] = useState(0);
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const nameInput = useRef<HTMLInputElement>(null);
  const controller = useRef(new AbortController());
  useEffect(() => {
    const change = () => {
      const next = routeFromUrl();
      setRoute(next);
      setSearch(next.search);
      setError('');
    };
    addEventListener('hashchange', change);
    return () => removeEventListener('hashchange', change);
  }, []);
  useEffect(() => {
    controller.current = new AbortController();
    const current = controller.current;
    return () => current.abort();
  }, []);
  useEffect(() => {
    if (route.create) nameInput.current?.focus();
  }, [route.create]);
  function navigate(change: Partial<Route>) {
    const next = { ...route, ...change };
    location.hash = routeUrl(next);
    setRoute(next);
    setError('');
  }
  const base = `/organizations/${organizationId}/instruments`;
  const query = new URLSearchParams({ page: String(route.page), pageSize: '20' });
  if (route.search) query.set('search', route.search);
  const listing = useWorkforceData(
    !route.instrument ? `${base}?${query}` : null,
    instrumentListSchema,
    organizationId,
    onExpire,
    attempt,
  );
  const identity = useWorkforceData(
    route.instrument ? `${base}/${route.instrument}` : null,
    instrumentSchema,
    organizationId,
    onExpire,
    attempt,
  );
  const versions = useWorkforceData(
    route.instrument && !route.version
      ? `${base}/${route.instrument}/versions?page=${route.versionPage}&pageSize=20`
      : null,
    instrumentVersionListSchema,
    organizationId,
    onExpire,
    attempt,
  );
  const version = useWorkforceData(
    route.instrument && route.version
      ? `${base}/${route.instrument}/versions/${route.version}`
      : null,
    instrumentVersionSchema,
    organizationId,
    onExpire,
    attempt,
  );
  const capabilities = useWorkforceData(
    '/auth/session-capabilities',
    sessionCapabilitiesSchema,
    organizationId,
    onExpire,
    attempt,
  );
  async function create(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const parsed = createInstrumentSchema.safeParse({ name });
    if (!parsed.success) {
      setError('Informe um nome de instrumento entre 2 e 160 caracteres.');
      nameInput.current?.focus();
      return;
    }
    setPending(true);
    setError('');
    try {
      const result = await request(base, createdInstrumentSchema, {
        method: 'POST',
        body: JSON.stringify(parsed.data),
        signal: controller.current.signal,
      });
      if (controller.current.signal.aborted) return;
      if (
        result.instrument.organizationId !== organizationId ||
        result.version.instrumentId !== result.instrument.id
      )
        throw new RequestError(502);
      setName('');
      navigate({ create: false, instrument: result.instrument.id, version: result.version.id });
      setAttempt((value) => value + 1);
    } catch (failure) {
      if (controller.current.signal.aborted) return;
      if (failure instanceof RequestError && failure.status === 401) return onExpire();
      setError(
        failure instanceof Error ? failure.message : 'Não foi possível criar o instrumento.',
      );
    } finally {
      if (!controller.current.signal.aborted) setPending(false);
    }
  }
  const current = route.instrument ? (route.version ? version : versions) : listing;
  return (
    <div className="instruments-workspace">
      <nav className="instrument-context" aria-label="Catálogo e versões">
        {route.instrument && (
          <Button
            variant="outline"
            onClick={() => navigate({ instrument: '', version: '', versionPage: 1 })}
          >
            Voltar ao catálogo
          </Button>
        )}
        {route.version && (
          <Button variant="outline" onClick={() => navigate({ version: '' })}>
            Ver versões
          </Button>
        )}
      </nav>
      <StatusMessage>
        Instrumentos publicados preservam seu conteúdo. Os ciclos existentes continuam associados à
        versão original.
      </StatusMessage>
      {error && <StatusMessage tone="error">{error}</StatusMessage>}
      {current.error && (
        <StatusMessage
          tone="error"
          action={
            <Button onClick={() => setAttempt((value) => value + 1)}>Tentar novamente</Button>
          }
        >
          {current.error}
        </StatusMessage>
      )}
      {current.loading && !current.data && (
        <StatusMessage tone="loading">Carregando catálogo…</StatusMessage>
      )}
      {!route.instrument && (
        <>
          <div className="instrument-toolbar">
            <h2>Catálogo da empresa</h2>
            {canEdit && (
              <Button onClick={() => navigate({ create: true })}>Novo instrumento</Button>
            )}
          </div>
          {route.create && canEdit && (
            <section className="surface">
              <h2>Criar instrumento</h2>
              <form
                aria-label="Criar instrumento"
                onSubmit={(event) => void create(event)}
                noValidate
              >
                <label htmlFor="instrument-name">Nome do instrumento</label>
                <input
                  ref={nameInput}
                  id="instrument-name"
                  maxLength={160}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={pending}
                />
                <p className="input-hint">
                  A primeira versão será um rascunho demonstrativo. A criação não abre ciclos de
                  diagnóstico.
                </p>
                <div className="form-actions">
                  <Button type="submit" disabled={pending}>
                    {pending ? 'Criando…' : 'Criar rascunho'}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() => navigate({ create: false })}
                  >
                    Cancelar criação
                  </Button>
                </div>
              </form>
            </section>
          )}
          <form
            className="surface instrument-search"
            aria-label="Buscar instrumentos"
            onSubmit={(event) => {
              event.preventDefault();
              navigate({ search: search.trim(), page: 1 });
            }}
          >
            <label htmlFor="instrument-search">Buscar instrumentos</label>
            <input
              id="instrument-search"
              type="search"
              maxLength={160}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Button type="submit">Buscar no catálogo</Button>
          </form>
          {listing.data && (
            <>
              <ul className="instrument-list">
                {listing.data.items.map((item) => (
                  <li key={item.id} className="surface">
                    <div>
                      <h2>{item.name}</h2>
                      {item.isLegacy && <StatusBadge tone="neutral" label="Demonstração legada" />}
                    </div>
                    <Button
                      variant="outline"
                      aria-label={`Ver versões de ${item.name}`}
                      onClick={() => navigate({ instrument: item.id, versionPage: 1 })}
                    >
                      Ver versões
                    </Button>
                  </li>
                ))}
              </ul>
              {!listing.data.total && (
                <StatusMessage>
                  Nenhum instrumento encontrado. Ajuste a busca ou crie um novo instrumento.
                </StatusMessage>
              )}
              <Pagination
                label="Paginação do catálogo"
                page={route.page}
                pageSize={listing.data.pageSize}
                total={listing.data.total}
                pending={listing.loading}
                onPageChange={(page) => navigate({ page })}
              />
            </>
          )}
        </>
      )}
      {route.instrument && identity.data && <h2>{identity.data.name}</h2>}
      {route.instrument && !route.version && versions.data && (
        <>
          <ul className="instrument-list">
            {versions.data.items.map((item) => (
              <li key={item.id} className="surface">
                <div>
                  <h3>{item.title || 'Rascunho sem título'}</h3>
                  <p>
                    Versão {item.version} · {item.questionCount} perguntas · {item.cycleCount}{' '}
                    ciclos associados
                  </p>
                  <StatusBadge
                    tone={item.status === 'PUBLISHED' ? 'info' : 'neutral'}
                    label={item.status === 'PUBLISHED' ? 'Publicada' : 'Rascunho'}
                  />
                  <p>{item.usageMode === 'REAL' ? 'Uso real' : 'Demonstração'}</p>
                </div>
                <Button
                  variant="outline"
                  aria-label={`Abrir versão ${item.version}`}
                  onClick={() => navigate({ version: item.id })}
                >
                  Abrir versão
                </Button>
              </li>
            ))}
          </ul>
          <Pagination
            label="Paginação das versões"
            page={route.versionPage}
            pageSize={versions.data.pageSize}
            total={versions.data.total}
            onPageChange={(versionPage) => navigate({ versionPage })}
          />
        </>
      )}
      {route.version &&
        version.data &&
        (version.data.instrumentId !== route.instrument || version.data.id !== route.version) && (
          <StatusMessage tone="error">
            A versão recebida não corresponde ao instrumento solicitado. Volte ao catálogo e tente
            novamente.
          </StatusMessage>
        )}
      {route.version &&
        version.data &&
        version.data.instrumentId === route.instrument &&
        version.data.id === route.version && (
          <InstrumentEditor
            key={version.data.id}
            initialVersion={version.data}
            organizationId={organizationId}
            canEdit={canEdit}
            canPublishReal={
              capabilities.data?.capabilities.includes('TECHNICAL_DECISIONS') ?? false
            }
            onExpire={onExpire}
            onSaved={() => setAttempt((value) => value + 1)}
            onFork={(version) => navigate({ version })}
          />
        )}
    </div>
  );
}
