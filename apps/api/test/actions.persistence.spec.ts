import 'dotenv/config';
import { PrismaService } from '../src/database/prisma.service';
import { parseEnvironment } from '../src/config/env';
import { localDatabaseUrl } from './local-database-url';

const describeDatabase = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
describeDatabase('Action additive persistence', () => {
  const env = parseEnvironment({ ...process.env, NODE_ENV: 'test' });
  localDatabaseUrl(env.DATABASE_URL);
  const db = new PrismaService(env);
  afterAll(async () => db.onApplicationShutdown());
  it('has action, immutable revisions and separate evidence persistence', async () => {
    const rows = await db.client.$queryRaw<
      Array<{ table_name: string }>
    >`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('actions','action_revisions','action_evidence')`;
    expect(rows.map((row) => row.table_name).sort()).toEqual([
      'action_evidence',
      'action_revisions',
      'actions',
    ]);
  });
});
