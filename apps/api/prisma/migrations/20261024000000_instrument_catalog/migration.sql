-- Expand the catalog while preserving version, question, answer and cycle identities.
SET lock_timeout = '5s';
ALTER TYPE "DiagnosticQuestionType" ADD VALUE IF NOT EXISTS 'ORDINAL_CHOICE';
CREATE TYPE "InstrumentUsageMode" AS ENUM ('DEMONSTRATION', 'REAL');
CREATE TABLE instruments (
 id UUID PRIMARY KEY, organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 name VARCHAR(160) NOT NULL, system_key VARCHAR(40), created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(organization_id,id), UNIQUE(organization_id,system_key)
);
ALTER TABLE instrument_versions
 ADD COLUMN instrument_id UUID DEFAULT NULL,
 ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
 ADD COLUMN description VARCHAR(2000) NOT NULL DEFAULT '',
 ADD COLUMN instructions VARCHAR(4000) NOT NULL DEFAULT '',
 ADD COLUMN usage_mode "InstrumentUsageMode" NOT NULL DEFAULT 'DEMONSTRATION',
 ADD COLUMN approval_reference VARCHAR(1000), ADD COLUMN published_at TIMESTAMP(3), ADD COLUMN published_by_id UUID REFERENCES users(id) ON DELETE RESTRICT,
 ADD COLUMN updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 ADD COLUMN creation_transaction TEXT NOT NULL DEFAULT txid_current()::text;
INSERT INTO instruments(id,organization_id,name,system_key,created_at)
 SELECT id,organization_id,title,CASE WHEN is_demo AND version=1 THEN 'LEGACY_DEMO' ELSE NULL END,created_at FROM instrument_versions;
UPDATE instrument_versions SET instrument_id=id, is_demo=(is_demo AND version=1), published_at=CASE WHEN status='PUBLISHED' THEN created_at ELSE NULL END;
ALTER TABLE instrument_versions ALTER COLUMN instrument_id SET NOT NULL;
ALTER TABLE instrument_versions ADD CONSTRAINT instrument_versions_instrument_fkey FOREIGN KEY(organization_id,instrument_id) REFERENCES instruments(organization_id,id) ON DELETE RESTRICT;
DROP INDEX instrument_versions_organization_id_version_key;
CREATE UNIQUE INDEX instrument_versions_instrument_id_version_key ON instrument_versions(instrument_id,version);
-- Frozen diagnostic readers select is_demo/version=1; exactly one reserved projection remains.
CREATE UNIQUE INDEX instrument_versions_legacy_demo_key ON instrument_versions(organization_id) WHERE is_demo;
ALTER TABLE instrument_versions ADD CONSTRAINT instrument_versions_status_check CHECK(status IN ('DRAFT','PUBLISHED'));
ALTER TABLE instrument_versions ADD CONSTRAINT instrument_versions_version_check CHECK(version > 0);
ALTER TABLE diagnostic_questions DROP CONSTRAINT diagnostic_questions_instrument_version_id_fkey;
ALTER TABLE diagnostic_questions ADD CONSTRAINT diagnostic_questions_instrument_version_id_fkey FOREIGN KEY(instrument_version_id) REFERENCES instrument_versions(id) ON DELETE CASCADE;
ALTER TABLE question_options DROP CONSTRAINT question_options_instrument_version_id_question_id_fkey;
ALTER TABLE question_options ADD CONSTRAINT question_options_instrument_version_id_question_id_fkey FOREIGN KEY(instrument_version_id,question_id) REFERENCES diagnostic_questions(instrument_version_id,id) ON DELETE CASCADE;

