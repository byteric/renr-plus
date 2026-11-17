import type { Capability } from '@renr/contracts';

const peopleCapabilities: ReadonlySet<Capability> = new Set([
  'HR_PROFILE_READ',
  'HR_PROFILE_MANAGE',
  'HR_ANALYTICS_READ',
  'HR_COMPENSATION_READ',
  'HR_COMPENSATION_MANAGE',
  'HR_EXPORT',
]);

export function hasPeopleAccess(capabilities: readonly Capability[]) {
  return capabilities.some((capability) => peopleCapabilities.has(capability));
}
