CREATE TABLE action_evidence (
 id UUID PRIMARY KEY, organization_id UUID NOT NULL, action_id UUID NOT NULL, description VARCHAR(1000) NOT NULL,
 file_name VARCHAR(100) NOT NULL, object_key VARCHAR(240) NOT NULL, mime_type VARCHAR(64) NOT NULL CHECK(mime_type IN ('application/pdf','image/png','image/jpeg')),
 size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 5242880), sha256 CHAR(64) NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 action_version INTEGER NOT NULL CHECK(action_version > 0), created_by_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, archived_at TIMESTAMP(3), archived_by_id UUID REFERENCES users(id) ON DELETE RESTRICT,
 archive_reason VARCHAR(1000), FOREIGN KEY(organization_id,action_id) REFERENCES actions(organization_id,id) ON DELETE RESTRICT,
 CHECK((archived_at IS NULL AND archived_by_id IS NULL AND archive_reason IS NULL) OR (archived_at IS NOT NULL AND archived_by_id IS NOT NULL AND archive_reason IS NOT NULL AND length(archive_reason) BETWEEN 10 AND 1000))
);
CREATE UNIQUE INDEX "action_evidence_object_key_key" ON action_evidence(object_key);
CREATE UNIQUE INDEX "action_evidence_organization_id_action_id_id_key" ON action_evidence(organization_id,action_id,id);
-- Paginated private attachment history by parent action.
CREATE INDEX "action_evidence_organization_id_action_id_created_at_id_idx" ON action_evidence(organization_id,action_id,created_at,id);
ALTER TABLE action_revisions ADD COLUMN evidence_id UUID;
ALTER TABLE action_revisions ADD FOREIGN KEY(organization_id,action_id,evidence_id) REFERENCES action_evidence(organization_id,action_id,id) ON DELETE RESTRICT;
ALTER TABLE action_revisions DROP CONSTRAINT action_revisions_event_check;
ALTER TABLE action_revisions ADD CONSTRAINT action_revisions_event_check CHECK(event IN ('CREATED','UPDATED','STARTED','IMPLEMENTED','CANCELLED','NOTE','EVIDENCE_ADDED','EVIDENCE_ARCHIVED'));
CREATE FUNCTION protect_action_evidence_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Evidence history is immutable' USING ERRCODE='23514'; END IF;
 IF OLD.archived_at IS NOT NULL OR NEW.archived_at IS NULL OR
 ROW(NEW.id,NEW.organization_id,NEW.action_id,NEW.description,NEW.file_name,NEW.object_key,NEW.mime_type,NEW.size,NEW.sha256,NEW.action_version,NEW.created_by_id,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.organization_id,OLD.action_id,OLD.description,OLD.file_name,OLD.object_key,OLD.mime_type,OLD.size,OLD.sha256,OLD.action_version,OLD.created_by_id,OLD.created_at)
 THEN RAISE EXCEPTION 'Only first evidence archival is permitted' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER action_evidence_history BEFORE UPDATE OR DELETE ON action_evidence FOR EACH ROW EXECUTE FUNCTION protect_action_evidence_history();
