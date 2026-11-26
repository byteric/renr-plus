import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';

const accessBase = '/api/v1/platform/commercial/access';
const orgAlpha = '30000000-0000-4000-8000-000000000001';
const orgBeta = '30000000-0000-4000-8000-000000000002';
const contractAlpha = '30000000-0000-4000-8000-000000000003';
const contractBeta = '30000000-0000-4000-8000-000000000004';
const trans1Id = '30000000-0000-4000-8000-000000000005';
const trans2Id = '30000000-0000-4000-8000-000000000006';
const actorId = '30000000-0000-4000-8000-000000000007';
const timestamp = '2026-11-24T14:00:00.000Z';

const clientAlphaActive = {
  organizationId: orgAlpha,
  organizationName: 'Alpha Operações LTDA',
  isActive: true,
  clientClassification: 'CLIENT' as const,
  fiscalState: 'VALID' as const,
  contract: { id: contractAlpha, situation: 'ACTIVE' as const },
  access: {
    status: 'ACTIVE' as const,
    version: 1,
    lastTransitionKind: 'ACTIVATION' as const,
    lastRule: 'MANUAL_CONTRACT_ACTIVATION' as const,
    lastOrigin: 'MANUAL_OPERATION' as const,
    lastEffectiveOn: '2026-11-20',
    lastReason: 'Ativação inicial confirmada.',
    lastNextStep: 'Uso operacional liberado.',
    lastActor: { id: actorId, name: 'Operadora Contratos' },
    updatedAt: timestamp,
  },
};

const clientBetaUnrecorded = {
  organizationId: orgBeta,
  organizationName: 'Beta Indústria S/A',
  isActive: true,
  clientClassification: 'DEMONSTRATION' as const,
  fiscalState: 'MISSING' as const,
  contract: { id: contractBeta, situation: 'ACTIVE' as const },
  access: {
    status: 'UNRECORDED' as const,
    version: 0,
    lastTransitionKind: null,
    lastRule: null,
    lastOrigin: null,
    lastEffectiveOn: null,
    lastReason: null,
    lastNextStep: null,
    lastActor: null,
    updatedAt: null,
  },
};

