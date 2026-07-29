# The State of MCP Aggregation: Market Study & Blueprint for the Ideal Aggregator

*Research date: July 2026*

---

## Executive Summary

I reviewed the major candidates that are commonly cited as “MCP aggregators”, their actual product sites, GitHub repositories, and open issue trackers. The candid set split into two groups:

1. **Dedicated lightweight MCP proxies/routers** — small, infrastructure-first, almost no UI/UX.
2. **General AI platforms with MCP support** — heavy, end-user-facing, agent-marketplace-driven.

Neither group currently dominates “the best MCP aggregator” slot. The dedicated proxies have poor developer experience and almost no self-service UI. The general platforms treat MCP as a feature, not the product. That gap is where the winner will be built.

---

## 1. What I Actually Found

### 1.1 Zed AI Gateway
- Site: `zed.dev/ai/gateway` returned **404**.
- Product: Zed is primarily a high-performance **code editor / IDE**, not a standalone MCP gateway.
- Verdict: Not a real contender for “best MCP aggregator” today; gateway story is either rebranded or not publicly shipped.

### 1.2 InfinyTrue MCP Gateway
- GitHub: `linkedin/InfinyTrue` returned **404**.
- Verdict: Could not verify as an active MCP aggregator. Either shutdown, renamed, or never shipped as a consumer product.

### 1.3 MCP Router / Relay (open-source proxies)
- **tbxark/mcp-proxy** — 710 stars. Single HTTP server that aggregates multiple MCP resource servers. Written in Go. Minimal surface area.
- **adamwattis/mcp-proxy-server** — 202 stars. Similar value prop.
- **sitbon/magg** — 140 stars. “The MCP Aggregator.” Python-based, Docker support.
- **vtxf/mcp-all-in-one** — 69 stars. All-in-one MCP service/router.
- **leeroybrun/mcp-superassistant-proxy** — 9 stars. Bulletproof proxy with memory-leak prevention focus.

**Success factors:**
- Lightweight, single-binary or Docker deploy.
- Protocol-correct aggregation.

**Failure modes / complaints:**
- Almost **zero UI/UX**. Configuration is YAML/ENV/CLI only.
- No observability dashboard, no marketplace, no auth beyond optional OAuth proxy headers.
- Issues are maintenance-mode; roadmap is unclear.
- They solve “can I route HTTP to five MCP servers?” but not “how do I discover, manage, and secure them?”

### 1.4 Agents.place / MCP.pm
- **agents.place**: Access denied / effectively dead.
- **mcp.pm**: Domain for sale.
- Verdict: No longer active products.

### 1.5 LobeHub — The Indirect Aggregator
- GitHub: 80.9k stars · 15.7k forks
- Product: “Your Chief Agent Operator”
- MCP-related surface area:
  - **82,143+ MCP Servers** listed in its marketplace
  - **333,269+ Skills** alongside MCP
  - Agent Marketplace: one-sentence agent creation, auto-configuration, instant deployment
- Open issues: 276 open, 5,997 closed

**What users love:**
- Polished visual UI; multi-agent orchestration out-of-the-box.
- Long-horizon scheduling (“hire 50 agents, go to bed”).
- Personal memory, continual learning, adaptive behavior.

**Where they lag:**
- MCP integrations are **service integrations inside a larger app**, not a standalone proxy.
- Complaints focus on “MCP marketplace rescan” issues, suggesting freshness/accuracy of the MCP catalog is a pain point.
- Feature bloat: UI is rich but complex; onboarding for simple MCP aggregation is overkill.

### 1.6 FastGPT — RAG-First Aggregation
- GitHub: 29.2k stars · 7.2k forks
- Product: Knowledge-based Q&A platform with RAG, visual workflow, AI proxy built-in.
- Open issues: 142 open, 3,312 closed

**Success:**
- Strong knowledge-base and RAG primitives.
- “AI Proxy” concept exists — unifies multiple backends.
- Chinese-market penetration and enterprise adoption.

**Complaints:**
- Deployment friction: PostgreSQL startup failures, self-signed certificate issues.
- AI proxy changelog hard to track; users ask “where do proxy updates live?”
- API design around knowledge-base chunking is confusing in practice.

### 1.7 Open WebUI — The Most Adopted Interface
- GitHub: 147k stars · 21.4k forks
- Product: “User-friendly AI Interface” — Ollama, OpenAI-compatible backends, MCP support via platform plugins.
- Open issues: 199 open, 8,923 closed. Highest closed-to-open ratio.

**What works:**
- Massive adoption, broad multi-backend support.
- Community trust signal: high closing rate on issues.
- Easy Docker deploy.

**Gaps:**
- MCP is one of many supported protocols, not a first-class citizen.
- Top feature requests: analytics, channels, calendar integration — none of these are MCP-specific.
- No standalone MCP governance UI (routing, scoping, auth per server).

### 1.8 Continue — IDE-Native Aggregation
- GitHub: 35.2k stars · 5.1k forks
- Product: Open-source coding agent / IDE extension (VS Code, Cursor, JetBrains, etc.).
- Open issues: 532 open, 6,101 closed

**Success:**
- Where developers already work (IDE).
- Hub config for sharing MCP/agent configs.
- Deep IDE integration.

