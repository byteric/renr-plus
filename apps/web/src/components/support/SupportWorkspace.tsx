import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  createSupportTicketSchema,
  supportTicketAssigneesSchema,
  supportTicketCategorySchema,
  supportTicketDetailSchema,
  supportTicketListSchema,
  supportTicketStatusSchema,
  updateSupportTicketSchema,
  type SupportTicket,
  type SupportTicketDetail,
  type SupportTicketStatus,
} from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { useAccessRefresh, usePrivateQuery } from '../platform/usePrivateQuery';
import { Button } from '../ui/button';
import { Pagination } from '../ui/pagination';
import { StatusBadge } from '../ui/status-badge';
import { StatusMessage } from '../ui/status-message';
import './support.css';

const categories = {
  ACCESS: 'Acesso',
  BILLING: 'Cobrança',
  TECHNICAL: 'Uso da plataforma',
  OTHER: 'Outro assunto',
};

const statuses = { OPEN: 'Aberto', IN_PROGRESS: 'Em atendimento', RESOLVED: 'Resolvido' };
const nextSteps = {
  OPEN: 'Aguardando a triagem da equipe de suporte.',
  IN_PROGRESS: 'Acompanhe as atualizações no histórico.',
  RESOLVED: 'Consulte a resolução no histórico.',
};
const attendantSteps = {
  OPEN: 'Atribua um responsável e informe o prazo acordado.',
  IN_PROGRESS: 'Registre o andamento ou marque como resolvido e informe o que foi feito.',
  RESOLVED: nextSteps.RESOLVED,
};

function civilDate(date: string | null) {
  return date ? date.split('-').reverse().join('/') : 'Sem prazo informado';
}

const eventDate = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

function TicketStatus({ status }: { status: SupportTicketStatus }) {
  return <StatusBadge label={statuses[status]} tone={status === 'RESOLVED' ? 'success' : 'info'} />;
}

