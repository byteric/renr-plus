import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  acceptAccessInviteSchema,
  accessInviteAcceptanceSchema,
  type SessionResponse,
} from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { Button } from '../ui/button';
import { StatusMessage } from '../ui/status-message';
import './access.css';

const readToken = () => window.location.hash.match(/^#\/?ativar\/([A-Za-z0-9_-]{43})$/)?.[1] ?? '';
function cleanTokenUrl() {
  // The bearer secret is never sent as a query/path parameter to the server.
  if (/^#\/?ativar\//.test(window.location.hash))
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}#/ativar`,
    );
}
export function AccessActivation({
  session,
  loading,
  login,
  onExpire,
  onAccepted,
}: {
  session: SessionResponse | null;
  loading: boolean;
  login: ReactNode;
  onExpire: () => void;
  onAccepted: () => Promise<void>;
}) {
  const [token, setToken] = useState(readToken);
  const [manualEntry, setManualEntry] = useState(() => !readToken());
  const [mode, setMode] = useState<'choose' | 'new' | 'existing'>('choose');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const controller = useRef(new AbortController());
  useLayoutEffect(cleanTokenUrl, []);
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    const change = () => {
      const next = readToken();
      if (!next) return;
      controller.current.abort();
      controller.current = new AbortController();
      cleanTokenUrl();
      setManualEntry(false);
      setPending(false);
      setToken(next);
      setMode('choose');
      setName('');
      setPassword('');
      setConfirmation('');
      setError('');
      setSuccess('');
      setUnavailable(false);
    };
    window.addEventListener('hashchange', change);
    return () => {
      controller.current.abort();
      window.removeEventListener('hashchange', change);
    };
  }, []);
  async function accept() {
    if (pending || unavailable) return;
    if (!session && password !== confirmation) {
      setError('As senhas precisam ser iguais.');
      return;
    }
    const input = acceptAccessInviteSchema.safeParse(
      session ? { token } : { token, name, password },
    );
    if (!input.success || (!session && (!name.trim() || password.length < 12))) {
      setError('Confira o convite, informe seu nome e uma senha de 12 a 256 caracteres.');
      return;
    }
    setPending(true);
    setError('');
    const operation = controller.current;
    try {
      await request('/access-invites/accept', accessInviteAcceptanceSchema, {
        method: 'POST',
        body: JSON.stringify(input.data),
        signal: operation.signal,
      });
      if (operation.signal.aborted) return;
      setToken('');
      setPassword('');
      setConfirmation('');
      setSuccess(
        session
          ? 'Vínculo ativado. Acesse a empresa pelo espaço de trabalho.'
          : 'Acesso ativado. Entre com sua conta para continuar.',
      );
      if (session) await onAccepted();
    } catch (failure) {
      if (operation.signal.aborted) return;
      if (
        failure instanceof RequestError &&
        (failure.status === 404 ||
          failure.status === 410 ||
          failure.code === 'INVITE_UNAVAILABLE' ||
          failure.code === 'ACCESS_INVITE_UNAVAILABLE')
      ) {
        setUnavailable(true);
        setToken('');
        setPassword('');
        setConfirmation('');
        setError(
          'Convite indisponível, expirado, revogado ou já utilizado. Solicite a reemissão ao administrador da empresa.',
        );
      } else if (failure instanceof RequestError && failure.status === 401) {
        setError(
          'Para vincular uma conta existente, entre com ela antes de aceitar. A senha existente não será alterada.',
        );
        setMode('existing');
        setPassword('');
        setConfirmation('');
        if (session) onExpire();
      } else if (failure instanceof RequestError && failure.status === 403)
        setError(
          'Este convite pertence a outra conta. Saia e entre com o e-mail que recebeu o convite.',
        );
      else if (failure instanceof RequestError && failure.status === 409)
        setError(
          'A conta ou o vínculo já existe. Se você já tem conta, entre com ela; caso contrário, solicite um novo convite ao administrador.',
        );
      else
        setError(
          failure instanceof Error ? failure.message : 'Não foi possível ativar. Tente novamente.',
        );
    } finally {
      if (!operation.signal.aborted) setPending(false);
    }
  }
  return (
    <section className="surface access-activation" aria-labelledby="activation-title">
      <p className="panel-label">CONVITE INDIVIDUAL · RENR+</p>
      <h1 id="activation-title">Ativar acesso</h1>
      <p>
        O convite libera um vínculo com a empresa. Não substitui a senha de uma conta existente.
      </p>
      {error && <StatusMessage tone="error">{error}</StatusMessage>}
      {success ? (
        <>
          <StatusMessage tone="success">{success}</StatusMessage>
          <a href="#/empresas">Ir para o espaço de trabalho</a>
        </>
      ) : loading ? (
        <StatusMessage tone="loading">Verificando sua conta…</StatusMessage>
      ) : (
        !unavailable && (
          <>
            {manualEntry && (
              <>
                <label htmlFor="activation-code">Código do convite de acesso</label>
                <input
                  id="activation-code"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={43}
                  value={token}
                  disabled={pending}
                  onChange={(event) => setToken(event.target.value.trim())}
                />
                <p className="muted">
                  Se atualizou esta página, abra novamente o link recebido ou cole o código. Ele não
                  fica salvo no navegador.
                </p>
              </>
            )}
            {session ? (
              <>
                <p>
                  Conta autenticada: <strong>{session.user.email}</strong>. Confirme apenas se este
                  é o e-mail convidado.
                </p>
                <Button disabled={pending || !token} onClick={() => void accept()}>
                  {pending ? 'Ativando…' : 'Aceitar vínculo'}
                </Button>
              </>
            ) : (
              <>
                <div className="access-actions">
                  <Button
                    variant="outline"
                    aria-pressed={mode === 'new'}
                    disabled={pending}
                    onClick={() => {
                      setMode('new');
                      setError('');
                    }}
                  >
                    Criar meu acesso
                  </Button>
                  <Button
                    variant="outline"
                    aria-pressed={mode === 'existing'}
                    disabled={pending}
                    onClick={() => {
                      setMode('existing');
                      setPassword('');
                      setConfirmation('');
                      setError('');
                    }}
                  >
                    Já tenho conta
                  </Button>
                </div>
                {mode === 'existing' && <div>{login}</div>}
                {mode === 'new' && (
                  <form
                    aria-label="Ativar nova conta"
                    noValidate
                    onSubmit={(event) => {
                      event.preventDefault();
                      void accept();
                    }}
                  >
                    <label htmlFor="activation-name">Seu nome</label>
                    <input
                      id="activation-name"
                      value={name}
                      maxLength={120}
                      autoComplete="name"
                      disabled={pending}
                      onChange={(event) => setName(event.target.value)}
                    />
                    <label htmlFor="activation-password">Nova senha</label>
                    <input
                      id="activation-password"
                      type="password"
                      minLength={12}
                      maxLength={256}
                      autoComplete="new-password"
                      value={password}
                      disabled={pending}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                    <label htmlFor="activation-confirmation">Confirmar nova senha</label>
                    <input
                      id="activation-confirmation"
                      type="password"
                      autoComplete="new-password"
                      maxLength={256}
                      value={confirmation}
                      disabled={pending}
                      onChange={(event) => setConfirmation(event.target.value)}
                    />
                    <p className="muted">
                      Use de 12 a 256 caracteres. A senha não será salva no navegador pela
                      aplicação.
                    </p>
                    <Button type="submit" disabled={pending || !token}>
                      {pending ? 'Ativando…' : 'Ativar acesso'}
                    </Button>
                  </form>
                )}
              </>
            )}
          </>
        )
      )}
      {!success && (
        <p>
          <a href="#/empresas">Voltar ao acesso</a>
        </p>
      )}
    </section>
  );
}
