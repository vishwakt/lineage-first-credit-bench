-- Audit log owned by the telecom_t integration.
CREATE TABLE baseline.audit_telecom_t (
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
CREATE INDEX audit_telecom_t_decision ON baseline.audit_telecom_t (decision_id);
ALTER TABLE baseline.audit_telecom_t ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON baseline.audit_telecom_t
  USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON baseline.audit_telecom_t TO app_rw;
