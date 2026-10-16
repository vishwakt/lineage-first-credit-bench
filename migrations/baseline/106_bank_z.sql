-- Audit log owned by the bank_z integration.
CREATE TABLE baseline.audit_bank_z (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  decision_id text NOT NULL,
  tenant_id text NOT NULL,
  requester text NOT NULL,
  purpose text NOT NULL,
  holder text,
  has_account boolean,
  txn_count integer,
  response jsonb,
  normalized jsonb,
  raw_text text,
  format_version text,
  logged_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_bank_z_decision ON baseline.audit_bank_z (decision_id);
ALTER TABLE baseline.audit_bank_z ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON baseline.audit_bank_z
  USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON baseline.audit_bank_z TO app_rw;
