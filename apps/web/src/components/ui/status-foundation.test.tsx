import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RiskInventory } from '../risks/RiskInventory';
import { ActionList } from '../actions/ActionList';

const org = '10000000-0000-4000-8000-000000000001';
const onExpire = () => undefined;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

it('pagina o inventário por teclado preservando o recorte da URL', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        json({ items: [], total: String(url).includes('/risks?') ? 51 : 0, page: 1, pageSize: 50 }),
      ),
  );
  render(
    <RiskInventory
      organizationId={org}
      canWrite={false}
      query="q=tarefas&page=1"
      onOpenDetail={() => undefined}
      onExpire={onExpire}
    />,
  );
  const nav = await screen.findByRole('navigation', { name: 'Paginação do inventário' });
  expect(within(nav).getByRole('button', { name: 'Página anterior' })).toBeDisabled();
  within(nav).getByRole('button', { name: 'Próxima página' }).focus();
  await userEvent.keyboard('{Enter}');
  expect(window.location.hash).toBe('#/inventario?q=tarefas&page=2');
});

it('permite recuperar a consulta de ações dentro da mensagem de erro', async () => {
  let failed = true;
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (String(url).includes('/actions?') && failed) return json({}, 503);
      return json({ items: [], total: 0, page: 1, pageSize: 50 });
    }),
  );
  render(<ActionList organizationId={org} query="page=1" onExpire={onExpire} />);
  const alert = await screen.findByRole('alert');
  failed = false;
  await userEvent.click(within(alert).getByRole('button', { name: 'Atualizar ações' }));
  expect(await screen.findByRole('heading', { name: 'Nenhuma ação neste recorte' })).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
