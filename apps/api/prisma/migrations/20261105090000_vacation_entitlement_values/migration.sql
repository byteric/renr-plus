-- Preserve any imported historical record and enforce the supported CLT bands on new writes.
ALTER TABLE employee_vacation_periods ADD CONSTRAINT vacation_entitlement_supported
  CHECK (entitlement_days IN (0, 12, 18, 24, 30)) NOT VALID;
