# DMR-X MCP Server

A powerful Model Context Protocol (MCP) server with intelligent routing, tool discovery, and enterprise-grade security features.

## What is This?

The DMR-X MCP Server acts as a smart proxy between AI agents (like Claude, GPT-4, etc.) and various AI services. It automatically routes requests to the best available provider based on quality, cost, and latency.

## Quick Start

```bash
# Install dependencies
bun install

# Build
bun run build

# Run (stdio mode - for Claude Code, Cursor, etc.)
bun run start

# Run (SSE mode - for web applications)
DMRX_MCP_TRANSPORT=sse DMRX_MCP_PORT=3100 bun run start
```

## Core Features

### 1. Intelligent Routing
- Automatically routes to the best AI provider
- Supports OpenAI, Anthropic, Ollama, Replicate, and more
- Balances quality, cost, and latency

### 2. Tool Search & Discovery
- Find tools using natural language: "generate an image from text"
- Hybrid search (BM25 + semantic) for 94% accuracy
- Searches across all connected MCP servers

### 3. Security Features
- **RBAC**: Role-based access control for tools
- **Guardrails**: PII detection and content filtering
- **Audit Logging**: Tamper-evident logging for compliance

### 4. A2A Protocol
- Agent discovery via Agent Cards
- Agent-to-agent task management
- Standard HTTP endpoints

### 5. Federation
- Share tools across multiple DMR-X instances
- Automatic peer discovery (mDNS or static)
- Health monitoring and failover

## Available Tools

| Tool | Description |
|------|-------------|
| `dmrx_chat` | Chat completions (LLM) |
| `dmrx_generate_image` | Image generation |
| `dmrx_generate_video` | Video generation |
| `dmrx_generate_music` | Music generation |
| `dmrx_embed` | Text embeddings |
| `dmrx_transcribe` | Audio transcription |
| `dmrx_speak` | Text-to-speech |
| `dmrx_tool_search` | Search for tools |
| `dmrx_tool_list` | List all tools |

## Configuration

Create `dmrx-mcp.config.json` in your working directory:

```json
{
  "transport": "sse",
  "port": 3100,
  "toolSearch": {
    "enableSemantic": true
  },
  "guardrails": {
    "enabled": true
  }
}
```

See [docs/CONFIGURATION-EXAMPLES.md](docs/CONFIGURATION-EXAMPLES.md) for more examples.

## Documentation

- [Advanced Features Guide](docs/ADVANCED-FEATURES.md) - Complete feature documentation
- [Tools Quick Reference](docs/TOOLS-QUICK-REFERENCE.md) - Tool parameters and examples
- [Configuration Examples](docs/CONFIGURATION-EXAMPLES.md) - Deployment scenarios

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DMRX_MCP_TRANSPORT` | Transport type (stdio/sse/http) | stdio |
| `DMRX_MCP_PORT` | Server port | 3100 |
| `DMRX_MCP_API_KEY` | API key for authentication | - |
| `OPENAI_API_KEY` | OpenAI API key | - |
| `ANTHROPIC_API_KEY` | Anthropic API key | - |

## License

Private - DMR-X Project