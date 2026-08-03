-- G0DM0D3 relay mode: persist the OpenAI-compatible relay gateway URL
-- (usually DMR-X itself) so the managed G0DM0D3 server can route LLM calls
-- through the host's provider vault without an OpenRouter key. Idempotent:
-- the migration runner skips "duplicate column name" if already present.
ALTER TABLE server_instances ADD COLUMN llm_base_url TEXT;
