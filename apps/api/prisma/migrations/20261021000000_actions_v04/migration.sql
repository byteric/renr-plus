CREATE TYPE "ActionStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'IMPLEMENTED', 'CANCELLED');
CREATE UNIQUE INDEX "risk_evaluations_organization_id_risk_id_id_key" ON "risk_evaluations"("organization_id", "risk_id", "id");
CREATE TABLE "actions" (
  "id" UUID PRIMARY KEY, "organization_id" UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  "risk_id" UUID NOT NULL, "evaluation_id" UUID, "source_risk_version" INTEGER NOT NULL CHECK(source_risk_version > 0),
  "context_snapshot" JSONB NOT NULL, "title" VARCHAR(160) NOT NULL, "description" VARCHAR(2000) NOT NULL,
  "responsible_name" VARCHAR(120) NOT NULL, "due_date" DATE NOT NULL, "expected_result" VARCHAR(2000) NOT NULL,
  "verification_criterion" VARCHAR(2000) NOT NULL, "status" "ActionStatus" NOT NULL DEFAULT 'PLANNED',
  "version" INTEGER NOT NULL DEFAULT 1 CHECK(version > 0), "implementation_note" VARCHAR(2000), "implemented_at" TIMESTAMP(3),
  "created_by_id" UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT, "updated_by_id" UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  FOREIGN KEY (organization_id, risk_id) REFERENCES risks(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, risk_id, evaluation_id) REFERENCES risk_evaluations(organization_id,risk_id,id) ON DELETE RESTRICT,
  CHECK ((status = 'IMPLEMENTED') = (implemented_at IS NOT NULL AND implementation_note IS NOT NULL))
);
CREATE UNIQUE INDEX "actions_organization_id_id_key" ON actions(organization_id,id);
-- Risk drill-down and stable organization/status/deadline pagination.
CREATE INDEX "actions_organization_id_risk_id_idx" ON actions(organization_id,risk_id);
CREATE INDEX "actions_organization_id_status_due_date_id_idx" ON actions(organization_id,status,due_date,id);
CREATE TABLE action_revisions (
  id UUID PRIMARY KEY, organization_id UUID NOT NULL, action_id UUID NOT NULL, version INTEGER NOT NULL CHECK(version > 0),
  event VARCHAR(32) NOT NULL CHECK(event IN ('CREATED','UPDATED','STARTED','IMPLEMENTED','CANCELLED','NOTE')),
  snapshot JSONB NOT NULL, change_reason VARCHAR(1000), text VARCHAR(2000),
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(organization_id,action_id) REFERENCES actions(organization_id,id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "action_revisions_action_id_version_key" ON action_revisions(action_id,version);
CREATE FUNCTION protect_action_revision_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Action history is immutable' USING ERRCODE = '23514'; END; $$;
CREATE TRIGGER action_revisions_immutable BEFORE UPDATE OR DELETE ON action_revisions FOR EACH ROW EXECUTE FUNCTION protect_action_revision_history();
CREATE FUNCTION protect_action_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.organization_id,NEW.risk_id,NEW.evaluation_id,NEW.source_risk_version,NEW.context_snapshot,NEW.created_by_id,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.organization_id,OLD.risk_id,OLD.evaluation_id,OLD.source_risk_version,OLD.context_snapshot,OLD.created_by_id,OLD.created_at)
  THEN RAISE EXCEPTION 'Action origin is immutable' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER actions_origin_immutable BEFORE UPDATE ON actions FOR EACH ROW EXECUTE FUNCTION protect_action_origin();
