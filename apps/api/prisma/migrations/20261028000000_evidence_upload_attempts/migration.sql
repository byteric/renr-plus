CREATE TABLE evidence_upload_attempts (
 id UUID PRIMARY KEY,
 organization_id UUID NOT NULL,
 action_id UUID NOT NULL,
 creator_id UUID NOT NULL,
 key UUID NOT NULL,
 state VARCHAR(16) NOT NULL,
 attempt_version INTEGER NOT NULL DEFAULT 1,
 fingerprint CHAR(64) NOT NULL,
 description VARCHAR(1000) NOT NULL,
 file_name VARCHAR(100) NOT NULL,
 object_key VARCHAR(240) NOT NULL UNIQUE,
 mime_type VARCHAR(64) NOT NULL,
 size INTEGER NOT NULL,
 sha256 CHAR(64) NOT NULL,
 lease_token UUID,
 lease_expires_at TIMESTAMP(3),
 object_state VARCHAR(8),
 expected_version INTEGER NOT NULL,
 evidence_id UUID UNIQUE,
 abandon_reason VARCHAR(1000),
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP(3) NOT NULL,
 CONSTRAINT evidence_upload_attempts_scope_key UNIQUE (organization_id, action_id, creator_id, key),
 CONSTRAINT evidence_upload_attempts_action_fkey FOREIGN KEY (organization_id, action_id) REFERENCES actions(organization_id,id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 CONSTRAINT evidence_upload_attempts_evidence_fkey FOREIGN KEY (organization_id, action_id, evidence_id) REFERENCES action_evidence(organization_id,action_id,id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 CONSTRAINT evidence_upload_attempts_creator_fkey FOREIGN KEY (creator_id,organization_id) REFERENCES memberships(user_id,organization_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 CONSTRAINT evidence_upload_attempts_state_check CHECK (state IN ('UPLOADING','UNCERTAIN','RETRYABLE','COMPLETED','ABANDONED')),
 CONSTRAINT evidence_upload_attempts_version_check CHECK (attempt_version>0 AND expected_version>0),
 CONSTRAINT evidence_upload_attempts_metadata_check CHECK (size BETWEEN 1 AND 5242880 AND mime_type IN ('application/pdf','image/png','image/jpeg') AND sha256 ~ '^[a-f0-9]{64}$' AND fingerprint ~ '^[a-f0-9]{64}$' AND length(btrim(description)) BETWEEN 10 AND 1000),
 CONSTRAINT evidence_upload_attempts_object_state_check CHECK (object_state IS NULL OR object_state IN ('PRESENT','ABSENT','UNKNOWN')),
 CONSTRAINT evidence_upload_attempts_completion_check CHECK ((state='COMPLETED')=(evidence_id IS NOT NULL)),
 CONSTRAINT evidence_upload_attempts_lease_check CHECK ((lease_token IS NULL)=(lease_expires_at IS NULL) AND (state NOT IN ('COMPLETED','ABANDONED','RETRYABLE') OR lease_token IS NULL)),
 CONSTRAINT evidence_upload_attempts_retry_check CHECK (state<>'RETRYABLE' OR object_state='ABSENT'),
 CONSTRAINT evidence_upload_attempts_abandon_check CHECK ((state='ABANDONED')=(abandon_reason IS NOT NULL))
);
-- Count reservations for the twenty-attachment limit under the action lock.
CREATE INDEX evidence_upload_attempts_reservations_idx ON evidence_upload_attempts(organization_id,action_id) WHERE state NOT IN ('COMPLETED','ABANDONED');
CREATE FUNCTION guard_evidence_upload_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.organization_id,NEW.action_id,NEW.creator_id,NEW.key,NEW.fingerprint,NEW.description,NEW.file_name,NEW.object_key,NEW.mime_type,NEW.size,NEW.sha256,NEW.created_at)
 IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.action_id,OLD.creator_id,OLD.key,OLD.fingerprint,OLD.description,OLD.file_name,OLD.object_key,OLD.mime_type,OLD.size,OLD.sha256,OLD.created_at) THEN
 RAISE EXCEPTION 'Upload metadata is immutable' USING ERRCODE='23514';
 END IF;
 IF OLD.state IN ('COMPLETED','ABANDONED') THEN
 RAISE EXCEPTION 'Upload attempt is terminal' USING ERRCODE='23514';
 END IF;
 IF NEW.attempt_version<>OLD.attempt_version+1 THEN
 RAISE EXCEPTION 'Upload version must advance' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER evidence_upload_attempt_guard BEFORE UPDATE ON evidence_upload_attempts FOR EACH ROW EXECUTE FUNCTION guard_evidence_upload_attempt();
