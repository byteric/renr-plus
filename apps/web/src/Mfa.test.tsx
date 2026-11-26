import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

const organizationId = '10000000-0000-4000-8000-000000000001';
const session = {
  user: {
    id: '10000000-0000-4000-8000-000000000002',
    name: 'Pessoa administradora',
    email: 'admin@example.test',
  },
  memberships: [{ organizationId, organizationName: 'Empresa fictícia', role: 'ADMIN' }],
  activeOrganizationId: organizationId,
  expiresAt: '2099-10-04T12:00:00.000Z',
};
const token = 'a'.repeat(43);
const password = 'Uma senha fictícia 321';
const recoveryCode = 'ABCD-EFGH-JKLM-NPQR';
const recoveryCodes = [
  recoveryCode,
  'BCDE-FGHJ-KLMN-PQRS',
  'CDEF-GHJK-LMNP-QRST',
  'DEFG-HJKL-MNPQ-RSTU',
  'EFGH-JKLM-NPQR-STUV',
  'FGHJ-KLMN-PQRS-TUVW',
  'GHJK-LMNP-QRST-UVWX',
  'HJKL-MNPQ-RSTU-VWXY',
];
const enrollment = {
  manualKey: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  qrCodeDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  expiresAt: session.expiresAt,
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const noContent = () => new Response(null, { status: 204 });
const failure = (code: string, statusCode: number) =>
  json(
    {
      statusCode,
      code,
      message: 'Mensagem do servidor',
      requestId: '10000000-0000-4000-8000-000000000000',
      timestamp: '2026-11-25T12:00:00.000Z',
    },
    statusCode,
  );
let signedIn: boolean;
let enabled: boolean;
let mode: 'verify' | 'enroll';
let capabilities: string[];
let reauth: boolean;
let platformScope: boolean;
const calls: { path: string; method: string; body: unknown; hash: string; credentials?: string }[] =
  [];

beforeEach(() => {
  signedIn = false;
  enabled = false;
  mode = 'verify';
  capabilities = [];
  reauth = false;
  platformScope = false;
  calls.length = 0;
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState(null, '', '#/');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | RequestInfo, options?: RequestInit) => {
      const path = String(input).replace('/api/v1', '').split('?')[0] ?? '';
      const method = options?.method ?? 'GET';
      const body = options?.body ? JSON.parse(String(options.body)) : null;
      calls.push({
        path,
        method,
        body,
        hash: window.location.hash,
        credentials: options?.credentials,
      });
      if (path === '/auth/session') {
        if (reauth) return failure('AUTH_MFA_REAUTH_REQUIRED', 401);
        return signedIn
          ? json(
              platformScope ? { ...session, memberships: [], activeOrganizationId: null } : session,
            )
          : json({}, 401);
      }
      if (path === '/auth/sessions') return json({ kind: 'mfa-required', mode }, 201);
      if (path === '/auth/session-capabilities')
        return json({
          organizationId: platformScope ? null : organizationId,
          capabilities: [],
          canManageAccess: !platformScope,
        });
      if (path === '/platform/capabilities') return json({ capabilities });
      if (path === '/organizations') return json({ items: [], total: 0, page: 1, pageSize: 50 });
      if (path === '/auth/mfa/login' && method === 'DELETE') return noContent();
      if (path === '/auth/mfa/login') {
        if (body.code !== recoveryCode) return failure('AUTH_MFA_CODE_INVALID', 401);
        signedIn = true;
        return json(session);
      }
      if (path === '/auth/mfa') return json({ available: true, enabled, required: false });
      if (path === '/auth/mfa/enrollment') return json(enrollment);
      if (path === '/auth/mfa/enrollment/cancel') return noContent();
      if (path === '/auth/mfa/enrollment/confirm') {
        signedIn = true;
        enabled = true;
        return json({ session, recoveryCodes });
      }
      if (path === '/platform/mfa-recoveries') return json({ token, expiresAt: session.expiresAt });
      if (path === '/auth/mfa/recover') return json({ kind: 'mfa-required', mode: 'enroll' });
      return json({}, 404);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function signIn() {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('E-mail', { exact: true }), session.user.email);
  await user.type(screen.getByLabelText('Senha', { exact: true }), password);
  await user.click(screen.getByRole('button', { name: 'Entrar' }));
  return user;
}

describe('Segundo fator de autenticação', () => {
  it('retém a sessão privada após a senha, aceita recuperação e permite cancelar o desafio', async () => {
    render(<App />);
    const user = await signIn();
    expect(
      await screen.findByRole('heading', { name: 'Verificação em duas etapas' }),
    ).toBeVisible();
    expect(calls.some(({ path }) => path === '/organizations')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Cancelar entrada' }));
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeVisible();
    expect(calls).toContainEqual(
      expect.objectContaining({ path: '/auth/mfa/login', method: 'DELETE' }),
    );
    await user.type(screen.getByLabelText('E-mail', { exact: true }), session.user.email);
    await user.type(screen.getByLabelText('Senha', { exact: true }), password);
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    const code = await screen.findByLabelText('Código do autenticador');
    await user.type(code, '123456{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(/código.*inválido/i);
    expect(calls.some(({ path }) => path === '/organizations')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Usar código de recuperação' }));
    const recoveryInput = screen.getByLabelText('Código de recuperação');
    expect(recoveryInput).toHaveFocus();
    await user.type(recoveryInput, recoveryCode.toLowerCase());
    await user.click(screen.getByRole('button', { name: 'Verificar código' }));
    expect(await screen.findByRole('heading', { name: 'Empresas' })).toBeVisible();
    expect(calls).toContainEqual(
      expect.objectContaining({
        path: '/auth/mfa/login',
        method: 'POST',
        body: { method: 'recovery', code: recoveryCode },
        credentials: 'include',
      }),
    );
  });

  it('mostra os segredos apenas durante a configuração e só abre a área privada ao guardar os códigos', async () => {
    mode = 'enroll';
    window.history.replaceState(null, '', '#/empresas');
    render(<App />, { reactStrictMode: true });
    const user = await signIn();
    expect(
      await screen.findByRole('img', { name: 'QR code para configurar o autenticador' }),
    ).toHaveAttribute('src', enrollment.qrCodeDataUrl);
    expect(screen.getByLabelText('Chave manual')).toHaveValue(enrollment.manualKey);
    expect(calls.filter(({ path }) => path === '/auth/mfa/enrollment')).toHaveLength(1);
    await user.type(screen.getByLabelText('Código do autenticador'), '654321');
    await user.click(screen.getByRole('button', { name: 'Confirmar autenticador' }));
    expect(await screen.findByRole('heading', { name: 'Códigos de recuperação' })).toHaveFocus();
    expect(screen.getByText(recoveryCode)).toBeVisible();
    expect(calls.some(({ path }) => path === '/organizations')).toBe(false);
    expect(screen.queryByLabelText('Chave manual')).not.toBeInTheDocument();
    expect(Object.values(localStorage)).not.toContain(recoveryCode);
    expect(Object.values(sessionStorage)).not.toContain(recoveryCode);
    await user.click(screen.getByRole('button', { name: 'Já guardei os códigos' }));
    expect(await screen.findByRole('heading', { name: 'Empresas' })).toBeVisible();
    expect(screen.queryByText(recoveryCode)).not.toBeInTheDocument();
  });

  it('exige senha e o fator anterior ao trocar o autenticador, depois mostra o estado atualizado', async () => {
    signedIn = true;
    enabled = true;
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: 'Segurança da conta' }));
    await user.click(await screen.findByRole('button', { name: 'Trocar autenticador' }));
    await user.type(screen.getByLabelText('Senha atual'), password);
    await user.click(screen.getByRole('button', { name: 'Usar código de recuperação' }));
    await user.type(screen.getByLabelText('Código de recuperação'), recoveryCode);
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByLabelText('Chave manual')).toHaveValue(enrollment.manualKey);
    expect(calls).toContainEqual(
      expect.objectContaining({
        path: '/auth/mfa/enrollment',
        body: { kind: 'account', password, factor: { method: 'recovery', code: recoveryCode } },
      }),
    );
    await user.type(screen.getByLabelText('Código do autenticador'), '654321');
    await user.click(screen.getByRole('button', { name: 'Confirmar autenticador' }));
    expect(await screen.findByText(recoveryCode)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Já guardei os códigos' }));
    expect(await screen.findByRole('heading', { name: 'Segurança da conta' })).toBeVisible();
    expect(await screen.findByRole('button', { name: 'Trocar autenticador' })).toBeVisible();
    expect(screen.queryByLabelText('Chave manual')).not.toBeInTheDocument();
  });

  it('remove o token da URL antes de enviar as credenciais e abre somente a configuração', async () => {
    signedIn = true;
    window.history.replaceState(null, '', '#/empresas');
    render(<App />);
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: 'Empresas' })).toBeVisible();
    await waitFor(() => expect(calls.some(({ path }) => path === '/organizations')).toBe(true));
    const previousPrivateRequests = calls.filter(({ path }) => path === '/organizations').length;
    await act(async () => {
      window.history.replaceState(null, '', `?extra=1#/recuperar-autenticador/${token}`);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    const heading = await screen.findByRole('heading', { name: 'Recuperar autenticador' });
    expect(heading).toHaveFocus();
    expect(window.location.hash).toBe('#/recuperar-autenticador');
    expect(window.location.search).toBe('');
    expect(document.body.textContent).not.toContain(token);
    await user.type(screen.getByLabelText('E-mail da conta'), session.user.email);
    await user.type(screen.getByLabelText('Senha atual'), password);
    await user.click(screen.getByRole('button', { name: 'Continuar recuperação' }));
    expect(await screen.findByLabelText('Chave manual')).toHaveValue(enrollment.manualKey);
    expect(screen.queryByRole('heading', { name: 'Empresas' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sair' })).not.toBeInTheDocument();
    expect(calls).toContainEqual(
      expect.objectContaining({
        path: '/auth/mfa/recover',
        body: { email: session.user.email, password, token },
        hash: '#/recuperar-autenticador',
      }),
    );
    expect(calls.filter(({ path }) => path === '/organizations')).toHaveLength(
      previousPrivateRequests,
    );
  });

  it('emite recuperação do autenticador somente com concessão global própria', async () => {
    signedIn = true;
    capabilities = ['MANAGE_PASSWORD_RECOVERY'];
    window.history.replaceState(null, '', '#/plataforma/recuperacao');
    const passwordOperator = render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Emitir recuperação assistida' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: 'Emitir recuperação do autenticador' }),
    ).not.toBeInTheDocument();
    passwordOperator.unmount();
    capabilities = ['RECOVER_ACCOUNT_MFA'];
    const companySession = render(<App />);
    expect(await screen.findByText(/conta de operação global/i)).toBeVisible();
    expect(
      screen.queryByRole('form', { name: 'Emitir recuperação do autenticador' }),
    ).not.toBeInTheDocument();
    companySession.unmount();
    platformScope = true;
    render(<App />);
    const user = userEvent.setup();
    const issue = await screen.findByRole('form', { name: 'Emitir recuperação do autenticador' });
    await user.type(within(issue).getByLabelText('E-mail da conta'), 'titular@example.test');
    await user.type(within(issue).getByLabelText('Referência da conferência'), 'PROTOCOLO-53');
    await user.click(within(issue).getByRole('checkbox'));
    await user.click(
      within(issue).getByRole('button', { name: 'Emitir link para o autenticador' }),
    );
    expect(await screen.findByLabelText('Link de recuperação do autenticador')).toHaveValue(
      `${window.location.origin}/#/recuperar-autenticador/${token}`,
    );
    expect(calls).toContainEqual(
      expect.objectContaining({
        path: '/platform/mfa-recoveries',
        body: {
          email: 'titular@example.test',
          verificationConfirmed: true,
          verificationReference: 'PROTOCOLO-53',
        },
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Ocultar link' }));
    await waitFor(() =>
      expect(
        screen.queryByLabelText('Link de recuperação do autenticador'),
      ).not.toBeInTheDocument(),
    );
  });

  it('explica a nova verificação quando uma sessão existente perde acesso', async () => {
    signedIn = true;
    reauth = true;
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeVisible();
    expect(screen.getByText(/entre novamente.*segundo fator/i)).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Segurança da conta' })).not.toBeInTheDocument();
  });
});
