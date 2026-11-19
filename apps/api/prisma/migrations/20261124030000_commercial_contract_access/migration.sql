-- AlterEnum
ALTER TYPE "PlatformCapability" ADD VALUE 'READ_CONTRACT_ACCESS';
ALTER TYPE "PlatformCapability" ADD VALUE 'MANAGE_CONTRACT_ACCESS';

-- CreateEnum
CREATE TYPE "CommercialContractAccessStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "CommercialContractAccessFromStatus" AS ENUM ('UNRECORDED', 'ACTIVE', 'SUSPENDED');
CREATE TYPE "CommercialContractAccessTransitionKind" AS ENUM ('ACTIVATION', 'SUSPENSION', 'REACTIVATION');
CREATE TYPE "CommercialContractAccessOrigin" AS ENUM ('MANUAL_OPERATION');
CREATE TYPE "CommercialContractAccessRule" AS ENUM (
    'MANUAL_CONTRACT_ACTIVATION',
    'MANUAL_CONTRACT_SUSPENSION',
    'MANUAL_CONTRACT_REACTIVATION'
);

-- CreateTable
CREATE TABLE "commercial_contract_accesses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "status" "CommercialContractAccessStatus" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "last_transition_kind" "CommercialContractAccessTransitionKind" NOT NULL,
    "last_rule" "CommercialContractAccessRule" NOT NULL,
    "last_origin" "CommercialContractAccessOrigin" NOT NULL DEFAULT 'MANUAL_OPERATION',
    "last_effective_on" DATE NOT NULL,
    "last_reason" VARCHAR(1000) NOT NULL,
    "last_next_step" VARCHAR(500) NOT NULL,
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commercial_contract_accesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_contract_access_transitions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "access_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "kind" "CommercialContractAccessTransitionKind" NOT NULL,
    "from_status" "CommercialContractAccessFromStatus" NOT NULL,
    "to_status" "CommercialContractAccessStatus" NOT NULL,
    "rule" "CommercialContractAccessRule" NOT NULL,
    "origin" "CommercialContractAccessOrigin" NOT NULL DEFAULT 'MANUAL_OPERATION',
    "effective_on" DATE NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "next_step" VARCHAR(500) NOT NULL,
    "idempotency_key" UUID,
    "actor_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commercial_contract_access_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "commercial_contract_accesses_organization_id_key"
    ON "commercial_contract_accesses"("organization_id");

CREATE UNIQUE INDEX "commercial_contract_accesses_contract_id_key"
    ON "commercial_contract_accesses"("contract_id");

CREATE UNIQUE INDEX "commercial_contract_accesses_organization_id_id_key"
    ON "commercial_contract_accesses"("organization_id", "id");

CREATE UNIQUE INDEX "commercial_contract_accesses_organization_id_contract_id_key"
    ON "commercial_contract_accesses"("organization_id", "contract_id");

CREATE INDEX "commercial_contract_accesses_status_updated_idx"
    ON "commercial_contract_accesses"("status", "updated_at", "id");

CREATE INDEX "commercial_contract_accesses_updated_by_idx"
    ON "commercial_contract_accesses"("updated_by");

CREATE UNIQUE INDEX "commercial_contract_access_transitions_access_id_ordinal_key"
    ON "commercial_contract_access_transitions"("access_id", "ordinal");

CREATE UNIQUE INDEX "commercial_contract_access_transitions_org_idempotency_key"
    ON "commercial_contract_access_transitions"("organization_id", "idempotency_key")
    WHERE "idempotency_key" IS NOT NULL;

CREATE INDEX "commercial_contract_access_trans_org_access_ordinal_idx"
    ON "commercial_contract_access_transitions"("organization_id", "access_id", "ordinal");

CREATE INDEX "commercial_contract_access_transitions_contract_id_idx"
    ON "commercial_contract_access_transitions"("contract_id");

CREATE INDEX "commercial_contract_access_transitions_actor_id_idx"
    ON "commercial_contract_access_transitions"("actor_id");

