import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createOrganizationSchema, capabilitySchema } from './index';
import { normalizeCnpj, validCnpj } from './fiscal-identifier';

describe('Fiscal identity and explicit HR grants', () => {
  it.each(['00000000000000', '11222333000100', '12ABC34501DE00', '11@222333000181'])(
    'rejects invalid CNPJ %s at the existing organization entrypoint',
    (fiscalIdentifier) => {
      expect(
        createOrganizationSchema.safeParse({ name: 'Example client', fiscalIdentifier }).success,
      ).toBe(false);
    },
  );
  it.each(['11.222.333/0001-81', '11222333000181', '12.ABC.345/01DE-35'])(
    'accepts a valid fiscal identifier without dropping letters or leading zeroes: %s',
    (fiscalIdentifier) => {
      expect(
        createOrganizationSchema.parse({ name: 'Example client', fiscalIdentifier })
          .fiscalIdentifier,
      ).toBe(fiscalIdentifier);
    },
  );
  it('keeps the legacy missing identifier optional', () => {
    expect(
      createOrganizationSchema.safeParse({ name: 'Legacy client', fiscalIdentifier: null }).success,
    ).toBe(true);
  });
  it('preserves identity across accepted presentation and rejects any changed check digit', () => {
    const examples = ['11222333000181', '12ABC34501DE35', '04252011000110'] as const;
    fc.assert(
      fc.property(
        fc.constantFrom(...examples),
        fc.boolean(),
        fc.boolean(),
        fc.integer({ min: 1, max: 9 }),
        (cnpj, masked, lower, digitOffset) => {
          const text = lower ? cnpj.toLowerCase() : cnpj;
          const formatted = masked
            ? ` ${text.slice(0, 2)}.${text.slice(2, 5)}.${text.slice(5, 8)}/${text.slice(8, 12)}-${text.slice(12)} `
            : text;
          expect(normalizeCnpj(formatted)).toBe(cnpj);
          expect(validCnpj(formatted)).toBe(true);
          const invalidLastDigit = (Number(cnpj[13]) + digitOffset) % 10;
          expect(validCnpj(cnpj.slice(0, -1) + invalidLastDigit)).toBe(false);
        },
      ),
    );
  });
  it.each([
    'HR_PROFILE_READ',
    'HR_PROFILE_MANAGE',
    'HR_ANALYTICS_READ',
    'HR_COMPENSATION_READ',
    'HR_COMPENSATION_MANAGE',
    'HR_EXPORT',
  ])('recognizes explicit HR capability %s', (capability) => {
    expect(capabilitySchema.safeParse(capability).success).toBe(true);
  });
});
