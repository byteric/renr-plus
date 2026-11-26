ALTER TYPE "PlatformCapability" ADD VALUE 'RECOVER_ACCOUNT_MFA';

ALTER TABLE "sessions"
  ADD COLUMN "mfa_version" INTEGER,
  ADD COLUMN "mfa_verified_at" TIMESTAMP(3),
  ADD CONSTRAINT "sessions_mfa_proof" CHECK (
    ("mfa_version" IS NULL AND "mfa_verified_at" IS NULL) OR
    ("mfa_version" IS NOT NULL AND "mfa_version" > 0 AND "mfa_verified_at" IS NOT NULL)
  );

CREATE TYPE "MfaChallengePurpose" AS ENUM ('VERIFY', 'ENROLL', 'RECOVER');
CREATE TYPE "MfaAttemptPurpose" AS ENUM ('PROOF', 'RECOVERY_PASSWORD', 'ACCOUNT_PASSWORD');

CREATE TABLE "mfa_factors" (
  "user_id" UUID PRIMARY KEY REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "version" INTEGER NOT NULL CHECK ("version" > 0),
  "encrypted_secret" TEXT NOT NULL,
  "last_accepted_step" INTEGER NOT NULL CHECK ("last_accepted_step" >= 0)
);

CREATE TABLE "mfa_recoveries" (
  "id" UUID PRIMARY KEY,
  "token_hash" CHAR(64) NOT NULL CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  "user_id" UUID NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "issuer_id" UUID NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "issuer_grant_version" INTEGER NOT NULL CHECK ("issuer_grant_version" > 0),
  "factor_version" INTEGER NOT NULL CHECK ("factor_version" > 0),
  "verification_reference" VARCHAR(64) NOT NULL CHECK ("verification_reference" ~ '^[A-Za-z0-9._-]{3,64}$'),
  "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  CONSTRAINT "mfa_recoveries_distinct_issuer" CHECK ("user_id" <> "issuer_id"),
  CONSTRAINT "mfa_recoveries_lifecycle" CHECK (
    "expires_at" > "issued_at" AND
    ("consumed_at" IS NULL OR ("consumed_at" >= "issued_at" AND "consumed_at" < "expires_at")) AND
    ("revoked_at" IS NULL OR "revoked_at" >= "issued_at") AND
    ("consumed_at" IS NULL OR "revoked_at" IS NULL)
  )
);
CREATE UNIQUE INDEX "mfa_recoveries_token_hash_key" ON "mfa_recoveries" ("token_hash");
CREATE INDEX "mfa_recoveries_user_id_issued_at_idx" ON "mfa_recoveries" ("user_id", "issued_at");
CREATE UNIQUE INDEX "mfa_recoveries_one_open_per_user" ON "mfa_recoveries" ("user_id")
  WHERE "consumed_at" IS NULL AND "revoked_at" IS NULL;

CREATE TABLE "mfa_challenges" (
  "id" UUID PRIMARY KEY,
  "user_id" UUID NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "token_hash" CHAR(64) NOT NULL CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  "purpose" "MfaChallengePurpose" NOT NULL,
  "factor_version" INTEGER,
  "recovery_id" UUID REFERENCES "mfa_recoveries" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "expires_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mfa_challenges_scope" CHECK (
    ("purpose" = 'ENROLL' AND "factor_version" IS NULL AND "recovery_id" IS NULL) OR
    ("purpose" = 'VERIFY' AND "factor_version" IS NOT NULL AND "recovery_id" IS NULL) OR
    ("purpose" = 'RECOVER' AND "factor_version" IS NOT NULL AND "recovery_id" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "mfa_challenges_token_hash_key" ON "mfa_challenges" ("token_hash");
CREATE INDEX "mfa_challenges_user_id_expires_at_idx" ON "mfa_challenges" ("user_id", "expires_at");

CREATE TABLE "mfa_enrollments" (
  "id" UUID PRIMARY KEY,
  "user_id" UUID NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "challenge_id" UUID REFERENCES "mfa_challenges" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "session_id" UUID REFERENCES "sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "encrypted_secret" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mfa_enrollments_credential" CHECK (("challenge_id" IS NULL) <> ("session_id" IS NULL))
);
CREATE UNIQUE INDEX "mfa_enrollments_challenge_id_key" ON "mfa_enrollments" ("challenge_id");
CREATE UNIQUE INDEX "mfa_enrollments_session_id_key" ON "mfa_enrollments" ("session_id");
CREATE INDEX "mfa_enrollments_user_id_expires_at_idx" ON "mfa_enrollments" ("user_id", "expires_at");

CREATE TABLE "mfa_recovery_codes" (
  "user_id" UUID NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "factor_version" INTEGER NOT NULL CHECK ("factor_version" > 0),
  "code_hash" CHAR(64) NOT NULL CHECK ("code_hash" ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY ("user_id", "factor_version", "code_hash")
);

CREATE TABLE "mfa_attempts" (
  "user_id" UUID NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "purpose" "MfaAttemptPurpose" NOT NULL,
  "failures" INTEGER NOT NULL CHECK ("failures" > 0),
  "expires_at" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("user_id", "purpose")
);
