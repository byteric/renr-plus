-- Serialize technical context changes and reject demonstrative or forged technical history.
-- The previously applied migration remains unchanged.
CREATE OR REPLACE FUNCTION protect_technical_risk_evaluation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r risks%ROWTYPE; v evaluation_method_versions%ROWTYPE; catalog evaluation_methods%ROWTYPE;
 p JSONB; s JSONB; l JSONB; priority JSONB; cell JSONB; expected JSONB; snapshot JSONB; src JSONB;
 scope RECORD; source_cycle assessment_cycles%ROWTYPE; source_instrument instrument_versions%ROWTYPE;
 source_policy consolidation_policy_versions%ROWTYPE; canonical_context JSONB; canonical_text TEXT; expected_fingerprint TEXT;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Technical evaluation history is append-only' USING ERRCODE='23514'; END IF;
 PERFORM id11_require_technician(NEW.organization_id,NEW.author_id);
 SELECT * INTO r FROM risks WHERE organization_id=NEW.organization_id AND id=NEW.risk_id FOR UPDATE;
 IF NOT FOUND OR r.status<>'REGISTERED' OR NEW.risk_version<>r.version THEN RAISE EXCEPTION 'Registered current risk required' USING ERRCODE='23514'; END IF;
 IF r.diagnostic_cycle_id IS NOT NULL AND EXISTS (
   SELECT 1 FROM diagnostic_cycles c JOIN instrument_versions i ON i.id=c.instrument_version_id AND i.organization_id=c.organization_id
   WHERE c.organization_id=r.organization_id AND c.id=r.diagnostic_cycle_id AND (i.is_demo OR i.usage_mode='DEMONSTRATION')
 ) THEN RAISE EXCEPTION 'Demonstration diagnostic origin cannot support a technical evaluation' USING ERRCODE='23514'; END IF;
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
 SELECT g.is_active AS group_active,g.id AS group_id,s.id AS sector_id,s.name AS sector_name,s.is_active AS sector_active,u.id AS unit_id,u.name AS unit_name,u.is_active AS unit_active INTO scope
 FROM assessment_groups g JOIN sectors s ON s.organization_id=g.organization_id AND s.id=g.sector_id JOIN units u ON u.organization_id=s.organization_id AND u.id=s.unit_id
 WHERE g.organization_id=r.organization_id AND g.id=r.assessment_group_id FOR SHARE OF g,s,u;
 IF NOT FOUND OR NOT scope.group_active OR NOT scope.sector_active OR NOT scope.unit_active THEN
   RAISE EXCEPTION 'Active assessment group, sector and unit required' USING ERRCODE='23514';
 END IF;
 snapshot := jsonb_build_object('factor',r.factor,'description',r.description,'exposureDescription',r.exposure_description,'exposedGroupDescription',r.exposed_group_description,'possibleHarms',r.possible_harms,'existingControls',r.existing_controls,'sourceKind',r.source_kind,'sourceNote',r.source_note,'diagnosticCycleId',r.diagnostic_cycle_id,'sectorId',scope.sector_id,'assessmentGroupId',r.assessment_group_id,'unit',jsonb_build_object('id',scope.unit_id,'name',scope.unit_name,'isActive',scope.unit_active),'sector',jsonb_build_object('id',scope.sector_id,'name',scope.sector_name,'isActive',scope.sector_active),'status',r.status);
 IF NEW.context_snapshot IS DISTINCT FROM snapshot THEN RAISE EXCEPTION 'Risk context snapshot mismatch' USING ERRCODE='23514'; END IF;
 -- Technical content uses code-point ordered scalar JSON, matching the API fingerprint.
 -- Administrative names, active flags, status, timestamps and risk.version are excluded.
 canonical_context := (NEW.context_snapshot - 'unit' - 'sector' - 'status') || jsonb_build_object('unitId',NEW.context_snapshot->'unit'->'id');
 SELECT '{' || string_agg(to_jsonb(key)::text || ':' || value::text, ',' ORDER BY key COLLATE "C") || '}'
 INTO canonical_text FROM jsonb_each(canonical_context);
 expected_fingerprint := encode(sha256(convert_to(canonical_text,'UTF8')),'hex');
 IF NEW.context_fingerprint IS DISTINCT FROM expected_fingerprint THEN
   RAISE EXCEPTION 'Technical context fingerprint mismatch' USING ERRCODE='23514';
 END IF;
 IF jsonb_typeof(NEW.sources) IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.sources) NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'Sources required' USING ERRCODE='23514'; END IF;
 FOR src IN SELECT * FROM jsonb_array_elements(NEW.sources) LOOP
  IF NOT coalesce(id11_object_keys(src,ARRAY['kind','id','title','reference','isDemonstration','capturedAt']),false)
   OR jsonb_typeof(src->'kind') IS DISTINCT FROM 'string' OR src->>'kind' NOT IN ('RISK_RECORD','ASSESSMENT_CYCLE','ASSESSMENT_SOURCE','DOCUMENT')
   OR jsonb_typeof(src->'title') IS DISTINCT FROM 'string' OR length(src->>'title') NOT BETWEEN 1 AND 1000
   OR jsonb_typeof(src->'reference') IS DISTINCT FROM 'string' OR length(src->>'reference') NOT BETWEEN 1 AND 1000
   OR jsonb_typeof(src->'isDemonstration') IS DISTINCT FROM 'boolean' OR jsonb_typeof(src->'capturedAt') IS DISTINCT FROM 'string'
   OR (src->>'capturedAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$'
  THEN RAISE EXCEPTION 'Invalid source snapshot' USING ERRCODE='23514'; END IF;
  IF (src->>'isDemonstration')::boolean THEN RAISE EXCEPTION 'Demonstration sources cannot support technical evaluations' USING ERRCODE='23514'; END IF;
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
   SELECT * INTO source_policy FROM consolidation_policy_versions WHERE id=source_cycle.policy_version_id AND organization_id=r.organization_id;
   IF NOT FOUND OR source_instrument.id IS NULL OR source_instrument.is_demo OR source_instrument.usage_mode<>'REAL' OR source_policy.usage_mode<>'REAL' THEN
     RAISE EXCEPTION 'Source instrument and consolidation policy must support real technical use' USING ERRCODE='23514';
   END IF;
  END IF;
 END LOOP;
 IF (SELECT count(DISTINCT (x->>'kind',CASE WHEN x->>'kind'='DOCUMENT' THEN x->>'reference' ELSE x->>'id' END)) FROM jsonb_array_elements(NEW.sources) x)<>jsonb_array_length(NEW.sources) THEN RAISE EXCEPTION 'Duplicate sources' USING ERRCODE='23514'; END IF;
 RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
 RAISE EXCEPTION 'Invalid technical evaluation snapshot value' USING ERRCODE='23514';
END $$;
