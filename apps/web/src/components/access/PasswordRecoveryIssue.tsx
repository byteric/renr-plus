import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { passwordRecoveryIssuedSchema, passwordRecoveryIssueSchema } from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { Button } from '../ui/button';
import { StatusMessage } from '../ui/status-message';
import { accessDate } from './access-labels';
import './access.css';

export function PasswordRecoveryIssue({
  organizationId,
  authenticator,
  onExpire,
  onClose,
}: (
  | { organizationId?: string; authenticator?: false }
  | { organizationId?: never; authenticator: true }
) & {
  onExpire: () => void;
  onClose?: () => void;
}) {
  const fieldId = useId();
  const emailInput = useRef<HTMLInputElement>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const restoreFocus = useRef(!!onClose);
  const controller = useRef<AbortController | null>(null);
  const [email, setEmail] = useState('');
  const [reference, setReference] = useState('');
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [pending, setPending] = useState(false);
  const [issued, setIssued] = useState<{ link: string; expiresAt: string } | null>(null);
  const title = authenticator
    ? 'Emitir recuperação do autenticador'
    : 'Emitir recuperação assistida';

  useEffect(() => {
    function discard() {
      controller.current?.abort();
      controller.current = null;
      setPending(false);
      setIssued(null);
      setCopyStatus('');
    }
    window.addEventListener('pagehide', discard);
    return () => {
      controller.current?.abort();
      window.removeEventListener('pagehide', discard);
    };
  }, []);

  useEffect(() => {
    if (issued) {
      linkInput.current?.focus();
      const timer = window.setTimeout(
        () => {
          restoreFocus.current = true;
          setIssued(null);
          setCopyStatus('');
          setError('O link perdeu a validade. Confirme a identidade antes de emitir outro.');
        },
        Math.min(Math.max(0, Date.parse(issued.expiresAt) - Date.now()), 2_147_483_647),
      );
      return () => window.clearTimeout(timer);
    }
    if (restoreFocus.current) {
      restoreFocus.current = false;
      emailInput.current?.focus();
    }
  }, [issued]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (controller.current) return;
    const input = passwordRecoveryIssueSchema.safeParse({
      email,
      verificationConfirmed: verified,
      verificationReference: reference,
    });
    if (!input.success) {
      setError('Confira o e-mail, a referência do protocolo e a confirmação de identidade.');
      return;
    }
    const active = new AbortController();
    controller.current = active;
    setError('');
    setPending(true);
    const path = organizationId
      ? `/organizations/${encodeURIComponent(organizationId)}/password-recoveries`
      : authenticator
        ? '/platform/mfa-recoveries'
        : '/platform/password-recoveries';
    try {
      const result = await request(path, passwordRecoveryIssuedSchema, {
        method: 'POST',
        body: JSON.stringify(input.data),
        signal: active.signal,
      });
      if (!active.signal.aborted) {
        if (Date.parse(result.expiresAt) <= Date.now()) {
          setError('O link perdeu a validade. Confirme a identidade antes de emitir outro.');
          return;
        }
        const link = new URL(
          `#/${authenticator ? 'recuperar-autenticador' : 'redefinir-senha'}/${result.token}`,
          `${window.location.origin}${window.location.pathname}`,
        ).href;
        setIssued({ link, expiresAt: result.expiresAt });
        setEmail('');
        setReference('');
        setVerified(false);
      }
    } catch (failure) {
      if (active.signal.aborted) return;
      if (failure instanceof RequestError && failure.status === 401) onExpire();
      else if (failure instanceof RequestError && failure.status === 503)
        setError('A emissão assistida está indisponível neste ambiente.');
      else if (failure instanceof RequestError && [403, 404].includes(failure.status))
        setError(
          organizationId
            ? 'Não foi possível emitir neste espaço. Encaminhe o pedido ao responsável pela recuperação na plataforma.'
            : authenticator
              ? 'A recuperação do autenticador precisa ser emitida por outro operador da plataforma com a concessão específica. Confira a conta informada.'
              : 'Não foi possível emitir para esta conta. Confira o e-mail e a sua concessão.',
        );
      else
        setError(
          failure instanceof RequestError ? failure.message : 'Não foi possível emitir o link.',
        );
    } finally {
      if (controller.current === active) controller.current = null;
      if (!active.signal.aborted) setPending(false);
    }
  }

  async function copy() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.link);
      setCopyStatus('Link copiado. Entregue-o pelo canal privado já validado.');
    } catch {
      linkInput.current?.focus();
      linkInput.current?.select();
      setCopyStatus('O link foi selecionado. Use o comando de cópia do seu dispositivo.');
    }
  }

  return (
    <section
      className="surface access-editor recovery-issue"
      aria-labelledby={`${fieldId}-heading`}
    >
      <h2 id={`${fieldId}-heading`}>{title}</h2>
      {issued ? (
        <>
          <p>
            Entregue este link somente ao titular, pelo contato privado já validado.{' '}
            {authenticator
              ? 'O titular usará a senha atual para configurar um novo autenticador.'
              : 'A senha será definida pelo titular.'}
          </p>
          <p className="muted">
            Válido até <time dateTime={issued.expiresAt}>{accessDate(issued.expiresAt)}</time>.
          </p>
          <label htmlFor={`${fieldId}-link`}>
            {authenticator ? 'Link de recuperação do autenticador' : 'Link de recuperação'}
          </label>
          <input
            id={`${fieldId}-link`}
            ref={linkInput}
            value={issued.link}
            readOnly
            autoComplete="off"
            spellCheck={false}
            className="recovery-secret"
          />
          <div className="access-actions">
            <Button onClick={() => void copy()}>Copiar link</Button>
            <Button
              variant="outline"
              onClick={() => {
                restoreFocus.current = true;
                setIssued(null);
                setCopyStatus('');
              }}
            >
              Ocultar link
            </Button>
            {onClose && (
              <Button variant="outline" onClick={onClose}>
                Fechar recuperação
              </Button>
            )}
          </div>
          {copyStatus && <StatusMessage tone="success">{copyStatus}</StatusMessage>}
        </>
      ) : (
        <>
          <p>
            {authenticator
              ? 'Operação exclusiva da plataforma. Outro operador com a concessão deve conferir a identidade do titular por um contato previamente validado.'
              : 'Confirme a identidade por um contato previamente validado antes de emitir o link.'}
          </p>
          <form noValidate aria-label={title} onSubmit={(event) => void submit(event)}>
            <label htmlFor={`${fieldId}-email`}>E-mail da conta</label>
            <input
              id={`${fieldId}-email`}
              type="email"
              ref={emailInput}
              value={email}
              autoComplete="off"
              onChange={(event) => setEmail(event.target.value)}
              maxLength={254}
              disabled={pending}
              required
            />
            <label htmlFor={`${fieldId}-reference`}>Referência da conferência</label>
            <input
              id={`${fieldId}-reference`}
              aria-describedby={`${fieldId}-reference-help`}
              value={reference}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setReference(event.target.value)}
              minLength={3}
              maxLength={64}
              disabled={pending}
              required
            />
            <small id={`${fieldId}-reference-help`} className="muted">
              Use o identificador do protocolo, com letras, números, pontos, hífens ou sublinhados.
            </small>
            <label className="access-check" htmlFor={`${fieldId}-verified`}>
              <input
                id={`${fieldId}-verified`}
                type="checkbox"
                checked={verified}
                onChange={(event) => setVerified(event.target.checked)}
                disabled={pending}
                required
              />
              Confirmei a identidade por um contato já validado.
            </label>
            {error && <StatusMessage tone="error">{error}</StatusMessage>}
            <div className="access-actions">
              <Button type="submit" disabled={pending || !verified}>
                {pending
                  ? 'Emitindo…'
                  : authenticator
                    ? 'Emitir link para o autenticador'
                    : 'Emitir link de recuperação'}
              </Button>
              {onClose && (
                <Button variant="outline" onClick={onClose}>
                  Fechar recuperação
                </Button>
              )}
            </div>
          </form>
        </>
      )}
    </section>
  );
}
