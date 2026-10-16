-- Audit log owned by the bureau_a integration.
CREATE TABLE baseline.audit_bureau_a (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  decision_id text NOT NULL,
  tenant_id text NOT NULL,
  requester text NOT NULL,
  purpose text NOT NULL,
  subject_ref text,
  hit boolean,
  score_value integer,
  response jsonb,
  normalized jsonb,
  raw_text text,
  format_version text,
  logged_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_bureau_a_decision ON baseline.audit_bureau_a (decision_id);
ALTER TABLE baseline.audit_bureau_a ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON baseline.audit_bureau_a
  USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON baseline.audit_bureau_a TO app_rw;
