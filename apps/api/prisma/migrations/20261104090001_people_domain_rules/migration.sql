-- Additive legacy reconciliation. Original fiscal_identifier and tenant ownership stay intact.
-- Receita Federal/Serpro algorithm, including the alphanumeric CNPJ.
CREATE FUNCTION renr_cnpj_normalize(input text) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT upper(regexp_replace(input, '[[:space:]./-]', '', 'g'));
$$;
CREATE FUNCTION renr_cnpj_valid(input text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE candidate text := renr_cnpj_normalize(input); base text; total integer; weight integer; digit integer; i integer; pass integer;
BEGIN
  IF candidate !~ '^[A-Z0-9]{12}[0-9]{2}$' OR candidate ~ '^([0-9])\1{13}$' THEN RETURN false; END IF;
  base := substr(candidate,1,12);
  FOR pass IN 1..2 LOOP
    total := 0; weight := 2;
    FOR i IN REVERSE length(base)..1 LOOP
      total := total + (ascii(substr(base,i,1))-48)*weight;
      weight := CASE WHEN weight=9 THEN 2 ELSE weight+1 END;
    END LOOP;
    digit := CASE WHEN total%11<2 THEN 0 ELSE 11-total%11 END;
    IF substr(candidate,12+pass,1) <> digit::text THEN RETURN false; END IF;
    base := base || digit::text;
  END LOOP;
  RETURN true;
END;
$$;
WITH candidates AS (
 SELECT id,renr_cnpj_normalize(fiscal_identifier) AS candidate,
   COALESCE(renr_cnpj_valid(fiscal_identifier),false) AS valid
 FROM organizations
), reconciled AS (
 SELECT *, count(*) FILTER(WHERE valid) OVER(PARTITION BY candidate) AS duplicates
 FROM candidates
)
UPDATE organizations o SET
 fiscal_candidate=CASE WHEN r.candidate ~ '^[A-Z0-9]{14}$' THEN r.candidate ELSE NULL END,
 fiscal_state=CASE WHEN r.candidate IS NULL OR r.candidate='' THEN 'MISSING'
   WHEN NOT r.valid THEN 'INVALID' WHEN r.duplicates>1 THEN 'CONFLICT' ELSE 'VALID' END,
 normalized_fiscal_identifier=CASE WHEN r.valid AND r.duplicates=1 THEN r.candidate ELSE NULL END
FROM reconciled r WHERE o.id=r.id;

ALTER TABLE organizations ADD CONSTRAINT organization_fiscal_contract CHECK (
 fiscal_state IN ('MISSING','INVALID','VALID','CONFLICT') AND
 client_classification IN ('UNCLASSIFIED','CLIENT','DEMONSTRATION') AND registration_version>0 AND
 (fiscal_state<>'VALID' OR (
    normalized_fiscal_identifier IS NOT NULL AND fiscal_candidate=normalized_fiscal_identifier AND
    normalized_fiscal_identifier=renr_cnpj_normalize(fiscal_identifier) AND renr_cnpj_valid(fiscal_identifier)
 )) AND (fiscal_state='VALID' OR normalized_fiscal_identifier IS NULL)
);
ALTER TABLE employee_hr_profiles ADD CONSTRAINT hr_profile_values CHECK (
 version>0 AND (birth_date IS NULL OR birth_date BETWEEN DATE '1900-01-01' AND DATE '2199-12-31') AND
 (gender IS NULL OR gender IN ('FEMALE','MALE','NON_BINARY','SELF_DESCRIBED','PREFER_NOT_TO_SAY')) AND
 (CASE WHEN gender='SELF_DESCRIBED' THEN length(trim(gender_description))>0 ELSE gender_description IS NULL END)
);
ALTER TABLE employment_periods ADD CONSTRAINT employment_period_dates CHECK (
 version>0 AND (ends_on IS NULL OR ends_on>=starts_on)
);
ALTER TABLE employee_remunerations ADD CONSTRAINT remuneration_values CHECK (
 version>0 AND salary_cents BETWEEN 0 AND 999999999999999 AND competence ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' AND remuneration_type IN ('FIXED','VARIABLE')
);
ALTER TABLE employee_vacation_periods ADD CONSTRAINT vacation_period_values CHECK (
 version>0 AND acquisition_start<=acquisition_end AND acquisition_end<concession_deadline AND
 entitlement_days BETWEEN 0 AND 30 AND balance_days BETWEEN 0 AND entitlement_days AND
 unjustified_absences BETWEEN 0 AND 366 AND jsonb_typeof(uses)='array' AND jsonb_array_length(uses)<=3
);
ALTER TABLE report_snapshots ADD CONSTRAINT report_scope CHECK (
 kind IN ('SST','PEOPLE','PLATFORM') AND ((kind='PLATFORM' AND organization_id IS NULL AND NOT financial) OR (kind<>'PLATFORM' AND organization_id IS NOT NULL)) AND (kind='PEOPLE' OR NOT financial)
);
CREATE FUNCTION renr_hr_periods_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM employees WHERE organization_id=NEW.organization_id AND id=NEW.employee_id FOR UPDATE;
  IF TG_TABLE_NAME='employment_periods' THEN
    IF EXISTS(SELECT 1 FROM employment_periods p WHERE p.organization_id=NEW.organization_id AND p.employee_id=NEW.employee_id
      AND p.id<>NEW.id AND p.starts_on<=COALESCE(NEW.ends_on,DATE '9999-12-31') AND COALESCE(p.ends_on,DATE '9999-12-31')>=NEW.starts_on)
    THEN RAISE EXCEPTION 'Overlapping employment period' USING ERRCODE='23514'; END IF;
  ELSE
    IF EXISTS(SELECT 1 FROM employee_vacation_periods p WHERE p.organization_id=NEW.organization_id AND p.employee_id=NEW.employee_id
      AND p.id<>NEW.id AND p.acquisition_start<=NEW.acquisition_end AND p.acquisition_end>=NEW.acquisition_start)
    THEN RAISE EXCEPTION 'Overlapping vacation period' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER employment_no_overlap BEFORE INSERT OR UPDATE ON employment_periods FOR EACH ROW EXECUTE FUNCTION renr_hr_periods_overlap();
CREATE TRIGGER vacation_no_overlap BEFORE INSERT OR UPDATE ON employee_vacation_periods FOR EACH ROW EXECUTE FUNCTION renr_hr_periods_overlap();
CREATE FUNCTION renr_immutable_business_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable business record' USING ERRCODE='23514'; END;
$$;
CREATE TRIGGER hr_revision_immutable BEFORE UPDATE OR DELETE ON employee_hr_revisions FOR EACH ROW EXECUTE FUNCTION renr_immutable_business_record();
CREATE TRIGGER registration_revision_immutable BEFORE UPDATE OR DELETE ON organization_registration_revisions FOR EACH ROW EXECUTE FUNCTION renr_immutable_business_record();
CREATE TRIGGER platform_audit_immutable BEFORE UPDATE OR DELETE ON platform_audit_events FOR EACH ROW EXECUTE FUNCTION renr_immutable_business_record();
CREATE TRIGGER report_snapshot_immutable BEFORE UPDATE OR DELETE ON report_snapshots FOR EACH ROW EXECUTE FUNCTION renr_immutable_business_record();
