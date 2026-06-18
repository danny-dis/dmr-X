# DMR-X: Single API Key for All Capabilities

## Overview

Yes, DMR-X is designed to provide a **single API key and base URL** that gives users access to **all routing capabilities** across all modalities (LLM, Video, Audio, Images, Embeddings, OCR, etc.) and all providers (OpenAI, Anthropic, Google, etc.).

## How It Works

### Architecture

1. **Admin** creates a **Tenant** (customer/organization)
2. **Admin** generates an **API Key** bound to that Tenant
3. **User** makes requests to DMR-X gateway with:
   - Base URL: `https://gateway.dmr-x.local:3000`
   - API Key: The tenant's key (in `Authorization: Bearer <key>` or `X-API-Key: <key>` header)
4. **Router** automatically:
   - Routes request to best provider
   - Handles all format conversions (Anthropic → OpenAI → Gemini, etc.)
   - Applies tenant's policies and quotas
   - Returns response in original format

## Database Schema

### Tenants
```sql
CREATE TABLE tenants (
  id TEXT PRIMARY KEY,           -- UUID
  name TEXT NOT NULL,             -- "acme-corp"
  created_at TEXT,
  updated_at TEXT
);
```

### API Keys
```sql
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,           -- UUID (internal)
  tenant_id TEXT NOT NULL,        -- References tenants.id
  key_hash TEXT UNIQUE,           -- Hashed key (stored, not plaintext)
  name TEXT,                      -- "Production API Key"
  is_active INTEGER,              -- 1 or 0
  created_at TEXT,
  last_used_at TEXT
);
```

### Policies (Optional - per-tenant routing rules)
```sql
CREATE TABLE policies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,        -- Tenant this policy applies to
  name TEXT NOT NULL,
  rules TEXT,                     -- JSON: provider allow/deny lists, quotas, etc.
  is_active INTEGER,
  created_at TEXT
);
```

### Quota Allocations (Optional - spending limits)
```sql
CREATE TABLE quota_allocations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,        -- Tenant quota applies to
  provider_id TEXT,               -- NULL = across all providers
  max_requests INTEGER,           -- Max API calls
  max_tokens INTEGER,             -- Max tokens (LLM only)
  max_cost REAL,                  -- Max USD cost
  period TEXT,                    -- 'monthly', 'daily', etc.
  created_at TEXT
);
```

## Setup Steps

### Step 1: Create a Tenant

```bash
curl -X POST http://localhost:3000/v1/admin/tenants \
  -H "Authorization: Bearer <DMRX_ADMIN_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "acme-corp"
  }'
```

**Response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "acme-corp",
  "created_at": "2026-06-17T10:00:00Z",
  "updated_at": "2026-06-17T10:00:00Z"
}
```

Save the `id` — you'll need it for the next step.

### Step 2: Generate an API Key for the Tenant

```bash
curl -X POST http://localhost:3000/v1/admin/api-keys \
  -H "Authorization: Bearer <DMRX_ADMIN_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Production API Key"
  }'
```

**Response:**
```json
{
  "id": "api-key-uuid",
  "tenant_id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Production API Key",
  "scopes": null,
  "created_at": "2026-06-17T10:00:00Z",
  "key": "dmr-sk-abcdef123456789"  ← ONLY SHOWN ONCE, SAVE IT!
}
```

**⚠️ IMPORTANT:** Save the `key` field securely. It's only shown once. The key is hashed before storage in the database.

### Step 3: User Makes Requests with the Key

The user now has:
- **Base URL:** `https://gateway.dmr-x.local:3000`
- **API Key:** `dmr-sk-abcdef123456789`

#### OpenAI Format Request (LLM)
```bash
curl -X POST https://gateway.dmr-x.local:3000/v1/chat/completions \
  -H "Authorization: Bearer dmr-sk-abcdef123456789" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": false
  }'
```

#### Anthropic Format Request (LLM)
```bash
curl -X POST https://gateway.dmr-x.local:3000/v1/messages \
  -H "Authorization: Bearer dmr-sk-abcdef123456789" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-opus",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

#### Google Gemini Format Request (LLM)
```bash
curl -X POST https://gateway.dmr-x.local:3000/v1/gemini/generateContent \
  -H "Authorization: Bearer dmr-sk-abcdef123456789" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{
      "role": "user",
      "parts": [{"text": "Hello!"}]
    }]
  }'
