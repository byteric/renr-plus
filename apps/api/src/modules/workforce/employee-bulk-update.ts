import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  createEmployeeSchema,
  employeeBulkUpdateHistorySchema,
  type EmployeeBulkUpdateHistory,
  type EmployeeBulkUpdatePreview,
  type EmployeeBulkUpdateResult,
  type EmployeeBulkUpdateStatus,
} from '@renr/contracts';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { assertContractAccessAllowed } from '../commercial/contract-access';
import { normalizeEmployeeIdentifier } from './employee-import';
import {
  employeeWorkbookFileLimit,
  readEmployeeWorkbook,
  type EmployeeWorkbookRow,
} from './employee-workbook';

type Scope = { organizationId: string; userId: string };
type Upload = Parameters<typeof readEmployeeWorkbook>[0];
type PreviewRow = EmployeeBulkUpdatePreview['rows'][number];
type PreviewFields = NonNullable<PreviewRow['before']>;
type Change = {
  id: string;
  version: number;
  before: PreviewFields;
  after: PreviewFields;
  sourceUnitId: string;
  sourceSectorId: string;
  unitId: string;
  sectorId: string;
};
type ClassifiedRow = { result: PreviewRow; change?: Change };
type Unit = { id: string; name: string; normalizedName: string; isActive: boolean };
type Sector = Unit & { unitId: string };
const lifetimeMs = 15 * 60 * 1000;
const expiredReceiptRetentionMs = 24 * 60 * 60 * 1000;
// Changing matching or blank-cell rules invalidates previews from an older build.
const rulesVersion = 'employee-bulk-update/v1';
const digest = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

function preparedRows(workbook: EmployeeWorkbookRow[]) {
  const column = (value: string | null | undefined, label: string, messages: string[]) => {
    const name = value?.trim();
    if (value === null || (name !== undefined && name.length > 120)) {
      messages.push(`Informe ${label} como texto do modelo.`);
      return undefined;
    }
    return name?.toLowerCase() || undefined;
  };
  return workbook.map(({ row, cells, extraColumns }) => {
    const messages: string[] = [];
    if (extraColumns) messages.push('Remova as informações em colunas fora do modelo.');
    const identifier = createEmployeeSchema.shape.internalIdentifier.safeParse(cells.Matrícula);
    const normalized =
      identifier.success && identifier.data
        ? normalizeEmployeeIdentifier(identifier.data)
        : undefined;
    if (!normalized) messages.push('Informe a matrícula como texto de 1 a 64 caracteres.');
    const name = createEmployeeSchema.shape.name.safeParse(cells.Nome);
    if (cells.Nome !== undefined && !name.success)
      messages.push('Informe o nome como texto de 2 a 120 caracteres ou deixe a célula vazia.');
    const unit = column(cells.Unidade, 'a unidade', messages);
    const sector = column(cells.Setor, 'o setor', messages);
    const preserved: PreviewRow['preserved'] = [];
    if (cells.Nome === undefined) preserved.push('name');
    if (cells.Unidade === undefined) preserved.push('unit');
    if (cells.Setor === undefined) preserved.push('sector');
    return {
      row,
      normalized,
      name: name.success ? name.data : undefined,
      unit,
      sector,
      messages,
      preserved,
    };
  });
}

