import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { AssessmentSources as Sources } from './components/assessments/AssessmentSources';
const org = '10000000-0000-4000-8000-000000000001';
const id = '20000000-0000-4000-8000-000000000001';
afterEach(() => vi.unstubAllGlobals());
it('preserva fonte após 503, envia data civil e usa autoria da resposta', async () => {
  let writes = 0;
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input, options) => {
      if (options?.method === 'POST') {
        writes++;
        bodies.push(JSON.parse(options.body));
        return new Response(
          JSON.stringify(
            writes === 1
              ? {}
              : {
                  ...bodies[1],
                  id,
                  organizationId: org,
                  cycleId: id,
                  createdAt: '2026-10-24T12:00:00.000Z',
                  createdBy: { id: org, name: 'Autora da sessão' },
                },
          ),
          { status: writes === 1 ? 503 : 200 },
        );
      }
      return new Response(JSON.stringify({ items: [], total: 0, page: 1, pageSize: 20 }));
    }),
  );
  render(<Sources organizationId={org} cycleId={id} canEdit onExpire={vi.fn()} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Contexto da fonte'), 'Rotina da equipe');
  await user.type(screen.getByLabelText('Data da fonte'), '2026-10-23');
  await user.type(screen.getByLabelText('Síntese da fonte'), 'Síntese da oficina coletiva');
  await user.click(screen.getByRole('button', { name: 'Registrar fonte' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('temporariamente indisponível');
  expect(screen.getByLabelText('Contexto da fonte')).toHaveValue('Rotina da equipe');
  await user.click(screen.getByRole('button', { name: 'Registrar fonte' }));
  expect(await screen.findByText(/Autora da sessão/)).toBeVisible();
  expect(bodies[1]).toEqual({
    kind: 'OBSERVATION',
    context: 'Rotina da equipe',
    occurredOn: '2026-10-23',
    summary: 'Síntese da oficina coletiva',
  });
  await waitFor(() => expect(screen.getByLabelText('Contexto da fonte')).toHaveValue(''));
});
it('leitor consulta fontes sem formulário', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ items: [], total: 0, page: 1, pageSize: 20 }))),
  );
  render(<Sources organizationId={org} cycleId={id} canEdit={false} onExpire={vi.fn()} />);
  expect(await screen.findByText('Nenhuma fonte registrada.')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Registrar fonte' })).not.toBeInTheDocument();
});

it('rejeita fontes de outro ciclo e permite repetir a consulta sem perder o rascunho', async () => {
  let calls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      calls++;
      return new Response(
        JSON.stringify({
          items:
            calls === 1
              ? [
                  {
                    id,
                    organizationId: org,
                    cycleId: org,
                    kind: 'OBSERVATION',
                    context: 'Contexto de outro ciclo',
                    occurredOn: '2026-10-23',
                    summary: 'Não exibir esta síntese',
                    createdAt: '2026-10-24T12:00:00.000Z',
                    createdBy: { id: org, name: 'Autora' },
                  },
                ]
              : [],
          total: calls === 1 ? 1 : 0,
          page: 1,
          pageSize: 20,
        }),
      );
    }),
  );
  render(<Sources organizationId={org} cycleId={id} canEdit onExpire={vi.fn()} />);
  const user = userEvent.setup();
  await screen.findByRole('alert');
  expect(screen.queryByText('Não exibir esta síntese')).not.toBeInTheDocument();
  await user.type(screen.getByLabelText('Contexto da fonte'), 'Rascunho ainda em edição');
  await user.click(screen.getByRole('button', { name: 'Atualizar fontes' }));
  expect(await screen.findByText('Nenhuma fonte registrada.')).toBeVisible();
  expect(screen.getByLabelText('Contexto da fonte')).toHaveValue('Rascunho ainda em edição');
});
