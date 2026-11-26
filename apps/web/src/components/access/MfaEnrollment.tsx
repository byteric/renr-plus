import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  mfaEnrollmentConfirmedSchema,
  mfaEnrollmentConfirmSchema,
  mfaEnrollmentRequestSchema,
  mfaEnrollmentSchema,
  mfaProofSchema,
  mfaStatusSchema,
  type MfaProof,
} from '@renr/contracts';
import { request, RequestError, send } from '../../lib/api';
import { Button } from '../ui/button';
import { StatusMessage } from '../ui/status-message';
import { MfaCard } from './MfaFlow';
import { MfaCodeField } from './MfaCodeField';
import { postMfa, useMfaAction } from './useMfaAction';

export type MfaConfirmation = ReturnType<typeof mfaEnrollmentConfirmedSchema.parse>;
type Enrollment = ReturnType<typeof mfaEnrollmentSchema.parse>;

function MfaEnrollmentForm({
  kind,
  seed,
  onConfirmed,
  onCancel,
  onUnavailable,
  onExpire,
}: {
  kind: 'login' | 'account';
  seed: Enrollment;
  onConfirmed: (value: MfaConfirmation) => void;
  onCancel: () => void;
  onUnavailable: (notice: string) => void;
  onExpire?: () => void;
}) {
  const id = useId();
  const [code, setCode] = useState('');
  const [expired, setExpired] = useState(() => Date.parse(seed.expiresAt) <= Date.now());
  const { pending, error, setError, run } = useMfaAction();
  const isLogin = kind === 'login';

  useEffect(() => {
    const timer = window.setTimeout(
      () => {
        setExpired(true);
        setCode('');
      },
      Math.max(0, Math.min(Date.parse(seed.expiresAt) - Date.now(), 2_147_483_647)),
    );
    return () => window.clearTimeout(timer);
  }, [seed.expiresAt]);

  function handleFailure(failure: unknown) {
    if (failure instanceof RequestError) {
      if (failure.code === 'AUTH_MFA_CHALLENGE_UNAVAILABLE') onUnavailable(failure.message);
      else if (failure.code === 'AUTH_MFA_CODE_INVALID')
        return 'Código do novo autenticador inválido ou já utilizado. Confira o aplicativo.';
      else if (!isLogin && failure.status === 401 && failure.code === 'UNAUTHORIZED') onExpire?.();
    }
    return failure instanceof Error ? failure.message : 'Não foi possível concluir a configuração.';
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (expired) return;
    const input = mfaEnrollmentConfirmSchema.safeParse({ kind, code });
    if (!input.success) {
      setError('Informe os 6 dígitos do autenticador.');
      return;
    }
    void run(
      (signal) =>
        postMfa('/auth/mfa/enrollment/confirm', mfaEnrollmentConfirmedSchema, input.data, signal),
      onConfirmed,
      (failure) => {
        setCode('');
        return handleFailure(failure);
      },
    );
  }

  function cancel() {
    void run(
      (signal) =>
        isLogin
          ? send('/auth/mfa/login', { method: 'DELETE', signal })
          : send('/auth/mfa/enrollment/cancel', {
              method: 'POST',
              body: JSON.stringify({ kind }),
              signal,
            }),
      onCancel,
      handleFailure,
    );
  }

  return (
    <MfaCard title="Configurar autenticador">
      <form noValidate aria-label="Configurar autenticador" onSubmit={submit}>
        {expired ? (
          <StatusMessage tone="warning" role="status">
            A configuração expirou.{' '}
            {isLogin
              ? 'Entre novamente para recomeçar.'
              : 'Volte à segurança da conta e inicie outra configuração.'}
          </StatusMessage>
        ) : (
          <>
            <p>
              Escaneie o QR code no seu aplicativo autenticador. Se estiver usando o mesmo
              dispositivo, cadastre a chave manual no aplicativo.
            </p>
            <div className="mfa-setup">
              <img
                className="mfa-qr"
                src={seed.qrCodeDataUrl}
                width={164}
                height={164}
                alt="QR code para configurar o autenticador"
              />
              <div className="mfa-manual">
                <label htmlFor={`${id}-key`}>Chave manual</label>
                <textarea
                  id={`${id}-key`}
                  className="mfa-key"
                  value={seed.manualKey}
                  readOnly
                  rows={2}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </div>
            <MfaCodeField code={code} method="totp" onChange={setCode} disabled={pending} />
          </>
        )}
        {error && <StatusMessage tone="error">{error}</StatusMessage>}
        <div className="access-actions">
          {!expired && (
            <Button type="submit" disabled={pending}>
              {pending ? 'Aguarde…' : 'Confirmar autenticador'}
            </Button>
          )}
          <Button variant="outline" onClick={cancel} disabled={pending}>
            {isLogin ? 'Cancelar entrada' : 'Cancelar configuração'}
          </Button>
        </div>
      </form>
    </MfaCard>
  );
}

