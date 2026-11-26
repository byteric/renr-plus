ALTER TYPE "PlatformCapability" ADD VALUE 'ASSIST_COMPANY_PASSWORD_RECOVERY';
ALTER TYPE "PlatformCapability" ADD VALUE 'MANAGE_PASSWORD_RECOVERY';

CREATE TYPE "PasswordRecoveryPurpose" AS ENUM ('PASSWORD_RESET');

CREATE TABLE "password_recoveries" (
  "id" UUID NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "user_id" UUID NOT NULL,
  "issuer_id" UUID NOT NULL,
  "organization_id" UUID,
  "purpose" "PasswordRecoveryPurpose" NOT NULL DEFAULT 'PASSWORD_RESET',
  "verification_reference" VARCHAR(64) NOT NULL,
  "policy_version" VARCHAR(32) NOT NULL,
  "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),

  CONSTRAINT "password_recoveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "password_recoveries_token_hash_format" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "password_recoveries_verification_reference_format"
    CHECK ("verification_reference" ~ '^[A-Za-z0-9._-]{3,64}$'),
  CONSTRAINT "password_recoveries_distinct_issuer" CHECK ("user_id" <> "issuer_id"),
  CONSTRAINT "password_recoveries_lifecycle" CHECK (
    "expires_at" > "issued_at" AND
    ("consumed_at" IS NULL OR ("consumed_at" >= "issued_at" AND "consumed_at" < "expires_at")) AND
    ("revoked_at" IS NULL OR "revoked_at" >= "issued_at") AND
    ("consumed_at" IS NULL OR "revoked_at" IS NULL)
  ),
  CONSTRAINT "password_recoveries_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "password_recoveries_issuer_id_fkey" FOREIGN KEY ("issuer_id")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "password_recoveries_organization_id_fkey" FOREIGN KEY ("organization_id")
    REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "password_recoveries_token_hash_key" ON "password_recoveries"("token_hash");
CREATE INDEX "password_recoveries_user_id_issued_at_idx" ON "password_recoveries"("user_id", "issued_at");
CREATE UNIQUE INDEX "password_recoveries_one_open_per_user"
  ON "password_recoveries"("user_id") WHERE "consumed_at" IS NULL AND "revoked_at" IS NULL;
