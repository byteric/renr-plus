import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { ReportsWorkspace } from './components/reports/ReportsWorkspace';
const organizationId = '10000000-0000-4000-8000-000000000001';
const id = '20000000-0000-4000-8000-000000000001';
const timestamp = '2026-11-04T12:00:00.000Z';
const snapshot = {
  id,
  kind: 'SST',
  organizationId,
  financial: false,
  nominal: false,
  createdAt: timestamp,
  referenceDate: '2026-11-04',
  timeZone: 'America/Sao_Paulo',
  title: 'Relatório Sintético Congelado',
  context: 'Empresa Sintética',
  filters: [{ label: 'Situação', value: 'Ativos na emissão' }],
  sections: [
    {
      key: 'frozen',
      title: 'Estado na emissão',
      columns: ['Indicador', 'Valor'],
      rows: [['Registros congelados', '12']],
      notes: ['Informação preservada na emissão.'],
    },
  ],
  limitations: ['Teste sintético.'],
};
const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let grants: string[] = [];
let pdfError = false;
beforeEach(() => {
  grants = [];
  pdfError = false;
  window.history.replaceState(null, '', '#/relatorios');
  localStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) => {
    const path = String(input);
    if (path.endsWith('/auth/session-capabilities'))
      return json({ organizationId, capabilities: grants, canManageAccess: true });
    if (path.endsWith('/platform/capabilities')) return json({ capabilities: [] });
    if (path.endsWith('/pdf'))
      return pdfError
        ? json({}, 403)
        : new Response('synthetic-pdf', { headers: { 'Content-Type': 'application/pdf' } });
    if (path.endsWith(`/${id}`)) return json(snapshot);
    if (path.includes('/reports?')) {
      const summary = {
        id: snapshot.id,
        kind: snapshot.kind,
        organizationId,
        financial: false,
        createdAt: timestamp,
        title: snapshot.title,
        context: snapshot.context,
      };
      return json({ items: [summary], total: 1, page: 1, pageSize: 25 });
    }
    return json({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});
it('bloqueia relatórios globais sem concessão antes de consultar snapshots', async () => {
  render(<ReportsWorkspace platform organizationId={null} onExpire={vi.fn()} />);
  expect(await screen.findByText(/relatórios globais exigem leitura da plataforma/i)).toBeVisible();
  expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
    '/api/v1/platform/capabilities',
  ]);
});
it('identifica a área de emissão global com um título próprio', async () => {
  const fallback = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (input, init) =>
    String(input).endsWith('/platform/capabilities')
      ? json({ capabilities: ['READ_OVERVIEW'] })
      : fallback(input, init),
  );
  render(<ReportsWorkspace platform organizationId={null} onExpire={vi.fn()} />);
  const workspace = await screen.findByRole('region', { name: 'Emissão e consulta global' });
  expect(within(workspace).getByRole('button', { name: 'Emitir relatório' })).toBeVisible();
});
it('mostra o snapshot congelado sem consultar indicadores atuais e restringe emissão PEOPLE', async () => {
  const user = userEvent.setup();
  render(<ReportsWorkspace organizationId={organizationId} onExpire={vi.fn()} />);
  await user.click(
    await screen.findByRole('button', { name: 'Abrir Relatório Sintético Congelado' }),
  );
  expect(await screen.findByRole('table', { name: 'Estado na emissão' })).toBeVisible();
  expect(screen.getByText('Registros congelados')).toBeVisible();
  expect(screen.getByText('12')).toBeVisible();
  expect(
    fetchMock.mock.calls.some(([url]) => /overview|employees|remunerations/.test(String(url))),
  ).toBe(false);
  expect(screen.queryByRole('option', { name: 'Gestão de Pessoas' })).not.toBeInTheDocument();
  expect(
    screen.queryByRole('checkbox', { name: 'Incluir dados financeiros' }),
  ).not.toBeInTheDocument();
  expect(localStorage.length).toBe(0);
});
it('não anuncia download bem-sucedido e remove a prévia quando o PDF é negado', async () => {
  pdfError = true;
  const user = userEvent.setup();
  render(<ReportsWorkspace organizationId={organizationId} onExpire={vi.fn()} />);
  await user.click(
    await screen.findByRole('button', { name: 'Abrir Relatório Sintético Congelado' }),
  );
  await user.click(await screen.findByRole('button', { name: 'Baixar PDF' }));
  expect(await screen.findByText(/acesso aos relatórios foi revogado/i)).toBeVisible();
  expect(screen.queryByRole('table', { name: 'Estado na emissão' })).not.toBeInTheDocument();
  expect(screen.queryByText(/download concluído/i)).not.toBeInTheDocument();
});

