-- Additive expansion: existing users, roles, sessions and authored records are retained.
CREATE TYPE "Capability" AS ENUM ('EXECUTE_ASSIGNED_ACTIONS', 'TECHNICAL_DECISIONS');
ALTER TABLE memberships
  ADD COLUMN is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN capabilities "Capability"[] NOT NULL DEFAULT '{}',
  ADD COLUMN updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE access_invites (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  email varchar(254) NOT NULL,
  name varchar(120) NOT NULL,
  role "Role" NOT NULL,
  capabilities "Capability"[] NOT NULL DEFAULT '{}',
  token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamp(3) NOT NULL,
  revoked_at timestamp(3),
  consumed_at timestamp(3),
  CHECK (revoked_at IS NULL OR consumed_at IS NULL)
);
-- Administrative listing scoped to organization with stable chronological ordering.
CREATE INDEX access_invites_organization_id_created_at_id_idx ON access_invites(organization_id, created_at, id);
CREATE INDEX access_invites_created_by_idx ON access_invites(created_by);

CREATE TABLE access_history (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_name varchar(120) NOT NULL,
  action varchar(100) NOT NULL,
  reason varchar(1000) NOT NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX access_history_organization_id_created_at_id_idx ON access_history(organization_id, created_at, id);
CREATE INDEX access_history_user_id_idx ON access_history(user_id);
CREATE INDEX access_history_actor_id_idx ON access_history(actor_id);

CREATE FUNCTION prevent_access_history_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Access history is immutable';
END;
$$;
CREATE TRIGGER access_history_immutable BEFORE UPDATE ON access_history
  FOR EACH ROW EXECUTE FUNCTION prevent_access_history_update();
