import { useEffect, useState } from 'react';
import type { SessionResponse } from '@renr/contracts';
import { ActionList } from './ActionList';
import { ActionForm } from './ActionForm';
import { ActionDetail } from './ActionDetail';
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
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const organizationId = session.activeOrganizationId;
  const canWrite =
    session.memberships.find((entry) => entry.organizationId === organizationId)?.role === 'ADMIN';
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?');
  const id = path.split('/')[1];
  if (!organizationId)
    return (
      <div className="surface empty-state">
        <h2>Selecione uma empresa</h2>
        <a href="#/empresas">Ir para Empresas →</a>
      </div>
    );
  if (id === 'nova')
    return canWrite ? (
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
        Seu acesso é somente leitura. <a href="#/acoes">Voltar às ações</a>
      </p>
    );
  if (id && /^[0-9a-f-]{36}$/i.test(id))
    return (
      <ActionDetail
        key={`${organizationId}-${id}`}
        organizationId={organizationId}
        id={id}
        canWrite={canWrite}
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
      onExpire={onExpire}
    />
  );
}
