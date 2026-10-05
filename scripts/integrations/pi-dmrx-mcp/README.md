# Pi → DMR-X MCP bridge

Reusable source for Pi's extension bridge. Inference configuration in Pi's
`models.json` is separate; this bridge does not configure models or provider keys.

From the DMR-X repository root:

```bash
node scripts/integrations/pi-dmrx-mcp/install.mjs
bun scripts/integrations/pi-dmrx-mcp/protocol-regression.ts
```

The installer defaults to `~/.pi/agent`, respects `PI_CODING_AGENT_DIR`, or accepts
an explicit agent config directory as its first argument. It installs only
`extensions/pi-dmrx-mcp/{index,mcp-client}.ts`, backs up differing files under the
agent config's `.backups/`, and leaves models, settings, and credentials untouched.
Repeating the installation is a no-op when source and destination match.

Configuration:
- `DMRX_MCP_URL`: default `http://127.0.0.1:47114`.
- `DMRX_MCP_API_KEY`: optional configured MCP bearer credential. No embedded key.
- `DMRX_MCP_MAX_TOOLS` and `DMRX_MCP_WRAP_AGENTS`: restrict native wrappers; all
  server-advertised tools remain reachable through `dmrx_mcp_call` unless a server
  or observing proxy enforces additional restrictions. These are **not** an
  authorization boundary.

The client stores the server-negotiated MCP version during initialization and
sends both `mcp-session-id` and `MCP-Protocol-Version` on session requests,
including notifications. The protocol regression exercises a real local HTTP
server that negotiates a different version and requires the negotiated header.
It uses no external inference or credentials.

For independent coding evaluations, enforce free-only inference at the gateway
with `X-Cost-Filter: free`, `X-Free-Tier-Strategy: free_only`, and body
`costFilter: "free"`. Do not assume `auto-free` intrinsically guarantees zero-cost
routing; it uses a separate GODMODE path. A working non-streaming completion does
not prove Pi's streaming/native-tool path. Probe it explicitly, and keep MCP
model/delegation tools blocked when the coder must receive no outside assistance.
