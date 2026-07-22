# DMR-X Playground Rebuild — Concrete Build Brief

**Repo:** `C:\Users\pc\Documents\projects\DMR-X`
**UI package:** `apps/ui` (React + Vite + TypeScript, Tailwind, Radix primitives, Zustand)
**Run from:** repo root. The app is served at `http://127.0.0.1:47113` (gateway serves `apps/gateway/public`).
**Local mode:** `DMRX_LOCAL_MODE=true` => auth is OFF. The UI uses `localStorage` tokens via `lib/api.ts` (`fetchAuthenticated`, `api`, `apiGet`, `apiPost`, `apiPut`, `apiDelete`). In local mode a request with no token still works. Use these helpers everywhere — do NOT hand-roll `fetch`.

---

## 0. Goal

Rebuild the Playground (`apps/ui/src/components/playground/*`) so it is a real, multi-mode AI workbench — not the current "basic" page. The user explicitly requires:

1. **At least 3 chat modes**, named exactly: **Normal Chat**, **Agentic Chat**, **Godmode Chat**.
2. From the Playground you must be able to **drive DMR-X's AaaS agents** (deployed agent instances).
3. From the Playground you must be able to **use MCP tools** (list + invoke).
4. Support **research / subagent delegation** (a "Deep Research" flow that fans out to subagents).

Keep the existing non-chat modalities (image / embed / tts / rerank / moderate) working — they already exist; do not delete them. The PRIMARY deliverable is the three chat modes being rich and functional.

---

## 1. Current architecture (read before editing)

Files under `apps/ui/src/components/playground/`:
- `PlaygroundPage.tsx` — layout: sidebar toggle + `PlaygroundSidebar` + `PlaygroundMain` + `PlaygroundInput`.
- `PlaygroundMain.tsx` — message list; renders `MessageBubble`/`StreamingBubble`; shows `message.events` trace.
- `PlaygroundInput.tsx` — **the heart**. Mode tabs (`modeOptions`), model combobox, config panel (temp, stream, tools JSON textarea), Godmode panel trigger. Calls `sendMessage` from the store.
- `EmptyState.tsx` — `MODE_CONFIG: Record<PlaygroundMode, ...>` (must cover EVERY mode or it white-screens — see pitfalls), sample prompt tiles.
- `PlaygroundSidebar.tsx` — conversation list.
- `GodmodePanel.tsx`, `PromptLibrary.tsx`, `MessageBubble.tsx`, `StreamingBubble.tsx`, `ConversationItem.tsx`, `index.ts`.

Store: `apps/ui/src/store/usePlaygroundStore.ts` is a Zustand `persist` store built from slices:
- `playgroundConversations.ts` — `currentConversationId`, `conversations`, `createConversation`, `loadConversation`, `deleteConversation`, `renameConversation`.
- `playgroundMessages.ts` — `messages`, `sendMessage`, `regenerateMessage`, `clearMessages`, `_createAssistantPlaceholder`, `_buildRequest`, `_streamToEndpoint`.
- `playgroundStreaming.ts` — `isStreaming`, `abortController`, `streamingEvents`, `cancelStreaming`, `updateStreamingMessage`, `addStreamingEvent`, `clearStreamingEvents`.
- `playgroundUI.ts` — `mode`, `model`, `config`, `costFilter`, `isTemporary`, `showSidebar`, setters.

`PlaygroundMode` union (in `usePlaygroundStore.ts`):
`'chat' | 'image' | 'embed' | 'tts' | 'rerank' | 'moderate' | 'agentic' | 'tool-loop' | 'godmode'`.

`_buildRequest` currently maps each mode to an endpoint + body:
- `chat` -> `/v1/chat/completions`
- `image` -> `/v1/images/generations`
- `tts` -> `/v1/audio/speech`
- `embed` -> `/v1/embeddings`
- `rerank` -> `/v1/rerank`
- `moderate` -> `/v1/moderations`
- `agentic` -> `/v1/agentic/chat`
- `tool-loop` -> `/v1/tools/loop`
- `godmode` -> `/v1/godmode/chat`

