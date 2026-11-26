CREATE TABLE "employee_bulk_updates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "file_digest" CHAR(64) NOT NULL,
    "proposal_digest" CHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "updated_count" INTEGER,
    "unchanged_count" INTEGER,
    CONSTRAINT "employee_bulk_updates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "employee_bulk_updates_organization_id_fkey" FOREIGN KEY ("organization_id")
        REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "employee_bulk_updates_actor_id_fkey" FOREIGN KEY ("actor_id")
        REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "employee_bulk_updates_valid_digests"
        CHECK ("file_digest" ~ '^[a-f0-9]{64}$' AND "proposal_digest" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "employee_bulk_updates_valid_receipt"
        CHECK (
            ("confirmed_at" IS NULL AND "updated_count" IS NULL AND "unchanged_count" IS NULL)
            OR
            ("confirmed_at" IS NOT NULL AND "updated_count" IS NOT NULL AND "unchanged_count" IS NOT NULL
                AND "updated_count" BETWEEN 1 AND 500 AND "unchanged_count" >= 0
                AND "updated_count" + "unchanged_count" <= 500)
        )
);

CREATE UNIQUE INDEX "employee_bulk_updates_organization_id_id_key"
    ON "employee_bulk_updates"("organization_id", "id");
CREATE INDEX "employee_bulk_updates_expiry_idx"
    ON "employee_bulk_updates"("organization_id", "actor_id", "confirmed_at", "expires_at");
CREATE INDEX "employee_bulk_updates_actor_id_idx" ON "employee_bulk_updates"("actor_id");

CREATE TABLE "employee_registration_revisions" (
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    CONSTRAINT "employee_registration_revisions_pkey" PRIMARY KEY ("organization_id", "employee_id", "version"),
    CONSTRAINT "employee_registration_revisions_organization_id_employee_id_fkey"
        FOREIGN KEY ("organization_id", "employee_id")
        REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "employee_registration_revisions_organization_id_batch_id_fkey"
        FOREIGN KEY ("organization_id", "batch_id")
        REFERENCES "employee_bulk_updates"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "employee_registration_revisions_valid_versions" CHECK (
        "version" >= 2 AND jsonb_typeof("before") = 'object' AND jsonb_typeof("after") = 'object'
    )
);

CREATE UNIQUE INDEX "employee_registration_revisions_organization_id_batch_id_em_key"
    ON "employee_registration_revisions"("organization_id", "batch_id", "employee_id");

CREATE TRIGGER employee_registration_revisions_immutable
    BEFORE UPDATE OR DELETE ON "employee_registration_revisions"
    FOR EACH ROW EXECUTE FUNCTION renr_immutable_business_record();

CREATE FUNCTION renr_protect_employee_bulk_receipt() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' AND OLD.confirmed_at IS NULL THEN
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.confirmed_at IS NULL AND NEW.confirmed_at IS NOT NULL
        AND (to_jsonb(OLD) - ARRAY['confirmed_at', 'updated_count', 'unchanged_count'])
            = (to_jsonb(NEW) - ARRAY['confirmed_at', 'updated_count', 'unchanged_count']) THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Employee bulk receipts are immutable after confirmation';
END;
$$;

CREATE TRIGGER employee_bulk_receipt_immutable
    BEFORE UPDATE OR DELETE ON "employee_bulk_updates"
    FOR EACH ROW EXECUTE FUNCTION renr_protect_employee_bulk_receipt();
