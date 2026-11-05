import type { SessionResponse } from '@renr/contracts';
import { HistoryView } from './HistoryView';

export function AuditWorkspace({
  session,
  onExpire,
}: {
  session: SessionResponse;
  onExpire: () => void;
}) {
  const organizationId = session.activeOrganizationId;
  if (!organizationId)
    return <p className="surface">Selecione uma empresa para consultar a auditoria.</p>;
  if (
    session.memberships.find((member) => member.organizationId === organizationId)?.role !== 'ADMIN'
  )
    return (
      <p role="alert" className="surface">
        A auditoria administrativa está disponível apenas para administradores.
      </p>
    );
  return <HistoryView key={organizationId} organizationId={organizationId} onExpire={onExpire} />;
}
