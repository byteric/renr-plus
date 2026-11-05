-- Optional exact references preserve legacy events without inventing revision links.
ALTER TABLE "audit_events"
  ADD COLUMN "resource_type" VARCHAR(80),
  ADD COLUMN "reason" VARCHAR(4000),
  ADD COLUMN "reference_type" VARCHAR(80),
  ADD COLUMN "reference_id" UUID,
  ADD COLUMN "version" INTEGER;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_reference_pair_check"
  CHECK (("reference_type" IS NULL) = ("reference_id" IS NULL));
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_positive_version_check"
  CHECK ("version" IS NULL OR "version" > 0);
-- Organization feed, operation/resource/actor filters and stable ties.
CREATE INDEX "audit_events_org_created_id_idx" ON "audit_events"("organization_id", "created_at", "id");
CREATE INDEX "audit_events_org_action_created_id_idx" ON "audit_events"("organization_id", "action", "created_at", "id");
CREATE INDEX "audit_events_org_resource_created_id_idx" ON "audit_events"("organization_id", "resource_id", "created_at", "id");
CREATE INDEX "audit_events_org_actor_created_id_idx" ON "audit_events"("organization_id", "actor_id", "created_at", "id");
CREATE INDEX "action_revisions_org_action_created_id_idx" ON "action_revisions"("organization_id", "action_id", "created_at", "id");
