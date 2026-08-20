# DMR-X MCP Server — Advanced Features

This document covers the advanced features added to the DMR-X MCP Server in v0.5.0+, including intelligent tool discovery, security features, A2A protocol support, and federation capabilities.

## Table of Contents

- [Tool Search & Discovery](#tool-search--discovery)
- [RBAC Authorization](#rbac-authorization)
- [Guardrails](#guardrails)
- [Audit Logging](#audit-logging)
- [A2A Protocol](#a2a-protocol)
- [Federation](#federation)
- [Configuration Reference](#configuration-reference)
- [Examples](#examples)

---

## Tool Search & Discovery

The MCP Server includes an intelligent tool search engine that uses hybrid BM25 + semantic search to find the best tools for your task.

### Features

- **Hybrid Search**: Combines BM25 keyword matching with semantic embeddings for 94% accuracy (vs 14% with BM25 alone)
- **Natural Language Queries**: Find tools by describing what you want to do
- **Tool Ranking**: Results ranked by relevance score
- **External Tool Support**: Searches across all connected MCP servers

### MCP Tools

#### `dmrx_tool_search`

Search for tools using natural language queries.

**Parameters:**
```typescript
{
  query: string;           // Natural language search query
  max_results?: number;    // Maximum results (default: 10)
  modalities?: string[];   // Filter by modality
  include_external?: boolean; // Include external MCP tools (default: true)
}
```

**Example:**
```json
{
  "query": "generate an image from text",
  "max_results": 5
}
```

**Response:**
```json
{
  "query": "generate an image from text",
  "results": [
    {
      "name": "dmrx_generate_image",
      "description": "Generate images through DMR-X...",
      "score": 0.95,
      "source": "internal",
      "modality": "diffusion"
    }
  ],
  "total_count": 1
}
```

#### `dmrx_tool_list`

List all available tools in the system.

**Parameters:**
```typescript
{
  modalities?: string[];      // Filter by modality
  include_external?: boolean; // Include external tools (default: true)
  include_descriptions?: boolean; // Include descriptions (default: true)
}
```

**Response:**
```json
{
  "tools": [
    {
      "name": "dmrx_chat",
      "description": "Send a chat completion request...",
      "source": "internal"
    }
  ],
  "total_count": 25,
  "internal_count": 20,
  "external_count": 5
}
```

### Configuration

```json
{
  "toolSearch": {
    "bm25Weight": 0.4,
    "semanticWeight": 0.6,
    "rrfConstant": 60,
    "maxResults": 10,
    "minScore": 0.01,
    "enableBM25": true,
    "enableSemantic": true,
    "embeddingConfig": {
      "provider": "ollama",
      "ollamaUrl": "http://localhost:11434",
      "ollamaModel": "nomic-embed-text"
    }
  }
}
```

**Environment Variables:**
- `DMRX_TOOL_SEARCH_BM25_WEIGHT` - BM25 weight (0-1)
- `DMRX_TOOL_SEARCH_SEMANTIC_WEIGHT` - Semantic weight (0-1)
- `DMRX_TOOL_SEARCH_ENABLE_BM25` - Enable BM25 search
- `DMRX_TOOL_SEARCH_ENABLE_SEMANTIC` - Enable semantic search
- `DMRX_TOOL_SEARCH_EMBEDDING_PROVIDER` - Embedding provider (ollama/openai/remote)

---

## RBAC Authorization

Fine-grained role-based access control for tool execution.

### Features

- **Cedar-like Policy Language**: Intuitive policy syntax
- **Tool-level Permissions**: Control access per tool
- **Role-based Authorization**: Assign permissions to roles
- **Claim-based Authorization**: JWT claim support

### Policy Syntax

```
// Permit admin to access all tools
permit(
  principal == Role::"admin",
  action,
  resource
);

// Deny bash execution for non-admins
deny(
  principal != Role::"admin",
  action == Action::"dmrx_bash",
  resource
);

// Allow file operations for authenticated users
permit(
  principal.type == "user",
  action in [Action::"dmrx_read_file", Action::"dmrx_list_files"],
  resource
);
```

### Configuration

```json
{
  "rbac": {
    "enabled": true,
    "defaultEffect": "allow",
    "policiesPath": "./policies",
    "auditLogging": true
  }
}
```

**Environment Variables:**
- `DMRX_RBAC_ENABLED` - Enable RBAC
- `DMRX_RBAC_DEFAULT_EFFECT` - Default effect when no policy matches (allow/deny)
- `DMRX_RBAC_POLICIES_PATH` - Path to policy files
- `DMRX_RBAC_AUDIT_LOGGING` - Enable audit logging for RBAC decisions

---

## Guardrails

PII detection, content filtering, and response sanitization for compliance and security.

### Features

- **PII Detection**: Regex-based detection for SSN, email, phone, etc.
- **Content Filtering**: Block specific keywords or patterns
- **Response Sanitization**: Redact sensitive information
- **Custom Patterns**: Define your own redaction patterns

### Default PII Patterns

| Pattern | Severity | Example |
|---------|----------|---------|
| SSN | critical | 123-45-6789 |
| Email | medium | user@example.com |
| Phone | medium | (555) 123-4567 |
| Credit Card | critical | 4111-1111-1111-1111 |
| IP Address | low | 192.168.1.1 |

### Configuration

```json
{
  "guardrails": {
    "enabled": true,
    "piiRedaction": true,
    "contentFiltering": true,
    "blockedKeywords": ["password", "secret", "api_key"],
    "logDetections": true
  }
}
```

**Environment Variables:**
- `DMRX_GUARDRAILS_ENABLED` - Enable guardrails
- `DMRX_GUARDRAILS_PII_REDACTION` - Enable PII redaction
- `DMRX_GUARDRAILS_CONTENT_FILTERING` - Enable content filtering
- `DMRX_GUARDRAILS_BLOCKED_KEYWORDS` - Comma-separated blocked keywords

---

## Audit Logging

Tamper-evident logging for compliance (SOC 2, GDPR) and debugging.

### Features

- **Structured Events**: JSON-formatted audit events
- **Event Chaining**: Hash-based tamper evidence
- **Configurable Retention**: Set log retention periods
- **Compliance Export**: Export logs for compliance reporting

### Event Types

| Event Type | Description |
|------------|-------------|
| `tool.invocation` | Tool execution started |
| `tool.result` | Tool execution completed |
| `auth.login` | User login |
| `auth.logout` | User logout |
| `policy.allow` | RBAC policy allowed |
| `policy.deny` | RBAC policy denied |

### Configuration

```json
{
  "audit": {
    "enabled": true,
    "retentionDays": 90,
    "includeBodies": false
  }
}
```

**Environment Variables:**
- `DMRX_AUDIT_ENABLED` - Enable audit logging
- `DMRX_AUDIT_RETENTION_DAYS` - Log retention in days
- `DMRX_AUDIT_INCLUDE_BODIES` - Include request/response bodies

---

## A2A Protocol

Google's Agent-to-Agent (A2A) protocol for agent discovery and inter-agent communication.

### Features

- **Agent Card**: Capability advertisement for agent discovery
- **Task Management**: Create, track, and cancel agent-to-agent tasks
- **HTTP Endpoints**: Standard REST API for A2A communication

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/.well-known/agent-card.json` | GET | Agent Card discovery (v1.0 canonical path) |
| `/.well-known/agent.json` | GET | Legacy card path, still answered for pre-1.0 clients |
| `/a2a` | POST | **All** JSON-RPC methods go here (single endpoint) |

A2A is JSON-RPC 2.0 over a **single** endpoint — there are no per-method REST
paths. The method name goes in the request body, not the URL. The card's
`supportedInterfaces[0].url` already points at `/a2a`; clients should POST there
rather than constructing paths themselves.

Supported methods: `message/send`, `message/stream` (SSE), `tasks/get`,
`tasks/list`, `tasks/cancel`, `tasks/resubscribe`, `agent/getExtendedCard`,
`tasks/pushNotificationConfig/set`, `tasks/pushNotificationConfig/get`.

### Agent Card

The Agent Card advertises the agent's capabilities to other agents.

```json
{
  "name": "DMR-X Agent",
  "description": "DMR-X MCP Server with intelligent routing",
  "version": "0.5.0",
  "url": "http://localhost:47114",
  "capabilities": {
    "streaming": true,
    "pushNotifications": false,
    "stateTransitionHistory": false
  },
  "defaultInputModes": ["text"],
  "defaultOutputModes": ["text"],
  "skills": [
    {
      "id": "dmrx_chat",
      "name": "dmrx_chat",
      "description": "Send a chat completion request...",
      "inputModes": ["text"],
      "outputModes": ["text"],
      "tags": ["llm"]
    }
  ]
}
```

### Task Lifecycle

```
submitted → working → completed
    ↓           ↓
    ↓       input-required
    ↓           ↓
    ↓       working → completed
    ↓
canceled / failed / rejected
```

### Configuration

```json
{
  "a2a": {
    "enabled": true,
    "agentCard": {
      "name": "My DMR-X Agent",
      "description": "Custom agent description",
      "version": "0.5.0",
      "url": "http://localhost:47114"
    }
  }
}
```

**Environment Variables:**
- `DMRX_A2A_ENABLED` - Enable A2A protocol
- `DMRX_A2A_AGENT_NAME` - Agent name
- `DMRX_A2A_AGENT_DESCRIPTION` - Agent description
- `DMRX_A2A_AGENT_VERSION` - Agent version
- `DMRX_A2A_AGENT_URL` - Agent URL

---

## Federation

Multi-instance tool sharing across a network.

### Features

- **Instance Discovery**: mDNS, static config, or Consul
- **Tool Synchronization**: Share tools across instances
- **Health Monitoring**: Peer health checks and failover
- **Load Balancing**: Distribute requests across instances

### Discovery Methods

#### Static Discovery

Configure peers explicitly in the config file:

```json
{
  "federation": {
    "enabled": true,
    "discoveryMethod": "static",
    "peers": [
      {
        "id": "dmrx-1",
        "name": "DMR-X Production",
        "url": "http://192.168.1.100:3100"
      },
      {
        "id": "dmrx-2",
        "name": "DMR-X Backup",
        "url": "http://192.168.1.101:3100"
      }
    ]
  }
}
```

#### mDNS Discovery

Automatically discover peers on the local network:

```json
{
  "federation": {
    "enabled": true,
    "discoveryMethod": "mdns",
    "mdnsServiceName": "dmrx-mcp",
    "mdnsServiceType": "_mcp._tcp"
  }
}
```

### Configuration

```json
{
  "federation": {
    "enabled": true,
    "instanceId": "dmrx-production-1",
    "instanceName": "DMR-X Production",
    "discoveryMethod": "static",
    "peers": [],
    "syncInterval": 30,
    "heartbeatInterval": 10,
    "peerTimeout": 60,
    "enableToolProxy": true,
    "maxRemoteTools": 100
  }
}
```

**Environment Variables:**
- `DMRX_FEDERATION_ENABLED` - Enable federation
- `DMRX_FEDERATION_INSTANCE_ID` - Instance ID
- `DMRX_FEDERATION_INSTANCE_NAME` - Instance name
- `DMRX_FEDERATION_DISCOVERY_METHOD` - Discovery method (mdns/static/consul)
- `DMRX_FEDERATION_SYNC_INTERVAL` - Sync interval in seconds
- `DMRX_FEDERATION_HEARTBEAT_INTERVAL` - Heartbeat interval in seconds
- `DMRX_FEDERATION_ENABLE_TOOL_PROXY` - Enable remote tool proxying

---

## Configuration Reference

### Complete Config Example

```json
{
  "transport": "sse",
  "port": 3100,
  "host": "0.0.0.0",
  "apiKey": "your-secret-key",
  
  "router": {
    "epsilon": 0.05,
    "defaultQualityTarget": "balanced",
    "enableDecomposition": false
  },
  
  "toolSearch": {
    "bm25Weight": 0.4,
    "semanticWeight": 0.6,
    "enableBM25": true,
    "enableSemantic": true,
    "embeddingConfig": {
      "provider": "ollama",
      "ollamaUrl": "http://localhost:11434",
      "ollamaModel": "nomic-embed-text"
    }
  },
  
  "rbac": {
    "enabled": false,
    "defaultEffect": "allow"
  },
  
  "guardrails": {
    "enabled": false,
    "piiRedaction": true,
    "contentFiltering": true
  },
  
  "audit": {
    "enabled": false,
    "retentionDays": 90
  },
  
  "a2a": {
    "enabled": false,
    "agentCard": {
      "name": "DMR-X Agent",
      "description": "DMR-X MCP Server with intelligent routing",
      "version": "0.5.0",
      "url": "http://localhost:47114"
    }
  },
  
  "federation": {
    "enabled": false,
    "instanceId": "dmrx-1",
    "instanceName": "DMR-X Instance 1",
    "discoveryMethod": "static",
    "peers": [],
    "syncInterval": 30,
    "heartbeatInterval": 10
  },
  
  "rateLimit": {
    "dmrx_chat": "100/hour",
    "dmrx_batch": "10/minute"
  },
  
  "telemetry": {
    "enabled": true,
    "metricsPort": 9465,
    "otlpEndpoint": "http://localhost:4318/v1/traces"
  }
}
```

---

## Examples

### Example 1: Search for Image Generation Tools

```bash
# Using MCP client
{
  "tool": "dmrx_tool_search",
  "arguments": {
    "query": "create images from text prompts",
    "max_results": 5
  }
}
```

### Example 2: List All Audio Tools

```bash
{
  "tool": "dmrx_tool_list",
  "arguments": {
    "modalities": ["audio_tts", "audio_stt"]
  }
}
```

### Example 3: Discover Agent via A2A

```bash
# Get Agent Card
curl http://localhost:47114/.well-known/agent-card.json

# Send a task — JSON-RPC 2.0 at the single /a2a endpoint.
# Note: parts use "kind" (not "type"), and messageId is REQUIRED.
curl -X POST http://localhost:47114/a2a \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "message/send",
    "params": {
      "message": {
        "messageId": "msg-1",
        "role": "user",
        "parts": [
          {
            "kind": "text",
            "text": "Generate an image of a sunset"
          }
        ]
      }
    }
  }'
```

### Example 4: Check Federation Status

```bash
# Health check shows federation status
curl http://localhost:47114/health

# Response
{
  "status": "ok",
  "transport": "sse",
  "sessions": 0,
  "federation": {
    "instanceId": "dmrx-1",
    "peerCount": 2,
    "healthyPeerCount": 2,
    "remoteToolCount": 15
  }
}
```

---

## Troubleshooting

### Tool Search Not Finding Tools

1. Ensure embeddings are configured correctly
2. Check Ollama is running (if using local embeddings)
3. Verify tools are registered (use `dmrx_tool_list`)

### RBAC Blocking Legitimate Requests

1. Check policy syntax
2. Verify principal is correctly set
3. Review audit logs for denied requests

### Federation Peers Not Discovering

1. Verify network connectivity
2. Check firewall rules
3. Ensure consistent `instanceId` across restarts

---

## Migration Guide

### From v0.4.x to v0.5.0

1. **New Dependencies**: Add `@dmr-x/tool-search` and `@dmr-x/policy` to your dependencies
2. **Config Updates**: Add new config sections for tool search, RBAC, guardrails, audit, A2A, and federation
3. **Environment Variables**: Add new environment variables as needed

### Breaking Changes

- None in v0.5.0 — all new features are opt-in