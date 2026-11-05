import { fiscalLabels } from '../../lib/fiscal-labels';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  platformCapabilitiesSchema,
  platformClientListSchema,
  platformOverviewSchema,
  platformQuerySchema,
} from '@renr/contracts';
import { Button } from '../ui/button';
import { StatusMessage } from '../ui/status-message';
import { Pagination } from '../ui/pagination';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '../ui/sheet';
import { usePresentationMotion } from '../../hooks/usePresentationMotion';
import { useAccessRefresh, usePrivateQuery } from './usePrivateQuery';
import { ClientEditor } from './PlatformEditors';
import { PlatformGrants } from './PlatformGrants';
import './platform.css';

type Client = ReturnType<typeof platformClientListSchema.parse>['items'][number];
type Filter = {
  search: string;
  isActive: string;
  classification: string;
  fiscalState: string;
  page: number;
  invalid?: boolean;
};
function readFilters(): Filter {
  const query = new URLSearchParams(window.location.hash.split('?')[1]);
  const raw = Object.fromEntries(
    ['search', 'isActive', 'classification', 'fiscalState', 'page']
      .filter((key) => query.has(key))
      .map((key) => [key, query.get(key)]),
  );
  if (raw.fiscalState === 'ALL') delete raw.fiscalState;
  const parsed = platformQuerySchema.safeParse(raw);
  const duplicate = Object.keys(raw).some((key) => query.getAll(key).length > 1);
  return {
    search: query.get('search') ?? '',
    isActive: query.get('isActive') ?? '',
    classification: query.get('classification') ?? 'CLIENT',
    fiscalState: query.get('fiscalState') === 'ALL' ? '' : (query.get('fiscalState') ?? 'VALID'),
    page: parsed.success ? parsed.data.page : 1,
    invalid: !parsed.success || duplicate || query.getAll('fiscalState').length > 1,
  };
}
function queryFor(filters: Filter) {
  const query = new URLSearchParams({ page: String(filters.page), pageSize: '25' });
  for (const key of ['search', 'isActive', 'classification', 'fiscalState'] as const)
    if (filters[key]) query.set(key, filters[key]);
  return query;
}
const classificationLabels = {
  CLIENT: 'Cliente',
  DEMONSTRATION: 'Demonstração',
  UNCLASSIFIED: 'Não classificado',
};

