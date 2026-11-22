import { useCallback, useEffect, useRef, useState } from 'react';
import { sessionCapabilitiesSchema, type SessionResponse } from '@renr/contracts';
import { ActionList } from './ActionList';
import { ActionForm } from './ActionForm';
import { ActionDetail } from './ActionDetail';
import { useActionData } from './useActionData';
import '../risks/risks.css';
import './actions.css';

export function ActionsWorkspace({
  session,
  onExpire,
}: {
  session: SessionResponse;
  onExpire: () => void;
}) {
  const [hash, setHash] = useState(window.location.hash);
  const returnPosition = useRef<{ query: string; id: string; top: number } | null>(null);
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const organizationId = session.activeOrganizationId;
  const scopeRestricted = organizationId
    ? session.organizationScopes?.[organizationId] !== undefined
    : false;
  const canWrite =
    !scopeRestricted &&
    session.memberships.find((entry) => entry.organizationId === organizationId)?.role === 'ADMIN';
  const capabilities = useActionData(
    organizationId && !scopeRestricted ? '/auth/session-capabilities' : null,
    sessionCapabilitiesSchema,
    organizationId ?? '',
    onExpire,
  );
  const hasTechnicalDecisions =
    !scopeRestricted &&
    capabilities.data?.organizationId === organizationId &&
    capabilities.data.capabilities.includes('TECHNICAL_DECISIONS') === true;
  const canCreateAction = !scopeRestricted && (canWrite || hasTechnicalDecisions);
  const permissionsLoading = !canWrite && !scopeRestricted && capabilities.loading;
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?');
  const id = path.split('/')[1];
  const takeReturnPosition = useCallback((listQuery: string) => {
    const position = returnPosition.current;
    returnPosition.current = null;
    return position?.query === listQuery ? position : null;
  }, []);
  if (!organizationId)
    return (
      <div className="surface empty-state">
        <h2>Selecione uma empresa</h2>
        <a href="#/empresas">Ir para Empresas →</a>
      </div>
    );
  if (id === 'nova') {
    if (permissionsLoading)
      return (
        <p role="status" className="surface">
          Verificando permissões…
        </p>
      );
    return canCreateAction ? (
      <ActionForm
        key={`${organizationId}-${query}`}
        organizationId={organizationId}
        riskId={new URLSearchParams(query).get('riskId') ?? ''}
        onExpire={onExpire}
        onSaved={(value) => {
          window.location.hash = `/acoes/${value.id}`;
        }}
        onCancel={() => {
          window.location.hash = '/acoes';
        }}
      />
    ) : (
      <p role="alert">
        {scopeRestricted
          ? 'Seu vínculo possui restrição de recorte por unidade ou setor e não permite criar ações preventivas.'
          : 'Seu perfil atual não permite criar ações preventivas. Criar medidas exige perfil Administrador ou capacidade de Decisões técnicas sem restrição de recorte.'}{' '}
        <a href="#/acoes">Voltar às ações</a>
      </p>
    );
  }
  if (id && /^[0-9a-f-]{36}$/i.test(id))
    return (
      <ActionDetail
        key={`${organizationId}-${id}`}
        organizationId={organizationId}
        id={id}
        query={query}
        onExpire={onExpire}
      />
    );
  if (id)
    return (
      <p role="alert">
        Endereço de ação inválido. <a href="#/acoes">Voltar às ações</a>
      </p>
    );
  return (
    <ActionList
      key={`${organizationId}-${query}`}
      organizationId={organizationId}
      query={query}
      canCreateAction={canCreateAction}
      scopeRestricted={scopeRestricted}
      permissionsLoading={permissionsLoading}
      onExpire={onExpire}
      onOpenDetail={(actionId) => {
        returnPosition.current = { query, id: actionId, top: window.scrollY };
      }}
      takeReturnPosition={takeReturnPosition}
    />
  );
}
