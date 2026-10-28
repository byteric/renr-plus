-- Additive ID11 persistence; legacy tables and constraints remain unchanged.
SET lock_timeout = '5s';
-- CreateTable
CREATE TABLE "evaluation_methods" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluation_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_method_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "method_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "title" VARCHAR(160) NOT NULL,
    "description" VARCHAR(2000) NOT NULL DEFAULT '',
    "definition" JSONB NOT NULL,
    "approval_reference" VARCHAR(1000),
    "published_by_id" UUID,
    "published_at" TIMESTAMP(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluation_method_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "technical_risk_evaluations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "risk_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "risk_version" INTEGER NOT NULL,
    "method_version_id" UUID NOT NULL,
    "probability_key" VARCHAR(40) NOT NULL,
    "severity_key" VARCHAR(40) NOT NULL,
    "result" JSONB NOT NULL,
    "method_snapshot" JSONB NOT NULL,
    "context_snapshot" JSONB NOT NULL,
    "context_fingerprint" VARCHAR(64) NOT NULL,
    "rationale" VARCHAR(4000) NOT NULL,
    "context" VARCHAR(4000) NOT NULL,
    "sources" JSONB NOT NULL,
    "author_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "technical_risk_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "evaluation_methods_organization_id_created_at_id_idx" ON "evaluation_methods"("organization_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_methods_organization_id_id_key" ON "evaluation_methods"("organization_id", "id");

-- CreateIndex
CREATE INDEX "evaluation_method_versions_organization_id_status_created_a_idx" ON "evaluation_method_versions"("organization_id", "status", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_method_versions_organization_id_id_key" ON "evaluation_method_versions"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_method_versions_method_id_version_key" ON "evaluation_method_versions"("method_id", "version");

-- CreateIndex
CREATE INDEX "technical_risk_evaluations_organization_id_risk_id_idx" ON "technical_risk_evaluations"("organization_id", "risk_id");

-- CreateIndex
CREATE INDEX "technical_risk_evaluations_organization_id_method_version_i_idx" ON "technical_risk_evaluations"("organization_id", "method_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "technical_risk_evaluations_organization_id_id_key" ON "technical_risk_evaluations"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "technical_risk_evaluations_organization_id_risk_id_id_key" ON "technical_risk_evaluations"("organization_id", "risk_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "technical_risk_evaluations_risk_id_sequence_key" ON "technical_risk_evaluations"("risk_id", "sequence");

-- AddForeignKey
ALTER TABLE "evaluation_methods" ADD CONSTRAINT "evaluation_methods_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "evaluation_methods" ADD CONSTRAINT "evaluation_methods_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "evaluation_method_versions" ADD CONSTRAINT "evaluation_method_versions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "evaluation_method_versions" ADD CONSTRAINT "evaluation_method_versions_organization_id_method_id_fkey" FOREIGN KEY ("organization_id", "method_id") REFERENCES "evaluation_methods"("organization_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "evaluation_method_versions" ADD CONSTRAINT "evaluation_method_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "evaluation_method_versions" ADD CONSTRAINT "evaluation_method_versions_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "technical_risk_evaluations" ADD CONSTRAINT "technical_risk_evaluations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "technical_risk_evaluations" ADD CONSTRAINT "technical_risk_evaluations_organization_id_risk_id_fkey" FOREIGN KEY ("organization_id", "risk_id") REFERENCES "risks"("organization_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "technical_risk_evaluations" ADD CONSTRAINT "technical_risk_evaluations_organization_id_method_version__fkey" FOREIGN KEY ("organization_id", "method_version_id") REFERENCES "evaluation_method_versions"("organization_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "technical_risk_evaluations" ADD CONSTRAINT "technical_risk_evaluations_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- ID11 integrity guards
CREATE FUNCTION id11_object_keys(value JSONB, expected TEXT[]) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_typeof(value) = 'object' AND
   (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(value) k) =
   (SELECT array_agg(k ORDER BY k) FROM unnest(expected) k)
$$;

CREATE FUNCTION id11_valid_definition(value JSONB, published BOOLEAN) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE field TEXT; item JSONB; cell JSONB; allowed TEXT[]; n INTEGER;
BEGIN
 IF NOT coalesce(id11_object_keys(value, ARRAY['probability','severity','levels','priorities','matrix']),false) THEN RETURN false; END IF;
 FOREACH field IN ARRAY ARRAY['probability','severity','levels','priorities','matrix'] LOOP
  IF jsonb_typeof(value->field) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  n := jsonb_array_length(value->field);
  IF n > (CASE WHEN field='matrix' THEN 400 ELSE 20 END) OR (published AND n=0) THEN RETURN false; END IF;
  IF field='matrix' THEN CONTINUE; END IF;
  allowed := CASE WHEN field IN ('probability','severity') THEN ARRAY['key','label','description','position'] WHEN field='priorities' THEN ARRAY['key','label','rank'] ELSE ARRAY['key','label'] END;
  FOR item IN SELECT * FROM jsonb_array_elements(value->field) LOOP
   IF NOT coalesce(id11_object_keys(item,allowed),false)
     OR jsonb_typeof(item->'key') IS DISTINCT FROM 'string' OR (item->>'key') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$'
     OR jsonb_typeof(item->'label') IS DISTINCT FROM 'string' OR length(btrim(item->>'label')) NOT BETWEEN 1 AND 120
   THEN RETURN false; END IF;
   IF field IN ('probability','severity') THEN
    IF jsonb_typeof(item->'description') IS DISTINCT FROM 'string' OR length(btrim(item->>'description'))>1000
     OR jsonb_typeof(item->'position') IS DISTINCT FROM 'number' OR (item->>'position')::numeric NOT BETWEEN 1 AND 20 OR (item->>'position')::numeric <> trunc((item->>'position')::numeric)
    THEN RETURN false; END IF;
   ELSIF field='priorities' THEN
    IF jsonb_typeof(item->'rank') IS DISTINCT FROM 'number' OR (item->>'rank')::numeric NOT BETWEEN 1 AND 20 OR (item->>'rank')::numeric <> trunc((item->>'rank')::numeric) THEN RETURN false; END IF;
   END IF;
  END LOOP;
  IF (SELECT count(DISTINCT x->>'key') FROM jsonb_array_elements(value->field) x) <> n THEN RETURN false; END IF;
  IF field IN ('probability','severity') AND (SELECT count(DISTINCT (x->>'position')::numeric) FROM jsonb_array_elements(value->field) x) <> n THEN RETURN false; END IF;
  IF field='priorities' AND (SELECT count(DISTINCT (x->>'rank')::numeric) FROM jsonb_array_elements(value->field) x) <> n THEN RETURN false; END IF;
 END LOOP;
 FOR cell IN SELECT * FROM jsonb_array_elements(value->'matrix') LOOP
  IF NOT coalesce(id11_object_keys(cell,ARRAY['probabilityKey','severityKey','levelKey','priorityKey']),false) THEN RETURN false; END IF;
  FOREACH field IN ARRAY ARRAY['probabilityKey','severityKey','levelKey','priorityKey'] LOOP
   IF jsonb_typeof(cell->field) IS DISTINCT FROM 'string' OR (cell->>field) !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$' THEN RETURN false; END IF;
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(value->CASE field WHEN 'probabilityKey' THEN 'probability' WHEN 'severityKey' THEN 'severity' WHEN 'levelKey' THEN 'levels' ELSE 'priorities' END) x WHERE x->>'key'=cell->>field) THEN RETURN false; END IF;
  END LOOP;
 END LOOP;
 IF (SELECT count(DISTINCT (x->>'probabilityKey',x->>'severityKey')) FROM jsonb_array_elements(value->'matrix') x) <> jsonb_array_length(value->'matrix') THEN RETURN false; END IF;
 RETURN NOT published OR jsonb_array_length(value->'matrix') = jsonb_array_length(value->'probability') * jsonb_array_length(value->'severity');
EXCEPTION WHEN invalid_parameter_value OR invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END $$;

ALTER TABLE evaluation_methods ADD CONSTRAINT evaluation_methods_name_check CHECK(length(btrim(name)) BETWEEN 3 AND 160);
ALTER TABLE evaluation_method_versions ADD CONSTRAINT evaluation_method_versions_content_check CHECK(
 version>0 AND revision>0 AND status IN ('DRAFT','PUBLISHED') AND length(btrim(title)) BETWEEN 3 AND 160
 AND id11_valid_definition(definition,status='PUBLISHED')
 AND ((status='DRAFT' AND approval_reference IS NULL AND published_by_id IS NULL AND published_at IS NULL)
 OR (status='PUBLISHED' AND approval_reference IS NOT NULL AND length(btrim(approval_reference)) BETWEEN 5 AND 1000 AND published_by_id IS NOT NULL AND published_at IS NOT NULL))
);
ALTER TABLE technical_risk_evaluations ADD CONSTRAINT technical_risk_evaluations_content_check CHECK(
 sequence>0 AND risk_version>0 AND context_fingerprint ~ '^[a-f0-9]{64}$'
 AND length(btrim(rationale)) BETWEEN 10 AND 4000 AND length(btrim(context)) BETWEEN 10 AND 4000
 AND jsonb_typeof(sources)='array' AND jsonb_array_length(sources) BETWEEN 1 AND 20
);

CREATE FUNCTION id11_require_technician(org UUID, actor UUID) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM memberships m JOIN organizations o ON o.id=m.organization_id
 WHERE m.organization_id=org AND m.user_id=actor AND m.is_active AND o.is_active
 AND 'TECHNICAL_DECISIONS'::"Capability"=ANY(m.capabilities) FOR SHARE OF m,o;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active TECHNICAL_DECISIONS capability required' USING ERRCODE='23514'; END IF;
END $$;

CREATE FUNCTION protect_evaluation_method() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Evaluation method catalog is immutable' USING ERRCODE='23514'; END IF;
 PERFORM id11_require_technician(NEW.organization_id,NEW.created_by_id);
 RETURN NEW;
END $$;
CREATE TRIGGER evaluation_methods_immutable BEFORE INSERT OR UPDATE OR DELETE ON evaluation_methods FOR EACH ROW EXECUTE FUNCTION protect_evaluation_method();

CREATE FUNCTION protect_evaluation_method_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.status='PUBLISHED' THEN RAISE EXCEPTION 'Published evaluation methods are immutable' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='INSERT' THEN
  PERFORM id11_require_technician(NEW.organization_id,NEW.created_by_id);
 ELSE
  IF OLD.status='PUBLISHED' OR ROW(NEW.id,NEW.organization_id,NEW.method_id,NEW.version,NEW.created_by_id,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.organization_id,OLD.method_id,OLD.version,OLD.created_by_id,OLD.created_at)
  THEN RAISE EXCEPTION 'Published versions and version identity are immutable' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status='PUBLISHED' THEN PERFORM id11_require_technician(NEW.organization_id,NEW.published_by_id); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER evaluation_method_versions_immutable BEFORE INSERT OR UPDATE OR DELETE ON evaluation_method_versions FOR EACH ROW EXECUTE FUNCTION protect_evaluation_method_version();

CREATE FUNCTION protect_technical_risk_evaluation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r risks%ROWTYPE; v evaluation_method_versions%ROWTYPE; catalog evaluation_methods%ROWTYPE;
 p JSONB; s JSONB; l JSONB; priority JSONB; cell JSONB; expected JSONB; snapshot JSONB; src JSONB;
 scope RECORD; source_cycle assessment_cycles%ROWTYPE; source_instrument instrument_versions%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Technical evaluation history is append-only' USING ERRCODE='23514'; END IF;
 PERFORM id11_require_technician(NEW.organization_id,NEW.author_id);
 SELECT * INTO r FROM risks WHERE organization_id=NEW.organization_id AND id=NEW.risk_id FOR UPDATE;
 IF NOT FOUND OR r.status<>'REGISTERED' OR NEW.risk_version<>r.version THEN RAISE EXCEPTION 'Registered current risk required' USING ERRCODE='23514'; END IF;
 IF NEW.sequence<>(SELECT coalesce(max(sequence),0)+1 FROM technical_risk_evaluations WHERE risk_id=r.id) THEN RAISE EXCEPTION 'Next technical evaluation sequence required' USING ERRCODE='23514'; END IF;
 SELECT * INTO v FROM evaluation_method_versions WHERE organization_id=NEW.organization_id AND id=NEW.method_version_id;
 IF NOT FOUND OR v.status<>'PUBLISHED' THEN RAISE EXCEPTION 'Published method from the same organization required' USING ERRCODE='23514'; END IF;
 SELECT * INTO catalog FROM evaluation_methods WHERE organization_id=v.organization_id AND id=v.method_id;
 SELECT x INTO cell FROM jsonb_array_elements(v.definition->'matrix') x WHERE x->>'probabilityKey'=NEW.probability_key AND x->>'severityKey'=NEW.severity_key;
 SELECT x INTO p FROM jsonb_array_elements(v.definition->'probability') x WHERE x->>'key'=NEW.probability_key;
 SELECT x INTO s FROM jsonb_array_elements(v.definition->'severity') x WHERE x->>'key'=NEW.severity_key;
 SELECT x INTO l FROM jsonb_array_elements(v.definition->'levels') x WHERE x->>'key'=cell->>'levelKey';
 SELECT x INTO priority FROM jsonb_array_elements(v.definition->'priorities') x WHERE x->>'key'=cell->>'priorityKey';
 expected := jsonb_build_object('probability',jsonb_build_object('key',p->'key','label',p->'label'),'severity',jsonb_build_object('key',s->'key','label',s->'label'),'level',l,'priority',priority);
 IF cell IS NULL OR NEW.result IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Result must exactly match configured method cell' USING ERRCODE='23514'; END IF;
 IF NEW.method_snapshot IS DISTINCT FROM jsonb_build_object('id',catalog.id,'name',catalog.name,'versionId',v.id,'version',v.version,'approvalReference',v.approval_reference) THEN RAISE EXCEPTION 'Method snapshot mismatch' USING ERRCODE='23514'; END IF;
 SELECT g.id AS group_id,s.id AS sector_id,s.name AS sector_name,s.is_active AS sector_active,u.id AS unit_id,u.name AS unit_name,u.is_active AS unit_active INTO scope
 FROM assessment_groups g JOIN sectors s ON s.organization_id=g.organization_id AND s.id=g.sector_id JOIN units u ON u.organization_id=s.organization_id AND u.id=s.unit_id
 WHERE g.organization_id=r.organization_id AND g.id=r.assessment_group_id;
 snapshot := jsonb_build_object('factor',r.factor,'description',r.description,'exposureDescription',r.exposure_description,'exposedGroupDescription',r.exposed_group_description,'possibleHarms',r.possible_harms,'existingControls',r.existing_controls,'sourceKind',r.source_kind,'sourceNote',r.source_note,'diagnosticCycleId',r.diagnostic_cycle_id,'sectorId',scope.sector_id,'assessmentGroupId',r.assessment_group_id,'unit',jsonb_build_object('id',scope.unit_id,'name',scope.unit_name,'isActive',scope.unit_active),'sector',jsonb_build_object('id',scope.sector_id,'name',scope.sector_name,'isActive',scope.sector_active),'status',r.status);
 IF NEW.context_snapshot IS DISTINCT FROM snapshot THEN RAISE EXCEPTION 'Risk context snapshot mismatch' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(NEW.sources) IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.sources) NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'Sources required' USING ERRCODE='23514'; END IF;
 FOR src IN SELECT * FROM jsonb_array_elements(NEW.sources) LOOP
  IF NOT coalesce(id11_object_keys(src,ARRAY['kind','id','title','reference','isDemonstration','capturedAt']),false)
   OR jsonb_typeof(src->'kind') IS DISTINCT FROM 'string' OR src->>'kind' NOT IN ('RISK_RECORD','ASSESSMENT_CYCLE','ASSESSMENT_SOURCE','DOCUMENT')
   OR jsonb_typeof(src->'title') IS DISTINCT FROM 'string' OR length(src->>'title') NOT BETWEEN 1 AND 1000
   OR jsonb_typeof(src->'reference') IS DISTINCT FROM 'string' OR length(src->>'reference') NOT BETWEEN 1 AND 1000
   OR jsonb_typeof(src->'isDemonstration') IS DISTINCT FROM 'boolean' OR jsonb_typeof(src->'capturedAt') IS DISTINCT FROM 'string'
   OR (src->>'capturedAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$'
  THEN RAISE EXCEPTION 'Invalid source snapshot' USING ERRCODE='23514'; END IF;
  -- Timestamp and UUID casts below are validation; normalize invalid input to constraint violations.
  PERFORM (src->>'capturedAt')::timestamptz;
  IF src->>'kind'='DOCUMENT' THEN
   IF src->'id' IS DISTINCT FROM 'null'::jsonb OR length(btrim(src->>'reference'))<5 OR (src->>'isDemonstration')::boolean THEN RAISE EXCEPTION 'Invalid document source' USING ERRCODE='23514'; END IF;
  ELSIF src->>'kind'='RISK_RECORD' THEN
   IF (src->>'id')::uuid IS DISTINCT FROM r.id OR (src->>'isDemonstration')::boolean THEN RAISE EXCEPTION 'Risk source mismatch' USING ERRCODE='23514'; END IF;
  ELSE
   IF src->>'kind'='ASSESSMENT_CYCLE' THEN
    SELECT * INTO source_cycle FROM assessment_cycles WHERE id=(src->>'id')::uuid AND organization_id=r.organization_id AND assessment_group_id=r.assessment_group_id;
   ELSE
    SELECT c.* INTO source_cycle FROM assessment_sources a JOIN assessment_cycles c ON c.id=a.cycle_id AND c.organization_id=a.organization_id WHERE a.id=(src->>'id')::uuid AND a.organization_id=r.organization_id AND c.assessment_group_id=r.assessment_group_id;
   END IF;
   IF NOT FOUND THEN RAISE EXCEPTION 'Source must belong to risk organization and group' USING ERRCODE='23514'; END IF;
   SELECT * INTO source_instrument FROM instrument_versions WHERE id=source_cycle.instrument_version_id AND organization_id=r.organization_id;
   IF (src->>'isDemonstration')::boolean IS DISTINCT FROM (source_instrument.usage_mode='DEMONSTRATION') THEN RAISE EXCEPTION 'Source demonstration flag mismatch' USING ERRCODE='23514'; END IF;
  END IF;
 END LOOP;
 IF (SELECT count(DISTINCT (x->>'kind',CASE WHEN x->>'kind'='DOCUMENT' THEN x->>'reference' ELSE x->>'id' END)) FROM jsonb_array_elements(NEW.sources) x)<>jsonb_array_length(NEW.sources) THEN RAISE EXCEPTION 'Duplicate sources' USING ERRCODE='23514'; END IF;
 RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
 RAISE EXCEPTION 'Invalid technical evaluation snapshot value' USING ERRCODE='23514';
END $$;
CREATE TRIGGER technical_risk_evaluations_append_only BEFORE INSERT OR UPDATE OR DELETE ON technical_risk_evaluations FOR EACH ROW EXECUTE FUNCTION protect_technical_risk_evaluation();


