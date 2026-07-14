# MCP Server

DMR-X includes an MCP (Model Context Protocol) server that exposes its routing capabilities as MCP tools. This allows MCP-compatible clients (Claude Desktop, Cursor, Continue, etc.) to use DMR-X as a tool provider.

## Transports

| Transport | Config | Description |
|-----------|--------|-------------|
| `stdio` | `DMRX_MCP_TRANSPORT=stdio` | Standard I/O (default, for local use) |
| `sse` | `DMRX_MCP_TRANSPORT=sse` | Server-Sent Events over HTTP |
| `http` | `DMRX_MCP_TRANSPORT=http` | Streamable HTTP |

## Configuration

```bash
# .env
DMRX_MCP_TRANSPORT=stdio         # Transport type
DMRX_MCP_PORT=3100               # Port for SSE/HTTP transports
DMRX_MCP_HOST=127.0.0.1          # Bind address (127.0.0.1 for local only)
DMRX_MCP_API_KEY=your-mcp-key    # API key for authentication (required in production)
```

**Security:** When using SSE or HTTP transports, always set `DMRX_MCP_API_KEY`. The server binds to `127.0.0.1` by default — only change to `0.0.0.0` if you need remote access.

## Available Tools

The DMR-X MCP server exposes **40+ tools** across routing, generation, context/memory, filesystem, skills, presets, templates, and tool search. The most-used tools are documented in detail below; the remainder are summarized in [Additional tools](#additional-tools).

### `dmrx_chat`

Chat completions via DMR-X routing.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `messages` | `ChatMessage[]` | Yes | Conversation messages |
| `model` | `string` | No | Model name or meta-model alias (default: auto-select) |
| `temperature` | `number` | No | Sampling temperature (0-2) |
| `max_tokens` | `integer` | No | Maximum response tokens |
| `stream` | `boolean` | No | Enable streaming (default: false) |
| `quality` | `string` | No | Routing target: `frontier`, `balanced`, `economy` |
| `response_format` | `object` | No | Response format (`text` or `json_object`) |

### `dmrx_generate_image`

Image generation via DMR-X routing.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | `string` | Yes | Image description |
| `model` | `string` | No | Model name (default: auto-select) |
| `size` | `string` | No | Image size (e.g., `1024x1024`) |
| `quality` | `string` | No | Image quality |
| `n` | `integer` | No | Number of images |

### `dmrx_embed`

Text embeddings via DMR-X routing.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `input` | `string \| string[]` | Yes | Text(s) to embed |
| `model` | `string` | No | Embedding model (default: auto-select) |

### `dmrx_transcribe`

Speech-to-text via DMR-X routing.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `audio` | `string` | Yes | Base64-encoded audio data |
| `model` | `string` | No | STT model (default: auto-select) |
| `language` | `string` | No | Audio language code |

### `dmrx_speak`

Text-to-speech via DMR-X routing.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `input` | `string` | Yes | Text to speak |
| `model` | `string` | No | TTS model (default: auto-select) |
| `voice` | `string` | No | Voice identifier |

### `dmrx_rerank`

Document reranking via DMR-X routing.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | `string` | Yes | Search query |
| `documents` | `string[]` | Yes | Documents to rank |
| `model` | `string` | No | Reranking model (default: auto-select) |
| `top_n` | `integer` | No | Number of top results to return |

### `dmrx_models`

List available models.

**Parameters:** None.

### `dmrx_status`

Get DMR-X system status.

**Parameters:** None.

### Routing Parameters (All Tools)

Most tools accept additional routing control parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `provider_preference` | `string[]` | Ordered list of preferred provider IDs |
| `provider_blacklist` | `string[]` | Provider IDs to exclude from routing |
| `latency_target` | `number \| string` | Maximum acceptable latency (e.g. `100` or `"100ms"`) |
| `cost_target` | `number \| string` | Max cost per 1M output tokens (e.g. `0.50` or `"$0.50"`) |
| `local_first` | `boolean` | Prefer local models (Ollama) when available |
| `require_privacy` | `boolean` | Force privacy-preserving providers only |

### `dmrx_batch`

Execute multiple tool calls atomically.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `calls` | `Array<{ tool: string, parameters: object }>` | Yes | Tool calls to execute |
| `continue_on_fail` | `boolean` | No | Continue on error (default true) |

### `dmrx_context_save`

Save conversation context for later use.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `messages` | `ChatMessage[]` | Yes | Conversation messages |
| `id` | `string` | No | Context ID (auto-generated if omitted) |
| `ttl_seconds` | `number` | No | Time-to-live in seconds (default 86400) |
| `user` | `string` | No | Owner user ID |

### `dmrx_context_load`

Load a saved conversation context.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | `string` | Yes | Context ID to load |

### `dmrx_context_list`

List saved conversation contexts.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `user` | `string` | No | Filter by user ID |
| `limit` | `number` | No | Max results (default 20) |

### `dmrx_context_summarize`

Generate a contextual summary of a saved conversation.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | `string` | Yes | Context ID to summarize |

### `dmrx_context_compress`

Compress a saved conversation context.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | `string` | Yes | Context ID to compress |
| `target_tokens` | `number` | No | Target token count after compression |

### `dmrx_chat_stream`

Streaming chat completions through DMR-X.

**Parameters:** Same as `dmrx_chat`.

### `dmrx_generate_image_stream`

Streaming image generation through DMR-X.

**Parameters:** Same as `dmrx_generate_image`.

### `dmrx_workflow`

Define and execute multi-step workflows.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `steps` | `Array<WorkflowStep>` | Yes | Ordered workflow steps |
| `fail_fast` | `boolean` | No | Stop on first error (default true) |
| `persist` | `boolean` | No | Persist workflow state for resumption |

**WorkflowStep:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Step identifier |
| `tool` | `string` | Tool name to execute |
| `parameters` | `object` | Tool parameters |
| `input_mapping` | `object` | Map previous step outputs to this step inputs |
| `retry_policy` | `object` | Retry configuration (`max_retries`, `backoff_ms`) |

### Additional tools (summary)

The server also exposes the following tools (routing tools accept the same [Routing Parameters](#routing-parameters-all-tools) as above):

- **Generation:** `dmrx_generate_video`, `dmrx_generate_video_stream`, `dmrx_generate_music`, `dmrx_generate_3d` — video/music/3D generation routed through DMR-X (parameters mirror `dmrx_generate_image`).
- **Filesystem:** `dmrx_read_file`, `dmrx_write_file`, `dmrx_edit_file`, `dmrx_list_files`, `dmrx_search_files` — local file operations for agentic workflows (paths are constrained to the configured workspace).
- **Skills:** `dmrx_skill_get`, `dmrx_skill_list`, `dmrx_skill_search`, `dmrx_skill_sync` — query and sync the universal skill registry.
- **Presets:** `dmrx_preset_create`, `dmrx_preset_get`, `dmrx_preset_list`, `dmrx_preset_update`, `dmrx_preset_delete` — saved routing presets.
- **Templates:** `dmrx_template_create`, `dmrx_template_get`, `dmrx_template_list`, `dmrx_template_update`, `dmrx_template_delete`, `dmrx_template_execute` — reusable prompt/tool templates.
- **Tool search:** `dmrx_tool_search`, `dmrx_tool_list` — hybrid BM25 + semantic search over available tools (requires the tool-search engine).

> The full, current tool inventory (40+) is the source of truth in `services/mcp-server/src/tools.ts`.

## Aggregating External MCP Servers

DMR-X can act as an **MCP aggregator**: when configured, it connects to one or more external MCP servers in the background and re-exposes all of their tools through the same MCP connection. Every external tool is registered under the name `<serverId>__<toolName>`, so a single agent connection to DMR-X gets access to DMR-X's own `dmrx_*` tools plus the full tool surface of every connected upstream server.

### Configuration

External servers are configured via the `DMRX_MCP_CLIENT_SERVERS` environment variable, which is a JSON array of `MCPServerConfig` objects:

```ts
{
  "id": string;          // unique ID
  "name": string;        // human-readable name
  "transport": "stdio" | "sse";
  "command"?: string;    // for stdio
  "args"?: string[];
  "env"?: Record<string, string>;
  "url"?: string;        // for sse
}
```

- `stdio` transports spawn the external server as a subprocess using `command` + `args` + `env`.
- `sse` transports connect to a remote MCP endpoint over Server-Sent Events using `url`.

Example with two stdio servers (GitHub and a local filesystem server):

```bash
DMRX_MCP_CLIENT_SERVERS='[
  {
    "id": "github",
    "name": "GitHub",
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": {"GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..."}
  },
  {
    "id": "filesystem",
    "name": "Filesystem",
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/workspace"]
  }
]'
```

Malformed entries (invalid JSON, missing required fields, unknown transport) are logged and skipped — the DMR-X MCP server still starts with whatever subset of the configuration parsed successfully.

### Tool Naming

External tools appear in the same `listTools()` response as DMR-X's built-in `dmrx_*` tools. To prevent collisions when multiple upstream servers expose tools with the same name, every external tool is registered under the name:

```
<serverId>__<toolName>
```

For example, a GitHub server's `create_issue` tool is exposed as `github__create_issue`, and a filesystem server's `read_file` tool is exposed as `filesystem__read_file`.

The tool's `description` is prefixed with `[Proxied via MCP server '<id>']` so the source of each aggregated tool is obvious when browsing the tool list.

The `inputSchema` for aggregated tools is a passthrough — DMR-X exposes an `args` wrapper (`{ args: <upstream inputSchema> }`) carrying the upstream tool's real JSON Schema. The upstream MCP server is still responsible for validating the real call arguments; the [Example Call](#example-call) section below shows the required argument shape.

### Example Call

Invoke an aggregated tool through the standard MCP `callTool` API. The proxied `inputSchema` is an `args` wrapper carrying the upstream tool's real JSON Schema; the per-tool arguments must be wrapped in a single `args` field:

```ts
const result = await client.callTool({
  name: "github__create_issue",
  arguments: {
    args: {
      owner: "octocat",
      repo: "hello-world",
      title: "Found a bug"
    }
  },
});
```

The contents of `args` are forwarded verbatim to the upstream MCP server, which performs the actual schema validation.

### Operational Notes

- The aggregator connects to all configured external servers at startup. Individual connection failures are logged but do not prevent the DMR-X MCP server from starting.
- The `dmrx_status` tool reports an `aggregator` object with `enabled`, `externalServerCount`, and `externalToolCount` fields, so operators can verify how many upstream servers connected and how many tools were successfully aggregated.
- To add or remove external servers, update the `DMRX_MCP_CLIENT_SERVERS` env var and restart the DMR-X MCP server (env-var-only config has no hot-reload in v1). When aggregation servers are configured via `dmrx-mcp.config.json` (`aggregation.servers`), editing the file live-reconnects/disconnects upstreams and re-registers tools without a restart.
- **Per-server authorization is opt-in** — set `allowedTools` (string[]) on a server in `aggregation.servers` to expose only a subset of its tools; a tool outside the allowlist is never registered. Omit `allowedTools` for the default open behavior (all aggregated tools callable). When using `sse` or `http` transports, also set `DMRX_MCP_API_KEY` to gate access to the DMR-X endpoint as a whole.

## Usage Examples

### Claude Desktop (stdio)

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "dmr-x": {
      "command": "bun",
      "args": ["run", "/path/to/dmr-x/services/mcp-server/src/index.ts"],
      "env": {
        "DMRX_MCP_TRANSPORT": "stdio"
      }
    }
  }
}
```

### Claude Desktop (HTTP)

```json
{
  "mcpServers": {
    "dmr-x": {
      "url": "http://localhost:3100",
      "headers": {
        "Authorization": "Bearer your-mcp-key"
      }
    }
  }
}
```

### Custom MCP Client

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const transport = new SSEClientTransport(
  new URL("http://localhost:3100/sse"),
  {
    requestInit: {
      headers: { Authorization: "Bearer your-mcp-key" },
    },
  }
);

const client = new Client({ name: "my-client", version: "1.0.0" });
await client.connect(transport);

// List available tools
const tools = await client.listTools();

// Call dmrx_chat
const result = await client.callTool({
  name: "dmrx_chat",
  arguments: {
    messages: [{ role: "user", content: "Hello!" }],
    model: "auto-coding",
  },
});
```