export function MfaLoginEnrollment({
  onConfirmed,
  onCancel,
}: {
  onConfirmed: (value: MfaConfirmation) => void;
  onCancel: (notice?: string) => void;
}) {
  const [seed, setSeed] = useState<Enrollment | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const cancel = useMfaAction();

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      void postMfa(
        '/auth/mfa/enrollment',
        mfaEnrollmentSchema,
        { kind: 'login' },
        controller.signal,
      )
        .then((value) => {
          if (!controller.signal.aborted) setSeed(value);
        })
        .catch((failure: unknown) => {
          if (controller.signal.aborted) return;
          if (failure instanceof RequestError && failure.code === 'AUTH_MFA_CHALLENGE_UNAVAILABLE')
            onCancel(failure.message);
          else
            setError(
              failure instanceof Error
                ? failure.message
                : 'Não foi possível iniciar a configuração.',
            );
        });
    });
    return () => controller.abort();
  }, [revision, onCancel]);

  if (seed && !cancel.pending)
    return (
      <MfaEnrollmentForm
        kind="login"
        seed={seed}
        onConfirmed={onConfirmed}
        onCancel={onCancel}
        onUnavailable={onCancel}
      />
    );

  return (
    <MfaCard title="Configurar autenticador">
      {cancel.pending ? (
        <StatusMessage tone="loading">Cancelando entrada…</StatusMessage>
      ) : error ? (
        <StatusMessage tone="error">{error}</StatusMessage>
      ) : (
        <StatusMessage tone="loading">Preparando a configuração…</StatusMessage>
      )}
      {cancel.error && <StatusMessage tone="error">{cancel.error}</StatusMessage>}
      <div className="access-actions">
        {error && (
          <Button
            onClick={() => {
              setError('');
              setRevision((value) => value + 1);
            }}
            disabled={cancel.pending}
          >
            Tentar novamente
          </Button>
        )}
        <Button
          variant="outline"
          disabled={cancel.pending}
          onClick={() =>
            void cancel.run(
              (signal) => send('/auth/mfa/login', { method: 'DELETE', signal }),
              () => onCancel(),
            )
          }
        >
          Cancelar entrada
        </Button>
      </div>
    </MfaCard>
  );
}

