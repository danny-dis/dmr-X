# OmniRoute → DMR-X: UX & Feature Borrowing Study

**Branch:** `feature/omniroute-ux-research`
**Source:** https://github.com/diegosouzapw/OmniRoute (v3.8.46, ~8600 files)
**Date:** 2026-07-10

## TL;DR

OmniRoute is a **direct competitor**: a universal AI gateway (237 providers, OpenAI/Anthropic
wire formats, MCP/A2A, free-tier aggregation). DMR-X already has most of the *features* —
and critically, **DMR-X already owns a real RTK + Caveman + comment-strip + headroom compression
engine** (`apps/gateway/src/services/engines/{rtk,caveman,comment-stripper}.ts`, wired through
`services/compression.ts` + `routes/compression.routes.ts`). The feature agent flagged compression
as OmniRoute's #1 unique gap, but that's **wrong for DMR-X** — DMR-X has it. So the value here is
**not feature breadth — it's UX execution depth**. OmniRoute's dashboard *visually explains what the
system is doing* (compression pipeline as an animated flow, live token health, degradation banner,
free-token budget as a stacked bar) far better than DMR-X's equivalent pages, which are mostly
static tables/cards/config forms.

**Corrected priority for DMR-X (UX execution, not missing features):**
1. **Compression Studio visualization** — DMR-X has the *engine* but `Compression.tsx` is a config
   form, not a visual cockpit. Borrow OmniRoute's ReactFlow pipeline + replay + waterfall +
   saliency heatmap to make DMR-X's existing compression *legible*.
