# Agents Checklist

| ID | Task | Assigned To | Status | Notes |
|----|------|-------------|--------|-------|
| dmr-x-routing-p0-2026-09-20 | Fix safe P0 routing/candidate-selection faults from live baseline | Jack | 🔄 In Progress | Excludes invalid candidate modalities and improves fallback safety; provider-key policy pending new keys |

| dmrx-three-pillars-wave2 | Implement production gateway/free reliability, runtime execution/sharing, MCP/A2A security/protocols | Jack/Astra + Sol implementation, Luna review | 🔄 In Progress | Ownership/seams: docs/plans/2026-09-28-three-pillars-execution.md; daily listeners unchanged until staging approval |
| dmrx-production-2026-09-28 | Production audit, company gateway onboarding, runtime, MCP/A2A, free-tier verification and minimal fixes | Jack/Astra (Sol workers, Luna review) | ✅ Audit/first fixes complete; release HOLD | 1737 unit tests passed; 18 isolated HTTP checks passed; free live 16/18. Daily listener unchanged. Gate: reports/production-2026-09-28-gate.md |

---

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
