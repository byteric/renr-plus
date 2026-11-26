BEGIN;

-- Atomic Capability enum upgrade (avoids PostgreSQL 55P04 unsafe use of new enum value in same tx)
CREATE TYPE "Capability_new" AS ENUM (
  'EXECUTE_ASSIGNED_ACTIONS',
  'TECHNICAL_DECISIONS',
  'PSYCHOLOGY_COLLABORATION',
  'HR_PROFILE_READ',
  'HR_PROFILE_MANAGE',
  'HR_ANALYTICS_READ',
  'HR_COMPENSATION_READ',
  'HR_COMPENSATION_MANAGE',
  'HR_EXPORT',
  'HR_ASSESSMENT_INVITES_ISSUE'
);

ALTER TABLE memberships
  DROP CONSTRAINT memberships_legacy_capabilities_check,
  DROP CONSTRAINT memberships_hr_capabilities_check;

ALTER TABLE access_invites
  DROP CONSTRAINT access_invites_legacy_capabilities_check,
  DROP CONSTRAINT access_invites_hr_capabilities_check;

ALTER TABLE memberships
  ALTER COLUMN capabilities DROP DEFAULT,
  ALTER COLUMN hr_capabilities DROP DEFAULT;

ALTER TABLE access_invites
  ALTER COLUMN capabilities DROP DEFAULT,
  ALTER COLUMN hr_capabilities DROP DEFAULT;

ALTER TABLE memberships
  ALTER COLUMN capabilities TYPE "Capability_new"[] USING capabilities::text[]::"Capability_new"[],
  ALTER COLUMN hr_capabilities TYPE "Capability_new"[] USING hr_capabilities::text[]::"Capability_new"[];

ALTER TABLE access_invites
  ALTER COLUMN capabilities TYPE "Capability_new"[] USING capabilities::text[]::"Capability_new"[],
  ALTER COLUMN hr_capabilities TYPE "Capability_new"[] USING hr_capabilities::text[]::"Capability_new"[];

DROP TYPE "Capability";
ALTER TYPE "Capability_new" RENAME TO "Capability";

ALTER TABLE memberships
  ALTER COLUMN capabilities SET DEFAULT ARRAY[]::"Capability"[],
  ALTER COLUMN hr_capabilities SET DEFAULT ARRAY[]::"Capability"[];

ALTER TABLE access_invites
  ALTER COLUMN capabilities SET DEFAULT ARRAY[]::"Capability"[],
  ALTER COLUMN hr_capabilities SET DEFAULT ARRAY[]::"Capability"[];

ALTER TABLE memberships
  ADD CONSTRAINT memberships_legacy_capabilities_check CHECK (
    capabilities <@ ARRAY[
      'EXECUTE_ASSIGNED_ACTIONS',
      'TECHNICAL_DECISIONS',
      'PSYCHOLOGY_COLLABORATION'
    ]::"Capability"[]
  ),
  ADD CONSTRAINT memberships_hr_capabilities_check CHECK (
    hr_capabilities <@ ARRAY[
      'HR_PROFILE_READ', 'HR_PROFILE_MANAGE', 'HR_ANALYTICS_READ',
      'HR_COMPENSATION_READ', 'HR_COMPENSATION_MANAGE', 'HR_EXPORT',
      'HR_ASSESSMENT_INVITES_ISSUE'
    ]::"Capability"[]
  );

ALTER TABLE access_invites
  ADD CONSTRAINT access_invites_legacy_capabilities_check CHECK (
    capabilities <@ ARRAY[
      'EXECUTE_ASSIGNED_ACTIONS',
      'TECHNICAL_DECISIONS',
      'PSYCHOLOGY_COLLABORATION'
    ]::"Capability"[]
  ),
  ADD CONSTRAINT access_invites_hr_capabilities_check CHECK (
    hr_capabilities <@ ARRAY[
      'HR_PROFILE_READ', 'HR_PROFILE_MANAGE', 'HR_ANALYTICS_READ',
      'HR_COMPENSATION_READ', 'HR_COMPENSATION_MANAGE', 'HR_EXPORT',
      'HR_ASSESSMENT_INVITES_ISSUE'
    ]::"Capability"[]
  );

