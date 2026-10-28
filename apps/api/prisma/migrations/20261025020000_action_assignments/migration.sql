-- Additive, SQL NULL for legacy actions/revisions; no historical inference.
ALTER TABLE actions ADD COLUMN assigned_user_id UUID, ADD COLUMN assigned_name VARCHAR(120);
ALTER TABLE action_revisions ADD COLUMN assignment_change JSONB;
ALTER TABLE actions ADD CONSTRAINT actions_assigned_membership_fkey
  FOREIGN KEY (assigned_user_id, organization_id) REFERENCES memberships(user_id, organization_id)
  ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE actions ADD CONSTRAINT actions_assignment_pair_check CHECK (
  (assigned_user_id IS NULL AND assigned_name IS NULL) OR
  (assigned_user_id IS NOT NULL AND assigned_name IS NOT NULL AND length(btrim(assigned_name)) > 0)
);
CREATE INDEX actions_org_assignee_status_due_id_idx ON actions(organization_id,assigned_user_id,status,due_date,id);

CREATE FUNCTION guard_action_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor UUID; organization_active BOOLEAN; assignee_active BOOLEAN; assignee_name TEXT; actor_active BOOLEAN; actor_role "Role";
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.assigned_user_id,NEW.assigned_name) IS NOT DISTINCT FROM ROW(OLD.assigned_user_id,OLD.assigned_name) THEN
      RETURN NEW;
    END IF;
    IF OLD.status IN ('IMPLEMENTED','CANCELLED') THEN
      RAISE EXCEPTION 'Terminal actions cannot be reassigned' USING ERRCODE='23514';
    END IF;
    IF NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'Assignment changes require the next action version' USING ERRCODE='23514';
    END IF;
    actor := NEW.updated_by_id;
  ELSE
    IF NEW.assigned_user_id IS NULL AND NEW.assigned_name IS NULL THEN RETURN NEW; END IF;
    actor := NEW.created_by_id;
  END IF;
  -- API takes these locks before locking the action; repeat validation for raw SQL.
  SELECT is_active INTO organization_active FROM organizations WHERE id=NEW.organization_id FOR SHARE;
  PERFORM user_id FROM memberships WHERE organization_id=NEW.organization_id
    AND user_id IN (actor,NEW.assigned_user_id) ORDER BY user_id FOR SHARE;
  SELECT is_active,role INTO actor_active,actor_role FROM memberships
    WHERE user_id=actor AND organization_id=NEW.organization_id;
  IF organization_active IS DISTINCT FROM TRUE OR actor_active IS DISTINCT FROM TRUE OR actor_role IS DISTINCT FROM 'ADMIN'::"Role" THEN
    RAISE EXCEPTION 'Assignment management requires an active organization and administrator' USING ERRCODE='23514';
  END IF;
  IF NEW.assigned_user_id IS NOT NULL THEN
    SELECT is_active INTO assignee_active FROM memberships
      WHERE user_id=NEW.assigned_user_id AND organization_id=NEW.organization_id;
    IF assignee_active IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'Assignee must be an active member of the organization' USING ERRCODE='23514';
    END IF;
    SELECT name INTO assignee_name FROM users WHERE id=NEW.assigned_user_id FOR SHARE;
    IF NEW.assigned_name IS DISTINCT FROM assignee_name THEN
      RAISE EXCEPTION 'Assignment name must capture the current user name' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER actions_assignment_guard BEFORE INSERT OR UPDATE ON actions
  FOR EACH ROW EXECUTE FUNCTION guard_action_assignment();

