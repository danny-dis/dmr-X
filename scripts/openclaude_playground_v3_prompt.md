# Playground Rewrite v3 — STRICT BRIEF (image/video/import added)

## Context
You (openclaude) previously rebuilt the DMR-X Playground into a 9-tab "capability
dashboard." That is WORSE than the original and the user rejected it twice. The original
Playground was a clean chat: `PlaygroundPage` = `PlaygroundSidebar` (left) +
`PlaygroundMain` (center message list) + `PlaygroundInput` (bottom). We are REVERTING to
that chat layout and adding exactly THREE modes — nothing more. This pass ALSO adds
image + video generation to Normal chat and a button to import files from the computer.

Model/endpoint wiring you already built (KEEP, do not break):
- `apps/gateway/src/routes/context.routes.ts` (POST /v1/context/save, /load, GET /list, DELETE /:id) — LIVE.
- `apps/gateway/src/routes/workflow.routes.ts` (POST /v1/workflows) — LIVE.
- `apps/ui/src/lib/admin.ts` — admin helpers (listAgents, deployAgent, runAgentChat, listSkills, getSkill, runWorkflow, listAgentSessions, contextSave/Load/List, mcpTools, mcpExecute, saveMemorySearch). FIXED + type-clean. DO NOT REVERT.
- `apps/ui/src/components/playground/capabilities/*` — panel components (AgentsPanel, SkillsPanel, WorkflowsPanel, RoutingPanel, McpToolsPanel, ContextPanel, ObservabilityPanel, PanelShell). REUSE as building blocks; do NOT create new pages/tabs.

REAL endpoints to reuse for generation (already exist in the gateway — do NOT create new ones):
- Image generation:  POST /v1/images/generations
    body: { prompt: string, model?: string, width?: number, height?: number, n?: number,
            quality?: string, style?: string, response_format?: 'url'|'b64_json', user?: string }
    returns: { data: Array<{ url?: string; b64_json?: string }> }
- Video generation:  POST /v1/video/generations
    body: { prompt: string, model?: string, duration?: number, image?: string (img2video),
            reference_video?: string, edit_video?: string, edit_instruction?: string,
            extend_video?: string, user?: string }
    returns: { data: { videos: string[] } }
- File import from computer: CLIENT-ONLY. Use a hidden <input type="file"> (or drag-drop)
  in the Normal/Agentic composer. Read the picked file as base64 (FileReader) and attach it
  inline to the next message OR offer to feed it to image gen. NO gateway changes needed.

## HARD RULES
1. NO tabs. NO "CapabilityPanelRouter". NO separate routes/pages for capabilities.
2. Keep `PlaygroundPage` as `Sidebar + Main + Input` (original chat skeleton).
3. Exactly THREE modes via a simple 3-segment toggle (Normal · Agentic · Godmode) using
   EXISTING design primitives (Button, cn, same sizing as the existing sidebar toggle).
   It must BLEND into the current UI — no new design language, no forced design.
4. Do NOT touch services/*, packages/*, or any gateway route file. Only edit `apps/ui/src/**`.
5. Image/Video generation and file import are features INSIDE Normal chat only.

## THE THREE MODES
Store `chatMode: 'normal' | 'agentic' | 'godmode'` + setter in `usePlaygroundStore`
(keep existing `mode` for back-compat; drive the page off `chatMode`).

### Normal chat
- Original chat (messages + streaming + model picker) PLUS:
  - A compact "Generate" affordance in the composer or a small toolbar: Image + Video
    buttons. Clicking opens a small inline popover (reuse existing popover/input primitives)
    for prompt + size, posts to /v1/images/generations or /v1/video/generations, and renders
    the resulting image/video inside the message thread (a normal message bubble showing the
    image or an <video>/<img> with the returned url/b64). Do not make this a separate page.
  - A file-import button (paperclip/upload icon) in the composer: opens OS file picker,
    reads file to base64, attaches to the next message (shown as a chip) and/or can be sent
    to the model. Client-only, no gateway change.
  - Sidebar contains a tidy, COLLAPSIBLE "Capabilities" section (disclosure/accordion with
    existing primitives) folding in, in order: Routing, MCP Tools, Context & Memory,
    Observability. Reuse RoutingPanel / McpToolsPanel / ContextPanel / ObservabilityPanel.
    Keep compact — secondary.

### Agentic chat  (connects to AaaS)
- AaaS surface: deploy/run agents via admin.runAgentChat / deployAgent / listAgents /
  listAgentInstances.
- Sidebar (Agentic mode only) shows a simple vertical list/accordion:
  - Agents (list, deploy, run)
  - Skills (list + load)   ← Skills BELONG to agentic (AaaS)
  - Workflows (compose + run via /v1/workflows)  ← Workflows BELONG to agentic (AaaS)
  Reuse AgentsPanel / SkillsPanel / WorkflowsPanel inside the Agentic sidebar.
- Reuse the Normal composer; in Agentic mode, send routes to an agent instance.

### Godmode chat
- Original godmode experience. Reuse EXISTING `GodmodePanel` (variant runner → /v1/godmode/<variant>).
  Do not expand into a page.

## DELIVERABLE
- Edit PlaygroundPage.tsx, PlaygroundSidebar.tsx, usePlaygroundStore.ts, EmptyState.tsx (minimal)
  to implement the 3-mode chat with the additions above. Remove the 9-tab router.
- Add image/video generation UI inside Normal chat (reuse /v1/images/generations and
  /v1/video/generations, render results in-thread).
- Add a file-import button (computer → base64) in the composer.
- Reuse capability panels inside the sidebars as described; create new files ONLY if a tiny
  shared sub-component is unavoidable (e.g. a GeneratePopover, an ImportButton).
- MUST typecheck: `cd apps/ui && bunx tsc -p tsconfig.app.json --noEmit` → ZERO errors in
  playground/*, lib/admin.ts, lib/playgroundCaps.ts, store/usePlaygroundStore.ts, vite-env.d.ts.
  (Models.tsx/Agents.tsx/etc have PRE-EXISTING unrelated errors — ignore those.)
- MUST build: `cd apps/ui && bunx vite build` must exit 0.

## WHAT NOT TO DO
- No top-level tab rail or top tab bar of capabilities.
- No separate Skills/Workflows top-level mode (they live under Agentic).
- No new types in api.ts (agent/skill types already exist & are imported).
- No gateway/services/packages changes.
- Do not force a new design system — blend into the existing primitives.

Report: files changed, 3-mode switch location, where Skills/Workflows landed (Agentic),
how image/video + import are wired (endpoints used), and final tsc --noEmit (playground
scope) + vite build result.
