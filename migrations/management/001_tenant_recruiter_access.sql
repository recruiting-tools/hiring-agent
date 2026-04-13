-- migration: 001_tenant_recruiter_access.sql
-- Control-plane schema for tenant/recruiter access resolution.

CREATE SCHEMA IF NOT EXISTS management;

CREATE TABLE IF NOT EXISTS management.tenants (
  tenant_id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tenants_status_check CHECK (status IN ('active', 'suspended', 'archived'))
);

CREATE TABLE IF NOT EXISTS management.recruiters (
  recruiter_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES management.tenants(tenant_id),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  role TEXT NOT NULL DEFAULT 'recruiter',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT recruiters_status_check CHECK (status IN ('active', 'suspended', 'disabled')),
  CONSTRAINT recruiters_role_check CHECK (role IN ('recruiter', 'admin'))
);

CREATE TABLE IF NOT EXISTS management.sessions (
  session_token TEXT PRIMARY KEY,
  recruiter_id TEXT NOT NULL REFERENCES management.recruiters(recruiter_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_management_sessions_expires_at
  ON management.sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_management_sessions_recruiter_id
  ON management.sessions(recruiter_id);

CREATE TABLE IF NOT EXISTS management.database_connections (
  db_alias TEXT PRIMARY KEY,
  secret_name TEXT,
  connection_string TEXT,
  provider TEXT NOT NULL,
  region TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT exactly_one_connection_source CHECK (
    ((secret_name IS NOT NULL)::int + (connection_string IS NOT NULL)::int) = 1
  ),
  CONSTRAINT database_connections_status_check CHECK (
    status IN ('active', 'disabled')
  )
);

CREATE TABLE IF NOT EXISTS management.tenant_database_bindings (
  binding_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES management.tenants(tenant_id),
  environment TEXT NOT NULL,
  binding_kind TEXT NOT NULL,
  db_alias TEXT NOT NULL REFERENCES management.database_connections(db_alias),
  schema_name TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tenant_database_bindings_environment_check CHECK (
    environment IN ('local', 'dev', 'sandbox', 'prod')
  ),
  CONSTRAINT tenant_database_bindings_kind_check CHECK (
    binding_kind IN ('shared_db', 'shared_schema', 'dedicated_db')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_management_primary_binding
  ON management.tenant_database_bindings (tenant_id, environment)
  WHERE is_primary = true;