CREATE FUNCTION validate_assignment_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE part JSONB; current_action actions%ROWTYPE; expected_next JSONB;
BEGIN
  IF NEW.assignment_change IS NULL THEN RETURN NEW; END IF;
  IF jsonb_typeof(NEW.assignment_change) IS DISTINCT FROM 'object' OR
     NOT (NEW.assignment_change ?& ARRAY['previous','next']) OR
     (NEW.assignment_change - 'previous' - 'next') <> '{}'::jsonb THEN
    RAISE EXCEPTION 'Invalid assignment change object' USING ERRCODE='23514';
  END IF;
  FOR part IN SELECT value FROM jsonb_each(NEW.assignment_change) LOOP
    IF part = 'null'::jsonb THEN CONTINUE; END IF;
    IF jsonb_typeof(part) IS DISTINCT FROM 'object' OR NOT (part ?& ARRAY['userId','name']) OR
       (part - 'userId' - 'name') <> '{}'::jsonb OR
       jsonb_typeof(part->'userId') IS DISTINCT FROM 'string' OR
       (part->>'userId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' OR
       jsonb_typeof(part->'name') IS DISTINCT FROM 'string' OR
       length(btrim(part->>'name')) NOT BETWEEN 1 AND 120 THEN
      RAISE EXCEPTION 'Invalid assignment change member' USING ERRCODE='23514';
    END IF;
  END LOOP;
  SELECT * INTO current_action FROM actions WHERE id=NEW.action_id AND organization_id=NEW.organization_id;
  expected_next := CASE WHEN current_action.assigned_user_id IS NULL THEN 'null'::jsonb ELSE
    jsonb_build_object('userId',current_action.assigned_user_id,'name',current_action.assigned_name) END;
  IF NEW.event NOT IN ('CREATED','UPDATED') OR NEW.version <> current_action.version OR
     NEW.author_id IS DISTINCT FROM (CASE WHEN NEW.event='CREATED' THEN current_action.created_by_id ELSE current_action.updated_by_id END) OR
     NEW.assignment_change->'next' IS DISTINCT FROM expected_next OR
     NEW.assignment_change->'previous' = NEW.assignment_change->'next' OR
     (NEW.event='CREATED' AND NEW.assignment_change->'previous' <> 'null'::jsonb) OR
     length(btrim(coalesce(NEW.change_reason,''))) = 0 THEN
    RAISE EXCEPTION 'Assignment revision must describe the current assignment and author with a reason' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER action_revisions_assignment_guard BEFORE INSERT ON action_revisions
  FOR EACH ROW EXECUTE FUNCTION validate_assignment_revision();

CREATE FUNCTION require_assignment_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous_assignment JSONB; next_assignment JSONB; actor UUID; revision_event TEXT;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW.assigned_user_id,NEW.assigned_name) IS NOT DISTINCT FROM ROW(OLD.assigned_user_id,OLD.assigned_name) THEN RETURN NULL; END IF;
    previous_assignment := CASE WHEN OLD.assigned_user_id IS NULL THEN 'null'::jsonb ELSE
      jsonb_build_object('userId',OLD.assigned_user_id,'name',OLD.assigned_name) END;
    actor := NEW.updated_by_id;
    revision_event := 'UPDATED';
  ELSE
    IF NEW.assigned_user_id IS NULL THEN RETURN NULL; END IF;
    previous_assignment := 'null'::jsonb;
    actor := NEW.created_by_id;
    revision_event := 'CREATED';
  END IF;
  next_assignment := CASE WHEN NEW.assigned_user_id IS NULL THEN 'null'::jsonb ELSE
    jsonb_build_object('userId',NEW.assigned_user_id,'name',NEW.assigned_name) END;
  IF NOT EXISTS (
    SELECT 1 FROM action_revisions WHERE action_id=NEW.id AND organization_id=NEW.organization_id
      AND version=NEW.version AND event=revision_event AND author_id=actor
      AND length(btrim(coalesce(change_reason,''))) > 0
      AND assignment_change=jsonb_build_object('previous',previous_assignment,'next',next_assignment)
      -- An uncommitted visible row belongs to this transaction (including savepoints).
      AND pg_xact_status(xmin::text::xid8)='in progress'
  ) THEN
    RAISE EXCEPTION 'Assignment change requires its matching atomic revision' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER actions_assignment_revision_required AFTER INSERT OR UPDATE ON actions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_assignment_revision();
