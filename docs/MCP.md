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
    model: "free-coding",
  },
});
```
