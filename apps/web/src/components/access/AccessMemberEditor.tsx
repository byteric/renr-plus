import { useEffect, useRef, useState } from 'react';
import {
  accessMembershipSchema,
  updateAccessCapabilitiesSchema,
  updateAccessMembershipSchema,
  type AccessMembership,
} from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { Button } from '../ui/button';
import { StatusMessage } from '../ui/status-message';
import { CapabilityFields } from './access-ui';

export function AccessMemberEditor({
  member,
  onSaved,
  onCancel,
  onExpire,
  onDenied,
}: {
  member: AccessMembership;
  onSaved: (member: AccessMembership) => void;
  onCancel: () => void;
  onExpire: () => void;
  onDenied: () => void;
}) {
  const [version, setVersion] = useState(member.version);
  const [role, setRole] = useState(member.role);
  const [isActive, setActive] = useState(member.isActive);
  const [capabilities, setCapabilities] = useState(member.capabilities);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const controller = useRef(new AbortController());
  const heading = useRef<HTMLHeadingElement>(null);
  const path = `/organizations/${member.organizationId}/access-memberships/${member.userId}`;
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    heading.current?.focus();
    return () => current.abort();
  }, []);
  async function save(kind: 'membership' | 'capabilities') {
    if (pending || conflict) return;
    if (kind === 'membership' && member.isActive && !isActive && !confirmed) {
      setError(
        'Confirme a desativação. Ela remove o acesso à empresa, sem apagar autoria ou outras empresas.',
      );
      return;
    }
    const input =
      kind === 'membership'
        ? updateAccessMembershipSchema.safeParse({
            expectedVersion: version,
            reason,
            role,
            isActive,
          })
        : updateAccessCapabilitiesSchema.safeParse({
            expectedVersion: version,
            reason,
            capabilities,
          });
    if (!input.success) {
      setError('Informe uma justificativa entre 3 e 1.000 caracteres.');
      return;
    }
    setPending(true);
    setError('');
    try {
      const saved = await request(
        `${path}${kind === 'capabilities' ? '/capabilities' : ''}`,
        accessMembershipSchema,
        {
          method: kind === 'capabilities' ? 'PUT' : 'PATCH',
          body: JSON.stringify(input.data),
          signal: controller.current.signal,
        },
      );
      if (!controller.current.signal.aborted) onSaved(saved);
    } catch (failure) {
      if (controller.current.signal.aborted) return;
      if (failure instanceof RequestError && failure.status === 401) onExpire();
      else if (failure instanceof RequestError && failure.status === 403) onDenied();
      else if (failure instanceof RequestError && failure.status === 409) {
        setConflict(true);
        setError(
          'O registro mudou ou a operação removeria o último administrador. Recarregue o registro e revise a alteração.',
        );
      } else setError(failure instanceof Error ? failure.message : 'Não foi possível salvar.');
    } finally {
      if (!controller.current.signal.aborted) setPending(false);
    }
  }
  async function reload() {
    if (pending) return;
    setPending(true);
    try {
      const current = await request(path, accessMembershipSchema, {
        signal: controller.current.signal,
      });
      if (!controller.current.signal.aborted) {
        setVersion(current.version);
        setConflict(false);
        setError('');
        setNotice(
          `Versão ${current.version} recarregada. Situação atual: ${current.isActive ? 'ativo' : 'inativo'}, perfil ${current.role === 'ADMIN' ? 'administrador' : 'leitor'}, capacidades: ${current.capabilities.join(', ') || 'nenhuma'}. Seu rascunho foi mantido; compare antes de salvar.`,
        );
      }
    } catch (failure) {
      if (controller.current.signal.aborted) return;
      if (failure instanceof RequestError && failure.status === 401) onExpire();
      else if (failure instanceof RequestError && failure.status === 403) onDenied();
      else setError('Não foi possível recarregar. Seu rascunho foi mantido.');
    } finally {
      if (!controller.current.signal.aborted) setPending(false);
    }
  }
  return (
    <section className="surface access-editor" aria-labelledby="member-editor-title">
      <h2 ref={heading} tabIndex={-1} id="member-editor-title">
        Gerenciar {member.name}
      </h2>
      <p className="muted">
        {member.email} · Versão {version}
      </p>
      {error && (
        <StatusMessage tone="error">
          {error}
          {conflict && (
            <Button variant="outline" disabled={pending} onClick={() => void reload()}>
              Recarregar registro
            </Button>
          )}
        </StatusMessage>
      )}
      {notice && <StatusMessage>{notice}</StatusMessage>}
      <form
        aria-label="Alterar vínculo"
        onSubmit={(event) => {
          event.preventDefault();
          void save('membership');
        }}
      >
        <fieldset disabled={pending}>
          <legend>Perfil administrativo</legend>
          <label htmlFor="member-role">Perfil na empresa</label>
          <select
            id="member-role"
            value={role}
            onChange={(event) => setRole(event.target.value as AccessMembership['role'])}
          >
            <option value="READER">Leitor</option>
            <option value="ADMIN">Administrador</option>
          </select>
          <label className="access-check">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(event) => {
                setActive(event.target.checked);
                setConfirmed(false);
              }}
            />
            Vínculo ativo
          </label>
          {!isActive && member.isActive && (
            <label className="access-check">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              Confirmo a desativação deste vínculo
            </label>
          )}
        </fieldset>
        <CapabilityFields value={capabilities} onChange={setCapabilities} disabled={pending} />
        <label htmlFor="member-reason">Justificativa da alteração</label>
        <textarea
          id="member-reason"
          value={reason}
          minLength={3}
          maxLength={1000}
          disabled={pending}
          onChange={(event) => setReason(event.target.value)}
        />
        <div className="access-actions">
          <Button type="submit" disabled={pending || conflict}>
            Salvar vínculo
          </Button>
          <Button
            variant="outline"
            disabled={pending || conflict || !member.isActive}
            onClick={() => void save('capabilities')}
          >
            Salvar capacidades
          </Button>
          <Button variant="outline" disabled={pending} onClick={onCancel}>
            Cancelar alteração
          </Button>
        </div>
      </form>
    </section>
  );
}