`_streamToEndpoint` handles `agentic`/`tool-loop` (SSE event stream), `chat` (OpenAI SSE), `godmode` (OpenAI SSE) separately.

**Helpers you MUST reuse:** `lib/api.ts` (`api`, `apiGet`, `apiPost`, `apiPut`, `apiDelete`, `fetchAuthenticated`), `hooks/useApiData.ts` (`useApiData(fetcher, deps, { refetchInterval })` — returns `{ data, isLoading, refetch, setData }`), `lib/admin.ts` (`Admin.listModels`, `Admin.listMcpTools`, etc.), `components/primitives/*` (Button, Card, Tabs, Select, Switch, Slider, Dialog, Drawer, Badge, Input, Textarea, Toast). Do not invent new HTTP plumbing.

---

## 2. Target UX / feature spec

### Top-level "Chat Mode" selector (new concept)
Introduce a **Chat Mode** concept distinct from the modality tabs. There are THREE chat modes the user must be able to pick:

- **Normal Chat** — plain `/v1/chat/completions` streaming. Model + temp + stream. (Existing `chat` mode, polished.)
- **Agentic Chat** — the power user mode. Sub-options:
  - **(a) Ad-hoc agentic**: POST `/v1/agentic/chat` with a `tools` array assembled from selected MCP tools. Multi-step tool loop with live event trace (turn / tool_calls / tool_results).
  - **(b) AaaS agent**: pick a **deployed agent instance** from a dropdown; POST to `/v1/agents/:instanceId/chat`. The agent's own `allowedTools`/`skills` drive it. Show the agent's name/description/preferredModel in the header. No manual tool picking needed (the agent brings its own tools), but you MAY still show them read-only.
  - **(c) Deep Research**: a toggle/button in Agentic Chat that runs a research-fan-out. Implementation: send the task to `/v1/agentic/dispatch` with `{ task, run: true, stream: true }` (or, if you prefer, drive an agentic chat with a research system prompt + web/MCP tools). Show the dispatched subagent's result as the assistant message. Keep it simple but functional — the user said "do research delegate to subagents".
- **Godmode Chat** — POST `/v1/godmode/chat` with the full G0DM0D3 pipeline. Keep `GodmodePanel` (autotune, parseltongue, technique, intensity, STM modules, custom system prompt). Display `x_g0dm0d3.params_used` / pipeline metadata in the response (see §3.3). (Existing `godmode` mode, polished + metadata display.)

### Concrete UI structure
- `PlaygroundInput` keeps modality tabs for non-chat modes (image/embed/tts/rerank/moderate) BUT the **primary chat modes** (Normal / Agentic / Godmode) are now a **prominent segmented control** above the composer (distinct visual treatment, e.g. a sticky top bar inside the input area or a left rail of mode cards). Make Agentic Chat the richest panel.
- **Agentic Chat panel** must include:
  - A **"Agent source"** selector: `Ad-hoc (MCP tools)` vs `AaaS Agent (deployed instance)`.
  - When `AaaS Agent` selected: a dropdown populated from `GET /v1/agents/:id/instances` (filtered client-side to `agentDefinitionId` + `status === 'active'`) — or simpler, list all definitions via `GET /v1/agents` and let the user pick a definition, then resolve its active instance. Show the chosen agent's description.
  - A **MCP tool picker**: list available tools (from `Admin.listMcpTools()` / `GET /v1/tools` or the admin MCP list) as checkboxes; selected tool schemas are assembled into the OpenAI-format `tools` array sent with `/v1/agentic/chat`.
  - A **"Deep Research"** toggle.
  - A live **event trace** under the assistant message (already supported via `message.events` — `PlaygroundMain` renders it). Ensure `agentic`/`tool-loop` SSE events render.
