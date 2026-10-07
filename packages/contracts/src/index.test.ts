import { describe, expect, it } from 'vitest';
import {
  apiErrorSchema,
  healthResponseSchema,
  loginSchema,
  createOrganizationSchema,
  createUnitSchema,
  updateSectorSchema,
  updateOrganizationSchema,
  paginationSchema,
} from './index';

describe('contratos HTTP compartilhados', () => {
  it('valida a resposta de liveness da API', () => {
    expect(
      healthResponseSchema.safeParse({
        status: 'ok',
        service: 'renr-api',
        timestamp: new Date().toISOString(),
      }).success,
    ).toBe(true);
  });

  it('rejeita resposta incompatível ou incompleta', () => {
    expect(healthResponseSchema.safeParse({ status: 'ok', service: 'outro' }).success).toBe(false);
  });

  it('exige identificador de requisição e status de erro válidos', () => {
    expect(
      apiErrorSchema.safeParse({
        statusCode: 200,
        code: 'OK',
        message: 'x',
        requestId: 'invalid',
        timestamp: new Date().toISOString(),
      }).success,
    ).toBe(false);
  });
  it('normaliza credenciais e mantém senha intacta', () => {
    expect(
      loginSchema.parse({ email: ' ADMIN@renr.example ', password: ' padded password ' }),
    ).toEqual({ email: 'admin@renr.example', password: ' padded password ' });
  });
  it('valida nomes, timezone e rejeita campos de organização no cadastro de unidade', () => {
    expect(createOrganizationSchema.parse({ name: ' Empresa ' })).toEqual({
      name: 'Empresa',
      timezone: 'America/Sao_Paulo',
    });
    expect(createOrganizationSchema.safeParse({ name: 'x' }).success).toBe(false);
    expect(
      createOrganizationSchema.safeParse({ name: 'Empresa', timezone: 'invalid-zone' }).success,
    ).toBe(false);
    expect(
      createUnitSchema.safeParse({ name: 'Unidade', organizationId: 'untrusted' }).success,
    ).toBe(false);
  });
  it('rejeita patches vazios e paginação excessiva', () => {
    expect(updateSectorSchema.safeParse({}).success).toBe(false);
    expect(updateOrganizationSchema.safeParse({}).success).toBe(false);
    expect(updateOrganizationSchema.parse({ name: 'Empresa' })).toEqual({ name: 'Empresa' });
    expect(paginationSchema.parse({ page: '2', pageSize: '100' })).toEqual({
      page: 2,
      pageSize: 100,
    });
    expect(paginationSchema.safeParse({ pageSize: 101 }).success).toBe(false);
    expect(paginationSchema.safeParse({ page: Number.MAX_SAFE_INTEGER }).success).toBe(false);
  });
});
