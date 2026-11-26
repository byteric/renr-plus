import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  mfaChallengeSchema,
  mfaProofSchema,
  mfaRecoverSchema,
  type MfaChallenge,
  type MfaProof,
  sessionResponseSchema,
  type SessionResponse,
} from '@renr/contracts';
import { RequestError, send } from '../../lib/api';
import { Button } from '../ui/button';
import { StatusMessage } from '../ui/status-message';
import { MfaCodeField } from './MfaCodeField';
import { postMfa, useMfaAction } from './useMfaAction';
import './access.css';
import './mfa.css';

export function MfaCard({
  title,
  className = '',
  children,
}: {
  title: string;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [title]);
  return (
    <section className={`surface access-activation mfa-card ${className}`} aria-labelledby={id}>
      <h1 id={id} ref={heading} tabIndex={-1}>
        {title}
      </h1>
      {children}
    </section>
  );
}

export function MfaLoginVerification({
  onVerified,
  onCancel,
}: {
  onVerified: (session: SessionResponse) => void;
  onCancel: (reason?: string) => void;
}) {
  const [code, setCode] = useState('');
  const [method, setMethod] = useState<MfaProof['method']>('totp');
  const { pending, error, setError, run } = useMfaAction();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = mfaProofSchema.safeParse({ method, code });
    if (!input.success) {
      setError(
        method === 'totp'
          ? 'Informe os 6 dígitos do autenticador.'
          : 'Confira o formato do código de recuperação.',
      );
      return;
    }
    void run(
      (signal) => postMfa('/auth/mfa/login', sessionResponseSchema, input.data, signal),
      onVerified,
      (failure) => {
        if (failure instanceof RequestError && failure.code === 'AUTH_MFA_CHALLENGE_UNAVAILABLE') {
          onCancel(failure.message);
        }
        setCode('');
        return failure instanceof Error ? failure.message : 'Não foi possível verificar o código.';
      },
    );
  }

  return (
    <MfaCard title="Verificação em duas etapas">
      <p>Confirme que você tem acesso ao autenticador vinculado a esta conta.</p>
      <form aria-label="Verificação em duas etapas" noValidate onSubmit={submit}>
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
        {error && <StatusMessage tone="error">{error}</StatusMessage>}
        <div className="access-actions">
          <Button type="submit" disabled={pending}>
            {pending ? 'Aguarde…' : 'Verificar código'}
          </Button>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              void run(
                (signal) => send('/auth/mfa/login', { method: 'DELETE', signal }),
                () => onCancel(),
              )
            }
          >
            Cancelar entrada
          </Button>
        </div>
      </form>
      <p className="muted mfa-support">
        Perdeu o autenticador e os códigos? Peça a recuperação à equipe da plataforma pelo canal de
        suporte já combinado.
      </p>
    </MfaCard>
  );
}

export function MfaRecovery({
  token,
  onChallenge,
}: {
  token: string;
  onChallenge: (challenge: MfaChallenge) => void;
}) {
  const id = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { pending, error, setError, run } = useMfaAction();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = mfaRecoverSchema.safeParse({ email, password, token });
    if (!input.success) {
      setError('Confira o e-mail da conta e sua senha atual.');
      return;
    }
    void run(
      (signal) => postMfa('/auth/mfa/recover', mfaChallengeSchema, input.data, signal),
      onChallenge,
      (failure) => {
        setPassword('');
        return failure instanceof RequestError && [401, 404, 410].includes(failure.status)
          ? 'Confira o e-mail e a senha. Se o link expirou ou já foi usado, solicite outro à equipe da plataforma.'
          : failure instanceof Error
            ? failure.message
            : 'Não foi possível recuperar o autenticador.';
      },
    );
  }

  return (
    <MfaCard title="Recuperar autenticador">
      {token ? (
        <>
          <p>Entre com a senha atual da sua conta para configurar um novo autenticador.</p>
          <form noValidate aria-label="Recuperar autenticador" onSubmit={submit}>
            <label htmlFor={`${id}-email`}>E-mail da conta</label>
            <input
              id={`${id}-email`}
              type="email"
              autoComplete="username"
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={pending}
              required
            />
            <label htmlFor={`${id}-password`}>Senha atual</label>
            <input
              id={`${id}-password`}
              type="password"
              autoComplete="current-password"
              maxLength={256}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={pending}
              required
            />
            {error && <StatusMessage tone="error">{error}</StatusMessage>}
            <Button type="submit" disabled={pending}>
              {pending ? 'Verificando…' : 'Continuar recuperação'}
            </Button>
          </form>
        </>
      ) : (
        <StatusMessage tone="warning" role="status">
          Link de recuperação indisponível. Solicite outro à equipe da plataforma.
        </StatusMessage>
      )}
      <p className="mfa-support">
        <a href="#/">Voltar ao login</a>
      </p>
    </MfaCard>
  );
}

export function MfaRecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  return (
    <MfaCard title="Códigos de recuperação" className="mfa-recovery-codes">
      <p>
        Guarde estes códigos em local privado e offline. Cada código funciona uma única vez e esta é
        a única vez que eles serão exibidos.
      </p>
      <ul className="mfa-code-list" aria-label="Seus códigos de recuperação">
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ul>
      <div className="access-actions">
        <Button onClick={onDone}>Já guardei os códigos</Button>
        <Button variant="outline" onClick={() => window.print()}>
          Imprimir códigos
        </Button>
      </div>
    </MfaCard>
  );
}
