import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

const token = 'a'.repeat(43);
const organizationId = '10000000-0000-4000-8000-000000000001';
const organization = { organizationId, organizationName: 'Empresa fictícia', role: 'ADMIN' };
const actor = {
  id: '10000000-0000-4000-8000-000000000002',
  name: 'Responsável',
  email: 'admin@example.test',
};
const password = 'Uma senha fictícia 321';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let signedIn = false;
let company = false;
let granted: string[] = [];
let allowed = true;
let denied = 0;
const requests: Array<{ path: string; body: unknown; hash: string; method: string | undefined }> =
  [];

beforeEach(() => {
  signedIn = false;
  company = false;
  granted = [];
  allowed = true;
  denied = 0;
  requests.length = 0;
  window.history.replaceState(null, '', '#/');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | RequestInfo, options?: RequestInit) => {
      const path = String(input).replace('/api/v1', '').split('?')[0];
      requests.push({
        path: path ?? '',
        body: options?.body ? JSON.parse(String(options.body)) : null,
        hash: window.location.hash,
        method: options?.method,
      });
      if (path === '/auth/session')
        return signedIn
          ? json({
              user: actor,
              memberships: company ? [organization] : [],
              activeOrganizationId: company ? organizationId : null,
              expiresAt: '2099-10-04T12:00:00.000Z',
            })
          : json({}, 401);
      if (path === '/auth/session-capabilities')
        return json({
          organizationId: company ? organizationId : null,
          capabilities: [],
          canManageAccess: company,
        });
      if (path === '/platform/capabilities') return json({ capabilities: granted });
      if (path?.endsWith('/access-memberships'))
        return json({ items: [], total: 0, page: 1, pageSize: 50 });
      if (path === '/auth/recovery/requests') return json({ accepted: true }, 202);
      if (path === '/auth/recovery/status') return json({ available: allowed });
      if (path === '/auth/recovery/confirm') {
        if (denied) return json({}, denied);
        signedIn = false;
        return json({ changed: true });
      }
      if (path?.endsWith('/password-recoveries'))
        return denied
          ? json({}, denied)
          : json({ token, expiresAt: '2099-10-04T12:00:00.000Z' }, 201);
      return json({}, 404);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Recuperação assistida de senha', () => {
  it('orienta igualmente quem tem uma conta e quem informa um e-mail desconhecido', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('link', { name: 'Esqueci minha senha' }));
    const email = await screen.findByRole('textbox', { name: 'E-mail da conta' });
    const explanation = 'Procure o responsável pelo seu acesso no canal privado já combinado.';
    for (const address of [actor.email, 'desconhecido@example.test']) {
      await user.clear(email);
      await user.type(email, address);
      await user.click(screen.getByRole('button', { name: 'Continuar' }));
      expect(await screen.findByText(new RegExp(explanation))).toBeVisible();
    }
    expect(
      requests.filter((call) => call.path === '/auth/recovery/requests').map((call) => call.body),
    ).toEqual([{ email: actor.email }, { email: 'desconhecido@example.test' }]);
  });

  it('remove o segredo do fragmento antes da consulta, valida a confirmação e retorna ao login', async () => {
    signedIn = true;
    window.history.replaceState(null, '', `#/redefinir-senha/${token}`);
    const user = userEvent.setup();
    render(<App />);
    const first = await screen.findByLabelText('Nova senha', { exact: true });
    const second = screen.getByLabelText('Confirmar nova senha', { exact: true });
    expect(requests.find((call) => call.path === '/auth/recovery/status')).toMatchObject({
      body: { token },
      hash: '#/redefinir-senha',
      method: 'POST',
    });
    expect(window.location.href).not.toContain(token);
    expect(document.body.textContent).not.toContain(token);
    await user.type(first, password);
    await user.type(second, 'senhas são diferentes');
    await user.click(screen.getByRole('button', { name: 'Redefinir senha' }));
    expect(screen.getByRole('alert')).toHaveTextContent('As senhas precisam ser iguais.');
    expect(requests.some((call) => call.path === '/auth/recovery/confirm')).toBe(false);
    await user.clear(second);
    await user.type(second, password);
    await user.click(screen.getByRole('button', { name: 'Redefinir senha' }));
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeVisible();
    expect(screen.getByText('Senha redefinida. Entre com a nova senha.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Sair' })).not.toBeInTheDocument();
    expect(Object.values(sessionStorage)).not.toContain(token);
    expect(Object.values(localStorage)).not.toContain(token);
  });

  it('mostra uma orientação genérica quando a recuperação está indisponível', async () => {
    allowed = false;
    window.history.replaceState(null, '', `#/redefinir-senha/${token}`);
    render(<App />);
    expect(await screen.findByText(/link de recuperação indisponível/i)).toBeVisible();
    expect(screen.queryByLabelText('Nova senha', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /solicitar um novo link/i })).toHaveAttribute(
      'href',
      '#/recuperar-acesso',
    );
  });

  it('não aceita um segredo na consulta da URL', async () => {
    window.history.replaceState(null, '', `?token=${token}#/redefinir-senha`);
    render(<App />);
    expect(await screen.findByText(/link de recuperação indisponível/i)).toBeVisible();
    expect(requests.some((call) => call.path === '/auth/recovery/status')).toBe(false);
    expect(window.location.href).not.toContain(token);
  });

  it('permite emissão global somente depois do registro de conferência e descarta o link quando ocultado', async () => {
    signedIn = true;
    granted = ['MANAGE_PASSWORD_RECOVERY'];
    const user = userEvent.setup();
    render(<App />);
    const issue = await screen.findByRole('button', { name: 'Emitir link de recuperação' });
    expect(window.location.hash).toBe('#/plataforma/recuperacao');
    expect(issue).toBeDisabled();
    await user.type(
      screen.getByRole('textbox', { name: 'E-mail da conta' }),
      'titular@example.test',
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Referência da conferência' }),
      'PROTOCOLO-52',
    );
    await user.click(
      screen.getByRole('checkbox', { name: 'Confirmei a identidade por um contato já validado.' }),
    );
    await user.click(issue);
    const link = await screen.findByRole('textbox', { name: 'Link de recuperação' });
    expect(link).toHaveValue(`${window.location.origin}/#/redefinir-senha/${token}`);
    expect(requests.find((call) => call.path === '/platform/password-recoveries')?.body).toEqual({
      email: 'titular@example.test',
      verificationConfirmed: true,
      verificationReference: 'PROTOCOLO-52',
    });
    expect(Object.values(localStorage)).not.toContain(token);
    await user.click(screen.getByRole('button', { name: 'Ocultar link' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('textbox', { name: 'Link de recuperação' }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('textbox', { name: 'E-mail da conta' })).toHaveFocus();
  });

  it('não mostra emissão empresarial para administrador sem concessão de recuperação', async () => {
    signedIn = true;
    company = true;
    window.history.replaceState(null, '', '#/acessos');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Membros da empresa' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Recuperar senha' })).not.toBeInTheDocument();
  });

  it('mantém a emissão empresarial dentro da organização ativa', async () => {
    signedIn = true;
    company = true;
    granted = ['ASSIST_COMPANY_PASSWORD_RECOVERY'];
    window.history.replaceState(null, '', '#/acessos');
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Recuperar senha' }));
    await user.type(
      screen.getByRole('textbox', { name: 'E-mail da conta' }),
      'titular@example.test',
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Referência da conferência' }),
      'PROTOCOLO-52',
    );
    await user.click(
      screen.getByRole('checkbox', { name: 'Confirmei a identidade por um contato já validado.' }),
    );
    await user.click(screen.getByRole('button', { name: 'Emitir link de recuperação' }));
    expect(await screen.findByRole('textbox', { name: 'Link de recuperação' })).toBeVisible();
    expect(
      requests.some((call) => call.path === `/organizations/${organizationId}/password-recoveries`),
    ).toBe(true);
    expect(requests.some((call) => call.path === '/platform/password-recoveries')).toBe(false);
  });
});
