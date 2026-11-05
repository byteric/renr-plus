import { useState } from 'react';
import { HistoryView } from './HistoryView';

/** Long domain details load the historical projection on demand; deep links open it directly. */
export function DomainHistory({
  organizationId,
  kind,
  id,
  refreshKey,
  onExpire,
  onUnavailable,
}: {
  organizationId: string;
  kind: 'risk' | 'action';
  id: string;
  refreshKey: number;
  onExpire: () => void;
  onUnavailable: (status: number) => void;
}) {
  const [open, setOpen] = useState(() =>
    /[?&]history(?:Page|From|To|RecordKind|RecordId)=/.test(window.location.hash),
  );
  return (
    <details
      className="surface history-domain"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Histórico unificado</summary>
      <p className="muted">
        Consulte operações, decisões técnicas e registros preservados desta origem.
      </p>
      {open && (
        <HistoryView
          organizationId={organizationId}
          resource={{ kind, id }}
          refreshKey={refreshKey}
          onExpire={onExpire}
          onUnavailable={onUnavailable}
        />
      )}
    </details>
  );
}
