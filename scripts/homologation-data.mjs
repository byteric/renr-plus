import { provisionDemoInstrument } from './diagnostic-demo-data.mjs';

export async function provisionHomologationData(client, passwordHash) {
  await client.$transaction(async (tx) => {
    const users = [];
    for (const [email, name] of [
      ['admin1@renr.example', 'Admin homologação 1'],
      ['admin2@renr.example', 'Admin homologação 2'],
      ['reader@renr.example', 'Leitor homologação'],
    ]) {
      users.push(
        await tx.user.upsert({
          where: { email },
          update: {},
          create: { email, name, passwordHash },
        }),
      );
    }
    for (const [index, id, name] of [
      [0, '10000000-0000-4000-8000-000000000001', 'Empresa homologação 1'],
      [1, '10000000-0000-4000-8000-000000000002', 'Empresa homologação 2'],
    ]) {
      await tx.organization.upsert({ where: { id }, update: {}, create: { id, name } });
      await provisionDemoInstrument(tx, id);
      await tx.membership.upsert({
        where: { userId_organizationId: { userId: users[index].id, organizationId: id } },
        update: {},
        create: { userId: users[index].id, organizationId: id, role: 'ADMIN' },
      });
      if (index === 0)
        await tx.membership.upsert({
          where: { userId_organizationId: { userId: users[2].id, organizationId: id } },
          update: {},
          create: { userId: users[2].id, organizationId: id, role: 'READER' },
        });
      const unit = await tx.unit.upsert({
        where: {
          organizationId_normalizedName: {
            organizationId: id,
            normalizedName: 'unidade homologação',
          },
        },
        update: {},
        create: {
          organizationId: id,
          name: 'Unidade homologação',
          normalizedName: 'unidade homologação',
        },
      });
      await tx.sector.upsert({
        where: { unitId_normalizedName: { unitId: unit.id, normalizedName: 'setor homologação' } },
        update: {},
        create: {
          organizationId: id,
          unitId: unit.id,
          name: 'Setor homologação',
          normalizedName: 'setor homologação',
        },
      });
    }
  });
}
