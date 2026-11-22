import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  loginResultSchema,
  loginSchema,
  passwordRecoveryTokenSchema,
  sessionResponseSchema,
  type LoginResult,
  type MfaChallenge,
  type SessionResponse,
} from '@renr/contracts';
import { Button } from './components/ui/button';
import {
  getHealth,
  mfaReauthEvent,
  mfaReauthMessage,
  request,
  RequestError,
  send,
} from './lib/api';
import { Structure } from './components/Structure';
import { Participation } from './components/Participation';
import { BrandIntro } from './components/BrandIntro';
import type { MfaConfirmation } from './components/access/MfaEnrollment';
const MfaLoginVerification = lazy(() =>
  import('./components/access/MfaFlow').then((module) => ({
    default: module.MfaLoginVerification,
  })),
);
const MfaRecovery = lazy(() =>
  import('./components/access/MfaFlow').then((module) => ({ default: module.MfaRecovery })),
);
const MfaRecoveryCodes = lazy(() =>
  import('./components/access/MfaFlow').then((module) => ({ default: module.MfaRecoveryCodes })),
);
const MfaLoginEnrollment = lazy(() =>
  import('./components/access/MfaEnrollment').then((module) => ({
    default: module.MfaLoginEnrollment,
  })),
);
const AccountSecurity = lazy(() =>
  import('./components/access/MfaEnrollment').then((module) => ({
    default: module.AccountSecurity,
  })),
);
const AccessActivation = lazy(() =>
  import('./components/access/AccessActivation').then((module) => ({
    default: module.AccessActivation,
  })),
);
const AssessmentParticipation = lazy(() =>
  import('./components/assessments/AssessmentParticipation').then((module) => ({
    default: module.AssessmentParticipation,
  })),
);
const PasswordRecoveryRequest = lazy(() =>
  import('./components/access/PasswordRecovery').then((module) => ({
    default: module.PasswordRecoveryRequest,
  })),
);
const PasswordRecoveryReset = lazy(() =>
  import('./components/access/PasswordRecovery').then((module) => ({
    default: module.PasswordRecoveryReset,
  })),
);

