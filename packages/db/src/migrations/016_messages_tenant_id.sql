-- Persist tenant_id on the messages table so row-level tenant filtering
-- is possible without an extra JOIN to conversations. This is the
-- companion to conversations.tenant_id (added in 012) and closes the
-- cross-tenant data leak in apps/gateway/src/routes/conversation.routes.ts.
--
-- The column is added with no FK reference to tenants(id) on purpose:
-- messages are CASCADE-deleted with their parent conversation, and a
-- second FK on the same parent would create ambiguity. We do not backfill
-- existing rows — pre-migration messages retain NULL tenant_id and are
-- treated as "unowned" by the new tenant-scoped queries (a NULL
-- `tenant_id = ?` comparison never matches, so they're invisible to
-- any tenant after the route is patched, which is the safe direction).

ALTER TABLE messages ADD COLUMN tenant_id TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_tenant ON messages(tenant_id);
