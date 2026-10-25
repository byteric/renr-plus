import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { localDatabaseUrl } from './local-database-url.mjs';
const requireApi = createRequire(resolve('apps/api/package.json'));
const { Pool } = requireApi('pg');
/** Archives one exact local synthetic fixture. Append-only history and shared users survive. */
export async function cleanupAssessmentFixture(organizationId, expectedName) {
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  if (
    !uuid.test(organizationId) ||
    !/^e2e-assessments-[a-f0-9-]{36}$/i.test(expectedName) ||
    !uuid.test(expectedName.slice('e2e-assessments-'.length))
  )
    throw new Error('Refused cleanup outside exact assessment E2E fixture.');
  const database = localDatabaseUrl(process.env.DATABASE_URL ?? '');
  const pool = new Pool({ connectionString: database.href, max: 1 });
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const existing = await db.query(
      'SELECT id FROM organizations WHERE id=$1 AND name=$2 FOR UPDATE',
      [organizationId, expectedName],
    );
    if (existing.rowCount) {
      await db.query(
        'UPDATE organizations SET is_active=false,updated_at=now() WHERE id=$1 AND name=$2',
        [organizationId, expectedName],
      );
      await db.query(
        'UPDATE memberships SET is_active=false,version=version+1,updated_at=now() WHERE organization_id=$1',
        [organizationId],
      );
      await db.query('DELETE FROM sessions WHERE active_organization_id=$1', [organizationId]);
    }
    await db.query('COMMIT');
  } catch {
    await db.query('ROLLBACK');
    throw new Error(
      'Guarded local assessment fixture archival failed; no partial changes retained.',
    );
  } finally {
    db.release();
    await pool.end();
  }
}
