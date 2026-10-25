import { ConflictException } from '@nestjs/common';
import { DiagnosticsService } from '../src/modules/diagnostics/diagnostics.service';
import { RisksService } from '../src/modules/risks/risks.service';
import type { PrismaService } from '../src/database/prisma.service';
import type { RisksRepository } from '../src/modules/risks/risks.repository';
describe('Inactive assessment groups', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const sector = {
    id: 'sector',
    isActive: true,
    organization: { isActive: true },
    unit: { isActive: true, organizationId: 'org' },
  };
  it('blocks creating risks even when the sector remains active', async () => {
    const tx = {
      $queryRaw: async () => [],
      sector: { findFirst: async () => sector },
      assessmentGroup: { upsert: async () => ({ id: 'group', isActive: false }) },
      risk: {
        create: async () => {
          throw new Error('Inactive group allowed to persist risk');
        },
      },
    };
    const repository = {
      transaction: async (operation: (value: unknown) => unknown) => operation(tx),
    } as unknown as RisksRepository;
    const service = new RisksService(repository);
    await expect(
      service.create({ userId: 'user', organizationId: 'org' }, {
        sectorId: 'sector',
        factor: 'Fator sint�tico',
        status: 'DRAFT',
      } as never),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('serializes risk creation after a pending group deactivation before reading group state', async () => {
    let active = true;
    const tx = {
      $queryRaw: async () => {
        active = false;
        return [];
      },
      sector: { findFirst: async () => sector },
      assessmentGroup: { upsert: async () => ({ id: 'group', isActive: active }) },
      risk: {
        create: async () => {
          throw new Error('Risk persisted before pending deactivation completed');
        },
      },
    };
    const repository = {
      transaction: async (operation: (value: unknown) => unknown) => operation(tx),
    } as unknown as RisksRepository;
    await expect(
      new RisksService(repository).create({ userId: 'user', organizationId: 'org' }, {
        sectorId: 'sector',
        factor: 'Synthetic factor',
        status: 'DRAFT',
      } as never),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('blocks new diagnostic cycles for inactive groups without changing historical records', async () => {
    const instrument = {
      id,
      organizationId: id,
      title: 'Instrument',
      version: 1,
      status: 'PUBLISHED',
      isDemo: true,
      questions: Array.from({ length: 5 }, (_, n) => ({
        id,
        label: 'Question',
        type: 'SINGLE_CHOICE',
        required: true,
        position: n + 1,
        options: [
          { id, label: 'Yes', position: 1 },
          { id, label: 'No', position: 2 },
        ],
      })),
    };
    const tx = {
      $queryRaw: async () => [],
      sector: { findFirst: async () => sector },
      instrumentVersion: { findFirst: async () => instrument },
      assessmentGroup: { upsert: async () => ({ id, isActive: false }) },
      diagnosticCycle: {
        create: async () => {
          throw new Error('Inactive group allowed diagnostic creation');
        },
      },
    };
    const database = {
      client: { $transaction: async (operation: (value: unknown) => unknown) => operation(tx) },
    } as unknown as PrismaService;
    await expect(
      new DiagnosticsService(database).create(
        { userId: id, organizationId: 'org' },
        {
          name: 'Cycle',
          sectorId: id,
          instrumentVersionId: id,
          startsAt: '2026-01-01T00:00:00.000Z',
          endsAt: '2026-02-01T00:00:00.000Z',
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
