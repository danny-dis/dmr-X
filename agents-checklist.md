# Agents Checklist

| ID | Task | Assigned To | Status | Notes |
|----|------|-------------|--------|-------|
| dmr-x-routing-p0-2026-09-20 | Fix safe P0 routing/candidate-selection faults from live baseline | Jack | 🔄 In Progress | Excludes invalid candidate modalities and improves fallback safety; provider-key policy pending new keys |

| dmrx-three-pillars-wave2 | Implement production gateway/free reliability, runtime execution/sharing, MCP/A2A security/protocols | Jack/Astra + Sol implementation, Luna review | 🔄 In Progress | Ownership/seams: docs/plans/2026-09-28-three-pillars-execution.md; daily listeners unchanged until staging approval |
| dmrx-production-2026-09-28 | Production audit, company gateway onboarding, runtime, MCP/A2A, free-tier verification and minimal fixes | Jack/Astra (Sol workers, Luna review) | ✅ Audit/first fixes complete; release HOLD | 1737 unit tests passed; 18 isolated HTTP checks passed; free live 16/18. Daily listener unchanged. Gate: reports/production-2026-09-28-gate.md |

---

| dmrx-six-client-proxy-2026-10-07 | Implement Responses, Gemini/Cloud Code compatibility, six-client setup/restore and real-client verification | Jack + free OpenCode workers | 🔄 In Progress | Isolated worktrees; no push or public exposure; protocol tests are not client E2E proof |

| dmrx-consumer-readiness-2026-10-11 | Evidence-based enterprise runtime, consumer UX, gateway/free-tier hardening and live release verification | Jack + Luna workers | ⛔ Release HOLD; verification recorded | Four test-fixture repairs and blank-output regression remain integrated; fresh18 focused checks pass. Isolated named teams4 tests pass; sharing7 pass/2 confirmed lifecycle leaks. UI remains partial. Queue ended; supervisor paused after model-drift skips. Full CI/GitNexus/catalog/security gates open. User authorised push, but green-tree rule blocks commit/push. Current handoff:reports/consumer-readiness-verification-and-unfinished.md. |

| dmrx-readiness-verify-publish-2026-10-11 | Independently verify readiness work, record unfinished items, commit/push only completed green scope | Jack | ✅ Bounded verification/handoff complete; ⛔ publication blocked | Fresh:18 focused pass; teams4 pass; sharing7 pass/2 lifecycle failures. Isolated runtime typechecks pass. Full tests/lint/gateway/UI/GitNexus timeout; catalog stale; audit1 critical/2 high. No commit/push. Report:reports/consumer-readiness-verification-and-unfinished.md. Supervisor paused; prototypes and unrelated dirty work preserved. |

| dmrx-readiness-resume-closeout | Resume isolated sharing/UI/security/catalog/team lanes; independently verify and integrate only approved work | Jack + isolated subagents | ⛔ Approved headroom retry complete; readiness still HOLD | Dependency metadata and catalog fixes preserved. User-approved MCP interruption completed; gateway stop via PM2 timed out, so gateway stayed running. MCP auto-restarted; both daily health endpoints verified200. Sharing/teams, Node22 sharing, lint and gateway/UI typechecks still timeout. Direct native imports and worker-ready probe pass, but real GitNexus indexing exits1 at5000ms readiness deadline; no valid impact graph. No implementation-symbol edits, full install, commit/push/deploy. Reports: reports/readiness-headroom-closeout.md and reports/readiness-headroom-service-restoration.json. |

| jack-dmrx-worktree-reconcile-cleanup | Inventory archived/live DMR-X worktrees; reconcile only verified finished work; remove exact approved redundant paths after preservation and verification | Jack + reconciliation subagents | ✅ Exact 17 approved archive copies deleted and verified | User replied Delete; all 17 exact targets removed, no errors. Revalidated 25,034 archive files and ZIP hashes/CRC before deletion; 2,700 main-file hashes unchanged after deletion, Git status/HEAD/refs/registered workers unchanged. Verified backup retained; receipt: .recovery/jack-worktree-reconciliation-20261012-101953/approved-archive-deletion-receipt.json. Measured net gain for this deletion1.63 GB; current free25.76 GB, total net increase25.44 GB from original reading, so original50 GB goal not met. No application source ports, commits or pushes. Only this ledger and preservation receipts updated. Full CI/GitNexus not certified. |

## Ishtar approved ecosystem source study — 2026-10-13

| ISHTAR-STUDY-20261013 | Read-only gateway/router/native-runtime/contracts assessment | Ishtar execution worker + source-review subagent | ⛔ Partial checkpoint | Delegated early dossier preserved, not final: gateway/authorization/native hosted execution/contracts and worktree comparison remain unfinished. No implementation/services/providers/tests/cleanup or external publishing; existing tasks untouched. No source worker remains assigned. |

## Status Legend
- ☐ Pending
- 🔄 In Progress
- ✅ Completed
- ⛔ Blocked

## Rules
1. Tag all work with your profile name
2. Check this file BEFORE starting any new task
3. Add unlisted tasks to this file BEFORE beginning work
4. Mark task as 🔄 In Progress BEFORE starting work
5. Mark task as ✅ Completed ONLY when verified done
6. First agent to mark 🔄 wins the task — do not touch another's in-progress task
7. Report status to keep the checklist current