async function classify(
  tx: Prisma.TransactionClient,
  organizationId: string,
  workbook: EmployeeWorkbookRow[],
  lock: boolean,
): Promise<ClassifiedRow[]> {
  const prepared = preparedRows(workbook);
  const identifiers = new Map<string, number>();
  for (const { normalized } of prepared)
    if (normalized) identifiers.set(normalized, (identifiers.get(normalized) ?? 0) + 1);
  const employees = await tx.employee.findMany({
    where: { organizationId, normalizedIdentifier: { in: [...identifiers.keys()] } },
    select: {
      id: true,
      name: true,
      unitId: true,
      sectorId: true,
      version: true,
      normalizedIdentifier: true,
    },
  });
  const rowLock = lock ? Prisma.sql`FOR SHARE` : Prisma.empty;
  const unitNames = [...new Set(prepared.flatMap(({ unit }) => (unit ? [unit] : [])))];
  const sectorNames = [...new Set(prepared.flatMap(({ sector }) => (sector ? [sector] : [])))];
  const units = await tx.$queryRaw<Unit[]>`
    SELECT id, name, normalized_name AS "normalizedName", is_active AS "isActive"
    FROM units WHERE organization_id = ${organizationId}::uuid AND
      (normalized_name = ANY(${unitNames}::text[]) OR id = ANY(${employees.map(({ unitId }) => unitId)}::uuid[]))
    ORDER BY id ${rowLock}
  `;
  const sectors = await tx.$queryRaw<Sector[]>`
    SELECT id, unit_id AS "unitId", name, normalized_name AS "normalizedName", is_active AS "isActive"
    FROM sectors WHERE organization_id = ${organizationId}::uuid AND unit_id = ANY(${units.map(({ id }) => id)}::uuid[]) AND
      (normalized_name = ANY(${sectorNames}::text[]) OR id = ANY(${employees.map(({ sectorId }) => sectorId)}::uuid[]))
    ORDER BY id ${rowLock}
  `;
  const people = new Map(employees.map((employee) => [employee.normalizedIdentifier, employee]));
  const unitById = new Map(units.map((item) => [item.id, item]));
  const unitByName = new Map(
    units.filter((item) => item.isActive).map((item) => [item.normalizedName, item]),
  );
  const sectorById = new Map(sectors.map((item) => [item.id, item]));
  const sectorByName = new Map(
    sectors
      .filter((item) => item.isActive)
      .map((item) => [`${item.unitId}/${item.normalizedName}`, item]),
  );

  return prepared.map(({ row, normalized, name, unit, sector, messages, preserved }) => {
    const invalid = (): ClassifiedRow => ({
      result: { row, status: 'INVALID', messages, before: null, after: null, preserved },
    });
    if (normalized && (identifiers.get(normalized) ?? 0) > 1)
      messages.push('A matrícula aparece mais de uma vez nesta planilha.');
    if (messages.length || !normalized) return invalid();
    const current = people.get(normalized);
    if (!current) {
      messages.push('Matrícula não encontrada nos cadastros desta empresa.');
      return invalid();
    }
    const oldUnit = unitById.get(current.unitId);
    const oldSector = sectorById.get(current.sectorId);
    const nextUnit = unit ? unitByName.get(unit) : oldUnit;
    if (!nextUnit || ((unit || sector) && !nextUnit.isActive))
      messages.push('A unidade indicada não está disponível nesta empresa.');
    const nextSector =
      sector && nextUnit ? sectorByName.get(`${nextUnit.id}/${sector}`) : oldSector;
    if (
      nextUnit &&
      (!nextSector ||
        nextSector.unitId !== nextUnit.id ||
        ((unit || sector) && !nextSector.isActive))
    )
      messages.push(
        'Informe um setor ativo da unidade de destino. Célula vazia mantém o setor atual.',
      );
    if (messages.length || !oldUnit || !oldSector || !nextUnit || !nextSector) return invalid();
    const before = { name: current.name, unitName: oldUnit.name, sectorName: oldSector.name };
    const after = {
      name: name ?? current.name,
      unitName: nextUnit.name,
      sectorName: nextSector.name,
    };
    const changed =
      before.name !== after.name ||
      current.unitId !== nextUnit.id ||
      current.sectorId !== nextSector.id;
    return {
      result: { row, status: changed ? 'READY' : 'UNCHANGED', messages, before, after, preserved },
      change: {
        id: current.id,
        version: current.version,
        before,
        after,
        sourceUnitId: current.unitId,
        sourceSectorId: current.sectorId,
        unitId: nextUnit.id,
        sectorId: nextSector.id,
      },
    };
  });
}

