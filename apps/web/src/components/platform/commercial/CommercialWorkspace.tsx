import { lazy, Suspense, useEffect, useState } from 'react';
import { commercialPlanListSchema, type CommercialBillingStatus } from '@renr/contracts';
import { Button } from '../../ui/button';
import { StatusMessage } from '../../ui/status-message';
import { useAccessRefresh, usePrivateQuery } from '../usePrivateQuery';
import { CommercialClients } from './CommercialClients';
import { CommercialOffers } from './CommercialOffers';
import { commercialPath } from './commercial-ui';
import '../platform.css';
import './commercial.css';

const CommercialDashboard = lazy(() =>
  import('./CommercialDashboard').then((module) => ({ default: module.CommercialDashboard })),
);
const CommercialBilling = lazy(() =>
  import('./CommercialBilling').then((module) => ({ default: module.CommercialBilling })),
);
const CommercialContractAccess = lazy(() =>
  import('./CommercialContractAccess').then((module) => ({
    default: module.CommercialContractAccess,
  })),
);

type CommercialSection = 'dashboard' | 'offers' | 'clients' | 'billing' | 'access';

const sectionFromHash = (): CommercialSection | null => {
  const query = new URLSearchParams(window.location.hash.split('?')[1]);
  const value = query.get('secao');
  if (value === 'painel') return 'dashboard';
  if (value === 'ofertas') return 'offers';
  if (value === 'clientes') return 'clients';
  if (value === 'cobrancas') return 'billing';
  if (value === 'acesso') return 'access';
  return null;
};

type BillingShortcut = {
  organizationId: string | null;
  status: '' | CommercialBillingStatus;
  competenceFrom: string;
  competenceTo: string;
};

