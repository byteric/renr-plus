BEGIN;

CREATE TABLE "assessment_invite_deliveries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "issued_at" TIMESTAMP(3),
    CONSTRAINT "assessment_invite_deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "assessment_invite_deliveries_manual_channel" CHECK ("channel" = 'MANUAL_CODE'),
    CONSTRAINT "assessment_invite_deliveries_invite_count" CHECK ("count" BETWEEN 1 AND 20),
    CONSTRAINT "assessment_invite_deliveries_period" CHECK (
        "expires_at" > "created_at" AND
        ("issued_at" IS NULL OR ("issued_at" >= "created_at" AND "issued_at" < "expires_at"))
    ),
    CONSTRAINT "assessment_invite_deliveries_organization_id_cycle_id_fkey"
        FOREIGN KEY ("organization_id", "cycle_id")
        REFERENCES "assessment_cycles" ("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "assessment_invite_deliveries_actor_id_fkey"
        FOREIGN KEY ("actor_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "assessment_invite_deliveries_idempotency_key"
    ON "assessment_invite_deliveries" ("organization_id", "cycle_id", "channel", "idempotency_key");
CREATE INDEX "assessment_invite_deliveries_actor_id_idx"
    ON "assessment_invite_deliveries" ("actor_id");

COMMIT;