async function assertAdministrator(tx: Prisma.TransactionClient, scope: Scope): Promise<number> {
  const { organizationId, userId } = scope;
  await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR SHARE`;
  await tx.$queryRaw`SELECT user_id FROM memberships
    WHERE organization_id = ${organizationId}::uuid AND user_id = ${userId}::uuid FOR SHARE`;
  const member = await tx.membership.findFirst({
    where: { organizationId, userId, isActive: true, organization: { isActive: true } },
    select: { role: true, scopeRestricted: true, version: true },
  });
  if (!member) throw new NotFoundException();
  await assertContractAccessAllowed(tx, organizationId);
  if (member.role !== 'ADMIN' || member.scopeRestricted) throw new ForbiddenException();
  return member.version;
}

async function assertSession(tx: Prisma.TransactionClient, sessionId: string, scope: Scope) {
  const rows = await tx.$queryRaw<{ activeOrganizationId: string | null; expiresAt: Date }[]>`
    SELECT active_organization_id AS "activeOrganizationId", expires_at AS "expiresAt"
    FROM sessions WHERE id = ${sessionId}::uuid AND user_id = ${scope.userId}::uuid FOR SHARE
  `;
  const session = rows[0];
  if (!session || session.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException();
  if (session.activeOrganizationId !== scope.organizationId) throw new NotFoundException();
}

function receipt(row: {
  confirmedAt: Date | null;
  updatedCount: number | null;
  unchangedCount: number | null;
}) {
  return row.confirmedAt && row.updatedCount !== null && row.unchangedCount !== null
    ? { updated: row.updatedCount, unchanged: row.unchangedCount }
    : null;
}

async function loadBatch(tx: Prisma.TransactionClient, scope: Scope, id: string) {
  const batch = await tx.employeeBulkUpdate.findUnique({
    where: { id, organizationId: scope.organizationId, actorId: scope.userId },
  });
  if (!batch) throw new NotFoundException();
  return batch;
}

async function saveChanges(
  tx: Prisma.TransactionClient,
  organizationId: string,
  batchId: string,
  changes: Change[],
) {
  const writes = changes.map(({ id, version, after, unitId, sectorId }) => ({
    id,
    version,
    name: after.name,
    unit_id: unitId,
    sector_id: sectorId,
  }));
  const updated = await tx.$executeRaw`
    UPDATE employees AS e SET name = p.name, unit_id = p.unit_id, sector_id = p.sector_id,
      version = e.version + 1, updated_at = CURRENT_TIMESTAMP
    FROM jsonb_to_recordset(${JSON.stringify(writes)}::jsonb)
      AS p(id uuid, version integer, name text, unit_id uuid, sector_id uuid)
    WHERE e.organization_id = ${organizationId}::uuid AND e.id = p.id AND e.version = p.version
  `;
  if (updated !== changes.length) throw new ConflictException();
  await tx.employeeRegistrationRevision.createMany({
    data: changes.map(({ id, version, before, after }) => ({
      organizationId,
      batchId,
      employeeId: id,
      version: version + 1,
      before,
      after,
    })),
  });
}

export class EmployeeBulkUpdates {
  constructor(private readonly database: PrismaService) {}

  async preview(scope: Scope, file: Upload): Promise<EmployeeBulkUpdatePreview> {
    const workbook = await readEmployeeWorkbook(file);
    return this.database.client.$transaction(async (tx) => {
      const membershipVersion = await assertAdministrator(tx, scope);
      const classified = await classify(tx, scope.organizationId, workbook, false);
      const now = Date.now();
      await tx.employeeBulkUpdate.deleteMany({
        where: {
          organizationId: scope.organizationId,
          actorId: scope.userId,
          confirmedAt: null,
          expiresAt: { lt: new Date(now - expiredReceiptRetentionMs) },
        },
      });
      const batch = await tx.employeeBulkUpdate.create({
        data: {
          organizationId: scope.organizationId,
          actorId: scope.userId,
          fileDigest: digest(file!.buffer),
          proposalDigest: digest(JSON.stringify([rulesVersion, membershipVersion, classified])),
          expiresAt: new Date(now + lifetimeMs),
        },
      });
      const rows = classified.map(({ result }) => result);
      return {
        version: batch.id,
        expiresAt: batch.expiresAt.toISOString(),
        total: rows.length,
        ready: rows.filter(({ status }) => status === 'READY').length,
        unchanged: rows.filter(({ status }) => status === 'UNCHANGED').length,
        invalid: rows.filter(({ status }) => status === 'INVALID').length,
        rows,
      };
    });
  }

  async confirm(
    scope: Scope,
    sessionId: string,
    file: Upload,
    version: string,
  ): Promise<EmployeeBulkUpdateResult> {
    if (!file?.buffer || !file.buffer.length || file.buffer.length > employeeWorkbookFileLimit)
      throw new BadRequestException('Envie o arquivo da prévia.');
    const fileDigest = digest(file.buffer);
    const selected = await loadBatch(this.database.client, scope, version);
    if (fileDigest !== selected.fileDigest) throw new ConflictException();
    // A recorded result needs no parsing. Recheck authorization inside the write transaction.
    const workbook = selected.confirmedAt ? null : await readEmployeeWorkbook(file);
    try {
      return await this.database.client.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${scope.organizationId}))::text`;
        const membershipVersion = await assertAdministrator(tx, scope);
        await assertSession(tx, sessionId, scope);
        const batch = await loadBatch(tx, scope, version);
        if (fileDigest !== batch.fileDigest) throw new ConflictException();
        const previous = receipt(batch);
        if (previous) return previous;
        if (!workbook || batch.expiresAt.getTime() <= Date.now()) throw new ConflictException();
        const classified = await classify(tx, scope.organizationId, workbook, true);
        if (
          classified.some(({ result }) => result.status === 'INVALID') ||
          batch.proposalDigest !==
            digest(JSON.stringify([rulesVersion, membershipVersion, classified])) ||
          batch.expiresAt.getTime() <= Date.now()
        )
          throw new ConflictException();
        const changes = classified.flatMap(({ result, change }) =>
          result.status === 'READY' && change ? [change] : [],
        );
        if (changes.length === 0) throw new ConflictException();
        await saveChanges(tx, scope.organizationId, version, changes);
        const result = { updated: changes.length, unchanged: classified.length - changes.length };
        await tx.employeeBulkUpdate.update({
          where: { id: batch.id },
          data: {
            confirmedAt: new Date(),
            updatedCount: result.updated,
            unchangedCount: result.unchanged,
          },
        });
        await tx.auditEvent.create({
          data: {
            organizationId: scope.organizationId,
            actorId: scope.userId,
            resourceType: 'organization',
            resourceId: scope.organizationId,
            action: 'EMPLOYEE_BULK_UPDATE',
            reason: `Cadastros atualizados: ${result.updated}. Cadastros mantidos: ${result.unchanged}.`,
          },
        });
        return result;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2003', 'P2025', 'P2034'].includes(error.code)
      )
        throw new ConflictException();
      throw error;
    }
  }

  status(scope: Scope, version: string): Promise<EmployeeBulkUpdateStatus> {
    return this.database.client.$transaction(async (tx) => {
      await assertAdministrator(tx, scope);
      const batch = await loadBatch(tx, scope, version);
      const result = receipt(batch);
      return result
        ? { status: 'CONFIRMED', result }
        : { status: batch.expiresAt.getTime() <= Date.now() ? 'EXPIRED' : 'PENDING', result: null };
    });
  }

  history(
    scope: Scope,
    employeeId: string,
    { page, pageSize }: { page: number; pageSize: number },
  ): Promise<EmployeeBulkUpdateHistory> {
    return this.database.client.$transaction(async (tx) => {
      await assertAdministrator(tx, scope);
      if (
        !(await tx.employee.findUnique({
          where: { organizationId_id: { organizationId: scope.organizationId, id: employeeId } },
          select: { id: true },
        }))
      )
        throw new NotFoundException();
      const where = { organizationId: scope.organizationId, employeeId };
      const rows = await tx.employeeRegistrationRevision.findMany({
        where,
        include: { batch: { select: { confirmedAt: true } } },
        orderBy: { version: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
      return employeeBulkUpdateHistorySchema.parse({
        items: rows.map(({ version, batchId, before, after, batch }) => ({
          version,
          batchId,
          before,
          after,
          confirmedAt: batch.confirmedAt?.toISOString(),
        })),
        total: await tx.employeeRegistrationRevision.count({ where }),
        page,
        pageSize,
      });
    });
  }
}