export function CommercialWorkspace({
  canReadCatalog,
  canEditCatalog,
  canReadBilling,
  canEditBilling,
  canReadContractAccess,
  canEditContractAccess,
  canReadSupport,
  accessLoading,
  accessError,
  onExpire,
  onRecheck,
}: {
  canReadCatalog: boolean;
  canEditCatalog: boolean;
  canReadBilling: boolean;
  canEditBilling: boolean;
  canReadContractAccess: boolean;
  canEditContractAccess: boolean;
  canReadSupport: boolean;
  accessLoading: boolean;
  accessError: string;
  onExpire: () => void;
  onRecheck: () => void;
}) {
  const canReadAny = canReadCatalog || canReadBilling || canReadContractAccess || canReadSupport;
  const [denied, setDenied] = useState(false);
  const [preferredSection, setPreferredSection] = useState<CommercialSection | null>(
    sectionFromHash,
  );
  const [clientsOrgId, setClientsOrgId] = useState<string | null>(null);
  const [billingTarget, setBillingTarget] = useState<BillingShortcut>({
    organizationId: null,
    status: '',
    competenceFrom: '',
    competenceTo: '',
  });
  const [accessOrgId, setAccessOrgId] = useState<string | null>(null);
  const { revision, refresh } = useAccessRefresh();
  const onDenied = () => setDenied(true);

  useEffect(() => {
    const sync = () => {
      const next = sectionFromHash();
      if (next) setPreferredSection(next);
    };
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const section: CommercialSection =
    preferredSection === 'dashboard' && canReadAny
      ? 'dashboard'
      : preferredSection === 'access' && canReadContractAccess
        ? 'access'
        : preferredSection === 'billing' && canReadBilling
          ? 'billing'
          : preferredSection === 'clients' && canReadCatalog
            ? 'clients'
            : preferredSection === 'offers' && canReadCatalog
              ? 'offers'
              : canReadCatalog
                ? 'offers'
                : canReadBilling
                  ? 'billing'
                  : canReadContractAccess
                    ? 'access'
                    : 'dashboard';

  const offers = usePrivateQuery(
    canReadCatalog && !denied ? `${commercialPath}/plans` : null,
    commercialPlanListSchema,
    revision,
    onExpire,
    onDenied,
    undefined,
    true,
  );

  function recheck() {
    setDenied(false);
    onRecheck();
    refresh();
  }

  function openClientBilling(organizationId: string) {
    setBillingTarget({
      organizationId,
      status: '',
      competenceFrom: '',
      competenceTo: '',
    });
    setPreferredSection('billing');
  }

  function openBillingShortcut(options?: {
    organizationId?: string | null;
    status?: '' | CommercialBillingStatus;
    competenceFrom?: string;
    competenceTo?: string;
  }) {
    setBillingTarget({
      organizationId: options?.organizationId ?? null,
      status: options?.status ?? '',
      competenceFrom: options?.competenceFrom ?? '',
      competenceTo: options?.competenceTo ?? '',
    });
    setPreferredSection('billing');
  }

  function openClientsShortcut(organizationId?: string | null) {
    setClientsOrgId(organizationId ?? null);
    setPreferredSection('clients');
  }

  function openClientContractAccess(organizationId?: string | null) {
    setAccessOrgId(organizationId ?? null);
    setPreferredSection('access');
  }

  if (denied || (!canReadAny && accessError))
    return (
      <StatusMessage tone="error" action={<Button onClick={recheck}>Revalidar acesso</Button>}>
        {denied
          ? 'A permissão comercial, financeira ou de acesso contratual não está mais disponível.'
          : accessError}
      </StatusMessage>
    );
  if (!canReadAny && accessLoading)
    return <StatusMessage tone="loading">Verificando acesso comercial…</StatusMessage>;
  if (!canReadAny)
    return <StatusMessage>A área comercial exige uma concessão específica.</StatusMessage>;

  return (
    <div className="commercial-workspace platform-workspace">
      <nav className="commercial-toolbar" aria-label="Áreas comerciais">
        <div className="platform-areas">
          <Button
            variant={section === 'dashboard' ? 'default' : 'outline'}
            aria-pressed={section === 'dashboard'}
            onClick={() => setPreferredSection('dashboard')}
          >
            Painel comercial
          </Button>
          {canReadCatalog && (
            <>
              <Button
                variant={section === 'offers' ? 'default' : 'outline'}
                aria-pressed={section === 'offers'}
                onClick={() => setPreferredSection('offers')}
              >
                Planos e serviços
              </Button>
              <Button
                variant={section === 'clients' ? 'default' : 'outline'}
                aria-pressed={section === 'clients'}
                onClick={() => {
                  setClientsOrgId(null);
                  setPreferredSection('clients');
                }}
              >
                Clientes e contratos
              </Button>
            </>
          )}
          {canReadBilling && (
            <Button
              variant={section === 'billing' ? 'default' : 'outline'}
              aria-pressed={section === 'billing'}
              onClick={() => {
                setBillingTarget({
                  organizationId: null,
                  status: '',
                  competenceFrom: '',
                  competenceTo: '',
                });
                setPreferredSection('billing');
              }}
            >
              Cobranças e pagamentos
            </Button>
          )}
          {canReadContractAccess && (
            <Button
              variant={section === 'access' ? 'default' : 'outline'}
              aria-pressed={section === 'access'}
              onClick={() => {
                setAccessOrgId(null);
                setPreferredSection('access');
              }}
            >
              Acesso contratual
            </Button>
          )}
        </div>
        <Button variant="outline" onClick={recheck}>
          Atualizar área comercial
        </Button>
      </nav>
      {section === 'dashboard' ? (
        <Suspense
          fallback={<StatusMessage tone="loading">Carregando painel comercial…</StatusMessage>}
        >
          <CommercialDashboard
            revision={revision}
            onExpire={onExpire}
            onDenied={onDenied}
            onOpenClients={openClientsShortcut}
            onOpenBilling={openBillingShortcut}
            onOpenAccess={openClientContractAccess}
          />
        </Suspense>
      ) : section === 'offers' && canReadCatalog ? (
        <CommercialOffers
          plans={offers.data?.items}
          error={offers.error}
          canEdit={canEditCatalog}
          onExpire={onExpire}
          onDenied={onDenied}
          onReload={refresh}
        />
      ) : section === 'clients' && canReadCatalog ? (
        <CommercialClients
          key={`${String(canEditCatalog)}:${clientsOrgId ?? 'all'}`}
          plans={offers.data?.items}
          plansError={offers.error}
          canEdit={canEditCatalog}
          canReadBilling={canReadBilling}
          canReadContractAccess={canReadContractAccess}
          initialOrganizationId={clientsOrgId}
          revision={revision}
          onExpire={onExpire}
          onDenied={onDenied}
          onReloadPlans={refresh}
          onOpenBilling={openClientBilling}
          onOpenContractAccess={openClientContractAccess}
        />
      ) : section === 'billing' && canReadBilling ? (
        <Suspense fallback={<StatusMessage tone="loading">Carregando cobranças…</StatusMessage>}>
          <CommercialBilling
            key={`${String(canEditBilling)}:${billingTarget.organizationId ?? 'all'}:${billingTarget.status}:${billingTarget.competenceFrom}:${billingTarget.competenceTo}`}
            canEdit={canEditBilling}
            revision={revision}
            initialOrganizationId={billingTarget.organizationId}
            initialStatus={billingTarget.status}
            initialCompetenceFrom={billingTarget.competenceFrom}
            initialCompetenceTo={billingTarget.competenceTo}
            onExpire={onExpire}
            onDenied={onDenied}
          />
        </Suspense>
      ) : (
        <Suspense
          fallback={<StatusMessage tone="loading">Carregando acesso contratual…</StatusMessage>}
        >
          <CommercialContractAccess
            key={`${String(canEditContractAccess)}:${accessOrgId ?? 'all'}`}
            canEdit={canEditContractAccess}
            revision={revision}
            initialOrganizationId={accessOrgId}
            onExpire={onExpire}
            onDenied={onDenied}
          />
        </Suspense>
      )}
    </div>
  );
}
