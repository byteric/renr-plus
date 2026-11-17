import { useEffect, useRef, useState } from 'react';
import {
  assessmentInviteDeliveryConfirmationSchema,
  assessmentInviteDeliveryListSchema,
  assessmentInviteDeliverySchema,
  type AssessmentInviteDelivery as Delivery,
  type AssessmentInvites,
} from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { Button } from '../ui/button';
import { StatusMessage } from '../ui/status-message';
import { useWorkforceData } from '../workforce/useWorkforceData';

const labels: Record<Delivery['status'], string> = {
  PENDING_CONFIRMATION: 'Aguardando confirmação',
  ISSUED: 'Códigos gerados',
  CLOSED: 'Coleta fechada',
  EXPIRED: 'Prazo encerrado',
};
const dateTime = (value: string) => new Date(value).toLocaleString('pt-BR');
const requiresManualReview =
  'Os códigos já foram gerados e só aparecem na primeira confirmação. Confira o repasse dos convites antes de preparar outro lote.';

export function AssessmentInviteDelivery({
  path,
  organizationId,
  available,
  disabled,
  onExpire,
}: {
  path: string;
  organizationId: string;
  available: boolean;
  disabled: boolean;
  onExpire: () => void;
}) {
  const [count, setCount] = useState('1');
  const [operation, setOperation] = useState<Delivery | null>(null);
  const [codes, setCodes] = useState<AssessmentInvites['invites']>([]);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const previewKey = useRef<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const history = useWorkforceData(
    path,
    assessmentInviteDeliveryListSchema,
    organizationId,
    onExpire,
    refresh,
  );
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    previewHeading.current?.focus();
  }, [operation?.id]);

  function select(next: Delivery | null) {
    setOperation(next);
    setCodes([]);
    setUncertain(false);
    setError('');
    setNotice(next?.status === 'ISSUED' ? requiresManualReview : '');
  }

  async function run(action: 'preview' | 'confirm' | 'check') {
    if (pending.current || disabled || (action !== 'check' && !available)) return;
    const current = operation;
    if (action !== 'preview' && !current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError('');
    setNotice('');
    const options = { signal: controller.signal };
    try {
      if (action === 'preview') {
        previewKey.current ??= crypto.randomUUID();
        const next = await request(`${path}/preview`, assessmentInviteDeliverySchema, {
          ...options,
          method: 'POST',
          body: JSON.stringify({
            channel: 'MANUAL_CODE',
            count: Number(count),
            idempotencyKey: previewKey.current,
          }),
        });
        if (controller.signal.aborted) return;
        if (next.count !== Number(count)) throw new RequestError(502);
        previewKey.current = null;
        select(next);
      } else if (action === 'confirm') {
        const result = await request(
          `${path}/${current!.id}/confirm`,
          assessmentInviteDeliveryConfirmationSchema,
          {
            ...options,
            method: 'POST',
            body: '{}',
          },
        );
        if (controller.signal.aborted) return;
        if (
          result.operation.id !== current!.id ||
          result.operation.count !== current!.count ||
          (!result.requiresReview && result.invites.length !== result.operation.count)
        ) {
          throw new RequestError(502);
        }
        select(result.operation);
        setNotice(
          result.requiresReview ? requiresManualReview : 'Códigos gerados para repasse manual.',
        );
        setCodes(result.invites);
      } else {
        const next = await request(
          `${path}/${current!.id}`,
          assessmentInviteDeliverySchema,
          options,
        );
        if (controller.signal.aborted) return;
        if (next.id !== current!.id) throw new RequestError(502);
        select(next);
      }
      setRefresh((value) => value + 1);
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof RequestError && failure.status === 401) return onExpire();
      if (failure instanceof RequestError && [403, 404].includes(failure.status)) {
        select(null);
        setError('O acesso aos convites desta coleta está indisponível.');
        setRefresh((value) => value + 1);
        return;
      }
      if (action === 'confirm') {
        setUncertain(true);
        setError(
          'Não foi possível confirmar o resultado. Consulte esta operação antes de tentar de novo.',
        );
      } else {
        setError(
          failure instanceof Error ? failure.message : 'Não foi possível consultar os convites.',
        );
      }
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  const validCount = Number.isInteger(Number(count)) && Number(count) >= 1 && Number(count) <= 20;
  const locked = busy || disabled;
  return (
    <section className="assessment-cycle-invites" aria-label="Convites de participação">
      <h3>Convites de participação</h3>
      <p>
        Entregue um código a cada pessoa para usar em <a href="/#/responder">Responder coleta</a>.
        Os códigos aparecem apenas na primeira confirmação do lote.
      </p>
      {available && !operation && (
        <form
          className="assessment-cycle-confirm"
          onSubmit={(event) => {
            event.preventDefault();
            if (validCount) void run('preview');
          }}
        >
          <label>
            Quantidade de convites
            <input
              type="number"
              min={1}
              max={20}
              value={count}
              disabled={locked}
              onChange={(event) => {
                setCount(event.target.value);
                previewKey.current = null;
              }}
            />
          </label>
          <div className="assessment-cycle-actions">
            <Button type="submit" disabled={locked || !validCount}>
              Preparar convites
            </Button>
          </div>
        </form>
      )}
      {operation && (
        <div className="assessment-cycle-confirm">
          <h4 tabIndex={-1} ref={previewHeading}>
            {operation.status === 'PENDING_CONFIRMATION'
              ? 'Prévia da entrega manual'
              : labels[operation.status]}
          </h4>
          <p>
            {operation.count} {operation.count === 1 ? 'convite' : 'convites'} por código.
            {operation.issuedAt && ` Geração em ${dateTime(operation.issuedAt)}.`}
            {operation.status === 'PENDING_CONFIRMATION' &&
              ` Confirmação da prévia até ${dateTime(operation.expiresAt)}.`}
          </p>
          {operation.status === 'PENDING_CONFIRMATION' && available && (
            <p>Confirme para gerar os códigos. O repasse aos participantes é feito por você.</p>
          )}
          <div className="assessment-cycle-actions">
            {uncertain ? (
              <Button variant="outline" disabled={locked} onClick={() => void run('check')}>
                Consultar operação
              </Button>
            ) : (
              operation.status === 'PENDING_CONFIRMATION' &&
              available && (
                <Button disabled={locked} onClick={() => void run('confirm')}>
                  Gerar convites
                </Button>
              )
            )}
            <Button variant="outline" disabled={locked} onClick={() => select(null)}>
              Voltar aos convites
            </Button>
          </div>
        </div>
      )}
      {codes.length > 0 && (
        <ul aria-label="Códigos para repasse">
          {codes.map((invite, index) => (
            <li key={invite.code}>
              <code className="assessment-invite-code">{invite.code}</code>
              <span>Validade: {dateTime(invite.expiresAt)}</span>
              <Button
                variant="outline"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(invite.code)
                    .then(() => setNotice(`Convite ${index + 1} copiado.`))
                    .catch(() => setNotice('Copie o código manualmente.'));
                }}
              >
                Copiar código {index + 1}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {busy && <StatusMessage tone="loading">Consultando a operação…</StatusMessage>}
      {error && <StatusMessage tone="error">{error}</StatusMessage>}
      {notice && (
        <StatusMessage tone="info" role="status">
          {notice}
        </StatusMessage>
      )}
      <details>
        <summary>Histórico de operações</summary>
        {history.loading && <StatusMessage tone="loading">Consultando o histórico…</StatusMessage>}
        {history.error && <StatusMessage tone="error">{history.error}</StatusMessage>}
        {history.data && history.data.items.length === 0 && <p>Nenhuma operação registrada.</p>}
        {!!history.data?.items.length && (
          <ul aria-label="Operações recentes">
            {history.data.items.map((entry) => (
              <li key={entry.id}>
                <strong>{labels[entry.status]}</strong>
                <span>
                  {entry.count} {entry.count === 1 ? 'convite' : 'convites'}
                </span>
                <span>
                  {entry.issuedAt
                    ? `Geração em ${dateTime(entry.issuedAt)}`
                    : `Prazo da prévia até ${dateTime(entry.expiresAt)}`}
                </span>
                {entry.status === 'PENDING_CONFIRMATION' && available && (
                  <Button
                    variant="outline"
                    disabled={locked || operation?.id === entry.id}
                    onClick={() => select(entry)}
                  >
                    Retomar prévia
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <Button
          variant="outline"
          disabled={locked || history.loading}
          onClick={() => setRefresh((value) => value + 1)}
        >
          Atualizar histórico
        </Button>
      </details>
    </section>
  );
}
