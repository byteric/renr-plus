-- Additive expansion; group IDs and all diagnostic references remain unchanged.
SET lock_timeout = '5s';
ALTER TABLE assessment_groups ADD COLUMN name VARCHAR(120) NOT NULL DEFAULT 'Grupo de avaliação', ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true, ADD COLUMN version INTEGER NOT NULL DEFAULT 1, ADD COLUMN updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE assessment_groups g SET name = s.name FROM sectors s WHERE s.id = g.sector_id AND s.organization_id = g.organization_id;
CREATE UNIQUE INDEX units_organization_id_id_key ON units(organization_id, id);
CREATE UNIQUE INDEX sectors_organization_id_unit_id_id_key ON sectors(organization_id, unit_id, id);
CREATE TABLE employees (
 id UUID PRIMARY KEY, organization_id UUID NOT NULL, name VARCHAR(120) NOT NULL,
 internal_identifier VARCHAR(64), normalized_identifier TEXT, unit_id UUID NOT NULL, sector_id UUID NOT NULL,
 linked_user_id UUID, is_active BOOLEAN NOT NULL DEFAULT true, version INTEGER NOT NULL DEFAULT 1,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL,
 CONSTRAINT employees_organization_id_fkey FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT employees_organization_id_unit_id_fkey FOREIGN KEY(organization_id,unit_id) REFERENCES units(organization_id,id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT employees_organization_id_unit_id_sector_id_fkey FOREIGN KEY(organization_id,unit_id,sector_id) REFERENCES sectors(organization_id,unit_id,id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT employees_linked_user_id_organization_id_fkey FOREIGN KEY(linked_user_id,organization_id) REFERENCES memberships(user_id,organization_id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX employees_organization_id_normalized_identifier_key ON employees(organization_id,normalized_identifier);
CREATE INDEX employees_organization_id_is_active_name_id_idx ON employees(organization_id,is_active,name,id);
CREATE INDEX employees_organization_id_unit_id_sector_id_idx ON employees(organization_id,unit_id,sector_id);
CREATE INDEX employees_linked_user_id_organization_id_idx ON employees(linked_user_id,organization_id);
