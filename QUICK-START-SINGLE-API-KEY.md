# DMR-X Single API Key - Quick Start

## TL;DR

**Yes, users get a single API key that provides access to ALL capabilities.**

One API key → All providers, all modalities, all formats.

---

## 3-Step Setup

### 1. Create Tenant
```bash
curl -X POST http://localhost:3000/v1/admin/tenants \
  -H "Authorization: Bearer YOUR_ADMIN_KEY" \
  -d '{"name": "customer-name"}'

# Response includes: id (save this)
```

### 2. Create API Key
```bash
curl -X POST http://localhost:3000/v1/admin/api-keys \
  -H "Authorization: Bearer YOUR_ADMIN_KEY" \
  -d '{"tenant_id": "abc123...", "name": "Prod Key"}'

# Response includes: key (save this! shown only once)
```

### 3. User Makes Requests
```bash
# Any of these work with the SAME API key:

# OpenAI format (chat)
curl -X POST https://gateway:3000/v1/chat/completions \
  -H "Authorization: Bearer dmr-sk-..." \
  -d '{"model": "gpt-4", "messages": [...]}'

# Anthropic format (chat)
curl -X POST https://gateway:3000/v1/messages \
  -H "Authorization: Bearer dmr-sk-..." \
  -d '{"model": "claude-3-opus", "messages": [...]}'

# Google format (chat)
curl -X POST https://gateway:3000/v1/gemini/generateContent \
  -H "Authorization: Bearer dmr-sk-..." \
  -d '{"contents": [...]}'

# Image generation
curl -X POST https://gateway:3000/v1/images/generations \
  -H "Authorization: Bearer dmr-sk-..." \
  -d '{"model": "dall-e-3", "prompt": "..."}'

# Video generation
curl -X POST https://gateway:3000/v1/video/generations \
  -H "Authorization: Bearer dmr-sk-..." \
  -d '{"model": "runway", "prompt": "..."}'

# Audio TTS
curl -X POST https://gateway:3000/v1/audio/speech \
  -H "Authorization: Bearer dmr-sk-..." \
  -d '{"model": "tts-1", "input": "..."}'

# Audio STT
curl -X POST https://gateway:3000/v1/audio/transcriptions \
  -H "Authorization: Bearer dmr-sk-..." \
  -F "file=@audio.mp3"

# Embeddings
curl -X POST https://gateway:3000/v1/embeddings \
  -H "Authorization: Bearer dmr-sk-..." \
  -d '{"model": "text-embedding-3", "input": "..."}'

# ... and more
```

---

## What Happens Behind the Scenes

```
User sends request (any format: OpenAI/Anthropic/Gemini)
  ↓
DMR-X validates API key
  ↓
DMR-X routes to best provider (intelligent selection)
  ↓
DMR-X calls provider API
  ↓
DMR-X converts response back to original format
  ↓
User gets response (in format they sent)
```

---

## One API Key = All of This

| Capability | Supported |
|------------|-----------|
| **Formats** | OpenAI, Anthropic, Google Gemini |
| **LLMs** | OpenAI, Anthropic, Google, Ollama, Replicate, + more |
| **Images** | DALL-E, Stability, Replicate, + more |
| **Video** | Runway, Luma, FAL, Veo, ComfyUI, + more |
| **Audio** | TTS (ElevenLabs, OpenAI), STT (Deepgram, OpenAI) |
| **Embeddings** | OpenAI, Cohere, Jina, Ollama, + more |
| **OCR** | Tesseract, PaddleOCR, HuggingFace |
| **Reranking** | Cohere |
| **3D** | (providers available) |

**Plus:**
- ✅ Intelligent provider selection (cost/latency/capability)
- ✅ Automatic fallback chains
- ✅ Format conversion (Anthropic → OpenAI → Gemini, etc.)
- ✅ Per-tenant rate limiting
- ✅ Per-tenant quotas
- ✅ Request logging

---

## Python Example

```python
from openai import OpenAI

# Point to DMR-X gateway instead of OpenAI
client = OpenAI(
    base_url="https://gateway.dmr-x.local:3000/v1",
    api_key="dmr-sk-abcdef123456789"
)

# Now you can use ANY model from ANY provider
# Even though this looks like OpenAI SDK, DMR-X routes internally

# Route to OpenAI
response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Hello"}]
)

# Route to Google (or Ollama, Replicate, etc.)
response = client.chat.completions.create(
    model="gemini-pro",
    messages=[{"role": "user", "content": "Hello"}]
)

# Generate images (router picks best: DALL-E, Stability, etc.)
response = client.images.generate(
    model="dall-e-3",
    prompt="A futuristic city"
)

# Get embeddings (router picks: OpenAI, Cohere, Jina, etc.)
response = client.embeddings.create(
    model="text-embedding-3",
    input="The quick brown fox"
)
```

---

## Admin Commands

```bash
# Create tenant
curl -X POST http://localhost:3000/v1/admin/tenants \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -d '{"name": "customer"}'

# Create API key for tenant
curl -X POST http://localhost:3000/v1/admin/api-keys \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -d '{"tenant_id": "...", "name": "Production"}'

# List all tenants
curl http://localhost:3000/v1/admin/tenants \
  -H "Authorization: Bearer $ADMIN_KEY"

# List all API keys
curl http://localhost:3000/v1/admin/api-keys \
  -H "Authorization: Bearer $ADMIN_KEY"

# Create policy (e.g., "no OpenAI")
curl -X POST http://localhost:3000/v1/admin/policies \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -d '{
    "tenant_id": "...",
    "name": "No OpenAI",
    "type": "provider_allow",
    "target": ["anthropic", "ollama"],
    "action": "allow"
  }'

# Set quota (e.g., "$100/month")
curl -X POST http://localhost:3000/v1/admin/quota-allocations \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -d '{
    "tenant_id": "...",
    "max_cost": 100,
    "period": "monthly"
  }'
```

---

## Key Points

1. **One key = unlimited capabilities**
   - No per-provider API keys needed
   - No per-modality setup needed

2. **Works with standard SDKs**
   - OpenAI Python/JS SDK
   - Anthropic Python SDK
   - Any HTTP client

3. **Format agnostic**
   - Client sends in format X
   - Router routes to any provider
   - Response in format X

4. **Intelligent routing**
   - No client code needed to pick provider
   - Router automatically selects best
   - Includes fallback chains

5. **Per-tenant isolation**
   - Each tenant gets their own key
   - Policies enforce restrictions
   - Quotas enforce spending limits

---

## Architecture

```
┌─────────────┐
│   Tenant    │ (customer/org)
└──────┬──────┘
       │
       ├─────► API Key #1 (Prod)
       │
       └─────► API Key #2 (Dev)
                    │
                    │ Each key has:
                    ├─ Access to all providers
                    ├─ Access to all modalities
                    ├─ Optional policies (restrict providers)
                    └─ Optional quotas (limit spending)
```

---

## End Result

**User provides:**
```json
{
  "base_url": "https://gateway.dmr-x.local:3000/v1",
  "api_key": "dmr-sk-abcdef123456789"
}
```

**User can access:**
- ✅ 50+ AI models from 15+ providers
- ✅ 13+ modalities (LLM, video, audio, images, etc.)
- ✅ 3 wire formats (OpenAI, Anthropic, Google)
- ✅ Intelligent routing
- ✅ Format conversion
- ✅ Fallback chains
- ✅ Rate limiting
- ✅ Quota enforcement

**With just one API key.**
