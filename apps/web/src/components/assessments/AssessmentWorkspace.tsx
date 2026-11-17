import { useEffect, useState } from 'react';
import {
  assessmentCycleListSchema,
  assessmentCycleSchema,
  sessionCapabilitiesSchema,
  type SessionResponse,
} from '@renr/contracts';
import { ConsolidationPolicies } from './ConsolidationPolicies';
import { AssessmentConsolidation } from './AssessmentConsolidation';
import { AssessmentCycleDetail } from './AssessmentCycleDetail';
import { AssessmentCycleForm } from './AssessmentCycleForm';
import { AssessmentComparison } from './AssessmentComparison';
import { comparisonReturn } from '../../lib/assessment-comparison-location';
import { useWorkforceData } from '../workforce/useWorkforceData';
import { Button } from '../ui/button';
import { StatusMessage } from '../ui/status-message';
import { StatusBadge } from '../ui/status-badge';
import { Pagination } from '../ui/pagination';
import './assessments.css';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type AssessmentRoute = {
  view: 'cycles' | 'policies' | 'consolidation' | 'comparison';
  cycle: string;
  create: boolean;
  edit: boolean;
  status: '' | 'DRAFT' | 'OPEN' | 'CLOSED';
  unitId: string;
  sectorId: string;
  referenceCycleId: string;
  currentCycleId: string;
  returnTo: string;
  page: number;
};
function readRoute(): AssessmentRoute {
  const query = new URLSearchParams(location.hash.split('?')[1]);
  const view = query.get('view');
  const status = query.get('status');
  const unitId = query.get('unitId') ?? '';
  const sectorId = query.get('sectorId') ?? '';
  const page = Number(query.get('page') || 1);
  return {
    view:
      view === 'policies' || view === 'consolidation' || view === 'comparison' ? view : 'cycles',
    cycle: uuid.test(query.get('cycle') || '') ? query.get('cycle')! : '',
    create: query.get('create') === 'true',
    edit: query.get('edit') === 'true',
    status: status === 'DRAFT' || status === 'OPEN' || status === 'CLOSED' ? status : '',
    unitId: uuid.test(unitId) ? unitId : '',
    sectorId: uuid.test(sectorId) ? sectorId : '',
    referenceCycleId: uuid.test(query.get('referenceCycleId') || '')
      ? query.get('referenceCycleId')!
      : '',
    currentCycleId: uuid.test(query.get('currentCycleId') || '')
      ? query.get('currentCycleId')!
      : '',
    returnTo: comparisonReturn(query.get('returnTo') || '') ?? '',
    page: Number.isInteger(page) && page > 0 && page <= 100000 ? page : 1,
  };
}
const cycleStatusLabels = { DRAFT: 'Rascunho', OPEN: 'Em coleta', CLOSED: 'Encerrada' };
const assessmentDate = (date: string) => new Date(date).toLocaleString('pt-BR');
export function AssessmentWorkspace({
  session,
  onExpire,
}: {
  session: SessionResponse;
  onExpire: () => void;
}) {
  const organizationId = session.activeOrganizationId;
  const membership = session.memberships.find((item) => item.organizationId === organizationId);
  if (!organizationId || !membership)
    return (
      <StatusMessage>
        Selecione uma empresa para organizar suas coletas. <a href="#/empresas">Ir para Empresas</a>
      </StatusMessage>
    );
  return (
    <AssessmentManager
      key={organizationId}
      organizationId={organizationId}
      canEdit={membership.role === 'ADMIN' && !session.organizationScopes?.[organizationId]}
      delegated={session.organizationScopes?.[organizationId] !== undefined}
      onExpire={onExpire}
    />
  );
}
function AssessmentManager({
  organizationId,
  canEdit,
  delegated,
  onExpire,
}: {
  organizationId: string;
  canEdit: boolean;
  delegated: boolean;
  onExpire: () => void;
}) {
  const [route, setRoute] = useState(readRoute);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const change = () => setRoute(readRoute());
    addEventListener('hashchange', change);
    return () => removeEventListener('hashchange', change);
  }, []);
  function navigate(change: Partial<AssessmentRoute>) {
    const next = { ...route, ...change };
    const query = new URLSearchParams();
    if (next.view !== 'cycles') query.set('view', next.view);
    if (next.cycle) query.set('cycle', next.cycle);
    if (next.create) query.set('create', 'true');
    if (next.edit) query.set('edit', 'true');
    if (next.status) query.set('status', next.status);
    if (next.unitId) query.set('unitId', next.unitId);
    if (next.sectorId) query.set('sectorId', next.sectorId);
    if (next.view === 'comparison') {
      if (next.referenceCycleId) query.set('referenceCycleId', next.referenceCycleId);
      if (next.currentCycleId) query.set('currentCycleId', next.currentCycleId);
    }
    if (next.cycle && next.returnTo) query.set('returnTo', next.returnTo);
    if (next.page > 1) query.set('page', String(next.page));
    location.hash = `#/coletas${query.size ? '?' + query : ''}`;
    setRoute(next);
  }
  const base = `/organizations/${organizationId}/assessment-cycles`;
  const query = new URLSearchParams({ page: String(route.page), pageSize: '20' });
  if (route.status) query.set('status', route.status);
  if (route.unitId) query.set('unitId', route.unitId);
  if (route.sectorId) query.set('sectorId', route.sectorId);
  const hasLocationFilter = Boolean(route.unitId || route.sectorId);
  const listing = useWorkforceData(
    route.view === 'cycles' && !route.cycle && !route.create ? `${base}?${query}` : null,
    assessmentCycleListSchema,
    organizationId,
    onExpire,
    attempt,
  );
  const capabilities = useWorkforceData(
    '/auth/session-capabilities',
    sessionCapabilitiesSchema,
    organizationId,
    onExpire,
  );
  const editing = useWorkforceData(
    route.view === 'cycles' && route.cycle && route.edit && canEdit
      ? `${base}/${route.cycle}`
      : null,
    assessmentCycleSchema,
    organizationId,
    onExpire,
    attempt,
  );
  const canPublishReal =
    capabilities.data?.organizationId === organizationId &&
    capabilities.data.capabilities.includes('TECHNICAL_DECISIONS') === true;
  const canIssueInvites =
    canEdit ||
    (capabilities.data?.organizationId === organizationId &&
      capabilities.data.capabilities.includes('HR_ASSESSMENT_INVITES_ISSUE'));
  return (
    <div className="assessment-workspace">
      <nav className="assessment-tabs" aria-label="Gestão das coletas">
        <Button
          variant="outline"
          aria-pressed={route.view === 'cycles'}
          onClick={() => navigate({ view: 'cycles', cycle: '', create: false, edit: false })}
        >
          Coletas da empresa
        </Button>
        {!delegated && (
          <Button
            variant="outline"
            aria-pressed={route.view === 'policies'}
            onClick={() => navigate({ view: 'policies', cycle: '', create: false, edit: false })}
          >
            Políticas de consolidação
          </Button>
        )}
        <Button
          variant="outline"
          aria-pressed={route.view === 'consolidation'}
          onClick={() => navigate({ view: 'consolidation', cycle: '', create: false, edit: false })}
        >
          Consolidação gerencial
        </Button>
        <Button
          variant="outline"
          aria-pressed={route.view === 'comparison'}
          onClick={() =>
            navigate({
              view: 'comparison',
              cycle: '',
              create: false,
              edit: false,
              status: '',
              page: 1,
            })
          }
        >
          Comparativo gerencial
        </Button>
      </nav>
      <StatusMessage>
        As coletas aplicam uma versão publicada do instrumento e uma política de consolidação. A
        ausência de dados não indica ausência de fatores de risco.
      </StatusMessage>
      {route.view === 'policies' &&
        (delegated ? (
          <StatusMessage>
            Consulte a política aplicada nos resultados da coleta autorizada.
          </StatusMessage>
        ) : (
          <ConsolidationPolicies
            organizationId={organizationId}
            canEdit={canEdit}
            canPublishReal={canPublishReal}
            onExpire={onExpire}
          />
        ))}
      {route.view === 'consolidation' && (
        <AssessmentConsolidation
          organizationId={organizationId}
          onExpire={onExpire}
          delegated={delegated}
        />
      )}
      {route.view === 'comparison' && (
        <AssessmentComparison
          key={`${route.unitId}:${route.sectorId}:${route.referenceCycleId}:${route.currentCycleId}`}
          organizationId={organizationId}
          selection={{
            unitId: route.unitId,
            sectorId: route.sectorId,
            referenceCycleId: route.referenceCycleId,
            currentCycleId: route.currentCycleId,
          }}
          onCompare={(selection) => navigate({ ...selection, view: 'comparison', page: 1 })}
          onExpire={onExpire}
        />
      )}
      {route.view === 'cycles' && route.create && canEdit && (
        <AssessmentCycleForm
          key="new-cycle"
          organizationId={organizationId}
          initial={null}
          onExpire={onExpire}
          onCancel={() => navigate({ create: false })}
          onSaved={(cycle) => {
            setAttempt((value) => value + 1);
            navigate({ create: false, cycle: cycle.id, edit: false });
          }}
        />
      )}
      {route.view === 'cycles' && route.cycle && route.edit && canEdit && (
        <>
          {editing.loading && !editing.data && (
            <StatusMessage tone="loading">Carregando rascunho…</StatusMessage>
          )}
          {editing.error && (
            <StatusMessage
              tone="error"
              action={
                <Button onClick={() => setAttempt((value) => value + 1)}>Tentar novamente</Button>
              }
            >
              {editing.error}
            </StatusMessage>
          )}
          {editing.data?.id === route.cycle && editing.data.status === 'DRAFT' && (
            <AssessmentCycleForm
              key={editing.data.id}
              organizationId={organizationId}
              initial={editing.data}
              onExpire={onExpire}
              onCancel={() => navigate({ edit: false })}
              onSaved={(cycle) => {
                setAttempt((value) => value + 1);
                navigate({ cycle: cycle.id, edit: false });
              }}
            />
          )}
          {editing.data?.status !== 'DRAFT' && editing.data && (
            <StatusMessage>
              Esta coleta já foi aberta e seu contexto está fixado.{' '}
              <Button onClick={() => navigate({ edit: false })}>Voltar à coleta</Button>
            </StatusMessage>
          )}
        </>
      )}
      {route.view === 'cycles' && route.cycle && (!route.edit || !canEdit) && (
        <AssessmentCycleDetail
          key={route.cycle}
          organizationId={organizationId}
          cycleId={route.cycle}
          canEdit={canEdit}
          canIssueInvites={canIssueInvites}
          onExpire={onExpire}
          backLabel={route.returnTo ? 'Voltar ao comparativo' : undefined}
          onBack={() => {
            if (route.returnTo) location.hash = route.returnTo;
            else navigate({ cycle: '', edit: false });
          }}
          onEdit={() => navigate({ edit: true })}
        />
      )}
      {route.view === 'cycles' && !route.cycle && !route.create && (
        <>
          <div className="assessment-toolbar">
            <h2>Ciclos da empresa</h2>
            {canEdit && <Button onClick={() => navigate({ create: true })}>Nova coleta</Button>}
          </div>
          <label htmlFor="assessment-status">Situação da coleta</label>
          <select
            id="assessment-status"
            value={route.status}
            onChange={(event) =>
              navigate({ status: event.target.value as AssessmentRoute['status'], page: 1 })
            }
          >
            <option value="">Todas as situações</option>
            <option value="DRAFT">Rascunhos</option>
            <option value="OPEN">Em coleta</option>
            <option value="CLOSED">Encerradas</option>
          </select>
          {hasLocationFilter && (
            <StatusMessage
              action={
                <Button
                  variant="outline"
                  onClick={() => navigate({ unitId: '', sectorId: '', page: 1 })}
                >
                  Limpar recorte de unidade e setor
                </Button>
              }
            >
              Coletas filtradas por {route.sectorId ? 'setor' : 'unidade'}.
            </StatusMessage>
          )}
          {listing.loading && !listing.data && (
            <StatusMessage tone="loading">Carregando coletas…</StatusMessage>
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
              {!listing.data.items.length && (
                <p className="surface">
                  {hasLocationFilter
                    ? 'Nenhuma coleta encontrada neste recorte.'
                    : 'Nenhuma coleta cadastrada nesta empresa.'}
                </p>
              )}
              <ul className="assessment-cycle-list">
                {listing.data.items.map((cycle) => (
                  <li className="surface" key={cycle.id}>
                    <div>
                      <StatusBadge
                        tone={
                          cycle.status === 'OPEN'
                            ? 'info'
                            : cycle.status === 'CLOSED'
                              ? 'success'
                              : 'neutral'
                        }
                        label={cycleStatusLabels[cycle.status]}
                      />
                      <h3>{cycle.name}</h3>
                      <p>
                        {cycle.unitName} · {cycle.sectorName} · {cycle.assessmentGroupName}
                      </p>
                      <p>
                        {cycle.instrumentTitle} · versão {cycle.instrumentVersion} · política v
                        {cycle.policyVersion}
                      </p>
                      <p>
                        {assessmentDate(cycle.startsAt)} até {assessmentDate(cycle.endsAt)}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      aria-label={`Abrir coleta ${cycle.name}`}
                      onClick={() => navigate({ cycle: cycle.id })}
                    >
                      Abrir coleta
                    </Button>
                  </li>
                ))}
              </ul>
              <Pagination
                label="Paginação das coletas"
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
    </div>
  );
}
