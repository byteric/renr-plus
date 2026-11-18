import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  createEmployeeSchema,
  type EmployeeImportPreview,
  type EmployeeImportResult,
} from '@renr/contracts';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { readEmployeeWorkbook, type EmployeeWorkbookRow } from './employee-workbook';

type Scope = { userId: string; organizationId: string };
type Upload = Parameters<typeof readEmployeeWorkbook>[0];
type RowStatus = EmployeeImportPreview['rows'][number];
const previewLifetimeMs = 15 * 60 * 1000;
const normalizeName = (name: string) => name.trim().toLowerCase();
export const normalizeEmployeeIdentifier = (identifier: string) =>
  identifier.normalize('NFKC').toLowerCase();
type PreparedEmployee = {
  name: string;
  internalIdentifier: string;
  normalizedIdentifier: string;
  unitId: string;
  sectorId: string;
};
type ClassifiedRow = {
  result: RowStatus;
  employee?: PreparedEmployee;
  existing?: { id: string; version: number };
};

async function classify(
  tx: Prisma.TransactionClient,
  scope: Scope,
  workbook: EmployeeWorkbookRow[],
): Promise<ClassifiedRow[]> {
  const { organizationId, userId } = scope;
  const member = await tx.membership.findFirst({
    where: { organizationId, userId, isActive: true, organization: { isActive: true } },
    select: { role: true },
  });
  if (!member) throw new NotFoundException();
  if (member.role !== 'ADMIN') throw new ForbiddenException();

  const identifiers = new Map<string, number>();
  const units = new Set<string>();
  const sectors = new Set<string>();
  const prepared = workbook.map(({ row, cells, extraColumns }) => {
    const messages: string[] = [];
    if (extraColumns) messages.push('Remova as informações em colunas fora do modelo.');
    const identifier = createEmployeeSchema.shape.internalIdentifier.safeParse(cells.Matrícula);
    const name = createEmployeeSchema.shape.name.safeParse(cells.Nome);
    const internalIdentifier = identifier.success ? identifier.data : undefined;
    if (!internalIdentifier) messages.push('Informe a matrícula como texto de 1 a 64 caracteres.');
    if (!name.success) messages.push('Informe o nome como texto de 2 a 120 caracteres.');
    const unit = cells.Unidade ? normalizeName(cells.Unidade) : '';
    const sector = cells.Setor ? normalizeName(cells.Setor) : '';
    if (unit && unit.length <= 120) units.add(unit);
    else messages.push('Informe o nome da unidade como texto.');
    if (sector && sector.length <= 120) sectors.add(sector);
    else messages.push('Informe o nome do setor como texto.');
    const normalizedIdentifier = internalIdentifier
      ? normalizeEmployeeIdentifier(internalIdentifier)
      : undefined;
    if (normalizedIdentifier)
      identifiers.set(normalizedIdentifier, (identifiers.get(normalizedIdentifier) ?? 0) + 1);
    return { row, internalIdentifier, normalizedIdentifier, name, unit, sector, messages };
  });
  const unitRecords = await tx.unit.findMany({
    where: { organizationId, isActive: true, normalizedName: { in: [...units] } },
    select: {
      id: true,
      normalizedName: true,
      sectors: {
        where: { organizationId, isActive: true, normalizedName: { in: [...sectors] } },
        select: { id: true, normalizedName: true },
      },
    },
  });
  const employeeRecords = await tx.employee.findMany({
    where: { organizationId, normalizedIdentifier: { in: [...identifiers.keys()] } },
    select: { id: true, normalizedIdentifier: true, version: true },
  });
  const unitsByName = new Map(
    unitRecords.map((unit) => [
      unit.normalizedName,
      {
        id: unit.id,
        sectors: new Map(unit.sectors.map((sector) => [sector.normalizedName, sector.id])),
      },
    ]),
  );
  const employeesByIdentifier = new Map(
    employeeRecords.map(({ normalizedIdentifier, ...employee }) => [
      normalizedIdentifier,
      employee,
    ]),
  );

  return prepared.map(
    ({ row, internalIdentifier, normalizedIdentifier, name, unit, sector, messages }) => {
      const unitRecord = unitsByName.get(unit);
      const sectorId = unitRecord?.sectors.get(sector);
      if (unit && unit.length <= 120 && !unitRecord)
        messages.push('A unidade não está ativa ou não pertence à empresa.');
      if (unitRecord && sector && sector.length <= 120 && !sectorId)
        messages.push('O setor não está ativo ou não pertence à unidade indicada.');
      if (normalizedIdentifier && (identifiers.get(normalizedIdentifier) ?? 0) > 1)
        messages.push('A matrícula aparece mais de uma vez nesta planilha.');
      if (
        messages.length ||
        !internalIdentifier ||
        !normalizedIdentifier ||
        !name.success ||
        !unitRecord ||
        !sectorId
      )
        return { result: { row, status: 'INVALID', messages } };
      const employee = {
        name: name.data,
        internalIdentifier,
        normalizedIdentifier,
        unitId: unitRecord.id,
        sectorId,
      };
      const existing = employeesByIdentifier.get(normalizedIdentifier);
      if (existing)
        return {
          result: { row, status: 'EXISTING', messages: ['Cadastro existente será mantido.'] },
          employee,
          existing,
        };
      return { result: { row, status: 'READY', messages: [] }, employee };
    },
  );
}

