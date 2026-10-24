-- CreateTable
CREATE TABLE "consolidation_policy_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "usage_mode" "InstrumentUsageMode" NOT NULL,
    "minimum_responses" INTEGER,
    "algorithm_version" VARCHAR(40) NOT NULL DEFAULT 'CONSERVATIVE_V1',
    "approval_reference" VARCHAR(1000),
    "published_by_id" UUID,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consolidation_policy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_cycles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "assessment_group_id" UUID NOT NULL,
    "instrument_version_id" UUID NOT NULL,
    "policy_version_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "status" "DiagnosticCycleStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_invites" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_submission_receipts" (
    "invite_hash" CHAR(64) NOT NULL,
    "secret_hash" CHAR(64) NOT NULL,
    "payload_mac" CHAR(64) NOT NULL,

    CONSTRAINT "assessment_submission_receipts_pkey" PRIMARY KEY ("invite_hash")
);

-- CreateTable
CREATE TABLE "assessment_responses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "instrument_version_id" UUID NOT NULL,

    CONSTRAINT "assessment_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_answers" (
    "id" UUID NOT NULL,
    "response_id" UUID NOT NULL,
    "instrument_version_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "option_ids" JSONB NOT NULL,

    CONSTRAINT "assessment_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_sources" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "kind" VARCHAR(30) NOT NULL,
    "context" VARCHAR(1000) NOT NULL,
    "occurred_on" DATE NOT NULL,
    "summary" VARCHAR(4000) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "consolidation_policy_versions_organization_id_id_key" ON "consolidation_policy_versions"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "consolidation_policy_versions_organization_id_version_key" ON "consolidation_policy_versions"("organization_id", "version");

-- CreateIndex
CREATE INDEX "assessment_cycles_organization_id_instrument_version_id_pol_idx" ON "assessment_cycles"("organization_id", "instrument_version_id", "policy_version_id");

-- CreateIndex
CREATE INDEX "assessment_cycles_organization_id_assessment_group_id_idx" ON "assessment_cycles"("organization_id", "assessment_group_id");

-- CreateIndex
CREATE INDEX "assessment_cycles_organization_id_policy_version_id_idx" ON "assessment_cycles"("organization_id", "policy_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_cycles_organization_id_id_key" ON "assessment_cycles"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_cycles_organization_id_id_instrument_version_id_key" ON "assessment_cycles"("organization_id", "id", "instrument_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_invites_token_hash_key" ON "assessment_invites"("token_hash");

-- CreateIndex
CREATE INDEX "assessment_invites_organization_id_cycle_id_idx" ON "assessment_invites"("organization_id", "cycle_id");

-- CreateIndex
CREATE INDEX "assessment_responses_organization_id_cycle_id_instrument_ve_idx" ON "assessment_responses"("organization_id", "cycle_id", "instrument_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_responses_id_instrument_version_id_key" ON "assessment_responses"("id", "instrument_version_id");

-- CreateIndex
CREATE INDEX "assessment_answers_response_id_instrument_version_id_idx" ON "assessment_answers"("response_id", "instrument_version_id");

-- CreateIndex
CREATE INDEX "assessment_answers_instrument_version_id_question_id_idx" ON "assessment_answers"("instrument_version_id", "question_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_answers_response_id_question_id_key" ON "assessment_answers"("response_id", "question_id");

-- CreateIndex
CREATE INDEX "assessment_sources_organization_id_cycle_id_created_at_id_idx" ON "assessment_sources"("organization_id", "cycle_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "assessment_sources_created_by_id_idx" ON "assessment_sources"("created_by_id");

-- AddForeignKey
ALTER TABLE "consolidation_policy_versions" ADD CONSTRAINT "consolidation_policy_versions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_cycles" ADD CONSTRAINT "assessment_cycles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_cycles" ADD CONSTRAINT "assessment_cycles_organization_id_assessment_group_id_fkey" FOREIGN KEY ("organization_id", "assessment_group_id") REFERENCES "assessment_groups"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_cycles" ADD CONSTRAINT "assessment_cycles_organization_id_instrument_version_id_fkey" FOREIGN KEY ("organization_id", "instrument_version_id") REFERENCES "instrument_versions"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_cycles" ADD CONSTRAINT "assessment_cycles_organization_id_policy_version_id_fkey" FOREIGN KEY ("organization_id", "policy_version_id") REFERENCES "consolidation_policy_versions"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_invites" ADD CONSTRAINT "assessment_invites_organization_id_cycle_id_fkey" FOREIGN KEY ("organization_id", "cycle_id") REFERENCES "assessment_cycles"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_responses" ADD CONSTRAINT "assessment_responses_organization_id_cycle_id_instrument_v_fkey" FOREIGN KEY ("organization_id", "cycle_id", "instrument_version_id") REFERENCES "assessment_cycles"("organization_id", "id", "instrument_version_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_answers" ADD CONSTRAINT "assessment_answers_response_id_instrument_version_id_fkey" FOREIGN KEY ("response_id", "instrument_version_id") REFERENCES "assessment_responses"("id", "instrument_version_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_answers" ADD CONSTRAINT "assessment_answers_instrument_version_id_question_id_fkey" FOREIGN KEY ("instrument_version_id", "question_id") REFERENCES "diagnostic_questions"("instrument_version_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_sources" ADD CONSTRAINT "assessment_sources_organization_id_cycle_id_fkey" FOREIGN KEY ("organization_id", "cycle_id") REFERENCES "assessment_cycles"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_sources" ADD CONSTRAINT "assessment_sources_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE consolidation_policy_versions ADD CONSTRAINT policy_domain CHECK (
  revision > 0 AND version > 0 AND status IN ('DRAFT','PUBLISHED') AND algorithm_version='CONSERVATIVE_V1'
  AND (minimum_responses IS NULL OR minimum_responses BETWEEN 2 AND 1000)
  AND (usage_mode <> 'DEMONSTRATION' OR minimum_responses IS NOT DISTINCT FROM 5)
  AND ((status='DRAFT' AND published_at IS NULL AND published_by_id IS NULL AND approval_reference IS NULL)
    OR (status='PUBLISHED' AND minimum_responses IS NOT NULL AND published_at IS NOT NULL AND published_by_id IS NOT NULL
       AND (usage_mode <> 'REAL' OR (approval_reference IS NOT NULL AND length(trim(approval_reference)) >= 3))))
);
ALTER TABLE consolidation_policy_versions ADD CONSTRAINT policy_publisher_fkey FOREIGN KEY(published_by_id) REFERENCES users(id) ON DELETE RESTRICT;
CREATE FUNCTION protect_assessment_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='PUBLISHED' THEN RAISE EXCEPTION 'Published policy is immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND (NEW.organization_id,NEW.version) IS DISTINCT FROM (OLD.organization_id,OLD.version) THEN RAISE EXCEPTION 'Policy identity is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assessment_policy_immutable BEFORE UPDATE OR DELETE ON consolidation_policy_versions FOR EACH ROW EXECUTE FUNCTION protect_assessment_policy();
ALTER TABLE assessment_cycles ADD CONSTRAINT assessment_cycle_period CHECK (ends_at > starts_at AND revision > 0 AND length(trim(name)) BETWEEN 3 AND 160 AND ((status='CLOSED')=(closed_at IS NOT NULL)));
CREATE FUNCTION protect_assessment_cycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE valid_context boolean;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.organization_id <> OLD.organization_id THEN RAISE EXCEPTION 'Organization immutable' USING ERRCODE='23514'; END IF;
    IF OLD.status <> 'DRAFT' AND (NEW.assessment_group_id,NEW.instrument_version_id,NEW.policy_version_id,NEW.starts_at,NEW.ends_at,NEW.name) IS DISTINCT FROM (OLD.assessment_group_id,OLD.instrument_version_id,OLD.policy_version_id,OLD.starts_at,OLD.ends_at,OLD.name) THEN RAISE EXCEPTION 'Opened context immutable' USING ERRCODE='23514'; END IF;
    IF NEW.status <> OLD.status AND NOT ((OLD.status='DRAFT' AND NEW.status='OPEN') OR (OLD.status='OPEN' AND NEW.status='CLOSED')) THEN RAISE EXCEPTION 'Invalid cycle transition' USING ERRCODE='23514'; END IF;
  ELSIF NEW.status <> 'DRAFT' THEN RAISE EXCEPTION 'Create draft first' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' OR OLD.status='DRAFT' THEN
    SELECT o.is_active AND g.is_active AND s.is_active AND u.is_active AND i.status='PUBLISHED' AND p.status='PUBLISHED' AND i.usage_mode=p.usage_mode INTO valid_context
      FROM organizations o JOIN assessment_groups g ON g.organization_id=o.id JOIN sectors s ON s.id=g.sector_id AND s.organization_id=o.id JOIN units u ON u.id=s.unit_id AND u.organization_id=o.id JOIN instrument_versions i ON i.organization_id=o.id JOIN consolidation_policy_versions p ON p.organization_id=o.id
      WHERE o.id=NEW.organization_id AND g.id=NEW.assessment_group_id AND i.id=NEW.instrument_version_id AND p.id=NEW.policy_version_id;
    IF valid_context IS DISTINCT FROM true THEN RAISE EXCEPTION 'Invalid collection context' USING ERRCODE='23514'; END IF;
    IF NEW.status='OPEN' AND NOT (NEW.starts_at <= CURRENT_TIMESTAMP AND NEW.ends_at > CURRENT_TIMESTAMP) THEN RAISE EXCEPTION 'Collection period unavailable' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assessment_cycle_context BEFORE INSERT OR UPDATE ON assessment_cycles FOR EACH ROW EXECUTE FUNCTION protect_assessment_cycle();
ALTER TABLE assessment_sources ADD CONSTRAINT assessment_source_domain CHECK (kind IN ('OBSERVATION','INTERVIEW','WORKSHOP','DOCUMENT_ANALYSIS') AND length(trim(context)) BETWEEN 3 AND 1000 AND length(trim(summary)) BETWEEN 3 AND 4000);
CREATE FUNCTION protect_assessment_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE today date;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Sources are append only' USING ERRCODE='23514'; END IF;
  SELECT (CURRENT_TIMESTAMP AT TIME ZONE timezone)::date INTO today FROM organizations WHERE id=NEW.organization_id;
  IF NEW.occurred_on > today THEN RAISE EXCEPTION 'Future source date' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assessment_source_append_only BEFORE INSERT OR UPDATE OR DELETE ON assessment_sources FOR EACH ROW EXECUTE FUNCTION protect_assessment_source();
CREATE FUNCTION validate_assessment_answer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q diagnostic_questions; selected_count integer;
BEGIN
  SELECT * INTO q FROM diagnostic_questions WHERE id=NEW.question_id AND instrument_version_id=NEW.instrument_version_id;
  IF jsonb_typeof(NEW.option_ids) <> 'array' OR jsonb_array_length(NEW.option_ids)=0 THEN RAISE EXCEPTION 'Invalid answer' USING ERRCODE='23514'; END IF;
  SELECT count(DISTINCT value) INTO selected_count FROM jsonb_array_elements_text(NEW.option_ids);
  IF selected_count <> jsonb_array_length(NEW.option_ids) OR (q.type <> 'MULTIPLE_CHOICE' AND selected_count <> 1) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.option_ids) v WHERE NOT EXISTS(SELECT 1 FROM question_options o WHERE o.id::text=v.value AND o.question_id=NEW.question_id AND o.instrument_version_id=NEW.instrument_version_id)) THEN RAISE EXCEPTION 'Invalid answer options' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assessment_answer_valid BEFORE INSERT OR UPDATE ON assessment_answers FOR EACH ROW EXECUTE FUNCTION validate_assessment_answer();
