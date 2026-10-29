import { describe, expect, it } from 'vitest';
import { createActionSchema, actionListQuerySchema } from './actions';
import {
  actionAssignmentChangeSchema,
  actionAssignmentSchema,
  actionExecutionSchema,
  actionWorkspaceQuerySchema,
  createAssignedActionSchema,
} from './action-workspaces';

const userId = '10000000-0000-4000-8000-000000000001';
const create = {
  title: 'Medida operacional',
  description: 'Descrição da medida operacional',
  responsibleName: 'Responsável externo',
  dueDate: '2027-01-10',
  expectedResult: 'Resultado operacional esperado',
  verificationCriterion: 'Critério observável de verificação',
  expectedRiskVersion: 1,
};

describe('assigned action boundaries', () => {
  it('keeps nominal responsibility and assignment optional without changing the legacy payload', () => {
    expect(createAssignedActionSchema.parse(create)).toEqual(create);
    expect(createAssignedActionSchema.parse({ ...create, assignedUserId: userId })).toEqual({
      ...create,
      assignedUserId: userId,
    });
    expect(createAssignedActionSchema.safeParse({ ...create, responsibleName: '' }).success).toBe(
      false,
    );
    expect(createActionSchema.safeParse({ ...create, assignedUserId: userId }).success).toBe(false);
  });

  it('accepts only the authenticated personal scope and refuses ambiguous or injected filters', () => {
    expect(actionWorkspaceQuerySchema.parse({ assignedTo: 'me', pageSize: '1' })).toEqual({
      assignedTo: 'me',
      page: 1,
      pageSize: 1,
    });
    for (const query of [
      { assignedTo: userId },
      { assignedTo: ['me', 'me'] },
      { assignedTo: 'me', userId },
      { assignedTo: 'me', page: ['1', '2'] },
    ])
      expect(actionWorkspaceQuerySchema.safeParse(query).success).toBe(false);
    expect(actionListQuerySchema.safeParse({ assignedTo: 'me' }).success).toBe(false);
  });

  it('limits execution to real operational transitions with a report only when implemented', () => {
    const start = {
      expectedVersion: 1,
      status: 'IN_PROGRESS',
      changeReason: 'Início operacional registrado',
    };
    expect(actionExecutionSchema.safeParse(start).success).toBe(true);
    expect(actionExecutionSchema.safeParse({ ...start, status: 'IMPLEMENTED' }).success).toBe(
      false,
    );
    const report = 'Execução realizada conforme a medida descrita.';
    expect(
      actionExecutionSchema.safeParse({
        ...start,
        status: 'IMPLEMENTED',
        implementationNote: report,
      }).success,
    ).toBe(true);
    expect(actionExecutionSchema.safeParse({ ...start, implementationNote: report }).success).toBe(
      false,
    );
    for (const injection of [
      { status: 'CANCELLED' },
      { assignedUserId: userId },
      { title: 'Alteração de gestão' },
      { effective: true },
    ])
      expect(actionExecutionSchema.safeParse({ ...start, ...injection }).success).toBe(false);
  });

  it('requires a version and meaningful reason for assignment and permits explicit removal', () => {
    const removal = {
      expectedVersion: 2,
      assignedUserId: null,
      changeReason: 'Responsabilidade reorganizada',
    };
    expect(actionAssignmentSchema.parse(removal)).toEqual(removal);
    for (const invalid of [
      { ...removal, expectedVersion: undefined },
      { ...removal, changeReason: ' ' },
      { ...removal, assignedName: 'Injected' },
    ])
      expect(actionAssignmentSchema.safeParse(invalid).success).toBe(false);
  });

  it('records explicit previous and next people without fabricating an absent assignment', () => {
    const next = { userId, name: 'Nome registrado' };
    expect(actionAssignmentChangeSchema.parse({ previous: null, next })).toEqual({
      previous: null,
      next,
    });
    expect(actionAssignmentChangeSchema.parse({ previous: next, next: null })).toEqual({
      previous: next,
      next: null,
    });
    expect(actionAssignmentChangeSchema.safeParse({ next }).success).toBe(false);
    expect(
      actionAssignmentChangeSchema.safeParse({ previous: null, next: { ...next, role: 'ADMIN' } })
        .success,
    ).toBe(false);
  });
});