export class EmployeeImports {
  private readonly signingKey = randomBytes(32);

  constructor(private readonly database: PrismaService) {}

  private sign(scope: Scope, expires: number, fileDigest: string, rows: ClassifiedRow[]): Buffer {
    return createHmac('sha256', this.signingKey)
      .update(JSON.stringify([scope.organizationId, scope.userId, expires, fileDigest, rows]))
      .digest();
  }

  async preview(scope: Scope, file: Upload): Promise<EmployeeImportPreview> {
    const workbook = await readEmployeeWorkbook(file);
    const fileDigest = createHash('sha256').update(file!.buffer).digest('hex');
    const classified = await this.database.client.$transaction(
      (tx) => classify(tx, scope, workbook),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const expires = Date.now() + previewLifetimeMs;
    const version = `${expires}.${this.sign(scope, expires, fileDigest, classified).toString('base64url')}`;
    const rows = classified.map(({ result }) => result);
    return {
      version,
      total: rows.length,
      ready: rows.filter(({ status }) => status === 'READY').length,
      existing: rows.filter(({ status }) => status === 'EXISTING').length,
      invalid: rows.filter(({ status }) => status === 'INVALID').length,
      rows,
    };
  }

  async confirm(scope: Scope, file: Upload, version: string): Promise<EmployeeImportResult> {
    const [timestamp, signature] = version.split('.');
    const expires = Number(timestamp);
    if (!signature || !Number.isSafeInteger(expires) || expires <= Date.now())
      throw new ConflictException();
    const workbook = await readEmployeeWorkbook(file);
    const fileDigest = createHash('sha256').update(file!.buffer).digest('hex');
    const supplied = Buffer.from(signature, 'base64url');
    try {
      return await this.database.client.$transaction(
        async (tx) => {
          const { organizationId, userId } = scope;
          // Match the lock used by manual workforce writes and check every row again inside it.
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId}))::text`;
          const classified = await classify(tx, scope, workbook);
          const expected = this.sign(scope, expires, fileDigest, classified);
          if (
            expires <= Date.now() ||
            supplied.length !== expected.length ||
            !timingSafeEqual(supplied, expected) ||
            classified.some(({ result }) => result.status === 'INVALID')
          )
            throw new ConflictException();
          const employees = classified.flatMap(({ result, employee }) =>
            result.status === 'READY' && employee ? [{ ...employee, organizationId }] : [],
          );
          if (!employees.length) throw new ConflictException();
          const { count: created } = await tx.employee.createMany({ data: employees });
          const skipped = classified.length - employees.length;
          await tx.auditEvent.create({
            data: {
              organizationId,
              actorId: userId,
              resourceId: organizationId,
              resourceType: 'organization',
              action: 'EMPLOYEE_IMPORT',
              reason: `Cadastros criados: ${created}. Cadastros existentes mantidos: ${skipped}.`,
            },
          });
          return { created, skipped };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2003', 'P2034'].includes(error.code)
      )
        throw new ConflictException();
      throw error;
    }
  }
}
