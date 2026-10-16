-- Audit log owned by the bnpl_q integration.
CREATE TABLE baseline.audit_bnpl_q (
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
CREATE INDEX audit_bnpl_q_decision ON baseline.audit_bnpl_q (decision_id);
ALTER TABLE baseline.audit_bnpl_q ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON baseline.audit_bnpl_q
  USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON baseline.audit_bnpl_q TO app_rw;