export function PlatformWorkspace({ onExpire }: { onExpire: () => void }) {
  const access = useAccessRefresh();
  const [expired, setExpired] = useState(false);
  const [denied, setDenied] = useState(false);
  const expire = useCallback(() => {
    setExpired(true);
    onExpire();
  }, [onExpire]);
  const deny = useCallback(() => setDenied(true), []);
  const capabilities = usePrivateQuery(
    expired ? null : '/platform/capabilities',
    platformCapabilitiesSchema,
    access.revision,
    expire,
    deny,
    undefined,
    true,
  );
  if (expired)
    return (
      <StatusMessage tone="error">
        Sua sessão terminou. Os dados da plataforma foram removidos.
      </StatusMessage>
    );
  if (capabilities.loading && !capabilities.data)
    return <StatusMessage tone="loading">Verificando acesso à plataforma…</StatusMessage>;
  if (capabilities.error || denied)
    return (
      <StatusMessage
        tone="error"
        action={
          <Button
            onClick={() => {
              setDenied(false);
              access.refresh();
            }}
          >
            Revalidar acesso
          </Button>
        }
      >
        {capabilities.error || 'Seu acesso à plataforma foi revogado. Os dados foram removidos.'}
      </StatusMessage>
    );
  const grants = capabilities.data?.capabilities ?? [];
  if (!grants.length)
    return <StatusMessage>O acesso à plataforma requer uma concessão específica.</StatusMessage>;
  return (
    <PlatformContent
      key={[...grants].sort().join(',')}
      grants={grants}
      onExpire={expire}
      onDenied={deny}
    />
  );
}
function PlatformContent({
  grants,
  onExpire,
  onDenied,
}: {
  grants: string[];
  onExpire: () => void;
  onDenied: () => void;
}) {
  const read = grants.includes('READ_OVERVIEW');
  const [area, setArea] = useState(read ? 'clients' : 'grants');
  const [filters, setFilters] = useState(readFilters);
  const [draft, setDraft] = useState(filters);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<Client | null>(null);
  const [notice, setNotice] = useState('');
  const editorTrigger = useRef<HTMLButtonElement>(null);
  const catalogHeading = useRef<HTMLHeadingElement>(null);
  const platformHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const change = () => {
      const value = readFilters();
      setFilters(value);
      setDraft(value);
      setSelected(null);
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  const overview = usePrivateQuery(
    read && area === 'clients' && !filters.invalid ? '/platform/overview' : null,
    platformOverviewSchema,
    revision,
    onExpire,
    onDenied,
  );
  const query = queryFor(filters);
  const listPath = `/platform/clients?${query}`;
  const clients = usePrivateQuery(
    read && area === 'clients' && !filters.invalid ? listPath : null,
    platformClientListSchema,
    revision,
    onExpire,
    onDenied,
  );
  const scope = useRef<HTMLElement>(null);
  usePresentationMotion(scope, overview.data);
  function navigate(next: Filter) {
    const query = queryFor(next);
    query.delete('pageSize');
    // Explicit ALL survives reload; an omitted filter keeps the safe default.
    if (!next.fiscalState) query.set('fiscalState', 'ALL');
    window.history.replaceState(
      null,
      '',
      `${window.location.hash.split('?')[0] || '#/plataforma'}?${query}`,
    );
    setFilters(next);
    setDraft(next);
    setSelected(null);
    setError('');
  }
  function apply(event: FormEvent) {
    event.preventDefault();
    if (!platformQuerySchema.safeParse(Object.fromEntries(queryFor(draft))).success) {
      setError('Confira os filtros antes de consultar.');
      return;
    }
    navigate({ ...draft, page: 1, invalid: false });
  }
  return (
    <section ref={scope} className="platform-workspace" aria-labelledby="platform-title">
      <header className="platform-heading">
        <div>
          <p className="eyebrow">PERCURSO · PLATAFORMA</p>
          <h2 ref={platformHeading} tabIndex={-1} id="platform-title">
            Clientes atendidos
          </h2>
          <p>
            Visão global de cadastros e concessões. Este acesso não permite entrar no contexto
            nominal das empresas.
          </p>
        </div>
        <Button variant="outline" onClick={() => setRevision((value) => value + 1)}>
          Atualizar plataforma
        </Button>
      </header>
      <nav className="platform-areas" aria-label="Áreas da plataforma">
        <Button
          variant={area === 'clients' ? 'default' : 'outline'}
          aria-pressed={area === 'clients'}
          onClick={() => setArea('clients')}
        >
          Resumo e clientes
        </Button>
        <Button
          variant={area === 'grants' ? 'default' : 'outline'}
          aria-pressed={area === 'grants'}
          onClick={() => setArea('grants')}
        >
          Concessões globais
        </Button>
      </nav>
      {area === 'grants' ? (
        grants.includes('MANAGE_GRANTS') ? (
          <PlatformGrants onExpire={onExpire} onDenied={onDenied} />
        ) : (
          <StatusMessage>
            A gestão de concessões exige permissão específica da plataforma.
          </StatusMessage>
        )
      ) : !read ? (
        <StatusMessage>O resumo e o catálogo exigem leitura da plataforma.</StatusMessage>
      ) : (
        <>
          <form onSubmit={apply} className="platform-filters" aria-label="Filtros de clientes">
            <label>
              Nome ou CNPJ
              <input
                value={draft.search}
                maxLength={160}
                onChange={(event) => setDraft({ ...draft, search: event.target.value })}
              />
            </label>
            <label>
              Situação
              <select
                value={draft.isActive}
                onChange={(event) => setDraft({ ...draft, isActive: event.target.value })}
              >
                <option value="">Todas</option>
                <option value="true">Ativos</option>
                <option value="false">Inativos</option>
              </select>
            </label>
            <label>
              Classificação
              <select
                value={draft.classification}
                onChange={(event) => setDraft({ ...draft, classification: event.target.value })}
              >
                {Object.entries(classificationLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Estado fiscal
              <select
                value={draft.fiscalState}
                onChange={(event) => setDraft({ ...draft, fiscalState: event.target.value })}
              >
                <option value="">Todos (inclui pendências)</option>
                {Object.entries(fiscalLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit">Aplicar filtros</Button>
            <Button
              variant="outline"
              onClick={() =>
                navigate({
                  search: '',
                  isActive: '',
                  classification: 'CLIENT',
                  fiscalState: 'VALID',
                  page: 1,
                })
              }
            >
              Restaurar clientes válidos
            </Button>
          </form>
          {(error || filters.invalid) && (
            <StatusMessage tone="error">
              {error ||
                'Filtros da URL inválidos ou duplicados. Corrija o recorte ou restaure os clientes válidos.'}
            </StatusMessage>
          )}
          {!filters.invalid && (
            <>
              {overview.loading && <StatusMessage tone="loading">Carregando resumo…</StatusMessage>}
              {overview.error && (
                <StatusMessage tone="error">
                  Resumo indisponível. O catálogo pode continuar disponível. {overview.error}
                </StatusMessage>
              )}
              {overview.data && (
                <>
                  <p>
                    Referência {overview.data.referenceDate} · {overview.data.timeZone}. Totais de
                    clientes classificados com CNPJ válido; o catálogo abaixo possui recorte
                    independente.
                  </p>
                  <div className="platform-metrics">
                    {[
                      ['Clientes', overview.data.organizations],
                      ['CNPJs válidos', overview.data.validatedCnpjs],
                      ['Clientes ativos', overview.data.activeClients],
                      ['Clientes inativos', overview.data.inactiveClients],
                      ['Não classificados', overview.data.unclassified],
                      ['Demonstrações', overview.data.demonstrations],
                      ['Pendências fiscais', overview.data.pendingFiscal],
                      ['Registros ativos', overview.data.employees.active],
                      ['Registros inativos', overview.data.employees.inactive],
                    ].map(([label, value]) => (
                      <article key={label}>
                        <h3>{label}</h3>
                        <strong data-motion-value="">{value}</strong>
                      </article>
                    ))}
                  </div>
                  <p>
                    Colaboradores são contados por registro, não por pessoas únicas. Não há dados
                    nominais ou financeiros nesta visão.
                  </p>
                </>
              )}
              {notice && <StatusMessage tone="success">{notice}</StatusMessage>}
              {clients.loading && (
                <StatusMessage tone="loading">Carregando catálogo…</StatusMessage>
              )}
              {clients.error && (
                <StatusMessage tone="error">Catálogo indisponível. {clients.error}</StatusMessage>
              )}
              {clients.data && (
                <>
                  <h3 ref={catalogHeading} tabIndex={-1}>
                    Catálogo de clientes
                  </h3>
                  <p>{clients.data.total} cadastros no recorte selecionado.</p>
                  <ul className="platform-records">
                    {clients.data.items.map((client) => (
                      <li key={client.organizationId}>
                        <div>
                          <strong>{client.name}</strong>
                          <p>
                            CNPJ: {client.fiscalIdentifier || 'Não informado'} ·{' '}
                            {fiscalLabels[client.fiscalState]}
                          </p>
                          <p>
                            {classificationLabels[client.clientClassification]} ·{' '}
                            {client.isActive ? 'Ativo' : 'Inativo'}
                          </p>
                          <p>
                            Registros: {client.employees.active} ativos ·{' '}
                            {client.employees.inactive} inativos
                          </p>
                        </div>
                        {grants.includes('MANAGE_CLIENTS') && (
                          <Button
                            variant="outline"
                            aria-label={`Corrigir cadastro de ${client.name}`}
                            onClick={(event) => {
                              editorTrigger.current = event.currentTarget;
                              setSelected(client);
                            }}
                          >
                            Corrigir cadastro
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                  {!clients.data.items.length && (
                    <StatusMessage>Nenhum cadastro neste recorte.</StatusMessage>
                  )}
                  <Pagination
                    label="Páginas do catálogo"
                    page={clients.data.page}
                    pageSize={25}
                    total={clients.data.total}
                    onPageChange={(page) => navigate({ ...filters, page })}
                  />
                </>
              )}
            </>
          )}
        </>
      )}
      <Sheet
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <SheetContent
          className="platform-sheet"
          closeLabel="Fechar correção de cadastro"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const trigger = editorTrigger.current;
            (trigger?.isConnected
              ? trigger
              : (catalogHeading.current ?? platformHeading.current)
            )?.focus();
          }}
        >
          <SheetTitle>Correção assistida de cadastro</SheetTitle>
          <SheetDescription>
            Administração da plataforma. Revise CNPJ, classificação e situação. A alteração fica
            vinculada ao motivo informado.
          </SheetDescription>
          {selected && (
            <ClientEditor
              key={selected.organizationId}
              client={selected}
              listPath={listPath}
              onSaved={() => {
                setSelected(null);
                setNotice('Cadastro atualizado com histórico.');
                setRevision((value) => value + 1);
              }}
              onExpire={onExpire}
              onDenied={onDenied}
            />
          )}
        </SheetContent>
      </Sheet>
    </section>
  );
}
