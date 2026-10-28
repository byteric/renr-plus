import { createHash } from 'node:crypto';
import type { EfficacyOpinion, RiskDetail } from '@renr/contracts';
import { technicalContextFingerprint } from '../technical-evaluations/risk-workspaces.service';

export function hashEfficacyScalars(
  value: Record<string, string | number | boolean | null>,
): string {
  const ordered = Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}

export function efficacyFingerprints(
  snapshot: EfficacyOpinion['actionSnapshot'],
  risk: RiskDetail,
) {
  const actionFingerprint = hashEfficacyScalars({
    title: snapshot.title,
    description: snapshot.description,
    expectedResult: snapshot.expectedResult,
    verificationCriterion: snapshot.verificationCriterion,
    status: snapshot.status,
    implementationNote: snapshot.implementationNote,
    implementedAt: snapshot.implementedAt,
  });
  const riskContextFingerprint = technicalContextFingerprint(risk);
  return {
    actionFingerprint,
    riskContextFingerprint,
    contextFingerprint: hashEfficacyScalars({ actionFingerprint, riskContextFingerprint }),
  };
}