const clientBetaSuspendedDetail = {
  ...clientBetaUnrecorded,
  access: {
    status: 'SUSPENDED' as const,
    version: 1,
    lastTransitionKind: 'SUSPENSION' as const,
    lastRule: 'MANUAL_CONTRACT_SUSPENSION' as const,
    lastOrigin: 'MANUAL_OPERATION' as const,
    lastEffectiveOn: '2026-11-24',
    lastReason: 'Suspensão contratual manual solicitada pela conta.',
    lastNextStep: 'Contate a equipe comercial para regularização e reativação.',
    lastActor: { id: actorId, name: 'Operadora Contratos' },
    updatedAt: timestamp,
  },
  transitions: [
    {
      id: trans1Id,
      ordinal: 1,
      kind: 'SUSPENSION' as const,
      fromStatus: 'UNRECORDED' as const,
      toStatus: 'SUSPENDED' as const,
      rule: 'MANUAL_CONTRACT_SUSPENSION' as const,
      origin: 'MANUAL_OPERATION' as const,
      effectiveOn: '2026-11-24',
      reason: 'Suspensão contratual manual solicitada pela conta.',
      nextStep: 'Contate a equipe comercial para regularização e reativação.',
      actor: { id: actorId, name: 'Operadora Contratos' },
      createdAt: timestamp,
    },
  ],
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function apiError(status: number, code: string, message: string) {
  return json(
    {
      statusCode: status,
      code,
      message,
      requestId: '30000000-0000-4000-8000-000000000099',
      timestamp,
    },
    status,
  );
}

beforeEach(() => {
  window.location.hash = '#/plataforma/comercial';
});

afterEach(() => {
  vi.restoreAllMocks();
  window.location.hash = '';
});

it('permite ao operador com MANAGE_CONTRACT_ACCESS registrar suspensão manual com confirmação e preserva rascunho em conflito 409', async () => {
  const user = userEvent.setup();
  let betaDetail: Record<string, unknown> = {
    ...clientBetaUnrecorded,
    transitions: [],
  };
  let conflictOnce = true;

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    if (url.endsWith('/api/v1/health')) {
      return json({ status: 'ok', service: 'renr-api', timestamp });
    }
    if (url.endsWith('/api/v1/auth/session')) {
      return json({
        user: { id: actorId, name: 'Operadora Contratos', email: 'op@retech.test' },
        memberships: [],
        activeOrganizationId: null,
        expiresAt: '2099-11-25T00:00:00.000Z',
      });
    }
    if (url.endsWith('/api/v1/auth/session-capabilities')) {
      return json({ organizationId: null, capabilities: [], canManageAccess: false });
    }
    if (url.endsWith('/api/v1/platform/capabilities')) {
      return json({ capabilities: ['MANAGE_CONTRACT_ACCESS'] });
    }
    if (url.includes(`${accessBase}/clients?`)) {
      const { transitions: _unused, ...betaSummaryItem } = betaDetail as Record<string, unknown>;
      void _unused;
      return json({
        summary: {
          timeZone: 'America/Sao_Paulo',
          referenceDate: '2026-11-24',
          counts: {
            total: 2,
            unrecorded: (betaDetail.access as { status: string }).status === 'UNRECORDED' ? 1 : 0,
            active: 1,
            suspended: (betaDetail.access as { status: string }).status === 'SUSPENDED' ? 1 : 0,
          },
        },
        items: [clientAlphaActive, betaSummaryItem],
        total: 2,
        page: 1,
        pageSize: 25,
      });
    }
    if (url.endsWith(`${accessBase}/clients/${orgBeta}`) && method === 'GET') {
      return json(betaDetail);
    }
    if (url.endsWith(`${accessBase}/clients/${orgBeta}/transitions`) && method === 'POST') {
      if (conflictOnce) {
        conflictOnce = false;
        betaDetail = {
          ...clientBetaUnrecorded,
          access: {
            status: 'ACTIVE',
            version: 1,
            lastTransitionKind: 'ACTIVATION',
            lastRule: 'MANUAL_CONTRACT_ACTIVATION',
            lastOrigin: 'MANUAL_OPERATION',
            lastEffectiveOn: '2026-11-24',
            lastReason: 'Ativação paralela por outro operador.',
            lastNextStep: 'Acesso regular ativo.',
            lastActor: { id: actorId, name: 'Outro Operador' },
            updatedAt: timestamp,
          },
          transitions: [
            {
              id: trans2Id,
              ordinal: 1,
              kind: 'ACTIVATION',
              fromStatus: 'UNRECORDED',
              toStatus: 'ACTIVE',
              rule: 'MANUAL_CONTRACT_ACTIVATION',
              origin: 'MANUAL_OPERATION',
              effectiveOn: '2026-11-24',
              reason: 'Ativação paralela por outro operador.',
              nextStep: 'Acesso regular ativo.',
              actor: { id: actorId, name: 'Outro Operador' },
              createdAt: timestamp,
            },
          ],
        };
        return apiError(409, 'CONFLICT', 'Versão desatualizada.');
      }
      const parsed = JSON.parse(String(init?.body)) as {
        expectedVersion: number;
        reason: string;
        nextStep: string;
      };
      expect(parsed.expectedVersion).toBe(1);
      betaDetail = {
        ...clientBetaSuspendedDetail,
        access: {
          ...clientBetaSuspendedDetail.access,
          version: 2,
          lastReason: parsed.reason,
          lastNextStep: parsed.nextStep,
        },
        transitions: [
          ...(betaDetail.transitions as unknown[]),
          {
            ...clientBetaSuspendedDetail.transitions[0],
            ordinal: 2,
            fromStatus: 'ACTIVE',
            reason: parsed.reason,
            nextStep: parsed.nextStep,
          },
        ],
      };
      return json(betaDetail, 201);
    }
    return apiError(404, 'NOT_FOUND', `Unhandled ${method} ${url}`);
  });

  render(<App />);

  const heading = await screen.findByRole(
    'heading',
    { name: 'Acesso contratual' },
    { timeout: 5000 },
  );
  expect(heading).toBeInTheDocument();
  expect(await screen.findByText('Beta Indústria S/A')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /Gerenciar acesso de Beta Indústria/i }));
  expect(await screen.findByRole('heading', { name: /Beta Indústria S\/A/i })).toBeInTheDocument();

  const reasonField = screen.getByLabelText(/Motivo da decisão/i);
  const nextStepField = screen.getByLabelText(/Próximo passo orientado/i);
  const confirmCheckbox = screen.getByLabelText(/Confirmo esta decisão manual/i);

  await user.selectOptions(screen.getByLabelText(/Transição contratual/i), 'SUSPENSION');
  await user.type(reasonField, 'Suspensão manual com preservação de rascunho.');
  await user.type(nextStepField, 'Acionar comercial ReTech+ para reativação.');
  await user.click(confirmCheckbox);
  await user.click(screen.getByRole('button', { name: /Confirmar transição/i }));

  // Em conflito 409, preserva o rascunho e oferece recarregar a versão atual.
  expect(await screen.findByRole('alert')).toHaveTextContent(
    /mudou em outra sessão.*rascunho foi preservado/i,
  );
  expect(reasonField).toHaveValue('Suspensão manual com preservação de rascunho.');
  expect(nextStepField).toHaveValue('Acionar comercial ReTech+ para reativação.');

  await user.click(screen.getByRole('button', { name: /Recarregar situação atual/i }));
  expect(
    (await screen.findAllByText(/Ativação paralela por outro operador/i)).length,
  ).toBeGreaterThanOrEqual(1);
  expect(confirmCheckbox).not.toBeChecked();

  // Confirma explicitamente novamente após revisar a nova versão (1 -> 2), preservando o rascunho.
  await user.click(confirmCheckbox);
  await user.click(screen.getByRole('button', { name: /Confirmar transição/i }));
  expect(await screen.findByText(/Transição registrada com histórico/i)).toBeInTheDocument();
  expect(
    (await screen.findAllByText(/Suspensão manual com preservação de rascunho/i)).length,
  ).toBeGreaterThanOrEqual(2);
});