CREATE FUNCTION prepare_instrument_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE catalog instruments%ROWTYPE;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.instrument_id IS NULL THEN
   IF NOT NEW.is_demo OR NEW.version<>1 OR NEW.status<>'PUBLISHED' THEN RAISE EXCEPTION 'Only the reserved legacy projection may omit instrument identity' USING ERRCODE='23514'; END IF;
   INSERT INTO instruments(id,organization_id,name,system_key) VALUES(gen_random_uuid(),NEW.organization_id,NEW.title,'LEGACY_DEMO')
    ON CONFLICT(organization_id,system_key) DO UPDATE SET system_key=EXCLUDED.system_key RETURNING * INTO catalog;
   NEW.instrument_id=catalog.id;
  ELSE SELECT * INTO catalog FROM instruments WHERE id=NEW.instrument_id AND organization_id=NEW.organization_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Instrument unavailable in organization' USING ERRCODE='23503'; END IF;
  END IF;
  IF catalog.system_key='LEGACY_DEMO' AND NEW.is_demo THEN
   IF NOT NEW.is_demo OR NEW.version<>1 OR NEW.usage_mode<>'DEMONSTRATION' OR NEW.status<>'PUBLISHED' THEN RAISE EXCEPTION 'Invalid reserved legacy projection' USING ERRCODE='23514'; END IF;
   NEW.published_at=COALESCE(NEW.published_at,NEW.created_at);
  ELSE
   IF NEW.is_demo OR NEW.status<>'DRAFT' THEN RAISE EXCEPTION 'Catalog versions start as non-legacy drafts' USING ERRCODE='23514'; END IF;
  END IF;
  NEW.creation_transaction=txid_current()::text;
 ELSE
  IF OLD.status='PUBLISHED' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Published instrument content is immutable' USING ERRCODE='23514'; END IF;
  IF ROW(NEW.id,NEW.organization_id,NEW.instrument_id,NEW.version,NEW.is_demo,NEW.created_at,NEW.creation_transaction) IS DISTINCT FROM ROW(OLD.id,OLD.organization_id,OLD.instrument_id,OLD.version,OLD.is_demo,OLD.created_at,OLD.creation_transaction) THEN RAISE EXCEPTION 'Instrument version identity is immutable' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status='DRAFT' AND (NEW.approval_reference IS NOT NULL OR NEW.published_at IS NOT NULL OR NEW.published_by_id IS NOT NULL) THEN RAISE EXCEPTION 'Draft cannot inherit publication approval' USING ERRCODE='23514'; END IF;
 IF NEW.status='PUBLISHED' AND NEW.usage_mode='REAL' AND (length(trim(COALESCE(NEW.approval_reference,'')))=0 OR NEW.published_by_id IS NULL OR NEW.published_at IS NULL) THEN RAISE EXCEPTION 'Real publication requires approval provenance' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER instrument_versions_prepare BEFORE INSERT OR UPDATE ON instrument_versions FOR EACH ROW EXECUTE FUNCTION prepare_instrument_version();

CREATE FUNCTION protect_instrument_child() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent instrument_versions%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN
  SELECT * INTO parent FROM instrument_versions WHERE id=OLD.instrument_version_id FOR SHARE;
  -- Owner maintenance deletes the unreferenced version first; cascades then remove children.
  IF NOT FOUND AND TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF parent.status='PUBLISHED' THEN RAISE EXCEPTION 'Published instrument children are immutable' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP<>'DELETE' THEN
  SELECT * INTO parent FROM instrument_versions WHERE id=NEW.instrument_version_id FOR SHARE;
  IF parent.status='PUBLISHED' AND NOT (TG_OP='INSERT' AND parent.is_demo AND parent.creation_transaction=txid_current()::text) THEN RAISE EXCEPTION 'Cannot insert or move children into a published instrument' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 RETURN OLD;
END; $$;
CREATE TRIGGER diagnostic_questions_immutable BEFORE INSERT OR UPDATE OR DELETE ON diagnostic_questions FOR EACH ROW EXECUTE FUNCTION protect_instrument_child();
CREATE TRIGGER question_options_immutable BEFORE INSERT OR UPDATE OR DELETE ON question_options FOR EACH ROW EXECUTE FUNCTION protect_instrument_child();

CREATE FUNCTION validate_instrument_publication() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version_id UUID; parent instrument_versions%ROWTYPE; question_count INTEGER;
BEGIN
 IF TG_TABLE_NAME='instrument_versions' THEN version_id=COALESCE(NEW.id,OLD.id);
 ELSE version_id=COALESCE(NEW.instrument_version_id,OLD.instrument_version_id); END IF;
 SELECT * INTO parent FROM instrument_versions WHERE id=version_id;
 IF NOT FOUND OR parent.status<>'PUBLISHED' THEN RETURN NULL; END IF;
 SELECT count(*) INTO question_count FROM diagnostic_questions WHERE instrument_version_id=version_id;
 IF length(trim(parent.title))=0 OR question_count NOT BETWEEN 1 AND 100 OR
  EXISTS(SELECT 1 FROM diagnostic_questions WHERE instrument_version_id=version_id AND (length(trim(label))=0 OR position<1 OR position>question_count)) OR
  EXISTS(SELECT 1 FROM diagnostic_questions q WHERE q.instrument_version_id=version_id AND (
   (SELECT count(*) FROM question_options o WHERE o.question_id=q.id) NOT BETWEEN 2 AND 20 OR
   EXISTS(SELECT 1 FROM question_options o WHERE o.question_id=q.id AND (length(trim(o.label))=0 OR o.position<1 OR o.position>(SELECT count(*) FROM question_options p WHERE p.question_id=q.id)))
  )) THEN RAISE EXCEPTION 'Published instrument requires complete ordered questions and options' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER instrument_versions_publication AFTER INSERT OR UPDATE ON instrument_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_instrument_publication();
CREATE CONSTRAINT TRIGGER diagnostic_questions_publication AFTER INSERT OR UPDATE OR DELETE ON diagnostic_questions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_instrument_publication();
CREATE CONSTRAINT TRIGGER question_options_publication AFTER INSERT OR UPDATE OR DELETE ON question_options DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_instrument_publication();
