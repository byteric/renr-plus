CREATE TYPE "RiskStatus" AS ENUM ('DRAFT', 'REGISTERED', 'ARCHIVED');
CREATE TYPE "RiskSourceKind" AS ENUM ('DIAGNOSTIC_CYCLE', 'TECHNICAL_RECORD');

CREATE TABLE "risks" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "assessment_group_id" UUID NOT NULL,
  "factor" VARCHAR(160) NOT NULL,
  "description" VARCHAR(2000),
  "exposure_description" VARCHAR(2000),
  "exposed_group_description" VARCHAR(2000),
  "possible_harms" VARCHAR(2000),
  "existing_controls" VARCHAR(2000),
  "source_kind" "RiskSourceKind",
  "source_note" VARCHAR(1000),
  "diagnostic_cycle_id" UUID,
  "status" "RiskStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "created_by_id" UUID NOT NULL,
  "updated_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "risks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "risks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "risks_group_fkey" FOREIGN KEY ("organization_id", "assessment_group_id") REFERENCES "assessment_groups"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "risks_cycle_fkey" FOREIGN KEY ("organization_id", "diagnostic_cycle_id") REFERENCES "diagnostic_cycles"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "risks_creator_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "risks_updater_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "risks_source_check" CHECK ("diagnostic_cycle_id" IS NULL OR "source_kind" = 'DIAGNOSTIC_CYCLE')
);
CREATE UNIQUE INDEX "risks_organization_id_id_key" ON "risks"("organization_id", "id");
-- Scoped list order and status filters; group/unit drill-down; diagnostic origin lookup.
CREATE INDEX "risks_organization_id_status_created_at_id_idx" ON "risks"("organization_id", "status", "created_at", "id");
CREATE INDEX "risks_organization_id_assessment_group_id_idx" ON "risks"("organization_id", "assessment_group_id");
CREATE INDEX "risks_organization_id_diagnostic_cycle_id_idx" ON "risks"("organization_id", "diagnostic_cycle_id");

CREATE TABLE "risk_evaluations" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "risk_id" UUID NOT NULL,
  "sequence" INTEGER NOT NULL CHECK ("sequence" > 0),
  "risk_version" INTEGER NOT NULL CHECK ("risk_version" > 0),
  "context_snapshot" JSONB NOT NULL,
  "label" VARCHAR(20) NOT NULL DEFAULT 'PRELIMINARY' CHECK ("label" = 'PRELIMINARY'),
  "method_reference" VARCHAR(200) NOT NULL,
  "method_version" VARCHAR(40) NOT NULL,
  "observation" VARCHAR(2000) NOT NULL,
  "rationale" VARCHAR(2000) NOT NULL,
  "author_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "risk_evaluations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "risk_evaluations_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "risk_evaluations_risk_fkey" FOREIGN KEY ("organization_id", "risk_id") REFERENCES "risks"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "risk_evaluations_author_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "risk_evaluations_risk_id_sequence_key" ON "risk_evaluations"("risk_id", "sequence");
CREATE INDEX "risk_evaluations_organization_id_risk_id_idx" ON "risk_evaluations"("organization_id", "risk_id");

-- History is append-only even for direct application database writes.
CREATE FUNCTION protect_risk_evaluation_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Preliminary evaluation history is immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER risk_evaluations_immutable BEFORE UPDATE OR DELETE ON "risk_evaluations"
FOR EACH ROW EXECUTE FUNCTION protect_risk_evaluation_history();
