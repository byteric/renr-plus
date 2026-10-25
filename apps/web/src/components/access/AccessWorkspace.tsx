import { useState } from 'react';
import {
  accessHistoryListSchema,
  accessInviteListSchema,
  accessMembershipListSchema,
  sessionCapabilitiesSchema,
  sessionResponseSchema,
  type AccessInvite,
  type AccessMembership,
  type SessionResponse,
} from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { useActionData } from '../actions/useActionData';
import { Button } from '../ui/button';
import { Pagination } from '../ui/pagination';
import { StatusMessage } from '../ui/status-message';
import { StatusBadge } from '../ui/status-badge';
import { AccessMemberEditor } from './AccessMemberEditor';
import { AccessInviteForm } from './AccessInviteForm';
import { AccessSecret } from './access-ui';
import { accessDate, capabilityLabels } from './access-labels';
import './access.css';

type Tab = 'members' | 'invites' | 'history';
const titles: Record<Tab, string> = {
  members: 'Membros da empresa',
  invites: 'Convites de acesso',
  history: 'Histórico de acessos',
};
const inviteStatus: Record<AccessInvite['status'], string> = {
  PENDING: 'Pendente',
  EXPIRED: 'Expirado',
  REVOKED: 'Revogado',
  CONSUMED: 'Utilizado',
};
const eventLabels: Record<string, string> = {
  'ACCESS_CAPABILITY_GRANTED:TECHNICAL_DECISIONS': 'Decisões técnicas concedidas',
  'ACCESS_CAPABILITY_REVOKED:TECHNICAL_DECISIONS': 'Decisões técnicas revogadas',
  'ACCESS_CAPABILITY_GRANTED:EXECUTE_ASSIGNED_ACTIONS': 'Execução de ações atribuídas concedida',
  'ACCESS_CAPABILITY_REVOKED:EXECUTE_ASSIGNED_ACTIONS': 'Execução de ações atribuídas revogada',
  ACCESS_MEMBERSHIP_UPDATED: 'Vínculo atualizado',
  ACCESS_MEMBERSHIP_ACTIVATED: 'Vínculo ativado',
  ACCESS_MEMBERSHIP_DEACTIVATED: 'Vínculo desativado',
  ACCESS_INVITE_CREATED: 'Convite emitido',
  ACCESS_INVITE_REVOKED: 'Convite revogado',
  ACCESS_INVITE_REISSUED: 'Convite reemitido',
  ACCESS_INVITE_ACCEPTED: 'Convite aceito',
};
export function AccessWorkspace({
  session,
  onSession,
  onExpire,
}: {
  session: SessionResponse;
  onSession: (value: SessionResponse) => void;
  onExpire: () => void;
}) {
  const organizationId = session.activeOrganizationId;
  const admin =
    session.memberships.find((member) => member.organizationId === organizationId)?.role ===
    'ADMIN';
  if (!organizationId)
    return (
      <StatusMessage>
        Selecione uma empresa para gerenciar acessos. <a href="#/empresas">Ir para Empresas</a>
      </StatusMessage>
    );
  if (!admin)
    return (
      <StatusMessage tone="error">
        Somente administradores da empresa podem gerenciar acessos.
      </StatusMessage>
    );
  return (
    <AccessManager
      key={organizationId}
      organizationId={organizationId}
      userId={session.user.id}
      onSession={onSession}
      onExpire={onExpire}
    />
  );
}
function AccessManager({
  organizationId,
  userId,
  onSession,
  onExpire,
}: {
  organizationId: string;
  userId: string;
  onSession: (value: SessionResponse) => void;
  onExpire: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [denied, setDenied] = useState(false);
  const [tab, setTab] = useState<Tab>('members');
  const [page, setPage] = useState(1);
  const [member, setMember] = useState<AccessMembership | null>(null);
  const [inviteEditor, setInviteEditor] = useState<
    { invite: AccessInvite; operation: 'revoke' | 'reissue' } | 'new' | null
  >(null);
  const [secret, setSecret] = useState('');
  const [notice, setNotice] = useState('');
  const capabilities = useActionData(
    '/auth/session-capabilities',
    sessionCapabilitiesSchema,
    organizationId,
    onExpire,
    attempt,
  );
  const allowed = capabilities.data?.canManageAccess && !denied;
  const base = `/organizations/${organizationId}`;
  const query = `?page=${page}&pageSize=20`;
  const members = useActionData(
    allowed && tab === 'members' ? `${base}/access-memberships${query}` : null,
    accessMembershipListSchema,
    organizationId,
    onExpire,
    attempt,
  );
  const invites = useActionData(
    allowed && tab === 'invites' ? `${base}/access-invites${query}` : null,
    accessInviteListSchema,
    organizationId,
    onExpire,
    attempt,
  );
  const history = useActionData(
    allowed && tab === 'history' ? `${base}/access-history${query}` : null,
    accessHistoryListSchema,
    organizationId,
    onExpire,
    attempt,
  );
  const current = tab === 'members' ? members : tab === 'invites' ? invites : history;
  function changeTab(next: Tab) {
    setTab(next);
    setPage(1);
    setMember(null);
    setInviteEditor(null);
    setSecret('');
    setNotice('');
  }
  function onDenied() {
    setDenied(true);
    setMember(null);
    setInviteEditor(null);
    setSecret('');
  }
  async function savedMember(value: AccessMembership) {
    setMember(null);
    setNotice('Vínculo atualizado com histórico preservado.');
    setAttempt((value) => value + 1);
    if (value.userId === userId) {
      try {
        onSession(await request('/auth/session', sessionResponseSchema));
      } catch (failure) {
        if (failure instanceof RequestError && failure.status === 401) onExpire();
        else onDenied();
      }
    }
  }
  if (capabilities.loading)
    return <StatusMessage tone="loading">Verificando permissões…</StatusMessage>;
  if (capabilities.error)
    return (
      <StatusMessage
        tone="error"
        action={
          <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
            Verificar acesso novamente
          </Button>
        }
      >
        {capabilities.error}
      </StatusMessage>
    );
  if (!allowed)
    return (
      <StatusMessage tone="error">
        Somente administradores da empresa podem gerenciar acessos.
      </StatusMessage>
    );
  return (
    <div className="access-workspace">
      <div className="access-guide surface">
        <h2>Acesso por necessidade, não por cargo</h2>
        <p>
          Administrador gerencia a empresa. Leitor consulta. Capacidades de execução e decisões
          técnicas são concedidas separadamente, com justificativa e rastreabilidade.
        </p>
      </div>
      <nav className="access-tabs" aria-label="Gestão de acessos">
        {(Object.keys(titles) as Tab[]).map((key) => (
          <Button
            key={key}
            variant={tab === key ? 'default' : 'outline'}
            aria-pressed={tab === key}
            onClick={() => changeTab(key)}
          >
            {titles[key]}
          </Button>
        ))}
      </nav>
      {notice && <StatusMessage tone="success">{notice}</StatusMessage>}
      {secret && <AccessSecret token={secret} onClose={() => setSecret('')} />}
      {member && (
        <AccessMemberEditor
          key={member.userId}
          member={member}
          onCancel={() => setMember(null)}
          onSaved={(value) => void savedMember(value)}
          onExpire={onExpire}
          onDenied={onDenied}
        />
      )}
      {inviteEditor && (
        <AccessInviteForm
          key={
            inviteEditor === 'new' ? 'new' : `${inviteEditor.invite.id}-${inviteEditor.operation}`
          }
          organizationId={organizationId}
          existing={inviteEditor === 'new' ? undefined : inviteEditor}
          onCancel={() => setInviteEditor(null)}
          onSaved={(token) => {
            setInviteEditor(null);
            setSecret(token ?? '');
            setNotice(
              token ? 'Convite emitido. Entregue o link em canal privado.' : 'Convite revogado.',
            );
            setAttempt((value) => value + 1);
          }}
          onExpire={onExpire}
          onDenied={onDenied}
        />
      )}
      <div className="access-section-heading">
        <h2>{titles[tab]}</h2>
        <div className="access-actions">
          <Button
            variant="outline"
            onClick={() => {
              setSecret('');
              setAttempt((value) => value + 1);
            }}
          >
            Atualizar acessos
          </Button>
          {tab === 'invites' && (
            <Button
              onClick={() => {
                setSecret('');
                setInviteEditor('new');
              }}
            >
              Novo convite
            </Button>
          )}
        </div>
      </div>
      {current.loading && (
        <StatusMessage tone="loading">Carregando {titles[tab].toLowerCase()}…</StatusMessage>
      )}
      {current.error && <StatusMessage tone="error">{current.error}</StatusMessage>}
      {current.data?.total === 0 && <StatusMessage>Nenhum registro nesta seção.</StatusMessage>}
      {tab === 'members' && members.data && (
        <ul className="access-list">
          {members.data.items.map((item) => (
            <li className="surface access-record" key={item.userId}>
              <div>
                <h3>{item.name}</h3>
                <p>{item.email}</p>
                <div className="access-tags">
                  <StatusBadge
                    tone={item.isActive ? 'success' : 'neutral'}
                    label={item.isActive ? 'Ativo' : 'Inativo'}
                  />
                  <StatusBadge label={item.role === 'ADMIN' ? 'Administrador' : 'Leitor'} />
                  {item.capabilities.map((value) => (
                    <StatusBadge tone="info" key={value} label={capabilityLabels[value]} />
                  ))}
                </div>
                <p className="muted">
                  {item.capabilities.length
                    ? 'Capacidades explícitas; não substituem atribuição nem validação técnica.'
                    : 'Nenhuma capacidade técnica ou de execução concedida.'}
                </p>
              </div>
              <Button
                variant="outline"
                aria-label={`Gerenciar ${item.name}`}
                onClick={() => {
                  setNotice('');
                  setMember(item);
                }}
              >
                Gerenciar
              </Button>
            </li>
          ))}
        </ul>
      )}
      {tab === 'invites' && invites.data && (
        <ul className="access-list">
          {invites.data.items.map((item) => (
            <li className="surface access-record" key={item.id}>
              <div>
                <h3>{item.name}</h3>
                <p>{item.email}</p>
                <StatusBadge
                  label={inviteStatus[item.status]}
                  tone={item.status === 'PENDING' ? 'info' : 'neutral'}
                />
                <p className="muted">
                  {item.role === 'ADMIN' ? 'Administrador' : 'Leitor'} · Emissor:{' '}
                  {item.createdBy.name}
                </p>
                <p className="muted">Validade: {accessDate(item.expiresAt)}</p>
              </div>
              <div className="access-actions">
                {item.status === 'PENDING' && (
                  <Button
                    variant="outline"
                    aria-label={`Revogar convite de ${item.name}`}
                    onClick={() => {
                      setSecret('');
                      setInviteEditor({ invite: item, operation: 'revoke' });
                    }}
                  >
                    Revogar
                  </Button>
                )}
                {(item.status === 'PENDING' || item.status === 'EXPIRED') && (
                  <Button
                    variant="outline"
                    aria-label={`Reemitir convite de ${item.name}`}
                    onClick={() => {
                      setSecret('');
                      setInviteEditor({ invite: item, operation: 'reissue' });
                    }}
                  >
                    Reemitir
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {tab === 'history' && history.data && (
        <ol className="access-list">
          {history.data.items.map((item) => (
            <li className="surface" key={item.id}>
              <h3>{eventLabels[item.action] ?? 'Alteração de acesso registrada'}</h3>
              <p>{item.reason}</p>
              <p className="muted">
                {item.actor.name} ·{' '}
                <time dateTime={item.createdAt}>{accessDate(item.createdAt)}</time>
              </p>
            </li>
          ))}
        </ol>
      )}
      {current.data && (
        <Pagination
          page={current.data.page}
          total={current.data.total}
          pageSize={current.data.pageSize}
          pending={current.loading}
          label={`Páginas de ${titles[tab].toLowerCase()}`}
          onPageChange={(value) => {
            setMember(null);
            setInviteEditor(null);
            setSecret('');
            setPage(value);
          }}
        />
      )}
    </div>
  );
}