function TicketDetails({
  detail,
  platform,
  canManage,
}: {
  detail: SupportTicketDetail;
  platform: boolean;
  canManage: boolean;
}) {
  const { ticket } = detail;
  return (
    <>
      <section className="surface support-card" aria-label="Detalhes do chamado">
        <div className="support-heading">
          <div>
            <h2>{ticket.subject}</h2>
            <p className="muted">
              {platform && ticket.organizationName + ' · '}
              {categories[ticket.category]}
            </p>
          </div>
          <TicketStatus status={ticket.status} />
        </div>
        <p className="support-note">{ticket.description}</p>
        <dl className="support-facts">
          <div>
            <dt>Responsável</dt>
            <dd>
              {ticket.assignee?.name ??
                (ticket.status === 'RESOLVED'
                  ? 'Sem responsável atribuído'
                  : 'Aguardando atribuição')}
            </dd>
          </div>
          <div>
            <dt>Prazo</dt>
            <dd>{civilDate(ticket.dueOn)}</dd>
          </div>
        </dl>
        <p>{(canManage ? attendantSteps : nextSteps)[ticket.status]}</p>
      </section>
      <section className="surface support-card" aria-label="Histórico do chamado">
        <h3>Histórico do chamado</h3>
        <ol className="support-list">
          {detail.history.map((entry) => (
            <li key={entry.id}>
              <div className="support-heading">
                <strong>{entry.actorName}</strong>
                <time dateTime={entry.createdAt}>
                  {eventDate.format(new Date(entry.createdAt))}
                </time>
              </div>
              <p>
                {statuses[entry.status]} · {entry.assignee?.name ?? 'Sem responsável'} ·{' '}
                {civilDate(entry.dueOn)}
              </p>
              <p className="support-note">{entry.note}</p>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

function TicketForm({
  path,
  root,
  ticket,
  revision,
  onSaved,
  onReload,
  onDenied,
  onExpire,
}: {
  path: string;
  root: string;
  ticket?: SupportTicket;
  revision: number;
  onSaved: (id: string) => void;
  onReload: () => void;
  onDenied: () => void;
  onExpire: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [assigneeId, setAssigneeId] = useState(ticket?.assignee?.id ?? '');
  const life = useRef<AbortController | null>(null);
  const id = useId();
  useEffect(() => {
    const controller = new AbortController();
    life.current = controller;
    return () => controller.abort();
  }, []);
  const assignees = usePrivateQuery(
    ticket ? root + '/assignees' : null,
    supportTicketAssigneesSchema,
    revision,
    onExpire,
    onDenied,
  );
  const unavailableAssignee =
    !!assigneeId && !assignees.data?.items.some((user) => user.id === assigneeId);
  const cannotSave = pending || conflict || (!!ticket && (!assignees.data || unavailableAssignee));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (cannotSave || !life.current) return;
    const { signal } = life.current;
    const form = new FormData(event.currentTarget);
    const parsed = ticket
      ? updateSupportTicketSchema.safeParse({
          expectedVersion: ticket.version,
          status: form.get('status'),
          assigneeId: assigneeId || null,
          dueOn: form.get('dueOn') || null,
          note: form.get('note'),
        })
      : createSupportTicketSchema.safeParse({
          subject: form.get('subject'),
          category: form.get('category'),
          description: form.get('description'),
        });
    if (!parsed.success) {
      setError('Confira os campos e preencha o texto com pelo menos 3 caracteres.');
      return;
    }
    setPending(true);
    setError('');
    try {
      const saved = await request(path, supportTicketDetailSchema, {
        method: ticket ? 'PATCH' : 'POST',
        body: JSON.stringify(parsed.data),
        signal,
      });
      if (!signal.aborted) onSaved(saved.ticket.id);
    } catch (failure) {
      if (signal.aborted) return;
      if (failure instanceof RequestError && failure.status === 401) onExpire();
      else if (failure instanceof RequestError && failure.status === 403) onDenied();
      else if (failure instanceof RequestError && failure.status === 409 && ticket) {
        setConflict(true);
        setError(
          'O chamado foi alterado ou já foi resolvido. Confira a versão atual antes de reenviar.',
        );
      } else setError(failure instanceof Error ? failure.message : 'Falha ao salvar o chamado.');
    } finally {
      if (!signal.aborted) setPending(false);
    }
  }

  return (
    <form
      className="surface support-card support-form"
      onSubmit={(event) => void save(event)}
      aria-labelledby={id}
    >
      <h3 id={id}>{ticket ? 'Atualizar atendimento' : 'Novo chamado'}</h3>
      {ticket ? (
        <>
          <div className="support-edit-grid">
            <label>
              Situação
              <select name="status" defaultValue={ticket.status} required>
                {supportTicketStatusSchema.options
                  .filter((status) => status !== 'OPEN' || ticket.status === 'OPEN')
                  .map((status) => (
                    <option key={status} value={status}>
                      {statuses[status]}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Responsável
              <select
                name="assigneeId"
                value={assigneeId}
                onChange={(event) => setAssigneeId(event.currentTarget.value)}
                disabled={!assignees.data}
              >
                <option value="">Sem responsável</option>
                {unavailableAssignee && (
                  <option value={assigneeId}>
                    {ticket.assignee?.id === assigneeId
                      ? ticket.assignee.name
                      : 'Responsável selecionado'}
                    {assignees.data ? ' (acesso indisponível)' : ''}
                  </option>
                )}
                {assignees.data?.items.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Prazo de atendimento
              <input type="date" name="dueOn" defaultValue={ticket.dueOn ?? ''} />
            </label>
          </div>
          {unavailableAssignee && assignees.data && (
            <StatusMessage tone="warning">
              Selecione um atendente ativo ou retire a atribuição antes de salvar.
            </StatusMessage>
          )}
          {assignees.error && (
            <StatusMessage
              tone="error"
              action={
                <Button variant="outline" onClick={onReload}>
                  Tentar novamente
                </Button>
              }
            >
              {assignees.error}
            </StatusMessage>
          )}
          <label>
            Atualização para o cliente
            <textarea name="note" rows={3} minLength={3} maxLength={2000} required />
          </label>
        </>
      ) : (
        <>
          <label>
            Assunto
            <input name="subject" minLength={3} maxLength={160} required />
          </label>
          <label>
            Categoria
            <select name="category" defaultValue="" required>
              <option value="" disabled>
                Selecione uma categoria
              </option>
              {supportTicketCategorySchema.options.map((category) => (
                <option key={category} value={category}>
                  {categories[category]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Descrição
            <textarea name="description" rows={4} minLength={3} maxLength={2000} required />
          </label>
          <p className="muted">
            Descreva a dúvida ou o problema de uso. Mantenha senhas e dados pessoais fora da
            mensagem.
          </p>
        </>
      )}
      {error && (
        <StatusMessage
          tone="error"
          action={
            conflict && (
              <Button variant="outline" onClick={onReload}>
                Recarregar chamado
              </Button>
            )
          }
        >
          {error}
        </StatusMessage>
      )}
      <div>
        <Button type="submit" disabled={cannotSave}>
          {pending ? 'Salvando…' : ticket ? 'Salvar atualização' : 'Enviar chamado'}
        </Button>
      </div>
    </form>
  );
}

export function SupportWorkspace({
  platform,
  canManage,
  organizationId,
  ticketId,
  onExpire,
}: {
  platform: boolean;
  canManage: boolean;
  organizationId: string | null;
  ticketId: string | undefined;
  onExpire: () => void;
}) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<SupportTicketStatus | ''>('');
  const [denied, setDenied] = useState(false);
  const [opened, setOpened] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const { revision, refresh } = useAccessRefresh();
  const onDenied = () => setDenied(true);
  const root = platform
    ? '/platform/support-tickets'
    : '/organizations/' + organizationId + '/support-tickets';
  const route = platform ? '#/plataforma/chamados' : '#/chamados';
  const validId = ticketId && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(ticketId);
  const detailPath = validId ? root + '/' + ticketId : null;
  const parameters = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (status) parameters.set('status', status);
  const detail = usePrivateQuery(
    denied ? null : detailPath,
    supportTicketDetailSchema,
    revision,
    onExpire,
    onDenied,
    undefined,
    true,
  );
  const list = usePrivateQuery(
    ticketId || denied ? null : root + '?' + parameters.toString(),
    supportTicketListSchema,
    revision,
    onExpire,
    onDenied,
    platform ? undefined : organizationId,
  );
  const retry = () => {
    setDenied(false);
    refresh();
  };
  if (denied)
    return (
      <StatusMessage
        tone="error"
        action={
          <Button variant="outline" onClick={retry}>
            Revalidar acesso
          </Button>
        }
      >
        Seu acesso ao suporte está indisponível.
      </StatusMessage>
    );
  if (ticketId) {
    const current = detail.data;
    const matches =
      current?.ticket.id === ticketId &&
      (platform || current.ticket.organizationId === organizationId);
    return (
      <div className="support-workspace">
        <a href={route} className="action-link" onClick={() => setConfirmation('')}>
          Voltar aos chamados
        </a>
        {confirmation && <StatusMessage tone="success">{confirmation}</StatusMessage>}
        {!validId && (
          <StatusMessage tone="error">Este endereço de chamado é inválido.</StatusMessage>
        )}
        {detail.loading && <StatusMessage tone="loading">Carregando chamado…</StatusMessage>}
        {detail.error && (
          <StatusMessage
            tone="error"
            action={
              <Button variant="outline" onClick={retry}>
                Tentar novamente
              </Button>
            }
          >
            {detail.error}
          </StatusMessage>
        )}
        {current && !matches && (
          <StatusMessage tone="error">
            Não foi possível confirmar o chamado neste espaço.
          </StatusMessage>
        )}
        {current && matches && (
          <>
            <TicketDetails detail={current} platform={platform} canManage={canManage} />
            {canManage && detailPath && current.ticket.status !== 'RESOLVED' && (
              <TicketForm
                key={current.ticket.id + ':' + current.ticket.version}
                path={detailPath}
                root={root}
                ticket={current.ticket}
                revision={revision}
                onSaved={() => {
                  setConfirmation('Atendimento atualizado.');
                  refresh();
                }}
                onReload={refresh}
                onDenied={onDenied}
                onExpire={onExpire}
              />
            )}
          </>
        )}
      </div>
    );
  }
  return (
    <div className="support-workspace">
      <section className="surface support-card" aria-label="Fila de chamados">
        <div className="support-heading">
          <h2>{platform ? 'Fila de atendimento' : 'Chamados da empresa'}</h2>
          {!platform && (
            <Button variant={opened ? 'outline' : 'default'} onClick={() => setOpened(!opened)}>
              {opened ? 'Cancelar abertura' : 'Abrir chamado'}
            </Button>
          )}
        </div>
        <label className="support-filter">
          Filtrar por situação
          <select
            value={status}
            onChange={(event) => {
              const selected = supportTicketStatusSchema.safeParse(event.currentTarget.value);
              setStatus(selected.success ? selected.data : '');
              setPage(1);
            }}
          >
            <option value="">Todas</option>
            {supportTicketStatusSchema.options.map((option) => (
              <option key={option} value={option}>
                {statuses[option]}
              </option>
            ))}
          </select>
        </label>
        {list.loading && <StatusMessage tone="loading">Carregando fila…</StatusMessage>}
        {list.error && (
          <StatusMessage
            tone="error"
            action={
              <Button variant="outline" onClick={retry}>
                Tentar novamente
              </Button>
            }
          >
            {list.error}
          </StatusMessage>
        )}
        {list.data &&
          (list.data.items.length === 0 ? (
            <StatusMessage>Nenhum chamado neste recorte.</StatusMessage>
          ) : (
            <>
              <ul className="support-list">
                {list.data.items.map((ticket) => (
                  <li key={ticket.id}>
                    <div className="support-heading">
                      <a className="action-link" href={route + '/' + ticket.id}>
                        {ticket.subject}
                      </a>
                      <TicketStatus status={ticket.status} />
                    </div>
                    <p>
                      {platform && ticket.organizationName + ' · '}
                      {categories[ticket.category]}
                    </p>
                    <p className="muted">
                      {ticket.assignee?.name ?? 'Sem responsável'} · {civilDate(ticket.dueOn)}
                    </p>
                  </li>
                ))}
              </ul>
              <Pagination
                page={list.data.page}
                pageSize={list.data.pageSize}
                total={list.data.total}
                onPageChange={setPage}
                label="Páginas de chamados"
              />
            </>
          ))}
      </section>
      {opened && !platform && (
        <TicketForm
          path={root}
          root={root}
          revision={revision}
          onSaved={(id) => {
            setOpened(false);
            setConfirmation('Chamado enviado.');
            window.location.hash = route + '/' + id;
          }}
          onReload={refresh}
          onDenied={onDenied}
          onExpire={onExpire}
        />
      )}
    </div>
  );
}
