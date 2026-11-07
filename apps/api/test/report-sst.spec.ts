import { captureSst } from '../src/modules/reports/report-sst';
import type { Prisma } from '../src/generated/prisma/client';

it('explica quais riscos do inventário exportado entram no total do painel', async () => {
  const group = { sector: { name: 'Setor fictício', unit: { name: 'Unidade fictícia' } } };
  const risks = [
    { id: '1', factor: 'Risco em rascunho', status: 'DRAFT', version: 1, assessmentGroup: group },
    {
      id: '2',
      factor: 'Risco registrado',
      status: 'REGISTERED',
      version: 1,
      assessmentGroup: group,
    },
    { id: '3', factor: 'Risco arquivado', status: 'ARCHIVED', version: 2, assessmentGroup: group },
  ];
  const empty = { findMany: async () => [] };
  const tx = {
    risk: { count: async () => risks.length, findMany: async () => risks },
    action: { count: async () => 0, ...empty },
    technicalRiskEvaluation: empty,
    riskEvaluation: empty,
    actionEvidence: empty,
    actionEfficacyOpinion: empty,
    riskReassessment: empty,
    actionTechnicalClosure: empty,
    auditEvent: empty,
    assessmentCycle: empty,
    diagnosticCycle: empty,
  } as unknown as Prisma.TransactionClient;

  const sections = await captureSst(tx, 'empresa-ficticia', {
    kind: 'SST',
    includeDetails: false,
    includeFinancial: false,
  });
  const inventory = sections.find((item) => item.key === 'inventory');
  expect(inventory?.rows).toHaveLength(3);
  expect(inventory?.rows[2]?.[0]).toContain('Risco arquivado');
  expect(inventory?.notes).toContain(
    'Contagem do painel (riscos não arquivados) · 2. Arquivados incluídos no relatório · 1.',
  );
});
