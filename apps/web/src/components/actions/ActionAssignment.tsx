import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  actionAssignmentSchema,
  actionDetailSchema,
  actionWorkspaceSchema,
  type ActionWorkspace,
} from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { Button } from '../ui/button';
import { ActionAssigneeSelect } from './ActionAssigneeSelect';

export function ActionAssignment({
  item,
  organizationId,
  onExpire,
  onChanged,
  onUnavailable,
}: {
  item: ActionWorkspace;
  organizationId: string;
  onExpire: () => void;
  onChanged: () => void;
  onUnavailable?: (status: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [expectedVersion, setExpectedVersion] = useState(item.version);
  const [assignedUserId, setAssignedUserId] = useState(item.assignedUser?.userId ?? '');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [current, setCurrent] = useState<ActionWorkspace | null>(null);
  const [error, setError] = useState('');
  const controller = useRef(new AbortController());
  useEffect(() => {
    controller.current = new AbortController();
    const active = controller.current;
    return () => active.abort();
  }, []);
  function accessUnavailable(failure: unknown) {
    if (!(failure instanceof RequestError) || ![401, 403, 404].includes(failure.status))
      return false;
    onUnavailable?.(failure.status);
    if (failure.status === 401) onExpire();
    return true;
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending || blocked || !item.permissions.canManage) return;
    const parsed = actionAssignmentSchema.safeParse({
      expectedVersion,
      assignedUserId: assignedUserId || null,
      changeReason: reason,
    });
    if (!parsed.success) {
      setError('Escolha um membro válido e justifique a alteração com 10 a 1.000 caracteres.');
      return;
    }
    setPending(true);
    setError('');
    try {
      await request(
        `/organizations/${organizationId}/actions/${item.id}/assignment`,
        actionDetailSchema,
        { method: 'PATCH', body: JSON.stringify(parsed.data), signal: controller.current.signal },
      );
      if (controller.current.signal.aborted) return;
      setEditing(false);
      setReason('');
      setCurrent(null);
      onChanged();
    } catch (failure) {
      if (controller.current.signal.aborted) return;
      if (accessUnavailable(failure)) return;
      setBlocked(failure instanceof RequestError && [0, 409, 502].includes(failure.status));
      setError(
        failure instanceof RequestError && [0, 409, 502].includes(failure.status)
          ? 'Atribuição não confirmada. Rascunho preservado; consulte a versão atual e revise antes de reenviar.'
          : failure instanceof Error
            ? failure.message
            : 'Não foi possível atribuir o membro.',
      );
    } finally {
      if (!controller.current.signal.aborted) setPending(false);
    }
  }
  async function consult() {
    setPending(true);
    setCurrent(null);
    try {
      const value = await request(
        `/organizations/${organizationId}/action-workspaces/${item.id}`,
        actionWorkspaceSchema,
        { signal: controller.current.signal },
      );
      if (!controller.current.signal.aborted) setCurrent(value);
    } catch (failure) {
      if (controller.current.signal.aborted) return;
      if (accessUnavailable(failure)) return;
      setError('Não foi possível consultar a ação atual. Rascunho preservado.');
    } finally {
      if (!controller.current.signal.aborted) setPending(false);
    }
  }
  return (
    <section className="surface risk-stack">
      <h3>Atribuição operacional</h3>
      <p className="muted">
        O responsável nominal permanece independente. Atribuição requer acesso e capacidade
        operacional para executar.
      </p>
      {!editing ? (
        <Button
          variant="outline"
          onClick={() => {
            setEditing(true);
            if (!blocked) {
              setAssignedUserId(item.assignedUser?.userId ?? '');
              setExpectedVersion(item.version);
              setReason('');
              setError('');
              setCurrent(null);
            }
          }}
        >
          Atribuir membro
        </Button>
      ) : (
        <form className="risk-form risk-stack" onSubmit={(event) => void save(event)}>
          <ActionAssigneeSelect
            organizationId={organizationId}
            value={assignedUserId}
            onChange={setAssignedUserId}
            onExpire={onExpire}
            disabled={pending}
          />
          <label htmlFor="assignment-reason">Justificativa da atribuição</label>
          <textarea
            id="assignment-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={1000}
            disabled={pending}
          />
          {error && <p role="alert">{error}</p>}
          {blocked && (
            <Button variant="outline" disabled={pending} onClick={() => void consult()}>
              Consultar atribuição atual
            </Button>
          )}
          {blocked && current && (
            <div>
              <p>
                Versão {current.version} · Membro atual:{' '}
                {current.assignedUser?.name ?? 'Sem atribuição'}
              </p>
              <Button
                variant="outline"
                disabled={
                  pending ||
                  !current.permissions.canManage ||
                  !['PLANNED', 'IN_PROGRESS'].includes(current.status)
                }
                onClick={() => {
                  setBlocked(false);
                  setExpectedVersion(current.version);
                  setError('Revise o rascunho preservado antes de confirmar.');
                }}
              >
                Revisar atribuição com a versão consultada
              </Button>
            </div>
          )}
          <div className="record-actions">
            <Button type="submit" disabled={pending || blocked}>
              Confirmar atribuição
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => setEditing(false)}>
              Voltar sem atribuir
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
