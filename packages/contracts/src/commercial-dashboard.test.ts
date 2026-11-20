import { describe, expect, it } from 'vitest';
import {
  commercialDashboardQuerySchema,
  commercialDashboardSchema,
  createPlatformClientSchema,
} from './index';

describe('ID 51 commercial dashboard and platform client creation contracts', () => {
  it('validates createPlatformClientSchema with defaults and rejects invalid timezone or CNPJ', () => {
    const parsed = createPlatformClientSchema.parse({
      name: 'Nova Cliente Sintética Ltda',
      fiscalIdentifier: '11.222.333/0001-81',
      reason: 'Cadastro inicial no catálogo da plataforma.',
    });
    expect(parsed.clientClassification).toBe('CLIENT');
    expect(parsed.timezone).toBe('America/Sao_Paulo');
    expect(parsed.isActive).toBe(true);
    expect(parsed.fiscalIdentifier).toBe('11.222.333/0001-81');

    expect(
      createPlatformClientSchema.safeParse({
        name: 'Empresa Inválida',
        fiscalIdentifier: '11.222.333/0001-81',
        timezone: 'Invalid/Zone',
        reason: 'Teste de fuso inválido.',
      }).success,
    ).toBe(false);

    expect(
      createPlatformClientSchema.safeParse({
        name: 'Empresa CNPJ Inválido',
        fiscalIdentifier: '11.111.111/1111-11',
        reason: 'Teste de CNPJ inválido.',
      }).success,
    ).toBe(false);
  });

  it('enforces period ordering and renewal window bounds on commercialDashboardQuerySchema', () => {
    const valid = commercialDashboardQuerySchema.parse({
      competenceFrom: '2026-10',
      competenceTo: '2026-12',
      renewalWindowDays: '45',
    });
    expect(valid.renewalWindowDays).toBe(45);

    expect(
      commercialDashboardQuerySchema.safeParse({
        competenceFrom: '2026-12',
        competenceTo: '2026-10',
      }).success,
    ).toBe(false);

    expect(
      commercialDashboardQuerySchema.safeParse({
        renewalWindowDays: '365',
      }).success,
    ).toBe(false);
  });

  it('validates a restricted-scope commercialDashboardSchema with null unauthorized sections', () => {
    const orgId = '10000000-0000-4000-8000-000000000001';
    const contractId = '10000000-0000-4000-8000-000000000002';
    const parsed = commercialDashboardSchema.parse({
      generatedAt: '2026-11-25T12:00:00.000Z',
      timeZone: 'America/Sao_Paulo',
      referenceDate: '2026-11-25',
      period: { competenceFrom: null, competenceTo: null, renewalWindowDays: 30 },
      organizationId: null,
      scope: {
        canReadOverview: false,
        canManageClients: false,
        canReadCatalog: true,
        canManageCatalog: false,
        canReadBilling: false,
        canManageBilling: false,
        canReadContractAccess: false,
        canManageContractAccess: false,
        canReadSupport: false,
      },
      catalog: {
        totalOrganizations: 2,
        activeClients: 1,
        inactiveClients: 0,
        demonstrations: 1,
        unclassified: 0,
        pendingFiscal: 1,
      },
      contracts: {
        total: 1,
        active: 1,
        scheduled: 0,
        expiringSoon: 1,
        expired: 0,
        cancelled: 0,
        withoutContractActiveClients: 0,
        pendingDocumentCount: 0,
      },
      billing: null,
      contractAccess: null,
      supportTickets: null,
      alerts: [
        {
          id: `CONTRACT_EXPIRING_SOON:${orgId}:${contractId}`,
          kind: 'CONTRACT_EXPIRING_SOON',
          severity: 'medium',
          domain: 'contracts',
          organizationId: orgId,
          organizationName: 'Empresa Fictícia A',
          sourceType: 'contract',
          sourceId: contractId,
          referenceDate: '2026-12-10',
          title: 'Contrato próximo do vencimento',
          description: 'Vigência atual encerra em 10/12/2026.',
          amountCents: null,
          itemCount: null,
          actionTarget: 'commercial-clients',
          billingStatusFilter: null,
          clientClassification: null,
        },
      ],
      reconciliation: {
        source: 'COMMERCIAL_LIVE_RECORDS',
        referenceDate: '2026-11-25',
        timeZone: 'America/Sao_Paulo',
        checkedAt: '2026-11-25T12:00:00.000Z',
        counts: {
          organizations: 2,
          contracts: 1,
          charges: null,
          accessRecords: null,
          alerts: 1,
        },
      },
    });
    expect(parsed.billing).toBeNull();
    expect(parsed.alerts).toHaveLength(1);
  });
});
