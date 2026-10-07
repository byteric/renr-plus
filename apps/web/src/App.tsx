import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { loginSchema, sessionResponseSchema, type SessionResponse } from '@renr/contracts';
import { Button } from './components/ui/button';
import { getHealth, request, RequestError, send } from './lib/api';
import { Structure } from './components/Structure';

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
}: {
  onLogin: (session: SessionResponse) => void;
  notice: string;
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
        await request('/auth/sessions', sessionResponseSchema, {
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
    <div className="login-layout">
      <section className="login-intro">
        <p className="eyebrow">GESTÃO PREVENTIVA · NR-01</p>
        <h1>
          O cuidado começa com uma estrutura clara<span className="title-dot">.</span>
        </h1>
        <p>
          Organize suas empresas, unidades e setores em um só lugar. Uma base para acompanhar o
          trabalho e construir a prevenção.
        </p>
        <div className="intro-note">
          ReTech+ / Porto Digital<span>ReNR+ · Gestão organizacional</span>
        </div>
      </section>
      <section className="surface login-panel" aria-labelledby="login-title">
        <p className="panel-label">SEU ESPAÇO DE TRABALHO</p>
        <h2 id="login-title">Acesse o ReNR+</h2>
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
          Se precisar de acesso, fale com o administrador da sua organização.
        </p>
      </section>
    </div>
  );
}
export function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [session, setSession] = useState<SessionResponse | null>(null);
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
  }, [attempt]);
  const expire = useCallback(() => {
    setSession(null);
    setNotice('Sua sessão terminou. Entre novamente para continuar.');
    window.location.hash = '/empresas';
  }, []);
  useEffect(() => {
    if (!session) return;
    const remaining = new Date(session.expiresAt).getTime() - Date.now();
    const timer = window.setTimeout(expire, Math.max(0, Math.min(remaining, 2_147_483_647)));
    return () => window.clearTimeout(timer);
  }, [session, expire]);
  async function logout() {
    if (pending) return;
    setPending(true);
    try {
      await send('/auth/session', { method: 'DELETE' });
      setSession(null);
      setNotice('Você saiu com segurança.');
      window.location.hash = '/empresas';
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
      <a className="skip-link" href="#conteudo">
        Ir para conteúdo
      </a>
      <header className="site-header">
        <a className="wordmark" href="#/empresas" aria-label="ReNR+ início">
          ReNR<span>+</span>
        </a>
        <div className="header-actions">
          <Button
            variant="outline"
            aria-pressed={theme === 'dark'}
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          >
            {theme === 'light' ? 'Modo escuro' : 'Modo claro'}
          </Button>
          {session && (
            <Button variant="outline" disabled={pending} onClick={() => void logout()}>
              {pending ? 'Saindo…' : 'Sair'}
            </Button>
          )}
        </div>
      </header>
      <main id="conteudo" tabIndex={-1}>
        {loading ? (
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
            <Structure
              key={session.user.id}
              session={session}
              onSession={setSession}
              onExpire={expire}
            />
          </>
        ) : (
          <>
            <Login
              notice={notice}
              onLogin={(value) => {
                setNotice('');
                setSession(value);
              }}
            />
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