- **Model selector**: keep the existing combobox; for Agentic Chat default to an `auto-agentic`/tool-capable model; for AaaS agent the model is fixed by the agent's `preferredModel` (disable the selector, show it read-only).
- **Normal Chat** and **Godmode Chat** keep their existing controls.

### Visual quality
The current page is "very basic". Make it look like a real product: clear mode cards, agent/source selectors, tool chips, collapsible event traces, token/latency/cost footers on messages (the `Message` type already has `tokensInput/tokensOutput/cost/latencyMs/provider/model` — render them). Use the existing `surface-1/2/3`, `border`, `fg`, `primary` Tailwind tokens consistently.

---

## 3. Exact API contracts (verified from source)

### 3.1 Normal Chat
- `POST /v1/chat/completions`, body `{ model, messages: [{role,content}], stream, temperature, max_tokens?, tools? }`.
- Response: OpenAI SSE `data: {choices:[{delta:{content}}]} ... data: [DONE]`.
- (Existing `chat` handling in `_streamToEndpoint` already does this correctly — keep it.)

### 3.2 Agentic Chat (ad-hoc) — `POST /v1/agentic/chat`
Request body (`apps/gateway/src/routes/agentic.routes.ts` `AgenticChatRequestSchema`):
```
{
  model: string,                                  // required
  messages: { role: 'system'|'user'|'assistant', content: string }[],  // min 1
  tools?: ToolSchema[],                           // OpenAI function-calling format
  tool_choice?: any,
  system_prompt?: string,
  stopWhen?: { type: 'step_count'|'tool_call'|'text_match'|'max_tokens'|'max_cost'|'finish_reason', value: number|string }[],
  approvalRequired?: boolean (default false),
  approvalDecisions?: { tool_call_id: string, approved: boolean, result?: any }[],
  conversationId?: string,
  max_steps?: number (1..50, default 10),
  max_tokens_budget?, max_cost_budget?, temperature?, max_tokens?, top_p?, frequency_penalty?, presence_penalty?,
  stream?: boolean (default false),
  thinking_level?: 'off'|'minimal'|'low'|'medium'|'high'|'xhigh'
}
```
SSE event names emitted (verified in source):
- `turn` — `{ message: { content, ... }, model, usage }` (assistant text / final answer)
- `tool_calls` — `{ toolCalls: [{ name }], ... }`
- `tool_results` — `{ results: [...] }`
- `approval_required` — when `approvalRequired` and a tool needs approval
- `budget_exceeded`
- `done` — `{ status: 'completed'|'awaiting_approval', conversationId }`
- `error` — `{ error: { message } }`

The store already parses `turn` (extract `message.content`) and `error` for `agentic`. **Extend `_streamToEndpoint` (agentic branch) to also capture `tool_calls`/`tool_results`/`done` into `events`** so the trace is complete. Keep `lastContent = parsed.message?.content` from `turn`.