-- ID 56: SST x Organizational Psychology Technical Collaboration
CREATE TYPE "RiskContributionSpecialty" AS ENUM ('SST', 'PSYCHOLOGY_ORGANIZATIONAL');
CREATE TYPE "RiskContributionVisibility" AS ENUM ('RESTRICTED', 'SHARED');
CREATE TYPE "RiskContributionStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "RiskContributionKind" AS ENUM (
  'PSYCHOSOCIAL_ANALYSIS',
  'WORK_ORGANIZATION_NOTE',
  'PREVENTIVE_RECOMMENDATION',
  'TECHNICAL_FOLLOW_UP'
);

CREATE TABLE "risk_technical_contributions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "risk_id" UUID NOT NULL,
  "specialty" "RiskContributionSpecialty" NOT NULL,
  "kind" "RiskContributionKind" NOT NULL,
  "status" "RiskContributionStatus" NOT NULL DEFAULT 'ACTIVE',
  "visibility" "RiskContributionVisibility" NOT NULL DEFAULT 'RESTRICTED',
  "title" VARCHAR(160) NOT NULL,
  "work_factors" VARCHAR(2000) NOT NULL,
  "preventive_recommendations" VARCHAR(2000) NOT NULL,
  "next_step" VARCHAR(500),
  "source_risk_version" INTEGER NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "author_id" UUID NOT NULL,
  "shared_at" TIMESTAMPTZ,
  "shared_by_id" UUID,
  "archived_at" TIMESTAMPTZ,
  "archived_by_id" UUID,
  "archive_reason" VARCHAR(1000),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "risk_technical_contributions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "risk_tech_contrib_org_id_key" UNIQUE ("organization_id", "id"),
  CONSTRAINT "risk_tech_contrib_org_risk_id_key" UNIQUE ("organization_id", "risk_id", "id"),
  CONSTRAINT "risk_tech_contrib_version_check" CHECK ("version" >= 1 AND "source_risk_version" >= 1),
  CONSTRAINT "risk_tech_contrib_visibility_check" CHECK (
    ("visibility" = 'SHARED' AND "shared_at" IS NOT NULL AND "shared_by_id" IS NOT NULL)
    OR ("visibility" = 'RESTRICTED' AND "shared_at" IS NULL AND "shared_by_id" IS NULL)
  ),
  CONSTRAINT "risk_tech_contrib_status_check" CHECK (
    ("status" = 'ARCHIVED' AND "archived_at" IS NOT NULL AND "archived_by_id" IS NOT NULL AND "archive_reason" IS NOT NULL)
    OR ("status" = 'ACTIVE' AND "archived_at" IS NULL AND "archived_by_id" IS NULL AND "archive_reason" IS NULL)
  ),
  CONSTRAINT "risk_tech_contrib_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "risk_tech_contrib_risk_fkey" FOREIGN KEY ("organization_id", "risk_id") REFERENCES "risks"("organization_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "risk_tech_contrib_author_fkey" FOREIGN KEY ("author_id", "organization_id") REFERENCES "memberships"("user_id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "risk_tech_contrib_sharer_fkey" FOREIGN KEY ("shared_by_id", "organization_id") REFERENCES "memberships"("user_id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "risk_tech_contrib_archiver_fkey" FOREIGN KEY ("archived_by_id", "organization_id") REFERENCES "memberships"("user_id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE INDEX "risk_tech_contrib_org_risk_vis_idx"
  ON "risk_technical_contributions"("organization_id", "risk_id", "visibility", "created_at", "id");
CREATE INDEX "risk_tech_contrib_org_author_idx"
  ON "risk_technical_contributions"("organization_id", "author_id", "created_at", "id");

CREATE TABLE "risk_technical_contribution_revisions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "risk_id" UUID NOT NULL,
  "contribution_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "event" VARCHAR(32) NOT NULL,
  "visibility" "RiskContributionVisibility" NOT NULL,
  "snapshot" JSONB NOT NULL,
  "change_reason" VARCHAR(1000),
  "author_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "risk_technical_contribution_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "risk_tech_contrib_rev_contrib_ver_key" UNIQUE ("contribution_id", "version"),
  CONSTRAINT "risk_tech_contrib_rev_version_check" CHECK ("version" >= 1),
  CONSTRAINT "risk_tech_contrib_rev_event_check" CHECK (
    "event" IN ('CREATED', 'UPDATED', 'SHARED', 'ATTACHMENT_ADDED', 'ATTACHMENT_ARCHIVED', 'ARCHIVED')
  ),
  CONSTRAINT "risk_tech_contrib_rev_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "risk_tech_contrib_rev_risk_fkey" FOREIGN KEY ("organization_id", "risk_id") REFERENCES "risks"("organization_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "risk_tech_contrib_rev_contrib_fkey" FOREIGN KEY ("organization_id", "risk_id", "contribution_id") REFERENCES "risk_technical_contributions"("organization_id", "risk_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "risk_tech_contrib_rev_author_fkey" FOREIGN KEY ("author_id", "organization_id") REFERENCES "memberships"("user_id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE INDEX "risk_tech_contrib_rev_org_contrib_idx"
  ON "risk_technical_contribution_revisions"("organization_id", "contribution_id", "created_at", "id");

CREATE TABLE "risk_technical_contribution_attachments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "risk_id" UUID NOT NULL,
  "contribution_id" UUID NOT NULL,
  "contribution_version" INTEGER NOT NULL,
  "visibility" "RiskContributionVisibility" NOT NULL DEFAULT 'RESTRICTED',
  "description" VARCHAR(1000) NOT NULL,
  "file_name" VARCHAR(100) NOT NULL,
  "object_key" VARCHAR(240) NOT NULL,
  "mime_type" VARCHAR(64) NOT NULL,
  "size" INTEGER NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archived_at" TIMESTAMPTZ,
  "archived_by_id" UUID,
  "archive_reason" VARCHAR(1000),

  CONSTRAINT "risk_technical_contribution_attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "risk_technical_contribution_attachments_object_key_key" UNIQUE ("object_key"),
  CONSTRAINT "risk_tech_contrib_att_org_contrib_id_key" UNIQUE ("organization_id", "contribution_id", "id"),
  CONSTRAINT "risk_tech_contrib_att_size_check" CHECK ("size" > 0 AND "size" <= 5242880),
  CONSTRAINT "risk_tech_contrib_att_mime_check" CHECK ("mime_type" IN ('application/pdf', 'image/png', 'image/jpeg')),
  CONSTRAINT "risk_tech_contrib_att_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "risk_tech_contrib_att_version_check" CHECK ("version" >= 1 AND "contribution_version" >= 1),
  CONSTRAINT "risk_tech_contrib_att_archive_check" CHECK (
    ("archived_at" IS NULL AND "archived_by_id" IS NULL AND "archive_reason" IS NULL)
    OR ("archived_at" IS NOT NULL AND "archived_by_id" IS NOT NULL AND "archive_reason" IS NOT NULL)
  ),
  CONSTRAINT "risk_tech_contrib_att_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "risk_tech_contrib_att_risk_fkey" FOREIGN KEY ("organization_id", "risk_id") REFERENCES "risks"("organization_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "risk_tech_contrib_att_contrib_fkey" FOREIGN KEY ("organization_id", "risk_id", "contribution_id") REFERENCES "risk_technical_contributions"("organization_id", "risk_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "risk_tech_contrib_att_rev_fkey" FOREIGN KEY ("contribution_id", "contribution_version") REFERENCES "risk_technical_contribution_revisions"("contribution_id", "version") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "risk_tech_contrib_att_creator_fkey" FOREIGN KEY ("created_by_id", "organization_id") REFERENCES "memberships"("user_id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "risk_tech_contrib_att_archiver_fkey" FOREIGN KEY ("archived_by_id", "organization_id") REFERENCES "memberships"("user_id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE INDEX "risk_tech_contrib_att_org_contrib_idx"
  ON "risk_technical_contribution_attachments"("organization_id", "contribution_id", "created_at", "id");

-- Immutability & state integrity triggers
CREATE FUNCTION protect_risk_technical_contribution() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'risk_technical_contributions cannot be deleted';
  END IF;
  IF NEW.id <> OLD.id
    OR NEW.organization_id <> OLD.organization_id
    OR NEW.risk_id <> OLD.risk_id
    OR NEW.author_id <> OLD.author_id
    OR NEW.specialty <> OLD.specialty
    OR NEW.source_risk_version <> OLD.source_risk_version
    OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'immutable risk technical contribution fields cannot change';
  END IF;
  IF OLD.visibility = 'SHARED' AND NEW.visibility = 'RESTRICTED' THEN
    RAISE EXCEPTION 'shared contribution cannot revert to restricted';
  END IF;
  IF OLD.visibility = 'SHARED' AND (
    NEW.shared_at IS DISTINCT FROM OLD.shared_at
    OR NEW.shared_by_id IS DISTINCT FROM OLD.shared_by_id
  ) THEN
    RAISE EXCEPTION 'shared metadata cannot be modified once shared';
  END IF;
  IF OLD.status = 'ARCHIVED' THEN
    RAISE EXCEPTION 'archived contribution is read-only';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'contribution version must increment strictly by 1';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER risk_technical_contributions_guard
  BEFORE UPDATE OR DELETE ON "risk_technical_contributions"
  FOR EACH ROW EXECUTE FUNCTION protect_risk_technical_contribution();

CREATE FUNCTION protect_risk_technical_contribution_revision() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'risk_technical_contribution_revisions are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER risk_technical_contribution_revisions_guard
  BEFORE UPDATE OR DELETE ON "risk_technical_contribution_revisions"
  FOR EACH ROW EXECUTE FUNCTION protect_risk_technical_contribution_revision();

CREATE FUNCTION protect_risk_technical_contribution_attachment() RETURNS TRIGGER AS $$
DECLARE
  parent_status "RiskContributionStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'risk_technical_contribution_attachments cannot be deleted';
  END IF;
  SELECT status INTO parent_status
    FROM "risk_technical_contributions"
    WHERE organization_id = NEW.organization_id
      AND risk_id = NEW.risk_id
      AND id = NEW.contribution_id;
  IF parent_status = 'ARCHIVED' THEN
    RAISE EXCEPTION 'archived contribution cannot accept or modify attachments';
  END IF;
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id
    OR NEW.organization_id <> OLD.organization_id
    OR NEW.risk_id <> OLD.risk_id
    OR NEW.contribution_id <> OLD.contribution_id
    OR NEW.contribution_version <> OLD.contribution_version
    OR NEW.description <> OLD.description
    OR NEW.file_name <> OLD.file_name
    OR NEW.object_key <> OLD.object_key
    OR NEW.mime_type <> OLD.mime_type
    OR NEW.size <> OLD.size
    OR NEW.sha256 <> OLD.sha256
    OR NEW.created_by_id <> OLD.created_by_id
    OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'immutable contribution attachment fields cannot change';
  END IF;
  IF OLD.visibility = 'SHARED' AND NEW.visibility = 'RESTRICTED' THEN
    RAISE EXCEPTION 'shared attachment cannot revert to restricted';
  END IF;
  IF OLD.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'archived attachment is read-only';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'attachment version must increment strictly by 1';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER risk_technical_contribution_attachments_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "risk_technical_contribution_attachments"
  FOR EACH ROW EXECUTE FUNCTION protect_risk_technical_contribution_attachment();

COMMIT;