-- AddForeignKey
ALTER TABLE "commercial_contract_accesses"
    ADD CONSTRAINT "commercial_contract_accesses_org_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commercial_contract_accesses"
    ADD CONSTRAINT "commercial_contract_accesses_contract_fkey"
    FOREIGN KEY ("organization_id", "contract_id") REFERENCES "commercial_contracts"("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commercial_contract_accesses"
    ADD CONSTRAINT "commercial_contract_accesses_updated_by_fkey"
    FOREIGN KEY ("updated_by") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commercial_contract_access_transitions"
    ADD CONSTRAINT "commercial_contract_access_trans_org_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commercial_contract_access_transitions"
    ADD CONSTRAINT "commercial_contract_access_trans_contract_fkey"
    FOREIGN KEY ("organization_id", "contract_id") REFERENCES "commercial_contracts"("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commercial_contract_access_transitions"
    ADD CONSTRAINT "commercial_contract_access_trans_access_fkey"
    FOREIGN KEY ("organization_id", "access_id") REFERENCES "commercial_contract_accesses"("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commercial_contract_access_transitions"
    ADD CONSTRAINT "commercial_contract_access_trans_actor_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain constraints
ALTER TABLE "commercial_contract_accesses"
    ADD CONSTRAINT "commercial_contract_accesses_values_check"
    CHECK (
        "version" > 0
        AND char_length(btrim("last_reason")) BETWEEN 3 AND 1000
        AND char_length(btrim("last_next_step")) BETWEEN 3 AND 500
        AND (
            ("last_transition_kind" = 'ACTIVATION' AND "status" = 'ACTIVE' AND "last_rule" = 'MANUAL_CONTRACT_ACTIVATION')
            OR ("last_transition_kind" = 'SUSPENSION' AND "status" = 'SUSPENDED' AND "last_rule" = 'MANUAL_CONTRACT_SUSPENSION')
            OR ("last_transition_kind" = 'REACTIVATION' AND "status" = 'ACTIVE' AND "last_rule" = 'MANUAL_CONTRACT_REACTIVATION')
        )
    );

ALTER TABLE "commercial_contract_access_transitions"
    ADD CONSTRAINT "commercial_contract_access_transitions_values_check"
    CHECK (
        "ordinal" > 0
        AND char_length(btrim("reason")) BETWEEN 3 AND 1000
        AND char_length(btrim("next_step")) BETWEEN 3 AND 500
        AND (
            ("kind" = 'ACTIVATION' AND "from_status" = 'UNRECORDED' AND "to_status" = 'ACTIVE' AND "rule" = 'MANUAL_CONTRACT_ACTIVATION')
            OR ("kind" = 'SUSPENSION' AND "from_status" IN ('UNRECORDED', 'ACTIVE') AND "to_status" = 'SUSPENDED' AND "rule" = 'MANUAL_CONTRACT_SUSPENSION')
            OR ("kind" = 'REACTIVATION' AND "from_status" = 'SUSPENDED' AND "to_status" = 'ACTIVE' AND "rule" = 'MANUAL_CONTRACT_REACTIVATION')
        )
    );

-- Protect current contractual access state from deletion, reparenting, or unversioned overwrites
CREATE FUNCTION renr_protect_commercial_contract_access() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.id = OLD.id
            AND NEW.organization_id = OLD.organization_id
            AND NEW.contract_id = OLD.contract_id
            AND NEW.created_at = OLD.created_at
            AND NEW.version = OLD.version + 1 THEN
            RETURN NEW;
        END IF;
    END IF;
    RAISE EXCEPTION 'Commercial contract access records cannot be deleted or overwritten without incrementing version';
END;
$$;

CREATE TRIGGER commercial_contract_accesses_protected
    BEFORE UPDATE OR DELETE ON "commercial_contract_accesses"
    FOR EACH ROW EXECUTE FUNCTION renr_protect_commercial_contract_access();

-- Every recorded contractual access transition is strictly immutable
CREATE TRIGGER commercial_contract_access_transitions_immutable
    BEFORE UPDATE OR DELETE ON "commercial_contract_access_transitions"
    FOR EACH ROW EXECUTE FUNCTION renr_immutable_business_record();