**Where it trails:**
- IDE crashes and extension host instability (77-comment thread on `.sh` copy/paste crash).
- Activation failures in VS Code.
- Aggregation is local and per-user; no multi-user / SaaS layer.

### 1.9 Flowise — Visual Agent Builder
- GitHub: 55k stars · 24.8k forks
- Product: Drag-and-drop AI agent/flow builder.
- Open issues: 691 open, 1,967 closed
- High open-to-closed ratio: active but growing pain surface.

**Success:**
- Non-technical users can build agents visually.
- Active community, rapid iteration.

**Complaints:**
- Agent invocation bugs.
- GraphRAG and advanced features are requested but not stable.
- Deployment/base-path issues in hosted environments.

---

## 2. Cross-Cutting Theme: Nobody Owns “The MCP Aggregator”

| Dimension | Dedicated Proxy | General Platform |
|---|---|---|
| UI/UX | CLI + YAML only | Polished but heavy |
| Discovery | None | Marketplace (often noisy) |
| Auth | Proxy headers only | Full user/permission model |
| Observability | Logs only | Dashboards, analytics |
| Per-server control | Low | Medium-High |
| Standalone deploy | Easy | Medium-Hard |
| Support for multiple clients | Yes | Often 1–2 only |
| Community trust | Niche | High stars but indirect |

The **ideal aggregator** would combine the lightweight deployment of proxies with the UX polish and governance of platforms.

---

## 3. Blueprint: The Ideal MCP Aggregator

### 3.1 Core Architecture
- **Single endpoint** that presents as one MCP server to clients.
- **Backend plane** that launches, health-checks, reloads, and routes to N upstream MCP servers.
- **Schema-aware proxy** — merges tools/resources from upstreams; handles name collisions through namespacing or policies.
- **Protocol-native** — implements `mcp-go` / TypeScript SDK at the edge; no custom sub-protocol required from clients.

### 3.2 UI/UX Requirements
| Capability | Why It Matters |
|---|---|
| **Catalog / Discovery** | Users should search, preview, and onboard MCP servers like npm packages. Auto-generated docs from upstream `listTools` / `listResources`. |
| **One-click add** | Connect a server from catalog → instant aggregation, no YAML editing. |
| **Server health dashboard** | P95 latency, error rate, auth expiry per upstream. Users complain today when proxy silently breaks. |
| **Testing playground** | Try tools/resources without wiring a client. MCP Inspector is good; aggregator should embed it. |
| **Policy & namespace editor** | Allow/deny lists, prefixing, user-scoping — this is where enterprises currently build homegrown fixes. |
| **Webhook / streaming logs** | Debug multi-server workflows in real time. |

### 3.3 Developer Experience
- **SDK / API** for adding servers programmatically.
- **Declarative config** with hot reload.
- **Client adapters**: Works with Claude Desktop, Claude Code, Cursor, VS Code, Open WebUI, LobeHub, etc. without per-client hand-configuration.
- **Transport flexibility:** SSE, Streamable HTTP, stdio-to-HTTP bridge.

### 3.4 Security & Governance
- Per-server **auth passthrough** (headers, OAuth2 client credentials).
- **Tool filtering** at aggregation layer — stop risky tools from reaching certain users or clients.
- **Audit trail** for tool calls per origin.
- **Sandboxed upstream execution** if hosting managed servers.
- **Secrets management** integration (env injection, vault backends).

### 3.5 Deployment Profiles
| Profile | Needs |
|---|---|
| Personal / Desktop | Single binary, local-first, zero-config defaults |
| Team / Self-hosted | RBAC, shared configs, usage quotas |
| SaaS / Enterprise | Multi-tenant, usage billing, audit logs, SSO |

### 3.6 What the Market Will Punish
- **Incomplete protocol conformance** — hidden incompatibilities with new MCP spec versions.
- **Silent failures** — proxies that drop errors rather than surface them.
- **Catalog drift** — stale/unscanned listings (see LobeHub rescan complaints).
- **Overcomplicated onboarding** — developers will choose a raw proxy over a fancy platform if it takes 60 seconds to route.
- **Vendor lock-in** — if users cannot export their config, they will not adopt.

---

## 4. Competitive Positioning

If I were building the “best MCP aggregator” today, here is how I would differentiate:

| Competitor | To Beat Them, Do This |
|---|---|
| mcp-proxy / magg | Add a real UI, catalog, health dashboard, and auth — keep the simple deploy. |
| LobeHub / Open WebUI / FastGPT | Make MCP a **first-class standalone product**, not a marketplace tab. Charge on aggregation governance, not chat UI. |
| Continue | Be client-agnostic and multi-user. Continue is per-installation, single-user, IDE-bound. |

---

## 5. Conclusion

The market does not have a clear “best MCP aggregator.” The lightweight proxies are too primitive; the general AI platforms treat MCP as a bolted-on feature. The winning product will sit in the gap:

> **A protocol-native, client-agnostic MCP gateway with a polished self-service UI for catalog, health, auth, and policy — that deploys as easily as a single Docker container or binary.**

That is the spec to build toward.

---

## References
- modelcontextprotocol.io — official MCP documentation
- tbxark/mcp-proxy, sitbon/magg — lightweight proxies
- lobehub/lobehub, labring/FastGPT, open-webui/open-webui, continuedev/continue, FlowiseAI/Flowise — platform comparisons via GitHub issues and product pages
