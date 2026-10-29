-- ID17/18: additive immutable continuity records; prior migrations remain unchanged.
CREATE TABLE risk_reassessments (
 id UUID PRIMARY KEY, organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 risk_id UUID NOT NULL, evaluation_id UUID NOT NULL UNIQUE, previous_evaluation_id UUID NOT NULL,
 author_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(organization_id,risk_id,id),
 CONSTRAINT risk_reassessments_risk_fkey FOREIGN KEY(organization_id,risk_id) REFERENCES risks(organization_id,id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 CONSTRAINT risk_reassessments_evaluation_fkey FOREIGN KEY(organization_id,risk_id,evaluation_id) REFERENCES technical_risk_evaluations(organization_id,risk_id,id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 CONSTRAINT risk_reassessments_previousevaluation_fkey FOREIGN KEY(organization_id,risk_id,previous_evaluation_id) REFERENCES technical_risk_evaluations(organization_id,risk_id,id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 CHECK(evaluation_id<>previous_evaluation_id)
);
CREATE INDEX risk_reassessments_organization_id_risk_id_created_at_id_idx ON risk_reassessments(organization_id,risk_id,created_at,id);
CREATE TABLE reassessment_measures (
 id UUID PRIMARY KEY, organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 risk_id UUID NOT NULL, reassessment_id UUID NOT NULL, action_id UUID NOT NULL, opinion_id UUID NOT NULL,
 action_version INTEGER NOT NULL, action_fingerprint VARCHAR(64) NOT NULL, risk_context_fingerprint VARCHAR(64) NOT NULL,
 context_fingerprint VARCHAR(64) NOT NULL, consideration VARCHAR(4000) NOT NULL,
 UNIQUE(reassessment_id,action_id),
 CONSTRAINT reassessment_measures_risk_fkey FOREIGN KEY(organization_id,risk_id) REFERENCES risks(organization_id,id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 CONSTRAINT reassessment_measures_reassessment_fkey FOREIGN KEY(organization_id,risk_id,reassessment_id) REFERENCES risk_reassessments(organization_id,risk_id,id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 CONSTRAINT reassessment_measures_action_fkey FOREIGN KEY(organization_id,action_id) REFERENCES actions(organization_id,id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 CONSTRAINT reassessment_measures_opinion_fkey FOREIGN KEY(organization_id,action_id,opinion_id) REFERENCES action_efficacy_opinions(organization_id,action_id,id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 CONSTRAINT reassessment_measures_revision_fkey FOREIGN KEY(action_id,action_version) REFERENCES action_revisions(action_id,version) ON DELETE RESTRICT ON UPDATE NO ACTION,
 CHECK(action_version>0 AND length(btrim(consideration)) BETWEEN 20 AND 4000
 AND action_fingerprint ~ '^[0-9a-f]{64}$' AND risk_context_fingerprint ~ '^[0-9a-f]{64}$' AND context_fingerprint ~ '^[0-9a-f]{64}$')
);
CREATE INDEX reassessment_measures_organization_id_action_id_idx ON reassessment_measures(organization_id,action_id);
CREATE TABLE action_technical_closures (
 id UUID PRIMARY KEY, organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 risk_id UUID NOT NULL, action_id UUID NOT NULL, sequence INTEGER NOT NULL, supersedes_id UUID UNIQUE,
 reassessment_id UUID NOT NULL, opinion_id UUID NOT NULL, action_version INTEGER NOT NULL, risk_version INTEGER NOT NULL,
 action_fingerprint VARCHAR(64) NOT NULL, risk_context_fingerprint VARCHAR(64) NOT NULL, context_fingerprint VARCHAR(64) NOT NULL,
 proof_package JSONB NOT NULL, rationale VARCHAR(4000) NOT NULL,
 author_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(organization_id,action_id,id), UNIQUE(action_id,sequence),
 CONSTRAINT action_technical_closures_risk_fkey FOREIGN KEY(organization_id,risk_id) REFERENCES risks(organization_id,id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 CONSTRAINT action_technical_closures_action_fkey FOREIGN KEY(organization_id,action_id) REFERENCES actions(organization_id,id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 CONSTRAINT action_technical_closures_reassessment_fkey FOREIGN KEY(organization_id,risk_id,reassessment_id) REFERENCES risk_reassessments(organization_id,risk_id,id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 CONSTRAINT action_technical_closures_opinion_fkey FOREIGN KEY(organization_id,action_id,opinion_id) REFERENCES action_efficacy_opinions(organization_id,action_id,id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 CONSTRAINT action_technical_closures_revision_fkey FOREIGN KEY(action_id,action_version) REFERENCES action_revisions(action_id,version) ON DELETE RESTRICT ON UPDATE NO ACTION,
 CONSTRAINT action_technical_closures_predecessor_fkey FOREIGN KEY(organization_id,action_id,supersedes_id) REFERENCES action_technical_closures(organization_id,action_id,id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 CHECK(sequence>0 AND action_version>0 AND risk_version>0 AND length(btrim(rationale)) BETWEEN 20 AND 4000
 AND action_fingerprint ~ '^[0-9a-f]{64}$' AND risk_context_fingerprint ~ '^[0-9a-f]{64}$' AND context_fingerprint ~ '^[0-9a-f]{64}$')
);
CREATE INDEX action_technical_closures_org_action_created_idx ON action_technical_closures(organization_id,action_id,created_at,id);
CREATE TABLE action_corrective_links (
 id UUID PRIMARY KEY, organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 risk_id UUID NOT NULL, previous_action_id UUID NOT NULL, new_action_id UUID NOT NULL UNIQUE, opinion_id UUID NOT NULL,
 reason VARCHAR(4000) NOT NULL, author_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT action_corrective_links_risk_fkey FOREIGN KEY(organization_id,risk_id) REFERENCES risks(organization_id,id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 CONSTRAINT action_corrective_links_previousaction_fkey FOREIGN KEY(organization_id,previous_action_id) REFERENCES actions(organization_id,id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 CONSTRAINT action_corrective_links_newaction_fkey FOREIGN KEY(organization_id,new_action_id) REFERENCES actions(organization_id,id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 CONSTRAINT action_corrective_links_opinion_fkey FOREIGN KEY(organization_id,previous_action_id,opinion_id) REFERENCES action_efficacy_opinions(organization_id,action_id,id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 CHECK(previous_action_id<>new_action_id AND length(btrim(reason)) BETWEEN 20 AND 4000)
);
CREATE INDEX action_corrective_links_org_previous_created_idx ON action_corrective_links(organization_id,previous_action_id,created_at,id);

CREATE FUNCTION id17_lock_context(org_id UUID, actor_id UUID, origin_id UUID, action_ids UUID[], risk_update BOOLEAN) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE org organizations%ROWTYPE; member memberships%ROWTYPE; r risks%ROWTYPE; scope RECORD;
BEGIN
 SELECT * INTO org FROM organizations WHERE id=org_id FOR SHARE;
 IF NOT FOUND OR NOT org.is_active THEN RAISE EXCEPTION 'Active organization required' USING ERRCODE='23514'; END IF;
 SELECT * INTO member FROM memberships WHERE organization_id=org_id AND user_id=actor_id FOR SHARE;
 IF NOT FOUND OR NOT member.is_active OR NOT ('TECHNICAL_DECISIONS'::"Capability"=ANY(member.capabilities)) THEN
  RAISE EXCEPTION 'Active TECHNICAL_DECISIONS capability required' USING ERRCODE='23514'; END IF;
 IF risk_update THEN SELECT * INTO r FROM risks WHERE organization_id=org_id AND id=origin_id FOR UPDATE;
 ELSE SELECT * INTO r FROM risks WHERE organization_id=org_id AND id=origin_id FOR SHARE; END IF;
 IF r.id IS NULL OR r.status<>'REGISTERED' THEN RAISE EXCEPTION 'Registered origin risk required' USING ERRCODE='23514'; END IF;
 PERFORM id FROM actions WHERE organization_id=org_id AND id=ANY(action_ids) ORDER BY id FOR UPDATE;
 IF (SELECT count(*) FROM actions WHERE organization_id=org_id AND risk_id=origin_id AND id=ANY(action_ids))<>cardinality(action_ids) THEN
  RAISE EXCEPTION 'Same-risk actions required' USING ERRCODE='23514'; END IF;
 -- Reassessment insertion has no measures yet; defer hierarchy locks until ordered action locks exist.
 IF cardinality(action_ids)=0 THEN RETURN; END IF;
 SELECT g.is_active AS ga,s.is_active AS sa,u.is_active AS ua INTO scope FROM assessment_groups g
 JOIN sectors s ON s.organization_id=g.organization_id AND s.id=g.sector_id
 JOIN units u ON u.organization_id=s.organization_id AND u.id=s.unit_id
 WHERE g.organization_id=org_id AND g.id=r.assessment_group_id FOR SHARE OF g,s,u;
 IF NOT FOUND OR NOT scope.ga OR NOT scope.sa OR NOT scope.ua THEN RAISE EXCEPTION 'Active origin hierarchy required' USING ERRCODE='23514'; END IF;
END $$;

-- Run before the legacy evaluation guard (PostgreSQL orders same-kind triggers by name).
-- Low-frequency technical decisions serialize all origin actions before taking hierarchy locks.
CREATE FUNCTION id17_lock_technical_evaluation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ids UUID[];
BEGIN
 PERFORM id17_lock_context(NEW.organization_id,NEW.author_id,NEW.risk_id,ARRAY[]::uuid[],true);
 SELECT coalesce(array_agg(id ORDER BY id),ARRAY[]::uuid[]) INTO ids FROM actions WHERE organization_id=NEW.organization_id AND risk_id=NEW.risk_id;
 PERFORM id17_lock_context(NEW.organization_id,NEW.author_id,NEW.risk_id,ids,true);
 RETURN NEW;
END $$;
CREATE TRIGGER a_id17_technical_evaluations_lock_order BEFORE INSERT ON technical_risk_evaluations FOR EACH ROW EXECUTE FUNCTION id17_lock_technical_evaluation();

-- Caller holds context locks. Only selected evidence participates in validity.
CREATE FUNCTION id17_opinion_current(org_id UUID, origin_id UUID, action_id_arg UUID, opinion_id_arg UUID) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE a actions%ROWTYPE; r risks%ROWTYPE; o action_efficacy_opinions%ROWTYPE; scope RECORD; af TEXT; rf TEXT; proof JSONB; f action_evidence%ROWTYPE;
BEGIN
 SELECT * INTO a FROM actions WHERE organization_id=org_id AND id=action_id_arg AND risk_id=origin_id;
 IF NOT FOUND OR a.status<>'IMPLEMENTED' THEN RETURN false; END IF;
 SELECT * INTO o FROM action_efficacy_opinions WHERE organization_id=org_id AND action_id=a.id ORDER BY sequence DESC LIMIT 1;
 IF NOT FOUND OR o.id<>opinion_id_arg OR o.risk_id<>origin_id OR o.action_version>a.version THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM action_revisions WHERE organization_id=org_id AND action_id=a.id AND version=a.version) THEN RETURN false; END IF;
 SELECT * INTO r FROM risks WHERE organization_id=org_id AND id=origin_id;
 SELECT s.id AS sector_id,u.id AS unit_id INTO scope FROM assessment_groups g
 JOIN sectors s ON s.organization_id=g.organization_id AND s.id=g.sector_id
 JOIN units u ON u.organization_id=s.organization_id AND u.id=s.unit_id WHERE g.organization_id=org_id AND g.id=r.assessment_group_id;
 af:=id15_hash_scalars(jsonb_build_object('title',a.title,'description',a.description,'expectedResult',a.expected_result,'verificationCriterion',a.verification_criterion,'status',a.status,'implementationNote',a.implementation_note,'implementedAt',CASE WHEN a.implemented_at IS NULL THEN NULL ELSE to_char(a.implemented_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END));
 rf:=id15_hash_scalars(jsonb_build_object('factor',r.factor,'description',r.description,'exposureDescription',r.exposure_description,'exposedGroupDescription',r.exposed_group_description,'possibleHarms',r.possible_harms,'existingControls',r.existing_controls,'sourceKind',r.source_kind,'sourceNote',r.source_note,'diagnosticCycleId',r.diagnostic_cycle_id,'assessmentGroupId',r.assessment_group_id,'sectorId',scope.sector_id,'unitId',scope.unit_id));
 IF o.action_fingerprint IS DISTINCT FROM af OR o.risk_context_fingerprint IS DISTINCT FROM rf
 OR o.context_fingerprint IS DISTINCT FROM id15_hash_scalars(jsonb_build_object('actionFingerprint',af,'riskContextFingerprint',rf)) THEN RETURN false; END IF;
 -- Opinion insertion already validates textual hashes and package shape; decisions are immutable.
 FOR proof IN SELECT value FROM jsonb_array_elements(o.proof_package->'files') ORDER BY (value->>'id')::uuid LOOP
  SELECT * INTO f FROM action_evidence WHERE organization_id=org_id AND action_id=a.id AND id=(proof->>'id')::uuid FOR SHARE;
  IF NOT FOUND OR f.archived_at IS NOT NULL OR proof IS DISTINCT FROM jsonb_build_object('id',f.id,'fileName',f.file_name,'description',f.description,'mimeType',f.mime_type,'size',f.size,'sha256',f.sha256) THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;

CREATE FUNCTION protect_risk_reassessment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e technical_risk_evaluations%ROWTYPE; p technical_risk_evaluations%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Continuity history is append-only' USING ERRCODE='23514'; END IF;
 PERFORM id17_lock_context(NEW.organization_id,NEW.author_id,NEW.risk_id,ARRAY[]::uuid[],true);
 SELECT * INTO e FROM technical_risk_evaluations WHERE organization_id=NEW.organization_id AND risk_id=NEW.risk_id ORDER BY sequence DESC LIMIT 1;
 SELECT * INTO p FROM technical_risk_evaluations WHERE organization_id=NEW.organization_id AND risk_id=NEW.risk_id AND sequence=e.sequence-1;
 IF e.id IS DISTINCT FROM NEW.evaluation_id OR p.id IS DISTINCT FROM NEW.previous_evaluation_id OR e.author_id IS DISTINCT FROM NEW.author_id
 OR NOT EXISTS(SELECT 1 FROM technical_risk_evaluations WHERE id=e.id AND pg_xact_status(xmin::text::xid8)='in progress') THEN
  RAISE EXCEPTION 'New same-author evaluation and immediate predecessor required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER risk_reassessments_guard BEFORE INSERT OR UPDATE OR DELETE ON risk_reassessments FOR EACH ROW EXECUTE FUNCTION protect_risk_reassessment();

CREATE FUNCTION id17_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Continuity history is append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER reassessment_measures_immutable BEFORE UPDATE OR DELETE ON reassessment_measures FOR EACH ROW EXECUTE FUNCTION id17_append_only();

-- A deferred constraint lets the aggregate and its 1..20 measures be written atomically.
CREATE FUNCTION validate_reassessment_measures() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rr risk_reassessments%ROWTYPE; m reassessment_measures%ROWTYPE; o action_efficacy_opinions%ROWTYPE; ids UUID[]; n INTEGER;
BEGIN
 IF TG_TABLE_NAME='risk_reassessments' THEN rr:=NEW;
 ELSE SELECT * INTO rr FROM risk_reassessments WHERE id=NEW.reassessment_id; END IF;
 IF NOT EXISTS(SELECT 1 FROM risk_reassessments WHERE id=rr.id AND pg_xact_status(xmin::text::xid8)='in progress') THEN
  RAISE EXCEPTION 'Measures must be created with their reassessment' USING ERRCODE='23514'; END IF;
 SELECT count(*),array_agg(action_id ORDER BY action_id) INTO n,ids FROM reassessment_measures WHERE reassessment_id=rr.id;
 IF n NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'One to twenty distinct measures required' USING ERRCODE='23514'; END IF;
 PERFORM id17_lock_context(rr.organization_id,rr.author_id,rr.risk_id,ids,true);
 -- Acquire all selected evidence across actions in UUID order before individual validation.
 PERFORM f.id FROM action_evidence f WHERE f.organization_id=rr.organization_id AND f.id IN
 (SELECT (p.value->>'id')::uuid FROM reassessment_measures x JOIN action_efficacy_opinions op ON op.id=x.opinion_id
 CROSS JOIN LATERAL jsonb_array_elements(op.proof_package->'files') p WHERE x.reassessment_id=rr.id) ORDER BY f.id FOR SHARE;
 FOR m IN SELECT * FROM reassessment_measures WHERE reassessment_id=rr.id ORDER BY action_id LOOP
  SELECT * INTO o FROM action_efficacy_opinions WHERE id=m.opinion_id;
  IF m.organization_id<>rr.organization_id OR m.risk_id<>rr.risk_id OR m.action_version IS DISTINCT FROM (SELECT version FROM actions WHERE id=m.action_id)
  OR NOT id17_opinion_current(rr.organization_id,rr.risk_id,m.action_id,m.opinion_id)
  OR m.action_fingerprint IS DISTINCT FROM o.action_fingerprint OR m.risk_context_fingerprint IS DISTINCT FROM o.risk_context_fingerprint OR m.context_fingerprint IS DISTINCT FROM o.context_fingerprint THEN
   RAISE EXCEPTION 'Current same-risk opinion, revision and fingerprints required' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER risk_reassessments_measures_guard AFTER INSERT ON risk_reassessments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_reassessment_measures();
CREATE CONSTRAINT TRIGGER reassessment_measures_guard AFTER INSERT ON reassessment_measures DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_reassessment_measures();

CREATE FUNCTION protect_action_technical_closure() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a actions%ROWTYPE; r risks%ROWTYPE; o action_efficacy_opinions%ROWTYPE; previous action_technical_closures%ROWTYPE; latest_eval UUID; rr risk_reassessments%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Continuity history is append-only' USING ERRCODE='23514'; END IF;
 PERFORM id17_lock_context(NEW.organization_id,NEW.author_id,NEW.risk_id,ARRAY[NEW.action_id],false);
 SELECT * INTO a FROM actions WHERE id=NEW.action_id; SELECT * INTO r FROM risks WHERE id=NEW.risk_id;
 SELECT * INTO o FROM action_efficacy_opinions WHERE id=NEW.opinion_id;
 SELECT id INTO latest_eval FROM technical_risk_evaluations WHERE organization_id=NEW.organization_id AND risk_id=NEW.risk_id ORDER BY sequence DESC LIMIT 1;
 SELECT * INTO rr FROM risk_reassessments WHERE id=NEW.reassessment_id;
 IF a.status<>'IMPLEMENTED' OR NEW.action_version<>a.version OR NEW.risk_version<>r.version
 OR o.result IS DISTINCT FROM 'EFFECTIVE' OR NOT id17_opinion_current(NEW.organization_id,NEW.risk_id,a.id,NEW.opinion_id)
 OR rr.evaluation_id IS DISTINCT FROM latest_eval OR rr.organization_id IS DISTINCT FROM NEW.organization_id OR rr.risk_id IS DISTINCT FROM NEW.risk_id
 OR NOT EXISTS(SELECT 1 FROM reassessment_measures WHERE reassessment_id=rr.id AND action_id=a.id AND opinion_id=o.id)
 OR NEW.action_fingerprint IS DISTINCT FROM o.action_fingerprint OR NEW.risk_context_fingerprint IS DISTINCT FROM o.risk_context_fingerprint
 OR NEW.context_fingerprint IS DISTINCT FROM o.context_fingerprint OR NEW.proof_package IS DISTINCT FROM o.proof_package THEN
  RAISE EXCEPTION 'Effective current opinion and latest reassessment with exact frozen proofs required' USING ERRCODE='23514'; END IF;
 SELECT * INTO previous FROM action_technical_closures WHERE action_id=a.id ORDER BY sequence DESC LIMIT 1;
 IF NEW.sequence<>coalesce(previous.sequence,0)+1 OR NEW.supersedes_id IS DISTINCT FROM previous.id THEN
  RAISE EXCEPTION 'Immediate closure predecessor and next sequence required' USING ERRCODE='23514'; END IF;
 IF previous.id IS NOT NULL AND previous.opinion_id=o.id AND previous.action_fingerprint=o.action_fingerprint
 AND previous.risk_context_fingerprint=o.risk_context_fingerprint AND previous.proof_package=o.proof_package
 AND EXISTS(SELECT 1 FROM risk_reassessments WHERE id=previous.reassessment_id AND evaluation_id=latest_eval) THEN
  RAISE EXCEPTION 'Previous closure must require review before replacement' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER action_technical_closures_guard BEFORE INSERT OR UPDATE OR DELETE ON action_technical_closures FOR EACH ROW EXECUTE FUNCTION protect_action_technical_closure();

CREATE FUNCTION protect_action_corrective_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a actions%ROWTYPE; child actions%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Continuity history is append-only' USING ERRCODE='23514'; END IF;
 PERFORM id17_lock_context(NEW.organization_id,NEW.author_id,NEW.risk_id,ARRAY(SELECT x FROM unnest(ARRAY[NEW.previous_action_id,NEW.new_action_id]) x ORDER BY x),true);
 IF NOT EXISTS(SELECT 1 FROM memberships WHERE organization_id=NEW.organization_id AND user_id=NEW.author_id AND role='ADMIN') THEN
  RAISE EXCEPTION 'Operational administrator and technical capability required' USING ERRCODE='23514'; END IF;
 SELECT * INTO a FROM actions WHERE id=NEW.previous_action_id; SELECT * INTO child FROM actions WHERE id=NEW.new_action_id;
 IF NOT id17_opinion_current(NEW.organization_id,NEW.risk_id,a.id,NEW.opinion_id) OR child.status<>'PLANNED' OR child.version<>1 OR child.created_by_id<>NEW.author_id
 OR NOT EXISTS(SELECT 1 FROM actions WHERE id=child.id AND pg_xact_status(xmin::text::xid8)='in progress')
 OR NOT EXISTS(SELECT 1 FROM action_revisions WHERE organization_id=NEW.organization_id AND action_id=child.id AND version=1 AND event='CREATED' AND author_id=NEW.author_id AND pg_xact_status(xmin::text::xid8)='in progress') THEN
  RAISE EXCEPTION 'Current motivating opinion and newly created planned same-author action required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER action_corrective_links_guard BEFORE INSERT OR UPDATE OR DELETE ON action_corrective_links FOR EACH ROW EXECUTE FUNCTION protect_action_corrective_link();
