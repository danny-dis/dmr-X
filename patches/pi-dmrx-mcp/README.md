# pi-dmrx-mcp — pi coding agent ↔ DMR-X MCP bridge

Vendored copy of the [pi](https://github.com/pi-agent/pi) extension that bridges the pi
coding agent to DMR-X's MCP server. pi has no native MCP client, so this extension speaks
MCP StreamableHTTP itself and re-exposes the tools to pi.

**Live location (outside this repo):** `~/.pi/agent/extensions/pi-dmrx-mcp/`

Kept here so the fixes below survive a pi reinstall, matching the `patches/g0dm0d3/`
convention for out-of-repo files.

## Install / restore

```bash
cp patches/pi-dmrx-mcp/*.ts ~/.pi/agent/extensions/pi-dmrx-mcp/
```

Register it in `~/.pi/agent/settings.json`:

```json
{
  "defaultProvider": "dmrx",
  "defaultModel": "auto-free",
  "extensions": ["C:/Users/pc/.pi/agent/extensions/pi-dmrx-mcp"]
}
```

And point pi's `dmrx` provider at the gateway in `~/.pi/agent/models.json`:

```json
{
  "dmrx": {
    "baseUrl": "http://127.0.0.1:47113/v1",
    "api": "openai-completions",
    "authHeader": true
  }
}
```

## Fixes applied here

### 1. Tool-count explosion (pi hung / returned empty output)

The extension originally wrapped **every** MCP tool as a native pi tool:

```ts
for (const tool of TOOL_LIST) { ... pi.registerTool(...) }
```

DMR-X exposes **321** MCP tools (~271 of them `dmrx_agent_*` subagents), so every pi
inference request shipped 321 tool schemas. That blows past provider request limits and
pi hangs or exits 0 with empty stdout.

Bisected threshold on this host: **2 / 8 / 16 wrapped tools work; 24 fails.**

Now the extension filters `dmrx_agent_*` out and caps the count:

| Env var | Default | Effect |
|---|---|---|
| `DMRX_MCP_MAX_TOOLS` | `16` | Max natively-wrapped tools |
| `DMRX_MCP_WRAP_AGENTS` | unset | Set to `1` to also wrap `dmrx_agent_*` |

The full 321-tool shelf stays reachable through the `dmrx_mcp_call` meta-tool, so nothing
is lost — the model calls `dmrx_mcp_call{name, args}` instead of a native wrapper.

### 2. Stale default MCP port

Default was `http://127.0.0.1:3100`; DMR-X's MCP server listens on **47114**
(`DMRX_MCP_PORT`). Corrected so no env var is needed.

> **Do NOT include the `/mcp` suffix** in `DMRX_MCP_URL`. `mcp-client.ts` builds
> `new URL(`${this.base}/mcp`)` itself, so passing `.../47114/mcp` yields `/mcp/mcp`
> and the connect fails.

## Verified behaviour

Startup line confirming the cap is active:

```
[pi-dmrx-mcp] connected: 321 tools (attempt 1)
[pi-dmrx-mcp] natively wrapping 16/321 tools (rest reachable via dmrx_mcp_call; ...)
```

**pi codes through DMR-X → godmode** (`model: auto-free`) — real files, passing tests:

- `fizzbuzz.py` → correct FizzBuzz output for 1..15
- `stats.py` + `test_stats.py` → `Ran 7 tests ... OK`
- `slug.py` → `slugify('Hello,   World!! -- Foo_Bar 123')` = `'hello-world-foo-bar-123'`

Godmode treatment confirmed on pi's exact request shape:

```
id:        gm-req_…            ← gm- prefix
x_g0dm0d3: True
pipeline.godmode: True
stm modules: ['hedge_reducer', 'direct_mode']
```

## Known gap

pi's **file-writing / coding** path works. pi prompts that ask it to *invoke an MCP tool*
still return empty stdout (exit 0), even though the gateway now correctly emits
`finish_reason: 'tool_calls'` (verified 3/3 by curl). The gateway side is fixed; something
in pi's own tool-execution loop does not consume it. Not yet root-caused.

## Debugging

Prove MCP itself is healthy independently of pi — drive the client directly:

```ts
import { McpClient } from "~/.pi/agent/extensions/pi-dmrx-mcp/mcp-client.ts";
const c = new McpClient("http://127.0.0.1:47114");
await c.initialize();
const tools = await c.listTools();          // → 321
await c.callTool("dmrx_status", {});        // → ~36ms
```

If that succeeds, MCP is fine and the fault is in pi or the tool-count cap.
