-- Independent, append-only technical opinions. Operational action history is untouched.
CREATE TABLE action_efficacy_opinions (
 id UUID PRIMARY KEY,
 organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 action_id UUID NOT NULL,
 risk_id UUID NOT NULL,
 sequence INTEGER NOT NULL,
 supersedes_id UUID UNIQUE,
 action_version INTEGER NOT NULL,
 action_snapshot JSONB NOT NULL,
 risk_context_snapshot JSONB NOT NULL,
 action_fingerprint VARCHAR(64) NOT NULL,
 risk_context_fingerprint VARCHAR(64) NOT NULL,
 context_fingerprint VARCHAR(64) NOT NULL,
 criterion_reference VARCHAR(2000) NOT NULL,
 result VARCHAR(24) NOT NULL,
 verified_on DATE NOT NULL,
 observation VARCHAR(4000) NOT NULL,
 rationale VARCHAR(4000) NOT NULL,
 next_steps VARCHAR(2000),
 proof_package JSONB NOT NULL,
 author_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(organization_id, action_id, id),
 UNIQUE(action_id, sequence),
 FOREIGN KEY(organization_id, action_id) REFERENCES actions(organization_id,id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 FOREIGN KEY(organization_id, risk_id) REFERENCES risks(organization_id,id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 FOREIGN KEY(action_id,action_version) REFERENCES action_revisions(action_id,version) ON DELETE RESTRICT ON UPDATE NO ACTION,
 FOREIGN KEY(organization_id,action_id,supersedes_id) REFERENCES action_efficacy_opinions(organization_id,action_id,id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 CONSTRAINT action_efficacy_opinion_content CHECK (
  sequence>0 AND action_version>0 AND result IN ('EFFECTIVE','NOT_EFFECTIVE','INCONCLUSIVE')
  AND length(btrim(observation)) BETWEEN 20 AND 4000 AND length(btrim(rationale)) BETWEEN 20 AND 4000
  AND (next_steps IS NULL OR length(btrim(next_steps)) BETWEEN 10 AND 2000)
  AND (result='EFFECTIVE' OR next_steps IS NOT NULL)
  AND action_fingerprint ~ '^[0-9a-f]{64}$' AND risk_context_fingerprint ~ '^[0-9a-f]{64}$' AND context_fingerprint ~ '^[0-9a-f]{64}$'
 )
);
CREATE INDEX action_efficacy_opinions_organization_id_action_id_created_at_idx ON action_efficacy_opinions(organization_id,action_id,created_at,id);

-- Scalar JSON only: JSONB's default whitespace/key ordering is not the wire recipe.
CREATE FUNCTION id15_hash_scalars(value JSONB) RETURNS TEXT LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT encode(sha256(convert_to('{' || coalesce(string_agg(to_jsonb(key)::text || ':' || value::text, ',' ORDER BY key COLLATE "C"),'') || '}','UTF8')),'hex') FROM jsonb_each(value)
$$;

CREATE FUNCTION protect_action_efficacy_opinion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 org organizations%ROWTYPE; member memberships%ROWTYPE; r risks%ROWTYPE; a actions%ROWTYPE;
 scope RECORD; previous action_efficacy_opinions%ROWTYPE; revision action_revisions%ROWTYPE;
 risk_snapshot JSONB; action_content JSONB; risk_content JSONB; proof JSONB; file_row action_evidence%ROWTYPE;
 af TEXT; rf TEXT; proof_id UUID;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Efficacy opinion history is append-only' USING ERRCODE='23514'; END IF;
 -- One lock order shared with API: organization, member, risk, action, hierarchy, files.
 SELECT * INTO org FROM organizations WHERE id=NEW.organization_id FOR SHARE;
 IF NOT FOUND OR NOT org.is_active THEN RAISE EXCEPTION 'Active organization required' USING ERRCODE='23514'; END IF;
 SELECT * INTO member FROM memberships WHERE organization_id=NEW.organization_id AND user_id=NEW.author_id FOR SHARE;
 IF NOT FOUND OR NOT member.is_active OR NOT ('TECHNICAL_DECISIONS'::"Capability"=ANY(member.capabilities)) THEN
  RAISE EXCEPTION 'Active TECHNICAL_DECISIONS capability required' USING ERRCODE='23514';
 END IF;
 SELECT * INTO r FROM risks WHERE organization_id=NEW.organization_id AND id=NEW.risk_id FOR SHARE;
 IF NOT FOUND OR r.status<>'REGISTERED' THEN RAISE EXCEPTION 'Registered origin risk required' USING ERRCODE='23514'; END IF;
 SELECT * INTO a FROM actions WHERE organization_id=NEW.organization_id AND id=NEW.action_id FOR UPDATE;
 IF NOT FOUND OR a.risk_id<>r.id OR a.status<>'IMPLEMENTED' OR NEW.action_version<>a.version THEN
  RAISE EXCEPTION 'Implemented current action from the same risk required' USING ERRCODE='23514';
 END IF;
 SELECT g.is_active AS group_active,s.id AS sector_id,s.name AS sector_name,s.is_active AS sector_active,u.id AS unit_id,u.name AS unit_name,u.is_active AS unit_active INTO scope
 FROM assessment_groups g JOIN sectors s ON s.organization_id=g.organization_id AND s.id=g.sector_id JOIN units u ON u.organization_id=s.organization_id AND u.id=s.unit_id
 WHERE g.organization_id=r.organization_id AND g.id=r.assessment_group_id FOR SHARE OF g,s,u;
 IF NOT FOUND OR NOT scope.group_active OR NOT scope.sector_active OR NOT scope.unit_active THEN
  RAISE EXCEPTION 'Active assessment group, sector and unit required' USING ERRCODE='23514';
 END IF;
 SELECT * INTO previous FROM action_efficacy_opinions WHERE action_id=a.id ORDER BY sequence DESC LIMIT 1;
 IF NEW.sequence<>coalesce(previous.sequence,0)+1 OR NEW.supersedes_id IS DISTINCT FROM previous.id THEN
  RAISE EXCEPTION 'Immediate same-action predecessor and next sequence required' USING ERRCODE='23514';
 END IF;
 SELECT * INTO revision FROM action_revisions WHERE organization_id=NEW.organization_id AND action_id=a.id AND version=a.version;
 IF NOT FOUND OR NEW.action_snapshot IS DISTINCT FROM revision.snapshot OR NEW.criterion_reference IS DISTINCT FROM a.verification_criterion THEN
  RAISE EXCEPTION 'Current revision snapshot and exact criterion required' USING ERRCODE='23514';
 END IF;
 risk_snapshot:=jsonb_build_object('factor',r.factor,'description',r.description,'exposureDescription',r.exposure_description,'exposedGroupDescription',r.exposed_group_description,'possibleHarms',r.possible_harms,'existingControls',r.existing_controls,'sourceKind',r.source_kind,'sourceNote',r.source_note,'diagnosticCycleId',r.diagnostic_cycle_id,'sectorId',scope.sector_id,'assessmentGroupId',r.assessment_group_id,'unit',jsonb_build_object('id',scope.unit_id,'name',scope.unit_name,'isActive',scope.unit_active),'sector',jsonb_build_object('id',scope.sector_id,'name',scope.sector_name,'isActive',scope.sector_active),'status',r.status);
 IF NEW.risk_context_snapshot IS DISTINCT FROM risk_snapshot THEN RAISE EXCEPTION 'Risk context snapshot mismatch' USING ERRCODE='23514'; END IF;
 risk_content:=(risk_snapshot-'unit'-'sector'-'status') || jsonb_build_object('unitId',scope.unit_id);
 action_content:=jsonb_build_object('title',a.title,'description',a.description,'expectedResult',a.expected_result,'verificationCriterion',a.verification_criterion,'status',a.status,'implementationNote',a.implementation_note,'implementedAt',CASE WHEN a.implemented_at IS NULL THEN NULL ELSE to_char(a.implemented_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END);
 IF NEW.action_snapshot IS DISTINCT FROM (action_content || jsonb_build_object('responsibleName',a.responsible_name,'dueDate',to_char(a.due_date,'YYYY-MM-DD'))) THEN
  RAISE EXCEPTION 'Operational snapshot must exactly match current action content' USING ERRCODE='23514';
 END IF;
 af:=id15_hash_scalars(action_content); rf:=id15_hash_scalars(risk_content);
 IF NEW.action_fingerprint IS DISTINCT FROM af OR NEW.risk_context_fingerprint IS DISTINCT FROM rf
 OR NEW.context_fingerprint IS DISTINCT FROM id15_hash_scalars(jsonb_build_object('actionFingerprint',af,'riskContextFingerprint',rf)) THEN
  RAISE EXCEPTION 'Technical context fingerprint mismatch' USING ERRCODE='23514';
 END IF;
 IF NOT isfinite(NEW.verified_on) OR NEW.verified_on<DATE '0001-01-01' OR NEW.verified_on>(CURRENT_TIMESTAMP AT TIME ZONE org.timezone)::date THEN RAISE EXCEPTION 'Positive civil verification date cannot be future in organization timezone' USING ERRCODE='23514'; END IF;
 IF NOT coalesce(id11_object_keys(NEW.proof_package,ARRAY['files','texts']),false)
 OR jsonb_typeof(NEW.proof_package->'files') IS DISTINCT FROM 'array' OR jsonb_typeof(NEW.proof_package->'texts') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Invalid frozen proof package' USING ERRCODE='23514';
 END IF;
 IF jsonb_array_length(NEW.proof_package->'files')>20 OR jsonb_array_length(NEW.proof_package->'texts')>10
 OR jsonb_array_length(NEW.proof_package->'files')+jsonb_array_length(NEW.proof_package->'texts')<1 THEN
  RAISE EXCEPTION 'One to twenty files and ten textual proofs maximum required' USING ERRCODE='23514';
 END IF;
 -- Validate IDs before selecting and lock selected files in stable UUID order.
 FOR proof IN SELECT value FROM jsonb_array_elements(NEW.proof_package->'files') LOOP
  IF jsonb_typeof(proof->'id') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'File UUID required' USING ERRCODE='23514'; END IF;
  PERFORM (proof->>'id')::uuid;
 END LOOP;
 FOR proof IN SELECT value FROM jsonb_array_elements(NEW.proof_package->'files') ORDER BY (value->>'id')::uuid LOOP
  SELECT * INTO file_row FROM action_evidence WHERE organization_id=NEW.organization_id AND action_id=a.id AND id=(proof->>'id')::uuid FOR SHARE;
  IF NOT FOUND OR file_row.archived_at IS NOT NULL OR proof IS DISTINCT FROM jsonb_build_object('id',file_row.id,'fileName',file_row.file_name,'description',file_row.description,'mimeType',file_row.mime_type,'size',file_row.size,'sha256',file_row.sha256) THEN
   RAISE EXCEPTION 'Active same-action proof and exact metadata/hash required' USING ERRCODE='23514';
  END IF;
 END LOOP;
 FOR proof IN SELECT value FROM jsonb_array_elements(NEW.proof_package->'texts') LOOP
  IF NOT coalesce(id11_object_keys(proof,ARRAY['id','reference','description','rationale','sha256']),false)
  OR jsonb_typeof(proof->'id') IS DISTINCT FROM 'string' OR jsonb_typeof(proof->'reference') IS DISTINCT FROM 'string'
  OR jsonb_typeof(proof->'description') IS DISTINCT FROM 'string' OR jsonb_typeof(proof->'rationale') IS DISTINCT FROM 'string'
  OR jsonb_typeof(proof->'sha256') IS DISTINCT FROM 'string'
  OR length(btrim(proof->>'reference')) NOT BETWEEN 5 AND 200 OR length(btrim(proof->>'description')) NOT BETWEEN 20 AND 4000
  OR length(btrim(proof->>'rationale')) NOT BETWEEN 10 AND 2000
  OR proof->>'sha256' IS DISTINCT FROM id15_hash_scalars(proof-'id'-'sha256') THEN
   RAISE EXCEPTION 'Described, justified and hashed textual proof required' USING ERRCODE='23514';
  END IF;
  proof_id:=(proof->>'id')::uuid;
 END LOOP;
 IF (SELECT count(DISTINCT (x->>'id')::uuid) FROM (SELECT value AS x FROM jsonb_array_elements(NEW.proof_package->'files') UNION ALL SELECT value FROM jsonb_array_elements(NEW.proof_package->'texts')) p)
 <>jsonb_array_length(NEW.proof_package->'files')+jsonb_array_length(NEW.proof_package->'texts')
 OR (SELECT count(DISTINCT x->>'reference') FROM jsonb_array_elements(NEW.proof_package->'texts') x)<>jsonb_array_length(NEW.proof_package->'texts') THEN
  RAISE EXCEPTION 'Duplicate proof IDs or textual references' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
 RAISE EXCEPTION 'Invalid efficacy opinion snapshot value' USING ERRCODE='23514';
END $$;
CREATE TRIGGER action_efficacy_opinions_guard BEFORE INSERT OR UPDATE OR DELETE ON action_efficacy_opinions FOR EACH ROW EXECUTE FUNCTION protect_action_efficacy_opinion();
