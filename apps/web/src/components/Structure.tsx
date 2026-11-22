import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  organizationListSchema,
  unitListSchema,
  sectorListSchema,
  sessionResponseSchema,
  sessionCapabilitiesSchema,
  platformCapabilitiesSchema,
  type Organization,
  type Unit,
  type Sector,
  type SessionResponse,
} from '@renr/contracts';
import { Button } from './ui/button';
import { FilterDisclosure } from './ui/filter-disclosure';
import { StatusMessage } from './ui/status-message';
import { request, RequestError } from '../lib/api';
import { Diagnostics } from './Diagnostics';
import { WorkspaceNavigation } from './WorkspaceNavigation';
import { RouteMotion } from './RouteMotion';
import { StructureEditor } from './StructureEditor';
import { useRiskData } from './risks/useRiskData';
import {
  hasBillingAccess,
  hasCommercialAccess,
  hasCommercialCatalogAccess,
  hasContractAccessPermission,
  hasPlatformAdministration,
  hasSupportAccess,
} from '../lib/commercial-permissions';
import { StatusBadge } from './ui/status-badge';
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
const PasswordRecoveryIssue = lazy(() =>
  import('./access/PasswordRecoveryIssue').then((module) => ({
    default: module.PasswordRecoveryIssue,
  })),
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
const AuditWorkspace = lazy(() =>
  import('./history/AuditWorkspace').then((module) => ({ default: module.AuditWorkspace })),
);
const PeopleWorkspace = lazy(() =>
  import('./people/PeopleWorkspace').then((module) => ({ default: module.PeopleWorkspace })),
);
const PlatformWorkspace = lazy(() =>
  import('./platform/PlatformWorkspace').then((module) => ({ default: module.PlatformWorkspace })),
);
const CompanyGroupsWorkspace = lazy(() =>
  import('./platform/CompanyGroupsWorkspace').then((module) => ({
    default: module.CompanyGroupsWorkspace,
  })),
);
const CompanyGroupsAdmin = lazy(() =>
  import('./platform/CompanyGroupsAdmin').then((module) => ({
    default: module.CompanyGroupsAdmin,
  })),
);
const CommercialWorkspace = lazy(() =>
  import('./platform/commercial/CommercialWorkspace').then((module) => ({
    default: module.CommercialWorkspace,
  })),
);
const SupportWorkspace = lazy(() =>
  import('./support/SupportWorkspace').then((module) => ({ default: module.SupportWorkspace })),
);
const ReportsWorkspace = lazy(() =>
  import('./reports/ReportsWorkspace').then((module) => ({ default: module.ReportsWorkspace })),
);

type Kind = 'empresas' | 'unidades' | 'setores';
type RecordItem = Organization | Unit | Sector;
type Route = {
  kind:
    | Kind
    | 'home'
    | 'painel'
    | 'diagnostico'
    | 'inventario'
    | 'acoes'
    | 'acessos'
    | 'auditoria'
    | 'instrumentos'
    | 'coletas'
    | 'colaboradores'
    | 'grupos'
    | 'pessoas'
    | 'plataforma'
    | 'platform-groups'
    | 'platform-commercial'
    | 'platform-support'
    | 'platform-recovery'
    | 'chamados'
    | 'consolidado'
    | 'relatorios'
    | 'platform-reports';
  unitId: string | null;
  ticketId?: string;
};
function readRoute(): Route {
  const hash = window.location.hash;
  if (!hash || hash === '#/') return { kind: 'home', unitId: null };
  const parts = hash.replace(/^#\/?/, '').split('?')[0]?.split('/') ?? [];
  if (parts[0] === 'chamados') return { kind: 'chamados', unitId: null, ticketId: parts[1] };
  if (parts[0] === 'plataforma' && parts[1] === 'chamados')
    return { kind: 'platform-support', unitId: null, ticketId: parts[2] };
  if (parts[0] === 'plataforma' && parts[1] === 'recuperacao')
    return { kind: 'platform-recovery', unitId: null };
  if (parts[0] === 'pessoas' || parts[0] === 'relatorios') return { kind: parts[0], unitId: null };
  if (parts[0] === 'plataforma')
    return {
      kind:
        parts[1] === 'relatorios'
          ? 'platform-reports'
          : parts[1] === 'grupos'
            ? 'platform-groups'
            : parts[1] === 'comercial'
              ? 'platform-commercial'
              : 'plataforma',
      unitId: null,
    };
  if (parts[0] === 'consolidado') return { kind: 'consolidado', unitId: null };
  if (parts[0] === 'coletas') return { kind: 'coletas', unitId: null };
  if (parts[0] === 'instrumentos') return { kind: 'instrumentos', unitId: null };
  if (parts[0] === 'colaboradores' || parts[0] === 'grupos')
    return { kind: parts[0], unitId: null };
  if (parts[0] === 'acessos') return { kind: 'acessos', unitId: null };
  if (parts[0] === 'auditoria') return { kind: 'auditoria', unitId: null };
  if (parts[0] === 'inventario') return { kind: 'inventario', unitId: null };
  if (parts[0] === 'acoes') return { kind: 'acoes', unitId: null };
  if (parts[0] === 'diagnostico') return { kind: 'diagnostico', unitId: null };
  if (parts[0] === 'painel') return { kind: 'painel', unitId: null };
  if (parts[0] === 'unidades') return { kind: 'unidades', unitId: null };
  if (parts[0] === 'setores' && /^[0-9a-f-]{36}$/i.test(parts[1] ?? ''))
    return { kind: 'setores', unitId: parts[1] ?? null };
  return { kind: 'empresas', unitId: null };
}
const titles: Record<Exclude<Route['kind'], 'home'>, string> = {
  pessoas: 'Gestão de Pessoas',
  plataforma: 'Administração da plataforma',
  'platform-groups': 'Gerenciar grupos de empresas',
  'platform-commercial': 'Comercial',
  'platform-support': 'Atendimento de chamados',
  'platform-recovery': 'Recuperação de acesso',
  chamados: 'Chamados',
  consolidado: 'Consolidado de empresas',
  relatorios: 'Relatórios',
  'platform-reports': 'Relatórios da plataforma',
  coletas: 'Coletas',
  instrumentos: 'Instrumentos',
  colaboradores: 'Colaboradores',
  grupos: 'Grupos de avaliação',
  painel: 'Painel',
  diagnostico: 'Diagnóstico demonstrativo',
  inventario: 'Inventário',
  acoes: 'Ações',
  acessos: 'Acessos',
  auditoria: 'Auditoria',
  empresas: 'Empresas',
  unidades: 'Unidades',
  setores: 'Setores',
};
const descriptions: Record<keyof typeof titles, string> = {
  pessoas: 'Consulte perfis e indicadores de RH conforme suas permissões na empresa.',
  plataforma: 'Acompanhe as empresas atendidas pela ReTech+ no catálogo da plataforma.',
  'platform-groups': 'Organize os CNPJs por grupo e conceda acesso à visão consolidada.',
  'platform-commercial':
    'Gerencie ofertas, cadastros comerciais, contratos, cobranças e acesso contratual registrados pela operação.',
  'platform-support': 'Acompanhe os chamados das empresas e registre o andamento do atendimento.',
  'platform-recovery': 'Emita links temporários após a conferência de identidade.',
  chamados: 'Envie solicitações e acompanhe o atendimento da sua empresa.',
  consolidado: 'Consulte indicadores agregados das empresas autorizadas em cada grupo.',
  'platform-reports': 'Consulte os relatórios globais das empresas atendidas.',
  relatorios: 'Emita uma versão preservada dos dados e consulte a prévia antes do download.',
  coletas: 'Aplique instrumentos publicados e acompanhe cada coleta da empresa.',
  instrumentos: 'Crie instrumentos, confira a prévia e preserve cada versão publicada.',
  colaboradores: 'Cadastre os colaboradores e vincule cada pessoa à unidade e ao setor.',
  grupos: 'Organize os grupos de avaliação vinculados aos setores.',
  painel: 'Consulte a situação da empresa, as pendências e as próximas etapas.',
  diagnostico: 'Aplique ciclos demonstrativos e consulte a consolidação coletiva.',
  inventario: 'Documente fatores, preserve a origem e acompanhe cada versão.',
  acoes: 'Organize medidas preventivas e acompanhe seu andamento.',
  acessos: 'Gerencie vínculos e conceda as permissões necessárias a cada função.',
  auditoria: 'Consulte o histórico de operações da empresa e os registros correspondentes.',
  empresas: 'Escolha a empresa em que você deseja trabalhar.',
  unidades: 'Organize os locais de trabalho da empresa e abra seus setores.',
  setores: 'Organize as equipes e áreas da unidade selecionada.',
};
const singular: Record<Kind, string> = {
  empresas: 'empresa',
  unidades: 'unidade',
  setores: 'setor',
};
type Listing = { items: RecordItem[]; total: number; page: number; pageSize: number };
const delegatedRoutes = new Set<Route['kind']>([
  'empresas',
  'unidades',
  'setores',
  'painel',
  'coletas',
  'inventario',
  'acoes',
  'relatorios',
]);
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
  const delegatedScopes = session.activeOrganizationId
    ? session.organizationScopes?.[session.activeOrganizationId]
    : undefined;
  const canWrite = membership?.role === 'ADMIN' && delegatedScopes === undefined;
  const access = useRiskData('/auth/session-capabilities', sessionCapabilitiesSchema, onExpire);
  const [scopeAttempt, setScopeAttempt] = useState(0);
  const globalAccess = useRiskData(
    '/platform/capabilities',
    platformCapabilitiesSchema,
    onExpire,
    scopeAttempt,
  );
  const capabilities =
    access.data?.organizationId === session.activeOrganizationId
      ? (access.data?.capabilities ?? [])
      : [];
  const platformCapabilities = globalAccess.data?.capabilities ?? [];
  const hasCompanies = session.memberships.length > 0;
  const hasSuspendedCompanies = (session.suspendedOrganizations?.length ?? 0) > 0;
  const canManagePasswordRecovery = platformCapabilities.includes('MANAGE_PASSWORD_RECOVERY');
  const canRecoverMfa = platformCapabilities.includes('RECOVER_ACCOUNT_MFA');
  const platformOnly =
    !hasCompanies &&
    platformCapabilities.some((capability) => capability !== 'ASSIST_COMPANY_PASSWORD_RECOVERY');
  const isPlatformRoute =
    route.kind === 'plataforma' ||
    route.kind === 'platform-reports' ||
    route.kind === 'platform-groups' ||
    route.kind === 'platform-support' ||
    route.kind === 'platform-recovery' ||
    route.kind === 'platform-commercial';
  const isGroupRoute = route.kind === 'consolidado';
  const groupOnly = !hasCompanies && session.hasCompanyGroups && !platformOnly;
  const companyRoute = !isPlatformRoute && !isGroupRoute;
  const allowSuspendedCompaniesPage = hasSuspendedCompanies && route.kind === 'empresas';
  const restrictedRoute =
    companyRoute && delegatedScopes !== undefined && !delegatedRoutes.has(route.kind);
  const emptyDelegation = companyRoute && delegatedScopes?.length === 0;
  const resolvingScope = !hasCompanies && globalAccess.loading;
  const scopeError = !hasCompanies && globalAccess.error;
  const redirect =
    platformOnly && companyRoute && !allowSuspendedCompaniesPage
      ? hasPlatformAdministration(platformCapabilities)
        ? 'plataforma'
        : (canManagePasswordRecovery || canRecoverMfa) && !hasCommercialAccess(platformCapabilities)
          ? 'plataforma/recuperacao'
          : 'plataforma/comercial'
      : groupOnly && companyRoute && !allowSuspendedCompaniesPage
        ? 'consolidado'
        : route.kind === 'home' && !resolvingScope && !scopeError
          ? delegatedScopes
            ? 'painel'
            : 'empresas'
          : null;
  const isRegistration =
    route.kind === 'empresas' || route.kind === 'unidades' || route.kind === 'setores';
  const registrationSingular =
    route.kind === 'unidades' ? 'unidade' : route.kind === 'setores' ? 'setor' : 'empresa';
  const listPath =
    ((platformOnly || groupOnly) && !allowSuspendedCompaniesPage) ||
    emptyDelegation ||
    resolvingScope ||
    scopeError
      ? null
      : route.kind === 'empresas'
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
    if (!redirect || readRoute().kind !== route.kind) return;
    window.location.replace(`#/${redirect}`);
  }, [route.kind, redirect]);
  useEffect(() => {
    const change = () => {
      const next = readRoute();
      const nextFilters = readFilters();
      setFilters(nextFilters);
      setSearchDraft(nextFilters.search);
      setStatusDraft(nextFilters.isActive);
      if (
        next.kind === route.kind &&
        next.unitId === route.unitId &&
        next.ticketId === route.ticketId
      )
        return;
      setRoute(next);
      setEditor(null);
      setConfirmation('');
      setError('');
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, [route.kind, route.unitId, route.ticketId]);
  useEffect(() => {
    mutationController.current = new AbortController();
    const current = mutationController.current;
    return () => current.abort();
  }, []);
  useEffect(() => {
    heading.current?.focus();
  }, [route.kind, route.unitId, resolvingScope, redirect, scopeError]);
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
  if (scopeError) {
    return (
      <div className="feedback error" role="alert">
        <p>Não foi possível consultar seu acesso à plataforma.</p>
        <Button variant="outline" onClick={() => setScopeAttempt(scopeAttempt + 1)}>
          Tentar novamente
        </Button>
      </div>
    );
  }
  if (resolvingScope || redirect || route.kind === 'home')
    return <StatusMessage tone="loading">Preparando seu espaço de trabalho…</StatusMessage>;
  return (
    <div className="workspace">
      <WorkspaceNavigation
        session={session}
        route={route.kind}
        unitId={route.unitId}
        pending={pending}
        onSelect={(id) => void select({ id })}
        capabilities={capabilities}
        platformCapabilities={platformCapabilities}
      />
      <section className="workspace-content">
        {window.location.hostname === 'renr-plus-homologation.onrender.com' && (
          <p className="panel-label">Homologação · ambiente de validação</p>
        )}
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
                          : isPlatformRoute
                            ? 'ADMINISTRAÇÃO · ESCOPO GLOBAL'
                            : isGroupRoute
                              ? 'CONSULTA · GRUPO DE EMPRESAS'
                              : 'ESTRUTURA ORGANIZACIONAL'}
              </p>
              <h1 ref={heading} tabIndex={-1}>
                {titles[route.kind]}
              </h1>
              <p className="muted">{descriptions[route.kind]}</p>
              {route.kind === 'empresas' && membership && (
                <a className="action-link" href="#/painel">
                  Ir ao painel da empresa
                </a>
              )}
              {route.kind === 'setores' && canWrite && (
                <div className="row-actions">
                  <a className="action-link" href="#/grupos">
                    Grupos de avaliação
                  </a>
                  <a className="action-link" href="#/colaboradores">
                    Colaboradores
                  </a>
                </div>
              )}
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
          {route.kind === 'consolidado' ? (
            session.hasCompanyGroups ? (
              <Suspense fallback={<StatusMessage tone="loading">Carregando grupos…</StatusMessage>}>
                <CompanyGroupsWorkspace onExpire={onExpire} />
              </Suspense>
            ) : (
              <StatusMessage>Você está sem acesso a grupos de empresas.</StatusMessage>
            )
          ) : route.kind === 'platform-groups' ? (
            <Suspense
              fallback={
                <StatusMessage tone="loading">Carregando administração de grupos…</StatusMessage>
              }
            >
              <CompanyGroupsAdmin onExpire={onExpire} />
            </Suspense>
          ) : route.kind === 'platform-commercial' ? (
            <Suspense
              fallback={<StatusMessage tone="loading">Carregando área comercial…</StatusMessage>}
            >
              <CommercialWorkspace
                canReadCatalog={hasCommercialCatalogAccess(platformCapabilities)}
                canEditCatalog={platformCapabilities.includes('MANAGE_COMMERCIAL')}
                canReadBilling={hasBillingAccess(platformCapabilities)}
                canEditBilling={platformCapabilities.includes('MANAGE_BILLING')}
                canReadContractAccess={hasContractAccessPermission(platformCapabilities)}
                canEditContractAccess={platformCapabilities.includes('MANAGE_CONTRACT_ACCESS')}
                canReadSupport={hasSupportAccess(platformCapabilities)}
                accessLoading={globalAccess.loading}
                accessError={globalAccess.error}
                onExpire={onExpire}
                onRecheck={() => setScopeAttempt((value) => value + 1)}
              />
            </Suspense>
          ) : route.kind === 'platform-recovery' ? (
            globalAccess.loading ? (
              <StatusMessage tone="loading">Verificando concessão de recuperação…</StatusMessage>
            ) : canManagePasswordRecovery || canRecoverMfa ? (
              <Suspense
                fallback={<StatusMessage tone="loading">Carregando recuperação…</StatusMessage>}
              >
                <div className="access-workspace">
                  {canManagePasswordRecovery && <PasswordRecoveryIssue onExpire={onExpire} />}
                  {canRecoverMfa &&
                    (session.activeOrganizationId === null ? (
                      <PasswordRecoveryIssue authenticator onExpire={onExpire} />
                    ) : (
                      <StatusMessage tone="warning">
                        Para emitir uma recuperação de autenticador, entre com sua conta de operação
                        global da plataforma.
                      </StatusMessage>
                    ))}
                </div>
              </Suspense>
            ) : (
              <StatusMessage tone="error">
                {globalAccess.error ||
                  'A recuperação na plataforma exige uma concessão específica.'}
              </StatusMessage>
            )
          ) : route.kind === 'platform-support' || route.kind === 'chamados' ? (
            route.kind === 'platform-support' && globalAccess.loading ? (
              <StatusMessage tone="loading">Verificando acesso ao suporte…</StatusMessage>
            ) : route.kind === 'platform-support' && hasSupportAccess(platformCapabilities) ? (
              <Suspense
                fallback={<StatusMessage tone="loading">Carregando chamados…</StatusMessage>}
              >
                <SupportWorkspace
                  platform
                  canManage={platformCapabilities.includes('MANAGE_SUPPORT')}
                  organizationId={null}
                  ticketId={route.ticketId}
                  onExpire={onExpire}
                />
              </Suspense>
            ) : route.kind === 'chamados' && canWrite && session.activeOrganizationId ? (
              <Suspense
                fallback={<StatusMessage tone="loading">Carregando chamados…</StatusMessage>}
              >
                <SupportWorkspace
                  platform={false}
                  canManage={false}
                  organizationId={session.activeOrganizationId}
                  ticketId={route.ticketId}
                  onExpire={onExpire}
                />
              </Suspense>
            ) : (
              <StatusMessage>
                Seu perfil está sem permissão para acessar chamados neste espaço.
              </StatusMessage>
            )
          ) : emptyDelegation ? (
            <StatusMessage>Seu vínculo está sem unidades ou setores autorizados.</StatusMessage>
          ) : restrictedRoute ? (
            <StatusMessage>
              Esta área não está disponível para o seu acesso por unidade ou setor.
            </StatusMessage>
          ) : route.kind === 'plataforma' ? (
            <Suspense fallback={<p role="status">Carregando administração da plataforma…</p>}>
              <PlatformWorkspace onExpire={onExpire} />
            </Suspense>
          ) : route.kind === 'relatorios' || route.kind === 'platform-reports' ? (
            <Suspense fallback={<p role="status">Carregando relatórios…</p>}>
              <ReportsWorkspace
                key={route.kind + '-' + session.activeOrganizationId}
                organizationId={session.activeOrganizationId}
                organizationName={membership?.organizationName}
                onExpire={onExpire}
                platform={route.kind === 'platform-reports'}
                scopes={route.kind === 'relatorios' ? delegatedScopes : undefined}
              />
            </Suspense>
          ) : route.kind === 'pessoas' ? (
            session.activeOrganizationId ? (
              <Suspense fallback={<p role="status">Carregando Gestão de Pessoas…</p>}>
                <PeopleWorkspace
                  key={session.activeOrganizationId}
                  organizationId={session.activeOrganizationId}
                  onExpire={onExpire}
                />
              </Suspense>
            ) : (
              <p className="surface">Selecione uma empresa para consultar Gestão de Pessoas.</p>
            )
          ) : route.kind === 'auditoria' ? (
            <Suspense fallback={<p role="status">Carregando auditoria…</p>}>
              <AuditWorkspace
                key={session.activeOrganizationId}
                session={session}
                onExpire={onExpire}
              />
            </Suspense>
          ) : route.kind === 'coletas' ? (
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
              <AccessWorkspace
                session={session}
                canIssueRecovery={
                  canWrite && platformCapabilities.includes('ASSIST_COMPANY_PASSWORD_RECOVERY')
                }
                onSession={onSession}
                onExpire={onExpire}
              />
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
                canReadEmployees={canWrite}
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
                  <Button type="submit">Aplicar filtros</Button>
                  <FilterDisclosure activeCount={filters.isActive ? 1 : 0}>
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
                  </FilterDisclosure>
                </form>
              )}
              {confirmation && (
                <p role="status" className="feedback success">
                  {confirmation}
                </p>
              )}
              {route.kind === 'empresas' &&
                session.suspendedOrganizations &&
                session.suspendedOrganizations.length > 0 && (
                  <section
                    className="surface suspended-orgs-panel"
                    aria-labelledby="suspended-orgs-heading"
                  >
                    <h2 id="suspended-orgs-heading">Empresas com acesso contratual suspenso</h2>
                    <ul className="suspended-orgs-list">
                      {session.suspendedOrganizations.map((org) => (
                        <li key={org.organizationId}>
                          <div className="suspended-orgs-header">
                            <strong>{org.organizationName}</strong>
                            <StatusBadge tone="error" label="Acesso suspenso" />
                          </div>
                          {org.reason && org.nextStep ? (
                            <>
                              <p>
                                <strong>Motivo:</strong> {org.reason}
                              </p>
                              <p>
                                <strong>Próximo passo:</strong> {org.nextStep}
                              </p>
                              <p className="muted">
                                Dados, histórico e anexos desta empresa permanecem preservados.
                              </p>
                            </>
                          ) : (
                            <p className="muted">
                              O acesso operacional desta empresa está temporariamente suspenso.
                              Procure a administração da empresa para mais orientações.
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
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
                                {route.kind === 'setores' && canWrite && 'unitId' in item && (
                                  <a
                                    className="action-link"
                                    href={`#/grupos?unitId=${item.unitId}&sectorId=${item.id}`}
                                    aria-label={`Ver grupos de ${item.name}`}
                                  >
                                    Ver grupos →
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
