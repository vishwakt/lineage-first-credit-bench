-- Lineage-first design: one append-only substrate for every source.
CREATE TABLE lineage.retrieval (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id text NOT NULL,
  decision_id text NOT NULL,
  requester text NOT NULL,
  purpose text NOT NULL,
  source text NOT NULL,
  content_type text NOT NULL,
  format_version text NOT NULL,
  refdata_version text,
  adapter_version text NOT NULL,
  payload bytea NOT NULL,
  payload_sha256 bytea NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX retrieval_decision ON lineage.retrieval (decision_id);

CREATE TABLE lineage.decision (
  decision_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  consumer_id text NOT NULL,
  as_of date NOT NULL,
  requester text NOT NULL,
  purpose text NOT NULL,
  model_version text NOT NULL,
  quality_mode text NOT NULL,
  retrieval_event_ids bigint[] NOT NULL,
  model_input_sha256 bytea NOT NULL,
  outcome text NOT NULL,
  reasons jsonb NOT NULL,
  quarantined jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION lineage.reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'lineage records are append only';
END $$;
CREATE TRIGGER retrieval_append_only BEFORE UPDATE OR DELETE ON lineage.retrieval FOR EACH ROW EXECUTE FUNCTION lineage.reject_change();
CREATE TRIGGER retrieval_no_truncate BEFORE TRUNCATE ON lineage.retrieval FOR EACH STATEMENT EXECUTE FUNCTION lineage.reject_change();
CREATE TRIGGER decision_append_only BEFORE UPDATE OR DELETE ON lineage.decision FOR EACH ROW EXECUTE FUNCTION lineage.reject_change();
CREATE TRIGGER decision_no_truncate BEFORE TRUNCATE ON lineage.decision FOR EACH STATEMENT EXECUTE FUNCTION lineage.reject_change();

ALTER TABLE lineage.retrieval ENABLE ROW LEVEL SECURITY;
ALTER TABLE lineage.decision ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON lineage.retrieval
  USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation ON lineage.decision
  USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT ON lineage.retrieval, lineage.decision TO app_rw;
