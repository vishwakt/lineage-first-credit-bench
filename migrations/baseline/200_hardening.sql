-- Hardened capture level (revision, docs/ANALYSIS_PLAN.md). Every integration's audit table
-- also keeps the raw bytes, a SHA-256 hash, and the dictionary and adapter versions, and
-- every baseline table becomes append only. A team hardening its per-integration logs would
-- apply this to each audit table; here one migration does it for all of them.
CREATE FUNCTION baseline.reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'baseline audit records are append only';
END $$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'baseline' AND tablename LIKE 'audit\_%' LOOP
    EXECUTE format('ALTER TABLE baseline.%I ADD COLUMN raw_bytes bytea, ADD COLUMN payload_sha256 bytea, ADD COLUMN refdata_version text, ADD COLUMN adapter_version text', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON baseline.%I FOR EACH ROW EXECUTE FUNCTION baseline.reject_change()', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON baseline.%I FOR EACH STATEMENT EXECUTE FUNCTION baseline.reject_change()', t || '_no_truncate', t);
  END LOOP;
END $$;

ALTER TABLE baseline.decision_log ADD COLUMN model_input_sha256 bytea;
CREATE TRIGGER decision_log_append_only BEFORE UPDATE OR DELETE ON baseline.decision_log FOR EACH ROW EXECUTE FUNCTION baseline.reject_change();
CREATE TRIGGER decision_log_no_truncate BEFORE TRUNCATE ON baseline.decision_log FOR EACH STATEMENT EXECUTE FUNCTION baseline.reject_change();
