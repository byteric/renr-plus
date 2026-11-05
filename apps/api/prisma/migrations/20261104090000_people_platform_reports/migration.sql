-- CreateEnum
CREATE TYPE "PlatformCapability" AS ENUM ('READ_OVERVIEW', 'MANAGE_CLIENTS', 'MANAGE_GRANTS');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Capability" ADD VALUE 'HR_PROFILE_READ';
ALTER TYPE "Capability" ADD VALUE 'HR_PROFILE_MANAGE';
ALTER TYPE "Capability" ADD VALUE 'HR_ANALYTICS_READ';
ALTER TYPE "Capability" ADD VALUE 'HR_COMPENSATION_READ';
ALTER TYPE "Capability" ADD VALUE 'HR_COMPENSATION_MANAGE';
ALTER TYPE "Capability" ADD VALUE 'HR_EXPORT';

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "client_classification" VARCHAR(20) NOT NULL DEFAULT 'UNCLASSIFIED',
ADD COLUMN     "fiscal_candidate" VARCHAR(14),
ADD COLUMN     "fiscal_state" VARCHAR(16) NOT NULL DEFAULT 'MISSING',
ADD COLUMN     "normalized_fiscal_identifier" VARCHAR(14),
ADD COLUMN     "registration_version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "employee_hr_profiles" (
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "birth_date" DATE,
    "gender" VARCHAR(30),
    "gender_description" VARCHAR(120),
    "vacation_history_known" BOOLEAN NOT NULL DEFAULT false,
    "complex_leave_history_known" BOOLEAN NOT NULL DEFAULT false,
    "has_complex_leaves" BOOLEAN NOT NULL DEFAULT false,
    "follow_up" BOOLEAN NOT NULL DEFAULT false,
    "source" VARCHAR(500) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_hr_profiles_pkey" PRIMARY KEY ("organization_id","employee_id")
);

-- CreateTable
CREATE TABLE "employee_settlement_parameters" (
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "reference_date" DATE NOT NULL,
    "input" JSONB NOT NULL,
    "source" VARCHAR(500) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_settlement_parameters_pkey" PRIMARY KEY ("organization_id","employee_id","reference_date")
);

-- CreateTable
CREATE TABLE "employment_periods" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,
    "source" VARCHAR(500) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employment_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_remunerations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "competence" VARCHAR(7) NOT NULL,
    "salary_cents" BIGINT NOT NULL,
    "remuneration_type" VARCHAR(16) NOT NULL DEFAULT 'FIXED',
    "source" VARCHAR(500) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_remunerations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_vacation_periods" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "acquisition_start" DATE NOT NULL,
    "acquisition_end" DATE NOT NULL,
    "concession_deadline" DATE NOT NULL,
    "entitlement_days" INTEGER NOT NULL,
    "balance_days" INTEGER NOT NULL,
    "unjustified_absences" INTEGER NOT NULL DEFAULT 0,
    "history_known" BOOLEAN NOT NULL,
    "uses" JSONB NOT NULL DEFAULT '[]',
    "source" VARCHAR(500) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_vacation_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_hr_revisions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "resource_type" VARCHAR(40) NOT NULL,
    "resource_id" UUID NOT NULL,
    "financial" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "actor_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_hr_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_grants" (
    "user_id" UUID NOT NULL,
    "capability" "PlatformCapability" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_grants_pkey" PRIMARY KEY ("user_id","capability")
);

-- CreateTable
CREATE TABLE "platform_audit_events" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "subject_id" UUID,
    "action" VARCHAR(80) NOT NULL,
    "resource_id" UUID,
    "reason" VARCHAR(1000) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_registration_revisions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "actor_id" UUID NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_registration_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_snapshots" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "kind" VARCHAR(16) NOT NULL,
    "financial" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "report_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_settlement_parameters_organization_id_reference_da_idx" ON "employee_settlement_parameters"("organization_id", "reference_date");

