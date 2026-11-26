import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  passwordRecoveryConfirmSchema,
  passwordRecoveryConfirmedSchema,
  passwordRecoveryRequestedSchema,
  passwordRecoveryRequestSchema,
  passwordRecoveryStatusSchema,
  passwordRecoveryTokenSchema,
} from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { Button } from '../ui/button';
import { StatusMessage } from '../ui/status-message';
import './access.css';

function useRecoveryRequest() {
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    return () => active.abort();
  }, []);
  return controller;
}

export function PasswordRecoveryRequest() {
  const heading = useRef<HTMLHeadingElement>(null);
  const controller = useRecoveryRequest();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [pending, setPending] = useState(false);
  useEffect(() => heading.current?.focus(), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const active = controller.current;
    if (pending || !active) return;
    const input = passwordRecoveryRequestSchema.safeParse({ email });
    if (!input.success) {
      setError('Informe um e-mail válido.');
      return;
    }
    setPending(true);
    setError('');
    setAccepted(false);
    try {
      await request('/auth/recovery/requests', passwordRecoveryRequestedSchema, {
        method: 'POST',
        credentials: 'omit',
        body: JSON.stringify(input.data),
        signal: active.signal,
      });
      if (!active.signal.aborted) setAccepted(true);
    } catch (failure) {
      if (!active.signal.aborted)
        setError(
          failure instanceof RequestError
            ? failure.message
            : 'Não foi possível continuar. Tente novamente.',
        );
    } finally {
      if (!active.signal.aborted) setPending(false);
    }
  }

  return (
    <section className="surface access-activation recovery-card" aria-labelledby="recovery-heading">
      <h1 id="recovery-heading" ref={heading} tabIndex={-1}>
        Recuperar acesso
      </h1>
      <p>Informe o e-mail que você usa para entrar no ReNR+.</p>
      <form
        noValidate
        aria-label="Orientação para recuperar acesso"
        onSubmit={(event) => void submit(event)}
      >
        <label htmlFor="recovery-email">E-mail da conta</label>
        <input
          id="recovery-email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={pending}
          maxLength={254}
          required
        />
        {error && <StatusMessage tone="error">{error}</StatusMessage>}
        <Button type="submit" disabled={pending}>
          {pending ? 'Aguarde…' : 'Continuar'}
        </Button>
      </form>
      {accepted && (
        <StatusMessage tone="success">
          Procure o responsável pelo seu acesso no canal privado já combinado. Após conferir sua
          identidade, ele poderá entregar um link para você definir a nova senha.
        </StatusMessage>
      )}
      <p className="recovery-back">
        <a href="#/">Voltar ao login</a>
      </p>
    </section>
  );
}

export function PasswordRecoveryReset({
  token,
  onUnavailable,
  onChanged,
}: {
  token: string;
  onUnavailable: () => void;
  onChanged: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const controller = useRecoveryRequest();
  const [availability, setAvailability] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const unavailable = !passwordRecoveryTokenSchema.safeParse({ token }).success;
  useEffect(() => heading.current?.focus(), [unavailable]);
  useEffect(() => {
    if (unavailable) return;
    const active = new AbortController();
    void request('/auth/recovery/status', passwordRecoveryStatusSchema, {
      method: 'POST',
      credentials: 'omit',
      body: JSON.stringify({ token }),
      signal: active.signal,
    })
      .then((result) => {
        if (active.signal.aborted) return;
        if (result.available) setAvailability('ready');
        else onUnavailable();
      })
      .catch((failure: unknown) => {
        if (active.signal.aborted) return;
        if (failure instanceof RequestError && [404, 410].includes(failure.status)) {
          onUnavailable();
          return;
        }
        setAvailability('error');
        setError(
          failure instanceof RequestError ? failure.message : 'Não foi possível verificar o link.',
        );
      });
    return () => active.abort();
  }, [token, attempt, unavailable, onUnavailable]);
  useEffect(() => {
    if (availability === 'ready') passwordInput.current?.focus();
  }, [availability]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const active = controller.current;
    if (pending || !active || unavailable || availability !== 'ready') return;
    if (password !== confirmation) {
      setError('As senhas precisam ser iguais.');
      return;
    }
    const input = passwordRecoveryConfirmSchema.safeParse({ token, password });
    if (!input.success) {
      setError('Informe uma senha de 12 a 256 caracteres.');
      return;
    }
    setPending(true);
    setError('');
    try {
      await request('/auth/recovery/confirm', passwordRecoveryConfirmedSchema, {
        method: 'POST',
        body: JSON.stringify(input.data),
        signal: active.signal,
      });
      if (!active.signal.aborted) onChanged();
    } catch (failure) {
      if (active.signal.aborted) return;
      if (failure instanceof RequestError && [404, 410].includes(failure.status)) {
        setPassword('');
        setConfirmation('');
        onUnavailable();
      } else {
        setError(
          failure instanceof RequestError ? failure.message : 'Não foi possível redefinir a senha.',
        );
      }
    } finally {
      if (!active.signal.aborted) setPending(false);
    }
  }

  return (
    <section className="surface access-activation recovery-card" aria-labelledby="reset-heading">
      <h1 id="reset-heading" ref={heading} tabIndex={-1}>
        Definir nova senha
      </h1>
      {unavailable ? (
        <StatusMessage tone="warning" role="status">
          Link de recuperação indisponível. <a href="#/recuperar-acesso">Solicitar um novo link</a>.
        </StatusMessage>
      ) : availability === 'loading' ? (
        <StatusMessage tone="loading">Verificando link…</StatusMessage>
      ) : availability === 'error' ? (
        <StatusMessage
          tone="error"
          action={
            <Button
              variant="outline"
              onClick={() => {
                setError('');
                setAvailability('loading');
                setAttempt((value) => value + 1);
              }}
            >
              Verificar link novamente
            </Button>
          }
        >
          {error}
        </StatusMessage>
      ) : (
        <form noValidate aria-label="Definir nova senha" onSubmit={(event) => void submit(event)}>
          <p id="recovery-password-rule" className="muted">
            Use de 12 a 256 caracteres. As sessões abertas serão encerradas.
          </p>
          <label htmlFor="recovery-password">Nova senha</label>
          <input
            id="recovery-password"
            type="password"
            autoComplete="new-password"
            aria-describedby="recovery-password-rule"
            ref={passwordInput}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={12}
            maxLength={256}
            disabled={pending}
            required
          />
          <label htmlFor="recovery-confirmation">Confirmar nova senha</label>
          <input
            id="recovery-confirmation"
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            maxLength={256}
            disabled={pending}
            required
          />
          {error && <StatusMessage tone="error">{error}</StatusMessage>}
          <Button type="submit" disabled={pending}>
            {pending ? 'Redefinindo…' : 'Redefinir senha'}
          </Button>
        </form>
      )}
      <p className="recovery-back">
        <a href="#/">Voltar ao login</a>
      </p>
    </section>
  );
}
