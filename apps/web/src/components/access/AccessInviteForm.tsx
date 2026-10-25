import { useEffect, useRef, useState } from 'react';
import {
  accessInviteSchema,
  accessInviteSecretSchema,
  createAccessInviteSchema,
  mutateAccessInviteSchema,
  type AccessInvite,
  type Capability,
} from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { Button } from '../ui/button';
import { StatusMessage } from '../ui/status-message';
import { CapabilityFields } from './access-ui';

export function AccessInviteForm({
  organizationId,
  existing,
  onSaved,
  onCancel,
  onExpire,
  onDenied,
}: {
  organizationId: string;
  existing?: { invite: AccessInvite; operation: 'revoke' | 'reissue' };
  onSaved: (token?: string) => void;
  onCancel: () => void;
  onExpire: () => void;
  onDenied: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'READER'>('READER');
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [hours, setHours] = useState('72');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef(new AbortController());
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    heading.current?.focus();
    return () => current.abort();
  }, []);
  async function submit() {
    if (pending || conflict) return;
    const input = existing
      ? mutateAccessInviteSchema.safeParse({ expectedVersion: existing.invite.version, reason })
      : createAccessInviteSchema.safeParse({
          email,
          name,
          role,
          capabilities,
          expiresInHours: Number(hours),
          reason,
        });
    if (!input.success) {
      setError(
        'Confira nome, e-mail, validade (1 a 168 horas) e justificativa (3 a 1.000 caracteres).',
      );
      return;
    }
    setPending(true);
    setError('');
    const path = `/organizations/${organizationId}/access-invites${existing ? `/${existing.invite.id}/${existing.operation}` : ''}`;
    try {
      if (existing?.operation === 'revoke') {
        await request(path, accessInviteSchema, {
          method: 'POST',
          body: JSON.stringify(input.data),
          signal: controller.current.signal,
        });
        if (!controller.current.signal.aborted) onSaved();
      } else {
        const result = await request(path, accessInviteSecretSchema, {
          method: 'POST',
          body: JSON.stringify(input.data),
          signal: controller.current.signal,
        });
        if (!controller.current.signal.aborted) onSaved(result.token);
      }
    } catch (failure) {
      if (controller.current.signal.aborted) return;
      if (failure instanceof RequestError && failure.status === 401) onExpire();
      else if (failure instanceof RequestError && failure.status === 403) onDenied();
      else if (failure instanceof RequestError && failure.status === 409) {
        setConflict(true);
        setError(
          'O convite mudou ou já existe um vínculo/convite ativo. Feche este formulário, atualize a lista e confira a situação antes de tentar novamente.',
        );
      } else
        setError(failure instanceof Error ? failure.message : 'Não foi possível emitir o convite.');
    } finally {
      if (!controller.current.signal.aborted) setPending(false);
    }
  }
  return (
    <section className="surface access-editor" aria-labelledby="invite-editor-title">
      <h2 ref={heading} tabIndex={-1} id="invite-editor-title">
        {existing
          ? `${existing.operation === 'revoke' ? 'Revogar' : 'Reemitir'} convite de ${existing.invite.name}`
          : 'Convidar pessoa'}
      </h2>
      <p className="muted">
        {existing?.operation === 'reissue'
          ? 'O link anterior será invalidado. Entregue o novo link em canal privado.'
          : 'A pessoa precisa aceitar o convite. Nenhuma senha existente será alterada.'}
      </p>
      {error && <StatusMessage tone="error">{error}</StatusMessage>}
      <form
        aria-label="Convidar pessoa"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {!existing && (
          <>
            <label htmlFor="invite-name">Nome da pessoa</label>
            <input
              id="invite-name"
              value={name}
              maxLength={120}
              disabled={pending}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
            />
            <label htmlFor="invite-email">E-mail da pessoa</label>
            <input
              id="invite-email"
              type="email"
              value={email}
              maxLength={254}
              disabled={pending}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="off"
            />
            <label htmlFor="invite-role">Perfil inicial</label>
            <select
              id="invite-role"
              value={role}
              disabled={pending}
              onChange={(event) => setRole(event.target.value as typeof role)}
            >
              <option value="READER">Leitor</option>
              <option value="ADMIN">Administrador</option>
            </select>
            <CapabilityFields value={capabilities} onChange={setCapabilities} disabled={pending} />
            <label htmlFor="invite-hours">Validade em horas</label>
            <input
              id="invite-hours"
              type="number"
              min={1}
              max={168}
              value={hours}
              disabled={pending}
              onChange={(event) => setHours(event.target.value)}
            />
          </>
        )}
        <label htmlFor="invite-reason">Justificativa do convite</label>
        <textarea
          id="invite-reason"
          value={reason}
          maxLength={1000}
          disabled={pending}
          onChange={(event) => setReason(event.target.value)}
        />
        <div className="access-actions">
          <Button type="submit" disabled={pending || conflict}>
            {pending
              ? 'Salvando…'
              : existing
                ? existing.operation === 'revoke'
                  ? 'Confirmar revogação'
                  : 'Confirmar reemissão'
                : 'Emitir convite'}
          </Button>
          <Button variant="outline" disabled={pending} onClick={onCancel}>
            Cancelar convite
          </Button>
        </div>
      </form>
    </section>
  );
}
