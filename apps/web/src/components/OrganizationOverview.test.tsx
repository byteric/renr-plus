import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationOverview } from './OrganizationOverview';

const organizationId = '10000000-0000-4000-8000-000000000001';
const otherId = '10000000-0000-4000-8000-000000000002';
const overview = {
  organization: { id: organizationId, name: 'Empresa Horizonte', isActive: true },
  units: { total: 3, active: 2, inactive: 1 },
  sectors: { total: 4, active: 3, inactive: 1 },
  unitsWithoutSectors: 1,
  generatedAt: '2026-10-12T12:00:00.000Z',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const fetchMock = vi.fn<typeof fetch>();
const onExpire = vi.fn();
beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(json(overview));
  onExpire.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('painel organizacional', () => {
  it('carrega dados reais do contrato, apresenta contagens e limita o escopo a cadastros', async () => {
    render(<OrganizationOverview organizationId={organizationId} onExpire={onExpire} />);
    expect(screen.getByRole('status')).toHaveTextContent('Carregando painel');
    expect(await screen.findByRole('heading', { name: 'Empresa Horizonte' })).toBeVisible();
    expect(screen.getByText('Unidades cadastradas').nextElementSibling).toHaveTextContent('3');
    expect(screen.getByText('Setores cadastrados').nextElementSibling).toHaveTextContent('4');
    expect(
      screen.getByText('Unidades sem setores', { exact: true }).nextElementSibling,
    ).toHaveTextContent('1');
    expect(
      screen.getByText(/não representam avaliação de riscos nem conformidade com a NR-01/),
    ).toBeVisible();
    expect(screen.queryByText(/ainda não estão implementados/)).not.toBeInTheDocument();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/v1/organizations/${organizationId}/overview`);
    const units = screen.getByRole('heading', { name: 'Unidades' }).parentElement!;
    expect(within(units).getByText('Ativas').nextElementSibling).toHaveTextContent('2');
  });

  it('orienta a seleção sem consultar a API quando não há empresa', () => {
    render(<OrganizationOverview organizationId={null} onExpire={onExpire} />);
    expect(screen.getByRole('link', { name: 'Ir para Empresas →' })).toHaveAttribute(
      'href',
      '#/empresas',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('mostra vazio sem inventar indicadores', async () => {
    fetchMock.mockResolvedValue(
      json({
        ...overview,
        units: { total: 0, active: 0, inactive: 0 },
        sectors: { total: 0, active: 0, inactive: 0 },
        unitsWithoutSectors: 0,
      }),
    );
    render(<OrganizationOverview organizationId={organizationId} onExpire={onExpire} />);
    expect(
      await screen.findByRole('heading', { name: 'A estrutura ainda está vazia' }),
    ).toBeVisible();
    expect(screen.getByText('Unidades cadastradas').nextElementSibling).toHaveTextContent('0');
  });

  it('permite repetir consulta após indisponibilidade e remove o erro enquanto carrega', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 503)).mockResolvedValueOnce(json(overview));
    render(<OrganizationOverview organizationId={organizationId} onExpire={onExpire} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Serviço temporariamente indisponível',
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByRole('heading', { name: 'Empresa Horizonte' })).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['formato inválido', {}],
    ['contagens inconsistentes', { ...overview, units: { total: 3, active: 3, inactive: 1 } }],
    ['empresa diferente', { ...overview, organization: { ...overview.organization, id: otherId } }],
  ])('rejeita resposta com %s sem mostrar números', async (_name, body) => {
    fetchMock.mockResolvedValue(json(body));
    render(<OrganizationOverview organizationId={organizationId} onExpire={onExpire} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível concluir a operação',
    );
    expect(screen.queryByText('Unidades cadastradas')).not.toBeInTheDocument();
  });

  it.each([403, 404, 429])(
    'mostra erro HTTP %s recuperável sem expor conteúdo interno',
    async (status) => {
      fetchMock.mockResolvedValue(json({ internal: 'PRIVATE' }, status));
      render(<OrganizationOverview organizationId={organizationId} onExpire={onExpire} />);
      expect(await screen.findByRole('alert')).not.toHaveTextContent('PRIVATE');
      expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeVisible();
    },
  );

  it('expira a sessão ao receber 401', async () => {
    fetchMock.mockResolvedValue(json({}, 401));
    render(<OrganizationOverview organizationId={organizationId} onExpire={onExpire} />);
    await waitFor(() => expect(onExpire).toHaveBeenCalledOnce());
    expect(screen.queryByText('Unidades cadastradas')).not.toBeInTheDocument();
  });

  it('trata falha de rede', async () => {
    fetchMock.mockRejectedValue(new TypeError('network'));
    render(<OrganizationOverview organizationId={organizationId} onExpire={onExpire} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão com o serviço');
  });

  it('oculta dados anteriores imediatamente na troca e ignora resposta atrasada', async () => {
    let resolveOld!: (value: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    fetchMock.mockResolvedValueOnce(
      json({
        ...overview,
        organization: { id: otherId, name: 'Nova empresa', isActive: false },
        units: { total: 9, active: 9, inactive: 0 },
      }),
    );
    const view = render(
      <OrganizationOverview organizationId={organizationId} onExpire={onExpire} />,
    );
    const signal = fetchMock.mock.calls[0]?.[1]?.signal;
    view.rerender(<OrganizationOverview organizationId={otherId} onExpire={onExpire} />);
    expect(screen.getByRole('status')).toHaveTextContent('Carregando');
    expect(signal?.aborted).toBe(true);
    expect(await screen.findByRole('heading', { name: 'Nova empresa' })).toBeVisible();
    await act(async () => resolveOld(json(overview)));
    await waitFor(() =>
      expect(screen.getByText('Unidades cadastradas').nextElementSibling).toHaveTextContent('9'),
    );
    expect(screen.queryByRole('heading', { name: 'Empresa Horizonte' })).not.toBeInTheDocument();
    expect(screen.getByText('Empresa inativa')).toBeVisible();
  });

  it('limpa indicadores já carregados ao mudar a empresa e cancela ao desmontar', async () => {
    const view = render(
      <OrganizationOverview organizationId={organizationId} onExpire={onExpire} />,
    );
    await screen.findByRole('heading', { name: 'Empresa Horizonte' });
    fetchMock.mockImplementationOnce(() => new Promise(() => {}));
    view.rerender(<OrganizationOverview organizationId={otherId} onExpire={onExpire} />);
    expect(screen.queryByRole('heading', { name: 'Empresa Horizonte' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeVisible();
    const signal = fetchMock.mock.calls[1]?.[1]?.signal;
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });
});
