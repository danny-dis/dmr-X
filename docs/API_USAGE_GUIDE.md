# DMR-X API Usage Guide

DMR-X is a universal AI gateway that accepts requests in three native wire formats — **OpenAI**, **Anthropic**, and **Google Gemini** — and routes them to the best available provider. This guide covers how to create API keys and configure DMR-X as a custom provider in popular tools.

## Table of Contents

- [How It Works](#how-it-works)
- [Creating a DMR-X API Key](#creating-a-dmr-x-api-key)
- [API Formats](#api-formats)
  - [OpenAI-Compatible Endpoint](#openai-compatible-endpoint)
  - [Anthropic-Compatible Endpoint](#anthropic-compatible-endpoint)
  - [Gemini-Compatible Endpoint](#gemini-compatible-endpoint)
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
- [Streaming](#streaming)
- [Tool / Function Calling](#tool--function-calling)
- [Vision (Image Inputs)](#vision-image-inputs)
- [Rate Limiting & Quotas](#rate-limiting--quotas)
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
  "model": "free-coding",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Hello!" }
  ],
  "temperature": 0.7,
  "max_tokens": 1024,
  "stream": false
}
```

Use a meta-model alias (`free`, `free-fast`, `free-smart`, `free-agentic`, `free-coding`) or a specific model name (`gpt-4o`, `claude-sonnet-4-0520`, `gemini-2.5-pro`, etc.).

**Auth:** `Authorization: Bearer <dmrx-api-key>`

**Response:** Standard OpenAI chat completion response with `id`, `object`, `choices`, `usage`.

### Anthropic-Compatible Endpoint

**Endpoint:** `POST /v1/messages`

This is the Anthropic Messages API format used by Claude SDKs.

```json
{
  "model": "free-smart",
  "max_tokens": 1024,
  "system": "You are a helpful assistant.",
  "messages": [
    { "role": "user", "content": "Hello!" }
  ],
  "stream": false
}
```

**Auth:** `x-api-key: <dmrx-api-key>`

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
    "maxOutputTokens": 1024,
    "model": "free-fast"
  },
  "stream": false
}
```

**Auth:** `x-api-key: <dmrx-api-key>`

**Response:** Standard Gemini response with `candidates`, `usageMetadata`.

---

## Meta-Models (Dynamic Routing)

Instead of picking a specific model, you can use **meta-model aliases**. DMR-X dynamically selects the best available provider at request time based on cost, latency, and quality — no hard-coded model names.

| Alias | What It Picks |
|-------|---------------|
| `free` | Any free model (pipeline scoring decides) |
| `free-fast` | Fastest free model (lowest latency) |
| `free-smart` | Most capable free model (highest quality) |
| `free-agentic` | Best free model for tool use (64K+ context, quality+speed scoring) |
| `free-coding` | Best free model for code (specialization match + quality + context + speed) |

Use these exactly like a model name — the router resolves them to an actual provider/model at request time.

```bash
# Instead of picking "gpt-4o" or "claude-sonnet-4-0520":
export ANTHROPIC_BASE_URL=http://localhost:3000/v1
export ANTHROPIC_API_KEY=dmrx_your_api_key_here
claude --model free-coding
```

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
claude --model free-coding          # best free model for code
claude --model free-smart           # most capable free model
claude --model free-fast            # fastest free model
claude --model free-agentic         # best free model for tool use
claude --model free                 # any free model
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
5. Enter a meta-model alias as the model name: `free-coding`, `free-fast`, `free-smart`, `free-agentic`, or `free`

For Anthropic models in Cursor, use the Anthropic API key settings with the same base URL pattern.

### Continue (VS Code / JetBrains)

In your `~/.continue/config.json`:

```json
{
  "models": [
    {
      "title": "DMR-X Free Coding",
      "provider": "openai",
      "model": "free-coding",
      "apiBase": "http://localhost:3000/v1",
      "apiKey": "dmrx_your_api_key_here"
    },
    {
      "title": "DMR-X Free Smart",
      "provider": "anthropic",
      "model": "free-smart",
      "apiBase": "http://localhost:3000/v1",
      "apiKey": "dmrx_your_api_key_here"
    },
    {
      "title": "DMR-X Free Agentic",
      "provider": "openai",
      "model": "free-agentic",
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
    model="free-coding",  # dynamically picks best free coding model
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
  apiKey: "dmrx_your_api_key_here",
});

const response = await client.chat.completions.create({
  model: "free-coding",  // dynamically picks best free coding model
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
    model="free-smart",  # dynamically picks most capable free model
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
  apiKey: "dmrx_your_api_key_here",
});

const response = await client.messages.create({
  model: "free-smart",  // dynamically picks most capable free model
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
  model: "free-fast",  // dynamically picks fastest free model
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
    "model": "free-coding",
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
    "model": "free-smart",
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
    "generationConfig": {"model": "free-fast"},
    "stream": false
  }'
```

---

## Streaming

All three formats support streaming. Set `"stream": true` in the request body.

| Format | Streaming Behavior |
|--------|-------------------|
| OpenAI | Server-Sent Events, ends with `data: [DONE]` |
| Anthropic | Server-Sent Events with `event:` types (`message_start`, `content_block_delta`, `message_stop`) |
| Gemini | Server-Sent Events with `data:` lines containing `GeminiGenerateContentResponse` chunks |

**Python streaming example (OpenAI format):**

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:3000/v1", api_key="dmrx_your_api_key_here")

stream = client.chat.completions.create(
    model="free-coding",  # dynamically picks best free coding model
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
  "model": "free-agentic",
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
  "model": "free-agentic",
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
  "generationConfig": {"model": "free-agentic"},
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
  "model": "free-smart",
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
  "model": "free-smart",
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
  "generationConfig": {"model": "free-smart"}
}
```

---

## Rate Limiting & Quotas

- Default rate limit: 100 requests per minute (configurable via `DMRX_RATE_LIMIT_MAX` and `DMRX_RATE_LIMIT_WINDOW`)
- Per-tenant quotas are managed via the admin API
- Free-tier strategy can be configured with the `x-free-tier-strategy` header or `DMRX_FREE_TIER_STRATEGY` env var

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `401 Invalid API key` | Check your DMR-X API key is correct and active |
| `401 Missing or invalid Authorization header` | Include `Authorization: Bearer <key>` (OpenAI) or `x-api-key: <key>` (Anthropic/Gemini) |
| `503 No available providers` | Ensure providers are configured with valid API keys in the admin UI |
| `429 Rate limit exceeded` | Reduce request frequency or increase `DMRX_RATE_LIMIT_MAX` |
| Connection refused | Ensure DMR-X gateway is running on the expected port |
| Model not found | Check `/v1/models` to see available models; ensure the provider has an API key set |

### Local Development

For local use without auth:

```bash
DMRX_LOCAL_MODE=true bun run dev:gateway
```

This disables API key authentication and uses the first tenant automatically. **Never use in production.**

### Health Checks

```bash
curl http://localhost:3000/health
# {"status":"ok"}

curl http://localhost:3000/healthz
# {"status":"ok","checks":{"sqlite":"ok"}}

curl http://localhost:3000/ready
# {"status":"ready"}
```
