import { useEffect, useRef, useState } from 'react';
import { sessionCapabilitiesSchema, type SessionResponse } from '@renr/contracts';
import { RiskInventory } from './RiskInventory';
import { RiskDetail } from './RiskDetail';
import { RiskForm } from './RiskForm';
import './risks.css';
import { useRiskData } from './useRiskData';

export function RiskWorkspace({
  session,
  onExpire,
}: {
  session: SessionResponse;
  onExpire: () => void;
}) {
  const [hash, setHash] = useState(() => window.location.hash);
  const [listPositions, setListPositions] = useState<ReadonlyMap<string, number>>(() => new Map());
  const previousId = useRef<string | undefined>(undefined);
  const openedFromList = useRef(false);
  const [revision, setRevision] = useState(0);
  const capabilities = useRiskData(
    '/auth/session-capabilities',
    sessionCapabilitiesSchema,
    onExpire,
  );
  useEffect(() => {
    const changed = () => setHash(window.location.hash);
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?');
  const id = path.split('/')[1];
  const organizationId = session.activeOrganizationId;
  const returnTo = new URLSearchParams(query).get('returnTo') ?? '';
  const listQuery =
    id && /^#\/inventario(?:\?|$)/.test(returnTo)
      ? (returnTo.split('?')[1] ?? '')
      : id
        ? ''
        : query;
  useEffect(() => {
    const closed = previousId.current;
    previousId.current = id;
    if (!closed || id) return;
    const frame = window.requestAnimationFrame(() => {
      (
        (openedFromList.current ? document.getElementById(`risk-open-${closed}`) : null) ??
        document.getElementById('risk-list-heading')
      )?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [id]);
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
  const validId = id && /^[0-9a-f-]{36}$/i.test(id);
  const inventory = (
    <RiskInventory
      key={`${organizationId}-${listQuery}`}
      organizationId={organizationId}
      canWrite={canWrite}
      query={listQuery}
      selectedId={validId ? id : undefined}
      revision={revision}
      restoreScrollY={listPositions.get(listQuery)}
      onOpenDetail={() => {
        openedFromList.current = true;
        setListPositions((positions) => new Map(positions).set(listQuery, window.scrollY));
      }}
      onExpire={onExpire}
    />
  );
  if (id && !validId)
    return (
      <p role="alert" className="feedback error">
        Este endereço de registro é inválido. <a href="#/inventario">Voltar ao inventário</a>
      </p>
    );
  return (
    <div className={validId ? 'risk-context-layout' : undefined}>
      <div className={validId ? 'risk-context-list' : undefined}>{inventory}</div>
      {validId && (
        <aside className="risk-context-panel" aria-label="Contexto do risco selecionado">
          <RiskDetail
            key={`${organizationId}-${id}`}
            organizationId={organizationId}
            id={id}
            canWrite={canWrite}
            onChanged={() => setRevision((value) => value + 1)}
            canEvaluate={
              capabilities.data?.organizationId === organizationId &&
              capabilities.data.capabilities.includes('TECHNICAL_DECISIONS') === true
            }
            query={query}
            onExpire={onExpire}
          />
        </aside>
      )}
    </div>
  );
}
