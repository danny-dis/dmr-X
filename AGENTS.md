# DMR-X — Project Rules

## Session start (required)

1. `cd` to this directory (`C:\Users\pc\Documents\projects\DMR-X`).
2. Run `npx -y gitnexus@latest status`. If status reports `stale`
   or `missing`, run `npx -y gitnexus@latest analyze` before
   answering any question or making any change.
3. Honor the global rules in
   `C:\Users\pc\.config\opencode\INSTRUCTIONS.md` for all
   code-intelligence work (impact, detect_changes, query, context,
   rename).
4. If launching opencode from a fresh shell, prefer the `dmr`
   wrapper (on PATH) which guarantees a refresh of the index.

## Build / commit workflow (required)

- Before editing any function, class, or method → run
  `gitnexus_impact` first and surface the blast radius.
- Before any commit → run `gitnexus_detect_changes` and confirm
  only the expected symbols/flows are touched.
- For renames / extractions / moves → use `gitnexus_rename`,
  never find-and-replace.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **dmr-X** (10450 symbols, 20213 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

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
