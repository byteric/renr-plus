-- Preserve applied history; validate new assignment changes against its recorded chain.
CREATE OR REPLACE FUNCTION validate_assignment_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE part JSONB; current_action actions%ROWTYPE; expected_next JSONB; expected_previous JSONB;
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
  -- Skip operational/legacy revisions: their SQL NULL carries no assignment change.
  -- Compare frozen historical names, never the user's current name.
  SELECT assignment_change->'next' INTO expected_previous FROM action_revisions
    WHERE action_id=NEW.action_id AND organization_id=NEW.organization_id
      AND version < NEW.version AND assignment_change IS NOT NULL
    ORDER BY version DESC LIMIT 1;
  expected_previous := coalesce(expected_previous, 'null'::jsonb);
  IF NEW.event NOT IN ('CREATED','UPDATED') OR NEW.version <> current_action.version OR
     NEW.author_id IS DISTINCT FROM (CASE WHEN NEW.event='CREATED' THEN current_action.created_by_id ELSE current_action.updated_by_id END) OR
     NEW.assignment_change->'previous' IS DISTINCT FROM expected_previous OR
     NEW.assignment_change->'next' IS DISTINCT FROM expected_next OR
     NEW.assignment_change->'previous' = NEW.assignment_change->'next' OR
     (NEW.event='CREATED' AND NEW.assignment_change->'previous' <> 'null'::jsonb) OR
     length(btrim(coalesce(NEW.change_reason,''))) = 0 THEN
    RAISE EXCEPTION 'Assignment revision must describe the recorded previous assignment, current assignment and author with a reason' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
