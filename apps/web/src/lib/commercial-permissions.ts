import type { PlatformCapability } from '@renr/contracts';

export function hasCommercialCatalogAccess(capabilities: PlatformCapability[]) {
  return capabilities.includes('READ_COMMERCIAL') || capabilities.includes('MANAGE_COMMERCIAL');
}

export function hasBillingAccess(capabilities: PlatformCapability[]) {
  return capabilities.includes('READ_BILLING') || capabilities.includes('MANAGE_BILLING');
}

export function hasContractAccessPermission(capabilities: PlatformCapability[]) {
  return (
    capabilities.includes('READ_CONTRACT_ACCESS') || capabilities.includes('MANAGE_CONTRACT_ACCESS')
  );
}

export function hasCommercialAccess(capabilities: PlatformCapability[]) {
  return (
    hasCommercialCatalogAccess(capabilities) ||
    hasBillingAccess(capabilities) ||
    hasContractAccessPermission(capabilities) ||
    hasSupportAccess(capabilities)
  );
}

export function hasSupportAccess(capabilities: PlatformCapability[]) {
  return capabilities.includes('READ_SUPPORT') || capabilities.includes('MANAGE_SUPPORT');
}

export function hasPlatformAdministration(capabilities: PlatformCapability[]) {
  return (
    capabilities.includes('READ_OVERVIEW') ||
    capabilities.includes('MANAGE_CLIENTS') ||
    capabilities.includes('MANAGE_GRANTS')
  );
}
