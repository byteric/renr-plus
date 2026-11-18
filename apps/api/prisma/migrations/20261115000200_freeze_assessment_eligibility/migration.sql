CREATE FUNCTION preserve_assessment_eligibility() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.eligible_count IS DISTINCT FROM OLD.eligible_count
    AND NOT (OLD.status = 'DRAFT' AND NEW.status = 'OPEN') THEN
    RAISE EXCEPTION 'Assessment eligibility is immutable after opening' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER assessment_eligibility_snapshot
  BEFORE UPDATE OF eligible_count ON assessment_cycles
  FOR EACH ROW EXECUTE FUNCTION preserve_assessment_eligibility();
