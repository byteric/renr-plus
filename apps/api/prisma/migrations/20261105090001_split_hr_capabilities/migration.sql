BEGIN;

ALTER TABLE memberships
  ADD COLUMN hr_capabilities "Capability"[] NOT NULL DEFAULT '{}';
ALTER TABLE access_invites
  ADD COLUMN hr_capabilities "Capability"[] NOT NULL DEFAULT '{}';

-- Preserve the order within each capability family without touching timestamps or versions.
UPDATE memberships
SET
  hr_capabilities = ARRAY(
    SELECT capability
    FROM unnest(capabilities) WITH ORDINALITY AS item(capability, position)
    WHERE capability NOT IN ('EXECUTE_ASSIGNED_ACTIONS', 'TECHNICAL_DECISIONS')
    ORDER BY position
  ),
  capabilities = ARRAY(
    SELECT capability
    FROM unnest(capabilities) WITH ORDINALITY AS item(capability, position)
    WHERE capability IN ('EXECUTE_ASSIGNED_ACTIONS', 'TECHNICAL_DECISIONS')
    ORDER BY position
  )
WHERE NOT capabilities <@ ARRAY['EXECUTE_ASSIGNED_ACTIONS', 'TECHNICAL_DECISIONS']::"Capability"[];

UPDATE access_invites
SET
  hr_capabilities = ARRAY(
    SELECT capability
    FROM unnest(capabilities) WITH ORDINALITY AS item(capability, position)
    WHERE capability NOT IN ('EXECUTE_ASSIGNED_ACTIONS', 'TECHNICAL_DECISIONS')
    ORDER BY position
  ),
  capabilities = ARRAY(
    SELECT capability
    FROM unnest(capabilities) WITH ORDINALITY AS item(capability, position)
    WHERE capability IN ('EXECUTE_ASSIGNED_ACTIONS', 'TECHNICAL_DECISIONS')
    ORDER BY position
  )
WHERE NOT capabilities <@ ARRAY['EXECUTE_ASSIGNED_ACTIONS', 'TECHNICAL_DECISIONS']::"Capability"[];

ALTER TABLE memberships
  ADD CONSTRAINT memberships_legacy_capabilities_check CHECK (
    capabilities <@ ARRAY['EXECUTE_ASSIGNED_ACTIONS', 'TECHNICAL_DECISIONS']::"Capability"[]
  ),
  ADD CONSTRAINT memberships_hr_capabilities_check CHECK (
    hr_capabilities <@ ARRAY[
      'HR_PROFILE_READ', 'HR_PROFILE_MANAGE', 'HR_ANALYTICS_READ',
      'HR_COMPENSATION_READ', 'HR_COMPENSATION_MANAGE', 'HR_EXPORT'
    ]::"Capability"[]
  );

ALTER TABLE access_invites
  ADD CONSTRAINT access_invites_legacy_capabilities_check CHECK (
    capabilities <@ ARRAY['EXECUTE_ASSIGNED_ACTIONS', 'TECHNICAL_DECISIONS']::"Capability"[]
  ),
  ADD CONSTRAINT access_invites_hr_capabilities_check CHECK (
    hr_capabilities <@ ARRAY[
      'HR_PROFILE_READ', 'HR_PROFILE_MANAGE', 'HR_ANALYTICS_READ',
      'HR_COMPENSATION_READ', 'HR_COMPENSATION_MANAGE', 'HR_EXPORT'
    ]::"Capability"[]
  );

COMMIT;