```

#### Image Generation Request
```bash
curl -X POST https://gateway.dmr-x.local:3000/v1/images/generations \
  -H "Authorization: Bearer dmr-sk-abcdef123456789" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "dall-e-3",
    "prompt": "A futuristic city",
    "n": 1,
    "size": "1024x1024"
  }'
```

#### Video Generation Request
```bash
curl -X POST https://gateway.dmr-x.local:3000/v1/video/generations \
  -H "Authorization: Bearer dmr-sk-abcdef123456789" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "runway-gen3",
    "prompt": "A drone flying over mountains",
    "duration": 5,
    "fps": 24
  }'
```

#### Audio TTS Request
```bash
curl -X POST https://gateway.dmr-x.local:3000/v1/audio/speech \
  -H "Authorization: Bearer dmr-sk-abcdef123456789" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "tts-1",
    "input": "Hello, world!",
    "voice": "alloy"
  }'
```

#### Audio STT Request
```bash
curl -X POST https://gateway.dmr-x.local:3000/v1/audio/transcriptions \
  -H "Authorization: Bearer dmr-sk-abcdef123456789" \
  -F "file=@audio.mp3" \
  -F "model=whisper-1"
```

#### Embeddings Request
```bash
curl -X POST https://gateway.dmr-x.local:3000/v1/embeddings \
  -H "Authorization: Bearer dmr-sk-abcdef123456789" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "text-embedding-3-small",
    "input": "The quick brown fox"
  }'
```

## Authentication Flow

```
User Request
  ↓
Authorization Header: "Bearer dmr-sk-..."
  ↓
authMiddleware (auth.middleware.ts:139-186)
  1. Extract API key from header
  2. Hash the key
  3. Query: SELECT * FROM api_keys WHERE key_hash = ? AND is_active = 1
  4. If found:
     - Attach to request.tenant = { id, name, apiKeyId }
     - Update last_used_at timestamp
  5. If not found:
     - Throw AuthenticationError
  ↓
Route Handler
  - Can access request.tenant to enforce per-tenant policies/quotas
  - Creates UnifiedRequest with tenant metadata
  ↓
Router
  - Routes request (modality-aware)
  - Applies tenant's rate limits and quotas
  - Selects best provider
  ↓
Response
  - Tagged with tenant_id in request logs
  - Quota consumption deducted
```

## Per-Tenant Policies (Optional)

Tenants can have **policies** that restrict which providers they can use:

```bash
curl -X POST http://localhost:3000/v1/admin/policies \
  -H "Authorization: Bearer <DMRX_ADMIN_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "No OpenAI",
    "type": "provider_allow",
    "target": ["anthropic", "ollama", "replicate"],
    "action": "allow",
    "priority": 0,
    "enabled": true
  }'
```

**Result:** Tenant can only use Anthropic, Ollama, and Replicate providers. OpenAI blocked.

## Per-Tenant Quotas (Optional)

Tenants can have **spending limits**:

```bash
curl -X POST http://localhost:3000/v1/admin/quota-allocations \
  -H "Authorization: Bearer <DMRX_ADMIN_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id": "550e8400-e29b-41d4-a716-446655440000",
    "max_cost": 100,
    "period": "monthly"
  }'
```

**Result:** Tenant can spend max $100/month across all providers.

## What the User Gets with One API Key

With a single API key bound to a tenant, the user can:

✅ **Make requests in any format:**
- OpenAI format (`/v1/chat/completions`)
- Anthropic format (`/v1/messages`)
- Google Gemini format (`/v1/gemini/generateContent`)

✅ **Access any modality:**
- LLM (chat completions)
- Image generation (diffusion)
- Video generation
- Audio TTS
- Audio STT
- Audio separation
- Embeddings
- OCR
- 3D generation
- Reranking

✅ **Route to any provider:**
- OpenAI, Anthropic, Google, Ollama, Replicate, FAL, Stability, ElevenLabs, Deepgram, Cohere, Jina, and more

✅ **Get automatic:**
- Format conversion (Anthropic request → OpenAI response)
- Intelligent provider selection (best cost, latency, availability)
- Fallback chains (automatic retry with alternative providers)
- Rate limiting (per tenant)
- Quota enforcement (per tenant, optional)
- Request logging (for analytics)

## Admin API Reference

### Tenant Management
```
POST   /v1/admin/tenants              Create tenant
GET    /v1/admin/tenants              List all tenants
GET    /v1/admin/tenants/{id}         Get single tenant
PUT    /v1/admin/tenants/{id}         Update tenant
DELETE /v1/admin/tenants/{id}         Delete tenant
```

### API Key Management
```
POST   /v1/admin/api-keys             Create key for tenant
GET    /v1/admin/api-keys             List all keys
GET    /v1/admin/api-keys/{id}        Get single key
PUT    /v1/admin/api-keys/{id}        Update key (deactivate, rename)
DELETE /v1/admin/api-keys/{id}        Delete key
```

### Policy Management
```
POST   /v1/admin/policies             Create policy for tenant
GET    /v1/admin/policies             List all policies
PUT    /v1/admin/policies/{id}        Update policy
DELETE /v1/admin/policies/{id}        Delete policy
```

### Quota Management
```
POST   /v1/admin/quota-allocations    Set quota for tenant
GET    /v1/admin/quota-allocations    List all quotas
PUT    /v1/admin/quota-allocations/{id} Update quota
```

## SDK Examples

### Python (OpenAI Client)
```python
from openai import OpenAI