### 3.3 AaaS agent — `POST /v1/agents/:instanceId/chat`
- List definitions: `GET /v1/agents` -> `{ definitions: [...] }` (or array). Each definition: `{ id, name, description, preferredModel, skills, triggers, allowedTools, category?, tags? }`.
- List instances for a definition: `GET /v1/agents/:id/instances` returns **ALL tenant instances** — filter client-side by `agentDefinitionId` and `status === 'active'`, then take the first.
- Chat body (`apps/gateway/src/routes/agent-chat.routes.ts` `AgentChatBody`):
```
{
  messages: { role: 'user'|'assistant'|'system', content: string }[],
  stream?: boolean,
  maxTokens?: number,
  temperature?: number,
  maxSteps?: number,
  conversationId?: string,
  max_cost_budget?: number
}
```
  - **No model override** — the agent's `preferredModel` is used server-side. Do NOT send `model`.
  - Streaming: same SSE family as `/v1/agentic/chat`. FULL event table emitted (verified from `agent-chat-loop.ts`):
    - `agent_start` — `{ requestId, agentInstanceId, agentName, model, resolvedConversationId }`
    - `plan` — `{ resolvedConversationId, plan }` (only if definition `planMode`)
    - `turn` — `{ turn, resolvedConversationId, message, model, usage, finish_reason }` (assistant text lives in `message.content`; `usage` has token counts)
    - `tool_blocked` — `{ turn, blocked: [{ name, reason }] }`
    - `tool_calls` — `{ turn, tool_calls: [{ id, name, arguments }] }`
    - `tool_results` — `{ turn, results: [...] }`
    - `model_retry` — `{ resolvedConversationId, reason, fallbackModel }`
    - `budget_exceeded` — `{ resolvedConversationId, max_cost_budget, totalCost }`
    - `context_compacted` — `{ resolvedConversationId, summary }` (only if `historyCompaction`)
    - `done` — `{ status, conversationId, durationMs, totalTokensUsed, totalCost }`
    - `error` — `{ message }`
    Capture ALL of these as `message.events` (the existing `PlaygroundMain` renders the trace). Use `turn.message.content` as the streamed text. Reuse the agentic streaming parser; just also handle `agent_start`/`plan`/`tool_blocked`/`model_retry`/`budget_exceeded`/`context_compacted` as informational events.
- Quirks (CRITICAL): Agent **update** is `PUT /v1/agents/:id` (NOT PATCH). Model field is `preferredModel` (NOT `model`). You will likely only need GET + chat, so just be aware.

### 3.4 MCP tools
- List tools: `Admin.listMcpTools` exists in `lib/admin.ts` (line ~325). If it returns the tool catalog, use it. Otherwise call `GET /v1/admin/mcp/tools` or `GET /v1/tools` (verify against `lib/admin.ts` and `tools.routes.ts`). Tools are namespaced `serverId__toolName` with `input_schema`/`parameters`.
- Execute a single tool: `POST /v1/tools/execute` with body `{ tool_call: { id, type:'function', function: { name, arguments: JSON.stringify(args) } } }` -> `{ tool_name, tool_call_id, result }` (or `{ error }`). The agentic loop's `tools` array should use the OpenAI format derived from each tool's schema.
- The `tools` array you send to `/v1/agentic/chat` must be OpenAI-format:
```
{ type: 'function', function: { name, description, parameters: <json-schema> } }
```
  Build it from the MCP tool catalog's `input_schema`/`parameters`.
- `POST /v1/tools/loop` (existing `tool-loop` mode) is an alternative multi-turn tool executor — you may keep it, but the primary Agentic Chat should use `/v1/agentic/chat` with tools.

### 3.5 Godmode Chat — `POST /v1/godmode/chat`
Body (`apps/gateway/src/routes/godmode.routes.ts` `GodmodeChatSchema`):
```
{
  messages: { role:'system'|'user'|'assistant', content:string }[],  // min 1
  model?: string,
  stream?: boolean (default false),
  max_tokens?, temperature?, top_p?, frequency_penalty?, presence_penalty?,
  godmode?: boolean (default true),
  custom_system_prompt?: string,
  autotune?: boolean (default true),
  autotune_strategy?: 'adaptive'|'precise'|'balanced'|'creative'|'chaotic',
  parseltongue?: boolean (default true),
  parseltongue_technique?: 'leetspeak'|'unicode'|'zwj'|'mixedcase'|'phonetic'|'random',
  parseltongue_intensity?: 'light'|'medium'|'heavy',
  stm_modules?: ('hedge_reducer'|'direct_mode'|'curiosity_bias'|'casual_mode')[],
  contribute_to_dataset?: boolean
}
```
- Response: OpenAI-style SSE (`choices[0].delta.content`) when `stream:true`. **IMPORTANT (verified):** the G0DM0D3 `x_g0dm0d3` wrapper (`params_used` + `pipeline`) is returned **only on the NON-stream JSON response body**, NOT on the streamed chunks (the stream sends content-only deltas). To display `params_used`/`pipeline` for a Godmode turn, after the stream completes, make a **second non-stream `POST /v1/godmode/chat`** with the same messages + `stream:false`, and read `response.x_g0dm0d3.params_used` + `response.x_g0dm0d3.pipeline`. Render these as a "resolved parameters" chip row + pipeline badges under the assistant message (stash in `message.metadata`). If you only do streaming, show "params: n/a (stream)".
- Keep `GodmodePanel.tsx` (already implements autotune/parseltongue/STM/custom prompt). Wire its state into the godmode request body.