-- CreateIndex
CREATE INDEX "employment_periods_organization_id_employee_id_starts_on_idx" ON "employment_periods"("organization_id", "employee_id", "starts_on");

-- CreateIndex
CREATE UNIQUE INDEX "employment_periods_organization_id_employee_id_id_key" ON "employment_periods"("organization_id", "employee_id", "id");

-- CreateIndex
CREATE INDEX "employee_remunerations_organization_id_competence_employee__idx" ON "employee_remunerations"("organization_id", "competence", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_remunerations_organization_id_employee_id_competen_key" ON "employee_remunerations"("organization_id", "employee_id", "competence");

-- CreateIndex
CREATE INDEX "employee_vacation_periods_organization_id_concession_deadli_idx" ON "employee_vacation_periods"("organization_id", "concession_deadline", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_vacation_periods_organization_id_employee_id_acqui_key" ON "employee_vacation_periods"("organization_id", "employee_id", "acquisition_start");

-- CreateIndex
CREATE INDEX "employee_hr_revisions_organization_id_employee_id_created_a_idx" ON "employee_hr_revisions"("organization_id", "employee_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "platform_grants_capability_is_active_idx" ON "platform_grants"("capability", "is_active");

-- CreateIndex
CREATE INDEX "platform_audit_events_created_at_id_idx" ON "platform_audit_events"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_registration_revisions_organization_id_version_key" ON "organization_registration_revisions"("organization_id", "version");

-- CreateIndex
CREATE INDEX "report_snapshots_organization_id_created_at_id_idx" ON "report_snapshots"("organization_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_normalized_fiscal_identifier_key" ON "organizations"("normalized_fiscal_identifier");

-- CreateIndex
CREATE INDEX "organizations_client_classification_is_active_name_id_idx" ON "organizations"("client_classification", "is_active", "name", "id");

-- CreateIndex
CREATE INDEX "organizations_fiscal_candidate_idx" ON "organizations"("fiscal_candidate");

-- CreateIndex
CREATE UNIQUE INDEX "employees_organization_id_id_key" ON "employees"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "employee_hr_profiles" ADD CONSTRAINT "employee_hr_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_hr_profiles" ADD CONSTRAINT "employee_hr_profiles_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_hr_profiles" ADD CONSTRAINT "employee_hr_profiles_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_settlement_parameters" ADD CONSTRAINT "employee_settlement_parameters_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_settlement_parameters" ADD CONSTRAINT "employee_settlement_parameters_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_settlement_parameters" ADD CONSTRAINT "employee_settlement_parameters_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_periods" ADD CONSTRAINT "employment_periods_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_periods" ADD CONSTRAINT "employment_periods_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_periods" ADD CONSTRAINT "employment_periods_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_remunerations" ADD CONSTRAINT "employee_remunerations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_remunerations" ADD CONSTRAINT "employee_remunerations_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_remunerations" ADD CONSTRAINT "employee_remunerations_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_vacation_periods" ADD CONSTRAINT "employee_vacation_periods_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_vacation_periods" ADD CONSTRAINT "employee_vacation_periods_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_vacation_periods" ADD CONSTRAINT "employee_vacation_periods_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_hr_revisions" ADD CONSTRAINT "employee_hr_revisions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_hr_revisions" ADD CONSTRAINT "employee_hr_revisions_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_hr_revisions" ADD CONSTRAINT "employee_hr_revisions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_grants" ADD CONSTRAINT "platform_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_audit_events" ADD CONSTRAINT "platform_audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_audit_events" ADD CONSTRAINT "platform_audit_events_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_registration_revisions" ADD CONSTRAINT "organization_registration_revisions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_registration_revisions" ADD CONSTRAINT "organization_registration_revisions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_snapshots" ADD CONSTRAINT "report_snapshots_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_snapshots" ADD CONSTRAINT "report_snapshots_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
