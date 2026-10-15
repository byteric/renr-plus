import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as contracts from './index';

const id = '00000000-0000-4000-8000-000000000001';
const option = '00000000-0000-4000-8000-000000000002';
const cycle = {
  name: 'Ciclo demonstrativo',
  sectorId: id,
  instrumentVersionId: id,
  startsAt: '2026-10-13T09:00:00.000Z',
  endsAt: '2026-10-15T23:00:00.000Z',
};
function accepts(name: string, value: unknown): boolean {
  const schema: unknown = Reflect.get(contracts, name);
  return schema instanceof z.ZodType && schema.safeParse(value).success;
}

describe('fronteiras do diagnóstico demonstrativo', () => {
  it('aceita criação completa e rejeita empresa ou proprietário controlados pelo cliente', () => {
    expect(accepts('createDiagnosticCycleSchema', cycle)).toBe(true);
    expect(accepts('createDiagnosticCycleSchema', { ...cycle, organizationId: id })).toBe(false);
    expect(accepts('createDiagnosticCycleSchema', { ...cycle, ownerId: id })).toBe(false);
  });
  it('exige um período crescente e identificadores válidos', () => {
    expect(accepts('createDiagnosticCycleSchema', { ...cycle, endsAt: cycle.startsAt })).toBe(
      false,
    );
    expect(accepts('createDiagnosticCycleSchema', { ...cycle, sectorId: 'outro' })).toBe(false);
  });
  it('limita emissão de convites e aceita um convite por padrão', () => {
    expect(accepts('createParticipationInvitesSchema', {})).toBe(true);
    expect(accepts('createParticipationInvitesSchema', { count: 20 })).toBe(true);
    expect(accepts('createParticipationInvitesSchema', { count: 21 })).toBe(false);
    expect(accepts('createParticipationInvitesSchema', { count: 0 })).toBe(false);
  });
  it('aceita credencial somente em corpo estrito sem identidade do participante', () => {
    const access = { inviteCode: 'a'.repeat(43) };
    expect(accepts('participationAccessSchema', access)).toBe(true);
    expect(accepts('participationAccessSchema', { ...access, email: 'pessoa@example.com' })).toBe(
      false,
    );
    expect(accepts('participationAccessSchema', { inviteCode: 'curto' })).toBe(false);
  });
  it('aceita escolhas tipadas sem texto livre ou identificador individual', () => {
    const submission = {
      inviteCode: 'a'.repeat(43),
      instrumentVersionId: id,
      answers: [{ questionId: id, optionIds: [option] }],
    };
    expect(accepts('submitDiagnosticResponseSchema', submission)).toBe(true);
    expect(accepts('submitDiagnosticResponseSchema', { ...submission, userId: id })).toBe(false);
    expect(
      accepts('submitDiagnosticResponseSchema', {
        ...submission,
        answers: [{ questionId: id, optionIds: [option], text: 'identificador' }],
      }),
    ).toBe(false);
  });
  it('rejeita perguntas repetidas e escolhas vazias ou duplicadas', () => {
    const answer = { questionId: id, optionIds: [option] };
    const submission = { inviteCode: 'a'.repeat(43), instrumentVersionId: id, answers: [answer] };
    expect(
      accepts('submitDiagnosticResponseSchema', { ...submission, answers: [answer, answer] }),
    ).toBe(false);
    expect(
      accepts('submitDiagnosticResponseSchema', {
        ...submission,
        answers: [{ questionId: id, optionIds: [] }],
      }),
    ).toBe(false);
    expect(
      accepts('submitDiagnosticResponseSchema', {
        ...submission,
        answers: [{ questionId: id, optionIds: [option, option] }],
      }),
    ).toBe(false);
  });
  it('não aceita contagens em um resultado abaixo do limiar', () => {
    const result = {
      cycleId: id,
      availability: 'INSUFFICIENT_RESPONSES',
      responseCount: null,
      minimumResponses: 5,
      questions: [],
    };
    expect(accepts('diagnosticResultsSchema', result)).toBe(true);
    expect(accepts('diagnosticResultsSchema', { ...result, responseCount: 4 })).toBe(false);
  });
  it('confirma o envio sem devolver identificador de resposta', () => {
    expect(accepts('diagnosticSubmissionSchema', { status: 'accepted' })).toBe(true);
    expect(accepts('diagnosticSubmissionSchema', { status: 'accepted', responseId: id })).toBe(
      false,
    );
  });
});
