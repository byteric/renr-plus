import { assessmentComparisonQuerySchema, type AssessmentComparisonQuery } from '@renr/contracts';

export function comparisonQuery(pair: AssessmentComparisonQuery) {
  const query = new URLSearchParams({
    referenceCycleId: pair.referenceCycleId,
    currentCycleId: pair.currentCycleId,
  });
  if (pair.unitId) query.set('unitId', pair.unitId);
  if (pair.sectorId) query.set('sectorId', pair.sectorId);
  return query;
}

export function comparisonHash(pair: AssessmentComparisonQuery) {
  return `#/coletas?view=comparison&${comparisonQuery(pair)}`;
}

/** Permit only a recognized internal comparison URL as a detail return target. */
export function comparisonReturn(hash: string) {
  const match = /^#\/coletas\?([^#]*)$/.exec(hash);
  if (!match) return null;
  const query = new URLSearchParams(match[1]);
  if (query.get('view') !== 'comparison') return null;
  query.delete('view');
  const pair = assessmentComparisonQuerySchema.safeParse(Object.fromEntries(query));
  return pair.success ? comparisonHash(pair.data) : null;
}
