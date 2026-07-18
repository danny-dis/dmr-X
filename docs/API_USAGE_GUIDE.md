# DMR-X API Usage Guide

DMR-X is a universal AI gateway that accepts requests in three native wire formats — **OpenAI**, **Anthropic**, and **Google Gemini** — and routes them to the best available provider. This guide covers how to create API keys, use the provider formats, the agent platform, MCP proxy, Godmode, admin API, quotas/policies, and troubleshooting.

## Table of Contents

- [How It Works](#how-it-works)
- [Creating a DMR-X API Key](#creating-a-dmr-x-api-key)
  - [Via the Admin UI](#via-the-admin-ui)
  - [Via the Admin API](#via-the-admin-api)
  - [List Existing Keys](#list-existing-keys)
- [API Formats](#api-formats)
  - [OpenAI-Compatible Endpoint](#openai-compatible-endpoint)
  - [Anthropic-Compatible Endpoint](#anthropic-compatible-endpoint)
  - [Gemini-Compatible Endpoint](#gemini-compatible-endpoint)
- [Meta-Models (Dynamic Routing & Free-Tier Strategy)](#meta-models-dynamic-routing--free-tier-strategy)
- [Free-Tier Routing Strategy](#free-tier-routing-strategy)
- [Using DMR-X as a Custom Provider](#using-dmr-x-as-a-custom-provider)
  - [Claude Code (Anthropic SDK)](#claude-code-anthropic-sdk)
  - [Claude Code (OpenAI SDK)](#claude-code-openai-sdk)
  - [Cursor](#cursor)
  - [Continue (VS Code / JetBrains)](#continue-vs-code--jetbrains)
  - [OpenAI SDK (Python)](#openai-sdk-python)
  - [OpenAI SDK (Node.js)](#openai-sdk-nodejs)
  - [Anthropic SDK (Python)](#anthropic-sdk-python)
  - [Anthropic SDK (Node.js)](#anthropic-sdk-nodejs)
  - [Google Generative AI SDK](#google-generative-ai-sdk)
  - [curl Examples](#curl-examples)
  - [Codex Integration](#codex-integration)
  - [Antigravity Integration](#antigravity-integration)
- [Streaming](#streaming)
- [Tool / Function Calling](#tool--function-calling)
- [Vision (Image Inputs)](#vision-image-inputs)
- [Agent Platform API (`/v1/agents`)](#agent-platform-api-v1agents)
  - [Agent Definitions](#agent-definitions)
  - [Agent Instances & Deployment](#agent-instances--deployment)
  - [Agent Chat (`/agents/:instanceId/chat`)](#agent-chat-agentsinstanceidchat)
  - [Resume / Cancel Conversations](#resume--cancel-conversations)
  - [Executions, Evaluations & Stats](#executions-evaluations--stats)
  - [Marketplace & Import](#marketplace--import)
  - [Dispatch Intent-Based Tasks (`/agentic/dispatch`)](#dispatch-intent-based-tasks-agenticdispatch)
- [MCP Proxy (`/admin/mcp/*`)](#mcp-proxy-adminmcp)
  - [Transports (stdio / SSE / Streamable HTTP)](#transports-stdio--sse--streamable-http)
  - [Auth for MCP Calls](#auth-for-mcp-calls)
  - [Available MCP Tools (dmrx_*)](#available-mcp-tools-dmrx_)
- [Godmode (`model: "auto-free"` & `/v1internal:*`)](#godmode-model-auto-free--v1internal)
  - [Native Meta-Model: `auto-free`](#native-meta-model-auto-free)
  - [Cloud Code / Antigravity Endpoints](#cloud-code--antigravity-endpoints)
- [Admin API (`/v1/admin/*`)](#admin-api-v1admin)
  - [Auth for Admin Routes](#auth-for-admin-routes)
  - [Admin Endpoint Reference](#admin-endpoint-reference)
  - [OAuth Provider Setup](#oauth-provider-setup)
- [Quotas, Rate Limits & Policies](#quotas-rate-limits--policies)
  - [Rate Limits](#rate-limits)
  - [Quotas](#quotas)
  - [Routing Policies (`/admin/policies`)](#routing-policies-adminpolicies)
  - [Cost Filtering](#cost-filtering)
  - [Compression](#compression)
- [Health & Observability](#health--observability)
- [Troubleshooting](#troubleshooting)

---

## How It Works

```
Your Client (any format)
        |
        v
  +-----------+
  | DMR-X     |   Accepts OpenAI, Anthropic, or Gemini wire format
  | Gateway    |   Converts to unified internal representation
  | :3000     |   Routes to best provider based on cost/latency/quality
  +-----------+
        |
        v
  OpenAI / Anthropic / Google / Ollama / Cohere / Replicate / ...
```

You send requests in **your preferred format**. DMR-X converts, routes, executes, and returns the response **in the same format you sent**. This means:

- An Anthropic-formatted request can be served by an OpenAI provider
- A Gemini-formatted request can be served by an Anthropic provider
- No SDK changes required on your side

---

## Creating a DMR-X API Key

### Via the Admin UI

1. Open the DMR-X dashboard (default: `http://localhost:4200`)
2. Go to **Tenants** page
3. Select or create a tenant
4. Click **Generate API Key**
5. Copy the key — it is shown only once

### Via the Admin API

```bash
# Create an API key for a tenant
curl -X POST http://localhost:3000/v1/admin/api-keys \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_ADMIN_API_KEY" \
  -d '{
    "tenant_id": "your-tenant-id",
    "name": "my-app-key"
  }'

# Response:
# {
#   "id": "...",
#   "tenant_id": "...",
#   "name": "my-app-key",
#   "key": "dmrx_abc123...",   <-- SAVE THIS, shown only once
#   "created_at": "..."
# }
```

You can also create tenant-scoped keys with optional compression settings, allowed tools, expiry, etc.

### List Existing Keys

```bash
curl http://localhost:3000/v1/admin/api-keys \
  -H "x-api-key: YOUR_ADMIN_API_KEY"
```

> **Note:** The raw API key is only returned at creation time. The stored hash cannot be reversed. If you lose a key, create a new one and delete the old one.

---

## API Formats

### OpenAI-Compatible Endpoint

**Endpoint:** `POST /v1/chat/completions`

This is the standard OpenAI chat completions format used by most AI tools and SDKs.

```json
{
  "model": "auto-coding",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Hello!" }
  ],
  "temperature": 0.7,
  "max_tokens": 1024,
  "stream": false
}
```

Use a meta-model alias (`auto`, `auto-fast`, `auto-smart`, `auto-agentic`, `auto-coding`, `auto-free`) or a specific model name (`gpt-4o`, `claude-sonnet-4-0520`, `gemini-2.5-pro`, etc.).

**Auth:** `Authorization: Bearer dmrx_...`

**Response:** Standard OpenAI chat completion response with `id`, `object`, `choices`, `usage`.

**Custom request metadata (F-1):** you can pass a top-level `metadata` object on OpenAI-format requests; DMR-X forwards known keys (e.g. `strictProvider`, `fallback`) to the routing layer.

### Anthropic-Compatible Endpoint

**Endpoint:** `POST /v1/messages`

This is the Anthropic Messages API format used by Claude SDKs.

```json
{
  "model": "auto-smart",
  "max_tokens": 1024,
  "system": "You are a helpful assistant.",
  "messages": [
    { "role": "user", "content": "Hello!" }
  ],
  "stream": false
}
```

**Auth:** `x-api-key: dmrx_...`

**Response:** Standard Anthropic messages response with `id`, `type`, `content`, `usage`.

### Gemini-Compatible Endpoint

**Endpoint:** `POST /v1/gemini/generateContent`

This is the Google Gemini generateContent format.

```json
{
  "contents": [
    { "role": "user", "parts": [{ "text": "Hello!" }] }
  ],
  "systemInstruction": {
    "parts": [{ "text": "You are a helpful assistant." }]
  },
  "generationConfig": {
    "temperature": 0.7,
    "maxOutputTokens": 1024
  },
  "stream": false
}
```

> **Note:** Do **not** nest a `model` field inside `generationConfig` — the Zod schema rejects it. Model selection happens via the meta-model path (`model` is a top-level field in the **UnifiedRequest** envelope, not in the Gemini wire format) or via the `x-free-tier-strategy` request header. To target a specific model, send it as a separate field on the converted request, or use a meta-model alias from the [Meta-Models](#meta-models-dynamic-routing) section below.

**Auth:** `x-api-key: dmrx_...`

**Response:** Standard Gemini response with `candidates`, `usageMetadata`.

---

## Meta-Models (Dynamic Routing & Free-Tier Strategy)

Instead of picking a specific model, you can use **meta-model aliases**. DMR-X dynamically selects the best available provider at request time based on cost, latency, and quality — no hard-coded model names.

| Alias | What It Picks |
|-------|---------------|
| `auto` | Best model overall (paid + free, pipeline scoring decides) |
| `auto-fast` | Fastest model (lowest latency, paid + free) |
| `auto-smart` | Most capable model (highest quality, paid + free) |
| `auto-agentic` | Best model for tool use (64K+ context, quality+speed scoring, paid + free) |
| `auto-coding` | Best model for code (specialization match + quality + context + speed, paid + free) |
| `auto-free` | Best free model wrapped through G0DM0D3 godmode persona layer |

Use these exactly like a model name — the router resolves them to an actual provider/model at request time.

```bash
# Instead of picking "gpt-4o" or "claude-sonnet-4-0520":
export ANTHROPIC_BASE_URL=http://localhost:3000/v1
export ANTHROPIC_API_KEY=dmrx_your_api_key_here
claude --model auto-coding
```

---

## Free-Tier Routing Strategy

Free-tier behavior is controlled by two mechanisms that work together:

1. **`x-free-tier-strategy` request header** — per-request override. Accepted values are defined per routing mode; common modes include `free_first`, `free_only`, `balanced`, `paid_only`. The gateway echoes the chosen strategy back in the response header `X-Free-Tier-Strategy` for observability.

2. **`x-cost-filter` request header** — restrict the candidate pool:
   - `x-cost-filter: free` — `auto*` aliases resolve to zero-cost providers only.
   - `x-cost-filter: all` (default) — include all providers.

3. **Global defaults via environment variables:**
   - `DMRX_FREE_TIER_STRATEGY` — default free-tier routing mode.
   - `DMRX_META_MODEL_COST_FILTER` — global default cost filter (`free` or `all`).

4. **Provider key tier labels** — each provider key is tagged `free` or `paid` at creation. The router respects these labels when scoring candidates.

---

## Using DMR-X as a Custom Provider

### Claude Code (Anthropic SDK)

Set these environment variables before running Claude Code:

```bash
export ANTHROPIC_BASE_URL=http://localhost:3000/v1
export ANTHROPIC_API_KEY=dmrx_your_api_key_here
```

Then use a meta-model alias as the model:

```bash
claude --model auto-coding          # best free model for code
claude --model auto-smart           # most capable free model
claude --model auto-fast            # fastest free model
claude --model auto-agentic         # best free model for tool use
claude --model auto                 # any free model
```

Or use a specific model name if you prefer:

```bash
claude --model claude-sonnet-4-0520
claude --model gpt-4o
claude --model gemini-2.5-pro
```

Claude Code sends Anthropic-formatted requests to `/v1/messages`. DMR-X routes to whichever provider owns the model — the response comes back in Anthropic format regardless.

### Claude Code (OpenAI SDK)

If your Claude Code setup uses the OpenAI-compatible path:

```bash
export OPENAI_BASE_URL=http://localhost:3000/v1
export OPENAI_API_KEY=dmrx_your_api_key_here
```

### Cursor

1. Open **Cursor Settings** > **Models**
2. Click **+ Add Model** (or configure OpenAI API Key)
3. Set **API Base URL** to: `http://localhost:3000/v1`
4. Set **API Key** to: `dmrx_your_api_key_here`
5. Enter a meta-model alias as the model name: `auto-coding`, `auto-fast`, `auto-smart`, `auto-agentic`, `auto`, or `auto-free`

For Anthropic models in Cursor, use the Anthropic API key settings with the same base URL pattern.

### Continue (VS Code / JetBrains)

In your `~/.continue/config.json`:

```json
{
  "models": [
    {
      "title": "DMR-X Auto Coding",
      "provider": "openai",
      "model": "auto-coding",
      "apiBase": "http://localhost:3000/v1",
      "apiKey": "dmrx_your_api_key_here"
    },
    {
      "title": "DMR-X Auto Smart",
      "provider": "anthropic",
      "model": "auto-smart",
      "apiBase": "http://localhost:3000/v1",
      "apiKey": "dmrx_your_api_key_here"
    },
    {
      "title": "DMR-X Auto Agentic",
      "provider": "openai",
      "model": "auto-agentic",
      "apiBase": "http://localhost:3000/v1",
      "apiKey": "dmrx_your_api_key_here"
    },
    {
      "title": "DMR-X Auto Free (Godmode)",
      "provider": "openai",
      "model": "auto-free",
      "apiBase": "http://localhost:3000/v1",
      "apiKey": "dmrx_your_api_key_here"
    }
  ]
}
```

### OpenAI SDK (Python)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="dmrx_your_api_key_here",
)

response = client.chat.completions.create(
    model="auto-coding",  # dynamically picks best free coding model
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Explain quantum computing in one paragraph."},
    ],
    temperature=0.7,
    max_tokens=500,
)

print(response.choices[0].message.content)
```

### OpenAI SDK (Node.js)

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:3000/v1",
  apiKey: "dmrx_...",
});

const response = await client.chat.completions.create({
  model: "auto-coding",  // dynamically picks best free coding model
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Explain quantum computing in one paragraph." },
  ],
  temperature: 0.7,
  max_tokens: 500,
});

console.log(response.choices[0].message.content);
```

### Anthropic SDK (Python)

```python
import anthropic

client = anthropic.Anthropic(
    base_url="http://localhost:3000/v1",
    api_key="dmrx_your_api_key_here",
)

response = client.messages.create(
    model="auto-smart",  # dynamically picks most capable free model
    max_tokens=500,
    system="You are a helpful assistant.",
    messages=[
        {"role": "user", "content": "Explain quantum computing in one paragraph."},
    ],
)

print(response.content[0].text)
```

### Anthropic SDK (Node.js)

```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  baseURL: "http://localhost:3000/v1",
  apiKey: "dmrx_...",
});

const response = await client.messages.create({
  model: "auto-smart",  # dynamically picks most capable free model
  max_tokens: 500,
  system: "You are a helpful assistant.",
  messages: [
    { role: "user", content: "Explain quantum computing in one paragraph." },
  ],
});

console.log(response.content[0].text);
```

### Google Generative AI SDK

```typescript
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI("dmrx_your_api_key_here");

const model = genAI.getGenerativeModel({
  model: "auto-fast",  // dynamically picks fastest free model
}, {
  baseUrl: "http://localhost:3000/v1",
});

const result = await model.generateContent("Explain quantum computing in one paragraph.");
console.log(result.response.text());
```

### curl Examples

**OpenAI format (meta-model):**

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dmrx_your_api_key_here" \
  -d '{
    "model": "auto-coding",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": false
  }'
```

**Anthropic format (meta-model):**

```bash
curl http://localhost:3000/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: dmrx_your_api_key_here" \
  -d '{
    "model": "auto-smart",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": false
  }'
```

**Gemini format (meta-model):**

```bash
curl http://localhost:3000/v1/gemini/generateContent \
  -H "Content-Type: application/json" \
  -H "x-api-key: dmrx_your_api_key_here" \
  -d '{
    "contents": [{"role": "user", "parts": [{"text": "Hello!"}]}],
    "generationConfig": {
      "model": "auto-fast"
    },
    "stream": false
  }'
```

### Codex Integration

DMR-X supports [OpenAI Codex CLI](https://github.com/openai/codex) out of the box via the existing OpenAI-compatible `/v1/chat/completions` endpoint.

#### Quick Setup

```bash
# Method A: Codex config.toml (recommended)
cat >> ~/.codex/config.toml << 'EOF'
model = "auto-coding"
model_provider = "dmrx"

[model_providers.dmrx]
name = "DMR-X Gateway"
base_url = "http://localhost:3000/v1"
env_key = "DMRX_API_KEY"
wire_api = "chat"
requires_openai_auth = false
EOF

# Method B: Environment variables
export OPENAI_BASE_URL=http://localhost:3000/v1
export OPENAI_API_KEY=dmrx_your_api_key_here

# Method C: Using the CLI
dmrx setup --codex
```

#### CLI Setup

```bash
# Auto-configure all supported agents
dmrx setup --codex --claude --opencode --cursor

# Remove DMR-X configuration from an agent
dmrx off --codex
```

Codex uses the `auto-coding` meta-model alias which routes to the best available model for code generation tasks.

### Antigravity Integration

DMR-X supports [Google Antigravity (agy)](https://cloud.google.com/code) via custom Cloud Code protocol endpoints.

#### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `POST /v1/internal:streamGenerateContent` | POST | Streaming generation (main endpoint) |
| `POST /v1/internal:generateContent` | POST | Non-streaming generation |
| `POST /v1/internal:loadCodeAssist` | POST | Project/credits initialization |
| `POST /v1/internal:fetchAvailableModels` | POST | List available models |

#### Quick Setup

```bash
# Using the CLI
dmrx setup --antigravity

# Or configure agy to point at your DMR-X gateway
export AGY_BASE_URL=http://localhost:3000
export AGY_API_KEY=dmrx_your_api_key_here
```

#### Protocol Format

Antigravity uses a Cloud Code wire format with an envelope around the standard Gemini request:

```json
{
  "project": "your-project",
  "model": "antigravity/gemini-2.5-flash",
  "request": {
    "contents": [
      { "role": "user", "parts": [{ "text": "Hello" }] }
    ],
    "systemInstruction": {
      "role": "user",
      "parts": [{ "text": "You are a helpful assistant." }]
    },
    "tools": [{ "functionDeclarations": [...] }],
    "generationConfig": { "maxOutputTokens": 8192, "temperature": 0.7 }
  },
  "requestType": "agent",
  "userAgent": "antigravity",
  "requestId": "agent-1719000000000-abc123"
}
```

The gateway converts this to a UnifiedRequest, routes it through the pipeline, and returns responses in Cloud Code SSE format.

---

## Streaming

All three formats support streaming. Set `"stream": true` in the request body.

| Format | Streaming Behavior |
|--------|-------------------|
| OpenAI | Server-Sent Events, ends with `data: [DONE]` |
| Anthropic | Server-Sent Events with `event:` types (`message_start`, `content_block_delta`, `message_stop`) |
| Gemini | Server-Sent Events with `data:` lines containing `GeminiGenerateContentResponse` chunks |
| Agentic (`/agentic/chat`) | SSE with `turn`, `tool_calls`, `tool_results`, `approval_required`, `error`, `done` events |
| Agent Instance (`/agents/:instanceId/chat`) | SSE with turn, tool call, and done events |

**Python streaming example (OpenAI format):**

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:3000/v1", api_key="dmrx_your_api_key_here")

stream = client.chat.completions.create(
    model="auto-coding",  # dynamically picks best free coding model
    messages=[{"role": "user", "content": "Write a haiku about code."}],
    stream=True,
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
print()
```

---

## Tool / Function Calling

All three formats support tool/function calling. DMR-X converts between formats automatically.

**OpenAI format (meta-model):**

```json
{
  "model": "auto-agentic",
  "messages": [{"role": "user", "content": "What's the weather in London?"}],
  "tools": [{
    "type": "function",
    "function": {
      "name": "get_weather",
      "description": "Get current weather for a city",
      "parameters": {
        "type": "object",
        "properties": {
          "city": { "type": "string", "description": "City name" }
        },
        "required": ["city"]
      }
    }
  }]
}
```

**Anthropic format (meta-model):**

```json
{
  "model": "auto-agentic",
  "max_tokens": 1024,
  "messages": [{"role": "user", "content": "What's the weather in London?"}],
  "tools": [{
    "name": "get_weather",
    "description": "Get current weather for a city",
    "input_schema": {
      "type": "object",
      "properties": {
        "city": { "type": "string", "description": "City name" }
      },
      "required": ["city"]
    }
  }]
}
```

**Gemini format (meta-model):**

```json
{
  "contents": [{"role": "user", "parts": [{"text": "What's the weather in London?"}]}],
  "generationConfig": {
    "model": "auto-agentic"
  },
  "tools": [{
    "functionDeclarations": [{
      "name": "get_weather",
      "description": "Get current weather for a city",
      "parameters": {
        "type": "object",
        "properties": {
          "city": { "type": "string", "description": "City name" }
        },
        "required": ["city"]
      }
    }]
  }]
}
```

---

## Vision (Image Inputs)

All three formats support image inputs.

**OpenAI format (meta-model):**

```json
{
  "model": "auto-smart",
  "messages": [{
    "role": "user",
    "content": [
      { "type": "text", "text": "What's in this image?" },
      { "type": "image_url", "image_url": { "url": "data:image/png;base64,iVBOR..." } }
    ]
  }]
}
```

**Anthropic format (meta-model):**

```json
{
  "model": "auto-smart",
  "max_tokens": 1024,
  "messages": [{
    "role": "user",
    "content": [
      { "type": "text", "text": "What's in this image?" },
      { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "iVBOR..." } }
    ]
  }]
}
```

**Gemini format (meta-model):**

```json
{
  "contents": [{
    "role": "user",
    "parts": [
      { "text": "What's in this image?" },
      { "inlineData": { "mimeType": "image/png", "data": "iVBOR..." } }
    ]
  }],
  "generationConfig": {"model": "auto-smart"}
}
```

---

## Agent Platform API (`/v1/agents`)

The agent platform lets you create reusable **agent definitions**, deploy **instances**, chat with them via durable multi-turn sessions, and publish them to a marketplace.

**Auth:** `Authorization: Bearer dmrx_...`

### Agent Definitions

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/agents` | Create a new agent definition |
| `GET` | `/v1/agents` | List agent definitions for the current tenant |
| `GET` | `/v1/agents/:id` | Get a specific agent definition |
| `PUT` | `/v1/agents/:id` | Update an agent definition |
| `DELETE` | `/v1/agents/:id` | Delete an agent definition |
| `POST` | `/v1/agents/:id/deploy` | Deploy a new instance from a definition |
| `GET` | `/v1/agents/:id/instances` | List instances for a definition |

**Create an agent definition:**

```bash
curl -X POST http://localhost:3000/v1/agents \
  -H "Authorization: Bearer dmrx_your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "code-reviewer",
    "description": "Reviews PRs for bugs and style issues",
    "model": "auto-coding",
    "system_prompt": "You are a senior code reviewer.",
    "allowed_tools": ["read_file", "search_files", "bash"],
    "triggers": [{"type": "schedule", "cron": "0 9 * * 1-5"}]
  }'
```

**Deploy an instance:**

```bash
curl -X POST http://localhost:3000/v1/agents/:definitionId/deploy \
  -H "Authorization: Bearer dmrx_your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "code-reviewer-prod"
  }'
```

### Agent Instances & Deployment

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/agents/:id/deploy` | Deploy a definition as a runnable instance |
| `GET` | `/v1/agents/:id/instances` | List instances of a definition |
| `DELETE` | `/v1/instances/:id` | Delete an instance |

### Agent Chat (`/agents/:instanceId/chat`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/agents/:instanceId/chat` | Send a message to a deployed agent instance |
| `POST` | `/v1/agents/:instanceId/chat/:conversationId/resume` | Resume a paused conversation with approval decisions |
| `GET` | `/v1/agents/:instanceId/sessions` | List conversation sessions for an instance |
| `DELETE` | `/v1/agents/:instanceId/chat/:conversationId` | Cancel/delete a conversation |
| `POST` | `/v1/agents/:instanceId/chat/:conversationId/cancel` | Abort a running conversation |
| `GET` | `/v1/agents/:instanceId/stats` | Instance-level stats (tokens, runs, errors) |

**Send a chat message to an agent instance:**

```bash
curl -X POST http://localhost:3000/v1/agents/:instanceId/chat \
  -H "Authorization: Bearer dmrx_your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Review the last PR for issues."}],
    "stream": false,
    "maxSteps": 10
  }'
```

The response includes `conversationId`, `all_steps`, and optional `budget` info. Use `conversationId` for multi-turn continuations.

### Resume / Cancel Conversations

**Resume a paused conversation** (e.g. after approval gate):

```bash
curl -X POST http://localhost:3000/v1/agents/:instanceId/chat/:conversationId/resume \
  -H "Authorization: Bearer dmrx_your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "approvalDecisions": [
      {"tool_call_id": "call_123", "approved": true}
    ]
  }'
```

**Cancel a running conversation:**

```bash
curl -X POST http://localhost:3000/v1/agents/:instanceId/chat/:conversationId/cancel \
  -H "Authorization: Bearer dmrx_your_api_key_here"
```

### Executions, Evaluations & Stats

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/instances/:id/executions` | List recent executions for an instance |
| `GET` | `/v1/instances/:id/stats` | Aggregate stats for an instance |
| `GET` | `/v1/instances/:id/evaluations` | List evaluations for an instance |
| `GET` | `/v1/evaluations/:id` | Get a single evaluation |
| `DELETE` | `/v1/evaluations/:id` | Delete an evaluation |

### Marketplace & Import

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/marketplace` | Browse published agent listings |
| `GET` | `/v1/marketplace/:id` | Get a specific listing |
| `POST` | `/v1/marketplace/:id/install` | Install an agent from the marketplace |
| `POST` | `/v1/marketplace/:id/rate` | Rate an installed listing |
| `POST` | `/v1/agents/:id/publish` | Publish an agent to the marketplace |
| `POST` | `/v1/agents/import` | Import agents from GitHub URL, ZIP upload, or pasted `.md` text |

**Import from GitHub:**

```bash
curl -X POST http://localhost:3000/v1/agents/import \
  -H "Authorization: Bearer dmrx_your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "github",
    "githubUrl": "https://github.com/org/agent-repo",
    "modelTier": "auto"
  }'
```

**Import from ZIP (multipart):**

```bash
curl -X POST "http://localhost:3000/v1/agents/import?modelTier=auto" \
  -H "Authorization: Bearer dmrx_your_api_key_here" \
  -F "file=@agents.zip"
```

### Dispatch Intent-Based Tasks (`/agentic/dispatch`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/agentic/dispatch` | Score and optionally run the best matching subagent by intent |

This is a meta-agent dispatcher: you give it a task (and optional category/tags), and DMR-X scores all active subagent instances for your tenant, picks the best match, and either returns the match info or forwards the task in one shot.

```bash
# Match only
curl -X POST http://localhost:3000/v1/agentic/dispatch \
  -H "Authorization: Bearer dmrx_your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "task": "Summarize the quarterly report",
    "category": "data",
    "tags": ["finance"],
    "run": false
  }'

# One-shot run
curl -X POST http://localhost:3000/v1/agentic/dispatch \
  -H "Authorization: Bearer dmrx_your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "task": "Summarize the quarterly report",
    "run": true,
    "maxTokens": 1024
  }'
```

Response includes `instanceId`, `name`, `category`, `tags`, `confidence`, `content`, and `usage`.

---

## MCP Proxy (`/admin/mcp/*`)

DMR-X includes a built-in MCP server that exposes DMR-X routing, agent, and tool capabilities as MCP tools. It can also proxy external MCP servers.

### Transports (stdio / SSE / Streamable HTTP)

The MCP server is transport-agnostic. Configure via `dmrx-mcp.config.json` or environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DMRX_MCP_TRANSPORT` | `stdio` | Transport mode: `stdio`, `sse`, or `streamable_http` |
| `DMRX_MCP_HOST` | `127.0.0.1` | Bind host (SSE/HTTP) |
| `DMRX_MCP_PORT` | — | Bind port (SSE/HTTP) |

- **stdio** (default): MCP server runs as a per-client child process; no daemon to probe. Best for desktop/CLI integrations.
- **SSE**: Persistent server-side event stream; suitable for web clients and long-lived connections.
- **Streamable HTTP**: Modern HTTP-based MCP transport; single endpoint for messages and notifications.

The gateway does **not** import or manage the MCP server process directly. For stdio, the gateway spawns it per client. For SSE/HTTP, it probes its `/health` endpoint for liveness.

### Auth for MCP Calls

- Per-request API key resolution: the MCP server resolves a DMR-X API key from the inbound request headers, using a per-request isolation strategy (client tenant header → fallback shared key).
- The MCP server can proxy outbound calls to the DMR-X gateway using `Authorization: Bearer <key>` on outbound HTTP calls.
- RBAC authorization is enforced for scoped tool access; input validation guards against injection.

### Available MCP Tools (dmrx_*)

| Tool | Description |
|------|-------------|
| `dmrx_chat` | Run a chat completion through DMR-X routing |
| `dmrx_chat_stream` | Streaming chat completion |
| `dmrx_generate_image` | Generate images (Pollinations/Replicate/Stability/Fal) |
| `dmrx_generate_video` | Generate videos (Veo/Runway) |
| `dmrx_generate_music` | Generate audio/music |
| `dmrx_embed` | Create embeddings |
| `dmrx_transcribe` | Speech-to-text |
| `dmrx_speak` | Text-to-speech |
| `dmrx_rerank` | Rerank documents |
| `dmrx_models` | List routed/available models |
| `dmrx_status` | Get DMR-X / gateway status |
| `dmrx_batch` | Run batch completions |
| `dmrx_context_save` | Save conversation context |
| `dmrx_context_load` | Load conversation context |
| `dmrx_context_list` | List saved contexts |
| `dmrx_context_summarize` | Summarize a context |
| `dmrx_context_compress` | Compress a context |
| `dmrx_workflow` | Run a multi-step workflow |
| `dmrx_tool_search` | Search available tools |
| `dmrx_tool_list` | List available tools |
| `dmrx_template_list / _get / _create / _update / _delete / _execute` | Tool templates CRUD |
| `dmrx_preset_list / _get / _create / _update / _delete` | Presets CRUD |
| `read_file` / `write_file` / `edit_file` / `list_files` | File system tools |
| `bash` | Execute shell commands (sandboxed) |
| `search_files` | Search files by content |

External MCP servers can be connected via `MCPClient.connect({ servers })`; their tools are re-exposed as `<serverId>__<toolName>` via the same MCP tool list.

---

## Godmode (`model: "auto-free"` & `/v1internal:*`)

Godmode is powered by the [G0DM0D3](https://github.com/elder-plinius/G0DM0D3) server integration, managed by DMR-X's server manager.

### Native Meta-Model: `auto-free`

Send requests with `model: "auto-free"` to `/v1/chat/completions`. DMR-X will:

1. Resolve the best free-tier model via `resolveMetaModel('auto-free', ...)`.
2. If godmode is initialized, proxy the request through the godmode service for persona wrapping and parameter optimization (AutoTune, Parseltongue, STM modules).
3. Relay inference back through DMR-X's own provider vault when an `llmBaseUrl` is configured, so no OpenRouter key is required.
4. Fall back to normal `auto-free` routing if godmode is not initialized.

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dmrx_your_api_key_here" \
  -d '{
    "model": "auto-free",
    "messages": [{"role": "user", "content": "Explain quantum computing."}],
    "stream": false
  }'
```

**Godmode-specific request fields** (forwarded when supported by the backend):

| Field | Type | Description |
|-------|------|-------------|
| `godmode` | `boolean` | Enable GODMODE system prompt injection |
| `custom_system_prompt` | `string` | Custom system prompt replacing GODMODE |
| `autotune` | `boolean` | Enable AutoTune parameter optimization |
| `autotune_strategy` | `string` | One of `adaptive`, `precise`, `balanced`, `creative`, `chaotic` |
| `parseltongue` | `boolean` | Enable trigger-word obfuscation |
| `parseltongue_technique` | `string` | One of `leetspeak`, `unicode`, `zwj`, `mixedcase`, `phonetic`, `random` |
| `parseltongue_intensity` | `string` | One of `light`, `medium`, `heavy` |
| `stm_modules` | `string[]` | STM modules to apply (e.g. `hedge_reducer`, `direct_mode`, `curiosity_bias`, `casual_mode`) |
| `contribute_to_dataset` | `boolean` | Opt in to open dataset collection |

**Godmode response fields** (returned in `x_g0dm0d3` wrapper):

| Field | Description |
|-------|-------------|
| `x_g0dm0d3.params_used` | Resolved parameter values |
| `x_g0dm0d3.pipeline.godmode` | Whether godmode injection was active |
| `x_g0dm0d3.pipeline.autotune` | Detected context and chosen strategy |
| `x_g0dm0d3.pipeline.parseltongue` | Triggers found and technique used |
| `x_g0dm0d3.pipeline.stm` | Modules applied |

### Cloud Code / Antigravity Endpoints

These are the same Cloud Code endpoints mentioned in the Antigravity section above, now exposed as DMR-X gateway endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `POST /v1/internal:streamGenerateContent` | POST | Streaming generation (main) |
| `POST /v1/internal:generateContent` | POST | Non-streaming generation |
| `POST /v1/internal:loadCodeAssist` | POST | Project/credits initialization |
| `POST /v1/internal:fetchAvailableModels` | POST | List available models |

---

## Admin API (`/v1/admin/*`)

The admin API is the control plane for DMR-X: providers, models, tenants, organizations, policies, quotas, billing, workers, federation, memory, sandbox, MCP config, and more.

**Auth:** All admin routes require `x-api-key: YOUR_ADMIN_API_KEY` or a valid bearer token. Local mode (`DMRX_LOCAL_MODE=true`) disables auth for development only.

**Deployment modes:**
- `selfhosted` (default): mounts all admin routes + UI.
- `managed`: skips admin routes for SaaS deployments with a separate control plane.

Set via `DMRX_DEPLOYMENT_MODE`.

### Admin Endpoint Reference

#### Providers

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/admin/catalog` | List the provider catalog (all supported provider templates) |
| `POST` | `/v1/admin/providers/activate` | Activate a provider from the catalog template |
| `POST` | `/v1/admin/providers/test` | Test provider connectivity with a given key |
| `GET` | `/v1/admin/providers` | List all configured providers |
| `GET` | `/v1/admin/providers/:id` | Get a single provider |
| `PUT` | `/v1/admin/providers/:id/api-key` | Update the provider's API key |
| `GET` | `/v1/admin/providers/:id/keys` | List keys for a provider |
| `POST` | `/v1/admin/providers/:id/keys` | Add a new key to a provider |
| `PUT` | `/v1/admin/providers/:id/keys/:keyId` | Update a provider key (rotate/decommission) |
| `DELETE` | `/v1/admin/providers/:id/keys/:keyId` | Delete a provider key |
| `POST` | `/v1/admin/providers/:id/keys/:keyId/test` | Test a specific provider key |
| `DELETE` | `/v1/admin/providers/:id` | Delete a provider entirely |

#### Models

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/admin/models` | List models; `?available_only=true|false` controls filter |
| `GET` | `/v1/admin/models/:id` | Get a single model profile |
| `GET` | `/v1/admin/models/classifications` | Get all pricing/classification tiers |
| `POST` | `/v1/admin/models/verify-free` | Verify a model is actually free at runtime |
| `GET` | `/v1/admin/models/free` | List free models (catalog + verified) |
| `POST` | `/v1/admin/models` | Create a model profile |
| `DELETE` | `/v1/admin/models/:id` | Delete a model |

**List available models (public, no auth):**

```bash
curl http://localhost:3000/v1/models
```

#### Tenants & Orgs

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/admin/tenants` | Create a tenant |
| `GET` | `/v1/admin/tenants` | List tenants |
| `GET` | `/v1/admin/tenants/:id` | Get a tenant |
| `PUT` | `/v1/admin/tenants/:id` | Update a tenant |
| `DELETE` | `/v1/admin/tenants/:id` | Delete a tenant |
| `PUT` | `/v1/admin/tenants/:id/organization` | Link a tenant to an org |
| `POST` | `/v1/admin/organizations` | Create an org |
| `GET` | `/v1/admin/organizations` | List orgs |
| `GET` | `/v1/admin/organizations/:id` | Get an org |
| `PUT` | `/v1/admin/organizations/:id` | Update an org |
| `DELETE` | `/v1/admin/organizations/:id` | Delete an org |
| `GET` | `/v1/admin/organizations/:id/members` | List org members |
| `POST` | `/v1/admin/organizations/:id/members` | Add an org member |
| `DELETE` | `/v1/admin/organizations/:id/members/:userId` | Remove an org member |

#### API Keys

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/admin/api-keys` | Create a tenant API key |
| `GET` | `/v1/admin/api-keys` | List API keys |
| `PATCH` | `/v1/admin/api-keys/:id/expiry` | Update expiry |
| `PATCH` | `/v1/admin/api-keys/:id/compression` | Update compression settings |
| `PUT` | `/v1/admin/api-keys/:id/tools` | Update allowed tools on a key |
| `DELETE` | `/v1/admin/api-keys/:id` | Delete an API key |

API keys are created with optional scopes, allowed tools, compression settings, and expiry. The raw key is returned only once at creation.

#### OAuth Provider Setup

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/admin/providers/:id/oauth/authorize` | Start OAuth authorization flow |
| `POST` | `/v1/admin/providers/:id/oauth/callback` | OAuth callback (auth code exchange) |
| `GET` | `/v1/admin/providers/:id/oauth/callback` | OAuth callback for browser redirects |
| `POST` | `/v1/admin/providers/:id/oauth/refresh` | Refresh an OAuth token |
| `GET` | `/v1/admin/providers/:id/oauth/status` | Get OAuth status for a provider |
| `POST` | `/v1/admin/providers/:id/oauth/device-code/poll` | Poll device-code flow |

#### Policies

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/admin/policies` | List policies |
| `POST` | `/v1/admin/policies` | Create a policy |
| `DELETE` | `/v1/admin/policies/:id` | Delete a policy |

Policy types: `provider_allow`, `provider_deny`, `model_allow`, `model_deny`, `cost_cap`, `modality_restriction`, `residency`, `tool_permission`.

Actions: `allow`, `deny`, `redirect`, `rate_limit`, `tag`.

#### Quotas, Billing & Credits

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/admin/quota` | Quota states per tenant/provider |
| `GET` | `/v1/admin/billing/usage-history` | Token usage history (configurable granularity) |
| `GET` | `/v1/admin/billing/summary` | Monthly spend summary |
| `GET` | `/v1/admin/credits/balance` | Current credit balance |
| `POST` | `/v1/admin/credits/topup` | Top up credits |
| `GET` | `/v1/admin/credits/transactions` | Credit transaction history |

#### Routing & Free-Tier

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/admin/routing/decisions` | Recent routing decisions (for admin UI) |
| `GET` | `/v1/admin/routing/performance-by-mode` | Routing performance broken down by mode (frontier/balanced/economy) and free-tier strategy |
| `GET` | `/v1/admin/free-tier/summary` | Aggregated free tokens/month across all providers |
| `GET` | `/v1/admin/cost/dashboard` | Aggregated cost data across tenants and providers |

#### Workers, Sandbox & Federation

| Method | Path | Description |
|--------|------|-------------|
| `GET` / `POST` | `/v1/admin/workers` | List / register workers |
| `POST` | `/v1/admin/workers/:id/heartbeat` | Worker heartbeat |
| `POST` | `/v1/admin/workers/:id/drain` | Drain a worker |
| `POST` | `/v1/admin/workers/:id/resume` | Resume a worker |
| `POST` | `/v1/admin/workers/cleanup` | Clean up stale workers |
| `GET` | `/v1/admin/workers/:id/jobs` | Worker job history |
| `GET` | `/v1/admin/jobs` | All jobs |
| `GET` | `/v1/admin/sandbox/jobs` | List sandbox jobs |
| `POST` | `/v1/admin/sandbox/jobs` | Submit a sandbox job |
| `POST` | `/v1/admin/sandbox/jobs/:id/cancel` | Cancel a sandbox job |
| `GET` | `/v1/admin/federation` | List federation nodes |
| `POST` | `/v1/admin/federation` | Register a federation node |
| `DELETE` | `/v1/admin/federation/:id` | Remove a federation node |
| `POST` | `/v1/admin/federation/:id/health` | Check federation node health |
| `POST` | `/v1/admin/federation/:id/sync` | Sync federation node |

#### Memory

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/admin/memory` | List memory items |
| `POST` | `/v1/admin/memory` | Create a memory item |
| `POST` | `/v1/admin/memory/search` | Search memory items |
| `DELETE` | `/v1/admin/memory/:id` | Delete a memory item |
| `GET` | `/v1/admin/memory/stats` | Memory retention stats |

#### MCP Management

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/admin/mcp/status` | MCP server status, config, and tool catalogue |
| `GET` | `/v1/admin/mcp/tools` | MCP tools list (from MCP server when reachable) |
| `POST` | `/v1/admin/mcp/tools/execute` | Execute an MCP tool directly (testing) |
| `GET` | `/v1/admin/mcp/config` | Full MCP configuration |
| `PUT` | `/v1/admin/mcp/config` | Update MCP configuration |
| `GET` | `/v1/admin/mcp/tool-search/config` | Tool search config |
| `PUT` | `/v1/admin/mcp/tool-search/config` | Update tool search config |
| `GET` | `/v1/admin/mcp/guardrails/config` | Guardrails config |
| `PUT` | `/v1/admin/mcp/guardrails/config` | Update guardrails config |

#### Telemetry, Audit & Dashboard

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/admin/dashboard/stats` | Dashboard stats (requests, tokens, spend, health) |
| `GET` | `/v1/admin/dashboard/stream` | SSE stream of live dashboard updates |
| `GET` | `/v1/admin/telemetry/events` | Telemetry events |
| `GET` | `/v1/admin/telemetry/stream` | SSE stream of telemetry events |
| `GET` | `/v1/admin/audit/events` | Admin audit events (SOC2/ISO27001) |
| `GET` | `/v1/admin/alerts` | Active alerts |
| `POST` | `/v1/admin/alerts/:id/ack` | Acknowledge an alert |
| `POST` | `/v1/admin/alerts/:id/resolve` | Resolve an alert |

#### Benchmarks

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/admin/benchmarks` | List benchmark results |

### OAuth Provider Setup

When activating a provider that supports OAuth (e.g., Google, GitHub, Microsoft), use the `/admin/providers/:id/oauth/authorize` endpoint to initiate an OAuth authorization flow. The callback endpoints exchange the authorization code for tokens and can auto-sync the token into the provider's config. Tokens are encrypted at rest and mirrored to `.env` for resilience.

### Settings

A comprehensive `UpdateSettingsSchema` governs gateway behavior including:

- **Routing:** `routingStrategy`, `costOptimization`, `latencyBudgetMs`, `autoFallback`, `routingTimeout`, fallback routing weights (`qualityWeight`, `costWeight`, `latencyWeight`).
- **Model defaults:** `defaultModel`, `maxContextWindow`, `defaultTemperature`.
- **Platform:** `platformName`, `timezone`.
- **Auth & CORS:** `requireAuth`, `corsOrigins`, `rateLimitRpm`.
- **Request limits:** `autoKeyRotation`, `maxRequestSizeMb`.
- **Caching & streaming:** `cacheTtlSec`, `streamingChunkSize`.
- **Worker / runtime:** `workerConcurrency`, `requestTimeout`.
- **Notifications:** `slackWebhookUrl`, `emailRecipients`, `latencyAlertThreshold`, `quotaAlertThreshold`.
- **Webhooks:** `alertWebhook`, `routeDecisionWebhook`, `webhookMaxRetries`, `webhookRetryBackoff`.
- **Benchmarking:** `autoBenchmarkRuns`, `benchmarkFrequency`, `regressionThreshold`.
- **Retention:** `requestLogRetentionDays`, `memoryRetentionDays`, `benchmarkHistoryDays`, `logRetention`.

---

## Quotas, Rate Limits & Policies

### Rate Limits

- **Per-key rate limit:** 1000 requests/minute per API key (configurable via `DMRX_PER_KEY_RATE_LIMIT`). Implemented in `auth.middleware.ts` using an in-memory LRU cache.
- **Global RPM limit:** configurable via `DMRX_RATE_LIMIT_MAX` and `DMRX_RATE_LIMIT_WINDOW` environment variables.
- **Per-tenant quotas:** managed via the admin API (`/v1/admin/quota`, `/v1/admin/credits`).

### Quotas

Quotas are enforced via `QuotaService`:
- Token quotas per tenant and per provider.
- Credit-based billing: top up via `/v1/admin/credits/topup`, track via `/v1/admin/credits/transactions`.
- Cost dashboard aggregated across tenants and providers: `/v1/admin/cost/dashboard`.
- Usage history with configurable granularity: `/v1/admin/billing/usage-history`.

### Routing Policies (`/admin/policies`)

Policies let operators declaratively control routing decisions:

| Policy type | Description |
|-------------|-------------|
| `provider_allow` | Only allow traffic to listed providers |
| `provider_deny` | Block traffic to listed providers |
| `model_allow` | Allow only listed models |
| `model_deny` | Block listed models |
| `cost_cap` | Hard cap on cost per request |
| `modality_restriction` | Restrict modalities (e.g. image, video) |
| `residency` | Enforce data residency rules |
| `tool_permission` | Allow/deny specific tools |

Each policy has:
- `match`: optional match criteria (`model`, `tenantId`, `tag`, `modality`).
- `action`: `allow`, `deny`, `redirect`, `rate_limit`, `tag`.
- `conditions`: arbitrary key/value pairs for fine-grained conditions.
- `priority`: lower numbers run first; `enabled` toggle.

### Cost Filtering

- **`x-cost-filter: free`** header restricts `auto*` meta-model resolution to zero-cost providers only.
- **`x-cost-filter: all`** (default) includes paid providers.
- Global default: `DMRX_META_MODEL_COST_FILTER` env var.

### Compression

DMR-X supports prompt compression to reduce token usage and cost. Compression is configurable per-tenant and per-API-key, with per-request override via `x-compression` header.

Supported engines: `headroom`, `rtk`, `caveman`, `comment-strip`, `auto`.

| Engine | Best for |
|--------|----------|
| `headroom` | General compression with semantic preservation |
| `rtk` | Code-heavy prompts |
| `caveman` | Minimalist text |
| `comment-strip` | Source code with comments |

Enable POST `/v1/admin/api-keys/:id/compression` with:

```json
{
  "compression_enabled": true,
  "compression_algorithm": "auto",
  "compression_reversible": true
}
```

Override per-request:

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer dmrx_your_api_key_here" \
  -H "x-compression: smartcrusher" \
  -d '{...}'
```

---

## Health & Observability

```bash
# Basic liveness
curl http://localhost:3000/health
# {"status":"ok"}

# Readiness (includes SQLite check)
curl http://localhost:3000/healthz
# {"status":"ok","checks":{"sqlite":"ok"}}

# Detailed readiness
curl http://localhost:3000/ready
# {"status":"ready"}
```

Additional observability:
- OpenTelemetry traces propagated across gateway → router → adapter.
- Telemetry events via `/v1/admin/telemetry/events` and SSE stream at `/v1/admin/telemetry/stream`.
- Dashboard stats stream at `/v1/admin/dashboard/stream`.
- Audit events at `/v1/admin/audit/events`.

---

## Rate Limiting & Quotas Summary

- Default rate limit: 1000 requests per minute per API key (configurable via `DMRX_PER_KEY_RATE_LIMIT`).
- Global rate limits configurable via `DMRX_RATE_LIMIT_MAX` and `DMRX_RATE_LIMIT_WINDOW`.
- Per-tenant quotas managed via the admin API (`/v1/admin/quota`, `/v1/admin/credits`).
- Free-tier strategy: configure via `x-free-tier-strategy` header or `DMRX_FREE_TIER_STRATEGY` env var.
- Cost filter for meta-models: `x-cost-filter: free` restricts `auto*` aliases to zero-cost providers; `x-cost-filter: all` includes all providers. Global default via `DMRX_META_MODEL_COST_FILTER`.
- Admin audit log captures all create/update/delete operations on sensitive resources (SOC2/ISO27001 compliance).

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `401 Invalid API key` | Check your DMR-X API key is correct and active |
| `401 Missing or invalid Authorization header` | Include `Authorization: Bearer ...` (OpenAI) or `x-api-key: ...` (Anthropic/Gemini) |
| `503 No available providers` | Ensure providers are configured with valid API keys in the admin UI or via `/v1/admin/providers/activate` |
| `429 Rate limit exceeded` | Reduce request frequency or increase `DMRX_RATE_LIMIT_MAX` / `DMRX_PER_KEY_RATE_LIMIT` |
| Connection refused | Ensure DMR-X gateway is running on the expected port |
| Model not found | Check `/v1/models` to see available models; ensure the provider has an API key set |
| MCP server unreachable | Check `DMRX_MCP_TRANSPORT`, `DMRX_MCP_HOST`, `DMRX_MCP_PORT`; for stdio, ensure the MCP process can spawn |
| Godmode proxy not initialized | Initialize via the server manager (`/v1/admin/servers/g0dm0d3`) or ensure `auto-free` falls back to normal routing |
| Provider OAuth expired | Call `/v1/admin/providers/:id/oauth/refresh` or re-authorize via `/v1/admin/providers/:id/oauth/authorize` |
| `DMRX_LOCAL_MODE=true` disables auth | Never use in production; restart the gateway after toggling |

### Local Development

For local use without auth:

```bash
DMRX_LOCAL_MODE=true bun run dev:gateway
```

This disables API key authentication and uses the first tenant automatically. **Never use in production.**

### Additional Notes

- **Anthropic passthrough mode:** when `ANTHROPIC_API_KEY` is NOT set in the gateway environment, DMR-X forwards the client's `Authorization`/`x-api-key` headers directly to `api.anthropic.com`, acting as a transparent proxy.
- **CORS:** configure allowed origins via `corsOrigins` in settings or `DMRX_CORS_ORIGINS` env var.
- **mTLS:** managed deployments can configure client certificate authentication; public routes remain accessible without mTLS.
