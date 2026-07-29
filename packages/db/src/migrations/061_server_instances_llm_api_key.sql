-- G0DM0D3 relay mode: persist the optional API key for the relay gateway
-- (DMR-X LOCAL MODE needs none). Idempotent via the runner's
-- "duplicate column name" skip.
ALTER TABLE server_instances ADD COLUMN llm_api_key TEXT;
