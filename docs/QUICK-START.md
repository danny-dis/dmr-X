# DMR-X Quick Start — Single API Key for All Capabilities

One API key provides access to **all providers, all modalities, and all wire formats**.

## 3-Step Setup

### 1. Create Tenant

```bash
curl -X POST http://localhost:3000/v1/admin/tenants \
  -H "Authorization: Bearer YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "acme-corp"}'
```

Response includes `id` — save it for the next step.

### 2. Create API Key

```bash
curl -X POST http://localhost:3000/v1/admin/api-keys \
  -H "Authorization: Bearer YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"tenant_id": "abc123...", "name": "Production API Key"}'
```

Response includes `key` — save it securely. It is only shown once.

### 3. Make Requests

```bash
# OpenAI format
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer dmr-sk-..." \
  -d '{"model": "gpt-4", "messages": [{"role": "user", "content": "Hello"}]}'

# Anthropic format
curl -X POST http://localhost:3000/v1/messages \
  -H "Authorization: Bearer dmr-sk-..." \
  -d '{"model": "claude-3-opus", "max_tokens": 1024, "messages": [{"role": "user", "content": "Hello"}]}'

# Google Gemini format
curl -X POST http://localhost:3000/v1/gemini/generateContent \
  -H "Authorization: Bearer dmr-sk-..." \
  -d '{"contents": [{"role": "user", "parts": [{"text": "Hello"}]}]}'

# Image generation
curl -X POST http://localhost:3000/v1/images/generations \
  -H "Authorization: Bearer dmr-sk-..." \
  -d '{"model": "dall-e-3", "prompt": "A futuristic city"}'

# Video generation
curl -X POST http://localhost:3000/v1/video/generations \
  -H "Authorization: Bearer dmr-sk-..." \
  -d '{"model": "runway-gen3", "prompt": "A drone flying over mountains", "duration": 5}'

# Audio TTS
curl -X POST http://localhost:3000/v1/audio/speech \
  -H "Authorization: Bearer dmr-sk-..." \
  -d '{"model": "tts-1", "input": "Hello, world!", "voice": "alloy"}'

# Audio STT
curl -X POST http://localhost:3000/v1/audio/transcriptions \
  -H "Authorization: Bearer dmr-sk-..." \
  -F "file=@audio.mp3" -F "model=whisper-1"

# Embeddings
curl -X POST http://localhost:3000/v1/embeddings \
  -H "Authorization: Bearer dmr-sk-..." \
  -d '{"model": "text-embedding-3-small", "input": "The quick brown fox"}'
```

## SDK Examples

### Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="dmr-sk-abcdef123456789"
)

response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Hello"}]
)
print(response.choices[0].message.content)
```

### Python (Anthropic SDK)

```python
from anthropic import Anthropic

client = Anthropic(
    base_url="http://localhost:3000/v1",
    api_key="dmr-sk-abcdef123456789"
)

response = client.messages.create(
    model="claude-3-opus",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello"}]
)
print(response.content[0].text)
```

### JavaScript / TypeScript

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:3000/v1',
  apiKey: 'dmr-sk-abcdef123456789'
});

const response = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello' }]
});

console.log(response.choices[0].message.content);
```

## What You Get

| Capability | Supported |
|------------|-----------|
| **Wire formats** | OpenAI, Anthropic, Google Gemini |
| **LLMs** | OpenAI, Anthropic, Google, Ollama, Replicate, + more |
| **Images** | DALL-E, Stability, Replicate, + more |
| **Video** | Runway, FAL, Veo, ComfyUI, + more |
| **Audio** | TTS (ElevenLabs, OpenAI), STT (Deepgram, OpenAI) |
| **Embeddings** | OpenAI, Cohere, Jina, Ollama, + more |
| **OCR** | Tesseract, PaddleOCR, HuggingFace |
| **Reranking** | Cohere, Jina, TEI |
| **3D** | Available providers |

Plus: intelligent provider selection, automatic fallback chains, format conversion, per-tenant rate limiting, per-tenant quotas, and request logging.

## Authentication Flow

```
User Request → Authorization: Bearer dmr-sk-...
  → authMiddleware hashes key, queries api_keys table
  → Attaches tenant to request
  → Router applies tenant policies/quotas
  → Routes to best provider
  → Returns response in original format
```

## Per-Tenant Policies (Optional)

Restrict which providers a tenant can use:

```bash
curl -X POST http://localhost:3000/v1/admin/policies \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id": "...",
    "name": "No OpenAI",
    "type": "provider_allow",
    "target": ["anthropic", "ollama", "replicate"],
    "action": "allow"
  }'
```

## Per-Tenant Quotas (Optional)

Set spending limits:

```bash
curl -X POST http://localhost:3000/v1/admin/quota-allocations \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id": "...",
    "max_cost": 100,
    "period": "monthly"
  }'
```

## Admin API Reference

| Resource | Endpoints |
|----------|-----------|
| Tenants | `POST/GET/PUT/DELETE /v1/admin/tenants` |
| API Keys | `POST/GET/PUT/DELETE /v1/admin/api-keys` |
| Policies | `POST/GET/PUT/DELETE /v1/admin/policies` |
| Quotas | `POST/GET/PUT /v1/admin/quota-allocations` |

## Architecture

```
┌─────────────┐
│   Tenant    │ (customer/org)
└──────┬──────┘
       │
       ├──► API Key #1 (Prod)
       │
       └──► API Key #2 (Dev)
              │
              ├── Access to all providers
              ├── Access to all modalities
              ├── Optional policies (restrict providers)
              └── Optional quotas (limit spending)
```
