ALTER TABLE assessment_cycles
  ADD COLUMN eligible_count INTEGER,
  ADD CONSTRAINT assessment_cycles_eligible_count_check CHECK (
    eligible_count IS NULL OR (eligible_count >= 0 AND status <> 'DRAFT')
  );
