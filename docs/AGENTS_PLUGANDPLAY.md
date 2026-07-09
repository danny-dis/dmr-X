# Plug & Play: external agents

Connect any MCP client (Claude Code, Cursor, Continue, etc.) to DMR-X's
`dmrx_agent_*` tools without code changes.

## 1. Two environment variables

The MCP server reads these (see `services/mcp-server/src/server.ts`):

| Variable | Default | Purpose |
|----------|---------|---------|
| `DMRX_GATEWAY_URL` | `http://localhost:3000` | Base URL of the running DMR-X gateway. |
| `DMRX_MCP_AGENT_API_KEY` | _(none)_ | Bearer key (tenant API key) sent to the gateway. |

Minimal run:

```bash
DMRX_GATEWAY_URL=http://localhost:3000 \
DMRX_MCP_AGENT_API_KEY=<tenant-api-key> \
bun run services/mcp-server
```

## 2. Zero-config tenant isolation (optional)

If you do not set `DMRX_MCP_AGENT_API_KEY`, the server tries to auto-provision
a dedicated tenant + API key via the gateway admin API — as long as
`DMRX_ADMIN_API_KEY` is set. Otherwise it logs a warning and continues with no
key (downstream calls report "agent key not configured").

## 3. Per-client key via header

An external MCP client may pass its own tenant key per request:

```
X-DMR-Tenant-Key: <client-tenant-key>
```

`resolveGatewayKey()` resolves the gateway key in this order:

1. `X-DMR-Tenant-Key` header (per-client isolation),
2. `DMRX_MCP_AGENT_API_KEY` env (shared/legacy tenant),
3. auto-provisioned key (if available).

## 4. Tools exposed

Once connected, the client sees `dmrx_agent_*` tools (create/list/run agents,
skills CRUD, dispatch, A2A, tool search, etc.). Agents/tasks are scoped to the
resolved tenant key.