### 3.6 Deep Research / delegation
- `POST /v1/agentic/dispatch` body: `{ task: string, category?, tags?: string[], stream?: boolean, run?: boolean, messages?, maxTokens?, temperature? }`. `run:true` forwards the task to the best-matching active subagent instance in one shot and returns its result. Use this for the "Deep Research" button: send `{ task: <user prompt>, run: true, stream: true }`, render the returned subagent answer as the assistant message. (If dispatch streaming is awkward, fall back to: Agentic Chat with a research system prompt + selected web/MCP tools.)

---

## 4. Implementation plan (recommended file changes)

1. **`store/usePlaygroundStore.ts`**: add a `chatMode: 'normal' | 'agentic' | 'godmode'` field + `setChatMode`. Keep `PlaygroundMode` for the modality sub-tabs. Add `agenticConfig: { source: 'adhoc'|'agent'; agentInstanceId?: string; selectedToolNames: string[]; deepResearch: boolean }` + setters. Add optional `metadata?: Record<string,unknown>` to `Message` (for godmode params_used).

2. **`store/playgroundMessages.ts`**:
   - `_buildRequest`: when `chatMode === 'agentic'`, branch:
     - `source === 'agent'` => endpoint `/v1/agents/${agentInstanceId}/chat`, body per §3.3 (no `model`).
     - `source === 'adhoc'` => endpoint `/v1/agentic/chat`, body per §3.2 with `tools` assembled from `selectedToolNames` (look up schemas from a passed-in catalog or fetched at send time). If `deepResearch`, either use `/v1/agentic/dispatch` per §3.6 OR inject a research system prompt.
   - `_streamToEndpoint`: extend the `agentic` SSE parser to also capture `tool_calls`, `tool_results`, `done` into `events`; keep `turn` -> content, `error` -> error message. Make AaaS-agent streaming share this parser (same event family).
   - Godmode branch: capture `x_g0dm0d3`/`params_used` from the stream/chunk and attach to the message `metadata`.

3. **`components/playground/PlaygroundInput.tsx`**:
   - Add the **Chat Mode segmented control** (Normal / Agentic / Godmode) as the primary selector.
   - Agentic panel: Agent source selector, AaaS agent dropdown (fetch via `useApiData(() => Admin...)` or `apiGet('/v1/agents')`), MCP tool multi-select (chips/checkboxes from `Admin.listMcpTools()`), Deep Research toggle.
   - Normal/Godmode panels: keep existing controls; wire GodmodePanel state -> godmode body.
   - Keep the modality tabs (image/embed/tts/rerank/moderate) accessible but visually secondary.

4. **`components/playground/PlaygroundMain.tsx`**: render `message.metadata` (godmode params_used) as a small badge/panel; keep event trace; render token/latency/cost footers.

5. **`components/playground/EmptyState.tsx`**: ensure `MODE_CONFIG` covers `chat, image, embed, tts, rerank, moderate, agentic, tool-loop, godmode` (keep the existing fallback). Add sample prompts for the 3 chat modes.

6. **`lib/admin.ts`**: confirm/implement `listAgents()` (`GET /v1/agents`), `listAgentInstances(id)` (`GET /v1/agents/:id/instances`), `listMcpTools()` (verify existing at ~line 325 returns the tool catalog). Add `dispatchAgent(task, opts)` (`POST /v1/agentic/dispatch`) if needed. Reuse `apiGet`/`apiPost`.