client = OpenAI(
    base_url="https://gateway.dmr-x.local:3000/v1",
    api_key="dmr-sk-abcdef123456789"
)

response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

**Note:** It uses the OpenAI SDK but points to DMR-X gateway. DMR-X converts internally to any provider!

### Python (Anthropic Client)
```python
from anthropic import Anthropic

client = Anthropic(
    base_url="https://gateway.dmr-x.local:3000/v1",
    api_key="dmr-sk-abcdef123456789"
)

response = client.messages.create(
    model="claude-3-opus",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.content[0].text)
```

### Python (Images)
```python
from openai import OpenAI

client = OpenAI(
    base_url="https://gateway.dmr-x.local:3000/v1",
    api_key="dmr-sk-abcdef123456789"
)

response = client.images.generate(
    model="dall-e-3",
    prompt="A futuristic city",
    n=1,
    size="1024x1024"
)
print(response.data[0].url)
```

### JavaScript/TypeScript
```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://gateway.dmr-x.local:3000/v1',
  apiKey: 'dmr-sk-abcdef123456789'
});

const response = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello!' }]
});

console.log(response.choices[0].message.content);
```

## Key Points

1. **One API Key = Access to Everything**
   - All modalities (LLM, video, audio, images, etc.)
   - All providers (OpenAI, Anthropic, Google, local, etc.)
   - All formats (Anthropic, Gemini, OpenAI wire formats)

2. **Tenant Isolation**
   - Each tenant gets their own API keys
   - Requests tagged with tenant_id in logs
   - Quotas and policies enforced per tenant

3. **Format Agnostic**
   - Client sends request in any format (Anthropic, Gemini, OpenAI)
   - Router selects provider (could be different format)
   - Response converted back to original format

4. **Automatic Routing**
   - No client code needed for provider selection
   - Router picks best based on cost, latency, capability
   - Fallback chains handle failures

5. **Standard SDK Support**
   - Use OpenAI Python SDK pointing to DMR-X
   - Use Anthropic SDK pointing to DMR-X
   - Any HTTP client with API key in header

## Example Workflow

```
1. Admin: Create tenant "acme-corp"
   → Tenant ID: abc123...

2. Admin: Create API key for tenant
   → API Key: dmr-sk-xyz789...

3. User: Configure app with:
   Base URL: https://gateway.dmr-x.local:3000/v1
   API Key: dmr-sk-xyz789...

4. User: Code using OpenAI SDK:
   from openai import OpenAI
   client = OpenAI(base_url="https://...", api_key="dmr-sk-...")
   response = client.chat.completions.create(model="any-model", ...)

5. Router: Receives Anthropic-format request but could route to OpenAI,
   Ollama, Google, etc. depending on availability/cost

6. User: Gets response in original format (what they sent in)
```

## Summary

✅ **Single API Key** → Access to all routing capabilities
✅ **No SDK modifications** → Works with standard OpenAI/Anthropic SDKs
✅ **Transparent routing** → Automatic provider selection
✅ **Format conversion** → Send Anthropic, route to OpenAI, get Anthropic back
✅ **Per-tenant policies** → Control which providers tenants can use
✅ **Per-tenant quotas** → Enforce spending limits
✅ **Request logging** → Track usage by tenant

DMR-X is the unified gateway for AI routing.