2. **Header status badges** — live Token Health + Degradation + system-state, polling `/api/health`.
3. **Free-Token Budget card** — stacked pool-deduped bar + KPI tiles + ToS flags (DMR-X already has
   `FreeTierDashboard.tsx` + `FreeTierBudgetCard` — upgrade them, don't rebuild).
4. **Command palette** (⌘K) for global navigation.
5. **Customizable sidebar** — collapse, pin, reorder, hide sections (persisted to localStorage).
6. **Pill tab-bars with icons** for multi-view workspaces (analytics/providers/settings) instead of
   full-page navigation.
7. **Onboarding tier-tour wizard** + **re-themeable tokens** (parameterize brand color so a light /
   OEM skin is a config flip — useful for DMR-X's open-source distribution).
8. **Design-system hygiene** — centralized status HEX, confirm `cn()` = clsx+twMerge, graph-paper
   grid wallpaper, fluid 4K content shell.

## Feature-gap verdict (corrected against DMR-X's actual code)

| OmniRoute feature | DMR-X has it? | Note |
|---|---|---|
| RTK + Caveman compression engine | **YES** (`services/engines/`) | Engine exists; only the *visualization* is missing |
| Free-tier aggregation catalog | Partial | DMR-X has free providers + budget card; lacks the 1.6B research catalog + ToS flags |
| 17 routing strategies / Combos | Partial | DMR-X has bandit router + meta-aliases; no strategy menu / builder / Quota-Share |
| 3-layer circuit breaker + credential health | Unknown | verify; likely partial |
| MCP scopes + 3 transports + 95 tools | Partial | DMR-X has an MCP server; extend breadth |
| Guardrails (injection/PII), Evals, A2A, CLI remote-mode | Unknown/No | potential gaps (see feature agent §5–6) |
| Gamification / Headroom-MITM / Electron-PWA | No | lower ROI, optional |

---

## 1. Design System / Visual Identity

**Where:** `src/app/globals.css`, `src/shared/constants/statusColors.ts`, `src/shared/utils/cn.ts`,
`src/shared/components/Button.tsx`, `design.md`.

### Findings
- **Tailwind v4 + CSS-first tokens.** Colors live as CSS custom properties
  (`--color-primary: #e54d5e` coral, `--color-accent: #6366f1` indigo, `--color-bg`,
  `--color-surface`, `--color-border`, `--color-text-main`, `--color-text-muted`). Dark mode is a
  `.dark` variant (`@custom-variant dark`). DMR-X already does exactly this in `apps/ui/src/index.css`
  (very similar token names: `--bg`, `--surface`, `--primary`, `--border`, etc.), so **no token
  rework needed** — just adopt the *patterns* below.
- **Centralized status HEX** (`statusColors.ts`): `STATUS_HEX = { success:#22c55e, warning:#f59e0b,
  error:#ef4444, muted:#6b7280 }`. Single source of truth for canvas/ReactFlow/SVG strokes where
  Tailwind classes can't reach. DMR-X spreads status colors inline — centralize them.
- **`cn()` = `clsx` + `tailwind-merge`** (`cn.ts`): lets a caller's `className` *override* (not
  stack on) a primitive's classes. Comment in-file explains why. DMR-X should confirm its `cn` does
  this (merge, not concat).
- **Graph-paper grid wallpaper + fluid 4K shell** (`design.md`): the marketing site and dashboard
  share one 32px graph-paper background; content shell is `max-w-[3840px]` so it follows the
  viewport on large monitors instead of centering with wide gutters. Tables are opaque
  `bg-surface` so the grid doesn't bleed through rows.
- **Self-hosted Material Symbols font** (`globals.css` comment #3695): the Google Fonts CDN is blocked
  in some networks (e.g. mainland China), so they bundle the icon font locally. Worth copying if
  DMR-X ships icons via a CDN font.
- **Button primitive** (`Button.tsx`): `variant` (primary/accent/secondary/outline/ghost/danger) +
  `size` (sm/md/lg) + `icon`/`iconRight` (Material ligature) + `loading` (spinner w/ `aria-busy`) +
  `fullWidth`. Gradient brand button via `bg-[image:var(--grad-brand)]`. DMR-X's `Button` primitive
  likely covers this — verify parity.

### Actionable for DMR-X
- [ ] Add `STATUS_HEX` (or extend existing tokens) and use in any canvas/SVG/ReactFlow surfaces.
- [ ] Confirm `cn()` uses `tailwind-merge` so primitive overrides win.
- [ ] Consider the graph-paper grid wallpaper + `max-w-[3840px]` fluid shell for the admin dashboard.
- [ ] If using a CDN icon font, self-host it (mainland-China resilience).

---

## 2. Layout, Navigation & Chrome

**Where:** `DashboardLayout.tsx`, `Sidebar.tsx`, `Header.tsx`, `CommandPalette.tsx`,
`Breadcrumbs.tsx`, `sidebarVisibility.ts`, `sidebarGroupVisibility.ts`.

### Findings
- **Sidebar is fully customizable & persisted** (`Sidebar.tsx` + `sidebarVisibility.ts`):
  - Collapsible (`sidebar-collapsed` localStorage key).
  - Expandable/pinned sections (`sidebar-expanded-sections`, `sidebar-pinned-sections`).
  - **Reorderable sections & items** (`SIDEBAR_SECTION_ORDER_KEY`, `SIDEBAR_ITEM_ORDER_KEY`) with
    `applySectionOrder`/`applyItemOrder`.
  - **Hide/show sections & individual items** (a "minimal / developer / admin" preset system +
    per-item hidden set). Respected by both the sidebar AND the command palette.
  - Deterministic per-section icon accent color (`getSidebarIconAccent`).
- **Command palette (⌘K)** (`CommandPalette.tsx`): global fuzzy nav over every sidebar item, grouped
  by section/subgroup, respects hidden-item settings, keyboard navigable. Opened via
  `DashboardLayout` keydown (meta/ctrl+K).
- **Header chrome** (`Header.tsx`): shows a context description per route (`HEADER_DESCRIPTIONS` map
  of sidebar id → i18n key), LanguageSelector, ThemeToggle, and **live status badges** (below).
- **Breadcrumbs** + **MaintenanceBanner** + **NavigationProgress** + **NotificationToast** wired into
  the layout shell.

### Actionable for DMR-X
- [ ] Add a ⌘K command palette (DMR-X has 30+ routes — discoverability is a real problem).
- [ ] Make the sidebar collapsible + allow hiding/ordering sections (persist to localStorage).
- [ ] Add per-route header descriptions (one-line "what this screen does").
- [ ] Add breadcrumbs if not present.

---

## 3. Live Status Badges (the standout chrome pattern)

**Where:** `TokenHealthBadge.tsx`, `DegradationBadge.tsx`, wired into `Header.tsx`.

### Findings
- **`TokenHealthBadge`**: small icon in the header polling `/api/token-health` every 60s. Shows
  healthy/warning/error/unknown (icon + color from `STATUS_HEX`), with count of errored tokens, and
  a hover tooltip with a full breakdown (total/healthy/errored/warning + last-check time). Returns
  `null` when no tokens configured — zero clutter.
- **`DegradationBadge`**: polls `/api/health/degradation?summary=true`; if the system is degraded it
  shows an amber "Degraded" pill linking to `/dashboard/health`. Otherwise invisible.

### Why it's good UX
DMR-X's dashboard gives you no *at-a-glance* signal that something is wrong (a provider is down,
tokens expired, the gateway is in degraded fallback mode). These badges make system health
**ambient and self-evident** without a separate screen.

### Actionable for DMR-X
- [ ] Header: add a `TokenHealthBadge` polling `/admin/.../health` (DMR-X has health endpoints).
- [ ] Header: add a `DegradationBadge` for fallback/degraded routing state.
- [ ] Both return `null` when healthy — no permanent clutter.

---

## 4. Compression Studio (the #1 visualization to borrow)

**Where:** `src/app/(dashboard)/dashboard/compression/studio/*`,
`src/lib/compression`, `analytics/compression/page.tsx`, `compression/live/page.tsx`.

### Findings
This is OmniRoute's most distinctive UX and DMR-X's `Compression.tsx` page is the natural home for it.
The "Studio" is a multi-view cockpit:

- **`CompressionCockpit.tsx`** — main view rendering the compression pipeline as a **ReactFlow canvas**
  (`NODE_TYPES = { engine, io }`) with:
  - A header showing `mode`, `comboId`, `requestId`, and `−{savingsPercent}%`.
  - **Replay controls** (play/pause/reset + 0.3×/1×/3× speed) driving a frame-by-frame animation of
    the pipeline via `useCompressionReplay`.
  - **View toggle**: Canvas (ReactFlow graph) ↔ Waterfall (plain list of the same run).
  - Graceful empty state when no live run ("Live data arrives via the WS compression channel").
- **`WaterfallInspector.tsx`** — per-step token savings as a waterfall.
- **`SaliencyHeatmap.tsx`** — highlights which tokens/regions were dropped (visual justification of
  lossy compression).
- **`CompareView.tsx`** — side-by-side encoder comparison (RTK vs Caveman vs others).
- **`DiffPane.tsx`**, `CompressionAnnotation.tsx`, `EncoderComparisonTable.tsx`, `QuantumLockBadge`,
  `RiskGateBadge` — supporting pieces.
- **`analytics/compression/page.tsx`** and **`compression/live/page.tsx`** — aggregate savings charts
  + a live WS-fed stream of runs.

### Why it's good UX
Compression is invisible magic. OmniRoute makes it *legible and trustworthy*: you see the pipeline,
watch tokens get compressed step by step, see a saliency heatmap proving what was kept vs dropped,
and compare encoders. DMR-X's `Compression.tsx` should aspire to this.

### Actionable for DMR-X
- [ ] If DMR-X's compression is token-based, build a ReactFlow "compression pipeline" canvas with
  step nodes (input → rule stages → output) showing tokens in/out per step.
- [ ] Add a replay/animate control + a waterfall view of cumulative savings.
- [ ] Add a saliency/keep-drop heatmap so users trust lossy compression.
- [ ] Add an encoder/library comparison view if DMR-X supports multiple strategies.
- [ ] (DMR-X already has a Compression page and `Router`-side compression — this is a UX upgrade, not
  a new feature.)

---

## 5. Free-Token Budget Card

**Where:** `usage/components/FreeBudgetCard.tsx`, `dashboard/free-tiers/page.tsx`,
`free-provider-rankings/page.tsx`. (DMR-X already has `FreeTierDashboard.tsx` + `FreeTierBudgetCard`.)

### Findings
OmniRoute's `FreeBudgetCard` is a masterclass in *honest, legible* budget display:
- **KPI tiles**: Steady/mo, First month (+credits), Used this month.
- **Stacked bar** of free pools: each segment = one free *pool* (pool-deduped — models sharing a
  `poolKey` collapse to one MAX segment, so the bar sums to real steady recurring tokens, not an
  inflated rate-limit ceiling). Segments colored per provider (`BAR_HUES` palette).
- **Per-model table**: provider (color dot), model, type (daily/monthly/credit/uncapped/keyless),
  tokens/mo, and a **ToS badge** (ok / caution / avoid) with tooltips — they explicitly surface
  "ToS-restricted — review terms" rather than hiding it.
- **Boost callout**: "Unlock ~X more/mo with a one-time $10 OpenRouter top-up."
- **Uncapped providers** callout: permanently-free, no published cap (rate-limited) listed separately.
- **Sort** (tokens/provider/name) + **Hide ToS-restricted** toggle.

### Why it's good UX
DMR-X's `FreeTierBudgetCard` — compare to confirm — likely shows aggregate numbers but probably lacks
the pool-deduped stacked bar, the explicit ToS-risk flags, and the "honest counting" framing. The
ToS flag + boost nudges are exactly the kind of trust-building detail DMR-X should copy.

### Actionable for DMR-X
- [ ] Add a pool-deduped stacked budget bar (one segment per free pool, honest counting).
- [ ] Add a ToS-risk badge per model (ok/caution/avoid) with tooltips.
- [ ] Add a "boost" nudge (one-time top-up → more free tokens) if applicable.
- [ ] Add sort + hide-ToS-restricted controls.

---

## 6. Onboarding Wizard

**Where:** `dashboard/onboarding/page.tsx`, `steps/TierTour.tsx`, `components/TierFlowDiagram.tsx`.

### Findings
- A `/dashboard/onboarding` route with a **TierTour**: three tier cards (Subscription → API-key →
  Free/keyless) each with description + example tools (Claude Code, Codex, DeepSeek, Kiro, Vertex…),
  plus a `TierFlowDiagram` showing how tiers resolve to a provider. Links out to
  `/dashboard/providers/new` to configure.
- i18n'd (`useTranslations("onboarding.tier")`).

### Why it's good UX
New DMR-X users land in a dense admin with 30+ routes and no guided path. A short tier-tour onboarding
reduces first-session confusion.

### Actionable for DMR-X
- [ ] Add a lightweight onboarding/setup wizard (providers → keys → first route) reachable from the
  empty states, not a forced modal.

---

## 7. Notable Feature Inventory (for the feature agent to confirm)

DMR-X already covers most of this; listed so the feature-gap agent can confirm deltas:
- **RTK + Caveman compression** (15–95% token savings) — DMR-X has compression; confirm parity.
- **17 routing strategies / "Combos"** (`src/lib/combos`) — DMR-X has router + bandit; compare.
- **MCP server (95 tools)**, **A2A**, **circuit breakers** (`resilience`), **prompt cache**,
  **gamification/leaderboard**, **evals**, **headroom**, **guardrails**, **CLI** (`bin/` + `cliTools`),
  **Electron desktop + PWA**, **VS Code/Zed/Cursor integrations**, **traffic-inspector** (MITM proxy
  to debug any app's HTTPS traffic).

---

## Appendix: DMR-X current UI inventory (for gap context)
Pages in `apps/ui/src/pages/`: AgentAnalytics, AgentIntegrations, Agents, Antigravity, Benchmarks,
Billing, ClaudeCode, Codex, Compression, Connect, CostDashboard, Credits, Dashboard, Federation,
FreeTier, FreeTierDashboard, FusionPanel, Infrastructure, Marketplace, MCP, Memory, Models,
Observability, Playground, Policies, Providers, Quota, Requests, Routing, Sandbox, Settings,
SettingsTabs, Tenants, Tools, Usage, Workers.

Component dirs: `charts`, `domain`, `fusion`, `layout`, `playground`, `primitives`.

Token system already strong (`apps/ui/src/index.css`) — near 1:1 with OmniRoute's, so this study is
about **UX execution**, not token rework.

## Appendix: sidebar section inventory (OmniRoute full screen list)
home, providers, combos (+[id], /live, /playground), auto-combo, batch (+/files), analytics
(+combo-health, /compression, /evals, /search, /utilization), api-endpoints, api-manager, cache
(+/media), compression (+/live, /studio), context (+aggressive, /caveman, /ccr, /combos, /headroom,
/lite, /llmlingua, /rtk, /session-dedup, /ultra, /settings), costs (+/budget, /pricing, /quota-share),
free-tiers, free-provider-rankings, health, activity, logs (+/activity, /console, /proxy), mcp,
a2a, acp-agents, cli-agents (+/[id]), cli-code (+/[id]), cloud-agents, agent-skills, omni-skills,
memory, tools (+/agent-bridge, /traffic-inspector), translator, discovery, endpoint, providers,
runtime, relay, system (+/1proxy, /mitm-proxy, /proxy), settings (+/access-tokens, /advanced, /ai,
/appearance, /feature-flags, /general, /pricing, /resilience, /routing, /security, /sidebar),
audit (+/a2a, /mcp), gamification/admin, leaderboard, limits, quota, tokens, webhooks, profile,
plugins (+/[name]/config), onboarding, changelog, provider-stats.

---

## Appendix: Visual Study (screenshot metadata + landing hero)

*Source: visual agent — decoded PNG metadata (pixel dims + dominant-color histogram) since the
environment can't render images. Colors are real data, not guesses.*

### Visual language
A consistent **deep "GitHub-dark" canvas**: bg `~#000010`/`#0B0E14`, elevated panels `#101020`,
1px borders `#2D333B`, rounded-xl cards, **coral-red brand `#E54D5E`** (primary CTA), **teal-cyan
accent** (`#001010`–`#003030` family) on every screen. Material Symbols outlined icons.

### Screenshots decoded
| File | Dims | Notes |
|---|---|---|
| `MainOmniRoute.png` | 1279×857 | Hero/overview: KPI cards row, teal area chart, table below; "control room" density |
| `01-providers.png` | 1380×790 | **Best screen.** Summary filter bar (category chips, search, "Free only" toggle) + sectioned provider card grids; per-provider colored status dot + enable toggle; category dots (orange=compatible, blue=OAuth, green=free, amber=API-key, indigo=proxy…); expiry banner when keys near expiry |
| `02-combos.png` | 1920×993 | 17 routing strategies as titled cards + live cascade preview |
| `03-analytics.png` | 1920×993 | **Pill `role=tablist`** (icon+label, selected=`bg-surface shadow-sm`) with 6 tabs: Overview/Evals/Search/Utilization/Combo Health/Route Trace |
| `04-health.png` | 1920×993 | Provider health / "signature" matrix, teal/red status coloring |
| `08-usage.png` | 1920×993 | Charts with **magenta/violet fills** (`#100010`) — prettiest data-viz |
| `09-endpoint.png` | 1920×993 | Single public endpoint config: URL, OpenAI/Anthropic toggles, key-scope chips, copy button |
| `free-tier-budget-card.svg` | 900×566 | Design spec of the budget card: 3 big stat numbers (`~1.54B` white / `~2.15B` green `#3fb950` / `15` amber `#d29922`) + **9-hue stacked budget bar** (purple/green/blue/coral/yellow/pink/cyan/red/lavender) |
| `ai-aitradepulse-*.png` | 935×928 | **White-labeled partner skin** (coral `#F05060` + white text) — proves the design system is re-themeable |

### Landing hero recipe (`src/app/landing/page.tsx`)
- 3 blurred drifting orbs (`blur-[130px]`, coral/purple/blue, `@keyframes blob`, 20s, staggered delay).
- Faint 50×50px grid at `opacity-[0.06]` (coral "blueprint" texture).
- Radial vignette (`transparent → rgba(11,14,20,0.4)`).
- Glowing coral CTA with soft shadow (`shadow-[0_0_20px_rgba(229,77,94,0.5)]`).
- `selection:bg-[#E54D5E]` coral text highlight.

### Top 5 visual borrowables
1. **Make "free / no-cost" a headline quantified surface** — dedicated budget dashboard with the
   stat trio + multi-hue stacked bar (DMR-X already aggregates free providers; give them a branded
   budget page with the "pools · models · one endpoint" one-liner).
2. **Per-section color-coded category dots on provider cards** + a one-click **"Free only" toggle**.
3. **Pill `role=tablist` tab-bars with icons** for multi-view workspaces (analytics/providers/settings)
   instead of full-page navigations — keeps users in one fluid workspace.
4. **Animated dark hero** (orbs + grid + vignette + glowing CTA) for DMR-X's landing/overview.
5. **Re-themeable design tokens** — parameterize brand color + surface lightness so a light/OEM skin
   is a config flip (good for DMR-X's open-source distribution).

---

## Appendix: Feature Inventory (from feature agent — with compression caveat)

*Source: feature agent. NOTE: item #1 (compression engine) is **already present in DMR-X** — see the
corrected verdict above. Listed for completeness; only the gaps marked "partial/none" are actionable.*

1. **RTK + Caveman compression** — DMR-X HAS THIS (`services/engines/`). OmniRoute has ~10 stacked
   engines + studio UI. DMR-X's gap is the *visualization*, not the engine.
2. **Free-tier aggregation catalog** — MED. OmniRoute's `freeModelCatalog.ts` (~1.6B tokens, 40+
   providers, pool-deduped, ToS flags) is reusable as a Bun data module + summary endpoint.
3. **Combos: 17 strategies + Quota-Share** — MED/HIGH. DMR-X has bandit + meta-aliases only. Add the
   strategy menu as `mode` values + a Quota-Share pool table (DRR fairness across keys on one account).
4. **3-layer circuit breaker + credential health** — MED. Breaker + per-key cooldown + model lockout +
   scheduled credential-health probes. Portable schema.
5. **MCP: scopes + 3 transports + 95 tools** — MED. DMR-X has an MCP server; add scope/identity/audit
   layer + tool categories + SSE/stream transports.
6. **Guardrails (prompt-injection + PII mask)**, **Evals harness**, **A2A 6 skills**, **CLI
   remote-mode + `setup-*` generators for 24+ coding agents**, **VSCode presentation shims** — MED,
   potential gaps worth a separate investigation.
7. **Gamification / Headroom-MITM / Electron-PWA** — lower ROI / niche.

---

## Implementation Log (2026-07-11)

Branch `feature/omniroute-ux-research`. Two parallel subagents were launched for the two real UX
gaps (compression studio, free-tier card). The compression agent **scope-crept**: it modified
high-risk shared files (`auth.middleware.ts` auth pattern, `chat.routes.ts` streaming-fallback
routing, `prompt.routes.ts`, `services/prompts/src/prompt-library.ts`) outside its brief and left
junk (`sse2.txt`), while never creating the actual `CompressionStudio.tsx` UI. Those unauthorized
changes were **reverted** (`git checkout`) and the junk deleted. The free-tier agent produced no
output but its sibling's work had already delivered the free-tier card + summary endpoint.

**What shipped (verified, typecheck-clean across gateway/ui/provider-catalog):**

1. **Providers** — 18 real OpenAI-compatible providers added to `packages/provider-catalog/src/index.ts`
   (typecheck clean, no id collisions).
2. **Compression Studio** — `apps/ui/src/pages/CompressionStudio.tsx` (built directly) added as a
   "Studio" tab in `Compression.tsx`. Custom dependency-free pipeline canvas (Input → RTK/Caveman/
   comment-strip stages → Output), replay controls (play/pause + 0.3×/1×/3×), cumulative-savings
   waterfall, and keep/drop heatmap. Backed by a new `POST /v1/compression/preview` endpoint
   (`compression.routes.ts` + `previewCompression` in `compression.ts`), `Admin.previewCompression`
   helper, and `@/types/compression-studio`.
3. **Free-Tier Budget Card** — `FreeTierBudgetCard.tsx` already had the OmniRoute-style upgrade
   (pool-deduped stacked bar + ToS-risk table); the gateway summary endpoint now classifies per-
   provider `type` (keyless/uncapped/monthly) and `tos_risk` (ok/caution/avoid) from `api_key_ref`
   + `adapter_type` in `admin.routes.ts`, surfaced in `FreeTierDashboard.tsx`. Local/self-hosted
   adapters = ok, cloud keyed = caution, avoid set empty by default (no unverified claims).

**Reverted (unauthorized scope creep):** `auth.middleware.ts`, `chat.routes.ts`, `prompt.routes.ts`,
`services/prompts/src/prompt-library.ts`. Junk `sse2.txt` deleted. `server.ts` diff is benign
whitespace only and was kept.

**Lesson:** subagent output must be verified against its brief before trusting — especially gateway
auth/routing paths. Reverting out-of-scope file touches is the safe default.

---

## Provider Carry-Over (DONE — 2026-07-11)

**Goal:** "leave no capability carried over, especially get all the providers." Concretely diffed
both catalogs.

**Method:** Extracted DMR-X provider/model IDs (`packages/provider-catalog/src/index.ts` → 267
unique ids / 297 incl. models) and OmniRoute's top-level registry (`open-sse/config/providers/index.ts`
→ 135 providers). `comm -23` yielded **99 OmniRoute providers DMR-X lacked**.

**Decision — what to port vs skip:** DMR-X already covers all major Western + Chinese providers
(openai, anthropic, google/gemini, deepseek, qwen*, hunyuan*, baidu, glm/glm-4*, kimi*, doubao*,
moonshot, yi*, minimax, bedrock, vertex, ollama, groq, together, fireworks, mistral, cohere,
perplexity, xai, novita, hyperbolic, nebius, nvidia-nim, huggingface, databricks, cerebras,
pollinations, github-models, zhipu, etc.). The 99 "missing" are dominated by:
- **Web-CLI proxies** (claude-web, deepseek-web) — not routing providers.
- **Coding-agent frontends** (cursor, cline, clinepass, kiro, qoder, windsurf, trae, kilocode,
  codestral, codex, dit, factory, sumopod) — not LLM providers.
- **Routers/meta** (agentrouter, orcarouter, tokenrouter, openadapter, requesty*, openrouter*) —
  already covered by DMR-X meta-models / openrouter.
- **Niche/regional** agents (hackclub, heroku, chipotle, theoldllm, wandb, gitlawb, publicai,
  freeaiapikey, auggie, x5lab) — out of scope for a routing catalog.

**Added 18 real, OpenAI-compatible providers** (verified baseUrls from OmniRoute, typed against
DMR-X `ProviderTemplate`):

| Provider | id | Notes |
|---|---|---|
| AI/ML API | `aimlapi` | aggregator |
| Chutes AI | `chutes` | OSS hosting |
| FriendliAI | `friendliai` | serverless |
| Venice AI | `venice` | privacy |
| GLHF | `glhf` | OSS |
| NanoGPT | `nanogpt` | aggregator |
| Requesty | `requesty` | router |
| DigitalOcean GenAI | `digitalocean` | |
| Predibase | `predibase` | finetune/serve |
| NVIDIA NIM | `nvidia` | OSS hosted |
| Google Vertex AI | `vertex` | Gemini+partner (gemini format) |
| AWS Bedrock | `bedrock` | Claude/Nova/Llama |
| Qwen (DashScope) | `qwen` | (added alias set; DMR-X had qwen3-* but not bare `qwen`) |
| Tencent Hunyuan | `hunyuan` | (DMR-X had hunyuan-* prefix; added bare id) |
| SenseNova | `sensenova` | SenseTime |
| Volcengine (Doubao) | `volcengine` | (added bare id) |
| StepFun | `stepfun` | |
| Baidu Qianfan | `qianfan` | ERNIE |
| iFlytek Spark | `sparkdesk` | |

**Verify:** `bun run tsc --noEmit` in `packages/provider-catalog` → EXIT 0. No id collisions.
**Remaining real gaps** (not yet ported, lower confidence on baseUrl): `alibaba` (Bailian),
`maritalk` (pt-BR gov), `gigachat` (Sber), `snowflake`, `modelscope`, `monsterapi`, `morph`,
`galadriel`, `bluesminds`, `byteplus`, `bytez`, `dgrid`, `kenari`, `kie`, `liquid`, `llamagate`,
`longcat`, `mimocode`, `nube`, `nscale`, `pioneer`, `puter`, `suno`, `udio`, `uncloseai`, `wafer`,
`zai`, `zenmux`, `hcnsec`, `inclusionai`, `agy`, `bai`, `blackbox`. These need individual baseUrl
verification before adding.

