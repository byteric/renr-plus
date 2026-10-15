-- CreateEnum
CREATE TYPE "DiagnosticQuestionType" AS ENUM ('SINGLE_CHOICE', 'MULTIPLE_CHOICE');

-- CreateEnum
CREATE TYPE "DiagnosticCycleStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "instrument_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "version" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PUBLISHED',
    "is_demo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instrument_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagnostic_questions" (
    "id" UUID NOT NULL,
    "instrument_version_id" UUID NOT NULL,
    "label" VARCHAR(400) NOT NULL,
    "type" "DiagnosticQuestionType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL,

    CONSTRAINT "diagnostic_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_options" (
    "id" UUID NOT NULL,
    "instrument_version_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "question_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_groups" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "sector_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagnostic_cycles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "instrument_version_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "status" "DiagnosticCycleStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "diagnostic_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cycle_groups" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "assessment_group_id" UUID NOT NULL,

    CONSTRAINT "cycle_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participation_invites" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "participation_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagnostic_responses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "instrument_version_id" UUID NOT NULL,
    "submitted_period" DATE NOT NULL,

    CONSTRAINT "diagnostic_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "response_answers" (
    "id" UUID NOT NULL,
    "response_id" UUID NOT NULL,
    "instrument_version_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "option_ids" JSONB NOT NULL,

    CONSTRAINT "response_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "instrument_versions_organization_id_id_key" ON "instrument_versions"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "instrument_versions_organization_id_version_key" ON "instrument_versions"("organization_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "diagnostic_questions_instrument_version_id_id_key" ON "diagnostic_questions"("instrument_version_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "diagnostic_questions_instrument_version_id_position_key" ON "diagnostic_questions"("instrument_version_id", "position");

-- CreateIndex
CREATE INDEX "question_options_instrument_version_id_question_id_idx" ON "question_options"("instrument_version_id", "question_id");

-- CreateIndex
CREATE UNIQUE INDEX "question_options_question_id_position_key" ON "question_options"("question_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_groups_organization_id_id_key" ON "assessment_groups"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_groups_organization_id_sector_id_key" ON "assessment_groups"("organization_id", "sector_id");

-- CreateIndex
CREATE INDEX "diagnostic_cycles_organization_id_created_at_idx" ON "diagnostic_cycles"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "diagnostic_cycles_organization_id_instrument_version_id_idx" ON "diagnostic_cycles"("organization_id", "instrument_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "diagnostic_cycles_organization_id_id_key" ON "diagnostic_cycles"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "diagnostic_cycles_organization_id_id_instrument_version_id_key" ON "diagnostic_cycles"("organization_id", "id", "instrument_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "cycle_groups_organization_id_cycle_id_assessment_group_id_key" ON "cycle_groups"("organization_id", "cycle_id", "assessment_group_id");

-- CreateIndex
CREATE INDEX "cycle_groups_organization_id_cycle_id_idx" ON "cycle_groups"("organization_id", "cycle_id");

-- CreateIndex
CREATE INDEX "cycle_groups_organization_id_assessment_group_id_idx" ON "cycle_groups"("organization_id", "assessment_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "participation_invites_token_hash_key" ON "participation_invites"("token_hash");

-- CreateIndex
CREATE INDEX "participation_invites_organization_id_cycle_id_idx" ON "participation_invites"("organization_id", "cycle_id");

-- CreateIndex
CREATE INDEX "diagnostic_responses_organization_id_cycle_id_instrument_ve_idx" ON "diagnostic_responses"("organization_id", "cycle_id", "instrument_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "diagnostic_responses_id_instrument_version_id_key" ON "diagnostic_responses"("id", "instrument_version_id");

-- CreateIndex
CREATE INDEX "response_answers_response_id_instrument_version_id_idx" ON "response_answers"("response_id", "instrument_version_id");

-- CreateIndex
CREATE INDEX "response_answers_instrument_version_id_question_id_idx" ON "response_answers"("instrument_version_id", "question_id");

-- CreateIndex
CREATE UNIQUE INDEX "response_answers_response_id_question_id_key" ON "response_answers"("response_id", "question_id");

-- CreateIndex
CREATE UNIQUE INDEX "sectors_organization_id_id_key" ON "sectors"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "instrument_versions" ADD CONSTRAINT "instrument_versions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnostic_questions" ADD CONSTRAINT "diagnostic_questions_instrument_version_id_fkey" FOREIGN KEY ("instrument_version_id") REFERENCES "instrument_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_options" ADD CONSTRAINT "question_options_instrument_version_id_question_id_fkey" FOREIGN KEY ("instrument_version_id", "question_id") REFERENCES "diagnostic_questions"("instrument_version_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_groups" ADD CONSTRAINT "assessment_groups_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_groups" ADD CONSTRAINT "assessment_groups_organization_id_sector_id_fkey" FOREIGN KEY ("organization_id", "sector_id") REFERENCES "sectors"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnostic_cycles" ADD CONSTRAINT "diagnostic_cycles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnostic_cycles" ADD CONSTRAINT "diagnostic_cycles_organization_id_instrument_version_id_fkey" FOREIGN KEY ("organization_id", "instrument_version_id") REFERENCES "instrument_versions"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_groups" ADD CONSTRAINT "cycle_groups_organization_id_cycle_id_fkey" FOREIGN KEY ("organization_id", "cycle_id") REFERENCES "diagnostic_cycles"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_groups" ADD CONSTRAINT "cycle_groups_organization_id_assessment_group_id_fkey" FOREIGN KEY ("organization_id", "assessment_group_id") REFERENCES "assessment_groups"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participation_invites" ADD CONSTRAINT "participation_invites_organization_id_cycle_id_fkey" FOREIGN KEY ("organization_id", "cycle_id") REFERENCES "diagnostic_cycles"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnostic_responses" ADD CONSTRAINT "diagnostic_responses_organization_id_cycle_id_instrument_v_fkey" FOREIGN KEY ("organization_id", "cycle_id", "instrument_version_id") REFERENCES "diagnostic_cycles"("organization_id", "id", "instrument_version_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "response_answers" ADD CONSTRAINT "response_answers_response_id_instrument_version_id_fkey" FOREIGN KEY ("response_id", "instrument_version_id") REFERENCES "diagnostic_responses"("id", "instrument_version_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "response_answers" ADD CONSTRAINT "response_answers_instrument_version_id_question_id_fkey" FOREIGN KEY ("instrument_version_id", "question_id") REFERENCES "diagnostic_questions"("instrument_version_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
