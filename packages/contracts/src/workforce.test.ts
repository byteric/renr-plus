import { describe, expect, it } from 'vitest';
import * as contracts from './index';
const id = '11111111-1111-4111-8111-111111111111';
describe('Employee and group contracts', () => {
  it('accepts minimum registration and rejects personal health/payroll identifiers', () => {
    expect(
      contracts.createEmployeeSchema.parse({ name: 'Pessoa teste', unitId: id, sectorId: id }),
    ).toEqual({ name: 'Pessoa teste', unitId: id, sectorId: id });
    expect(
      contracts.createEmployeeSchema.safeParse({
        name: 'Pessoa teste',
        unitId: id,
        sectorId: id,
        cpf: '123',
      }).success,
    ).toBe(false);
  });
  it('requires a version and real mutation, and forbids moving a group sector', () => {
    expect(contracts.updateEmployeeSchema.safeParse({ isActive: false }).success).toBe(false);
    expect(contracts.updateEmployeeSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(
      contracts.updateAssessmentGroupSchema.safeParse({ version: 1, sectorId: id }).success,
    ).toBe(false);
  });
  it('parses false literally without changing legacy pagination', () => {
    expect(
      contracts.employeeQuerySchema.parse({ isActive: 'false', search: ' Test ' }),
    ).toMatchObject({ isActive: false, search: 'Test', page: 1 });
    expect(contracts.paginationSchema.safeParse({ search: 'Test' }).success).toBe(false);
  });
});
