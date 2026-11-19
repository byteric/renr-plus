DROP INDEX "commercial_contract_revisions_contract_id_starts_on_key";

CREATE TABLE "commercial_contract_withdrawals" (
    "revision_id" UUID NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "commercial_contract_withdrawals_pkey" PRIMARY KEY ("revision_id"),
    CONSTRAINT "commercial_contract_withdrawals_revision_id_fkey"
        FOREIGN KEY ("revision_id") REFERENCES "commercial_contract_revisions"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TRIGGER commercial_contract_withdrawals_immutable
    BEFORE UPDATE OR DELETE ON "commercial_contract_withdrawals"
    FOR EACH ROW EXECUTE FUNCTION renr_immutable_business_record();

DROP TRIGGER commercial_contract_documents_immutable ON "commercial_contract_documents";
ALTER TABLE "commercial_contract_documents" ADD COLUMN "stored_at" TIMESTAMP(3);
UPDATE "commercial_contract_documents" SET "stored_at" = "created_at";

CREATE FUNCTION renr_protect_commercial_contract_document() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.stored_at IS NULL AND NEW.stored_at IS NOT NULL
            AND NEW.stored_at >= OLD.created_at
            AND (to_jsonb(NEW) - 'stored_at') = (to_jsonb(OLD) - 'stored_at') THEN
            RETURN NEW;
        END IF;
    END IF;
    RAISE EXCEPTION 'Commercial contract documents are immutable after confirmation';
END;
$$;

CREATE TRIGGER commercial_contract_documents_immutable
    BEFORE UPDATE OR DELETE ON "commercial_contract_documents"
    FOR EACH ROW EXECUTE FUNCTION renr_protect_commercial_contract_document();
