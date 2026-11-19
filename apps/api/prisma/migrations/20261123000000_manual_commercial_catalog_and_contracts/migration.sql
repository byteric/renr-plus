-- CreateEnum
CREATE TYPE "CommercialPlanKind" AS ENUM ('PLAN', 'SERVICE');

-- CreateEnum
CREATE TYPE "CommercialPricingUnit" AS ENUM ('EMPLOYEE_MONTH', 'TRAINING_CLASS', 'SERVICE');

-- CreateEnum
CREATE TYPE "CommercialPriceMode" AS ENUM ('FIXED', 'STARTING_AT');

-- CreateEnum
CREATE TYPE "CommercialContractRevisionKind" AS ENUM ('INITIAL', 'RENEWAL', 'AMENDMENT', 'CANCELLATION');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PlatformCapability" ADD VALUE 'READ_COMMERCIAL';
ALTER TYPE "PlatformCapability" ADD VALUE 'MANAGE_COMMERCIAL';

-- CreateTable
CREATE TABLE "commercial_plans" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "kind" "CommercialPlanKind" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "commercial_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_plan_versions" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "effective_on" DATE NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "pricing_unit" "CommercialPricingUnit" NOT NULL,
    "price_mode" "CommercialPriceMode" NOT NULL,
    "conditions" VARCHAR(4000) NOT NULL,
    "limits" VARCHAR(4000) NOT NULL,
    "included_features" TEXT[],
    "planned_features" TEXT[],
    "reason" VARCHAR(1000) NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commercial_plan_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_client_profiles" (
    "organization_id" UUID NOT NULL,
    "contact_name" VARCHAR(160),
    "contact_email" VARCHAR(254),
    "adopted_on" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "commercial_client_profiles_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "commercial_contracts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "commercial_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_contract_revisions" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "plan_version_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "kind" "CommercialContractRevisionKind" NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "terms" VARCHAR(8000) NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commercial_contract_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_contract_documents" (
    "id" UUID NOT NULL,
    "revision_id" UUID NOT NULL,
    "file_name" VARCHAR(200) NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "storage_key" VARCHAR(300) NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commercial_contract_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "commercial_plans_kind_name_id_idx" ON "commercial_plans"("kind", "name", "id");

-- CreateIndex
CREATE UNIQUE INDEX "commercial_plan_versions_plan_id_ordinal_key" ON "commercial_plan_versions"("plan_id", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "commercial_plan_versions_plan_id_effective_on_key" ON "commercial_plan_versions"("plan_id", "effective_on");

-- CreateIndex
CREATE UNIQUE INDEX "commercial_contracts_organization_id_key" ON "commercial_contracts"("organization_id");

-- CreateIndex
CREATE INDEX "commercial_contract_revisions_plan_version_id_idx" ON "commercial_contract_revisions"("plan_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "commercial_contract_revisions_contract_id_ordinal_key" ON "commercial_contract_revisions"("contract_id", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "commercial_contract_revisions_contract_id_starts_on_key" ON "commercial_contract_revisions"("contract_id", "starts_on");

-- CreateIndex
CREATE UNIQUE INDEX "commercial_contract_documents_revision_id_key" ON "commercial_contract_documents"("revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "commercial_contract_documents_storage_key_key" ON "commercial_contract_documents"("storage_key");

-- AddForeignKey
ALTER TABLE "commercial_plan_versions" ADD CONSTRAINT "commercial_plan_versions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "commercial_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_plan_versions" ADD CONSTRAINT "commercial_plan_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_client_profiles" ADD CONSTRAINT "commercial_client_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_contracts" ADD CONSTRAINT "commercial_contracts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_contract_revisions" ADD CONSTRAINT "commercial_contract_revisions_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "commercial_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_contract_revisions" ADD CONSTRAINT "commercial_contract_revisions_plan_version_id_fkey" FOREIGN KEY ("plan_version_id") REFERENCES "commercial_plan_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_contract_revisions" ADD CONSTRAINT "commercial_contract_revisions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_contract_documents" ADD CONSTRAINT "commercial_contract_documents_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "commercial_contract_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_contract_documents" ADD CONSTRAINT "commercial_contract_documents_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Lower bounds and child metadata complement API validation.
ALTER TABLE "commercial_plans"
    ADD CONSTRAINT "commercial_plans_positive_version" CHECK ("version" > 0);
ALTER TABLE "commercial_plan_versions"
    ADD CONSTRAINT "commercial_plan_versions_values"
    CHECK ("ordinal" > 0 AND "price_cents" >= 0 AND "included_features" IS NOT NULL AND "planned_features" IS NOT NULL);
ALTER TABLE "commercial_client_profiles"
    ADD CONSTRAINT "commercial_client_profiles_positive_version" CHECK ("version" > 0);
ALTER TABLE "commercial_contracts"
    ADD CONSTRAINT "commercial_contracts_positive_version" CHECK ("version" > 0);
ALTER TABLE "commercial_contract_revisions"
    ADD CONSTRAINT "commercial_contract_revisions_valid_term"
    CHECK ("ordinal" > 0 AND "starts_on" <= "ends_on"
           AND ("kind" <> 'CANCELLATION' OR "starts_on" = "ends_on"));
ALTER TABLE "commercial_contract_documents"
    ADD CONSTRAINT "commercial_contract_documents_valid_pdf"
    CHECK ("size" BETWEEN 1 AND 5242880 AND "sha256" ~ '^[a-f0-9]{64}$');

-- A new version records a change. Existing versions and signed document metadata remain immutable.
CREATE TRIGGER commercial_plan_versions_immutable
    BEFORE UPDATE OR DELETE ON "commercial_plan_versions"
    FOR EACH ROW EXECUTE FUNCTION renr_immutable_business_record();
CREATE TRIGGER commercial_contract_revisions_immutable
    BEFORE UPDATE OR DELETE ON "commercial_contract_revisions"
    FOR EACH ROW EXECUTE FUNCTION renr_immutable_business_record();
CREATE TRIGGER commercial_contract_documents_immutable
    BEFORE UPDATE OR DELETE ON "commercial_contract_documents"
    FOR EACH ROW EXECUTE FUNCTION renr_immutable_business_record();
