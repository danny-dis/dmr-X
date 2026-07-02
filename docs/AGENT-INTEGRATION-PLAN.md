# Agent Integration Plan: Codex & Antigravity

> Implementation plan for integrating OpenAI Codex CLI and Google Antigravity (agy) with DMR-X.

---

## Overview

| Agent | Protocol | Complexity | Status |
|-------|----------|------------|--------|
| **Codex** | OpenAI `/chat/completions` | Low | Ready to implement |
| **Antigravity** | Google Cloud Code `cloudcode-pa.googleapis.com` | High | Ready to implement |

DMR-X already serves OpenAI format (`/v1/chat/completions`), so Codex integration is straightforward. Antigravity requires a new protocol adapter since it speaks Google's Cloud Code protocol, not OpenAI/Anthropic.

---

## Part 1: Codex Integration

### Architecture

```
codex CLI
  ↓  OpenAI format (/chat/completions)
  ↓  Authorization: Bearer dmr-sk-...
  ↓
DMR-X Gateway — existing endpoint: POST /v1/chat/completions
  ↓  Routes through pipeline
  ↓
Provider Adapter (OpenAI / Anthropic / Vertex AI)
  ↓
Provider
```

No new gateway code needed — Codex uses the existing OpenAI-compatible endpoint.

### Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `apps/ui/src/pages/Codex.tsx` | **Create** | UI configuration page |
| `apps/ui/src/App.tsx` | **Modify** | Add `/codex` route |
| `docs/API_USAGE_GUIDE.md` | **Modify** | Add Codex documentation section |

### Configuration Methods

**Method A: `~/.codex/config.toml` (recommended)**
```toml
model = "auto-coding"
model_provider = "dmrx"

[model_providers.dmrx]
name = "DMR-X Gateway"
base_url = "http://localhost:3000/v1"
env_key = "DMRX_API_KEY"
wire_api = "chat"
requires_openai_auth = false
```

**Method B: Environment variables**
```bash
export OPENAI_BASE_URL=http://localhost:3000/v1
export OPENAI_API_KEY=dmrx_your_api_key_here
```

---

## Part 2: Antigravity Integration

### Architecture

```
agy (Antigravity CLI)
  ↓  Cloud Code format (contents[], functionCall, etc.)
  ↓  Authorization: Bearer <google_oauth_token>
  ↓
DMR-X Gateway — NEW endpoint: POST /v1internal:streamGenerateContent
  ↓  Convert Cloud Code → UnifiedRequest
  ↓  Route through pipeline
  ↓
Provider Adapter (OpenAI / Anthropic / Vertex AI)
  ↓  Provider-native format
  ↓
Provider
  ↓  Response
  ↓
DMR-X — Convert UnifiedResponse → Cloud Code response
  ↓  SSE stream with candidates[], parts[], functionCall
  ↓
agy receives response
```

### Cloud Code Protocol Summary

**Request envelope:**
```json
{
  "project": "rising-fact-p41fc",
  "model": "gemini-2.5-flash",
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

**SSE streaming response:**
```
data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5,"totalTokenCount":15}}}
```

### Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `apps/gateway/src/converters/cloudcode-converter.ts` | **Create** | Cloud Code → UnifiedRequest conversion |
| `apps/gateway/src/converters/cloudcode-response-converter.ts` | **Create** | UnifiedResponse → Cloud Code response |
| `apps/gateway/src/converters/cloudcode-stream-serializer.ts` | **Create** | StreamChunk → Cloud Code SSE |
| `apps/gateway/src/routes/cloudcode.routes.ts` | **Create** | Gateway endpoints for Cloud Code protocol |
| `apps/gateway/src/server.ts` | **Modify** | Register Cloud Code routes |
| `services/adapters/src/antigravity/antigravity.adapter.ts` | **Create** | Antigravity outbound adapter |
| `services/adapters/src/index.ts` | **Modify** | Export AntigravityAdapter |
| `apps/gateway/src/server.ts` | **Modify** | Register AntigravityAdapter |
| `services/registry/src/provider-catalog.ts` | **Modify** | Add Antigravity provider template |
| `apps/ui/src/pages/Antigravity.tsx` | **Create** | UI configuration page |
| `apps/ui/src/App.tsx` | **Modify** | Add `/antigravity` route |
| `docs/API_USAGE_GUIDE.md` | **Modify** | Add Antigravity documentation |

### Gateway Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v1internal:streamGenerateContent` | POST | Streaming generation (main endpoint) |
| `/v1internal:generateContent` | POST | Non-streaming generation |
| `/v1internal:loadCodeAssist` | POST | Project/credits initialization |
| `/v1internal:fetchAvailableModels` | POST | List available models |

### Auth Strategy

- Accept `Authorization: Bearer <token>` from agy
- If token starts with `dmr-` → validate as DMR-X tenant key
- If token is a Google OAuth token → store for potential Google provider use
- DMR-X uses its own stored provider keys for routing (not the OAuth token)

---

## Implementation Order

1. Write plan document (this file)
2. Codex UI page (`Codex.tsx`)
3. Codex route (`App.tsx`)
4. Codex documentation (`API_USAGE_GUIDE.md`)
5. Cloud Code inbound converter
6. Cloud Code response converter
7. Cloud Code SSE serializer
8. Cloud Code gateway routes
9. Register routes in `server.ts`
10. Antigravity adapter
11. Export + register adapter
12. Provider catalog entry
13. Antigravity UI page
14. Antigravity route
15. Antigravity documentation
16. Build verification
