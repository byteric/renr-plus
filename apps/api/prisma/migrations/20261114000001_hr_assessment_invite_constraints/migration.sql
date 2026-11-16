BEGIN;

ALTER TABLE memberships
  DROP CONSTRAINT memberships_hr_capabilities_check,
  ADD CONSTRAINT memberships_hr_capabilities_check CHECK (
    hr_capabilities <@ ARRAY[
      'HR_PROFILE_READ', 'HR_PROFILE_MANAGE', 'HR_ANALYTICS_READ',
      'HR_COMPENSATION_READ', 'HR_COMPENSATION_MANAGE', 'HR_EXPORT',
      'HR_ASSESSMENT_INVITES_ISSUE'
    ]::"Capability"[]
  );

ALTER TABLE access_invites
  DROP CONSTRAINT access_invites_hr_capabilities_check,
  ADD CONSTRAINT access_invites_hr_capabilities_check CHECK (
    hr_capabilities <@ ARRAY[
      'HR_PROFILE_READ', 'HR_PROFILE_MANAGE', 'HR_ANALYTICS_READ',
      'HR_COMPENSATION_READ', 'HR_COMPENSATION_MANAGE', 'HR_EXPORT',
      'HR_ASSESSMENT_INVITES_ISSUE'
    ]::"Capability"[]
  );

COMMIT;
