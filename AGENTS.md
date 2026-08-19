<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **dmr-X** (12834 symbols, 31814 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).
- **MUST update `TODO.md` when starting, finishing, or abandoning work.** See [Multi-Agent Tracking](#multi-agent-tracking) below.

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.
- NEVER start work on an item already marked `🔨 Working` in `TODO.md` without coordinating with that agent first.
- NEVER leave a discovered bug out of `TODO.md`. If you find it, log it.

## Multi-Agent Tracking

Multiple agents work on this DMR-X codebase in parallel. To avoid duplicate work and track progress:

1. **`TODO.md`** at the repository root is the single source of truth for all in-progress, pending, and recently completed work.
2. **Before starting work:** check `TODO.md` for an existing item. If found, set its status to `🔨 Working` and set the **Agent** column to your identifier (e.g., `claude-code-1`, `mimo-3`, `opencode-review`). If not found, add a new entry.
3. **When finishing:** set status to `✅ Done`, add finish date, and link to the commit/PR in **Notes**.
4. **When abandoning:** set status back to `🔲 Pending` and clear the **Agent** column.
5. **When discovering a bug:** add it to the **Backlog / Discovered Bugs** section at the bottom of `TODO.md` with file:line, severity, and a one-line description.
6. **Do NOT** start work on an item already marked `🔨 Working` without coordinating with that agent first.

`docs/ROADMAP.md` is the long-term consolidated roadmap. `TODO.md` is the day-to-day task board. Keep both in sync.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/dmr-X/context` | Codebase overview, check index freshness |
| `gitnexus://repo/dmr-X/clusters` | All functional areas |
| `gitnexus://repo/dmr-X/processes` | All execution flows |
| `gitnexus://repo/dmr-X/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
