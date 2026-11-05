import type { PeopleMetric, PeopleDistribution } from '@renr/contracts';
export function suppressedMetric(): PeopleMetric {
  return {
    state: 'SUPPRESSED',
    value: null,
    known: null,
    missing: null,
    explanation: 'Suprimido pela política HR_MIN5_COMPLEMENT_V1.',
  };
}
export function metric(
  value: string | null,
  known: number,
  missing: number,
  explanation: string,
): PeopleMetric {
  if ([known, missing].some((count) => count > 0 && count < 5)) return suppressedMetric();
  return {
    state: value === null ? 'INSUFFICIENT_DATA' : 'KNOWN',
    value,
    known,
    missing,
    explanation,
  };
}
export function distribution(
  key: string,
  label: string,
  buckets: { key: string; label: string; count: number }[],
  protectedPartition = false,
): PeopleDistribution {
  const suppressed =
    protectedPartition || buckets.some((bucket) => bucket.count > 0 && bucket.count < 5);
  return {
    key,
    label,
    state: suppressed ? 'SUPPRESSED' : 'KNOWN',
    items: suppressed ? [] : buckets,
  };
}
