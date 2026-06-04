# Plan: Frontend–Backend Feature Parity

**Goal:** Expose every meaningful backend setting, capability, and use case to the frontend UI.

**Progress:**
- ✅ Phase 1: Settings page — DONE (346→590 lines, 13→35 settings, 4→8 tabs)
- ✅ Phase 2: Playground — DONE (240→777 lines, 4→8 tabs, advanced params added)
- ⬜ Phase 3: Wire placeholder buttons (Sandbox, Workers, Federation, Benchmarks, Memory, Tenants)
- ⬜ Phase 4: Provider OAuth + Model creation + Provider editing
- ⬜ Phase 5: Policy types
- ⬜ Phase 6: Quota management
- ⬜ Phase 7: Free tier activate button
- ⬜ Phase 8: Model editing fields

---

## Phase 1 — Settings Page (13 → 35+ settings)

**File:** `apps/ui/src/pages/Settings.tsx`

### 1A. Extend `SettingsForm` interface

Add all missing backend settings to the TypeScript interface, `DEFAULTS`, `fromServer()`, and `toServer()`:

```
+ routingTimeout: number            (default: 30000)
+ qualityWeight: number             (default: 0.4)
+ costWeight: number                (default: 0.25)
+ latencyWeight: number             (default: 0.2)
+ platformName: string              (default: 'DMR-X')
+ timezone: string                  (default: 'UTC')
+ requestTimeout: number            (default: 30000)
+ slackWebhookUrl: string           (default: '')
+ emailRecipients: string           (default: '')
+ latencyAlertThreshold: number     (default: 5000)
+ quotaAlertThreshold: number       (default: 80)
+ autoKeyRotation: boolean          (default: false)
+ maxRequestSizeMb: number          (default: 10)
+ autoBenchmarkRuns: boolean        (default: false)
+ benchmarkFrequency: string        (default: 'daily')
+ regressionThreshold: number       (default: 10)
+ routeDecisionWebhook: string      (default: '')
+ alertWebhook: string              (default: '')
+ webhookMaxRetries: number         (default: 3)
+ webhookRetryBackoff: number       (default: 1000)
+ requestLogRetentionDays: number   (default: 30)
+ memoryRetentionDays: number       (default: 90)
+ benchmarkHistoryDays: number      (default: 30)
+ logRetention: number              (default: 30)
```

### 1B. Add new Settings tabs

Current tabs: Routing, Defaults, Security, Performance (4)

Add 4 new tabs → **8 total**:

| Tab | Icon | Settings |
|-----|------|----------|
| **Routing** (existing) | Brain | routingStrategy, costOptimization, latencyBudgetMs, autoFallback, **+ routingTimeout, qualityWeight, costWeight, latencyWeight** |
| **Defaults** (existing) | Cpu | defaultModel, maxContextWindow, defaultTemperature, **+ platformName, timezone** |
| **Security** (existing) | Shield | requireAuth, corsOrigins, rateLimitRpm, **+ autoKeyRotation, maxRequestSizeMb** |
| **Performance** (existing) | Server | cacheTtlSec, streamingChunkSize, workerConcurrency, **+ requestTimeout** |
| **Alerts** (new) | Bell | slackWebhookUrl, emailRecipients, latencyAlertThreshold, quotaAlertThreshold, alertWebhook, routeDecisionWebhook |
| **Webhooks** (new) | Webhook | routeDecisionWebhook, alertWebhook, webhookMaxRetries, webhookRetryBackoff |
| **Benchmarks** (new) | Trophy | autoBenchmarkRuns, benchmarkFrequency, regressionThreshold |
| **Data Retention** (new) | Clock | requestLogRetentionDays, memoryRetentionDays, benchmarkHistoryDays, logRetention |

### 1C. Implementation steps

1. Update `SettingsForm` interface, `DEFAULTS`, `fromServer()`, `toServer()` with all new fields
2. Add 4 new tab triggers to `TabsList`
3. Add 4 new `TabsContent` blocks using the existing `SettingRow` + `Card` pattern
4. Import new icons: `Bell`, `Webhook`, `Trophy`, `Clock` from lucide-react
5. No new API calls needed — all settings go through existing `PUT /admin/settings`

---

## Phase 2 — Playground: Advanced Parameters + Missing Modality Tabs

**File:** `apps/ui/src/pages/Playground.tsx`

### 2A. Add advanced parameters collapsible section

Below the Prompt textarea, add a collapsible "Advanced" section:

```
+ temperature: Slider (0–2, step 0.1, default 0.7)
+ max_tokens: Number input
+ top_p: Slider (0–1, step 0.05, default 1.0)
+ frequency_penalty: Slider (-2–2, step 0.1, default 0)
+ presence_penalty: Slider (-2–2, step 0.1, default 0)
+ stop: Text input (comma-separated)
+ response_format: Select (text / json_object)
+ seed: Number input
+ n: Number input (1–5)
+ stream: Switch (default on)
```

Wire these into the `fetch('/v1/chat/completions')` body in `onSend()`.

### 2B. Add TTS tab

New tab value: `tts`

Form fields:
- `input`: Textarea (text to synthesize)
- `model`: Select (from models filtered by modality `audio_tts`)
- `voice`: Text input
- `speed`: Slider (0.25–4.0, default 1.0)
- `response_format`: Select (mp3/opus/aac/flac/wav/pcm)

API call: `POST /v1/audio/speech` with the form body. Response is binary audio — play it with `<audio>` element.

### 2C. Add STT tab

New tab value: `stt`

Form fields:
- `file`: File upload input (accept audio/*)
- `model`: Select (from models filtered by modality `audio_stt`)
- `language`: Text input (optional)
- `prompt`: Text input (optional context)

API call: `POST /v1/audio/transcriptions` as multipart form-data. Display transcription text in response card.

### 2D. Add Rerank tab

New tab value: `rerank`

Form fields:
- `query`: Text input
- `documents`: Textarea (one document per line)
- `model`: Select (from models filtered by modality `reranking`)
- `top_n`: Number input

API call: Route through chat completions. Display ranked results.

### 2E. Add Moderate tab

New tab value: `moderate`

Form fields:
- `content`: Textarea
- `model`: Select (free or specific)

API call: Route through chat. Display flagged categories and scores.

### 2F. Implementation steps

1. Add `temperature`, `maxTokens`, `topP`, `frequencyPenalty`, `presencePenalty`, `stop`, `responseFormat`, `seed`, `n`, `stream` state variables
2. Create collapsible "Advanced" section using Accordion primitive or simple toggle
3. Add 4 new TabsTrigger values: `tts`, `stt`, `rerank`, `moderate`
4. Create form content for each new tab
5. Add corresponding `onSend*` handlers for each modality
6. Filter model lists by modality for each tab's model selector

---

## Phase 3 — Wire Placeholder Buttons (6 pages)

### 3A. Sandbox: Job submission dialog

**File:** `apps/ui/src/pages/Sandbox.tsx`

Create `SandboxJobDialog.tsx` in `components/domain/`:

```
Fields:
- language: Select (python/node/javascript/bash/sh/deno/bun)
- code: Textarea (monospace, 10+ rows)
- timeoutMs: Number input (default 5000)
- maxRetries: Number input (default 2)
```

Wire:
1. "New job" button → open dialog
2. Dialog submit → `Admin.submitSandbox({ language, code, timeoutMs, maxRetries })`
3. Add "Cancel" button per running job card → `Admin.cancelSandbox(job.id)`
4. Expand job cards to show `output` / `error` in collapsible section

### 3B. Workers: Register worker dialog

**File:** `apps/ui/src/pages/Workers.tsx`

Create `RegisterWorkerDialog.tsx` in `components/domain/`:

```
Fields:
- name: Text input (required)
- type: Select (background/inference/temporary)
```

Wire:
1. "Register worker" button → open dialog
2. Dialog submit → `apiPost('/admin/workers', { name, type })`
3. Add to `Admin` lib: `registerWorker: (body) => apiPost('/admin/workers', body)`

### 3C. Federation: Register peer + delete + health check + sync

**File:** `apps/ui/src/pages/Federation.tsx`

Create `RegisterPeerDialog.tsx` in `components/domain/`:

```
Fields:
- name: Text input (required)
- url: Text input (required)
- region: Text input (optional)
- apiKey: Text input (optional, password)
- privacyLevel: Select (full/aggregated/anonymized, default: anonymized)
```

Wire:
1. "Register peer" button → open dialog
2. Dialog submit → `Admin.registerFederation({ name, url, region, apiKey, privacyLevel })`
3. Delete button per node → `Admin.unregisterFederation(node.id)` + confirmation
4. Add "Health check" button per node → `apiPost(`/admin/federation/${node.id}/health`)`
5. Add "Sync" button per node → `apiPost(`/admin/federation/${node.id}/sync`)`
6. Add to `Admin` lib: `healthCheckFederation`, `syncFederation`

### 3D. Benchmarks: Run benchmark dialog

**File:** `apps/ui/src/pages/Benchmarks.tsx`

Create `RunBenchmarkDialog.tsx` in `components/domain/`:

```
Fields:
- models: Multi-select or comma-separated input (model IDs)
- promptSet: Select (reasoning/creative/instruction/all)
- promptCount: Number input (default 3)
- concurrency: Number input (default 1)
```

Wire:
1. "New benchmark" button → open dialog
2. Dialog submit → `Admin.runBenchmark({ models, promptSet, promptCount, concurrency })`
3. Show running state with polling
4. Empty state "Run benchmark" button → same dialog

### 3E. Memory: Wire delete button

**File:** `apps/ui/src/pages/Memory.tsx`

Wire the existing delete button (line 109-111):

```
onClick → confirmation dialog → Admin.deleteMemory(m.id) → refetch
```

### 3F. Tenants: Wire edit, delete, revoke

**File:** `apps/ui/src/pages/Tenants.tsx`

1. **Edit tenant**: Wire "Edit" button → open `CreateTenantDialog` pre-filled with tenant data, call `Admin.updateTenant(id, body)`
2. **Delete tenant**: Add "Delete" button per tenant → confirmation → `Admin.deleteTenant(id)`
3. **Revoke API key**: Add "Revoke" button per `ApiKeyCard` → confirmation → `Admin.revokeApiKey(tenantId, keyId)`
4. **Rotate API key**: Wire "Rotate" button → revoke old + create new key

---

## Phase 4 — Provider Page: OAuth Flow + Model Creation + Provider Editing

### 4A. OAuth flow in ProviderDetailDrawer

**File:** `apps/ui/src/components/domain/ProviderDetailDrawer.tsx`

Add an "OAuth" section when provider uses OAuth auth:

1. Show OAuth status: `Admin.getProviderOAuthStatus(id)`
2. "Authorize" button → calls `Admin.startProviderOAuth(id)`
   - For `authorization_code`: open returned `authorizationUrl` in popup
   - For `device_code`: show device code + verification URI in dialog, poll `pollProviderOAuthDeviceCode`
   - For `client_credentials`: auto-exchanges, show success/failure
3. Show token expiry + "Refresh" button → `Admin.refreshProviderOAuth(id)`
4. The OAuth callback HTML already auto-closes the popup

### 4B. Model creation dialog

**File:** `apps/ui/src/pages/Models.tsx`

Create `CreateModelDialog.tsx` in `components/domain/`:

```
Fields:
- providerId: Select (from providers list)
- modelId: Text input (required)
- displayName: Text input
- modality: Select (all 14 modalities)
- intelligenceLayer: Select (brain/thinker/executor/worker/temp_worker)
- contextWindow: Number input
- maxOutputTokens: Number input
- All 5 capability toggles (streaming, vision, tool_use, reasoning, function_call)
- inputCostPer1k: Number input
- outputCostPer1k: Number input
- costPerImage: Number input
```

Wire:
1. "New model" button → open dialog
2. Dialog submit → `Admin.createModel(body)`
3. Add to `Admin` lib if missing: already exists as `Admin.createModel`

### 4C. Provider editing in ProviderDetailDrawer

Make the following fields editable in the drawer (currently read-only):

- Name: inline edit → `Admin.updateProvider(id, { name })`
- Base URL: inline edit → `Admin.updateProvider(id, { base_url })`
- API Key: "Update key" button → dialog → `Admin.updateProvider(id, { api_key_ref })`
- Region: inline edit → `Admin.updateProvider(id, { region })`
- Priority: inline edit → `Admin.updateProvider(id, { priority })`

---

## Phase 5 — Policies: Missing Policy Types

**File:** `apps/ui/src/components/domain/PolicyDialog.tsx`

### 5A. Add missing actions to ACTIONS array

```
+ { id: 'cost_cap', label: 'cost_cap', description: 'Enforce a cost threshold' }
+ { id: 'modality_restriction', label: 'modality_restriction', description: 'Restrict by modality' }
+ { id: 'residency', label: 'residency', description: 'Restrict to data residency regions' }
+ { id: 'tool_permission', label: 'tool_permission', description: 'Control tool access' }
```

### 5B. Add action-specific fields

When `action === 'cost_cap'`:
```
+ costThreshold: Number input (cost per token in cents)
```

When `action === 'residency'`:
```
+ region: Select (us/eu/cn/kr/in/global/local/self)
```

When `action === 'tool_permission'`:
```
+ toolName: Text input
+ allowed: Switch
```

### 5C. Update `ApiPolicyRule` type

**File:** `apps/ui/src/types/api.ts`

Add to `ApiPolicyRule`:
```
+ costThreshold?: number
+ region?: string
+ toolName?: string
```

---

## Phase 6 — Quota: Add Quota Management

**File:** `apps/ui/src/pages/Quota.tsx`

The backend stores `quota_allocations` per tenant/provider but the frontend only displays usage.

### 6A. Add "Edit quota" button per tenant

Create `EditQuotaDialog.tsx` in `components/domain/`:

```
Fields:
- tokensLimit: Number input
- requestsLimit: Number input
- costLimit: Number input
- period: Select (monthly/weekly/daily)
```

Wire:
1. "Edit quota" button per tenant → open dialog pre-filled with current limits
2. Dialog submit → needs a backend endpoint or use the existing `updateTenant` to set limits
3. Since `quota_allocations` is a separate table, may need to add endpoint or use tenant update

---

## Phase 7 — Free Tier Drawer: Add Activate Button

**File:** `apps/ui/src/components/domain/FreeTierDrawer.tsx`

Add "Activate" button inside the drawer:
1. When provider is not yet connected, show "Activate" button
2. Click → opens `AddProviderDialog` pre-filled with the catalog template
3. Or directly call `Admin.activateProvider({ template_id: entry.id })`

---

## Phase 8 — Models Page: Expose All Editable Fields

**File:** `apps/ui/src/components/domain/ModelDetailDrawer.tsx`

Currently only toggles capabilities and isActive. Make these fields editable:

- `displayName`: inline edit
- `modality`: select
- `intelligenceLayer`: select
- `contextWindow`: number input
- `maxOutputTokens`: number input

Wire each change to `Admin.updateModel(id, { field: value })`.

---

## File Checklist (all files to create or modify)

### New files to create:
| File | Purpose |
|------|---------|
| `components/domain/SandboxJobDialog.tsx` | Submit sandbox jobs |
| `components/domain/RegisterWorkerDialog.tsx` | Register workers |
| `components/domain/RegisterPeerDialog.tsx` | Register federation peers |
| `components/domain/RunBenchmarkDialog.tsx` | Run benchmarks |
| `components/domain/CreateModelDialog.tsx` | Create model profiles |
| `components/domain/EditQuotaDialog.tsx` | Edit tenant quotas |

### Files to modify:
| File | Changes |
|------|---------|
| `pages/Settings.tsx` | Add 22 settings, 4 new tabs |
| `pages/Playground.tsx` | Add advanced params, 4 modality tabs |
| `pages/Sandbox.tsx` | Wire new job button, cancel, expand output |
| `pages/Workers.tsx` | Wire register button |
| `pages/Federation.tsx` | Wire register, delete, health, sync |
| `pages/Benchmarks.tsx` | Wire run button |
| `pages/Memory.tsx` | Wire delete button |
| `pages/Tenants.tsx` | Wire edit, delete, revoke, rotate |
| `pages/Models.tsx` | Add new model button |
| `pages/Quota.tsx` | Add edit quota button |
| `components/domain/ProviderDetailDrawer.tsx` | Add OAuth section, editable fields |
| `components/domain/ModelDetailDrawer.tsx` | Add editable fields |
| `components/domain/PolicyDialog.tsx` | Add missing actions + fields |
| `components/domain/FreeTierDrawer.tsx` | Add activate button |
| `components/domain/ApiKeyCard.tsx` | Add revoke/rotate buttons |
| `types/api.ts` | Add missing type fields |
| `lib/admin.ts` | Add any missing API methods |

---

## Execution Order

| Step | Phase | Est. Effort | Dependencies |
|------|-------|-------------|--------------|
| 1 | Phase 1: Settings | Medium | None |
| 2 | Phase 5: Policy types | Small | None |
| 3 | Phase 3E: Memory delete | Trivial | None |
| 4 | Phase 3F: Tenant edit/delete/revoke | Small | None |
| 5 | Phase 3D: Benchmark run | Small | None |
| 6 | Phase 3A: Sandbox submit | Medium | None |
| 7 | Phase 3B: Worker register | Small | None |
| 8 | Phase 3C: Federation register+delete+health+sync | Medium | None |
| 9 | Phase 2A: Playground advanced params | Medium | None |
| 10 | Phase 2B-2E: Playground modality tabs | Large | None |
| 11 | Phase 4A: Provider OAuth flow | Large | None |
| 12 | Phase 4B: Model creation | Medium | None |
| 13 | Phase 4C: Provider editing | Medium | None |
| 14 | Phase 6: Quota management | Medium | None |
| 15 | Phase 7: Free tier activate | Small | None |
| 16 | Phase 8: Model editing fields | Small | None |

**Total: ~16 steps across 8 phases. Estimated 36 files touched (6 new + 30 modified).**