export function AccountSecurity({
  onConfirmed,
  onExpire,
}: {
  onConfirmed: (value: MfaConfirmation) => void;
  onExpire: () => void;
}) {
  const id = useId();
  const passwordField = useRef<HTMLInputElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  const wasAuthorizing = useRef(false);
  const [status, setStatus] = useState<ReturnType<typeof mfaStatusSchema.parse> | null>(null);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [authorizing, setAuthorizing] = useState(false);
  const [password, setPassword] = useState('');
  const [method, setMethod] = useState<MfaProof['method']>('totp');
  const [code, setCode] = useState('');
  const [seed, setSeed] = useState<Enrollment | null>(null);
  const { pending, error, setError, run } = useMfaAction();

  useEffect(() => {
    if (authorizing) passwordField.current?.focus();
    else if (wasAuthorizing.current) action.current?.focus();
    wasAuthorizing.current = authorizing;
  }, [authorizing]);

  useEffect(() => {
    const controller = new AbortController();
    void request('/auth/mfa', mfaStatusSchema, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setStatus(value);
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        if (failure instanceof RequestError && failure.status === 401) onExpire();
        else
          setLoadError(
            failure instanceof Error
              ? failure.message
              : 'Não foi possível consultar a segurança da conta.',
          );
      });
    return () => controller.abort();
  }, [onExpire, revision]);

  function clearCredentials() {
    setPassword('');
    setCode('');
    setMethod('totp');
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!status?.available) return;
    const factor = mfaProofSchema.safeParse({ method, code });
    if (status.enabled && !factor.success) {
      setError('Informe o código do autenticador atual ou use um código de recuperação.');
      return;
    }
    const input = mfaEnrollmentRequestSchema.safeParse({
      kind: 'account',
      password,
      ...(status.enabled && factor.success ? { factor: factor.data } : {}),
    });
    if (!input.success) {
      setError('Informe a sua senha atual.');
      return;
    }
    void run(
      (signal) => postMfa('/auth/mfa/enrollment', mfaEnrollmentSchema, input.data, signal),
      (value) => {
        clearCredentials();
        setAuthorizing(false);
        setSeed(value);
      },
      (failure) => {
        setCode('');
        return failure instanceof RequestError &&
          failure.status === 401 &&
          failure.code === 'UNAUTHORIZED'
          ? 'Senha atual inválida. Confira e tente novamente.'
          : failure instanceof Error
            ? failure.message
            : 'Não foi possível iniciar a configuração.';
      },
    );
  }

  if (seed)
    return (
      <MfaEnrollmentForm
        kind="account"
        seed={seed}
        onConfirmed={onConfirmed}
        onCancel={() => setSeed(null)}
        onUnavailable={() => {
          setSeed(null);
          setNotice('A configuração não está mais disponível. Inicie outra configuração.');
        }}
        onExpire={onExpire}
      />
    );

  return (
    <MfaCard title="Segurança da conta">
      <h2>Autenticador</h2>
      {loadError ? (
        <StatusMessage
          tone="error"
          action={
            <Button
              variant="outline"
              onClick={() => {
                setLoadError('');
                setRevision((value) => value + 1);
              }}
            >
              Tentar novamente
            </Button>
          }
        >
          {loadError}
        </StatusMessage>
      ) : !status ? (
        <StatusMessage tone="loading">Consultando a configuração…</StatusMessage>
      ) : (
        <>
          {notice && (
            <StatusMessage tone="warning" role="status">
              {notice}
            </StatusMessage>
          )}
          <p role="status">
            {status.enabled ? 'Autenticador ativo.' : 'Autenticador ainda não configurado.'}
          </p>
          {status.required && <p>O segundo fator é obrigatório para esta conta.</p>}
          {!status.available ? (
            <StatusMessage>
              O serviço de configuração do autenticador está indisponível neste ambiente.
            </StatusMessage>
          ) : authorizing ? (
            <form noValidate aria-label="Confirmar sua identidade" onSubmit={submit}>
              <label htmlFor={`${id}-password`}>Senha atual</label>
              <input
                id={`${id}-password`}
                ref={passwordField}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                maxLength={256}
                disabled={pending}
                required
              />
              {status.enabled && (
                <MfaCodeField
                  code={code}
                  method={method}
                  onChange={setCode}
                  onSwitch={() => {
                    setCode('');
                    setError('');
                    setMethod(method === 'totp' ? 'recovery' : 'totp');
                  }}
                  disabled={pending}
                />
              )}
              {error && <StatusMessage tone="error">{error}</StatusMessage>}
              <div className="access-actions">
                <Button type="submit" disabled={pending}>
                  {pending ? 'Verificando…' : 'Continuar'}
                </Button>
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    clearCredentials();
                    setError('');
                    setAuthorizing(false);
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          ) : (
            <>
              <p className="muted">
                {status.enabled
                  ? 'Para trocar o autenticador, use a senha atual e um código do aplicativo ou um código de recuperação.'
                  : 'Use um aplicativo para gerar um código de verificação ao entrar.'}
              </p>
              <Button
                ref={action}
                onClick={() => {
                  setNotice('');
                  setAuthorizing(true);
                }}
              >
                {status.enabled ? 'Trocar autenticador' : 'Ativar autenticador'}
              </Button>
            </>
          )}
        </>
      )}
      <p className="mfa-support">
        <a href="#/">Voltar ao espaço de trabalho</a>
      </p>
    </MfaCard>
  );
}