it('move o foco ao título da prévia quando abre uma emissão', async () => {
  const user = userEvent.setup();
  render(<ReportsWorkspace organizationId={organizationId} onExpire={vi.fn()} />);
  await user.click(
    await screen.findByRole('button', { name: 'Abrir Relatório Sintético Congelado' }),
  );
  expect(await screen.findByRole('heading', { name: snapshot.title })).toHaveFocus();
});
it('rejeita a resposta de uma emissão diferente da selecionada', async () => {
  const fallback = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (input, init) =>
    String(input).endsWith(`/${id}`)
      ? json({ ...snapshot, id: '20000000-0000-4000-8000-000000000002' })
      : fallback(input, init),
  );
  const user = userEvent.setup();
  render(<ReportsWorkspace organizationId={organizationId} onExpire={vi.fn()} />);
  await user.click(
    await screen.findByRole('button', { name: 'Abrir Relatório Sintético Congelado' }),
  );
  expect(await screen.findByText(/prévia indisponível/i)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Baixar PDF' })).not.toBeInTheDocument();
});
it.each([
  [422, 'REPORT_SCOPE_TOO_LARGE', /reduza o recorte/i],
  [429, 'REPORT_GENERATION_BUSY', /outras exportações em andamento/i],
  [503, 'REPORT_GENERATION_DEADLINE', /tempo limite de geração/i],
])('explica falha de PDF %s sem anunciar sucesso', async (status, code, message) => {
  const fallback = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (input, init) =>
    String(input).endsWith('/pdf')
      ? json({ statusCode: status, code, message: 'Falha', requestId: id, timestamp }, status)
      : fallback(input, init),
  );
  const user = userEvent.setup();
  render(<ReportsWorkspace organizationId={organizationId} onExpire={vi.fn()} />);
  await user.click(
    await screen.findByRole('button', { name: 'Abrir Relatório Sintético Congelado' }),
  );
  await user.click(await screen.findByRole('button', { name: 'Baixar PDF' }));
  expect(await screen.findByText(message)).toBeVisible();
  expect(screen.queryByText(/PDF preparado/i)).not.toBeInTheDocument();
  expect(screen.getByRole('table', { name: 'Estado na emissão' })).toBeVisible();
});
it('omite opções exclusivas de RH ao alternar para SST', async () => {
  grants = ['HR_EXPORT', 'HR_ANALYTICS_READ', 'HR_PROFILE_READ', 'HR_COMPENSATION_READ'];
  const fallback = fetchMock.getMockImplementation()!;
  const issue = vi.fn();
  fetchMock.mockImplementation(async (input, init) => {
    if (init?.method !== 'POST') return fallback(input, init);
    issue(JSON.parse(String(init.body)));
    return json(snapshot, 201);
  });
  const user = userEvent.setup();
  render(<ReportsWorkspace organizationId={organizationId} onExpire={vi.fn()} />);
  const kind = await screen.findByRole('combobox', { name: 'Tipo de relatório' });
  await user.selectOptions(kind, 'PEOPLE');
  await user.selectOptions(screen.getByRole('combobox', { name: 'Situação' }), 'true');
  await user.click(screen.getByRole('checkbox', { name: 'Incluir detalhes nominais' }));
  await user.click(screen.getByRole('checkbox', { name: 'Incluir dados financeiros' }));
  await user.selectOptions(kind, 'SST');
  expect(screen.queryByRole('combobox', { name: 'Situação' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Competência')).not.toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: /incluir detalhes/i })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Emitir relatório' }));
  expect(issue).toHaveBeenCalledWith({ kind: 'SST' });
});
it('recolhe a personalização inicial e permite emitir com todas as seções padrão', async () => {
  const fallback = fetchMock.getMockImplementation()!;
  const issue = vi.fn();
  fetchMock.mockImplementation(async (input, init) => {
    if (init?.method !== 'POST') return fallback(input, init);
    issue(JSON.parse(String(init.body)));
    return json(snapshot, 201);
  });
  const user = userEvent.setup();
  render(<ReportsWorkspace organizationId={organizationId} onExpire={vi.fn()} />);
  const sections = (await screen.findByText('Seções da emissão')).closest('fieldset');
  expect(sections).not.toBeVisible();
  expect(screen.getByText('13 de 13 selecionadas')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Emitir relatório' }));
  expect(issue).toHaveBeenCalledWith({ kind: 'SST' });
});
it('envia somente as seções SST selecionadas e reabre a personalização vazia', async () => {
  const fallback = fetchMock.getMockImplementation()!;
  const issue = vi.fn();
  fetchMock.mockImplementation(async (input, init) => {
    if (init?.method !== 'POST') return fallback(input, init);
    issue(JSON.parse(String(init.body)));
    return json(snapshot, 201);
  });
  const user = userEvent.setup();
  render(<ReportsWorkspace organizationId={organizationId} onExpire={vi.fn()} />);
  const customize = await screen.findByText('Personalizar seções');
  await user.click(customize);
  const sections = await screen.findByRole('group', { name: 'Seções da emissão' });
  const choices = within(sections).getAllByRole('checkbox');
  expect(choices.length).toBeGreaterThan(1);
  for (const choice of choices) await user.click(choice);
  await user.click(customize);
  const emit = screen.getByRole('button', { name: 'Emitir relatório' });
  await user.click(emit);
  expect(issue).not.toHaveBeenCalled();
  expect(screen.getByText('Selecione ao menos uma seção.')).toBeVisible();
  expect(sections).toBeVisible();
  expect(customize.closest('summary')).toHaveFocus();
  await user.click(choices[0]!);
  await user.click(customize);
  expect(screen.getByText(`1 de ${choices.length} selecionadas`)).toBeVisible();
  await user.click(emit);
  expect(issue).toHaveBeenCalledWith({
    kind: 'SST',
    sectionKeys: [(choices[0] as HTMLInputElement).value],
  });
});
it('emite o subconjunto de Pessoas mantendo opções de RH autorizadas separadas', async () => {
  grants = ['HR_EXPORT', 'HR_ANALYTICS_READ', 'HR_PROFILE_READ', 'HR_COMPENSATION_READ'];
  window.history.replaceState(
    null,
    '',
    '#/relatorios?kind=PEOPLE&isActive=false&competence=2026-11',
  );
  const fallback = fetchMock.getMockImplementation()!;
  const issue = vi.fn();
  fetchMock.mockImplementation(async (input, init) => {
    if (init?.method !== 'POST') return fallback(input, init);
    issue(JSON.parse(String(init.body)));
    return json({ ...snapshot, kind: 'PEOPLE', financial: true, nominal: true }, 201);
  });
  const user = userEvent.setup();
  render(<ReportsWorkspace organizationId={organizationId} onExpire={vi.fn()} />);
  await user.click(await screen.findByText('Personalizar seções'));
  const sections = await screen.findByRole('group', { name: 'Seções da emissão' });
  const choices = within(sections).getAllByRole('checkbox') as HTMLInputElement[];
  await user.click(choices[0]!);
  await user.click(screen.getByRole('checkbox', { name: 'Incluir detalhes nominais' }));
  await user.click(screen.getByRole('checkbox', { name: 'Incluir dados financeiros' }));
  await user.click(screen.getByRole('button', { name: 'Emitir relatório' }));
  expect(issue).toHaveBeenCalledWith({
    kind: 'PEOPLE',
    isActive: 'false',
    competence: '2026-11',
    includeDetails: true,
    includeFinancial: true,
    sectionKeys: choices.slice(1).map((choice) => choice.value),
  });
});
