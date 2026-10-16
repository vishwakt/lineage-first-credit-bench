-- Schemas for the two designs and the experiment harness, plus the application role.
-- The application role is not a superuser, so row-level security applies to it.
CREATE SCHEMA IF NOT EXISTS lineage;
CREATE SCHEMA IF NOT EXISTS baseline;
CREATE SCHEMA IF NOT EXISTS harness;
DO $$ BEGIN CREATE ROLE app_rw NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA lineage, baseline TO app_rw;

-- Ground truth recorded by the experiment harness at decision time; never read by a design.
CREATE TABLE IF NOT EXISTS harness.truth (
  decision_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  as_of date NOT NULL,
  model_input_sha256 bytea NOT NULL,
  raw_sha256 jsonb NOT NULL,
  decision jsonb NOT NULL,
  faults jsonb NOT NULL DEFAULT '[]'
);
