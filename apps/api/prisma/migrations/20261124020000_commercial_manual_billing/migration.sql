-- AlterEnum
ALTER TYPE "PlatformCapability" ADD VALUE 'READ_BILLING';
ALTER TYPE "PlatformCapability" ADD VALUE 'MANAGE_BILLING';

-- CreateEnum
CREATE TYPE "CommercialBillingChargeRevisionKind" AS ENUM ('CREATED', 'PAYMENT_CONFIRMED', 'CORRECTION');

-- Composite unique targets for strict tenant + contract + plan version referential integrity
CREATE UNIQUE INDEX "commercial_contracts_organization_id_id_key"
    ON "commercial_contracts"("organization_id", "id");

CREATE UNIQUE INDEX "commercial_contract_revisions_contract_id_id_plan_version_i_key"
    ON "commercial_contract_revisions"("contract_id", "id", "plan_version_id");

-- CreateTable
CREATE TABLE "commercial_billing_charges" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "contract_revision_id" UUID NOT NULL,
    "plan_version_id" UUID NOT NULL,
    "competence" VARCHAR(7) NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "due_on" DATE NOT NULL,
    "paid_on" DATE,
    "receipt_reference" VARCHAR(240),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commercial_billing_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_billing_charge_revisions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "charge_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "contract_revision_id" UUID NOT NULL,
    "plan_version_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "kind" "CommercialBillingChargeRevisionKind" NOT NULL,
    "competence" VARCHAR(7) NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "due_on" DATE NOT NULL,
    "paid_on" DATE,
    "receipt_reference" VARCHAR(240),
    "reason" VARCHAR(1000) NOT NULL,
    "idempotency_key" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commercial_billing_charge_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "commercial_billing_charges_organization_id_id_key"
    ON "commercial_billing_charges"("organization_id", "id");

CREATE UNIQUE INDEX "commercial_billing_charges_org_contract_competence_key"
    ON "commercial_billing_charges"("organization_id", "contract_id", "competence");

CREATE INDEX "commercial_billing_charges_org_competence_due_idx"
    ON "commercial_billing_charges"("organization_id", "competence", "due_on", "id");

CREATE INDEX "commercial_billing_charges_period_status_idx"
    ON "commercial_billing_charges"("competence", "paid_on", "due_on", "id");

CREATE INDEX "commercial_billing_charges_contract_revision_idx"
    ON "commercial_billing_charges"("contract_id", "contract_revision_id");

CREATE INDEX "commercial_billing_charges_plan_version_id_idx"
    ON "commercial_billing_charges"("plan_version_id");

CREATE INDEX "commercial_billing_charges_created_by_idx"
    ON "commercial_billing_charges"("created_by");

CREATE INDEX "commercial_billing_charges_updated_by_idx"
    ON "commercial_billing_charges"("updated_by");

CREATE UNIQUE INDEX "commercial_billing_charge_revisions_charge_id_ordinal_key"
    ON "commercial_billing_charge_revisions"("charge_id", "ordinal");

CREATE UNIQUE INDEX "commercial_billing_charge_revisions_org_idempotency_key"
    ON "commercial_billing_charge_revisions"("organization_id", "idempotency_key")
    WHERE "idempotency_key" IS NOT NULL;

CREATE INDEX "commercial_billing_charge_revisions_org_charge_ordinal_idx"
    ON "commercial_billing_charge_revisions"("organization_id", "charge_id", "ordinal");

CREATE INDEX "commercial_billing_charge_revisions_contract_revision_idx"
    ON "commercial_billing_charge_revisions"("contract_id", "contract_revision_id");

CREATE INDEX "commercial_billing_charge_revisions_plan_version_id_idx"
    ON "commercial_billing_charge_revisions"("plan_version_id");

CREATE INDEX "commercial_billing_charge_revisions_created_by_idx"
    ON "commercial_billing_charge_revisions"("created_by");

