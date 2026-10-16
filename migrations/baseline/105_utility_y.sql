-- Audit log owned by the utility_y integration.
CREATE TABLE baseline.audit_utility_y (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  decision_id text NOT NULL,
  tenant_id text NOT NULL,
  requester text NOT NULL,
  purpose text NOT NULL,
  record_count integer,
  response jsonb,
  normalized jsonb,
  raw_text text,
  format_version text,
  logged_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_utility_y_decision ON baseline.audit_utility_y (decision_id);
ALTER TABLE baseline.audit_utility_y ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON baseline.audit_utility_y
  USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON baseline.audit_utility_y TO app_rw;
