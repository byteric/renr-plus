import type { Capability } from '@renr/contracts';

export type HrCapability = Extract<Capability, `HR_${string}`>;
export type LegacyCapability = Exclude<Capability, HrCapability>;

function isHrCapability(capability: Capability): capability is HrCapability {
  return capability.startsWith('HR_');
}

export function splitCapabilities(capabilities: readonly Capability[]) {
  return {
    capabilities: capabilities.filter((capability) => !isHrCapability(capability)),
    hrCapabilities: capabilities.filter(isHrCapability),
  };
}

export function combineCapabilities(record: {
  capabilities: readonly Capability[];
  hrCapabilities: readonly Capability[];
}): Capability[] {
  return [...record.capabilities, ...record.hrCapabilities];
}