-- AddForeignKey
ALTER TABLE "commercial_billing_charges"
    ADD CONSTRAINT "commercial_billing_charges_org_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commercial_billing_charges"
    ADD CONSTRAINT "commercial_billing_charges_contract_fkey"
    FOREIGN KEY ("organization_id", "contract_id") REFERENCES "commercial_contracts"("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commercial_billing_charges"
    ADD CONSTRAINT "commercial_billing_charges_contract_rev_fkey"
    FOREIGN KEY ("contract_id", "contract_revision_id", "plan_version_id")
    REFERENCES "commercial_contract_revisions"("contract_id", "id", "plan_version_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commercial_billing_charges"
    ADD CONSTRAINT "commercial_billing_charges_plan_ver_fkey"
    FOREIGN KEY ("plan_version_id") REFERENCES "commercial_plan_versions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commercial_billing_charges"
    ADD CONSTRAINT "commercial_billing_charges_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commercial_billing_charges"
    ADD CONSTRAINT "commercial_billing_charges_updated_by_fkey"
    FOREIGN KEY ("updated_by") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commercial_billing_charge_revisions"
    ADD CONSTRAINT "commercial_billing_charge_revs_org_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commercial_billing_charge_revisions"
    ADD CONSTRAINT "commercial_billing_charge_revs_charge_fkey"
    FOREIGN KEY ("organization_id", "charge_id") REFERENCES "commercial_billing_charges"("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commercial_billing_charge_revisions"
    ADD CONSTRAINT "commercial_billing_charge_revs_contract_fkey"
    FOREIGN KEY ("organization_id", "contract_id") REFERENCES "commercial_contracts"("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commercial_billing_charge_revisions"
    ADD CONSTRAINT "commercial_billing_charge_revs_contract_rev_fkey"
    FOREIGN KEY ("contract_id", "contract_revision_id", "plan_version_id")
    REFERENCES "commercial_contract_revisions"("contract_id", "id", "plan_version_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commercial_billing_charge_revisions"
    ADD CONSTRAINT "commercial_billing_charge_revs_plan_ver_fkey"
    FOREIGN KEY ("plan_version_id") REFERENCES "commercial_plan_versions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commercial_billing_charge_revisions"
    ADD CONSTRAINT "commercial_billing_charge_revs_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain constraints
ALTER TABLE "commercial_billing_charges"
    ADD CONSTRAINT "commercial_billing_charges_values_check"
    CHECK (
        "version" > 0
        AND "amount_cents" > 0
        AND "competence" ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'
        AND ("receipt_reference" IS NULL OR ("paid_on" IS NOT NULL AND char_length(btrim("receipt_reference")) BETWEEN 1 AND 240))
    );

ALTER TABLE "commercial_billing_charge_revisions"
    ADD CONSTRAINT "commercial_billing_charge_revisions_values_check"
    CHECK (
        "ordinal" > 0
        AND "amount_cents" > 0
        AND "competence" ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'
        AND char_length(btrim("reason")) BETWEEN 3 AND 1000
        AND ("kind" <> 'PAYMENT_CONFIRMED' OR "paid_on" IS NOT NULL)
        AND ("receipt_reference" IS NULL OR ("paid_on" IS NOT NULL AND char_length(btrim("receipt_reference")) BETWEEN 1 AND 240))
    );

-- Protect current billing charge headers from deletion, reparenting, or unversioned overwrites
CREATE FUNCTION renr_protect_commercial_billing_charge() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.id = OLD.id
            AND NEW.organization_id = OLD.organization_id
            AND NEW.contract_id = OLD.contract_id
            AND NEW.created_by = OLD.created_by
            AND NEW.created_at = OLD.created_at
            AND NEW.version = OLD.version + 1 THEN
            RETURN NEW;
        END IF;
    END IF;
    RAISE EXCEPTION 'Commercial billing charges cannot be deleted or overwritten without incrementing version';
END;
$$;

CREATE TRIGGER commercial_billing_charges_protected
    BEFORE UPDATE OR DELETE ON "commercial_billing_charges"
    FOR EACH ROW EXECUTE FUNCTION renr_protect_commercial_billing_charge();

-- Every revision snapshot in the billing trail is strictly immutable
CREATE TRIGGER commercial_billing_charge_revisions_immutable
    BEFORE UPDATE OR DELETE ON "commercial_billing_charge_revisions"
    FOR EACH ROW EXECUTE FUNCTION renr_immutable_business_record();
