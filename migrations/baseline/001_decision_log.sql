-- Baseline design: the decision service keeps its own log; each integration adds its own
-- audit table in a later migration (one per source).
CREATE TABLE baseline.decision_log (
  decision_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  consumer_id text NOT NULL,
  as_of date NOT NULL,
  requester text NOT NULL,
  purpose text NOT NULL,
  model_version text NOT NULL,
  quality_mode text NOT NULL,
  sources text[] NOT NULL,
  outcome text NOT NULL,
  reasons jsonb NOT NULL,
  quarantined jsonb NOT NULL,
  logged_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE baseline.decision_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON baseline.decision_log
  USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON baseline.decision_log TO app_rw;
