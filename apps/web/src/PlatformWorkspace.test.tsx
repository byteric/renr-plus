import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { PlatformWorkspace } from './components/platform/PlatformWorkspace';
const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let capabilities: string[] = [];
const organizationId = '10000000-0000-4000-8000-000000000001';
beforeEach(() => {
  capabilities = [];
  window.history.replaceState(null, '', '#/plataforma');
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) => {
    const path = String(input);
    if (path.endsWith('/platform/capabilities')) return json({ capabilities });
    if (path.endsWith('/platform/overview')) return json({}, 503);
    if (path.includes('/platform/clients'))
      return json({
        items: [
          {
            organizationId,
            name: 'Cliente Sintético',
            fiscalIdentifier: '11222333000181',
            normalizedFiscalIdentifier: '11222333000181',
            fiscalState: 'VALID',
            clientClassification: 'CLIENT',
            isActive: true,
            version: 1,
            employees: { active: 10, inactive: 2 },
          },
        ],
        total: 1,
        page: 1,
        pageSize: 25,
      });
    return json({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});
it('não consulta catálogo ou empregados sem concessão global explícita', async () => {
  render(<PlatformWorkspace onExpire={vi.fn()} />);
  expect(
    await screen.findByText(/acesso à plataforma requer uma concessão específica/i),
  ).toBeVisible();
  expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
    '/api/v1/platform/capabilities',
  ]);
});
it('mantém catálogo disponível quando o resumo falha e começa apenas com clientes válidos', async () => {
  capabilities = ['READ_OVERVIEW'];
  render(<PlatformWorkspace onExpire={vi.fn()} />);
  expect(await screen.findByText('Cliente Sintético')).toBeVisible();
  expect(await screen.findByText(/resumo indisponível/i)).toBeVisible();
  expect(
    fetchMock.mock.calls.some(
      ([url]) =>
        String(url).includes('classification=CLIENT') && String(url).includes('fiscalState=VALID'),
    ),
  ).toBe(true);
  expect(
    fetchMock.mock.calls.some(
      ([url]) => String(url).includes('/employees') || String(url).includes('/remunerations'),
    ),
  ).toBe(false);
  expect(screen.queryByRole('button', { name: /corrigir cadastro/i })).not.toBeInTheDocument();
});
it.each([
  'classification=INVALID',
  'classification=CLIENT&classification=DEMONSTRATION',
  'page=zero',
])('bloqueia query inválida sem ampliar o catálogo: %s', async (query) => {
  capabilities = ['READ_OVERVIEW'];
  window.history.replaceState(null, '', `#/plataforma?${query}`);
  render(<PlatformWorkspace onExpire={vi.fn()} />);
  expect(await screen.findByText(/filtros da URL inválidos/i)).toBeVisible();
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/platform/clients'))).toBe(
    false,
  );
});
