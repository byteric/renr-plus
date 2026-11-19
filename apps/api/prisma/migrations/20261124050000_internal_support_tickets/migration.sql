ALTER TYPE "PlatformCapability" ADD VALUE 'READ_SUPPORT';
ALTER TYPE "PlatformCapability" ADD VALUE 'MANAGE_SUPPORT';

CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');
CREATE TYPE "SupportTicketCategory" AS ENUM ('ACCESS', 'BILLING', 'TECHNICAL', 'OTHER');

CREATE TABLE "support_tickets" (
  "id" UUID PRIMARY KEY,
  "organization_id" UUID NOT NULL,
  "opened_by_id" UUID NOT NULL,
  "subject" VARCHAR(160) NOT NULL,
  "category" "SupportTicketCategory" NOT NULL,
  "description" VARCHAR(2000) NOT NULL,
  "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
  "assignee_id" UUID,
  "due_on" DATE,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "resolved_at" TIMESTAMP(3),
  CONSTRAINT "support_tickets_organization_id_fkey" FOREIGN KEY ("organization_id")
    REFERENCES "organizations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "support_tickets_opened_by_id_fkey" FOREIGN KEY ("opened_by_id")
    REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "support_tickets_assignee_id_fkey" FOREIGN KEY ("assignee_id")
    REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "support_ticket_consistent_state" CHECK (
    "version" > 0 AND (("status" = 'RESOLVED') = ("resolved_at" IS NOT NULL))
  )
);

CREATE UNIQUE INDEX "support_tickets_organization_id_id_key"
  ON "support_tickets" ("organization_id", "id");
CREATE INDEX "support_tickets_organization_id_updated_at_id_idx"
  ON "support_tickets" ("organization_id", "updated_at", "id");
CREATE INDEX "support_tickets_status_due_on_id_idx"
  ON "support_tickets" ("status", "due_on", "id");

CREATE TABLE "support_ticket_revisions" (
  "id" UUID PRIMARY KEY,
  "organization_id" UUID NOT NULL,
  "ticket_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "SupportTicketStatus" NOT NULL,
  "assignee_id" UUID,
  "assignee_name" VARCHAR(120),
  "due_on" DATE,
  "note" VARCHAR(2000) NOT NULL,
  "actor_id" UUID NOT NULL,
  "actor_name" VARCHAR(120) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_ticket_revisions_organization_id_ticket_id_fkey"
    FOREIGN KEY ("organization_id", "ticket_id") REFERENCES "support_tickets" ("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "support_ticket_revisions_actor_id_fkey" FOREIGN KEY ("actor_id")
    REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "support_ticket_revision_consistent_assignee" CHECK (
    "version" > 0 AND (("assignee_id" IS NULL) = ("assignee_name" IS NULL))
  )
);

CREATE UNIQUE INDEX "support_ticket_revisions_organization_id_ticket_id_version_key"
  ON "support_ticket_revisions" ("organization_id", "ticket_id", "version");

CREATE FUNCTION preserve_support_ticket_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Support ticket history is immutable';
END;
$$;

CREATE TRIGGER "support_ticket_revisions_immutable"
  BEFORE UPDATE OR DELETE ON "support_ticket_revisions"
  FOR EACH ROW EXECUTE FUNCTION preserve_support_ticket_revision();
