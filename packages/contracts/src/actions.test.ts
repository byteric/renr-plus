import { describe, it, expect } from 'vitest';
import {
  createActionSchema,
  updateActionSchema,
  actionListQuerySchema,
  actionOverviewSchema,
  uploadEvidenceSchema,
} from './index';

describe('action boundaries', () => {
  it('rejects civil year zero, unavailable in PostgreSQL DATE', () => {
    expect(
      createActionSchema.safeParse({
        title: 'Medida fictícia',
        description: 'Descrição fictícia',
        responsibleName: 'Pessoa fictícia',
        dueDate: '0000-01-01',
        expectedResult: 'Resultado esperado',
        verificationCriterion: 'Critério fictício',
        expectedRiskVersion: 1,
      }).success,
    ).toBe(false);
  });
  it('accepts real civil leap dates and rejects unknown fields or missing version', () => {
    const input = {
      title: 'Medida fictícia',
      description: 'Descrição da medida',
      responsibleName: 'Pessoa fictícia',
      dueDate: '2028-02-29',
      expectedResult: 'Resultado esperado',
      verificationCriterion: 'Critério de aferição',
      expectedRiskVersion: 1,
    };
    expect(createActionSchema.safeParse(input).success).toBe(true);
    expect(createActionSchema.safeParse({ ...input, dueDate: '2027-02-29' }).success).toBe(false);
    expect(createActionSchema.safeParse({ ...input, organizationId: 'injected' }).success).toBe(
      false,
    );
    expect(createActionSchema.safeParse({ ...input, expectedRiskVersion: undefined }).success).toBe(
      false,
    );
  });
  it.each(['true,false', ['true', 'false'], true, '1'])(
    'rejects ambiguous boolean filter %j',
    (openOnly) => {
      expect(actionListQuerySchema.safeParse({ openOnly }).success).toBe(false);
    },
  );
  it.each([
    { page: ['1', '2'] },
    { page: '1.0' },
    { page: '1e2' },
    { pageSize: '101' },
    { foreign: 'x' },
    { q: ['x', 'y'] },
  ])('rejects duplicate, unknown or malformed query %j', (query) => {
    expect(actionListQuerySchema.safeParse(query).success).toBe(false);
  });
  it('requires implementation report and refuses empty edits', () => {
    expect(
      updateActionSchema.safeParse({ expectedVersion: 1, changeReason: 'Motivo fictício' }).success,
    ).toBe(false);
    expect(
      updateActionSchema.safeParse({
        expectedVersion: 1,
        changeReason: 'Motivo fictício',
        status: 'IMPLEMENTED',
      }).success,
    ).toBe(false);
  });
  it('requires full operational totals', () => {
    expect(
      actionOverviewSchema.safeParse({
        organizationId: '11111111-1111-4111-8111-111111111111',
        generatedAt: '2026-10-21T00:00:00Z',
        referenceDate: '2026-10-21',
        timeZone: '+05:30',
        totals: {
          total: 2,
          planned: 1,
          inProgress: 1,
          implemented: 0,
          cancelled: 0,
          open: 2,
          overdue: 3,
        },
      }).success,
    ).toBe(false);
  });
  it('parses the multipart version without accepting duplicate field arrays', () => {
    expect(
      uploadEvidenceSchema.parse({ description: 'Documento fictício', expectedVersion: '1' })
        .expectedVersion,
    ).toBe(1);
    expect(
      uploadEvidenceSchema.safeParse({
        description: 'Documento fictício',
        expectedVersion: ['1', '2'],
      }).success,
    ).toBe(false);
  });
});