it('oculta formulário de escrita para READ_CONTRACT_ACCESS e exibe motivo/próximo passo de suspensão somente ao ADMIN irrestrito na visão de Empresas', async () => {
  window.location.hash = '#/empresas';
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/api/v1/health')) {
      return json({ status: 'ok', service: 'renr-api', timestamp });
    }
    if (url.endsWith('/api/v1/auth/session')) {
      return json({
        user: { id: actorId, name: 'Gestora Multi', email: 'gestora@alpha.test' },
        memberships: [
          {
            organizationId: orgAlpha,
            organizationName: 'Alpha Operações LTDA',
            role: 'ADMIN',
          },
        ],
        activeOrganizationId: orgAlpha,
        expiresAt: '2099-11-25T00:00:00.000Z',
        suspendedOrganizations: [
          {
            organizationId: orgBeta,
            organizationName: 'Beta Indústria S/A',
            role: 'ADMIN',
            reason: 'Suspensão manual visível somente ao administrador.',
            nextStep: 'Regularize o contrato com a equipe comercial.',
          },
          {
            organizationId: '30000000-0000-4000-8000-000000000090',
            organizationName: 'Gama Somente Leitura LTDA',
            role: 'READER',
            reason: null,
            nextStep: null,
          },
        ],
      });
    }
    if (url.endsWith('/api/v1/auth/session-capabilities')) {
      return json({ organizationId: orgAlpha, capabilities: [], canManageAccess: true });
    }
    if (url.endsWith('/api/v1/platform/capabilities')) {
      return json({ capabilities: [] });
    }
    if (url.includes('/api/v1/organizations?')) {
      return json({
        items: [
          {
            id: orgAlpha,
            name: 'Alpha Operações LTDA',
            fiscalIdentifier: null,
            timezone: 'America/Sao_Paulo',
            isActive: true,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 50,
      });
    }
    return apiError(404, 'NOT_FOUND', url);
  });

  render(<App />);

  const noticeRegion = await screen.findByRole('region', {
    name: /Empresas com acesso contratual suspenso/i,
  });
  expect(within(noticeRegion).getByText('Beta Indústria S/A')).toBeInTheDocument();
  expect(
    within(noticeRegion).getByText(/Suspensão manual visível somente ao administrador/i),
  ).toBeInTheDocument();
  expect(
    within(noticeRegion).getByText(/Regularize o contrato com a equipe comercial/i),
  ).toBeInTheDocument();

  // Empresa onde o perfil é READER não recebe motivo/próximo passo internos.
  expect(within(noticeRegion).getByText('Gama Somente Leitura LTDA')).toBeInTheDocument();
  expect(within(noticeRegion).getByText(/Procure a administração da empresa/i)).toBeInTheDocument();
});

it('permite consulta somente leitura para READ_CONTRACT_ACCESS sem exibir formulário de decisão', async () => {
  const user = userEvent.setup();
  window.location.hash = '#/plataforma/comercial';
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/api/v1/health')) {
      return json({ status: 'ok', service: 'renr-api', timestamp });
    }
    if (url.endsWith('/api/v1/auth/session')) {
      return json({
        user: { id: actorId, name: 'Auditora Contratos', email: 'aud@retech.test' },
        memberships: [],
        activeOrganizationId: null,
        expiresAt: '2099-11-25T00:00:00.000Z',
      });
    }
    if (url.endsWith('/api/v1/auth/session-capabilities')) {
      return json({ organizationId: null, capabilities: [], canManageAccess: false });
    }
    if (url.endsWith('/api/v1/platform/capabilities')) {
      return json({ capabilities: ['READ_CONTRACT_ACCESS'] });
    }
    if (url.includes(`${accessBase}/clients?`)) {
      return json({
        summary: {
          timeZone: 'America/Sao_Paulo',
          referenceDate: '2026-11-24',
          counts: { total: 1, unrecorded: 0, active: 0, suspended: 1 },
        },
        items: [
          {
            ...clientBetaUnrecorded,
            access: clientBetaSuspendedDetail.access,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 25,
      });
    }
    if (url.endsWith(`${accessBase}/clients/${orgBeta}`)) {
      return json(clientBetaSuspendedDetail);
    }
    return apiError(404, 'NOT_FOUND', url);
  });

  render(<App />);
  await screen.findByRole('heading', { name: 'Acesso contratual' }, { timeout: 5000 });
  await user.click(await screen.findByRole('button', { name: /Consultar acesso de Beta/i }));
  expect(
    (await screen.findAllByText(/Suspensão contratual manual solicitada pela conta/i)).length,
  ).toBeGreaterThanOrEqual(2);
  expect(screen.queryByRole('button', { name: /Confirmar transição/i })).not.toBeInTheDocument();
});
