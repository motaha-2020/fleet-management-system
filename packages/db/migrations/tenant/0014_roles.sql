-- Owner decision (14 Nov 2026): each company sets what its office roles may do.
-- A row with a `key` overrides a built-in role (fleet_manager, finance_reviewer); a row without one is a role the
-- company made itself. Company admin and driver are fixed and never stored here. Permissions absent = not allowed.
CREATE TABLE roles (
  id          uuid PRIMARY KEY,
  key         text UNIQUE CHECK (key IN ('fleet_manager', 'finance_reviewer')),
  name_ar     text NOT NULL CHECK (length(trim(name_ar)) BETWEEN 2 AND 80),
  name_en     text NOT NULL CHECK (length(trim(name_en)) BETWEEN 2 AND 80),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by  uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- The whole permission set of a role is replaced on save, so rows are removed here (not business records).
CREATE TABLE role_permissions (
  role_id  uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  action   text NOT NULL,
  scope    text NOT NULL CHECK (scope IN ('all', 'branches')),
  PRIMARY KEY (role_id, action)
);
