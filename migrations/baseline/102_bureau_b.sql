-- Audit log owned by the bureau_b integration.
CREATE TABLE baseline.audit_bureau_b (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  decision_id text NOT NULL,
  tenant_id text NOT NULL,
  requester text NOT NULL,
  purpose text NOT NULL,
  subject_ref text,
  hit boolean,
  score_value integer,
  tradeline_count integer,
  response jsonb,
  normalized jsonb,
  raw_text text,
  format_version text,
  logged_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_bureau_b_decision ON baseline.audit_bureau_b (decision_id);
ALTER TABLE baseline.audit_bureau_b ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON baseline.audit_bureau_b
  USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON baseline.audit_bureau_b TO app_rw;
