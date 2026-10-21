import { useEffect, useState } from 'react';
import type { SessionResponse } from '@renr/contracts';
import { RiskInventory } from './RiskInventory';
import { RiskDetail } from './RiskDetail';
import { RiskForm } from './RiskForm';
import './risks.css';

export function RiskWorkspace({
  session,
  onExpire,
}: {
  session: SessionResponse;
  onExpire: () => void;
}) {
  const [hash, setHash] = useState(() => window.location.hash);
  const [listPositions, setListPositions] = useState<ReadonlyMap<string, number>>(() => new Map());
  useEffect(() => {
    const changed = () => setHash(window.location.hash);
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?');
  const id = path.split('/')[1];
  const organizationId = session.activeOrganizationId;
  const canWrite =
    session.memberships.find((entry) => entry.organizationId === organizationId)?.role === 'ADMIN';
  if (!organizationId)
    return (
      <div className="surface empty-state">
        <h2>Selecione uma empresa</h2>
        <a href="#/empresas">Ir para Empresas →</a>
      </div>
    );
  if (id === 'novo')
    return canWrite ? (
      <RiskForm
        key={`${organizationId}-${query}`}
        organizationId={organizationId}
        onExpire={onExpire}
        initialQuery={query}
        onSaved={(risk) => {
          window.location.hash = `/inventario/${risk.id}`;
        }}
        onCancel={() => {
          window.location.hash = '/inventario';
        }}
      />
    ) : (
      <p role="alert" className="feedback">
        Seu acesso é somente leitura. <a href="#/inventario">Voltar ao inventário</a>
      </p>
    );
  if (id && /^[0-9a-f-]{36}$/i.test(id))
    return (
      <RiskDetail
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
      <p role="alert" className="feedback error">
        Este endereço de registro é inválido. <a href="#/inventario">Voltar ao inventário</a>
      </p>
    );
  return (
    <RiskInventory
      key={`${organizationId}-${query}`}
      organizationId={organizationId}
      canWrite={canWrite}
      query={query}
      restoreScrollY={listPositions.get(query)}
      onOpenDetail={() =>
        setListPositions((positions) => new Map(positions).set(query, window.scrollY))
      }
      onExpire={onExpire}
    />
  );
}