type Theme = 'light' | 'dark';
function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem('renr-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* Preference storage is optional. */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function Connection() {
  const [status, setStatus] = useState<'loading' | 'online' | 'offline'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 10_000);
    let active = true;
    void getHealth(controller.signal)
      .then(() => {
        if (active) setStatus('online');
      })
      .catch(() => {
        if (active) setStatus('offline');
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [attempt]);
  return (
    <div className={`connection connection-${status}`}>
      <span role="status">
        {status === 'loading'
          ? 'Verificando conexão'
          : status === 'online'
            ? 'API conectada'
            : 'API indisponível'}
      </span>
      <Button
        variant="outline"
        disabled={status === 'loading'}
        onClick={() => {
          setStatus('loading');
          setAttempt(attempt + 1);
        }}
      >
        {status === 'offline' ? 'Tentar novamente' : 'Verificar conexão'}
      </Button>
    </div>
  );
}
function Login({
  onLogin,
  notice,
  compact = false,
}: {
  onLogin: (session: LoginResult) => void;
  notice: string;
  compact?: boolean;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError('Informe um e-mail válido e sua senha.');
      return;
    }
    setPending(true);
    setError('');
    try {
      onLogin(
        await request('/auth/sessions', loginResultSchema, {
          method: 'POST',
          body: JSON.stringify(parsed.data),
        }),
      );
    } catch (failure) {
      setError(
        failure instanceof RequestError && failure.status === 401
          ? 'E-mail ou senha inválidos. Confira os dados e tente novamente.'
          : failure instanceof Error
            ? failure.message
            : 'Não foi possível entrar.',
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <div className={compact ? undefined : 'login-layout'}>
      <section className="surface login-panel" aria-labelledby="login-title">
        <p className="panel-label">SEU ESPAÇO DE TRABALHO</p>
        {compact ? (
          <h2 id="login-title">Entre na sua conta</h2>
        ) : (
          <h1 id="login-title">Acesse o ReNR+</h1>
        )}
        <p className="muted">Entre com seu acesso autorizado.</p>
        {notice && (
          <p role="status" className="feedback">
            {notice}
          </p>
        )}
        <form onSubmit={(event) => void submit(event)} noValidate aria-label="Acesso">
          <label htmlFor="email">E-mail</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-describedby={error ? 'login-error' : undefined}
          />
          <label htmlFor="password">Senha</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={256}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-describedby={error ? 'login-error' : undefined}
          />
          {error && (
            <p role="alert" id="login-error" className="feedback error">
              {error}
            </p>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>
        <p className="login-footnote">
          <a href="#/recuperar-acesso">Esqueci minha senha</a>
        </p>
        <p className="login-footnote">
          Se precisar de acesso, fale com o administrador da sua organização.
        </p>
      </section>
      {!compact && <BrandIntro />}
    </div>
  );
}
type PublicPage =
  | ''
  | 'participar'
  | 'responder'
  | 'ativar'
  | 'recuperar-acesso'
  | 'redefinir-senha'
  | 'recuperar-autenticador';
const securityHash = '#/seguranca-da-conta';
function readPublicLocation(): { page: PublicPage; recoveryToken: string } {
  const [path, token, ...rest] = window.location.hash.replace(/^#\/?/, '').split('/');
  if (path === 'redefinir-senha' || path === 'recuperar-autenticador') {
    const parsed = passwordRecoveryTokenSchema.safeParse({ token });
    return { page: path, recoveryToken: !rest.length && parsed.success ? parsed.data.token : '' };
  }
  const page =
    path === 'participar' ||
    path === 'responder' ||
    path === 'ativar' ||
    path === 'recuperar-acesso'
      ? path
      : '';
  return { page, recoveryToken: '' };
}
function hideRecoveryLocation(page: PublicPage) {
  if (
    (page === 'redefinir-senha' || page === 'recuperar-autenticador') &&
    (window.location.hash !== `#/${page}` || window.location.search)
  )
    window.history.replaceState(window.history.state, '', `${window.location.pathname}#/${page}`);
}
function organizationScopeKey(session: SessionResponse) {
  if (!session.activeOrganizationId) return '';
  const scope = session.organizationScopes?.[session.activeOrganizationId];
  return scope === undefined
    ? 'company'
    : scope
        .map(({ unitId, sectorId }) => `${unitId}/${sectorId ?? ''}`)
        .sort()
        .join(',');
}
export function App() {
  const [{ page: publicRoute, recoveryToken }, setPublicLocation] = useState(readPublicLocation);
  const [securityPage, setSecurityPage] = useState(() => window.location.hash === securityHash);
  const standalonePublic = !!publicRoute && publicRoute !== 'ativar';
  const discardRecoveryToken = useCallback(() => {
    setPublicLocation((previous) =>
      previous.recoveryToken ? { ...previous, recoveryToken: '' } : previous,
    );
  }, []);
  useLayoutEffect(() => {
    hideRecoveryLocation(readPublicLocation().page);
    const change = () => {
      const next = readPublicLocation();
      hideRecoveryLocation(next.page);
      setPublicLocation(next);
      setSecurityPage(window.location.hash === securityHash);
    };
    window.addEventListener('hashchange', change);
    window.addEventListener('pagehide', discardRecoveryToken);
    return () => {
      window.removeEventListener('hashchange', change);
      window.removeEventListener('pagehide', discardRecoveryToken);
    };
  }, [discardRecoveryToken]);
  const contentRef = useRef<HTMLElement>(null);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [mfaChallenge, setMfaChallenge] = useState<MfaChallenge | null>(null);
  const [mfaConfirmation, setMfaConfirmation] = useState<MfaConfirmation | null>(null);
  const mfaInProgress = !!(mfaChallenge || mfaConfirmation);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem('renr-theme', theme);
    } catch {
      /* Preference storage is optional. */
    }
  }, [theme]);
  useEffect(() => {
    if (standalonePublic || mfaInProgress) return;
    const controller = new AbortController();
    let active = true;
    void request('/auth/session', sessionResponseSchema, { signal: controller.signal })
      .then((value) => {
        if (active) setSession(value);
      })
      .catch((error: unknown) => {
        if (active && !(error instanceof RequestError && error.status === 401))
          setNotice(
            error instanceof Error ? error.message : 'Não foi possível verificar sua sessão.',
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [attempt, publicRoute, standalonePublic, mfaInProgress]);
  const expire = useCallback(() => {
    setSession(null);
    setNotice((previous) =>
      previous === mfaReauthMessage
        ? previous
        : 'Sua sessão terminou. Entre novamente para continuar.',
    );
    window.location.hash = '/';
  }, []);
  useEffect(() => {
    function requireReauth() {
      setSession(null);
      setLoading(false);
      setNotice(mfaReauthMessage);
      window.location.hash = '/';
    }
    window.addEventListener(mfaReauthEvent, requireReauth);
    return () => window.removeEventListener(mfaReauthEvent, requireReauth);
  }, []);
  useEffect(() => {
    if (!session || publicRoute || mfaInProgress) return;
    const controller = new AbortController();
    let pending = false;
    async function refresh() {
      if (!session || pending || controller.signal.aborted) return;
      pending = true;
      try {
        const current = await request('/auth/session', sessionResponseSchema, {
          signal: controller.signal,
        });
        if (controller.signal.aborted || current.user.id !== session.user.id) return;
        if (
          current.activeOrganizationId !== session.activeOrganizationId ||
          organizationScopeKey(current) !== organizationScopeKey(session)
        ) {
          const route = window.location.hash.split(/[/?]/)[1];
          if (
            route !== 'plataforma' &&
            route !== 'consolidado' &&
            window.location.hash !== securityHash
          )
            window.location.replace('#/');
        }
        setSession((previous) =>
          previous === session && JSON.stringify(current) !== JSON.stringify(previous)
            ? current
            : previous,
        );
      } catch (error) {
        if (!controller.signal.aborted && error instanceof RequestError && error.status === 401)
          expire();
      } finally {
        pending = false;
      }
    }
    function whenVisible() {
      if (document.visibilityState === 'visible') void refresh();
    }
    const onFocus = () => void refresh();
    const timer = window.setInterval(whenVisible, 30_000);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', whenVisible);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', whenVisible);
    };
  }, [session, publicRoute, expire, mfaInProgress]);
  useEffect(() => {
    if (!session || standalonePublic || mfaInProgress) return;
    const remaining = new Date(session.expiresAt).getTime() - Date.now();
    const timer = window.setTimeout(expire, Math.max(0, Math.min(remaining, 2_147_483_647)));
    return () => window.clearTimeout(timer);
  }, [session, expire, standalonePublic, mfaInProgress]);
  function receiveLogin(value: LoginResult) {
    setNotice('');
    setLoading(false);
    if ('kind' in value) {
      setSession(null);
      setMfaChallenge(value);
      discardRecoveryToken();
    } else {
      setSession(value);
      setMfaChallenge(null);
    }
  }
  const exitMfa = useCallback((reason?: string) => {
    setMfaChallenge(null);
    setNotice(reason ?? 'Entrada cancelada. Entre novamente para continuar.');
    if (readPublicLocation().page === 'recuperar-autenticador') {
      setPublicLocation({ page: '', recoveryToken: '' });
      window.history.replaceState(window.history.state, '', `${window.location.pathname}#/`);
    }
    contentRef.current?.focus();
  }, []);
  function finishMfaEnrollment() {
    if (!mfaConfirmation) return;
    setMfaConfirmation(null);
    receiveLogin(mfaConfirmation.session);
    if (publicRoute === 'recuperar-autenticador') {
      setPublicLocation({ page: '', recoveryToken: '' });
      window.history.replaceState(window.history.state, '', `${window.location.pathname}#/`);
    }
  }
  function recoveryCompleted() {
    setSession(null);
    setLoading(false);
    setNotice('Senha redefinida. Entre com a nova senha.');
    setPublicLocation({ page: '', recoveryToken: '' });
    window.history.replaceState(window.history.state, '', `${window.location.pathname}#/`);
    contentRef.current?.focus();
  }
  async function logout() {
    if (pending) return;
    setPending(true);
    try {
      await send('/auth/session', { method: 'DELETE' });
      setSession(null);
      setNotice('Você saiu com segurança.');
      window.location.hash = '/';
    } catch (error) {
      if (error instanceof RequestError && error.status === 401) expire();
      else
        setNotice(
          error instanceof Error ? error.message : 'Não foi possível sair. Tente novamente.',
        );
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#conteudo"
        onClick={(event) => {
          event.preventDefault();
          contentRef.current?.focus({ preventScroll: true });
          contentRef.current?.scrollIntoView({ block: 'start' });
        }}
      >
        Ir para conteúdo
      </a>
      <header className="site-header">
        <a className="wordmark" href="#/" aria-label="ReNR+ início">
          <picture>
            <source
              media="(max-width: 600px)"
              srcSet={
                theme === 'dark'
                  ? '/brand/renr-plus-symbol-dark.svg'
                  : '/brand/renr-plus-symbol.svg'
              }
            />
            <img
              src={
                theme === 'dark' ? '/brand/renr-plus-logo-dark.svg' : '/brand/renr-plus-logo.svg'
              }
              width={180}
              height={57}
              alt=""
            />
          </picture>
        </a>
        <div className="header-actions">
          <Button
            variant="outline"
            aria-pressed={theme === 'dark'}
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          >
            {theme === 'light' ? 'Modo escuro' : 'Modo claro'}
          </Button>
          {session && !standalonePublic && !mfaInProgress && (
            <>
              <a
                className="account-security-link"
                href={securityHash}
                aria-current={securityPage ? 'page' : undefined}
              >
                Segurança da conta
              </a>
              <Button variant="outline" disabled={pending} onClick={() => void logout()}>
                {pending ? 'Saindo…' : 'Sair'}
              </Button>
            </>
          )}
        </div>
      </header>
      <main id="conteudo" ref={contentRef} tabIndex={-1}>
        {mfaConfirmation ? (
          <Suspense fallback={<p role="status">Carregando códigos de recuperação…</p>}>
            <MfaRecoveryCodes codes={mfaConfirmation.recoveryCodes} onDone={finishMfaEnrollment} />
          </Suspense>
        ) : mfaChallenge ? (
          <Suspense fallback={<p role="status">Carregando verificação…</p>}>
            {mfaChallenge.mode === 'verify' ? (
              <MfaLoginVerification onVerified={receiveLogin} onCancel={exitMfa} />
            ) : (
              <MfaLoginEnrollment onConfirmed={setMfaConfirmation} onCancel={exitMfa} />
            )}
          </Suspense>
        ) : publicRoute === 'recuperar-autenticador' ? (
          <Suspense fallback={<p role="status">Carregando recuperação…</p>}>
            <MfaRecovery key={recoveryToken} token={recoveryToken} onChallenge={receiveLogin} />
          </Suspense>
        ) : publicRoute === 'recuperar-acesso' ? (
          <Suspense fallback={<p role="status">Carregando recuperação…</p>}>
            <PasswordRecoveryRequest />
          </Suspense>
        ) : publicRoute === 'redefinir-senha' ? (
          <Suspense fallback={<p role="status">Carregando recuperação…</p>}>
            <PasswordRecoveryReset
              key={recoveryToken}
              token={recoveryToken}
              onUnavailable={discardRecoveryToken}
              onChanged={recoveryCompleted}
            />
          </Suspense>
        ) : publicRoute === 'ativar' ? (
          <Suspense fallback={<p role="status">Carregando ativação…</p>}>
            <AccessActivation
              session={session}
              loading={loading}
              login={<Login compact notice={notice} onLogin={receiveLogin} />}
              onExpire={expire}
              onAccepted={async () => {
                setSession(await request('/auth/session', sessionResponseSchema));
              }}
            />
          </Suspense>
        ) : publicRoute === 'responder' ? (
          <Suspense fallback={<p role="status">Carregando coleta…</p>}>
            <AssessmentParticipation />
          </Suspense>
        ) : publicRoute === 'participar' ? (
          <Participation />
        ) : loading ? (
          <p role="status" className="surface">
            Verificando seu acesso…
          </p>
        ) : session ? (
          <>
            {notice && (
              <p role="alert" className="feedback">
                {notice}
              </p>
            )}
            {securityPage ? (
              <Suspense fallback={<p role="status">Carregando segurança da conta…</p>}>
                <AccountSecurity onConfirmed={setMfaConfirmation} onExpire={expire} />
              </Suspense>
            ) : (
              <Structure
                key={`${session.user.id}-${session.activeOrganizationId}-${organizationScopeKey(session)}`}
                session={session}
                onSession={setSession}
                onExpire={expire}
              />
            )}
          </>
        ) : (
          <>
            <Login notice={notice} onLogin={receiveLogin} />
            {notice && (
              <Button
                variant="outline"
                onClick={() => {
                  setLoading(true);
                  setNotice('');
                  setAttempt(attempt + 1);
                }}
              >
                Verificar meu acesso novamente
              </Button>
            )}
          </>
        )}
      </main>
      <footer className="site-footer">
        <span>ReNR+ / ReTech+ · Porto Digital</span>
        <Connection />
      </footer>
    </div>
  );
}
