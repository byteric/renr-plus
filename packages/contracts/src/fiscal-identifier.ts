import { z } from 'zod';

/** Receita Federal/Serpro: ASCII - 48, modulo 11. This is not a registry lookup. */
export function normalizeCnpj(value: string): string {
  return value.replace(/[./\s-]/g, '').toUpperCase();
}
export function validCnpj(value: string): boolean {
  const normalized = normalizeCnpj(value);
  if (!/^[A-Z0-9]{12}[0-9]{2}$/.test(normalized) || /^(\d)\1{13}$/.test(normalized)) return false;
  const digit = (base: string) => {
    let sum = 0,
      weight = 2;
    for (let i = base.length - 1; i >= 0; i--) {
      sum += (base.charCodeAt(i) - 48) * weight;
      weight = weight === 9 ? 2 : weight + 1;
    }
    const remainder = sum % 11;
    return remainder < 2 ? '0' : String(11 - remainder);
  };
  const first = digit(normalized.slice(0, 12));
  return normalized.slice(12) === first + digit(normalized.slice(0, 12) + first);
}
export const fiscalIdentifierInputSchema = z
  .string()
  .trim()
  .max(32)
  .refine(
    (value) => value === '' || validCnpj(value),
    'Informe um CNPJ numérico ou alfanumérico válido.',
  );
export const fiscalStateSchema = z.enum(['MISSING', 'INVALID', 'VALID', 'CONFLICT']);
export const clientClassificationSchema = z.enum(['UNCLASSIFIED', 'CLIENT', 'DEMONSTRATION']);
