-- Per-API-key tool restrictions. Stored as a JSON-encoded array
-- of tool patterns (e.g. ["dmrx_chat", "dmrx_embed", "dmrx_*"]). NULL means
-- "no restrictions" (all tools allowed). This enables fine-grained control
-- over which MCP tools a key can invoke.
ALTER TABLE api_keys ADD COLUMN allowed_tools TEXT;