7. **`components/playground/index.ts`**: export any new components.

### Pitfalls (learned the hard way in this repo)
- `MODE_CONFIG` in `EmptyState.tsx` MUST have an entry for every `PlaygroundMode` or clicking an uncovered tab white-screens the whole Playground (the file already has a fallback — keep it).
- Do NOT introduce missing named imports (e.g. `PopoverPrimitive.Icon` only exists on `@radix-ui/react-select`, not `MultiSelect`). The build is `vite build` and a single bad import breaks the ENTIRE bundle (all routes white-screen). After editing, the build MUST succeed (see §5).
- The build writes to `apps/gateway/public` via `vite.config.ts` `outDir: '../gateway/public'`. `emptyOutDir` does NOT clear that dir — you MUST `rm -rf apps/gateway/public/assets apps/gateway/public/index.html` before building or stale chunks linger.
- Auth is off in local mode; always go through `lib/api.ts` helpers.
- `useApiData` signature: `useApiData(fetcher, deps, options)`. `fetcher` must be a zero-arg function.

---

## 5. Build, run, and verify (MANDATORY before reporting done)

From repo root, in git-bash:
```bash
# 1. Clean stale bundle (vite does NOT auto-empty the outDir)
rm -rf apps/gateway/public/assets apps/gateway/public/index.html

# 2. Build the UI
cd apps/ui && bunx vite build && echo BUILD_EXIT=$?
# BUILD_EXIT must be 0. A successful build PROVES no broken imports.
```
If typecheck matters: `cd apps/ui && bunx tsc --noEmit` (do not change tsconfig). Fix any TS errors the build surfaces.

Do NOT need to restart the gateway for a pure-UI change (gateway serves `apps/gateway/public` statically; a fresh `vite build` overwrites it and the running gateway serves the new files on next load). But if you changed `apps/gateway` server code, restart is required — you are only changing `apps/ui`, so a rebuild is sufficient.

Verify the built bundle actually contains your new mode code:
```bash
E=$(curl -s http://127.0.0.1:47113/index.html | grep -oE "index-[A-Za-z0-9_-]+\.js" | head -1)
curl -s "http://127.0.0.1:47113/assets/$E" -o /tmp/entry.js
grep -oE "Playground-[A-Za-z0-9_-]+\.js" /tmp/entry.js | head -1
# then fetch that chunk and grep for 'Deep Research' / 'AaaS' / 'chatMode' to confirm your code shipped
```

Final ground truth = real browser: the gateway is already running at `http://127.0.0.1:47113`. Load `/#/playground`, switch through **Normal Chat → Agentic Chat (try AaaS agent + MCP tools + Deep Research) → Godmode Chat**, and confirm **0 JS console errors** (the top banner should read "Live: ok"). If you cannot run a browser here, at minimum confirm `BUILD_EXIT=0` and that the playground chunk contains your new strings.

---

## 6. Out of scope (do NOT do)
- Do not modify `services/router`, `services/godmode`, `services/server-manager`, `services/agent-runtime`, `services/agent-registry`, `packages/*` (they are server-side; if a capability is missing server-side, note it in your report but do not rebuild them).
- Do not add import bridges to external frameworks (Vercel EVE etc.) — the user does not run them.
- Do not touch the `.dmrx-data` vendored G0DM0D3 code.
- Do not change `tsconfig.json`, `package.json` deps, or install packages unless strictly required to fix a build error (then note it).

## 7. Report back (required)
When finished, summarize in <=200 words:
- Which files you changed and why.
- BUILD_EXIT code.
- How each of the 3 chat modes is wired (endpoints used).
- Any server-side capability gap you hit (e.g. "no list-endpoints for X") and how you worked around it.
- Any TS/build errors you could not resolve.
