BEGIN;

ALTER TABLE memberships ADD COLUMN scope_restricted BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE membership_scopes (
  id UUID NOT NULL,
  user_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  unit_id UUID NOT NULL,
  sector_id UUID,
  CONSTRAINT membership_scopes_pkey PRIMARY KEY (id),
  CONSTRAINT membership_scopes_membership_fkey FOREIGN KEY (user_id, organization_id)
    REFERENCES memberships (user_id, organization_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT membership_scopes_unit_fkey FOREIGN KEY (organization_id, unit_id)
    REFERENCES units (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT membership_scopes_sector_fkey FOREIGN KEY (organization_id, unit_id, sector_id)
    REFERENCES sectors (organization_id, unit_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX membership_scopes_membership_idx ON membership_scopes (user_id, organization_id);
CREATE INDEX membership_scopes_structure_idx ON membership_scopes (organization_id, unit_id, sector_id);
CREATE UNIQUE INDEX membership_scopes_unit_only_key
  ON membership_scopes (user_id, organization_id, unit_id) WHERE sector_id IS NULL;
CREATE UNIQUE INDEX membership_scopes_sector_key
  ON membership_scopes (user_id, organization_id, unit_id, sector_id) WHERE sector_id IS NOT NULL;

CREATE TABLE company_groups (
  id UUID NOT NULL,
  name VARCHAR(160) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT company_groups_pkey PRIMARY KEY (id)
);

CREATE INDEX company_groups_name_id_idx ON company_groups (name, id);

CREATE TABLE company_group_clients (
  group_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  CONSTRAINT company_group_clients_pkey PRIMARY KEY (group_id, organization_id),
  CONSTRAINT company_group_clients_group_id_fkey FOREIGN KEY (group_id)
    REFERENCES company_groups (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT company_group_clients_organization_id_fkey FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX company_group_clients_organization_id_idx ON company_group_clients (organization_id);

CREATE TABLE company_group_grants (
  group_id UUID NOT NULL,
  user_id UUID NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT company_group_grants_pkey PRIMARY KEY (group_id, user_id),
  CONSTRAINT company_group_grants_group_id_fkey FOREIGN KEY (group_id)
    REFERENCES company_groups (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT company_group_grants_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX company_group_grants_user_id_is_active_idx ON company_group_grants (user_id, is_active);

COMMIT;
