import { describe, expect, it } from 'vitest';
import * as contracts from './index';
import type { z } from 'zod';

const schemas = contracts as unknown as Record<string, z.ZodType>;
const sectorId = '00000000-0000-4000-8000-000000000001';
const registered = {
  sectorId,
  factor: ' Sobrecarga ',
  status: 'REGISTERED',
  description: 'Descrição do contexto',
  exposureDescription: 'Exposição persistente',
  exposedGroupDescription: 'Equipe técnica',
  possibleHarms: 'Fadiga relatada',
  existingControls: 'Pausas previstas',
  sourceKind: 'TECHNICAL_RECORD',
  sourceNote: 'Registro técnico preliminar',
  diagnosticCycleId: null,
};
const parse = (name: string, input: unknown) =>
  schemas[name]?.safeParse(input) ?? { success: false };

describe('risk contracts', () => {
  it('accepts a complete registered risk and trims its factor', () => {
    const result = parse('createRiskSchema', registered);
    expect(result.success).toBe(true);
    if (result.success) expect((result.data as { factor: string }).factor).toBe('Sobrecarga');
  });
  it('normalizes pending draft text to null', () => {
    const result = parse('createRiskSchema', { sectorId, factor: 'Fator', description: '  ' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toMatchObject({ status: 'DRAFT', description: null });
  });
  it.each([
    { ...registered, description: '' },
    { ...registered, exposureDescription: 'curta' },
    { ...registered, sourceNote: '' },
    { ...registered, diagnosticCycleId: sectorId },
    { ...registered, organizationId: sectorId },
    { ...registered, authorId: sectorId },
    { ...registered, status: 'ARCHIVED' },
    { ...registered, sourceKind: 'DIAGNOSTIC_CYCLE', diagnosticCycleId: null },
  ])('rejects incomplete, incoherent or client-owned registration fields', (input) => {
    expect(parse('createRiskSchema', input).success).toBe(false);
  });
  it('validates optimistic versions and immutable sector in patches', () => {
    expect(parse('updateRiskSchema', { expectedVersion: 1, status: 'ARCHIVED' }).success).toBe(
      true,
    );
    for (const input of [
      { factor: 'Novo' },
      { expectedVersion: 0 },
      { expectedVersion: 1 },
      { expectedVersion: 1, sectorId },
      { expectedVersion: 2147483648, factor: 'Novo' },
    ]) {
      expect(parse('updateRiskSchema', input).success).toBe(false);
    }
  });
  it('accepts bounded filters and preliminary evaluation without scores', () => {
    expect(parse('riskListQuerySchema', { evaluationPresence: 'WITHOUT', page: '2' }).success).toBe(
      true,
    );
    const evaluation = {
      expectedVersion: 1,
      methodReference: 'Registro técnico',
      methodVersion: '1',
      observation: 'Observação preliminar',
      rationale: 'Justificativa contextual',
    };
    expect(parse('createPreliminaryEvaluationSchema', evaluation).success).toBe(true);
    expect(parse('createPreliminaryEvaluationSchema', { ...evaluation, score: 4 }).success).toBe(
      false,
    );
  });
  it.each([
    { q: 'x'.repeat(121) },
    { status: 'APPROVED' },
    { evaluationPresence: 'NONE' },
    { pageSize: 101 },
    { sectorId: 'invalid' },
  ])('rejects invalid filters: %j', (query) => {
    expect(parse('riskListQuerySchema', query).success).toBe(false);
  });
});
