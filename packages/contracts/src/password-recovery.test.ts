import { expect, it } from 'vitest';
import { platformCapabilitiesSchema } from './platform-administration';
import {
  passwordRecoveryConfirmSchema,
  passwordRecoveryIssueSchema,
  passwordRecoveryRequestedSchema,
  passwordRecoveryRequestSchema,
  passwordRecoveryStatusSchema,
} from './password-recovery';

it('representa separadamente as duas concessões explícitas de recuperação', () => {
  expect(
    platformCapabilitiesSchema.safeParse({
      capabilities: ['ASSIST_COMPANY_PASSWORD_RECOVERY', 'MANAGE_PASSWORD_RECOVERY'],
    }).success,
  ).toBe(true);
});

it('normaliza e-mail na solicitação e só expõe confirmação ou disponibilidade', () => {
  expect(passwordRecoveryRequestSchema.parse({ email: ' TITULAR@renr.example ' })).toEqual({
    email: 'titular@renr.example',
  });
  expect(passwordRecoveryRequestedSchema.safeParse({ accepted: true, userId: 'id' }).success).toBe(
    false,
  );
  expect(
    passwordRecoveryStatusSchema.safeParse({ available: false, reason: 'EXPIRED' }).success,
  ).toBe(false);
});

it('exige conferência explícita e referência curta para emitir', () => {
  const input = {
    email: 'titular@renr.example',
    verificationConfirmed: true,
    verificationReference: 'REC-2026_05',
  };
  expect(passwordRecoveryIssueSchema.safeParse(input).success).toBe(true);
  expect(
    passwordRecoveryIssueSchema.safeParse({ ...input, verificationConfirmed: false }).success,
  ).toBe(false);
  expect(
    passwordRecoveryIssueSchema.safeParse({
      ...input,
      verificationReference: 'Contato informado por e-mail',
    }).success,
  ).toBe(false);
});

it('valida o segredo opaco e aplica a política de senha da ativação', () => {
  const source = {
    token: 'A'.repeat(43),
    password: 'Frase fictícia de teste 52',
  };
  expect(passwordRecoveryConfirmSchema.parse(source)).toEqual(source);
  expect(
    passwordRecoveryConfirmSchema.safeParse({ ...source, token: 'A'.repeat(42) }).success,
  ).toBe(false);
  expect(passwordRecoveryConfirmSchema.safeParse({ ...source, password: 'Curta' }).success).toBe(
    false,
  );
  expect(
    passwordRecoveryConfirmSchema.safeParse({ ...source, email: 'outra@renr.example' }).success,
  ).toBe(false);
});
